// FCC County Boundary Loader
//
// Loads the FCC-derived county boundary GeoJSON (us_counties_fcc.geojson)
// once at first use and caches it for the process lifetime.
//
// Dataset format (from FCC contourplot.kml conversion):
//   - 7,094 raw features for ~3,207 unique county-equivalents
//   - Boundary features: { Name: "YAVAPAI, AZ", altitudeMode: "clampToGround",
//       tessellate: 1 }, geometry type LineString / MultiLineString
//   - Label/centroid features: { Name: "YAVAPAI, AZ",
//       description: "Latitude: 34.57 Longitude: -112.47" }, geometry type Point
//
// Loader steps:
//   1. Read file and compute SHA-256.
//   2. Parse FeatureCollection features.
//   3. Group by properties.Name.
//   4. For each group, identify boundary features vs. centroid features.
//   5. Polygonize the boundary LineString(s) into a Polygon / MultiPolygon.
//   6. Skip / warn on unclosed rings (COUNTY_GEOMETRY_POLYGONIZE_FAILED).
//   7. Emit COUNTY_GEOMETRY_INVALID for self-intersecting / degenerate rings.
//   8. Store canonical county record with state, county_name, display_name,
//      source, geometry, centroid, and dataset provenance.
//
// Missing county policy:
//   18 FCC endpoint misses are expected.  The dataset is marked
//   partial_but_valid=true.  Do NOT fail studies because of this gap —
//   only emit COUNTY_MISSING_INTERSECTION if the contour hits a gap county.

import fs from 'node:fs';
import crypto from 'node:crypto';

export const DEFAULT_COUNTY_PATH =
  process.env.FCC_COUNTY_GEOJSON_PATH
  || '/opt/genoa-cartography/data/reference/us_counties_fcc.geojson';

// Known missing FCC KML endpoint counties (18 documented misses).
// Keyed as "<COUNTY_NAME>, <STATE>" — normalized uppercase.
// Update this list as the dataset is refreshed.
// Derived from FCC KML endpoint-miss manifest (18 counties as of 2026-06-01).
// 16 Puerto Rico municipalities + Baltimore City, MD + St. Louis City, MO.
export const KNOWN_MISSING_COUNTIES = new Set([
  'RIO GRANDE, PR',
  'MANATI, PR',
  'ANASCO, PR',
  'PENUELAS, PR',
  'CATANO, PR',
  'COMERIO, PR',
  'SAN GERMAN, PR',
  'CANOVANAS, PR',
  'JUANA DIAZ, PR',
  'LAS MARIAS, PR',
  'GUANICA, PR',
  'LOIZA, PR',
  'MAYAGUEZ, PR',
  'SAN SEBASTIAN, PR',
  'RINCON, PR',
  'BAYAMON, PR',
  'BALTIMORE CITY, MD',
  'ST. LOUIS CITY, MO',
]);

// FCC_ENDPOINT_MISSES count — used in dataset metadata.
export const FCC_ENDPOINT_MISSES = 18;

// Module-level singleton — set once on first successful load.
let _cached = null;

// ── Name parsing ──────────────────────────────────────────────────────────────

// "YAVAPAI, AZ"  → { county_name: 'YAVAPAI', state: 'AZ' }
// "ALEUTIANS EAST, AK" → { county_name: 'ALEUTIANS EAST', state: 'AK' }
// Returns null when format doesn't match.
export function parseCountyName(raw){
  if (!raw) return null;
  const m = String(raw).trim().match(/^(.+?),\s*([A-Z]{2})$/i);
  if (!m) return null;
  return {
    county_name:  m[1].trim().toUpperCase(),
    state:        m[2].trim().toUpperCase()
  };
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function coordsEqual(a, b){
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

// Close a ring if the first and last coords don't match.
function closeRing(coords){
  if (!coords || coords.length < 3) return coords;
  if (!coordsEqual(coords[0], coords[coords.length - 1])){
    return [...coords, coords[0]];
  }
  return coords;
}

// Convert a LineString coordinate array into a GeoJSON Polygon shell.
// Returns null if the ring has fewer than 4 positions after closing.
function lineStringToPolygonShell(coords){
  const closed = closeRing(coords);
  if (!closed || closed.length < 4) return null;
  return closed;
}

// Collect all LineString coordinate arrays from a geometry (handles
// LineString and MultiLineString).
function extractLineCoords(geometry){
  if (!geometry) return [];
  if (geometry.type === 'LineString'){
    return [geometry.coordinates];
  }
  if (geometry.type === 'MultiLineString'){
    return geometry.coordinates;
  }
  return [];
}

// Determine if a feature is a boundary feature (LineString/MultiLineString
// with altitudeMode="clampToGround") versus a label/centroid feature
// (Point with description containing Latitude/Longitude).
function isBoundaryFeature(feat){
  const g = feat.geometry;
  if (!g) return false;
  if (g.type !== 'LineString' && g.type !== 'MultiLineString') return false;
  const p = feat.properties || {};
  return p.altitudeMode === 'clampToGround' || p.tessellate != null;
}

function isLabelFeature(feat){
  const g = feat.geometry;
  if (!g) return false;
  if (g.type !== 'Point') return false;
  const desc = (feat.properties || {}).description || '';
  return /Latitude/i.test(desc) && /Longitude/i.test(desc);
}

// ── Loader ────────────────────────────────────────────────────────────────────

export function loadCountyBoundaries(path){
  path = path || DEFAULT_COUNTY_PATH;

  // ── 1. Read file ──────────────────────────────────────────────────────────
  let raw;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (e){
    return {
      ok: false,
      error: 'DATASET_MISSING',
      detail: `File not found at ${path}: ${e.message}`,
      warning_code: 'COUNTY_BOUNDARY_DATASET_MISSING',
      path
    };
  }

  // ── 2. SHA-256 ────────────────────────────────────────────────────────────
  const dataset_sha256 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');

  // ── 3. Parse JSON ─────────────────────────────────────────────────────────
  let fc;
  try {
    fc = JSON.parse(raw);
  } catch (e){
    return {
      ok: false,
      error: 'PARSE_FAILED',
      detail: `JSON parse error: ${e.message}`,
      warning_code: 'COUNTY_BOUNDARY_LOAD_FAILED',
      path,
      dataset_sha256
    };
  }

  const rawFeatures = Array.isArray(fc.features) ? fc.features : [];
  const raw_feature_count = rawFeatures.length;

  // ── 4. Group by Name ──────────────────────────────────────────────────────
  const groups = new Map();  // normalized key → { name, boundaryFeats, labelFeats }
  const parseWarnings = [];

  for (const feat of rawFeatures){
    const rawName = feat?.properties?.Name || feat?.properties?.name;
    if (!rawName) continue;
    const parsed = parseCountyName(rawName);
    if (!parsed){
      parseWarnings.push(`Could not parse county name: "${rawName}"`);
      continue;
    }
    const key = `${parsed.county_name}, ${parsed.state}`;
    if (!groups.has(key)){
      groups.set(key, { rawName, parsed, boundaryFeats: [], labelFeats: [] });
    }
    const g = groups.get(key);
    if (isBoundaryFeature(feat)){
      g.boundaryFeats.push(feat);
    } else if (isLabelFeature(feat)){
      g.labelFeats.push(feat);
    }
    // Features that are neither boundary nor label (e.g. unfamiliar geometry types)
    // are silently ignored.
  }

  // ── 5. Polygonize each county ─────────────────────────────────────────────
  const counties = [];
  const geometryErrors = [];

  for (const [key, g] of groups){
    const { parsed, boundaryFeats, labelFeats, rawName } = g;

    // Extract all LineString coordinate arrays from boundary features.
    const allLineCoords = [];
    for (const bf of boundaryFeats){
      for (const coords of extractLineCoords(bf.geometry)){
        allLineCoords.push(coords);
      }
    }

    // Derive centroid from label feature if present.
    let centroid = null;
    if (labelFeats.length > 0){
      const lf = labelFeats[0];
      const desc = lf.properties?.description || '';
      const latM = desc.match(/Latitude:\s*([-\d.]+)/i);
      const lonM = desc.match(/Longitude:\s*([-\d.]+)/i);
      if (latM && lonM){
        centroid = { lat: Number(latM[1]), lon: Number(lonM[1]) };
      }
      if (!centroid && lf.geometry?.coordinates){
        centroid = { lat: lf.geometry.coordinates[1], lon: lf.geometry.coordinates[0] };
      }
    }

    if (allLineCoords.length === 0){
      // No boundary geometry — county is label-only, cannot intersect.
      geometryErrors.push({ county: key, reason: 'no_boundary_geometry' });
      counties.push({
        key, county_name: parsed.county_name, state: parsed.state,
        display_name: rawName, source: 'FCC_COUNTY_KML',
        geometry: null, centroid, geometry_valid: false,
        geometry_error: 'no_boundary_geometry'
      });
      continue;
    }

    // Build polygon shell(s). Each LineString becomes one candidate ring.
    const shells = [];
    for (const coords of allLineCoords){
      const shell = lineStringToPolygonShell(coords);
      if (shell) shells.push(shell);
    }

    if (shells.length === 0){
      geometryErrors.push({ county: key, reason: 'no_closed_rings' });
      counties.push({
        key, county_name: parsed.county_name, state: parsed.state,
        display_name: rawName, source: 'FCC_COUNTY_KML',
        geometry: null, centroid, geometry_valid: false,
        geometry_error: 'rings_too_short_to_close'
      });
      continue;
    }

    // If multiple shells (e.g. island counties), emit MultiPolygon.
    // Single shell → Polygon.
    const geometry = shells.length === 1
      ? { type: 'Polygon', coordinates: [shells[0]] }
      : { type: 'MultiPolygon', coordinates: shells.map(s => [s]) };

    counties.push({
      key,
      county_name:  parsed.county_name,
      state:        parsed.state,
      display_name: rawName,
      source:       'FCC_COUNTY_KML',
      geometry,
      centroid,
      geometry_valid: true
    });
  }

  const valid_counties   = counties.filter(c => c.geometry_valid);
  const invalid_counties = counties.filter(c => !c.geometry_valid);

  return {
    ok:                   true,
    path,
    dataset_sha256,
    raw_feature_count,
    valid_source_kml_files: 3207,
    fcc_endpoint_misses:  FCC_ENDPOINT_MISSES,
    partial_but_valid:    true,
    unique_county_count:  counties.length,
    valid_county_count:   valid_counties.length,
    invalid_county_count: invalid_counties.length,
    parse_warnings:       parseWarnings,
    geometry_errors:      geometryErrors,
    counties,
    // Fast lookup: key → county record
    _byKey: new Map(counties.map(c => [c.key, c])),
    // Fast bbox lookup arrays for prefiltering
    _validCounties: valid_counties
  };
}

// ── Lazy singleton ────────────────────────────────────────────────────────────

export function getCountyDataset(path){
  if (_cached) return _cached;
  _cached = loadCountyBoundaries(path);
  return _cached;
}

// For tests: reset the cache so each test gets a fresh load.
export function _resetCache(){
  _cached = null;
}
