// server.js — FCC/OET R86-1 Ground Wave advisory sidecar.
//
// Clean production Express API wrapping the GroundWaveFCC Octave engine.
// All outputs are ADVISORY ONLY: advisory:true, filing_effect:'none'.
// This sidecar never modifies FCC §73.184 curve-derived contour distances.
//
// Endpoints:
//   GET  /healthz              — octave reachability check
//   GET  /version              — engine metadata
//   POST /am/fccgw/field       — field strength at requested distances
//   POST /am/fccgw/contour     — contour distance for target field
//
// Port: 8096 (env PORT)
// Auth: optional bearer token (env FCCGW_API_TOKEN)

'use strict';

const express = require('express');
const { execFile } = require('child_process');
const { generateDistanceGrid, computeContour } = require('./contour.js');
const { runFccgw, FCCGW_OCTAVE_PATH } = require('./engine.js');

const PORT       = Number(process.env.PORT)           || 8096;
const API_TOKEN  = (process.env.FCCGW_API_TOKEN || '').trim() || null;
const STARTED_AT = new Date().toISOString();

// ---- AM frequency band limits in Hz ----
const FREQ_HZ_MIN = 530000;    // 530 kHz
const FREQ_HZ_MAX = 1710000;   // 1710 kHz

// ---- Auth middleware ----
function authMiddleware(req, res, next){
  if (!API_TOKEN) return next();
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || token !== API_TOKEN){
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized — valid Bearer token required',
      code:  'AUTH_REQUIRED'
    });
  }
  next();
}

// ---- Request logger ----
function requestLogger(req, res, next){
  const t0 = Date.now();
  res.on('finish', function(){
    process.stdout.write(JSON.stringify({
      ts:          new Date().toISOString(),
      method:      req.method,
      path:        req.path,
      status:      res.statusCode,
      duration_ms: Date.now() - t0
    }) + '\n');
  });
  next();
}

// ---- Validation helpers ----
function validateAmRequest(body, requireTarget){
  const b = body || {};
  const freq_hz       = b.freq_hz;
  const sigma_s_per_m = b.sigma_s_per_m;
  const epsilon       = b.epsilon;
  const e1km_mvm      = b.e1km_mvm;
  const target_field_mvm = b.target_field_mvm;
  const distances_km  = b.distances_km;

  if (freq_hz === undefined || freq_hz === null){
    return { error: 'freq_hz is required', code: 'MISSING_FIELD' };
  }
  if (!Number.isFinite(Number(freq_hz))){
    return { error: 'freq_hz must be a finite number', code: 'INVALID_FIELD' };
  }
  const fFreq = Number(freq_hz);
  if (fFreq < FREQ_HZ_MIN || fFreq > FREQ_HZ_MAX){
    return {
      error: 'freq_hz must be between ' + FREQ_HZ_MIN + ' and ' + FREQ_HZ_MAX + ' Hz (530-1710 kHz AM band)',
      code: 'OUT_OF_RANGE'
    };
  }

  if (sigma_s_per_m === undefined || sigma_s_per_m === null){
    return { error: 'sigma_s_per_m is required', code: 'MISSING_FIELD' };
  }
  const fSigma = Number(sigma_s_per_m);
  if (!Number.isFinite(fSigma) || fSigma <= 0){
    return { error: 'sigma_s_per_m must be a positive finite number (S/m)', code: 'INVALID_FIELD' };
  }

  if (epsilon === undefined || epsilon === null){
    return { error: 'epsilon is required', code: 'MISSING_FIELD' };
  }
  const fEpsilon = Number(epsilon);
  if (!Number.isFinite(fEpsilon) || fEpsilon < 1){
    return { error: 'epsilon must be >= 1 (relative dielectric constant)', code: 'INVALID_FIELD' };
  }

  if (e1km_mvm === undefined || e1km_mvm === null){
    return { error: 'e1km_mvm is required', code: 'MISSING_FIELD' };
  }
  const fE1km = Number(e1km_mvm);
  if (!Number.isFinite(fE1km) || fE1km <= 0){
    return { error: 'e1km_mvm must be a positive finite number (mV/m)', code: 'INVALID_FIELD' };
  }

  if (requireTarget){
    if (target_field_mvm === undefined || target_field_mvm === null){
      return { error: 'target_field_mvm is required', code: 'MISSING_FIELD' };
    }
    const fTarget = Number(target_field_mvm);
    if (!Number.isFinite(fTarget) || fTarget <= 0){
      return { error: 'target_field_mvm must be a positive finite number (mV/m)', code: 'INVALID_FIELD' };
    }
  }

  if (distances_km !== undefined){
    if (!Array.isArray(distances_km)){
      return { error: 'distances_km must be an array', code: 'INVALID_FIELD' };
    }
    if (distances_km.length === 0){
      return { error: 'distances_km must be non-empty', code: 'INVALID_FIELD' };
    }
    for (let i = 0; i < distances_km.length; i++){
      const d = distances_km[i];
      if (!Number.isFinite(Number(d)) || Number(d) <= 0){
        return { error: 'All distances_km values must be positive finite numbers', code: 'INVALID_FIELD' };
      }
    }
  }

  return null;  // valid
}

// ---- Build Express app ----
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

// ---- GET /healthz ---- (no auth — monitoring probes must not require a token)
app.get('/healthz', function(req, res){
  const child = execFile('octave', ['--version'], { timeout: 5000, maxBuffer: 64 * 1024 }, function(err, stdout){
    const octave_available = !err && (stdout.includes('GNU Octave') || stdout.includes('octave'));
    res.status(octave_available ? 200 : 503).json({
      ok:               octave_available,
      octave_available: octave_available,
      fccgw_path:       FCCGW_OCTAVE_PATH,
      started_at:       STARTED_AT
    });
  });
});

// ---- Apply auth to all routes below /healthz ----
app.use(authMiddleware);

// ---- GET /version ----
app.get('/version', function(req, res){
  res.json({
    engine:        'fccgw-oet-r86-1',
    model:         'FCC/OET R86-1 Ground Wave',
    regulation:    '47 CFR §73.184 — AM groundwave curves',
    advisory:      true,
    filing_effect: 'none',
    label:         'Independent Physics Validation — FCC/OET R86-1 Ground Wave',
    octave_path:   process.env.PATH || null,
    fccgw_path:    FCCGW_OCTAVE_PATH
  });
});

// ---- POST /am/fccgw/field ----
app.post('/am/fccgw/field', function(req, res){
  const err = validateAmRequest(req.body, false);
  if (err){
    return res.status(400).json(Object.assign({ ok: false }, err));
  }

  const b = req.body;
  const freq_hz       = Number(b.freq_hz);
  const sigma_s_per_m = Number(b.sigma_s_per_m);
  const epsilon       = Number(b.epsilon);
  const e1km_mvm      = Number(b.e1km_mvm);
  const distances_km  = b.distances_km
    ? b.distances_km.map(Number)
    : generateDistanceGrid(200);

  runFccgw({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km })
    .then(function(result){
      return res.json({
        ok:            true,
        advisory:      true,
        filing_effect: 'none',
        label:         'Independent Physics Validation — FCC/OET R86-1 Ground Wave',
        engine:        result.engine,
        inputs: { freq_hz, sigma_s_per_m, epsilon, e1km_mvm },
        distances_km:  result.distances_km,
        fields_mvm:    result.fields_mvm
      });
    })
    .catch(function(e){
      return res.status(500).json({
        ok:    false,
        error: e.message || 'Engine error',
        code:  'ENGINE_ERROR'
      });
    });
});

// ---- POST /am/fccgw/contour ----
app.post('/am/fccgw/contour', function(req, res){
  const err = validateAmRequest(req.body, true);
  if (err){
    return res.status(400).json(Object.assign({ ok: false }, err));
  }

  const b = req.body;
  const freq_hz         = Number(b.freq_hz);
  const sigma_s_per_m   = Number(b.sigma_s_per_m);
  const epsilon         = Number(b.epsilon);
  const e1km_mvm        = Number(b.e1km_mvm);
  const target_field_mvm = Number(b.target_field_mvm);

  computeContour({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, target_field_mvm })
    .then(function(result){
      return res.json({
        ok:                   true,
        advisory:             true,
        filing_effect:        'none',
        label:                'Independent Physics Validation — FCC/OET R86-1 Ground Wave',
        engine:               'fccgw-oet-r86-1',
        inputs: { freq_hz, sigma_s_per_m, epsilon, e1km_mvm, target_field_mvm },
        contour_distance_km:  result.contour_distance_km,
        field_mvm_at_contour: result.field_mvm_at_contour,
        bracketed_by:         result.bracketed_by,
        n_grid_points:        result.n_grid_points
      });
    })
    .catch(function(e){
      return res.status(500).json({
        ok:    false,
        error: e.message || 'Engine error',
        code:  'ENGINE_ERROR'
      });
    });
});

// ---- Start server ----
app.listen(PORT, function(){
  process.stdout.write(JSON.stringify({
    ts:         STARTED_AT,
    event:      'started',
    port:       PORT,
    fccgw_path: FCCGW_OCTAVE_PATH,
    auth:       API_TOKEN ? 'bearer_token' : 'none'
  }) + '\n');
});

module.exports = app;
