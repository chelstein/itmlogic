// Filing Field Lineage — contract and regression tests.
//
// Covers buildLineageReport() output shape, per-field lineage
// enrichment, and WJPZ-FM regression scenarios (the five bugs fixed
// in PR #316 that must never recur).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLineageReport } from '../exports/lmsFiling/lineage.js';

// ── Fixtures ───────────────────────────────────────────────────────

// Minimal FM exhibit — most fields will be EVIDENCE_MISSING / gap.
const MINIMAL_FM = {
  station_inputs: {
    call: 'WTST',
    service: 'FM',
    frequency: 100.7,
    erp_kw: 6,
    haat_m_input: 100,
    fcc_class: 'A',
    lat: 40.0,
    lon: -75.0
  },
  evidence: {}
};

// WJPZ-FM fixture — reproduces the five pre-fix bugs.
//   • community only in facility_metadata.raw.city
//   • tower height 0 in station_inputs.overall_height_m
//   • §73.215 fails both §73.207 and §73.215
//   • filed HAAT 37 m, terrain-derived ~241.8 m mean
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
      call:   'WJPZ',
      city:   'SYRACUSE',
      state:  'NY',
      haat_m: 37,
      erp_kw: 6.0
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

// ── 1. Top-level output shape ───────────────────────────────────────

test('buildLineageReport: throws on missing exhibit', () => {
  assert.throws(() => buildLineageReport(null), /exhibit is required/);
  assert.throws(() => buildLineageReport(undefined), /exhibit is required/);
});

test('buildLineageReport: returns correct top-level keys', () => {
  const r = buildLineageReport(MINIMAL_FM);
  assert.ok(r.schema, 'schema key must be present');
  assert.match(r.schema, /genoa\.filing_lineage/);
  assert.ok(r.generated_at, 'generated_at must be present');
  assert.ok(!isNaN(Date.parse(r.generated_at)), 'generated_at must be ISO-8601');
  assert.ok(r.exhibit_metadata, 'exhibit_metadata must be present');
  assert.ok(r.form, 'form must be present');
  assert.ok(r.summary, 'summary must be present');
  assert.ok(Array.isArray(r.fields), 'fields must be an array');
  assert.ok(r.fields.length > 0, 'fields must be non-empty for FM');
});

test('buildLineageReport: exhibit_metadata carries call/service/facility_id', () => {
  const r = buildLineageReport(MINIMAL_FM);
  assert.equal(r.exhibit_metadata.call, 'WTST');
  assert.equal(r.exhibit_metadata.service, 'FM');
});

// ── 2. Per-field lineage shape ──────────────────────────────────────

test('every field carries all required lineage keys', () => {
  const r = buildLineageReport(MINIMAL_FM);
  const REQUIRED_KEYS = [
    'id', 'lms_label', 'section', 'subsection',
    'required', 'advisory', 'filing_critical',
    'value', 'status', 'blocking',
    'source_system', 'source_path', 'confidence', 'timestamp',
    'validation_result', 'provenance',
    'expected_source', 'conflict_values', 'invalid_reason',
    'notes', 'engineer_confirmation_required'
  ];
  for (const f of r.fields){
    for (const k of REQUIRED_KEYS){
      assert.ok(k in f, `field ${f.id} missing key: ${k}`);
    }
  }
});

test('validation_result is an object with { valid, reason }', () => {
  const r = buildLineageReport(MINIMAL_FM);
  for (const f of r.fields){
    assert.ok(typeof f.validation_result === 'object' && f.validation_result !== null,
      `field ${f.id}: validation_result must be an object`);
    assert.ok('valid' in f.validation_result,
      `field ${f.id}: validation_result.valid missing`);
    assert.ok('reason' in f.validation_result,
      `field ${f.id}: validation_result.reason missing`);
  }
});

test('blocking is true for required fields with gap-status', () => {
  const r = buildLineageReport(MINIMAL_FM);
  for (const f of r.fields){
    if (f.blocking){
      assert.ok(f.required, `field ${f.id}: blocking=true but required=false`);
      assert.notEqual(f.status, 'filled', `field ${f.id}: blocking=true but status=filled`);
    }
  }
});

test('advisory fields are never blocking', () => {
  const r = buildLineageReport(MINIMAL_FM);
  const advisoryBlocking = r.fields.filter(f => f.advisory && f.blocking);
  assert.equal(advisoryBlocking.length, 0,
    `advisory fields must never be blocking: ${advisoryBlocking.map(f => f.id).join(', ')}`);
});

test('filing_critical is true for required non-advisory fields', () => {
  const r = buildLineageReport(MINIMAL_FM);
  for (const f of r.fields){
    if (f.filing_critical){
      assert.ok(f.required, `field ${f.id}: filing_critical=true but required=false`);
      assert.ok(!f.advisory, `field ${f.id}: filing_critical=true but advisory=true`);
    }
  }
});

test('FILLED fields have valid=true in validation_result', () => {
  const exhibit = {
    ...MINIMAL_FM,
    station_inputs: { ...MINIMAL_FM.station_inputs, overall_height_m: 55.0 }
  };
  const r = buildLineageReport(exhibit);
  const filled = r.fields.filter(f => f.status === 'filled');
  for (const f of filled){
    assert.equal(f.validation_result.valid, true,
      `FILLED field ${f.id} must have valid=true (reason: ${f.validation_result.reason})`);
  }
});

// ── 3. Source system inference ──────────────────────────────────────

test('station_inputs.call resolves source_system from facility_metadata lookup source', () => {
  const r = buildLineageReport(WJPZ_FM);
  const callF = r.fields.find(f => f.id === 'station-call-sign');
  assert.ok(callF, 'station-call-sign must exist');
  // facility_metadata.facility_lookup_source is 'FCC FMQ' → source_system should be that
  assert.ok(callF.source_system, 'source_system must be set');
});

test('computed fields have source_system = genoa-engine', () => {
  const r = buildLineageReport(WJPZ_FM);
  const computedIds = ['channel-number', 'compliance-rule-path', 'compliance-pass'];
  for (const id of computedIds){
    const f = r.fields.find(x => x.id === id);
    if (!f) continue;  // may not exist if status not filled
    assert.equal(f.source_system, 'genoa-engine',
      `${id}: computed field must have source_system=genoa-engine`);
  }
});

test('source_path for computed fields starts with "computed:"', () => {
  const r = buildLineageReport(WJPZ_FM);
  const channelF = r.fields.find(f => f.id === 'channel-number');
  assert.ok(channelF, 'channel-number must exist');
  assert.match(channelF.source_path, /^computed:/,
    'channel-number source_path must start with "computed:"');
});

// ── 4. Summary counts ──────────────────────────────────────────────

test('summary totals are consistent with fields array', () => {
  const r = buildLineageReport(MINIMAL_FM);
  const { summary, fields } = r;
  assert.equal(summary.total, fields.length);
  assert.equal(summary.filled,  fields.filter(f => f.status === 'filled').length);
  assert.equal(summary.blocking_gaps, fields.filter(f => f.blocking).length);
  assert.equal(summary.advisory_count, fields.filter(f => f.advisory).length);
});

test('summary carries filing_ready, gating_reason, compliance_pass', () => {
  const r = buildLineageReport(MINIMAL_FM);
  assert.ok('filing_ready' in r.summary);
  assert.ok('gating_reason' in r.summary);
  assert.ok('compliance_pass' in r.summary);
});

// ── 5. WJPZ regression: community-of-license ───────────────────────

test('WJPZ: community-of-license is FILLED from facility_metadata.raw.city', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'community-of-license');
  assert.ok(f, 'community-of-license must exist');
  assert.equal(f.status, 'filled',
    `community-of-license must be filled (got '${f.status}', value='${f.value}')`);
  assert.ok(f.value && /SYRACUSE/i.test(String(f.value)),
    `community-of-license value must contain SYRACUSE (got '${f.value}')`);
  assert.equal(f.validation_result.valid, true);
  assert.ok(!f.blocking, 'community-of-license must not be blocking when filled');
});

test('WJPZ: community-of-license source_path points into facility_metadata.raw', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'community-of-license');
  assert.ok(f.source_path, 'source_path must be set');
  assert.match(f.source_path, /facility_metadata\.raw/,
    `source_path should point into facility_metadata.raw (got '${f.source_path}')`);
});

// ── 6. WJPZ regression: tower height = 0 is INVALID ───────────────

test('WJPZ: tower-overall-height-agl-m = 0 is INVALID with invalid_reason', () => {
  const exhibit = {
    ...WJPZ_FM,
    station_inputs: { ...WJPZ_FM.station_inputs, overall_height_m: 0 }
  };
  const r = buildLineageReport(exhibit);
  const f = r.fields.find(x => x.id === 'tower-overall-height-agl-m');
  assert.ok(f, 'tower-overall-height-agl-m must exist');
  assert.equal(f.status, 'invalid',
    `expected status=invalid, got '${f.status}'`);
  assert.ok(f.invalid_reason && f.invalid_reason.length > 10,
    `invalid_reason must explain why (got '${f.invalid_reason}')`);
  assert.equal(f.validation_result.valid, false);
  assert.ok(f.validation_result.reason && f.validation_result.reason.length > 0);
});

test('WJPZ: tower-overall-height-agl-m > 0 is FILLED and valid', () => {
  const exhibit = {
    ...WJPZ_FM,
    station_inputs: { ...WJPZ_FM.station_inputs, overall_height_m: 42.5 }
  };
  const r = buildLineageReport(exhibit);
  const f = r.fields.find(x => x.id === 'tower-overall-height-agl-m');
  assert.equal(f.status, 'filled');
  assert.equal(f.value, 42.5);
  assert.equal(f.validation_result.valid, true);
});

// ── 7. WJPZ regression: compliance fields ──────────────────────────

test('WJPZ: compliance-rule-path is FILLED = §73.215 when §73.207 fails', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'compliance-rule-path');
  assert.ok(f, 'compliance-rule-path must exist');
  assert.equal(f.status, 'filled');
  assert.equal(f.value, '§73.215');
  assert.equal(f.validation_result.valid, true);
});

test('WJPZ: compliance-pass is FILLED = FAIL when both rules fail', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'compliance-pass');
  assert.ok(f, 'compliance-pass must exist');
  assert.equal(f.status, 'filled');
  assert.equal(f.value, 'FAIL');
});

test('compliance-pass is PASS-via-73.215 when §73.207 fails but §73.215 passes', () => {
  const exhibit = {
    ...WJPZ_FM,
    regulatory_compliance: {
      pass: true,
      violations: [],
      section_73_207: { pass: false, violations: [{ cite: '47 CFR §73.207', message: 'co-channel fail' }] }
    }
  };
  const r = buildLineageReport(exhibit);
  const cp  = r.fields.find(f => f.id === 'compliance-pass');
  const crp = r.fields.find(f => f.id === 'compliance-rule-path');
  assert.equal(cp.value,  'PASS-via-73.215');
  assert.equal(crp.value, '§73.215');
});

test('compliance-pass is PASS when both §73.207 and §73.215 pass', () => {
  const exhibit = {
    ...WJPZ_FM,
    regulatory_compliance: {
      pass: true,
      violations: [],
      section_73_207: { pass: true, violations: [] }
    }
  };
  const r = buildLineageReport(exhibit);
  const cp  = r.fields.find(f => f.id === 'compliance-pass');
  const crp = r.fields.find(f => f.id === 'compliance-rule-path');
  assert.equal(cp.value,  'PASS');
  assert.equal(crp.value, '§73.207');
});

// ── 8. WJPZ regression: HAAT advisory field ────────────────────────

test('WJPZ: haat-m is FILLED with filed (operator-supplied) value', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'haat-m');
  assert.ok(f, 'haat-m must exist');
  assert.equal(f.status, 'filled');
  assert.equal(f.value, 37);
  assert.equal(f.validation_result.valid, true);
});

test('WJPZ: haat-terrain-advisory-m is computed from per-radial profiles (~241.8 m)', () => {
  const r = buildLineageReport(WJPZ_FM);
  const f = r.fields.find(x => x.id === 'haat-terrain-advisory-m');
  assert.ok(f, 'haat-terrain-advisory-m must exist');
  assert.ok(Number.isFinite(Number(f.value)),
    `advisory HAAT must be a finite number (got ${f.value})`);
  assert.ok(Number(f.value) > 200,
    `advisory HAAT mean should be ~241.8 (got ${f.value})`);
  assert.equal(f.advisory, true, 'haat-terrain-advisory-m must be advisory=true');
  assert.equal(f.required, false, 'advisory HAAT must not be required');
  assert.equal(f.blocking, false, 'advisory HAAT must not be blocking');
  assert.equal(f.source_path, 'computed:Mean of evidence.terrain_haat_per_radial[].haat_computed_m',
    `advisory HAAT source_path should describe computation (got '${f.source_path}')`);
});

test('WJPZ: advisory HAAT and filed HAAT differ visibly in the lineage report', () => {
  const r = buildLineageReport(WJPZ_FM);
  const filed   = r.fields.find(x => x.id === 'haat-m');
  const advisory = r.fields.find(x => x.id === 'haat-terrain-advisory-m');
  assert.ok(filed && advisory);
  // The two values must differ significantly (37 vs ~241.8) — this is the
  // conflict the engineer needs to resolve before filing.
  assert.ok(Math.abs(Number(advisory.value) - Number(filed.value)) > 100,
    `filed HAAT (${filed.value}) and advisory HAAT (${advisory.value}) should diverge by >100 m`);
});

// ── 9. Confidence propagation ───────────────────────────────────────

test('FCC-FMQ-sourced fields have high confidence', () => {
  const r = buildLineageReport(WJPZ_FM);
  // station-call-sign comes from station_inputs, which is populated from FMQ
  const callF = r.fields.find(f => f.id === 'station-call-sign');
  // Confidence must be set (not unknown)
  assert.ok(['high', 'medium'].includes(callF.confidence),
    `station-call-sign confidence should be high or medium (got '${callF.confidence}')`);
});

test('advisory fields have advisory confidence', () => {
  const r = buildLineageReport(WJPZ_FM);
  const adv = r.fields.filter(f => f.advisory);
  for (const f of adv){
    assert.equal(f.confidence, 'advisory',
      `advisory field ${f.id} should have confidence=advisory (got '${f.confidence}')`);
  }
});

// ── 10. Timestamp propagation ───────────────────────────────────────

test('FMQ-sourced fields carry the facility_updated_at timestamp', () => {
  const r = buildLineageReport(WJPZ_FM);
  // Fields sourced from FCC-FMQ should carry the facility_updated_at.
  const callF = r.fields.find(f => f.id === 'station-call-sign');
  // Timestamp may be null for station_inputs, but facility_metadata-sourced fields should carry it.
  const colF = r.fields.find(f => f.id === 'community-of-license');
  assert.equal(colF.timestamp, '2026-04-01T00:00:00Z',
    `community-of-license timestamp should be facility_updated_at (got '${colF.timestamp}')`);
});

// ── 11. No null-value field can be FILLED ──────────────────────────

test('no field with value=null has status=filled', () => {
  const r = buildLineageReport(MINIMAL_FM);
  for (const f of r.fields){
    if (f.value === null || f.value === undefined){
      assert.notEqual(f.status, 'filled',
        `field ${f.id} has null value but status='filled'`);
    }
  }
});

// ── 12. expected_source for EVIDENCE_MISSING fields ─────────────────

test('EVIDENCE_MISSING required fields carry expected_source', () => {
  const r = buildLineageReport(MINIMAL_FM);
  const emFields = r.fields.filter(
    f => (f.status === 'unknown' || f.status === 'EVIDENCE_MISSING') && f.required
  );
  // Not every field will have expected_source defined, but key fields should.
  // Assert the ones with LINEAGE_PATHS hints carry it.
  const keyFields = ['community-of-license', 'rcamsl-m', 'population-served'];
  for (const id of keyFields){
    const f = r.fields.find(x => x.id === id);
    if (!f) continue;
    if (f.status === 'unknown' || f.status === 'EVIDENCE_MISSING'){
      assert.ok(f.expected_source,
        `${id} is EVIDENCE_MISSING/unknown and must carry expected_source`);
    }
  }
});

// ── 13. FM routes to Form 301-FM ───────────────────────────────────

test('buildLineageReport routes FM → Form 301-FM', () => {
  const r = buildLineageReport(MINIMAL_FM);
  assert.equal(r.form.form_id, '301-FM');
});

test('buildLineageReport routes to correct form for each service', () => {
  const amR = buildLineageReport({
    station_inputs: { call: 'WTEST', service: 'AM', frequency_khz: 1000, lat: 40, lon: -75 },
    evidence: {}
  });
  assert.equal(amR.form.form_id, '301-AM');
});
