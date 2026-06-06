// Tests for the AM Co-Location Opportunity Engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runColocationOpportunities,
  __test__
} from '../engine/am/colocationOpportunities.js';

// KAZM (Sedona) — matches the seed inventory cluster.
const KAZM = { lat: 34.86, lon: -111.82 };

// A canonical request with knobs to tweak per-test.
function baseBody(overrides = {}){
  return {
    callsign: 'KAZM',
    frequency_khz: 790,
    current_site: { ...KAZM },
    search_radius_km: 50,
    grid_spacing_km: 25,
    tpo_kw: 1.0,
    pattern_mode: 'NDA',
    fcc_class: 'D',
    optimization_goals: { maximize_col_coverage: true, maximize_population: true },
    search_mode: 'INFRASTRUCTURE',
    infrastructure_source: 'MANUAL',
    candidate_limit: 30,
    ...overrides
  };
}

// ---------- Test 1 — INFRASTRUCTURE mode with empty radius ----------
test('INFRASTRUCTURE-only mode: no infrastructure in radius returns empty candidates, available:true', async () => {
  // Center mid-Atlantic so the Arizona-only inventory does not intersect.
  const out = await runColocationOpportunities(baseBody({
    current_site: { lat: 30.0, lon: -50.0 },
    search_radius_km: 100,
    search_mode: 'INFRASTRUCTURE'
  }));
  assert.equal(out.available, true);
  assert.equal(out.n_candidates_returned, 0);
  assert.deepEqual(out.candidates, []);
});

// ---------- Test 2 — INFRASTRUCTURE mode pulls and ranks the manual seed ----------
test('INFRASTRUCTURE mode pulls manual sites and returns them ranked by score (desc)', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  assert.equal(out.available, true);
  assert.ok(out.n_candidates_returned >= 1, 'at least one seed site within 50 km of KAZM');
  // Every returned candidate is sourced from the manual inventory.
  for (const c of out.candidates){
    assert.equal(c.source, 'INFRASTRUCTURE');
    assert.ok(c.infrastructure_ref && c.infrastructure_ref.id, 'each result references an inventory record');
    assert.ok(c.colocation_analysis, 'each result has colocation_analysis');
    assert.ok(c.colocation_analysis.shared_lease_advantage, 'infra candidates get the shared_lease_advantage flag');
  }
  // Strictly non-increasing score order.
  for (let i = 1; i < out.candidates.length; i++){
    assert.ok(out.candidates[i - 1].score >= out.candidates[i].score,
      `candidates[${i - 1}].score (${out.candidates[i - 1].score}) should be >= candidates[${i}].score (${out.candidates[i].score})`);
  }
});

// ---------- Test 3 — HYBRID mode returns both source types ----------
test('HYBRID mode returns both source=GRID and source=INFRASTRUCTURE candidates', async () => {
  const out = await runColocationOpportunities(baseBody({
    search_mode: 'HYBRID',
    grid_spacing_km: 20,
    search_radius_km: 40,
    candidate_limit: 200
  }));
  assert.equal(out.available, true);
  const sources = new Set(out.candidates.map((c) => c.source));
  assert.ok(sources.has('GRID'), 'expected at least one GRID candidate');
  assert.ok(sources.has('INFRASTRUCTURE'), 'expected at least one INFRASTRUCTURE candidate');
});

// ---------- Test 4 — Same-band AM host within 10 km triggers diplexing_required ----------
test('Same-band AM host within 10 km sets diplexing_required:true on that candidate', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  const kzed = out.candidates.find((c) => c.infrastructure_ref && c.infrastructure_ref.station_call === 'KZED');
  assert.ok(kzed, 'KZED seed record should appear in candidate list');
  assert.equal(kzed.colocation_analysis.diplexing_required, true);
  assert.equal(kzed.colocation_analysis.same_band_interference_risk, 'HIGH');
  assert.equal(kzed.colocation_analysis.host_kind, 'AM_SITE');
});

// ---------- Test 5 — RECOVERABLE_WITH_DA when COL fails but score is otherwise good ----------
test('Status RECOVERABLE_WITH_DA assigned when COL coverage fails but score otherwise good', () => {
  // Synthesize a candidate that fails COL coverage but otherwise looks
  // healthy, and run it through the classifier directly.
  const c = {
    lat: 34.87, lon: -111.83,
    distance_from_current_km: 15,    // within NEARBY_COMMUNITY_RADIUS_KM
    score: 80,                       // well above RECOVERY_SCORE_FLOOR (55)
    col_coverage_pct: 0.40,          // below §73.24(j) 0.80 floor
    blanket_population_pct: 0.20,    // well under §73.24(g) 1% ceiling
    daytime_reach_km: 60,
    ground_sigma_mS_m: 4,
    treaty_zone: null,
    source: 'INFRASTRUCTURE',
    colocation_analysis: {
      distance_to_host_m: 0,
      host_kind: 'TOWER',
      diplexing_required: false,
      same_band_interference_risk: 'LOW'
    }
  };
  __test__.assignStatusCategory(c, /*scoreCutoff=*/90, { current_site: KAZM });
  assert.equal(c.status_category, 'RECOVERABLE_WITH_DA');
  assert.ok(c.explanation.recovery_reasoning.includes('directional-antenna'),
    `expected reasoning to mention DA; got: ${c.explanation.recovery_reasoning}`);
});

// ---------- Test 6 — Invalid search_mode is rejected ----------
test('Invalid search_mode produces a 400-equivalent error response', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'WHATEVER' }));
  assert.equal(out.available, false);
  assert.ok(/search_mode/i.test(out.error), `expected error to mention search_mode; got: ${out.error}`);
});

// ---------- Test 7 (bonus) — ASR candidate gets regulatory note ----------
test('ASR-kind candidate carries an ASR registration regulatory note', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  const asr = out.candidates.find((c) => c.infrastructure_ref && c.infrastructure_ref.kind === 'ASR');
  assert.ok(asr, 'expected at least one ASR-kind seed candidate within radius');
  const hasAsrNote = asr.colocation_analysis.regulatory_notes
    .some((n) => /ASR/i.test(n) && /notification/i.test(n));
  assert.ok(hasAsrNote,
    `expected ASR registration note; got: ${JSON.stringify(asr.colocation_analysis.regulatory_notes)}`);
});

// ---------- Test 8 — Treaty review supersedes other categories ----------
test('Treaty zone triggers TREATY_REVIEW status', () => {
  const c = {
    lat: 32.0, lon: -106.0,
    distance_from_current_km: 200,
    score: 90,
    col_coverage_pct: 0.95,
    blanket_population_pct: 0.10,
    daytime_reach_km: 50,
    treaty_zone: 'US/MX 1986 AM Agreement',
    source: 'GRID',
    colocation_analysis: null
  };
  __test__.assignStatusCategory(c, 80, { current_site: KAZM });
  assert.equal(c.status_category, 'TREATY_REVIEW');
});

// ---------- Test 9 — RECOVERABLE_WITH_REDUCED_POWER on blanket fail ----------
test('HYBRID mode returns score_stats and optimization_confidence', async () => {
  const out = await runColocationOpportunities(baseBody({
    search_mode: 'HYBRID',
    grid_spacing_km: 25,
    search_radius_km: 40,
    candidate_limit: 30,
    optimization_goals: {
      maximize_col_coverage: true, maximize_population: true,
      minimize_blanket_population: true, minimize_int_treaty_zone: false,
      prefer_high_conductivity: true, avoid_wildfire_risk: false
    }
  }));
  assert.equal(out.available, true);
  // score_stats
  assert.ok(out.score_stats, 'score_stats must be present in HYBRID response');
  assert.ok(Number.isFinite(out.score_stats.mean),    'score_stats.mean finite');
  assert.ok(Number.isFinite(out.score_stats.std_dev), 'score_stats.std_dev finite');
  assert.ok(Number.isFinite(out.score_stats.min),     'score_stats.min finite');
  assert.ok(Number.isFinite(out.score_stats.max),     'score_stats.max finite');
  // optimization_confidence
  assert.ok(out.optimization_confidence, 'optimization_confidence must be present in HYBRID response');
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(out.optimization_confidence.level),
    `level must be HIGH/MEDIUM/LOW, got ${out.optimization_confidence.level}`);
  assert.ok(Array.isArray(out.optimization_confidence.contributing_layers));
  assert.ok(Array.isArray(out.optimization_confidence.notes));
  // conductivity_mode
  assert.ok(out.conductivity_mode === 'raster' || out.conductivity_mode === 'zone-table',
    `conductivity_mode must be 'raster' or 'zone-table', got: ${out.conductivity_mode}`);
  // n_infrastructure_sites
  assert.ok(typeof out.n_infrastructure_sites === 'number' && out.n_infrastructure_sites >= 0,
    `n_infrastructure_sites must be a non-negative number, got: ${out.n_infrastructure_sites}`);
});

test('Status RECOVERABLE_WITH_REDUCED_POWER when blanket pop fails but COL OK', () => {
  const c = {
    lat: 34.87, lon: -111.83,
    distance_from_current_km: 5,
    score: 72,
    col_coverage_pct: 0.92,
    blanket_population_pct: 1.4,     // > 1% §73.24(g) ceiling
    daytime_reach_km: 60,
    treaty_zone: null,
    source: 'INFRASTRUCTURE',
    colocation_analysis: { diplexing_required: false, same_band_interference_risk: 'LOW' }
  };
  __test__.assignStatusCategory(c, 80, { current_site: KAZM });
  assert.equal(c.status_category, 'RECOVERABLE_WITH_REDUCED_POWER');
});

// ---------- Test 11 — HYBRID candidates carry rank_percentile ----------
test('HYBRID candidates all have rank_percentile in [0,100]; rank 1 has the highest', async () => {
  const out = await runColocationOpportunities(baseBody({
    search_mode: 'HYBRID',
    grid_spacing_km: 25,
    search_radius_km: 40,
    candidate_limit: 50
  }));
  assert.equal(out.available, true);
  assert.ok(out.candidates.length > 1, 'need at least 2 candidates to check order');
  for (const c of out.candidates){
    assert.ok(Number.isFinite(c.rank_percentile),
      `rank_percentile must be finite for rank ${c.rank}`);
    assert.ok(c.rank_percentile >= 0 && c.rank_percentile <= 100,
      `rank_percentile must be in [0,100] (rank ${c.rank}, got ${c.rank_percentile})`);
  }
  const sorted = [...out.candidates].sort((a, b) => a.rank - b.rank);
  assert.ok(
    sorted[0].rank_percentile >= sorted[sorted.length - 1].rank_percentile,
    `rank 1 must have rank_percentile >= last (got ${sorted[0].rank_percentile} vs ${sorted[sorted.length - 1].rank_percentile})`
  );
});

// ---------- Test 12 — scoring_time_ms present in all modes ----------
test('scoring_time_ms is a non-negative number in INFRASTRUCTURE response', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  assert.equal(out.available, true);
  assert.ok(typeof out.scoring_time_ms === 'number' && out.scoring_time_ms >= 0,
    `scoring_time_ms must be a non-negative number, got: ${out.scoring_time_ms}`);
});

test('scoring_time_ms is a non-negative number in HYBRID response', async () => {
  const out = await runColocationOpportunities(baseBody({
    search_mode: 'HYBRID',
    grid_spacing_km: 25,
    search_radius_km: 40
  }));
  assert.equal(out.available, true);
  assert.ok(typeof out.scoring_time_ms === 'number' && out.scoring_time_ms >= 0,
    `scoring_time_ms must be a non-negative number, got: ${out.scoring_time_ms}`);
});

// ---------- Test 13 — MPE regulatory notes present on INFRASTRUCTURE candidates ----------
test('INFRASTRUCTURE candidates carry §1.1310 / OET-65 RF safety regulatory note', async () => {
  const out = await runColocationOpportunities(baseBody({
    search_mode: 'INFRASTRUCTURE',
    tpo_kw: 5.0,
    frequency_khz: 790
  }));
  assert.equal(out.available, true);
  const infra = out.candidates.filter(c => c.source === 'INFRASTRUCTURE');
  assert.ok(infra.length > 0, 'need at least one INFRASTRUCTURE candidate');
  for (const c of infra){
    const notes = c.colocation_analysis?.regulatory_notes ?? [];
    const nfNote = notes.find(n => /λ.*2π|near.field boundary/i.test(n));
    assert.ok(nfNote, `INFRASTRUCTURE candidate at (${c.lat},${c.lon}) missing near-field boundary MPE note; got: ${JSON.stringify(notes)}`);
  }
});

// ---------- Test 14 — RECOVERABLE_WITH_COL_CHANGE for distant COL fail ----------
test('Status RECOVERABLE_WITH_COL_CHANGE when COL fails and site is far from current', () => {
  // Site is > NEARBY_COMMUNITY_RADIUS_KM (25 km) away — COL polygon can be changed.
  const c = {
    lat: 34.0, lon: -112.5,                   // ~90 km south of KAZM
    distance_from_current_km: 90,
    score: 70,                                 // above RECOVERY_SCORE_FLOOR (55)
    col_coverage_pct: 0.35,                    // fails §73.24(j) 0.80 floor
    blanket_population_pct: 0.10,
    daytime_reach_km: 60,
    ground_sigma_mS_m: 6,
    treaty_zone: null,
    source: 'GRID',
    colocation_analysis: null
  };
  __test__.assignStatusCategory(c, /*scoreCutoff=*/80, { current_site: KAZM });
  assert.equal(c.status_category, 'RECOVERABLE_WITH_COL_CHANGE',
    `expected RECOVERABLE_WITH_COL_CHANGE; got ${c.status_category}`);
  assert.ok(
    c.explanation && /community.of.license/i.test(c.explanation.recovery_reasoning || ''),
    `expected recovery_reasoning to mention community of license; got: ${c.explanation?.recovery_reasoning}`
  );
});

// ---------- Test 15 — skywave_risk_level and protection_class_advisory ----------
test('INFRASTRUCTURE mode response includes skywave_risk_level and protection_class_advisory', async () => {
  const out = await runColocationOpportunities(baseBody({
    frequency_khz: 780,  // clear channel
    fcc_class: 'D',
    search_mode: 'INFRASTRUCTURE'
  }));
  assert.equal(out.available, true);
  assert.ok(['LOW', 'MODERATE', 'HIGH'].includes(out.skywave_risk_level),
    `skywave_risk_level must be LOW/MODERATE/HIGH; got: ${out.skywave_risk_level}`);
  assert.equal(out.skywave_risk_level, 'HIGH',
    '780 kHz is a §73.25 clear channel — should emit HIGH skywave risk');
  assert.ok(typeof out.protection_class_advisory === 'string' && out.protection_class_advisory.length > 20,
    `protection_class_advisory must be non-empty string; got: ${JSON.stringify(out.protection_class_advisory)}`);
  assert.ok(/§73\.182/i.test(out.protection_class_advisory),
    'advisory must mention §73.182');
});

// ---------- Test 16 — recommended_actions in response ----------
test('INFRASTRUCTURE mode response includes recommended_actions array', async () => {
  const out = await runColocationOpportunities(baseBody({
    frequency_khz: 780,
    fcc_class: 'D',
    search_mode: 'INFRASTRUCTURE'
  }));
  assert.equal(out.available, true);
  assert.ok(Array.isArray(out.recommended_actions),
    `recommended_actions must be an array; got: ${typeof out.recommended_actions}`);
  // At minimum a NIF study recommendation should appear for a clear channel station.
  const niffy = out.recommended_actions.find(a => /NIF|§73\.182|nighttime/i.test(a.action));
  assert.ok(niffy, 'recommended_actions should include a NIF study item for clear channel 780 kHz');
  // All entries must have required fields.
  for (const item of out.recommended_actions){
    assert.ok(['URGENT', 'HIGH', 'MEDIUM', 'INFORMATIONAL'].includes(item.priority),
      `item.priority must be valid; got: ${item.priority}`);
    assert.ok(typeof item.action === 'string' && item.action.length > 5,
      `item.action must be non-empty; got: ${JSON.stringify(item)}`);
    assert.ok(typeof item.rationale === 'string' && item.rationale.length > 5,
      `item.rationale must be non-empty; got: ${JSON.stringify(item)}`);
  }
});

// ---------- Test 17 — GRID mode also forwards skywave + recommended_actions ----------
test('GRID search_mode forwards skywave_risk_level + recommended_actions from siteOptimizer', async () => {
  const out = await runColocationOpportunities(baseBody({
    frequency_khz: 780,
    fcc_class: 'D',
    search_mode: 'GRID',
    grid_spacing_km: 25,
    candidate_limit: 5
  }));
  assert.equal(out.available, true);
  assert.ok(['LOW', 'MODERATE', 'HIGH'].includes(out.skywave_risk_level),
    `skywave_risk_level forwarded from siteOptimizer; got: ${out.skywave_risk_level}`);
  assert.equal(out.skywave_risk_level, 'HIGH', '780 kHz clear channel → HIGH');
  assert.ok(Array.isArray(out.recommended_actions),
    `recommended_actions must be array in GRID mode; got: ${typeof out.recommended_actions}`);
});

// ---------- Test 18 — assignStatusCategory sets nif_status ----------
test('assignStatusCategory sets nif_status aligned with status_category', () => {
  const promisingC = {
    lat: 34.87, lon: -111.83, distance_from_current_km: 5,
    score: 95, col_coverage_pct: 0.92, blanket_population_pct: 0.2,
    daytime_reach_km: 60, ground_sigma_mS_m: 8, treaty_zone: null,
    source: 'INFRASTRUCTURE',
    colocation_analysis: { diplexing_required: false, same_band_interference_risk: 'LOW' }
  };
  __test__.assignStatusCategory(promisingC, /*scoreCutoff=*/80, { current_site: KAZM });
  assert.equal(promisingC.status_category, 'PROMISING');
  assert.equal(promisingC.nif_status, 'PROMISING',
    `PROMISING candidate should have nif_status='PROMISING'; got: ${promisingC.nif_status}`);

  const nonCompliantC = {
    lat: 34.87, lon: -111.83, distance_from_current_km: 5,
    score: 90, col_coverage_pct: 0.30, blanket_population_pct: 0.2,
    daytime_reach_km: 60, ground_sigma_mS_m: 8, treaty_zone: null,
    source: 'INFRASTRUCTURE',
    colocation_analysis: { diplexing_required: false, same_band_interference_risk: 'LOW' }
  };
  __test__.assignStatusCategory(nonCompliantC, /*scoreCutoff=*/80, { current_site: KAZM });
  // Status depends on distance and minimum_tpo_for_col_coverage_kw.
  assert.ok(['RECOVERABLE_WITH_DA', 'RECOVERABLE_WITH_COL_CHANGE', 'NON_COMPLIANT',
    'RECOVERABLE_WITH_POWER_INCREASE'].includes(nonCompliantC.status_category),
    `expected a recovery or NON_COMPLIANT category; got: ${nonCompliantC.status_category}`);
  assert.equal(nonCompliantC.nif_status, 'NON-COMPLIANT',
    `recovery/non-compliant candidate should have nif_status='NON-COMPLIANT'; got: ${nonCompliantC.nif_status}`);
});

// ---------- Test 19 — RECOVERABLE_WITH_POWER_INCREASE in colocation engine ----------
test('RECOVERABLE_WITH_POWER_INCREASE assigned when minimum_tpo_for_col_coverage_kw is set', () => {
  const c = {
    lat: 34.87, lon: -111.83, distance_from_current_km: 10,
    score: 80,
    col_coverage_pct: 0.60,          // below §73.24(j) 0.80 floor
    blanket_population_pct: 0.20,    // OK
    daytime_reach_km: 50,
    ground_sigma_mS_m: 6,
    treaty_zone: null,
    minimum_tpo_for_col_coverage_kw: 12.5,  // engine found a fix
    source: 'INFRASTRUCTURE',
    colocation_analysis: { diplexing_required: false, same_band_interference_risk: 'LOW' }
  };
  __test__.assignStatusCategory(c, /*scoreCutoff=*/90, { current_site: KAZM });
  assert.equal(c.status_category, 'RECOVERABLE_WITH_POWER_INCREASE',
    `candidate with minimum_tpo_for_col_coverage_kw set should be RECOVERABLE_WITH_POWER_INCREASE; got: ${c.status_category}`);
  assert.ok(c.explanation.recovery_reasoning.includes('12.5'),
    `recovery_reasoning should cite the minimum TPO; got: ${c.explanation.recovery_reasoning}`);
  assert.equal(c.nif_status, 'NON-COMPLIANT',
    `RECOVERABLE_WITH_POWER_INCREASE should have nif_status='NON-COMPLIANT'; got: ${c.nif_status}`);
});

// ---------- Test 20 — nif_status enriched with skywave risk in INFRASTRUCTURE response ----------
test('nif_status includes skywave risk suffix in INFRASTRUCTURE response for clear channel', async () => {
  const out = await runColocationOpportunities(baseBody({
    frequency_khz: 780,
    fcc_class: 'A',
    search_mode: 'INFRASTRUCTURE',
    candidate_limit: 5
  }));
  assert.equal(out.available, true);
  for (const c of out.candidates){
    // Every candidate whose nif_status is not SCREENING ONLY should include skywave risk.
    if (c.nif_status && c.nif_status !== 'SCREENING ONLY'){
      assert.ok(/HIGH skywave risk/i.test(c.nif_status) || /TREATY/i.test(c.nif_status),
        `nif_status for Class A clear-channel INFRA candidate should mention HIGH skywave risk; rank ${c.rank} got: "${c.nif_status}"`);
    }
  }
});

// ---------- Test 21 — co_siting_complexity present on INFRASTRUCTURE candidates ----------
test('INFRASTRUCTURE candidates carry co_siting_complexity with score and label', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  assert.equal(out.available, true);
  assert.ok(out.candidates.length >= 1, 'need at least one INFRASTRUCTURE candidate');
  for (const c of out.candidates){
    assert.ok(c.colocation_analysis, `candidate rank ${c.rank} missing colocation_analysis`);
    const csc = c.colocation_analysis.co_siting_complexity;
    assert.ok(csc, `candidate rank ${c.rank} missing co_siting_complexity`);
    assert.ok(typeof csc.score === 'number', `co_siting_complexity.score must be a number; got: ${typeof csc.score}`);
    assert.ok(csc.score >= 0 && csc.score <= 10,
      `co_siting_complexity.score must be in [0,10]; got: ${csc.score}`);
    assert.ok(typeof csc.label === 'string' && csc.label.length > 0,
      `co_siting_complexity.label must be non-empty string; got: ${JSON.stringify(csc.label)}`);
    assert.ok(/LOW|MODERATE|HIGH/i.test(csc.label),
      `co_siting_complexity.label must start with LOW/MODERATE/HIGH; got: "${csc.label}"`);
  }
});

// ---------- Test 22 — co_siting_complexity score increases with complexity drivers ----------
test('co_siting_complexity.score is higher for diplexing+interference than for clean host', () => {
  // KZED is same-band AM within diplex radius → high complexity
  const outKazm = runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  return outKazm.then(out => {
    const kzed = out.candidates.find(c => c.infrastructure_ref?.station_call === 'KZED');
    assert.ok(kzed, 'KZED seed must be present in INFRASTRUCTURE results');
    const kzedScore = kzed.colocation_analysis.co_siting_complexity.score;
    // diplexing(+3) + HIGH interference(+3) = at least 6
    assert.ok(kzedScore >= 6,
      `KZED same-band AM co_siting_complexity.score should be >= 6; got ${kzedScore}`);
    assert.ok(/HIGH/i.test(kzed.colocation_analysis.co_siting_complexity.label),
      `KZED label should be HIGH; got: "${kzed.colocation_analysis.co_siting_complexity.label}"`);
  });
});

// ---------- Test 23 — lease_synergy_advisory present on INFRASTRUCTURE candidates ----------
test('INFRASTRUCTURE candidates carry lease_synergy_advisory string', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const lsa = c.colocation_analysis?.lease_synergy_advisory;
    assert.ok(typeof lsa === 'string' && lsa.length > 10,
      `lease_synergy_advisory must be non-empty string on rank ${c.rank}; got: ${JSON.stringify(lsa)}`);
  }
});

// ---------- Test 24 — AM_SITE host gets STRONG lease_synergy_advisory ----------
test('AM_SITE host gets STRONG lease_synergy_advisory', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  const amSites = out.candidates.filter(c => c.infrastructure_ref?.kind === 'AM_SITE');
  assert.ok(amSites.length >= 1, 'need at least one AM_SITE host in the seed inventory');
  for (const c of amSites){
    assert.ok(/STRONG/i.test(c.colocation_analysis.lease_synergy_advisory),
      `AM_SITE host should have STRONG lease_synergy_advisory; got: "${c.colocation_analysis.lease_synergy_advisory}"`);
  }
});

// ---------- Test 25 — GRID candidates do NOT carry co_siting_complexity ----------
test('GRID candidates do not have co_siting_complexity (only INFRASTRUCTURE sources get it)', async () => {
  const out = await runColocationOpportunities(baseBody({
    search_mode: 'HYBRID',
    grid_spacing_km: 25,
    search_radius_km: 40,
    candidate_limit: 50
  }));
  assert.equal(out.available, true);
  const gridCandidates = out.candidates.filter(c => c.source === 'GRID');
  assert.ok(gridCandidates.length >= 1, 'need at least one GRID candidate in HYBRID mode');
  for (const c of gridCandidates){
    assert.ok(!c.colocation_analysis?.co_siting_complexity,
      `GRID candidate rank ${c.rank} should not have co_siting_complexity; got: ${JSON.stringify(c.colocation_analysis?.co_siting_complexity)}`);
    assert.ok(!c.colocation_analysis?.lease_synergy_advisory,
      `GRID candidate rank ${c.rank} should not have lease_synergy_advisory`);
  }
});

// ---------- Test 26 — candidate_shortlist ----------
test('candidate_shortlist is present in INFRASTRUCTURE mode response', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  assert.equal(out.available, true);
  assert.ok(Array.isArray(out.candidate_shortlist),
    'candidate_shortlist must be an array');
  assert.ok(out.candidate_shortlist.length <= 3,
    `candidate_shortlist must have ≤3 entries; got ${out.candidate_shortlist.length}`);
  for (const entry of out.candidate_shortlist){
    assert.ok(typeof entry.rank === 'number', 'shortlist entry must have numeric rank');
    assert.ok(typeof entry.status_category === 'string', 'shortlist entry must have status_category');
    assert.ok(typeof entry.summary === 'string' && entry.summary.length > 5, 'shortlist entry must have summary');
    assert.ok(typeof entry.recommended_next_step === 'string', 'shortlist entry must have recommended_next_step');
    assert.ok(typeof entry.source === 'string', 'shortlist entry must have source field');
  }
});

// ---------- Test 27 — minimum_spacing_reference in INFRASTRUCTURE mode ----------
test('minimum_spacing_reference is present in INFRASTRUCTURE mode response', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  assert.equal(out.available, true);
  assert.ok(out.minimum_spacing_reference != null,
    'minimum_spacing_reference must be present in colocation INFRASTRUCTURE response');
  assert.ok(typeof out.minimum_spacing_reference.rule === 'string',
    'minimum_spacing_reference.rule must be a string');
  assert.ok(Array.isArray(out.minimum_spacing_reference.co_channel),
    'minimum_spacing_reference.co_channel must be an array');
});

// ---------- Test 28 — candidate_shortlist in HYBRID mode ----------
test('candidate_shortlist is present in HYBRID mode and entries have source field', async () => {
  const out = await runColocationOpportunities(baseBody({ search_mode: 'HYBRID' }));
  assert.equal(out.available, true);
  assert.ok(Array.isArray(out.candidate_shortlist), 'candidate_shortlist must be array in HYBRID mode');
  for (const entry of out.candidate_shortlist){
    assert.ok(['INFRASTRUCTURE', 'GRID'].includes(entry.source),
      `shortlist entry.source must be INFRASTRUCTURE or GRID; got '${entry.source}'`);
  }
});

// ---------- Test 29 — new optimizer fields propagate through colocation ----------

test('colocation candidates have land_use_classification and estimated_erp_kw', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true, maximize_population: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(c.land_use_classification != null,
      `colocation candidate rank ${c.rank} missing land_use_classification`);
    assert.ok(c.antenna_system_summary?.estimated_erp_kw != null,
      `colocation candidate rank ${c.rank} missing estimated_erp_kw`);
    assert.ok(c.nighttime_classification != null,
      `colocation candidate rank ${c.rank} missing nighttime_classification`);
  }
});

// ---------- Test 30 — session optimizer enrichments in colocation ----------

test('colocation candidates have site_viability_summary and tower_cost_estimate', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true, maximize_population: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.site_viability_summary != null,
      `colocation candidate rank ${c.rank} missing site_viability_summary`);
    assert.ok(c.tower_cost_estimate != null,
      `colocation candidate rank ${c.rank} missing tower_cost_estimate`);
    assert.ok(c.power_upgrade_analysis != null,
      `colocation candidate rank ${c.rank} missing power_upgrade_analysis`);
  }
});

// ---------- Test 31 — colocation response has regulatory_timeline_estimate ----------

test('colocation response has regulatory_timeline_estimate', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  assert.ok(out.regulatory_timeline_estimate != null,
    'colocation response must have regulatory_timeline_estimate');
  assert.ok(Array.isArray(out.regulatory_timeline_estimate.phases),
    'regulatory_timeline_estimate.phases must be an array');
});

// ---------- Test 32 — population_reach_bands in colocation candidates ----------

test('colocation candidates have population_reach_bands with 5 entries', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.population_reach_bands?.bands?.length === 5,
      `colocation candidate rank ${c.rank} should have 5 population_reach_bands`);
  }
});
