// Per-service filing-package mappers — contract tests.
//
// Asserts:
//   1. mapping.js routes the right form_meta for each service:
//        AM   → Form 301-AM  (form_id '301-AM')
//        FM   → Form 301-FM  (form_id '301-FM')   (legacy)
//        FX   → Form 349     (form_id '349')
//        LPFM → Form 318     (form_id '318')
//   2. AM filings carry the AM-specific schema language:
//        - Class A/B/C/D enum (NOT FM A/B1/B/C0/C1/C2/C3)
//        - "power" language (NOT "ERP")
//        - §73.183/.184/.182/.187/.190/.99 citations present
//        - NO HAAT field
//   3. FM filings still produce the prior field shape (no regression).
//   4. Every field carries { source, status, value, provenance,
//      engineer_confirmation_required? }.
//   5. _readiness.gateFilingReady gates correctly and advisory
//      evidence (am_physics, geo_rf_evidence) is NEVER a filing gap.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilingPackage } from '../exports/lmsFiling/packager.js';
import { mapForm301Fm, selectSchemaForService } from '../exports/lmsFiling/mapping.js';
import { gateFilingReady, FieldStatus, ADVISORY_EVIDENCE_KEYS } from '../exports/lmsFiling/_readiness.js';
import { FORM_301_AM_FIELDS, FORM_301_AM_META } from '../exports/lmsFiling/form301am.js';
import { FORM_349_META } from '../exports/lmsFiling/form349.js';
import { FORM_318_META } from '../exports/lmsFiling/form318.js';

// ── Fixtures ───────────────────────────────────────────────────────

const KAZM_AM = {
  station_inputs: {
    call: 'KAZM',
    facility_id: '35149',
    service: 'AM',
    fcc_class: 'C',
    frequency_khz: 780,
    power_day_kw: 1.0,
    power_night_kw: 0.052,
    community: 'Sedona',
    lat: 34.86833,
    lon: -111.79111,
    tower_count: 1,
    rms_field_mv_m: 309,
    m3_conductivity_zone: '4 mS/m'
  },
  evidence: {}
};

const WFAN_AM = {
  station_inputs: {
    call: 'WFAN',
    facility_id: '28617',
    service: 'AM',
    fcc_class: 'A',
    frequency_khz: 660,
    power_day_kw: 50,
    power_night_kw: 50,
    community: 'New York',
    lat: 40.859833,
    lon: -73.785417,
    tower_count: 6,
    m3_conductivity_zone: '15 mS/m (coastal)'
  },
  evidence: {}
};

const WPLJ_FM = {
  station_inputs: {
    call: 'WPLJ',
    facility_id: '36479',
    service: 'FM',
    fcc_class: 'B',
    frequency: 95.5,
    erp_kw: 6.0,
    haat_m_input: 410,
    community: 'New York',
    lat: 40.7488,
    lon: -73.9858
  },
  evidence: {}
};

// ── 1. Service routing → correct form_meta ────────────────────────

test('mapping routes AM → Form 301-AM', () => {
  const r = selectSchemaForService('AM');
  assert.equal(r.key, 'AM');
  assert.equal(r.meta.form_id, '301-AM');
});

test('mapping routes FM → Form 301-FM (legacy preserved)', () => {
  const r = selectSchemaForService('FM');
  assert.equal(r.key, 'FM');
  assert.equal(r.meta.form_id, '301-FM');
});

test('mapping routes FX → Form 349', () => {
  const r = selectSchemaForService('FX');
  assert.equal(r.key, 'FX');
  assert.equal(r.meta.form_id, '349');
});

test('mapping routes LPFM → Form 318', () => {
  const r = selectSchemaForService('LPFM');
  assert.equal(r.key, 'LPFM');
  assert.equal(r.meta.form_id, '318');
});

test('mapping defaults to FM when service is unknown / blank', () => {
  assert.equal(selectSchemaForService(null).meta.form_id, '301-FM');
  assert.equal(selectSchemaForService('').meta.form_id, '301-FM');
});

// ── 2. AM-specific schema language ────────────────────────────────

test('Form 301-AM has Class A/B/C/D enum (not FM classes)', () => {
  const cls = FORM_301_AM_FIELDS.find(f => f.id === 'am-class');
  assert.ok(cls, 'am-class field must exist');
  assert.deepEqual([...cls.options].sort(), ['A','B','C','D']);
});

test('Form 301-AM uses "power" language, NOT "ERP"', () => {
  const labels = FORM_301_AM_FIELDS.map(f => f.lms_label).join(' || ');
  assert.match(labels, /Authorized antenna input power/i);
  // 'ERP' must NOT appear anywhere in an AM-form lms_label.
  for (const f of FORM_301_AM_FIELDS){
    assert.ok(!/\bERP\b/.test(f.lms_label),
      `AM field ${f.id} must not contain "ERP" in its label: ${f.lms_label}`);
  }
});

test('Form 301-AM has no HAAT field', () => {
  for (const f of FORM_301_AM_FIELDS){
    assert.ok(!/HAAT/i.test(f.id) && !/HAAT/.test(f.lms_label),
      `AM field ${f.id} unexpectedly mentions HAAT: ${f.lms_label}`);
  }
});

test('Form 301-AM cites the AM §73.x sections', () => {
  const cites = FORM_301_AM_FIELDS.map(f => f.cite || '').join(' || ');
  for (const expected of ['73.183', '73.184', '73.182', '73.187', '73.190', '73.99']){
    assert.match(cites, new RegExp(`§${expected.replace('.', '\\.')}`),
      `AM schema must cite §${expected}`);
  }
});

test('Form 301-AM cites groundwave concepts (NOT FM contour concepts)', () => {
  const allText = FORM_301_AM_FIELDS
    .map(f => `${f.lms_label} ${f.notes || ''}`)
    .join(' || ');
  assert.match(allText, /groundwave/i);
  // The FM-specific "service / protected / interfering" trio of
  // contour names must not appear in the AM AM-form schema labels.
  const fmContourLabels = FORM_301_AM_FIELDS.filter(f =>
    /60\s*dBu|40\s*dBu|F\(50,10\)/i.test(f.lms_label));
  assert.equal(fmContourLabels.length, 0,
    'AM form must not carry FM dBu / F(50,10) contour labels');
});

// ── 3. KAZM AM filing-package end-to-end ──────────────────────────

test('KAZM AM filing package routes to Form 301-AM', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  assert.equal(j.form.form_id, '301-AM');
  assert.match(j.schema, /form_301_am/);
  assert.match(pkg.filename_stem, /form301am-filing-package$/);
  // Filing cheatsheet must not contain FM contour vocabulary.
  assert.ok(!/60\s*dBu/.test(pkg.plain_text), 'AM cheatsheet must not mention 60 dBu');
  assert.ok(!/F\(50,10\)/.test(pkg.plain_text), 'AM cheatsheet must not mention F(50,10)');
});

test('KAZM AM filing package fills key AM-specific fields', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  const byId = Object.fromEntries(j.fields.map(f => [f.id, f]));
  assert.equal(byId['am-class'].status, 'filled');
  assert.equal(byId['am-class'].value, 'C');
  assert.equal(byId['frequency-khz'].status, 'filled');
  assert.equal(byId['frequency-khz'].value, 780);
  assert.equal(byId['power-day-kw'].status, 'filled');
  assert.equal(byId['power-day-kw'].value, 1.0);
  assert.equal(byId['rms-groundwave-field-1km'].status, 'filled');
  assert.equal(byId['rms-groundwave-field-1km'].value, 309);
});

test('WFAN AM (Class A) gets the Class A primary service contour (0.1 mV/m)', () => {
  const pkg = buildFilingPackage(WFAN_AM);
  const j = JSON.parse(pkg.json);
  const psc = j.fields.find(f => f.id === 'primary-service-contour-mv-m');
  assert.equal(psc.value, 0.1);
  const ssc = j.fields.find(f => f.id === 'secondary-service-contour-mv-m');
  // Class A → secondary service contour is defined (0.5 mV/m skywave)
  assert.equal(ssc.value, 0.5);
});

test('KAZM AM (Class C) does NOT carry a secondary service contour', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  const ssc = j.fields.find(f => f.id === 'secondary-service-contour-mv-m');
  assert.equal(ssc.value, null);  // §73.182(c) Class A only
});

// ── 4. FM still works (no regression) ─────────────────────────────

test('WPLJ FM filing package still routes to Form 301-FM', () => {
  const pkg = buildFilingPackage(WPLJ_FM);
  const j = JSON.parse(pkg.json);
  assert.equal(j.form.form_id, '301-FM');
  assert.match(pkg.filename_stem, /form301fm-filing-package$/);
  // FM should still carry its HAAT field.
  const haat = j.fields.find(f => f.id === 'haat-m');
  assert.ok(haat, 'FM form must still have haat-m');
  assert.equal(haat.value, 410);
  // Class field uses FM enum (look it up in mapped output's form schema).
  const m = mapForm301Fm(WPLJ_FM);
  const clsSchema = m.fields.find(f => f.id === 'fcc-class');
  assert.ok(clsSchema && Array.isArray(clsSchema.options));
  assert.ok(clsSchema.options.includes('B1'), 'FM class enum must still include B1');
});

// ── 5. Per-field shape ────────────────────────────────────────────

test('every AM field carries source/status/value/provenance keys', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  for (const f of j.fields){
    assert.ok('source' in f, `field ${f.id} missing source`);
    assert.ok('status' in f, `field ${f.id} missing status`);
    assert.ok('value' in f, `field ${f.id} missing value`);
    assert.ok('provenance' in f, `field ${f.id} missing provenance`);
    // engineer_confirmation_required must at least be defined
    assert.ok('engineer_confirmation_required' in f,
      `field ${f.id} missing engineer_confirmation_required`);
  }
});

test('manual-engineer fields flag engineer_confirmation_required', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  const ground = j.fields.find(f => f.id === 'ground-system-radials');
  // manual-engineer + no operator input + required → must flag confirmation
  assert.equal(ground.source, 'manual-engineer');
  assert.equal(ground.engineer_confirmation_required, true);
});

// ── 6. Readiness gating ───────────────────────────────────────────

test('gateFilingReady returns ready when no gaps / blockers', () => {
  const r = gateFilingReady({
    fields: [
      { required: true, status: FieldStatus.FILLED },
      { required: true, status: FieldStatus.NOT_APPLICABLE }
    ],
    blockers: 0
  });
  assert.equal(r.ready, true);
  assert.equal(r.gating_reason, null);
});

test('gateFilingReady blocks on NEEDS_INPUT required field', () => {
  const r = gateFilingReady({
    fields: [
      { required: true, status: FieldStatus.FILLED },
      { required: true, status: FieldStatus.NEEDS_INPUT }
    ],
    blockers: 0
  });
  assert.equal(r.ready, false);
  assert.match(r.gating_reason, /not filled/);
});

test('gateFilingReady blocks on engine blockers', () => {
  const r = gateFilingReady({ fields: [], blockers: 2 });
  assert.equal(r.ready, false);
  assert.match(r.gating_reason, /blocker/);
});

test('gateFilingReady blocks AM night NIF when azimuths fail', () => {
  const r = gateFilingReady({
    fields: [],
    blockers: 0,
    am_night_nif: { available: true, summary: { n_failing_azimuths: 3 } }
  });
  assert.equal(r.ready, false);
  assert.match(r.gating_reason, /NIF/);
});

test('gateFilingReady allows AM night NIF when all azimuths pass', () => {
  const r = gateFilingReady({
    fields: [],
    blockers: 0,
    am_night_nif: { available: true, summary: { n_failing_azimuths: 0, worst_margin_db: 4.2 } }
  });
  assert.equal(r.ready, true);
});

// ── 7. Advisory evidence is NEVER a filing gap (anti-regression) ──

test('ADVISORY_EVIDENCE_KEYS list includes am_physics, geo_rf_evidence, sdr_captures', () => {
  assert.ok(ADVISORY_EVIDENCE_KEYS.includes('am_physics'));
  assert.ok(ADVISORY_EVIDENCE_KEYS.includes('geo_rf_evidence'));
  assert.ok(ADVISORY_EVIDENCE_KEYS.includes('sdr_captures'));
});

test('adding am_physics advisory evidence does NOT change filing_ready', () => {
  const without = buildFilingPackage(KAZM_AM);
  const withAp = buildFilingPackage({
    ...KAZM_AM,
    evidence: {
      ...KAZM_AM.evidence,
      am_physics: {
        status: 'run',
        advisory: true,
        filing_effect: 'none',
        outputs: { grid_sha256: 'abc123' },
        fetched_at: '2026-05-16T00:00:00Z'
      }
    }
  });
  assert.equal(without.filing_ready, withAp.filing_ready);
  assert.equal(without.blockers_count, withAp.blockers_count);
});

test('adding geo_rf_evidence does NOT add or remove LMS fields on an AM exhibit', () => {
  const without = JSON.parse(buildFilingPackage(KAZM_AM).json);
  const withGeo = JSON.parse(buildFilingPackage({
    ...KAZM_AM,
    evidence: {
      ...KAZM_AM.evidence,
      geo_rf_evidence: {
        status: 'run',
        advisory: true,
        filing_effect: 'none',
        datasets: { tree_canopy_conus: { value_numeric: 12, dataset: 'tcc-2022' } }
      }
    }
  }).json);
  const fp = (j) => j.fields.map(f => `${f.id}::${f.status}`);
  assert.deepEqual(fp(without), fp(withGeo),
    'advisory geo_rf_evidence must not alter LMS field statuses');
});

// ── 8. Form 301-AM META meets the schema-version contract ────────

test('Form 301-AM META declares its LMS revision', () => {
  assert.ok(FORM_301_AM_META.lms_revision);
  assert.match(FORM_301_AM_META.form_title, /AM/);
});

test('Form 349 META is FM-translator-shaped', () => {
  assert.equal(FORM_349_META.form_id, '349');
  assert.match(FORM_349_META.form_title, /FM Translator|FM Booster/);
});

test('Form 318 META is LPFM-shaped', () => {
  assert.equal(FORM_318_META.form_id, '318');
  assert.match(FORM_318_META.form_title, /Low Power FM/);
});

// ── 9. mapForm301Fm back-compat alias still routes by service ────

test('mapForm301Fm alias routes AM exhibit to Form 301-AM (not FM)', () => {
  const m = mapForm301Fm(KAZM_AM);
  assert.equal(m.form.form_id, '301-AM');
});

// ── 10. Submission scaffolding: every form has LMS portal + checklist ──
//
// The cheatsheet's whole purpose is to get an engineer to "submission
// ready".  Each form META must therefore carry:
//   - lms_portal_url    (the actual FCC LMS portal entry)
//   - lms_schedule      (Schedule 301-FM / Schedule 349 / etc.)
//   - lms_filing_path   (one-line breadcrumb of clicks inside LMS)
//   - submission_checklist (array of pre-flight items the engineer
//                           verifies before upload)
// Missing any of these means the cheatsheet won't tell the engineer
// where to file or what to attach — which defeats the point.

import { FORM_301_FM_META } from '../exports/lmsFiling/form301fm.js';
const ALL_FORM_METAS = [
  ['301-FM', FORM_301_FM_META],
  ['301-AM', FORM_301_AM_META],
  ['349',    FORM_349_META],
  ['318',    FORM_318_META]
];

for (const [label, meta] of ALL_FORM_METAS){
  test(`${label} META carries LMS portal URL + schedule + filing path`, () => {
    assert.match(meta.lms_portal_url, /^https:\/\/enterpriseefiling\.fcc\.gov/,
      `${label}.lms_portal_url must point at the FCC LMS entry`);
    assert.match(meta.lms_schedule, /Schedule/, `${label}.lms_schedule should reference its LMS Schedule`);
    assert.ok(meta.lms_filing_path && meta.lms_filing_path.length > 40,
      `${label}.lms_filing_path must be a usable breadcrumb`);
  });
  test(`${label} META carries a non-trivial submission checklist`, () => {
    assert.ok(Array.isArray(meta.submission_checklist), `${label}.submission_checklist must be an array`);
    assert.ok(meta.submission_checklist.length >= 5,
      `${label} checklist has ${meta.submission_checklist.length} items — too thin to be useful pre-flight`);
    for (const item of meta.submission_checklist){
      assert.equal(typeof item, 'string');
      assert.ok(item.length > 20, `checklist item too terse: "${item}"`);
    }
  });
}

test('cheatsheet HTML embeds the portal URL + schedule + checklist for FM CP', () => {
  const pkg = buildFilingPackage({
    station_inputs: { call: 'WTST', service: 'FM', frequency: 100.7, lat: 40, lon: -75,
                      erp_kw: 6, haat_m: 100, fcc_class: 'A' },
    evidence: {}
  });
  assert.match(pkg.html, /enterpriseefiling\.fcc\.gov/, 'HTML must surface the LMS portal URL');
  assert.match(pkg.html, /Schedule 301-FM/, 'HTML must surface the LMS schedule name');
  assert.match(pkg.html, /Pre-flight checklist/i, 'HTML must include the pre-flight checklist section');
  assert.match(pkg.html, /Engineering Statement PDF/, 'HTML must list the PDF as a required attachment');
  // Header used to be hardcoded "Form 301-FM" — verify the form_id is now templated.
  assert.match(pkg.html, /FCC Form 301-FM/);
});

test('cheatsheet HTML retitles correctly for an AM filing (no "Form 301-FM" hardcode)', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  assert.match(pkg.html, /FCC Form 301-AM/, 'AM filing must render as Form 301-AM, not Form 301-FM');
  assert.doesNotMatch(pkg.html, /<h1>[^<]*Form 301-FM[^<]*<\/h1>/, 'AM filing must not render an FM h1');
  assert.match(pkg.html, /Schedule 301-AM/);
});

test('cheatsheet plain-text retitles correctly for FM translator (Form 349)', () => {
  const pkg = buildFilingPackage({
    station_inputs: { call: 'W123XY', service: 'FX', frequency: 92.1, lat: 40, lon: -75,
                      erp_kw: 0.250, haat_m: 30 },
    evidence: {}
  });
  assert.match(pkg.plain_text, /FCC FORM 349/, 'translator filing must render as Form 349');
  assert.match(pkg.plain_text, /SUBMISSION PORTAL/);
  assert.match(pkg.plain_text, /PRE-FLIGHT CHECKLIST/);
});

// ── 11. WJPZ-FM filing-field lineage regression suite ────────────
//
// Fixture: WJPZ-FM at 107.9 MHz, Class A, Syracuse NY.
//   • Community stored only in facility_metadata.raw.city (FCC FMQ shape).
//   • Tower height AGL is erroneously 0 in the source data.
//   • regulatory_compliance shows §73.215 failures against WDWN/WIII.
//   • Filed HAAT 37 m differs significantly from terrain-derived 241.8 m.
//
// Each test asserts a specific failure mode that occurred on the
// WJPZ-FM run and MUST NEVER recur.

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
    // community intentionally NOT set here — must come from facility_metadata.raw.city
  },
  facility_metadata: {
    cached:                 true,
    facility_lookup_source: 'FCC FMQ',
    raw: {
      call:    'WJPZ',
      city:    'SYRACUSE',   // FCC FMQ shape stores community as `city` in raw record
      state:   'NY',
      haat_m:  37,
      erp_kw:  6.0
    }
  },
  // station_inputs.overall_height_m = 0 simulates the observed bug.
  // tower_compliance and evidence.asr are both absent, so
  // firstNonEmptyPath resolves station_inputs.overall_height_m = 0.
  // The validator MUST reject 0 and mark the field INVALID.
  regulatory_compliance: {
    pass:     false,   // §73.215 FAILS against WDWN and WIII
    violations: [
      { cite: '47 CFR §73.215', message: 'Contour overlap with WDWN (66249) at 3.2 km' },
      { cite: '47 CFR §73.215', message: 'Contour overlap with WIII (12312) at 4.7 km' }
    ],
    section_73_207: {
      pass:       false,
      violations: [
        { cite: '47 CFR §73.207', message: 'Co-channel separation: WDWN fails by 12 km' }
      ]
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

// 11a. Community of license must NOT be EVIDENCE_MISSING when
//      the value is present in facility_metadata.raw.city.
test('WJPZ: community-of-license is FILLED from facility_metadata.raw.city', () => {
  const pkg = buildFilingPackage(WJPZ_FM);
  const j   = JSON.parse(pkg.json);
  const col = j.fields.find(f => f.id === 'community-of-license');
  assert.ok(col, 'community-of-license field must exist');
  assert.equal(col.status, 'filled',
    `community-of-license must be filled (got '${col.status}' value='${col.value}')`);
  assert.ok(col.value && /SYRACUSE/i.test(String(col.value)),
    `community-of-license value must contain SYRACUSE (got '${col.value}')`);
});

// 11b. Tower height AGL = 0 must be INVALID, not FILLED.
//      A zero tower height is physically impossible for a licensed
//      broadcast facility and must never be auto-certified.
test('WJPZ: tower-overall-height-agl-m = 0 is INVALID, not FILLED', () => {
  const exhibit = {
    ...WJPZ_FM,
    station_inputs: { ...WJPZ_FM.station_inputs, overall_height_m: 0 }
  };
  const pkg = buildFilingPackage(exhibit);
  const j   = JSON.parse(pkg.json);
  const f   = j.fields.find(x => x.id === 'tower-overall-height-agl-m');
  assert.ok(f, 'tower-overall-height-agl-m must exist');
  assert.notEqual(f.status, 'filled',
    'tower height 0 must NOT be FILLED — zero is not a valid AGL height');
  assert.equal(f.status, 'invalid',
    `expected INVALID, got '${f.status}'`);
  // The invalid reason must surface in provenance.
  assert.ok(f.provenance?.note && f.provenance.note.length > 10,
    'provenance.note must explain why the value is INVALID');
});

// Complementary: a positive tower height IS FILLED.
test('WJPZ: tower-overall-height-agl-m > 0 is FILLED', () => {
  const exhibit = {
    ...WJPZ_FM,
    station_inputs: { ...WJPZ_FM.station_inputs, overall_height_m: 42.5 }
  };
  const pkg = buildFilingPackage(exhibit);
  const j   = JSON.parse(pkg.json);
  const f   = j.fields.find(x => x.id === 'tower-overall-height-agl-m');
  assert.equal(f.status, 'filled');
  assert.equal(f.value, 42.5);
});

// 11c. Compliance basis must be derivable (not EVIDENCE_MISSING)
//      when regulatory_compliance carries violations.
test('WJPZ: compliance-rule-path is FILLED even when §73.215 fails', () => {
  const pkg = buildFilingPackage(WJPZ_FM);
  const j   = JSON.parse(pkg.json);
  const crp = j.fields.find(f => f.id === 'compliance-rule-path');
  assert.ok(crp, 'compliance-rule-path must exist');
  assert.equal(crp.status, 'filled',
    `compliance-rule-path must be filled when rc is present (got '${crp.status}')`);
  assert.equal(crp.value, '§73.215',
    `expected §73.215 (station fails §73.207, attempts §73.215); got '${crp.value}'`);
});

test('WJPZ: compliance-pass is FAIL when both §73.207 and §73.215 fail', () => {
  const pkg = buildFilingPackage(WJPZ_FM);
  const j   = JSON.parse(pkg.json);
  const cp  = j.fields.find(f => f.id === 'compliance-pass');
  assert.equal(cp.status, 'filled');
  assert.equal(cp.value, 'FAIL');
});

test('compliance-pass is PASS-via-73.215 when §73.207 fails but §73.215 passes', () => {
  const exhibit = {
    ...WJPZ_FM,
    regulatory_compliance: {
      pass:     true,   // §73.215 passes
      violations: [],
      section_73_207: { pass: false, violations: [{ cite: '47 CFR §73.207', message: 'co-channel fail' }] }
    }
  };
  const pkg = buildFilingPackage(exhibit);
  const j   = JSON.parse(pkg.json);
  const cp  = j.fields.find(f => f.id === 'compliance-pass');
  assert.equal(cp.value, 'PASS-via-73.215');
  // Rule path should be §73.215 when filing on that basis.
  const crp = j.fields.find(f => f.id === 'compliance-rule-path');
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
  const j = JSON.parse(buildFilingPackage(exhibit).json);
  const cp  = j.fields.find(f => f.id === 'compliance-pass');
  assert.equal(cp.value, 'PASS');
  // When §73.207 passes cleanly, use §73.207 as basis.
  const crp = j.fields.find(f => f.id === 'compliance-rule-path');
  assert.equal(crp.value, '§73.207');
});

// 11d. HAAT conflict — advisory terrain HAAT (241.8 m mean) vs
//      filed HAAT (37 m) must both appear, filed HAAT stays FILLED.
test('WJPZ: filed haat-m is FILLED with operator value', () => {
  const pkg = buildFilingPackage(WJPZ_FM);
  const j   = JSON.parse(pkg.json);
  const h   = j.fields.find(f => f.id === 'haat-m');
  assert.equal(h.status, 'filled');
  assert.equal(h.value, 37, 'filed HAAT must be the operator-supplied value');
});

test('WJPZ: terrain advisory HAAT is computed from per-radial profiles', () => {
  const pkg = buildFilingPackage(WJPZ_FM);
  const j   = JSON.parse(pkg.json);
  const adv = j.fields.find(f => f.id === 'haat-terrain-advisory-m');
  assert.ok(adv, 'haat-terrain-advisory-m field must exist');
  // Mean of [220.3,241.5,260.1,255.8,230.4,248.2,241.6,236.7] ≈ 241.8
  assert.ok(Number.isFinite(Number(adv.value)),
    'advisory HAAT must be a finite number');
  assert.ok(Number(adv.value) > 200,
    `advisory HAAT should be ~241.8 (got ${adv.value})`);
});

test('WJPZ: advisory HAAT field is not required and does not block filing on that alone', () => {
  const pkg = buildFilingPackage(WJPZ_FM);
  const j   = JSON.parse(pkg.json);
  const adv = j.fields.find(f => f.id === 'haat-terrain-advisory-m');
  assert.equal(adv.required, false,
    'advisory HAAT must not be required — it must not gate filing');
});

// 11e. No required field with null/0/blank can be FILLED.
//      Inject pathological values and verify they never slip through.
test('no required FM field with value null can be FILLED', () => {
  // Run the mapper on a minimal exhibit — many fields will be null/unknown;
  // assert none of those nulls have status=filled.
  const pkg = buildFilingPackage({
    station_inputs: { call: 'WFOO', service: 'FM', frequency: 100.1, erp_kw: 1, lat: 40, lon: -75 },
    evidence: {}
  });
  const j = JSON.parse(pkg.json);
  for (const f of j.fields){
    if (f.value === null || f.value === undefined){
      assert.notEqual(f.status, 'filled',
        `field ${f.id} has null value but status='filled' — null cannot be FILLED`);
    }
  }
});

test('validateFilingField rejects zero for physical dimension', async () => {
  const { validateFilingField } = await import('../exports/lmsFiling/mapping.js');
  const err = validateFilingField({
    def: { id: 'tower-overall-height-agl-m', type: 'number', physical_dimension: true, lms_label: 'Overall tower height AGL (m)' },
    value: 0
  });
  assert.ok(err && err.length > 0, 'zero physical dimension must produce an error string');
});

test('validateFilingField accepts positive physical dimension', async () => {
  const { validateFilingField } = await import('../exports/lmsFiling/mapping.js');
  const err = validateFilingField({
    def: { id: 'tower-overall-height-agl-m', type: 'number', physical_dimension: true, lms_label: 'Overall tower height AGL (m)' },
    value: 48.8
  });
  assert.equal(err, null, 'positive height must not produce an error');
});

test('validateFilingField rejects null value', async () => {
  const { validateFilingField } = await import('../exports/lmsFiling/mapping.js');
  const err = validateFilingField({
    def: { id: 'haat-m', type: 'number', physical_dimension: true, lms_label: 'HAAT' },
    value: null
  });
  assert.ok(err && err.length > 0, 'null must produce an error string');
});
