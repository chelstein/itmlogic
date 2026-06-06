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
  const valid = new Set(['PROMISING', 'REVIEW_REQUIRED', 'NON_COMPLIANT',
    'RECOVERABLE_WITH_DA', 'RECOVERABLE_WITH_POWER_INCREASE',
    'RECOVERABLE_WITH_REDUCED_POWER', 'RECOVERABLE_WITH_COL_CHANGE', 'TREATY_REVIEW']);
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

test('col_centroid input changes field_at_col_centroid_mvm for distant candidates', async () => {
  // Without col_centroid: field is computed using distance from candidate to current_site.
  // With a col_centroid 40 km away from current_site, the field for a candidate AT the
  // current_site should reflect that 40 km distance, not ~0 km.
  const colCenter = { lat: KAZM.current_site.lat + 0.36, lon: KAZM.current_site.lon }; // ~40 km N
  const outNoCentroid = await runSiteOptimizer({
    ...KAZM, candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  const outWithCentroid = await runSiteOptimizer({
    ...KAZM, candidate_limit: 5, col_centroid: colCenter,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(outWithCentroid.available, true);
  assert.equal(outWithCentroid.inputs_echo.col_centroid_provided, true);
  // For the current-site candidate (distance ~0), no-centroid field is null (distance < 0.5 km).
  // With centroid 40 km away, field should be computed and likely < 5 mV/m.
  const currentCandNoCentroid = outNoCentroid.candidates.find(c => c.distance_from_current_km < 0.5);
  const currentCandWithCentroid = outWithCentroid.candidates.find(c => c.distance_from_current_km < 0.5);
  if (currentCandNoCentroid) {
    assert.equal(currentCandNoCentroid.field_at_col_centroid_mvm, null,
      'current-site candidate should have null field when no col_centroid (distance < 0.5 km)');
  }
  if (currentCandWithCentroid) {
    assert.ok(currentCandWithCentroid.field_at_col_centroid_mvm != null,
      'current-site candidate should have non-null field when col_centroid supplied ~40 km away');
    assert.ok(currentCandWithCentroid.field_at_col_centroid_mvm > 0,
      `field must be > 0 mV/m; got ${currentCandWithCentroid.field_at_col_centroid_mvm}`);
  }
  // inputs_echo should record col_centroid
  assert.deepEqual(outWithCentroid.inputs_echo.col_centroid, colCenter,
    'inputs_echo.col_centroid should echo the supplied centroid');
});

test('invalid col_centroid emits COL_CENTROID_INVALID warning and falls back', async () => {
  const out = await runSiteOptimizer({
    ...KAZM, candidate_limit: 3,
    col_centroid: { lat: 999, lon: 0 },   // lat out of range
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const warn = out.warnings.find(w => w?.code === 'COL_CENTROID_INVALID');
  assert.ok(warn, `COL_CENTROID_INVALID warning must fire for invalid centroid; got: ${JSON.stringify(out.warnings)}`);
  assert.equal(out.inputs_echo.col_centroid_provided, false,
    'col_centroid_provided should be false when centroid was invalid');
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

test('estimated_daytime_population_served is a positive integer on every candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true, maximize_population: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(Number.isFinite(c.estimated_daytime_population_served) && c.estimated_daytime_population_served > 0,
      `estimated_daytime_population_served must be a positive integer; rank ${c.rank} got: ${c.estimated_daytime_population_served}`);
    // Should be < US population (sanity)
    assert.ok(c.estimated_daytime_population_served < 335e6,
      `estimated_daytime_population_served must be < US population (rank ${c.rank}): ${c.estimated_daytime_population_served}`);
  }
});

test('ranking_rationale mentions field_at_col_centroid_mvm for non-current-site candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const distant = out.candidates.filter(c => c.distance_from_current_km >= 0.5);
  assert.ok(distant.length > 0, 'should have distant candidates');
  for (const c of distant){
    const rationale = c.explanation?.ranking_rationale || '';
    assert.ok(/COL field|mV\/m|Non-compliant/i.test(rationale),
      `rationale should mention COL field or mV/m (rank ${c.rank}): "${rationale}"`);
  }
});

test('protection_class_advisory and skywave_risk_level are present in the response', async () => {
  // KAZM is 780 kHz (clear channel) Class D → HIGH risk advisory
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  assert.ok(typeof out.protection_class_advisory === 'string' && out.protection_class_advisory.length > 20,
    `protection_class_advisory must be a non-empty string; got: ${JSON.stringify(out.protection_class_advisory)}`);
  assert.ok(['LOW', 'MODERATE', 'HIGH'].includes(out.skywave_risk_level),
    `skywave_risk_level must be LOW/MODERATE/HIGH; got: ${out.skywave_risk_level}`);
  // 780 kHz is a clear channel → HIGH
  assert.equal(out.skywave_risk_level, 'HIGH', '780 kHz (clear channel) should be HIGH skywave risk');
  assert.ok(/§73\.182/i.test(out.protection_class_advisory), 'advisory must mention §73.182');
});

test('buildProtectionAdvisory returns LOW risk for local channel Class C', () => {
  const { buildProtectionAdvisory } = __test__;
  const res = buildProtectionAdvisory({ fcc_class: 'C', frequency_khz: 1240, channel_class: 'local', pattern_mode: 'NDA' });
  assert.equal(res.skywave_risk_level, 'LOW', 'local channel should be LOW risk');
  assert.ok(/250 W/i.test(res.protection_class_advisory) || /local channel/i.test(res.protection_class_advisory),
    'advisory should mention 250W or local channel');
});

test('buildProtectionAdvisory returns MODERATE risk for regional channel Class B', () => {
  const { buildProtectionAdvisory } = __test__;
  const res = buildProtectionAdvisory({ fcc_class: 'B', frequency_khz: 950, channel_class: 'regional', pattern_mode: 'NDA' });
  assert.equal(res.skywave_risk_level, 'MODERATE');
  assert.ok(/§73\.182/i.test(res.protection_class_advisory), 'advisory must mention §73.182');
});

test('ADJACENT_TO_CLEAR_CHANNEL warning fires when frequency is adjacent to a §73.25 clear channel', async () => {
  // 790 kHz: 780 kHz is a clear channel → 790 ± 10 = {780, 800}; 780 is clear → should warn.
  const outAdj = await runSiteOptimizer({ ...KAZM, frequency_khz: 790, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(outAdj.available, true);
  const adjWarn = outAdj.warnings.find(w => w?.code === 'ADJACENT_TO_CLEAR_CHANNEL');
  assert.ok(adjWarn, `ADJACENT_TO_CLEAR_CHANNEL warning must fire for 790 kHz (adj to 780 clear); got: ${JSON.stringify(outAdj.warnings)}`);
  assert.ok(/780/.test(adjWarn.message), 'warning must mention 780 kHz');

  // 700 kHz is itself a clear channel; 710 is also clear, 690 is not clear.
  // So 700 → adjacent to 710 (clear). Should warn.
  const out700 = await runSiteOptimizer({ ...KAZM, frequency_khz: 700, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out700.available, true);
  const adjWarn700 = out700.warnings.find(w => w?.code === 'ADJACENT_TO_CLEAR_CHANNEL');
  assert.ok(adjWarn700, `ADJACENT_TO_CLEAR_CHANNEL warning must fire for 700 kHz (adj to 710 clear)`);

  // 950 kHz: neither 940 (clear) adjacent fires... actually 940 is in CLEAR_CHANNEL_KHZ.
  // 950-10=940 is clear. Should warn.
  const out950 = await runSiteOptimizer({ ...KAZM, frequency_khz: 950, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out950.available, true);
  const adjWarn950 = out950.warnings.find(w => w?.code === 'ADJACENT_TO_CLEAR_CHANNEL');
  assert.ok(adjWarn950, `ADJACENT_TO_CLEAR_CHANNEL warning must fire for 950 kHz (adj to 940 clear)`);

  // 600 kHz: neither 590 nor 610 is a clear channel. No warning.
  const outNo = await runSiteOptimizer({ ...KAZM, frequency_khz: 600, candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(outNo.available, true);
  const adjWarnNo = outNo.warnings.find(w => w?.code === 'ADJACENT_TO_CLEAR_CHANNEL');
  assert.equal(adjWarnNo, undefined, `No ADJACENT_TO_CLEAR_CHANNEL warning for 600 kHz; got: ${JSON.stringify(outNo.warnings)}`);
});

test('DA pattern_mode causes protection_class_advisory to mention §73.150', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'DA-D', candidate_limit: 1,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  assert.ok(/§73\.150/i.test(out.protection_class_advisory),
    `DA pattern_mode should cause advisory to mention §73.150; got: ${out.protection_class_advisory}`);
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

// ---- recommended_actions ----

test('recommended_actions is present in the response and is an array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  assert.ok(Array.isArray(out.recommended_actions),
    `recommended_actions must be an array; got: ${typeof out.recommended_actions}`);
});

test('recommended_actions entries have required fields: priority, action, rationale', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.ok(out.recommended_actions.length > 0, 'should produce at least one recommended action');
  for (const item of out.recommended_actions){
    assert.ok(typeof item.priority === 'string' && item.priority.length > 0,
      `action entry must have non-empty priority string; got: ${JSON.stringify(item)}`);
    assert.ok(typeof item.action === 'string' && item.action.length > 10,
      `action entry must have non-empty action string; got: ${JSON.stringify(item)}`);
    assert.ok(typeof item.rationale === 'string' && item.rationale.length > 10,
      `action entry must have non-empty rationale string; got: ${JSON.stringify(item)}`);
    assert.ok(['URGENT', 'HIGH', 'MEDIUM', 'INFORMATIONAL'].includes(item.priority),
      `priority must be URGENT/HIGH/MEDIUM/INFORMATIONAL; got: ${item.priority}`);
  }
});

test('recommended_actions: URGENT action fires when baseline is NON_COMPLIANT', () => {
  const { buildRecommendedActions } = __test__;
  const baseline = { status_category: 'NON_COMPLIANT', score: 23.4 };
  const actions = buildRecommendedActions({
    baseline, returned: [], scored: [],
    candidate_count_by_status: { NON_COMPLIANT: 1 },
    fcc_class: 'D', pattern_mode: 'NDA', chanClass: 'regional',
    skywave_risk_level: 'MODERATE', warnings: [],
    community_of_license_polygon: null
  });
  const urgents = actions.filter(a => a.priority === 'URGENT');
  assert.ok(urgents.length >= 1, 'should emit at least one URGENT when baseline is NON_COMPLIANT');
  assert.ok(/STA|Minor Modification/i.test(urgents[0].action),
    `URGENT action should mention STA or Minor Modification; got: ${urgents[0].action}`);
});

test('recommended_actions: URGENT action fires when no PROMISING sites found', () => {
  const { buildRecommendedActions } = __test__;
  const actions = buildRecommendedActions({
    baseline: null,
    returned: [],
    scored: [{ status_category: 'NON_COMPLIANT' }, { status_category: 'NEEDS_REVIEW' }],
    candidate_count_by_status: { NON_COMPLIANT: 2 },
    fcc_class: 'B', pattern_mode: 'NDA', chanClass: 'regional',
    skywave_risk_level: 'MODERATE', warnings: [],
    community_of_license_polygon: null
  });
  const urgents = actions.filter(a => a.priority === 'URGENT');
  assert.ok(urgents.length >= 1, 'should emit URGENT when no PROMISING sites exist');
  assert.ok(/radius|search|TPO/i.test(urgents[0].action),
    `URGENT action should suggest expanding search or reducing TPO; got: ${urgents[0].action}`);
});

test('recommended_actions: HIGH action to advance Rank 1 fires when top candidate is PROMISING', () => {
  const { buildRecommendedActions } = __test__;
  const actions = buildRecommendedActions({
    baseline: null,
    returned: [{
      status_category: 'PROMISING',
      rank: 1,
      score: 78.3,
      distance_from_current_km: 12.5,
      cardinal_direction: 'NNE'
    }],
    scored: [{ status_category: 'PROMISING' }],
    candidate_count_by_status: { PROMISING: 1 },
    fcc_class: 'D', pattern_mode: 'NDA', chanClass: 'regional',
    skywave_risk_level: 'MODERATE', warnings: [],
    community_of_license_polygon: null
  });
  const highs = actions.filter(a => a.priority === 'HIGH');
  assert.ok(highs.length >= 1, 'should emit HIGH action to advance top candidate');
  assert.ok(/Rank 1|§73\.182|NIF/i.test(highs[0].action),
    `HIGH action should mention Rank 1 and next step; got: ${highs[0].action}`);
});

test('recommended_actions: MEDIUM clear_channel NIF action fires for clear channel', () => {
  const { buildRecommendedActions } = __test__;
  const actions = buildRecommendedActions({
    baseline: null, returned: [], scored: [],
    candidate_count_by_status: {},
    fcc_class: 'A', pattern_mode: 'NDA', chanClass: 'clear_channel',
    skywave_risk_level: 'HIGH', warnings: [],
    community_of_license_polygon: null
  });
  const niffy = actions.find(a => /NIF|§73\.182|nighttime/i.test(a.action));
  assert.ok(niffy, 'should recommend NIF study for clear channel stations');
  assert.ok(niffy.priority === 'MEDIUM' || niffy.priority === 'HIGH',
    `NIF action should be HIGH or MEDIUM priority; got: ${niffy.priority}`);
});

test('recommended_actions: MEDIUM COL polygon action fires when polygon not provided', () => {
  const { buildRecommendedActions } = __test__;
  const actionsNoPoly = buildRecommendedActions({
    baseline: null, returned: [], scored: [],
    candidate_count_by_status: {},
    fcc_class: 'D', pattern_mode: 'NDA', chanClass: 'regional',
    skywave_risk_level: 'MODERATE', warnings: [],
    community_of_license_polygon: null
  });
  const polyAction = actionsNoPoly.find(a => /COL|community.of.license|polygon/i.test(a.action));
  assert.ok(polyAction, 'should recommend providing COL polygon when absent');
  assert.equal(polyAction.priority, 'MEDIUM', 'COL polygon action should be MEDIUM priority');

  // With polygon provided → no such recommendation
  const actionsWithPoly = buildRecommendedActions({
    baseline: null, returned: [], scored: [],
    candidate_count_by_status: {},
    fcc_class: 'D', pattern_mode: 'NDA', chanClass: 'regional',
    skywave_risk_level: 'MODERATE', warnings: [],
    community_of_license_polygon: { type: 'Polygon', coordinates: [[]] }
  });
  const polyActionWith = actionsWithPoly.find(a => /COL|community.of.license|polygon/i.test(a.action));
  assert.equal(polyActionWith, undefined, 'should NOT emit COL polygon action when polygon is provided');
});

test('recommended_actions: INFORMATIONAL soil survey fires when POOR/FAIR σ candidates present', () => {
  const { buildRecommendedActions } = __test__;
  const actions = buildRecommendedActions({
    baseline: null,
    returned: [{ ground_sigma_quality: 'POOR', rank: 1, status_category: 'PROMISING' }],
    scored: [{ status_category: 'PROMISING' }],
    candidate_count_by_status: { PROMISING: 1 },
    fcc_class: 'D', pattern_mode: 'NDA', chanClass: 'regional',
    skywave_risk_level: 'MODERATE', warnings: [],
    community_of_license_polygon: null
  });
  const survey = actions.find(a => /resistivity|soil|radial/i.test(a.action));
  assert.ok(survey, 'should recommend soil survey when POOR/FAIR σ candidates present');
  assert.equal(survey.priority, 'INFORMATIONAL', 'soil survey should be INFORMATIONAL priority');
});

test('recommended_actions: DA HIGH action fires when pattern_mode contains DA', () => {
  const { buildRecommendedActions } = __test__;
  const actions = buildRecommendedActions({
    baseline: null, returned: [], scored: [],
    candidate_count_by_status: {},
    fcc_class: 'B', pattern_mode: 'DA-N', chanClass: 'regional',
    skywave_risk_level: 'MODERATE', warnings: [],
    community_of_license_polygon: null
  });
  const daAction = actions.find(a => /§73\.150|directional antenna|DA/i.test(a.action));
  assert.ok(daAction, 'should recommend DA pattern study when DA pattern_mode set');
  assert.equal(daAction.priority, 'HIGH', 'DA action should be HIGH priority');
});

test('recommended_actions: priority ordering — URGENT before HIGH before MEDIUM before INFORMATIONAL', () => {
  const { buildRecommendedActions } = __test__;
  // Trigger as many action types as possible.
  const actions = buildRecommendedActions({
    baseline: { status_category: 'NON_COMPLIANT', score: 20 },
    returned: [{
      status_category: 'PROMISING',
      rank: 1, score: 65.0,
      distance_from_current_km: 5, cardinal_direction: 'N',
      ground_sigma_quality: 'POOR'
    }],
    scored: [{ status_category: 'PROMISING' }],
    candidate_count_by_status: { PROMISING: 1 },
    fcc_class: 'A', pattern_mode: 'DA-D', chanClass: 'clear_channel',
    skywave_risk_level: 'HIGH', warnings: [],
    community_of_license_polygon: null
  });

  const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, INFORMATIONAL: 3 };
  for (let i = 1; i < actions.length; i++){
    const prev = priorityOrder[actions[i - 1].priority];
    const curr = priorityOrder[actions[i].priority];
    assert.ok(prev <= curr,
      `Priority order violated at index ${i}: ${actions[i-1].priority} (${prev}) > ${actions[i].priority} (${curr})`);
  }
});

test('recommended_actions: MEDIUM COL power action fires when top-5 candidate has minimum_tpo_for_col_coverage_kw', () => {
  const { buildRecommendedActions } = __test__;
  const actions = buildRecommendedActions({
    baseline: null,
    returned: [{
      status_category: 'PROMISING',
      rank: 1,
      score: 72.1,
      distance_from_current_km: 14.2,
      cardinal_direction: 'NW',
      minimum_tpo_for_col_coverage_kw: 9.8,
      field_at_col_centroid_mvm: 3.1
    }],
    scored: [{ status_category: 'PROMISING' }],
    candidate_count_by_status: { PROMISING: 1 },
    fcc_class: 'B', pattern_mode: 'NDA', chanClass: 'regional',
    skywave_risk_level: 'MODERATE', warnings: [],
    community_of_license_polygon: null
  });
  const colPwrAction = actions.find(a => /Evaluate TPO increase/i.test(a.action));
  assert.ok(colPwrAction, 'should emit a MEDIUM action for COL coverage power increase');
  assert.equal(colPwrAction.priority, 'MEDIUM',
    `COL power action should be MEDIUM priority; got: ${colPwrAction.priority}`);
  assert.ok(/9\.8/i.test(colPwrAction.action),
    `COL power action should mention the required TPO (9.8 kW); got: ${colPwrAction.action}`);
  assert.ok(/§73\.24\(j\)/i.test(colPwrAction.rationale),
    `COL power rationale should cite §73.24(j); got: ${colPwrAction.rationale}`);
});

test('recommended_actions: COL power action does NOT fire when no candidate has minimum_tpo_for_col_coverage_kw', () => {
  const { buildRecommendedActions } = __test__;
  const actions = buildRecommendedActions({
    baseline: null,
    returned: [{
      status_category: 'PROMISING', rank: 1, score: 80.0,
      distance_from_current_km: 8.0, cardinal_direction: 'N',
      minimum_tpo_for_col_coverage_kw: null,
      field_at_col_centroid_mvm: 12.4
    }],
    scored: [{ status_category: 'PROMISING' }],
    candidate_count_by_status: { PROMISING: 1 },
    fcc_class: 'B', pattern_mode: 'NDA', chanClass: 'regional',
    skywave_risk_level: 'MODERATE', warnings: [],
    community_of_license_polygon: null
  });
  const colPwrAction = actions.find(a => /Evaluate TPO increase/i.test(a.action));
  assert.equal(colPwrAction, undefined,
    'should not emit COL power action when all candidates have field >= 5 mV/m');
});

// ---------- minimum_tpo_for_col_coverage_kw ----------

test('minimum_tpo_for_col_coverage_kw is null for candidates where field_at_col_centroid_mvm >= 5', async () => {
  // Candidates that already achieve ≥ 5 mV/m at the proxy COL distance must not
  // have minimum_tpo_for_col_coverage_kw set (there's nothing to remediate).
  const out = await runSiteOptimizer({
    ...KAZM, candidate_limit: 15,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const passingField = out.candidates.filter(c =>
    c.field_at_col_centroid_mvm != null && c.field_at_col_centroid_mvm >= 5
  );
  for (const c of passingField){
    assert.equal(c.minimum_tpo_for_col_coverage_kw, null,
      `minimum_tpo_for_col_coverage_kw must be null when field >= 5 mV/m; rank ${c.rank}, field=${c.field_at_col_centroid_mvm}`);
  }
  // Also null when field is null (too close to compute)
  const nullField = out.candidates.filter(c => c.field_at_col_centroid_mvm == null);
  for (const c of nullField){
    assert.equal(c.minimum_tpo_for_col_coverage_kw, null,
      `minimum_tpo_for_col_coverage_kw must be null when field is null; rank ${c.rank}`);
  }
});

test('minimum_tpo_for_col_coverage_kw is computed for weak-field candidates when col_centroid is far', async () => {
  // Place the COL centroid ~80 km north of the current site so that most
  // candidates at 5 kW will have field_at_col_centroid_mvm < 5.
  // The binary search should produce a value in (5, 50] kW for those candidates.
  const farCentroid = { lat: KAZM.current_site.lat + 0.72, lon: KAZM.current_site.lon }; // ~80 km N
  const out = await runSiteOptimizer({
    ...KAZM, tpo_kw: 5, fcc_class: 'A', candidate_limit: 15,
    col_centroid: farCentroid,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const weakField = out.candidates.filter(c =>
    c.field_at_col_centroid_mvm != null && c.field_at_col_centroid_mvm < 5
  );
  // At least some candidates should fail the 5 mV/m threshold at 5 kW / 80 km.
  assert.ok(weakField.length > 0,
    `Expected at least one candidate with field_at_col_centroid_mvm < 5; found ${weakField.length}`);
  for (const c of weakField){
    // When the contour at 50 kW can reach the COL centroid, a value must be returned.
    if (c.minimum_tpo_for_col_coverage_kw != null){
      assert.ok(c.minimum_tpo_for_col_coverage_kw > 0 && c.minimum_tpo_for_col_coverage_kw <= 50,
        `minimum_tpo_for_col_coverage_kw must be in (0, 50]; got ${c.minimum_tpo_for_col_coverage_kw} rank ${c.rank}`);
      // no ordering constraint — COL coverage power can be higher or lower than blanket compliance power
    }
  }
  // Candidates with field ≥ 5 mV/m must have null.
  const strongField = out.candidates.filter(c =>
    c.field_at_col_centroid_mvm != null && c.field_at_col_centroid_mvm >= 5
  );
  for (const c of strongField){
    assert.equal(c.minimum_tpo_for_col_coverage_kw, null,
      `minimum_tpo_for_col_coverage_kw must be null when field ≥ 5 mV/m; rank ${c.rank}`);
  }
});

test('minimum_tpo_for_col_coverage_kw is in current_site_baseline when col_centroid provided', async () => {
  const farCentroid = { lat: KAZM.current_site.lat + 0.72, lon: KAZM.current_site.lon };
  const out = await runSiteOptimizer({
    ...KAZM, tpo_kw: 5, fcc_class: 'A', candidate_limit: 5,
    col_centroid: farCentroid,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const baseline = out.current_site_baseline;
  assert.ok(baseline != null, 'current_site_baseline must be present');
  // The baseline exposes these fields (may be null if physics don't trigger).
  assert.ok('minimum_tpo_for_col_coverage_kw' in baseline,
    'baseline must include minimum_tpo_for_col_coverage_kw key');
  assert.ok('field_at_col_centroid_mvm' in baseline,
    'baseline must include field_at_col_centroid_mvm key');
  assert.ok('estimated_daytime_population_served' in baseline,
    'baseline must include estimated_daytime_population_served key');
  assert.ok('score_confidence' in baseline,
    'baseline must include score_confidence key');
});

// ---------- status_category recovery pathways ----------

test('status_category: RECOVERABLE_WITH_REDUCED_POWER for blanket-only failures', async () => {
  // 50 kW at a close-in site will push blanket population over 1% while
  // coverage is likely still fine — the category should be RECOVERABLE_WITH_REDUCED_POWER.
  const out = await runSiteOptimizer({
    ...KAZM,
    tpo_kw: 50,
    fcc_class: 'A',
    search_radius_km: 2,
    grid_spacing_km: 10,
    candidate_limit: 20,
    optimization_goals: { minimize_blanket_population: true, maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const recPwr = out.candidates.filter(c => c.status_category === 'RECOVERABLE_WITH_REDUCED_POWER');
  const blankOnly = out.candidates.filter(c =>
    (c.blanket_population_pct ?? 0) > 1.0 &&
    (c.col_coverage_pct ?? 1) >= 0.80
  );
  // Every blanket-only failure candidate must be RECOVERABLE_WITH_REDUCED_POWER.
  for (const c of blankOnly){
    assert.equal(c.status_category, 'RECOVERABLE_WITH_REDUCED_POWER',
      `blanket-only failure rank ${c.rank} should be RECOVERABLE_WITH_REDUCED_POWER; got ${c.status_category}`);
  }
  // RECOVERABLE_WITH_REDUCED_POWER candidates must have minimum_tpo_for_compliance_kw set.
  for (const c of recPwr){
    assert.ok(c.minimum_tpo_for_compliance_kw != null,
      `RECOVERABLE_WITH_REDUCED_POWER rank ${c.rank} must have minimum_tpo_for_compliance_kw`);
  }
});

test('status_category: TREATY_REVIEW for near-border candidates that pass all hard checks', async () => {
  // Run with minimize_int_treaty_zone active near the US/MX border so that
  // some candidates land in the treaty zone.  We only care about candidates that
  // have NO hard compliance failures (no _flags) — those should be TREATY_REVIEW.
  const nearBorder = {
    ...KAZM,
    current_site: { lat: 31.7, lon: -106.5 },  // near El Paso / Juarez
    search_radius_km: 50, grid_spacing_km: 20, candidate_limit: 20,
    tpo_kw: 1,    // low power avoids blanket pop issues
    fcc_class: 'C',
    optimization_goals: { ...KAZM.optimization_goals, minimize_int_treaty_zone: true }
  };
  const out = await runSiteOptimizer(nearBorder);
  if (!out.available) return;  // env may lack conductivity data — skip gracefully
  // Only assert on candidates that are in treaty zone AND have no hard failures.
  // A candidate with treaty_zone AND NON_COMPLIANT/RECOVERABLE_* keeps the compliance label.
  const cleanTreatyCands = out.candidates.filter(c =>
    c.treaty_zone &&
    !['NON_COMPLIANT', 'RECOVERABLE_WITH_DA', 'RECOVERABLE_WITH_POWER_INCREASE',
      'RECOVERABLE_WITH_REDUCED_POWER', 'RECOVERABLE_WITH_COL_CHANGE'].includes(c.status_category)
  );
  // If any exist, they should be TREATY_REVIEW (not PROMISING or REVIEW_REQUIRED).
  for (const c of cleanTreatyCands){
    assert.equal(c.status_category, 'TREATY_REVIEW',
      `clean treaty-zone candidate rank ${c.rank} should be TREATY_REVIEW; got ${c.status_category}`);
  }
  // PROMISING/REVIEW_REQUIRED candidates should NOT have treaty_zone set as their category.
  // (This is more of a sanity check on the inverse.)
  const nonTreatyPassing = out.candidates.filter(c =>
    !c.treaty_zone && (c.status_category === 'PROMISING' || c.status_category === 'REVIEW_REQUIRED')
  );
  for (const c of nonTreatyPassing){
    assert.ok(c.status_category !== 'TREATY_REVIEW',
      `non-treaty candidate rank ${c.rank} should not be TREATY_REVIEW`);
  }
});

test('status_category: RECOVERABLE_WITH_POWER_INCREASE when engine computed a COL-coverage TPO fix', async () => {
  // Run with a low power at a distance from the current site.
  // Low TPO → small 5 mV/m radius → COL coverage fail, but power can be increased to fix it.
  // Use col_centroid far away to force field_at_col_centroid_mvm to be low and trigger binary search.
  const farColCentroid = { lat: 34.86 + 0.5, lon: -111.82 };  // ~55 km north
  const out = await runSiteOptimizer({
    ...KAZM, tpo_kw: 1, fcc_class: 'D',
    col_centroid: farColCentroid,
    search_radius_km: 10, grid_spacing_km: 5, candidate_limit: 20,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  // Any candidate where minimum_tpo_for_col_coverage_kw is set AND colFail should be
  // RECOVERABLE_WITH_POWER_INCREASE.
  const pwrIncrCands = out.candidates.filter(c =>
    c.minimum_tpo_for_col_coverage_kw != null &&
    Array.isArray(c.limitations) && c.limitations.some(l => /COL/i.test(l))
  );
  for (const c of pwrIncrCands){
    assert.equal(c.status_category, 'RECOVERABLE_WITH_POWER_INCREASE',
      `candidate with minimum_tpo_for_col_coverage_kw and COL failure should be RECOVERABLE_WITH_POWER_INCREASE; rank ${c.rank} got ${c.status_category}`);
  }
});

test('status_category: NON_COMPLIANT candidates have HARD CHECK FAIL in limitations', async () => {
  const out = await runSiteOptimizer({
    ...KAZM, tpo_kw: 50, fcc_class: 'A',
    search_radius_km: 2, grid_spacing_km: 10, candidate_limit: 20,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    if (c.status_category === 'NON_COMPLIANT'){
      const hasHardFail = Array.isArray(c.limitations) &&
        c.limitations.some(l => /HARD CHECK FAIL/i.test(l));
      assert.ok(hasHardFail,
        `NON_COMPLIANT rank ${c.rank} must have at least one HARD CHECK FAIL limitation; got: ${JSON.stringify(c.limitations)}`);
    }
  }
});

test('col_centroid changes coverage_computed_from to indicate centroid was used', async () => {
  const colCenter = { lat: KAZM.current_site.lat + 0.2, lon: KAZM.current_site.lon + 0.2 };
  const outNoCentroid = await runSiteOptimizer({
    ...KAZM, candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  const outWithCentroid = await runSiteOptimizer({
    ...KAZM, candidate_limit: 5, col_centroid: colCenter,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(outWithCentroid.available, true);
  // Candidates that used the disc-disc proxy should report the centroid in the description.
  for (const c of outWithCentroid.candidates){
    const cov = c.explanation?.coverage_computed_from;
    if (cov && cov.includes('disc-disc')){
      assert.ok(/supplied centroid/i.test(cov),
        `coverage_computed_from should mention supplied centroid; got: "${cov}"`);
    }
  }
  // Without centroid, the description uses current site.
  for (const c of outNoCentroid.candidates){
    const cov = c.explanation?.coverage_computed_from;
    if (cov && cov.includes('disc-disc')){
      assert.ok(!/supplied centroid/i.test(cov),
        `coverage_computed_from should not mention supplied centroid without one; got: "${cov}"`);
    }
  }
});

test('ranking_rationale for non-compliant candidates includes fix hint when minimum_tpo values are present', async () => {
  // Use 50 kW near-border to force blanket pop failures with minimum_tpo_for_compliance_kw set.
  const out = await runSiteOptimizer({
    ...KAZM, tpo_kw: 50, fcc_class: 'A',
    search_radius_km: 2, grid_spacing_km: 10, candidate_limit: 20,
    optimization_goals: { maximize_col_coverage: true, minimize_blanket_population: true }
  });
  assert.equal(out.available, true);
  // For candidates with minimum_tpo_for_compliance_kw set, the rationale should mention the fix.
  const fixable = out.candidates.filter(c =>
    c.minimum_tpo_for_compliance_kw != null &&
    (c.status_category === 'NON_COMPLIANT' || c.status_category === 'RECOVERABLE_WITH_REDUCED_POWER')
  );
  for (const c of fixable){
    const rationale = c.explanation?.ranking_rationale || '';
    const kw = c.minimum_tpo_for_compliance_kw;
    assert.ok(rationale.includes(String(kw)),
      `rationale should include the blanket fix TPO (${kw} kW) for rank ${c.rank}: "${rationale}"`);
  }
});

test('score_breakdown includes confidence_penalty for LOW-confidence candidates', async () => {
  // No polygon, no raster → all candidates are LOW confidence → each should
  // carry a negative confidence_penalty in score_breakdown.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true, maximize_population: true,
                          prefer_high_conductivity: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.equal(c.score_confidence, 'LOW', `expected LOW confidence; rank ${c.rank}`);
    const bd = c.explanation?.score_breakdown;
    assert.ok(bd != null, `score_breakdown must exist; rank ${c.rank}`);
    if (c.score > 0){
      // LOW confidence → 7% haircut → penalty must be negative and present.
      assert.ok('confidence_penalty' in bd,
        `confidence_penalty must be in score_breakdown for LOW-confidence non-zero score (rank ${c.rank})`);
      assert.ok(bd.confidence_penalty < 0,
        `confidence_penalty must be negative for LOW confidence; rank ${c.rank} got ${bd.confidence_penalty}`);
      // Verify it restores: breakdown sum ≈ score (within 0.5 rounding tolerance).
      const sumPts = Object.values(bd).reduce((a, v) => a + (Number(v) || 0), 0);
      assert.ok(Math.abs(sumPts - c.score) <= 0.5,
        `breakdown sum ${sumPts.toFixed(2)} should ≈ score ${c.score} including confidence_penalty (rank ${c.rank})`);
    }
  }
});

test('score_confidence dampening: confidence_penalty absent when score is 0', async () => {
  // Zero-weight run → score=0 for all → penalty=0 → not added to breakdown.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5,
    optimization_goals: {}
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.equal(c.score, 0, `score must be 0 with empty goals (rank ${c.rank})`);
    const bd = c.explanation?.score_breakdown;
    if (bd){
      assert.ok(!('confidence_penalty' in bd),
        `confidence_penalty should not be in breakdown when score=0 (rank ${c.rank})`);
    }
  }
});

test('nif_status includes skywave risk suffix for HIGH-risk station (clear channel)', async () => {
  // KAZM is on 780 kHz (clear channel) Class D → HIGH skywave risk.
  const out = await runSiteOptimizer({ ...KAZM, fcc_class: 'A', candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  // Every candidate should have the HIGH skywave risk suffix in nif_status.
  for (const c of out.candidates){
    assert.ok(c.nif_status && /HIGH skywave risk/i.test(c.nif_status),
      `nif_status for clear-channel Class A should mention HIGH skywave risk; rank ${c.rank} got: "${c.nif_status}"`);
  }
});

test('nif_status does NOT include skywave suffix for LOW-risk station (local channel)', async () => {
  // Local channel (1230 kHz) Class C → LOW skywave risk.
  const localKazm = { ...KAZM, frequency_khz: 1230, fcc_class: 'C', tpo_kw: 0.1 };
  const out = await runSiteOptimizer({ ...localKazm, candidate_limit: 5,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(!c.nif_status || !/HIGH skywave risk|MODERATE skywave risk/i.test(c.nif_status),
      `nif_status for local channel should NOT mention HIGH/MODERATE skywave risk; rank ${c.rank} got: "${c.nif_status}"`);
  }
});

test('col_coverage_gap_pct is positive for candidates below 80% COL floor, null otherwise', async () => {
  const out = await runSiteOptimizer({ ...KAZM, tpo_kw: 1, fcc_class: 'D',
    search_radius_km: 30, grid_spacing_km: 10, candidate_limit: 20,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    if (c.col_coverage_pct != null && c.col_coverage_pct < 0.80){
      assert.ok(c.col_coverage_gap_pct != null && c.col_coverage_gap_pct > 0,
        `col_coverage_gap_pct should be positive when coverage < 80%; rank ${c.rank} got ${c.col_coverage_gap_pct}`);
      // gap should equal 0.80 - coverage (within 0.01 rounding)
      assert.ok(Math.abs(c.col_coverage_gap_pct - (0.80 - c.col_coverage_pct)) < 0.01,
        `col_coverage_gap_pct ${c.col_coverage_gap_pct} should equal 0.80 - ${c.col_coverage_pct} (rank ${c.rank})`);
    } else if (c.col_coverage_pct != null && c.col_coverage_pct >= 0.80){
      assert.equal(c.col_coverage_gap_pct, null,
        `col_coverage_gap_pct should be null when coverage ≥ 80%; rank ${c.rank} got ${c.col_coverage_gap_pct}`);
    }
  }
});

test('population_delta_vs_baseline is stamped after a run with a baseline', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_population: true }
  });
  assert.equal(out.available, true);
  // Every candidate should have the field (null or integer).
  for (const c of out.candidates){
    assert.ok('population_delta_vs_baseline' in c,
      `population_delta_vs_baseline must be present on every candidate (rank ${c.rank})`);
    if (c.population_delta_vs_baseline != null){
      assert.ok(Number.isFinite(c.population_delta_vs_baseline) && Number.isInteger(c.population_delta_vs_baseline),
        `population_delta_vs_baseline must be an integer; rank ${c.rank} got ${c.population_delta_vs_baseline}`);
    }
  }
  // Baseline itself should have delta = 0.
  const baseline = out.candidates.find(c => c.distance_from_current_km < 0.5);
  if (baseline && baseline.population_delta_vs_baseline != null){
    assert.equal(baseline.population_delta_vs_baseline, 0,
      `baseline candidate should have population_delta_vs_baseline = 0`);
  }
});

test('optimization_confidence includes per_candidate_confidence distribution', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true }
  });
  assert.equal(out.available, true);
  const pcc = out.optimization_confidence?.per_candidate_confidence;
  assert.ok(pcc != null, 'optimization_confidence.per_candidate_confidence must be present');
  assert.ok('LOW' in pcc, 'per_candidate_confidence must have a LOW key');
  assert.ok('MEDIUM' in pcc, 'per_candidate_confidence must have a MEDIUM key');
  assert.ok('HIGH' in pcc, 'per_candidate_confidence must have a HIGH key');
  // Without raster or polygon, all candidates should be LOW.
  assert.equal(pcc.MEDIUM, 0, 'MEDIUM should be 0 without raster or polygon');
  assert.equal(pcc.HIGH, 0, 'HIGH should be 0 without raster or polygon');
  assert.ok(pcc.LOW > 0, 'LOW should be > 0');
});

test('optimization_confidence notes include all-LOW advisory when no filing-grade inputs', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true, prefer_high_conductivity: true }
  });
  assert.equal(out.available, true);
  const notes = out.optimization_confidence?.notes ?? [];
  // All candidates are LOW → advisory note should be present.
  const hasAdvisory = notes.some(n => /LOW confidence/i.test(n) || /zone-table/i.test(n));
  assert.ok(hasAdvisory,
    `optimization_confidence.notes should include a LOW-confidence advisory; got: ${JSON.stringify(notes)}`);
});

test('blanket_pop_risk is set correctly based on blanket_population_pct tier', async () => {
  // Standard KAZM run: blanket pop will be very low → expect OK or ELEVATED.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 15,
    optimization_goals: { minimize_blanket_population: true }
  });
  assert.equal(out.available, true);
  const VALID_RISK = new Set(['OK', 'ELEVATED', 'HIGH', 'EXCEEDS_LIMIT']);
  for (const c of out.candidates){
    if (c.blanket_population_pct == null){
      assert.equal(c.blanket_pop_risk, null,
        `blanket_pop_risk should be null when blanket_population_pct is null (rank ${c.rank})`);
    } else {
      assert.ok(VALID_RISK.has(c.blanket_pop_risk),
        `blanket_pop_risk must be OK/ELEVATED/HIGH/EXCEEDS_LIMIT; rank ${c.rank} got: ${c.blanket_pop_risk}`);
      // Tier consistency checks.
      if (c.blanket_population_pct > 1) assert.equal(c.blanket_pop_risk, 'EXCEEDS_LIMIT', `>1% should be EXCEEDS_LIMIT`);
      if (c.blanket_population_pct >= 0.8 && c.blanket_population_pct <= 1) assert.equal(c.blanket_pop_risk, 'HIGH', `0.8-1% should be HIGH`);
      if (c.blanket_population_pct >= 0.5 && c.blanket_population_pct < 0.8) assert.equal(c.blanket_pop_risk, 'ELEVATED', `0.5-0.8% should be ELEVATED`);
      if (c.blanket_population_pct < 0.5) assert.equal(c.blanket_pop_risk, 'OK', `<0.5% should be OK`);
    }
  }
});

test('score_histogram buckets include promising_count field', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20,
    optimization_goals: { maximize_col_coverage: true, maximize_population: true }
  });
  assert.equal(out.available, true);
  assert.ok(Array.isArray(out.score_histogram), 'score_histogram must be an array');
  for (const bucket of out.score_histogram){
    assert.ok('promising_count' in bucket,
      `every histogram bucket must have promising_count; bucket ${bucket.bucket} is missing it`);
    assert.ok(Number.isInteger(bucket.promising_count) && bucket.promising_count >= 0,
      `promising_count must be a non-negative integer; bucket ${bucket.bucket} got ${bucket.promising_count}`);
    assert.ok(bucket.promising_count <= bucket.count,
      `promising_count must be ≤ count; bucket ${bucket.bucket}: ${bucket.promising_count} > ${bucket.count}`);
  }
});

test('regulatory_compliance_summary present on every candidate with correct shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  const VALID_STATUS = new Set(['PASS', 'FAIL', 'ADVISORY', 'NOT_EVALUATED', 'CLEAR']);
  for (const c of out.candidates){
    const rcs = c.regulatory_compliance_summary;
    assert.ok(rcs != null, `regulatory_compliance_summary must be present on every candidate (rank ${c.rank})`);
    for (const key of ['col_coverage', 'blanket_pop', 'class_power', 'treaty_zone']){
      assert.ok(key in rcs, `regulatory_compliance_summary must have '${key}' key (rank ${c.rank})`);
      assert.ok(VALID_STATUS.has(rcs[key].status),
        `${key}.status must be one of PASS/FAIL/ADVISORY/NOT_EVALUATED/CLEAR; rank ${c.rank} got '${rcs[key].status}'`);
      assert.ok(typeof rcs[key].rule === 'string' && rcs[key].rule.length > 0,
        `${key}.rule must be a non-empty string (rank ${c.rank})`);
    }
  }
});

test('regulatory_compliance_summary.col_coverage.status is FAIL for candidates below 80% COL floor', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 30 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const rcs = c.regulatory_compliance_summary;
    if (c.col_coverage_pct != null && c.col_coverage_pct < 0.80){
      assert.equal(rcs.col_coverage.status, 'FAIL',
        `rank ${c.rank}: col_coverage_pct=${c.col_coverage_pct} < 0.80 should yield FAIL status`);
    } else if (c.col_coverage_pct != null && c.col_coverage_pct >= 0.80){
      assert.equal(rcs.col_coverage.status, 'PASS',
        `rank ${c.rank}: col_coverage_pct=${c.col_coverage_pct} >= 0.80 should yield PASS status`);
    }
  }
});

test('regulatory_compliance_summary.blanket_pop.status is FAIL when blanket_population_pct > 1%', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 40 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const rcs = c.regulatory_compliance_summary;
    if (c.blanket_population_pct != null){
      const expected = c.blanket_population_pct > 1.0 ? 'FAIL' : 'PASS';
      assert.equal(rcs.blanket_pop.status, expected,
        `rank ${c.rank}: blanket_pop status mismatch (pct=${c.blanket_population_pct})`);
    }
  }
});

test('regulatory_compliance_summary.class_power.ceiling matches FCC §73.21 for the station class', async () => {
  // Class B max = 50 kW per §73.21; KAZM is Class B.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const rcs = c.regulatory_compliance_summary;
    assert.equal(rcs.class_power.ceiling, 50,
      `Class B ceiling must be 50 kW per §73.21; rank ${c.rank} got ${rcs.class_power.ceiling}`);
    assert.ok(rcs.class_power.value > 0,
      `class_power.value (tpo_kw) must be positive; rank ${c.rank} got ${rcs.class_power.value}`);
  }
});

test('power_class_ceiling_kw is stamped on every candidate and matches §73.21 class table', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(c.power_class_ceiling_kw != null,
      `power_class_ceiling_kw must be non-null; rank ${c.rank}`);
    // KAZM is Class B → ceiling 50 kW per §73.21.
    assert.equal(c.power_class_ceiling_kw, 50,
      `KAZM Class B ceiling must be 50 kW; rank ${c.rank} got ${c.power_class_ceiling_kw}`);
    // consistency with regulatory_compliance_summary
    assert.equal(c.regulatory_compliance_summary.class_power.ceiling, c.power_class_ceiling_kw,
      `power_class_ceiling_kw must match regulatory_compliance_summary.class_power.ceiling (rank ${c.rank})`);
  }
});

test('mpe_evaluation_required is true on every candidate (AM broadcast categorical requirement)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.strictEqual(c.mpe_evaluation_required, true,
      `mpe_evaluation_required must be true for all AM broadcast candidates; rank ${c.rank}`);
  }
});

test('regulatory_compliance_summary.treaty_zone.status is ADVISORY when treaty_zone is set', async () => {
  // Build a synthetic scored candidate by running the optimizer and checking any treaty candidates.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 50 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const rcs = c.regulatory_compliance_summary;
    if (c.treaty_zone){
      assert.equal(rcs.treaty_zone.status, 'ADVISORY',
        `rank ${c.rank}: treaty_zone set but regulatory_compliance_summary.treaty_zone.status is not ADVISORY`);
      assert.equal(rcs.treaty_zone.value, c.treaty_zone,
        `rcs.treaty_zone.value must equal candidate.treaty_zone (rank ${c.rank})`);
    } else {
      assert.equal(rcs.treaty_zone.status, 'CLEAR',
        `rank ${c.rank}: no treaty_zone but status is ${rcs.treaty_zone.status}`);
      assert.equal(rcs.treaty_zone.value, null,
        `rcs.treaty_zone.value must be null when no treaty zone (rank ${c.rank})`);
    }
  }
});

test('score_delta_explanation is present and structurally correct when a baseline exists', async () => {
  // KAZM run: current_site is inside the grid, so baseline will be found.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  // At least some candidates should have a baseline (if any point equals current_site coords).
  const withDelta = out.candidates.filter(c => c.score_delta_explanation != null);
  // score_delta_vs_baseline is always stamped; score_delta_explanation should match those.
  const withScoreDelta = out.candidates.filter(c => c.score_delta_vs_baseline != null);
  assert.equal(withDelta.length, withScoreDelta.length,
    'every candidate with score_delta_vs_baseline must have score_delta_explanation');
  for (const c of withDelta){
    const sde = c.score_delta_explanation;
    assert.ok(typeof sde.total === 'number', `score_delta_explanation.total must be a number (rank ${c.rank})`);
    assert.ok(sde.components && typeof sde.components === 'object',
      `score_delta_explanation.components must be an object (rank ${c.rank})`);
    assert.ok(Math.abs(sde.total - c.score_delta_vs_baseline) < 0.01,
      `score_delta_explanation.total (${sde.total}) must match score_delta_vs_baseline (${c.score_delta_vs_baseline})`);
  }
});

test('score_delta_explanation.components values are non-zero (zero deltas are omitted)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    if (!c.score_delta_explanation) continue;
    for (const [k, v] of Object.entries(c.score_delta_explanation.components)){
      assert.notEqual(v, 0,
        `score_delta_explanation.components must omit zero-delta keys; found ${k}=0 on rank ${c.rank}`);
    }
  }
});

test('form_301_checklist is present and contains required FCC filing items', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  assert.ok(Array.isArray(out.form_301_checklist) && out.form_301_checklist.length > 0,
    'form_301_checklist must be a non-empty array');
  const VALID_STATUS = new Set(['REQUIRED', 'CONDITIONAL', 'ADVISORY']);
  const REQUIRED_IDS = ['SITE_SURVEY', 'ANTENNA_STUDY', 'ASR_REGISTRATION',
    'RF_EXPOSURE_MPE', 'COL_COVERAGE', 'BLANKET_POPULATION', 'PROTECTION_STUDIES', 'NEPA_ENVIRONMENTAL'];
  const ids = out.form_301_checklist.map(item => item.id);
  for (const reqId of REQUIRED_IDS){
    assert.ok(ids.includes(reqId), `form_301_checklist must include item '${reqId}'`);
  }
  for (const item of out.form_301_checklist){
    assert.ok(typeof item.id === 'string' && item.id.length > 0,
      `every checklist item must have a non-empty id`);
    assert.ok(VALID_STATUS.has(item.status),
      `checklist item '${item.id}' status must be REQUIRED/CONDITIONAL/ADVISORY; got '${item.status}'`);
    assert.ok(typeof item.description === 'string' && item.description.length > 0,
      `checklist item '${item.id}' must have a description`);
    assert.ok(typeof item.rule === 'string' && item.rule.length > 0,
      `checklist item '${item.id}' must have a rule citation`);
  }
});

test('form_301_checklist includes SKYWAVE_NIF for clear_channel or HIGH skywave stations', async () => {
  // KAZM (1490 kHz) is a regional channel, Class B — skywave risk depends on the
  // buildProtectionAdvisory logic.  Clear channel stations always include it.
  // We test that a clear channel station (e.g. 640 kHz — KFI clear) gets the item.
  const clearChannelInputs = { ...KAZM, frequency_khz: 640 };
  const out = await runSiteOptimizer({ ...clearChannelInputs, candidate_limit: 5 });
  assert.equal(out.available, true);
  const ids = out.form_301_checklist.map(i => i.id);
  assert.ok(ids.includes('SKYWAVE_NIF'),
    'form_301_checklist must include SKYWAVE_NIF for clear channel frequency (640 kHz)');
  const nifItem = out.form_301_checklist.find(i => i.id === 'SKYWAVE_NIF');
  assert.equal(nifItem.status, 'REQUIRED', 'SKYWAVE_NIF must be REQUIRED for clear channel');
});

test('form_301_checklist includes DA_PATTERN item when pattern_mode is DA', async () => {
  const daInputs = { ...KAZM, pattern_mode: 'DA-N' };
  const out = await runSiteOptimizer({ ...daInputs, candidate_limit: 5 });
  assert.equal(out.available, true);
  const ids = out.form_301_checklist.map(i => i.id);
  assert.ok(ids.includes('DA_PATTERN'),
    'form_301_checklist must include DA_PATTERN item when pattern_mode is DA-N');
});

test('form_301_checklist omits DA_PATTERN for non-directional stations', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'ND', candidate_limit: 5 });
  assert.equal(out.available, true);
  const ids = out.form_301_checklist.map(i => i.id);
  assert.ok(!ids.includes('DA_PATTERN'),
    'form_301_checklist must NOT include DA_PATTERN for ND stations');
});

test('groundwave_contour_table present on every candidate with 4 standard FCC contours', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const EXPECTED_LEVELS = [25, 5, 2, 0.5];
  for (const c of out.candidates){
    assert.ok(Array.isArray(c.groundwave_contour_table),
      `groundwave_contour_table must be an array (rank ${c.rank})`);
    assert.equal(c.groundwave_contour_table.length, 4,
      `groundwave_contour_table must have exactly 4 entries (rank ${c.rank})`);
    for (let i = 0; i < 4; i++){
      const row = c.groundwave_contour_table[i];
      assert.equal(row.mvm, EXPECTED_LEVELS[i],
        `contour table row ${i} mvm must be ${EXPECTED_LEVELS[i]}; got ${row.mvm} (rank ${c.rank})`);
      assert.ok(typeof row.label === 'string', `row.label must be a string (rank ${c.rank})`);
      assert.ok(typeof row.note === 'string', `row.note must be a string (rank ${c.rank})`);
    }
  }
});

test('groundwave_contour_table: 5 mV/m distance matches principal_community_5mvm_km', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    if (c.principal_community_5mvm_km == null) continue;
    const fiveMvm = c.groundwave_contour_table.find(r => r.mvm === 5);
    assert.ok(fiveMvm != null, `groundwave_contour_table must include 5 mV/m row (rank ${c.rank})`);
    if (fiveMvm.distance_km != null){
      assert.ok(Math.abs(fiveMvm.distance_km - c.principal_community_5mvm_km) < 0.1,
        `5 mV/m contour distance (${fiveMvm.distance_km}) must match principal_community_5mvm_km (${c.principal_community_5mvm_km}); rank ${c.rank}`);
    }
  }
});

test('antenna_system_summary present on every candidate with correct structure', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const s = c.antenna_system_summary;
    assert.ok(s != null, `antenna_system_summary must be present (rank ${c.rank})`);
    assert.ok(typeof s.efficiency_range_db.min_db === 'number', `efficiency_range_db.min_db must be a number (rank ${c.rank})`);
    assert.ok(typeof s.efficiency_range_db.max_db === 'number', `efficiency_range_db.max_db must be a number (rank ${c.rank})`);
    assert.ok(s.efficiency_range_db.min_db <= s.efficiency_range_db.max_db,
      `efficiency min_db must be ≤ max_db (rank ${c.rank})`);
    assert.ok(typeof s.efficiency_range_db.label === 'string', `efficiency_range_db.label must be a string (rank ${c.rank})`);
    // KAZM is Class B ceiling 50 kW; headroom = 50 - tpo_kw >= 0
    assert.ok(s.tpo_headroom_to_class_max_kw != null && s.tpo_headroom_to_class_max_kw >= 0,
      `tpo_headroom must be non-negative for Class B station (rank ${c.rank})`);
  }
});

test('antenna_system_summary.effective_service_area_km2 ≈ π×daytime_reach²', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    if (c.daytime_reach_km == null) continue;
    const expected = Math.round(Math.PI * c.daytime_reach_km * c.daytime_reach_km * 100) / 100;
    const got = c.antenna_system_summary.effective_service_area_km2;
    assert.ok(Math.abs(got - expected) < 1,
      `effective_service_area_km2 (${got}) should match π×daytime_reach² (${expected}); rank ${c.rank}`);
  }
});

test('groundwave_contour_table: 0.5 mV/m distance matches daytime_reach_km', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    if (c.daytime_reach_km == null) continue;
    const halfMvm = c.groundwave_contour_table.find(r => r.mvm === 0.5);
    assert.ok(halfMvm != null, `groundwave_contour_table must include 0.5 mV/m row (rank ${c.rank})`);
    if (halfMvm.distance_km != null){
      assert.ok(Math.abs(halfMvm.distance_km - c.daytime_reach_km) < 0.1,
        `0.5 mV/m contour distance (${halfMvm.distance_km}) must match daytime_reach_km (${c.daytime_reach_km}); rank ${c.rank}`);
    }
  }
});
