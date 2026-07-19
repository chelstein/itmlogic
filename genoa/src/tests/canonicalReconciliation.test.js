// Canonical-consistency reconciliation tests — canonical-consistency-audit-followup.
//
// These are PRODUCTION-PATH integration proofs: they drive the real
// runSiteOptimizer() entry point (grid search -> scoreCandidate() ->
// buildCanonicalCandidateResult() -> validateCandidateResult() -> the v1
// response envelope), not the isolated canonical assembler tested in
// canonicalCore.test.js / canonicalPipeline.test.js. The goal is to prove
// that every TOP-LEVEL field an operator or the UI would read (comparison
// table, tower_reference, cost summaries, NIF/ASR labels, recommendation)
// traces back to the SAME candidate.canonical facts, not an independent
// recomputation that can silently drift.
//
// Station identity mirrors src/tests/fixtures/kazmCanonical.js (KAZM,
// 780 kHz clear channel, Class D, 5 kW, licensed NDA, no COL polygon, no
// night study, ~2 mS/m screening conductivity) — that fixture drives the
// isolated buildCanonicalCandidateResult() assembler directly; this file
// drives the same station identity through the real runSiteOptimizer()
// production path instead.
//
// NOTE on "React CandidateDetailDrawer rendering": this repo has no
// React/DOM test harness (no testing-library dependency; see package.json)
// and the existing UI-test convention (src/tests/siteOptimizerUiFormat.test.js)
// tests the pure presentation helpers CandidateDetailDrawer imports from
// src/components/ui/SiteOptimizer/format.js directly, never a DOM render.
// This file follows that same convention: it proves the DATA every
// consumer (comparison table, tower_reference, CandidateDetailDrawer's
// autofill computation, CSV export) reads is identical, and exercises the
// format.js helpers those components call on that data. It does not spin
// up a JSX render pass, consistent with the existing test suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runSiteOptimizer } from '../engine/am/siteOptimizer.js';
import { fmtCoord } from '../components/ui/SiteOptimizer/format.js';

const KAZM = {
  callsign:        'KAZM',
  frequency_khz:   780,
  current_site:    { lat: 34.86, lon: -111.82 },
  search_radius_km: 50,
  grid_spacing_km:  10,
  tpo_kw:           5,
  pattern_mode:     'NDA',
  fcc_class:        'D',
  community_of_license_polygon: null,
  optimization_goals: {
    maximize_col_coverage:        true,
    maximize_population:          true,
    minimize_blanket_population:  true,
    avoid_wildfire_risk:          false,
    prefer_high_conductivity:     true,
    minimize_int_treaty_zone:     false,
  },
};

// Single production-path run, shared across proofs (grid search + full
// scoreCandidate() pipeline is expensive; ~2 mS/m screening conductivity,
// no COL polygon, no night study — same screening posture as the fixture).
let _out = null;
async function getKAZM() {
  if (!_out) _out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  return _out;
}

/* ── Production-path sanity (item 1 of the standing final-audit spec) ── */

test('production path: KAZM resolves through the real runSiteOptimizer() entry, not a mock', async () => {
  const out = await getKAZM();
  assert.equal(out.available, true);
  assert.ok(Array.isArray(out.candidates) && out.candidates.length > 0);
  assert.ok(Array.isArray(out.candidate_comparison_table) && out.candidate_comparison_table.length > 0);
  for (const c of out.candidates) {
    assert.ok(c.canonical, `rank ${c.rank} must carry an attached canonical result`);
    assert.equal(c.canonical.schema, 'canonical-candidate-result/1');
    assert.ok(c.canonical.validation, `rank ${c.rank} canonical result must carry a validation report`);
  }
});

test('production path: longitude never renders "° E" for a candidate west of the prime meridian', async () => {
  const out = await getKAZM();
  for (const c of out.candidates) {
    if (c.lon == null) continue;
    const s = fmtCoord(c.lat, c.lon);
    if (c.lon < 0) {
      assert.match(s, /° W/, `rank ${c.rank} lon=${c.lon} must render W`);
      assert.doesNotMatch(s, /° E/, `rank ${c.rank} lon=${c.lon} must never render E`);
    }
  }
  // KAZM's current site and every candidate in this search are west of the
  // prime meridian (Arizona) — confirms fmtCoord's sign-derived hemisphere
  // logic (proven in isolation by siteOptimizerUiFormat.test.js) holds on
  // real production-path longitude values, not just synthetic inputs.
  const withCoords = out.candidates.filter(c => c.lat != null && c.lon != null);
  assert.ok(withCoords.length > 0, 'must have at least one candidate with coordinates to check');
  assert.ok(withCoords.every(c => c.lon < 0), 'sanity: all KAZM search candidates should be west longitude');
});

test('production path: blanket population is a FRACTION on canonical, never a raw percent leaking through', async () => {
  const out = await getKAZM();
  for (const c of out.candidates) {
    const frac = c.canonical?.blanket?.populationFraction;
    if (frac == null) continue;
    assert.ok(frac >= 0 && frac <= 1,
      `rank ${c.rank}: canonical.blanket.populationFraction must be a fraction in [0,1] (0.01=1%), got ${frac}`);
  }
});

test('production path: filing_ready reads the real canonical filingReadiness gate (never a hardcoded constant)', async () => {
  const out = await getKAZM();
  // Screening never runs a §73.182 night study or supplies filing-grade
  // population basis, so every candidate's filingReadiness.ready is false
  // and the response-level filing_ready must therefore also be false — but
  // it must be false BECAUSE it read the gate, not because it is a
  // hardcoded constant. Cross-check against the per-candidate gate.
  const anyReady = out.candidates.some(c => c.canonical?.filingReadiness?.ready === true);
  assert.equal(out.filing_ready, anyReady,
    'response-level filing_ready must equal "any candidate canonical.filingReadiness.ready===true", not a hardcoded value');
  for (const c of out.candidates) {
    assert.equal(c.filing_ready, c.canonical?.filingReadiness?.ready === true,
      `rank ${c.rank}: per-candidate filing_ready must equal canonical.filingReadiness.ready`);
  }
});

/* ── (a) cost sum equality ──────────────────────────────────────────── */

test('reconciliation (a): canonical.costs.total reconciles across comparison table and total_project_cost_estimate', async () => {
  const out = await getKAZM();
  const byRank = new Map(out.candidates.map(c => [c.rank, c]));
  for (const row of out.candidate_comparison_table) {
    const c = byRank.get(row.rank);
    const total = c.canonical?.costs?.total;
    assert.ok(total, `rank ${row.rank} must have canonical.costs.total`);
    assert.equal(row.cost_low_usd, total.low,
      `rank ${row.rank}: comparison table cost_low_usd must equal canonical.costs.total.low exactly`);
    assert.equal(row.cost_high_usd, total.high,
      `rank ${row.rank}: comparison table cost_high_usd must equal canonical.costs.total.high exactly`);
  }
  for (const row of out.total_project_cost_estimate.top_candidates) {
    const c = byRank.get(row.rank);
    const total = c.canonical?.costs?.total;
    assert.equal(row.total_low_usd, Math.round(total.low),
      `rank ${row.rank}: total_project_cost_estimate.total_low_usd must equal canonical.costs.total.low`);
    assert.equal(row.total_high_usd, Math.round(total.high),
      `rank ${row.rank}: total_project_cost_estimate.total_high_usd must equal canonical.costs.total.high`);
  }
});

/* ── (b) tower-height threading ─────────────────────────────────────── */

test('reconciliation (b): the same tower design height threads through tower_reference, comparison table, and canonical.antenna', async () => {
  const out = await getKAZM();
  const heightM = out.candidates[0]?.canonical?.antenna?.selectedDesignHeightM?.value;
  assert.ok(heightM != null, 'canonical.antenna.selectedDesignHeightM.value must be present');
  // tower_reference is a STATION-LEVEL summary (same height basis for every
  // candidate in a screening run — no per-candidate host/requested height
  // is supplied at screening); it is not literally design_h_m, but its
  // note field and ASR gate must be driven by the same canonical.regulatory.asr
  // record every candidate carries.
  assert.equal(out.tower_reference.asr_registration_required_at_design_height,
    out.candidates[0].canonical.regulatory.asr.required,
    'tower_reference ASR gate must equal canonical.regulatory.asr.required');
  for (const c of out.candidates) {
    assert.equal(c.canonical.antenna.selectedDesignHeightM.value, heightM,
      `rank ${c.rank}: selectedDesignHeightM must be identical across candidates at screening (no per-candidate height input supplied)`);
  }
  // Comparison table's design_h_m must equal canonical.antenna exactly.
  for (const row of out.candidate_comparison_table) {
    const c = out.candidates.find(x => x.rank === row.rank);
    assert.equal(row.design_h_m, c.canonical.antenna.selectedDesignHeightM.value,
      `rank ${row.rank}: comparison table design_h_m must equal canonical.antenna.selectedDesignHeightM.value exactly`);
  }
  // asr_required_design (the single ASR signal) must equal canonical everywhere it appears.
  for (const row of out.candidate_comparison_table) {
    const c = out.candidates.find(x => x.rank === row.rank);
    assert.equal(row.asr_required_design, c.canonical.regulatory.asr.required,
      `rank ${row.rank}: comparison table asr_required_design must equal canonical.regulatory.asr.required`);
  }
});

/* ── (c) ground-scenario threading ──────────────────────────────────── */

test('reconciliation (c): the same ground-system radial count/length threads through the comparison table and canonical.groundSystem', async () => {
  const out = await getKAZM();
  for (const row of out.candidate_comparison_table) {
    const c = out.candidates.find(x => x.rank === row.rank);
    const scenario = c.canonical.groundSystem.selectedScenario;
    assert.equal(row.gnd_recommended_radials, scenario.radialCount,
      `rank ${row.rank}: gnd_recommended_radials must equal canonical.groundSystem.selectedScenario.radialCount`);
    const expectedFt = Math.round(scenario.radialLengthM * 3.28084 * 100) / 100;
    assert.equal(row.gnd_radial_length_ft, expectedFt,
      `rank ${row.rank}: gnd_radial_length_ft must equal canonical radial length converted to feet`);
  }
});

/* ── (d) NIF decision-ID identity ───────────────────────────────────── */

test('reconciliation (d): nif_status/nif_required/nif_completion/nif_result and the comparison table all trace to the SAME canonical.regulatory.nif decision', async () => {
  const out = await getKAZM();
  for (const c of out.candidates) {
    const nif = c.canonical.regulatory.nif;
    assert.equal(c.nif_required,   nif.required,   `rank ${c.rank}: nif_required must equal canonical.regulatory.nif.required`);
    assert.equal(c.nif_completion, nif.completion, `rank ${c.rank}: nif_completion must equal canonical.regulatory.nif.completion`);
    assert.equal(c.nif_result,     nif.result,     `rank ${c.rank}: nif_result must equal canonical.regulatory.nif.result`);

    // nif_status is a DERIVED LABEL of the same decision, so it must be
    // deterministically consistent with required/completion/result — not
    // an independent classification (this is the practical, black-box
    // proof of "same source" for an integration test: the label can never
    // disagree with the fields it is supposedly derived from).
    if (nif.required === false) {
      assert.equal(c.nif_status, 'NOT REQUIRED',
        `rank ${c.rank}: nif_status must read NOT REQUIRED when canonical.regulatory.nif.required===false`);
    } else if (nif.required === true && nif.completion !== 'RUN') {
      assert.match(c.nif_status, /^REQUIRED — NOT EVALUATED/,
        `rank ${c.rank}: nif_status must lead with REQUIRED — NOT EVALUATED when required but not run`);
    }

    // The comparison-table nif_required column must also match.
    const row = out.candidate_comparison_table.find(r => r.rank === c.rank);
    assert.equal(row.nif_required, nif.required,
      `rank ${c.rank}: comparison table nif_required must equal canonical.regulatory.nif.required`);
  }
});

/* ── (e) recommendation suppression on validation failure ──────────── */

test('reconciliation (e): an internally-inconsistent canonical result never yields an advance/PASS-style recommendation', async () => {
  const out = await getKAZM();
  for (const c of out.candidates) {
    if (c.canonical.validation?.consistent !== true) {
      assert.equal(c.canonical.recommendation.level, 'SCREEN_FURTHER',
        `rank ${c.rank}: validation-inconsistent candidates must be forced to SCREEN_FURTHER, never an advance level`);
      assert.equal(c.canonical.filingReadiness?.ready, false,
        `rank ${c.rank}: validation-inconsistent candidates must never show filingReadiness.ready===true`);
    }
  }
  // Every candidate in this screening run is expected to be internally
  // consistent (production KAZM inputs are well-formed) — assert that at
  // least the validation report itself was actually run and attached, so
  // this proof is exercising real validation output, not an absent field.
  assert.ok(out.candidates.every(c => typeof c.canonical.validation?.consistent === 'boolean'),
    'every candidate must carry a validation.consistent boolean (validation actually ran)');
});

/* ── (g) canonical fractional percentage storage ────────────────────── */

test('reconciliation (g): canonical percentage-shaped values are always fractions (never a raw percent >1 in a fraction slot)', async () => {
  const out = await getKAZM();
  for (const c of out.candidates) {
    const bf = c.canonical.blanket?.populationFraction;
    if (bf != null) assert.ok(bf <= 1, `rank ${c.rank}: canonical.blanket.populationFraction must be <=1 (fraction, not percent), got ${bf}`);
    const cf = c.canonical.propagation?.coverageFraction?.value;
    if (cf != null) assert.ok(cf <= 1, `rank ${c.rank}: canonical.propagation.coverageFraction.value must be <=1, got ${cf}`);
    const bpf = c.canonical.propagation?.blanketPopulationFraction?.value;
    if (bpf != null) assert.ok(bpf <= 1, `rank ${c.rank}: canonical.propagation.blanketPopulationFraction.value must be <=1, got ${bpf}`);
    const limitFraction = c.canonical.blanket?.limitFraction;
    if (limitFraction != null) assert.ok(limitFraction <= 1, `canonical.blanket.limitFraction must be <=1, got ${limitFraction}`);
  }
});

/* ── (h) export/UI value equality (partial — see note) ──────────────── */

test('reconciliation (h): fields present in the client CSV export column set equal what the API/UI would render for the same candidate', async () => {
  // The client-side CSV export in CandidateTable.jsx builds rows directly
  // from the top-level candidate object (not candidate_comparison_table),
  // using a fixed CSV_COLS list. Mirror that list here and prove every
  // column it reads is present and, for the shared blanket/score fields,
  // consistent with the canonical-sourced values used elsewhere.
  //
  // HONEST GAP: the current CSV_COLS list does NOT include tower height,
  // radial count/length, or ASR-required at all — so full export/UI
  // equality for those specific fields cannot be exercised through this
  // export path today. That is a real, acknowledged limitation (not
  // silently glossed over): if/when those columns are added to the CSV
  // export, this test should be extended to check them against
  // candidate.canonical the same way the comparison-table reconciliation
  // tests above do.
  const out = await getKAZM();
  // 'source' is omitted from this check: CandidateTable.jsx is shared with
  // colocationOpportunities.js (GRID/INFRASTRUCTURE/HYBRID search), which
  // sets a top-level `source` marker; plain siteOptimizer.js grid-search
  // candidates (this fixture) never set it — the CSV export's esc() helper
  // already null-safes that (renders empty string), so its absence here is
  // expected, not a reconciliation defect.
  const CSV_COLS = ['rank','score','score_delta_vs_baseline','status_category',
    'distance_from_current_km','bearing_deg','cardinal_direction',
    'col_coverage_pct','col_coverage_gap_pct','blanket_population_pct','blanket_pop_risk','daytime_reach_km',
    'principal_community_5mvm_km','blanket_1000mvm_km','ground_sigma_mS_m',
    'ground_sigma_quality','ground_sigma_filing_grade','ground_radial_advisory',
    'field_at_col_centroid_mvm','estimated_daytime_population_served',
    'population_delta_vs_baseline','score_confidence',
    'lat','lon','treaty_zone',
    'minimum_tpo_for_compliance_kw','minimum_tpo_for_col_coverage_kw',
    'power_class_ceiling_kw','mpe_evaluation_required'];
  for (const c of out.candidates) {
    for (const col of CSV_COLS) {
      assert.ok(col in c, `CSV export column "${col}" must exist on the candidate object (rank ${c.rank})`);
    }
    // blanket_pop_risk (CSV-exported) is canonical-sourced (Group 4 item 1)
    // — prove it agrees with the same canonical.blanket fraction the
    // comparison table and blanket_population_pct read.
    const frac = c.canonical?.blanket?.populationFraction;
    const limit = c.canonical?.blanket?.limitFraction;
    if (frac != null && limit != null) {
      const expected = frac > limit ? 'EXCEEDS_LIMIT'
        : frac >= limit * 0.8 ? 'HIGH'
        : frac >= limit * 0.5 ? 'ELEVATED'
        : 'OK';
      assert.equal(c.blanket_pop_risk, expected,
        `rank ${c.rank}: CSV-exported blanket_pop_risk must match the canonical-derived tier`);
    }
    // score_confidence (CSV-exported) must equal the comparison table's copy.
    const row = out.candidate_comparison_table.find(r => r.rank === c.rank);
    assert.equal(c.score_confidence, row.score_confidence,
      `rank ${c.rank}: CSV-exported score_confidence must equal comparison table score_confidence`);
  }
});
