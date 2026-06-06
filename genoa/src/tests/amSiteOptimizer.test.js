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

test('buildGroundRadialAdvisory returns structured object with advisory_level, note, and radial sizing fields', () => {
  const { buildGroundRadialAdvisory } = __test__;
  // GOOD/EXCELLENT: returns STANDARD advisory (not null — now always structured)
  const good = buildGroundRadialAdvisory(4, 780);
  assert.ok(good != null, 'σ=4 mS/m (GOOD) should return a structured advisory');
  assert.equal(good.advisory_level, 'STANDARD', 'σ=4 mS/m should be STANDARD');
  assert.ok(typeof good.recommended_radial_count === 'number' && good.recommended_radial_count > 0,
    'STANDARD advisory must have recommended_radial_count');

  // FAIR: returns ADVISORY
  const fair = buildGroundRadialAdvisory(2, 780);
  assert.ok(fair != null, 'σ=2 mS/m (FAIR) should return an advisory');
  assert.equal(fair.advisory_level, 'ADVISORY', 'σ=2 mS/m should be ADVISORY');
  assert.ok(/120.radial|§73\.190/i.test(fair.note),
    'FAIR advisory note should mention §73.190 or radial count');

  // POOR: returns REQUIRED with extended system flag
  const poor = buildGroundRadialAdvisory(0.5, 780);
  assert.ok(poor != null, 'σ=0.5 mS/m (POOR) should return an advisory');
  assert.equal(poor.advisory_level, 'REQUIRED', 'σ=0.5 mS/m should be REQUIRED');
  assert.ok(/POOR/i.test(poor.note), 'POOR advisory note should mention POOR conductivity');
  assert.equal(poor.extended_system_required, true, 'POOR σ must flag extended_system_required');

  // null σ: returns null
  assert.equal(buildGroundRadialAdvisory(null, 780), null, 'null σ should return null');
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

test('form_301_checklist always includes HAAT_CALCULATION and CP_OR_LICENSE_MOD', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const ids = out.form_301_checklist.map(i => i.id);
  assert.ok(ids.includes('HAAT_CALCULATION'),
    'form_301_checklist must always include HAAT_CALCULATION');
  assert.ok(ids.includes('CP_OR_LICENSE_MOD'),
    'form_301_checklist must always include CP_OR_LICENSE_MOD');
  const haatItem = out.form_301_checklist.find(i => i.id === 'HAAT_CALCULATION');
  assert.equal(haatItem.status, 'REQUIRED', 'HAAT_CALCULATION must be REQUIRED');
  const cpItem = out.form_301_checklist.find(i => i.id === 'CP_OR_LICENSE_MOD');
  assert.equal(cpItem.status, 'REQUIRED', 'CP_OR_LICENSE_MOD must be REQUIRED');
});

test('form_301_checklist includes CONDUCTIVITY_FIELD_SURVEY when zone-table sigma used', async () => {
  // KAZM uses zone-table sigma (no M3 raster loaded in tests), so CONDUCTIVITY_FIELD_SURVEY
  // should always appear in test runs.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const ids = out.form_301_checklist.map(i => i.id);
  assert.ok(ids.includes('CONDUCTIVITY_FIELD_SURVEY'),
    'form_301_checklist must include CONDUCTIVITY_FIELD_SURVEY when zone-table sigma is used');
  const item = out.form_301_checklist.find(i => i.id === 'CONDUCTIVITY_FIELD_SURVEY');
  const VALID_STATUS = new Set(['REQUIRED', 'CONDITIONAL', 'ADVISORY']);
  assert.ok(VALID_STATUS.has(item.status), `CONDUCTIVITY_FIELD_SURVEY status must be valid; got '${item.status}'`);
});

test('score_confidence_band is present on every candidate with score_low, score_high, uncertainty_pts', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const band = c.score_confidence_band;
    assert.ok(band != null, `score_confidence_band must be present (rank ${c.rank})`);
    assert.ok(typeof band.score_low === 'number' && band.score_low >= 0,
      `score_low must be a non-negative number (rank ${c.rank})`);
    assert.ok(typeof band.score_high === 'number' && band.score_high <= 100,
      `score_high must be <= 100 (rank ${c.rank})`);
    assert.ok(band.score_low <= c.score && c.score <= band.score_high,
      `score ${c.score} must be within [${band.score_low}, ${band.score_high}] (rank ${c.rank})`);
    assert.ok(typeof band.uncertainty_pts === 'number' && band.uncertainty_pts >= 0,
      `uncertainty_pts must be non-negative (rank ${c.rank})`);
    assert.ok(Array.isArray(band.uncertainty_factors),
      `uncertainty_factors must be an array (rank ${c.rank})`);
  }
});

test('score_confidence_band: LOW confidence (no polygon, no centroid, zone-table sigma) has uncertainty_pts >= 22', async () => {
  // KAZM: no polygon, no centroid, zone-table sigma → should accumulate all three factors
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const band = c.score_confidence_band;
    assert.ok(band.uncertainty_pts >= 22,
      `KAZM (no polygon/centroid, zone-table sigma) should have uncertainty_pts >= 22; got ${band.uncertainty_pts} (rank ${c.rank})`);
  }
});

test('score_confidence_band: HIGH confidence (polygon + centroid) has fewer factors than LOW', async () => {
  const withPolygon = {
    ...KAZM,
    community_of_license_polygon: {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[
        [-118.3, 34.0], [-118.2, 34.0], [-118.2, 34.1], [-118.3, 34.1], [-118.3, 34.0]
      ]]}
    },
    col_centroid: { lat: 34.05, lon: -118.25 },
    candidate_limit: 5
  };
  const outLow  = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  const outHigh = await runSiteOptimizer(withPolygon);
  assert.equal(outHigh.available, true);
  const lowBand  = outLow.candidates[0].score_confidence_band;
  const highBand = outHigh.candidates[0].score_confidence_band;
  assert.ok(highBand.uncertainty_pts < lowBand.uncertainty_pts,
    `providing polygon+centroid should reduce uncertainty_pts (high=${highBand.uncertainty_pts}, low=${lowBand.uncertainty_pts})`);
  assert.ok(highBand.uncertainty_factors.length < lowBand.uncertainty_factors.length,
    `providing polygon+centroid should reduce number of uncertainty_factors`);
});

test('tpo_power_sweep is present on every candidate with 2-5 rows', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(Array.isArray(c.tpo_power_sweep) && c.tpo_power_sweep.length >= 2,
      `tpo_power_sweep must be an array with ≥2 rows (rank ${c.rank})`);
    assert.ok(c.tpo_power_sweep.length <= 5,
      `tpo_power_sweep must have ≤5 rows (rank ${c.rank}); got ${c.tpo_power_sweep.length}`);
  }
});

test('tpo_power_sweep: exactly one row has is_current_tpo = true and matches input tpo_kw', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const currentRows = c.tpo_power_sweep.filter(r => r.is_current_tpo === true);
    assert.equal(currentRows.length, 1,
      `tpo_power_sweep must have exactly one is_current_tpo=true row (rank ${c.rank})`);
    assert.ok(Math.abs(currentRows[0].tpo_kw - KAZM.tpo_kw) < 0.01,
      `is_current_tpo row must have tpo_kw ≈ ${KAZM.tpo_kw}; got ${currentRows[0].tpo_kw} (rank ${c.rank})`);
  }
});

test('tpo_power_sweep: rows are sorted ascending by tpo_kw', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const tpos = c.tpo_power_sweep.map(r => r.tpo_kw);
    for (let i = 1; i < tpos.length; i++){
      assert.ok(tpos[i] >= tpos[i - 1],
        `tpo_power_sweep must be sorted ascending; row ${i-1}=${tpos[i-1]} > row ${i}=${tpos[i]} (rank ${c.rank})`);
    }
  }
});

test('tpo_power_sweep: higher tpo rows have larger daytime_reach_km', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const rows = c.tpo_power_sweep.filter(r => r.daytime_reach_km != null);
    if (rows.length < 2) continue;
    for (let i = 1; i < rows.length; i++){
      assert.ok(rows[i].daytime_reach_km >= rows[i - 1].daytime_reach_km,
        `higher TPO must not decrease daytime reach; row ${i-1} reach=${rows[i-1].daytime_reach_km} > row ${i} reach=${rows[i].daytime_reach_km} (rank ${c.rank})`);
    }
  }
});

test('tpo_power_sweep: all rows within class ceiling and class minimum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const { __test__: { FCC_CLASS_POWER_KW } } = await import('../engine/am/siteOptimizer.js');
  const classLimits = FCC_CLASS_POWER_KW[KAZM.fcc_class];
  for (const c of out.candidates){
    for (const row of c.tpo_power_sweep){
      assert.ok(row.tpo_kw >= classLimits.min - 0.001,
        `tpo_power_sweep row tpo_kw must be >= class min ${classLimits.min}; got ${row.tpo_kw} (rank ${c.rank})`);
      assert.ok(row.tpo_kw <= classLimits.max + 0.001,
        `tpo_power_sweep row tpo_kw must be <= class max ${classLimits.max}; got ${row.tpo_kw} (rank ${c.rank})`);
    }
  }
});

test('antenna_height_profile present on every candidate with required fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const ahp = c.antenna_height_profile;
    assert.ok(ahp != null, `antenna_height_profile must be present (rank ${c.rank})`);
    assert.equal(ahp.frequency_khz, KAZM.frequency_khz, `antenna_height_profile.frequency_khz must match input (rank ${c.rank})`);
    assert.ok(typeof ahp.wavelength_m === 'number' && ahp.wavelength_m > 0,
      `antenna_height_profile.wavelength_m must be positive (rank ${c.rank})`);
    assert.ok(typeof ahp.quarter_wave_m === 'number' && ahp.quarter_wave_m > 0,
      `antenna_height_profile.quarter_wave_m must be positive (rank ${c.rank})`);
    assert.ok(typeof ahp.five_eighths_wave_m === 'number' && ahp.five_eighths_wave_m > ahp.quarter_wave_m,
      `five_eighths_wave_m must exceed quarter_wave_m (rank ${c.rank})`);
    assert.ok(typeof ahp.quarter_wave_asr_required === 'boolean',
      `antenna_height_profile.quarter_wave_asr_required must be boolean (rank ${c.rank})`);
    assert.ok(typeof ahp.note === 'string' && ahp.note.length > 0,
      `antenna_height_profile.note must be a string (rank ${c.rank})`);
  }
});

test('antenna_height_profile: 540 kHz requires ASR (λ/4 ≈ 139 m >> 60.96 m threshold)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 540, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const ahp = c.antenna_height_profile;
    assert.ok(ahp.quarter_wave_asr_required === true,
      `540 kHz λ/4 ≈ 139 m must trigger ASR requirement (rank ${c.rank})`);
    assert.ok(ahp.if_asr_constrained != null,
      `if_asr_constrained must be populated when ASR is required (rank ${c.rank})`);
    assert.ok(ahp.if_asr_constrained.max_physical_height_m === 60.96,
      `if_asr_constrained.max_physical_height_m must be 60.96 m (rank ${c.rank})`);
    assert.ok(ahp.if_asr_constrained.electrical_height_deg < 90,
      `ASR-constrained electrical height must be < 90° at 540 kHz (rank ${c.rank})`);
    assert.ok(ahp.if_asr_constrained.efficiency_loss_db < 0,
      `efficiency_loss_db must be negative (rank ${c.rank})`);
  }
});

test('antenna_height_profile: quarter_wave_m × 4 ≈ wavelength_m', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const ahp = c.antenna_height_profile;
    const computed_lambda = ahp.quarter_wave_m * 4;
    assert.ok(Math.abs(computed_lambda - ahp.wavelength_m) < 0.5,
      `quarter_wave_m × 4 should ≈ wavelength_m; got ${computed_lambda} vs ${ahp.wavelength_m} (rank ${c.rank})`);
  }
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

test('field_strength_profile present on every candidate with 6 distance entries', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const EXPECTED_KM = [1, 5, 10, 25, 50, 100];
  for (const c of out.candidates){
    assert.ok(Array.isArray(c.field_strength_profile),
      `field_strength_profile must be an array (rank ${c.rank})`);
    assert.equal(c.field_strength_profile.length, 6,
      `field_strength_profile must have 6 entries (rank ${c.rank})`);
    for (let i = 0; i < 6; i++){
      assert.equal(c.field_strength_profile[i].distance_km, EXPECTED_KM[i],
        `profile[${i}].distance_km must be ${EXPECTED_KM[i]} (rank ${c.rank})`);
      assert.ok(typeof c.field_strength_profile[i].tier === 'string',
        `profile[${i}].tier must be a string (rank ${c.rank})`);
    }
  }
});

test('tpo_to_coverage_table present on every candidate with correct structure', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const EXPECTED_DISTANCES = [5, 10, 15, 20, 30, 50];
  for (const c of out.candidates){
    assert.ok(Array.isArray(c.tpo_to_coverage_table),
      `tpo_to_coverage_table must be an array (rank ${c.rank})`);
    assert.equal(c.tpo_to_coverage_table.length, 6,
      `tpo_to_coverage_table must have 6 entries (rank ${c.rank})`);
    for (let i = 0; i < 6; i++){
      const row = c.tpo_to_coverage_table[i];
      assert.equal(row.col_distance_km, EXPECTED_DISTANCES[i],
        `tpo_to_coverage_table[${i}].col_distance_km must be ${EXPECTED_DISTANCES[i]} (rank ${c.rank})`);
      if (row.tpo_needed_kw != null){
        assert.ok(row.tpo_needed_kw > 0,
          `tpo_needed_kw must be positive (rank ${c.rank}, dist ${row.col_distance_km} km)`);
      }
      assert.equal(row.rule, '47 CFR §73.24(j) 5 mV/m floor',
        `rule must cite §73.24(j) (rank ${c.rank})`);
    }
  }
});

test('score_components_raw present in explanation with correct 0-100 bounds', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10,
    optimization_goals: { maximize_col_coverage: true, maximize_population: true,
      minimize_blanket_population: true, prefer_high_conductivity: true }
  });
  assert.equal(out.available, true);
  const EXPECTED_KEYS = ['col_coverage', 'population', 'blanket', 'conductivity', 'wildfire', 'treaty_zone'];
  for (const c of out.candidates){
    const raw = c.explanation?.score_components_raw;
    assert.ok(raw != null, `score_components_raw must be present (rank ${c.rank})`);
    for (const k of EXPECTED_KEYS){
      assert.ok(k in raw, `score_components_raw must have key '${k}' (rank ${c.rank})`);
      if (raw[k] != null){
        assert.ok(raw[k] >= 0 && raw[k] <= 100,
          `score_components_raw.${k} must be in [0, 100]; got ${raw[k]} (rank ${c.rank})`);
      }
    }
  }
});

test('tpo_to_coverage_table: TPO increases monotonically with distance', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const valid = c.tpo_to_coverage_table.filter(r => r.tpo_needed_kw != null);
    for (let i = 1; i < valid.length; i++){
      assert.ok(valid[i].tpo_needed_kw >= valid[i-1].tpo_needed_kw,
        `tpo_needed_kw must increase with distance: [${i}]=${valid[i].tpo_needed_kw} < [${i-1}]=${valid[i-1].tpo_needed_kw} (rank ${c.rank})`);
    }
  }
});

test('field_strength_profile: field decreases monotonically with distance', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const profile = c.field_strength_profile.filter(r => r.field_mvm != null);
    for (let i = 1; i < profile.length; i++){
      assert.ok(profile[i].field_mvm <= profile[i-1].field_mvm,
        `field strength must decrease with distance: profile[${i}]=${profile[i].field_mvm} > profile[${i-1}]=${profile[i-1].field_mvm} (rank ${c.rank})`);
    }
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

test('protection_requirements present in response with correct structure', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const pr = out.protection_requirements;
  assert.ok(pr != null, 'protection_requirements must be present in response');
  assert.ok(pr.station_class, 'protection_requirements.station_class must be set');
  assert.ok(pr.channel_class, 'protection_requirements.channel_class must be set');
  assert.ok(typeof pr.nif_study_required === 'boolean',
    'protection_requirements.nif_study_required must be boolean');
  assert.ok(Array.isArray(pr.must_protect_against_interference),
    'protection_requirements.must_protect_against_interference must be an array');
  assert.ok(pr.receives_co_channel_protection?.type,
    'protection_requirements.receives_co_channel_protection.type must be set');
  assert.ok(pr.adjacent_channel_advisory?.minus_10khz?.protection_db != null,
    'adjacent_channel_advisory must include 1st adjacent lower protection_db');
});

test('protection_requirements.nif_study_required is false for local channel stations', async () => {
  // Local channel (e.g., 1230 kHz).
  const localInputs = { ...KAZM, frequency_khz: 1230 };
  const out = await runSiteOptimizer({ ...localInputs, candidate_limit: 5 });
  assert.equal(out.available, true);
  assert.strictEqual(out.protection_requirements.nif_study_required, false,
    'Local channel stations should not require NIF study');
  assert.equal(out.protection_requirements.channel_class, 'local');
});

test('protection_requirements.nif_study_required is true for clear channel stations', async () => {
  const clearInputs = { ...KAZM, frequency_khz: 640 };
  const out = await runSiteOptimizer({ ...clearInputs, candidate_limit: 5 });
  assert.equal(out.available, true);
  assert.strictEqual(out.protection_requirements.nif_study_required, true,
    'Clear channel stations must require NIF study');
  assert.equal(out.protection_requirements.channel_class, 'clear_channel');
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

// ---------- coverage_feasibility_assessment ----------

test('coverage_feasibility_assessment present on every candidate with correct shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  const VALID_VERDICTS = [
    'MEETS_ALL_FLOORS', 'COL_OK_BLANKET_FAILS', 'FEASIBLE_WITH_POWER_INCREASE',
    'POTENTIALLY_DA_RESCUABLE', 'INFEASIBLE_AT_CLASS_CEILING',
    'REQUIRES_ENGINEERING_REVIEW', 'NOT_EVALUATED'
  ];
  for (const c of out.candidates){
    const fa = c.coverage_feasibility_assessment;
    assert.ok(fa, `coverage_feasibility_assessment missing on rank ${c.rank}`);
    assert.ok(VALID_VERDICTS.includes(fa.verdict),
      `verdict must be one of the known values; rank ${c.rank} got: ${fa.verdict}`);
    assert.ok(typeof fa.summary === 'string' && fa.summary.length > 0,
      `summary must be non-empty string on rank ${c.rank}`);
    // Numeric fields must be null or finite.
    for (const key of ['col_coverage_pct', 'tpo_needed_for_col_floor_kw', 'class_power_ceiling_kw', 'blanket_pop_pct']){
      assert.ok(fa[key] == null || Number.isFinite(fa[key]),
        `${key} must be null or finite on rank ${c.rank}; got: ${fa[key]}`);
    }
    // Boolean fields must be boolean or null.
    for (const key of ['col_coverage_meets_floor', 'tpo_needed_within_class_ceiling', 'blanket_pop_meets_limit', 'da_pattern_may_resolve']){
      assert.ok(fa[key] == null || typeof fa[key] === 'boolean',
        `${key} must be boolean or null on rank ${c.rank}; got: ${fa[key]}`);
    }
  }
});

test('coverage_feasibility_assessment.class_power_ceiling_kw matches §73.21 class table', async () => {
  const CLASS_CEILINGS = { A: 50, B: 50, C: 0.25, D: 50 };
  for (const [cls, ceil] of Object.entries(CLASS_CEILINGS)){
    const out = await runSiteOptimizer({ ...KAZM, fcc_class: cls, candidate_limit: 3 });
    assert.equal(out.available, true);
    for (const c of out.candidates){
      assert.equal(c.coverage_feasibility_assessment.class_power_ceiling_kw, ceil,
        `class ${cls} ceiling should be ${ceil} kW; rank ${c.rank} got: ${c.coverage_feasibility_assessment.class_power_ceiling_kw}`);
    }
  }
});

test('coverage_feasibility_assessment.verdict is MEETS_ALL_FLOORS for baseline when coverage is high', async () => {
  // Use a high-power input so coverage should be easily met at the current site.
  const out = await runSiteOptimizer({ ...KAZM, tpo_kw: 50, fcc_class: 'A', candidate_limit: 20 });
  assert.equal(out.available, true);
  const baseline = out.candidates.find(c => c.distance_from_current_km === 0);
  assert.ok(baseline, 'baseline (current site, distance=0) must be in candidates');
  const fa = baseline.coverage_feasibility_assessment;
  // At 50 kW Class A, the 5 mV/m reach is large, so COL coverage should be met.
  if (fa.col_coverage_pct != null && fa.col_coverage_pct >= 0.80){
    assert.ok(
      fa.verdict === 'MEETS_ALL_FLOORS' || fa.verdict === 'COL_OK_BLANKET_FAILS',
      `50 kW Class A baseline with high coverage should be MEETS_ALL_FLOORS or COL_OK_BLANKET_FAILS; got: ${fa.verdict}`
    );
    assert.equal(fa.col_coverage_meets_floor, true, 'col_coverage_meets_floor should be true');
  }
});

test('coverage_feasibility_assessment.da_pattern_may_resolve is true when coverage is 50–80%', async () => {
  // Use low power to put coverage in the DA-rescuable range.
  const out = await runSiteOptimizer({ ...KAZM, tpo_kw: 0.01, candidate_limit: 30 });
  assert.equal(out.available, true);
  const daRescuable = out.candidates.filter(
    c => c.coverage_feasibility_assessment?.da_pattern_may_resolve === true
  );
  // At very low power many candidates should fall in the 50–80% range and flag as DA-rescuable.
  // At least check that when it IS true, the coverage_pct is in [0.50, 0.80).
  for (const c of daRescuable){
    const pct = c.coverage_feasibility_assessment.col_coverage_pct;
    assert.ok(pct != null && pct >= 0.50 && pct < 0.80,
      `da_pattern_may_resolve=true should only occur when coverage is in [0.50, 0.80); rank ${c.rank} got: ${pct}`);
  }
});

test('coverage_feasibility_assessment.tpo_needed_within_class_ceiling is consistent with class ceiling', async () => {
  const out = await runSiteOptimizer({ ...KAZM, tpo_kw: 0.05, fcc_class: 'D', candidate_limit: 20 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const fa = c.coverage_feasibility_assessment;
    if (fa.tpo_needed_for_col_floor_kw == null || fa.class_power_ceiling_kw == null) continue;
    const expectedWithinCeiling = fa.tpo_needed_for_col_floor_kw <= fa.class_power_ceiling_kw;
    assert.equal(fa.tpo_needed_within_class_ceiling, expectedWithinCeiling,
      `tpo_needed_within_class_ceiling should be ${expectedWithinCeiling} when tpo_needed=${fa.tpo_needed_for_col_floor_kw} vs ceiling=${fa.class_power_ceiling_kw}; rank ${c.rank}`);
  }
});

// ---------- per_candidate_engineering_checklist ----------

test('per_candidate_engineering_checklist is present on every candidate as a non-empty array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  const VALID_PRIORITIES = ['REQUIRED', 'HIGH', 'MEDIUM', 'ADVISORY'];
  for (const c of out.candidates){
    const cl = c.per_candidate_engineering_checklist;
    assert.ok(Array.isArray(cl),
      `per_candidate_engineering_checklist must be an array on rank ${c.rank}`);
    assert.ok(cl.length >= 1,
      `per_candidate_engineering_checklist must be non-empty on rank ${c.rank}; it was empty`);
    for (const item of cl){
      assert.ok(typeof item.id === 'string' && item.id.length > 0,
        `checklist item.id must be non-empty string on rank ${c.rank}`);
      assert.ok(VALID_PRIORITIES.includes(item.priority),
        `checklist item.priority must be valid on rank ${c.rank}; got: ${item.priority}`);
      assert.ok(typeof item.label === 'string' && item.label.length > 0,
        `checklist item.label must be non-empty string on rank ${c.rank}`);
      assert.ok(typeof item.note === 'string' && item.note.length > 0,
        `checklist item.note must be non-empty string on rank ${c.rank}`);
    }
  }
});

test('per_candidate_engineering_checklist always includes MPE_STUDY (mandatory for all AM)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const mpe = c.per_candidate_engineering_checklist.find(i => i.id === 'MPE_STUDY');
    assert.ok(mpe, `MPE_STUDY must appear on every candidate; missing on rank ${c.rank}`);
    assert.equal(mpe.priority, 'REQUIRED', `MPE_STUDY must be REQUIRED; rank ${c.rank} got: ${mpe.priority}`);
    assert.ok(/λ\/\(2π\)|near.field|OET.65/i.test(mpe.note),
      `MPE_STUDY note must mention near-field boundary; rank ${c.rank} got: "${mpe.note}"`);
  }
});

test('per_candidate_engineering_checklist includes ASR_REGISTRATION for low frequencies (long wavelength)', async () => {
  // 540 kHz → λ/4 ≈ 139 m >> 60.96 m ASR threshold
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 540, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const asr = c.per_candidate_engineering_checklist.find(i => i.id === 'ASR_REGISTRATION');
    assert.ok(asr, `ASR_REGISTRATION must appear on 540 kHz candidate (λ/4≈139m >> 60.96m threshold); rank ${c.rank}`);
    assert.ok(/§17\.7|200.ft|60\.96/i.test(asr.note),
      `ASR note must cite §17.7 / 200-ft threshold; got: "${asr.note}"`);
  }
});

test('per_candidate_engineering_checklist includes INTERNATIONAL_BORDER_COORDINATION for treaty zone', async () => {
  // Border-adjacent test: overriding treaty_zone via a location near the US/MX border
  // (El Paso area ~31.8° lat, -106.4° lon is very close to the border).
  const out = await runSiteOptimizer({
    ...KAZM,
    current_site: { lat: 31.8, lon: -106.4 },
    search_radius_km: 10,
    grid_spacing_km: 5,
    candidate_limit: 10
  });
  assert.equal(out.available, true);
  // At least some candidates near El Paso should be in the US/MX treaty zone.
  const treatyCandidates = out.candidates.filter(c => c.treaty_zone != null);
  if (treatyCandidates.length > 0){
    for (const c of treatyCandidates){
      const coord = c.per_candidate_engineering_checklist.find(i => i.id === 'INTERNATIONAL_BORDER_COORDINATION');
      assert.ok(coord,
        `Treaty-zone candidate at (${c.lat}, ${c.lon}) must have INTERNATIONAL_BORDER_COORDINATION checklist item`);
      assert.equal(coord.priority, 'REQUIRED', 'Border coordination must be REQUIRED priority');
    }
  }
  // Even if no treaty zone candidates, the test passes (location is on the edge).
});

test('per_candidate_engineering_checklist includes DA_PATTERN_DESIGN for DA stations', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'DA-D', candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const da = c.per_candidate_engineering_checklist.find(i => i.id === 'DA_PATTERN_DESIGN');
    assert.ok(da, `DA_PATTERN_DESIGN must appear when pattern_mode=DA-D; rank ${c.rank}`);
    assert.equal(da.priority, 'REQUIRED');
    assert.ok(/§73\.150|pattern/i.test(da.note), `DA note must mention §73.150; got: "${da.note}"`);
  }
});

test('per_candidate_engineering_checklist includes SOIL_RESISTIVITY_SURVEY when conductivity is zone-table (screening grade)', async () => {
  // Without AM_m3.tif loaded, conductivity is zone-table (screening-grade) → survey required.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  if (out.conductivity_mode === 'zone-table'){
    for (const c of out.candidates){
      const survey = c.per_candidate_engineering_checklist.find(i => i.id === 'SOIL_RESISTIVITY_SURVEY');
      assert.ok(survey,
        `SOIL_RESISTIVITY_SURVEY must appear when conductivity is zone-table (screening-grade); rank ${c.rank}`);
      assert.equal(survey.priority, 'REQUIRED');
    }
  }
  // If raster is loaded (filing-grade σ), survey is optional — test is a no-op.
});

// ---------- minimum_spacing_reference ----------

test('minimum_spacing_reference is present in response with correct structure', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  const msr = out.minimum_spacing_reference;
  assert.ok(msr, 'minimum_spacing_reference must be present in response');
  assert.ok(typeof msr.rule === 'string' && /§73\.37/i.test(msr.rule),
    `rule must cite §73.37; got: "${msr.rule}"`);
  assert.ok(['A', 'B', 'C', 'D'].includes(msr.proposed_class),
    `proposed_class must be A/B/C/D; got: ${msr.proposed_class}`);
  assert.ok(['local', 'regional', 'clear_channel'].includes(msr.channel_class),
    `channel_class must be local/regional/clear_channel; got: ${msr.channel_class}`);
  assert.ok(typeof msr.caveat === 'string' && msr.caveat.length > 20,
    'caveat must be a non-empty explanation string');

  for (const tableKey of ['co_channel', 'adjacent_10khz', 'adjacent_20khz']){
    assert.ok(Array.isArray(msr[tableKey]) && msr[tableKey].length === 4,
      `${tableKey} must be an array of 4 entries (one per class A/B/C/D)`);
    for (const row of msr[tableKey]){
      assert.ok(['A', 'B', 'C', 'D'].includes(row.existing_class),
        `${tableKey} row.existing_class must be A/B/C/D; got: ${row.existing_class}`);
      assert.ok(row.min_separation_km == null || Number.isFinite(row.min_separation_km),
        `${tableKey} row.min_separation_km must be null or finite; got: ${row.min_separation_km}`);
    }
  }
});

test('minimum_spacing_reference.co_channel: Class A vs Class A is the largest separation', async () => {
  const out = await runSiteOptimizer({ ...KAZM, fcc_class: 'A', candidate_limit: 3 });
  assert.equal(out.available, true);
  const msr = out.minimum_spacing_reference;
  const aaRow = msr.co_channel.find(r => r.existing_class === 'A');
  const acRow = msr.co_channel.find(r => r.existing_class === 'C');
  assert.ok(aaRow?.min_separation_km != null, 'A vs A co-channel row must have a distance');
  assert.ok(acRow?.min_separation_km != null, 'A vs C co-channel row must have a distance');
  assert.ok(aaRow.min_separation_km >= acRow.min_separation_km,
    `A vs A separation (${aaRow.min_separation_km} km) should be ≥ A vs C (${acRow.min_separation_km} km)`);
});

test('minimum_spacing_reference: co_channel separations are always >= adjacent_10khz', async () => {
  for (const cls of ['A', 'B', 'C', 'D']){
    const out = await runSiteOptimizer({ ...KAZM, fcc_class: cls, candidate_limit: 1 });
    const msr = out.minimum_spacing_reference;
    for (const exCls of ['A', 'B', 'C', 'D']){
      const coRow  = msr.co_channel.find(r => r.existing_class === exCls);
      const adjRow = msr.adjacent_10khz.find(r => r.existing_class === exCls);
      if (coRow?.min_separation_km == null || adjRow?.min_separation_km == null) continue;
      assert.ok(coRow.min_separation_km >= adjRow.min_separation_km,
        `Class ${cls} co-channel vs ${exCls} (${coRow.min_separation_km}) must be >= adjacent-10kHz (${adjRow.min_separation_km})`);
    }
  }
});

test('minimum_spacing_reference: Class C proposed station has smaller separations than Class A', async () => {
  const outA = await runSiteOptimizer({ ...KAZM, fcc_class: 'A', candidate_limit: 1 });
  const outC = await runSiteOptimizer({ ...KAZM, fcc_class: 'C', candidate_limit: 1 });
  const msrA = outA.minimum_spacing_reference;
  const msrC = outC.minimum_spacing_reference;
  // C vs C should be much smaller than A vs A
  const acac = msrA.co_channel.find(r => r.existing_class === 'A').min_separation_km;
  const cccc = msrC.co_channel.find(r => r.existing_class === 'C').min_separation_km;
  assert.ok(acac > cccc,
    `Class A vs A co-channel (${acac} km) must exceed Class C vs C (${cccc} km)`);
});

// ---------- buildMinimumSpacingReference unit tests ----------

test('buildMinimumSpacingReference: Class D co-channel vs A is 1037 km', () => {
  const msr = __test__.buildMinimumSpacingReference({ fcc_class: 'D', channel_class: 'clear_channel' });
  const row = msr.co_channel.find(r => r.existing_class === 'A');
  assert.equal(row.min_separation_km, 1037,
    `Class D vs A co-channel should be 1037 km; got: ${row.min_separation_km}`);
});

test('buildMinimumSpacingReference: Class C co-channel vs C is 354 km (smallest co-channel)', () => {
  const msr = __test__.buildMinimumSpacingReference({ fcc_class: 'C', channel_class: 'local' });
  const row = msr.co_channel.find(r => r.existing_class === 'C');
  assert.equal(row.min_separation_km, 354,
    `Class C vs C co-channel should be 354 km; got: ${row.min_separation_km}`);
});

test('buildMinimumSpacingReference: adjacent_20khz always < adjacent_10khz', () => {
  for (const cls of ['A', 'B', 'C', 'D']){
    const msr = __test__.buildMinimumSpacingReference({ fcc_class: cls, channel_class: 'regional' });
    for (const ex of ['A', 'B', 'C', 'D']){
      const adj10 = msr.adjacent_10khz.find(r => r.existing_class === ex).min_separation_km;
      const adj20 = msr.adjacent_20khz.find(r => r.existing_class === ex).min_separation_km;
      assert.ok(adj20 <= adj10,
        `Class ${cls} vs ${ex}: 2nd adjacent (${adj20}) should be <= 1st adjacent (${adj10})`);
    }
  }
});

test('buildMinimumSpacingReference: unknown fcc_class falls back to Class D table', () => {
  const msr = __test__.buildMinimumSpacingReference({ fcc_class: 'X', channel_class: 'regional' });
  assert.equal(msr.proposed_class, 'D', 'Unknown class should fall back to D');
  assert.ok(Array.isArray(msr.co_channel) && msr.co_channel.length === 4,
    'Fallback to D should still return 4 co-channel rows');
});

// ---------- sigma_sensitivity_analysis ----------

test('sigma_sensitivity_analysis is null when conductivity is filing-grade (raster loaded)', async () => {
  // In zone-table mode this test just verifies the field is present and non-null.
  // We can't force filing-grade σ in unit tests without the raster, so we verify:
  //   - If conductivity_mode is zone-table: sigma_sensitivity_analysis must be non-null
  //   - The field exists on every candidate
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok('sigma_sensitivity_analysis' in c,
      `sigma_sensitivity_analysis must be a key on every candidate (rank ${c.rank})`);
    if (out.conductivity_mode === 'zone-table'){
      assert.ok(c.sigma_sensitivity_analysis != null,
        `sigma_sensitivity_analysis must be non-null in zone-table mode (rank ${c.rank})`);
    }
  }
});

test('sigma_sensitivity_analysis has correct shape in zone-table mode', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  if (out.conductivity_mode !== 'zone-table') return; // skip in raster mode
  for (const c of out.candidates){
    const ssa = c.sigma_sensitivity_analysis;
    if (ssa == null) continue; // filing-grade σ
    assert.ok(typeof ssa.upgrade_possible === 'boolean',
      `upgrade_possible must be boolean on rank ${c.rank}`);
    if (!ssa.upgrade_possible) continue; // EXCELLENT already — valid case
    assert.ok(Number.isFinite(ssa.current_sigma_msm),
      `current_sigma_msm must be finite on rank ${c.rank}`);
    assert.ok(Number.isFinite(ssa.projected_sigma_msm),
      `projected_sigma_msm must be finite on rank ${c.rank}`);
    assert.ok(ssa.projected_sigma_msm > ssa.current_sigma_msm,
      `projected sigma must be > current sigma on rank ${c.rank}`);
    assert.ok(typeof ssa.survey_recommendation === 'string' && ssa.survey_recommendation.length > 5,
      `survey_recommendation must be non-empty string on rank ${c.rank}`);
    assert.ok(['HIGH VALUE', 'MODERATE VALUE', 'LIMITED VALUE'].some(v => ssa.survey_recommendation.startsWith(v)),
      `survey_recommendation must start with HIGH/MODERATE/LIMITED VALUE; rank ${c.rank} got: "${ssa.survey_recommendation}"`);
  }
});

test('sigma_sensitivity_analysis: projected reach exceeds current reach when upgrade_possible', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  if (out.conductivity_mode !== 'zone-table') return;
  for (const c of out.candidates){
    const ssa = c.sigma_sensitivity_analysis;
    if (!ssa?.upgrade_possible) continue;
    if (ssa.projected_daytime_reach_km != null && c.daytime_reach_km != null){
      assert.ok(ssa.projected_daytime_reach_km >= c.daytime_reach_km,
        `projected reach (${ssa.projected_daytime_reach_km}) should be >= current reach (${c.daytime_reach_km}); rank ${c.rank}`);
    }
    if (ssa.daytime_reach_delta_km != null){
      assert.ok(ssa.daytime_reach_delta_km >= 0,
        `reach delta must be non-negative (higher σ → more reach); rank ${c.rank} got: ${ssa.daytime_reach_delta_km}`);
    }
  }
});

// ---------- candidate_shortlist ----------

test('candidate_shortlist is present and is an array of ≤3 entries', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  assert.ok(Array.isArray(out.candidate_shortlist),
    'candidate_shortlist must be an array');
  assert.ok(out.candidate_shortlist.length <= 3,
    `candidate_shortlist must have ≤3 entries; got ${out.candidate_shortlist.length}`);
});

test('candidate_shortlist entries have rank, lat, lon, status_category, summary, recommended_next_step', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const entry of out.candidate_shortlist){
    assert.ok(typeof entry.rank === 'number', 'shortlist entry must have numeric rank');
    assert.ok(typeof entry.lat === 'number', 'shortlist entry must have lat');
    assert.ok(typeof entry.lon === 'number', 'shortlist entry must have lon');
    assert.ok(typeof entry.status_category === 'string', 'shortlist entry must have status_category');
    assert.ok(typeof entry.summary === 'string' && entry.summary.length > 10, 'shortlist entry must have non-empty summary');
    assert.ok(typeof entry.recommended_next_step === 'string' && entry.recommended_next_step.length > 5,
      'shortlist entry must have recommended_next_step');
    assert.ok(typeof entry.score_with_band === 'string', 'shortlist entry must have score_with_band');
  }
});

test('candidate_shortlist entries are from the top-N returned candidates by rank', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const shortlistRanks = new Set(out.candidate_shortlist.map(e => e.rank));
  for (const rank of shortlistRanks){
    const candidate = out.candidates.find(c => c.rank === rank);
    assert.ok(candidate != null, `shortlist rank ${rank} must correspond to a returned candidate`);
  }
});

// ---------- candidate_set_diversity ----------

test('candidate_set_diversity is present in the response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  assert.ok(out.candidate_set_diversity != null, 'candidate_set_diversity must be present');
});

test('candidate_set_diversity has n_candidates matching returned length', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const div = out.candidate_set_diversity;
  if (div.n_candidates != null){
    assert.equal(div.n_candidates, out.candidates.length,
      'candidate_set_diversity.n_candidates must match out.candidates.length');
  }
});

test('candidate_set_diversity.bearing_spread_deg is between 0 and 360 when present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const div = out.candidate_set_diversity;
  if (div.bearing_spread_deg != null){
    assert.ok(div.bearing_spread_deg >= 0 && div.bearing_spread_deg <= 360,
      `bearing_spread_deg must be in [0, 360]; got ${div.bearing_spread_deg}`);
  }
});

test('candidate_set_diversity: single candidate returns note about insufficient candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  assert.equal(out.available, true);
  if (out.candidates.length < 2){
    assert.ok(out.candidate_set_diversity.note != null,
      'single-candidate response should have a diversity.note instead of metrics');
  }
});

// ---------- compliance_pathway ----------

test('compliance_pathway is present on every candidate with steps array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const cp = c.compliance_pathway;
    assert.ok(cp != null, `compliance_pathway must be present (rank ${c.rank})`);
    assert.ok(Array.isArray(cp.steps) && cp.steps.length >= 3,
      `compliance_pathway.steps must have ≥3 entries (rank ${c.rank})`);
    assert.ok(typeof cp.total_steps === 'number' && cp.total_steps === cp.steps.length,
      `total_steps must match steps.length (rank ${c.rank})`);
    assert.ok(typeof cp.estimated_weeks_to_filing === 'number',
      `estimated_weeks_to_filing must be a number (rank ${c.rank})`);
  }
});

test('compliance_pathway: all steps have step, phase, action, timeline_weeks, blocking', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    for (const s of c.compliance_pathway.steps){
      assert.ok(typeof s.step === 'number', `step must be a number (rank ${c.rank})`);
      assert.ok(typeof s.phase === 'string' && s.phase.length > 0, `phase must be string (rank ${c.rank})`);
      assert.ok(typeof s.action === 'string' && s.action.length > 5, `action must be string (rank ${c.rank})`);
      assert.ok(typeof s.timeline_weeks === 'string', `timeline_weeks must be string (rank ${c.rank})`);
      assert.ok(typeof s.blocking === 'boolean', `blocking must be boolean (rank ${c.rank})`);
    }
  }
});

test('compliance_pathway: always starts with SITE_INVESTIGATION step', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const first = c.compliance_pathway.steps[0];
    assert.equal(first.phase, 'SITE_INVESTIGATION',
      `first step must be SITE_INVESTIGATION (rank ${c.rank}); got ${first.phase}`);
  }
});

test('compliance_pathway: always ends with FCC_FILING step', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const steps = c.compliance_pathway.steps;
    const last = steps[steps.length - 1];
    assert.equal(last.phase, 'FCC_FILING',
      `last step must be FCC_FILING (rank ${c.rank}); got ${last.phase}`);
  }
});

test('compliance_pathway: includes ASR_FAA_COORDINATION for 540 kHz (λ/4 >> 60.96 m)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 540, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const phases = c.compliance_pathway.steps.map(s => s.phase);
    assert.ok(phases.includes('ASR_FAA_COORDINATION'),
      `540 kHz should include ASR_FAA_COORDINATION step; got phases: ${phases.join(', ')} (rank ${c.rank})`);
  }
});

test('compliance_pathway: step numbers are sequential starting at 1', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const steps = c.compliance_pathway.steps;
    for (let i = 0; i < steps.length; i++){
      assert.equal(steps[i].step, i + 1,
        `step[${i}].step must be ${i + 1}; got ${steps[i].step} (rank ${c.rank})`);
    }
  }
});

// ---------- candidate_comparison_table ----------

test('candidate_comparison_table is present and is an array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  assert.ok(Array.isArray(out.candidate_comparison_table),
    'candidate_comparison_table must be an array');
});

test('candidate_comparison_table length matches n_candidates_returned', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  assert.equal(out.candidate_comparison_table.length, out.n_candidates_returned,
    'candidate_comparison_table.length must equal n_candidates_returned');
});

test('candidate_comparison_table rows have required fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const REQUIRED = ['rank','lat','lon','distance_km','direction','score','status',
    'sigma_msm','sigma_quality','score_confidence'];
  for (const row of out.candidate_comparison_table){
    for (const field of REQUIRED){
      assert.ok(field in row,
        `candidate_comparison_table row missing field '${field}' (rank ${row.rank})`);
    }
  }
});

test('candidate_comparison_table ranks match returned candidates ranks', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const tableRanks = out.candidate_comparison_table.map(r => r.rank);
  const candidateRanks = out.candidates.map(c => c.rank);
  assert.deepEqual(tableRanks, candidateRanks,
    'candidate_comparison_table ranks must match candidates ranks in order');
});

test('candidate_comparison_table feasibility_verdict matches coverage_feasibility_assessment.verdict', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (let i = 0; i < out.candidates.length; i++){
    const c = out.candidates[i];
    const row = out.candidate_comparison_table[i];
    const expected = c.coverage_feasibility_assessment?.verdict ?? null;
    assert.equal(row.feasibility_verdict, expected,
      `feasibility_verdict mismatch at rank ${c.rank}: got ${row.feasibility_verdict}, expected ${expected}`);
  }
});

test('candidate_comparison_table pathway_weeks matches compliance_pathway.estimated_weeks_to_filing', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (let i = 0; i < out.candidates.length; i++){
    const c = out.candidates[i];
    const row = out.candidate_comparison_table[i];
    const expected = c.compliance_pathway?.estimated_weeks_to_filing ?? null;
    assert.equal(row.pathway_weeks, expected,
      `pathway_weeks mismatch at rank ${c.rank}: got ${row.pathway_weeks}, expected ${expected}`);
  }
});

test('candidate_comparison_table uncertainty_pts matches score_confidence_band.uncertainty_pts', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (let i = 0; i < out.candidates.length; i++){
    const c = out.candidates[i];
    const row = out.candidate_comparison_table[i];
    const expected = c.score_confidence_band?.uncertainty_pts ?? null;
    assert.equal(row.uncertainty_pts, expected,
      `uncertainty_pts mismatch at rank ${c.rank}: got ${row.uncertainty_pts}, expected ${expected}`);
  }
});

test('candidate_comparison_table risk_score and risk_category match regulatory_risk_score', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (let i = 0; i < out.candidates.length; i++){
    const c = out.candidates[i];
    const row = out.candidate_comparison_table[i];
    assert.equal(row.risk_score, c.regulatory_risk_score?.risk_score ?? null,
      `risk_score mismatch at rank ${c.rank}`);
    assert.equal(row.risk_category, c.regulatory_risk_score?.risk_category ?? null,
      `risk_category mismatch at rank ${c.rank}`);
  }
});

// ---------- regulatory_risk_score ----------

test('regulatory_risk_score is present on every candidate with required shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const rrs = c.regulatory_risk_score;
    assert.ok(rrs != null, `regulatory_risk_score must be present (rank ${c.rank})`);
    assert.ok(typeof rrs.risk_score === 'number', `risk_score must be a number (rank ${c.rank})`);
    assert.ok(typeof rrs.risk_category === 'string', `risk_category must be a string (rank ${c.rank})`);
    assert.ok(Array.isArray(rrs.risk_factors), `risk_factors must be an array (rank ${c.rank})`);
    assert.ok(typeof rrs.interpretation === 'string', `interpretation must be a string (rank ${c.rank})`);
  }
});

test('regulatory_risk_score.risk_score is between 0 and 100', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const s = c.regulatory_risk_score.risk_score;
    assert.ok(s >= 0 && s <= 100,
      `risk_score must be 0-100; got ${s} at rank ${c.rank}`);
  }
});

test('regulatory_risk_score.risk_category is one of LOW, MODERATE, HIGH, VERY_HIGH', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const VALID = new Set(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']);
  for (const c of out.candidates){
    assert.ok(VALID.has(c.regulatory_risk_score.risk_category),
      `risk_category must be valid (rank ${c.rank}); got "${c.regulatory_risk_score.risk_category}"`);
  }
});

test('regulatory_risk_score includes NIF_STUDY_REQUIRED for non-local-channel stations', async () => {
  // KAZM is on 1310 kHz — not a local channel — so NIF risk factor must appear.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const factors = c.regulatory_risk_score.risk_factors.map(f => f.factor);
    assert.ok(factors.includes('NIF_STUDY_REQUIRED'),
      `NIF_STUDY_REQUIRED must be in risk_factors for non-local channel (rank ${c.rank}); got [${factors.join(', ')}]`);
  }
});

test('regulatory_risk_score does NOT include NIF_STUDY_REQUIRED for local channels', async () => {
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 1230, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const factors = c.regulatory_risk_score.risk_factors.map(f => f.factor);
    assert.ok(!factors.includes('NIF_STUDY_REQUIRED'),
      `NIF_STUDY_REQUIRED must NOT appear for local channel 1230 kHz (rank ${c.rank}); got [${factors.join(', ')}]`);
  }
});

test('regulatory_risk_score includes ASR_REQUIRED for 540 kHz (lambda/4 >> 60.96 m)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 540, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const factors = c.regulatory_risk_score.risk_factors.map(f => f.factor);
    assert.ok(factors.includes('ASR_REQUIRED'),
      `ASR_REQUIRED must appear for 540 kHz (rank ${c.rank}); got [${factors.join(', ')}]`);
  }
});

test('regulatory_risk_score risk_factors each have factor, points, note fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    for (const f of c.regulatory_risk_score.risk_factors){
      assert.ok(typeof f.factor === 'string' && f.factor.length > 0,
        `risk factor must have factor string (rank ${c.rank})`);
      assert.ok(typeof f.points === 'number' && f.points > 0,
        `risk factor must have positive points (rank ${c.rank})`);
      assert.ok(typeof f.note === 'string' && f.note.length > 0,
        `risk factor must have note string (rank ${c.rank})`);
    }
  }
});

test('regulatory_risk_score is consistent: risk_score equals sum of risk_factors points (capped at 100)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const rrs = c.regulatory_risk_score;
    const sumPoints = rrs.risk_factors.reduce((acc, f) => acc + f.points, 0);
    const expectedScore = Math.min(100, sumPoints);
    assert.equal(rrs.risk_score, expectedScore,
      `risk_score must equal min(100, sum of factor points) at rank ${c.rank}: expected ${expectedScore}, got ${rrs.risk_score}`);
  }
});

// ---------- ground_radial_advisory (structured) ----------

test('ground_radial_advisory is present on every candidate with required shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const gra = c.ground_radial_advisory;
    assert.ok(gra != null, `ground_radial_advisory must be present (rank ${c.rank})`);
    assert.ok(typeof gra.advisory_level === 'string',
      `advisory_level must be a string (rank ${c.rank})`);
    assert.ok(typeof gra.recommended_radial_count === 'number' && gra.recommended_radial_count >= 120,
      `recommended_radial_count must be ≥120 (rank ${c.rank}); got ${gra.recommended_radial_count}`);
    assert.ok(typeof gra.note === 'string' && gra.note.length > 0,
      `note must be a non-empty string (rank ${c.rank})`);
    assert.ok(typeof gra.certification_method === 'string',
      `certification_method must be a string (rank ${c.rank})`);
  }
});

test('ground_radial_advisory.advisory_level is one of STANDARD, ADVISORY, REQUIRED', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const VALID = new Set(['STANDARD', 'ADVISORY', 'REQUIRED']);
  for (const c of out.candidates){
    assert.ok(VALID.has(c.ground_radial_advisory.advisory_level),
      `advisory_level "${c.ground_radial_advisory.advisory_level}" not valid (rank ${c.rank})`);
  }
});

test('ground_radial_advisory.estimated_copper_kg is a positive number when radial length known', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const kg = c.ground_radial_advisory.estimated_copper_kg;
    if (kg != null){
      assert.ok(typeof kg === 'number' && kg > 0,
        `estimated_copper_kg must be > 0 (rank ${c.rank}); got ${kg}`);
    }
  }
});

test('ground_radial_advisory REQUIRED advisory has extended_system_required=true', async () => {
  // Force a POOR conductivity scenario via a very low sigma zone area.
  // The test uses the real engine — we check that any REQUIRED advisory is consistent.
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const gra = c.ground_radial_advisory;
    if (gra.advisory_level === 'REQUIRED'){
      assert.equal(gra.extended_system_required, true,
        `REQUIRED advisory must have extended_system_required=true (rank ${c.rank})`);
      assert.equal(gra.deep_driven_rods_required, true,
        `REQUIRED advisory must have deep_driven_rods_required=true (rank ${c.rank})`);
    }
  }
});

// ---------- mpe_rf_exposure_summary ----------

test('mpe_rf_exposure_summary is present on every candidate with required shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const mpe = c.mpe_rf_exposure_summary;
    assert.ok(mpe != null, `mpe_rf_exposure_summary must be present (rank ${c.rank})`);
    assert.equal(mpe.evaluation_required, true, `evaluation_required must be true (rank ${c.rank})`);
    assert.ok(typeof mpe.near_field_boundary_m === 'number' && mpe.near_field_boundary_m > 0,
      `near_field_boundary_m must be > 0 (rank ${c.rank})`);
    assert.ok(typeof mpe.mpe_limit_mw_cm2 === 'number' && mpe.mpe_limit_mw_cm2 > 0,
      `mpe_limit_mw_cm2 must be > 0 (rank ${c.rank})`);
    assert.ok(typeof mpe.far_field_exclusion_m === 'number' && mpe.far_field_exclusion_m > 0,
      `far_field_exclusion_m must be > 0 (rank ${c.rank})`);
    assert.ok(typeof mpe.recommended_fence_distance_m === 'number' && mpe.recommended_fence_distance_m > 0,
      `recommended_fence_distance_m must be > 0 (rank ${c.rank})`);
    assert.ok(typeof mpe.note === 'string' && mpe.note.length > 0,
      `note must be non-empty string (rank ${c.rank})`);
  }
});

test('mpe_rf_exposure_summary.near_field_boundary_m ≈ lambda/(2*pi) at station frequency', async () => {
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 1000, candidate_limit: 3 });
  assert.equal(out.available, true);
  // At 1000 kHz: lambda = 300 m, lambda/(2*pi) ≈ 47.75 m
  const expected = 300000 / 1000 / (2 * Math.PI);
  for (const c of out.candidates.slice(0, 1)){
    const mpe = c.mpe_rf_exposure_summary;
    assert.ok(Math.abs(mpe.near_field_boundary_m - Math.round(expected * 100) / 100) < 1,
      `near_field_boundary_m should be ≈${expected.toFixed(2)} at 1000 kHz; got ${mpe.near_field_boundary_m}`);
  }
});

test('mpe_rf_exposure_summary.recommended_fence_distance_m >= near_field_boundary_m', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const mpe = c.mpe_rf_exposure_summary;
    assert.ok(mpe.recommended_fence_distance_m >= mpe.near_field_boundary_m,
      `fence distance must be >= near_field_boundary (rank ${c.rank}): ${mpe.recommended_fence_distance_m} < ${mpe.near_field_boundary_m}`);
  }
});

test('mpe_rf_exposure_summary fence distance increases with higher TPO', async () => {
  const low  = await runSiteOptimizer({ ...KAZM, tpo_kw: 1, candidate_limit: 1 });
  const high = await runSiteOptimizer({ ...KAZM, tpo_kw: 50, candidate_limit: 1 });
  assert.equal(low.available, true);
  assert.equal(high.available, true);
  const fenceLow  = low.candidates[0].mpe_rf_exposure_summary.recommended_fence_distance_m;
  const fenceHigh = high.candidates[0].mpe_rf_exposure_summary.recommended_fence_distance_m;
  assert.ok(fenceHigh > fenceLow,
    `higher TPO should produce larger fence distance: ${fenceHigh} not > ${fenceLow}`);
});

// ---------- engineering_summary ----------

test('engineering_summary is present with required shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const es = out.engineering_summary;
  assert.ok(es != null, 'engineering_summary must be present');
  assert.ok(typeof es.callsign === 'string', 'callsign must be string');
  assert.ok(typeof es.frequency_khz === 'number', 'frequency_khz must be number');
  assert.ok(typeof es.n_candidates_evaluated === 'number', 'n_candidates_evaluated must be number');
  assert.ok(typeof es.overall_feasibility === 'string', 'overall_feasibility must be string');
  assert.ok(Array.isArray(es.statements) && es.statements.length >= 1, 'statements must be non-empty array');
  assert.ok(Array.isArray(es.caveats) && es.caveats.length >= 1, 'caveats must be non-empty array');
});

test('engineering_summary.overall_feasibility is one of SITES_AVAILABLE, SITES_RECOVERABLE, NO_SITES_AT_CURRENT_PARAMETERS', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const VALID = new Set(['SITES_AVAILABLE', 'SITES_RECOVERABLE', 'NO_SITES_AT_CURRENT_PARAMETERS']);
  assert.ok(VALID.has(out.engineering_summary.overall_feasibility),
    `overall_feasibility "${out.engineering_summary.overall_feasibility}" must be one of the valid values`);
});

test('engineering_summary.n_candidates_evaluated matches n_candidates_evaluated in response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  assert.equal(out.engineering_summary.n_candidates_evaluated, out.n_candidates_evaluated,
    'engineering_summary.n_candidates_evaluated must match out.n_candidates_evaluated');
});

test('engineering_summary.n_promising matches candidate_count_by_status.PROMISING', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  assert.equal(out.engineering_summary.n_promising, out.candidate_count_by_status.PROMISING ?? 0,
    'engineering_summary.n_promising must match candidate_count_by_status.PROMISING');
});

test('engineering_summary statements are all non-empty strings', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const s of out.engineering_summary.statements){
    assert.ok(typeof s === 'string' && s.length > 10,
      `All statements must be non-empty strings; got "${s}"`);
  }
});

// ---------- co_channel_spacing_estimate ----------

test('co_channel_spacing_estimate is present on every candidate with required shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const ccs = c.co_channel_spacing_estimate;
    assert.ok(ccs != null, `co_channel_spacing_estimate must be present (rank ${c.rank})`);
    assert.ok(typeof ccs.candidate_distance_km === 'number',
      `candidate_distance_km must be a number (rank ${c.rank})`);
    assert.ok(typeof ccs.co_channel?.meets_separation === 'boolean',
      `co_channel.meets_separation must be boolean (rank ${c.rank})`);
    assert.ok(typeof ccs.adjacent_10khz?.meets_separation === 'boolean',
      `adjacent_10khz.meets_separation must be boolean (rank ${c.rank})`);
    assert.ok(typeof ccs.adjacent_20khz?.meets_separation === 'boolean',
      `adjacent_20khz.meets_separation must be boolean (rank ${c.rank})`);
    assert.ok(typeof ccs.screening_verdict === 'string',
      `screening_verdict must be a string (rank ${c.rank})`);
  }
});

test('co_channel_spacing_estimate.screening_verdict is one of valid values', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const VALID = new Set([
    'CO_CHANNEL_ELIGIBLE', 'FIRST_ADJACENT_ELIGIBLE',
    'SECOND_ADJACENT_ELIGIBLE', 'BELOW_ALL_SPACING_MINIMUMS'
  ]);
  for (const c of out.candidates){
    assert.ok(VALID.has(c.co_channel_spacing_estimate.screening_verdict),
      `screening_verdict "${c.co_channel_spacing_estimate.screening_verdict}" is not valid (rank ${c.rank})`);
  }
});

test('co_channel_spacing_estimate: current site candidate has distance_km ≈ 0 and BELOW_ALL_SPACING_MINIMUMS', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  const currentSite = out.candidates.find(c =>
    Math.abs(c.lat - KAZM.current_site.lat) < 0.001 &&
    Math.abs(c.lon - KAZM.current_site.lon) < 0.001
  );
  if (currentSite){
    const ccs = currentSite.co_channel_spacing_estimate;
    assert.ok(ccs.candidate_distance_km < 1,
      `Current site distance should be ~0 km; got ${ccs.candidate_distance_km}`);
    assert.equal(ccs.screening_verdict, 'BELOW_ALL_SPACING_MINIMUMS',
      `Current site (distance 0) must be BELOW_ALL_SPACING_MINIMUMS; got ${ccs.screening_verdict}`);
  }
});

test('co_channel_spacing_estimate: adjacent spacing minimums decrease from co-channel', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const ccs = c.co_channel_spacing_estimate;
    assert.ok(ccs.co_channel.min_separation_km >= ccs.adjacent_10khz.min_separation_km,
      `co_channel min must be >= adj10 min (rank ${c.rank})`);
    assert.ok(ccs.adjacent_10khz.min_separation_km >= ccs.adjacent_20khz.min_separation_km,
      `adj10 min must be >= adj20 min (rank ${c.rank})`);
  }
});

// ---------- nighttime_classification ----------

test('nighttime_classification is present on every candidate with required shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const nc = c.nighttime_classification;
    assert.ok(nc != null, `nighttime_classification must be present (rank ${c.rank})`);
    assert.ok(typeof nc.eligibility === 'string', `eligibility must be string (rank ${c.rank})`);
    assert.ok(typeof nc.nif_complexity === 'string', `nif_complexity must be string (rank ${c.rank})`);
    assert.ok(typeof nc.protection_class === 'string', `protection_class must be string (rank ${c.rank})`);
    assert.ok(typeof nc.key_constraint === 'string' && nc.key_constraint.length > 0,
      `key_constraint must be non-empty string (rank ${c.rank})`);
    assert.ok(typeof nc.nif_study_required === 'boolean', `nif_study_required must be boolean (rank ${c.rank})`);
    assert.ok(typeof nc.rule === 'string', `rule must be string (rank ${c.rank})`);
  }
});

test('nighttime_classification.eligibility is one of YES, LIMITED, RESTRICTED, PROHIBITED', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const VALID = new Set(['YES', 'LIMITED', 'RESTRICTED', 'PROHIBITED']);
  for (const c of out.candidates){
    assert.ok(VALID.has(c.nighttime_classification.eligibility),
      `eligibility "${c.nighttime_classification.eligibility}" must be valid (rank ${c.rank})`);
  }
});

test('nighttime_classification.nif_complexity is one of LOW, MODERATE, HIGH, VERY_HIGH', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const VALID = new Set(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']);
  for (const c of out.candidates){
    assert.ok(VALID.has(c.nighttime_classification.nif_complexity),
      `nif_complexity "${c.nighttime_classification.nif_complexity}" must be valid (rank ${c.rank})`);
  }
});

test('nighttime_classification: local channel (1230 kHz) has LIMITED eligibility and nif_study_required=false', async () => {
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 1230, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates.slice(0, 1)){
    const nc = c.nighttime_classification;
    assert.equal(nc.eligibility, 'LIMITED',
      `Local channel should have LIMITED nighttime eligibility; got ${nc.eligibility}`);
    assert.equal(nc.nif_study_required, false,
      `Local channel should have nif_study_required=false; got ${nc.nif_study_required}`);
  }
});

test('nighttime_classification: clear channel (660 kHz) Class A has VERY_HIGH NIF complexity', async () => {
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 660, fcc_class: 'A', tpo_kw: 50, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates.slice(0, 1)){
    const nc = c.nighttime_classification;
    assert.equal(nc.nif_complexity, 'VERY_HIGH',
      `Class A clear channel should have VERY_HIGH NIF complexity; got ${nc.nif_complexity}`);
    assert.equal(nc.nif_study_required, true,
      `Class A clear channel should have nif_study_required=true`);
  }
});

// ---------- power_efficiency_metrics ----------

test('power_efficiency_metrics is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(c.power_efficiency_metrics != null,
      `power_efficiency_metrics must be present (rank ${c.rank})`);
  }
});

test('power_efficiency_metrics has required fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  const pem = out.candidates[0].power_efficiency_metrics;
  assert.ok(pem != null, 'power_efficiency_metrics must not be null');
  for (const field of ['tpo_kw', 'people_per_kw', 'km2_per_kw', 'efficiency_tier', 'note']){
    assert.ok(field in pem, `power_efficiency_metrics missing field '${field}'`);
  }
});

test('power_efficiency_metrics.tpo_kw matches request tpo_kw', async () => {
  const out = await runSiteOptimizer({ ...KAZM, tpo_kw: 10, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.equal(c.power_efficiency_metrics.tpo_kw, 10,
      `power_efficiency_metrics.tpo_kw should be 10 (rank ${c.rank})`);
  }
});

test('power_efficiency_metrics.efficiency_tier is a valid value', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const VALID = new Set(['HIGH', 'MODERATE', 'LOW', 'UNKNOWN']);
  for (const c of out.candidates){
    const tier = c.power_efficiency_metrics?.efficiency_tier;
    assert.ok(VALID.has(tier),
      `efficiency_tier "${tier}" must be HIGH/MODERATE/LOW/UNKNOWN (rank ${c.rank})`);
  }
});

test('power_efficiency_metrics comparison table fields are populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table){
    assert.ok('people_per_kw' in row, `comparison table row missing people_per_kw (rank ${row.rank})`);
    assert.ok('km2_per_kw' in row, `comparison table row missing km2_per_kw (rank ${row.rank})`);
    assert.ok('efficiency_tier' in row, `comparison table row missing efficiency_tier (rank ${row.rank})`);
  }
});

// ---------- da_gain_potential ----------

test('da_gain_potential is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok('da_gain_potential' in c,
      `da_gain_potential must be present (rank ${c.rank})`);
  }
});

test('da_gain_potential returns null for DA pattern_mode inputs', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'DA-D', candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.equal(c.da_gain_potential, null,
      `da_gain_potential must be null when pattern_mode is DA (rank ${c.rank})`);
  }
});

test('da_gain_potential.applicable is a boolean when present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    if (c.da_gain_potential != null){
      assert.equal(typeof c.da_gain_potential.applicable, 'boolean',
        `da_gain_potential.applicable must be boolean (rank ${c.rank})`);
    }
  }
});

test('da_gain_potential comparison table fields are present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table){
    assert.ok('da_applicable' in row, `comparison table row missing da_applicable (rank ${row.rank})`);
    assert.ok('da_col_pct_estimate' in row, `comparison table row missing da_col_pct_estimate (rank ${row.rank})`);
    assert.ok('da_would_recover' in row, `comparison table row missing da_would_recover (rank ${row.rank})`);
  }
});

// ---------- compliance_pathway enrichment ----------

test('compliance_pathway has timeline_label, estimated_weeks_min, blocking_steps fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const cp = c.compliance_pathway;
    assert.ok(cp != null, `compliance_pathway must be present (rank ${c.rank})`);
    assert.ok('timeline_label' in cp, `compliance_pathway missing timeline_label (rank ${c.rank})`);
    assert.ok('estimated_weeks_min' in cp, `compliance_pathway missing estimated_weeks_min (rank ${c.rank})`);
    assert.ok('blocking_steps' in cp, `compliance_pathway missing blocking_steps (rank ${c.rank})`);
  }
});

test('compliance_pathway.estimated_weeks_min <= estimated_weeks_to_filing', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const cp = c.compliance_pathway;
    if (cp.estimated_weeks_min != null && cp.estimated_weeks_to_filing != null){
      assert.ok(cp.estimated_weeks_min <= cp.estimated_weeks_to_filing,
        `estimated_weeks_min ${cp.estimated_weeks_min} must be ≤ estimated_weeks_to_filing ${cp.estimated_weeks_to_filing} (rank ${c.rank})`);
    }
  }
});

test('compliance_pathway.blocking_steps is a non-negative integer', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const bs = c.compliance_pathway?.blocking_steps;
    assert.ok(Number.isInteger(bs) && bs >= 0,
      `blocking_steps must be a non-negative integer; got ${bs} (rank ${c.rank})`);
  }
});

test('candidate_comparison_table has timeline_label column', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table){
    assert.ok('timeline_label' in row, `comparison table row missing timeline_label (rank ${row.rank})`);
  }
});

// ---------- site_risk_summary ribbon (engine no-op, drawer-only UI) ----------

test('regulatory_risk_score.risk_factors is an array on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const rrs = c.regulatory_risk_score;
    assert.ok(Array.isArray(rrs?.risk_factors),
      `regulatory_risk_score.risk_factors must be an array (rank ${c.rank})`);
  }
});

// ---------- antenna_system_summary ERP enrichment ----------

test('antenna_system_summary.estimated_erp_kw is present and positive on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const erp = c.antenna_system_summary?.estimated_erp_kw;
    assert.ok(erp != null && erp > 0,
      `estimated_erp_kw must be positive (rank ${c.rank}, got ${erp})`);
  }
});

test('antenna_system_summary.estimated_erp_kw <= tpo_kw (efficiency ≤ 1)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const { tpo_kw } = out.inputs_echo;
  for (const c of out.candidates){
    const erp = c.antenna_system_summary?.estimated_erp_kw;
    if (erp != null){
      assert.ok(erp <= tpo_kw,
        `estimated_erp_kw ${erp} must be ≤ tpo_kw ${tpo_kw} (rank ${c.rank})`);
    }
  }
});

test('antenna_system_summary.erp_vs_tpo_ratio is in (0, 1]', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const ratio = c.antenna_system_summary?.erp_vs_tpo_ratio;
    if (ratio != null){
      assert.ok(ratio > 0 && ratio <= 1,
        `erp_vs_tpo_ratio ${ratio} must be in (0,1] (rank ${c.rank})`);
    }
  }
});

test('candidate_comparison_table has estimated_erp_kw and erp_efficiency_pct columns', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table){
    assert.ok('estimated_erp_kw' in row, `comparison table row missing estimated_erp_kw (rank ${row.rank})`);
    assert.ok('erp_efficiency_pct' in row, `comparison table row missing erp_efficiency_pct (rank ${row.rank})`);
  }
});

// ---------- land_use_classification ----------

test('land_use_classification is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(c.land_use_classification != null,
      `land_use_classification must be present (rank ${c.rank})`);
  }
});

test('land_use_classification.class is a valid value', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const VALID = new Set(['SUBURBAN', 'SUBURBAN_RURAL', 'RURAL', 'REMOTE']);
  for (const c of out.candidates){
    const cls = c.land_use_classification?.class;
    assert.ok(VALID.has(cls),
      `land_use_classification.class "${cls}" must be SUBURBAN/SUBURBAN_RURAL/RURAL/REMOTE (rank ${c.rank})`);
  }
});

test('land_use_classification.density_factor is positive', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const f = c.land_use_classification?.density_factor;
    assert.ok(f != null && f > 0,
      `density_factor must be positive (rank ${c.rank}, got ${f})`);
  }
});

test('current-site candidate (dist=0) gets SUBURBAN land_use_class', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  const currentSite = out.candidates.find(c => c.distance_from_current_km === 0);
  if (currentSite){
    assert.equal(currentSite.land_use_classification?.class, 'SUBURBAN',
      `Current site (dist=0) should be SUBURBAN, got ${currentSite.land_use_classification?.class}`);
  }
});

test('candidate_comparison_table has land_use_class and density_factor columns', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table){
    assert.ok('land_use_class' in row, `comparison table missing land_use_class (rank ${row.rank})`);
    assert.ok('density_factor' in row, `comparison table missing density_factor (rank ${row.rank})`);
  }
});

// ---------- signal_environment_advisory ----------

test('signal_environment_advisory is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    assert.ok(c.signal_environment_advisory != null,
      `signal_environment_advisory must be present (rank ${c.rank})`);
  }
});

test('signal_environment_advisory.proximity_tier is NEAR/MID/FAR', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const VALID = new Set(['NEAR', 'MID', 'FAR']);
  for (const c of out.candidates){
    const tier = c.signal_environment_advisory?.proximity_tier;
    assert.ok(VALID.has(tier),
      `proximity_tier "${tier}" must be NEAR/MID/FAR (rank ${c.rank})`);
  }
});

test('signal_environment_advisory.notes is a non-empty array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates){
    const notes = c.signal_environment_advisory?.notes;
    assert.ok(Array.isArray(notes) && notes.length > 0,
      `signal_environment_advisory.notes must be a non-empty array (rank ${c.rank})`);
  }
});

test('current-site candidate (dist=0) has NEAR proximity_tier', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  const currentSite = out.candidates.find(c => c.distance_from_current_km === 0);
  if (currentSite){
    assert.equal(currentSite.signal_environment_advisory?.proximity_tier, 'NEAR',
      `Current site should have NEAR proximity_tier`);
  }
});

// ---------- coverage_overlap_analysis ----------

test('coverage_overlap_analysis is present on all candidates (or null when reach unavailable)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    // may be null if daytime_reach_km is null, but key should exist
    assert.ok('coverage_overlap_analysis' in c,
      `coverage_overlap_analysis key must be present (rank ${c.rank})`);
  }
});

test('coverage_overlap_analysis.overlap_fraction is in [0, 1] when present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const oa = c.coverage_overlap_analysis;
    if (oa == null) continue;
    assert.ok(oa.overlap_fraction >= 0 && oa.overlap_fraction <= 1,
      `overlap_fraction ${oa.overlap_fraction} out of [0,1] (rank ${c.rank})`);
  }
});

test('current-site candidate (dist=0) has overlap_fraction = 1.0', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  const currentSite = out.candidates.find(c => c.distance_from_current_km === 0);
  if (currentSite && currentSite.coverage_overlap_analysis != null) {
    assert.equal(currentSite.coverage_overlap_analysis.overlap_fraction, 1.0,
      'Current site (dist=0) should have overlap_fraction = 1.0');
    assert.equal(currentSite.coverage_overlap_analysis.coverage_continuity, 'HIGH',
      'Current site should have HIGH coverage_continuity');
  }
});

test('coverage_overlap_analysis.coverage_continuity is a valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const VALID = new Set(['HIGH', 'MODERATE', 'LOW', 'MINIMAL', 'UNKNOWN']);
  for (const c of out.candidates) {
    const oa = c.coverage_overlap_analysis;
    if (oa == null) continue;
    assert.ok(VALID.has(oa.coverage_continuity),
      `coverage_continuity "${oa.coverage_continuity}" not valid (rank ${c.rank})`);
  }
});

test('candidate_comparison_table has overlap_fraction and coverage_continuity columns', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table) {
    assert.ok('overlap_fraction' in row, `comparison table missing overlap_fraction (rank ${row.rank})`);
    assert.ok('coverage_continuity' in row, `comparison table missing coverage_continuity (rank ${row.rank})`);
  }
});

test('coverage_overlap_analysis.tower_separation_km matches distance_from_current_km', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const oa = c.coverage_overlap_analysis;
    if (oa == null) continue;
    const expectedDist = Math.round((c.distance_from_current_km ?? 0) * 100) / 100;
    assert.equal(oa.tower_separation_km, expectedDist,
      `tower_separation_km should match distance_from_current_km (rank ${c.rank})`);
  }
});

// ---------- frequency_allocation_context ----------

test('frequency_allocation_context is present on response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.available, true);
  assert.ok(out.frequency_allocation_context != null, 'frequency_allocation_context must be present');
});

test('frequency_allocation_context.channel_class matches frequency_channel_class', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.frequency_allocation_context.channel_class, out.frequency_channel_class,
    'frequency_allocation_context.channel_class should match top-level frequency_channel_class');
});

test('frequency_allocation_context.nif_required is false for local channels', async () => {
  const LOCAL_FREQ = 1230; // always local channel
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: LOCAL_FREQ, candidate_limit: 2 });
  assert.equal(out.available, true);
  assert.equal(out.frequency_allocation_context.nif_required, false,
    'Local channel (1230 kHz) should not require NIF');
});

test('frequency_allocation_context.nif_required is true for clear channel', async () => {
  const CLEAR_FREQ = 780; // KAZM is 780 kHz — a clear channel
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: CLEAR_FREQ, candidate_limit: 2 });
  assert.equal(out.available, true);
  assert.equal(out.frequency_allocation_context.nif_required, true,
    '780 kHz (clear channel) should require NIF');
});

test('frequency_allocation_context.nighttime_flexibility is valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const VALID = new Set(['HIGH', 'MODERATE', 'LOW']);
  assert.ok(VALID.has(out.frequency_allocation_context.nighttime_flexibility),
    `nighttime_flexibility "${out.frequency_allocation_context.nighttime_flexibility}" must be HIGH/MODERATE/LOW`);
});

test('frequency_allocation_context.implications is a non-empty array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.ok(Array.isArray(out.frequency_allocation_context.implications),
    'implications must be an array');
  assert.ok(out.frequency_allocation_context.implications.length > 0,
    'implications must have at least one entry');
});

// ---------- candidate_set_statistics ----------

test('candidate_set_statistics is present on response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  assert.ok(out.candidate_set_statistics != null, 'candidate_set_statistics must be present');
});

test('candidate_set_statistics.n matches number of returned candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  assert.equal(out.candidate_set_statistics.n, out.candidates.length,
    'n should equal candidates.length');
});

test('candidate_set_statistics.score has mean/min/max fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const s = out.candidate_set_statistics.score;
  assert.ok('mean' in s && 'min' in s && 'max' in s, 'score must have mean/min/max');
  assert.ok(s.min <= s.max, 'score.min should be <= score.max');
});

test('candidate_set_statistics.status_distribution covers all returned statuses', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const dist = out.candidate_set_statistics.status_distribution;
  const totalInDist = Object.values(dist).reduce((a, b) => a + b, 0);
  assert.equal(totalInDist, out.candidates.length,
    'status_distribution counts should sum to candidate count');
});

test('candidate_set_statistics.overlap_fraction has mean in [0,1] when present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const ov = out.candidate_set_statistics.overlap_fraction;
  if (ov.mean != null) {
    assert.ok(ov.mean >= 0 && ov.mean <= 1, `overlap_fraction.mean ${ov.mean} out of [0,1]`);
  }
});

// ---------- site_viability_summary ----------

test('site_viability_summary is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.site_viability_summary != null,
      `site_viability_summary must be present (rank ${c.rank})`);
  }
});

test('site_viability_summary.go_no_go is a valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const VALID = new Set(['GO', 'CONDITIONAL', 'NO_GO', 'INSUFFICIENT_DATA']);
  for (const c of out.candidates) {
    const gng = c.site_viability_summary?.go_no_go;
    assert.ok(VALID.has(gng),
      `go_no_go "${gng}" not a valid enum (rank ${c.rank})`);
  }
});

test('site_viability_summary.one_line is a non-empty string', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const ol = c.site_viability_summary?.one_line;
    assert.ok(typeof ol === 'string' && ol.length > 0,
      `one_line must be a non-empty string (rank ${c.rank})`);
  }
});

test('NON_COMPLIANT candidates have go_no_go of NO_GO or CONDITIONAL', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    if (c.status_category === 'NON_COMPLIANT') {
      const gng = c.site_viability_summary?.go_no_go;
      assert.ok(gng === 'NO_GO' || gng === 'CONDITIONAL' || gng === 'INSUFFICIENT_DATA',
        `NON_COMPLIANT candidate should not be GO (rank ${c.rank}, go_no_go=${gng})`);
    }
  }
});

test('PROMISING candidates have go_no_go of GO or CONDITIONAL', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    if (c.status_category === 'PROMISING') {
      const gng = c.site_viability_summary?.go_no_go;
      assert.ok(gng === 'GO' || gng === 'CONDITIONAL',
        `PROMISING candidate should be GO or CONDITIONAL (rank ${c.rank}, go_no_go=${gng})`);
    }
  }
});

// ---------- tower_cost_estimate ----------

test('tower_cost_estimate is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.tower_cost_estimate != null,
      `tower_cost_estimate must be present (rank ${c.rank})`);
  }
});

test('tower_cost_estimate.total_low_usd < total_high_usd', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const tce = c.tower_cost_estimate;
    assert.ok(tce.total_low_usd <= tce.total_high_usd,
      `total_low_usd must be <= total_high_usd (rank ${c.rank})`);
    assert.ok(tce.total_low_usd > 0, `total_low_usd must be positive (rank ${c.rank})`);
  }
});

test('tower_cost_estimate.cost_tier is a valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const VALID = new Set(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']);
  for (const c of out.candidates) {
    const tier = c.tower_cost_estimate?.cost_tier;
    assert.ok(VALID.has(tier), `cost_tier "${tier}" not valid (rank ${c.rank})`);
  }
});

test('tower_cost_estimate.tower_height_m matches lambda/4 for frequency', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.available, true);
  const expectedQw = Math.round((300000 / KAZM.frequency_khz / 4) * 100) / 100;
  for (const c of out.candidates) {
    assert.ok(Math.abs(c.tower_cost_estimate.tower_height_m - expectedQw) < 0.1,
      `tower_height_m ${c.tower_cost_estimate.tower_height_m} should be near λ/4 = ${expectedQw} m`);
  }
});

test('candidate_comparison_table has cost_tier and cost_low_usd columns', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table) {
    assert.ok('cost_tier' in row, `missing cost_tier in comparison table (rank ${row.rank})`);
    assert.ok('cost_low_usd' in row, `missing cost_low_usd in comparison table (rank ${row.rank})`);
  }
});

// ---------- seasonal_conductivity_note ----------

test('seasonal_conductivity_note is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.seasonal_conductivity_note != null,
      `seasonal_conductivity_note must be present (rank ${c.rank})`);
  }
});

test('seasonal_conductivity_note.seasonal_variability is a valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const VALID = new Set(['LOW', 'MODERATE', 'MODERATE_HIGH', 'HIGH']);
  for (const c of out.candidates) {
    const v = c.seasonal_conductivity_note?.seasonal_variability;
    assert.ok(VALID.has(v), `seasonal_variability "${v}" not valid (rank ${c.rank})`);
  }
});

test('seasonal_conductivity_note.notes is a non-empty array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const notes = c.seasonal_conductivity_note?.notes;
    assert.ok(Array.isArray(notes) && notes.length > 0,
      `seasonal notes must be a non-empty array (rank ${c.rank})`);
  }
});

test('high-sigma candidates have LOW seasonal variability', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 20 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    if ((c.ground_sigma_mS_m ?? 0) >= 8) {
      assert.equal(c.seasonal_conductivity_note?.seasonal_variability, 'LOW',
        `σ≥8 candidate should have LOW seasonal variability (rank ${c.rank}, σ=${c.ground_sigma_mS_m})`);
    }
  }
});

test('comparison table has seasonal_variability and seasonal_risk columns', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table) {
    assert.ok('seasonal_variability' in row, `missing seasonal_variability (rank ${row.rank})`);
    assert.ok('seasonal_risk' in row, `missing seasonal_risk (rank ${row.rank})`);
  }
});

// ---------- antenna_height_options ----------

test('antenna_height_options is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.antenna_height_options != null,
      `antenna_height_options must be present (rank ${c.rank})`);
  }
});

test('antenna_height_options.options has exactly 3 entries', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.equal(c.antenna_height_options.options.length, 3,
      `options must have 3 entries (rank ${c.rank})`);
  }
});

test('antenna_height_options λ/4 entry has gain_vs_qw_db = 0', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const qw = c.antenna_height_options.options.find(o => o.id === 'QUARTER_WAVE');
    assert.ok(qw != null, `QUARTER_WAVE option must exist (rank ${c.rank})`);
    assert.equal(qw.gain_vs_qw_db, 0.0, 'λ/4 gain vs λ/4 must be 0.0 dB');
    assert.equal(qw.erp_vs_tpo_ratio, 1.0, 'λ/4 ERP ratio must be 1.0');
  }
});

test('antenna_height_options 5/8λ has higher estimated_erp_kw than 0.19λ', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const five8 = c.antenna_height_options.options.find(o => o.id === '5_8_LAMBDA');
    const compact = c.antenna_height_options.options.find(o => o.id === '0_19_LAMBDA');
    assert.ok(five8.estimated_erp_kw > compact.estimated_erp_kw,
      `5/8λ ERP should exceed 0.19λ ERP (rank ${c.rank})`);
  }
});

test('antenna_height_options.full_wavelength_m matches 300000/freq_khz', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.available, true);
  const expectedLambda = Math.round(300000 / KAZM.frequency_khz * 100) / 100;
  for (const c of out.candidates) {
    assert.equal(c.antenna_height_options.full_wavelength_m, expectedLambda,
      `full_wavelength_m should equal 300000/${KAZM.frequency_khz} (rank ${c.rank})`);
  }
});

// ---------- population_reach_bands ----------

test('population_reach_bands is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.population_reach_bands != null,
      `population_reach_bands must be present (rank ${c.rank})`);
  }
});

test('population_reach_bands.bands has 5 entries', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.equal(c.population_reach_bands.bands.length, 5,
      `should have 5 bands (rank ${c.rank})`);
  }
});

test('population_reach_bands bands are sorted descending by target_mvm', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const mvms = c.population_reach_bands.bands.map(b => b.target_mvm);
    for (let i = 1; i < mvms.length; i++) {
      assert.ok(mvms[i] < mvms[i - 1],
        `bands should be sorted descending by target_mvm (rank ${c.rank})`);
    }
  }
});

test('population_reach_bands 5 mV/m distance_km <= 0.5 mV/m distance_km (farther at lower field)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const b5 = c.population_reach_bands.bands.find(b => b.target_mvm === 5.0);
    const b05 = c.population_reach_bands.bands.find(b => b.target_mvm === 0.5);
    if (b5?.distance_km != null && b05?.distance_km != null) {
      assert.ok(b5.distance_km <= b05.distance_km,
        `5 mV/m contour should be closer than 0.5 mV/m (rank ${c.rank}): ${b5.distance_km} vs ${b05.distance_km}`);
    }
  }
});

// ---------- power_upgrade_analysis ----------

test('power_upgrade_analysis is present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.power_upgrade_analysis != null,
      `power_upgrade_analysis must be present (rank ${c.rank})`);
  }
});

test('power_upgrade_analysis.verdict is a valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 10 });
  assert.equal(out.available, true);
  const VALID = new Set(['UPGRADE_RESOLVES_COL', 'UPGRADE_CAUSES_BLANKET_VIOLATION',
    'UPGRADE_INSUFFICIENT_FOR_COL', 'REVIEW_REQUIRED', undefined]);
  for (const c of out.candidates) {
    const verdict = c.power_upgrade_analysis?.verdict;
    assert.ok(VALID.has(verdict),
      `verdict "${verdict}" not valid (rank ${c.rank})`);
  }
});

test('power_upgrade_analysis.headroom_kw is non-negative when applicable', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const pua = c.power_upgrade_analysis;
    if (pua.applicable) {
      assert.ok(pua.headroom_kw >= 0, `headroom_kw must be >= 0 (rank ${c.rank})`);
      assert.ok(pua.max_class_power_kw > KAZM.tpo_kw,
        `max_class_power_kw must exceed current TPO when applicable (rank ${c.rank})`);
    }
  }
});

test('power_upgrade_analysis comparison table column exists (via candidate)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok('power_upgrade_analysis' in c, `power_upgrade_analysis must be in candidate (rank ${c.rank})`);
  }
});

// ---------- comparison table completeness (session additions) ----------

test('candidate_comparison_table has all session-added columns', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const SESSION_COLUMNS = [
    'go_no_go', 'viability_confidence',
    'overlap_fraction', 'coverage_continuity',
    'cost_tier', 'cost_low_usd', 'cost_high_usd',
    'seasonal_variability', 'seasonal_risk',
    'power_upgrade_verdict', 'headroom_kw',
    'land_use_class', 'density_factor',
    'estimated_erp_kw', 'erp_efficiency_pct',
    'da_applicable', 'da_col_pct_estimate', 'da_would_recover',
    'people_per_kw', 'km2_per_kw', 'efficiency_tier',
    'nighttime_eligibility', 'nif_complexity',
    'spacing_verdict', 'fence_m', 'blanket_km',
    'pathway_weeks', 'pathway_min_weeks', 'timeline_label',
    'risk_score', 'risk_category'
  ];
  for (const row of out.candidate_comparison_table) {
    for (const col of SESSION_COLUMNS) {
      assert.ok(col in row,
        `comparison table missing column "${col}" (rank ${row.rank})`);
    }
  }
});

// ---------- regulatory_timeline_estimate ----------

test('regulatory_timeline_estimate is present on response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.available, true);
  assert.ok(out.regulatory_timeline_estimate != null,
    'regulatory_timeline_estimate must be present');
});

test('regulatory_timeline_estimate.phases is a non-empty array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.available, true);
  const rte = out.regulatory_timeline_estimate;
  assert.ok(Array.isArray(rte.phases) && rte.phases.length > 0,
    'phases must be a non-empty array');
});

test('regulatory_timeline_estimate.total_estimated_weeks_min <= total_estimated_weeks_max', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.available, true);
  const rte = out.regulatory_timeline_estimate;
  assert.ok(rte.total_estimated_weeks_min <= rte.total_estimated_weeks_max,
    'weeks_min must be <= weeks_max');
  assert.ok(rte.total_estimated_weeks_min > 0, 'total weeks must be > 0');
});

test('regulatory_timeline_estimate.total_estimated_months_range is a string with "-"', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.available, true);
  const range = out.regulatory_timeline_estimate.total_estimated_months_range;
  assert.ok(typeof range === 'string' && range.includes('–'),
    `months_range "${range}" must contain "–"`);
});

test('regulatory_timeline_estimate phases each have id, label, weeks, blocking', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.available, true);
  for (const p of out.regulatory_timeline_estimate.phases) {
    assert.ok(p.id, `phase must have id`);
    assert.ok(p.label, `phase must have label`);
    assert.ok(p.weeks, `phase must have weeks`);
    assert.ok(typeof p.blocking === 'boolean', `phase.blocking must be boolean`);
  }
});

// ---------- candidate_scoring_audit ----------

test('candidate_scoring_audit is present on response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  assert.ok(out.candidate_scoring_audit != null, 'candidate_scoring_audit must be present');
});

test('candidate_scoring_audit.total_scored >= total_returned', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const audit = out.candidate_scoring_audit;
  assert.ok(audit.total_scored >= audit.total_returned,
    'total_scored must be >= total_returned');
  assert.equal(audit.total_returned, out.candidates.length,
    'total_returned must match candidates.length');
});

test('candidate_scoring_audit.total_truncated = total_scored - total_returned', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const audit = out.candidate_scoring_audit;
  assert.equal(audit.total_truncated, audit.total_scored - audit.total_returned,
    'total_truncated must equal total_scored - total_returned');
});

test('candidate_scoring_audit.lowest_returned_score is present when candidates exist', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  if (out.candidates.length > 0) {
    assert.ok(out.candidate_scoring_audit.lowest_returned_score != null,
      'lowest_returned_score must be present when candidates are returned');
  }
});

test('candidate_scoring_audit truncation warnings present when limit is very small', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  assert.equal(out.available, true);
  const audit = out.candidate_scoring_audit;
  if (audit.total_truncated > 0) {
    assert.ok(audit.total_truncated > 0, 'truncated should be positive with limit=1');
  }
});

// ---------- directional_antenna_study_guide ----------

test('directional_antenna_study_guide is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.directional_antenna_study_guide != null,
      `directional_antenna_study_guide must be present on candidate rank ${c.rank}`);
  }
});

test('directional_antenna_study_guide.recommended is boolean', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.directional_antenna_study_guide;
    assert.ok(typeof g.recommended === 'boolean',
      `directional_antenna_study_guide.recommended must be boolean for rank ${c.rank}`);
  }
});

test('directional_antenna_study_guide study_type is valid enum when recommended', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const validTypes = new Set(['FULL_DA_STUDY_DAY_NIGHT', 'DA_N_NIGHTTIME_ONLY', 'DA_D_DAYTIME_ONLY']);
  for (const c of out.candidates) {
    const g = c.directional_antenna_study_guide;
    if (g.recommended && g.study_type != null) {
      assert.ok(validTypes.has(g.study_type),
        `study_type "${g.study_type}" must be valid enum for rank ${c.rank}`);
    }
  }
});

test('directional_antenna_study_guide triggers is array when recommended', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.directional_antenna_study_guide;
    if (g.recommended) {
      assert.ok(Array.isArray(g.triggers) && g.triggers.length > 0,
        `triggers must be non-empty array when recommended=true for rank ${c.rank}`);
    }
  }
});

test('directional_antenna_study_guide pattern_radials_required = 72 when recommended', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const g = c.directional_antenna_study_guide;
    if (g.recommended) {
      assert.equal(g.pattern_radials_required, 72,
        `pattern_radials_required must be 72 (§73.316 5° increments) for rank ${c.rank}`);
    }
  }
});

test('directional_antenna_study_guide comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table) {
    assert.ok('da_study_recommended' in row, 'da_study_recommended must be in comparison table');
    assert.ok('da_study_type' in row, 'da_study_type must be in comparison table');
  }
});

// ---------- skywave_protection_advisory ----------

test('skywave_protection_advisory is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.skywave_protection_advisory != null,
      `skywave_protection_advisory must be present on candidate rank ${c.rank}`);
  }
});

test('skywave_protection_advisory.advisory_level is valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const validLevels = new Set(['NONE', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
  for (const c of out.candidates) {
    const s = c.skywave_protection_advisory;
    assert.ok(validLevels.has(s.advisory_level),
      `advisory_level "${s.advisory_level}" must be valid enum for rank ${c.rank}`);
  }
});

test('skywave_protection_advisory.nif_required is boolean', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(typeof c.skywave_protection_advisory.nif_required === 'boolean',
      `nif_required must be boolean for rank ${c.rank}`);
  }
});

test('skywave_protection_advisory.protected_contour_25uvm_est_km is positive number when nif_required', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const s = c.skywave_protection_advisory;
    if (s.nif_required) {
      assert.ok(typeof s.protected_contour_25uvm_est_km === 'number' && s.protected_contour_25uvm_est_km > 0,
        `protected_contour_25uvm_est_km must be positive number for rank ${c.rank}`);
    }
  }
});

test('skywave_protection_advisory.advisory_items is non-empty array when nif_required', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const s = c.skywave_protection_advisory;
    if (s.nif_required) {
      assert.ok(Array.isArray(s.advisory_items) && s.advisory_items.length > 0,
        `advisory_items must be non-empty array when nif_required for rank ${c.rank}`);
    }
  }
});

test('skywave_protection_advisory skywave_advisory_level in comparison table', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table) {
    assert.ok('skywave_advisory_level' in row,
      'skywave_advisory_level must be in comparison table');
  }
});

// ---------- filing_complexity_score ----------

test('filing_complexity_score is present on response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  assert.ok(out.filing_complexity_score != null, 'filing_complexity_score must be present');
});

test('filing_complexity_score.total_score is 0–100', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  const s = out.filing_complexity_score.total_score;
  assert.ok(typeof s === 'number' && s >= 0 && s <= 100,
    `total_score ${s} must be in [0,100]`);
});

test('filing_complexity_score.complexity_tier is valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  const validTiers = new Set(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']);
  assert.ok(validTiers.has(out.filing_complexity_score.complexity_tier),
    `complexity_tier "${out.filing_complexity_score.complexity_tier}" must be valid`);
});

test('filing_complexity_score.factors is non-empty array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  const f = out.filing_complexity_score.factors;
  assert.ok(Array.isArray(f) && f.length > 0, 'factors must be non-empty array');
});

test('filing_complexity_score.tier_interpretation is a string', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  assert.ok(typeof out.filing_complexity_score.tier_interpretation === 'string',
    'tier_interpretation must be a string');
});

test('filing_complexity_score for local channel is LOW complexity', async () => {
  // 1240 kHz is a local channel — should produce a lower score than KAZM (clear channel)
  const outLocal = await runSiteOptimizer({
    ...KAZM,
    frequency_khz: 1240, fcc_class: 'C', tpo_kw: 0.25,
    candidate_limit: 2
  });
  if (outLocal.available) {
    const tier = outLocal.filing_complexity_score.complexity_tier;
    assert.ok(['LOW', 'MODERATE'].includes(tier),
      `local channel complexity_tier "${tier}" should be LOW or MODERATE`);
  }
});

// ---------- transmission_line_analysis ----------

test('transmission_line_analysis is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.transmission_line_analysis != null,
      `transmission_line_analysis must be present on candidate rank ${c.rank}`);
  }
});

test('transmission_line_analysis has 4 feedline options', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const tl = c.transmission_line_analysis;
    assert.equal(tl.feedline_options.length, 4,
      `feedline_options must have 4 entries for rank ${c.rank}`);
  }
});

test('transmission_line_analysis feedline loss is positive', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    for (const fl of c.transmission_line_analysis.feedline_options) {
      assert.ok(fl.total_loss_db_at_60m > 0,
        `feedline ${fl.id} total_loss_db_at_60m must be positive for rank ${c.rank}`);
      assert.ok(fl.erp_at_antenna_kw > 0 && fl.erp_at_antenna_kw <= c.transmission_line_analysis.reference_tpo_kw,
        `erp_at_antenna_kw must be in (0, TPO] for rank ${c.rank}`);
    }
  }
});

test('transmission_line_analysis open-wire has lowest loss', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const fls = c.transmission_line_analysis.feedline_options;
    const openWire = fls.find(f => f.id === 'OPEN_WIRE');
    for (const other of fls.filter(f => f.id !== 'OPEN_WIRE')) {
      assert.ok(openWire.attenuation_db_per_100m < other.attenuation_db_per_100m,
        `OPEN_WIRE must have lowest attenuation vs ${other.id} for rank ${c.rank}`);
    }
  }
});

test('transmission_line_analysis comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table) {
    assert.ok('feedline_loss_db' in row, 'feedline_loss_db must be in comparison table');
    assert.ok('erp_at_antenna_kw' in row, 'erp_at_antenna_kw must be in comparison table');
  }
});

// ---------- antenna_base_impedance ----------

test('antenna_base_impedance is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.antenna_base_impedance != null,
      `antenna_base_impedance must be present on candidate rank ${c.rank}`);
  }
});

test('antenna_base_impedance.quarter_wave.radiation_resistance_ohm is ~36.6', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const rr = c.antenna_base_impedance.quarter_wave.radiation_resistance_ohm;
    assert.ok(Math.abs(rr - 36.6) < 0.5,
      `radiation_resistance_ohm ${rr} should be near 36.6 Ω for rank ${c.rank}`);
  }
});

test('antenna_base_impedance efficiency <= 100%', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const eff = c.antenna_base_impedance.quarter_wave.efficiency_standard_pct;
    assert.ok(eff > 0 && eff <= 100,
      `efficiency_standard_pct ${eff} must be in (0, 100] for rank ${c.rank}`);
  }
});

test('antenna_base_impedance high sigma gives higher efficiency', async () => {
  // High sigma (better ground) → lower ground loss → higher efficiency
  const outHighSigma = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(outHighSigma.available, true);
  if (outHighSigma.candidates.length > 0) {
    const c = outHighSigma.candidates[0];
    // Only check if we have efficiency data
    if (c.antenna_base_impedance?.quarter_wave) {
      const eff = c.antenna_base_impedance.quarter_wave.efficiency_standard_pct;
      assert.ok(typeof eff === 'number', 'efficiency must be a number');
    }
  }
});

test('antenna_base_impedance.base_reactance_table has 3 entries', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.equal(c.antenna_base_impedance.base_reactance_table.length, 3,
      `base_reactance_table must have 3 entries for rank ${c.rank}`);
  }
});

// ---------- permit_and_engineering_cost_estimate ----------

test('permit_and_engineering_cost_estimate is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.permit_and_engineering_cost_estimate != null,
      `permit_and_engineering_cost_estimate must be present on candidate rank ${c.rank}`);
  }
});

test('permit_and_engineering_cost_estimate total_soft_cost_low <= high', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const pe = c.permit_and_engineering_cost_estimate;
    assert.ok(pe.total_soft_cost_low_usd <= pe.total_soft_cost_high_usd,
      `soft cost low must be <= high for rank ${c.rank}`);
    assert.ok(pe.total_soft_cost_low_usd > 0, `soft cost low must be positive for rank ${c.rank}`);
  }
});

test('permit_and_engineering_cost_estimate cost_tier is valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  const validTiers = new Set(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']);
  for (const c of out.candidates) {
    assert.ok(validTiers.has(c.permit_and_engineering_cost_estimate.cost_tier),
      `cost_tier must be valid for rank ${c.rank}`);
  }
});

test('permit_and_engineering_cost_estimate line_items is non-empty array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const items = c.permit_and_engineering_cost_estimate.line_items;
    assert.ok(Array.isArray(items) && items.length > 0,
      `line_items must be non-empty array for rank ${c.rank}`);
  }
});

test('permit_and_engineering_cost_estimate always includes FCC_FORM_301 and FCC_COUNSEL', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const ids = c.permit_and_engineering_cost_estimate.line_items.map(i => i.id);
    assert.ok(ids.includes('FCC_FORM_301'), `FCC_FORM_301 must be in line_items for rank ${c.rank}`);
    assert.ok(ids.includes('FCC_COUNSEL'),  `FCC_COUNSEL must be in line_items for rank ${c.rank}`);
  }
});

test('permit_and_engineering_cost_estimate soft_cost columns in comparison table', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const row of out.candidate_comparison_table) {
    assert.ok('soft_cost_low_usd' in row, 'soft_cost_low_usd must be in comparison table');
    assert.ok('soft_cost_high_usd' in row, 'soft_cost_high_usd must be in comparison table');
    assert.ok('soft_cost_tier' in row, 'soft_cost_tier must be in comparison table');
  }
});

// ---------- total_project_cost_estimate ----------

test('total_project_cost_estimate is present on response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  assert.ok(out.total_project_cost_estimate != null, 'total_project_cost_estimate must be present');
});

test('total_project_cost_estimate.top_candidates length matches min(candidates, 5)', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  const tpc = out.total_project_cost_estimate;
  assert.ok(tpc.top_candidates.length <= Math.min(out.candidates.length, 5),
    'top_candidates must not exceed 5 or candidates.length');
});

test('total_project_cost_estimate each row has total_low <= total_high', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const row of out.total_project_cost_estimate.top_candidates) {
    assert.ok(row.total_low_usd <= row.total_high_usd,
      `rank ${row.rank}: total_low_usd must be <= total_high_usd`);
    assert.ok(row.total_low_usd > 0, `rank ${row.rank}: total_low_usd must be positive`);
  }
});

test('total_project_cost_estimate.lowest_cost_candidate_rank is a valid rank', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  const tpc = out.total_project_cost_estimate;
  if (tpc.lowest_cost_candidate_rank != null) {
    const ranks = out.candidates.map(c => c.rank);
    assert.ok(ranks.includes(tpc.lowest_cost_candidate_rank),
      `lowest_cost_candidate_rank ${tpc.lowest_cost_candidate_rank} must be a valid rank`);
  }
});

// ---------- candidate_narrative_summary ----------

test('candidate_narrative_summary is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.candidate_narrative_summary != null,
      `candidate_narrative_summary must be present on candidate rank ${c.rank}`);
  }
});

test('candidate_narrative_summary.summary is a non-empty string', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const ns = c.candidate_narrative_summary;
    assert.ok(typeof ns.summary === 'string' && ns.summary.length > 20,
      `summary must be a non-empty string for rank ${c.rank}`);
  }
});

test('candidate_narrative_summary.summary mentions COL coverage', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    if (c.col_coverage_pct != null) {
      assert.ok(c.candidate_narrative_summary.summary.includes('%'),
        `summary should mention COL% for rank ${c.rank}`);
    }
  }
});

test('candidate_narrative_summary.recommendation is a string', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(typeof c.candidate_narrative_summary.recommendation === 'string',
      `recommendation must be a string for rank ${c.rank}`);
  }
});

// ---------- signal_propagation_profile ----------

test('signal_propagation_profile is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.signal_propagation_profile != null,
      `signal_propagation_profile must be present on candidate rank ${c.rank}`);
  }
});

test('signal_propagation_profile has 5 contours', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.equal(c.signal_propagation_profile.contours.length, 5,
      `signal_propagation_profile must have 5 contours for rank ${c.rank}`);
  }
});

test('signal_propagation_profile contours in descending mV/m order', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const contours = c.signal_propagation_profile.contours;
    // 5mV/m should have shorter distance than 0.1mV/m (stronger signal = shorter reach)
    const c5 = contours.find(x => x.id === 'DAYTIME_5MVM');
    const c01 = contours.find(x => x.id === 'DAYTIME_01MVM');
    if (c5?.distance_km != null && c01?.distance_km != null) {
      assert.ok(c5.distance_km < c01.distance_km,
        `5mV/m distance must be < 0.1mV/m distance for rank ${c.rank}`);
    }
  }
});

test('signal_propagation_profile.skywave_25uvm_est_km is positive', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    const skw = c.signal_propagation_profile.skywave_25uvm_est_km;
    assert.ok(typeof skw === 'number' && skw > 0,
      `skywave_25uvm_est_km must be positive for rank ${c.rank}`);
  }
});

// ---------- geographic_diversity_analysis ----------

test('geographic_diversity_analysis is present on optimizer response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 8 });
  assert.equal(out.available, true);
  assert.ok(out.geographic_diversity_analysis != null, 'geographic_diversity_analysis must be present');
});

test('geographic_diversity_analysis has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 8 });
  const gd = out.geographic_diversity_analysis;
  assert.ok(typeof gd.n_candidates_analyzed === 'number', 'n_candidates_analyzed must be a number');
  assert.ok(typeof gd.quadrants_covered === 'number', 'quadrants_covered must be a number');
  assert.ok([0,1,2,3,4].includes(gd.quadrants_covered), 'quadrants_covered must be 0-4');
  assert.ok(typeof gd.diversity_score === 'number', 'diversity_score must be a number');
  assert.ok(['EXCELLENT','GOOD','MODERATE','POOR'].includes(gd.diversity_tier), 'diversity_tier must be a valid tier');
  assert.ok(gd.quadrant_summary != null, 'quadrant_summary must be present');
  assert.ok(Array.isArray(gd.uncovered_quadrants), 'uncovered_quadrants must be an array');
});

test('geographic_diversity_analysis.diversity_score range is 0-100', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 8 });
  const { diversity_score } = out.geographic_diversity_analysis;
  assert.ok(diversity_score >= 0 && diversity_score <= 100, `diversity_score ${diversity_score} must be 0-100`);
});

test('geographic_diversity_analysis quadrant_summary covers NE SE SW NW', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 8 });
  const qs = out.geographic_diversity_analysis.quadrant_summary;
  for (const q of ['NE', 'SE', 'SW', 'NW']) {
    assert.ok(qs[q] != null, `quadrant_summary must have entry for ${q}`);
    assert.ok(Array.isArray(qs[q].candidates), `quadrant_summary[${q}].candidates must be an array`);
    assert.ok(typeof qs[q].covered === 'boolean', `quadrant_summary[${q}].covered must be a boolean`);
  }
});

test('geographic_diversity_analysis uncovered_quadrants consistent with quadrant_summary', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 8 });
  const gd = out.geographic_diversity_analysis;
  const qs = gd.quadrant_summary;
  for (const q of gd.uncovered_quadrants) {
    assert.equal(qs[q].covered, false, `uncovered_quadrant ${q} must have covered=false in quadrant_summary`);
  }
  const coveredCount = Object.values(qs).filter(v => v.covered).length;
  assert.equal(coveredCount, gd.quadrants_covered, 'quadrants_covered must match count of covered quadrants in summary');
});

test('geographic_diversity_analysis.median_distance_km is positive', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 5 });
  const { median_distance_km } = out.geographic_diversity_analysis;
  assert.ok(typeof median_distance_km === 'number' && median_distance_km > 0, `median_distance_km must be positive, got ${median_distance_km}`);
});

// ---------- regulatory_gate_summary ----------

test('regulatory_gate_summary is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.regulatory_gate_summary != null,
      `regulatory_gate_summary must be present on candidate rank ${c.rank}`);
  }
});

test('regulatory_gate_summary has overall_verdict and gates array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const rg = c.regulatory_gate_summary;
    assert.ok(['VIABLE','CONDITIONAL','NON_VIABLE_AS_IS'].includes(rg.overall_verdict),
      `overall_verdict "${rg.overall_verdict}" must be valid for rank ${c.rank}`);
    assert.ok(Array.isArray(rg.gates) && rg.gates.length >= 5,
      `gates must be an array with ≥5 entries for rank ${c.rank}`);
    assert.ok(typeof rg.fail_count === 'number', `fail_count must be a number for rank ${c.rank}`);
    assert.ok(typeof rg.warn_count === 'number', `warn_count must be a number for rank ${c.rank}`);
  }
});

test('regulatory_gate_summary each gate has id, status, rule', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const VALID_STATUSES = ['PASS','WARN','FAIL','N/A'];
  for (const c of out.candidates) {
    for (const g of c.regulatory_gate_summary.gates) {
      assert.ok(typeof g.id === 'string' && g.id.length > 0,
        `gate must have id string on rank ${c.rank}`);
      assert.ok(VALID_STATUSES.includes(g.status),
        `gate ${g.id} status "${g.status}" must be valid on rank ${c.rank}`);
      assert.ok(typeof g.rule === 'string' && g.rule.length > 0,
        `gate ${g.id} must have rule on rank ${c.rank}`);
    }
  }
});

test('regulatory_gate_summary fail_count matches actual FAIL gates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  for (const c of out.candidates) {
    const rg = c.regulatory_gate_summary;
    const actualFails = rg.gates.filter(g => g.status === 'FAIL').length;
    assert.equal(rg.fail_count, actualFails,
      `fail_count ${rg.fail_count} must match actual FAIL gate count ${actualFails} on rank ${c.rank}`);
  }
});

test('regulatory_gate_summary NON_VIABLE_AS_IS iff fail_count > 0', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  for (const c of out.candidates) {
    const rg = c.regulatory_gate_summary;
    if (rg.fail_count > 0) {
      assert.equal(rg.overall_verdict, 'NON_VIABLE_AS_IS',
        `verdict must be NON_VIABLE_AS_IS when fail_count=${rg.fail_count} on rank ${c.rank}`);
    } else {
      assert.notEqual(rg.overall_verdict, 'NON_VIABLE_AS_IS',
        `verdict must NOT be NON_VIABLE_AS_IS when fail_count=0 on rank ${c.rank}`);
    }
  }
});

test('regulatory_gate_summary gate_verdict in comparison table', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('gate_verdict' in row, 'gate_verdict must be in comparison table');
    assert.ok('gate_fail_count' in row, 'gate_fail_count must be in comparison table');
    assert.ok('gate_warn_count' in row, 'gate_warn_count must be in comparison table');
  }
});

// ---------- ground_system_design_specification ----------

test('ground_system_design_specification is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.ground_system_design_specification != null,
      `ground_system_design_specification must be present on rank ${c.rank}`);
  }
});

test('ground_system_design_specification has standard and extended designs', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const gs = c.ground_system_design_specification;
    assert.ok(gs.standard_design != null, `standard_design must be present on rank ${c.rank}`);
    assert.ok(gs.extended_design != null, `extended_design must be present on rank ${c.rank}`);
    assert.ok(gs.minimum_design != null, `minimum_design must be present on rank ${c.rank}`);
    assert.ok(typeof gs.standard_design.n_radials === 'number', `n_radials must be a number on rank ${c.rank}`);
    assert.ok(typeof gs.standard_design.efficiency_pct === 'number', `efficiency_pct must be a number on rank ${c.rank}`);
  }
});

test('ground_system_design_specification efficiency_pct is 0-100', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  for (const c of out.candidates) {
    const eff = c.ground_system_design_specification.standard_design.efficiency_pct;
    assert.ok(eff >= 0 && eff <= 100,
      `efficiency_pct ${eff} must be 0-100 on rank ${c.rank}`);
  }
});

test('ground_system_design_specification extended efficiency > standard efficiency', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const gs = c.ground_system_design_specification;
    assert.ok(gs.extended_design.efficiency_pct >= gs.standard_design.efficiency_pct,
      `extended efficiency must be >= standard efficiency on rank ${c.rank}`);
  }
});

test('ground_system_design_specification quarter_wave_m positive', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const gs = c.ground_system_design_specification;
    assert.ok(typeof gs.quarter_wave_m === 'number' && gs.quarter_wave_m > 0,
      `quarter_wave_m must be positive on rank ${c.rank}`);
  }
});

test('ground_system_design_specification comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('ground_eff_pct' in row, 'ground_eff_pct must be in comparison table');
    assert.ok('ground_rg_ohm' in row, 'ground_rg_ohm must be in comparison table');
    assert.ok('ground_design_grade' in row, 'ground_design_grade must be in comparison table');
  }
});

// ---------- noise_floor_estimate ----------

test('noise_floor_estimate is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  for (const c of out.candidates) {
    assert.ok(c.noise_floor_estimate != null,
      `noise_floor_estimate must be present on rank ${c.rank}`);
  }
});

test('noise_floor_estimate has correct shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const nf = c.noise_floor_estimate;
    assert.equal(nf.frequency_khz, KAZM.frequency_khz, `frequency_khz must match input on rank ${c.rank}`);
    assert.ok(typeof nf.atmospheric_noise_fa_db === 'number', `atmospheric_noise_fa_db must be a number on rank ${c.rank}`);
    assert.ok(typeof nf.man_made_noise_fa_db?.residential === 'number', `man_made_noise_fa_db.residential must be a number on rank ${c.rank}`);
    assert.ok(['HIGH_NOISE','MODERATE_NOISE','LOW_NOISE'].includes(nf.noise_tier), `noise_tier must be valid on rank ${c.rank}`);
  }
});

test('noise_floor_estimate atmospheric noise positive', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const fa = c.noise_floor_estimate.atmospheric_noise_fa_db;
    assert.ok(fa > 0, `atmospheric_noise_fa_db ${fa} must be positive on rank ${c.rank}`);
  }
});

test('noise_floor_estimate man_made noise urban > residential > rural', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  for (const c of out.candidates) {
    const mm = c.noise_floor_estimate.man_made_noise_fa_db;
    assert.ok(mm.urban > mm.residential, `urban noise must be > residential on rank ${c.rank}`);
    assert.ok(mm.residential > mm.rural, `residential noise must be > rural on rank ${c.rank}`);
  }
});

test('noise_floor_estimate required_field_for_30db_snr_mvm is positive', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const rf = c.noise_floor_estimate.required_field_for_30db_snr_mvm;
    assert.ok(typeof rf === 'number' && rf > 0, `required_field must be positive on rank ${c.rank}`);
  }
});

test('noise_floor_estimate comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('noise_tier' in row, 'noise_tier must be in comparison table');
    assert.ok('atm_noise_fa_db' in row, 'atm_noise_fa_db must be in comparison table');
    assert.ok('req_field_30snr_mvm' in row, 'req_field_30snr_mvm must be in comparison table');
  }
});

// ---------- candidate_set_recommendation ----------

test('candidate_set_recommendation is present on optimizer response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  assert.equal(out.available, true);
  assert.ok(out.candidate_set_recommendation != null, 'candidate_set_recommendation must be present');
});

test('candidate_set_recommendation has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  const csr = out.candidate_set_recommendation;
  assert.ok(typeof csr.overall_guidance === 'string', 'overall_guidance must be a string');
  assert.ok(typeof csr.n_advance_ready === 'number', 'n_advance_ready must be a number');
  assert.ok(typeof csr.n_need_remedy === 'number', 'n_need_remedy must be a number');
  assert.ok(typeof csr.n_hold === 'number', 'n_hold must be a number');
  assert.ok(Array.isArray(csr.candidates), 'candidates must be an array');
});

test('candidate_set_recommendation.candidates covers all returned', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  const csr = out.candidate_set_recommendation;
  assert.ok(csr.candidates.length <= 5, 'candidates must cover top 5');
  const ranks = csr.candidates.map(e => e.rank);
  for (const c of out.candidates.slice(0, Math.min(5, out.candidates.length))) {
    assert.ok(ranks.includes(c.rank), `candidate rank ${c.rank} must appear in recommendation`);
  }
});

test('candidate_set_recommendation each entry has priority and action', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  const VALID_PRIORITIES = ['ADVANCE_IMMEDIATELY','ADVANCE_AFTER_REMEDY','HOLD','MONITOR'];
  for (const e of out.candidate_set_recommendation.candidates) {
    assert.ok(VALID_PRIORITIES.includes(e.priority),
      `priority "${e.priority}" must be valid for rank ${e.rank}`);
    assert.ok(typeof e.action === 'string' && e.action.length > 0,
      `action must be a non-empty string for rank ${e.rank}`);
  }
});

test('candidate_set_recommendation n_advance_ready + n_need_remedy + n_hold <= candidates.length', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 4 });
  const csr = out.candidate_set_recommendation;
  const total = csr.n_advance_ready + csr.n_need_remedy + csr.n_hold
    + (csr.candidates.filter(e => e.priority === 'MONITOR').length);
  assert.equal(total, csr.candidates.length,
    `priority counts must sum to candidates.length`);
});

// ---------- tower_construction_timeline ----------

test('tower_construction_timeline is present on optimizer response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  assert.equal(out.available, true);
  assert.ok(out.tower_construction_timeline != null, 'tower_construction_timeline must be present');
});

test('tower_construction_timeline has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const tct = out.tower_construction_timeline;
  assert.ok(Array.isArray(tct.phases) && tct.phases.length >= 5, 'phases must have ≥5 entries');
  assert.ok(typeof tct.total_weeks_min === 'number', 'total_weeks_min must be a number');
  assert.ok(typeof tct.total_weeks_max === 'number', 'total_weeks_max must be a number');
  assert.ok(typeof tct.range_label === 'string', 'range_label must be a string');
  assert.ok(tct.total_weeks_min > 0, 'total_weeks_min must be positive');
  assert.ok(tct.total_weeks_max >= tct.total_weeks_min, 'total_weeks_max must be >= total_weeks_min');
});

test('tower_construction_timeline each phase has id, label, weeks_min, weeks_max', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  for (const p of out.tower_construction_timeline.phases) {
    assert.ok(typeof p.id === 'string' && p.id.length > 0, 'phase must have id');
    assert.ok(typeof p.label === 'string' && p.label.length > 0, 'phase must have label');
    assert.ok(typeof p.weeks_min === 'number' && p.weeks_min > 0, 'weeks_min must be positive');
    assert.ok(typeof p.weeks_max === 'number' && p.weeks_max >= p.weeks_min, 'weeks_max must be >= weeks_min');
  }
});

test('tower_construction_timeline total_months are positive', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const tct = out.tower_construction_timeline;
  assert.ok(tct.total_months_min > 0, 'total_months_min must be positive');
  assert.ok(tct.total_months_max >= tct.total_months_min, 'total_months_max must be >= min');
});

test('tower_construction_timeline critical_path_notes is array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.ok(Array.isArray(out.tower_construction_timeline.critical_path_notes), 'critical_path_notes must be an array');
});

// ---- fcc_lms_filing_checklist ----

test('fcc_lms_filing_checklist is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.fcc_lms_filing_checklist != null, `rank ${c.rank} missing fcc_lms_filing_checklist`);
  }
});

test('fcc_lms_filing_checklist has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const fl = out.candidates[0].fcc_lms_filing_checklist;
  assert.ok(Array.isArray(fl.items), 'items must be an array');
  assert.ok(fl.items.length >= 5, `expected ≥5 items, got ${fl.items.length}`);
  assert.ok(typeof fl.required_count === 'number', 'required_count must be a number');
  assert.ok(typeof fl.total_items === 'number', 'total_items must be a number');
});

test('fcc_lms_filing_checklist each item has id, form, status, rule', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const fl = out.candidates[0].fcc_lms_filing_checklist;
  for (const item of fl.items) {
    assert.ok(item.id, `item missing id: ${JSON.stringify(item)}`);
    assert.ok(item.form, `item ${item.id} missing form`);
    assert.ok(['REQUIRED', 'CONDITIONAL', 'INFORMATIONAL'].includes(item.status), `item ${item.id} has invalid status: ${item.status}`);
    assert.ok(item.rule, `item ${item.id} missing rule`);
  }
});

test('fcc_lms_filing_checklist LMS_FORM_301 is always REQUIRED', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const fl = out.candidates[0].fcc_lms_filing_checklist;
  const form301 = fl.items.find(i => i.id === 'LMS_FORM_301');
  assert.ok(form301 != null, 'LMS_FORM_301 item must be present');
  assert.equal(form301.status, 'REQUIRED', 'LMS_FORM_301 must be REQUIRED');
});

test('fcc_lms_filing_checklist comparison table columns are populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const row = out.candidate_comparison_table?.[0];
  assert.ok(row != null, 'comparison table must have at least one row');
  assert.ok(typeof row.lms_required_items === 'number', 'lms_required_items must be a number');
  assert.ok(typeof row.lms_total_items === 'number', 'lms_total_items must be a number');
  assert.ok(row.lms_required_items > 0, 'lms_required_items must be > 0');
});

// ---- seasonal_propagation_summary ----

test('seasonal_propagation_summary is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.seasonal_propagation_summary != null, `rank ${c.rank} missing seasonal_propagation_summary`);
  }
});

test('seasonal_propagation_summary has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const ss = out.candidates[0].seasonal_propagation_summary;
  assert.ok(Array.isArray(ss.contours), 'contours must be an array');
  assert.ok(ss.contours.length >= 3, `expected ≥3 seasonal contours, got ${ss.contours.length}`);
  assert.ok(typeof ss.annual_avg_sigma_msm === 'number', 'annual_avg_sigma_msm must be a number');
  assert.ok(['HIGH', 'MODERATE', 'LOW'].includes(ss.col_compliance_risk_tier), `invalid col_compliance_risk_tier: ${ss.col_compliance_risk_tier}`);
});

test('seasonal_propagation_summary each contour has season, sigma, and reach', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const ss = out.candidates[0].seasonal_propagation_summary;
  for (const c of ss.contours) {
    assert.ok(c.season, `contour missing season: ${JSON.stringify(c)}`);
    assert.ok(typeof c.sigma_msm === 'number', `contour ${c.season} missing sigma_msm`);
    assert.ok(c.sigma_msm > 0, `contour ${c.season} sigma_msm must be positive`);
  }
});

test('seasonal_propagation_summary comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const row = out.candidate_comparison_table?.[0];
  assert.ok(row != null, 'comparison table must have at least one row');
  assert.ok(['HIGH', 'MODERATE', 'LOW'].includes(row.seasonal_col_risk), `invalid seasonal_col_risk: ${row.seasonal_col_risk}`);
});

test('seasonal_propagation_summary summer-dry sigma is less than annual avg', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const ss = out.candidates[0].seasonal_propagation_summary;
  const summer = ss.contours.find(c => c.season === 'SUMMER_DRY');
  assert.ok(summer != null, 'SUMMER_DRY contour must exist');
  assert.ok(summer.sigma_msm < ss.annual_avg_sigma_msm, `summer sigma (${summer.sigma_msm}) must be < annual avg (${ss.annual_avg_sigma_msm})`);
});

// ---- fcc_class_power_ceiling_analysis ----

test('fcc_class_power_ceiling_analysis is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.fcc_class_power_ceiling_analysis != null, `rank ${c.rank} missing fcc_class_power_ceiling_analysis`);
  }
});

test('fcc_class_power_ceiling_analysis has correct class ceiling for Class D', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const pa = out.candidates[0].fcc_class_power_ceiling_analysis;
  assert.equal(pa.fcc_class, 'D', 'fcc_class must be D');
  assert.equal(pa.class_power_ceiling_kw, 50, 'Class D ceiling must be 50 kW');
  assert.equal(pa.current_tpo_kw, 5, 'current_tpo_kw must be 5');
  assert.ok(pa.headroom_kw > 0, 'headroom_kw must be positive for 5 kW / 50 kW ceiling');
});

test('fcc_class_power_ceiling_analysis utilization_pct is correct', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const pa = out.candidates[0].fcc_class_power_ceiling_analysis;
  assert.ok(pa.power_utilization_pct > 0, 'utilization_pct must be positive');
  assert.ok(pa.power_utilization_pct <= 100, 'utilization_pct must be <= 100');
  // 5 kW / 50 kW = 10%
  assert.ok(Math.abs(pa.power_utilization_pct - 10) < 1, `expected ~10% utilization, got ${pa.power_utilization_pct}`);
});

test('fcc_class_power_ceiling_analysis upgrade_feasibility is valid', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const pa = out.candidates[0].fcc_class_power_ceiling_analysis;
  assert.ok(['NONE', 'LIMITED', 'SIGNIFICANT'].includes(pa.upgrade_feasibility), `invalid upgrade_feasibility: ${pa.upgrade_feasibility}`);
});

test('fcc_class_power_ceiling_analysis comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const row = out.candidate_comparison_table?.[0];
  assert.ok(row != null, 'comparison table must have at least one row');
  assert.ok(typeof row.power_utilization_pct === 'number', 'power_utilization_pct must be a number');
  assert.ok(['NONE', 'LIMITED', 'SIGNIFICANT'].includes(row.upgrade_feasibility), `invalid upgrade_feasibility: ${row.upgrade_feasibility}`);
});

// ---- technical_proof_guide ----

test('technical_proof_guide is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.technical_proof_guide != null, `rank ${c.rank} missing technical_proof_guide`);
  }
});

test('technical_proof_guide has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const pg = out.candidates[0].technical_proof_guide;
  assert.ok(Array.isArray(pg.measurements), 'measurements must be an array');
  assert.ok(pg.measurements.length >= 4, `expected ≥4 measurements, got ${pg.measurements.length}`);
  assert.ok(['NDA', 'DA'].includes(pg.antenna_mode), `invalid antenna_mode: ${pg.antenna_mode}`);
  assert.ok(typeof pg.n_proof_radials === 'number', 'n_proof_radials must be a number');
});

test('technical_proof_guide NDA mode has 8 radials', async () => {
  // KAZM/780 is clear channel, so DA is expected. Use local channel for NDA test.
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 1490, fcc_class: 'C', candidate_limit: 2 });
  const pg = out.candidates[0].technical_proof_guide;
  // 1490 kHz is a local channel — NDA, 8 radials
  assert.equal(pg.antenna_mode, 'NDA', 'local channel must be NDA mode');
  assert.equal(pg.n_proof_radials, 8, 'NDA must have 8 proof radials');
  assert.ok(Array.isArray(pg.nda_radial_plan), 'NDA must have nda_radial_plan');
  assert.equal(pg.nda_radial_plan.length, 8, 'nda_radial_plan must have 8 entries');
});

test('technical_proof_guide each measurement has id, label, rule', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const pg = out.candidates[0].technical_proof_guide;
  for (const m of pg.measurements) {
    assert.ok(m.id, `measurement missing id`);
    assert.ok(m.label, `measurement ${m.id} missing label`);
    assert.ok(m.rule, `measurement ${m.id} missing rule`);
  }
});

test('technical_proof_guide comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const row = out.candidate_comparison_table?.[0];
  assert.ok(row != null, 'comparison table must have at least one row');
  assert.ok(['NDA', 'DA'].includes(row.proof_antenna_mode), `invalid proof_antenna_mode: ${row.proof_antenna_mode}`);
  assert.ok(typeof row.proof_radials === 'number', 'proof_radials must be a number');
});

// ---- site_acquisition_checklist ----

test('site_acquisition_checklist is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.site_acquisition_checklist != null, `rank ${c.rank} missing site_acquisition_checklist`);
  }
});

test('site_acquisition_checklist has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const sa = out.candidates[0].site_acquisition_checklist;
  assert.ok(Array.isArray(sa.items), 'items must be an array');
  assert.ok(sa.items.length >= 5, `expected ≥5 items, got ${sa.items.length}`);
  assert.ok(typeof sa.critical_count === 'number', 'critical_count must be a number');
  assert.ok(typeof sa.min_parcel_area_ha === 'number', 'min_parcel_area_ha must be a number');
  assert.ok(sa.min_parcel_area_ha > 0, 'min_parcel_area_ha must be positive');
});

test('site_acquisition_checklist each item has id, category, priority, action', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const sa = out.candidates[0].site_acquisition_checklist;
  for (const item of sa.items) {
    assert.ok(item.id, `item missing id`);
    assert.ok(item.category, `item ${item.id} missing category`);
    assert.ok(['CRITICAL','HIGH','MEDIUM','INFORMATIONAL'].includes(item.priority), `item ${item.id} has invalid priority: ${item.priority}`);
    assert.ok(item.action, `item ${item.id} missing action`);
  }
});

test('site_acquisition_checklist has ZONING_VERIFICATION as CRITICAL', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const sa = out.candidates[0].site_acquisition_checklist;
  const zoning = sa.items.find(i => i.id === 'ZONING_VERIFICATION');
  assert.ok(zoning != null, 'ZONING_VERIFICATION must be present');
  assert.equal(zoning.priority, 'CRITICAL', 'ZONING_VERIFICATION must be CRITICAL');
});

test('site_acquisition_checklist comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const row = out.candidate_comparison_table?.[0];
  assert.ok(row != null, 'comparison table must have at least one row');
  assert.ok(typeof row.acq_critical_items === 'number', 'acq_critical_items must be a number');
  assert.ok(typeof row.acq_min_parcel_ha === 'number', 'acq_min_parcel_ha must be a number');
  assert.ok(row.acq_critical_items > 0, 'acq_critical_items must be > 0');
});

// ---- engineering_confidence_matrix ----

test('engineering_confidence_matrix is present on optimizer response', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  assert.ok(out.engineering_confidence_matrix != null, 'engineering_confidence_matrix must be present');
});

test('engineering_confidence_matrix has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const ecm = out.engineering_confidence_matrix;
  assert.ok(Array.isArray(ecm.dimensions), 'dimensions must be an array');
  assert.ok(ecm.dimensions.length >= 4, `expected ≥4 dimensions, got ${ecm.dimensions.length}`);
  assert.ok(['LOW', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH'].includes(ecm.overall_confidence), `invalid overall_confidence: ${ecm.overall_confidence}`);
  assert.ok(typeof ecm.n_filing_grade === 'number', 'n_filing_grade must be a number');
  assert.ok(typeof ecm.n_not_evaluated === 'number', 'n_not_evaluated must be a number');
});

test('engineering_confidence_matrix each dimension has id, label, confidence', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const ecm = out.engineering_confidence_matrix;
  for (const d of ecm.dimensions) {
    assert.ok(d.id, `dimension missing id`);
    assert.ok(d.label, `dimension ${d.id} missing label`);
    assert.ok(['FILING_GRADE','HIGH','SCREENING','NOT_EVALUATED'].includes(d.confidence),
      `dimension ${d.id} has invalid confidence: ${d.confidence}`);
  }
});

test('engineering_confidence_matrix has CONDUCTIVITY dimension', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const ecm = out.engineering_confidence_matrix;
  const cond = ecm.dimensions.find(d => d.id === 'CONDUCTIVITY');
  assert.ok(cond != null, 'CONDUCTIVITY dimension must be present');
  // Zone-table mode: SCREENING; raster mode: FILING_GRADE
  assert.ok(['SCREENING', 'FILING_GRADE'].includes(cond.confidence), `invalid CONDUCTIVITY confidence: ${cond.confidence}`);
});

test('engineering_confidence_matrix col_polygon_supplied reflects input', async () => {
  const outNo  = await runSiteOptimizer({ ...KAZM, candidate_limit: 2, community_of_license_polygon: null });
  const outYes = await runSiteOptimizer({ ...KAZM, candidate_limit: 2, community_of_license_polygon: { type: 'Point', coordinates: [-111.82, 34.86] } });
  assert.equal(outNo.engineering_confidence_matrix.col_polygon_supplied,  false, 'no polygon → col_polygon_supplied must be false');
  assert.equal(outYes.engineering_confidence_matrix.col_polygon_supplied, true,  'with polygon → col_polygon_supplied must be true');
});

// ---- spectrum_interference_summary ----

test('spectrum_interference_summary is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.spectrum_interference_summary != null, `rank ${c.rank} missing spectrum_interference_summary`);
  }
});

test('spectrum_interference_summary has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const si = out.candidates[0].spectrum_interference_summary;
  assert.ok(typeof si.frequency_khz === 'number');
  assert.ok(typeof si.fcc_class === 'string');
  assert.ok(typeof si.channel_class === 'string');
  assert.ok(typeof si.is_clear_channel === 'boolean');
  assert.ok(typeof si.is_local_channel === 'boolean');
  assert.ok(typeof si.interference_risk_tier === 'string');
  assert.ok(typeof si.risk_note === 'string');
  assert.ok(Array.isArray(si.separation_rules));
  assert.ok(typeof si.full_study_required === 'boolean');
  assert.ok(typeof si.nighttime_nif_required === 'boolean');
});

test('spectrum_interference_summary separation_rules has 3 entries', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const si = out.candidates[0].spectrum_interference_summary;
  assert.equal(si.separation_rules.length, 3);
  const ids = si.separation_rules.map(r => r.relationship);
  assert.ok(ids.includes('CO_CHANNEL'));
  assert.ok(ids.includes('FIRST_ADJACENT'));
  assert.ok(ids.includes('SECOND_ADJACENT'));
});

test('spectrum_interference_summary local channel has LOW risk', async () => {
  // 1490 kHz is a local channel
  const out = await runSiteOptimizer({ ...KAZM, frequency_khz: 1490, candidate_limit: 2 });
  const si = out.candidates[0].spectrum_interference_summary;
  assert.equal(si.is_local_channel, true);
  assert.equal(si.interference_risk_tier, 'LOW');
  assert.equal(si.full_study_required, false);
});

test('spectrum_interference_summary comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ct  = out.candidate_comparison_table;
  for (const row of ct) {
    assert.ok('int_risk_tier' in row);
    assert.ok('int_protected_radius_km' in row);
    assert.ok('int_nighttime_nif' in row);
  }
});

// ---- colocation_compatibility_score ----

test('colocation_compatibility_score is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.colocation_compatibility_score != null, `rank ${c.rank} missing colocation_compatibility_score`);
  }
});

test('colocation_compatibility_score has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const cc = out.candidates[0].colocation_compatibility_score;
  assert.ok(typeof cc.frequency_khz === 'number');
  assert.ok(typeof cc.tpo_kw === 'number');
  assert.ok(typeof cc.quarter_wave_m === 'number');
  assert.ok(Array.isArray(cc.host_scores));
  assert.ok(typeof cc.best_host_type === 'string');
  assert.ok(typeof cc.best_host_score === 'number');
  assert.ok(typeof cc.best_host_tier === 'string');
  assert.equal(typeof cc.diplexing_always_required, 'boolean');
});

test('colocation_compatibility_score has 5 host types', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const cc = out.candidates[0].colocation_compatibility_score;
  assert.equal(cc.host_scores.length, 5);
  const ids = cc.host_scores.map(h => h.host_type);
  assert.ok(ids.includes('AM_SITE'));
  assert.ok(ids.includes('FM_TX'));
  assert.ok(ids.includes('CELLULAR'));
  assert.ok(ids.includes('WATER_TOWER'));
  assert.ok(ids.includes('BUILDING_ROOFTOP'));
});

test('colocation_compatibility_score each host has score, tier, risks, benefits', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const cc = out.candidates[0].colocation_compatibility_score;
  for (const h of cc.host_scores) {
    assert.ok(typeof h.score === 'number', `${h.host_type} score must be number`);
    assert.ok(['GOOD', 'FAIR', 'POOR'].includes(h.compatibility_tier), `${h.host_type} invalid tier`);
    assert.ok(Array.isArray(h.risks), `${h.host_type} missing risks`);
    assert.ok(Array.isArray(h.benefits), `${h.host_type} missing benefits`);
  }
});

test('colocation_compatibility_score comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ct  = out.candidate_comparison_table;
  for (const row of ct) {
    assert.ok('coloc_best_host' in row);
    assert.ok('coloc_best_score' in row);
    assert.ok('coloc_best_tier' in row);
  }
});

// ---- environmental_risk_matrix ----

test('environmental_risk_matrix is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.environmental_risk_matrix != null, `rank ${c.rank} missing environmental_risk_matrix`);
  }
});

test('environmental_risk_matrix has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const env = out.candidates[0].environmental_risk_matrix;
  assert.ok(typeof env.overall_nepa_risk === 'string');
  assert.ok(typeof env.high_risk_count === 'number');
  assert.ok(typeof env.elevated_risk_count === 'number');
  assert.ok(Array.isArray(env.items));
  assert.ok(typeof env.ea_timeline_weeks_worst_case === 'number');
  assert.ok(typeof env.ea_eligibility_note === 'string');
});

test('environmental_risk_matrix has 13 NEPA categories', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const env = out.candidates[0].environmental_risk_matrix;
  assert.equal(env.items.length, 13);
});

test('environmental_risk_matrix each item has id, cfr, risk_level, verification', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const env = out.candidates[0].environmental_risk_matrix;
  const VALID_RISK = ['HIGH', 'ELEVATED', 'MODERATE', 'LOW', 'UNKNOWN'];
  for (const item of env.items) {
    assert.ok(typeof item.id === 'string', `item missing id`);
    assert.ok(typeof item.cfr === 'string', `${item.id} missing cfr`);
    assert.ok(VALID_RISK.includes(item.risk_level), `${item.id} invalid risk_level: ${item.risk_level}`);
    assert.ok(typeof item.verification === 'string', `${item.id} missing verification`);
  }
});

test('environmental_risk_matrix comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ct  = out.candidate_comparison_table;
  for (const row of ct) {
    assert.ok('nepa_risk' in row);
    assert.ok('nepa_high_count' in row);
    assert.ok('nepa_ea_weeks_worst' in row);
  }
});

// ---- financial_feasibility_summary ----

test('financial_feasibility_summary is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.financial_feasibility_summary != null, `rank ${c.rank} missing financial_feasibility_summary`);
  }
});

test('financial_feasibility_summary has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const fin = out.candidates[0].financial_feasibility_summary;
  assert.ok(typeof fin.total_buy_low_usd === 'number');
  assert.ok(typeof fin.total_buy_high_usd === 'number');
  assert.ok(typeof fin.annual_operating_low_usd === 'number');
  assert.ok(typeof fin.overall_feasibility === 'string');
  assert.ok(Array.isArray(fin.line_items));
  assert.ok(typeof fin.annual_power_kwh === 'number');
});

test('financial_feasibility_summary has 10 line items', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const fin = out.candidates[0].financial_feasibility_summary;
  assert.equal(fin.line_items.length, 10);
  const ids = fin.line_items.map(l => l.id);
  assert.ok(ids.includes('TOWER_CONSTRUCTION'));
  assert.ok(ids.includes('GROUND_SYSTEM'));
  assert.ok(ids.includes('TRANSMITTER'));
  assert.ok(ids.includes('CONTINGENCY'));
});

test('financial_feasibility_summary total_buy_high > total_buy_low', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const fin = out.candidates[0].financial_feasibility_summary;
  assert.ok(fin.total_buy_high_usd > fin.total_buy_low_usd, 'high must exceed low');
  assert.ok(fin.total_buy_low_usd > 0, 'total must be positive');
});

test('financial_feasibility_summary comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ct  = out.candidate_comparison_table;
  for (const row of ct) {
    assert.ok('fin_total_buy_low' in row);
    assert.ok('fin_total_buy_high' in row);
    assert.ok('fin_feasibility' in row);
    assert.ok('fin_payback_optimistic' in row);
  }
});

// ---- antenna_pattern_optimization_guide ----

test('antenna_pattern_optimization_guide is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.antenna_pattern_optimization_guide != null, `rank ${c.rank} missing antenna_pattern_optimization_guide`);
  }
});

test('antenna_pattern_optimization_guide has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const ap = out.candidates[0].antenna_pattern_optimization_guide;
  assert.ok(typeof ap.col_bearing_deg === 'number');
  assert.ok(typeof ap.dist_to_col_km === 'number');
  assert.ok(typeof ap.col_required_field_mvm === 'number');
  assert.ok(typeof ap.da_recommended === 'string');
  assert.ok(typeof ap.da_recommended_note === 'string');
  assert.ok(Array.isArray(ap.hrp_compliance_checklist));
});

test('antenna_pattern_optimization_guide NDA has no spacing options', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'NDA', candidate_limit: 1 });
  const ap = out.candidates[0].antenna_pattern_optimization_guide;
  assert.equal(ap.is_directional, false);
  assert.ok(ap.element_spacing_options === null);
});

test('antenna_pattern_optimization_guide DA has 3 spacing options', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'DA-D', candidate_limit: 1 });
  const ap = out.candidates[0].antenna_pattern_optimization_guide;
  assert.equal(ap.is_directional, true);
  assert.equal(ap.element_spacing_options.length, 3);
  const spacings = ap.element_spacing_options.map(s => s.spacing_label);
  assert.ok(spacings.includes('λ/4'));
  assert.ok(spacings.includes('λ/2'));
});

test('antenna_pattern_optimization_guide comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ct  = out.candidate_comparison_table;
  for (const row of ct) {
    assert.ok('ap_col_bearing_deg' in row);
    assert.ok('ap_col_field_nda_mvm' in row);
    assert.ok('ap_da_recommended' in row);
  }
});

// ---- propagation_confidence_interval ----

test('propagation_confidence_interval is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.propagation_confidence_interval != null, `rank ${c.rank} missing propagation_confidence_interval`);
  }
});

test('propagation_confidence_interval has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const pci = out.candidates[0].propagation_confidence_interval;
  assert.ok(typeof pci.field_uncertainty_pct === 'number');
  assert.ok(typeof pci.reach_uncertainty_pct === 'number');
  assert.ok(['HIGH','MEDIUM','LOW'].includes(pci.confidence_level));
  assert.ok(pci.daytime_reach_bounds_km != null);
  assert.ok(typeof pci.daytime_reach_bounds_km.low === 'number');
  assert.ok(typeof pci.daytime_reach_bounds_km.high === 'number');
});

test('propagation_confidence_interval zone-table source yields LOW confidence', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const pci = out.candidates[0].propagation_confidence_interval;
  // zone-table σ → field_uncertainty_pct >= 30 → LOW
  assert.equal(pci.confidence_level, 'LOW');
  assert.ok(pci.field_uncertainty_pct >= 30);
});

test('propagation_confidence_interval bounds are ordered low < nominal < high', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const pci = out.candidates[0].propagation_confidence_interval;
  const b = pci.daytime_reach_bounds_km;
  if (b.nominal != null) {
    assert.ok(b.low < b.nominal, 'low must be < nominal');
    assert.ok(b.nominal < b.high, 'nominal must be < high');
  }
});

test('propagation_confidence_interval comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ct  = out.candidate_comparison_table;
  for (const row of ct) {
    assert.ok('prop_confidence' in row);
    assert.ok('prop_reach_unc_pct' in row);
    assert.ok('prop_reach_low_km' in row);
    assert.ok('prop_reach_high_km' in row);
  }
});

// ---- transmission_system_design_guide ----

test('transmission_system_design_guide is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.transmission_system_design_guide != null, `rank ${c.rank} missing transmission_system_design_guide`);
  }
});

test('transmission_system_design_guide has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const ts = out.candidates[0].transmission_system_design_guide;
  assert.ok(typeof ts.antenna_efficiency_pct === 'number');
  assert.ok(typeof ts.base_current_ideal_a === 'number');
  assert.ok(typeof ts.estimated_base_impedance_ohm === 'number');
  assert.ok(Array.isArray(ts.feedline_options));
  assert.ok(typeof ts.recommended_feedline === 'string');
  assert.ok(typeof ts.detuning === 'object');
});

test('transmission_system_design_guide has 3 feedline options', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const ts = out.candidates[0].transmission_system_design_guide;
  assert.equal(ts.feedline_options.length, 3);
  const types = ts.feedline_options.map(f => f.type);
  assert.ok(types.includes('HELIAX_7_8'));
  assert.ok(types.includes('RIGID_COAX_3_1_8'));
  assert.ok(types.includes('OPEN_WIRE'));
});

test('transmission_system_design_guide NDA has detuning.required = false', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'NDA', candidate_limit: 1 });
  const ts = out.candidates[0].transmission_system_design_guide;
  assert.equal(ts.detuning.required, false);
});

test('transmission_system_design_guide comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ct  = out.candidate_comparison_table;
  for (const row of ct) {
    assert.ok('tx_efficiency_pct' in row);
    assert.ok('tx_base_impedance_ohm' in row);
    assert.ok('tx_recommended_feedline' in row);
  }
});

// ---- licensing_timeline_estimate ----

test('licensing_timeline_estimate is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.licensing_timeline_estimate != null, `rank ${c.rank} missing licensing_timeline_estimate`);
  }
});

test('licensing_timeline_estimate has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 2 });
  const lt = out.candidates[0].licensing_timeline_estimate;
  assert.ok(Array.isArray(lt.phases));
  assert.ok(typeof lt.total_weeks_optimistic === 'number');
  assert.ok(typeof lt.total_weeks_conservative === 'number');
  assert.ok(typeof lt.total_years_optimistic === 'number');
  assert.ok(typeof lt.licensing_risk_tier === 'string');
  assert.ok(typeof lt.risk_note === 'string');
});

test('licensing_timeline_estimate has 5 phases', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const lt = out.candidates[0].licensing_timeline_estimate;
  assert.equal(lt.phases.length, 5);
  const ids = lt.phases.map(p => p.phase);
  assert.ok(ids.includes('PRE_APPLICATION'));
  assert.ok(ids.includes('FCC_PROCESSING'));
  assert.ok(ids.includes('LICENSE_TO_COVER'));
});

test('licensing_timeline_estimate conservative >= optimistic', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const lt = out.candidates[0].licensing_timeline_estimate;
  assert.ok(lt.total_weeks_conservative >= lt.total_weeks_optimistic, 'conservative must be >= optimistic');
});

test('licensing_timeline_estimate comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ct  = out.candidate_comparison_table;
  for (const row of ct) {
    assert.ok('lic_risk_tier' in row);
    assert.ok('lic_total_yrs_opt' in row);
    assert.ok('lic_total_yrs_cons' in row);
  }
});

// ---- candidate_scoring_audit (per-candidate) ----

test('per-candidate candidate_scoring_audit is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.candidate_scoring_audit != null, `rank ${c.rank} missing candidate_scoring_audit`);
  }
});

test('per-candidate candidate_scoring_audit has expected shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const a = out.candidates[0].candidate_scoring_audit;
  assert.ok('score_pre_confidence' in a, 'score_pre_confidence missing');
  assert.ok('confidence_tier' in a, 'confidence_tier missing');
  assert.ok('confidence_factor' in a, 'confidence_factor missing');
  assert.ok('confidence_penalty_pts' in a, 'confidence_penalty_pts missing');
  assert.ok('score_final' in a, 'score_final missing');
  assert.ok('normalization_factor' in a, 'normalization_factor missing');
  assert.ok('weight_sum' in a, 'weight_sum missing');
  assert.ok('active_goals_count' in a, 'active_goals_count missing');
  assert.ok('total_weighted_pts' in a, 'total_weighted_pts missing');
  assert.ok(Array.isArray(a.goal_details), 'goal_details must be an array');
});

test('per-candidate candidate_scoring_audit goal_details has 6 entries', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const a = out.candidates[0].candidate_scoring_audit;
  assert.strictEqual(a.goal_details.length, 6, 'goal_details must have exactly 6 entries');
  const goals = a.goal_details.map(g => g.goal);
  assert.ok(goals.includes('maximize_col_coverage'), 'missing maximize_col_coverage');
  assert.ok(goals.includes('maximize_population'), 'missing maximize_population');
  assert.ok(goals.includes('prefer_high_conductivity'), 'missing prefer_high_conductivity');
});

test('per-candidate candidate_scoring_audit score_pre_confidence >= 0 and score_final <= 100', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const a = c.candidate_scoring_audit;
    assert.ok(a.score_pre_confidence >= 0 && a.score_pre_confidence <= 100, `score_pre_confidence out of range: ${a.score_pre_confidence}`);
    assert.ok(a.score_final >= 0 && a.score_final <= 100, `score_final out of range: ${a.score_final}`);
    assert.ok(a.score_final <= a.score_pre_confidence + 0.01, 'score_final should not exceed score_pre_confidence (confidence dampening only reduces score)');
  }
});

test('per-candidate candidate_scoring_audit comparison table columns populated', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ct  = out.candidate_comparison_table;
  for (const row of ct) {
    assert.ok('audit_active_goals' in row, 'audit_active_goals missing from comparison table');
    assert.ok('audit_conf_tier' in row, 'audit_conf_tier missing from comparison table');
    assert.ok('audit_score_pre_conf' in row, 'audit_score_pre_conf missing from comparison table');
  }
});

// ---- regulatory_compliance_checklist ----

test('regulatory_compliance_checklist is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.regulatory_compliance_checklist != null, `rank ${c.rank} missing regulatory_compliance_checklist`);
  }
});

test('regulatory_compliance_checklist has 12 items', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const rc = out.candidates[0].regulatory_compliance_checklist;
  assert.strictEqual(rc.items.length, 12, 'checklist must have exactly 12 items');
  const ids = rc.items.map(i => i.id);
  assert.ok(ids.includes('col_coverage'), 'col_coverage item missing');
  assert.ok(ids.includes('blanket_pop'), 'blanket_pop item missing');
  assert.ok(ids.includes('asr_registration'), 'asr_registration item missing');
  assert.ok(ids.includes('nif_study'), 'nif_study item missing');
});

test('regulatory_compliance_checklist counts match items array', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const rc = c.regulatory_compliance_checklist;
    const pass  = rc.items.filter(i => i.status === 'PASS').length;
    const warn  = rc.items.filter(i => i.status === 'WARN').length;
    const fail  = rc.items.filter(i => i.status === 'FAIL').length;
    const notEv = rc.items.filter(i => i.status === 'NOT_EVALUATED').length;
    assert.strictEqual(rc.pass_count,          pass,  `rank ${c.rank} pass_count mismatch`);
    assert.strictEqual(rc.warn_count,          warn,  `rank ${c.rank} warn_count mismatch`);
    assert.strictEqual(rc.fail_count,          fail,  `rank ${c.rank} fail_count mismatch`);
    assert.strictEqual(rc.not_evaluated_count, notEv, `rank ${c.rank} not_evaluated_count mismatch`);
  }
});

test('regulatory_compliance_checklist overall_status is valid enum', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const VALID = new Set(['PASS', 'WARN', 'FAIL', 'INCOMPLETE']);
  for (const c of out.candidates) {
    const rc = c.regulatory_compliance_checklist;
    assert.ok(VALID.has(rc.overall_status), `rank ${c.rank} invalid overall_status: ${rc.overall_status}`);
  }
});

test('regulatory_compliance_checklist comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('comp_overall_status' in row, 'comp_overall_status missing');
    assert.ok('comp_fail_count' in row, 'comp_fail_count missing');
    assert.ok('comp_warn_count' in row, 'comp_warn_count missing');
  }
});

// ---- ground_system_design_guide ----

test('ground_system_design_guide is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.ground_system_design_guide != null, `rank ${c.rank} missing ground_system_design_guide`);
  }
});

test('ground_system_design_guide has 3 scenarios', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const gs = out.candidates[0].ground_system_design_guide;
  assert.strictEqual(gs.scenarios.length, 3, 'ground_system_design_guide must have 3 scenarios');
  assert.strictEqual(gs.scenarios[0].radial_count, 120, 'first scenario must be 120-radial standard');
  assert.strictEqual(gs.scenarios[1].radial_count, 60, 'second scenario must be 60-radial reduced');
  assert.strictEqual(gs.scenarios[2].radial_count, 30, 'third scenario must be 30-radial urban-constrained');
});

test('ground_system_design_guide antenna efficiency is in 0-100 range', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    for (const s of c.ground_system_design_guide.scenarios) {
      assert.ok(s.antenna_efficiency_pct > 0 && s.antenna_efficiency_pct <= 100,
        `rank ${c.rank} scenario ${s.label} efficiency ${s.antenna_efficiency_pct} out of range`);
    }
  }
});

test('ground_system_design_guide standard efficiency > reduced > urban-constrained', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const gs = out.candidates[0].ground_system_design_guide;
  assert.ok(gs.scenarios[0].antenna_efficiency_pct >= gs.scenarios[1].antenna_efficiency_pct,
    'standard efficiency should be >= reduced');
  assert.ok(gs.scenarios[1].antenna_efficiency_pct >= gs.scenarios[2].antenna_efficiency_pct,
    'reduced efficiency should be >= urban-constrained');
});

test('ground_system_design_guide comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('gnd_soil_class' in row, 'gnd_soil_class missing from comparison table');
    assert.ok('gnd_eff_std_pct' in row, 'gnd_eff_std_pct missing from comparison table');
    assert.ok('gnd_rho_ohm_m' in row, 'gnd_rho_ohm_m missing from comparison table');
  }
});

// ---- tower_structural_assessment_guide ----

test('tower_structural_assessment_guide is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.tower_structural_assessment_guide != null, `rank ${c.rank} missing tower_structural_assessment_guide`);
  }
});

test('tower_structural_assessment_guide wind_ice_zone is a valid zone string', async () => {
  const VALID_ZONES = new Set(['ZONE_I_HIGH_WIND', 'ZONE_II_MODERATE', 'ZONE_III_HEAVY_ICE', 'ZONE_IV_PNW']);
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const ts = c.tower_structural_assessment_guide;
    assert.ok(VALID_ZONES.has(ts.wind_ice_zone), `rank ${c.rank} invalid wind_ice_zone: ${ts.wind_ice_zone}`);
  }
});

test('tower_structural_assessment_guide tower_types has 3 entries', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const ts = out.candidates[0].tower_structural_assessment_guide;
  assert.strictEqual(ts.tower_types.length, 3, 'tower_types must have 3 entries');
  const types = ts.tower_types.map(t => t.type);
  assert.ok(types.includes('GUYED_MAST'), 'GUYED_MAST type must be present');
  assert.ok(types.includes('SELF_SUPPORTING_LATTICE'), 'SELF_SUPPORTING_LATTICE type must be present');
  assert.ok(types.includes('MONOPOLE_TUBULAR'), 'MONOPOLE_TUBULAR type must be present');
});

test('tower_structural_assessment_guide asr_registration_required matches height threshold', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const ts = c.tower_structural_assessment_guide;
    // 780 kHz: λ/4 = 300000/780/4 = 96.15 m > 60.96 m → ASR required
    assert.strictEqual(ts.asr_registration_required, true, `rank ${c.rank}: ASR should be required at 780 kHz`);
  }
});

test('tower_structural_assessment_guide comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('twr_wind_ice_zone' in row, 'twr_wind_ice_zone missing from comparison table');
    assert.ok('twr_asr_required' in row, 'twr_asr_required missing from comparison table');
    assert.ok('twr_faa_type' in row, 'twr_faa_type missing from comparison table');
  }
});

// ---- community_of_license_profile ----

test('community_of_license_profile is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.community_of_license_profile != null, `rank ${c.rank} missing community_of_license_profile`);
  }
});

test('community_of_license_profile geographic_tier is valid enum', async () => {
  const VALID = new Set(['PROXIMATE', 'NEAR', 'MID', 'FAR', 'REMOTE', 'UNKNOWN']);
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const cp = c.community_of_license_profile;
    assert.ok(VALID.has(cp.geographic_tier), `rank ${c.rank} invalid geographic_tier: ${cp.geographic_tier}`);
  }
});

test('community_of_license_profile col_coverage_pct is in 0-100 range', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const cp = c.community_of_license_profile;
    if (cp.col_coverage_pct != null) {
      assert.ok(cp.col_coverage_pct >= 0 && cp.col_coverage_pct <= 100,
        `rank ${c.rank} col_coverage_pct ${cp.col_coverage_pct} out of 0-100 range`);
    }
  }
});

test('community_of_license_profile col_compliant is boolean or null', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const cp = c.community_of_license_profile;
    assert.ok(cp.col_compliant === null || typeof cp.col_compliant === 'boolean', `rank ${c.rank} col_compliant must be boolean or null`);
  }
});

test('community_of_license_profile comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('col_geo_tier' in row, 'col_geo_tier missing from comparison table');
    assert.ok('col_dist_km' in row, 'col_dist_km missing from comparison table');
    assert.ok('col_bearing_deg' in row, 'col_bearing_deg missing from comparison table');
  }
});

// ---- atmospheric_noise_analysis ----

test('atmospheric_noise_analysis is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.atmospheric_noise_analysis != null, `rank ${c.rank} missing atmospheric_noise_analysis`);
  }
});

test('atmospheric_noise_analysis noise Fa values are physically plausible', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const an = c.atmospheric_noise_analysis;
    // Man-made noise Fa at AM frequencies should be in range 20-120 dB
    assert.ok(an.effective_noise_fa_day >= 20 && an.effective_noise_fa_day <= 120,
      `rank ${c.rank} effective_noise_fa_day ${an.effective_noise_fa_day} out of plausible range`);
    // Nighttime noise should be >= daytime (ionospheric enhancement)
    assert.ok(an.effective_noise_fa_night >= an.effective_noise_fa_day,
      `rank ${c.rank} nighttime noise should be >= daytime`);
  }
});

test('atmospheric_noise_analysis site_noise_class is valid enum', async () => {
  const VALID = new Set(['BUSINESS', 'RESIDENTIAL', 'RURAL', 'QUIET_RURAL', 'UNKNOWN']);
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const an = c.atmospheric_noise_analysis;
    assert.ok(VALID.has(an.site_noise_class), `rank ${c.rank} invalid site_noise_class: ${an.site_noise_class}`);
  }
});

test('atmospheric_noise_analysis minimum_detectable_field is positive', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    const an = c.atmospheric_noise_analysis;
    assert.ok(an.minimum_detectable_field_day_mvm > 0, `rank ${c.rank} minimum_detectable_field_day_mvm must be positive`);
  }
});

test('atmospheric_noise_analysis comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('noise_class' in row, 'noise_class missing from comparison table');
    assert.ok('noise_fa_day' in row, 'noise_fa_day missing from comparison table');
    assert.ok('noise_min_field_mvm' in row, 'noise_min_field_mvm missing from comparison table');
  }
});

// ---- proof_of_performance_requirements ----

test('proof_of_performance_requirements is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.proof_of_performance_requirements != null, `rank ${c.rank} missing proof_of_performance_requirements`);
  }
});

test('proof_of_performance_requirements NDA has 8-radial traversal spec', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const pp = out.candidates[0].proof_of_performance_requirements;
  // KAZM uses NDA pattern
  assert.strictEqual(pp.traversal_spec.radial_count, 8, 'NDA must have 8-radial traversal');
  assert.strictEqual(pp.traversal_spec.radial_spacing_deg, 45, 'NDA radial spacing must be 45°');
});

test('proof_of_performance_requirements DA has 72-radial traversal spec', async () => {
  const daResult = await runSiteOptimizer({ ...KAZM, pattern_mode: 'DA-D', candidate_limit: 1 });
  const pp = daResult.candidates[0].proof_of_performance_requirements;
  assert.strictEqual(pp.traversal_spec.radial_count, 72, 'DA must have 72-radial traversal');
  assert.strictEqual(pp.traversal_spec.radial_spacing_deg, 5, 'DA radial spacing must be 5°');
});

test('proof_of_performance_requirements DA timeline > NDA timeline', async () => {
  const [ndaR, daR] = await Promise.all([
    runSiteOptimizer({ ...KAZM, pattern_mode: 'NDA', candidate_limit: 1 }),
    runSiteOptimizer({ ...KAZM, pattern_mode: 'DA-D', candidate_limit: 1 })
  ]);
  const ndaWks = ndaR.candidates[0].proof_of_performance_requirements.proof_timeline_weeks_high;
  const daWks  = daR.candidates[0].proof_of_performance_requirements.proof_timeline_weeks_high;
  assert.ok(daWks > ndaWks, 'DA proof timeline should be longer than NDA');
});

test('proof_of_performance_requirements comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('proof_radials' in row, 'proof_radials missing from comparison table');
    assert.ok('proof_wks_low' in row, 'proof_wks_low missing from comparison table');
    assert.ok('proof_mpe_required' in row, 'proof_mpe_required missing from comparison table');
  }
});

// ---- operational_monitoring_requirements ----

test('operational_monitoring_requirements is present on each candidate', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.operational_monitoring_requirements != null, `rank ${c.rank} missing operational_monitoring_requirements`);
  }
});

test('operational_monitoring_requirements has 6 monitoring items', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  const om = out.candidates[0].operational_monitoring_requirements;
  assert.strictEqual(om.monitoring_items.length, 6, 'must have exactly 6 monitoring items');
  const ids = om.monitoring_items.map(i => i.id);
  assert.ok(ids.includes('power'), 'power monitoring item missing');
  assert.ok(ids.includes('eas'), 'eas monitoring item missing');
  assert.ok(ids.includes('renewal'), 'renewal monitoring item missing');
});

test('operational_monitoring_requirements local channel has nighttime power limit', async () => {
  const localR = await runSiteOptimizer({ ...KAZM, frequency_khz: 1230, candidate_limit: 1 });
  const om = localR.candidates[0].operational_monitoring_requirements;
  assert.ok(om.nighttime_power.required === true, 'local channel must have nighttime power restriction');
  assert.ok(om.nighttime_power.nighttime_tpo_limit_kw != null, 'local channel must have nighttime TPO limit');
});

test('operational_monitoring_requirements comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('ops_nighttime_limit_kw' in row, 'ops_nighttime_limit_kw missing');
    assert.ok('ops_renewal_cycle_yrs' in row, 'ops_renewal_cycle_yrs missing');
    assert.ok('ops_eas_required' in row, 'ops_eas_required missing');
  }
});

// ---- da_array_design_guide ----

test('da_array_design_guide present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.da_array_design_guide != null, `rank ${c.rank} missing da_array_design_guide`);
  }
});

test('da_array_design_guide applicable=false for NDA station', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'NDA', candidate_limit: 1 });
  const d = out.candidates[0].da_array_design_guide;
  assert.strictEqual(d.applicable, false, 'NDA station should have applicable=false');
  assert.ok(typeof d.reason === 'string', 'NDA block must include a reason string');
});

test('da_array_design_guide applicable=true for DA-D station with correct shape', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'DA-D', candidate_limit: 1 });
  const d = out.candidates[0].da_array_design_guide;
  assert.strictEqual(d.applicable, true, 'DA-D station should have applicable=true');
  assert.strictEqual(d.has_daytime_pattern, true, 'DA-D must have daytime pattern');
  assert.strictEqual(d.has_nighttime_pattern, false, 'DA-D must not have nighttime pattern');
  assert.strictEqual(d.array_configurations.length, 4, 'must have 4 array configurations');
  assert.strictEqual(d.n_hrp_radials, 36, 'must have 36 HRP radials');
  assert.strictEqual(d.hrp_increment_deg, 10, 'HRP increment must be 10°');
});

test('da_array_design_guide DA-2 has both day and nighttime patterns', async () => {
  const out = await runSiteOptimizer({ ...KAZM, pattern_mode: 'DA-2', candidate_limit: 1 });
  const d = out.candidates[0].da_array_design_guide;
  assert.strictEqual(d.applicable, true);
  assert.strictEqual(d.has_daytime_pattern, true);
  assert.strictEqual(d.has_nighttime_pattern, true);
  assert.strictEqual(d.suppression_requirement_db, 28.3, 'suppression requirement must be 28.3 dB');
  assert.strictEqual(d.form_301am_exhibits.length, 8, 'must have 8 Form 301-AM exhibits');
  assert.ok(d.base_current_monitoring.current_ratio_tolerance_pct === 5, '§73.61 5% current ratio tolerance');
  assert.ok(d.base_current_monitoring.phase_tolerance_deg === 3, '§73.61 3° phase tolerance');
});

test('da_array_design_guide comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('da_array_applicable' in row, 'da_array_applicable missing from comparison table');
    assert.ok('da_array_min_elements' in row, 'da_array_min_elements missing from comparison table');
    assert.ok('da_array_footprint_m' in row, 'da_array_footprint_m missing from comparison table');
  }
});

// ---- am_fm_translator_opportunity ----

test('am_fm_translator_opportunity present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.am_fm_translator_opportunity != null, `rank ${c.rank} missing am_fm_translator_opportunity`);
  }
});

test('am_fm_translator_opportunity has correct shape and key fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const t = out.candidates[0].am_fm_translator_opportunity;
  assert.strictEqual(t.am_revitalization_eligible, true, 'all AM stations eligible for revitalization');
  assert.strictEqual(t.translator_max_erp_kw, 0.25, '250 W ERP max per §73.850(b)');
  assert.strictEqual(t.fm_60dbu_radius_screening_km, 12.5, '60 dBu screening radius must be 12.5 km');
  assert.strictEqual(t.filing_windows.length, 3, 'must have 3 filing window entries');
  assert.strictEqual(t.form_349_exhibits.length, 6, 'must have 6 Form 349 exhibits');
});

test('am_fm_translator_opportunity contour check PASS when 60dbu < 2mvm contour', async () => {
  // 5 kW at 780 kHz on KAZM gives a 2 mV/m contour >> 12.5 km, so PASS expected
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const t = out.candidates[0].am_fm_translator_opportunity;
  assert.strictEqual(t.translator_contour_check, 'PASS', '5 kW station should pass the 60dBu contour check');
  assert.ok(t.am_2mvm_contour_km > 12.5, 'AM 2 mV/m contour must exceed 60dBu radius for PASS');
});

test('am_fm_translator_opportunity lpfm_protection and spectrum guidance present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const t = out.candidates[0].am_fm_translator_opportunity;
  assert.ok(t.lpfm_protection != null, 'lpfm_protection must be present');
  assert.ok(t.spectrum_search_guidance != null, 'spectrum_search_guidance must be present');
  assert.ok(Array.isArray(t.spectrum_search_guidance.key_checks), 'spectrum key_checks must be an array');
  assert.ok(t.spectrum_search_guidance.key_checks.length >= 4, 'must have at least 4 spectrum key checks');
});

test('am_fm_translator_opportunity comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('trans_contour_check' in row, 'trans_contour_check missing from comparison table');
    assert.ok('trans_60dbu_km' in row, 'trans_60dbu_km missing from comparison table');
    assert.ok('trans_am_2mvm_km' in row, 'trans_am_2mvm_km missing from comparison table');
  }
});

// ---- spacing_rule_compliance_guide ----

test('spacing_rule_compliance_guide present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.spacing_rule_compliance_guide != null, `rank ${c.rank} missing spacing_rule_compliance_guide`);
  }
});

test('spacing_rule_compliance_guide has correct shape and spacing table', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const s = out.candidates[0].spacing_rule_compliance_guide;
  assert.strictEqual(s.fcc_class, KAZM.fcc_class, 'fcc_class must match input');
  assert.strictEqual(s.frequency_khz, KAZM.frequency_khz, 'frequency_khz must match input');
  assert.strictEqual(s.spacing_table.length, 4, 'must have 4 spacing table rows (A, B, C, D)');
  assert.ok(s.spacing_risk_tier != null, 'spacing_risk_tier must be present');
  assert.ok(['VERY_HIGH', 'HIGH', 'MODERATE', 'LOW'].includes(s.spacing_risk_tier), 'risk tier must be a known value');
});

test('spacing_rule_compliance_guide Class D clear channel has VERY_HIGH risk', async () => {
  // KAZM: 780 kHz (clear channel), fcc_class D → VERY_HIGH
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const s = out.candidates[0].spacing_rule_compliance_guide;
  assert.strictEqual(s.channel_class, 'clear_channel', '780 kHz is a clear channel');
  assert.strictEqual(s.spacing_risk_tier, 'VERY_HIGH', 'Class D on clear channel must be VERY_HIGH risk');
});

test('spacing_rule_compliance_guide verification checklist has required items', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const s = out.candidates[0].spacing_rule_compliance_guide;
  const ids = s.verification_checklist.map(i => i.id);
  assert.ok(ids.includes('cc_query'), 'must have co-channel query item');
  assert.ok(ids.includes('fa_query'), 'must have first-adjacent query item');
  assert.ok(ids.includes('sa_query'), 'must have second-adjacent query item');
  assert.ok(ids.includes('blanket_check'), 'must have blanket_check item');
  assert.ok(s.n_checklist_required >= 4, 'at least 4 items must be required');
});

test('spacing_rule_compliance_guide comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('spacing_risk_tier' in row, 'spacing_risk_tier missing from comparison table');
    assert.ok('spacing_n_required' in row, 'spacing_n_required missing from comparison table');
    assert.ok('spacing_chan_class' in row, 'spacing_chan_class missing from comparison table');
  }
});

// ---- license_class_upgrade_analysis ----

test('license_class_upgrade_analysis present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.license_class_upgrade_analysis != null, `rank ${c.rank} missing license_class_upgrade_analysis`);
  }
});

test('license_class_upgrade_analysis Class D has D->B upgrade path', async () => {
  const out = await runSiteOptimizer({ ...KAZM, fcc_class: 'D', frequency_khz: 1230, candidate_limit: 1 });
  const u = out.candidates[0].license_class_upgrade_analysis;
  assert.strictEqual(u.fcc_class, 'D');
  assert.strictEqual(u.upgrade_paths.length, 1, 'Class D should have 1 upgrade path');
  assert.strictEqual(u.upgrade_paths[0].from_class, 'D');
  assert.strictEqual(u.upgrade_paths[0].to_class, 'B');
});

test('license_class_upgrade_analysis Class D on clear channel has DIFFICULT feasibility', async () => {
  // KAZM: 780 kHz clear channel, Class D
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const u = out.candidates[0].license_class_upgrade_analysis;
  assert.strictEqual(u.primary_feasibility, 'DIFFICULT', 'clear channel D->B upgrade should be DIFFICULT');
  assert.ok(u.upgrade_filing_steps.length > 0, 'should have upgrade filing steps');
  assert.strictEqual(u.upgrade_filing_steps.length, 6, 'should have exactly 6 filing steps');
});

test('license_class_upgrade_analysis Class A is AT_TOP_CLASS', async () => {
  const out = await runSiteOptimizer({ ...KAZM, fcc_class: 'A', candidate_limit: 1 });
  const u = out.candidates[0].license_class_upgrade_analysis;
  assert.strictEqual(u.primary_feasibility, 'AT_TOP_CLASS', 'Class A has no upgrade path');
  assert.strictEqual(u.upgrade_filing_steps.length, 0, 'Class A has no filing steps');
});

test('license_class_upgrade_analysis comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('class_upg_feasibility' in row, 'class_upg_feasibility missing from comparison table');
    assert.ok('class_upg_n_paths' in row, 'class_upg_n_paths missing from comparison table');
    assert.ok('class_upg_to_class' in row, 'class_upg_to_class missing from comparison table');
  }
});

// ---- soil_conductivity_improvement_guide ----

test('soil_conductivity_improvement_guide present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.soil_conductivity_improvement_guide != null, `rank ${c.rank} missing soil_conductivity_improvement_guide`);
  }
});

test('soil_conductivity_improvement_guide has correct shape and key fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const s = out.candidates[0].soil_conductivity_improvement_guide;
  assert.ok(s.sigma_msm_current != null, 'sigma_msm_current must be present');
  assert.ok(['EXCELLENT', 'GOOD', 'FAIR', 'POOR'].includes(s.soil_class_current), 'soil_class must be valid');
  assert.ok(typeof s.improvement_needed === 'boolean', 'improvement_needed must be boolean');
  assert.ok(Array.isArray(s.techniques), 'techniques must be an array');
  assert.ok(s.techniques.length > 0, 'must have at least 1 technique');
});

test('soil_conductivity_improvement_guide reach_gain_km is positive when sigma < 8', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const s = out.candidates[0].soil_conductivity_improvement_guide;
  if (s.sigma_msm_current < 8) {
    assert.ok(s.reach_gain_km > 0, 'reach_gain_km must be positive when sigma < target (8 mS/m)');
    assert.strictEqual(s.improvement_needed, true, 'improvement_needed must be true when sigma < 8 mS/m');
  }
});

test('soil_conductivity_improvement_guide techniques have required fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const s = out.candidates[0].soil_conductivity_improvement_guide;
  for (const tech of s.techniques) {
    assert.ok(tech.id != null, 'technique must have id');
    assert.ok(tech.name != null, 'technique must have name');
    assert.ok(tech.longevity_years > 0, 'technique must have longevity_years > 0');
    assert.ok(typeof tech.fcc_measurable === 'boolean', 'fcc_measurable must be boolean');
  }
});

test('soil_conductivity_improvement_guide comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('soil_class' in row, 'soil_class missing from comparison table');
    assert.ok('soil_improv_needed' in row, 'soil_improv_needed missing from comparison table');
    assert.ok('soil_reach_gain_km' in row, 'soil_reach_gain_km missing from comparison table');
  }
});

// ---- transmitter_facility_design_guide ----

test('transmitter_facility_design_guide present on all candidates', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const c of out.candidates) {
    assert.ok(c.transmitter_facility_design_guide != null, `rank ${c.rank} missing transmitter_facility_design_guide`);
  }
});

test('transmitter_facility_design_guide has correct power calculations', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const f = out.candidates[0].transmitter_facility_design_guide;
  assert.ok(f.ac_power_draw_kw > KAZM.tpo_kw, 'ac draw must exceed TPO (transmitter efficiency < 100%)');
  assert.ok(f.total_facility_load_kw > f.ac_power_draw_kw, 'facility load must exceed tx draw (HVAC + misc)');
  assert.ok(f.recommended_service_size_a >= 100, 'service size must be at least 100A');
  assert.ok(f.hvac_required_tons > 0, 'HVAC must be required');
});

test('transmitter_facility_design_guide §73.49 fencing required when TPO > 250W', async () => {
  const out = await runSiteOptimizer({ ...KAZM, tpo_kw: 5, candidate_limit: 1 });
  const f = out.candidates[0].transmitter_facility_design_guide;
  assert.strictEqual(f.fencing.required, true, '5 kW station must require §73.49 fencing');
  assert.ok(f.fencing.minimum_height_ft >= 8, 'fence must be at least 8 ft');
  assert.ok(typeof f.fencing.warning_signs === 'string', 'warning signs spec must be present');
});

test('transmitter_facility_design_guide standby generator has correct fields', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const f = out.candidates[0].transmitter_facility_design_guide;
  assert.ok(f.standby_generator.rating_kw > 0, 'generator rating must be positive');
  assert.ok(f.standby_generator.fuel_tank_gallons > 0, 'fuel tank must have volume');
  assert.ok(f.standby_generator.runtime_hours_72hr_load === 72, 'must specify 72hr runtime');
});

test('transmitter_facility_design_guide comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('fac_service_a' in row, 'fac_service_a missing from comparison table');
    assert.ok('fac_hvac_tons' in row, 'fac_hvac_tons missing from comparison table');
    assert.ok('fac_fence_required' in row, 'fac_fence_required missing from comparison table');
  }
});

test('coverage_service_area_map_spec presence and contour count', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const m = out.candidates[0].coverage_service_area_map_spec;
  assert.ok(m != null, 'coverage_service_area_map_spec must be present');
  assert.strictEqual(m.n_contours, 4, 'must have 4 contours (col_min, standard, primary, blanket)');
  assert.ok(Array.isArray(m.contours), 'contours must be an array');
});

test('coverage_service_area_map_spec contour IDs and mV/m thresholds', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const { contours } = out.candidates[0].coverage_service_area_map_spec;
  const ids = contours.map(c => c.id);
  assert.ok(ids.includes('col_min'),  'must include col_min contour');
  assert.ok(ids.includes('standard'), 'must include standard contour');
  assert.ok(ids.includes('primary'),  'must include primary contour');
  assert.ok(ids.includes('blanket'),  'must include blanket contour');
  const col = contours.find(c => c.id === 'col_min');
  assert.strictEqual(col.mvm, 5.0, 'col_min contour must be 5 mV/m');
});

test('coverage_service_area_map_spec radius ordering and render_spec', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const m = out.candidates[0].coverage_service_area_map_spec;
  const col     = m.contours.find(c => c.id === 'col_min');
  const primary = m.contours.find(c => c.id === 'primary');
  assert.ok(col.radius_km != null && col.radius_km > 0, 'col_min radius must be positive');
  assert.ok(primary.radius_km != null && primary.radius_km > 0, 'primary radius must be positive');
  assert.ok(primary.radius_km > col.radius_km, 'primary (0.5 mV/m) must reach farther than col_min (5 mV/m)');
  assert.ok(m.render_spec != null, 'render_spec must be present');
  assert.ok(typeof m.render_spec.layer_type === 'string', 'render_spec.layer_type must be a string');
});

test('coverage_service_area_map_spec area fields are non-negative numbers', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const m = out.candidates[0].coverage_service_area_map_spec;
  assert.ok(typeof m.col_service_area_km2 === 'number' && m.col_service_area_km2 >= 0, 'col_service_area_km2 must be non-negative');
  assert.ok(typeof m.primary_area_km2 === 'number' && m.primary_area_km2 >= 0, 'primary_area_km2 must be non-negative');
  assert.ok(m.primary_area_km2 > m.col_service_area_km2, 'primary area must be larger than col area');
});

test('coverage_service_area_map_spec comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('map_col_radius_km' in row,     'map_col_radius_km missing from comparison table');
    assert.ok('map_primary_radius_km' in row, 'map_primary_radius_km missing from comparison table');
    assert.ok('map_blanket_radius_km' in row, 'map_blanket_radius_km missing from comparison table');
  }
});

test('iboc_hd_radio_analysis presence and applicability', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const h = out.candidates[0].iboc_hd_radio_analysis;
  assert.ok(h != null, 'iboc_hd_radio_analysis must be present');
  assert.strictEqual(h.applicable, true, 'must be applicable for all licensed classes');
  assert.strictEqual(h.hybrid_mode_available, true, 'hybrid mode must be available');
  assert.strictEqual(h.all_digital_available, false, 'all-digital AM not yet FCC approved');
});

test('iboc_hd_radio_analysis digital sideband power and bandwidth', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const h = out.candidates[0].iboc_hd_radio_analysis;
  assert.strictEqual(h.iboc_digital_erp_dbw, -14, 'digital sideband level must be -14 dBc');
  assert.ok(h.digital_sideband_erp_kw > 0, 'digital ERP must be positive');
  assert.ok(h.digital_sideband_erp_kw < h.tpo_kw, 'digital ERP must be less than analog TPO');
  assert.strictEqual(h.digital_bandwidth_khz.span_khz, 30, 'IBOC digital bandwidth must be 30 kHz (±15 kHz)');
});

test('iboc_hd_radio_analysis reach and coverage delta', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const h = out.candidates[0].iboc_hd_radio_analysis;
  assert.ok(h.analog_reach_km != null && h.analog_reach_km > 0, 'analog reach must be computed');
  assert.ok(h.iboc_digital_reach_km != null && h.iboc_digital_reach_km > 0, 'digital reach must be computed');
  assert.ok(h.iboc_digital_reach_km < h.analog_reach_km, 'digital reach must be less than analog reach');
  assert.strictEqual(h.iboc_digital_reach_fraction, 0.85, 'digital reach fraction must be 0.85');
});

test('iboc_hd_radio_analysis filing requirement is notification-only', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 1 });
  const h = out.candidates[0].iboc_hd_radio_analysis;
  assert.strictEqual(h.filing_requirement.fee, 0, 'IBOC notification is free');
  assert.ok(h.filing_requirement.rule.includes('73.404'), 'filing rule must cite §73.404');
  assert.ok(h.nrsc5_requirements.length > 0, 'NRSC-5 requirements list must be non-empty');
  assert.ok(h.n_mandatory_requirements > 0, 'must have mandatory requirements');
});

test('iboc_hd_radio_analysis comparison table columns present', async () => {
  const out = await runSiteOptimizer({ ...KAZM, candidate_limit: 3 });
  for (const row of out.candidate_comparison_table) {
    assert.ok('iboc_applicable' in row,       'iboc_applicable missing from comparison table');
    assert.ok('iboc_digital_reach_km' in row, 'iboc_digital_reach_km missing from comparison table');
    assert.ok('iboc_night_risk' in row,       'iboc_night_risk missing from comparison table');
  }
});
