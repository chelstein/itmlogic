// 47 CFR §73.24(j) — AM principal community coverage.
//
// The rule: the 5 mV/m groundwave daytime contour must encompass the
// entire legal boundary of the principal community (city of license).
// Where it does not, the application must include a §73.24(j) waiver
// showing.  Real-world reference: Mullaney KELP 1989 Engineering
// Statement, Section I — "The 5.0 mV daytime contour covers 92
// percent of the city limits of El Paso; therefore this proposal
// shows 'substantial compliance' with Section 73.24(j)."  (Mullaney's
// 92% triggered the waiver showing under §73.24(j) at the time;
// modern practice treats anything below 80% as non-compliant and
// 80-99% as substantial compliance requiring justification.)
//
// This module computes the §73.24(j) coverage percentage from
// whatever data is attached.  When the operator provides a community
// boundary GeoJSON we run a real polygon-overlap area calculation;
// when they don't we report NOT_RUN with explicit instructions for
// what to attach.
//
// Output: { applicable, regulation, findings, overall_pass, summary,
//           coverage_pct, computed_method } — same shape as
// section_73_150 / section_73_24g for uniform verdict rendering.

const SUBSTANTIAL_COMPLIANCE_THRESHOLD = 0.80;   // < 80% → fail-soft non-compliant
const FULL_COMPLIANCE_THRESHOLD        = 0.999;  // ≥ 99.9% → unambiguous pass
const RULE_CITE                        = '47 CFR §73.24(j)';

/**
 * @param {object} args
 * @param {object} args.exhibit  the exhibit object (read-only)
 */
export function checkAm73_24j({ exhibit } = {}){
  const result = {
    applicable: false,
    regulation: RULE_CITE,
    findings: [],
    overall_pass: null,
    coverage_pct: null,
    computed_method: null
  };

  const service = String(exhibit?.station_inputs?.service || '').toUpperCase();
  if (service !== 'AM'){
    return { ...result, reason: 'rule applies only to AM service' };
  }
  result.applicable = true;

  const community = exhibit?.station_inputs?.community_of_license
                 || exhibit?.facility_metadata?.community_of_license
                 || null;
  const cityBoundary = exhibit?.station_inputs?.community_boundary_geojson
                    || exhibit?.evidence?.community_boundary
                    || null;
  const cityPoly5mvm = polygonForContour(exhibit, 'city_5mvm');

  // Finding 1 — the 5 mV/m city-grade contour itself must exist.
  result.findings.push({
    rule:      'city_grade_contour_present',
    citation:  `${RULE_CITE} — 5 mV/m city-grade groundwave contour must be computed`,
    observed:  cityPoly5mvm
                ? `5 mV/m polygon attached (${cityPoly5mvm.coordinates?.[0]?.length || 0} vertices)`
                : '5 mV/m polygon missing from computed contour set',
    pass:      !!cityPoly5mvm,
    detail:    cityPoly5mvm
                ? '5 mV/m city-grade contour computed and available for the coverage check.'
                : '5 mV/m city-grade contour missing — check that city_5mvm is in AM_DEFAULT_CONTOURS and polygon assembly ran.'
  });

  // Finding 2 — coverage percentage.  Decisive only when the operator
  // attached a community_boundary_geojson; otherwise NOT_RUN with the
  // explicit instruction needed to enable the check.
  if (cityBoundary && cityPoly5mvm){
    const cov = computeCoveragePct({
      service_polygon:  cityPoly5mvm,
      community_polygon: extractFirstPolygon(cityBoundary)
    });
    if (cov && Number.isFinite(cov.coverage_pct)){
      result.coverage_pct    = cov.coverage_pct;
      result.computed_method = cov.method;
      const pct = cov.coverage_pct * 100;
      const fullPass = cov.coverage_pct >= FULL_COMPLIANCE_THRESHOLD;
      const substantial = cov.coverage_pct >= SUBSTANTIAL_COMPLIANCE_THRESHOLD;
      result.findings.push({
        rule:      'coverage_percentage',
        citation:  `${RULE_CITE} — 5 mV/m contour must encompass the entire legal community boundary`,
        limit:     '100% (or §73.24(j) waiver showing for substantial compliance)',
        observed:  `${pct.toFixed(2)}% of ${community || 'community-of-license'} legal boundary inside 5 mV/m contour (method: ${cov.method})`,
        pass:      fullPass,
        detail:    fullPass
          ? '5 mV/m contour fully encompasses the principal community — straightforward §73.24(j) compliance.'
          : substantial
            ? `Substantial compliance (${pct.toFixed(1)}% coverage).  Modern practice requires a §73.24(j) waiver showing for any shortfall; cf. Mullaney KELP 1989 which filed a 92% coverage waiver showing the same way.`
            : `Non-compliant (${pct.toFixed(1)}% coverage).  The 5 mV/m contour does not encompass the principal community and the shortfall is too large for the standard 'substantial compliance' showing — facility redesign (move site, increase TPO, or re-pattern DA) likely required.`
      });
    } else {
      result.findings.push({
        rule:      'coverage_percentage',
        citation:  `${RULE_CITE} — 5 mV/m contour must encompass the entire legal community boundary`,
        observed:  'attached community boundary GeoJSON could not be parsed as a polygon',
        pass:      null,
        detail:    'Attach community_boundary_geojson as a single Polygon feature (RFC 7946) in WGS-84.  Multi-polygon Census Place shapes should be merged into the convex hull or outer ring before attachment.'
      });
    }
  } else {
    result.findings.push({
      rule:      'coverage_percentage',
      citation:  `${RULE_CITE} — 5 mV/m contour must encompass the entire legal community boundary`,
      observed:  cityBoundary
                  ? 'community boundary attached but 5 mV/m polygon missing'
                  : `${community || 'community-of-license'} legal boundary not attached`,
      pass:      null,
      detail:    cityBoundary
                  ? 'Community boundary present but service polygon missing — fix the polygon assembly first.'
                  : 'Not measured — attach inputs.community_boundary_geojson (RFC 7946 Polygon in WGS-84) to enable the §73.24(j) coverage check.  Sources: US Census TIGER/Line Places shapefile, OSM Nominatim relation, or operator-supplied GIS layer.'
    });
  }

  // Overall: every decisive finding must pass.
  const decisive = result.findings.filter((f) => f.pass !== null);
  result.overall_pass = decisive.length > 0 && decisive.every((f) => f.pass === true);
  result.summary = result.overall_pass
    ? '§73.24(j) principal-community coverage check passes (5 mV/m contour encompasses city-of-license).'
    : decisive.some((f) => f.pass === false)
      ? '§73.24(j) principal-community coverage check FAILED — see findings.'
      : '§73.24(j) check incomplete — community boundary GeoJSON not attached.';

  return result;
}

// ─────────── helpers ───────────

// Surface the polygon for a given contour id from exhibit.polygons.
// Returns a GeoJSON Polygon when found; null otherwise.
function polygonForContour(exhibit, contourId){
  const polys = Array.isArray(exhibit?.polygons) ? exhibit.polygons : null;
  if (!polys) return null;
  const hit = polys.find((p) => p?.id === contourId || p?.contour_id === contourId);
  if (!hit) return null;
  // Polygons stored as { id, polygon_lonlat: [[lon, lat], ...] } or as
  // full GeoJSON.  Normalize to { type: 'Polygon', coordinates: [...] }.
  if (hit.type === 'Polygon' && Array.isArray(hit.coordinates)) return hit;
  if (Array.isArray(hit.polygon_lonlat)){
    return { type: 'Polygon', coordinates: [hit.polygon_lonlat] };
  }
  if (hit?.geometry?.type === 'Polygon') return hit.geometry;
  return null;
}

// Extract a single Polygon from a GeoJSON Feature / FeatureCollection /
// MultiPolygon by taking the largest ring (good-enough for city
// boundaries; Census Places multi-polygons usually have a single
// dominant outer ring).
function extractFirstPolygon(g){
  if (!g) return null;
  if (g.type === 'Polygon') return g;
  if (g.type === 'Feature' && g.geometry) return extractFirstPolygon(g.geometry);
  if (g.type === 'FeatureCollection' && Array.isArray(g.features)){
    for (const f of g.features){
      const p = extractFirstPolygon(f);
      if (p) return p;
    }
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length){
    // Largest ring by point count is a workable proxy for largest area
    // at city scales without dragging in a full geodesic area lib.
    const largest = g.coordinates.reduce((best, ring) =>
      (ring?.[0]?.length || 0) > (best?.[0]?.length || 0) ? ring : best, null);
    if (largest) return { type: 'Polygon', coordinates: largest };
  }
  return null;
}

// Coverage = area(service ∩ community) / area(community).  Uses a
// local-tangent projection at the community centroid so polygon area
// computation stays planar (sub-percent error at city scales).
// Returns { coverage_pct, method } or null when polygons are degenerate.
function computeCoveragePct({ service_polygon, community_polygon }){
  if (!service_polygon || !community_polygon) return null;
  const serviceRing   = service_polygon.coordinates?.[0];
  const communityRing = community_polygon.coordinates?.[0];
  if (!Array.isArray(serviceRing) || !Array.isArray(communityRing)) return null;
  if (serviceRing.length < 3 || communityRing.length < 3) return null;

  const centroid = ringCentroidLonLat(communityRing);
  const project  = makeLocalTangentProjection(centroid);
  const serviceXY   = serviceRing.map(project);
  const communityXY = communityRing.map(project);

  const aCommunity = Math.abs(shoelaceArea(communityXY));
  if (aCommunity <= 0) return null;

  // Sutherland-Hodgman convex clip.  Service contour at city scales
  // is convex enough for this to be accurate; for highly concave
  // service polygons a robust polygon-clipping library would be
  // needed (out of scope for first ship).
  const clipped = sutherlandHodgman(communityXY, serviceXY);
  const aClipped = Math.abs(shoelaceArea(clipped));
  const pct = aClipped / aCommunity;
  return {
    coverage_pct: Math.min(1, Math.max(0, pct)),
    method: 'Sutherland-Hodgman convex clip in local-tangent projection (sub-percent area error at city scales)'
  };
}

function ringCentroidLonLat(ring){
  let lon = 0, lat = 0, n = 0;
  for (const [x, y] of ring){
    if (Number.isFinite(x) && Number.isFinite(y)){ lon += x; lat += y; n++; }
  }
  return n > 0 ? [lon / n, lat / n] : [0, 0];
}

function makeLocalTangentProjection([lon0, lat0]){
  const R = 6371.0088;
  const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
  return ([lon, lat]) => {
    const dLon = (lon - lon0) * Math.PI / 180;
    const dLat = (lat - lat0) * Math.PI / 180;
    return [R * dLon * cosLat0, R * dLat];  // km
  };
}

function shoelaceArea(pts){
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++){
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function sutherlandHodgman(subject, clip){
  let output = subject.slice();
  for (let i = 0, n = clip.length; i < n; i++){
    const a = clip[i];
    const b = clip[(i + 1) % n];
    const input = output;
    output = [];
    for (let j = 0, m = input.length; j < m; j++){
      const p = input[j];
      const q = input[(j + 1) % m];
      const pIn = inside(p, a, b);
      const qIn = inside(q, a, b);
      if (pIn && qIn){ output.push(q); }
      else if (pIn && !qIn){ output.push(intersect(p, q, a, b)); }
      else if (!pIn && qIn){ output.push(intersect(p, q, a, b)); output.push(q); }
    }
    if (output.length === 0) break;
  }
  return output;
}
function inside(p, a, b){
  // Half-plane test for CCW-oriented clip edge a→b.
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}
function intersect(p, q, a, b){
  const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1];
  const x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (denom === 0) return p;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}
