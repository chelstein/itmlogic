// Tests for canonical/scenario.js — the OperatingScenario/AntennaDesign
// labeling layer added in canonical-consistency-audit-followup Phase 2.
//
// This module invents no new selection: it only names facts
// buildCanonicalCandidateResult() already assembled (antenna mode,
// selected design height, NIF decision). These tests prove the
// classification logic is deterministic and the documented gaps
// (POWER_UPGRADE_STUDY unreachable; DA_DAY has no dedicated enum member)
// behave exactly as documented, not silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalCandidateResult } from '../engine/am/canonical/buildCanonicalCandidateResult.js';
import { classifyAntennaDesign, classifyOperatingScenario } from '../engine/am/canonical/scenario.js';
import { OPERATING_SCENARIOS, ANTENNA_DESIGN_CATEGORIES, ANTENNA_MODES } from '../engine/am/canonical/types.js';
import { KAZM_BUILD_ARGS } from './fixtures/kazmCanonical.js';

test('canonical.scenario is attached to the assembled result', () => {
  const r = buildCanonicalCandidateResult(KAZM_BUILD_ARGS);
  assert.ok(r.scenario, 'result.scenario must be present');
  assert.ok(typeof r.scenario.primaryScenarioLabel === 'string' && r.scenario.primaryScenarioLabel.length > 0);
  assert.ok(Object.values(OPERATING_SCENARIOS).includes(r.scenario.operatingScenario));
  assert.ok(Object.values(ANTENNA_DESIGN_CATEGORIES).includes(r.scenario.antennaDesignCategory));
});

test('KAZM (NDA, no night study, Class D 3/8-wave default): RELOCATION_NDA_DAY_ONLY + COMPACT', () => {
  const r = buildCanonicalCandidateResult(KAZM_BUILD_ARGS);
  assert.equal(r.scenario.operatingScenario, OPERATING_SCENARIOS.RELOCATION_NDA_DAY_ONLY);
  assert.equal(r.scenario.antennaDesignCategory, ANTENNA_DESIGN_CATEGORIES.COMPACT);
  assert.match(r.scenario.primaryScenarioLabel, /daytime NDA relocation/);
  assert.match(r.scenario.primaryScenarioLabel, /compact radiator/);
});

test('classifyOperatingScenario: baseline candidate is always CURRENT_AUTHORIZED_BASELINE, regardless of mode', () => {
  const res = classifyOperatingScenario({ isBaselineCandidate: true, modeledMode: ANTENNA_MODES.DA_NIGHT, nif: null });
  assert.equal(res.scenario, OPERATING_SCENARIOS.CURRENT_AUTHORIZED_BASELINE);
});

test('classifyOperatingScenario: NDA with a PASSED night study is RELOCATION_NDA_WITH_NIGHT_AUTHORITY', () => {
  const nif = { required: true, completion: 'RUN', result: 'PASS' };
  const res = classifyOperatingScenario({ isBaselineCandidate: false, modeledMode: ANTENNA_MODES.NDA, nif });
  assert.equal(res.scenario, OPERATING_SCENARIOS.RELOCATION_NDA_WITH_NIGHT_AUTHORITY);
});

test('classifyOperatingScenario: NDA with a FAILED or not-run night study stays RELOCATION_NDA_DAY_ONLY (never inferred as authorized)', () => {
  const failed = { required: true, completion: 'RUN', result: 'FAIL' };
  assert.equal(classifyOperatingScenario({ modeledMode: ANTENNA_MODES.NDA, nif: failed }).scenario,
    OPERATING_SCENARIOS.RELOCATION_NDA_DAY_ONLY);
  const notRun = { required: true, completion: 'NOT_RUN', result: 'NOT_EVALUATED' };
  assert.equal(classifyOperatingScenario({ modeledMode: ANTENNA_MODES.NDA, nif: notRun }).scenario,
    OPERATING_SCENARIOS.RELOCATION_NDA_DAY_ONLY);
});

test('classifyOperatingScenario: DA_NIGHT -> RELOCATION_DA_NIGHT; DA_DAY_AND_NIGHT -> RELOCATION_DA_FULL_TIME', () => {
  assert.equal(classifyOperatingScenario({ modeledMode: ANTENNA_MODES.DA_NIGHT, nif: null }).scenario,
    OPERATING_SCENARIOS.RELOCATION_DA_NIGHT);
  assert.equal(classifyOperatingScenario({ modeledMode: ANTENNA_MODES.DA_DAY_AND_NIGHT, nif: null }).scenario,
    OPERATING_SCENARIOS.RELOCATION_DA_FULL_TIME);
});

test('classifyOperatingScenario: DA_DAY has no dedicated enum member — documented fallback to RELOCATION_DA_FULL_TIME, never silent', () => {
  const res = classifyOperatingScenario({ modeledMode: ANTENNA_MODES.DA_DAY, nif: null });
  assert.equal(res.scenario, OPERATING_SCENARIOS.RELOCATION_DA_FULL_TIME);
  assert.match(res.basis, /no day-only-directional member/i,
    'the basis string must explicitly document this is a known enum gap, not a confirmed full-time claim');
});

test('classifyOperatingScenario: POWER_UPGRADE_STUDY is never returned (documented, unreachable given current inputs)', () => {
  // The function accepts no "current authorized power" input distinct
  // from tpo_kw, so it can never legitimately classify a candidate as a
  // power-upgrade study without fabricating a comparison. Exhaustively
  // sweep the reachable input space and confirm POWER_UPGRADE_STUDY never
  // appears.
  for (const isBaselineCandidate of [true, false]) {
    for (const modeledMode of [ANTENNA_MODES.NDA, ANTENNA_MODES.DA_DAY, ANTENNA_MODES.DA_NIGHT, ANTENNA_MODES.DA_DAY_AND_NIGHT, null]) {
      for (const nif of [null, { required: true, completion: 'RUN', result: 'PASS' }, { required: true, completion: 'RUN', result: 'FAIL' }, { required: false, completion: 'NOT_RUN', result: 'NOT_EVALUATED' }]) {
        const res = classifyOperatingScenario({ isBaselineCandidate, modeledMode, nif });
        assert.notEqual(res.scenario, OPERATING_SCENARIOS.POWER_UPGRADE_STUDY,
          `POWER_UPGRADE_STUDY must never appear (isBaselineCandidate=${isBaselineCandidate}, modeledMode=${modeledMode}, nif=${JSON.stringify(nif)})`);
      }
    }
  }
});

test('classifyAntennaDesign: HOST_STRUCTURE selection basis -> EXISTING_STRUCTURE_COLOCATION regardless of height', () => {
  const antennaDesign = {
    selectionBasis: 'HOST_STRUCTURE',
    selectedDesignHeightM: { value: 60 },
    wavelengthM: { value: 384.62 },
  };
  const res = classifyAntennaDesign({ antennaDesign, modeledMode: ANTENNA_MODES.NDA });
  assert.equal(res.category, ANTENNA_DESIGN_CATEGORIES.EXISTING_STRUCTURE_COLOCATION);
});

test('classifyAntennaDesign: directional modeled mode -> CUSTOM_DA_ARRAY, overrides height-band classification', () => {
  const antennaDesign = {
    selectionBasis: 'CLASS_TYPICAL_DEFAULT',
    selectedDesignHeightM: { value: 240.4 }, // 5/8 wave at 780 kHz
    wavelengthM: { value: 384.62 },
  };
  const res = classifyAntennaDesign({ antennaDesign, modeledMode: ANTENNA_MODES.DA_NIGHT });
  assert.equal(res.category, ANTENNA_DESIGN_CATEGORIES.CUSTOM_DA_ARRAY);
});

test('classifyAntennaDesign: height bands — quarter-wave, compact, five-eighths-wave', () => {
  const lambda = 384.62;
  const mk = (h) => ({ selectionBasis: 'CLASS_TYPICAL_DEFAULT', selectedDesignHeightM: { value: h }, wavelengthM: { value: lambda } });
  assert.equal(classifyAntennaDesign({ antennaDesign: mk(lambda * 0.25), modeledMode: ANTENNA_MODES.NDA }).category,
    ANTENNA_DESIGN_CATEGORIES.QUARTER_WAVE);
  assert.equal(classifyAntennaDesign({ antennaDesign: mk(lambda * 0.375), modeledMode: ANTENNA_MODES.NDA }).category,
    ANTENNA_DESIGN_CATEGORIES.COMPACT);
  assert.equal(classifyAntennaDesign({ antennaDesign: mk(lambda * 0.625), modeledMode: ANTENNA_MODES.NDA }).category,
    ANTENNA_DESIGN_CATEGORIES.FIVE_EIGHTHS_WAVE);
});

test('production path: candidate_comparison_table carries primary_scenario_label sourced from canonical.scenario', async () => {
  const { runSiteOptimizer } = await import('../engine/am/siteOptimizer.js');
  const out = await runSiteOptimizer({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.86, lon: -111.82 },
    search_radius_km: 50, grid_spacing_km: 10, tpo_kw: 5, pattern_mode: 'NDA', fcc_class: 'D',
    community_of_license_polygon: null,
    optimization_goals: { maximize_col_coverage: true, maximize_population: true, minimize_blanket_population: true, avoid_wildfire_risk: false, prefer_high_conductivity: true, minimize_int_treaty_zone: false },
    candidate_limit: 3,
  });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table) {
    const c = out.candidates.find(x => x.rank === row.rank);
    assert.equal(row.primary_scenario_label, c.canonical?.scenario?.primaryScenarioLabel,
      `rank ${row.rank}: comparison table primary_scenario_label must equal canonical.scenario.primaryScenarioLabel`);
    assert.equal(row.operating_scenario, c.canonical?.scenario?.operatingScenario);
    assert.equal(row.antenna_design_category, c.canonical?.scenario?.antennaDesignCategory);
  }
});
