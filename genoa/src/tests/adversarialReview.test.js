// Adversarial Review — permanent regression tests for all 4 golden stations.
//
// Each test proves that buildAdversarialReview() and generateReviewerQuestions()
// produce well-formed, non-placeholder output that a filing engineer, FCC
// reviewer, or opposing engineer could act on.
//
// Invariants tested:
//   - every challenge point has severity, reviewer_question, why_it_matters, recommended_fix
//   - unsupported PASS/FAIL conditions are flagged
//   - AM reasoning gaps are flagged for KAZM
//   - HAAT conflicts are flagged for WJPZ
//   - no placeholder strings like "TODO", "FIXME", "(unknown)" in question text
//   - overall_risk is always one of: MINIMAL, LOW, MEDIUM, HIGH

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdversarialReview, generateReviewerQuestions } from '../review/adversarialReview.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// WJPZ-FM — §73.215 failures, HAAT conflict, NOT_READY
const WJPZ_FM = {
  station_inputs: {
    call: 'WJPZ', facility_id: '73610', service: 'FM', fcc_class: 'A',
    frequency: 107.9, erp_kw: 6.0, haat_m_input: 37,
    lat: 43.0481, lon: -76.1474
  },
  facility_metadata: {
    cached: true, facility_lookup_source: 'FCC FMQ',
    facility_updated_at: '2026-04-01T00:00:00Z',
    raw: { call: 'WJPZ', city: 'SYRACUSE', state: 'NY', haat_m: 37, erp_kw: 6.0, frequency: 107.9 }
  },
  regulatory_compliance: {
    pass: false,
    violations: [
      { cite: '47 CFR §73.215', message: 'Contour overlap with WDWN (66249) at 3.2 km' },
      { cite: '47 CFR §73.215', message: 'Contour overlap with WIII (12312) at 4.7 km' }
    ],
    section_73_207: {
      pass: false,
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

// KAZM-AM — AM station, no AM reasoning, no regulatory_compliance
const KAZM_AM = {
  station_inputs: {
    call: 'KAZM', facility_id: '64001', service: 'AM', fcc_class: 'C',
    frequency: 1230, power_kw: 1.0, lat: 34.8697, lon: -111.7609
  },
  facility_metadata: {
    cached: true, facility_lookup_source: 'FCC FMQ',
    facility_updated_at: '2026-03-15T00:00:00Z',
    raw: { call: 'KAZM', city: 'SEDONA', state: 'AZ', power_kw: 1.0 }
  },
  evidence: { contour_km: 2.1 }
};

// KNUV-FM — clean compliance, Class C 100 kW
const KNUV_FM = {
  station_inputs: {
    call: 'KNUV', facility_id: '185001', service: 'FM', fcc_class: 'C',
    frequency: 101.3, erp_kw: 100.0, haat_m_input: 610,
    lat: 34.0522, lon: -118.2437, overall_height_m: 60.0
  },
  facility_metadata: {
    cached: true, facility_lookup_source: 'FCC FMQ',
    facility_updated_at: '2026-04-01T00:00:00Z',
    raw: { call: 'KNUV', city: 'LOS ANGELES', state: 'CA', haat_m: 610, erp_kw: 100.0 }
  },
  regulatory_compliance: {
    pass: true, violations: [],
    section_73_207: { pass: true, violations: [] }
  },
  evidence: {
    contour_km: 112.0,
    terrain_haat_per_radial: [
      { azimuth_deg: 0,   haat_computed_m: 605.0 },
      { azimuth_deg: 90,  haat_computed_m: 615.0 },
      { azimuth_deg: 180, haat_computed_m: 608.0 },
      { azimuth_deg: 270, haat_computed_m: 612.0 }
    ]
  }
};

// WVIK-FM — §73.215 short-spacing showing
const WVIK_FM = {
  station_inputs: {
    call: 'WVIK', facility_id: '185002', service: 'FM', fcc_class: 'A',
    frequency: 90.3, erp_kw: 6.0, haat_m_input: 120,
    lat: 41.5236, lon: -90.5776, overall_height_m: 45.0
  },
  facility_metadata: {
    cached: true, facility_lookup_source: 'FCC FMQ',
    facility_updated_at: '2026-04-01T00:00:00Z',
    raw: { call: 'WVIK', city: 'MOLINE', state: 'IL', haat_m: 120, erp_kw: 6.0 }
  },
  regulatory_compliance: {
    pass: true, violations: [],
    section_73_207: {
      pass: false, short_spacing: true,
      violations: [{ cite: '47 CFR §73.207', message: 'Short-spacing; §73.215 showing filed' }]
    }
  },
  evidence: {
    contour_km: 28.0,
    terrain_haat_per_radial: [
      { azimuth_deg: 0,   haat_computed_m: 118.0 },
      { azimuth_deg: 90,  haat_computed_m: 122.0 },
      { azimuth_deg: 180, haat_computed_m: 119.0 },
      { azimuth_deg: 270, haat_computed_m: 121.0 }
    ]
  }
};

// ── Section 1: Output shape invariants ────────────────────────────────────────

const VALID_RISKS = new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
const VALID_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

const GOLDEN = [
  { call: 'WJPZ', fixture: WJPZ_FM },
  { call: 'KAZM', fixture: KAZM_AM },
  { call: 'KNUV', fixture: KNUV_FM },
  { call: 'WVIK', fixture: WVIK_FM }
];

for (const { call, fixture } of GOLDEN) {
  test(`${call}: buildAdversarialReview returns required top-level keys`, () => {
    const r = buildAdversarialReview(fixture);
    assert.ok('station'                      in r, `${call}: missing station`);
    assert.ok('overall_risk'                 in r, `${call}: missing overall_risk`);
    assert.ok('challenge_points'             in r, `${call}: missing challenge_points`);
    assert.ok('defensibility_gaps'           in r, `${call}: missing defensibility_gaps`);
    assert.ok('evidence_gaps'               in r, `${call}: missing evidence_gaps`);
    assert.ok('questions_reviewer_may_ask'   in r, `${call}: missing questions_reviewer_may_ask`);
    assert.ok('recommended_engineer_actions' in r, `${call}: missing recommended_engineer_actions`);
  });

  test(`${call}: overall_risk is a valid value`, () => {
    const r = buildAdversarialReview(fixture);
    assert.ok(VALID_RISKS.has(r.overall_risk),
      `${call}: overall_risk '${r.overall_risk}' is not one of MINIMAL/LOW/MEDIUM/HIGH`);
  });

  test(`${call}: challenge_points is non-empty array`, () => {
    const r = buildAdversarialReview(fixture);
    assert.ok(Array.isArray(r.challenge_points), `${call}: challenge_points must be array`);
    assert.ok(r.challenge_points.length > 0,
      `${call}: challenge_points is empty — adversarial review found nothing to challenge`);
  });

  test(`${call}: every challenge point has required fields`, () => {
    const r = buildAdversarialReview(fixture);
    for (const cp of r.challenge_points) {
      assert.ok(cp.category,          `${call}: challenge_point missing category: ${JSON.stringify(cp)}`);
      assert.ok(cp.severity,          `${call}: challenge_point missing severity: ${JSON.stringify(cp)}`);
      assert.ok(cp.reviewer_question, `${call}: challenge_point missing reviewer_question: ${JSON.stringify(cp)}`);
      assert.ok(cp.why_it_matters,    `${call}: challenge_point missing why_it_matters: ${JSON.stringify(cp)}`);
      assert.ok(cp.gap,               `${call}: challenge_point missing gap: ${JSON.stringify(cp)}`);
      assert.ok(cp.recommended_fix,   `${call}: challenge_point missing recommended_fix: ${JSON.stringify(cp)}`);
    }
  });

  test(`${call}: every challenge point severity is valid`, () => {
    const r = buildAdversarialReview(fixture);
    for (const cp of r.challenge_points) {
      assert.ok(VALID_SEVERITIES.has(cp.severity),
        `${call}: invalid severity '${cp.severity}' in ${cp.category}`);
    }
  });

  test(`${call}: no placeholder strings in reviewer_question or recommended_fix`, () => {
    const PLACEHOLDERS = ['TODO', 'FIXME', 'PLACEHOLDER', 'undefined', 'null'];
    const r = buildAdversarialReview(fixture);
    for (const cp of r.challenge_points) {
      for (const ph of PLACEHOLDERS) {
        assert.ok(
          !String(cp.reviewer_question || '').includes(ph),
          `${call}: placeholder '${ph}' found in reviewer_question of ${cp.category}`
        );
        assert.ok(
          !String(cp.recommended_fix || '').includes(ph),
          `${call}: placeholder '${ph}' found in recommended_fix of ${cp.category}`
        );
      }
    }
  });

  test(`${call}: defensibility_gaps is subset of challenge_points with CRITICAL or HIGH severity`, () => {
    const r = buildAdversarialReview(fixture);
    assert.ok(Array.isArray(r.defensibility_gaps), `${call}: defensibility_gaps must be array`);
    for (const gap of r.defensibility_gaps) {
      assert.ok(gap.severity === 'CRITICAL' || gap.severity === 'HIGH',
        `${call}: defensibility_gap has unexpected severity '${gap.severity}'`);
    }
  });

  test(`${call}: questions_reviewer_may_ask is string array with no duplicates`, () => {
    const r = buildAdversarialReview(fixture);
    assert.ok(Array.isArray(r.questions_reviewer_may_ask), `${call}: questions must be array`);
    for (const q of r.questions_reviewer_may_ask) {
      assert.ok(typeof q === 'string' && q.length > 10, `${call}: question too short or not string: '${q}'`);
    }
    const unique = new Set(r.questions_reviewer_may_ask);
    assert.equal(unique.size, r.questions_reviewer_may_ask.length,
      `${call}: duplicate questions in questions_reviewer_may_ask`);
  });

  test(`${call}: recommended_engineer_actions is string array`, () => {
    const r = buildAdversarialReview(fixture);
    assert.ok(Array.isArray(r.recommended_engineer_actions), `${call}: must be array`);
    for (const a of r.recommended_engineer_actions) {
      assert.ok(typeof a === 'string' && a.length > 10, `${call}: action too short or not string: '${a}'`);
    }
  });

  test(`${call}: generateReviewerQuestions matches buildAdversarialReview output`, () => {
    const questions = generateReviewerQuestions(fixture);
    const review    = buildAdversarialReview(fixture);
    assert.deepEqual(questions, review.questions_reviewer_may_ask,
      `${call}: generateReviewerQuestions must return the same questions as buildAdversarialReview`);
  });
}

// ── Section 2: Station-specific golden assertions ─────────────────────────────

// WJPZ — must flag HAAT conflict and active compliance failures
test('WJPZ: overall_risk is HIGH (CRITICAL items present)', () => {
  const r = buildAdversarialReview(WJPZ_FM);
  assert.equal(r.overall_risk, 'HIGH',
    `expected HIGH risk for WJPZ (compliance failures + HAAT conflict)`);
});

test('WJPZ: challenge_points includes haat_support conflict (filed 37m vs terrain ~241m)', () => {
  const r = buildAdversarialReview(WJPZ_FM);
  const haatPoints = r.challenge_points.filter(cp => cp.category === 'haat_support');
  assert.ok(haatPoints.length >= 1,
    `expected >=1 haat_support challenge point for WJPZ (got ${haatPoints.length})`);
  const conflict = haatPoints.find(cp => cp.severity === 'CRITICAL');
  assert.ok(conflict,
    'expected a CRITICAL haat_support point for WJPZ (>20% HAAT divergence)');
  assert.match(conflict.reviewer_question, /HAAT|haat|terrain/i,
    'HAAT conflict reviewer_question must reference HAAT or terrain');
});

test('WJPZ: challenge_points includes filing_readiness CRITICAL (compliance failures)', () => {
  const r = buildAdversarialReview(WJPZ_FM);
  const fr = r.challenge_points.filter(cp => cp.category === 'filing_readiness' && cp.severity === 'CRITICAL');
  assert.ok(fr.length >= 1,
    `expected >=1 CRITICAL filing_readiness point for WJPZ (got ${fr.length})`);
  assert.match(fr[0].reviewer_question, /compliance|violation|WDWN|WIII|§73/i,
    'filing_readiness reviewer_question must reference compliance issue');
});

test('WJPZ: defensibility_gaps is non-empty (multiple CRITICAL/HIGH items)', () => {
  const r = buildAdversarialReview(WJPZ_FM);
  assert.ok(r.defensibility_gaps.length >= 2,
    `expected >=2 defensibility gaps for WJPZ (got ${r.defensibility_gaps.length})`);
});

test('WJPZ: OET-65 gap flagged (6 kW ERP, no OET-65 in exhibit)', () => {
  const r = buildAdversarialReview(WJPZ_FM);
  const oet = r.challenge_points.find(cp => cp.category === 'environmental_rf');
  assert.ok(oet, 'expected environmental_rf challenge point for WJPZ (6 kW ERP, no OET-65)');
  assert.match(oet.rule, /OET/i, 'environmental_rf rule must reference OET Bulletin 65');
});

// KAZM-AM — must flag AM reasoning gap
test('KAZM: challenge_points includes am_reasoning gap', () => {
  const r = buildAdversarialReview(KAZM_AM);
  const am = r.challenge_points.find(cp => cp.category === 'am_reasoning');
  assert.ok(am, 'expected am_reasoning challenge point for KAZM (AM station, no AM conclusions)');
  assert.ok(am.severity === 'CRITICAL' || am.severity === 'HIGH',
    `am_reasoning severity should be CRITICAL or HIGH (got '${am.severity}')`);
  assert.match(am.reviewer_question, /§73\.182|§73\.183|nighttime|skywave|NIF/i,
    'am_reasoning reviewer_question must reference AM-specific rules');
});

test('KAZM: overall_risk is MEDIUM or HIGH (AM reasoning gap + other gaps)', () => {
  const r = buildAdversarialReview(KAZM_AM);
  assert.ok(r.overall_risk === 'MEDIUM' || r.overall_risk === 'HIGH',
    `expected MEDIUM or HIGH risk for KAZM (got '${r.overall_risk}')`);
});

test('KAZM: no unsupported_pass challenge (AM has no regulatory_compliance)', () => {
  const r = buildAdversarialReview(KAZM_AM);
  const unsupPass = r.challenge_points.filter(cp => cp.category === 'unsupported_pass');
  assert.equal(unsupPass.length, 0,
    'KAZM should have no unsupported_pass challenges (AM compliance not checked by engine)');
});

// KNUV — well-formed FM; some gaps should still be flagged (OET-65, HAAT radials)
test('KNUV: no filing_readiness CRITICAL (compliance passes)', () => {
  const r = buildAdversarialReview(KNUV_FM);
  const fr = r.challenge_points.filter(cp => cp.category === 'filing_readiness' && cp.severity === 'CRITICAL');
  assert.equal(fr.length, 0,
    `KNUV has passing compliance — no CRITICAL filing_readiness expected (got ${fr.length})`);
});

test('KNUV: no unsupported_pass (section_73_207 record is present)', () => {
  const r = buildAdversarialReview(KNUV_FM);
  const up = r.challenge_points.filter(cp => cp.category === 'unsupported_pass');
  assert.equal(up.length, 0,
    'KNUV has full section_73_207 record — unsupported_pass should not fire');
});

test('KNUV: haat_support MEDIUM flagged (only 4 of 8 standard radials)', () => {
  const r = buildAdversarialReview(KNUV_FM);
  const haat = r.challenge_points.find(cp => cp.category === 'haat_support' && cp.severity === 'MEDIUM');
  assert.ok(haat, 'expected haat_support MEDIUM for KNUV (4/8 radials)');
  assert.match(haat.reviewer_question, /radial|8|standard/i,
    'haat_support MEDIUM reviewer_question must mention radials');
});

test('KNUV: OET-65 gap flagged (100 kW ERP, no OET-65)', () => {
  const r = buildAdversarialReview(KNUV_FM);
  const oet = r.challenge_points.find(cp => cp.category === 'environmental_rf');
  assert.ok(oet, 'expected OET-65 gap for KNUV (100 kW, no OET-65)');
  assert.equal(oet.severity, 'HIGH',
    'OET-65 gap at 100 kW should be HIGH severity');
});

// WVIK — §73.215 short-spacing showing; must flag the showing as needing documentation
test('WVIK: spacing_support MEDIUM flagged for §73.215 short-spacing showing', () => {
  const r = buildAdversarialReview(WVIK_FM);
  const ss = r.challenge_points.find(cp => cp.category === 'spacing_support' && cp.severity === 'MEDIUM');
  assert.ok(ss, 'expected spacing_support MEDIUM for WVIK (§73.215 showing needs documentation)');
  assert.match(ss.reviewer_question, /§73\.215|short.spacing|IPA|showing/i,
    'spacing_support reviewer_question must reference §73.215 or IPA');
});

test('WVIK: no filing_readiness CRITICAL (compliance passes via §73.215)', () => {
  const r = buildAdversarialReview(WVIK_FM);
  const fr = r.challenge_points.filter(cp => cp.category === 'filing_readiness' && cp.severity === 'CRITICAL');
  assert.equal(fr.length, 0,
    'WVIK has passing compliance — no CRITICAL filing_readiness expected');
});

// ── Section 3: Edge cases ─────────────────────────────────────────────────────

test('null exhibit returns UNKNOWN risk with empty arrays', () => {
  const r = buildAdversarialReview(null);
  assert.equal(r.overall_risk, 'UNKNOWN');
  assert.ok(Array.isArray(r.challenge_points) && r.challenge_points.length === 0);
});

test('empty exhibit {} returns challenge_points (coordinate and community gaps at minimum)', () => {
  const r = buildAdversarialReview({});
  assert.ok(Array.isArray(r.challenge_points));
  assert.ok(r.challenge_points.length >= 1, 'empty exhibit must produce at least one challenge point');
});

test('FM exhibit with no regulatory_compliance gets spacing_support CRITICAL', () => {
  const minimal = {
    station_inputs: { call: 'WTEST', service: 'FM', fcc_class: 'A', frequency: 100.1, erp_kw: 3.0, haat_m_input: 80, lat: 40.0, lon: -75.0 },
    facility_metadata: { raw: { city: 'TESTVILLE' } }
  };
  const r = buildAdversarialReview(minimal);
  const sp = r.challenge_points.find(cp => cp.category === 'spacing_support' && cp.severity === 'CRITICAL');
  assert.ok(sp, 'FM exhibit with no regulatory_compliance must get CRITICAL spacing_support challenge');
});

test('FM exhibit with unsupported_pass (compliance.pass=true, no section_73_207) is flagged', () => {
  const exhibit = {
    station_inputs: { call: 'WTEST2', service: 'FM', fcc_class: 'A', frequency: 100.3, erp_kw: 3.0, haat_m_input: 80, lat: 40.0, lon: -75.0 },
    facility_metadata: { raw: { city: 'TESTVILLE' } },
    regulatory_compliance: { pass: true, violations: [] }
  };
  const r = buildAdversarialReview(exhibit);
  const up = r.challenge_points.find(cp => cp.category === 'unsupported_pass');
  assert.ok(up, 'compliance.pass=true without section_73_207 must produce unsupported_pass challenge');
  assert.equal(up.severity, 'HIGH');
});

test('DA station without pattern table gets directional_status HIGH challenge', () => {
  const exhibit = {
    station_inputs: { call: 'WTEST3', service: 'FM', fcc_class: 'A', frequency: 100.5, erp_kw: 3.0, haat_m_input: 80, lat: 40.0, lon: -75.0, pattern_mode: 'DA' },
    facility_metadata: { raw: { city: 'TESTVILLE' } },
    regulatory_compliance: { pass: true, violations: [], section_73_207: { pass: true, violations: [] } }
  };
  const r = buildAdversarialReview(exhibit);
  const da = r.challenge_points.find(cp => cp.category === 'directional_status');
  assert.ok(da, 'DA station without pattern_data must get directional_status challenge');
  assert.equal(da.severity, 'HIGH');
  assert.match(da.rule, /§73\.316/);
});

test('tower height 0 gets tower_registration CRITICAL challenge', () => {
  const exhibit = {
    station_inputs: { call: 'WTEST4', service: 'FM', fcc_class: 'A', frequency: 100.7, erp_kw: 3.0, haat_m_input: 80, lat: 40.0, lon: -75.0, overall_height_m: 0 },
    facility_metadata: { raw: { city: 'TESTVILLE' } },
    regulatory_compliance: { pass: true, violations: [], section_73_207: { pass: true, violations: [] } }
  };
  const r = buildAdversarialReview(exhibit);
  const tr = r.challenge_points.find(cp => cp.category === 'tower_registration' && cp.severity === 'CRITICAL');
  assert.ok(tr, 'tower height 0 must produce tower_registration CRITICAL challenge');
});

test('tower >60.96m with no ASR gets tower_registration HIGH challenge', () => {
  const exhibit = {
    station_inputs: { call: 'WTEST5', service: 'FM', fcc_class: 'C', frequency: 101.1, erp_kw: 100.0, haat_m_input: 600, lat: 40.0, lon: -75.0, overall_height_m: 90.0 },
    facility_metadata: { raw: { city: 'TESTVILLE' } },
    regulatory_compliance: { pass: true, violations: [], section_73_207: { pass: true, violations: [] } }
  };
  const r = buildAdversarialReview(exhibit);
  const tr = r.challenge_points.find(cp => cp.category === 'tower_registration' && cp.severity === 'HIGH');
  assert.ok(tr, 'tower >60.96m without ASR must produce tower_registration HIGH challenge');
  assert.match(tr.rule, /Part 17|§17/i);
});

test('challenge_points are sorted highest severity first', () => {
  const r = buildAdversarialReview(WJPZ_FM);
  for (let i = 1; i < r.challenge_points.length; i++) {
    const prev = SEVERITY_RANK[r.challenge_points[i - 1].severity] || 0;
    const curr = SEVERITY_RANK[r.challenge_points[i].severity] || 0;
    assert.ok(prev >= curr,
      `challenge_points must be sorted highest severity first (position ${i - 1}: ${r.challenge_points[i - 1].severity} < position ${i}: ${r.challenge_points[i].severity})`);
  }
});

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
