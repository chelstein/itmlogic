// County spatial intersection service.
//
// Given a contour polygon (GeoJSON Polygon or MultiPolygon geometry, or a
// GeoJSON Feature wrapping one), returns a county overlay evidence block:
//
//   {
//     available: true,
//     source: 'FCC_COUNTY_KML',
//     dataset_path: '/opt/genoa-cartography/...',
//     dataset_sha256: '...',
//     valid_source_kml_files: 3207,
//     fcc_endpoint_misses: 18,
//     partial_but_valid: true,
//     unique_county_count: 3207,
//     valid_county_count: 3206,
//     counties_intersected: [ { ... }, ... ],
//     counties_fully_contained: [ 'YAVAPAI, AZ', ... ],
//     counties_partially_intersected: [ 'COCONINO, AZ', ... ],
//     contour_area_sq_km: 45321,
//     warnings: []
//   }
//
// Intersection algorithm (uses @turf/turf):
//   1. Bounding-box prefilter (fast reject).
//   2. turf.booleanIntersects for a second-pass candidate test.
//   3. turf.intersect for the actual overlap polygon.
//   4. turf.area on the overlap polygon → intersection_area_sq_km.
//   5. turf.area on the county polygon → county_area_sq_km.
//   6. percent_of_county_covered = intersect / county × 100.
//   7. percent_of_contour_in_county = intersect / contour × 100.
//   8. A county is "fully contained" when percent_of_county_covered >= 99.5%.

import * as turf from '@turf/turf';
import {
  getCountyDataset,
  loadCountyBoundaries,
  KNOWN_MISSING_COUNTIES
} from './countyBoundaryLoader.js';

// ── Bounding box helpers ──────────────────────────────────────────────────────

function bboxOf(geometry){
  try {
    return turf.bbox({ type: 'Feature', geometry });
  } catch {
    return null;
  }
}

function bboxesOverlap(a, b){
  if (!a || !b) return true;  // optimistic when bbox fails
  // a/b = [minLon, minLat, maxLon, maxLat]
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

// ── Feature wrappers ──────────────────────────────────────────────────────────

function toFeature(geom){
  if (!geom) return null;
  if (geom.type === 'Feature') return geom;
  return { type: 'Feature', properties: {}, geometry: geom };
}

// ── Main intersection function ────────────────────────────────────────────────

// contourGeom: GeoJSON geometry (Polygon or MultiPolygon) or Feature wrapping one.
// opts.path:   optional override for dataset path (useful in tests).
export async function computeCountyOverlay(contourGeom, opts = {}){
  const warnings = [];

  // Unwrap Feature if needed.
  const contourFeature = toFeature(
    contourGeom?.type === 'Feature' ? contourGeom.geometry : contourGeom
  );
  if (!contourFeature || !contourFeature.geometry){
    return {
      available: false,
      error: 'no_contour_geometry',
      warnings
    };
  }

  // Load dataset.
  const ds = opts._dataset || getCountyDataset(opts.path);

  if (!ds.ok){
    warnings.push({
      code:   ds.warning_code || 'COUNTY_BOUNDARY_LOAD_FAILED',
      detail: ds.detail || ds.error
    });
    return { available: false, error: ds.error, warnings };
  }

  if (ds.parse_warnings?.length > 0){
    warnings.push({ code: 'COUNTY_BOUNDARY_FEATURE_PARSE_WARNING',
      detail: `${ds.parse_warnings.length} features could not be parsed` });
  }
  if (ds.partial_but_valid){
    warnings.push({ code: 'COUNTY_OVERLAY_PARTIAL_DATASET',
      detail: `${ds.fcc_endpoint_misses} FCC KML endpoint misses in dataset` });
  }

  // Contour area and bbox.
  let contour_area_sq_km = null;
  let contourBbox = null;
  try {
    contour_area_sq_km = turf.area(contourFeature) / 1e6;
    contourBbox = bboxOf(contourFeature.geometry);
  } catch (e){
    warnings.push({ code: 'COUNTY_INTERSECTION_FAILED',
      detail: `Failed to compute contour area: ${e.message}` });
  }

  // ── Per-county intersection ───────────────────────────────────────────────
  const counties_intersected = [];
  const intersectionErrors   = [];

  for (const county of ds._validCounties){
    // Bounding-box prefilter.
    const countyBbox = bboxOf(county.geometry);
    if (!bboxesOverlap(contourBbox, countyBbox)) continue;

    const countyFeature = toFeature(county.geometry);

    // Second-pass boolean check before the expensive intersect call.
    let doesIntersect = false;
    try {
      doesIntersect = turf.booleanIntersects(contourFeature, countyFeature);
    } catch (e){
      intersectionErrors.push({ county: county.key, stage: 'booleanIntersects', error: e.message });
      continue;
    }
    if (!doesIntersect) continue;

    // Compute intersection polygon and area.
    let intersection_area_sq_km = null;
    let county_area_sq_km = null;
    let percent_of_county_covered = null;
    let percent_of_contour_in_county = null;

    try {
      const intersectFeat = turf.intersect(
        turf.featureCollection([contourFeature, countyFeature])
      );
      if (intersectFeat && intersectFeat.geometry){
        intersection_area_sq_km = turf.area(intersectFeat) / 1e6;
      } else {
        // booleanIntersects said yes but intersect returned null — boundary touch only.
        continue;
      }
    } catch (e){
      intersectionErrors.push({ county: county.key, stage: 'intersect', error: e.message });
      continue;
    }

    try {
      county_area_sq_km = turf.area(countyFeature) / 1e6;
    } catch (e){
      intersectionErrors.push({ county: county.key, stage: 'county_area', error: e.message });
    }

    if (Number.isFinite(intersection_area_sq_km) && Number.isFinite(county_area_sq_km) && county_area_sq_km > 0){
      percent_of_county_covered = (intersection_area_sq_km / county_area_sq_km) * 100;
    }
    if (Number.isFinite(intersection_area_sq_km) && Number.isFinite(contour_area_sq_km) && contour_area_sq_km > 0){
      percent_of_contour_in_county = (intersection_area_sq_km / contour_area_sq_km) * 100;
    }

    counties_intersected.push({
      county_name:              county.county_name,
      state:                    county.state,
      display_name:             county.display_name,
      key:                      county.key,
      intersection_area_sq_km:  Number.isFinite(intersection_area_sq_km) ? +intersection_area_sq_km.toFixed(3) : null,
      county_area_sq_km:        Number.isFinite(county_area_sq_km) ? +county_area_sq_km.toFixed(3) : null,
      percent_of_county_covered: Number.isFinite(percent_of_county_covered) ? +percent_of_county_covered.toFixed(2) : null,
      percent_of_contour_in_county: Number.isFinite(percent_of_contour_in_county) ? +percent_of_contour_in_county.toFixed(2) : null
    });
  }

  // Classify fully vs. partially intersected.
  const counties_fully_contained      = counties_intersected
    .filter(c => c.percent_of_county_covered != null && c.percent_of_county_covered >= 99.5)
    .map(c => c.key);
  const counties_partially_intersected = counties_intersected
    .filter(c => c.percent_of_county_covered == null || c.percent_of_county_covered < 99.5)
    .map(c => c.key);

  // Check for missing-county intersection.
  const missing_hits = [];
  for (const county of (ds.counties || [])){
    if (!county.geometry_valid && county.centroid){
      const pt = turf.point([county.centroid.lon, county.centroid.lat]);
      try {
        if (KNOWN_MISSING_COUNTIES.has(county.key) && turf.booleanPointInPolygon(pt, contourFeature)){
          missing_hits.push(county.key);
        }
      } catch { /* centroid check is best-effort */ }
    }
  }
  if (missing_hits.length > 0){
    warnings.push({
      code: 'COUNTY_MISSING_INTERSECTION',
      detail: `Contour intersects ${missing_hits.length} county(ies) with no FCC KML boundary: ${missing_hits.join(', ')}`
    });
  }

  if (intersectionErrors.length > 0){
    warnings.push({
      code:   'COUNTY_INTERSECTION_FAILED',
      detail: `${intersectionErrors.length} county intersection(s) failed; see errors array`
    });
  }

  return {
    available:                   true,
    source:                      'FCC_COUNTY_KML',
    dataset_path:                ds.path,
    dataset_sha256:              ds.dataset_sha256,
    valid_source_kml_files:      ds.valid_source_kml_files,
    fcc_endpoint_misses:         ds.fcc_endpoint_misses,
    partial_but_valid:           ds.partial_but_valid,
    unique_county_count:         ds.unique_county_count,
    valid_county_count:          ds.valid_county_count,
    contour_area_sq_km:          Number.isFinite(contour_area_sq_km) ? +contour_area_sq_km.toFixed(3) : null,
    counties_intersected,
    counties_fully_contained,
    counties_partially_intersected,
    errors:                      intersectionErrors.length > 0 ? intersectionErrors : undefined,
    warnings
  };
}
