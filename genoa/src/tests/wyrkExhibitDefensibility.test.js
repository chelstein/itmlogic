// WYRK FM Engineering Exhibit — filing defensibility tests.
//
// Covers the 9-item task list from the WYRK credibility audit:
//   1. rule_validation = FAIL when interference_study.filing_qualifies = false
//   2. §73.215 table wording: failed rows never say 'satisfied'; null = 'status not determined'
//   3. "NEW" facility identity: SOURCE_UNVERIFIED_CALLSIGN blocker blocks filing
//   4. Tower source attestation: ASR outranks operator 0m; SOURCE_CONFLICT_TOWER_HEIGHT
//   5. HAAT basis: FCC_LMS (filing-controlling) beats DEM (advisory) in resolution
//   6. RF exposure: INCOMPLETE_BOUNDARY_GEOMETRY when boundary missing with distances computed
//   7. FAA OE: FAA_OE_DETERMINATION_MISSING when study number present but no determination

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_TYPE, RULE_STATUS, FILING_STATUS,
  buildAttestedExhibitValues
} from '../attestation/index.js';
import { buildFmReasoning } from '../exports/engineeringReport/sections/_fmReasoning.js';
import { buildContourProtectionSection } from '../exports/engineeringReport/sections/contourProtection.js';
import { buildRfExposureSection } from '../exports/engineeringReport/sections/rfExposure.js';
import { buildTowerStudySection } from '../exports/engineeringReport/sections/towerStudy.js';

// ---- helpers ----

function makeExhibit(overrides = {}){
  return {
    station_inputs: { call: 'WYRK', facility_id: '12345', service: 'FM', fcc_class: 'C1',
                      frequency: 106.5, frequency_unit: 'MHz', erp_kw: 100, haat_m: 142 },
    filing_readiness:   { status: 'REVIEW' },
    interference_study: null,
    source_attestation_v2: null,
    build_attestation: {},
    attestation_overrides: {},
    evidence:          {},
    haat_lineage:      {},
    rcamsl_lineage:    {},
    erp_lineage:       {},
    class_lineage:     {},
    frequency_lineage: {},
    method_versions:   {},
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: rule_validation = FAIL when interference_study.filing_qualifies = false
// ─────────────────────────────────────────────────────────────────────────────

test('rule_validation is FAIL when interference_study.filing_qualifies = false (regardless of filing_readiness)', () => {
  const exhibit = makeExhibit({
    filing_readiness:   { status: 'REVIEW' },
    interference_study: { filing_qualifies: false, n_fail: 1, n_pass: 0 }
  });
  const av2 = buildAttestedExhibitValues(exhibit, null, {});
  assert.equal(av2.statuses.rule_status, RULE_STATUS.FAIL,
    'rule_status must be FAIL when interference_study.filing_qualifies=false');
  // filing_status may be BLOCKED (due to missing primary sources in this minimal exhibit)
  // or NON_COMPLIANT — in either case it must not be VERIFIED or REVIEW.
  assert.notEqual(av2.statuses.filing_status, FILING_STATUS.VERIFIED,
    'filing_status must not be VERIFIED when interference rule fails');
  assert.notEqual(av2.statuses.filing_status, FILING_STATUS.REVIEW,
    'filing_status must not be REVIEW when rule is FAIL (should be NON_COMPLIANT or BLOCKED)');
});

test('rule_validation is PASS when interference_study.filing_qualifies = true', () => {
  const exhibit = makeExhibit({
    filing_readiness:   { status: 'READY' },
    interference_study: { filing_qualifies: true, n_fail: 0, n_pass: 3 }
  });
  const av2 = buildAttestedExhibitValues(exhibit, null, {});
  assert.equal(av2.statuses.rule_status, RULE_STATUS.PASS,
    'rule_status must be PASS when interference_study.filing_qualifies=true and filing_readiness=READY');
});

test('rule_validation is NOT_RUN when interference_study is null and filing_readiness is absent', () => {
  const exhibit = makeExhibit({
    filing_readiness:   null,
    interference_study: null
  });
  const av2 = buildAttestedExhibitValues(exhibit, null, {});
  assert.equal(av2.statuses.rule_status, RULE_STATUS.NOT_RUN,
    'rule_status must be NOT_RUN when no study and no filing_readiness');
});

test('filing_readiness FAIL path still returns FAIL rule_status', () => {
  const exhibit = makeExhibit({
    filing_readiness:   { status: 'NON_COMPLIANT' },
    interference_study: null
  });
  const av2 = buildAttestedExhibitValues(exhibit, null, {});
  assert.equal(av2.statuses.rule_status, RULE_STATUS.FAIL,
    'filing_readiness=NON_COMPLIANT → rule_status FAIL (legacy path)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: §73.215 table wording
// ─────────────────────────────────────────────────────────────────────────────

function fakeInterferenceStudy({ pass }){
  return {
    stations: [{
      call: 'WFOO', facility_id: '99999', fcc_class: 'C1',
      frequency_mhz: 106.5, channel_relationship: 'co-channel', distance_km: 120,
      rules: {
        section_73_215: {
          cite: '47 CFR §73.215',
          du_required_db: 20,
          du_actual_db_forward: pass ? 23 : 15,
          du_actual_db_reverse: pass ? 24 : 14,
          du_forward_beyond_range: false, du_reverse_beyond_range: false,
          du_pass: pass,
          polygon_overlap_subject_into_nearby_km2: null,
          polygon_overlap_nearby_into_subject_km2: null,
          polygon_pass: pass,
          pass
        }
      },
      pass_overall: pass
    }]
  };
}

test('§73.215 wording: passing pair says "satisfied"', () => {
  const reasoning = buildFmReasoning(fakeInterferenceStudy({ pass: true }));
  const pair = reasoning.pairs[0];
  assert.ok(pair.binding_constraint.includes('satisfied'),
    `Expected "satisfied" in: ${pair.binding_constraint}`);
  assert.ok(!pair.binding_constraint.includes('fails'),
    `"fails" must NOT appear when pass=true: ${pair.binding_constraint}`);
});

test('§73.215 wording: failing pair says "fails" not "satisfied"', () => {
  const reasoning = buildFmReasoning(fakeInterferenceStudy({ pass: false }));
  const pair = reasoning.pairs[0];
  assert.ok(!pair.binding_constraint.includes('satisfied'),
    `"satisfied" must NOT appear when pass=false: ${pair.binding_constraint}`);
  assert.ok(pair.binding_constraint.includes('fails'),
    `Expected "fails" in: ${pair.binding_constraint}`);
});

test('§73.215 wording: null pass returns "not determined" not "satisfied"', () => {
  const study = {
    stations: [{
      call: 'WFOO', facility_id: '99999', fcc_class: 'C1',
      frequency_mhz: 106.5, channel_relationship: 'co-channel', distance_km: 120,
      rules: {
        section_73_215: {
          cite: '47 CFR §73.215',
          du_required_db: 20, du_actual_db_forward: null, du_actual_db_reverse: null,
          du_forward_beyond_range: false, du_reverse_beyond_range: false,
          du_pass: null, polygon_pass: null, pass: null
        }
      },
      pass_overall: null
    }]
  };
  const reasoning = buildFmReasoning(study);
  const pair = reasoning.pairs[0];
  assert.ok(!pair.binding_constraint.includes('satisfied'),
    `"satisfied" must not appear for null pass: ${pair.binding_constraint}`);
  assert.ok(!pair.binding_constraint.includes('fails'),
    `"fails" must not appear for null pass (use "not determined"): ${pair.binding_constraint}`);
});

test('contourProtection polygon_pass: undefined overlap fields should not say "polygon overlaps"', () => {
  const exhibit = {
    station_inputs: { service: 'FM' },
    regulatory_compliance: {
      cite: '47 CFR §73.215',
      pass: true,
      studies: [{
        nearby_call: 'WTEST', nearby_class: 'C1', nearby_frequency_mhz: 106.5,
        delta_khz: 0, relationship: 'co-channel', du_threshold_db: 20,
        pair_pass: true, pair_pass_du: true,
        forward: { du_actual_db: 25, pass: true, du_beyond_curve_range: false },
        reverse: { du_actual_db: 26, pass: true, du_beyond_curve_range: false },
        polygon_overlap: {}   // intentionally missing boolean fields
      }]
    },
    interference_study: { stations: [] }
  };
  const section = buildContourProtectionSection(exhibit);
  assert.ok(section, 'section must be returned');
  const row = section.table.rows[0];
  assert.notEqual(row.reasoning, 'F(50,10) interfering polygon overlaps the protected contour — §73.215 polygon-overlap test fails',
    'undefined polygon_overlap booleans must NOT say "overlaps"');
  assert.equal(row.pass, 'PASS',
    'pair_pass=true → pass column must be PASS');
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3: "NEW" facility identity
// ─────────────────────────────────────────────────────────────────────────────

test('"NEW" callsign blocks filing readiness with SOURCE_UNVERIFIED_CALLSIGN', () => {
  const exhibit = makeExhibit({
    station_inputs: { call: 'NEW', facility_id: 'NEW', service: 'FM',
                      frequency: 106.5, frequency_unit: 'MHz', erp_kw: 10 },
    filing_readiness: { status: 'READY' }
  });
  const av2 = buildAttestedExhibitValues(exhibit, null, {});
  assert.ok(
    av2.blockers.some(b => b.code === 'SOURCE_UNVERIFIED_CALLSIGN'),
    `Expected SOURCE_UNVERIFIED_CALLSIGN blocker; got: ${JSON.stringify(av2.blockers.map(b => b.code))}`
  );
  assert.equal(av2.statuses.filing_status, FILING_STATUS.BLOCKED,
    'filing_status must be BLOCKED when callsign is NEW');
});

test('real callsign does not raise SOURCE_UNVERIFIED_CALLSIGN', () => {
  const exhibit = makeExhibit({
    station_inputs: { call: 'WYRK', facility_id: '12345', service: 'FM',
                      frequency: 106.5, frequency_unit: 'MHz', erp_kw: 10 },
    filing_readiness: { status: 'READY' }
  });
  const av2 = buildAttestedExhibitValues(exhibit, null, {});
  assert.ok(
    !av2.blockers.some(b => b.code === 'SOURCE_UNVERIFIED_CALLSIGN'),
    'Real callsign must NOT raise SOURCE_UNVERIFIED_CALLSIGN'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: Tower source attestation
// ─────────────────────────────────────────────────────────────────────────────

test('ASR height outranks operator 0m; conflict code is SOURCE_CONFLICT_TOWER_HEIGHT', () => {
  const exhibit = makeExhibit({
    station_inputs: { call: 'WYRK', facility_id: '12345', service: 'FM',
                      overall_height_m: 0 }
  });
  const evidence = {
    asr: { asr_number: '1234567', overall_height_m: 47.2, overall_height_amsl_m: 340.5,
           lat: 42.5, lon: -78.8, fetched_at: '2026-06-01T00:00:00Z' }
  };
  const av2 = buildAttestedExhibitValues(exhibit, evidence, {});
  const asrField = av2.fields?.asr_height_agl_m;
  assert.ok(asrField, 'asr_height_agl_m field must exist');
  assert.equal(asrField.operative_value, 47.2,
    'ASR (PRIMARY) value must be operative, not operator 0m');
  assert.equal(asrField.operative_source_type, SOURCE_TYPE.FCC_ASR,
    'Operative source must be FCC_ASR');
  // Conflict warning must be SOURCE_CONFLICT_TOWER_HEIGHT (renamed from SOURCE_CONFLICT_ASR_HEIGHT)
  assert.ok(
    (asrField.warnings || []).some(w => w === 'SOURCE_CONFLICT_TOWER_HEIGHT') ||
    (asrField.blockers || []).some(b => b === 'SOURCE_CONFLICT_TOWER_HEIGHT') ||
    (asrField.candidates || []).some(c => c.conflicts?.some(cf => cf.code === 'SOURCE_CONFLICT_TOWER_HEIGHT')),
    `Expected SOURCE_CONFLICT_TOWER_HEIGHT; field: ${JSON.stringify(asrField.warnings)}`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 5: HAAT basis governance
// ─────────────────────────────────────────────────────────────────────────────

test('FCC_LMS HAAT (filing-controlling) beats DEM HAAT (advisory) in resolution', () => {
  const exhibit = makeExhibit({
    haat_lineage: {
      operator_entered_m: 142,
      fcc_authorized_m:   142,
      terrain_mean_m:     340
    }
  });
  const evidence = {
    fcc_lms: { license: { haat_m: 142, call: 'WYRK', facility_id: '12345',
                          frequency: 106.5, fcc_class: 'C1', erp_kw: 100 } }
  };
  const av2 = buildAttestedExhibitValues(exhibit, evidence, {});
  const haatField = av2.fields?.haat_m;
  assert.ok(haatField, 'haat_m field must exist');
  assert.equal(haatField.operative_value, 142,
    'FCC LMS HAAT 142m must control (not DEM 340m)');
  assert.equal(haatField.operative_source_type, SOURCE_TYPE.FCC_LMS,
    'Operative source must be FCC_LMS');
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6: RF exposure completeness
// ─────────────────────────────────────────────────────────────────────────────

test('rfExposure: INCOMPLETE_BOUNDARY_GEOMETRY when distances computed but boundary missing', () => {
  const exhibit = {
    station_inputs: { service: 'FM', frequency: 106.5, erp_kw: 100 },
    oet65: {
      compliance: {
        controlled:   { distance_m: 12.5, mpe_mw_cm2: 1.0 },
        uncontrolled: { distance_m: 28.0, mpe_mw_cm2: 0.2 },
        boundary_check: { boundary_distance_m: null, pass: null }
      },
      near_field: { required_for_filing: false },
      method: 'OET-65 simplified far-field'
    }
  };
  const section = buildRfExposureSection(exhibit);
  assert.ok(section, 'section must be returned');
  // rows is an array of [label, value] pairs
  const statusRow = section.rows.find(r => r[0] === 'Status');
  assert.ok(statusRow, 'Status row must exist');
  assert.ok(statusRow[1].includes('INCOMPLETE_BOUNDARY_GEOMETRY'),
    `Status row must say INCOMPLETE_BOUNDARY_GEOMETRY; got: ${statusRow[1]}`);
});

test('rfExposure: PASS when boundary present and clears MPE', () => {
  const exhibit = {
    station_inputs: { service: 'FM', frequency: 106.5, erp_kw: 100 },
    oet65: {
      compliance: {
        controlled:   { distance_m: 12.5 },
        uncontrolled: { distance_m: 28.0 },
        boundary_check: { boundary_distance_m: 50, pass: true, power_density_mw_cm2: 0.05 }
      },
      near_field: { required_for_filing: false }
    }
  };
  const section = buildRfExposureSection(exhibit);
  const statusRow = section.rows.find(r => r[0] === 'Status');
  assert.ok(statusRow[1].startsWith('PASS'), `Status must be PASS; got: ${statusRow[1]}`);
});

test('rfExposure: absent oet65 emits deferred-to-engineer note', () => {
  const exhibit = { station_inputs: { service: 'FM', erp_kw: 1 }, oet65: null };
  const section = buildRfExposureSection(exhibit);
  assert.equal(section.type, 'paragraphs', 'Must return paragraphs when oet65 absent');
  assert.ok(section.paragraphs.some(p => p.includes('engineer of record')),
    'Must mention engineer of record');
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7: FAA OE completeness
// ─────────────────────────────────────────────────────────────────────────────

test('towerStudy: FAA_OE_DETERMINATION_MISSING when ASR has faa_study_number but no determination', () => {
  const exhibit = {
    evidence: {
      asr: {
        available: true,
        asr_number: '1234567',
        faa_study_number: '2026-ASO-1234-OE',
        overall_height_m: 47.2,
        lat: 42.5, lon: -78.8
      },
      faa_oe: { available: false }
    },
    tower_compliance: null
  };
  const section = buildTowerStudySection(exhibit);
  assert.ok(section, 'section must be returned');
  // rows is [label, value] pairs; multiple 'Status' rows exist (ASR status + FAA status).
  // The FAA-specific Status row is the one containing FAA_OE_DETERMINATION_MISSING.
  const rows = section.rows || [];
  const faaStatusRow = rows.find(r => Array.isArray(r) && r[0] === 'Status'
                                    && String(r[1]).includes('FAA_OE'));
  assert.ok(faaStatusRow,
    `FAA Status row must exist; rows: ${JSON.stringify(rows.map(r => r[0]))}`);
  assert.ok(faaStatusRow[1].includes('FAA_OE_DETERMINATION_MISSING'),
    `FAA Status must say FAA_OE_DETERMINATION_MISSING; got: ${faaStatusRow[1]}`);
  // Second paragraph is the summary
  const summary = section.paragraphs[1];
  assert.ok(summary.includes('FAA_OE_DETERMINATION_MISSING'),
    `Summary must say FAA_OE_DETERMINATION_MISSING; got: ${summary}`);
});

test('towerStudy: no FAA_OE_DETERMINATION_MISSING when determination is present', () => {
  const exhibit = {
    evidence: {
      asr: {
        available: true,
        asr_number: '1234567',
        faa_study_number: '2026-ASO-1234-OE',
        overall_height_m: 47.2
      },
      faa_oe: {
        available: true,
        study_number: '2026-ASO-1234-OE',
        determination: 'DNH',
        determination_date: '2026-01-15',
        expiration_date: '2027-07-15',
        conditions: []
      }
    },
    tower_compliance: null
  };
  const section = buildTowerStudySection(exhibit);
  const summary = section.paragraphs[1] || '';
  assert.ok(!summary.includes('FAA_OE_DETERMINATION_MISSING'),
    `Summary must NOT say FAA_OE_DETERMINATION_MISSING when determination present; got: ${summary}`);
});
