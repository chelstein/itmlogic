// AM Physics (SOMNEC2D) sidecar route.
//
//   GET  /api/am/physics/health
//     → 200 { ok, healthy, baseUrl, engine }
//
//   POST /api/am/physics/somnec
//     content-type: application/json
//     body: { epr?, sig_s_m?, sigma_ms_m?, frequency_mhz?, frequency_khz?,
//             print_grid?, debug? }
//     → 200 { available, engine, advisory, inputs, outputs, ...sidecar payload }
//          (200 even on sidecar-unconfigured/unreachable — UI renders inline)
//
// ADVISORY ONLY.  Independent physics evidence beside FCC rule math.
// Never overrides §73.184 contour distances, §73.183 allocation
// results, or any filing-controlling calculation.
//
// REGULATORY POSTURE
//   Genoa does not replace FCC allocation rules with NEC-family physics
//   output.  Genoa uses SOMNEC2D as an independent physics engine
//   beside deterministic FCC rule calculations.

import express from 'express';
import { sidecars } from '../services/sidecars.js';
import {
  DEFAULT_EPR,
  DEFAULT_GROUND_SIGMA_MS_M,
  sigmaMsmToSm,
  khzToMhz
} from '../../evidence/amPhysicsClient.js';
import { lookupM3Conductivity, m3LoadStatus } from '../../engine/am/m3.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

function notConfigured(){
  return {
    available: false,
    status:    'not_configured',
    advisory:  true,
    engine:    'somnec2d',
    error:     'AM physics sidecar unavailable — independent evidence omitted (AM_PHYSICS_SIDECAR_URL unset)',
    filing_effect: 'none',
    notes: [
      'Independent physics evidence only.',
      'Does not modify FCC §73.184 curve-derived contour distances.'
    ]
  };
}

r.get('/am/physics/health', asyncHandler(async (req, res) => {
  if (!sidecars.amPhysics){
    return res.json({ ok: false, configured: false, healthy: false, engine: 'somnec2d' });
  }
  const healthy = await sidecars.amPhysics.health();
  res.json({
    ok:         true,
    configured: true,
    healthy,
    baseUrl:    sidecars.amPhysics.baseUrl,
    engine:     'somnec2d'
  });
}));

r.post('/am/physics/somnec', express.json({ limit: '64kb' }), asyncHandler(async (req, res) => {
  if (!sidecars.amPhysics){
    return res.json(notConfigured());
  }
  const body = req.body || {};

  // Frequency: accept MHz directly or kHz (Genoa AM-band native).
  let frequency_mhz = Number(body.frequency_mhz);
  if (!Number.isFinite(frequency_mhz) || frequency_mhz <= 0){
    const khz = Number(body.frequency_khz);
    if (Number.isFinite(khz) && khz > 0){
      frequency_mhz = khzToMhz(khz);
    }
  }
  if (!Number.isFinite(frequency_mhz) || frequency_mhz <= 0){
    return res.status(400).json({
      available: false,
      error: 'frequency_mhz or frequency_khz required (positive finite number)'
    });
  }

  // Conductivity: accept S/m directly or mS/m (Genoa schema native).
  // Default to §73.190 Figure R3 average soil (8 mS/m) when neither is
  // supplied — the evidence block records the source explicitly.
  let sig_s_m  = Number(body.sig_s_m);
  let sigma_ms_m = Number(body.sigma_ms_m);
  let sigma_source = 'input';
  if (!Number.isFinite(sig_s_m) || sig_s_m <= 0){
    if (Number.isFinite(sigma_ms_m) && sigma_ms_m > 0){
      sig_s_m = sigmaMsmToSm(sigma_ms_m);
    } else {
      sigma_ms_m = DEFAULT_GROUND_SIGMA_MS_M;
      sig_s_m    = sigmaMsmToSm(sigma_ms_m);
      sigma_source = 'default';
    }
  } else if (!Number.isFinite(sigma_ms_m)){
    sigma_ms_m = sig_s_m * 1000;
  }

  // Dielectric: default to NEC average-soil convention when unset.
  let epr = Number(body.epr);
  let epr_source = 'input';
  if (!Number.isFinite(epr) || epr <= 0){
    epr = DEFAULT_EPR;
    epr_source = 'default';
  }

  const print_grid = body.print_grid == null ? 1 : (body.print_grid ? 1 : 0);
  const debug = !!body.debug;

  const out = await sidecars.amPhysics.runSomnec({
    epr, sig_s_m, frequency_mhz, print_grid, debug
  });

  res.json({
    ...out,
    inputs: {
      epr,
      epr_source,
      sig_s_m,
      sigma_ms_m,
      sigma_source,
      frequency_mhz,
      print_grid
    },
    method:        'NEC-family modified Sommerfeld integral ground-field solver',
    filing_effect: 'none',
    notes: [
      'Independent physics evidence only.',
      'Does not modify FCC §73.184 curve-derived contour distances.'
    ]
  });
}));

// ---- M3 ground conductivity endpoints ----
//
// GET /api/am/physics/m3/conductivity?lat=&lon=
//   Point-in-polygon lookup against the locally loaded AM_m3.geojson.
//   Returns the FCC §73.190 Figure M3 conductivity for the site.
//   Used by the exhibit orchestrator as tier-3 fallback when ZTR
//   M3 proxy is unavailable.  Also callable directly for inspection.
//
// GET /api/am/physics/m3/status
//   GeoJSON load status — feature count, file path, any load error.

r.get('/am/physics/m3/conductivity', asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)){
    return res.status(400).json({
      available: false,
      error: 'lat and lon query params required (decimal degrees)'
    });
  }
  const result = lookupM3Conductivity(lat, lon);
  res.json({
    ...result,
    fetched_at: new Date().toISOString()
  });
}));

r.get('/am/physics/m3/status', asyncHandler(async (req, res) => {
  res.json(m3LoadStatus());
}));

export default r;
