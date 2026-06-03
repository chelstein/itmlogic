// WJPZ-FM Golden Audit — permanent regression fixture.
//
// WJPZ-FM 107.9 MHz Class A Syracuse NY is the canonical test case for
// the Genoa filing readiness, reasoning, and conflict systems.  Every
// assertion here represents a known failure mode that MUST NEVER recur.
//
// Criteria:
//   Community not missing        (was EVIDENCE MISSING — fixed PR #316)
//   Tower height not zero        (was FILLED — fixed PR #316)
//   Compliance basis populated   (was null — fixed PR #316)
//   WDWN failure shown           (§73.215 blocker)
//   WIII failure shown           (§73.215 blocker)
//   Filed HAAT shown             (37 m operator-supplied)
//   Terrain HAAT shown           (~241.8 m advisory)
//   Readiness = NOT_READY        (compliance failures block filing)
//   Lineage complete             (all PR #317 fields have lineage)
//   Reasoning complete           (HAAT + compliance + tower conclusions)
//   Conflict engine fires        (filed 37m vs terrain 241.8m)

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessReport }       from '../exports/readiness/index.js';
import { buildEngineeringReasoning }  from '../exports/readiness/reasoning.js';
import { detectFieldConflicts }       from '../exports/readiness/conflicts.js';
import { buildLineageReport }         from '../exports/lmsFiling/lineage.js';

// ── WJPZ-FM fixture ───────────────────────────────────────────────────────────

const WJPZ_FM = {
  station_inputs: {
    call:          'WJPZ',
    facility_id:   '73610',
    service:       'FM',
    fcc_class:     'A',
    frequency:     107.9,
    erp_kw:        6.0,
    haat_m_input:  37,
    lat:           43.0481,
    lon:          -76.1474
    // community intentionally absent — must come from facility_metadata.raw.city
  },
  facility_metadata: {
    cached:                 true,
    facility_lookup_source: 'FCC FMQ',
    facility_updated_at:    '2026-04-01T00:00:00Z',
    raw: {
      call:      'WJPZ',
      city:      'SYRACUSE',
      state:     'NY',
      haat_m:    37,
      erp_kw:    6.0,
      frequency: 107.9
    }
  },
  regulatory_compliance: {
    pass:     false,
    violations: [
      { cite: '47 CFR §73.215', message: 'Contour overlap with WDWN (66249) at 3.2 km' },
      { cite: '47 CFR §73.215', message: 'Contour overlap with WIII (12312) at 4.7 km' }
    ],
    section_73_207: {
      pass:       false,
      violations: [{ cite: '47 CFR §73.207', message: 'Co-channel: WDWN fails by 12 km' }]
    }
  },
  evidence: {
    terrain_haat_per_radial: [
      { azimuth_deg: 0,   haat_computed_m: 220.3 },
      { azimuth_deg: 45,  haat_computed_m: 241.5 },
      { azimuth_deg: 90,  haat_computed_m: 260.1 },
      { azimuth_deg: 135, haat_computed_m: 255.8 },
      { azimuth_deg: 180, haat_computed_m: 230.4 },
      { azimuth_deg: 225, haat_computed_m: 248.2 },
      { azimuth_deg: 270, haat_computed_m: 241.6 },
      { azimuth_deg: 315, haat_computed_m: 236.7 }
    ]
  }
};

// ── Phase 1: Filing Readiness Gate ────────────────────────────────────────────

test('WJPZ readiness determination is NOT_READY', () => {
  const r = buildReadinessReport(WJPZ_FM);
  assert.equal(r.determination, 'NOT_READY',
    `expected NOT_READY, got '${r.determination}'`);
});

test('WJPZ readiness score ≤ 40 due to compliance blockers', () => {
  const r = buildReadinessReport(WJPZ_FM);
  assert.ok(r.readiness_score <= 40,
    `score should be ≤40 with compliance blockers (got ${r.readiness_score})`);
});

test('WJPZ readiness has COMPLIANCE_FAILURE blockers for WDWN and WIII', () => {
  const r = buildReadinessReport(WJPZ_FM);
  const cf = r.blockers.filter(b => b.code === 'COMPLIANCE_FAILURE');
  assert.ok(cf.length >= 2,
    `expected ≥2 COMPLIANCE_FAILURE blockers (got ${cf.length}): ${JSON.stringify(r.blockers)}`);
  const msgs = cf.map(b => b.message).join(' ');
  assert.match(msgs, /WDWN/, 'WDWN compliance failure must appear in blockers');
  assert.match(msgs, /WIII/, 'WIII compliance failure must appear in blockers');
});

test('WJPZ readiness COMPLIANCE_FAILURE blockers carry rule citation', () => {
  const r = buildReadinessReport(WJPZ_FM);
  const cf = r.blockers.filter(b => b.code === 'COMPLIANCE_FAILURE');
  for (const b of cf){
    assert.ok(b.rule && b.rule.length > 5,
      `COMPLIANCE_FAILURE blocker must carry a rule citation (got '${b.rule}')`);
    assert.match(b.rule, /§73\.(207|215)/);
  }
});

test('WJPZ readiness warns about HAAT discrepancy (37m vs ~241.8m)', () => {
  const r = buildReadinessReport(WJPZ_FM);
  const hw = r.warnings.find(w => w.code === 'HAAT_DISCREPANCY');
  assert.ok(hw, `expected HAAT_DISCREPANCY warning, got warnings: ${JSON.stringify(r.warnings)}`);
  assert.match(hw.message, /37/,  'warning must mention filed HAAT 37m');
  assert.match(hw.message, /241|242/, 'warning must mention terrain advisory HAAT ~241.8m');
});

test('WJPZ readiness has blockers array', () => {
  const r = buildReadinessReport(WJPZ_FM);
  assert.ok(Array.isArray(r.blockers));
  assert.ok(Array.isArray(r.warnings));
  assert.ok(Array.isArray(r.advisories));
  assert.ok(Array.isArray(r.evidence));
});

test('WJPZ readiness evidence includes filed HAAT and terrain advisory HAAT', () => {
  const r = buildReadinessReport(WJPZ_FM);
  const filed   = r.evidence.find(e => e.type === 'haat_filed');
  const advisory = r.evidence.find(e => e.type === 'haat_advisory');
  assert.ok(filed,   'evidence must include haat_filed');
  assert.ok(advisory, 'evidence must include haat_advisory');
  assert.equal(filed.value, 37);
  assert.ok(Number(advisory.value) > 200,
    `advisory HAAT should be ~241.8 (got ${advisory.value})`);
});

test('WJPZ readiness: SDR advisory present, OET-65 escalated to warning at 6 kW ERP', () => {
  const r = buildReadinessReport(WJPZ_FM);
  const sdr  = r.advisories.find(a => a.code === 'SDR_MISSING');
  const oet  = r.warnings.find(w => w.code === 'OET65_REQUIRED');
  assert.ok(sdr, 'SDR_MISSING advisory must be present');
  assert.ok(oet, 'OET65_REQUIRED warning must be present for 6 kW ERP (never a blocker)');
  // OET-65 is a warning, not a blocker — determination is NOT_READY only due to compliance.
  assert.equal(r.determination, 'NOT_READY');
});

// ── Phase 2: Engineering Reasoning ───────────────────────────────────────────

test('WJPZ reasoning generates section-73-215-compliance conclusion', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  assert.ok(r.conclusions, 'conclusions must be an array');
  const c = r.conclusions.find(x => x.id === 'section-73-215-compliance');
  assert.ok(c, 'section-73-215-compliance conclusion must exist');
  assert.equal(c.result, 'FAIL');
  assert.match(c.rule, /§73\.215/);
  assert.ok(c.confidence === 'HIGH');
});

test('WJPZ reasoning: §73.215 conclusion evidence lists WDWN and WIII', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  const c = r.conclusions.find(x => x.id === 'section-73-215-compliance');
  const evidenceTxt = c.evidence.map(e => JSON.stringify(e.value)).join(' ');
  assert.match(evidenceTxt, /WDWN/, 'WDWN must appear in evidence');
  assert.match(evidenceTxt, /WIII/, 'WIII must appear in evidence');
});

test('WJPZ reasoning generates haat-conflict conclusion', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  const c = r.conclusions.find(x => x.id === 'haat-conflict');
  assert.ok(c, 'haat-conflict conclusion must exist when filed and terrain HAAT diverge');
  assert.equal(c.result, 'FAIL');
  assert.match(c.conclusion, /37/,  'conclusion must mention filed HAAT 37m');
  assert.match(c.conclusion, /241|242/, 'conclusion must mention terrain advisory HAAT');
});

test('WJPZ reasoning generates haat-terrain-advisory conclusion', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  const c = r.conclusions.find(x => x.id === 'haat-terrain-advisory');
  assert.ok(c, 'haat-terrain-advisory conclusion must exist');
  assert.equal(c.result, 'ADVISORY');
  assert.ok(c.evidence.length >= 8, 'should have ≥8 radial evidence entries');
});

test('WJPZ reasoning every FAIL conclusion has a rule', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  const fails = r.conclusions.filter(c => c.result === 'FAIL');
  assert.ok(fails.length > 0, 'must have at least one FAIL conclusion');
  for (const c of fails){
    assert.ok(c.rule && c.rule.length > 3,
      `FAIL conclusion ${c.id} must carry a rule citation (got '${c.rule}')`);
  }
});

test('WJPZ reasoning every conclusion has evidence', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  for (const c of r.conclusions){
    assert.ok(Array.isArray(c.evidence) && c.evidence.length > 0,
      `conclusion ${c.id} must have at least one evidence entry`);
  }
});

test('WJPZ reasoning has schema and generated_at', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  assert.match(r.schema, /genoa\.engineering_reasoning/);
  assert.ok(!isNaN(Date.parse(r.generated_at)));
});

test('WJPZ reasoning generates coordinate-validation conclusion (PASS for CONUS)', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  const c = r.conclusions.find(x => x.id === 'coordinate-validation');
  assert.ok(c, 'coordinate-validation conclusion must exist');
  assert.equal(c.result, 'PASS');
});

// ── Phase 5: Conflict Engine ──────────────────────────────────────────────────

test('WJPZ: conflict engine detects HAAT discrepancy (37m vs ~241.8m)', () => {
  const cs = detectFieldConflicts(WJPZ_FM);
  const haat = cs.find(c => c.field === 'haat-m');
  assert.ok(haat, 'HAAT conflict must be detected');
  assert.ok(haat.values.length >= 2, 'HAAT conflict must have ≥2 values');
  const vals = haat.values.map(v => Number(v.value));
  assert.ok(vals.some(v => v < 50), 'one value should be 37m (filed)');
  assert.ok(vals.some(v => v > 200), 'one value should be ~241.8m (terrain advisory)');
  assert.ok(haat.winning_source, 'conflict must have a winning_source');
  assert.ok(haat.conflict_reason && haat.conflict_reason.length > 10,
    'conflict_reason must explain the discrepancy');
});

test('WJPZ: conflict engine does not fire for frequency (no FMQ frequency mismatch)', () => {
  // WJPZ_FM has frequency 107.9 in both station_inputs and facility_metadata.raw
  const cs = detectFieldConflicts(WJPZ_FM);
  const freq = cs.find(c => c.field === 'frequency-mhz');
  assert.ok(!freq, 'no frequency conflict expected when values match');
});

test('conflict engine fires for tower height when ASR and input differ', () => {
  const exhibit = {
    ...WJPZ_FM,
    station_inputs: { ...WJPZ_FM.station_inputs, overall_height_m: 45.0 },
    evidence: {
      ...WJPZ_FM.evidence,
      asr: { overall_height_m: 60.0, asr_number: '1234567' }
    }
  };
  const cs = detectFieldConflicts(exhibit);
  const tc = cs.find(c => c.field === 'tower-overall-height-agl-m');
  assert.ok(tc, 'tower height conflict must fire when input≠ASR by >5%');
  assert.equal(tc.winning_source, 'evidence.asr.overall_height_m');
  assert.match(tc.winning_reason, /ASR/i);
});

test('conflict engine winning_source is always set', () => {
  const cs = detectFieldConflicts(WJPZ_FM);
  for (const c of cs){
    assert.ok(c.winning_source, `conflict ${c.field} must have winning_source`);
    assert.ok(c.winning_reason, `conflict ${c.field} must have winning_reason`);
  }
});

// ── Phase 6: Lineage completeness ────────────────────────────────────────────

test('WJPZ lineage: community-of-license is FILLED from facility_metadata.raw.city', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'community-of-license');
  assert.equal(f.status, 'filled');
  assert.ok(/SYRACUSE/i.test(String(f.value)));
  assert.match(f.source_path, /facility_metadata\.raw/);
});

test('WJPZ lineage: tower height 0 is INVALID', () => {
  const exhibit = {
    ...WJPZ_FM,
    station_inputs: { ...WJPZ_FM.station_inputs, overall_height_m: 0 }
  };
  const r = buildLineageReport(exhibit);
  const f = r.fields.find(x => x.id === 'tower-overall-height-agl-m');
  assert.equal(f.status, 'invalid');
  assert.ok(f.invalid_reason && f.invalid_reason.length > 5);
});

test('WJPZ lineage: compliance-rule-path is FILLED = §73.215', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'compliance-rule-path');
  assert.equal(f.status, 'filled');
  assert.equal(f.value, '§73.215');
});

test('WJPZ lineage: compliance-pass is FILLED = FAIL', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'compliance-pass');
  assert.equal(f.status, 'filled');
  assert.equal(f.value, 'FAIL');
});

test('WJPZ lineage: filed HAAT is 37m (FILLED)', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'haat-m');
  assert.equal(f.status, 'filled');
  assert.equal(f.value, 37);
});

test('WJPZ lineage: terrain advisory HAAT is ~241.8m and non-blocking', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'haat-terrain-advisory-m');
  assert.ok(Number(f.value) > 200);
  assert.equal(f.blocking, false);
  assert.equal(f.advisory, true);
});

test('WJPZ lineage is complete: every field has id, status, source_system, source_path', () => {
  const r = buildLineageReport(WJPZ_FM);
  for (const f of r.fields){
    assert.ok(f.id,          `field missing id`);
    assert.ok(f.status,      `field ${f.id} missing status`);
    assert.ok(f.source_system, `field ${f.id} missing source_system`);
    // source_path may be null for unfilled fields, but must be present as a key
    assert.ok('source_path' in f, `field ${f.id} missing source_path key`);
  }
});

// ── Golden audit: consulting engineer scenario ────────────────────────────────
//
// "Why did Genoa say FAIL?" — every answer should be traceable.

test('WJPZ golden: can explain FAIL with exact rule, evidence, source', () => {
  const reasoning = buildEngineeringReasoning(WJPZ_FM);
  const compliance = reasoning.conclusions.find(c => c.id === 'section-73-215-compliance');

  assert.ok(compliance, 'Must have compliance conclusion');
  assert.ok(compliance.rule, 'Must have rule');
  assert.ok(compliance.evidence.length > 0, 'Must have evidence');
  assert.ok(compliance.source, 'Must have source');
  assert.ok(compliance.confidence, 'Must have confidence');

  // Every piece of the answer is non-null:
  assert.notEqual(compliance.rule, null);
  assert.notEqual(compliance.required, null);
  assert.equal(compliance.result, 'FAIL');
  assert.equal(compliance.confidence, 'HIGH');
});

test('WJPZ golden: readiness report provides complete remediation path', () => {
  const r = buildReadinessReport(WJPZ_FM);
  for (const b of r.blockers){
    assert.ok(b.code,    `blocker missing code`);
    assert.ok(b.message, `blocker missing message`);
    // Every compliance blocker needs a rule citation
    if (b.code === 'COMPLIANCE_FAILURE'){
      assert.ok(b.rule, `COMPLIANCE_FAILURE blocker missing rule: ${JSON.stringify(b)}`);
    }
    // Every field blocker needs a remedy
    if (b.code === 'FIELD_MISSING' || b.code === 'FIELD_INVALID'){
      assert.ok(b.remedy, `${b.code} blocker missing remedy: ${JSON.stringify(b)}`);
    }
  }
});

test('WJPZ golden: no advisory issue affects NOT_READY determination', () => {
  const noSdr = buildReadinessReport(WJPZ_FM);
  assert.equal(noSdr.determination, 'NOT_READY');

  // Adding SDR captures should NOT change the determination
  const withSdr = buildReadinessReport({
    ...WJPZ_FM,
    evidence: { ...WJPZ_FM.evidence, sdr_captures: [{ id: 'cap_1', path: 'test.sigmf' }] }
  });
  assert.equal(withSdr.determination, 'NOT_READY',
    'Adding SDR captures must NOT change NOT_READY — compliance failures still block');
});
