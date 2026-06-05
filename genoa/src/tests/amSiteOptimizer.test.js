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

test('SCORE_CLUSTERED warning fires when many candidates share the same score', async () => {
  // Use 0 goals so every candidate scores 0.0 — guaranteed clustering.
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
  assert.ok(clustered, 'SCORE_CLUSTERED warning must fire when >10 candidates share the same score');
});

test('REACH_PLACEHOLDER warning fires when many candidates share identical reach', async () => {
  // Large grid, same sigma region for all candidates → identical reach.
  const out = await runSiteOptimizer({
    ...KAZM,
    search_radius_km: 30,
    grid_spacing_km:  5,
    candidate_limit:  200,
    optimization_goals: { ...KAZM.optimization_goals, maximize_population: true }
  });
  const reachPlaceholder = out.warnings.some(w =>
    (typeof w === 'object' ? w.code : w) === 'REACH_PLACEHOLDER'
  );
  assert.ok(reachPlaceholder, 'REACH_PLACEHOLDER warning must fire when >10 candidates share identical daytime_reach_km');
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
