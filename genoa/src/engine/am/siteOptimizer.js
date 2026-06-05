// AM Regional Relocation Optimizer — screening-grade candidate ranking.
//
// PURPOSE
//   An AM licensee whose current site is becoming untenable (lease,
//   zoning, wildfire risk, environmental, etc.) needs to evaluate
//   candidate relocation sites within a regional radius BEFORE
//   committing engineering resources to a single design.  This module
//   builds a grid of candidate sites around the current location,
//   scores each one against a configurable set of optimization goals,
//   and returns a ranked list with per-candidate explainability.
//
// WHAT THIS IS NOT
//   This is a SCREENING tool.  Every candidate carries an
//   "ENGINEER REVIEW REQUIRED" label and the response is explicitly
//   tagged "SCREENING ONLY" — the output is intended to help an
//   engineer narrow the search to 3-5 promising sites that then get
//   the real full-physics treatment (skywave NIF contour, §73.182
//   nighttime, DA-N pattern design, parcel availability, environmental
//   review, treaty consultation if applicable, etc.).
//
// PURITY
//   No IO except calling fccAmDistanceKm() from the vendored FCC
//   gwave path for groundwave distance estimates.  Deterministic on
//   the same inputs.
//
// REFERENCES
//   - 47 CFR §73.24(g) blanket-interference 1% population limit
//   - 47 CFR §73.24(j) principal community 5 mV/m coverage rule
//   - 47 CFR §73.184 groundwave method (FCC gwave.js)
//   - US/Mexico AM Agreement (1986); US/Canada AM treaty

import { fccAmDistanceKm } from '../curves/fcc/index.mjs';
import { detectInternationalBorder } from '../regulatory/internationalBorderDetect.js';
import { lookupM3Conductivity, lookupM3ZoneFallback, m3LoadStatus } from './m3.js';

// ---------- thresholds & weights ----------

// Hard non-compliance bars.  Failing any of these flags a candidate
// NON-COMPLIANT and excludes it from the PROMISING pool (§73.24 floors).
const COL_COVERAGE_HARD_FLOOR    = 0.80;   // §73.24(j) substantial-compliance threshold
const BLANKET_POP_HARD_CEIL_PCT  = 1.0;    // §73.24(g) 1% limit on persons inside 1000 mV/m
const PROMISING_TOP_QUANTILE     = 0.75;   // top 25% of score → PROMISING (and no NON-COMPLIANT)

// Treaty-zone soft bias (when minimize_int_treaty_zone is enabled).
const TREATY_ZONE_PENALTY_KM_MX  = 320;    // 1986 US/MX agreement applicability outer band
const TREATY_ZONE_PENALTY_KM_CA  = 800;    // US/CA letter of understanding outer band

// Groundwave target field for "daytime reach" estimate (mV/m).  0.5 mV/m
// is the §73.24 default secondary daytime contour — what the operator
// generally cares about for "how far does my station reach."
const DAYTIME_REACH_TARGET_MVM = 0.5;

// Conductivity target — M3-zone high end is 8 mS/m (rule §73.184).
const SIGMA_PREFERRED_MIN_MSM = 8;

// Earth radius for great-circle math (mean, km).
const R_EARTH_KM = 6371.0088;

// Blanket-population proxy constants.
// §73.24(g) requires people inside the 1000 mV/m contour be < 1% of US population.
// We estimate via: (blanket area km²) × (regional density ppl/km²) / US_POPULATION * 100.
// "Regional density" is the US national average — rural/suburban bias is handled by the
// distance-from-city surrogate in the scoreCandidate function.
const US_POPULATION_M = 335e6;                    // 2024 US population (persons)
const US_AVG_POP_DENSITY_PER_KM2 = 34.0;          // national avg (USCB, 2023)

// Goals enum — these are the keys the API exposes.  The set is fixed;
// unknown keys in the request are ignored (forward-compatibility for UI).
const KNOWN_GOALS = Object.freeze([
  'maximize_col_coverage',
  'maximize_population',
  'minimize_blanket_population',
  'avoid_wildfire_risk',
  'prefer_high_conductivity',
  'minimize_int_treaty_zone'
]);

// Goals that are placeholders for the screening-grade pipeline; if
// enabled, surface them in the candidate's limitations[] so the
// operator knows the sub-score isn't backed by real data yet.
const PLACEHOLDER_GOALS = Object.freeze({
  avoid_wildfire_risk: 'Wildfire / fuel-risk scoring not yet wired (USFS FIA / LANDFIRE integration deferred)',
});

// Status-label vocabulary.
const LABEL_SCREENING        = 'SCREENING ONLY';
const LABEL_PROMISING        = 'PROMISING';
const LABEL_NON_COMPLIANT    = 'NON-COMPLIANT';
const LABEL_REVIEW_REQUIRED  = 'REVIEW REQUIRED';
const LABEL_ENGINEER_REVIEW  = 'ENGINEER REVIEW REQUIRED';
const LABEL_NOT_EVALUATED    = 'NOT-EVALUATED';

// ---------- public API ----------

/**
 * Run the site optimizer.
 *
 * @param {object} body              the POST body — see route file for shape.
 * @param {string} body.callsign
 * @param {number} body.frequency_khz
 * @param {{lat:number,lon:number}} body.current_site
 * @param {number} body.search_radius_km
 * @param {number} body.grid_spacing_km
 * @param {number} body.tpo_kw       transmitter power output (kW)
 * @param {string} body.pattern_mode 'NDA' | 'DA-D' | 'DA-N' | 'DA-2' | …
 * @param {string} body.fcc_class    'A' | 'B' | 'C' | 'D'
 * @param {object} [body.community_of_license_polygon]  GeoJSON Polygon (optional)
 * @param {object} body.optimization_goals  flags — see KNOWN_GOALS
 * @param {object} [body.candidate_limit]   how many ranked results to return (default 20)
 *
 * @returns {{
 *   available:boolean,
 *   n_candidates_evaluated:number,
 *   n_candidates_returned:number,
 *   current_site_baseline:object,
 *   candidates:object[],
 *   inputs_echo:object,
 *   warnings:string[],
 *   method:string
 * }}
 */
export async function runSiteOptimizer(body = {}){
  const warnings = [];

  // ---- 1. validate & echo inputs ----
  const v = validateInputs(body, warnings);
  if (!v.ok){
    return { available: false, error: v.error, inputs_echo: body };
  }
  const {
    callsign, frequency_khz, current_site, search_radius_km,
    grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
    community_of_license_polygon, goals, candidate_limit
  } = v.value;

  // ---- 2. build candidate grid ----
  const gridPoints = buildGridCandidates({
    center: current_site,
    radius_km: search_radius_km,
    spacing_km: grid_spacing_km
  });

  // Always include the current site as the first candidate so the
  // operator can see how their existing location scores under the
  // same rubric (the "baseline").
  ensureCurrentSiteIncluded(gridPoints, current_site);

  const scoringStart = Date.now();

  // ---- 3. score every candidate ----
  // Compute reach_scale_km once: the maximum daytime reach this station
  // can achieve (at σ=15 mS/m, the best M3-zone conductivity) is used
  // as the population sub-score normalizer.  This makes the 0..100
  // score relative to the station's theoretical ceiling rather than a
  // fixed 50 km that is too small for any real AM station.
  let reach_scale_km = 200; // default fallback
  try {
    const rMax = fccAmDistanceKm({
      frequency_khz,
      target_mvm: DAYTIME_REACH_TARGET_MVM,
      conductivity_msm: 15,   // best-case M3 conductivity (Great Plains)
      erp_kw: tpo_kw
    });
    if (rMax?.distance_km > 0) reach_scale_km = rMax.distance_km;
  } catch (_) { /* keep fallback */ }

  const ctx = {
    callsign,
    frequency_khz,
    tpo_kw,
    pattern_mode,
    fcc_class,
    community_of_license_polygon,
    goals,
    current_site,
    reach_scale_km
  };
  const scored = await Promise.all(gridPoints.map((pt) => scoreCandidate(pt, ctx, warnings)));

  // ---- 4. rank, label, slice ----
  scored.sort((a, b) => b.score - a.score);

  const scoreCutoff = quantile(scored.map((c) => c.score), PROMISING_TOP_QUANTILE);
  for (const c of scored){
    finalizeLabels(c, scoreCutoff);
  }

  // Re-rank after labeling and assign rank index + score percentile.
  const nScored = scored.length;
  scored.forEach((c, i) => {
    c.rank = i + 1;
    // Percentile = fraction of candidates WITH LOWER score (higher rank = top percentile).
    // rank 1 (top score) → 100th percentile; rank n (bottom) → 0th percentile.
    c.rank_percentile = nScored > 1 ? round2(((nScored - i - 1) / (nScored - 1)) * 100) : 100;
  });

  // ---- 5. Score variance stats + clustering audit ----
  const rasterLoaded = m3LoadStatus().loaded;
  const scoreValues = scored.map(c => c.score);
  const scoreMean   = scoreValues.reduce((a, b) => a + b, 0) / Math.max(scoreValues.length, 1);
  const scoreVar    = scoreValues.reduce((a, v) => a + (v - scoreMean) ** 2, 0) / Math.max(scoreValues.length, 1);
  const score_stats = {
    mean:    round2(scoreMean),
    std_dev: round2(Math.sqrt(scoreVar)),
    min:     round2(Math.min(...scoreValues)),
    max:     round2(Math.max(...scoreValues))
  };

  const scoreBuckets = {};
  for (const c of scored){
    const k = c.score.toFixed(1);
    scoreBuckets[k] = (scoreBuckets[k] || 0) + 1;
  }
  // Only warn about score clustering when the raster is loaded AND we expect
  // per-pixel differentiation.  Zone-table mode naturally produces score
  // clusters when candidates share the same M3 zone — that is expected.
  for (const [val, n] of Object.entries(scoreBuckets)){
    if (n > 10 && rasterLoaded){
      warnings.push({ code: 'SCORE_CLUSTERED', message: `${n} candidates share score ${val} despite raster σ — weight mix may not differentiate sites; consider enabling additional goals or narrowing the search radius` });
    }
  }

  // ---- 6. Daytime-reach clustering audit ----
  // Zone-table mode naturally produces clusters (all candidates in a zone
  // share the same σ → same reach).  Only emit a real warning when the
  // GeoTIFF raster IS loaded — at that point flat clusters would indicate
  // a broken per-pixel lookup.
  const reachBuckets = {};
  for (const c of scored){
    if (c.daytime_reach_km != null){
      const k = c.daytime_reach_km.toFixed(1);
      reachBuckets[k] = (reachBuckets[k] || 0) + 1;
    }
  }
  for (const [val, n] of Object.entries(reachBuckets)){
    if (n > 10){
      if (rasterLoaded){
        warnings.push({ code: 'REACH_FLAT_RASTER', message: `${n} candidates share identical daytime_reach_km=${val} km despite GeoTIFF raster being loaded — possible per-pixel lookup fault` });
      }
      // Zone-table: flat clusters are expected (per-zone σ); no warning needed.
    }
  }

  // ---- 7. Optimization confidence ----
  const conductivity_mode = rasterLoaded ? 'raster' : 'zone-table';

  const confidenceLayers = [];
  if (goals.maximize_col_coverage || goals.maximize_population || goals.minimize_blanket_population){
    confidenceLayers.push('fcc_groundwave_engine');
  }
  if (rasterLoaded){
    confidenceLayers.push('m3_conductivity_raster');
  }
  if (goals.minimize_blanket_population){
    confidenceLayers.push('blanket_population_proxy');
  }
  if (goals.minimize_int_treaty_zone){
    confidenceLayers.push('international_border_detection');
  }
  if (community_of_license_polygon){
    confidenceLayers.push('col_polygon_provided');
  }
  const nLayers = confidenceLayers.length;
  const optimization_confidence = {
    level: nLayers >= 4 ? 'HIGH' : nLayers >= 2 ? 'MEDIUM' : 'LOW',
    contributing_layers: confidenceLayers,
    notes: [
      ...(!rasterLoaded && goals.prefer_high_conductivity ? ['Ground conductivity: FCC M3 zone table (15 zones, ±50% vs. raster) — deploy AM_m3.tif for filing-grade σ'] : []),
      ...(goals.avoid_wildfire_risk ? ['Wildfire scoring is a placeholder — USFS FIA / LANDFIRE not yet integrated'] : []),
      ...(!community_of_license_polygon ? ['COL coverage uses a 10 km disc proxy; supply community_of_license_polygon for higher confidence'] : [])
    ]
  };

  // Baseline = the score row for the current site (search by coord match).
  const baseline = scored.find((c) => coordsEqual(c, current_site)) || null;

  const returned = scored.slice(0, candidate_limit);

  // Status summary across all evaluated candidates (not just returned).
  const candidate_count_by_status = {};
  for (const c of scored){
    const s = c.status_category || 'UNKNOWN_DATA';
    candidate_count_by_status[s] = (candidate_count_by_status[s] || 0) + 1;
  }

  const scoring_time_ms = Date.now() - scoringStart;

  // ---- 8. Tower sizing reference ----
  // Physical antenna height limits both site selection and ASR requirements.
  // Standard AM vertical antennas run λ/4 to λ/2; the FCC §17.7 ASR
  // registration threshold is 200 ft (60.96 m) AGL.
  const lambda_m       = round2(300000 / frequency_khz);
  const quarter_wave_m = round2(lambda_m / 4);
  const half_wave_m    = round2(lambda_m / 2);
  const ASR_THRESHOLD_M = 60.96;
  const tower_reference = {
    wavelength_m:            lambda_m,
    quarter_wave_m,
    half_wave_m,
    typical_range_m:         `${quarter_wave_m}–${half_wave_m}`,
    asr_threshold_m:         ASR_THRESHOLD_M,
    asr_registration_required_at_quarter_wave: quarter_wave_m > ASR_THRESHOLD_M,
    note: `AM vertical antennas typically run λ/4–λ/2. At ${frequency_khz} kHz all heights in the typical range ${quarter_wave_m > ASR_THRESHOLD_M ? 'EXCEED' : 'may be below'} the §17.7 ASR 200-ft threshold.`
  };

  return {
    available: true,
    method: 'grid-search + per-goal sub-scoring (SCREENING ONLY)',
    n_candidates_evaluated: scored.length,
    n_candidates_returned:  returned.length,
    scoring_time_ms,
    candidate_count_by_status,
    current_site_baseline:  baselineSummary(baseline),
    candidates: returned,
    score_stats,
    optimization_confidence,
    conductivity_mode,
    tower_reference,
    inputs_echo: {
      callsign, frequency_khz, current_site, search_radius_km,
      grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
      goals_enabled: Object.entries(goals).filter(([_, v]) => v).map(([k]) => k),
      community_of_license_polygon_provided: !!community_of_license_polygon,
      candidate_limit,
      reach_scale_km: round2(reach_scale_km)
    },
    warnings,
    limitations_global: [
      'Screening-grade output only; engineer-grade NIF / §73.182 / DA-N analysis is required for any filing.',
      'Population sub-score uses a population-density proxy (groundwave reach × density model), not a Census-block sum.',
      'Wildfire / fuel-risk scoring is a placeholder until USFS FIA / LANDFIRE integration lands.',
      'Parcel / zoning availability is not checked — engineer must verify each site is leasable / buildable.',
      'No skywave (§73.182) interference analysis is performed at this stage.'
    ]
  };
}

// ---------- input validation ----------

function validateInputs(body, warnings){
  const err = (msg) => ({ ok: false, error: msg });

  const callsign = String(body.callsign || '').trim().toUpperCase();
  if (!callsign) return err('callsign required');

  const frequency_khz = Number(body.frequency_khz);
  if (!Number.isFinite(frequency_khz) || frequency_khz < 530 || frequency_khz > 1700){
    return err('frequency_khz must be in 530..1700');
  }

  const current_site = body.current_site || {};
  const lat = Number(current_site.lat), lon = Number(current_site.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return err('current_site.lat invalid');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return err('current_site.lon invalid');

  const search_radius_km = Number(body.search_radius_km);
  if (!Number.isFinite(search_radius_km) || search_radius_km <= 0 || search_radius_km > 500){
    return err('search_radius_km must be in (0, 500]');
  }

  const grid_spacing_km = Number(body.grid_spacing_km);
  if (!Number.isFinite(grid_spacing_km) || grid_spacing_km <= 0){
    return err('grid_spacing_km must be > 0');
  }
  if (grid_spacing_km > search_radius_km){
    warnings.push({ code: 'GRID_SPACING_LARGE', message: `grid_spacing_km (${grid_spacing_km}) exceeds search_radius_km (${search_radius_km}); only the current-site point will be evaluated` });
  }

  // Safety cap on grid size — protects the API from a DOS-y request.
  const est_n = Math.ceil((2 * search_radius_km / grid_spacing_km) + 1) ** 2;
  if (est_n > 10_000){
    return err(`grid would generate ~${est_n} candidates (>10,000 limit); increase grid_spacing_km or shrink search_radius_km`);
  }

  const tpo_kw = Number(body.tpo_kw);
  if (!Number.isFinite(tpo_kw) || tpo_kw <= 0) return err('tpo_kw must be > 0');

  const pattern_mode = String(body.pattern_mode || 'NDA').toUpperCase();
  const fcc_class    = String(body.fcc_class || 'D').toUpperCase();

  const goals = normalizeGoals(body.optimization_goals);

  const candidate_limit = Number.isFinite(Number(body.candidate_limit))
    ? Math.max(1, Math.min(200, Math.floor(Number(body.candidate_limit))))
    : 20;

  return {
    ok: true,
    value: {
      callsign, frequency_khz,
      current_site: { lat, lon },
      search_radius_km, grid_spacing_km, tpo_kw,
      pattern_mode, fcc_class,
      community_of_license_polygon: body.community_of_license_polygon || null,
      goals,
      candidate_limit
    }
  };
}

function normalizeGoals(raw){
  const out = {};
  for (const key of KNOWN_GOALS){
    out[key] = !!(raw && raw[key]);
  }
  return out;
}

// ---------- grid generation ----------

/**
 * Build a square grid of candidate (lat, lon) pairs centered on
 * `center`, with `spacing_km` between adjacent grid lines, clipped to
 * a great-circle radius of `radius_km`.  Uses a local equirectangular
 * approximation — at AM regional scales (≤ 500 km) cross-track error
 * is well under 1% which is far below the resolution of the per-goal
 * sub-scores.
 */
function buildGridCandidates({ center, radius_km, spacing_km }){
  const cosLat = Math.cos(center.lat * Math.PI / 180);
  // Δlat / Δlon per km of grid spacing.
  const dLatPerKm = 1 / (R_EARTH_KM * Math.PI / 180);
  const dLonPerKm = 1 / (R_EARTH_KM * Math.PI / 180 * Math.max(cosLat, 1e-6));

  const n = Math.floor(radius_km / spacing_km);
  const points = [];
  for (let iy = -n; iy <= n; iy++){
    for (let ix = -n; ix <= n; ix++){
      const lat = center.lat + iy * spacing_km * dLatPerKm;
      const lon = center.lon + ix * spacing_km * dLonPerKm;
      const d = greatCircleKm(center.lat, center.lon, lat, lon);
      if (d <= radius_km + 1e-6){
        const bearing = d < 0.01 ? 0 : bearingDeg(center.lat, center.lon, lat, lon);
        points.push({ lat, lon, distance_from_current_km: d, bearing_deg: Math.round(bearing) });
      }
    }
  }
  return points;
}

function ensureCurrentSiteIncluded(points, current){
  if (!points.some((p) => coordsEqual(p, current))){
    points.push({ lat: current.lat, lon: current.lon, distance_from_current_km: 0, bearing_deg: 0 });
  }
}

// ---------- per-candidate scoring ----------

/**
 * Score one candidate.  Returns an object matching the per-candidate
 * shape documented on the route.
 */
async function scoreCandidate(pt, ctx, warnings){
  const { frequency_khz, tpo_kw, current_site, goals,
          community_of_license_polygon, reach_scale_km = 200 } = ctx;

  // --- raw sub-metrics (computed independent of weighting) ---

  // 1. Groundwave "daytime reach" — distance to DAYTIME_REACH_TARGET_MVM.
  //    Try real GeoTIFF raster first (filing-grade); fall through to the
  //    15-zone M3 table (screening-grade) when AM_m3.tif is unavailable.
  let _m3 = await lookupM3Conductivity(pt.lat, pt.lon).catch(() => null);
  if (!_m3?.available) _m3 = lookupM3ZoneFallback(pt.lat, pt.lon);
  const sigma_msm = _m3?.available ? _m3.sigma_mS_m : 4;
  const ground_sigma_source = _m3?.available
    ? (_m3.zone_label || `${sigma_msm} mS/m (FCC M3)`)
    : 'default (4 mS/m screening)';
  const ground_sigma_filing_grade = _m3?.available
    ? (_m3.filing_grade || 'filing')   // GeoTIFF result → filing-grade; zone table sets 'screening'
    : 'screening';
  let daytime_reach_km = null;
  try {
    const r = fccAmDistanceKm({
      frequency_khz,
      target_mvm: DAYTIME_REACH_TARGET_MVM,
      conductivity_msm: sigma_msm,
      erp_kw: tpo_kw
    });
    daytime_reach_km = r.distance_km;
  } catch (e){
    // M3 / range errors fall through to NOT-EVALUATED for this candidate.
    warnings.push({ code: 'CURVE_LOOKUP_FAILED', message: `fccAmDistanceKm failed at (${pt.lat.toFixed(3)}, ${pt.lon.toFixed(3)}): ${e.message}` });
  }

  // 2. Principal-community coverage (§73.24(j)).  When a polygon was
  //    supplied we compute the fraction of the COL boundary inside the
  //    5 mV/m daytime contour (modeled as a circle of radius =
  //    fccAmDistanceKm(target=5 mV/m)).  When no polygon was supplied
  //    we estimate "coverage" as the fraction of the COL polygon
  //    proxy (a 10-km disc centered on the current site, treated as a
  //    rough community) inside the 5-mV/m circle.
  let coverage_pct = null;
  let coverage_computed_from = 'none';
  try {
    const r5 = fccAmDistanceKm({
      frequency_khz,
      target_mvm: 5.0,
      conductivity_msm: sigma_msm,
      erp_kw: tpo_kw
    });
    const r5km = r5.distance_km;
    if (community_of_license_polygon){
      coverage_pct = polygonCoverageFraction({
        polygon: community_of_license_polygon,
        circle_center: pt,
        circle_radius_km: r5km
      });
      coverage_computed_from = 'polygon-overlap (Monte-Carlo)';
    } else {
      // Proxy COL = 10 km disc around the OPERATOR'S current site —
      // i.e., the community of license stays where it is even when
      // the transmitter moves.
      coverage_pct = discCoverageFraction({
        circle_center: pt,
        circle_radius_km: r5km,
        disc_center: current_site,
        disc_radius_km: 10
      });
      coverage_computed_from = 'disc-disc analytical proxy (10 km COL)';
    }
  } catch (e){
    warnings.push({ code: 'COL_CURVE_FAILED', message: `fccAmDistanceKm(5 mV/m) failed: ${e.message}` });
  }

  // 3. Blanket population — fraction of US population inside the 1000 mV/m
  //    ground-wave contour.  §73.24(g) caps this at 1%.
  //
  //    Proxy formula:
  //      blanket_area_km² = π × r_1000²
  //      regional_density = US_AVG × urbanisation_factor
  //      urbanisation_factor ∈ [1.0, 5.0]: sites closer to the current
  //        city of license are assumed to be in a more urbanised area;
  //        sites at ≥ 100 km fall back to pure national average.
  //      pop_in_blanket = blanket_area_km² × regional_density
  //      blanket_pct    = pop_in_blanket / US_POPULATION × 100
  //
  //    This is still a screening proxy (vs. Census-block sum) but it is
  //    physically meaningful: changing conductivity / power / frequency
  //    changes r_1000 which changes the area and therefore the result.
  let blanket_population_pct = null;
  try {
    const r1000 = fccAmDistanceKm({
      frequency_khz, target_mvm: 1000, conductivity_msm: sigma_msm, erp_kw: tpo_kw
    }).distance_km;
    if (r1000 > 0){
      const blanket_area_km2 = Math.PI * r1000 * r1000;
      // Urbanisation factor: 1.0 (rural) → 5.0 (central metro).  Linear
      // over 0–50 km from current site; saturates at 50 km out.
      const dist = pt.distance_from_current_km ?? 0;
      const urbanFactor = 1.0 + 4.0 * Math.max(0, 1 - Math.min(1, dist / 50));
      const regional_density = US_AVG_POP_DENSITY_PER_KM2 * urbanFactor;
      const pop_in_blanket = blanket_area_km2 * regional_density;
      blanket_population_pct = (pop_in_blanket / US_POPULATION_M) * 100;
    }
  } catch (_){ /* leave null */ }

  // 4. NIF status (screening grade) — pass-through for now; future
  //    versions will run a partial §73.182 NIF screening here.
  const nif_status = 'SCREENING ONLY';

  // 5. International border / treaty zone.
  let treaty_zone = null;
  let treaty_min_border_km = null;
  try {
    const b = detectInternationalBorder({ lat: pt.lat, lon: pt.lon });
    if (b.available){
      treaty_min_border_km = Math.min(b.distances.us_mx_km ?? Infinity, b.distances.us_ca_km ?? Infinity);
      if (b.inside_treaty_zone){
        treaty_zone = b.treaties.map((t) => t.treaty).join('; ');
      }
    }
  } catch (_){ /* leave null */ }

  // --- per-goal sub-scores (0..100) ---

  const sub = {
    col_coverage: coverage_pct == null ? null : Math.max(0, Math.min(100, coverage_pct * 100)),
    population:   daytime_reach_km == null ? null
      // Area-based normalisation: population inside the 0.5 mV/m contour
      // is proportional to πr², so scoring on (r/r_max)² is more physically
      // meaningful than linear r.  Uses best-achievable reach at σ=15 mS/m
      // as the ceiling so conductivity differences actually differentiate sites.
      : Math.max(0, Math.min(100, (daytime_reach_km / reach_scale_km) ** 2 * 100)),
    blanket:      blanket_population_pct == null ? null
      // Lower is better.  0% blanket pop → 100 score; 1% → 50; 2% → 0.
      : Math.max(0, Math.min(100, 100 - 50 * blanket_population_pct)),
    conductivity: Math.max(0, Math.min(100, (sigma_msm / SIGMA_PREFERRED_MIN_MSM) * 100)),
    wildfire:     null,   // placeholder
    treaty_zone:  treaty_min_border_km == null ? null
      // Farther from border = better; saturates at the treaty threshold.
      : Math.max(0, Math.min(100, (treaty_min_border_km / TREATY_ZONE_PENALTY_KM_MX) * 100))
  };

  // --- weighting & combination ---
  const enabled = goals;
  const weightPool = {
    maximize_col_coverage:        enabled.maximize_col_coverage        ? 35 : 0,
    maximize_population:          enabled.maximize_population          ? 28 : 0,
    minimize_blanket_population:  enabled.minimize_blanket_population  ? 14 : 0,
    prefer_high_conductivity:     enabled.prefer_high_conductivity     ? 10 : 0,
    avoid_wildfire_risk:          enabled.avoid_wildfire_risk          ?  4 : 0,
    minimize_int_treaty_zone:     enabled.minimize_int_treaty_zone     ?  4 : 0
  };
  // Map goal-key → sub-score key.
  const subKey = {
    maximize_col_coverage:        'col_coverage',
    maximize_population:          'population',
    minimize_blanket_population:  'blanket',
    prefer_high_conductivity:     'conductivity',
    avoid_wildfire_risk:          'wildfire',
    minimize_int_treaty_zone:     'treaty_zone'
  };

  const score_breakdown = {};
  let total = 0;
  let weightSum = 0;
  for (const [goal, w] of Object.entries(weightPool)){
    if (w === 0){
      score_breakdown[subKey[goal]] = 0;
      continue;
    }
    const s = sub[subKey[goal]];
    // null sub-score → contributes 0 but full weight still counted so
    // a NOT-EVALUATED metric doesn't artificially boost the score.
    const pts = s == null ? 0 : (s / 100) * w;
    score_breakdown[subKey[goal]] = round2(pts);
    total += pts;
    weightSum += w;
  }

  // Normalize to 0..100 even when only a subset of goals is enabled.
  const normFactor = weightSum > 0 ? 100 / weightSum : 1;
  const score = weightSum > 0 ? round2(total * normFactor) : 0;
  // Normalize breakdown values so they sum to score (aids explainability).
  for (const k of Object.keys(score_breakdown)){
    score_breakdown[k] = round2(score_breakdown[k] * normFactor);
  }

  // --- compliance & label flags ---
  const flags = [];
  if (coverage_pct != null && coverage_pct < COL_COVERAGE_HARD_FLOOR){
    flags.push(`COL coverage ${(coverage_pct * 100).toFixed(0)}% < §73.24(j) ${(COL_COVERAGE_HARD_FLOOR * 100).toFixed(0)}% floor`);
  }
  if (blanket_population_pct != null && blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT){
    flags.push(`Blanket population ${blanket_population_pct.toFixed(2)}% > §73.24(g) 1% ceiling`);
  }

  // --- limitations array (placeholders + missing data) ---
  const limitations = [];
  if (goals.avoid_wildfire_risk) limitations.push(PLACEHOLDER_GOALS.avoid_wildfire_risk);
  if (!community_of_license_polygon){
    limitations.push('Principal-community coverage uses a 10-km disc proxy; supply community_of_license_polygon for filing-grade overlap.');
  }
  limitations.push('Parcel / zoning availability not checked.');
  limitations.push('NIF status is SCREENING-grade only — full §73.182 nighttime analysis required for filing.');

  // --- ranking_rationale sentence ---
  const rationale = buildRationale({
    coverage_pct, daytime_reach_km, blanket_population_pct,
    sigma_msm, distance_from_current_km: pt.distance_from_current_km,
    bearing_deg: pt.bearing_deg ?? null,
    treaty_zone, flags, score, score_breakdown
  });

  return {
    lat: round6(pt.lat),
    lon: round6(pt.lon),
    distance_from_current_km: round2(pt.distance_from_current_km),
    bearing_deg: pt.bearing_deg ?? null,
    score,
    col_coverage_pct:        coverage_pct == null ? null : round2(coverage_pct),
    nif_status,
    daytime_reach_km:        daytime_reach_km == null ? null : round2(daytime_reach_km),
    blanket_population_pct:  blanket_population_pct == null ? null : round2(blanket_population_pct),
    ground_sigma_mS_m:         sigma_msm,
    ground_sigma_quality:      sigmaQuality(sigma_msm),
    ground_sigma_source,
    ground_sigma_filing_grade,
    treaty_zone,
    fuel_risk:               LABEL_NOT_EVALUATED,
    notes: buildNotes({ coverage_pct, sigma_msm, blanket_population_pct, distance_from_current_km: pt.distance_from_current_km }),
    explanation: {
      score_breakdown: roundBreakdown(score_breakdown),
      ranking_rationale: rationale,
      weights_pool: weightPool,
      coverage_computed_from
    },
    status_labels: [LABEL_SCREENING, LABEL_ENGINEER_REVIEW],  // base set; finalizeLabels() adds more
    _flags: flags,                                            // private: removed in finalizeLabels
    limitations
  };
}

// ---------- finalize per-candidate labels after ranking ----------

function finalizeLabels(c, scoreCutoff){
  const labels = new Set(c.status_labels);
  labels.add(LABEL_SCREENING);
  labels.add(LABEL_ENGINEER_REVIEW);

  if (c._flags && c._flags.length){
    labels.add(LABEL_NON_COMPLIANT);
  } else if (c.score >= scoreCutoff){
    labels.add(LABEL_PROMISING);
  } else if (c.score >= scoreCutoff * 0.85){
    // Borderline — within 15% of the PROMISING cutoff.
    labels.add(LABEL_REVIEW_REQUIRED);
  }
  // Update nif_status mirror and status_category enum for the UI table.
  if (labels.has(LABEL_NON_COMPLIANT)){
    c.nif_status     = LABEL_NON_COMPLIANT;
    c.status_category = 'NON_COMPLIANT';
  } else if (labels.has(LABEL_PROMISING)){
    c.nif_status     = LABEL_PROMISING;
    c.status_category = 'PROMISING';
  } else if (labels.has(LABEL_REVIEW_REQUIRED)){
    c.status_category = 'REVIEW_REQUIRED';
  } else {
    c.status_category = 'REVIEW_REQUIRED';
  }

  c.status_labels = Array.from(labels);
  // Lift the flags to limitations and remove the private field.
  if (c._flags && c._flags.length){
    for (const f of c._flags){
      c.limitations.unshift(`HARD CHECK FAIL: ${f}`);
    }
  }
  delete c._flags;
}

// ---------- baseline summary ----------

function baselineSummary(b){
  if (!b) return null;
  return {
    lat: b.lat, lon: b.lon,
    score: b.score,
    rank_percentile:        b.rank_percentile,
    col_coverage_pct:       b.col_coverage_pct,
    daytime_reach_km:       b.daytime_reach_km,
    blanket_population_pct: b.blanket_population_pct,
    ground_sigma_mS_m:         b.ground_sigma_mS_m,
    ground_sigma_quality:      b.ground_sigma_quality,
    ground_sigma_source:       b.ground_sigma_source,
    ground_sigma_filing_grade: b.ground_sigma_filing_grade,
    nif_status:             b.nif_status,
    treaty_zone:            b.treaty_zone,
    status_labels:          b.status_labels,
    score_breakdown:        b.explanation?.score_breakdown ?? null
  };
}

// ---------- explanatory text builders ----------

// Qualitative conductivity label based on FCC M3 zone ranges.
// Guides the engineer on site selection even before the sub-score number.
function sigmaQuality(sigma_msm){
  if (sigma_msm == null || !Number.isFinite(sigma_msm)) return 'UNKNOWN';
  if (sigma_msm >= 8)  return 'EXCELLENT';   // Great Plains / coastal / rich soil
  if (sigma_msm >= 4)  return 'GOOD';        // typical mid-continental
  if (sigma_msm >= 2)  return 'FAIR';        // hilly, mixed soil
  return 'POOR';                             // desert, rocky terrain, urban fill
}

function buildNotes({ coverage_pct, sigma_msm, blanket_population_pct, distance_from_current_km }){
  const parts = [];
  if (coverage_pct != null) parts.push(`${(coverage_pct * 100).toFixed(0)}% city-coverage`);
  if (sigma_msm   != null) parts.push(`σ=${sigma_msm} mS/m`);
  if (blanket_population_pct != null) parts.push(`${blanket_population_pct.toFixed(1)}% blanket pop`);
  parts.push(`${distance_from_current_km.toFixed(0)} km from current`);
  return parts.join(', ') + '.';
}

function cardinalDir(deg){
  if (deg == null || !Number.isFinite(deg)) return null;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function buildRationale({ coverage_pct, daytime_reach_km, blanket_population_pct, sigma_msm,
                          distance_from_current_km, bearing_deg, treaty_zone, flags, score, score_breakdown }){
  if (flags.length){
    return `Non-compliant on screening: ${flags.join('; ')}.  Engineer-grade analysis required before filing.`;
  }
  // Find the leading scoring factor from score_breakdown.
  let leadFactor = null;
  if (score_breakdown){
    let maxPts = 0;
    const labels = { col_coverage: 'COL coverage', population: 'daytime population reach',
                     blanket: 'low blanket-pop risk', conductivity: 'ground conductivity',
                     wildfire: 'wildfire risk avoidance', treaty_zone: 'treaty zone clearance' };
    for (const [k, v] of Object.entries(score_breakdown)){
      if ((Number(v) || 0) > maxPts){ maxPts = Number(v); leadFactor = labels[k] || k; }
    }
  }
  const bits = [];
  if (leadFactor && score != null){
    bits.push(`Composite score ${score.toFixed(1)}; leading factor ${leadFactor}`);
  }
  if (coverage_pct != null && coverage_pct >= 0.95){
    bits.push(`strong COL coverage ${(coverage_pct * 100).toFixed(0)}%`);
  } else if (coverage_pct != null){
    bits.push(`COL coverage ${(coverage_pct * 100).toFixed(0)}%`);
  }
  if (daytime_reach_km != null){
    bits.push(`0.5 mV/m reach ${daytime_reach_km.toFixed(0)} km`);
  }
  if (sigma_msm >= SIGMA_PREFERRED_MIN_MSM){
    bits.push(`σ=${sigma_msm} mS/m (favourable conductivity)`);
  }
  if (blanket_population_pct != null && blanket_population_pct < 0.5){
    bits.push(`blanket pop ${blanket_population_pct.toFixed(1)}% well under §73.24(g) 1% limit`);
  } else if (blanket_population_pct != null && blanket_population_pct > 0.8){
    bits.push(`blanket pop ${blanket_population_pct.toFixed(1)}% — approaching §73.24(g) limit`);
  }
  if (treaty_zone) bits.push(`in ${treaty_zone} treaty zone — verify §73.187`);
  if (distance_from_current_km < 0.5){
    bits.push('current site location');
  } else {
    const card = cardinalDir(bearing_deg);
    bits.push(`${distance_from_current_km.toFixed(0)} km from current site${card ? ` (${card})` : ''}`);
  }
  return bits.join('; ') + '.';
}

// ---------- geometric helpers ----------

function greatCircleKm(lat1, lon1, lat2, lon2){
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dφ = (lat2 - lat1) * Math.PI / 180;
  const dλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R_EARTH_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordsEqual(a, b, tol_deg = 1e-9){
  return Math.abs(a.lat - b.lat) < tol_deg && Math.abs(a.lon - b.lon) < tol_deg;
}

// Forward (initial) bearing from (lat1,lon1) → (lat2,lon2), degrees 0–360.
function bearingDeg(lat1, lon1, lat2, lon2){
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Analytical fraction of disc B (radius rB at center cB) covered by
// disc A (radius rA at center cA).  Used as a no-polygon COL coverage
// proxy.  Returns a value in [0, 1].
function discCoverageFraction({ circle_center, circle_radius_km, disc_center, disc_radius_km }){
  const d = greatCircleKm(circle_center.lat, circle_center.lon, disc_center.lat, disc_center.lon);
  const rA = circle_radius_km, rB = disc_radius_km;
  if (d + rB <= rA) return 1;       // disc B is entirely inside disc A
  if (d >= rA + rB) return 0;       // no overlap
  // Otherwise compute the lens area / disc-B area.
  const aA = rA * rA;
  const aB = rB * rB;
  const t1 = Math.acos(Math.min(1, Math.max(-1, (d * d + aB - aA) / (2 * d * rB))));
  const t2 = Math.acos(Math.min(1, Math.max(-1, (d * d + aA - aB) / (2 * d * rA))));
  const lens = aB * t1 + aA * t2 - 0.5 * Math.sqrt(
    Math.max(0, (-d + rA + rB) * (d + rA - rB) * (d - rA + rB) * (d + rA + rB))
  );
  const areaB = Math.PI * aB;
  return Math.max(0, Math.min(1, lens / areaB));
}

// Monte-Carlo fraction of a GeoJSON Polygon covered by the disc
// (circle_center, circle_radius_km).  Polygon is assumed to be in
// [lon, lat] order per the GeoJSON spec.  Uses the polygon's bounding
// box × 1024 samples — deterministic via a seeded RNG so results are
// stable across calls.
function polygonCoverageFraction({ polygon, circle_center, circle_radius_km, n_samples = 1024 }){
  try {
    const ring = polygon.coordinates && polygon.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    let minLat =  Infinity, maxLat = -Infinity, minLon =  Infinity, maxLon = -Infinity;
    for (const [lon, lat] of ring){
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    if (!Number.isFinite(minLat)) return null;

    // Deterministic LCG seeded from the polygon bbox + circle center
    // so two calls with the same inputs produce identical fractions.
    let s = Math.floor((minLat + maxLat + minLon + maxLon
                        + circle_center.lat + circle_center.lon) * 1e6) >>> 0;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };

    let inPoly = 0, inBoth = 0;
    for (let i = 0; i < n_samples; i++){
      const lat = minLat + (maxLat - minLat) * rand();
      const lon = minLon + (maxLon - minLon) * rand();
      if (pointInPolygon(lat, lon, ring)){
        inPoly++;
        if (greatCircleKm(lat, lon, circle_center.lat, circle_center.lon) <= circle_radius_km){
          inBoth++;
        }
      }
    }
    return inPoly === 0 ? 0 : inBoth / inPoly;
  } catch (_) {
    return null;
  }
}

function pointInPolygon(lat, lon, ring){
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const [xi, yi] = ring[i];   // [lon, lat]
    const [xj, yj] = ring[j];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------- misc ----------

function quantile(arr, q){
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

function round2(x){ return Number.isFinite(x) ? Math.round(x * 100) / 100 : x; }
function round6(x){ return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x; }
function roundBreakdown(b){
  const o = {};
  for (const [k, v] of Object.entries(b)) o[k] = round2(v);
  return o;
}

// ---------- public test-only export ----------
// Exposed for unit tests.  Not part of the public API contract.
export const __test__ = {
  buildGridCandidates,
  scoreCandidate,
  validateInputs,
  greatCircleKm,
  bearingDeg,
  discCoverageFraction,
  polygonCoverageFraction,
  lookupM3ZoneFallback,
  sigmaQuality,
  KNOWN_GOALS
};
