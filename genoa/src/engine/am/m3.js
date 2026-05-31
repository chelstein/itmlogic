// FCC §73.190 Figure M3 ground conductivity map — GeoTIFF raster lookup.
//
// Opens AM_m3.tif once (lazy, on first call) via the geotiff package,
// which makes efficient range reads so the full raster is never loaded
// into memory.  Provides a local fallback when the ZTR M3 proxy is
// unavailable.
//
// DATA SOURCE (search order):
//   1. AM_M3_TIF_PATH env var
//   2. /opt/genoa/live-data/m3/AM_m3.tif   (production)
//   3. /opt/genoa/live-data/m3/m3.tif
//   4. <repo>/data/m3/AM_m3.tif            (local dev)
//
// Pixel values are treated as mS/m.  Set AM_M3_TIF_SCALE=1000 if the
// raster stores S/m (all values ≤ 0.1) instead.
//
// REGULATORY BASIS: 47 CFR §73.190 Figure M3.

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TIF_SEARCH_PATHS = [
  process.env.AM_M3_TIF_PATH,
  '/opt/genoa/live-data/m3/AM_m3.tif',
  '/opt/genoa/live-data/m3/m3.tif',
  resolve(__dirname, '..', '..', '..', '..', 'data', 'm3', 'AM_m3.tif'),
  resolve(__dirname, '..', '..', '..', '..', 'data', 'm3', 'm3.tif'),
].filter(Boolean);

const SIGMA_SCALE = Number(process.env.AM_M3_TIF_SCALE || 1) || 1;

let _state = {
  status:     'pending',  // 'pending' | 'loaded' | 'error'
  sourcePath: null,
  loadError:  null,
  image:      null,
  originLon:  null,
  originLat:  null,
  resLon:     null,
  resLat:     null,
  width:      null,
  height:     null
};
let _loadPromise = null;

async function _ensureLoaded(){
  if (_state.status !== 'pending') return;
  if (_loadPromise) return _loadPromise;
  _loadPromise = _doLoad();
  return _loadPromise;
}

async function _doLoad(){
  const { fromFile } = await import('geotiff');

  let sourcePath = null;
  let image = null;

  for (const p of TIF_SEARCH_PATHS){
    if (!existsSync(p)) continue;
    try {
      const tiff = await fromFile(p);
      image = await tiff.getImage();
      sourcePath = p;
      break;
    } catch { /* try next */ }
  }

  if (!image){
    _state = {
      ..._state,
      status:    'error',
      loadError: `AM_m3.tif not found; searched: ${TIF_SEARCH_PATHS.join(', ')}`
    };
    return;
  }

  const origin = image.getOrigin();
  const res    = image.getResolution();

  if (!origin || !res || !Number.isFinite(origin[0]) || !Number.isFinite(res[0])){
    _state = {
      ..._state,
      status: 'error',
      sourcePath,
      loadError: `${sourcePath}: no georeferencing (getOrigin/getResolution failed)`
    };
    return;
  }

  _state = {
    status:     'loaded',
    sourcePath,
    loadError:  null,
    image,
    originLon:  origin[0],
    originLat:  origin[1],
    resLon:     res[0],
    resLat:     res[1],
    width:      image.getWidth(),
    height:     image.getHeight()
  };
}

/**
 * Look up FCC M3 ground conductivity at a point.
 *
 * @param {number} lat  Decimal degrees latitude (positive = North)
 * @param {number} lon  Decimal degrees longitude (negative = West)
 * @returns {Promise<{
 *   available:    boolean,
 *   sigma_mS_m?:  number,
 *   zone_label?:  string,
 *   source:       string,
 *   regulation?:  string,
 *   error?:       string
 * }>}
 */
export async function lookupM3Conductivity(lat, lon){
  await _ensureLoaded();

  if (_state.status !== 'loaded'){
    return { available: false, source: 'fcc-m3-tif-local', error: _state.loadError || 'GeoTIFF not loaded' };
  }

  const fLat = Number(lat);
  const fLon = Number(lon);
  if (!Number.isFinite(fLat) || !Number.isFinite(fLon)){
    return { available: false, source: 'fcc-m3-tif-local', error: 'lat and lon must be finite numbers' };
  }

  const { image, originLon, originLat, resLon, resLat, width, height } = _state;
  const px = Math.floor((fLon - originLon) / resLon);
  const py = Math.floor((fLat - originLat) / resLat);

  if (px < 0 || px >= width || py < 0 || py >= height){
    return { available: false, source: 'fcc-m3-tif-local', error: 'point outside raster coverage' };
  }

  let rawValue;
  try {
    const data = await image.readRasters({ window: [px, py, px + 1, py + 1] });
    rawValue = data[0][0];
  } catch (e){
    return { available: false, source: 'fcc-m3-tif-local', error: `raster read failed: ${e.message}` };
  }

  if (rawValue == null || !Number.isFinite(rawValue) || rawValue <= 0){
    return { available: false, source: 'fcc-m3-tif-local', error: 'no-data pixel at this location' };
  }

  const sigma = rawValue * SIGMA_SCALE;
  return {
    available:  true,
    sigma_mS_m: sigma,
    zone_label: `${sigma} mS/m (FCC M3)`,
    source:     'fcc-m3-tif-local',
    regulation: '47 CFR §73.190 Figure M3'
  };
}

// ── Zone-based screening fallback ─────────────────────────────────────
//
// Approximates FCC Figure M3 conductivity using geographic bounding boxes
// for the major US conductivity regions.  Values are taken from the FCC's
// published representative conductivities in 47 CFR Part 73 Appendix B
// and longstanding AM engineering practice.
//
// This is a SCREENING-GRADE fallback: ±50% accuracy vs. the raster.
// Only returned when both ZTR and local GeoTIFF are unavailable.

const M3_ZONE_TABLE = [
  // Central Great Plains — finest agricultural soils, highest conductivity.
  { label: 'Great Plains',    sigma: 15, lat: [35, 49], lon: [-104, -90] },
  // Upper Midwest corn belt.
  { label: 'Upper Midwest',   sigma: 10, lat: [40, 49], lon: [-97, -80] },
  // Southeast coastal plain and Gulf coast.
  { label: 'Southeast',       sigma: 10, lat: [25, 37], lon: [-92, -76] },
  // Appalachians and mid-Atlantic.
  { label: 'Mid-Atlantic',    sigma:  8, lat: [35, 44], lon: [-84, -72] },
  // New England (rocky glacial soils).
  { label: 'New England',     sigma:  5, lat: [40, 48], lon: [-76, -67] },
  // Pacific Northwest.
  { label: 'Pacific NW',      sigma: 10, lat: [42, 49], lon: [-125, -117] },
  // Pacific Coast (California coast + valleys).
  { label: 'Pacific Coast',   sigma:  8, lat: [32, 42], lon: [-125, -117] },
  // Desert Southwest (AZ, NM, southern NV, southern CA desert).
  { label: 'Desert SW',       sigma:  2, lat: [31, 38], lon: [-117, -103] },
  // Great Basin (NV, UT, southern ID).
  { label: 'Great Basin',     sigma:  2, lat: [36, 45], lon: [-120, -110] },
  // Rocky Mountain uplift (CO, WY, ID, MT).
  { label: 'Rocky Mtns',      sigma:  2, lat: [37, 49], lon: [-116, -104] },
  // Northern Plains (ND, SD, MT eastern).
  { label: 'Northern Plains', sigma: 10, lat: [44, 49], lon: [-105, -96] },
  // Florida peninsula.
  { label: 'Florida',         sigma: 10, lat: [25, 31], lon: [-88, -80] },
  // Alaska (poor rocky/permafrost soils as a conservative default).
  { label: 'Alaska',          sigma:  2, lat: [51, 72], lon: [-180, -130] },
  // Hawaii (tropical volcanic soils, moderate).
  { label: 'Hawaii',          sigma:  5, lat: [18, 23], lon: [-162, -154] },
  // Fallback for anything else in CONUS (eastern US general).
  { label: 'CONUS-general',   sigma:  5, lat: [24, 50], lon: [-130, -64] },
];

/**
 * Screening-grade FCC M3 zone lookup by lat/lon.
 *
 * Returns a result with `available:true` and `filing_grade:'screening'`
 * only when the exact GeoTIFF is unavailable.  Callers should include
 * `filing_grade` in their evidence record so the PDF exhibit can flag
 * that σ is screening-grade.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {{ available:boolean, sigma_mS_m?:number, zone_label?:string,
 *             source:string, filing_grade:string, regulation?:string }}
 */
export function lookupM3ZoneFallback(lat, lon){
  const fLat = Number(lat);
  const fLon = Number(lon);
  if (!Number.isFinite(fLat) || !Number.isFinite(fLon)){
    return { available: false, source: 'fcc-m3-zone-fallback', error: 'lat/lon not finite' };
  }
  for (const zone of M3_ZONE_TABLE){
    if (fLat >= zone.lat[0] && fLat <= zone.lat[1]
     && fLon >= zone.lon[0] && fLon <= zone.lon[1]){
      return {
        available:    true,
        sigma_mS_m:   zone.sigma,
        zone_label:   `${zone.label} (~${zone.sigma} mS/m, FCC M3 zone estimate)`,
        source:       'fcc-m3-zone-fallback',
        filing_grade: 'screening',
        regulation:   '47 CFR §73.190 Figure M3 (approximate zone; GeoTIFF not available)',
        note:         'Screening-grade conductivity from FCC M3 zone table. Deploy AM_m3.tif or configure ZTR for filing-grade σ.',
      };
    }
  }
  return { available: false, source: 'fcc-m3-zone-fallback', error: 'point outside all defined M3 zones' };
}

/**
 * Status of the locally loaded M3 GeoTIFF — for health checks.
 */
export function m3LoadStatus(){
  if (_state.status === 'pending'){
    // trigger load but don't await — status will update asynchronously
    _ensureLoaded().catch(() => {});
    return { loaded: false, status: 'pending', searched: TIF_SEARCH_PATHS };
  }
  if (_state.status === 'error'){
    return { loaded: false, status: 'error', error: _state.loadError, searched: TIF_SEARCH_PATHS };
  }
  return {
    loaded:     true,
    status:     'loaded',
    path:       _state.sourcePath,
    width:      _state.width,
    height:     _state.height,
    sigma_scale: SIGMA_SCALE
  };
}
