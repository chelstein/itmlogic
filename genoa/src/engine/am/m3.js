// FCC §73.190 Figure M3 ground conductivity map — local GeoJSON lookup.
//
// Loads AM_m3.geojson once at first call from AM_M3_GEOJSON_PATH
// (default: /opt/genoa/live-data/m3/AM_m3.geojson).  Provides a
// local fallback when the ZTR M3 proxy is unavailable.
//
// Point-in-polygon via ray-casting; the M3 map has ~150 polygons so
// a single lookup is sub-millisecond.
//
// REGULATORY BASIS: 47 CFR §73.190 Figure M3 (FCC ground conductivity
// map for the contiguous United States).  Values are on the integer
// mS/m grid {1, 2, 4, 8, 15, 30} historically; the FCC §73.184
// groundwave table is tabulated for 1–8 mS/m.

import fs from 'fs';

const DEFAULT_M3_PATH = '/opt/genoa/live-data/m3/AM_m3.geojson';

let _geojson   = null;
let _loadError = null;
let _loaded    = false;

function _load(){
  if (_loaded) return;
  _loaded = true;
  const p = process.env.AM_M3_GEOJSON_PATH || DEFAULT_M3_PATH;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    _geojson = JSON.parse(raw);
  } catch (e){
    _loadError = `AM_m3.geojson load failed (${p}): ${e.message}`;
  }
}

// Ray-casting point-in-polygon for a single coordinate ring.
function _pointInRing(lon, lat, ring){
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++){
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)){
      inside = !inside;
    }
  }
  return inside;
}

// Test [lon, lat] against a GeoJSON Polygon or MultiPolygon geometry.
function _pointInGeometry(lon, lat, geom){
  if (!geom) return false;
  if (geom.type === 'Polygon'){
    if (!_pointInRing(lon, lat, geom.coordinates[0])) return false;
    for (let h = 1; h < geom.coordinates.length; h++){
      if (_pointInRing(lon, lat, geom.coordinates[h])) return false; // hole
    }
    return true;
  }
  if (geom.type === 'MultiPolygon'){
    for (const poly of geom.coordinates){
      if (!_pointInRing(lon, lat, poly[0])) continue;
      let inHole = false;
      for (let h = 1; h < poly.length; h++){
        if (_pointInRing(lon, lat, poly[h])){ inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  }
  return false;
}

// Property key variants seen across FCC M3 GeoJSON vintages.
const SIGMA_KEYS = [
  'conductivity_mS_m', 'conductivity_msm', 'conductivity_mS_per_m',
  'conductivity', 'sigma_mS_m', 'sigma',
  'COND', 'CONDUCTIVITY', 'VALUE', 'value'
];

function _getSigma(props){
  if (!props) return null;
  for (const k of SIGMA_KEYS){
    const v = Number(props[k]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * Look up FCC M3 ground conductivity at a point.
 *
 * @param {number} lat  Decimal degrees latitude (positive = North)
 * @param {number} lon  Decimal degrees longitude (negative = West)
 * @returns {{
 *   available:    boolean,
 *   sigma_mS_m?:  number,
 *   zone_id?:     string,
 *   zone_label?:  string,
 *   source:       string,
 *   regulation?:  string,
 *   error?:       string
 * }}
 */
export function lookupM3Conductivity(lat, lon){
  _load();
  if (_loadError){
    return { available: false, source: 'fcc-m3-geojson-local', error: _loadError };
  }
  if (!_geojson?.features){
    return { available: false, source: 'fcc-m3-geojson-local', error: 'GeoJSON not loaded or has no features' };
  }
  const fLat = Number(lat);
  const fLon = Number(lon);
  if (!Number.isFinite(fLat) || !Number.isFinite(fLon)){
    return { available: false, source: 'fcc-m3-geojson-local', error: 'lat and lon must be finite numbers' };
  }
  for (const feat of _geojson.features){
    if (!_pointInGeometry(fLon, fLat, feat.geometry)) continue;
    const sigma = _getSigma(feat.properties);
    if (sigma === null) continue;
    const props      = feat.properties || {};
    const zone_id    = String(props.zone ?? props.ZONE ?? props.id ?? feat.id ?? '');
    const zone_label = String(props.label ?? props.LABEL ?? props.name ?? props.NAME ?? (sigma + ' mS/m'));
    return {
      available:  true,
      sigma_mS_m: sigma,
      zone_id,
      zone_label,
      source:     'fcc-m3-geojson-local',
      regulation: '47 CFR §73.190 Figure M3'
    };
  }
  return {
    available: false,
    source:    'fcc-m3-geojson-local',
    error:     'point not within any M3 polygon (outside CONUS coverage or GeoJSON gap)'
  };
}

/**
 * Status of the locally loaded M3 GeoJSON file — for health checks.
 */
export function m3LoadStatus(){
  _load();
  const p = process.env.AM_M3_GEOJSON_PATH || DEFAULT_M3_PATH;
  if (_loadError) return { loaded: false, path: p, error: _loadError };
  if (!_geojson)  return { loaded: false, path: p, error: 'not loaded' };
  return {
    loaded:        true,
    path:          p,
    feature_count: _geojson.features?.length ?? 0
  };
}
