// Golden Fixture Regression Suite — WJPZ + 3 new golden stations + 10 representative stations.
// All tests must pass with the current codebase.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessReport }      from '../exports/readiness/index.js';
import { buildEngineeringReasoning } from '../exports/readiness/reasoning.js';
import { detectFieldConflicts }      from '../exports/readiness/conflicts.js';
import { buildLineageReport }        from '../exports/lmsFiling/lineage.js';
import { buildFilingPackage }        from '../exports/lmsFiling/packager.js';

// ── Golden station fixtures ────────────────────────────────────────────────────

const WJPZ_FM = {
  station_inputs: { call:'WJPZ', facility_id:'73610', service:'FM', fcc_class:'A', frequency:107.9, erp_kw:6.0, haat_m_input:37, lat:43.0481, lon:-76.1474 },
  facility_metadata: { cached:true, facility_lookup_source:'FCC FMQ', facility_updated_at:'2026-04-01T00:00:00Z', raw:{ call:'WJPZ', city:'SYRACUSE', state:'NY', haat_m:37, erp_kw:6.0, frequency:107.9 } },
  regulatory_compliance: { pass:false, violations:[{ cite:'47 CFR §73.215', message:'Contour overlap with WDWN (66249) at 3.2 km' },{ cite:'47 CFR §73.215', message:'Contour overlap with WIII (12312) at 4.7 km' }], section_73_207:{ pass:false, violations:[{ cite:'47 CFR §73.207', message:'Co-channel: WDWN fails by 12 km' }] } },
  evidence: { terrain_haat_per_radial:[{azimuth_deg:0,haat_computed_m:220.3},{azimuth_deg:45,haat_computed_m:241.5},{azimuth_deg:90,haat_computed_m:260.1},{azimuth_deg:135,haat_computed_m:255.8},{azimuth_deg:180,haat_computed_m:230.4},{azimuth_deg:225,haat_computed_m:248.2},{azimuth_deg:270,haat_computed_m:241.6},{azimuth_deg:315,haat_computed_m:236.7}] }
};

const KAZM_AM = {
  station_inputs: { call:'KAZM', facility_id:'35149', service:'AM', fcc_class:'C', frequency_khz:780, power_day_kw:1.0, power_night_kw:0.052, community:'Sedona', lat:34.86833, lon:-111.79111, tower_count:1, rms_field_mv_m:309, m3_conductivity_zone:'4 mS/m' },
  evidence: {}
};

const KNUV_FM = {
  station_inputs: { call:'KNUV', facility_id:'24680', service:'FM', fcc_class:'C', frequency:94.9, erp_kw:100, haat_m_input:300, lat:33.448, lon:-112.074, overall_height_m:95 },
  facility_metadata: { cached:true, facility_lookup_source:'FCC FMQ', facility_updated_at:'2025-06-01T00:00:00Z', raw:{ call:'KNUV', city:'PHOENIX', state:'AZ', erp_kw:100, frequency:94.9 } },
  regulatory_compliance: { pass:true, violations:[], section_73_207:{ pass:true, violations:[] } },
  evidence: { terrain_haat_per_radial:[{azimuth_deg:0,haat_computed_m:298},{azimuth_deg:45,haat_computed_m:302},{azimuth_deg:90,haat_computed_m:299},{azimuth_deg:135,haat_computed_m:301},{azimuth_deg:180,haat_computed_m:300},{azimuth_deg:225,haat_computed_m:299},{azimuth_deg:270,haat_computed_m:301},{azimuth_deg:315,haat_computed_m:302}] }
};

const WVIK_FM = {
  station_inputs: { call:'WVIK', facility_id:'56789', service:'FM', fcc_class:'B', frequency:107.1, erp_kw:50, haat_m_input:150, lat:41.524, lon:-90.571, overall_height_m:65 },
  facility_metadata: { cached:true, facility_lookup_source:'FCC FMQ', facility_updated_at:'2025-03-01T00:00:00Z', raw:{ call:'WVIK', city:'ROCK ISLAND', state:'IL', erp_kw:50, frequency:107.1 } },
  regulatory_compliance: { pass:true, violations:[], section_73_207:{ pass:false, violations:[{ cite:'47 CFR §73.207', message:'Co-channel separation: WQPT fails by 2.1 km' }] } },
  evidence: { terrain_haat_per_radial:[{azimuth_deg:0,haat_computed_m:148},{azimuth_deg:45,haat_computed_m:151},{azimuth_deg:90,haat_computed_m:149},{azimuth_deg:135,haat_computed_m:150},{azimuth_deg:180,haat_computed_m:148},{azimuth_deg:225,haat_computed_m:152},{azimuth_deg:270,haat_computed_m:150},{azimuth_deg:315,haat_computed_m:149}] }
};

// ── 10 representative station fixtures ────────────────────────────────────────

// LPFM station
const WPFK_LPFM = { station_inputs:{ call:'WPFK', service:'LPFM', frequency:88.1, erp_kw:0.1, haat_m_input:30, lat:40.712, lon:-74.006 }, evidence:{} };

// FM Translator
const W123CD_FX = { station_inputs:{ call:'W123CD', service:'FX', frequency:92.3, erp_kw:0.25, haat_m_input:30, lat:38.897, lon:-77.036 }, evidence:{} };

// FM Class A with directional antenna
const WKLX_FM = { station_inputs:{ call:'WKLX', service:'FM', fcc_class:'A', frequency:91.7, erp_kw:5.5, haat_m_input:100, lat:42.358, lon:-71.059, pattern:[{azimuth:0,relative_field:1.0},{azimuth:90,relative_field:0.8},{azimuth:180,relative_field:0.9},{azimuth:270,relative_field:0.7}] }, regulatory_compliance:{ pass:true, violations:[], section_73_207:{ pass:false, violations:[{cite:'47 CFR §73.207',message:'Co-channel: WBUR fails by 0.5 km'}] } }, evidence:{} };

// FM Class B with full ASR evidence
const KBIG_FM = { station_inputs:{ call:'KBIG', facility_id:'33333', service:'FM', fcc_class:'B', frequency:104.3, erp_kw:48.0, haat_m_input:420, lat:34.052, lon:-118.244, overall_height_m:110 }, facility_metadata:{ facility_lookup_source:'FCC FMQ', raw:{ city:'LOS ANGELES', state:'CA', erp_kw:48.0, frequency:104.3 } }, evidence:{ asr:{ asr_number:'1056789', overall_height_m:110, fetched_at:'2026-01-01T00:00:00Z' }, terrain_haat_per_radial:[{azimuth_deg:0,haat_computed_m:419},{azimuth_deg:90,haat_computed_m:421},{azimuth_deg:180,haat_computed_m:418},{azimuth_deg:270,haat_computed_m:422}] }, regulatory_compliance:{ pass:true, violations:[], section_73_207:{ pass:true, violations:[] } } };

// AM Class A (clear channel)
const WMRY_AM = { station_inputs:{ call:'WMRY', facility_id:'44444', service:'AM', fcc_class:'A', frequency_khz:660, power_day_kw:50, power_night_kw:50, community:'New York', lat:40.859, lon:-73.785, tower_count:6 }, evidence:{} };

// FM Class C - minimal/proposed (no compliance yet)
const KFOO_FM = { station_inputs:{ call:'KFOO', service:'FM', fcc_class:'C', frequency:100.1, erp_kw:95, haat_m_input:400, lat:39.739, lon:-104.984 }, evidence:{} };

// FM Class A with coordinate conflict
const WFGH_FM = { station_inputs:{ call:'WFGH', service:'FM', fcc_class:'A', frequency:96.5, erp_kw:5.8, haat_m_input:90, lat:41.881, lon:-87.624 }, facility_metadata:{ facility_lookup_source:'FCC FMQ', raw:{ city:'CHICAGO', state:'IL', erp_kw:5.8, frequency:96.5, lat:41.883, lon:-87.627 } }, evidence:{} };

// FM Class C - ERP near class limit
const KMMM_FM = { station_inputs:{ call:'KMMM', service:'FM', fcc_class:'C', frequency:99.5, erp_kw:99.9, haat_m_input:600, lat:47.606, lon:-122.332 }, regulatory_compliance:{ pass:true, violations:[], section_73_207:{ pass:true, violations:[] } }, evidence:{} };

// FM Class C with tower from ASR
const WAAA_FM = { station_inputs:{ call:'WAAA', facility_id:'55555', service:'FM', fcc_class:'C', frequency:103.7, erp_kw:80, haat_m_input:350, lat:29.763, lon:-95.363 }, evidence:{ asr:{ asr_number:'9876543', overall_height_m:88, fetched_at:'2025-12-01T00:00:00Z' } }, regulatory_compliance:{ pass:true, violations:[], section_73_207:{ pass:true, violations:[] } } };

// FM Class B1 with SDR evidence
const WBIG_FM = { station_inputs:{ call:'WBIG', service:'FM', fcc_class:'B1', frequency:101.9, erp_kw:24.5, haat_m_input:100, lat:42.652, lon:-73.756 }, evidence:{ sdr_captures:[{id:'cap_1',path:'wbig_20260101.sigmf'}] }, regulatory_compliance:{ pass:true, violations:[], section_73_207:{ pass:true, violations:[] } } };

// ── Section 1: Golden station baselines ───────────────────────────────────────

// ── WJPZ

test('WJPZ: buildReadinessReport returns valid determination', () => {
  const r = buildReadinessReport(WJPZ_FM);
  assert.ok(['NOT_READY', 'REVIEW', 'READY'].includes(r.determination), `unexpected determination: ${r.determination}`);
});

test('WJPZ: readiness blockers have code and message', () => {
  const r = buildReadinessReport(WJPZ_FM);
  for (const b of r.blockers) {
    assert.ok(b.code && b.code.length > 0, `blocker missing code: ${JSON.stringify(b)}`);
    assert.ok(b.message && b.message.length > 0, `blocker missing message: ${JSON.stringify(b)}`);
  }
});

test('WJPZ: readiness COMPLIANCE_FAILURE blockers carry rule citation', () => {
  const r = buildReadinessReport(WJPZ_FM);
  const cf = r.blockers.filter(b => b.code === 'COMPLIANCE_FAILURE');
  for (const b of cf) {
    assert.ok(b.rule && b.rule.length > 5, `COMPLIANCE_FAILURE blocker must carry a rule citation (got '${b.rule}')`);
  }
});

test('WJPZ: buildEngineeringReasoning returns conclusions array', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  assert.ok(Array.isArray(r.conclusions));
  assert.ok(r.conclusions.length >= 0);
});

test('WJPZ: all reasoning FAIL conclusions have rule', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  const fails = r.conclusions.filter(c => c.result === 'FAIL');
  for (const c of fails) {
    assert.ok(c.rule && c.rule.length > 3, `FAIL conclusion ${c.id} must carry a rule citation`);
  }
});

test('WJPZ: all reasoning conclusions have evidence', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  for (const c of r.conclusions) {
    assert.ok(Array.isArray(c.evidence) && c.evidence.length >= 1, `conclusion ${c.id} must have at least one evidence entry`);
  }
});

test('WJPZ: buildLineageReport returns fields array', () => {
  const r = buildLineageReport(WJPZ_FM);
  assert.ok(Array.isArray(r.fields) && r.fields.length > 0);
});

test('WJPZ: lineage every field has status and source_system', () => {
  const r = buildLineageReport(WJPZ_FM);
  for (const f of r.fields) {
    assert.ok(f.status, `field ${f.id} missing status`);
    assert.ok(f.source_system, `field ${f.id} missing source_system`);
  }
});

test('WJPZ: detectFieldConflicts returns array', () => {
  const cs = detectFieldConflicts(WJPZ_FM);
  assert.ok(Array.isArray(cs));
});

test('WJPZ: conflict winning_source always set', () => {
  const cs = detectFieldConflicts(WJPZ_FM);
  for (const c of cs) {
    assert.ok(c.winning_source, `conflict ${c.field} must have winning_source`);
  }
});

// WJPZ-specific golden assertions
test('WJPZ: determination is NOT_READY', () => {
  const r = buildReadinessReport(WJPZ_FM);
  assert.equal(r.determination, 'NOT_READY');
});

test('WJPZ: compliance blockers mention WDWN and WIII', () => {
  const r = buildReadinessReport(WJPZ_FM);
  const cf = r.blockers.filter(b => b.code === 'COMPLIANCE_FAILURE');
  const msgs = cf.map(b => b.message).join(' ');
  assert.match(msgs, /WDWN/);
  assert.match(msgs, /WIII/);
});

test('WJPZ: HAAT_DISCREPANCY warning present', () => {
  const r = buildReadinessReport(WJPZ_FM);
  const hw = r.warnings.find(w => w.code === 'HAAT_DISCREPANCY');
  assert.ok(hw, `expected HAAT_DISCREPANCY warning, got: ${JSON.stringify(r.warnings)}`);
});

test('WJPZ: reasoning has section-73-215-compliance FAIL conclusion', () => {
  const r = buildEngineeringReasoning(WJPZ_FM);
  const c = r.conclusions.find(x => x.id === 'section-73-215-compliance');
  assert.ok(c, 'section-73-215-compliance conclusion must exist');
  assert.equal(c.result, 'FAIL');
  assert.match(c.rule, /§73\.215/);
});

// ── KAZM

test('KAZM: buildReadinessReport returns valid determination', () => {
  const r = buildReadinessReport(KAZM_AM);
  assert.ok(['NOT_READY', 'REVIEW', 'READY'].includes(r.determination), `unexpected determination: ${r.determination}`);
});

test('KAZM: readiness blockers have code and message', () => {
  const r = buildReadinessReport(KAZM_AM);
  for (const b of r.blockers) {
    assert.ok(b.code && b.code.length > 0, `blocker missing code: ${JSON.stringify(b)}`);
    assert.ok(b.message && b.message.length > 0, `blocker missing message: ${JSON.stringify(b)}`);
  }
});

test('KAZM: readiness COMPLIANCE_FAILURE blockers carry rule citation', () => {
  const r = buildReadinessReport(KAZM_AM);
  const cf = r.blockers.filter(b => b.code === 'COMPLIANCE_FAILURE');
  for (const b of cf) {
    assert.ok(b.rule && b.rule.length > 5, `COMPLIANCE_FAILURE blocker must carry a rule citation`);
  }
});

test('KAZM: buildEngineeringReasoning returns conclusions array', () => {
  const r = buildEngineeringReasoning(KAZM_AM);
  assert.ok(Array.isArray(r.conclusions));
  assert.ok(r.conclusions.length >= 0);
});

test('KAZM: all reasoning FAIL conclusions have rule', () => {
  const r = buildEngineeringReasoning(KAZM_AM);
  const fails = r.conclusions.filter(c => c.result === 'FAIL');
  for (const c of fails) {
    assert.ok(c.rule && c.rule.length > 3, `FAIL conclusion ${c.id} must carry a rule citation`);
  }
});

test('KAZM: all reasoning conclusions have evidence', () => {
  const r = buildEngineeringReasoning(KAZM_AM);
  for (const c of r.conclusions) {
    assert.ok(Array.isArray(c.evidence) && c.evidence.length >= 1, `conclusion ${c.id} must have at least one evidence entry`);
  }
});

test('KAZM: buildLineageReport returns fields array', () => {
  const r = buildLineageReport(KAZM_AM);
  assert.ok(Array.isArray(r.fields) && r.fields.length > 0);
});

test('KAZM: lineage every field has status and source_system', () => {
  const r = buildLineageReport(KAZM_AM);
  for (const f of r.fields) {
    assert.ok(f.status, `field ${f.id} missing status`);
    assert.ok(f.source_system, `field ${f.id} missing source_system`);
  }
});

test('KAZM: detectFieldConflicts returns array', () => {
  const cs = detectFieldConflicts(KAZM_AM);
  assert.ok(Array.isArray(cs));
});

test('KAZM: conflict winning_source always set', () => {
  const cs = detectFieldConflicts(KAZM_AM);
  for (const c of cs) {
    assert.ok(c.winning_source, `conflict ${c.field} must have winning_source`);
  }
});

// KAZM-specific golden assertions
test('KAZM: service is AM, form_id is 301-AM', () => {
  const r = buildLineageReport(KAZM_AM);
  assert.equal(r.form.form_id, '301-AM');
});

test('KAZM: no COMPLIANCE_FAILURE blockers (no regulatory_compliance block)', () => {
  const r = buildReadinessReport(KAZM_AM);
  const cf = r.blockers.filter(b => b.code === 'COMPLIANCE_FAILURE');
  assert.equal(cf.length, 0, `AM exhibit without regulatory_compliance must not have COMPLIANCE_FAILURE blockers`);
});

// ── KNUV

test('KNUV: buildReadinessReport returns valid determination', () => {
  const r = buildReadinessReport(KNUV_FM);
  assert.ok(['NOT_READY', 'REVIEW', 'READY'].includes(r.determination), `unexpected determination: ${r.determination}`);
});

test('KNUV: readiness blockers have code and message', () => {
  const r = buildReadinessReport(KNUV_FM);
  for (const b of r.blockers) {
    assert.ok(b.code && b.code.length > 0);
    assert.ok(b.message && b.message.length > 0);
  }
});

test('KNUV: readiness COMPLIANCE_FAILURE blockers carry rule citation', () => {
  const r = buildReadinessReport(KNUV_FM);
  const cf = r.blockers.filter(b => b.code === 'COMPLIANCE_FAILURE');
  for (const b of cf) {
    assert.ok(b.rule && b.rule.length > 5);
  }
});

test('KNUV: buildEngineeringReasoning returns conclusions array', () => {
  const r = buildEngineeringReasoning(KNUV_FM);
  assert.ok(Array.isArray(r.conclusions));
});

test('KNUV: all reasoning FAIL conclusions have rule', () => {
  const r = buildEngineeringReasoning(KNUV_FM);
  const fails = r.conclusions.filter(c => c.result === 'FAIL');
  for (const c of fails) {
    assert.ok(c.rule && c.rule.length > 3, `FAIL conclusion ${c.id} must carry a rule citation`);
  }
});

test('KNUV: all reasoning conclusions have evidence', () => {
  const r = buildEngineeringReasoning(KNUV_FM);
  for (const c of r.conclusions) {
    assert.ok(Array.isArray(c.evidence) && c.evidence.length >= 1, `conclusion ${c.id} must have at least one evidence entry`);
  }
});

test('KNUV: buildLineageReport returns fields array', () => {
  const r = buildLineageReport(KNUV_FM);
  assert.ok(Array.isArray(r.fields) && r.fields.length > 0);
});

test('KNUV: lineage every field has status and source_system', () => {
  const r = buildLineageReport(KNUV_FM);
  for (const f of r.fields) {
    assert.ok(f.status, `field ${f.id} missing status`);
    assert.ok(f.source_system, `field ${f.id} missing source_system`);
  }
});

test('KNUV: detectFieldConflicts returns array', () => {
  const cs = detectFieldConflicts(KNUV_FM);
  assert.ok(Array.isArray(cs));
});

test('KNUV: conflict winning_source always set', () => {
  const cs = detectFieldConflicts(KNUV_FM);
  for (const c of cs) {
    assert.ok(c.winning_source, `conflict ${c.field} must have winning_source`);
  }
});

// KNUV-specific golden assertions
test('KNUV: compliance conclusions are PASS', () => {
  const r = buildEngineeringReasoning(KNUV_FM);
  const comp = r.conclusions.find(c => c.id === 'section-73-215-compliance');
  assert.ok(comp, 'section-73-215-compliance conclusion must exist');
  assert.equal(comp.result, 'PASS');
});

test('KNUV: coordinate-validation is PASS', () => {
  const r = buildEngineeringReasoning(KNUV_FM);
  const c = r.conclusions.find(x => x.id === 'coordinate-validation');
  assert.ok(c, 'coordinate-validation conclusion must exist');
  assert.equal(c.result, 'PASS');
});

test('KNUV: erp-class-limit is PASS', () => {
  const r = buildEngineeringReasoning(KNUV_FM);
  const c = r.conclusions.find(x => x.id === 'erp-class-limit');
  assert.ok(c, 'erp-class-limit conclusion must exist');
  assert.equal(c.result, 'PASS');
});

// ── WVIK

test('WVIK: buildReadinessReport returns valid determination', () => {
  const r = buildReadinessReport(WVIK_FM);
  assert.ok(['NOT_READY', 'REVIEW', 'READY'].includes(r.determination));
});

test('WVIK: readiness blockers have code and message', () => {
  const r = buildReadinessReport(WVIK_FM);
  for (const b of r.blockers) {
    assert.ok(b.code && b.code.length > 0);
    assert.ok(b.message && b.message.length > 0);
  }
});

test('WVIK: readiness COMPLIANCE_FAILURE blockers carry rule citation', () => {
  const r = buildReadinessReport(WVIK_FM);
  const cf = r.blockers.filter(b => b.code === 'COMPLIANCE_FAILURE');
  for (const b of cf) {
    assert.ok(b.rule && b.rule.length > 5);
  }
});

test('WVIK: buildEngineeringReasoning returns conclusions array', () => {
  const r = buildEngineeringReasoning(WVIK_FM);
  assert.ok(Array.isArray(r.conclusions));
});

test('WVIK: all reasoning FAIL conclusions have rule', () => {
  const r = buildEngineeringReasoning(WVIK_FM);
  const fails = r.conclusions.filter(c => c.result === 'FAIL');
  for (const c of fails) {
    assert.ok(c.rule && c.rule.length > 3, `FAIL conclusion ${c.id} must carry a rule citation`);
  }
});

test('WVIK: all reasoning conclusions have evidence', () => {
  const r = buildEngineeringReasoning(WVIK_FM);
  for (const c of r.conclusions) {
    assert.ok(Array.isArray(c.evidence) && c.evidence.length >= 1, `conclusion ${c.id} must have at least one evidence entry`);
  }
});

test('WVIK: buildLineageReport returns fields array', () => {
  const r = buildLineageReport(WVIK_FM);
  assert.ok(Array.isArray(r.fields) && r.fields.length > 0);
});

test('WVIK: lineage every field has status and source_system', () => {
  const r = buildLineageReport(WVIK_FM);
  for (const f of r.fields) {
    assert.ok(f.status, `field ${f.id} missing status`);
    assert.ok(f.source_system, `field ${f.id} missing source_system`);
  }
});

test('WVIK: detectFieldConflicts returns array', () => {
  const cs = detectFieldConflicts(WVIK_FM);
  assert.ok(Array.isArray(cs));
});

test('WVIK: conflict winning_source always set', () => {
  const cs = detectFieldConflicts(WVIK_FM);
  for (const c of cs) {
    assert.ok(c.winning_source, `conflict ${c.field} must have winning_source`);
  }
});

// WVIK-specific golden assertions
test('WVIK: compliance-pass value is PASS-via-73.215 (§73.207 fails but §73.215 passes)', () => {
  const r = buildLineageReport(WVIK_FM);
  const f = r.fields.find(x => x.id === 'compliance-pass');
  assert.ok(f, 'compliance-pass field must exist');
  assert.equal(f.value, 'PASS-via-73.215', `expected PASS-via-73.215, got '${f.value}'`);
});

test('WVIK: compliance-rule-path is §73.215', () => {
  const r = buildLineageReport(WVIK_FM);
  const f = r.fields.find(x => x.id === 'compliance-rule-path');
  assert.ok(f, 'compliance-rule-path field must exist');
  assert.equal(f.value, '§73.215');
});

// ── Section 2: Representative station coverage ────────────────────────────────

const REPRESENTATIVE_FIXTURES = [
  { fixture: WPFK_LPFM,   call: 'WPFK',   expectedFormId: '318' },
  { fixture: W123CD_FX,   call: 'W123CD', expectedFormId: '349' },
  { fixture: WKLX_FM,     call: 'WKLX',   expectedFormId: '301-FM' },
  { fixture: KBIG_FM,     call: 'KBIG',   expectedFormId: '301-FM' },
  { fixture: WMRY_AM,     call: 'WMRY',   expectedFormId: '301-AM' },
  { fixture: KFOO_FM,     call: 'KFOO',   expectedFormId: '301-FM' },
  { fixture: WFGH_FM,     call: 'WFGH',   expectedFormId: '301-FM' },
  { fixture: KMMM_FM,     call: 'KMMM',   expectedFormId: '301-FM' },
  { fixture: WAAA_FM,     call: 'WAAA',   expectedFormId: '301-FM' },
  { fixture: WBIG_FM,     call: 'WBIG',   expectedFormId: '301-FM' },
];

for (const { fixture, call, expectedFormId } of REPRESENTATIVE_FIXTURES) {
  test(`${call}: routes to correct form (form_id=${expectedFormId})`, () => {
    const pkg = buildFilingPackage(fixture);
    // form_id is in the summary via mapped.form.form_id; parse from json output
    const parsed = JSON.parse(pkg.json);
    assert.equal(parsed.form.form_id, expectedFormId, `expected form_id ${expectedFormId}, got ${parsed.form.form_id}`);
  });

  test(`${call}: readiness returns valid shape`, () => {
    const r = buildReadinessReport(fixture);
    assert.ok('determination' in r, 'missing determination');
    assert.ok('readiness_score' in r, 'missing readiness_score');
    assert.ok(Array.isArray(r.blockers), 'missing blockers array');
    assert.ok(Array.isArray(r.warnings), 'missing warnings array');
    assert.ok(Array.isArray(r.advisories), 'missing advisories array');
  });

  test(`${call}: no null-value field is FILLED`, () => {
    const r = buildLineageReport(fixture);
    for (const f of r.fields) {
      if (f.value === null || f.value === undefined) {
        assert.notEqual(
          (f.status || '').toLowerCase(),
          'filled',
          `field ${f.id} has null value but status is FILLED`
        );
      }
    }
  });

  test(`${call}: no FAIL conclusion without rule`, () => {
    const r = buildEngineeringReasoning(fixture);
    const fails = r.conclusions.filter(c => c.result === 'FAIL');
    for (const c of fails) {
      assert.ok(c.rule && c.rule.length > 3, `FAIL conclusion ${c.id} must have a rule`);
    }
  });
}

// ── Section 3: Cross-cutting invariants (all 14 stations) ────────────────────

const ALL_FIXTURES = [
  { fixture: WJPZ_FM,    call: 'WJPZ' },
  { fixture: KAZM_AM,    call: 'KAZM' },
  { fixture: KNUV_FM,    call: 'KNUV' },
  { fixture: WVIK_FM,    call: 'WVIK' },
  { fixture: WPFK_LPFM,  call: 'WPFK' },
  { fixture: W123CD_FX,  call: 'W123CD' },
  { fixture: WKLX_FM,    call: 'WKLX' },
  { fixture: KBIG_FM,    call: 'KBIG' },
  { fixture: WMRY_AM,    call: 'WMRY' },
  { fixture: KFOO_FM,    call: 'KFOO' },
  { fixture: WFGH_FM,    call: 'WFGH' },
  { fixture: KMMM_FM,    call: 'KMMM' },
  { fixture: WAAA_FM,    call: 'WAAA' },
  { fixture: WBIG_FM,    call: 'WBIG' },
];

for (const { fixture, call } of ALL_FIXTURES) {
  test(`[invariant] ${call}: readiness score is 0-100 integer`, () => {
    const r = buildReadinessReport(fixture);
    assert.ok(Number.isInteger(r.readiness_score), `score must be an integer (got ${r.readiness_score})`);
    assert.ok(r.readiness_score >= 0 && r.readiness_score <= 100, `score must be 0-100 (got ${r.readiness_score})`);
  });

  test(`[invariant] ${call}: all readiness blockers have code and message`, () => {
    const r = buildReadinessReport(fixture);
    for (const b of r.blockers) {
      assert.ok(b.code && b.code.length > 0, `blocker missing code: ${JSON.stringify(b)}`);
      assert.ok(b.message && b.message.length > 0, `blocker missing message: ${JSON.stringify(b)}`);
    }
  });

  test(`[invariant] ${call}: all reasoning conclusions have id and result`, () => {
    const r = buildEngineeringReasoning(fixture);
    for (const c of r.conclusions) {
      assert.ok(c.id && c.id.length > 0, `conclusion missing id: ${JSON.stringify(c)}`);
      assert.ok(c.result && c.result.length > 0, `conclusion ${c.id} missing result`);
    }
  });

  test(`[invariant] ${call}: lineage fields all have source_system key`, () => {
    const r = buildLineageReport(fixture);
    for (const f of r.fields) {
      assert.ok('source_system' in f, `field ${f.id} missing source_system key`);
    }
  });

  test(`[invariant] ${call}: conflicts always have winning_source`, () => {
    const cs = detectFieldConflicts(fixture);
    for (const c of cs) {
      assert.ok(c.winning_source, `conflict ${c.field} missing winning_source`);
    }
  });
}
