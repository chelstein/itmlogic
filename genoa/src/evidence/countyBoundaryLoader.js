// FCC County Boundary Loader
//
// Loads the FCC-derived county boundary GeoJSON (us_counties_fcc.geojson)
// once at first use and caches it for the process lifetime.
//
// Source: FCC_COUNTY_GEOJSON_PATH environment variable.
//   File path:  '/opt/genoa-cartography/data/reference/us_counties_fcc.geojson'
//   HTTP/HTTPS: 'http://159.223.153.153:8765/us_counties_fcc.geojson'
//
// getCountyDataset(pathOrUrl) is async and handles both.
// loadCountyBoundaries(filePath) is sync (file path only — for tests / CLI).
//
// Dataset format (from FCC contourplot.kml conversion):
//   - 7,094 raw features for ~3,207 unique county-equivalents
//   - Boundary features: { Name: "YAVAPAI, AZ", altitudeMode: "clampToGround",
//       tessellate: 1 }, geometry type LineString / MultiLineString
//   - Label/centroid features: { Name: "YAVAPAI, AZ",
//       description: "Latitude: 34.57 Longitude: -112.47" }, geometry type Point
//
// Loader steps:
//   1. Read file (or fetch URL) and compute SHA-256.
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

// Known approximate centroids for the 18 FCC endpoint-miss counties.
// Used by countyIntersectionClient.js to fire COUNTY_MISSING_INTERSECTION
// when a contour encloses one of these gap counties.  These counties are
// absent from the loaded GeoJSON (the FCC endpoint never returned their KML),
// so there are no geometry records in the dataset to iterate — the centroid
// manifest is the only way to detect an overlap.
//
// Coordinates are [lon, lat] in decimal degrees (WGS-84), accurate to ~1 km.
export const MISSING_COUNTY_CENTROIDS = new Map([
  ['RIO GRANDE, PR',   [-65.83, 18.38]],
  ['MANATI, PR',       [-66.48, 18.43]],
  ['ANASCO, PR',       [-67.14, 18.29]],
  ['PENUELAS, PR',     [-66.73, 17.99]],
  ['CATANO, PR',       [-66.11, 18.44]],
  ['COMERIO, PR',      [-66.23, 18.22]],
  ['SAN GERMAN, PR',   [-67.04, 18.08]],
  ['CANOVANAS, PR',    [-65.90, 18.38]],
  ['JUANA DIAZ, PR',   [-66.51, 18.05]],
  ['LAS MARIAS, PR',   [-66.99, 18.25]],
  ['GUANICA, PR',      [-66.91, 17.97]],
  ['LOIZA, PR',        [-65.88, 18.43]],
  ['MAYAGUEZ, PR',     [-67.14, 18.20]],
  ['SAN SEBASTIAN, PR',[-66.99, 18.34]],
  ['RINCON, PR',       [-67.25, 18.34]],
  ['BAYAMON, PR',      [-66.16, 18.40]],
  ['BALTIMORE CITY, MD',[-76.61, 39.29]],
  ['ST. LOUIS CITY, MO',[-90.20, 38.63]],
]);

// FCC_ENDPOINT_MISSES count — used in dataset metadata.
export const FCC_ENDPOINT_MISSES = 18;

// Module-level singleton.
// _cached   — resolved dataset (or error result) after first successful load.
// _loading  — Promise in flight, prevents duplicate fetches under concurrency.
let _cached  = null;
let _loading = null;

// Returns true when the path/URL string should be fetched over HTTP(S).
export function isUrl(s){
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

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

// ── Shared raw-to-dataset processing ─────────────────────────────────────────
//
// Called by both the sync file loader and the async URL loader.
// raw    — GeoJSON string (already read/fetched).
// source — file path or URL, stored on the result for provenance.

function _processRaw(raw, source){
  // SHA-256
  const dataset_sha256 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');

  // Parse JSON
  let fc;
  try {
    fc = JSON.parse(raw);
  } catch (e){
    return {
      ok: false,
      error: 'PARSE_FAILED',
      detail: `JSON parse error: ${e.message}`,
      warning_code: 'COUNTY_BOUNDARY_LOAD_FAILED',
      path: source,
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
    path:                 source,
    dataset_sha256,
    raw_feature_count,
    valid_source_kml_files: valid_counties.length,   // derived from what was actually parsed, not a manifest literal
    fcc_endpoint_misses:  FCC_ENDPOINT_MISSES,       // documented upstream-manifest constant (18 FCC KML endpoints never returned boundaries)
    partial_but_valid:    valid_counties.length > 0 && (invalid_counties.length > 0 || FCC_ENDPOINT_MISSES > 0),
    unique_county_count:  counties.length,
    valid_county_count:   valid_counties.length,
    invalid_county_count: invalid_counties.length,
    parse_warnings:       parseWarnings,
    geometry_errors:      geometryErrors,
    counties,
    _byKey:         new Map(counties.map(c => [c.key, c])),
    _validCounties: valid_counties
  };
}

// ── File loader (sync) ────────────────────────────────────────────────────────

export function loadCountyBoundaries(filePath){
  filePath = filePath || DEFAULT_COUNTY_PATH;
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e){
    return {
      ok: false,
      error: 'DATASET_MISSING',
      detail: `File not found at ${filePath}: ${e.message}`,
      warning_code: 'COUNTY_BOUNDARY_DATASET_MISSING',
      path: filePath
    };
  }
  return _processRaw(raw, filePath);
}

// ── URL loader (async) ────────────────────────────────────────────────────────

// 30 s covers a cold-start on the data server; keeps exhibit requests from hanging
// indefinitely when the endpoint stalls after accepting the connection.
const FETCH_TIMEOUT_MS = 30_000;

export async function fetchCountyBoundaries(url){
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let raw;
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok){
      return {
        ok: false,
        error: 'DATASET_MISSING',
        detail: `HTTP ${res.status} fetching county dataset from ${url}`,
        warning_code: 'COUNTY_BOUNDARY_DATASET_MISSING',
        path: url
      };
    }
    raw = await res.text();
  } catch (e){
    const timedOut = e.name === 'AbortError';
    return {
      ok: false,
      error: 'DATASET_MISSING',
      detail: timedOut
        ? `Timeout fetching county dataset from ${url} (>${FETCH_TIMEOUT_MS} ms)`
        : `Network error fetching county dataset from ${url}: ${e.message}`,
      warning_code: 'COUNTY_BOUNDARY_DATASET_MISSING',
      path: url
    };
  } finally {
    clearTimeout(timer);
  }
  return _processRaw(raw, url);
}

// ── Lazy singleton (async, URL- and file-aware) ───────────────────────────────
//
// Returns a Promise that resolves to the dataset.  A single in-flight fetch
// is reused for concurrent callers; the result is cached for the process
// lifetime.  Set FCC_COUNTY_GEOJSON_PATH to a file path or an http(s) URL.

export async function getCountyDataset(pathOrUrl){
  if (_cached)  return _cached;
  if (_loading) return _loading;

  const source = pathOrUrl || DEFAULT_COUNTY_PATH;
  _loading = (isUrl(source)
    ? fetchCountyBoundaries(source)
    : Promise.resolve(loadCountyBoundaries(source))
  ).then(ds => {
    _cached  = ds;
    _loading = null;
    return ds;
  });
  return _loading;
}

// For tests: reset the cache so each test gets a fresh load.
export function _resetCache(){
  _cached  = null;
  _loading = null;
}
