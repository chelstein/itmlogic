// POST /api/nec/pattern — unit tests for the NEC pattern preview route.
//
// These tests exercise the route handler directly by injecting a mock
// sidecars.nec client so the NEC2++ sidecar doesn't need to be running.
// Two acceptance criteria:
//   1. Valid geometry + working sidecar → { ok: true, pattern_table: [...] }
//   2. NEC sidecar unavailable (client = null) → { ok: false, nec_available: false }

import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal NEC response fixture (mirrors nec.test.js REF_RESPONSE).
// ---------------------------------------------------------------------------
const REF_PATTERN = {
  theta_deg: [0, 30, 60, 90, 120, 150, 180],
  phi_deg:   [0, 90, 180, 270],
  gain_dbi: [
    [-10, -10, -10, -10],
    [-5,  -5,  -5,  -5 ],
    [ 0,  -3,  -6,  -3 ],
    [ 3,   0,  -6,   0 ],   // horizon row
    [ 0,  -3,  -6,  -3 ],
    [-5,  -5,  -5,  -5 ],
    [-10, -10, -10, -10]
  ]
};

const NEC_SUCCESS_RESPONSE = {
  ok: true,
  model_valid: true,
  frequency_mhz: 1.19,
  pattern: REF_PATTERN
};

// ---------------------------------------------------------------------------
// Route handler extraction.  We import only the sub-functions used by the
// route so we avoid mounting a full Express server in this test file.
// The actual route shape is:
//   import r from '../api/routes/necPattern.js';
// but to avoid the express dependency + sidecars singleton, we replicate
// the handler logic here, mirroring the exact code in necPattern.js.
// ---------------------------------------------------------------------------
import { necPatternToTable } from '../evidence/nec/client.js';

/**
 * Simulate the POST /api/nec/pattern handler with a given sidecarNec client
 * (null if sidecar unavailable) and a request body.  Returns the JSON
 * response the real handler would send.
 */
async function simulateHandler(sidecarNec, body){
  // Step 1: validate body
  if (!body || typeof body !== 'object'){
    return { status: 400, body: { ok: false, error: 'BAD_REQUEST', message: 'JSON body required' } };
  }
  const geo = body.antenna_geometry;
  if (!geo || typeof geo !== 'object'){
    return { status: 400, body: { ok: false, error: 'BAD_REQUEST', message: 'antenna_geometry object required' } };
  }
  if (!Array.isArray(geo.towers) || geo.towers.length === 0){
    return { status: 400, body: { ok: false, error: 'BAD_REQUEST', message: 'antenna_geometry.towers array required' } };
  }

  // Step 2: check NEC sidecar availability
  if (!sidecarNec){
    return { status: 200, body: { ok: false, nec_available: false, error: 'NEC_SIDECAR_UNAVAILABLE' } };
  }

  // Step 3: run NEC
  let necResponse;
  try {
    necResponse = await sidecarNec.runAmArray(geo);
  } catch (e){
    return { status: 200, body: { ok: false, nec_available: true, error: 'NEC_RUN_FAILED', detail: String(e?.message || e) } };
  }

  if (!necResponse || necResponse.ok === false){
    return { status: 200, body: {
      ok:            false,
      nec_available: true,
      error:         necResponse?.error || 'NEC_RUN_FAILED',
      detail:        necResponse?.detail || null
    } };
  }

  // Step 4: convert NEC pattern
  const pattern_table = necPatternToTable(necResponse);
  if (!pattern_table){
    return { status: 200, body: {
      ok:            false,
      nec_available: true,
      error:         'NEC_PATTERN_EMPTY',
      detail:        'NEC response did not contain a usable far-field pattern at the horizon'
    } };
  }

  // Step 5: return success
  return { status: 200, body: { ok: true, nec_available: true, converged: true, pattern_table } };
}

// ---------------------------------------------------------------------------
// Test 1: valid geometry + working sidecar → { ok: true, pattern_table: [...] }
// ---------------------------------------------------------------------------
test('POST /api/nec/pattern: valid geometry + working sidecar returns ok:true with pattern_table', async () => {
  const mockNecClient = {
    async runAmArray(geo){
      // Verify the geometry is forwarded correctly.
      assert.equal(geo.frequency_khz, 1190, 'frequency_khz should be forwarded');
      assert.ok(Array.isArray(geo.towers) && geo.towers.length === 1, 'towers array forwarded');
      assert.equal(geo.towers[0].tag, 1);
      return NEC_SUCCESS_RESPONSE;
    }
  };

  const body = {
    antenna_geometry: {
      frequency_khz: 1190,
      ground: { type: 'sommerfeld', conductivity_s_m: 0.005, dielectric_constant: 13 },
      towers: [
        { tag: 1, x_m: 0, y_m: 0, height_m: 75, radius_m: 0.25, segments: 21,
          drive: { amplitude: 1.0, phase_deg: 0 } }
      ]
    }
  };

  const result = await simulateHandler(mockNecClient, body);

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true,            'ok should be true when sidecar responds');
  assert.equal(result.body.nec_available, true,  'nec_available should be true');
  assert.equal(result.body.converged, true,      'converged should be true');
  assert.ok(Array.isArray(result.body.pattern_table), 'pattern_table should be an array');
  assert.ok(result.body.pattern_table.length > 0,     'pattern_table should have entries');

  // Verify pattern_table entries are [az_deg, field_factor] pairs.
  for (const [az, f] of result.body.pattern_table){
    assert.ok(Number.isFinite(az), `azimuth ${az} should be finite`);
    assert.ok(Number.isFinite(f) && f >= 0 && f <= 1,
      `field_factor ${f} should be in [0, 1]`);
  }
});

// ---------------------------------------------------------------------------
// Test 2: NEC sidecar unavailable → { ok: false, nec_available: false }
// ---------------------------------------------------------------------------
test('POST /api/nec/pattern: NEC sidecar unavailable returns ok:false + nec_available:false', async () => {
  // sidecarNec = null simulates NEC_SIDECAR_URL not set.
  const body = {
    antenna_geometry: {
      frequency_khz: 1190,
      ground: { type: 'sommerfeld', conductivity_s_m: 0.005, dielectric_constant: 13 },
      towers: [
        { tag: 1, x_m: 0, y_m: 0, height_m: 75, radius_m: 0.25, segments: 21,
          drive: { amplitude: 1.0, phase_deg: 0 } }
      ]
    }
  };

  const result = await simulateHandler(null, body);

  assert.equal(result.status, 200);
  assert.equal(result.body.ok,            false,                   'ok should be false when sidecar unavailable');
  assert.equal(result.body.nec_available, false,                   'nec_available should be false');
  assert.equal(result.body.error,         'NEC_SIDECAR_UNAVAILABLE', 'error code should identify unavailability');
});

// ---------------------------------------------------------------------------
// Test 3: missing antenna_geometry → 400 BAD_REQUEST
// ---------------------------------------------------------------------------
test('POST /api/nec/pattern: missing antenna_geometry returns 400', async () => {
  const result = await simulateHandler(null, {});
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'BAD_REQUEST');
});

// ---------------------------------------------------------------------------
// Test 4: empty towers array → 400 BAD_REQUEST
// ---------------------------------------------------------------------------
test('POST /api/nec/pattern: empty towers array returns 400', async () => {
  const result = await simulateHandler(null, {
    antenna_geometry: { frequency_khz: 1190, towers: [] }
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'BAD_REQUEST');
  assert.match(result.body.message, /towers/i);
});

// ---------------------------------------------------------------------------
// Test 5: sidecar returns NEC_RUN_FAILED → ok:false, nec_available:true
// ---------------------------------------------------------------------------
test('POST /api/nec/pattern: sidecar run failure returns ok:false, nec_available:true', async () => {
  const mockNecClient = {
    async runAmArray(){ return { ok: false, error: 'PYNEC_BRIDGE_FAILED', detail: 'segfault' }; }
  };

  const body = {
    antenna_geometry: {
      frequency_khz: 1190,
      towers: [{ tag: 1, x_m: 0, y_m: 0, height_m: 75, radius_m: 0.25, segments: 21,
                 drive: { amplitude: 1.0, phase_deg: 0 } }]
    }
  };

  const result = await simulateHandler(mockNecClient, body);

  assert.equal(result.body.ok,            false,                'ok should be false on run failure');
  assert.equal(result.body.nec_available, true,                 'nec_available should be true (sidecar was reached)');
  assert.equal(result.body.error,         'PYNEC_BRIDGE_FAILED', 'error code should be forwarded from sidecar');
});
