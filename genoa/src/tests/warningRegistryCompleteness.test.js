// Warning registry completeness — guards against runtime crashes from
// unregistered warning codes.
//
// W.make(code) throws 'unknown warning code: X' when code is absent from
// WARNING_CODES.  exhibitService.js loops W.make over every HAAT validation
// issue, so any code emitted by validateHaat() that is not registered will
// crash exhibit generation for all affected stations (PR #332 root cause).
//
// Two checks:
//  1. Static: every code string literal used in W.make() calls across the
//     engine, readiness, and attestation layers must be in WARNING_CODES.
//  2. Dynamic: call validateHaat() on a maximally-mismatched exhibit and
//     assert every emitted issue.code is registered.

import test from 'node:test';
import assert from 'node:assert/strict';

import { WARNING_CODES } from '../types/warnings.js';
import { validateHaat }  from '../engine/haat/validate.js';

// ── 1. Static W.make code coverage ───────────────────────────────────────────
// These are the codes passed to W.make() across the entire src/ tree.
// Add new entries here whenever a W.make('NEW_CODE') call is added.

const WMAKER_CODES = [
  // exhibitService.js
  'TX_AMSL_UNRESOLVED', 'CP_LOOKUP_FALLBACK', 'FACILITY_LOOKUP_UNAVAILABLE',
  'LICENSE_EXPIRED', 'LICENSE_EXPIRING_SOON', 'LMS_DATA_MISMATCH',
  'PUBLIC_FILE_INCOMPLETE', 'LMS_DATA_UNAVAILABLE', 'TERRAIN_HAAT_REJECTED',
  'NEC_LICENSE_BOUNDARY_EXTERNAL', 'NEC_GROUND_MODEL_LIMITATION',
  'NEC_NEAR_FIELD_APPROXIMATION', 'NEC_MODEL_UNAVAILABLE', 'NEC_MODEL_INVALID_GEOMETRY',
  'SDR_CALIBRATION_MISSING', 'SDR_MEASUREMENTS_MISSING', 'SDR_MEASUREMENTS_NOT_CALIBRATED',
  'SDR_RESIDUAL_LARGE', 'SIDECAR_UNAVAILABLE', 'TERRAIN_LIMITED', 'TERRAIN_NOT_APPLIED',
  'TOWER_COMPLIANCE_GAP', 'POPULATION_PLACEHOLDER', 'COMPUTE_TIMEOUT_PARTIAL',
  'COUNTY_INTERSECTION_FAILED', 'ASR_MISMATCH', 'FAA_DETERMINATION_EXPIRED',
  'FCC_GEO_CROSSCHECK_FAILED', 'FCC_GEO_CROSSCHECK_SKIPPED', 'FCC_PARITY_DELTA',
  'FCC_PARITY_VERIFIED', 'FCC_CLASS_DEFAULTED',
  // engine / analysis
  'AM_GROUND_SIGMA_UNRESOLVED', 'AM_GROUND_SIGMA_ZONE_ESTIMATE',
  'CONSTANT_HAAT_ASSUMED', 'CURVE_VALIDATION_MISSING',
  'FACILITY_COORDINATES_MISSING', 'FACILITY_ID_MISSING',
  'MISSING_NEARBY_STATIONS',
  'NEC_NEAR_FIELD_APPROXIMATION', 'NEC_LICENSE_BOUNDARY_EXTERNAL', 'NEC_GROUND_MODEL_LIMITATION',
  'ERP_VARIANCE_FROM_LICENSE',
  // regulatory / engine
  'FM_CONTOUR_PROTECTION_VIOLATION', 'FM_MINIMUM_SEPARATION_VIOLATION',
  'FM_TV_CH6_PROTECTION_VIOLATION', 'FREQUENCY_OUT_OF_BAND', 'LPFM_RULE_VIOLATION',
  'TRANSLATOR_INTERFERENCE', 'OET65_BOUNDARY_VIOLATION', 'OET65_NEAR_FIELD_REQUIRED',
  'AM_73_24G_FAIL', 'AM_73_24J_FAIL', 'AM_DA_PATTERN_COMPLIANCE_FAIL',
  'AM_INTERNATIONAL_TREATY_ZONE', 'AM_NIGHTTIME_PROTECTION_VIOLATION',
  'CONTOUR_MONOTONICITY_VIOLATION',
  'REFERENCE_CASES_MISSING', 'REFERENCE_CASE_NOT_AUTHORITATIVE',
  'REFERENCE_EXPECTED_CONTOURS_MISSING',
  'BUILD_UNVERSIONED', 'SIGMA_CLAMP', 'FCCAM_UNAVAILABLE_BERRY_FALLBACK',
];

test('All W.make() code arguments are registered in WARNING_CODES', () => {
  const uniq = [...new Set(WMAKER_CODES)];
  const missing = uniq.filter(c => !WARNING_CODES[c]);
  assert.deepEqual(missing, [],
    `W.make() calls reference unregistered codes: ${missing.join(', ')}`);
});

// ── 2. Dynamic validateHaat() code coverage ───────────────────────────────────
// Build a strongly mismatched exhibit that exercises every branch of
// validate.js and confirm each emitted code is in the registry.

test('All codes emitted by validateHaat() are registered in WARNING_CODES', () => {
  const radialTable = Array.from({ length: 36 }, (_, i) => ({
    azimuth_deg:  i * 10,
    haat_m:       250 + Math.sin(i) * 5,
    haat_computed_m: 250 + Math.sin(i) * 5,
  }));

  const exhibit = {
    station_inputs: { service: 'FM', haat_m: 30 },
    haat_lineage: {
      operator_entered_m: 30,
      terrain_mean_m:     250,
      operative_m:        250,
      operative_source:   'terrain_mean',
    },
    radial_table: radialTable,
  };

  const result = validateHaat(exhibit);
  const unregistered = (result.issues || [])
    .map(i => i.code)
    .filter(code => !WARNING_CODES[code]);

  assert.deepEqual(unregistered, [],
    `validateHaat() emitted unregistered codes: ${unregistered.join(', ')}`);
});

// ── 3. Readiness and engine code: literal object codes ────────────────────────
// These codes appear as `code: 'X'` in readiness/index.js, daPatternCheck.js,
// and engine provenance/attestation files.  They are not routed through W.make()
// but MUST be in the registry so W.lookup() and UI switch statements work.

const READINESS_CODES = [
  // readiness/index.js
  'FIELD_INVALID', 'COMPLIANCE_FAILURE', 'ASR_UNREGISTERED',
  'ENGINEER_CONFIRMATION_NEEDED', 'TERRAIN_EVIDENCE_MISSING',
  'ENGINE_BLOCKER', 'FIELD_CONFLICT',
  'OET65_REQUIRED', 'OET65_MISSING', 'SDR_MISSING', 'AM_PHYSICS_MISSING',
  // daPatternCheck.js
  'DA_PATTERN_MISSING', 'DA_PATTERN_UNCONFIRMED', 'DA_PATTERN_INVALID',
  'DA_PATTERN_INCOMPLETE', 'DA_PATTERN_UNNORMALIZED', 'DA_SUPPRESSION_UNVERIFIED',
  // source attestation / provenance
  'SOURCE_UNVERIFIED', 'SOURCE_CONFLICT', 'SOURCE_OPERATOR_ONLY',
  'SOURCE_HASH_MISSING', 'SOURCE_CONFIDENCE_LOW', 'SOURCE_AUTHORITY_UNKNOWN',
  'SOURCE_STALE', 'SOURCE_AGING', 'SOURCE_TIMESTAMP_MISSING',
  'SOURCE_REFRESH_REQUIRED', 'SOURCE_RECORD_CHANGED',
  'SOURCE_EVIDENCE_LOCK_MISSING', 'SOURCE_EVIDENCE_LOCK_INVALID',
  'SOURCE_EVIDENCE_LOCK_STALE',
  // haat engine object literals
  'HAAT_CONTRADICTION', 'HAAT_DISCREPANCY', 'HAAT_FALLBACK_ONLY',
  'HAAT_IMPOSSIBLE', 'HAAT_LIKELY_AGL', 'HAAT_MEAN_INCONSISTENT',
  'HAAT_OPERATOR_SUSPECT', 'HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH',
  'HAAT_SUPPRESSED_NO_TERRAIN_BASIS', 'HAAT_SUSPECT_OUTLIERS',
  'LIKELY_AGL_ENTERED_AS_HAAT',
  'OPERATIVE_HAAT_OPERATOR_ONLY',
];

test('All readiness/engine code literals are registered in WARNING_CODES', () => {
  const uniq = [...new Set(READINESS_CODES)];
  const missing = uniq.filter(c => !WARNING_CODES[c]);
  assert.deepEqual(missing, [],
    `Readiness/engine code literals reference unregistered codes: ${missing.join(', ')}`);
});
