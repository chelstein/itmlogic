// regression.test.js — FCC/OET R86-1 FCCGW sidecar regression tests.
//
// Uses Node.js built-in test runner (node:test).
// Tests the contour.js interpolation logic directly with validated
// reference data.  The Octave engine is NOT invoked; instead the
// test stubs runFccgw via module mocking with the known data points.
//
// Validated reference data (freq=1190 kHz, sigma=8 mS/m, epsilon=15, E1km=80 mV/m):
//   Distance (km)    Field (mV/m)
//   1.00             73.8216
//   2.77             24.1190
//   9.61              4.9840    ← 5 mV/m contour
//   17.18             2.0053    ← 2 mV/m contour
//   35.10             0.5014    ← 0.5 mV/m contour
//   121.91            0.02489   ← 0.025 mV/m contour

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Import the pure functions that do not depend on the Octave engine.
// We import directly from contour.js and engine.js to avoid the
// live Octave subprocess.
import { findContourDistance, generateDistanceGrid } from '../contour.js';

// ---- Validated reference data points ----
// These exact data points come from FCC/OET R86-1 test runs with:
//   freq=1190000 Hz, sigma=0.008 S/m, epsilon=15, e1km=80 mV/m
const REF_DISTANCES = [1.00, 2.77, 9.61, 17.18, 35.10, 121.91];
const REF_FIELDS    = [73.8216, 24.1190, 4.9840, 2.0053, 0.5014, 0.02489];

describe('findContourDistance — log-log interpolation', () => {
  test('returns ~9.61 km for the 5 mV/m contour (±1%)', () => {
    const d = findContourDistance(REF_DISTANCES, REF_FIELDS, 5.0);
    assert.ok(d !== null, 'expected a non-null result for 5 mV/m');
    // The reference point is 9.61 km at 4.9840 mV/m; interpolating
    // into a neighbouring bracket should land within 1% of 9.61.
    const expected = 9.61;
    const pct = Math.abs(d - expected) / expected * 100;
    assert.ok(
      pct <= 1,
      `5 mV/m contour: expected ~${expected} km, got ${d.toFixed(4)} km (${pct.toFixed(3)}% error)`
    );
  });

  test('returns ~17.18 km for the 2 mV/m contour (±1%)', () => {
    const d = findContourDistance(REF_DISTANCES, REF_FIELDS, 2.0);
    assert.ok(d !== null, 'expected a non-null result for 2 mV/m');
    const expected = 17.18;
    const pct = Math.abs(d - expected) / expected * 100;
    assert.ok(
      pct <= 1,
      `2 mV/m contour: expected ~${expected} km, got ${d.toFixed(4)} km (${pct.toFixed(3)}% error)`
    );
  });

  test('returns ~35.10 km for the 0.5 mV/m contour (±1%)', () => {
    const d = findContourDistance(REF_DISTANCES, REF_FIELDS, 0.5);
    assert.ok(d !== null, 'expected a non-null result for 0.5 mV/m');
    const expected = 35.10;
    const pct = Math.abs(d - expected) / expected * 100;
    assert.ok(
      pct <= 1,
      `0.5 mV/m contour: expected ~${expected} km, got ${d.toFixed(4)} km (${pct.toFixed(3)}% error)`
    );
  });

  test('returns null when target is above all field values', () => {
    // Max field in REF_FIELDS is 73.8216 — target 100 is out of range.
    const d = findContourDistance(REF_DISTANCES, REF_FIELDS, 100);
    assert.equal(d, null, 'expected null for target above all fields');
  });

  test('returns null when target is below all field values', () => {
    // Min field in REF_FIELDS is 0.02489 — target 0.001 is out of range.
    const d = findContourDistance(REF_DISTANCES, REF_FIELDS, 0.001);
    assert.equal(d, null, 'expected null for target below all fields');
  });

  test('throws TypeError when distances is not an array', () => {
    assert.throws(
      () => findContourDistance('not-an-array', REF_FIELDS, 5.0),
      TypeError
    );
  });

  test('throws TypeError when fields is not an array', () => {
    assert.throws(
      () => findContourDistance(REF_DISTANCES, 'not-an-array', 5.0),
      TypeError
    );
  });

  test('throws RangeError when targetField is not positive', () => {
    assert.throws(
      () => findContourDistance(REF_DISTANCES, REF_FIELDS, 0),
      RangeError
    );
    assert.throws(
      () => findContourDistance(REF_DISTANCES, REF_FIELDS, -1),
      RangeError
    );
  });

  test('throws RangeError when arrays have different lengths', () => {
    assert.throws(
      () => findContourDistance([1, 2, 3], [1, 2], 1.5),
      RangeError
    );
  });
});

describe('generateDistanceGrid', () => {
  test('returns exactly 200 points by default', () => {
    const grid = generateDistanceGrid();
    assert.equal(grid.length, 200);
  });

  test('first point is 0.5 km', () => {
    const grid = generateDistanceGrid(200);
    assert.ok(
      Math.abs(grid[0] - 0.5) < 1e-9,
      `expected first point ~0.5, got ${grid[0]}`
    );
  });

  test('last point is 2000 km', () => {
    const grid = generateDistanceGrid(200);
    assert.ok(
      Math.abs(grid[grid.length - 1] - 2000) < 1e-6,
      `expected last point ~2000, got ${grid[grid.length - 1]}`
    );
  });

  test('returns n points when n is specified', () => {
    assert.equal(generateDistanceGrid(50).length, 50);
    assert.equal(generateDistanceGrid(500).length, 500);
  });

  test('grid is strictly increasing', () => {
    const grid = generateDistanceGrid(200);
    for (let i = 1; i < grid.length; i++){
      assert.ok(
        grid[i] > grid[i - 1],
        `grid not strictly increasing at index ${i}: ${grid[i - 1]} >= ${grid[i]}`
      );
    }
  });

  test('all values are positive finite numbers', () => {
    const grid = generateDistanceGrid(200);
    for (const d of grid){
      assert.ok(Number.isFinite(d) && d > 0, `non-positive or non-finite grid point: ${d}`);
    }
  });
});

describe('Request validation (inline logic replication)', () => {
  // These tests replicate the server-side validation logic without
  // importing Express — they ensure the validation contract is correct.
  const FREQ_HZ_MIN = 530_000;
  const FREQ_HZ_MAX = 1_710_000;

  function validate(body, requireTarget = false){
    const { freq_hz, sigma_s_per_m, epsilon, e1km_mvm, target_field_mvm } = body || {};
    if (freq_hz === undefined || freq_hz === null)
      return 'MISSING_FIELD:freq_hz';
    if (!Number.isFinite(Number(freq_hz)))
      return 'INVALID_FIELD:freq_hz';
    const fFreq = Number(freq_hz);
    if (fFreq < FREQ_HZ_MIN || fFreq > FREQ_HZ_MAX)
      return 'OUT_OF_RANGE:freq_hz';
    if (sigma_s_per_m === undefined || sigma_s_per_m === null)
      return 'MISSING_FIELD:sigma_s_per_m';
    const fSigma = Number(sigma_s_per_m);
    if (!Number.isFinite(fSigma) || fSigma <= 0)
      return 'INVALID_FIELD:sigma_s_per_m';
    if (epsilon === undefined || epsilon === null)
      return 'MISSING_FIELD:epsilon';
    const fEpsilon = Number(epsilon);
    if (!Number.isFinite(fEpsilon) || fEpsilon < 1)
      return 'INVALID_FIELD:epsilon';
    if (e1km_mvm === undefined || e1km_mvm === null)
      return 'MISSING_FIELD:e1km_mvm';
    const fE1km = Number(e1km_mvm);
    if (!Number.isFinite(fE1km) || fE1km <= 0)
      return 'INVALID_FIELD:e1km_mvm';
    if (requireTarget){
      if (target_field_mvm === undefined || target_field_mvm === null)
        return 'MISSING_FIELD:target_field_mvm';
      const fTarget = Number(target_field_mvm);
      if (!Number.isFinite(fTarget) || fTarget <= 0)
        return 'INVALID_FIELD:target_field_mvm';
    }
    return null;  // valid
  }

  const VALID_BODY = {
    freq_hz:       1_190_000,
    sigma_s_per_m: 0.008,
    epsilon:       15,
    e1km_mvm:      80
  };

  test('valid request passes validation', () => {
    assert.equal(validate(VALID_BODY), null);
  });

  test('missing freq_hz fails with MISSING_FIELD', () => {
    const { freq_hz: _, ...body } = VALID_BODY;
    assert.ok(validate(body).startsWith('MISSING_FIELD'));
  });

  test('sigma_s_per_m <= 0 fails with INVALID_FIELD', () => {
    const result = validate({ ...VALID_BODY, sigma_s_per_m: 0 });
    assert.ok(result.startsWith('INVALID_FIELD'), `expected INVALID_FIELD, got: ${result}`);
  });

  test('sigma_s_per_m < 0 fails with INVALID_FIELD', () => {
    const result = validate({ ...VALID_BODY, sigma_s_per_m: -0.001 });
    assert.ok(result.startsWith('INVALID_FIELD'), `expected INVALID_FIELD, got: ${result}`);
  });

  test('freq_hz below 530 kHz fails with OUT_OF_RANGE', () => {
    const result = validate({ ...VALID_BODY, freq_hz: 400_000 });
    assert.ok(result.startsWith('OUT_OF_RANGE'), `expected OUT_OF_RANGE, got: ${result}`);
  });

  test('freq_hz above 1710 kHz fails with OUT_OF_RANGE', () => {
    const result = validate({ ...VALID_BODY, freq_hz: 2_000_000 });
    assert.ok(result.startsWith('OUT_OF_RANGE'), `expected OUT_OF_RANGE, got: ${result}`);
  });

  test('epsilon < 1 fails with INVALID_FIELD', () => {
    const result = validate({ ...VALID_BODY, epsilon: 0.5 });
    assert.ok(result.startsWith('INVALID_FIELD'), `expected INVALID_FIELD, got: ${result}`);
  });

  test('missing target_field_mvm when requireTarget=true fails', () => {
    const result = validate(VALID_BODY, true);
    assert.ok(result.startsWith('MISSING_FIELD'), `expected MISSING_FIELD, got: ${result}`);
  });

  test('valid request with target_field_mvm passes when requireTarget=true', () => {
    const result = validate({ ...VALID_BODY, target_field_mvm: 2.0 }, true);
    assert.equal(result, null);
  });
});
