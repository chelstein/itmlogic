// Genoa terrain sidecar — THIN ADAPTER.
//
// This sidecar is a wrapper, not a new engine.  It must shell out to:
//   - chelstein/splat        (terrain-aware Longley-Rice contour overlays)
//   - chelstein/itmlogic     (pure-Python ITM, terrain profiles)
//   - chelstein/ZTRpsITS     (ITS reference comparisons)
// and normalize their outputs into the JSON the genoa engine consumes.
//
// Endpoints:
//   GET  /health   -> 200 "ok"
//   GET  /version  -> { sidecar, upstream_tools }
//   POST /v1/haat  -> { provider, arc, haat_per_radial: [{az, haat_m, ...}] }
//
// Wiring in the upstream tools is intentionally a TODO so this sidecar
// is shipped honestly: today it returns 503 "upstream tool not wired"
// for /v1/haat unless TERRAIN_BACKEND is explicitly set and the binary
// is on PATH.  The genoa engine treats 503 as SIDECAR_UNAVAILABLE.

import express from 'express';
import { spawnSync } from 'node:child_process';

const PORT     = parseInt(process.env.SIDECAR_PORT || process.env.PORT || '8081', 10);
const BACKEND  = process.env.TERRAIN_BACKEND || null;   // 'splat' | 'itmlogic' | 'ztrpsits'
const SPLAT_BIN    = process.env.SPLAT_BIN    || 'splat';
const ITMLOGIC_BIN = process.env.ITMLOGIC_BIN || 'python3 -m itmlogic';
const ZTRPSITS_BIN = process.env.ZTRPSITS_BIN || 'ztrpsits';
const VERSION  = '0.1.0';

const app = express();
app.use(express.json({ limit: '4mb' }));
app.disable('x-powered-by');

app.get('/health',  (_req, res) => res.type('text').send('ok'));
app.get('/version', (_req, res) => res.json({
  sidecar: { name: 'genoa-terrain-sidecar', version: VERSION },
  backend: BACKEND,
  upstream_tools: {
    'chelstein/splat':    { binary: SPLAT_BIN,    available: which(SPLAT_BIN.split(/\s+/)[0]) },
    'chelstein/itmlogic': { binary: ITMLOGIC_BIN, available: null /* python module */ },
    'chelstein/ZTRpsITS': { binary: ZTRPSITS_BIN, available: which(ZTRPSITS_BIN.split(/\s+/)[0]) }
  }
}));

app.post('/v1/haat', async (req, res) => {
  if (!BACKEND){
    return res.status(503).json({
      error: 'TERRAIN_BACKEND_NOT_WIRED',
      detail: 'Set TERRAIN_BACKEND=splat | itmlogic | ztrpsits and ensure the upstream binary is on PATH. The terrain sidecar is an adapter; it does not implement Longley-Rice / ITM itself.',
      upstream_tools: ['chelstein/splat', 'chelstein/itmlogic', 'chelstein/ZTRpsITS']
    });
  }
  // The actual call-out to the upstream tool is left explicit: it MUST
  // use one of the chelstein repos.  The placeholder below documents
  // the exact contract a wired backend has to satisfy.
  return res.status(501).json({
    error: 'NOT_IMPLEMENTED',
    detail: `wire ${BACKEND} subprocess call here; output must conform to { provider, arc:{from_km,to_km,samples}, haat_per_radial:[{az, avg_elev_m, min_elev_m, max_elev_m, haat_m}] }`,
    backend: BACKEND
  });
});

function which(bin){
  try {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    return r.status === 0 ? (r.stdout || '').trim() : false;
  } catch { return false; }
}

app.listen(PORT, '0.0.0.0', () => console.log(`[genoa-terrain-sidecar] listening on 0.0.0.0:${PORT} backend=${BACKEND || '(none)'} version=${VERSION}`));
