// Phase-1 HAAT validation contract tests.
//
// Covers the seven edge cases the hardening sprint called out:
//
//   1. normal mountain FM site                  — PASS, all positive
//   2. lowland FM site                          — PASS, smaller positive
//   3. missing DEM                              — NOT_RUN, basis=flat
//   4. inverted-subtraction bug (KZLZ class)    — INVALID, HAAT_MEAN_INCONSISTENT
//   5. NAD83/WGS84 coordinate mismatch (subtle) — SUSPECT with outliers
//   6. negative HAAT but valid terrain          — PASS, basis=terrain_derived
//   7. impossible negative HAAT                 — INVALID, HAAT_IMPOSSIBLE
//
// Also asserts the validator never throws on malformed input —
// downstream code in exhibitService.js reads .status without
// guarding so an exception would break the whole pipeline.

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHaat } from '../engine/haat/validate.js';

function fmExhibit({ haat_m = 581, perRadial = [], txAmsl = null, service = 'FM' } = {}){
  return {
    station_inputs: { call: 'KZLZ', service, frequency: 105.3, haat_m, lat: 32.25, lon: -111.12 },
    evidence: {
      terrain_haat_per_radial: perRadial.map((h, i) => ({ az: i * 10, haat_m: h })),
      tx_amsl_resolved: txAmsl
    }
  };
}

// Case 1 — Mountain FM site (Mt. Lemmon-class).  Operator HAAT 700 m,
// terrain rises and falls within ±200 m of antenna AMSL.  Per-radial
// HAATs land in [500, 900] — all positive, mean close to 700.
test('mountain FM: PASS when per-radial HAAT clusters around operator HAAT', () => {
  const radials = [800, 750, 700, 650, 720, 690, 710, 730, 740, 705, 680, 695,
                   715, 720, 700, 685, 695, 710, 705, 700, 720, 730, 740, 750,
                   760, 770, 780, 790, 800, 790, 760, 740, 720, 710, 700, 690];
  const r = validateHaat(fmExhibit({ haat_m: 720, perRadial: radials,
    txAmsl: { value_m: 2400, source: 'derived' }}));
  assert.equal(r.status, 'PASS');
  assert.equal(r.basis, 'terrain_derived');
  assert.equal(r.stats.n_implausible, 0);
  assert.equal(r.stats.n_negative, 0);
  assert.ok(Math.abs(r.stats.delta_mean_vs_operator_m) < 50, `Δ should be small, got ${r.stats.delta_mean_vs_operator_m}`);
});

// Case 2 — Lowland FM (coastal plains, FL/TX panhandle).  Operator
// HAAT 100 m, terrain is flat within ±20 m.  Per-radial HAATs cluster
// tight around 100.
test('lowland FM: PASS when per-radial HAAT clusters tight + low', () => {
  const radials = Array.from({ length: 36 }, () => 100 + (Math.random() - 0.5) * 15);
  const r = validateHaat(fmExhibit({ haat_m: 100, perRadial: radials,
    txAmsl: { value_m: 150, source: 'derived' }}));
  assert.equal(r.status, 'PASS');
  assert.equal(r.stats.n_negative, 0);
});

// Case 3 — Missing DEM.  No per-radial bundle attached.  Validator
// returns NOT_RUN, NOT a fake PASS.
test('missing DEM: NOT_RUN, never fakes a HAAT validation result', () => {
  const r = validateHaat({ station_inputs: { call: 'WTEST', service: 'FM', haat_m: 200 },
                           evidence: {} });
  assert.equal(r.status, 'NOT_RUN');
  assert.equal(r.basis, 'flat');
  assert.equal(r.issues.length, 0);
  assert.equal(r.stats.n_radials, 0);
});

// Case 4 — Inverted subtraction (the KZLZ bug class).  Operator HAAT
// 581, per-radial HAATs all between -141 and -275.  Validator must
// catch this and emit a blocker.
test('inverted-subtraction bug (KZLZ class): INVALID with HAAT_MEAN_INCONSISTENT blocker', () => {
  const radials = [-143, -141, -139, -141, -144, -156, -164, -174, -216, -227,
                   -258, -275, -263, -242, -238, -209, -188, -176, -167, -159,
                   -155, -155, -159, -167, -186, -197, -250, -245, -255, -231,
                   -209, -207, -179, -159, -148, -146];
  const r = validateHaat(fmExhibit({ haat_m: 581, perRadial: radials,
    txAmsl: { value_m: 581, source: 'legacy_fallback' }}));
  assert.equal(r.status, 'INVALID');
  const codes = r.issues.map(i => i.code);
  assert.ok(codes.includes('HAAT_MEAN_INCONSISTENT'),
    `must flag mean-vs-operator inconsistency; got ${codes.join(',')}`);
  assert.ok(r.stats.delta_mean_vs_operator_m < -700,
    `Δ should be deeply negative, got ${r.stats.delta_mean_vs_operator_m}`);
});

// Case 5 — Subtle NAD83/WGS84 coordinate mismatch.  Coordinate
// systems differ by ≤30 m within CONUS, so a mismatch will subtly
// shift terrain samples and produce a few outliers but most radials
// stay reasonable.  SUSPECT, not INVALID.
test('coord-mismatch artifact: SUSPECT with HAAT_SUSPECT_OUTLIERS warning', () => {
  // 33 normal radials around 350m + 3 outliers from sampling
  // off-axis a few km away (simulating geodetic mismatch).
  const radials = [
    ...Array.from({ length: 33 }, () => 350 + (Math.random() - 0.5) * 40),
    -80, -95, -120                                  // soft-floor outliers
  ];
  const r = validateHaat(fmExhibit({ haat_m: 360, perRadial: radials,
    txAmsl: { value_m: 1100, source: 'derived' }}));
  assert.equal(r.status, 'SUSPECT');
  assert.ok(r.issues.find(i => i.code === 'HAAT_SUSPECT_OUTLIERS'));
});

// Case 6 — Negative HAAT but valid terrain.  A real station inside
// a valley with surrounding ridges — HAAT genuinely is negative.
// Must NOT be flagged as a bug just because of sign.
//
// Sub-case 6a: shallow valley (HAAT around -30 m, all radials
// above soft floor of -50).  Should PASS — sign alone is not a bug.
test('negative HAAT in shallow valley: PASS when all radials above soft floor', () => {
  const radials = Array.from({ length: 36 }, () => -30 + (Math.random() - 0.5) * 30); // [-45, -15]
  const r = validateHaat(fmExhibit({ haat_m: -30, perRadial: radials,
    txAmsl: { value_m: 450, source: 'derived' }}));
  assert.equal(r.status, 'PASS', 'all radials inside [-50, 4000] m → PASS, sign alone is not a bug');
  assert.ok(!r.issues.find(i => i.code === 'HAAT_IMPOSSIBLE'));
  assert.ok(!r.issues.find(i => i.code === 'HAAT_MEAN_INCONSISTENT'));
});

// Sub-case 6b: deeper valley (some radials between hard and soft floor).
// Physically possible but worth flagging — SUSPECT, not INVALID.
test('negative HAAT in deeper valley: SUSPECT when some radials cross soft floor', () => {
  // Mix: half cluster around -30 (above soft floor), half around -120
  // (below soft floor but above hard floor of -200).
  const radials = [
    ...Array.from({ length: 18 }, () => -30 + (Math.random() - 0.5) * 20),
    ...Array.from({ length: 18 }, () => -120 + (Math.random() - 0.5) * 30)
  ];
  const r = validateHaat(fmExhibit({ haat_m: -75, perRadial: radials,
    txAmsl: { value_m: 450, source: 'derived' }}));
  assert.equal(r.status, 'SUSPECT');
  assert.ok(r.issues.find(i => i.code === 'HAAT_SUSPECT_OUTLIERS'));
  assert.ok(!r.issues.find(i => i.code === 'HAAT_IMPOSSIBLE'));
});

// Case 7 — Impossible negative HAAT.  Per-radial values below
// -200 m (the hard floor).  This would imply a transmitter
// underground or in a 200+ m crater.  Must be blocked.
test('impossible negative HAAT: INVALID with HAAT_IMPOSSIBLE blocker', () => {
  const radials = [-450, -500, -480, -460, -470, -490, -510, -495, -485, -475,
                   -465, -455, -445, -435, -425, -415, -405, -395, -385, -375,
                   -365, -355, -345, -335, -325, -315, -305, -295, -285, -275,
                   -265, -255, -245, -235, -225, -215];
  const r = validateHaat(fmExhibit({ haat_m: 500, perRadial: radials,
    txAmsl: { value_m: 500, source: 'legacy_fallback' }}));
  assert.equal(r.status, 'INVALID');
  assert.ok(r.issues.find(i => i.code === 'HAAT_IMPOSSIBLE'));
});

// Robustness — malformed inputs must not throw.
test('robustness: malformed exhibit does not throw', () => {
  assert.doesNotThrow(() => validateHaat({}));
  assert.doesNotThrow(() => validateHaat({ station_inputs: null, evidence: null }));
  assert.doesNotThrow(() => validateHaat({ station_inputs: {}, evidence: { terrain_haat_per_radial: [{ haat_m: NaN }, { haat_m: 'oops' }] } }));
});

// AM exhibits skip per-radial DEM-HAAT by design; status should
// reflect "not applicable" without flagging anything.
test('AM exhibit: NOT_RUN with not_applicable_am basis', () => {
  const r = validateHaat({ station_inputs: { service: 'AM', call: 'KAZM' }, evidence: {} });
  assert.equal(r.status, 'NOT_RUN');
  assert.equal(r.basis, 'not_applicable_am');
});

// Basis labelling — operator_supplied vs terrain_derived must
// propagate from tx_amsl_resolved.source.
test('basis label reflects tx_amsl_resolved.source', () => {
  const radials = Array.from({ length: 36 }, () => 500);
  for (const [src, expected] of [
    ['operator_supplied', 'operator_supplied'],
    ['derived',           'terrain_derived'],
    ['legacy_fallback',   'flat']
  ]){
    const r = validateHaat(fmExhibit({ haat_m: 500, perRadial: radials,
      txAmsl: { value_m: 500, source: src }}));
    assert.equal(r.basis, expected, `source=${src} should map to basis=${expected}`);
  }
});
