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
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_emergency_power_and_backup_systems_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_emergency_power_and_backup_systems_guide missing`);
    assert.ok(g.generator_size_kw >= 10, `rank ${c.rank}: generator_size_kw should be ≥10 kW`);
    assert.ok(g.total_backup_low_usd > 0, `rank ${c.rank}: total_backup_low_usd must be positive`);
    assert.ok(g.fuel_for_72h_gal > 0, `rank ${c.rank}: fuel_for_72h_gal must be positive`);
  }
});

test('am_tower_structural_and_wind_loading_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tower_structural_and_wind_loading_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_structural_and_wind_loading_guide missing`);
    assert.ok(g.tower_height_ft > 0, `rank ${c.rank}: tower_height_ft must be positive`);
    assert.ok(g.total_guyed_low_usd > 0, `rank ${c.rank}: total_guyed_low_usd must be positive`);
    assert.ok(typeof g.tia_class === 'string', `rank ${c.rank}: tia_class should be a string`);
  }
});

test('am_nepa_and_environmental_permitting_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_nepa_and_environmental_permitting_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_nepa_and_environmental_permitting_guide missing`);
    assert.ok(typeof g.nepa_level === 'string', `rank ${c.rank}: nepa_level should be a string`);
    assert.ok(g.total_env_cost_low_usd > 0, `rank ${c.rank}: total_env_cost_low_usd must be positive`);
    assert.ok(g.env_review_weeks_low > 0, `rank ${c.rank}: env_review_weeks_low must be positive`);
  }
});

test('am_electrical_service_and_power_infrastructure_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_electrical_service_and_power_infrastructure_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_electrical_service_and_power_infrastructure_guide missing`);
    assert.ok(g.service_amps > 0, `rank ${c.rank}: service_amps must be positive`);
    assert.ok(g.transformer_kva > 0, `rank ${c.rank}: transformer_kva must be positive`);
    assert.ok(g.total_utility_low_usd > 0, `rank ${c.rank}: total_utility_low_usd must be positive`);
  }
});

test('am_soil_conductivity_and_groundwave_coverage_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_soil_conductivity_and_groundwave_coverage_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_soil_conductivity_and_groundwave_coverage_guide missing`);
    assert.ok(g.sigma_ms > 0, `rank ${c.rank}: sigma_ms must be positive`);
    assert.ok(g.d_05_mvm_km > 0, `rank ${c.rank}: d_05_mvm_km must be positive`);
    assert.ok(g.coverage_area_km2 > 0, `rank ${c.rank}: coverage_area_km2 must be positive`);
  }
});

test('am_lightning_protection_and_surge_suppression_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_lightning_protection_and_surge_suppression_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_lightning_protection_and_surge_suppression_guide missing`);
    assert.ok(g.N_g > 0, `rank ${c.rank}: N_g must be positive`);
    assert.ok(g.total_lp_cost_low_usd > 0, `rank ${c.rank}: total_lp_cost_low_usd must be positive`);
    assert.ok(g.N_s > 0, `rank ${c.rank}: N_s must be positive`);
  }
});

test('am_coverage_improvement_vs_current_site_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_coverage_improvement_vs_current_site_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_coverage_improvement_vs_current_site_guide missing`);
    assert.ok(typeof g.verdict === 'string', `rank ${c.rank}: verdict should be a string`);
    assert.ok(g.d_candidate_km > 0, `rank ${c.rank}: d_candidate_km must be positive`);
    assert.ok(['SIGNIFICANT_COVERAGE_GAIN','MARGINAL_COVERAGE_GAIN','EQUIVALENT_COVERAGE','MARGINAL_COVERAGE_LOSS','SIGNIFICANT_COVERAGE_LOSS'].includes(g.verdict), `rank ${c.rank}: verdict should be a valid classification`);
  }
});

test('am_rf_system_monitoring_and_telemetry_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_rf_system_monitoring_and_telemetry_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_rf_system_monitoring_and_telemetry_guide missing`);
    assert.ok(g.n_base_meters >= 1, `rank ${c.rank}: n_base_meters must be at least 1`);
    assert.ok(g.total_telemetry_low_usd > 0, `rank ${c.rank}: total_telemetry_low_usd must be positive`);
    assert.ok(g.annual_log_entries > 0, `rank ${c.rank}: annual_log_entries must be positive`);
  }
});

test('am_geotechnical_and_soil_investigation_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_geotechnical_and_soil_investigation_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_geotechnical_and_soil_investigation_guide missing`);
    assert.ok(g.bearing_capacity_psf_low > 0, `rank ${c.rank}: bearing_capacity_psf_low must be positive`);
    assert.ok(g.total_geotech_low_usd > 0, `rank ${c.rank}: total_geotech_low_usd must be positive`);
    assert.ok(typeof g.foundation_type === 'string', `rank ${c.rank}: foundation_type should be a string`);
  }
});

test('am_transmitter_procurement_and_upgrade_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmitter_procurement_and_upgrade_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_transmitter_procurement_and_upgrade_guide missing`);
    assert.ok(g.tx_cost_low_usd > 0, `rank ${c.rank}: tx_cost_low_usd must be positive`);
    assert.ok(g.total_tx_high_usd >= g.total_tx_low_usd, `rank ${c.rank}: high cost must be >= low`);
    assert.ok(['solid_state_low_power','solid_state_medium_power','solid_state_high_power'].includes(g.tx_type), `rank ${c.rank}: tx_type must be valid`);
  }
});

test('am_site_grading_and_drainage_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_site_grading_and_drainage_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_site_grading_and_drainage_guide missing`);
    assert.ok(g.total_site_prep_low_usd > 0, `rank ${c.rank}: total_site_prep_low_usd must be positive`);
    assert.ok(['existing_or_improved','semi_rural','rural_undeveloped'].includes(g.terrain_class), `rank ${c.rank}: terrain_class must be valid`);
  }
});

test('am_insurance_and_bonding_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_insurance_and_bonding_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_insurance_and_bonding_guide missing`);
    assert.ok(g.annual_total_ins_low_usd > 0, `rank ${c.rank}: annual_total_ins_low_usd must be positive`);
    assert.ok(g.surety_bond_low_usd > 0, `rank ${c.rank}: surety_bond_low_usd must be positive`);
    assert.ok(g.annual_total_ins_high_usd >= g.annual_total_ins_low_usd, `rank ${c.rank}: high must be >= low`);
  }
});

test('am_studio_transmitter_link_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_studio_transmitter_link_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_studio_transmitter_link_guide missing`);
    assert.ok(g.total_stl_setup_low_usd > 0, `rank ${c.rank}: total_stl_setup_low_usd must be positive`);
    assert.ok(g.total_stl_setup_high_usd >= g.total_stl_setup_low_usd, `rank ${c.rank}: high cost must be >= low`);
    assert.ok(['ip_audio_internet','microwave_950mhz'].includes(g.stl_type), `rank ${c.rank}: stl_type must be valid`);
  }
});

test('am_construction_project_schedule_and_management_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_construction_project_schedule_and_management_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_construction_project_schedule_and_management_guide missing`);
    assert.ok(g.total_months_low > 0, `rank ${c.rank}: total_months_low must be positive`);
    assert.ok(g.total_months_high >= g.total_months_low, `rank ${c.rank}: high must be >= low`);
    assert.strictEqual(g.is_clear, true, `rank ${c.rank}: KAZM 780 kHz is_clear should be true`);
  }
});

test('am_utility_power_service_and_metering_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_utility_power_service_and_metering_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_utility_power_service_and_metering_guide missing`);
    assert.ok(g.monthly_power_cost_usd > 0, `rank ${c.rank}: monthly_power_cost_usd must be positive`);
    assert.ok(g.total_utility_setup_low_usd >= 0, `rank ${c.rank}: total_utility_setup_low_usd must be non-negative`);
    assert.ok(['single_phase_240V','three_phase_208V'].includes(g.service_type), `rank ${c.rank}: service_type must be valid`);
  }
});

test('am_transmission_line_and_antenna_tuning_unit_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmission_line_and_antenna_tuning_unit_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_transmission_line_and_antenna_tuning_unit_guide missing`);
    assert.ok(g.r_base_est_ohm > 0, `rank ${c.rank}: r_base_est_ohm must be positive`);
    assert.ok(g.total_atu_system_low_usd > 0, `rank ${c.rank}: total_atu_system_low_usd must be positive`);
    assert.ok(g.total_atu_system_high_usd >= g.total_atu_system_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_tower_base_insulator_and_rf_isolation_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tower_base_insulator_and_rf_isolation_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_base_insulator_and_rf_isolation_guide missing`);
    assert.ok(g.tower_height_ft > 0, `rank ${c.rank}: tower_height_ft must be positive`);
    assert.ok(g.total_rf_isolation_low_usd > 0, `rank ${c.rank}: total_rf_isolation_low_usd must be positive`);
    assert.ok(g.total_rf_isolation_high_usd >= g.total_rf_isolation_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_emergency_alert_system_equipment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_emergency_alert_system_equipment_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_emergency_alert_system_equipment_guide missing`);
    assert.strictEqual(g.cap_compatible, true, `rank ${c.rank}: cap_compatible should be true`);
    assert.ok(g.total_eas_equipment_low_usd > 0, `rank ${c.rank}: total_eas_equipment_low_usd must be positive`);
    assert.strictEqual(g.n_required_sources, 2, `rank ${c.rank}: n_required_sources should be 2`);
  }
});

test('am_auxiliary_transmitter_and_backup_power_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_auxiliary_transmitter_and_backup_power_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_auxiliary_transmitter_and_backup_power_guide missing`);
    assert.ok(g.generator_kw > 0, `rank ${c.rank}: generator_kw must be positive`);
    assert.ok(g.total_backup_low_usd > 0, `rank ${c.rank}: total_backup_low_usd must be positive`);
    assert.ok(g.total_backup_high_usd >= g.total_backup_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_modulation_monitor_and_station_logging_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_modulation_monitor_and_station_logging_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_modulation_monitor_and_station_logging_guide missing`);
    assert.ok(g.monitor_cost_low_usd > 0, `rank ${c.rank}: monitor_cost_low_usd must be positive`);
    assert.ok(g.total_monitoring_low_usd > 0, `rank ${c.rank}: total_monitoring_low_usd must be positive`);
    assert.strictEqual(g.log_interval_min, 30, `rank ${c.rank}: log_interval_min should be 30`);
  }
});

test('am_transmitter_building_and_equipment_shelter_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmitter_building_and_equipment_shelter_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_transmitter_building_and_equipment_shelter_guide missing`);
    assert.ok(g.bldg_sqft > 0, `rank ${c.rank}: bldg_sqft must be positive`);
    assert.ok(g.total_shelter_low_usd > 0, `rank ${c.rank}: total_shelter_low_usd must be positive`);
    assert.ok(g.total_shelter_high_usd >= g.total_shelter_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_site_lease_and_land_acquisition_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_site_lease_and_land_acquisition_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_site_lease_and_land_acquisition_guide missing`);
    assert.ok(g.site_acres > 0, `rank ${c.rank}: site_acres must be positive`);
    assert.ok(g.purchase_total_low_usd > 0, `rank ${c.rank}: purchase_total_low_usd must be positive`);
    assert.ok(['suburban','rural_edge','rural'].includes(g.land_class), `rank ${c.rank}: land_class must be suburban/rural_edge/rural`);
  }
});

test('am_carrier_frequency_accuracy_and_reference_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_carrier_frequency_accuracy_and_reference_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_carrier_frequency_accuracy_and_reference_guide missing`);
    assert.ok(g.required_accuracy_hz > 0, `rank ${c.rank}: required_accuracy_hz must be positive`);
    assert.ok(g.gpsdo_cost_low_usd > 0, `rank ${c.rank}: gpsdo_cost_low_usd must be positive`);
    assert.strictEqual(g.recommended_reference, 'GPSDO', `rank ${c.rank}: recommended_reference should be GPSDO`);
  }
});

test('am_tower_decommissioning_and_site_remediation_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tower_decommissioning_and_site_remediation_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_decommissioning_and_site_remediation_guide missing`);
    assert.ok(g.tower_demo_ft > 0, `rank ${c.rank}: tower_demo_ft must be positive`);
    assert.ok(g.total_demo_cost_low_usd > 0, `rank ${c.rank}: total_demo_cost_low_usd must be positive`);
    assert.ok(g.net_demo_cost_high_usd >= 0, `rank ${c.rank}: net_demo_cost_high_usd must be non-negative`);
  }
});

test('am_ground_system_resistance_and_maintenance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_ground_system_resistance_and_maintenance_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_ground_system_resistance_and_maintenance_guide missing`);
    assert.ok(g.rg_est_ohm > 0, `rank ${c.rank}: rg_est_ohm must be positive`);
    assert.ok(typeof g.rg_acceptable === 'boolean', `rank ${c.rank}: rg_acceptable must be a boolean`);
    assert.ok(g.total_annual_ground_maint_high_usd >= g.total_annual_ground_maint_low_usd, `rank ${c.rank}: high cost >= low`);
  }
});

test('am_commissioning_and_acceptance_testing_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_commissioning_and_acceptance_testing_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_commissioning_and_acceptance_testing_guide missing`);
    assert.ok(g.total_commissioning_low_usd > 0, `rank ${c.rank}: total_commissioning_low_usd must be positive`);
    assert.ok(g.mpe_evaluation_required === true, `rank ${c.rank}: MPE evaluation required for all AM stations`);
    assert.ok(g.total_commissioning_high_usd >= g.total_commissioning_low_usd, `rank ${c.rank}: high cost >= low`);
  }
});

test('am_broadcast_tower_structural_inspection_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_broadcast_tower_structural_inspection_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_broadcast_tower_structural_inspection_guide missing`);
    assert.ok(g.tower_insp_ft > 0, `rank ${c.rank}: tower_insp_ft must be positive`);
    assert.ok(g.n_guy_levels >= 2, `rank ${c.rank}: n_guy_levels must be at least 2`);
    assert.ok(g.total_annual_inspection_high_usd >= g.total_annual_inspection_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_annual_regulatory_compliance_and_fee_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_annual_regulatory_compliance_and_fee_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_annual_regulatory_compliance_and_fee_guide missing`);
    assert.ok(g.annual_fcc_fee_usd > 0, `rank ${c.rank}: annual_fcc_fee_usd must be positive`);
    assert.ok(g.total_annual_compliance_low_usd > 0, `rank ${c.rank}: total_annual_compliance_low_usd must be positive`);
    assert.ok(g.license_renewal_cycle_years === 8, `rank ${c.rank}: license renewal cycle must be 8 years`);
  }
});

test('am_concrete_foundation_and_anchor_design_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_concrete_foundation_and_anchor_design_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_concrete_foundation_and_anchor_design_guide missing`);
    assert.ok(g.tower_fnd_ft > 0, `rank ${c.rank}: tower_fnd_ft must be positive`);
    assert.ok(g.total_concrete_cy > 0, `rank ${c.rank}: total_concrete_cy must be positive`);
    assert.ok(g.total_foundation_high_usd >= g.total_foundation_low_usd, `rank ${c.rank}: high cost must be >= low`);
  }
});

test('am_tower_painting_and_aviation_marking_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tower_painting_and_aviation_marking_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_painting_and_aviation_marking_guide missing`);
    assert.ok(g.tower_pnt_ft > 0, `rank ${c.rank}: tower_pnt_ft must be positive`);
    assert.ok(g.initial_paint_cost_low_usd > 0, `rank ${c.rank}: initial_paint_cost_low_usd must be positive`);
    assert.ok(g.life_20yr_paint_high_usd >= g.life_20yr_paint_low_usd, `rank ${c.rank}: high lifecycle cost must be >= low`);
  }
});

test('am_noise_floor_and_rf_environment_analysis_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_noise_floor_and_rf_environment_analysis_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_noise_floor_and_rf_environment_analysis_guide missing`);
    assert.ok(g.fa_atmospheric_db > 0, `rank ${c.rank}: fa_atmospheric_db must be positive`);
    assert.ok(g.noise_score >= 0 && g.noise_score <= 100, `rank ${c.rank}: noise_score must be 0-100`);
    assert.ok(['low','medium','high'].includes(g.interference_risk), `rank ${c.rank}: interference_risk must be low/medium/high`);
  }
});

test('am_phase_i_environmental_site_assessment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_phase_i_environmental_site_assessment_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_phase_i_environmental_site_assessment_guide missing`);
    assert.ok(g.site_acres > 0, `rank ${c.rank}: site_acres must be positive`);
    assert.ok(g.phase1_cost_low_usd > 0, `rank ${c.rank}: phase1_cost_low_usd must be positive`);
    assert.ok(g.total_esa_high_usd >= g.total_esa_low_usd, `rank ${c.rank}: high ESA cost must be >= low`);
  }
});

test('am_fcc_application_engineering_report_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_fcc_application_engineering_report_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_fcc_application_engineering_report_guide missing`);
    assert.ok(g.fcc_filing_fee_usd > 0, `rank ${c.rank}: fcc_filing_fee_usd must be positive`);
    assert.ok(g.n_stations_to_study > 0, `rank ${c.rank}: n_stations_to_study must be positive`);
    assert.ok(g.total_application_low_usd > 0, `rank ${c.rank}: total_application_low_usd must be positive`);
  }
});

test('am_site_access_road_and_security_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_site_access_road_and_security_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_site_access_road_and_security_guide missing`);
    assert.ok(g.fence_perim_ft > 0, `rank ${c.rank}: fence_perim_ft must be positive`);
    assert.ok(g.total_security_low_usd > 0, `rank ${c.rank}: total_security_low_usd must be positive`);
    assert.ok(g.annual_security_maint_usd > 0, `rank ${c.rank}: annual_security_maint_usd must be positive`);
  }
});

test('am_ground_system_installation_and_maintenance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_ground_system_installation_and_maintenance_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_ground_system_installation_and_maintenance_guide missing`);
    assert.ok(g.radial_length_ft > 0, `rank ${c.rank}: radial_length_ft must be positive`);
    assert.ok(g.total_high_usd >= g.total_low_usd, `rank ${c.rank}: total_high must be >= total_low`);
    assert.ok([120, 160].includes(g.recommended_radials), `rank ${c.rank}: recommended_radials must be 120 or 160`);
  }
});

test('am_rf_radiation_safety_and_compliance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
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
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_antenna_array_and_phasor_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_antenna_array_and_phasor_guide missing`);
    assert.ok(g.tower_count >= 1, `rank ${c.rank}: tower_count must be >= 1`);
    assert.ok(g.total_high_usd >= g.total_low_usd, `rank ${c.rank}: total_high must be >= total_low`);
    assert.ok(['single_tower_nda','two_tower_da','three_tower_da'].includes(g.array_type),
      `rank ${c.rank}: unexpected array_type: ${g.array_type}`);
  }
});

test('am_environmental_impact_assessment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_environmental_impact_assessment_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_environmental_impact_assessment_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.total_high_usd >= g.total_low_usd, `rank ${c.rank}: total_high must be >= total_low`);
    assert.ok(['categorical_exclusion','environmental_assessment'].includes(g.assessment_type),
      `rank ${c.rank}: unexpected assessment_type: ${g.assessment_type}`);
  }
});

test('am_tower_lighting_and_aviation_compliance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tower_lighting_and_aviation_compliance_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_lighting_and_aviation_compliance_guide missing`);
    assert.ok(g.tower_height_ft > 0, `rank ${c.rank}: tower_height_ft must be positive`);
    assert.ok(g.total_install_high_usd >= g.total_install_low_usd, `rank ${c.rank}: high must be >= low`);
    assert.ok(['none_required','medium_intensity_white_or_red','high_intensity_white_dual_red'].includes(g.lighting_type),
      `rank ${c.rank}: unexpected lighting_type: ${g.lighting_type}`);
  }
});

test('am_soil_conductivity_and_ground_loss_assessment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_soil_conductivity_and_ground_loss_assessment_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_soil_conductivity_and_ground_loss_assessment_guide missing`);
    assert.ok(g.sigma_est_ms_m > 0, `rank ${c.rank}: sigma_est_ms_m must be positive`);
    assert.ok(g.total_high_usd >= g.total_low_usd, `rank ${c.rank}: total_high must be >= total_low`);
    assert.ok(['arid_low','average'].includes(g.conductivity_tier),
      `rank ${c.rank}: unexpected conductivity_tier: ${g.conductivity_tier}`);
  }
});

test('am_zoning_and_land_use_permit_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_zoning_and_land_use_permit_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_zoning_and_land_use_permit_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.total_high_usd >= g.total_low_usd, `rank ${c.rank}: total_high must be >= total_low`);
    assert.ok(['small','medium','large'].includes(g.market_tier),
      `rank ${c.rank}: unexpected market_tier: ${g.market_tier}`);
  }
});

test('am_colocation_sharing_and_tower_lease_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_colocation_sharing_and_tower_lease_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_colocation_sharing_and_tower_lease_guide missing`);
    assert.ok(g.standalone_tower_low_usd > 0, `rank ${c.rank}: standalone_tower_low_usd must be positive`);
    assert.ok(g.colocation_10yr_high >= g.colocation_10yr_low, `rank ${c.rank}: 10yr high must be >= low`);
    assert.ok(g.tower_height_ft > 0, `rank ${c.rank}: tower_height_ft must be positive`);
  }
});

test('am_operating_cost_and_annual_expense_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_operating_cost_and_annual_expense_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_operating_cost_and_annual_expense_guide missing`);
    assert.ok(g.annual_total_low > 0, `rank ${c.rank}: annual_total_low must be positive`);
    assert.ok(g.annual_total_high >= g.annual_total_low, `rank ${c.rank}: high must be >= low`);
    assert.ok(g.annual_power_kw_input > 0, `rank ${c.rank}: annual_power_kw_input must be positive`);
  }
});

test('am_nighttime_operation_and_skywave_classification_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_nighttime_operation_and_skywave_classification_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_nighttime_operation_and_skywave_classification_guide missing`);
    assert.ok(g.effective_power_fraction > 0 && g.effective_power_fraction <= 1,
      `rank ${c.rank}: effective_power_fraction must be in (0,1]`);
    assert.ok(['secondary_limited_time','secondary_standard','dominant_unlimited'].includes(g.nighttime_status),
      `rank ${c.rank}: unexpected nighttime_status: ${g.nighttime_status}`);
  }
});

test('am_broadcast_proof_of_performance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_broadcast_proof_of_performance_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_broadcast_proof_of_performance_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.total_high_usd >= g.total_low_usd, `rank ${c.rank}: total_high must be >= total_low`);
    assert.ok(['nda_reference_check','full_directional_proof'].includes(g.proof_type),
      `rank ${c.rank}: unexpected proof_type: ${g.proof_type}`);
  }
});

test('am_financial_feasibility_and_roi_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_financial_feasibility_and_roi_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_financial_feasibility_and_roi_guide missing`);
    assert.ok(g.total_capital_low > 0, `rank ${c.rank}: total_capital_low must be positive`);
    assert.ok(g.total_capital_high >= g.total_capital_low, `rank ${c.rank}: total_capital_high must be >= low`);
    assert.ok(g.simple_payback_years_low > 0, `rank ${c.rank}: payback_years_low must be positive`);
  }
});

test('am_tower_guy_wire_and_anchor_system_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tower_guy_wire_and_anchor_system_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_guy_wire_and_anchor_system_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.num_total_anchors >= 9, `rank ${c.rank}: num_total_anchors must be >= 9`);
    assert.ok([3,4].includes(g.num_guy_levels), `rank ${c.rank}: num_guy_levels should be 3 or 4`);
  }
});

test('am_transmission_loss_budget_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmission_loss_budget_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_transmission_loss_budget_guide missing`);
    assert.ok(g.total_loss_db > 0, `rank ${c.rank}: total_loss_db must be positive`);
    assert.ok(g.power_fraction_at_antenna > 0.9, `rank ${c.rank}: power_fraction_at_antenna must be > 0.9`);
    assert.ok(['7_8_inch','1_5_8_inch','3_inch'].includes(g.coax_diameter),
      `rank ${c.rank}: unexpected coax_diameter: ${g.coax_diameter}`);
  }
});

test('am_grounding_and_lightning_protection_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_grounding_and_lightning_protection_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_grounding_and_lightning_protection_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.total_high_usd >= g.total_low_usd, `rank ${c.rank}: total_high must be >= total_low`);
    assert.ok(g.num_ground_rods > 0, `rank ${c.rank}: num_ground_rods must be positive`);
  }
});

test('am_fcc_asr_tower_registration_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_fcc_asr_tower_registration_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_fcc_asr_tower_registration_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(typeof g.requires_asr === 'boolean', `rank ${c.rank}: requires_asr must be boolean`);
    assert.ok(g.tower_height_ft > 0, `rank ${c.rank}: tower_height_ft must be positive`);
  }
});

test('am_site_access_and_road_construction_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_site_access_and_road_construction_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_site_access_and_road_construction_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.road_length_mi >= 0.25, `rank ${c.rank}: road_length_mi must be >= 0.25 (minimum)`);
    assert.ok(g.road_length_mi <= 2.0, `rank ${c.rank}: road_length_mi must be <= 2.0 (maximum)`);
  }
});

test('am_utility_power_and_backup_systems_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_utility_power_and_backup_systems_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_utility_power_and_backup_systems_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.gen_kw > 0, `rank ${c.rank}: gen_kw must be positive`);
    assert.ok(g.power_ext_mi >= 0.1, `rank ${c.rank}: power_ext_mi must be >= 0.1 (minimum)`);
  }
});

test('am_transmitter_building_and_studio_link_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmitter_building_and_studio_link_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_transmitter_building_and_studio_link_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(['licensed_950mhz_microwave','leased_circuit_or_fiber'].includes(g.stl_type),
      `rank ${c.rank}: unexpected stl_type: ${g.stl_type}`);
  }
});

test('am_fcc_construction_permit_and_license_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_fcc_construction_permit_and_license_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_fcc_construction_permit_and_license_guide missing`);
    assert.ok(g.total_nonrecurring_low_usd > 0, `rank ${c.rank}: total_nonrecurring_low_usd must be positive`);
    assert.ok(typeof g.isDA === 'boolean', `rank ${c.rank}: isDA must be boolean`);
    assert.ok(Array.isArray(g.filing_forms), `rank ${c.rank}: filing_forms must be array`);
  }
});

test('am_signal_contour_and_coverage_area_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_signal_contour_and_coverage_area_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_signal_contour_and_coverage_area_guide missing`);
    assert.ok(g.r_5mvm_km > 0, `rank ${c.rank}: r_5mvm_km must be positive`);
    assert.ok(g.r_05mvm_km > g.r_5mvm_km, `rank ${c.rank}: r_05mvm_km must be > r_5mvm_km`);
    assert.ok(g.area_5mvm_km2 > 0, `rank ${c.rank}: area_5mvm_km2 must be positive`);
  }
});

test('am_nighttime_skywave_interference_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_nighttime_skywave_interference_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_nighttime_skywave_interference_guide missing`);
    assert.ok(g.total_study_low_usd > 0, `rank ${c.rank}: total_study_low_usd must be positive`);
    assert.ok(typeof g.is_clear_channel === 'boolean', `rank ${c.rank}: is_clear_channel must be boolean`);
    assert.ok(typeof g.nighttime_power_note === 'string', `rank ${c.rank}: nighttime_power_note must be string`);
  }
});

test('am_real_estate_and_land_acquisition_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_real_estate_and_land_acquisition_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_real_estate_and_land_acquisition_guide missing`);
    assert.ok(g.total_purchase_low_usd > 0, `rank ${c.rank}: total_purchase_low_usd must be positive`);
    assert.ok(g.min_acres >= 2, `rank ${c.rank}: min_acres must be >= 2`);
    assert.ok(g.radial_ft > 0, `rank ${c.rank}: radial_ft must be positive`);
  }
});

test('am_total_project_cost_summary_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_total_project_cost_summary_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_total_project_cost_summary_guide missing`);
    assert.ok(g.grand_total_low_usd > 0, `rank ${c.rank}: grand_total_low_usd must be positive`);
    assert.ok(g.total_with_contingency_low_usd > g.grand_total_low_usd, `rank ${c.rank}: contingency must increase total`);
    assert.ok(typeof g.line_items_low === 'object', `rank ${c.rank}: line_items_low must be object`);
  }
});

test('am_community_impact_and_coverage_shift_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_community_impact_and_coverage_shift_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_community_impact_and_coverage_shift_guide missing`);
    assert.ok(typeof g.col_proximity_status === 'string', `rank ${c.rank}: col_proximity_status must be string`);
    assert.ok(['excellent (<15 km)','acceptable (15–30 km)','needs_waiver_review (>30 km)'].includes(g.col_proximity_status),
      `rank ${c.rank}: unexpected col_proximity_status: ${g.col_proximity_status}`);
  }
});

test('am_transmitter_decommission_and_site_remediation_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmitter_decommission_and_site_remediation_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_transmitter_decommission_and_site_remediation_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.num_towers >= 1, `rank ${c.rank}: num_towers must be >= 1`);
    assert.ok(g.tower_height_ft > 0, `rank ${c.rank}: tower_height_ft must be positive`);
  }
});

test('am_interference_protection_contour_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_interference_protection_contour_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_interference_protection_contour_guide missing`);
    assert.ok(g.du_cochannel_db > 0, `rank ${c.rank}: du_cochannel_db must be positive`);
    assert.ok(g.study_low_usd > 0, `rank ${c.rank}: study_low_usd must be positive`);
    assert.ok(typeof g.is_clear_channel === 'boolean', `rank ${c.rank}: is_clear_channel must be boolean`);
  }
});

test('am_tower_painting_and_marking_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tower_painting_and_marking_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tower_painting_and_marking_guide missing`);
    assert.ok(typeof g.requires_painting === 'boolean', `rank ${c.rank}: requires_painting must be boolean`);
    assert.ok(g.total_initial_low_usd > 0, `rank ${c.rank}: total_initial_low_usd must be positive`);
    if (g.requires_painting) {
      assert.ok(g.num_bands > 0, `rank ${c.rank}: num_bands must be > 0 when painting required`);
    }
  }
});

test('am_ground_system_radial_design_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_ground_system_radial_design_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_ground_system_radial_design_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.num_radials_ideal === 120, `rank ${c.rank}: num_radials_ideal should be 120`);
    assert.ok(g.radial_length_ft > 0, `rank ${c.rank}: radial_length_ft must be positive`);
  }
});

test('am_tpo_and_antenna_efficiency_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tpo_and_antenna_efficiency_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_tpo_and_antenna_efficiency_guide missing`);
    assert.ok(g.eta_excellent > 0.9, `rank ${c.rank}: eta_excellent must be > 0.9`);
    assert.ok(g.erp_excellent_kw > 0, `rank ${c.rank}: erp_excellent_kw must be positive`);
    assert.ok(g.erp_excellent_kw <= g.tpo_kw, `rank ${c.rank}: erp must be <= tpo (losses exist)`);
  }
});

test('am_frequency_allocation_class_and_channel_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_frequency_allocation_class_and_channel_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_frequency_allocation_class_and_channel_guide missing`);
    assert.ok(['clear','local','regional'].includes(g.channel_type), `rank ${c.rank}: unexpected channel_type: ${g.channel_type}`);
    assert.ok(g.class_max_day_kw > 0, `rank ${c.rank}: class_max_day_kw must be positive`);
  }
});

test('am_modulation_and_audio_processing_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_modulation_and_audio_processing_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_modulation_and_audio_processing_guide missing`);
    assert.ok(g.pos_mod_limit_pct === 125, `rank ${c.rank}: pos_mod_limit_pct should always be 125%`);
    assert.ok(g.iboc_digital_kw >= 0, `rank ${c.rank}: iboc_digital_kw must be >= 0`);
    assert.ok(g.total_basic_low_usd > 0, `rank ${c.rank}: total_basic_low_usd must be positive`);
  }
});

test('am_annual_operating_cost_breakdown_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_annual_operating_cost_breakdown_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_annual_operating_cost_breakdown_guide missing`);
    assert.ok(g.total_low_usd > 0, `rank ${c.rank}: total_low_usd must be positive`);
    assert.ok(g.kwh_per_year > 0, `rank ${c.rank}: kwh_per_year must be positive`);
    assert.ok(g.electricity_draw_kw >= 3, `rank ${c.rank}: electricity_draw_kw must be >= 3 (3× TPO min 1 kW)`);
  }
});

test('am_terrain_and_propagation_assessment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_terrain_and_propagation_assessment_guide;
    assert.ok(g !== undefined && g !== null, `rank ${c.rank}: am_terrain_and_propagation_assessment_guide missing`);
    assert.ok(g.conductivity_ms_per_m_low > 0, `rank ${c.rank}: conductivity_ms_per_m_low must be positive`);
    assert.ok(Array.isArray(g.study_tools), `rank ${c.rank}: study_tools must be array`);
    assert.ok(g.terrain_study_low_usd > 0, `rank ${c.rank}: terrain_study_low_usd must be positive`);
  }
});

test('am_tower_foundation_and_civil_engineering_guide colocation: all colocation candidates have valid tower foundation data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_tower_foundation_and_civil_engineering_guide;
    assert.ok(g, `candidate missing am_tower_foundation_and_civil_engineering_guide`);
    assert.ok(g.tower_height_m > 0, `tower_height_m must be positive`);
    assert.ok(g.civil_foundation_low_usd > 0, `civil_foundation_low_usd must be positive`);
    assert.ok(g.guy_anchor_count === 3, `guy_anchor_count should be 3 for guyed AM monopole`);
  }
});

test('am_rf_exposure_and_oet65_compliance_guide colocation: all colocation candidates have valid RF exposure data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_rf_exposure_and_oet65_compliance_guide;
    assert.ok(g, `candidate missing am_rf_exposure_and_oet65_compliance_guide`);
    assert.ok(g.exclusion_radius_m_general > 0, `exclusion_radius_m_general must be positive`);
    assert.ok(typeof g.evaluation_required === 'boolean', `evaluation_required must be boolean`);
    assert.ok(g.mpe_general_mv_per_m === 614, `mpe_general_mv_per_m must be 614 mV/m (FCC limit)`);
  }
});

test('am_faa_aeronautical_study_and_airspace_guide colocation: all colocation candidates have valid FAA data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_faa_aeronautical_study_and_airspace_guide;
    assert.ok(g, `candidate missing am_faa_aeronautical_study_and_airspace_guide`);
    assert.ok(g.tower_height_ft > 0, `tower_height_ft must be positive`);
    assert.ok(typeof g.notice_required === 'boolean', `notice_required must be boolean`);
    assert.ok(g.faa_study_cost_low_usd > 0, `faa_study_cost_low_usd must be positive`);
  }
});

test('am_environmental_and_nepa_compliance_guide colocation: all colocation candidates have valid NEPA data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_environmental_and_nepa_compliance_guide;
    assert.ok(g, `candidate missing am_environmental_and_nepa_compliance_guide`);
    assert.ok(g.total_env_cost_low_usd > 0, `total_env_cost_low_usd must be positive`);
    assert.ok(['CATEGORICAL_EXCLUSION','EA_REQUIRED'].includes(g.nepa_category), `nepa_category must be valid`);
    assert.ok(g.phase1_esa_low_usd > 0, `phase1_esa_low_usd must be positive`);
  }
});

test('am_zoning_and_land_use_approval_guide colocation: all colocation candidates have valid zoning data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_zoning_and_land_use_approval_guide;
    assert.ok(g, `candidate missing am_zoning_and_land_use_approval_guide`);
    assert.ok(g.setback_ft_typical > 0, `setback_ft_typical must be positive`);
    assert.ok(g.min_parcel_acres > 0, `min_parcel_acres must be positive`);
    assert.ok(g.total_zoning_low_usd > 0, `total_zoning_low_usd must be positive`);
  }
});

test('am_transmission_line_and_phasor_guide colocation: all colocation candidates have valid TL data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_transmission_line_and_phasor_guide;
    assert.ok(g, `candidate missing am_transmission_line_and_phasor_guide`);
    assert.ok(g.lambda_m > 0, `lambda_m must be positive`);
    assert.ok(g.total_tl_system_low_usd > 0, `total_tl_system_low_usd must be positive`);
    assert.ok(typeof g.is_directional === 'boolean', `is_directional must be boolean`);
  }
});

test('am_insurance_and_liability_guide colocation: all colocation candidates have valid insurance data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_insurance_and_liability_guide;
    assert.ok(g, `candidate missing am_insurance_and_liability_guide`);
    assert.ok(g.total_annual_insurance_low_usd > 0, `total_annual_insurance_low_usd must be positive`);
    assert.ok(g.tower_replacement_value_low_usd > 0, `tower_replacement_value_low_usd must be positive`);
    assert.ok(g.annual_gl_premium_low_usd > 0, `annual_gl_premium_low_usd must be positive`);
  }
});

test('am_tower_structural_analysis_guide colocation: all colocation candidates have valid structural data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_tower_structural_analysis_guide;
    assert.ok(g, `candidate missing am_tower_structural_analysis_guide`);
    assert.ok(g.tower_height_ft > 0, `tower_height_ft must be positive`);
    assert.ok(g.guy_levels >= 1, `guy_levels must be at least 1`);
    assert.ok(g.total_structural_low_usd > 0, `total_structural_low_usd must be positive`);
  }
});

test('am_broadcast_facility_security_guide colocation: all colocation candidates have valid security data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_broadcast_facility_security_guide;
    assert.ok(g, `candidate missing am_broadcast_facility_security_guide`);
    assert.strictEqual(g.fence_height_ft, 8, `fence_height_ft must be 8 per §73.49`);
    assert.ok(g.total_security_capex_low_usd > 0, `total_security_capex_low_usd must be positive`);
    assert.ok(g.fence_perimeter_ft > 0, `fence_perimeter_ft must be positive`);
  }
});

test('am_frequency_monitoring_and_technical_compliance_guide colocation: all candidates have valid monitoring data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_frequency_monitoring_and_technical_compliance_guide;
    assert.ok(g, `candidate missing am_frequency_monitoring_and_technical_compliance_guide`);
    assert.strictEqual(g.freq_tolerance_hz, 20, `freq_tolerance_hz must be 20 Hz`);
    assert.ok(g.total_monitoring_equip_low_usd > 0, `total_monitoring_equip_low_usd must be positive`);
    assert.strictEqual(g.audio_bandwidth_khz, 10, `audio_bandwidth_khz must be 10 kHz (NRSC-2-B)`);
  }
});

test('am_station_financial_feasibility_guide colocation: all candidates have valid financial data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_station_financial_feasibility_guide;
    assert.ok(g, `candidate missing am_station_financial_feasibility_guide`);
    assert.ok(Number.isFinite(g.npv_optimistic_10yr), `npv_optimistic_10yr must be finite`);
    assert.ok(g.capex_low_usd > 0, `capex_low_usd must be positive`);
    assert.ok(['POTENTIALLY_VIABLE','FINANCIALLY_CHALLENGED'].includes(g.feasibility_flag), `feasibility_flag must be valid`);
  }
});

test('am_construction_contractor_and_pm_guide colocation: all candidates have valid PM data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_construction_contractor_and_pm_guide;
    assert.ok(g, `candidate missing am_construction_contractor_and_pm_guide`);
    assert.ok(g.total_construction_weeks_low > 0, `total_construction_weeks_low must be positive`);
    assert.ok(g.tower_erection_cost_low_usd > 0, `tower_erection_cost_low_usd must be positive`);
    assert.ok(g.gc_markup_pct_low > 0 && g.gc_markup_pct_low < 100, `gc_markup_pct_low must be 0-100`);
  }
});

test('am_antenna_tower_lighting_and_marking_guide colocation: all candidates have valid lighting data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_antenna_tower_lighting_and_marking_guide;
    assert.ok(g, `candidate missing am_antenna_tower_lighting_and_marking_guide`);
    assert.ok(g.tower_height_ft > 0, `tower_height_ft must be positive`);
    assert.ok(typeof g.lighting_required === 'boolean', `lighting_required must be boolean`);
    assert.ok(g.painting_cost_low_usd >= 0, `painting_cost_low_usd must be non-negative`);
  }
});

test('am_daytime_vs_nighttime_coverage_differential_guide colocation: all candidates have valid day/night data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_daytime_vs_nighttime_coverage_differential_guide;
    assert.ok(g, `candidate missing am_daytime_vs_nighttime_coverage_differential_guide`);
    assert.ok(g.daytime_05mvpm_radius_km > 0, `daytime_05mvpm_radius_km must be positive`);
    assert.ok(typeof g.is_clear_channel === 'boolean', `is_clear_channel must be boolean`);
    assert.ok(g.nighttime_restriction != null, `nighttime_restriction must not be null`);
  }
});

test('am_digital_broadcasting_iboc_guide colocation: all candidates have valid IBOC data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_digital_broadcasting_iboc_guide;
    assert.ok(g, `candidate missing am_digital_broadcasting_iboc_guide`);
    assert.ok(g.digital_sideband_kw > 0, `digital_sideband_kw must be positive`);
    assert.ok(g.total_iboc_capex_low_usd > 0, `total_iboc_capex_low_usd must be positive`);
    assert.ok(g.iboc_bandwidth_khz === 30, `iboc_bandwidth_khz must be 30 kHz (hybrid AM IBOC)`);
  }
});

test('colocation candidates include am_tower_base_rf_safety_and_detuning_guide with §73.49 fence', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_tower_base_rf_safety_and_detuning_guide;
    assert.ok(g, `candidate missing am_tower_base_rf_safety_and_detuning_guide`);
    assert.strictEqual(g.fence_required_by_regulation, true, '§73.49 fence required on all AM towers');
    assert.ok(g.v_base_high_vrms > 0, `v_base_high_vrms must be positive`);
    assert.ok(g.total_rf_safety_low_usd > 0, `total_rf_safety_low_usd must be positive`);
  }
});

test('colocation candidates include am_antenna_base_current_and_impedance_monitoring_guide with §73.61 tolerance', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_antenna_base_current_and_impedance_monitoring_guide;
    assert.ok(g, `candidate missing am_antenna_base_current_and_impedance_monitoring_guide`);
    assert.strictEqual(g.i_base_tolerance_pct, 2, '§73.61 requires ±2% base current tolerance');
    assert.ok(g.total_monitoring_equip_low_usd > 0, `total_monitoring_equip_low_usd must be positive`);
    assert.ok(g.calibration_interval_months === 12, `calibration_interval_months must be 12`);
  }
});

test('colocation candidates include am_broadcast_tower_grounding_and_cathodic_protection_guide', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_broadcast_tower_grounding_and_cathodic_protection_guide;
    assert.ok(g, `candidate missing am_broadcast_tower_grounding_and_cathodic_protection_guide`);
    assert.strictEqual(g.n_radials_standard, 120, 'standard ground system = 120 radials');
    assert.ok(g.total_ground_low_usd > 0, `total_ground_low_usd must be positive`);
    assert.ok(g.cp_recommended != null, `cp_recommended must be defined`);
  }
});

test('colocation candidates include am_tower_structural_load_and_wind_survival_guide with TIA-222-H wind data', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_tower_structural_load_and_wind_survival_guide;
    assert.ok(g, `candidate missing am_tower_structural_load_and_wind_survival_guide`);
    assert.strictEqual(g.wind_design_mph, 90, 'design wind speed must be 90 mph per ASCE 7-22 Risk Cat II');
    assert.ok(g.wind_force_kn > 0, `wind_force_kn must be positive`);
    assert.ok(g.total_structural_low_usd > 0, `total_structural_low_usd must be positive`);
  }
});

test('colocation candidates include am_eas_equipment_readiness_guide with §11.56 CAP/IPAWS required', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_eas_equipment_readiness_guide;
    assert.ok(g, `candidate missing am_eas_equipment_readiness_guide`);
    assert.strictEqual(g.eas_cap_ipaws_required, true, '§11.56 CAP/IPAWS required for all AM stations since 2012');
    assert.strictEqual(g.eas_monthly_test_min_sec, 120, '§11.61 RMT ≥ 120 s');
    assert.ok(g.total_eas_low_usd > 0, `total_eas_low_usd must be positive`);
  }
});

test('colocation candidates include am_auxiliary_backup_transmitter_compliance_guide with §73.1560 power tolerance', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_auxiliary_backup_transmitter_compliance_guide;
    assert.ok(g, `candidate missing am_auxiliary_backup_transmitter_compliance_guide`);
    assert.strictEqual(g.power_tolerance_pct, 10, '§73.1560 AM power tolerance ±10%');
    assert.strictEqual(g.backup_tpo_kw, 5, 'backup_tpo_kw must equal authorized tpo_kw');
    assert.ok(g.total_backup_low_usd > 0, `total_backup_low_usd must be positive`);
  }
});

test('colocation candidates include am_license_renewal_and_regulatory_history_guide with §73.1125 main studio check', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_license_renewal_and_regulatory_history_guide;
    assert.ok(g, `candidate missing am_license_renewal_and_regulatory_history_guide`);
    assert.strictEqual(g.renewal_cycle_years, 8, '§73.3539 renewal cycle = 8 years');
    assert.ok(Math.abs(g.main_studio_max_distance_km - 40.23) < 0.01, '§73.1125 limit = 40.23 km');
    assert.ok(g.total_renewal_low_usd > 0, `total_renewal_low_usd must be positive`);
  }
});

test('colocation candidates include am_skywave_nighttime_service_and_interference_guide with §73.182 D/U obligation', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_skywave_nighttime_service_and_interference_guide;
    assert.ok(g, `candidate missing am_skywave_nighttime_service_and_interference_guide`);
    assert.strictEqual(g.is_clear_channel, true, '780 kHz is a clear channel');
    assert.strictEqual(g.night_signoff_risk, true, 'Class D on 780 kHz has nighttime sign-off risk');
    assert.ok(g.dominant_station.includes('KKOB'), 'dominant on 780 kHz is KKOB');
  }
});

test('colocation candidates include am_antenna_insulator_and_base_voltage_protection_guide with V_peak check', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_antenna_insulator_and_base_voltage_protection_guide;
    assert.ok(g, `candidate missing am_antenna_insulator_and_base_voltage_protection_guide`);
    assert.ok(g.v_peak_kv > 0, 'v_peak_kv must be positive');
    assert.ok(g.insulator_rating_kv_min >= 15, 'insulator_rating_kv_min must be ≥ 15 kV BIL');
    assert.ok(g.insulator_margin_ratio > 1, 'insulator must be rated above V_peak');
  }
});

test('colocation candidates include am_directional_antenna_phase_and_ratio_verification_guide (NDA = zero DA cost)', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_directional_antenna_phase_and_ratio_verification_guide;
    assert.ok(g, `candidate missing am_directional_antenna_phase_and_ratio_verification_guide`);
    assert.strictEqual(g.is_da_station, false, 'KAZM NDA should not be DA');
    assert.strictEqual(g.total_da_low_usd, 0, 'NDA station DA compliance cost must be 0');
    assert.strictEqual(g.phase_tolerance_deg, 3, '§73.68(a) phase tolerance = ±3°');
  }
});

test('colocation candidates include am_transmission_line_and_atu_engineering_guide with VSWR target', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_transmission_line_and_atu_engineering_guide;
    assert.ok(g, `candidate missing am_transmission_line_and_atu_engineering_guide`);
    assert.strictEqual(g.atu_design_required, true, 'ATU design required at every new site');
    assert.strictEqual(g.vswr_target, 1.3, 'VSWR target must be 1.3:1');
    assert.ok(g.total_atu_low_usd > 0, 'total_atu_low_usd must be positive');
  }
});

test('colocation candidates include am_station_power_supply_and_electrical_infrastructure_guide with NEC 702.5 sizing', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_station_power_supply_and_electrical_infrastructure_guide;
    assert.ok(g, `candidate missing am_station_power_supply_and_electrical_infrastructure_guide`);
    assert.ok(g.ac_input_kw > 0, 'ac_input_kw must be positive');
    assert.ok(g.generator_kw_required >= g.site_load_kw * 1.25 - 0.1, 'generator must be ≥ 125% of site load (NEC 702.5)');
    assert.ok(g.total_electrical_low_usd > 0, 'total_electrical_low_usd must be positive');
  }
});

test('colocation candidates include am_contour_overlap_and_co_channel_interference_guide with §73.182 D/U check', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_contour_overlap_and_co_channel_interference_guide;
    assert.ok(g, `candidate missing am_contour_overlap_and_co_channel_interference_guide`);
    assert.strictEqual(g.protection_db_required, 20, '§73.182(c) D/U requirement = 20 dB');
    assert.strictEqual(g.adjacent_ch_low_khz, 770, 'adjacent lower channel is 770 kHz');
    assert.strictEqual(g.adjacent_ch_high_khz, 790, 'adjacent upper channel is 790 kHz');
  }
});

test('colocation candidates include am_operating_log_and_technical_records_compliance_guide with §73.1840 retention', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_operating_log_and_technical_records_compliance_guide;
    assert.ok(g, `candidate missing am_operating_log_and_technical_records_compliance_guide`);
    assert.strictEqual(g.log_retention_years, 2, '§73.1840 retention = 2 years');
    assert.strictEqual(g.log_public_file_required, true, 'online public file required per §73.3527');
    assert.ok(g.total_setup_low_usd > 0, 'total_setup_low_usd must be positive');
  }
});

test('colocation candidates include am_transmitter_site_lease_and_property_rights_guide with site area calculation', async () => {
  const out = await runColocationOpportunities({
    callsign: 'KAZM', frequency_khz: 780, current_site: { lat: 34.8606, lon: -111.8206 },
    search_radius_km: 30, grid_spacing_km: 15, tpo_kw: 5, pattern_mode: 'NDA',
    fcc_class: 'D', search_mode: 'GRID', candidate_limit: 3,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.am_transmitter_site_lease_and_property_rights_guide;
    assert.ok(g, `candidate missing am_transmitter_site_lease_and_property_rights_guide`);
    assert.ok(g.site_area_required_acres > 5, 'site area must be > 5 acres for 780 kHz');
    assert.ok(g.lease_annual_low_usd > 0, 'lease_annual_low_usd must be positive');
    assert.ok(g.total_acquisition_low_usd > 0, 'total_acquisition must be positive');
  }
});

test('am_modulation_monitoring_and_audio_processing_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_modulation_monitoring_and_audio_processing_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_modulation_monitoring_and_audio_processing_guide`);
    assert.strictEqual(g.max_positive_peak_pct, 125, 'positive peak limit must be 125% per §73.1570(b)');
    assert.strictEqual(g.max_negative_peak_pct, 100, 'negative peak limit must be 100% per §73.1570(b)');
    assert.ok(g.total_audio_low_usd > 0, 'total_audio_low_usd must be positive');
  }
});

test('am_public_inspection_file_and_online_compliance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_public_inspection_file_and_online_compliance_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_public_inspection_file_and_online_compliance_guide`);
    assert.strictEqual(g.opif_mandatory, true, 'OPIF mandatory for all AM stations since 2020');
    assert.strictEqual(g.political_file_upload_days, 1, 'political file upload within 1 business day');
    assert.ok(g.total_setup_low_usd > 0, 'total_setup_low_usd must be positive');
  }
});

test('am_noise_floor_and_rf_interference_environment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_noise_floor_and_rf_interference_environment_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_noise_floor_and_rf_interference_environment_guide`);
    assert.strictEqual(g.fa_atmospheric_dBuVm, 53.0, 'ITU-R P.372-16 zone B atmospheric noise must be 53 dBµV/m');
    assert.ok(g.ft_dBuVm >= g.fa_atmospheric_dBuVm, 'combined noise Ft must be >= atmospheric alone');
    assert.ok(['LOW', 'ELEVATED', 'HIGH'].includes(g.noise_risk_level), 'noise_risk_level must be LOW/ELEVATED/HIGH');
  }
});

test('am_fm_translator_and_signal_booster_filing_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_fm_translator_and_signal_booster_filing_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_fm_translator_and_signal_booster_filing_guide`);
    assert.strictEqual(g.translator_eligible, true, 'all AM stations eligible for FM translator per §74.1201(g)');
    assert.strictEqual(g.translator_max_erp_w, 250, 'FM translator max ERP is 250 W per §74.1235(a)');
    assert.ok(g.total_translator_low_usd > 0, 'total_translator_low_usd must be positive');
  }
});

test('am_nrsc_emission_mask_and_bandwidth_compliance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_nrsc_emission_mask_and_bandwidth_compliance_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_nrsc_emission_mask_and_bandwidth_compliance_guide`);
    assert.strictEqual(g.occupied_bw_khz, 20, 'AM occupied bandwidth must be 20 kHz (±10 kHz NRSC-1-A audio)');
    assert.strictEqual(g.harmonic_suppression_required_dBc, 40, '§73.44(e) requires 40 dBc harmonic suppression');
    assert.ok(Array.isArray(g.nrsc2b_mask) && g.nrsc2b_mask.length >= 3, 'nrsc2b_mask must have mask points');
  }
});

test('am_remote_control_and_unattended_operation_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_remote_control_and_unattended_operation_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_remote_control_and_unattended_operation_guide`);
    assert.strictEqual(g.operator_response_time_hrs, 2, '§73.1300 operator response time must be 2 hours');
    assert.strictEqual(g.rc_accuracy_pct, 2.0, '§73.1400 remote control accuracy must be ±2%');
    assert.ok(g.total_rc_low_usd > 0, 'total_rc_low_usd must be positive');
  }
});

test('am_nighttime_nif_service_contour_analysis_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_nighttime_nif_service_contour_analysis_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_nighttime_nif_service_contour_analysis_guide`);
    assert.strictEqual(g.protection_threshold_uVm, 50, 'Class D clear channel protection threshold must be 50 µV/m');
    assert.ok(g.dist_to_kkob_km > 0, 'dist_to_kkob_km must be positive');
    assert.ok(g.total_nif_low_usd >= 2000, 'NIF study cost must be ≥$2,000');
  }
});

test('am_transmitter_power_efficiency_and_operating_cost_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmitter_power_efficiency_and_operating_cost_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_transmitter_power_efficiency_and_operating_cost_guide`);
    assert.strictEqual(g.overall_efficiency_pct, 72, 'solid-state AM transmitter overall efficiency must be 72%');
    assert.ok(g.ac_input_kw > 0, 'ac_input_kw must be positive');
    assert.ok(g.annual_electric_usd > 0, 'annual_electric_usd must be positive');
  }
});

test('am_site_environmental_impact_and_permitting_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_site_environmental_impact_and_permitting_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_site_environmental_impact_and_permitting_guide`);
    assert.ok(typeof g.nepa_trigger === 'string', 'nepa_trigger must be a string');
    assert.strictEqual(g.cup_required, true, 'cup_required must be true for colocation candidate');
    assert.ok(g.total_permitting_low_usd > 0, 'total_permitting_low_usd must be positive');
  }
});

test('am_site_access_and_utility_infrastructure_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_site_access_and_utility_infrastructure_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_site_access_and_utility_infrastructure_guide`);
    assert.ok(g.generator_kw > 0, 'generator_kw must be positive');
    assert.ok(typeof g.road_access_type === 'string', 'road_access_type must be a string');
    assert.ok(g.total_infra_low_usd > 0, 'total_infra_low_usd must be positive');
  }
});

test('am_antenna_system_impedance_and_base_current_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_antenna_system_impedance_and_base_current_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_antenna_system_impedance_and_base_current_guide`);
    assert.ok(g.base_current_a > 0, 'base_current_a must be positive');
    assert.ok(g.ct_rating_a >= g.base_current_peak_a, 'CT must cover peak base current');
    assert.strictEqual(g.r_rad, 36.5, 'r_rad must be 36.5 Ω for λ/4 monopole');
  }
});

test('am_propagation_groundwave_field_strength_estimate_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_propagation_groundwave_field_strength_estimate_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_propagation_groundwave_field_strength_estimate_guide`);
    assert.ok(g.contour_05mvm_radius_km > 0, 'contour_05mvm_radius_km must be positive');
    assert.ok(g.contour_01mvm_radius_km > g.contour_05mvm_radius_km, '0.1 mV/m must be farther than 0.5 mV/m');
    assert.ok(g.study_cost_low_usd > 0, 'study_cost_low_usd must be positive');
  }
});

test('am_tower_lighting_and_painting_compliance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tower_lighting_and_painting_compliance_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_tower_lighting_and_painting_compliance_guide`);
    assert.ok(g.tower_height_ft > 0, 'tower_height_ft must be positive');
    assert.ok(typeof g.asr_required === 'boolean', 'asr_required must be boolean');
    assert.ok(g.total_lighting_low_usd > 0, 'total_lighting_low_usd must be positive');
  }
});

test('am_ground_radial_system_design_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_ground_radial_system_design_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_ground_radial_system_design_guide`);
    assert.ok(g.quarter_wave_ft > 0, 'quarter_wave_ft must be positive');
    assert.ok(g.efficiency_full_pct > 50, 'efficiency_full_pct must be > 50%');
    assert.ok(g.total_radial_system_low_usd > 0, 'total_radial_system_low_usd must be positive');
  }
});

test('am_daytime_nighttime_power_reduction_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_daytime_nighttime_power_reduction_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_daytime_nighttime_power_reduction_guide`);
    assert.ok(typeof g.is_clear_channel === 'boolean', 'is_clear_channel must be boolean');
    assert.ok(g.summer_day_length_h > 0, 'summer_day_length_h must be positive');
    assert.ok(g.summer_day_length_h > g.winter_day_length_h, 'summer must be longer than winter');
  }
});

test('am_transmission_line_and_coaxial_feed_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmission_line_and_coaxial_feed_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_transmission_line_and_coaxial_feed_guide`);
    assert.ok(g.alpha_78_db_per100ft > 0, 'alpha_78_db_per100ft must be positive');
    assert.ok(g.efficiency_78_pct > 90, 'efficiency_78_pct must be > 90% at AM frequencies');
    assert.ok(typeof g.recommended_cable === 'string', 'recommended_cable must be a string');
  }
});

test('am_rf_exposure_mpe_evaluation_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_rf_exposure_mpe_evaluation_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_rf_exposure_mpe_evaluation_guide`);
    assert.ok(typeof g.eval_required === 'boolean', 'eval_required must be boolean');
    assert.ok(g.r_gp_exclusion_m > 0, 'r_gp_exclusion_m must be positive');
    assert.strictEqual(g.e_limit_gp_vm, 614, 'GP limit must be 614 V/m');
  }
});

test('am_tower_structural_load_analysis_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tower_structural_load_analysis_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_tower_structural_load_analysis_guide`);
    assert.ok(g.tower_height_ft > 0, 'tower_height_ft must be positive');
    assert.ok(g.total_wind_load_lbf > 0, 'total_wind_load_lbf must be positive');
    assert.ok(g.total_structural_low_usd > 0, 'total_structural_low_usd must be positive');
  }
});

test('am_transmitter_building_and_hvac_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmitter_building_and_hvac_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_transmitter_building_and_hvac_guide`);
    assert.ok(g.hvac_tons_specified >= 0.5, 'hvac_tons_specified must be >= 0.5 ton');
    assert.ok(g.total_heat_kw > 0, 'total_heat_kw must be positive');
    assert.ok(g.total_building_low_usd > 0, 'total_building_low_usd must be positive');
  }
});

test('am_fcc_application_filing_cost_and_timeline_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_fcc_application_filing_cost_and_timeline_guide;
    assert.ok(g !== undefined && g !== null, `candidate missing am_fcc_application_filing_cost_and_timeline_guide`);
    assert.strictEqual(g.total_fcc_fees, 2030, 'total_fcc_fees must be $2,030');
    assert.ok(g.filing_sequence.length >= 6, 'filing_sequence must have >= 6 steps');
    assert.ok(g.total_timeline_days_low > 0, 'total_timeline_days_low must be positive');
  }
});

test('am_station_relocation_total_project_cost_proforma present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const pf = c.am_station_relocation_total_project_cost_proforma;
    assert.ok(pf !== undefined && pf !== null, `candidate missing am_station_relocation_total_project_cost_proforma`);
    assert.ok(pf.grand_total_low_usd > 0, 'grand_total_low_usd must be positive');
    assert.ok(pf.grand_total_high_usd > pf.grand_total_low_usd, 'high must exceed low');
    assert.strictEqual(pf.line_items.length, 11, 'must have 11 line items');
  }
});

test('am_site_access_and_land_use_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const lu = c.am_site_access_and_land_use_guide;
    assert.ok(lu !== undefined && lu !== null, `candidate missing am_site_access_and_land_use_guide`);
    assert.ok(['LOW', 'MODERATE', 'HIGH'].includes(lu.zone_risk_tier), `zone_risk_tier invalid: ${lu.zone_risk_tier}`);
    assert.strictEqual(lu.due_diligence_items.length, 7, 'must have 7 due-diligence items');
    assert.ok(lu.site_control_weeks_low > 0, 'site_control_weeks_low must be positive');
  }
});

test('am_nepa_environmental_review_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const ne = c.am_nepa_environmental_review_guide;
    assert.ok(ne !== undefined && ne !== null, `candidate missing am_nepa_environmental_review_guide`);
    assert.ok(['CE_LIKELY', 'CE_LIKELY_WITH_NHPA', 'EA_REQUIRED'].includes(ne.review_path), `review_path invalid: ${ne.review_path}`);
    assert.strictEqual(ne.tribal_tcns_required, true, 'tribal_tcns_required must always be true');
    assert.ok(ne.env_review_weeks_low > 0, 'env_review_weeks_low must be positive');
  }
});

test('am_interference_budget_and_nif_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const ib = c.am_interference_budget_and_nif_guide;
    assert.ok(ib !== undefined && ib !== null, `candidate missing am_interference_budget_and_nif_guide`);
    assert.ok(['FULL', 'STANDARD', 'SIMPLIFIED'].includes(ib.nif_study_complexity), `nif_study_complexity invalid: ${ib.nif_study_complexity}`);
    assert.ok(ib.nif_study_cost_low_usd > 0, 'nif_study_cost_low_usd must be positive');
    assert.ok(ib.min_sep_co_channel_km > 0, 'min_sep_co_channel_km must be positive');
  }
});

test('am_relocation_master_timeline_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const mt = c.am_relocation_master_timeline_guide;
    assert.ok(mt !== undefined && mt !== null, `candidate missing am_relocation_master_timeline_guide`);
    assert.strictEqual(mt.n_phases, 8, 'must have 8 phases');
    assert.ok(mt.total_months_high > mt.total_months_low, 'high must exceed low');
    assert.ok(mt.parallel_path_weeks_high > 0, 'parallel path must be positive');
  }
});

test('am_da_pattern_design_guide present across colocation candidates (NDA = not applicable)', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const da = c.am_da_pattern_design_guide;
    assert.ok(da !== undefined && da !== null, `candidate missing am_da_pattern_design_guide`);
    // baseBody uses NDA, so all candidates must have applicable=false
    assert.strictEqual(da.applicable, false, `NDA colocation candidate must have applicable=false`);
    assert.ok(typeof da.reason === 'string', 'reason must be a string');
  }
});

test('am_ground_system_design_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const gs = c.am_ground_system_design_guide;
    assert.ok(gs !== undefined && gs !== null, `candidate missing am_ground_system_design_guide`);
    assert.strictEqual(gs.radials_standard, 120, 'radials_standard must be 120');
    assert.ok(gs.ground_cost_low_usd > 0, 'ground_cost_low_usd must be positive');
  }
});

test('am_rf_exposure_mpe_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ tpo_kw: 5, candidate_limit: 5 }));
  for (const c of out.candidates) {
    const mpe = c.am_rf_exposure_mpe_guide;
    assert.ok(mpe !== undefined && mpe !== null, 'candidate missing am_rf_exposure_mpe_guide');
    assert.ok(typeof mpe.mpe_required === 'boolean', 'mpe_required must be boolean');
    assert.ok(mpe.e_limit_controlled_vm > 0, 'e_limit_controlled_vm must be positive');
  }
});

test('am_cp_validity_and_tolling_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const cp = c.am_cp_validity_and_tolling_guide;
    assert.ok(cp !== undefined && cp !== null, 'candidate missing am_cp_validity_and_tolling_guide');
    assert.strictEqual(cp.cp_term_years, 3, 'cp_term_years must be 3');
    assert.ok(Array.isArray(cp.milestones) && cp.milestones.length >= 4, 'milestones must have ≥ 4 entries');
  }
});

test('am_skywave_nighttime_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const sw = c.am_skywave_nighttime_guide;
    assert.ok(sw !== undefined && sw !== null, 'candidate missing am_skywave_nighttime_guide');
    assert.ok(typeof sw.night_operation_type === 'string', 'night_operation_type must be string');
    assert.ok(sw.night_power_limit_kw > 0, 'night_power_limit_kw must be positive');
  }
});

test('am_site_buildout_risk_assessment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const bra = c.am_site_buildout_risk_assessment_guide;
    assert.ok(bra !== undefined && bra !== null, 'candidate missing am_site_buildout_risk_assessment_guide');
    assert.ok(['LOW','MODERATE','HIGH','CRITICAL'].includes(bra.buildout_risk_tier), `unexpected risk tier: ${bra.buildout_risk_tier}`);
    assert.ok(typeof bra.buildout_feasibility_score === 'number', 'buildout_feasibility_score must be numeric');
  }
});

test('am_license_to_cover_and_sta_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const ltc = c.am_license_to_cover_and_sta_guide;
    assert.ok(ltc !== undefined && ltc !== null, 'candidate missing am_license_to_cover_and_sta_guide');
    assert.strictEqual(ltc.cp_term_years, 3, 'cp_term_years must be 3');
    assert.ok(ltc.n_ltc_required_items >= 8, 'must have ≥ 8 required LTC items');
  }
});

test('am_tower_detuning_and_phasor_verification_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const dtv = c.am_tower_detuning_and_phasor_verification_guide;
    assert.ok(dtv !== undefined && dtv !== null, 'candidate missing am_tower_detuning_and_phasor_verification_guide');
    assert.ok(dtv.n_phasor_triggers >= 5, 'must have ≥ 5 phasor triggers');
    assert.ok(dtv.detuning_cap_pf > 0, 'detuning_cap_pf must be positive');
  }
});

test('am_carrier_frequency_reference_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const cfr = c.am_carrier_frequency_reference_guide;
    assert.ok(cfr !== undefined && cfr !== null, 'candidate missing am_carrier_frequency_reference_guide');
    assert.strictEqual(cfr.fcc_tolerance_hz, 20, 'tolerance must be ±20 Hz');
    assert.ok(cfr.n_reference_options >= 4, 'must have ≥ 4 reference options');
  }
});

test('am_colocation_opportunity_score_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const cos = c.am_colocation_opportunity_score_guide;
    assert.ok(cos !== undefined && cos !== null, 'candidate missing am_colocation_opportunity_score_guide');
    assert.ok(['GOOD','MODERATE','LOW'].includes(cos.opportunity_tier), `unexpected tier: ${cos.opportunity_tier}`);
    assert.ok(cos.optimal_tower_height_ft > 0, 'optimal_tower_height_ft must be positive');
  }
});

test('am_frequency_coordination_and_channel_study_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const fcs = c.am_frequency_coordination_and_channel_study_guide;
    assert.ok(fcs !== undefined && fcs !== null, 'candidate missing am_frequency_coordination_and_channel_study_guide');
    assert.ok(typeof fcs.channel_class === 'string', 'channel_class must be a string');
    assert.ok(typeof fcs.co_channel_search_radius_km === 'number', 'co_channel_search_radius_km must be numeric');
    assert.ok(fcs.n_form_301_required > 0, 'n_form_301_required must be positive');
  }
});

test('am_environmental_and_rf_hazard_assessment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const env = c.am_environmental_and_rf_hazard_assessment_guide;
    assert.ok(env !== undefined && env !== null, 'candidate missing am_environmental_and_rf_hazard_assessment_guide');
    assert.ok(typeof env.nepa_disposition === 'string', 'nepa_disposition must be a string');
    assert.ok(Array.isArray(env.env_checklist), 'env_checklist must be an array');
  }
});

test('am_proof_of_performance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const pop = c.am_proof_of_performance_guide;
    assert.ok(pop !== undefined && pop !== null, 'candidate missing am_proof_of_performance_guide');
    assert.ok(typeof pop.proof_required === 'boolean', 'proof_required must be boolean');
    assert.ok(typeof pop.proof_type === 'string', 'proof_type must be a string');
  }
});

test('am_construction_permit_exhibit_requirements_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const cpe = c.am_construction_permit_exhibit_requirements_guide;
    assert.ok(cpe !== undefined && cpe !== null, 'candidate missing am_construction_permit_exhibit_requirements_guide');
    assert.ok(typeof cpe.n_required_exhibits === 'number', 'n_required_exhibits must be numeric');
    assert.ok(Array.isArray(cpe.exhibits), 'exhibits must be an array');
    assert.ok(cpe.n_required_exhibits >= 4, 'must have at least 4 required exhibits');
  }
});

test('am_licensed_contour_migration_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const lcm = c.am_licensed_contour_migration_guide;
    assert.ok(lcm !== undefined && lcm !== null, 'candidate missing am_licensed_contour_migration_guide');
    assert.ok(typeof lcm.daytime_5mvm_contour_km === 'number', 'daytime_5mvm_contour_km must be numeric');
    assert.ok(['EXPANDED','SIMILAR','CONTRACTED'].includes(lcm.soil_coverage_advantage), 'soil_coverage_advantage must be valid');
  }
});

test('am_tower_electrical_height_and_efficiency_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const teh = c.am_tower_electrical_height_and_efficiency_guide;
    assert.ok(teh !== undefined && teh !== null, 'candidate missing am_tower_electrical_height_and_efficiency_guide');
    assert.ok(typeof teh.electrical_height_deg === 'number', 'electrical_height_deg must be numeric');
    assert.ok(['OPTIMAL','ACCEPTABLE','SUBOPTIMAL'].includes(teh.height_rating), 'height_rating must be valid');
  }
});

test('am_ground_radial_system_cost_and_specification_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const grs = c.am_ground_radial_system_cost_and_specification_guide;
    assert.ok(grs !== undefined && grs !== null, 'candidate missing am_ground_radial_system_cost_and_specification_guide');
    assert.ok(typeof grs.radial_length_m === 'number' && grs.radial_length_m > 0, 'radial_length_m must be positive');
    assert.ok(grs.recommended_config?.label === 'standard', 'recommended config must be standard');
  }
});

test('am_transmitter_building_specification_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const tbs = c.am_transmitter_building_specification_guide;
    assert.ok(tbs !== undefined && tbs !== null, 'candidate missing am_transmitter_building_specification_guide');
    assert.ok(typeof tbs.floor_area_m2 === 'number' && tbs.floor_area_m2 > 0, 'floor_area_m2 must be positive');
    assert.ok(tbs.generator?.recommended_std_kw > 0, 'generator size must be positive');
  }
});

test('am_total_project_capital_cost_rollup_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const cap = c.am_total_project_capital_cost_rollup_guide;
    assert.ok(cap !== undefined && cap !== null, 'candidate missing am_total_project_capital_cost_rollup_guide');
    assert.ok(cap.total_usd?.low > 0, 'total_usd.low must be positive');
    assert.ok(Array.isArray(cap.components), 'components must be an array');
  }
});

test('am_transmitter_power_monitoring_and_operating_log_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmitter_power_monitoring_and_operating_log_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_transmitter_power_monitoring_and_operating_log_guide');
    assert.strictEqual(g.power_tolerance_pct, 10, '§73.1560 tolerance must be 10%');
    assert.ok(g.n_base_current_meters >= 1, 'must have at least 1 base current meter');
    assert.ok(Array.isArray(g.log_entry_triggers) && g.log_entry_triggers.length >= 3, 'must have at least 3 log entry triggers');
  }
});

test('am_operator_and_chief_operator_qualification_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_operator_and_chief_operator_qualification_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_operator_and_chief_operator_qualification_guide');
    assert.strictEqual(g.rp_permit_required, true, 'RP permit always required');
    assert.ok(g.n_weekly_duties >= 4, 'must have at least 4 weekly chief operator duties');
    assert.strictEqual(g.unattended_operation.authorized, true, 'unattended operation must be authorized');
  }
});

test('am_field_strength_measurement_and_contour_verification_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_field_strength_measurement_and_contour_verification_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_field_strength_measurement_and_contour_verification_guide');
    assert.ok(typeof g.formal_proof_required === 'boolean', 'formal_proof_required must be boolean');
    assert.ok(g.total_cost_low_usd > 0, 'total_cost_low_usd must be positive');
    assert.ok(Array.isArray(g.measurement_conditions), 'measurement_conditions must be an array');
  }
});

test('am_interference_distance_and_service_area_overlap_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_interference_distance_and_service_area_overlap_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_interference_distance_and_service_area_overlap_guide');
    assert.ok(g.service_contours?.d_05_mvm_km > 0, 'd_05_mvm_km must be positive');
    assert.strictEqual(g.du_requirements?.adj_10khz_db, -6, 'adj ±10 kHz must be −6 dB');
    assert.ok(['LOW','MODERATE','HIGH'].includes(g.interference_risk_level), 'valid risk level required');
  }
});

test('am_tia222_tower_structural_certification_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_tia222_tower_structural_certification_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_tia222_tower_structural_certification_guide');
    assert.ok(g.tower_height_ft > 0, 'tower_height_ft must be positive');
    assert.strictEqual(g.structural_category, 'II', 'structural category must be II');
    assert.ok(g.total_pe_analysis_low_usd > 0, 'PE analysis cost must be positive');
  }
});

test('am_broadcast_lease_and_spectrum_sharing_agreement_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_broadcast_lease_and_spectrum_sharing_agreement_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_broadcast_lease_and_spectrum_sharing_agreement_guide');
    assert.ok(typeof g.min_licensee_hours_per_week === 'number' && g.min_licensee_hours_per_week > 0, 'min_licensee_hours_per_week must be positive');
    assert.ok(Array.isArray(g.agreement_types) && g.agreement_types.length >= 3, 'must have at least 3 agreement types');
    assert.ok(g.market_station_limits?.total >= 6, 'market station limit must be at least 6');
  }
});

test('am_fcc_registration_and_database_management_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_fcc_registration_and_database_management_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_fcc_registration_and_database_management_guide');
    assert.ok(typeof g.asr_required === 'boolean', 'asr_required must be boolean');
    assert.ok(g.annual_maintenance_costs?.total_annual_low_usd > 0, 'annual cost must be positive');
    assert.ok(Array.isArray(g.key_databases) && g.key_databases.length >= 3, 'must have at least 3 key databases');
  }
});

test('am_station_sale_and_license_assignment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_station_sale_and_license_assignment_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_station_sale_and_license_assignment_guide');
    assert.ok(g.total_cost_low_usd > 0, 'total_cost_low_usd must be positive');
    assert.ok(g.timeline_days?.streamlined === 60, 'streamlined timeline must be 60 days');
    assert.ok(Array.isArray(g.due_diligence_items) && g.due_diligence_items.length >= 6, 'must have ≥6 due diligence items');
  }
});

test('am_signal_coverage_mapping_and_contour_documentation_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_signal_coverage_mapping_and_contour_documentation_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_signal_coverage_mapping_and_contour_documentation_guide');
    assert.ok(Array.isArray(g.contours_required) && g.contours_required.length >= 2, 'must have ≥2 contours');
    assert.ok(g.contour_distances_km?.d_05mvm_km > 0, '0.5 mV/m distance must be positive');
    assert.ok(typeof g.formal_proof_required === 'boolean', 'formal_proof_required must be boolean');
  }
});

test('am_transmitter_type_acceptance_and_fcc_certification_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmitter_type_acceptance_and_fcc_certification_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_transmitter_type_acceptance_and_fcc_certification_guide');
    assert.ok(typeof g.power_category === 'string', 'power_category must be a string');
    assert.ok(g.authorized_power_range?.min_kw > 0, 'min_kw must be positive');
    assert.ok(g.cost_estimates?.total_equipment_low_usd > 0, 'equipment cost must be positive');
  }
});

test('am_community_coverage_waiver_and_short_spacing_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_community_coverage_waiver_and_short_spacing_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_community_coverage_waiver_and_short_spacing_guide');
    assert.ok(['ADEQUATE','MARGINAL','DEFICIENT','UNKNOWN'].includes(g.coverage_status), 'coverage_status must be valid enum');
    assert.ok(g.co_channel_min_km > 0, 'co_channel_min_km must be positive');
    assert.ok(typeof g.waiver_likely_needed === 'boolean', 'waiver_likely_needed must be boolean');
  }
});

test('am_nighttime_clear_channel_exclusion_zone_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_nighttime_clear_channel_exclusion_zone_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_nighttime_clear_channel_exclusion_zone_guide');
    assert.ok(typeof g.is_clear_channel_freq === 'boolean', 'is_clear_channel_freq must be boolean');
    assert.ok(typeof g.exclusion_zone_applies === 'boolean', 'exclusion_zone_applies must be boolean');
    assert.ok(typeof g.daytime_only_required === 'boolean', 'daytime_only_required must be boolean');
  }
});

test('am_licensed_power_class_upgrade_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_licensed_power_class_upgrade_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_licensed_power_class_upgrade_guide');
    assert.ok(typeof g.modification_type === 'string', 'modification_type must be string');
    assert.ok(g.cost_estimates?.total_low_usd > 0, 'total cost must be positive');
    assert.ok(g.n_engineering_exhibits >= 6, 'must have ≥6 exhibits');
  }
});

test('am_rural_electric_and_standby_power_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_rural_electric_and_standby_power_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_rural_electric_and_standby_power_guide');
    assert.ok(g.generator_size_kva > 0, 'generator_size_kva must be positive');
    assert.ok(g.fuel_reserve_gal > 0, 'fuel_reserve_gal must be positive');
    assert.ok(g.cost_estimates?.total_power_low_usd >= 0, 'total_power_low_usd must be non-negative');
  }
});

test('am_rf_ground_system_inspection_and_maintenance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_rf_ground_system_inspection_and_maintenance_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_rf_ground_system_inspection_and_maintenance_guide');
    assert.ok(g.total_radials >= 120, 'total_radials must be ≥120');
    assert.ok(g.radial_length_ft > 0, 'radial_length_ft must be positive');
    assert.ok(g.rehabilitation_cost?.total_rehab_low_usd > 0, 'rehab cost must be positive');
  }
});

test('am_antenna_commissioning_and_proof_of_performance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_antenna_commissioning_and_proof_of_performance_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_antenna_commissioning_and_proof_of_performance_guide');
    assert.ok(g.n_commissioning_steps >= 6, 'must have ≥6 commissioning steps');
    assert.ok(typeof g.formal_proof_required === 'boolean', 'formal_proof_required must be boolean');
    assert.ok(g.cost_estimates?.total_low_usd > 0, 'total cost must be positive');
  }
});

test('am_frequency_interference_analysis_and_channel_study_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_frequency_interference_analysis_and_channel_study_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_frequency_interference_analysis_and_channel_study_guide');
    assert.ok(g.d_05mvm_km > 0, '0.5 mV/m reach must be positive');
    assert.ok(Array.isArray(g.du_requirements) && g.du_requirements.length >= 3, 'must have ≥3 D/U requirements');
    assert.strictEqual(g.contour_overlap_prohibited, true, 'contour overlap must be prohibited');
  }
});

test('am_site_hydrology_and_flood_zone_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_site_hydrology_and_flood_zone_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_site_hydrology_and_flood_zone_guide');
    assert.ok(['LOW','MODERATE','ELEVATED'].includes(g.flood_risk_level), 'flood_risk_level must be valid enum');
    assert.strictEqual(g.ea_required_if_in_floodplain, true, 'EA must be required if in floodplain');
    assert.ok(g.n_mitigation_measures >= 3, 'must have ≥3 mitigation measures');
  }
});

test('am_soil_conductivity_measurement_and_radial_design_validation_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_soil_conductivity_measurement_and_radial_design_validation_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_soil_conductivity_measurement_and_radial_design_validation_guide');
    assert.ok(['POOR','FAIR','GOOD','EXCELLENT'].includes(g.conductivity_category), 'conductivity_category must be valid enum');
    assert.ok(g.n_measurement_radials >= 3, 'must recommend ≥3 measurement radials');
    assert.ok(g.cost_estimates?.total_low_usd > 0, 'measurement cost must be positive');
  }
});

test('am_transmitter_site_emc_assessment_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_transmitter_site_emc_assessment_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_transmitter_site_emc_assessment_guide');
    assert.ok(['LOW','MODERATE','HIGH'].includes(g.emc_risk_level), 'emc_risk_level must be valid enum');
    assert.ok(g.n_interference_sources >= 4, 'must identify ≥4 interference sources');
    assert.ok(g.cost_estimates?.total_low_usd > 0, 'EMC assessment cost must be positive');
  }
});

test('am_noise_floor_and_interference_environment_survey_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_noise_floor_and_interference_environment_survey_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_noise_floor_and_interference_environment_survey_guide');
    assert.ok(['URBAN_INDUSTRIAL','SUBURBAN','RURAL_HIGHWAY','RURAL_QUIET'].includes(g.noise_environment), 'noise_environment must be valid enum');
    assert.ok(typeof g.snr_at_05mvm_contour_db === 'number', 'SNR must be a number');
    assert.ok(g.cost_estimates?.total_low_usd > 0, 'survey cost must be positive');
  }
});

test('am_online_public_file_compliance_guide present across colocation candidates', async () => {
  const out = await runColocationOpportunities(baseBody({ candidate_limit: 5 }));
  for (const c of out.candidates) {
    const g = c.am_online_public_file_compliance_guide;
    assert.ok(g !== undefined && g !== null, 'candidate missing am_online_public_file_compliance_guide');
    assert.ok(g.n_triggered_on_relocation >= 5, 'relocation must trigger ≥5 OPIF categories');
    assert.strictEqual(g.opif_update_deadline_days, 30, 'OPIF deadline must be 30 days');
    assert.ok(g.cost_estimates?.total_low_usd > 0, 'OPIF compliance cost must be positive');
  }
});
