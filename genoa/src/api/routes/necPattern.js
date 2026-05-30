// POST /api/nec/pattern — lightweight NEC pattern preview.
//
// Lets the UI preview a directional pattern from a NEC antenna geometry
// spec without running a full exhibit.  The pattern_table returned is the
// same shape used by the exhibit engine's DA pattern code paths.
//
// REQUEST BODY
//   {
//     "antenna_geometry": {
//       "frequency_khz": 1190,
//       "ground": { "type": "sommerfeld", "conductivity_s_m": 0.005, "dielectric_constant": 13 },
//       "towers": [
//         { "tag": 1, "x_m": 0, "y_m": 0, "height_m": 75, "radius_m": 0.25, "segments": 21,
//           "drive": { "amplitude": 1.0, "phase_deg": 0 } }
//       ]
//     }
//   }
//
// SUCCESS RESPONSE
//   { "ok": true, "pattern_table": [[0, 1.0], ...], "nec_available": true, "converged": true }
//
// SIDECAR OFFLINE RESPONSE
//   { "ok": false, "nec_available": false, "error": "NEC_SIDECAR_UNAVAILABLE" }
//
// AUTH: same cookie-session auth as all other /api/* routes (requireAuth
//       applied globally in server.js before this router is mounted).

import express from 'express';
import { sidecars }        from '../services/sidecars.js';
import { necPatternToTable } from '../../evidence/nec/client.js';
import { asyncHandler }    from '../middleware/errors.js';

const r = express.Router();

r.post('/nec/pattern', asyncHandler(async (req, res) => {
  // 1. Validate request body
  const body = req.body;
  if (!body || typeof body !== 'object'){
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'JSON body required' });
  }
  const geo = body.antenna_geometry;
  if (!geo || typeof geo !== 'object'){
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'antenna_geometry object required' });
  }
  if (!Array.isArray(geo.towers) || geo.towers.length === 0){
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'antenna_geometry.towers array required' });
  }

  // 2. Check NEC sidecar availability
  const necClient = sidecars.nec;
  if (!necClient){
    return res.json({ ok: false, nec_available: false, error: 'NEC_SIDECAR_UNAVAILABLE' });
  }

  // 3. Run the NEC am-array model
  let necResponse;
  try {
    necResponse = await necClient.runAmArray(geo);
  } catch (e){
    return res.json({ ok: false, nec_available: true, error: 'NEC_RUN_FAILED', detail: String(e?.message || e) });
  }

  if (!necResponse || necResponse.ok === false){
    return res.json({
      ok:            false,
      nec_available: true,
      error:         necResponse?.error || 'NEC_RUN_FAILED',
      detail:        necResponse?.detail || null
    });
  }

  // 4. Convert NEC pattern to Genoa pattern_table
  const pattern_table = necPatternToTable(necResponse);
  if (!pattern_table){
    return res.json({
      ok:            false,
      nec_available: true,
      error:         'NEC_PATTERN_EMPTY',
      detail:        'NEC response did not contain a usable far-field pattern at the horizon'
    });
  }

  // 5. Return success
  return res.json({
    ok:            true,
    nec_available: true,
    converged:     true,
    pattern_table
  });
}));

export default r;
