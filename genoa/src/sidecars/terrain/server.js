// Genoa terrain sidecar — HAAT computation via public DEM APIs.
//
// This sidecar implements §73.313 per-radial HAAT from real terrain data.
// It can also forward requests to SPLAT or itmlogic for full ITM coverage
// analysis once those binaries are provisioned.
//
// BACKENDS (select via TERRAIN_BACKEND env var)
//   usgs-epqs   — USGS 3DEP Elevation Point Query Service (NED / 3DEP,
//                 the same dataset FCC uses for its own contour HAAT).
//                 No API key required.  Free public service.
//                 URL: https://epqs.nationalmap.gov/v1/json
//
//   splat       — chelstein/splat binary + DEM tiles in WORKDIR.
//                 Returns 503 until DEM tiles are provisioned.
//
//   itmlogic    — chelstein/itmlogic Python module.
//                 Returns 503 until DEM tiles are provisioned.
//
// HAAT ALGORITHM (per §73.313)
//   For each requested radial azimuth:
//   1. Generate `samples` equally-spaced points along the radial from
//      `from_km` to `to_km` using the WGS-84 Karney geodesic Direct().
//   2. Query USGS 3DEP for the ground elevation (AMSL, meters) at each point.
//   3. Average the sampled ground elevations.
//   4. HAAT = tx_amsl_m − mean(ground_elevations_m).
//
//   This matches the FCC §73.313(d) arc-averaging method for computed HAAT.
//
// ENDPOINTS
//   GET  /health    → 200 "ok"
//   GET  /version   → { sidecar, backend, upstream_tools }
//   POST /v1/haat   → { provider, arc, haat_per_radial: [{az, ...}] }
//     body: {
//       tx_lat, tx_lon, tx_amsl_m,
//       radials_deg: number[],
//       from_km?: number  (default 3),
//       to_km?:   number  (default 16),
//       samples?: number  (default 27)
//     }

import express from 'express';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const PORT     = parseInt(process.env.SIDECAR_PORT || process.env.PORT || '8081', 10);
const BACKEND  = process.env.TERRAIN_BACKEND || null;
const SPLAT_BIN    = process.env.SPLAT_BIN    || 'splat';
const ITMLOGIC_BIN = process.env.ITMLOGIC_BIN || 'python3 -m itmlogic';
const ZTRPSITS_BIN = process.env.ZTRPSITS_BIN || 'ztrpsits';
const VERSION  = '0.2.0';

// USGS 3DEP EPQS — official USGS elevation service.
// Same NED/3DEP dataset FCC uses for contour HAAT computation.
// Returns AMSL elevation in meters.
const USGS_EPQS_URL = 'https://epqs.nationalmap.gov/v1/json';
const USGS_EPQS_TIMEOUT_MS = 10_000;
const USGS_MAX_CONCURRENT  = 20;   // parallel fetch limit to avoid 429s

// Load Karney geodesic for accurate radial sample point computation.
const geographiclib = require('geographiclib-geodesic');
const { Geodesic } = geographiclib;
const _GEOD = Geodesic.WGS84;

const app = express();
app.use(express.json({ limit: '256kb' }));
app.disable('x-powered-by');

app.get('/health',  (_req, res) => res.type('text').send('ok'));
app.get('/version', (_req, res) => res.json({
  sidecar: { name: 'genoa-terrain-sidecar', version: VERSION },
  backend: BACKEND,
  upstream_tools: {
    'chelstein/splat':    { binary: SPLAT_BIN,    available: which(SPLAT_BIN.split(/\s+/)[0]) },
    'chelstein/itmlogic': { binary: ITMLOGIC_BIN, available: null },
    'chelstein/ZTRpsITS': { binary: ZTRPSITS_BIN, available: which(ZTRPSITS_BIN.split(/\s+/)[0]) }
  }
}));

app.post('/v1/haat', async (req, res) => {
  const { tx_lat, tx_lon, tx_amsl_m, radials_deg,
          from_km = 3, to_km = 16, samples = 27 } = req.body || {};

  // Validate required inputs
  if (!Number.isFinite(tx_lat) || !Number.isFinite(tx_lon)){
    return res.status(400).json({ error: 'tx_lat and tx_lon required' });
  }
  if (!Number.isFinite(tx_amsl_m)){
    return res.status(400).json({ error: 'tx_amsl_m (antenna AMSL, meters) required' });
  }
  if (!Array.isArray(radials_deg) || !radials_deg.length){
    return res.status(400).json({ error: 'radials_deg must be a non-empty array' });
  }

  if (BACKEND === 'usgs-epqs'){
    try {
      const result = await computeHaatUsgsEpqs({
        tx_lat, tx_lon, tx_amsl_m, radials_deg,
        from_km, to_km, samples
      });
      return res.json(result);
    } catch (e){
      return res.status(502).json({
        error: 'USGS_EPQS_FAILED',
        detail: String(e.message)
      });
    }
  }

  if (BACKEND === 'splat' || BACKEND === 'itmlogic' || BACKEND === 'ztrpsits'){
    return res.status(503).json({
      error: 'TERRAIN_BACKEND_NOT_WIRED',
      detail: `Backend '${BACKEND}' requires DEM tiles provisioned in WORKDIR and subprocess wiring. See chelstein/splat, chelstein/itmlogic, chelstein/ZTRpsITS.`,
      upstream_tools: ['chelstein/splat', 'chelstein/itmlogic', 'chelstein/ZTRpsITS']
    });
  }

  // No TERRAIN_BACKEND set
  return res.status(503).json({
    error: 'TERRAIN_BACKEND_NOT_CONFIGURED',
    detail: 'Set TERRAIN_BACKEND=usgs-epqs (free, no auth) to enable HAAT computation. For ITM coverage analysis set TERRAIN_BACKEND=splat|itmlogic|ztrpsits and provision DEM tiles.',
    available_backends: ['usgs-epqs', 'splat', 'itmlogic', 'ztrpsits']
  });
});

// ---------------------------------------------------------------------------
// USGS 3DEP EPQS HAAT implementation
// ---------------------------------------------------------------------------

async function computeHaatUsgsEpqs({
  tx_lat, tx_lon, tx_amsl_m, radials_deg,
  from_km, to_km, samples
}){
  // Build all sample points for all radials
  const allPoints = [];   // { radialIdx, sampleIdx, lat, lon }
  for (let ri = 0; ri < radials_deg.length; ri++){
    const az = radials_deg[ri];
    for (let si = 0; si < samples; si++){
      const d_km = from_km + (to_km - from_km) * (si / (samples - 1));
      const r = _GEOD.Direct(tx_lat, tx_lon, az, d_km * 1000);
      allPoints.push({ radialIdx: ri, sampleIdx: si, lat: r.lat2, lon: r.lon2 });
    }
  }

  // Fetch elevations in parallel batches of USGS_MAX_CONCURRENT
  const elevations = new Array(allPoints.length).fill(null);
  const chunks = chunkArray(allPoints, USGS_MAX_CONCURRENT);
  for (const chunk of chunks){
    await Promise.all(chunk.map(async (pt, i) => {
      const idx = allPoints.indexOf(pt);
      try {
        elevations[idx] = await fetchUsgsEpqs(pt.lat, pt.lon);
      } catch {
        elevations[idx] = null;   // graceful; will surface as NaN HAAT
      }
    }));
  }

  // Compute per-radial HAAT
  const haat_per_radial = radials_deg.map((az, ri) => {
    const start = ri * samples;
    const radialElevs = elevations.slice(start, start + samples)
      .filter(e => e != null && Number.isFinite(e));
    if (!radialElevs.length){
      return { az, avg_elev_m: null, min_elev_m: null, max_elev_m: null,
               haat_m: null, samples_ok: 0, samples_total: samples };
    }
    const avg = radialElevs.reduce((a, b) => a + b, 0) / radialElevs.length;
    const min = Math.min(...radialElevs);
    const max = Math.max(...radialElevs);
    const haat_m = tx_amsl_m - avg;
    return {
      az,
      avg_elev_m:   Math.round(avg * 10) / 10,
      min_elev_m:   Math.round(min * 10) / 10,
      max_elev_m:   Math.round(max * 10) / 10,
      haat_m:       Math.round(haat_m * 10) / 10,
      samples_ok:   radialElevs.length,
      samples_total: samples
    };
  });

  return {
    provider: 'usgs-epqs',
    dem_source: 'USGS 3DEP / NED (National Elevation Dataset)',
    dem_url:    USGS_EPQS_URL,
    regulation: '47 CFR §73.313(d) arc-averaged HAAT',
    arc: { from_km, to_km, samples, method: 'equal-spacing, Karney WGS-84 geodesic' },
    tx: { lat: tx_lat, lon: tx_lon, amsl_m: tx_amsl_m },
    haat_per_radial,
    fetched_at: new Date().toISOString()
  };
}

async function fetchUsgsEpqs(lat, lon){
  const url = `${USGS_EPQS_URL}?x=${lon}&y=${lat}&wkid=4326&units=Meters&includeDate=false`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), USGS_EPQS_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`USGS EPQS HTTP ${r.status}`);
    const j = await r.json();
    const val = j?.value ?? j?.Value ?? j?.elevation;
    const elev = Number(val);
    if (!Number.isFinite(elev) || elev < -500 || elev > 9000){
      throw new Error(`USGS EPQS unexpected value: ${val}`);
    }
    return elev;
  } finally {
    clearTimeout(t);
  }
}

function chunkArray(arr, size){
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function which(bin){
  try {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    return r.status === 0 ? (r.stdout || '').trim() : false;
  } catch { return false; }
}

app.listen(PORT, '0.0.0.0', () =>
  console.log(`[genoa-terrain-sidecar] v${VERSION} listening on 0.0.0.0:${PORT} backend=${BACKEND || '(none)'}`));
