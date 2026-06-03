// Trust Sprint #4 — DA pattern suppression verification tests
//
// Covers 6 new readiness codes:
//   DA_PATTERN_MISSING     BLOCKER — pattern_mode=DA but no pattern table anywhere
//   DA_PATTERN_INVALID     BLOCKER — pattern entries are non-numeric / out-of-range
//   DA_PATTERN_UNCONFIRMED WARNING — pattern data present but pattern_mode not declared
//   DA_PATTERN_INCOMPLETE  WARNING — fewer than 36 standard radials (§73.316)
//   DA_PATTERN_UNNORMALIZED WARNING — max relative_field < 0.95
//   DA_SUPPRESSION_UNVERIFIED WARNING — FM DA with no suppression calc in evidence

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessReport } from '../exports/readiness/index.js';
import { checkDaPatternReadiness } from '../exports/readiness/daPatternCheck.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

// 36-radial pattern (10° intervals per §73.316), normalized to 1.0 at 0°.
const GOOD_PATTERN = Array.from({ length: 36 }, (_, i) => ({
  azimuth: i * 10,
  relative_field: i === 0 ? 1.0 : Math.min(1.0, Math.max(0.1, 0.75 + 0.2 * Math.cos(i * Math.PI / 18))),
}));

// 4-point pattern (WKLX-style) — incomplete but parseable.
const SPARSE_PATTERN = [
  { azimuth: 0,   relative_field: 1.0 },
  { azimuth: 90,  relative_field: 0.8 },
  { azimuth: 180, relative_field: 0.9 },
  { azimuth: 270, relative_field: 0.7 },
];

function fmDaExhibit(overrides = {}) {
  return {
    station_inputs: {
      call: 'WTEST', service: 'FM', fcc_class: 'A',
      frequency: 107.9, erp_kw: 1.0, haat_m_input: 100,
      lat: 43.048, lon: -76.147,
      pattern_mode: 'DA',
      ...overrides.station_inputs,
    },
    evidence: { ...overrides.evidence },
    oet65:   overrides.oet65,
    regulatory_compliance: overrides.regulatory_compliance,
  };
}

// ── DA_PATTERN_MISSING (BLOCKER) ──────────────────────────────────────────────

test('DA_PATTERN_MISSING fires: pattern_mode=DA, no pattern anywhere', () => {
  const ex = fmDaExhibit();
  const r  = buildReadinessReport(ex);
  const b  = r.blockers.find(b => b.code === 'DA_PATTERN_MISSING');
  assert.ok(b, 'DA_PATTERN_MISSING blocker must fire when pattern_mode=DA and no pattern table');
  assert.match(b.rule, /§73\.316/);
  assert.ok(b.remedy && b.remedy.length > 10, 'blocker must include a remedy');
});

test('DA_PATTERN_MISSING makes determination NOT_READY', () => {
  const ex = fmDaExhibit();
  const r  = buildReadinessReport(ex);
  assert.equal(r.determination, 'NOT_READY');
});

test('DA_PATTERN_MISSING does NOT fire when pattern is in station_inputs.pattern', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern: GOOD_PATTERN } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'DA_PATTERN_MISSING'),
    'DA_PATTERN_MISSING must not fire when station_inputs.pattern is populated');
});

test('DA_PATTERN_MISSING does NOT fire when pattern is in evidence.nec_pattern_table', () => {
  const ex = fmDaExhibit({ evidence: { nec_pattern_table: GOOD_PATTERN } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'DA_PATTERN_MISSING'),
    'DA_PATTERN_MISSING must not fire when evidence.nec_pattern_table is populated');
});

test('DA_PATTERN_MISSING does NOT fire for pattern_mode=D (synonym)', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern_mode: 'D', pattern: GOOD_PATTERN } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'DA_PATTERN_MISSING'));
});

// ── DA_PATTERN_INVALID (BLOCKER) ──────────────────────────────────────────────

test('DA_PATTERN_INVALID fires: entry has NaN azimuth', () => {
  const badPattern = [
    { azimuth: 'north', relative_field: 1.0 }, // azimuth is not a number
    ...GOOD_PATTERN.slice(1),
  ];
  const ex = fmDaExhibit({ station_inputs: { pattern: badPattern } });
  const r  = buildReadinessReport(ex);
  assert.ok(r.blockers.find(b => b.code === 'DA_PATTERN_INVALID'),
    'DA_PATTERN_INVALID must fire for non-numeric azimuth');
});

test('DA_PATTERN_INVALID fires: entry has relative_field > 2.0', () => {
  const badPattern = [
    { azimuth: 0, relative_field: 5.0 }, // clearly wrong
    ...GOOD_PATTERN.slice(1),
  ];
  const ex = fmDaExhibit({ station_inputs: { pattern: badPattern } });
  const r  = buildReadinessReport(ex);
  assert.ok(r.blockers.find(b => b.code === 'DA_PATTERN_INVALID'),
    'DA_PATTERN_INVALID must fire for relative_field > 2.0');
});

test('DA_PATTERN_INVALID fires: entry has negative relative_field', () => {
  const badPattern = [
    { azimuth: 0, relative_field: -0.1 },
    ...GOOD_PATTERN.slice(1),
  ];
  const ex = fmDaExhibit({ station_inputs: { pattern: badPattern } });
  const r  = buildReadinessReport(ex);
  assert.ok(r.blockers.find(b => b.code === 'DA_PATTERN_INVALID'));
});

test('DA_PATTERN_INVALID fires: entry has azimuth >= 360', () => {
  const badPattern = [
    { azimuth: 360, relative_field: 1.0 }, // 360 is out of range (valid: 0-359)
    ...GOOD_PATTERN.slice(1),
  ];
  const ex = fmDaExhibit({ station_inputs: { pattern: badPattern } });
  const r  = buildReadinessReport(ex);
  assert.ok(r.blockers.find(b => b.code === 'DA_PATTERN_INVALID'));
});

test('DA_PATTERN_INVALID does NOT fire for valid pattern with relative_field 0.0–1.0', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern: GOOD_PATTERN } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'DA_PATTERN_INVALID'));
});

// ── DA_PATTERN_UNCONFIRMED (WARNING) ──────────────────────────────────────────

test('DA_PATTERN_UNCONFIRMED fires: pattern present but no pattern_mode set', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern_mode: undefined, pattern: GOOD_PATTERN } });
  // Remove pattern_mode entirely
  delete ex.station_inputs.pattern_mode;
  const r  = buildReadinessReport(ex);
  assert.ok(r.warnings.find(w => w.code === 'DA_PATTERN_UNCONFIRMED'),
    'DA_PATTERN_UNCONFIRMED must fire when pattern is present but pattern_mode is absent');
});

test('DA_PATTERN_UNCONFIRMED does NOT fire when pattern_mode=DA is set', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern: GOOD_PATTERN } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.warnings.find(w => w.code === 'DA_PATTERN_UNCONFIRMED'));
});

test('WKLX golden fixture: DA_PATTERN_UNCONFIRMED fires (no pattern_mode in fixture)', () => {
  // WKLX from goldenFixtures.test.js — 4-point pattern, no pattern_mode
  const WKLX = {
    station_inputs: {
      call: 'WKLX', service: 'FM', fcc_class: 'A', frequency: 91.7,
      erp_kw: 5.5, haat_m_input: 100, lat: 42.358, lon: -71.059,
      pattern: SPARSE_PATTERN
    },
    regulatory_compliance: {
      pass: true, violations: [],
      section_73_207: { pass: false, violations: [{ cite: '47 CFR §73.207', message: 'Co-channel: WBUR fails by 0.5 km' }] }
    },
    evidence: {}
  };
  const r = buildReadinessReport(WKLX);
  assert.ok(r.warnings.find(w => w.code === 'DA_PATTERN_UNCONFIRMED'), 'WKLX must get DA_PATTERN_UNCONFIRMED');
  assert.ok(r.warnings.find(w => w.code === 'DA_PATTERN_INCOMPLETE'),  'WKLX must get DA_PATTERN_INCOMPLETE (4 radials)');
  assert.ok(r.warnings.find(w => w.code === 'DA_SUPPRESSION_UNVERIFIED'), 'WKLX must get DA_SUPPRESSION_UNVERIFIED');
  assert.ok(r.readiness_score >= 0 && r.readiness_score <= 100, 'WKLX score must remain 0-100');
});

// ── DA_PATTERN_INCOMPLETE (WARNING) ───────────────────────────────────────────

test('DA_PATTERN_INCOMPLETE fires: fewer than 36 standard radials (§73.316)', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern: SPARSE_PATTERN } });
  const r  = buildReadinessReport(ex);
  const w  = r.warnings.find(w => w.code === 'DA_PATTERN_INCOMPLETE');
  assert.ok(w, 'DA_PATTERN_INCOMPLETE must fire for 4-radial pattern');
  assert.match(w.message, /4/, 'warning must state the actual radial count');
  assert.match(w.message, /36/, 'warning must state the §73.316 required radial count');
});

test('DA_PATTERN_INCOMPLETE does NOT fire for 36-radial pattern (§73.316 minimum)', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern: GOOD_PATTERN } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.warnings.find(w => w.code === 'DA_PATTERN_INCOMPLETE'));
});

test('DA_PATTERN_INCOMPLETE does NOT fire for pattern with > 36 radials', () => {
  // 72-radial pattern (5° increments — denser than required)
  const dense = Array.from({ length: 72 }, (_, i) => ({ azimuth: i * 5, relative_field: 0.5 + 0.5 * Math.cos(i * Math.PI / 36) }));
  dense[0].relative_field = 1.0;
  const ex = fmDaExhibit({ station_inputs: { pattern: dense } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.warnings.find(w => w.code === 'DA_PATTERN_INCOMPLETE'));
});

// ── DA_PATTERN_UNNORMALIZED (WARNING) ─────────────────────────────────────────

test('DA_PATTERN_UNNORMALIZED fires: max relative_field < 0.95', () => {
  const unnormalized = GOOD_PATTERN.map(e => ({ ...e, relative_field: e.relative_field * 0.7 }));
  const ex = fmDaExhibit({ station_inputs: { pattern: unnormalized } });
  const r  = buildReadinessReport(ex);
  assert.ok(r.warnings.find(w => w.code === 'DA_PATTERN_UNNORMALIZED'),
    'DA_PATTERN_UNNORMALIZED must fire when max relative_field < 0.95');
});

test('DA_PATTERN_UNNORMALIZED does NOT fire when max relative_field = 1.0', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern: GOOD_PATTERN } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.warnings.find(w => w.code === 'DA_PATTERN_UNNORMALIZED'));
});

test('DA_PATTERN_UNNORMALIZED does NOT fire at exactly 0.95 boundary', () => {
  const pattern = GOOD_PATTERN.map(e => ({ ...e, relative_field: e.relative_field * 0.95 }));
  pattern[0].relative_field = 0.95;
  const ex = fmDaExhibit({ station_inputs: { pattern } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.warnings.find(w => w.code === 'DA_PATTERN_UNNORMALIZED'));
});

// ── DA_SUPPRESSION_UNVERIFIED (WARNING) ───────────────────────────────────────

test('DA_SUPPRESSION_UNVERIFIED fires: FM DA with no suppression evidence', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern: GOOD_PATTERN } });
  const r  = buildReadinessReport(ex);
  assert.ok(r.warnings.find(w => w.code === 'DA_SUPPRESSION_UNVERIFIED'),
    'DA_SUPPRESSION_UNVERIFIED must fire for FM DA with no suppression evidence');
});

test('DA_SUPPRESSION_UNVERIFIED does NOT fire when evidence.suppression_db present', () => {
  const ex = fmDaExhibit({
    station_inputs: { pattern: GOOD_PATTERN },
    evidence: { suppression_db: 25.0 },
  });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.warnings.find(w => w.code === 'DA_SUPPRESSION_UNVERIFIED'));
});

test('DA_SUPPRESSION_UNVERIFIED does NOT fire when evidence.pattern_suppression present', () => {
  const ex = fmDaExhibit({
    station_inputs: { pattern: GOOD_PATTERN },
    evidence: { pattern_suppression: { achieved_db: 28 } },
  });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.warnings.find(w => w.code === 'DA_SUPPRESSION_UNVERIFIED'));
});

test('DA_SUPPRESSION_UNVERIFIED is never a blocker', () => {
  const ex = fmDaExhibit({ station_inputs: { pattern: GOOD_PATTERN } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'DA_SUPPRESSION_UNVERIFIED'));
});

// ── AM / LPFM / service guard ─────────────────────────────────────────────────

test('No DA checks fire for AM station (§73.316 is FM-band only)', () => {
  const ex = {
    station_inputs: {
      call: 'KTEST', service: 'AM', frequency_khz: 780, power_day_kw: 1.0,
      lat: 34.86, lon: -111.79, pattern_mode: 'DA',
      pattern: GOOD_PATTERN,
    },
    evidence: {},
  };
  const r = buildReadinessReport(ex);
  const daCodes = ['DA_PATTERN_MISSING', 'DA_PATTERN_INVALID', 'DA_PATTERN_UNCONFIRMED',
                   'DA_PATTERN_INCOMPLETE', 'DA_PATTERN_UNNORMALIZED', 'DA_SUPPRESSION_UNVERIFIED'];
  for (const code of daCodes) {
    assert.ok(!r.blockers.find(b => b.code === code), `${code} must not fire for AM`);
    assert.ok(!r.warnings.find(w => w.code === code), `${code} must not fire for AM`);
  }
});

test('No DA checks fire for omni FM station (no pattern data, no pattern_mode)', () => {
  const ex = {
    station_inputs: { call: 'WTEST', service: 'FM', fcc_class: 'A', frequency: 107.9, erp_kw: 1.0, lat: 43.0, lon: -76.0 },
    evidence: {},
  };
  const r = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code?.startsWith('DA_')));
  assert.ok(!r.warnings.find(w => w.code?.startsWith('DA_')));
});

test('No DA checks fire for NDA FM station (pattern_mode=NDA)', () => {
  const ex = {
    station_inputs: { call: 'WTEST', service: 'FM', frequency: 107.9, erp_kw: 1.0, lat: 43.0, lon: -76.0, pattern_mode: 'NDA' },
    evidence: {},
  };
  const r = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code?.startsWith('DA_')));
  assert.ok(!r.warnings.find(w => w.code?.startsWith('DA_')));
});

// ── Pattern format compatibility ──────────────────────────────────────────────

test('Array-format pattern [azimuth_deg, relative_field] is accepted', () => {
  const arrayPattern = GOOD_PATTERN.map(e => [e.azimuth, e.relative_field]);
  const ex = fmDaExhibit({ station_inputs: { pattern: arrayPattern } });
  const { blockers } = checkDaPatternReadiness(ex);
  assert.ok(!blockers.find(b => b.code === 'DA_PATTERN_INVALID'),
    'Array-format [azimuth, field] pattern must not produce DA_PATTERN_INVALID');
});

test('azimuth_deg key (vs azimuth) is accepted', () => {
  const altPattern = GOOD_PATTERN.map(e => ({ azimuth_deg: e.azimuth, relative_field: e.relative_field }));
  const ex = fmDaExhibit({ station_inputs: { pattern: altPattern } });
  const { blockers } = checkDaPatternReadiness(ex);
  assert.ok(!blockers.find(b => b.code === 'DA_PATTERN_INVALID'));
});

// ── Cross-cutting ─────────────────────────────────────────────────────────────

test('All scores remain 0-100 integers after Sprint #4 changes', () => {
  const fixtures = [
    fmDaExhibit(),                                                // BLOCKER: DA_PATTERN_MISSING
    fmDaExhibit({ station_inputs: { pattern: GOOD_PATTERN } }),   // warnings only
    fmDaExhibit({ station_inputs: { pattern: SPARSE_PATTERN } }), // incomplete warning
    {
      station_inputs: { call: 'W', service: 'FM', frequency: 107.9, erp_kw: 1.0, lat: 43.0, lon: -76.0 },
      evidence: {}
    },  // omni — no DA checks
  ];
  for (const ex of fixtures) {
    const r = buildReadinessReport(ex);
    assert.ok(Number.isInteger(r.readiness_score), `score must be integer (got ${r.readiness_score})`);
    assert.ok(r.readiness_score >= 0 && r.readiness_score <= 100,
      `score must be 0-100 (got ${r.readiness_score})`);
  }
});

test('DA_PATTERN_MISSING and DA_PATTERN_INVALID are never in warnings (blockers only)', () => {
  // Missing
  const ex1 = fmDaExhibit();
  const r1  = buildReadinessReport(ex1);
  assert.ok(!r1.warnings.find(w => w.code === 'DA_PATTERN_MISSING'));

  // Invalid
  const badPattern = [{ azimuth: 'x', relative_field: 1.0 }, ...GOOD_PATTERN.slice(1)];
  const ex2 = fmDaExhibit({ station_inputs: { pattern: badPattern } });
  const r2  = buildReadinessReport(ex2);
  assert.ok(!r2.warnings.find(w => w.code === 'DA_PATTERN_INVALID'));
});
