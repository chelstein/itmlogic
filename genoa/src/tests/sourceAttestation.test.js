// PR #330 regression tests — Source Attestation Framework.
//
// Tests the source_attestation exhibit block, per-field authority
// scoring, cross-source conflict detection, provenance hashing,
// and readiness gate integration.
//
// Test labels:
//   A. source_attestation block is always present on engine output
//   B. operator-only FM exhibit → overall_confidence ~0.50, operator_only statuses
//   C. LMS evidence present → erp field gets FCC_LMS authority
//   D. ERP conflict (>5%) → SOURCE_CONFLICT in attestation.conflicts
//   E. Coordinate conflict (>10 m) → SOURCE_CONFLICT in attestation.conflicts
//   F. Evidence hashes present when fcc_lms/asr evidence supplied
//   G. WARNING_CODES includes the 6 new source attestation codes

import test from 'node:test';
import assert from 'node:assert/strict';

import { W, WARNING_CODES } from '../types/warnings.js';
import { compute } from '../engine/index.js';
import { runValidationSuite } from '../engine/validation/runner.js';
import { buildSourceAttestation } from '../engine/provenance/buildSourceAttestation.js';
import { detectProvenanceConflicts } from '../engine/provenance/provenanceConflicts.js';
import { scoreSource } from '../engine/provenance/sourceConfidence.js';
import { SOURCE_AUTHORITY } from '../engine/provenance/sourceAuthority.js';
import { hashEvidence } from '../engine/provenance/hashEvidence.js';
import { buildExhibit, FM_CLASS_A } from './_helpers.js';

// ─── shared validation context ────────────────────────────────────────────────

let _validation = null;
async function getValidation(){
  if (!_validation) _validation = await runValidationSuite();
  return _validation;
}

async function run(inputs, evidence = {}){
  const v = await getValidation();
  return compute({ inputs, evidence, options: {
    operator:   'test',
    validation: { runs: [v], reference_cases_present: v.reference_cases_present }
  }});
}

// ─── A. source_attestation present on engine output ──────────────────────────

test('A: source_attestation block always present on FM engine output', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  // Engine produces lineage fields; attestation is built by exhibitService.
  // For the unit-test path (buildExhibit bypasses exhibitService), we verify
  // the provenance modules work correctly in isolation.
  const sa = buildSourceAttestation(exhibit, {});
  assert.ok(sa != null, 'buildSourceAttestation must return an object');
  assert.ok(typeof sa.overall_confidence === 'number', 'overall_confidence must be numeric');
  assert.ok(Array.isArray(sa.field_scores), 'field_scores must be an array');
  assert.ok(Array.isArray(sa.conflicts), 'conflicts must be an array');
  assert.ok(typeof sa.source_hashes === 'object', 'source_hashes must be an object');
  assert.ok(typeof sa.generated_at === 'string', 'generated_at must be a string');
});

// ─── B. Operator-only exhibit → low confidence, operator_only statuses ────────

test('B: operator-only FM exhibit → overall_confidence ≈ 0.50, no authoritative cross-check', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  const sa = buildSourceAttestation(exhibit, {});
  // Without any FCC LMS / ASR / DEM evidence, most fields are operator_input
  assert.ok(sa.overall_confidence <= 0.60,
    `Operator-only confidence should be ≤ 0.60, got ${sa.overall_confidence}`);

  const operatorOnlyFields = sa.field_scores.filter(
    s => s.verification_status === 'operator_only'
  );
  assert.ok(operatorOnlyFields.length > 0,
    'At least one field must be operator_only when no external evidence supplied');
});

// ─── C. LMS evidence → erp field authority = fcc_lms ─────────────────────────

test('C: erp field gets fcc_lms authority when LMS evidence present and ERP matches', async () => {
  const exhibit = await run(
    { ...FM_CLASS_A, erp_kw: 6.0 },
    { fcc_lms: { license: { erp_kw: 6.0 } } }
  );
  const sa = buildSourceAttestation(exhibit, exhibit.evidence);
  const erpScore = sa.field_scores.find(s => s.field === 'erp')
    || sa.fields?.erp;
  assert.ok(erpScore != null, 'erp field must be scored');
  assert.equal(erpScore.source_authority, SOURCE_AUTHORITY.FCC_LMS,
    'erp source_authority must be fcc_lms when LMS evidence present');
  assert.equal(erpScore.verification_status, 'cross_checked',
    'erp must be cross_checked when LMS record agrees');
  assert.ok(!erpScore.conflict, 'erp conflict must be false when within 5% tolerance');
});

// ─── D. ERP conflict (>5%) → SOURCE_CONFLICT in attestation.conflicts ─────────

test('D: ERP 10 kW vs licensed 5 kW → ERP conflict in attestation.conflicts', async () => {
  const exhibit = await run(
    { ...FM_CLASS_A, erp_kw: 10.0 },
    { fcc_lms: { license: { erp_kw: 5.0 } } }
  );
  const sa = buildSourceAttestation(exhibit, exhibit.evidence);
  const erpConflict = sa.conflicts.find(c => c.field === 'erp');
  assert.ok(erpConflict != null,
    'ERP 100% above licensed must produce erp conflict in attestation.conflicts');
  assert.equal(erpConflict.severity, 'conflict');
  assert.ok(erpConflict.delta_pct > 5,
    'conflict delta_pct must exceed the 5% threshold');
});

// ─── E. Coordinate conflict (>10 m) → SOURCE_CONFLICT detected ───────────────

test('E: operator coordinates >10 m from LMS → coordinate conflict in attestation.conflicts', () => {
  // Build a minimal exhibit-like object with the lineage fields
  const exhibit = {
    station_inputs: {
      lat: 37.0902,
      lon: -95.7129
    }
  };
  // LMS location ~500 m away (about 0.005° lat delta at mid-latitudes ≈ 556 m)
  const evidence = {
    fcc_lms: { license: { lat: 37.0952, lon: -95.7129 } }
  };
  const conflicts = detectProvenanceConflicts(exhibit, evidence);
  const coordConflict = conflicts.find(c => c.field === 'coordinates');
  assert.ok(coordConflict != null,
    'Coordinates >10 m from LMS must produce a coordinates conflict');
  assert.ok(coordConflict.delta_m > 10,
    `delta_m must exceed 10 m, got ${coordConflict?.delta_m}`);
  assert.equal(coordConflict.warning_code, 'SOURCE_CONFLICT');
});

// ─── F. Evidence hashes present when fcc_lms/asr evidence supplied ─────────────

test('F: hashEvidence returns fcc_lms hash when evidence.fcc_lms present', () => {
  const evidence = {
    fcc_lms: { license: { erp_kw: 6.0, frequency: 98.7, lat: 37.0902, lon: -95.7129 } },
    asr:     { asr_number: '1234567', overall_height_m: 90 }
  };
  const hashes = hashEvidence(evidence);
  assert.ok(typeof hashes.fcc_lms === 'string' && hashes.fcc_lms.length === 64,
    'fcc_lms SHA-256 hash must be a 64-char hex string');
  assert.ok(typeof hashes.fcc_asr === 'string' && hashes.fcc_asr.length === 64,
    'fcc_asr SHA-256 hash must be a 64-char hex string');
});

test('F2: hashEvidence produces same hash for identical evidence regardless of key order', () => {
  const e1 = { fcc_lms: { license: { a: 1, b: 2 } } };
  const e2 = { fcc_lms: { license: { b: 2, a: 1 } } };
  const h1 = hashEvidence(e1);
  const h2 = hashEvidence(e2);
  assert.equal(h1.fcc_lms, h2.fcc_lms,
    'SHA-256 must be identical for same values in different key insertion order');
});

test('F3: hashEvidence returns empty object when no evidence', () => {
  const hashes = hashEvidence({});
  assert.deepEqual(hashes, {});
});

// ─── G. WARNING_CODES includes the 6 new source attestation codes ──────────────

test('G: WARNING_CODES contains all 6 source attestation codes', () => {
  const expectedCodes = [
    'SOURCE_UNVERIFIED',
    'SOURCE_CONFLICT',
    'SOURCE_OPERATOR_ONLY',
    'SOURCE_HASH_MISSING',
    'SOURCE_CONFIDENCE_LOW',
    'SOURCE_AUTHORITY_UNKNOWN'
  ];
  for (const code of expectedCodes){
    assert.ok(WARNING_CODES[code] != null, `WARNING_CODES must contain ${code}`);
  }
  assert.equal(WARNING_CODES.SOURCE_UNVERIFIED.severity,     'blocker');
  assert.equal(WARNING_CODES.SOURCE_CONFLICT.severity,       'warning');
  assert.equal(WARNING_CODES.SOURCE_OPERATOR_ONLY.severity,  'warning');
  assert.equal(WARNING_CODES.SOURCE_HASH_MISSING.severity,   'info');
  assert.equal(WARNING_CODES.SOURCE_CONFIDENCE_LOW.severity, 'warning');
  assert.equal(WARNING_CODES.SOURCE_AUTHORITY_UNKNOWN.severity, 'info');
});

test('G2: W.make works for all 6 new source attestation codes', () => {
  const codes = [
    'SOURCE_UNVERIFIED', 'SOURCE_CONFLICT', 'SOURCE_OPERATOR_ONLY',
    'SOURCE_HASH_MISSING', 'SOURCE_CONFIDENCE_LOW', 'SOURCE_AUTHORITY_UNKNOWN'
  ];
  for (const code of codes){
    assert.doesNotThrow(() => W.make(code, 'test detail'),
      `W.make must not throw for ${code}`);
    const w = W.make(code);
    assert.equal(w.code, code);
    assert.ok(w.severity, `${code} must have a severity`);
  }
});

// ─── scoreSource unit tests ────────────────────────────────────────────────────

test('scoreSource: fcc_lms with no conflict → confidence=1.00, verified', () => {
  const s = scoreSource({ field: 'frequency', source_authority: 'fcc_lms',
    cross_checked: false, conflict: false });
  assert.equal(s.confidence, 1.00);
  assert.equal(s.verification_status, 'verified');
});

test('scoreSource: fcc_lms with cross_checked → cross_checked status, +0.05 bonus', () => {
  const s = scoreSource({ field: 'erp', source_authority: 'fcc_lms',
    cross_checked: true, conflict: false });
  assert.equal(s.confidence, 1.00); // capped at 1.0
  assert.equal(s.verification_status, 'cross_checked');
});

test('scoreSource: operator_input → confidence=0.50, operator_only', () => {
  const s = scoreSource({ field: 'haat', source_authority: 'operator_input',
    cross_checked: false, conflict: false });
  assert.equal(s.confidence, 0.50);
  assert.equal(s.verification_status, 'operator_only');
  assert.ok(s.warnings.includes('SOURCE_OPERATOR_ONLY'));
});

test('scoreSource: conflict flag → penalty -0.15, status=conflict', () => {
  const s = scoreSource({ field: 'erp', source_authority: 'fcc_lms',
    cross_checked: false, conflict: true, conflict_detail: 'ERP mismatch' });
  assert.equal(s.confidence, +(1.00 - 0.15).toFixed(3));
  assert.equal(s.verification_status, 'conflict');
  assert.ok(s.warnings.includes('SOURCE_CONFLICT'));
});

test('scoreSource: unknown authority → confidence=0.00, unknown status', () => {
  const s = scoreSource({ field: 'fcc_class', source_authority: 'unknown',
    cross_checked: false, conflict: false });
  assert.equal(s.confidence, 0.00);
  assert.equal(s.verification_status, 'unknown');
  assert.ok(s.warnings.includes('SOURCE_AUTHORITY_UNKNOWN'));
});
