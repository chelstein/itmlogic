// PR #329 regression tests — RF engineering lineage gaps.
//
// Covers four categories of lineage defects this PR fixes:
//
//   1. TX_AMSL_UNRESOLVED is now a BLOCKER (not a warning), preventing
//      per-radial HAAT from being silently computed as (haat_m − terrain)
//      when the antenna AMSL cannot be resolved (the KZLZ bug class).
//
//   2. FREQUENCY_OUT_OF_BAND is a BLOCKER emitted when the frequency is
//      outside the US broadcast band — most commonly a kHz/MHz unit error
//      (e.g. FM 98700 entered as MHz instead of 98.7 MHz).
//
//   3. ERP_VARIANCE_FROM_LICENSE warning fires when proposed ERP diverges
//      >5 % from the FCC-licensed ERP found in evidence.fcc_lms.
//
//   4. FCC_CLASS_DEFAULTED info warning fires when fcc_class is omitted
//      for an FM/LPFM/FX station, and class_lineage.assumption_applied
//      documents the Class-A conservative default.

import test from 'node:test';
import assert from 'node:assert/strict';

import { W, WARNING_CODES } from '../types/warnings.js';
import { compute } from '../engine/index.js';
import { runValidationSuite } from '../engine/validation/runner.js';
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

// ─── 1. TX_AMSL_UNRESOLVED severity ──────────────────────────────────────────

test('TX_AMSL_UNRESOLVED is registered as a blocker', () => {
  assert.equal(WARNING_CODES.TX_AMSL_UNRESOLVED.severity, 'blocker',
    'TX_AMSL_UNRESOLVED must be a blocker so the KZLZ class of per-radial HAAT errors blocks filing');
});

test('W.make(TX_AMSL_UNRESOLVED) returns severity=blocker', () => {
  const w = W.make('TX_AMSL_UNRESOLVED', 'test detail');
  assert.equal(w.severity, 'blocker');
  assert.equal(w.code, 'TX_AMSL_UNRESOLVED');
});

// ─── 2. Frequency out-of-band → BLOCKER ──────────────────────────────────────

test('FM frequency entered as kHz → FREQUENCY_OUT_OF_BAND blocker', async () => {
  // 98.7 MHz is valid FM; 98700 looks like kHz → treated as MHz = 98700 MHz,
  // which is far outside 88–108 MHz.
  const exhibit = await buildExhibit({
    ...FM_CLASS_A,
    frequency: 98700   // kHz value entered in the MHz field
  });
  const blocked = exhibit.blockers.some(b => b.code === 'FREQUENCY_OUT_OF_BAND');
  assert.ok(blocked,
    'FM frequency entered as kHz (98700) should emit FREQUENCY_OUT_OF_BAND blocker');
  assert.equal(exhibit.filing_readiness?.status, 'demo',
    'Filing readiness must be "demo" when a blocker is present');
});

test('FM frequency below 88 MHz → FREQUENCY_OUT_OF_BAND blocker', async () => {
  const exhibit = await buildExhibit({ ...FM_CLASS_A, frequency: 87.9 });
  assert.ok(exhibit.blockers.some(b => b.code === 'FREQUENCY_OUT_OF_BAND'));
});

test('FM frequency above 108 MHz → FREQUENCY_OUT_OF_BAND blocker', async () => {
  const exhibit = await buildExhibit({ ...FM_CLASS_A, frequency: 108.1 });
  assert.ok(exhibit.blockers.some(b => b.code === 'FREQUENCY_OUT_OF_BAND'));
});

test('AM frequency 530–1710 kHz → no FREQUENCY_OUT_OF_BAND', async () => {
  const exhibit = await run({
    call: 'WAM-AM', facility_id: '8888',
    service: 'AM', frequency: 1000,
    erp_kw: 1.0, ground_sigma_mS_m: 8,
    lat: 37.09, lon: -95.71, radial_step_deg: 45
  });
  assert.ok(!exhibit.warnings.some(w => w.code === 'FREQUENCY_OUT_OF_BAND'),
    'Valid AM frequency 1000 kHz should not emit FREQUENCY_OUT_OF_BAND');
});

test('AM frequency 200 kHz → FREQUENCY_OUT_OF_BAND blocker', async () => {
  const exhibit = await run({
    call: 'WAM-AM', facility_id: '8888',
    service: 'AM', frequency: 200,
    erp_kw: 1.0, ground_sigma_mS_m: 8,
    lat: 37.09, lon: -95.71, radial_step_deg: 45
  });
  assert.ok(exhibit.blockers.some(b => b.code === 'FREQUENCY_OUT_OF_BAND'),
    'AM frequency 200 kHz is below 530 kHz and must emit FREQUENCY_OUT_OF_BAND blocker');
});

test('Valid FM frequency 98.7 MHz → no FREQUENCY_OUT_OF_BAND', async () => {
  const exhibit = await buildExhibit({ ...FM_CLASS_A, frequency: 98.7 });
  assert.ok(!exhibit.warnings.some(w => w.code === 'FREQUENCY_OUT_OF_BAND'),
    'Valid FM frequency 98.7 MHz must not emit FREQUENCY_OUT_OF_BAND');
});

// ─── 3. ERP variance from license ────────────────────────────────────────────

test('ERP 10 kW vs licensed 5 kW (100 % variance) → ERP_VARIANCE_FROM_LICENSE warning', async () => {
  const exhibit = await run(
    { ...FM_CLASS_A, erp_kw: 10.0 },
    { fcc_lms: { license: { erp_kw: 5.0 } } }
  );
  assert.ok(exhibit.warnings.some(w => w.code === 'ERP_VARIANCE_FROM_LICENSE'),
    'ERP 100 % above licensed value must emit ERP_VARIANCE_FROM_LICENSE warning');
  assert.ok(exhibit.erp_lineage != null, 'erp_lineage must be present on exhibit');
  assert.equal(exhibit.erp_lineage.licensed_erp_kw, 5.0);
  assert.equal(exhibit.erp_lineage.proposed_erp_kw, 10.0);
  assert.ok(exhibit.erp_lineage.variance_pct > 5,
    'variance_pct must reflect the actual divergence');
});

test('ERP 6 kW vs licensed 6.2 kW (3.2 % variance) → no ERP_VARIANCE_FROM_LICENSE', async () => {
  const exhibit = await run(
    { ...FM_CLASS_A, erp_kw: 6.0 },
    { fcc_lms: { license: { erp_kw: 6.2 } } }
  );
  assert.ok(!exhibit.warnings.some(w => w.code === 'ERP_VARIANCE_FROM_LICENSE'),
    'ERP within 5 % tolerance must not emit ERP_VARIANCE_FROM_LICENSE');
});

test('No FCC LMS evidence → erp_lineage.source is not_available, no ERP warning', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  assert.ok(!exhibit.warnings.some(w => w.code === 'ERP_VARIANCE_FROM_LICENSE'));
  assert.equal(exhibit.erp_lineage?.source, 'not_available');
});

// ─── 4. FCC class defaulting ──────────────────────────────────────────────────

test('FM station without fcc_class → FCC_CLASS_DEFAULTED info warning', async () => {
  const exhibit = await run({
    call: 'WTEST-FM', facility_id: '99999',
    service: 'FM',
    frequency: 98.7, erp_kw: 6.0, haat_m: 100,
    lat: 37.09, lon: -95.71, radial_step_deg: 10
    // fcc_class intentionally omitted
  });
  assert.ok(exhibit.warnings.some(w => w.code === 'FCC_CLASS_DEFAULTED'),
    'FM station without fcc_class must emit FCC_CLASS_DEFAULTED info warning');
  assert.ok(exhibit.class_lineage != null, 'class_lineage must be present on exhibit');
  assert.ok(exhibit.class_lineage.assumption_applied != null,
    'class_lineage.assumption_applied must document the Class-A default');
  assert.equal(exhibit.class_lineage.raw, null,
    'class_lineage.raw must be null when fcc_class not supplied');
  assert.equal(exhibit.class_lineage.engineering_assumption_source, 'default_class_a');
});

test('FM station with fcc_class="C" → no FCC_CLASS_DEFAULTED, class_lineage.raw="C"', async () => {
  const exhibit = await buildExhibit({ ...FM_CLASS_A, fcc_class: 'C' });
  assert.ok(!exhibit.warnings.some(w => w.code === 'FCC_CLASS_DEFAULTED'));
  assert.equal(exhibit.class_lineage?.raw, 'C');
  assert.equal(exhibit.class_lineage?.engineering_assumption_source, 'operator_supplied');
  assert.equal(exhibit.class_lineage?.assumption_applied, null);
});

test('AM station without fcc_class → no FCC_CLASS_DEFAULTED (class not used for AM groundwave)', async () => {
  const exhibit = await run({
    call: 'WAM-AM', facility_id: '8888',
    service: 'AM', frequency: 1000,
    erp_kw: 1.0, ground_sigma_mS_m: 8,
    lat: 37.09, lon: -95.71, radial_step_deg: 45
  });
  assert.ok(!exhibit.warnings.some(w => w.code === 'FCC_CLASS_DEFAULTED'),
    'AM stations should not emit FCC_CLASS_DEFAULTED (class is not used in AM groundwave)');
});

// ─── 5. Lineage objects present on every exhibit ──────────────────────────────

test('frequency_lineage present on FM exhibit with correct band bounds', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  const fl = exhibit.frequency_lineage;
  assert.ok(fl != null, 'frequency_lineage must be on exhibit');
  assert.equal(fl.unit, 'MHz');
  assert.equal(fl.value, FM_CLASS_A.frequency);
  assert.deepEqual(fl.band_check.min, 88.0);
  assert.deepEqual(fl.band_check.max, 108.0);
  assert.equal(fl.band_check.pass, true);
});

test('erp_lineage present on exhibit regardless of evidence', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  assert.ok(exhibit.erp_lineage != null, 'erp_lineage must always be on exhibit');
  assert.equal(exhibit.erp_lineage.proposed_erp_kw, FM_CLASS_A.erp_kw);
});

test('class_lineage present on exhibit', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  assert.ok(exhibit.class_lineage != null, 'class_lineage must always be on exhibit');
  assert.equal(exhibit.class_lineage.raw, FM_CLASS_A.fcc_class);
});

// ─── 6. Warning registry completeness ────────────────────────────────────────
// Every code emitted via W.make() in the haat validation pipeline must be in
// the registry — this guards against the production crash where
// HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH was emitted but unregistered.

import { Severity, validateHaat } from '../engine/haat/validate.js';

test('All codes emitted by validateHaat issues are registered in WARNING_CODES', () => {
  // Build a minimal exhibit that triggers all three mismatch paths:
  // 1. HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH (relative delta > 50%)
  // 2. LIKELY_AGL_ENTERED_AS_HAAT (operator very low, terrain high)
  const haatMismatchExhibit = {
    station_inputs:  { service: 'FM', haat_m: 30 },
    haat_validation: null,
    blockers:        [],
    warnings:        [],
    haat_lineage:    { operator_entered_m: 30, terrain_mean_m: 250 },
    radial_table:    Array.from({ length: 36 }, (_, i) => ({
      azimuth_deg: i * 10,
      haat_m:      250 + Math.sin(i) * 5   // plausible per-radial values
    }))
  };

  const haatReport = validateHaat(haatMismatchExhibit);
  const issueCodes = (haatReport.issues || []).map(i => i.code);

  // Every code the validator emits must exist in WARNING_CODES so W.make won't throw.
  for (const code of issueCodes){
    if (!WARNING_CODES[code]){
      assert.fail(`validateHaat emitted code "${code}" that is NOT in WARNING_CODES — will crash W.make in exhibitService`);
    }
  }

  // Specifically confirm the two codes that were missing are now registered.
  assert.ok(WARNING_CODES['HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH'] != null,
    'HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH must be in WARNING_CODES (PR #332 fix)');
  assert.ok(WARNING_CODES['LIKELY_AGL_ENTERED_AS_HAAT'] != null,
    'LIKELY_AGL_ENTERED_AS_HAAT must be in WARNING_CODES');
});
