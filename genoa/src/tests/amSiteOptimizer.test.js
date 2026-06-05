// Unit tests for the AM Regional Relocation Optimizer.
//
// Pure-module tests — no HTTP, no DB.  Covers:
//   - happy path: KAZM-like inputs return ≥ 10 candidates with
//     monotonic ranks and every candidate carries SCREENING ONLY +
//     ENGINEER REVIEW REQUIRED.
//   - empty optimization_goals → every candidate scores 0 (no weights)
//     and the current-site row is the baseline.
//   - tiny radius (< grid spacing) → grid generates nothing but the
//     current-site point is still included.
//   - placeholder goal (avoid_wildfire_risk) is surfaced in
//     limitations[] when enabled.
//   - NON-COMPLIANT label and HARD CHECK FAIL limitations fire when
//     coverage_pct < 0.80 (forced via input).

import test from 'node:test';
import assert from 'node:assert/strict';

import { runSiteOptimizer, __test__ } from '../engine/am/siteOptimizer.js';

const KAZM = {
  callsign:        'KAZM',
  frequency_khz:   780,
  current_site:    { lat: 34.8606, lon: -111.8206 },
  search_radius_km: 50,
  grid_spacing_km:  10,            // 10 km keeps the test fast (vs 2)
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
    minimize_int_treaty_zone:     false
  }
};

test('happy path: KAZM-like inputs return ≥ 10 ranked candidates with monotonic ranks', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  assert.ok(out.n_candidates_evaluated >= 10, `expected ≥ 10 candidates, got ${out.n_candidates_evaluated}`);
  assert.ok(out.candidates.length >= 10, `expected ≥ 10 returned, got ${out.candidates.length}`);

  // Ranks are 1..N monotonically increasing.
  out.candidates.forEach((c, i) => {
    assert.equal(c.rank, i + 1, `candidate[${i}].rank should be ${i + 1}`);
  });
  // Scores monotonically non-increasing.
  for (let i = 1; i < out.candidates.length; i++){
    assert.ok(out.candidates[i - 1].score >= out.candidates[i].score,
      `score should be non-increasing: rank ${i} (${out.candidates[i-1].score}) vs rank ${i+1} (${out.candidates[i].score})`);
  }
  // Every candidate has SCREENING ONLY + ENGINEER REVIEW REQUIRED.
  for (const c of out.candidates){
    assert.ok(c.status_labels.includes('SCREENING ONLY'),
      `every candidate must carry SCREENING ONLY label (got ${JSON.stringify(c.status_labels)})`);
    assert.ok(c.status_labels.includes('ENGINEER REVIEW REQUIRED'),
      `every candidate must carry ENGINEER REVIEW REQUIRED label`);
  }
  // Explainability: every candidate has a score_breakdown + rationale.
  for (const c of out.candidates){
    assert.ok(c.explanation && typeof c.explanation.score_breakdown === 'object',
      'every candidate must carry an explanation.score_breakdown');
    assert.ok(typeof c.explanation.ranking_rationale === 'string'
              && c.explanation.ranking_rationale.length > 10,
      'every candidate must carry an explanation.ranking_rationale sentence');
  }
  // Baseline present.
  assert.ok(out.current_site_baseline, 'baseline summary must be present');
  assert.equal(out.current_site_baseline.lat, 34.8606);
  assert.equal(out.current_site_baseline.lon, -111.8206);
});

test('empty goals → every candidate scores 0 and current site is included as baseline', async () => {
  const out = await runSiteOptimizer({
    ...KAZM,
    optimization_goals: {
      maximize_col_coverage:        false,
      maximize_population:          false,
      minimize_blanket_population:  false,
      avoid_wildfire_risk:          false,
      prefer_high_conductivity:     false,
      minimize_int_treaty_zone:     false
    }
  });
  assert.equal(out.available, true);
  assert.ok(out.n_candidates_evaluated >= 1, 'at least the current site must be evaluated');
  // With no goals enabled there's nothing to score → every candidate
  // returns 0 (which equals the current-site baseline).
  for (const c of out.candidates){
    assert.equal(c.score, 0, `candidate score should be 0 with no goals (got ${c.score})`);
  }
  assert.equal(out.current_site_baseline.score, 0,
    'current-site baseline score should be 0 when no goals are enabled');
});

test('tiny radius (< grid spacing) returns at least the current-site point', async () => {
  const out = await runSiteOptimizer({
    ...KAZM,
    search_radius_km: 1,   // < grid_spacing_km (10)
    grid_spacing_km:  10
  });
  assert.equal(out.available, true);
  assert.ok(out.n_candidates_evaluated >= 1,
    'tiny-radius search must still include the current site');
  // The current site row must be present.
  const me = out.candidates.find(
    (c) => Math.abs(c.lat - KAZM.current_site.lat) < 1e-6
        && Math.abs(c.lon - KAZM.current_site.lon) < 1e-6
  );
  assert.ok(me, 'current-site row must be among the returned candidates');
  assert.ok(me.status_labels.includes('SCREENING ONLY'));
  // The "grid_spacing > radius" warning should have fired (string or object).
  assert.ok(out.warnings.some((w) => /grid_spacing_km/.test(typeof w === 'string' ? w : w.message || '')),
    'warning about grid_spacing > radius should fire');
});

test('score_stats are present and sensible', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.ok(out.score_stats, 'score_stats must be present');
  assert.ok(Number.isFinite(out.score_stats.mean),   'score_stats.mean must be finite');
  assert.ok(Number.isFinite(out.score_stats.std_dev),'score_stats.std_dev must be finite');
  assert.ok(Number.isFinite(out.score_stats.min),    'score_stats.min must be finite');
  assert.ok(Number.isFinite(out.score_stats.max),    'score_stats.max must be finite');
  assert.ok(out.score_stats.min <= out.score_stats.max, 'min <= max');
  assert.ok(out.score_stats.mean >= out.score_stats.min && out.score_stats.mean <= out.score_stats.max,
    'mean in [min, max]');
});

test('optimization_confidence is present with valid level', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.ok(out.optimization_confidence, 'optimization_confidence must be present');
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(out.optimization_confidence.level),
    `level must be HIGH/MEDIUM/LOW, got ${out.optimization_confidence.level}`);
  assert.ok(Array.isArray(out.optimization_confidence.contributing_layers),
    'contributing_layers must be an array');
  assert.ok(Array.isArray(out.optimization_confidence.notes),
    'notes must be an array');
});

test('optimization_confidence is HIGH when COL polygon + 3 real goals enabled', async () => {
  const poly = {
    type: 'Polygon',
    coordinates: [[
      [-111.85, 34.83], [-111.78, 34.83], [-111.78, 34.90],
      [-111.85, 34.90], [-111.85, 34.83]
    ]]
  };
  const out = await runSiteOptimizer({
    ...KAZM,
    community_of_license_polygon: poly,
    optimization_goals: {
      maximize_col_coverage:        true,
      maximize_population:          true,
      minimize_blanket_population:  true,
      minimize_int_treaty_zone:     true,
      prefer_high_conductivity:     false,
      avoid_wildfire_risk:          false
    }
  });
  assert.equal(out.optimization_confidence.level, 'HIGH');
  assert.ok(out.optimization_confidence.contributing_layers.includes('col_polygon_provided'));
});

test('optimization_confidence is LOW when no goals enabled', async () => {
  const out = await runSiteOptimizer({
    ...KAZM,
    optimization_goals: {
      maximize_col_coverage: false, maximize_population: false,
      minimize_blanket_population: false, minimize_int_treaty_zone: false,
      prefer_high_conductivity: false, avoid_wildfire_risk: false
    }
  });
  assert.equal(out.optimization_confidence.level, 'LOW');
});

test('SCORE_CLUSTERED does NOT fire in zone-table mode (expected when no goals or same-zone candidates)', async () => {
  // Zone-table mode produces score clusters by design (same σ per zone →
  // same sub-scores → same composite).  SCORE_CLUSTERED now only fires
  // when the GeoTIFF raster IS loaded and results are still flat (unusual).
  const out = await runSiteOptimizer({
    ...KAZM,
    search_radius_km:  50,
    grid_spacing_km:   10,
    candidate_limit:   200,
    optimization_goals: {
      maximize_col_coverage: false, maximize_population: false,
      minimize_blanket_population: false, minimize_int_treaty_zone: false,
      prefer_high_conductivity: false, avoid_wildfire_risk: false
    }
  });
  const clustered = out.warnings.some(w =>
    (typeof w === 'object' ? w.code : w) === 'SCORE_CLUSTERED'
  );
  assert.ok(!clustered, 'SCORE_CLUSTERED must NOT fire in zone-table mode (clustering is expected)');
  // conductivity_mode should be present
  assert.ok(['raster', 'zone-table'].includes(out.conductivity_mode),
    `conductivity_mode must be raster or zone-table, got ${out.conductivity_mode}`);
});

test('zone-table mode does NOT emit REACH_PLACEHOLDER for clusters (expected per-zone behaviour)', async () => {
  // Zone-table mode naturally produces reach clusters within each M3 zone.
  // The old REACH_PLACEHOLDER code was a false-positive in that case.
  // Now it is silent in zone-table mode; REACH_FLAT_RASTER only fires
  // when the GeoTIFF is loaded and results are still flat (unusual).
  const out = await runSiteOptimizer({
    ...KAZM,
    search_radius_km: 30,
    grid_spacing_km:  5,
    candidate_limit:  200,
    optimization_goals: { ...KAZM.optimization_goals, maximize_population: true }
  });
  const legacyCode = out.warnings.some(w =>
    (typeof w === 'object' ? w.code : w) === 'REACH_PLACEHOLDER'
  );
  assert.ok(!legacyCode, 'REACH_PLACEHOLDER must NOT fire in zone-table mode (clusters are expected per-zone)');
  // conductivity_mode field must be present
  assert.ok(out.conductivity_mode === 'raster' || out.conductivity_mode === 'zone-table',
    `conductivity_mode must be 'raster' or 'zone-table', got: ${out.conductivity_mode}`);
});

test('placeholder goal (avoid_wildfire_risk) surfaces in candidate limitations', async () => {
  const out = await runSiteOptimizer({
    ...KAZM,
    optimization_goals: { ...KAZM.optimization_goals, avoid_wildfire_risk: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(
      c.limitations.some((l) => /Wildfire/i.test(l)),
      'wildfire-risk placeholder must surface in limitations when enabled'
    );
    assert.equal(c.fuel_risk, 'NOT-EVALUATED');
  }
});

test('invalid inputs reject with a 400-style error envelope', async () => {
  // Missing callsign.
  const a = await runSiteOptimizer({ ...KAZM, callsign: '' });
  assert.equal(a.available, false);
  assert.match(a.error, /callsign/);

  // Out-of-range frequency.
  const b = await runSiteOptimizer({ ...KAZM, frequency_khz: 200 });
  assert.equal(b.available, false);
  assert.match(b.error, /frequency_khz/);

  // Bad lat.
  const c = await runSiteOptimizer({ ...KAZM, current_site: { lat: 999, lon: 0 } });
  assert.equal(c.available, false);
  assert.match(c.error, /current_site\.lat/);

  // Grid too large (DoS guard).
  const d = await runSiteOptimizer({ ...KAZM, search_radius_km: 500, grid_spacing_km: 1 });
  assert.equal(d.available, false);
  assert.match(d.error, /candidates/);
});

test('global limitations carry the SCREENING-ONLY disclaimer', async () => {
  const out = await runSiteOptimizer(KAZM);
  assert.ok(Array.isArray(out.limitations_global) && out.limitations_global.length > 0);
  assert.ok(out.limitations_global.some((l) => /Screening-grade/i.test(l)),
    'global limitations must mention screening-grade');
});

test('disc-disc analytical coverage helper produces sane values', () => {
  const { discCoverageFraction } = __test__;
  // Identical disc-disc → 1.
  const a = discCoverageFraction({
    circle_center: { lat: 34, lon: -111 }, circle_radius_km: 20,
    disc_center:   { lat: 34, lon: -111 }, disc_radius_km:   10
  });
  assert.equal(a, 1);
  // Disjoint discs → 0.
  const b = discCoverageFraction({
    circle_center: { lat: 34, lon: -111 }, circle_radius_km: 5,
    disc_center:   { lat: 40, lon: -111 }, disc_radius_km:   5
  });
  assert.equal(b, 0);
  // Partial overlap → in (0, 1).
  const c = discCoverageFraction({
    circle_center: { lat: 34, lon: -111   }, circle_radius_km: 10,
    disc_center:   { lat: 34, lon: -110.9 }, disc_radius_km:   10
  });
  assert.ok(c > 0 && c < 1, `partial overlap should be in (0,1), got ${c}`);
});

test('M3 zone lookup: every candidate carries ground_sigma_source and filing_grade', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(typeof c.ground_sigma_source === 'string' && c.ground_sigma_source.length > 0,
      `candidate must have ground_sigma_source string (got ${JSON.stringify(c.ground_sigma_source)})`);
    assert.ok(typeof c.ground_sigma_filing_grade === 'string' && c.ground_sigma_filing_grade.length > 0,
      `candidate must have ground_sigma_filing_grade string (got ${JSON.stringify(c.ground_sigma_filing_grade)})`);
  }
  // Baseline must carry the same fields.
  assert.ok(out.current_site_baseline.ground_sigma_source,     'baseline must have ground_sigma_source');
  assert.ok(out.current_site_baseline.ground_sigma_filing_grade, 'baseline must have ground_sigma_filing_grade');
});

test('M3 zone lookup: conductivity varies across geographically distinct points', () => {
  const { lookupM3ZoneFallback } = __test__;
  // Desert SW (AZ/NM) — should be σ=2.
  const sw = lookupM3ZoneFallback(34.86, -111.82);
  assert.equal(sw.available, true, 'Desert SW point should be available');
  assert.equal(sw.sigma_mS_m, 2, `Desert SW σ should be 2 mS/m, got ${sw.sigma_mS_m}`);
  // Great Plains (KS) — should be σ=15.
  const gp = lookupM3ZoneFallback(38.5, -98.5);
  assert.equal(gp.available, true, 'Great Plains point should be available');
  assert.equal(gp.sigma_mS_m, 15, `Great Plains σ should be 15 mS/m, got ${gp.sigma_mS_m}`);
  // Florida — should be σ=10.
  const fl = lookupM3ZoneFallback(27.5, -82.0);
  assert.equal(fl.available, true, 'Florida point should be available');
  assert.equal(fl.sigma_mS_m, 10, `Florida σ should be 10 mS/m, got ${fl.sigma_mS_m}`);
  // All three should differ.
  assert.ok(sw.sigma_mS_m !== gp.sigma_mS_m || gp.sigma_mS_m !== fl.sigma_mS_m,
    'σ should vary across geographically distinct zones');
});

test('every GRID candidate carries a valid status_category enum value', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  const valid = new Set(['PROMISING', 'REVIEW_REQUIRED', 'NON_COMPLIANT', 'RECOVERABLE_WITH_DA']);
  for (const c of out.candidates){
    assert.ok(valid.has(c.status_category),
      `status_category must be a valid enum (got ${JSON.stringify(c.status_category)})`);
  }
});

test('every candidate has rank_percentile in [0, 100]; rank 1 gets the highest percentile', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(Number.isFinite(c.rank_percentile), `rank_percentile must be finite (rank ${c.rank})`);
    assert.ok(c.rank_percentile >= 0 && c.rank_percentile <= 100,
      `rank_percentile must be in [0,100] (rank ${c.rank}, got ${c.rank_percentile})`);
  }
  const sorted = [...out.candidates].sort((a, b) => a.rank - b.rank);
  if (sorted.length >= 2){
    assert.ok(sorted[0].rank_percentile >= sorted[1].rank_percentile,
      'rank 1 should have >= percentile compared to rank 2');
  }
});

test('community-of-license polygon path is exercised when supplied', async () => {
  // Small square polygon around the KAZM site, in [lon, lat] order.
  const poly = {
    type: 'Polygon',
    coordinates: [[
      [-111.85, 34.83],
      [-111.78, 34.83],
      [-111.78, 34.90],
      [-111.85, 34.90],
      [-111.85, 34.83]
    ]]
  };
  const out = await runSiteOptimizer({
    ...KAZM,
    community_of_license_polygon: poly
  });
  assert.equal(out.available, true);
  // Every candidate's explanation should record polygon-overlap method.
  const me = out.candidates.find(
    (c) => Math.abs(c.lat - KAZM.current_site.lat) < 1e-6
        && Math.abs(c.lon - KAZM.current_site.lon) < 1e-6
  );
  assert.ok(me, 'current-site row present');
  assert.match(me.explanation.coverage_computed_from, /polygon-overlap/);
  // And the input echo flag is set.
  assert.equal(out.inputs_echo.community_of_license_polygon_provided, true);
});

test('score_breakdown values sum to approximately the candidate score', async () => {
  const out = await runSiteOptimizer({
    ...KAZM,
    candidate_limit: 20,
    optimization_goals: {
      maximize_col_coverage: true, maximize_population: true,
      minimize_blanket_population: true, prefer_high_conductivity: true,
      minimize_int_treaty_zone: false, avoid_wildfire_risk: false
    }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const bd = c.explanation?.score_breakdown;
    if (!bd) continue;
    const sumPts = Object.values(bd).reduce((a, v) => a + (Number(v) || 0), 0);
    // Allow ±0.5 rounding tolerance from round2().
    assert.ok(Math.abs(sumPts - c.score) <= 0.5,
      `breakdown sum ${sumPts.toFixed(2)} should ≈ score ${c.score} (rank ${c.rank})`);
  }
});


test('scoring_time_ms is a non-negative number in the response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  assert.ok(typeof out.scoring_time_ms === 'number' && out.scoring_time_ms >= 0,
    `scoring_time_ms must be a non-negative number, got: ${out.scoring_time_ms}`);
});

test('every candidate has bearing_deg in [0, 360); current site gets bearing_deg 0', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(c.bearing_deg != null, `bearing_deg must be present (rank ${c.rank})`);
    assert.ok(c.bearing_deg >= 0 && c.bearing_deg < 360,
      `bearing_deg must be in [0,360) (rank ${c.rank}, got ${c.bearing_deg})`);
  }
  const current = out.candidates.find(c => c.distance_from_current_km === 0);
  if (current) assert.equal(current.bearing_deg, 0, 'current site bearing must be 0');
});

test('tower_reference block has correct physics for operating frequency', async () => {
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 790, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const tr = out.tower_reference;
  assert.ok(tr, 'tower_reference must be present');
  // λ = c/f; c = 300,000 km/s = 300,000,000 m/s → λ_m = 300,000/f_khz
  const expectedLambda = Math.round(300000 / 790 * 100) / 100;
  assert.ok(Math.abs(tr.wavelength_m - expectedLambda) < 1, `wavelength_m off: got ${tr.wavelength_m} expected ~${expectedLambda}`);
  assert.ok(Math.abs(tr.quarter_wave_m - expectedLambda / 4) < 1, `quarter_wave_m off`);
  assert.ok(Math.abs(tr.half_wave_m - expectedLambda / 2) < 1, `half_wave_m off`);
  assert.equal(tr.asr_threshold_m, 60.96);
  // At 790 kHz, λ/4 ≈ 95 m > 60.96 m → ASR required
  assert.equal(tr.asr_registration_required_at_quarter_wave, true);
});

test('sigmaQuality returns correct labels at boundary values', () => {
  const { sigmaQuality } = __test__;
  assert.equal(sigmaQuality(0.5),  'POOR');
  assert.equal(sigmaQuality(1),    'POOR');
  assert.equal(sigmaQuality(2),    'FAIR');
  assert.equal(sigmaQuality(3),    'FAIR');
  assert.equal(sigmaQuality(4),    'GOOD');
  assert.equal(sigmaQuality(7),    'GOOD');
  assert.equal(sigmaQuality(8),    'EXCELLENT');
  assert.equal(sigmaQuality(15),   'EXCELLENT');
  assert.equal(sigmaQuality(null), 'UNKNOWN');
  assert.equal(sigmaQuality(NaN),  'UNKNOWN');
});

test('every candidate carries ground_sigma_quality from the engine', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true, prefer_high_conductivity: true }
  });
  assert.equal(out.available, true);
  const VALID = new Set(['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'UNKNOWN']);
  for (const c of out.candidates){
    assert.ok(VALID.has(c.ground_sigma_quality),
      `ground_sigma_quality must be a known label; rank ${c.rank} got: ${c.ground_sigma_quality}`);
  }
});

test('every candidate carries principal_community_5mvm_km (§73.24(j) 5 mV/m contour radius)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(c.principal_community_5mvm_km != null && Number.isFinite(c.principal_community_5mvm_km),
      `principal_community_5mvm_km must be a finite number; rank ${c.rank} got: ${c.principal_community_5mvm_km}`);
    assert.ok(c.principal_community_5mvm_km > 0,
      `principal_community_5mvm_km must be positive; rank ${c.rank} got: ${c.principal_community_5mvm_km}`);
    // 5 mV/m radius must be shorter than 0.5 mV/m radius (higher field = shorter range)
    if (c.daytime_reach_km != null){
      assert.ok(c.principal_community_5mvm_km <= c.daytime_reach_km,
        `5 mV/m radius must be ≤ 0.5 mV/m reach (rank ${c.rank}): ${c.principal_community_5mvm_km} vs ${c.daytime_reach_km}`);
    }
  }
});

test('DA pattern_mode emits DA_MODE_REQUIRED warning', async () => {
  for (const mode of ['DA-D', 'DA-N', 'DA-2']){
    const out = await runSiteOptimizer({ ...KAZM, pattern_mode: mode, candidate_limit: 1,
      optimization_goals: { maximize_col_coverage: true }
    });
    assert.equal(out.available, true);
    const daWarn = out.warnings.find(w => w?.code === 'DA_MODE_REQUIRED');
    assert.ok(daWarn, `DA_MODE_REQUIRED warning must be present for pattern_mode=${mode}; got: ${JSON.stringify(out.warnings)}`);
    assert.ok(/§73\.150|§73\.182/i.test(daWarn.message), `DA warning should mention §73.150 and §73.182`);
  }
});

test('minimum_tpo_for_compliance_kw computed when blanket_population_pct > 1%', async () => {
  // High-power, close-in site should have blanket pop > 1% at 50 kW.
  // Use a very high TPO and narrow grid to force high blanket population.
  const out = await runSiteOptimizer({
    ...KAZM,
    tpo_kw: 50,
    search_radius_km: 5,
    grid_spacing_km: 10,
    candidate_limit: 20,
    optimization_goals: { minimize_blanket_population: true }
  });
  assert.equal(out.available, true);
  const failing = out.candidates.filter(c => (c.blanket_population_pct ?? 0) > 1.0);
  if (failing.length > 0){
    for (const c of failing){
      assert.ok(c.minimum_tpo_for_compliance_kw != null,
        `minimum_tpo_for_compliance_kw must be present when blanket pop > 1%; got: ${c.minimum_tpo_for_compliance_kw}`);
      assert.ok(c.minimum_tpo_for_compliance_kw > 0 && c.minimum_tpo_for_compliance_kw < 50,
        `min TPO must be in (0, 50) kW; got ${c.minimum_tpo_for_compliance_kw}`);
    }
  }
  // Candidates with blanket pop ≤ 1% should NOT have this field set.
  const passing = out.candidates.filter(c => (c.blanket_population_pct ?? 0) <= 1.0);
  for (const c of passing){
    assert.equal(c.minimum_tpo_for_compliance_kw, null,
      `minimum_tpo_for_compliance_kw must be null when blanket pop ≤ 1%; rank ${c.rank}`);
  }
});

test('top_candidates_summary is a non-empty string in the response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true, maximize_population: true }
  });
  assert.equal(out.available, true);
  assert.ok(typeof out.top_candidates_summary === 'string' && out.top_candidates_summary.length > 20,
    `top_candidates_summary must be a non-empty string; got: ${JSON.stringify(out.top_candidates_summary)}`);
  // Should mention rank 1 score and status
  assert.ok(/Rank 1/.test(out.top_candidates_summary), 'summary must mention Rank 1');
});

test('frequencyChannelClass classifies local, clear, and regional channels correctly', () => {
  const { frequencyChannelClass, LOCAL_CHANNEL_KHZ, CLEAR_CHANNEL_KHZ } = __test__;

  // Local channels — all six §73.27 frequencies
  for (const f of LOCAL_CHANNEL_KHZ){
    assert.equal(frequencyChannelClass(f), 'local', `${f} kHz should be local`);
  }

  // Clear channels — spot-check a few §73.25 frequencies
  for (const f of [720, 760, 880, 1000, 1210]){
    assert.equal(frequencyChannelClass(f), 'clear_channel', `${f} kHz should be clear_channel`);
  }

  // Regional — anything else in the AM band
  for (const f of [530, 600, 790, 950, 1050, 1300, 1500, 1700]){
    assert.equal(frequencyChannelClass(f), 'regional', `${f} kHz should be regional`);
  }
});

test('frequency_channel_class is included in the runSiteOptimizer response', async () => {
  // 1240 kHz is a local channel; 780 kHz (KAZM) is clear_channel
  const localOut = await runSiteOptimizer({ ...KAZM, frequency_khz: 1240, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(localOut.available, true);
  assert.equal(localOut.frequency_channel_class, 'local', '1240 kHz must classify as local');

  const clearOut = await runSiteOptimizer({ ...KAZM, frequency_khz: 780, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(clearOut.available, true);
  assert.equal(clearOut.frequency_channel_class, 'clear_channel', '780 kHz must classify as clear_channel');
});

test('TPO_EXCEEDS_CLASS_MAX warning fires when tpo_kw > class maximum', async () => {
  // Class C max is 250 W (0.25 kW); submitting 5 kW should trigger the warning.
  const out = await runSiteOptimizer({ ...KAZM, fcc_class: 'C', tpo_kw: 5, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const warn = out.warnings.find(w => w?.code === 'TPO_EXCEEDS_CLASS_MAX');
  assert.ok(warn, `TPO_EXCEEDS_CLASS_MAX warning must be present for Class C at 5 kW; got: ${JSON.stringify(out.warnings)}`);
  assert.ok(/0\.25 kW|250 W/i.test(warn.message), 'warning must mention the 0.25 kW Class C limit');
});

test('TPO_BELOW_CLASS_MIN warning fires when Class A tpo_kw < 10 kW', async () => {
  const out = await runSiteOptimizer({ ...KAZM, fcc_class: 'A', tpo_kw: 5, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const warn = out.warnings.find(w => w?.code === 'TPO_BELOW_CLASS_MIN');
  assert.ok(warn, `TPO_BELOW_CLASS_MIN warning must be present for Class A at 5 kW; got: ${JSON.stringify(out.warnings)}`);
  assert.ok(/10 kW/i.test(warn.message), 'warning must mention 10 kW minimum');
});

test('Class B at 50 kW produces no power-limit warning (50 kW is at the max)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, fcc_class: 'B', tpo_kw: 50, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const pwrWarns = out.warnings.filter(w => w?.code === 'TPO_EXCEEDS_CLASS_MAX' || w?.code === 'TPO_BELOW_CLASS_MIN');
  assert.equal(pwrWarns.length, 0, `no power limit warnings for Class B at 50 kW; got: ${JSON.stringify(pwrWarns)}`);
});

test('every candidate exposes cardinal_direction as a 16-point compass string', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 15,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const COMPASS_16 = new Set(['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']);
  for (const c of out.candidates){
    if (c.distance_from_current_km === 0){
      // Current site: bearing_deg=0 → cardinal 'N' (or null is also acceptable at distance 0)
      continue;
    }
    assert.ok(c.cardinal_direction != null, `cardinal_direction must be present (rank ${c.rank})`);
    assert.ok(COMPASS_16.has(c.cardinal_direction),
      `cardinal_direction must be a valid 16-point compass label; rank ${c.rank} got: ${c.cardinal_direction}`);
  }
});

test('field_at_col_centroid_mvm is present and physically plausible for non-current-site candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);

  for (const c of out.candidates){
    if (c.distance_from_current_km < 0.5){
      // Co-located — field_at_col_centroid_mvm can be null (too close for curve inversion)
      continue;
    }
    assert.ok(c.field_at_col_centroid_mvm != null,
      `field_at_col_centroid_mvm must be present for distant candidates; rank ${c.rank}, dist=${c.distance_from_current_km}`);
    assert.ok(Number.isFinite(c.field_at_col_centroid_mvm) && c.field_at_col_centroid_mvm > 0,
      `field_at_col_centroid_mvm must be > 0; rank ${c.rank}, got ${c.field_at_col_centroid_mvm}`);
    // Physical sanity: if the COL is within the 5 mV/m radius, field ≥ 5 mV/m
    if (c.principal_community_5mvm_km != null && c.distance_from_current_km <= c.principal_community_5mvm_km){
      assert.ok(c.field_at_col_centroid_mvm >= 4.9,
        `field at COL should be ≥ 5 mV/m when COL is within r5 (rank ${c.rank}): ` +
        `dist=${c.distance_from_current_km}, r5=${c.principal_community_5mvm_km}, field=${c.field_at_col_centroid_mvm}`);
    }
    // Physical sanity: if COL is beyond 0.5 mV/m reach, field < 0.5 mV/m
    if (c.daytime_reach_km != null && c.distance_from_current_km > c.daytime_reach_km){
      assert.ok(c.field_at_col_centroid_mvm < 0.55,
        `field at COL should be < 0.5 mV/m when COL is beyond daytime reach (rank ${c.rank}): ` +
        `dist=${c.distance_from_current_km}, reach=${c.daytime_reach_km}, field=${c.field_at_col_centroid_mvm}`);
    }
  }
});

test('score_confidence is HIGH/MEDIUM/LOW per candidate based on available data layers', async () => {
  // Without polygon and on zone-table σ → all candidates should be LOW confidence.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 8,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const VALID = new Set(['HIGH', 'MEDIUM', 'LOW']);
  for (const c of out.candidates){
    assert.ok(VALID.has(c.score_confidence),
      `score_confidence must be HIGH/MEDIUM/LOW; rank ${c.rank} got: ${c.score_confidence}`);
    // No polygon + no raster → LOW
    assert.equal(c.score_confidence, 'LOW',
      `score_confidence should be LOW when no polygon and no raster (rank ${c.rank})`);
  }
});

test('buildGroundRadialAdvisory returns null for GOOD/EXCELLENT σ, advisory for POOR/FAIR', () => {
  const { buildGroundRadialAdvisory } = __test__;
  assert.equal(buildGroundRadialAdvisory(4),    null,  'σ=4 mS/m (GOOD) should return null');
  assert.equal(buildGroundRadialAdvisory(8),    null,  'σ=8 mS/m (EXCELLENT) should return null');
  assert.equal(buildGroundRadialAdvisory(15),   null,  'σ=15 mS/m should return null');
  assert.ok(buildGroundRadialAdvisory(2) != null,  'σ=2 mS/m (FAIR) should return an advisory');
  assert.ok(/120.radial|§73\.190/i.test(buildGroundRadialAdvisory(2)),
    'FAIR advisory should mention §73.190 or radial count');
  assert.ok(buildGroundRadialAdvisory(0.5) != null, 'σ=0.5 mS/m (POOR) should return an advisory');
  assert.ok(/POOR/i.test(buildGroundRadialAdvisory(0.5)),
    'POOR advisory should mention POOR conductivity');
  assert.equal(buildGroundRadialAdvisory(null), null, 'null σ should return null');
});
