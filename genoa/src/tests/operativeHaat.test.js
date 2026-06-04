// Regression tests for the operative HAAT resolver and HAAT validation
// improvements that fixed the WJPZ-FM lineage bug.
//
// Background: WJPZ-FM (89.1 MHz, 1 kW, Syracuse NY) entered haat_m=37,
// which is tower AGL height.  Terrain-derived mean HAAT = 241.8 m.
// The engine was incorrectly passing 37 m to §73.215; HAAT validation
// returned PASS instead of REVIEW because the absolute delta (204.8 m)
// was within the 300 m tolerance despite a 84.7% relative discrepancy.
//
// Test cases:
//   A. WJPZ-style:   operator=37, terrain mean=241.8 → REVIEW, AGL suspected
//   B. No terrain:   operator=37, no evidence       → operator fallback, low confidence
//   C. Close match:  operator=240, terrain mean=241.8 → PASS
//   D. Reg fail + HAAT review (independent checks)  → regulatory FAIL, not "contradiction"

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateHaat,
  HAAT_GATES_READINESS,
  HAAT_DISPLAY_SUPPRESSED
} from '../engine/haat/validate.js';
import { resolveOperativeHaat } from '../engine/haat/resolveOperativeHaat.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePerRadial(n, mean, variance = 20) {
  return Array.from({ length: n }, (_, i) => ({
    az:            i * (360 / n),
    haat_m:        mean + (Math.random() - 0.5) * variance * 2,
    haat_computed_m: mean + (Math.random() - 0.5) * variance * 2,
    haat_source:   'dem'
  }));
}

function exhibitWith({ operatorHaat, perRadialMean, perRadialN = 36, variance = 20 } = {}) {
  const perRadial = perRadialMean != null ? makePerRadial(perRadialN, perRadialMean, variance) : [];
  return {
    station_inputs: {
      call:      'WJPZ',
      service:   'FM',
      haat_m:    operatorHaat,
      frequency: 89.1,
      lat:       43.05,
      lon:       -76.15
    },
    evidence: {
      terrain_haat_per_radial: perRadial,
      tx_amsl_resolved: perRadial.length > 0
        ? { value_m: 302, source: 'derived' }
        : null,
      terrain: perRadial.length > 0
        ? { available: true, n_radials_dem_sourced: perRadialN }
        : { available: false }
    }
  };
}

// ─── Case A: WJPZ-style (operator=37, terrain mean≈241.8) ─────────────────

test('A: WJPZ-style — haat_status REVIEW, agl_suspected=true', () => {
  const exhibit = exhibitWith({ operatorHaat: 37, perRadialMean: 241.8, variance: 30 });
  const r = validateHaat(exhibit);

  assert.equal(r.status, 'REVIEW',
    `expected REVIEW, got ${r.status}`);
  assert.equal(r.agl_suspected, true,
    'agl_suspected should be true when operator < 100 and terrain mean > 150');
  assert.ok(
    r.issues.some(i => i.code === 'LIKELY_AGL_ENTERED_AS_HAAT'),
    'should emit LIKELY_AGL_ENTERED_AS_HAAT issue'
  );
  assert.ok(
    r.issues.some(i => i.code === 'HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH'),
    'should emit HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH issue'
  );
  assert.equal(r.display_suppressed, false,
    'REVIEW status must not suppress per-radial display — terrain is valid');
  assert.equal(r.gates_readiness, false,
    'REVIEW status must not gate readiness to BLOCKED');
  assert.ok(r.stats.relative_delta != null && r.stats.relative_delta > 0.80,
    `relative_delta should be > 0.80, got ${r.stats.relative_delta}`);
});

test('A: resolveOperativeHaat uses terrain mean (241.8), not operator (37)', () => {
  const exhibit = exhibitWith({ operatorHaat: 37, perRadialMean: 241.8, variance: 30 });
  const op = resolveOperativeHaat({
    inputs:   exhibit.station_inputs,
    evidence: exhibit.evidence
  });

  assert.ok(Math.abs(op.haat_m - 241.8) < 20,
    `operative haat_m should be near 241.8 (terrain mean), got ${op.haat_m}`);
  assert.equal(op.basis, 'terrain_derived');
  assert.equal(op.confidence, 'high');
  assert.equal(op.operator_entered_m, 37);
  assert.equal(op.warnings.length, 0,
    'no warnings when terrain is available');
});

test('A: checkSection73215 would receive operative HAAT (241.8), not operator (37)', () => {
  // This is a unit test of the resolver, not the full engine.
  // The full engine integration is exercised by the engine.test.js suite.
  const exhibit = exhibitWith({ operatorHaat: 37, perRadialMean: 241.8, variance: 30 });
  const op = resolveOperativeHaat({
    inputs:   exhibit.station_inputs,
    evidence: exhibit.evidence
  });
  // Verify the value that WOULD be passed to checkSection73215:
  assert.ok(op.haat_m > 100,
    `operative HAAT passed to §73.215 should be > 100 m (terrain-derived), got ${op.haat_m}`);
  assert.notEqual(op.haat_m, 37,
    'operative HAAT must not be the raw operator AGL value');
});

// ─── Case B: No terrain evidence ──────────────────────────────────────────

test('B: no terrain — resolveOperativeHaat falls back to operator, warns', () => {
  const op = resolveOperativeHaat({
    inputs:   { haat_m: 37 },
    evidence: {}
  });
  assert.equal(op.haat_m, 37);
  assert.equal(op.basis, 'operator_input');
  assert.equal(op.confidence, 'low');
  assert.equal(op.warnings.length, 1);
  assert.equal(op.warnings[0].code, 'OPERATIVE_HAAT_OPERATOR_ONLY');
});

test('B: no terrain — validateHaat returns NOT_RUN', () => {
  const exhibit = exhibitWith({ operatorHaat: 37 });   // no perRadialMean
  const r = validateHaat(exhibit);
  assert.equal(r.status, 'NOT_RUN');
  assert.equal(r.agl_suspected, undefined);  // not set when NOT_RUN
});

// ─── Case C: Close match (operator=240, terrain≈241.8) ─────────────────────

test('C: close match — haat_status PASS, operative is terrain mean', () => {
  const exhibit = exhibitWith({ operatorHaat: 240, perRadialMean: 241.8, variance: 15 });
  const r = validateHaat(exhibit);
  assert.equal(r.status, 'PASS',
    `expected PASS for close operator/terrain match, got ${r.status}`);
  assert.equal(r.agl_suspected, false);
  assert.ok(!r.issues.some(i => i.code === 'LIKELY_AGL_ENTERED_AS_HAAT'));
  assert.ok(!r.issues.some(i => i.code === 'HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH'));
});

test('C: close match — resolveOperativeHaat returns terrain mean (241.8)', () => {
  const exhibit = exhibitWith({ operatorHaat: 240, perRadialMean: 241.8, variance: 15 });
  const op = resolveOperativeHaat({
    inputs:   exhibit.station_inputs,
    evidence: exhibit.evidence
  });
  assert.ok(Math.abs(op.haat_m - 241.8) < 15,
    `operative should be near 241.8, got ${op.haat_m}`);
  assert.equal(op.basis, 'terrain_derived');
  assert.equal(op.confidence, 'high');
});

// ─── Case D: Regulatory fail with HAAT REVIEW (independent checks) ─────────

test('D: REVIEW HAAT + interference FAIL are not a contradiction', () => {
  // Simulate: terrain HAAT valid (basis=terrain_derived, status=REVIEW),
  // regulatory compliance failed due to §73.215 interference geometry.
  // These must never be flagged as an internal contradiction.
  const haatValidation = {
    status:        'REVIEW',
    basis:         'terrain_derived',
    agl_suspected: true,
    issues: [
      { code: 'LIKELY_AGL_ENTERED_AS_HAAT', severity: 'WARNING', detail: 'operator < 100 m, terrain mean > 150 m' },
      { code: 'HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH', severity: 'WARNING', detail: '84.7%' }
    ],
    stats: { operator_m: 37, mean_m: 241.8, min_m: 94.4, max_m: 325.2, relative_delta: 0.847 }
  };

  // REVIEW should NOT gate readiness (only INVALID/FALLBACK_ONLY/NOT_RUN do).
  assert.ok(!HAAT_GATES_READINESS.has('REVIEW'),
    'REVIEW must not be in HAAT_GATES_READINESS — it does not block filing');

  // REVIEW should NOT suppress per-radial display.
  assert.ok(!HAAT_DISPLAY_SUPPRESSED.has('REVIEW'),
    'REVIEW must not be in HAAT_DISPLAY_SUPPRESSED — terrain column is valid');

  // The operative HAAT for a REVIEW exhibit is still terrain-derived.
  const op = resolveOperativeHaat({
    inputs:         { haat_m: 37 },
    evidence:       { terrain_haat_per_radial: makePerRadial(36, 241.8, 25) },
    haatValidation
  });
  assert.equal(op.basis, 'terrain_derived',
    'haatValidation REVIEW with terrain_derived basis should still use terrain mean');
  assert.ok(op.haat_m > 100,
    `operative HAAT should be terrain mean (~241.8), got ${op.haat_m}`);
});

// ─── Edge cases for resolveOperativeHaat ────────────────────────────────────

test('resolveOperativeHaat: haatValidation INVALID → skips to per-radial mean', () => {
  const evidence = {
    terrain_haat_per_radial: makePerRadial(36, 250, 20)
  };
  const haatValidation = {
    status: 'INVALID',
    basis:  'terrain_derived',
    stats:  { mean_m: 250 }
  };
  const op = resolveOperativeHaat({ inputs: { haat_m: 37 }, evidence, haatValidation });
  // INVALID result is skipped (option 1), falls to option 2 (per-radial mean from evidence).
  assert.equal(op.basis, 'terrain_derived');
  assert.equal(op.source, 'evidence.terrain_haat_per_radial.mean');
});

test('resolveOperativeHaat: haatValidation REVIEW → uses terrain mean', () => {
  const evidence = {};
  const haatValidation = {
    status: 'REVIEW',
    basis:  'terrain_derived',
    stats:  { mean_m: 241.8 }
  };
  const op = resolveOperativeHaat({ inputs: { haat_m: 37 }, evidence, haatValidation });
  assert.equal(op.haat_m, 241.8);
  assert.equal(op.basis, 'terrain_derived');
  assert.equal(op.source, 'haat_validation.stats.mean_m');
});

test('resolveOperativeHaat: FCC authorized HAAT used when no terrain', () => {
  const op = resolveOperativeHaat({
    inputs:   { haat_m: 37 },
    evidence: { fcc_licensed: { haat_m: 180 } }
  });
  assert.equal(op.haat_m, 180);
  assert.equal(op.basis, 'fcc_authorized');
  assert.equal(op.confidence, 'medium');
});

test('resolveOperativeHaat: garbage per-radial mean falls through to operator', () => {
  // If per-radial means are below the -200 m floor (KZLZ class), do NOT use them.
  const evidence = {
    terrain_haat_per_radial: makePerRadial(36, -400, 50)
  };
  const op = resolveOperativeHaat({ inputs: { haat_m: 37 }, evidence });
  assert.equal(op.basis, 'operator_input',
    'garbage terrain mean (< -200) should fall through to operator fallback');
});
