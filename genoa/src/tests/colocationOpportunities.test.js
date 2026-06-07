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

// ---------- Test 33 — directional_antenna_study_guide in colocation candidates ----------

test('colocation candidates have directional_antenna_study_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.directional_antenna_study_guide;
    assert.ok(g != null, `colocation candidate rank ${c.rank} missing directional_antenna_study_guide`);
    assert.ok(typeof g.recommended === 'boolean', `directional_antenna_study_guide.recommended must be boolean`);
  }
});

// ---------- Test 34 — skywave_protection_advisory in colocation candidates ----------

test('colocation candidates have skywave_protection_advisory', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const validLevels = new Set(['NONE', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
  for (const c of out.candidates) {
    const s = c.skywave_protection_advisory;
    assert.ok(s != null, `colocation candidate rank ${c.rank} missing skywave_protection_advisory`);
    assert.ok(validLevels.has(s.advisory_level), `advisory_level "${s.advisory_level}" must be valid`);
    assert.ok(typeof s.nif_required === 'boolean', `nif_required must be boolean`);
  }
});

// ---------- Test 35 — filing_complexity_score in colocation response ----------

test('colocation response has filing_complexity_score', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const fcs = out.filing_complexity_score;
  assert.ok(fcs != null, 'colocation response must have filing_complexity_score');
  assert.ok(typeof fcs.total_score === 'number' && fcs.total_score >= 0 && fcs.total_score <= 100,
    'total_score must be in [0,100]');
  assert.ok(['LOW','MODERATE','HIGH','VERY_HIGH'].includes(fcs.complexity_tier),
    `complexity_tier "${fcs.complexity_tier}" must be valid`);
});

// ---------- Test 36 — geographic_diversity_analysis in colocation response ----------

test('colocation response has geographic_diversity_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const gd = out.geographic_diversity_analysis;
  assert.ok(gd != null, 'geographic_diversity_analysis must be present on colocation response');
  assert.ok(typeof gd.diversity_score === 'number', 'diversity_score must be a number');
  assert.ok(['EXCELLENT','GOOD','MODERATE','POOR'].includes(gd.diversity_tier), 'diversity_tier must be valid');
  assert.ok(gd.quadrant_summary != null, 'quadrant_summary must be present');
  for (const q of ['NE','SE','SW','NW']) {
    assert.ok(q in gd.quadrant_summary, `quadrant_summary must have entry for ${q}`);
  }
});

// ---------- Test 37 — comparison table has new columns ----------

test('colocation comparison table has da_study_recommended and skywave_advisory_level', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table) {
    assert.ok('da_study_recommended' in row, 'da_study_recommended must be in comparison table');
    assert.ok('da_study_type' in row, 'da_study_type must be in comparison table');
    assert.ok('skywave_advisory_level' in row, 'skywave_advisory_level must be in comparison table');
  }
});

// ---------- Test 38 — candidate_set_recommendation in colocation response ----------

test('colocation response has candidate_set_recommendation', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const csr = out.candidate_set_recommendation;
  assert.ok(csr != null, 'candidate_set_recommendation must be present on colocation response');
  assert.ok(typeof csr.overall_guidance === 'string', 'overall_guidance must be a string');
  assert.ok(typeof csr.n_advance_ready === 'number', 'n_advance_ready must be a number');
  assert.ok(Array.isArray(csr.candidates), 'candidates must be an array');
  for (const e of csr.candidates) {
    assert.ok(['ADVANCE_IMMEDIATELY','ADVANCE_AFTER_REMEDY','HOLD','MONITOR'].includes(e.priority),
      `priority "${e.priority}" must be valid for rank ${e.rank}`);
  }
});

test('colocation GRID candidates have fcc_lms_filing_checklist', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.fcc_lms_filing_checklist != null, `rank ${c.rank} missing fcc_lms_filing_checklist`);
    assert.ok(Array.isArray(c.fcc_lms_filing_checklist.items), `rank ${c.rank} fcc_lms_filing_checklist.items must be array`);
  }
});

test('colocation GRID candidates have seasonal_propagation_summary', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.seasonal_propagation_summary != null, `rank ${c.rank} missing seasonal_propagation_summary`);
    assert.ok(['HIGH', 'MODERATE', 'LOW'].includes(c.seasonal_propagation_summary.col_compliance_risk_tier),
      `rank ${c.rank} invalid col_compliance_risk_tier`);
  }
});

test('colocation GRID candidates have fcc_class_power_ceiling_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.fcc_class_power_ceiling_analysis != null, `rank ${c.rank} missing fcc_class_power_ceiling_analysis`);
    assert.equal(c.fcc_class_power_ceiling_analysis.class_power_ceiling_kw, 50, `rank ${c.rank} Class D ceiling must be 50 kW`);
    assert.ok(['NONE','LIMITED','SIGNIFICANT'].includes(c.fcc_class_power_ceiling_analysis.upgrade_feasibility),
      `rank ${c.rank} invalid upgrade_feasibility`);
  }
});

test('colocation GRID candidates have technical_proof_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.technical_proof_guide != null, `rank ${c.rank} missing technical_proof_guide`);
    assert.ok(['NDA','DA'].includes(c.technical_proof_guide.antenna_mode), `rank ${c.rank} invalid antenna_mode`);
    assert.ok(c.technical_proof_guide.n_proof_radials > 0, `rank ${c.rank} n_proof_radials must be positive`);
  }
});

test('colocation GRID candidates have site_acquisition_checklist', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.site_acquisition_checklist != null, `rank ${c.rank} missing site_acquisition_checklist`);
    assert.ok(Array.isArray(c.site_acquisition_checklist.items), `rank ${c.rank} site_acquisition_checklist.items must be array`);
    assert.ok(c.site_acquisition_checklist.critical_count > 0, `rank ${c.rank} critical_count must be > 0`);
  }
});

test('colocation GRID candidates have spectrum_interference_summary', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.spectrum_interference_summary != null, `rank ${c.rank} missing spectrum_interference_summary`);
    assert.ok(['HIGH','ELEVATED','MODERATE','LOW'].includes(c.spectrum_interference_summary.interference_risk_tier),
              `rank ${c.rank} invalid interference_risk_tier`);
    assert.equal(c.spectrum_interference_summary.separation_rules.length, 3, `rank ${c.rank} must have 3 separation rules`);
  }
});

test('colocation GRID candidates have colocation_compatibility_score', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.colocation_compatibility_score != null, `rank ${c.rank} missing colocation_compatibility_score`);
    assert.equal(c.colocation_compatibility_score.host_scores.length, 5, `rank ${c.rank} must have 5 host scores`);
    assert.ok(['GOOD','FAIR','POOR'].includes(c.colocation_compatibility_score.best_host_tier),
              `rank ${c.rank} invalid best_host_tier`);
  }
});

test('colocation GRID candidates have environmental_risk_matrix', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.environmental_risk_matrix != null, `rank ${c.rank} missing environmental_risk_matrix`);
    assert.equal(c.environmental_risk_matrix.items.length, 13, `rank ${c.rank} must have 13 NEPA items`);
  }
});

test('colocation GRID candidates have financial_feasibility_summary', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.financial_feasibility_summary != null, `rank ${c.rank} missing financial_feasibility_summary`);
    assert.ok(c.financial_feasibility_summary.total_buy_high_usd > 0, `rank ${c.rank} total must be positive`);
    assert.ok(Array.isArray(c.financial_feasibility_summary.line_items), `rank ${c.rank} line_items must be array`);
  }
});

test('colocation GRID candidates have candidate_scoring_audit', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.candidate_scoring_audit != null, `rank ${c.rank} missing candidate_scoring_audit`);
    assert.ok(Array.isArray(c.candidate_scoring_audit.goal_details), `rank ${c.rank} goal_details must be array`);
    assert.strictEqual(c.candidate_scoring_audit.goal_details.length, 6, `rank ${c.rank} must have 6 goal detail entries`);
  }
});

test('colocation GRID candidates have regulatory_compliance_checklist', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.regulatory_compliance_checklist != null, `rank ${c.rank} missing regulatory_compliance_checklist`);
    assert.strictEqual(c.regulatory_compliance_checklist.items.length, 12, `rank ${c.rank} must have 12 checklist items`);
  }
});

test('colocation GRID candidates have ground_system_design_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.ground_system_design_guide != null, `rank ${c.rank} missing ground_system_design_guide`);
    assert.strictEqual(c.ground_system_design_guide.scenarios.length, 3, `rank ${c.rank} must have 3 radial scenarios`);
  }
});

test('colocation GRID candidates have tower_structural_assessment_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.tower_structural_assessment_guide != null, `rank ${c.rank} missing tower_structural_assessment_guide`);
    assert.ok(c.tower_structural_assessment_guide.tower_types.length === 3, `rank ${c.rank} must have 3 tower type entries`);
  }
});

test('colocation GRID candidates have community_of_license_profile', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.community_of_license_profile != null, `rank ${c.rank} missing community_of_license_profile`);
    assert.ok(c.community_of_license_profile.geographic_tier != null, `rank ${c.rank} missing geographic_tier`);
  }
});

test('colocation GRID candidates have atmospheric_noise_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.atmospheric_noise_analysis != null, `rank ${c.rank} missing atmospheric_noise_analysis`);
    assert.ok(c.atmospheric_noise_analysis.effective_noise_fa_day > 0, `rank ${c.rank} Fa_day must be positive`);
  }
});

test('colocation GRID candidates have proof_of_performance_requirements', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.proof_of_performance_requirements != null, `rank ${c.rank} missing proof_of_performance_requirements`);
    assert.strictEqual(c.proof_of_performance_requirements.traversal_spec.radial_count, 8, `rank ${c.rank} NDA must have 8 radials`);
  }
});

test('colocation GRID candidates have operational_monitoring_requirements', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.operational_monitoring_requirements != null, `rank ${c.rank} missing operational_monitoring_requirements`);
    assert.strictEqual(c.operational_monitoring_requirements.monitoring_items.length, 6, `rank ${c.rank} must have 6 monitoring items`);
  }
});

test('colocation GRID candidates have da_array_design_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'DA-D',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.da_array_design_guide != null, `rank ${c.rank} missing da_array_design_guide`);
    assert.strictEqual(c.da_array_design_guide.applicable, true, `rank ${c.rank} DA-D must have applicable=true`);
    assert.strictEqual(c.da_array_design_guide.n_hrp_radials, 36, `rank ${c.rank} must have 36 HRP radials`);
  }
});

test('colocation GRID candidates have am_fm_translator_opportunity', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.am_fm_translator_opportunity != null, `rank ${c.rank} missing am_fm_translator_opportunity`);
    assert.strictEqual(c.am_fm_translator_opportunity.am_revitalization_eligible, true, `rank ${c.rank} must be eligible`);
  }
});

test('colocation GRID candidates have spacing_rule_compliance_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.spacing_rule_compliance_guide != null, `rank ${c.rank} missing spacing_rule_compliance_guide`);
    assert.ok(c.spacing_rule_compliance_guide.spacing_table.length === 4, `rank ${c.rank} spacing table must have 4 rows`);
  }
});

test('colocation GRID candidates have license_class_upgrade_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.license_class_upgrade_analysis != null, `rank ${c.rank} missing license_class_upgrade_analysis`);
    assert.ok(c.license_class_upgrade_analysis.upgrade_paths.length > 0, `rank ${c.rank} must have upgrade paths`);
  }
});

test('colocation GRID candidates have soil_conductivity_improvement_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.soil_conductivity_improvement_guide != null, `rank ${c.rank} missing soil_conductivity_improvement_guide`);
    assert.ok(c.soil_conductivity_improvement_guide.techniques.length > 0, `rank ${c.rank} must have applicable techniques`);
  }
});

test('colocation GRID candidates have transmitter_facility_design_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.transmitter_facility_design_guide != null, `rank ${c.rank} missing transmitter_facility_design_guide`);
    assert.ok(c.transmitter_facility_design_guide.fencing.required === true, `rank ${c.rank} must require fencing at 5 kW`);
  }
});

test('colocation GRID candidates have coverage_service_area_map_spec', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.coverage_service_area_map_spec != null, `rank ${c.rank} missing coverage_service_area_map_spec`);
    assert.strictEqual(c.coverage_service_area_map_spec.n_contours, 4, `rank ${c.rank} must have 4 contours`);
  }
});

test('colocation GRID candidates have iboc_hd_radio_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.iboc_hd_radio_analysis != null, `rank ${c.rank} missing iboc_hd_radio_analysis`);
    assert.strictEqual(c.iboc_hd_radio_analysis.applicable, true, `rank ${c.rank} IBOC must be applicable`);
  }
});

test('colocation GRID candidates have co_channel_interference_budget', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.co_channel_interference_budget != null, `rank ${c.rank} missing co_channel_interference_budget`);
    assert.ok(c.co_channel_interference_budget.required_cc_spacing_km > 0, `rank ${c.rank} cc spacing must be positive`);
  }
});

test('colocation GRID candidates have construction_permit_timeline_optimizer', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.construction_permit_timeline_optimizer != null, `rank ${c.rank} missing construction_permit_timeline_optimizer`);
    assert.strictEqual(c.construction_permit_timeline_optimizer.n_phases, 6, `rank ${c.rank} must have 6 phases`);
  }
});

test('colocation GRID candidates have radial_system_engineering_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.radial_system_engineering_guide != null, `rank ${c.rank} missing radial_system_engineering_guide`);
    assert.ok(c.radial_system_engineering_guide.recommended_n_radials > 0, `rank ${c.rank} radial count must be positive`);
  }
});

test('colocation GRID candidates have skywave_coverage_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.skywave_coverage_analysis != null, `rank ${c.rank} missing skywave_coverage_analysis`);
    assert.ok(c.skywave_coverage_analysis.skywave_dist_50pct_km > 0, `rank ${c.rank} skywave distance must be positive`);
  }
});

test('colocation GRID candidates have eas_acp_compliance_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.eas_acp_compliance_guide != null, `rank ${c.rank} missing eas_acp_compliance_guide`);
    assert.strictEqual(c.eas_acp_compliance_guide.eas_participation, 'MANDATORY', `rank ${c.rank} EAS must be MANDATORY`);
  }
});

test('colocation GRID candidates have tower_lighting_marking_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.tower_lighting_marking_guide != null, `rank ${c.rank} missing tower_lighting_marking_guide`);
    assert.ok(c.tower_lighting_marking_guide.tower_height_estimate_m > 0, `rank ${c.rank} tower height must be positive`);
  }
});

test('colocation GRID candidates have rf_exposure_mpe_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.rf_exposure_mpe_analysis != null, `rank ${c.rank} missing rf_exposure_mpe_analysis`);
    assert.ok(c.rf_exposure_mpe_analysis.exclusion_radius_m > 0, `rank ${c.rank} exclusion radius must be positive`);
  }
});

test('colocation GRID candidates have station_relocation_cost_estimator', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.station_relocation_cost_estimator != null, `rank ${c.rank} missing station_relocation_cost_estimator`);
    assert.ok(c.station_relocation_cost_estimator.total_low > 0, `rank ${c.rank} relocation cost must be positive`);
  }
});

test('colocation GRID candidates have power_line_interference_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.power_line_interference_analysis != null, `rank ${c.rank} missing power_line_interference_analysis`);
    assert.ok(c.power_line_interference_analysis.recommended_min_distance_m > 0, `rank ${c.rank} min distance must be positive`);
  }
});

test('colocation GRID candidates have environmental_impact_assessment', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.environmental_impact_assessment != null, `rank ${c.rank} missing environmental_impact_assessment`);
    assert.strictEqual(c.environmental_impact_assessment.n_nepa_exclusions, 8, `rank ${c.rank} must have 8 NEPA triggers`);
  }
});

test('colocation GRID candidates have site_security_perimeter_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.site_security_perimeter_guide != null, `rank ${c.rank} missing site_security_perimeter_guide`);
    assert.ok(c.site_security_perimeter_guide.perimeter_m > 0, `rank ${c.rank} perimeter_m must be positive`);
  }
});

test('colocation GRID candidates have insurance_liability_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.insurance_liability_analysis != null, `rank ${c.rank} missing insurance_liability_analysis`);
    assert.ok(c.insurance_liability_analysis.total_annual_premium_usd > 0, `rank ${c.rank} annual premium must be positive`);
  }
});

test('colocation GRID candidates have directional_antenna_proof_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.directional_antenna_proof_guide != null, `rank ${c.rank} missing directional_antenna_proof_guide`);
    // NDA pattern → applicable=false
    assert.strictEqual(c.directional_antenna_proof_guide.applicable, false, `rank ${c.rank} NDA pattern must not require DA proof`);
  }
});

test('colocation GRID candidates have tower_structural_analysis_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.tower_structural_analysis_guide != null, `rank ${c.rank} missing tower_structural_analysis_guide`);
    assert.ok(c.tower_structural_analysis_guide.tower_height_m > 0, `rank ${c.rank} tower_height_m must be positive`);
  }
});

test('colocation GRID candidates have rf_exposure_compliance_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.rf_exposure_compliance_guide != null, `rank ${c.rank} missing rf_exposure_compliance_guide`);
    assert.ok(c.rf_exposure_compliance_guide.exclusion_radius_gp_m > 0, `rank ${c.rank} GP exclusion radius must be positive`);
  }
});

test('colocation GRID candidates have property_acquisition_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.property_acquisition_guide != null, `rank ${c.rank} missing property_acquisition_guide`);
    assert.ok(c.property_acquisition_guide.min_site_area_acres > 0, `rank ${c.rank} min site area must be positive`);
  }
});

test('colocation GRID candidates have nighttime_pattern_switching_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.nighttime_pattern_switching_guide != null, `rank ${c.rank} missing nighttime_pattern_switching_guide`);
    assert.ok(typeof c.nighttime_pattern_switching_guide.power_reduction_required === 'boolean', `rank ${c.rank} power_reduction_required must be boolean`);
  }
});

test('colocation GRID candidates have license_renewal_compliance_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.license_renewal_compliance_guide != null, `rank ${c.rank} missing license_renewal_compliance_guide`);
    assert.strictEqual(c.license_renewal_compliance_guide.license_term_years, 8, `rank ${c.rank} must have 8-year license term`);
  }
});

test('colocation GRID candidates have am_coverage_optimization_by_tower_height_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA', fcc_class: 'D',
    search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.am_coverage_optimization_by_tower_height_guide != null, `rank ${c.rank} missing am_coverage_optimization_by_tower_height_guide`);
    assert.strictEqual(c.am_coverage_optimization_by_tower_height_guide.lambda_quarter_m, 96, `rank ${c.rank} lambda_quarter_m must be 96 m`);
    assert.ok(c.am_coverage_optimization_by_tower_height_guide.n_height_milestones >= 3, `rank ${c.rank} should have height milestones`);
  }
});

test('colocation GRID candidates have spectrum_monitoring_and_frequency_drift_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA', fcc_class: 'D',
    search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.spectrum_monitoring_and_frequency_drift_guide != null, `rank ${c.rank} missing spectrum_monitoring_and_frequency_drift_guide`);
    assert.strictEqual(c.spectrum_monitoring_and_frequency_drift_guide.tolerance_hz, 20, `rank ${c.rank} tolerance_hz must be 20`);
    assert.ok(c.spectrum_monitoring_and_frequency_drift_guide.n_monitoring_methods >= 2, `rank ${c.rank} should have monitoring methods`);
  }
});

test('colocation GRID candidates have broadcast_attorney_and_consulting_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.broadcast_attorney_and_consulting_guide != null, `rank ${c.rank} missing broadcast_attorney_and_consulting_guide`);
    assert.ok(c.broadcast_attorney_and_consulting_guide.combined_total_usd.typical > 0, `rank ${c.rank} combined professional fees must be positive`);
  }
});

test('colocation GRID candidates have zoning_and_land_use_compliance_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.zoning_and_land_use_compliance_guide != null, `rank ${c.rank} missing zoning_and_land_use_compliance_guide`);
    assert.strictEqual(c.zoning_and_land_use_compliance_guide.tca_preemption_applies, false, `rank ${c.rank} TCA §332 must not apply to AM towers`);
  }
});

test('colocation GRID candidates have faa_obstruction_marking_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.faa_obstruction_marking_guide != null, `rank ${c.rank} missing faa_obstruction_marking_guide`);
    assert.ok(c.faa_obstruction_marking_guide.tower_height_ft > 0, `rank ${c.rank} tower height must be positive`);
  }
});

test('colocation GRID candidates have antenna_tuning_unit_commissioning_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.antenna_tuning_unit_commissioning_guide != null, `rank ${c.rank} missing antenna_tuning_unit_commissioning_guide`);
    assert.strictEqual(c.antenna_tuning_unit_commissioning_guide.base_resistance_ohm_typical, 36, `rank ${c.rank} base resistance must be 36Ω`);
  }
});

test('colocation GRID candidates have tower_construction_contract_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.tower_construction_contract_guide != null, `rank ${c.rank} missing tower_construction_contract_guide`);
    assert.ok(c.tower_construction_contract_guide.total_estimated_cost_usd.typical > 0, `rank ${c.rank} construction cost must be positive`);
  }
});

test('colocation GRID candidates have ground_radial_installation_cost_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.ground_radial_installation_cost_guide != null, `rank ${c.rank} missing ground_radial_installation_cost_guide`);
    assert.strictEqual(c.ground_radial_installation_cost_guide.n_radials, 120, `rank ${c.rank} must have 120 radials`);
  }
});

test('colocation GRID candidates have frequency_coordination_with_adjacent_stations_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.frequency_coordination_with_adjacent_stations_guide != null, `rank ${c.rank} missing frequency_coordination_with_adjacent_stations_guide`);
    assert.strictEqual(c.frequency_coordination_with_adjacent_stations_guide.channel_type, 'CLEAR', `rank ${c.rank} 780kHz must be CLEAR channel`);
  }
});

test('colocation GRID candidates have remote_control_authority_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.remote_control_authority_guide != null, `rank ${c.rank} missing remote_control_authority_guide`);
    assert.strictEqual(c.remote_control_authority_guide.remote_control_authorized, true, `rank ${c.rank} remote control must be authorized`);
  }
});

test('colocation GRID candidates have fcc_silent_station_authorization_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.fcc_silent_station_authorization_guide != null, `rank ${c.rank} missing fcc_silent_station_authorization_guide`);
    assert.strictEqual(c.fcc_silent_station_authorization_guide.sta_required, true, `rank ${c.rank} STA must be required`);
  }
});

test('colocation GRID candidates have antenna_rfi_from_nearby_equipment_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.antenna_rfi_from_nearby_equipment_guide != null, `rank ${c.rank} missing antenna_rfi_from_nearby_equipment_guide`);
    assert.strictEqual(c.antenna_rfi_from_nearby_equipment_guide.frequency_sensitivity, 'HIGH', `rank ${c.rank} 780kHz must be HIGH RFI sensitivity`);
  }
});

test('colocation GRID candidates have neighboring_landowner_notification_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.neighboring_landowner_notification_guide != null, `rank ${c.rank} missing neighboring_landowner_notification_guide`);
    assert.strictEqual(c.neighboring_landowner_notification_guide.fcc_public_notice_required, true, `rank ${c.rank} FCC public notice must be required`);
  }
});

test('colocation GRID candidates have transmitter_insurance_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.transmitter_insurance_guide != null, `rank ${c.rank} missing transmitter_insurance_guide`);
    assert.ok(c.transmitter_insurance_guide.estimated_equipment_value_usd >= 200000, `rank ${c.rank} insured value must be >= $200,000`);
  }
});

test('colocation GRID candidates have signal_booster_prohibited_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.signal_booster_prohibited_guide != null, `rank ${c.rank} missing signal_booster_prohibited_guide`);
    assert.strictEqual(c.signal_booster_prohibited_guide.am_booster_authorized, false, `rank ${c.rank} AM boosters must be prohibited`);
  }
});

test('colocation GRID candidates have community_of_license_change_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.community_of_license_change_guide != null, `rank ${c.rank} missing community_of_license_change_guide`);
    assert.strictEqual(c.community_of_license_change_guide.col_contour_threshold_mv_m, 0.5, `rank ${c.rank} COL contour threshold must be 0.5 mV/m`);
  }
});

test('colocation GRID candidates have fcc_license_modification_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.fcc_license_modification_guide != null, `rank ${c.rank} missing fcc_license_modification_guide`);
    assert.strictEqual(c.fcc_license_modification_guide.fcc_form, '301-AM', `rank ${c.rank} form must be 301-AM`);
  }
});

test('colocation GRID candidates have transmitter_building_design_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.transmitter_building_design_guide != null, `rank ${c.rank} missing transmitter_building_design_guide`);
    assert.ok(c.transmitter_building_design_guide.hvac_tons_required >= 1, `rank ${c.rank} HVAC must be >= 1 ton`);
  }
});

test('colocation GRID candidates have am_monitoring_point_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.am_monitoring_point_guide != null, `rank ${c.rank} missing am_monitoring_point_guide`);
    assert.ok(c.am_monitoring_point_guide.n_monitoring_points >= 1, `rank ${c.rank} must have at least 1 monitoring point`);
  }
});

test('colocation GRID candidates have utility_power_service_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.utility_power_service_guide != null, `rank ${c.rank} missing utility_power_service_guide`);
    assert.strictEqual(c.utility_power_service_guide.generator_recommended, true, `rank ${c.rank} generator must be recommended`);
  }
});

test('colocation GRID candidates have antenna_deicing_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.antenna_deicing_guide != null, `rank ${c.rank} missing antenna_deicing_guide`);
    assert.ok('ice_zone' in c.antenna_deicing_guide, `rank ${c.rank} antenna_deicing_guide missing ice_zone`);
  }
});

test('colocation GRID candidates have ground_lease_negotiation_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.ground_lease_negotiation_guide != null, `rank ${c.rank} missing ground_lease_negotiation_guide`);
    assert.ok(c.ground_lease_negotiation_guide.recommended_lease_term_years >= 20, `rank ${c.rank} lease term must be >= 20 years`);
  }
});

test('colocation GRID candidates have emergency_alert_system_equipment_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.emergency_alert_system_equipment_guide != null, `rank ${c.rank} missing emergency_alert_system_equipment_guide`);
    assert.strictEqual(c.emergency_alert_system_equipment_guide.eas_equipment_required, true, `rank ${c.rank} EAS must be required`);
  }
});

test('colocation GRID candidates have public_inspection_file_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.public_inspection_file_guide != null, `rank ${c.rank} missing public_inspection_file_guide`);
    assert.strictEqual(c.public_inspection_file_guide.issues_programs_list_required, false, `rank ${c.rank} commercial AM must be exempt from issues/programs list`);
  }
});

test('colocation GRID candidates have broadcast_content_compliance_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.broadcast_content_compliance_guide != null, `rank ${c.rank} missing broadcast_content_compliance_guide`);
    assert.strictEqual(c.broadcast_content_compliance_guide.indecency_rules.safe_harbor_start, '22:00', `rank ${c.rank} safe harbor must start at 22:00`);
  }
});

test('colocation GRID candidates have political_programming_compliance_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.political_programming_compliance_guide != null, `rank ${c.rank} missing political_programming_compliance_guide`);
    assert.strictEqual(c.political_programming_compliance_guide.election_windows.luc_pre_general_days, 60, `rank ${c.rank} LUC pre-general must be 60 days`);
  }
});

test('colocation GRID candidates have transmitter_redundancy_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.transmitter_redundancy_guide != null, `rank ${c.rank} missing transmitter_redundancy_guide`);
    assert.strictEqual(c.transmitter_redundancy_guide.backup_required_by_fcc, false, `rank ${c.rank} FCC does not require backup transmitter`);
  }
});

test('colocation GRID candidates have frequency_monitoring_plan_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.frequency_monitoring_plan_guide != null, `rank ${c.rank} missing frequency_monitoring_plan_guide`);
    assert.strictEqual(c.frequency_monitoring_plan_guide.carrier_frequency_monitoring.max_deviation_hz, 20, `rank ${c.rank} carrier tolerance must be ±20 Hz`);
  }
});

test('colocation GRID candidates have asr_registration_update_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.asr_registration_update_guide != null, `rank ${c.rank} missing asr_registration_update_guide`);
    assert.strictEqual(c.asr_registration_update_guide.asr_required_by_height, true, `rank ${c.rank} KAZM 780 kHz tower must require ASR`);
  }
});

test('colocation GRID candidates have tower_climbing_safety_plan_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.tower_climbing_safety_plan_guide != null, `rank ${c.rank} missing tower_climbing_safety_plan_guide`);
    assert.strictEqual(c.tower_climbing_safety_plan_guide.rf_ppe_required, true, `rank ${c.rank} RF PPE must be required at 5 kW`);
  }
});

test('colocation GRID candidates have remote_pickup_unit_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.remote_pickup_unit_guide != null, `rank ${c.rank} missing remote_pickup_unit_guide`);
    assert.strictEqual(c.remote_pickup_unit_guide.licensing.requires_fcc_license, true, `rank ${c.rank} RPU must require FCC license`);
  }
});

test('colocation GRID candidates have spectrum_repack_readiness_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.spectrum_repack_readiness_guide != null, `rank ${c.rank} missing spectrum_repack_readiness_guide`);
    assert.strictEqual(c.spectrum_repack_readiness_guide.repack_mandate_current, false, `rank ${c.rank} no mandatory AM repack exists currently`);
  }
});

test('colocation GRID candidates have interference_complaint_resolution_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.interference_complaint_resolution_guide != null, `rank ${c.rank} missing interference_complaint_resolution_guide`);
    assert.strictEqual(c.interference_complaint_resolution_guide.protected_contours_mvm.day, 0.5, `rank ${c.rank} Class D day contour must be 0.5 mV/m`);
  }
});

test('colocation GRID candidates have am_broadcast_translator_path_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.am_broadcast_translator_path_guide != null, `rank ${c.rank} missing am_broadcast_translator_path_guide`);
    assert.strictEqual(c.am_broadcast_translator_path_guide.fm_translator.max_erp_w, 250, `rank ${c.rank} FM translator max ERP must be 250W`);
  }
});

test('colocation GRID candidates have daytime_only_operation_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.daytime_only_operation_guide != null, `rank ${c.rank} missing daytime_only_operation_guide`);
    assert.strictEqual(c.daytime_only_operation_guide.is_daytime_only, true, `rank ${c.rank} KAZM 780 kHz Class D must be daytime only`);
  }
});

test('colocation GRID candidates have ownership_multiple_rules_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.ownership_multiple_rules_guide != null, `rank ${c.rank} missing ownership_multiple_rules_guide`);
    assert.strictEqual(c.ownership_multiple_rules_guide.local_am_limit, 5, `rank ${c.rank} local AM limit must be 5`);
  }
});

test('colocation GRID candidates have adjacent_channel_protection_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.adjacent_channel_protection_guide != null, `rank ${c.rank} missing adjacent_channel_protection_guide`);
    assert.ok(c.adjacent_channel_protection_guide.adjacent_10khz.required_du_db > 0, `rank ${c.rank} 10 kHz D/U must be positive`);
  }
});

test('colocation GRID candidates have main_studio_rule_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.main_studio_rule_guide != null, `rank ${c.rank} missing main_studio_rule_guide`);
    assert.strictEqual(c.main_studio_rule_guide.main_studio_required, false, `rank ${c.rank} main studio must be false (repealed)`);
  }
});

test('colocation GRID candidates have silent_station_consideration', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.silent_station_consideration != null, `rank ${c.rank} missing silent_station_consideration`);
    assert.ok(c.silent_station_consideration.silent_authorization.max_silent_weeks === 52, `rank ${c.rank} max silent must be 52 weeks`);
  }
});

test('colocation GRID candidates have am_propagation_variability_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.am_propagation_variability_guide != null, `rank ${c.rank} missing am_propagation_variability_guide`);
    assert.ok(c.am_propagation_variability_guide.ionospheric_skip.min_skip_distance_km > 0, `rank ${c.rank} skip distance must be positive`);
  }
});

test('colocation GRID candidates have adjacent_market_coverage_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.adjacent_market_coverage_analysis != null, `rank ${c.rank} missing adjacent_market_coverage_analysis`);
    assert.ok(c.adjacent_market_coverage_analysis.primary_service_radius_km > 0, `rank ${c.rank} primary reach must be positive`);
  }
});

test('colocation GRID candidates have ground_conductivity_improvement', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.ground_conductivity_improvement != null, `rank ${c.rank} missing ground_conductivity_improvement`);
    assert.strictEqual(c.ground_conductivity_improvement.n_all_techniques, 5, `rank ${c.rank} must have 5 techniques`);
  }
});

test('colocation GRID candidates have frequency_spectrum_coordination', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.frequency_spectrum_coordination != null, `rank ${c.rank} missing frequency_spectrum_coordination`);
    assert.strictEqual(c.frequency_spectrum_coordination.n_relationships, 5, `rank ${c.rank} must have 5 channel relationships`);
  }
});

test('colocation GRID candidates have stl_network_link_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.stl_network_link_guide != null, `rank ${c.rank} missing stl_network_link_guide`);
    assert.strictEqual(c.stl_network_link_guide.n_stl_options, 4, `rank ${c.rank} must have 4 STL options`);
  }
});

test('colocation GRID candidates have regulatory_filing_checklist', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.regulatory_filing_checklist != null, `rank ${c.rank} missing regulatory_filing_checklist`);
    assert.ok(c.regulatory_filing_checklist.n_required_filings > 0, `rank ${c.rank} must have required filings`);
  }
});

test('colocation GRID candidates have transmitter_cooling_hvac_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.transmitter_cooling_hvac_guide != null, `rank ${c.rank} missing transmitter_cooling_hvac_guide`);
    assert.strictEqual(c.transmitter_cooling_hvac_guide.n_hvac_options, 3, `rank ${c.rank} must have 3 HVAC options`);
  }
});

test('colocation GRID candidates have zoning_land_use_compatibility_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.zoning_land_use_compatibility_guide != null, `rank ${c.rank} missing zoning_land_use_compatibility_guide`);
    assert.strictEqual(c.zoning_land_use_compatibility_guide.n_zoning_tiers, 5, `rank ${c.rank} must have 5 zoning tiers`);
  }
});

test('colocation GRID candidates have emergency_power_backup_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.emergency_power_backup_guide != null, `rank ${c.rank} missing emergency_power_backup_guide`);
    assert.strictEqual(c.emergency_power_backup_guide.n_checklist_items, 7, `rank ${c.rank} must have 7 checklist items`);
  }
});

test('colocation GRID candidates have market_competitive_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.market_competitive_analysis != null, `rank ${c.rank} missing market_competitive_analysis`);
    assert.strictEqual(c.market_competitive_analysis.n_formats, 7, `rank ${c.rank} must have 7 AM formats`);
  }
});

test('colocation GRID candidates have terrain_path_loss_analysis', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.terrain_path_loss_analysis != null, `rank ${c.rank} missing terrain_path_loss_analysis`);
    assert.strictEqual(c.terrain_path_loss_analysis.n_terrain_classes, 5, `rank ${c.rank} must have 5 terrain classes`);
  }
});

test('colocation GRID candidates have antenna_height_optimization', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.antenna_height_optimization != null, `rank ${c.rank} missing antenna_height_optimization`);
    assert.strictEqual(c.antenna_height_optimization.n_height_tiers, 6, `rank ${c.rank} must have 6 height tiers`);
  }
});

test('colocation GRID candidates have population_demographics_overlay', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.population_demographics_overlay != null, `rank ${c.rank} missing population_demographics_overlay`);
    assert.strictEqual(c.population_demographics_overlay.n_contours, 3, `rank ${c.rank} must have 3 contours`);
  }
});

test('colocation GRID candidates have transmitter_power_upgrade_pathway_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.transmitter_power_upgrade_pathway_guide;
    assert.ok(g != null, `rank ${c.rank} missing transmitter_power_upgrade_pathway_guide`);
    assert.strictEqual(g.can_upgrade_day_power, true, `rank ${c.rank} can_upgrade_day_power must be true (5 kW → 10 kW headroom)`);
    assert.strictEqual(g.coverage_gain_pct, 41, `rank ${c.rank} coverage_gain_pct must be 41`);
  }
});

test('colocation GRID candidates have station_total_project_cost_pro_forma_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.station_total_project_cost_pro_forma_guide;
    assert.ok(g != null, `rank ${c.rank} missing station_total_project_cost_pro_forma_guide`);
    assert.strictEqual(g.n_cost_categories, 9, `rank ${c.rank} must have 9 cost categories`);
    assert.ok(g.total_project_low_usd > 200000, `rank ${c.rank} total_low must be > $200k`);
  }
});

test('colocation GRID candidates have antenna_base_impedance_and_atu_design_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.antenna_base_impedance_and_atu_design_guide;
    assert.ok(g != null, `rank ${c.rank} missing antenna_base_impedance_and_atu_design_guide`);
    assert.strictEqual(g.rr_ohm, 36.6, `rank ${c.rank} Rr must be 36.6 Ω`);
    assert.ok(g.bw_adequate, `rank ${c.rank} bw_adequate must be true`);
  }
});

test('colocation GRID candidates have electrical_power_consumption_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.electrical_power_consumption_guide;
    assert.ok(g != null, `rank ${c.rank} missing electrical_power_consumption_guide`);
    assert.strictEqual(g.n_transmitter_models, 3, `rank ${c.rank} must have 3 transmitter models`);
    assert.ok(g.annual_savings_vs_tube_usd > 0, `rank ${c.rank} annual savings must be positive`);
  }
});

test('colocation GRID candidates have fcc_form_301_exhibit_checklist_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.fcc_form_301_exhibit_checklist_guide;
    assert.ok(g != null, `rank ${c.rank} missing fcc_form_301_exhibit_checklist_guide`);
    assert.strictEqual(g.n_exhibits_da_specific, 0, `rank ${c.rank} NDA must have 0 DA exhibits`);
    assert.strictEqual(g.filing_fee_usd, 4200, `rank ${c.rank} filing fee must be $4,200`);
  }
});

test('silent_period_revenue_impact_and_audience_retention_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.silent_period_revenue_impact_and_audience_retention_guide;
    assert.ok(g != null, `rank ${c.rank} missing silent_period guide`);
    assert.ok(g.typical_6mo_revenue_loss_low_usd > 0, `rank ${c.rank}: 6mo revenue loss must be positive`);
    assert.ok(g.silence_scenarios.length === 4, `rank ${c.rank}: must have 4 silence scenarios`);
  }
});

test('community_of_license_population_change_trend_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const valid_tiers = ['RAPID_GROWTH', 'GROWING', 'STABLE', 'DECLINING', 'RAPID_DECLINE'];
  for (const c of out.candidates) {
    const g = c.community_of_license_population_change_trend_guide;
    assert.ok(g != null, `rank ${c.rank} missing community_of_license_population_change_trend_guide`);
    assert.ok(valid_tiers.includes(g.growth_tier), `rank ${c.rank}: growth_tier '${g.growth_tier}' invalid`);
    assert.ok(g.col_pop_estimate_now >= 0, `rank ${c.rank}: col_pop_estimate_now must be >= 0`);
  }
});

test('environmental_permitting_and_nepa_compliance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const valid_tiers = ['CATEGORICAL_EXCLUSION', 'ENVIRONMENTAL_ASSESSMENT', 'ENVIRONMENTAL_IMPACT_STATEMENT'];
  for (const c of out.candidates) {
    const g = c.environmental_permitting_and_nepa_compliance_guide;
    assert.ok(g != null, `rank ${c.rank} missing environmental_permitting_and_nepa_compliance_guide`);
    assert.ok(valid_tiers.includes(g.nepa_tier), `rank ${c.rank}: nepa_tier '${g.nepa_tier}' invalid`);
    assert.ok(g.total_permitting_timeline_days_low > 0, `rank ${c.rank}: timeline must be positive`);
  }
});

test('fcc_license_history_and_compliance_record_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const valid_priorities = ['EXPEDITED_ELIGIBLE', 'NORMAL', 'PRIORITY_RURAL'];
  for (const c of out.candidates) {
    const g = c.fcc_license_history_and_compliance_record_guide;
    assert.ok(g != null, `rank ${c.rank} missing fcc_license_history_and_compliance_record_guide`);
    assert.ok(valid_priorities.includes(g.processing_priority), `rank ${c.rank}: processing_priority '${g.processing_priority}' invalid`);
    assert.ok(g.processing_months_low > 0, `rank ${c.rank}: processing_months_low must be > 0`);
  }
});

test('rf_propagation_terrain_roughness_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const valid_classes = ['VERY_SMOOTH', 'SMOOTH', 'MODERATE', 'ROUGH', 'VERY_ROUGH'];
  for (const c of out.candidates) {
    const g = c.rf_propagation_terrain_roughness_guide;
    assert.ok(g != null, `rank ${c.rank} missing rf_propagation_terrain_roughness_guide`);
    assert.ok(valid_classes.includes(g.terrain_class), `rank ${c.rank}: terrain_class '${g.terrain_class}' invalid`);
    assert.ok(g.estimated_range_km > 0, `rank ${c.rank}: estimated_range_km must be > 0`);
  }
});

test('am_night_skywave_coverage_and_interference_risk_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const valid_ops = ['FULL_POWER_24H', 'DA_N_REQUIRED', 'REDUCED_POWER_OR_SILENT'];
  for (const c of out.candidates) {
    const g = c.am_night_skywave_coverage_and_interference_risk_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_night_skywave_coverage_and_interference_risk_guide`);
    assert.ok(valid_ops.includes(g.night_operation_type), `rank ${c.rank}: night_operation_type '${g.night_operation_type}' invalid`);
    assert.ok(g.skip_distance_km > 0, `rank ${c.rank}: skip_distance_km must be > 0`);
  }
});

test('tower_structural_wind_and_ice_load_design_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const valid_zones = ['SOUTHWEST_DESERT', 'MOUNTAIN_WEST', 'PACIFIC_COAST', 'NORTHEAST', 'CENTRAL_PLAINS', 'GULF_COAST'];
  for (const c of out.candidates) {
    const g = c.tower_structural_wind_and_ice_load_design_guide;
    assert.ok(g != null, `rank ${c.rank} missing tower_structural_wind_and_ice_load_design_guide`);
    assert.ok(valid_zones.includes(g.wind_zone), `rank ${c.rank}: wind_zone '${g.wind_zone}' invalid`);
    assert.ok(g.design_wind_speed_mph > 0, `rank ${c.rank}: design_wind_speed_mph must be > 0`);
  }
});

test('broadcast_market_competitive_landscape_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const valid_tiers = ['MAJOR', 'MEDIUM', 'SMALL', 'RURAL'];
  for (const c of out.candidates) {
    const g = c.broadcast_market_competitive_landscape_guide;
    assert.ok(g != null, `rank ${c.rank} missing broadcast_market_competitive_landscape_guide`);
    assert.ok(valid_tiers.includes(g.market_tier), `rank ${c.rank}: market_tier '${g.market_tier}' invalid`);
    assert.ok(g.n_format_segments >= 5, `rank ${c.rank}: must have at least 5 format segments`);
  }
});

test('am_automation_and_emergency_alert_system_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const valid_tiers = ['Entry-level', 'Professional', 'Enterprise'];
  for (const c of out.candidates) {
    const g = c.am_automation_and_emergency_alert_system_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_automation_and_emergency_alert_system_guide`);
    assert.ok(valid_tiers.includes(g.recommended_eas_tier), `rank ${c.rank}: eas_tier '${g.recommended_eas_tier}' invalid`);
    assert.ok(g.eas_setup_cost_low_usd > 0, `rank ${c.rank}: EAS setup cost must be positive`);
  }
});

test('am_digital_hd_radio_upgrade_pathway_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_digital_hd_radio_upgrade_pathway_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_digital_hd_radio_upgrade_pathway_guide`);
    assert.ok(g.n_applicable_hd_modes >= 1, `rank ${c.rank}: must have at least 1 applicable HD mode`);
    assert.ok(g.total_hd_upgrade_cost_low_usd > 0, `rank ${c.rank}: HD upgrade cost must be positive`);
  }
});

test('am_translator_and_booster_strategy_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_translator_and_booster_strategy_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_translator_and_booster_strategy_guide`);
    assert.ok(g.fm_translator_eligible, `rank ${c.rank}: must be FM translator eligible`);
    assert.ok(g.recommended_translator_erp_w > 0, `rank ${c.rank}: recommended ERP must be > 0`);
  }
});

test('fcc_proof_of_performance_measurement_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const valid_proof_types = ['FULL_PROOF', 'SHORT_PROOF', 'ABBREVIATED', 'NONE'];
  for (const c of out.candidates) {
    const g = c.fcc_proof_of_performance_measurement_guide;
    assert.ok(g != null, `rank ${c.rank} missing fcc_proof_of_performance_measurement_guide`);
    assert.ok(valid_proof_types.includes(g.proof_type), `rank ${c.rank}: proof_type '${g.proof_type}' invalid`);
    assert.ok(g.total_measurement_points > 0, `rank ${c.rank}: total measurement points must be > 0`);
  }
});

test('am_station_insurance_and_bonding_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_station_insurance_and_bonding_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_station_insurance_and_bonding_guide`);
    assert.ok(g.annual_premium_low_usd > 0, `rank ${c.rank}: annual premium must be > 0`);
    assert.ok(g.n_required_categories >= 5, `rank ${c.rank}: must have >= 5 required coverage categories`);
  }
});

test('am_grounding_system_and_rf_safety_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_grounding_system_and_rf_safety_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_grounding_system_and_rf_safety_guide`);
    assert.ok(g.n_radials >= 60, `rank ${c.rank}: n_radials must be >= 60`);
    assert.ok(g.total_cost_low_usd > 0, `rank ${c.rank}: total_cost_low_usd must be positive`);
    assert.ok(g.exclusion_zone_m > 0, `rank ${c.rank}: exclusion_zone_m must be positive`);
  }
});

test('am_antenna_tower_lighting_and_faa_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_antenna_tower_lighting_and_faa_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_antenna_tower_lighting_and_faa_guide`);
    assert.ok(typeof g.lighting_type === 'string', `rank ${c.rank}: lighting_type must be a string`);
    assert.ok(g.std_tower_height_ft > 0, `rank ${c.rank}: std_tower_height_ft must be positive`);
    assert.ok(g.total_initial_cost_low_usd >= 0, `rank ${c.rank}: total_initial_cost_low_usd must be non-negative`);
  }
});

test('am_site_acquisition_and_real_property_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_site_acquisition_and_real_property_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_site_acquisition_and_real_property_guide`);
    assert.ok(['RURAL', 'SUBURBAN', 'URBAN'].includes(g.site_class), `rank ${c.rank}: invalid site_class`);
    assert.ok(g.total_purchase_low_usd > 0, `rank ${c.rank}: total_purchase_low_usd must be positive`);
    assert.ok(g.annual_lease_low_usd > 0, `rank ${c.rank}: annual_lease_low_usd must be positive`);
  }
});

test('am_construction_permit_and_buildout_timeline_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_construction_permit_and_buildout_timeline_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_construction_permit_and_buildout_timeline_guide`);
    assert.ok(g.total_months_low > 0, `rank ${c.rank}: total_months_low must be positive`);
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(g.cp_expiration_risk), `rank ${c.rank}: invalid cp_expiration_risk`);
    assert.ok(g.fcc_filing_fee_usd > 0, `rank ${c.rank}: fcc_filing_fee_usd must be positive`);
  }
});

test('am_transmitter_and_equipment_selection_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_transmitter_and_equipment_selection_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_transmitter_and_equipment_selection_guide`);
    assert.ok(['LOW','MEDIUM','HIGH','VERY_HIGH'].includes(g.power_class_tx), `rank ${c.rank}: invalid power_class_tx`);
    assert.ok(g.total_equipment_low_usd > 0, `rank ${c.rank}: total_equipment_low_usd must be positive`);
    assert.ok(g.backup_tx_kw >= 1, `rank ${c.rank}: backup_tx_kw must be at least 1`);
  }
});

test('am_transmitter_building_and_utilities_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_transmitter_building_and_utilities_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_transmitter_building_and_utilities_guide`);
    assert.ok(g.bld_sqft_low > 0, `rank ${c.rank}: bld_sqft_low must be positive`);
    assert.ok(g.generator_kw > 0, `rank ${c.rank}: generator_kw must be positive`);
    assert.ok(g.total_infrastructure_low_usd > 0, `rank ${c.rank}: total_infrastructure_low_usd must be positive`);
  }
});

test('am_local_zoning_and_land_use_compatibility_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_local_zoning_and_land_use_compatibility_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_local_zoning_and_land_use_compatibility_guide`);
    assert.ok(g.tower_height_ft > 0, `rank ${c.rank}: tower_height_ft must be positive`);
    assert.ok(g.total_zoning_cost_low_usd >= 0, `rank ${c.rank}: total_zoning_cost_low_usd must be non-negative`);
  }
});

test('am_daytime_interference_and_protection_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_daytime_interference_and_protection_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_daytime_interference_and_protection_guide`);
    assert.ok(['CLEAR_CHANNEL','REGIONAL_CHANNEL','LOCAL_CHANNEL'].includes(g.channel_type), `rank ${c.rank}: invalid channel_type`);
    assert.ok(g.service_radius_05_mvpm_km > 0, `rank ${c.rank}: service_radius must be positive`);
  }
});

test('am_studio_to_transmitter_link_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_studio_to_transmitter_link_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_studio_to_transmitter_link_guide`);
    assert.ok(['IP_INTERNET','LICENSED_950MHZ','DIGITAL_MICROWAVE'].includes(g.stl_technology), `rank ${c.rank}: invalid stl_technology`);
    assert.ok(g.total_stl_cost_low_usd >= 0, `rank ${c.rank}: total_stl_cost_low_usd must be non-negative`);
    assert.ok(g.stl_latency_ms > 0, `rank ${c.rank}: stl_latency_ms must be positive`);
  }
});

test('am_antenna_electrical_design_and_efficiency_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_antenna_electrical_design_and_efficiency_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_antenna_electrical_design_and_efficiency_guide`);
    assert.ok(g.efficiency_pct_low > 0 && g.efficiency_pct_low < 100, `rank ${c.rank}: efficiency_pct_low must be 0-100`);
    assert.ok(g.effective_erp_kw_low > 0, `rank ${c.rank}: effective_erp_kw_low must be positive`);
    assert.ok(g.radiation_resistance_ohm === 36.5, `rank ${c.rank}: radiation_resistance should be 36.5Ω`);
  }
});

test('am_annual_operating_cost_analysis_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_annual_operating_cost_analysis_guide;
    assert.ok(g != null, `rank ${c.rank} missing am_annual_operating_cost_analysis_guide`);
    assert.ok(g.total_annual_low_usd > 0, `rank ${c.rank}: total_annual_low_usd must be positive`);
    assert.ok(g.annual_kwh_total > 0, `rank ${c.rank}: annual_kwh_total must be positive`);
    assert.ok(g.opex_10yr_pv_low_usd > g.total_annual_low_usd, `rank ${c.rank}: 10yr NPV must exceed 1 year`);
  }
});

test('am_emergency_power_and_backup_systems_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_emergency_power_and_backup_systems_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_emergency_power_and_backup_systems_guide missing`);
    assert.ok(g.generator_size_kw >= 10, `rank ${c.rank}: generator_size_kw should be ≥10 kW`);
    assert.ok(g.total_backup_low_usd > 0, `rank ${c.rank}: total_backup_low_usd must be positive`);
    assert.ok(g.fuel_for_72h_gal > 0, `rank ${c.rank}: fuel_for_72h_gal must be positive`);
  }
});

test('am_tower_structural_and_wind_loading_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_tower_structural_and_wind_loading_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_structural_and_wind_loading_guide missing`);
    assert.ok(g.tower_height_ft > 0, `rank ${c.rank}: tower_height_ft must be positive`);
    assert.ok(g.total_guyed_low_usd > 0, `rank ${c.rank}: total_guyed_low_usd must be positive`);
    assert.ok(typeof g.tia_class === 'string', `rank ${c.rank}: tia_class should be a string`);
  }
});

test('am_nepa_and_environmental_permitting_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_nepa_and_environmental_permitting_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_nepa_and_environmental_permitting_guide missing`);
    assert.ok(typeof g.nepa_level === 'string', `rank ${c.rank}: nepa_level should be a string`);
    assert.ok(g.total_env_cost_low_usd > 0, `rank ${c.rank}: total_env_cost_low_usd must be positive`);
    assert.ok(g.env_review_weeks_low > 0, `rank ${c.rank}: env_review_weeks_low must be positive`);
  }
});

test('am_electrical_service_and_power_infrastructure_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_electrical_service_and_power_infrastructure_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_electrical_service_and_power_infrastructure_guide missing`);
    assert.ok(g.service_amps > 0, `rank ${c.rank}: service_amps must be positive`);
    assert.ok(g.transformer_kva > 0, `rank ${c.rank}: transformer_kva must be positive`);
    assert.ok(g.total_utility_low_usd > 0, `rank ${c.rank}: total_utility_low_usd must be positive`);
  }
});

test('am_soil_conductivity_and_groundwave_coverage_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_soil_conductivity_and_groundwave_coverage_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_soil_conductivity_and_groundwave_coverage_guide missing`);
    assert.ok(g.sigma_ms > 0, `rank ${c.rank}: sigma_ms must be positive`);
    assert.ok(g.d_05_mvm_km > 0, `rank ${c.rank}: d_05_mvm_km must be positive`);
    assert.ok(g.coverage_area_km2 > 0, `rank ${c.rank}: coverage_area_km2 must be positive`);
  }
});

test('am_lightning_protection_and_surge_suppression_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_lightning_protection_and_surge_suppression_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_lightning_protection_and_surge_suppression_guide missing`);
    assert.ok(g.N_g > 0, `rank ${c.rank}: N_g must be positive`);
    assert.ok(g.total_lp_cost_low_usd > 0, `rank ${c.rank}: total_lp_cost_low_usd must be positive`);
    assert.ok(g.N_s > 0, `rank ${c.rank}: N_s must be positive`);
  }
});

test('am_coverage_improvement_vs_current_site_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_coverage_improvement_vs_current_site_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_coverage_improvement_vs_current_site_guide missing`);
    assert.ok(typeof g.verdict === 'string', `rank ${c.rank}: verdict should be a string`);
    assert.ok(g.d_candidate_km > 0, `rank ${c.rank}: d_candidate_km must be positive`);
    assert.ok(['SIGNIFICANT_COVERAGE_GAIN','MARGINAL_COVERAGE_GAIN','EQUIVALENT_COVERAGE','MARGINAL_COVERAGE_LOSS','SIGNIFICANT_COVERAGE_LOSS'].includes(g.verdict), `rank ${c.rank}: verdict should be a valid classification`);
  }
});

test('am_rf_system_monitoring_and_telemetry_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_rf_system_monitoring_and_telemetry_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_rf_system_monitoring_and_telemetry_guide missing`);
    assert.ok(g.n_base_meters >= 1, `rank ${c.rank}: n_base_meters must be at least 1`);
    assert.ok(g.total_telemetry_low_usd > 0, `rank ${c.rank}: total_telemetry_low_usd must be positive`);
    assert.ok(g.annual_log_entries > 0, `rank ${c.rank}: annual_log_entries must be positive`);
  }
});

test('am_geotechnical_and_soil_investigation_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_geotechnical_and_soil_investigation_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_geotechnical_and_soil_investigation_guide missing`);
    assert.ok(g.bearing_capacity_psf_low > 0, `rank ${c.rank}: bearing_capacity_psf_low must be positive`);
    assert.ok(g.total_geotech_low_usd > 0, `rank ${c.rank}: total_geotech_low_usd must be positive`);
    assert.ok(typeof g.foundation_type === 'string', `rank ${c.rank}: foundation_type should be a string`);
  }
});

test('am_transmitter_procurement_and_upgrade_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_transmitter_procurement_and_upgrade_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_transmitter_procurement_and_upgrade_guide missing`);
    assert.ok(g.tx_cost_low_usd > 0, `rank ${c.rank}: tx_cost_low_usd must be positive`);
    assert.ok(g.total_tx_high_usd >= g.total_tx_low_usd, `rank ${c.rank}: high cost must be >= low`);
    assert.ok(['solid_state_low_power','solid_state_medium_power','solid_state_high_power'].includes(g.tx_type), `rank ${c.rank}: tx_type must be valid`);
  }
});

test('am_site_grading_and_drainage_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_site_grading_and_drainage_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_site_grading_and_drainage_guide missing`);
    assert.ok(g.total_site_prep_low_usd > 0, `rank ${c.rank}: total_site_prep_low_usd must be positive`);
    assert.ok(['existing_or_improved','semi_rural','rural_undeveloped'].includes(g.terrain_class), `rank ${c.rank}: terrain_class must be valid`);
  }
});

test('am_insurance_and_bonding_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_insurance_and_bonding_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_insurance_and_bonding_guide missing`);
    assert.ok(g.annual_total_ins_low_usd > 0, `rank ${c.rank}: annual_total_ins_low_usd must be positive`);
    assert.ok(g.surety_bond_low_usd > 0, `rank ${c.rank}: surety_bond_low_usd must be positive`);
    assert.ok(g.annual_total_ins_high_usd >= g.annual_total_ins_low_usd, `rank ${c.rank}: high must be >= low`);
  }
});

test('am_studio_transmitter_link_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_studio_transmitter_link_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_studio_transmitter_link_guide missing`);
    assert.ok(g.total_stl_setup_low_usd > 0, `rank ${c.rank}: total_stl_setup_low_usd must be positive`);
    assert.ok(g.total_stl_setup_high_usd >= g.total_stl_setup_low_usd, `rank ${c.rank}: high cost must be >= low`);
    assert.ok(['ip_audio_internet','microwave_950mhz'].includes(g.stl_type), `rank ${c.rank}: stl_type must be valid`);
  }
});

test('am_construction_project_schedule_and_management_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_construction_project_schedule_and_management_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_construction_project_schedule_and_management_guide missing`);
    assert.ok(g.total_months_low > 0, `rank ${c.rank}: total_months_low must be positive`);
    assert.ok(g.total_months_high >= g.total_months_low, `rank ${c.rank}: high must be >= low`);
    assert.strictEqual(g.is_clear, true, `rank ${c.rank}: KAZM 780 kHz is_clear should be true`);
  }
});

test('am_utility_power_service_and_metering_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_utility_power_service_and_metering_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_utility_power_service_and_metering_guide missing`);
    assert.ok(g.monthly_power_cost_usd > 0, `rank ${c.rank}: monthly_power_cost_usd must be positive`);
    assert.ok(g.total_utility_setup_low_usd >= 0, `rank ${c.rank}: total_utility_setup_low_usd must be non-negative`);
    assert.ok(['single_phase_240V','three_phase_208V'].includes(g.service_type), `rank ${c.rank}: service_type must be valid`);
  }
});

test('am_transmission_line_and_antenna_tuning_unit_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_transmission_line_and_antenna_tuning_unit_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_transmission_line_and_antenna_tuning_unit_guide missing`);
    assert.ok(g.r_base_est_ohm > 0, `rank ${c.rank}: r_base_est_ohm must be positive`);
    assert.ok(g.total_atu_system_low_usd > 0, `rank ${c.rank}: total_atu_system_low_usd must be positive`);
    assert.ok(g.total_atu_system_high_usd >= g.total_atu_system_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_tower_base_insulator_and_rf_isolation_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_tower_base_insulator_and_rf_isolation_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_base_insulator_and_rf_isolation_guide missing`);
    assert.ok(g.tower_height_ft > 0, `rank ${c.rank}: tower_height_ft must be positive`);
    assert.ok(g.total_rf_isolation_low_usd > 0, `rank ${c.rank}: total_rf_isolation_low_usd must be positive`);
    assert.ok(g.total_rf_isolation_high_usd >= g.total_rf_isolation_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_emergency_alert_system_equipment_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_emergency_alert_system_equipment_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_emergency_alert_system_equipment_guide missing`);
    assert.strictEqual(g.cap_compatible, true, `rank ${c.rank}: cap_compatible should be true`);
    assert.ok(g.total_eas_equipment_low_usd > 0, `rank ${c.rank}: total_eas_equipment_low_usd must be positive`);
    assert.strictEqual(g.n_required_sources, 2, `rank ${c.rank}: n_required_sources should be 2`);
  }
});

test('am_auxiliary_transmitter_and_backup_power_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_auxiliary_transmitter_and_backup_power_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_auxiliary_transmitter_and_backup_power_guide missing`);
    assert.ok(g.generator_kw > 0, `rank ${c.rank}: generator_kw must be positive`);
    assert.ok(g.total_backup_low_usd > 0, `rank ${c.rank}: total_backup_low_usd must be positive`);
    assert.ok(g.total_backup_high_usd >= g.total_backup_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_modulation_monitor_and_station_logging_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_modulation_monitor_and_station_logging_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_modulation_monitor_and_station_logging_guide missing`);
    assert.ok(g.monitor_cost_low_usd > 0, `rank ${c.rank}: monitor_cost_low_usd must be positive`);
    assert.ok(g.total_monitoring_low_usd > 0, `rank ${c.rank}: total_monitoring_low_usd must be positive`);
    assert.strictEqual(g.log_interval_min, 30, `rank ${c.rank}: log_interval_min should be 30`);
  }
});

test('am_transmitter_building_and_equipment_shelter_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_transmitter_building_and_equipment_shelter_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_transmitter_building_and_equipment_shelter_guide missing`);
    assert.ok(g.bldg_sqft > 0, `rank ${c.rank}: bldg_sqft must be positive`);
    assert.ok(g.total_shelter_low_usd > 0, `rank ${c.rank}: total_shelter_low_usd must be positive`);
    assert.ok(g.total_shelter_high_usd >= g.total_shelter_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_site_lease_and_land_acquisition_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_site_lease_and_land_acquisition_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_site_lease_and_land_acquisition_guide missing`);
    assert.ok(g.site_acres > 0, `rank ${c.rank}: site_acres must be positive`);
    assert.ok(g.purchase_total_low_usd > 0, `rank ${c.rank}: purchase_total_low_usd must be positive`);
    assert.ok(['suburban','rural_edge','rural'].includes(g.land_class), `rank ${c.rank}: land_class must be suburban/rural_edge/rural`);
  }
});

test('am_carrier_frequency_accuracy_and_reference_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_carrier_frequency_accuracy_and_reference_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_carrier_frequency_accuracy_and_reference_guide missing`);
    assert.ok(g.required_accuracy_hz > 0, `rank ${c.rank}: required_accuracy_hz must be positive`);
    assert.ok(g.gpsdo_cost_low_usd > 0, `rank ${c.rank}: gpsdo_cost_low_usd must be positive`);
    assert.strictEqual(g.recommended_reference, 'GPSDO', `rank ${c.rank}: recommended_reference should be GPSDO`);
  }
});

test('am_tower_decommissioning_and_site_remediation_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_tower_decommissioning_and_site_remediation_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_decommissioning_and_site_remediation_guide missing`);
    assert.ok(g.tower_demo_ft > 0, `rank ${c.rank}: tower_demo_ft must be positive`);
    assert.ok(g.total_demo_cost_low_usd > 0, `rank ${c.rank}: total_demo_cost_low_usd must be positive`);
    assert.ok(g.net_demo_cost_high_usd >= 0, `rank ${c.rank}: net_demo_cost_high_usd must be non-negative`);
  }
});

test('am_ground_system_resistance_and_maintenance_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_ground_system_resistance_and_maintenance_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_ground_system_resistance_and_maintenance_guide missing`);
    assert.ok(g.rg_est_ohm > 0, `rank ${c.rank}: rg_est_ohm must be positive`);
    assert.ok(typeof g.rg_acceptable === 'boolean', `rank ${c.rank}: rg_acceptable must be a boolean`);
    assert.ok(g.total_annual_ground_maint_high_usd >= g.total_annual_ground_maint_low_usd, `rank ${c.rank}: high cost >= low`);
  }
});

test('am_commissioning_and_acceptance_testing_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_commissioning_and_acceptance_testing_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_commissioning_and_acceptance_testing_guide missing`);
    assert.ok(g.total_commissioning_low_usd > 0, `rank ${c.rank}: total_commissioning_low_usd must be positive`);
    assert.ok(g.mpe_evaluation_required === true, `rank ${c.rank}: MPE evaluation required for all AM stations`);
    assert.ok(g.total_commissioning_high_usd >= g.total_commissioning_low_usd, `rank ${c.rank}: high cost >= low`);
  }
});

test('am_broadcast_tower_structural_inspection_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_broadcast_tower_structural_inspection_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_broadcast_tower_structural_inspection_guide missing`);
    assert.ok(g.tower_insp_ft > 0, `rank ${c.rank}: tower_insp_ft must be positive`);
    assert.ok(g.n_guy_levels >= 2, `rank ${c.rank}: n_guy_levels must be at least 2`);
    assert.ok(g.total_annual_inspection_high_usd >= g.total_annual_inspection_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_annual_regulatory_compliance_and_fee_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_annual_regulatory_compliance_and_fee_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_annual_regulatory_compliance_and_fee_guide missing`);
    assert.ok(g.annual_fcc_fee_usd > 0, `rank ${c.rank}: annual_fcc_fee_usd must be positive`);
    assert.ok(g.total_annual_compliance_low_usd > 0, `rank ${c.rank}: total_annual_compliance_low_usd must be positive`);
    assert.ok(g.license_renewal_cycle_years === 8, `rank ${c.rank}: license renewal cycle must be 8 years`);
  }
});

test('am_concrete_foundation_and_anchor_design_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_concrete_foundation_and_anchor_design_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_concrete_foundation_and_anchor_design_guide missing`);
    assert.ok(g.tower_fnd_ft > 0, `rank ${c.rank}: tower_fnd_ft must be positive`);
    assert.ok(g.total_concrete_cy > 0, `rank ${c.rank}: total_concrete_cy must be positive`);
    assert.ok(g.total_foundation_high_usd >= g.total_foundation_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_tower_painting_and_aviation_marking_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_tower_painting_and_aviation_marking_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_painting_and_aviation_marking_guide missing`);
    assert.ok(g.tower_pnt_ft > 0, `rank ${c.rank}: tower_pnt_ft must be positive`);
    assert.ok(g.initial_paint_cost_low_usd > 0, `rank ${c.rank}: initial_paint_cost_low_usd must be positive`);
    assert.ok(g.life_20yr_paint_high_usd >= g.life_20yr_paint_low_usd, `rank ${c.rank}: high lifecycle cost must be >= low`);
  }
});

test('am_noise_floor_and_rf_environment_analysis_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_noise_floor_and_rf_environment_analysis_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_noise_floor_and_rf_environment_analysis_guide missing`);
    assert.ok(g.fa_atmospheric_db > 0, `rank ${c.rank}: fa_atmospheric_db must be positive`);
    assert.ok(g.noise_score >= 0 && g.noise_score <= 100, `rank ${c.rank}: noise_score must be 0-100`);
    assert.ok(['low','medium','high'].includes(g.interference_risk), `rank ${c.rank}: interference_risk must be low/medium/high`);
  }
});

test('am_phase_i_environmental_site_assessment_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_phase_i_environmental_site_assessment_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_phase_i_environmental_site_assessment_guide missing`);
    assert.ok(g.site_acres > 0, `rank ${c.rank}: site_acres must be positive`);
    assert.ok(g.phase1_cost_low_usd > 0, `rank ${c.rank}: phase1_cost_low_usd must be positive`);
    assert.ok(g.total_esa_high_usd >= g.total_esa_low_usd, `rank ${c.rank}: high ESA cost must be >= low`);
  }
});

test('am_fcc_application_engineering_report_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_fcc_application_engineering_report_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_fcc_application_engineering_report_guide missing`);
    assert.ok(g.fcc_filing_fee_usd > 0, `rank ${c.rank}: fcc_filing_fee_usd must be positive`);
    assert.ok(g.n_stations_to_study > 0, `rank ${c.rank}: n_stations_to_study must be positive`);
    assert.ok(g.total_application_low_usd > 0, `rank ${c.rank}: total_application_low_usd must be positive`);
  }
});

test('am_site_access_road_and_security_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_site_access_road_and_security_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_site_access_road_and_security_guide missing`);
    assert.ok(g.fence_perim_ft > 0, `rank ${c.rank}: fence_perim_ft must be positive`);
    assert.ok(g.total_security_low_usd > 0, `rank ${c.rank}: total_security_low_usd must be positive`);
    assert.ok(g.annual_security_maint_usd > 0, `rank ${c.rank}: annual_security_maint_usd must be positive`);
  }
});

test('am_ground_system_installation_and_maintenance_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_ground_system_installation_and_maintenance_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_ground_system_installation_and_maintenance_guide missing`);
    assert.ok(g.radial_length_ft > 0, `rank ${c.rank}: radial_length_ft must be positive`);
    assert.ok(g.total_high_usd >= g.total_low_usd, `rank ${c.rank}: total_high must be >= total_low`);
    assert.ok([120, 160].includes(g.recommended_radials), `rank ${c.rank}: recommended_radials must be 120 or 160`);
  }
});

test('am_rf_radiation_safety_and_compliance_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_rf_radiation_safety_and_compliance_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_rf_radiation_safety_and_compliance_guide missing`);
    assert.ok(g.exclusion_zone_m >= 0, `rank ${c.rank}: exclusion_zone_m must be non-negative`);
    assert.ok(g.total_compliance_high_usd >= g.total_compliance_low_usd, `rank ${c.rank}: high must be >= low`);
    assert.ok(['desktop_calculation_required','computational_evaluation_required','field_measurement_required'].includes(g.evaluation_type),
      `rank ${c.rank}: unexpected evaluation_type: ${g.evaluation_type}`);
  }
});

test('am_antenna_array_and_phasor_guide present across colocation candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  for (const c of out.candidates) {
    const g = c.am_antenna_array_and_phasor_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_antenna_array_and_phasor_guide missing`);
    assert.ok(g.tower_count >= 1, `rank ${c.rank}: tower_count must be >= 1`);
    assert.ok(g.total_high_usd >= g.total_low_usd, `rank ${c.rank}: total_high must be >= total_low`);
    assert.ok(['single_tower_nda','two_tower_da','three_tower_da'].includes(g.array_type),
      `rank ${c.rank}: unexpected array_type: ${g.array_type}`);
  }
});
