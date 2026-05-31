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
      status: 'error',
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
