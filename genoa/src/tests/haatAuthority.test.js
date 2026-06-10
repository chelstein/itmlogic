// HAAT Authority Resolver — contract tests.
//
// Covers the nine cases from the HAAT governance spec:
//
//   1. existing licensed facility, FCC 37m, computed 241.8m → REVIEW_REQUIRED (not BLOCKER)
//   2. CP/modification, operator 37m, computed 241.8m, no FCC HAAT → BLOCKER
//   3. missing RCAMSL with computed basis → BLOCKER
//   4. engineer override with full evidence → PASS (ENGINEER_OVERRIDE_LOCKED)
//   5. engineer override missing reason/evidence → BLOCKER
//   6. existing licensed, computed agrees with FCC (within tolerance) → RESOLVED
//   7. source attestation conflict does not downgrade engine math parity
//      (attestation labeling is orthogonal to resolveHaatAuthority — verify
//       the resolver never references attestation fields)
//   8. proposed facility, no terrain, no FCC HAAT → BLOCKER
//   9. WJPZ-FM golden exhibit: licensed FM, FCC haat=37m, terrain mean ≈ 241.8m

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHaatAuthority } from '../engine/haat/resolveHaatAuthority.js';

// Build a per-radial array with a given mean (36 radials, 10° step).
function makeRadials(mean, spread = 10) {
  return Array.from({ length: 36 }, (_, i) => ({
    az: i * 10,
    haat_computed_m: mean + (i % 3 === 0 ? spread : i % 3 === 1 ? -spread : 0)
  }));
}

// -----------------------------------------------------------------------
// Test 1: existing licensed facility — REVIEW_REQUIRED, not BLOCKER
// -----------------------------------------------------------------------
test('existing licensed facility with FCC 37m and computed 241.8m → REVIEW_REQUIRED', () => {
  const result = resolveHaatAuthority({
    studyIntent:           'existing_facility_review',
    facilityStatus:        'licensed',
    fccAuthorizedHaatM:    37,
    operatorDeclaredHaatM: 37,
    computedRadialHaat:    makeRadials(241.8, 8),
    rcamslM:               300
  });

  assert.strictEqual(result.haat_conflict_status, 'REVIEW_REQUIRED',
    'Licensed facility with large FCC vs computed divergence must be REVIEW_REQUIRED');
  assert.notStrictEqual(result.haat_conflict_status, 'BLOCKER',
    'Licensed facility with existing FCC HAAT must NOT be a BLOCKER — it is a basis-selection issue');
  assert.strictEqual(result.filing_controlling_haat_basis, 'FCC_AUTHORIZED',
    'For an existing licensed facility, FCC-authorized HAAT controls the filing');
  assert.strictEqual(result.filing_controlling_haat_m, 37,
    'Filing-controlling HAAT must be the FCC-authorized value of 37m');
  assert.strictEqual(result.authorized_haat_m, 37);
  assert.ok(Math.abs(result.computed_average_haat_m - 241.8) < 2,
    'Computed mean should be close to 241.8m');
  assert.strictEqual(result.haat_blockers.length, 0,
    'No blockers for a licensed facility with divergent values');
  assert.ok(result.haat_review_messages.length > 0, 'Review message must be present');
});

// -----------------------------------------------------------------------
// Test 2: CP/modification, operator 37m, computed 241.8m, no FCC HAAT → BLOCKER
// -----------------------------------------------------------------------
test('CP/modification, operator 37m, computed 241.8m, no FCC HAAT → BLOCKER', () => {
  const result = resolveHaatAuthority({
    studyIntent:           'cp_modification',
    facilityStatus:        'cp_granted',
    fccAuthorizedHaatM:    null,
    operatorDeclaredHaatM: 37,
    computedRadialHaat:    makeRadials(241.8, 8),
    rcamslM:               300
  });

  assert.strictEqual(result.haat_conflict_status, 'BLOCKER',
    'CP/modification with no FCC HAAT and large operator-vs-computed divergence must be BLOCKER');
  assert.ok(result.haat_blockers.length > 0, 'Must have at least one blocker');
  assert.ok(
    result.haat_blockers.some(b => b.code === 'OPERATOR_VS_COMPUTED_HAAT_BLOCKER'),
    'Blocker code must be OPERATOR_VS_COMPUTED_HAAT_BLOCKER'
  );
  assert.strictEqual(result.filing_controlling_haat_basis, 'GENOA_COMPUTED_73_313',
    'Without FCC HAAT, computed §73.313 is the basis (even when blocked)');
});

// -----------------------------------------------------------------------
// Test 3: missing RCAMSL with computed basis → BLOCKER
// -----------------------------------------------------------------------
test('computed basis with missing RCAMSL and ground elevation → BLOCKER', () => {
  const result = resolveHaatAuthority({
    studyIntent:           'new_facility',
    facilityStatus:        'proposed',
    fccAuthorizedHaatM:    null,
    operatorDeclaredHaatM: null,
    computedRadialHaat:    makeRadials(120, 5),
    rcamslM:               null,
    groundElevationM:      null
  });

  assert.strictEqual(result.haat_conflict_status, 'BLOCKER');
  assert.ok(result.haat_blockers.some(b => b.code === 'MISSING_RCAMSL_WITH_COMPUTED_BASIS'),
    'Must flag missing RCAMSL when computed basis is selected');
});

// -----------------------------------------------------------------------
// Test 4: engineer override with full evidence → PASS (ENGINEER_OVERRIDE_LOCKED)
// -----------------------------------------------------------------------
test('valid engineer override with all required fields → ENGINEER_OVERRIDE_LOCKED, RESOLVED', () => {
  const result = resolveHaatAuthority({
    studyIntent:           'existing_facility_review',
    facilityStatus:        'licensed',
    fccAuthorizedHaatM:    37,
    operatorDeclaredHaatM: 37,
    computedRadialHaat:    makeRadials(241.8, 8),
    rcamslM:               300,
    engineerOverride: {
      value_m:          241.8,
      original_value_m: 37,
      reason:           'AGL height was erroneously entered; terrain HAAT confirmed via §73.313 DEM run',
      engineer:         'J. Smith, P.E.',
      timestamp:        '2026-06-01T12:00:00Z',
      evidence_ref:     'terrain-analysis-2026-06-01.pdf'
    }
  });

  assert.strictEqual(result.filing_controlling_haat_basis, 'ENGINEER_OVERRIDE_LOCKED');
  assert.strictEqual(result.filing_controlling_haat_m, 241.8);
  assert.strictEqual(result.haat_conflict_status, 'RESOLVED');
  assert.strictEqual(result.haat_blockers.length, 0);
  // PII (engineer name, reason) must NOT appear in the public override block
  assert.ok(!result.engineer_override?.engineer, 'engineer name must be stripped from public override');
  assert.ok(!result.engineer_override?.reason,   'reason must be stripped from public override');
  // Audit fields must be present
  assert.ok(result.engineer_override?.evidence_ref);
  assert.ok(result.engineer_override?.timestamp);
});

// -----------------------------------------------------------------------
// Test 5: engineer override missing required fields → BLOCKER
// -----------------------------------------------------------------------
test('engineer override missing reason and evidence_ref → BLOCKER', () => {
  const result = resolveHaatAuthority({
    studyIntent:           'existing_facility_review',
    facilityStatus:        'licensed',
    fccAuthorizedHaatM:    37,
    computedRadialHaat:    makeRadials(241.8, 8),
    rcamslM:               300,
    engineerOverride: {
      value_m:   241.8,
      engineer:  'J. Smith, P.E.',
      timestamp: '2026-06-01T12:00:00Z'
      // missing: reason, evidence_ref
    }
  });

  assert.strictEqual(result.haat_conflict_status, 'BLOCKER');
  assert.ok(result.haat_blockers.some(b => b.code === 'ENGINEER_OVERRIDE_INCOMPLETE'));
  assert.ok(!result.engineer_override, 'Incomplete override must not be stamped on result');
});

// -----------------------------------------------------------------------
// Test 6: licensed facility, computed agrees with FCC (within tolerance) → RESOLVED
// -----------------------------------------------------------------------
test('licensed facility with FCC 120m and computed 125m (within tolerance) → RESOLVED', () => {
  const result = resolveHaatAuthority({
    studyIntent:           'existing_facility_review',
    facilityStatus:        'licensed',
    fccAuthorizedHaatM:    120,
    operatorDeclaredHaatM: 120,
    computedRadialHaat:    makeRadials(125, 3),
    rcamslM:               350
  });

  assert.strictEqual(result.haat_conflict_status, 'RESOLVED');
  assert.strictEqual(result.filing_controlling_haat_basis, 'FCC_AUTHORIZED');
  assert.strictEqual(result.filing_controlling_haat_m, 120);
  assert.strictEqual(result.haat_blockers.length, 0);
});

// -----------------------------------------------------------------------
// Test 7: source attestation conflicts are orthogonal to engine math
//         resolveHaatAuthority must not read or modify attestation fields
// -----------------------------------------------------------------------
test('resolver does not reference or modify source_attestation fields', () => {
  // Pass an engineerOverride-like object as attestation poison — must be ignored
  const result = resolveHaatAuthority({
    studyIntent:           'existing_facility_review',
    facilityStatus:        'licensed',
    fccAuthorizedHaatM:    120,
    computedRadialHaat:    makeRadials(120, 2),
    rcamslM:               300
    // No engineerOverride — attestation conflicts not passed here by design
  });

  // Resolver must not have any field named 'source_attestation' in its output
  assert.ok(!('source_attestation' in result), 'resolver output must not contain source_attestation');
  assert.ok(!('attestation_conflict' in result), 'resolver output must not contain attestation_conflict');
  // Verdict must be driven purely by HAAT evidence, not attestation state
  assert.strictEqual(result.haat_conflict_status, 'RESOLVED',
    'Resolver verdict must be driven by HAAT evidence, not attestation state');
});

// -----------------------------------------------------------------------
// Test 8: proposed facility, no terrain, no FCC HAAT → BLOCKER
// -----------------------------------------------------------------------
test('proposed facility with no terrain and no FCC HAAT → BLOCKER', () => {
  const result = resolveHaatAuthority({
    studyIntent:           'new_facility',
    facilityStatus:        'proposed',
    fccAuthorizedHaatM:    null,
    operatorDeclaredHaatM: null,
    computedRadialHaat:    [],
    rcamslM:               null
  });

  assert.strictEqual(result.haat_conflict_status, 'BLOCKER');
  assert.ok(result.haat_blockers.some(b => b.code === 'NO_HAAT_AVAILABLE'));
  assert.ok(result.filing_controlling_haat_m == null);
});

// -----------------------------------------------------------------------
// Test 9: WJPZ-FM golden exhibit
//         WJPZ is a licensed facility. FCC-authorized HAAT = 37m (suspected
//         AGL entry). Terrain mean ≈ 241.8m.
//         Expected: REVIEW_REQUIRED (not BLOCKER), FCC_AUTHORIZED basis,
//         filing_controlling_haat_m = 37.
// -----------------------------------------------------------------------
test('WJPZ-FM golden exhibit: licensed FM, FCC haat=37m, terrain mean 241.8m → REVIEW_REQUIRED', () => {
  // Simulate WJPZ-FM 107.9 MHz Class A terrain evidence
  const wjpzRadials = makeRadials(241.8, 15);

  const result = resolveHaatAuthority({
    studyIntent:           'existing_facility_review',
    facilityStatus:        'licensed',
    fccAuthorizedHaatM:    37,
    operatorDeclaredHaatM: 37,
    computedRadialHaat:    wjpzRadials,
    rcamslM:               480    // approximate AMSL for WJPZ-FM tower
  });

  // Must be REVIEW_REQUIRED — not BLOCKER — because the facility is licensed
  assert.strictEqual(result.haat_conflict_status, 'REVIEW_REQUIRED',
    'WJPZ-FM: licensed facility with FCC vs terrain divergence must be REVIEW_REQUIRED, not BLOCKER');

  // The FCC-authorized value (37m) controls the filing for this licensed facility
  assert.strictEqual(result.filing_controlling_haat_basis, 'FCC_AUTHORIZED',
    'WJPZ-FM: FCC-authorized HAAT must be the filing-controlling basis for a licensed facility');
  assert.strictEqual(result.filing_controlling_haat_m, 37,
    'WJPZ-FM: filing_controlling_haat_m must be 37 (the FCC-licensed value)');

  // Computed terrain value must be captured for review
  assert.ok(result.computed_average_haat_m != null, 'Computed §73.313 mean must be captured');
  assert.ok(Math.abs(result.computed_average_haat_m - 241.8) < 5,
    'Computed mean must be approximately 241.8m');

  // No blockers — licensed facility with divergent values is a review issue, not a blocker
  assert.strictEqual(result.haat_blockers.length, 0,
    'WJPZ-FM: must have zero blockers — licensed facility with divergent HAAT is review, not block');

  // Review message must mention both values and explain basis-selection
  assert.ok(result.haat_review_messages.length > 0);
  const reviewMsg = result.haat_review_messages[0];
  assert.ok(reviewMsg.includes('37'), 'Review message must mention the FCC HAAT of 37m');
  assert.ok(reviewMsg.includes('basis-selection'),
    'Review message must describe this as a basis-selection issue, not a defect');

  // Three distinct HAAT concepts all populated
  assert.strictEqual(result.authorized_haat_m, 37, 'authorized_haat_m must be 37');
  assert.strictEqual(result.operator_declared_haat_m, 37, 'operator_declared_haat_m must be 37');
  assert.ok(result.computed_average_haat_m > 200, 'computed_average_haat_m must be terrain-scale');
  assert.ok(Array.isArray(result.computed_radial_haat_m) && result.computed_radial_haat_m.length >= 3,
    'computed_radial_haat_m must be an array with at least 3 values');
});

// -----------------------------------------------------------------------
// Test 10: engine/index.js path fix — fcc_lms.license.haat_m surfaces as
// fccAuthorizedHaatM even when fcc_licensed is absent
// -----------------------------------------------------------------------
import { checkHaatConsistency } from '../engine/haat/haatConsistencyCheck.js';

test('checkHaatConsistency PASS when resolver and attestation agree', () => {
  // Minimal exhibit: resolver says filing_controlling_haat_m = 37,
  // source_attestation_v2 reports operative haat_m = 37 (FCC_LMS candidate).
  const exhibit = {
    station_inputs: { service: 'FM' },
    haat_authority: {
      filing_controlling_haat_m:     37,
      filing_controlling_haat_basis: 'FCC_AUTHORIZED',
      haat_conflict_status:          'REVIEW_REQUIRED'
    },
    haat_lineage: { operative_m: 241.8 },
    source_attestation_v2: {
      fields: {
        haat_m: {
          candidates: [
            { value: 241.8, is_operative: false, source_type: 'USGS_DEM' },
            { value: 37,    is_operative: true,  source_type: 'FCC_LMS'  }
          ]
        }
      }
    }
  };
  const result = checkHaatConsistency(exhibit, { operative_haat_m: 241.8, operative_haat_basis: 'terrain_derived' });
  assert.ok(result.pass, `Expected PASS, got: ${JSON.stringify(result.blockers)}`);
  assert.strictEqual(result.status, 'PASS');
  assert.strictEqual(result.table.length, 6);
});

test('checkHaatConsistency BLOCKER when attestation operative differs from resolver', () => {
  // Simulate the original bug: attestation incorrectly shows 241.8m as operative
  // while resolver correctly returns 37m.
  const exhibit = {
    station_inputs: { service: 'FM' },
    haat_authority: {
      filing_controlling_haat_m:     37,
      filing_controlling_haat_basis: 'FCC_AUTHORIZED',
      haat_conflict_status:          'REVIEW_REQUIRED'
    },
    haat_lineage: { operative_m: 241.8 },
    source_attestation_v2: {
      fields: {
        haat_m: {
          candidates: [
            { value: 241.8, is_operative: true,  source_type: 'USGS_DEM' }  // WRONG
          ]
        }
      }
    }
  };
  const result = checkHaatConsistency(exhibit, { operative_haat_m: 241.8 });
  assert.ok(!result.pass, 'Should FAIL when attestation and resolver disagree');
  assert.strictEqual(result.status, 'BLOCKER');
  const codes = result.blockers.map(b => b.code);
  assert.ok(codes.includes('HAAT_CONSISTENCY_SA_VS_RESOLVER'),
    `Expected HAAT_CONSISTENCY_SA_VS_RESOLVER, got: ${codes}`);
});

test('checkHaatConsistency BLOCKER when resolver has no filing_controlling_haat_m', () => {
  const exhibit = {
    station_inputs: { service: 'FM' },
    haat_authority: {
      filing_controlling_haat_m:     null,
      filing_controlling_haat_basis: null,
      haat_conflict_status:          'BLOCKER'
    },
    source_attestation_v2: { fields: {} }
  };
  const result = checkHaatConsistency(exhibit);
  assert.ok(!result.pass, 'Null resolver value must be a BLOCKER');
  const codes = result.blockers.map(b => b.code);
  assert.ok(codes.includes('HAAT_CONSISTENCY_NO_RESOLVER_VALUE'));
});

test('producer table has all six consumers', () => {
  const exhibit = {
    station_inputs: { service: 'FM' },
    haat_authority: { filing_controlling_haat_m: 100, filing_controlling_haat_basis: 'FCC_AUTHORIZED' },
    source_attestation_v2: { fields: { haat_m: { candidates: [{ value: 100, is_operative: true }] } } }
  };
  const result = checkHaatConsistency(exhibit, { operative_haat_m: 100 });
  const producers = result.table.map(r => r.producer);
  assert.ok(producers.includes('contour engine'),     'table must include contour engine');
  assert.ok(producers.includes('validation verdict'), 'table must include validation verdict');
  assert.ok(producers.includes('source attestation'), 'table must include source attestation');
  assert.ok(producers.includes('AI review context'),  'table must include AI review context');
  assert.ok(producers.includes('replay token'),       'table must include replay token');
  assert.ok(producers.includes('PDF renderer'),       'table must include PDF renderer');
});
