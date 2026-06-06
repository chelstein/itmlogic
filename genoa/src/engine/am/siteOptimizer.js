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

import { fccAmDistanceKm, fccAmFieldMvmAtDistance } from '../curves/fcc/index.mjs';
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

// FCC AM channel classification (47 CFR §73.25-27)
// Local channels run Class C stations at ≤250 W (§73.27).
const LOCAL_CHANNEL_KHZ = Object.freeze(new Set([1230, 1240, 1340, 1400, 1450, 1490]));
// Clear channels are §73.25 dominant Class A channels where skywave protection applies.
const CLEAR_CHANNEL_KHZ = Object.freeze(new Set([
  640, 650, 660, 670, 700, 710, 720, 750, 760, 770, 780,
  820, 830, 840, 870, 880, 890, 940, 990, 1000, 1020, 1030,
  1040, 1060, 1070, 1100, 1120, 1160, 1180, 1200, 1210
]));

// FCC class daytime TPO limits (47 CFR §73.21).
// Nighttime limits for Class D are not enforced here (require separate analysis).
const FCC_CLASS_POWER_KW = Object.freeze({
  A: { min: 10,    max: 50   },
  B: { min: 0.25,  max: 50   },
  C: { min: 0.001, max: 0.25 },
  D: { min: 0.001, max: 50   }   // daytime only
});

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
 * @param {{lat:number,lon:number}} [body.col_centroid]  COL centroid lat/lon (optional).
 *   When provided, field_at_col_centroid_mvm uses the distance from each candidate to
 *   the COL centroid rather than to the current transmitter site.  Useful when the
 *   current transmitter is not co-located with the community of license.
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
    community_of_license_polygon, col_centroid, goals, candidate_limit
  } = v.value;

  // ---- 1b. DA mode notice ----
  // When pattern_mode indicates directional antenna operation, a
  // §73.182 nighttime skywave analysis and §73.150 DA pattern design
  // are required at filing.  Surface this early so the operator
  // plans for it even at the screening stage.
  if (/DA/i.test(pattern_mode)){
    warnings.push({
      code: 'DA_MODE_REQUIRED',
      message: `pattern_mode=${pattern_mode}: a directional antenna (§73.150) pattern design and §73.182 nighttime skywave NIF analysis are required at filing.  Screening scores here are daytime/NDA proxies — DA gain pattern optimization is NOT performed.`
    });
  }

  // ---- 1c. FCC class power limit advisory ----
  // Flag when the requested TPO is outside the §73.21 limits for the declared
  // FCC class.  These are advisory warnings, not hard-stop errors, because
  // special temporary authorisations and license modifications exist.
  const classLimits = FCC_CLASS_POWER_KW[fcc_class];
  if (classLimits){
    if (tpo_kw > classLimits.max){
      warnings.push({
        code: 'TPO_EXCEEDS_CLASS_MAX',
        message: `tpo_kw ${tpo_kw} kW exceeds the §73.21 daytime maximum for Class ${fcc_class} stations (${classLimits.max} kW). A filing at this power level will require FCC justification or a class reclassification.`
      });
    } else if (fcc_class === 'A' && tpo_kw < classLimits.min){
      warnings.push({
        code: 'TPO_BELOW_CLASS_MIN',
        message: `tpo_kw ${tpo_kw} kW is below the §73.21 minimum for Class A stations (${classLimits.min} kW). Class A dominant stations must operate at ≥10 kW to maintain their protected status.`
      });
    }
  }

  // ---- 1d. Adjacent-channel clear-channel advisory ----
  // Adjacent channels (±10 kHz) that are §73.25 clear channels warrant a note:
  // the co-channel / adjacent-channel separation rules under §73.182 may require
  // larger physical separation or pattern protection for a secondary station
  // whose frequency is close to a dominant clear-channel assignment.
  const adjChannels = [-10, 10].map(d => frequency_khz + d).filter(f => CLEAR_CHANNEL_KHZ.has(f));
  if (adjChannels.length > 0){
    warnings.push({
      code: 'ADJACENT_TO_CLEAR_CHANNEL',
      message: `${frequency_khz} kHz is adjacent to §73.25 clear-channel assignment(s): ${adjChannels.join(', ')} kHz. ` +
               `Adjacent-channel interference requirements under §73.182 may apply — verify nighttime inter-station separation.`
    });
  }

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
    col_centroid,
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

  // Per-candidate confidence distribution (computed over all scored candidates).
  // Used to surface a data-quality advisory when all candidates are LOW confidence.
  const confDist = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const c of scored) confDist[c.score_confidence] = (confDist[c.score_confidence] || 0) + 1;
  const nScoredTotal = scored.length || 1;
  const pctLow = ((confDist.LOW / nScoredTotal) * 100).toFixed(0);
  const confidenceNotes = [
    ...(!rasterLoaded && goals.prefer_high_conductivity ? ['Ground conductivity: FCC M3 zone table (15 zones, ±50% vs. raster) — deploy AM_m3.tif for filing-grade σ'] : []),
    ...(goals.avoid_wildfire_risk ? ['Wildfire scoring is a placeholder — USFS FIA / LANDFIRE not yet integrated'] : []),
    ...(!community_of_license_polygon ? ['COL coverage uses a 10 km disc proxy; supply community_of_license_polygon for higher confidence'] : []),
    ...(confDist.LOW === nScoredTotal ? [`All ${nScoredTotal} candidates scored at LOW confidence (zone-table σ + disc-proxy COL) — provide AM_m3.tif and community_of_license_polygon to raise ranking reliability.`]
      : confDist.LOW > nScoredTotal * 0.7 ? [`${pctLow}% of candidates scored at LOW confidence — upgrade conductivity raster and/or COL polygon for more reliable ranking.`]
      : [])
  ];
  const optimization_confidence = {
    level: nLayers >= 4 ? 'HIGH' : nLayers >= 2 ? 'MEDIUM' : 'LOW',
    contributing_layers: confidenceLayers,
    per_candidate_confidence: confDist,
    notes: confidenceNotes
  };

  // Baseline = the score row for the current site (search by coord match).
  const baseline = scored.find((c) => coordsEqual(c, current_site)) || null;

  // Stamp deltas vs baseline on every candidate (null if baseline unknown).
  if (baseline){
    const bBd = baseline.explanation?.score_breakdown ?? {};
    for (const c of scored){
      c.score_delta_vs_baseline = round2(c.score - baseline.score);
      // Population delta: how many more (or fewer) people does this site serve vs current?
      if (c.estimated_daytime_population_served != null && baseline.estimated_daytime_population_served != null){
        c.population_delta_vs_baseline = Math.round(
          c.estimated_daytime_population_served - baseline.estimated_daytime_population_served
        );
      }
      // Structured per-component delta vs baseline score_breakdown.
      const cbd = c.explanation?.score_breakdown ?? {};
      const components = new Set([...Object.keys(cbd), ...Object.keys(bBd)]);
      const componentDeltas = {};
      for (const k of components){
        const cv = cbd[k] ?? 0;
        const bv = bBd[k] ?? 0;
        const delta = round2(cv - bv);
        if (delta !== 0) componentDeltas[k] = delta;
      }
      c.score_delta_explanation = {
        total: c.score_delta_vs_baseline,
        components: componentDeltas
      };
    }
  }

  // Stamp col_coverage_gap_pct on candidates that fall below the 80% hard floor.
  // Tells the engineer how much additional coverage is needed to clear §73.24(j).
  for (const c of scored){
    if (c.col_coverage_pct != null && c.col_coverage_pct < COL_COVERAGE_HARD_FLOOR){
      c.col_coverage_gap_pct = round2(COL_COVERAGE_HARD_FLOOR - c.col_coverage_pct);
    } else {
      c.col_coverage_gap_pct = null;
    }
  }

  const returned = scored.slice(0, candidate_limit);

  // Status summary across all evaluated candidates (not just returned).
  const candidate_count_by_status = {};
  for (const c of scored){
    const s = c.status_category || 'UNKNOWN_DATA';
    candidate_count_by_status[s] = (candidate_count_by_status[s] || 0) + 1;
  }

  const scoring_time_ms = Date.now() - scoringStart;

  // ---- 8a. Score histogram ----
  // 10-bucket histogram over [0, 100], 10 points wide each.
  // Lets the UI visualize the candidate distribution without scanning all scores.
  // promising_count: PROMISING candidates in each bucket (helps identify
  // which score range holds actionable sites).
  const score_histogram = Array.from({ length: 10 }, (_, i) => ({
    bucket: `${i * 10}–${i * 10 + 9}`,
    min: i * 10,
    max: i * 10 + 9,
    count: 0,
    promising_count: 0
  }));
  for (const c of scored){
    const idx = Math.min(9, Math.floor(c.score / 10));
    score_histogram[idx].count += 1;
    if (c.status_category === 'PROMISING') score_histogram[idx].promising_count += 1;
  }

  // ---- 8b. Tower sizing reference ----
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

  // ---- 9. Top-candidates summary ----
  const top5 = returned.slice(0, Math.min(5, returned.length));
  const top_candidates_summary = buildTopSummary(top5, baseline, scored.length);

  // ---- 10. Protection class advisory ----
  // Human-readable §73.182 skywave and protection class guidance for the operator.
  const chanClass = frequencyChannelClass(frequency_khz);
  const { protection_class_advisory, skywave_risk_level } = buildProtectionAdvisory({
    fcc_class, frequency_khz, channel_class: chanClass, pattern_mode
  });

  // ---- 10b. Enrich nif_status with station-level skywave risk ----
  // After finalizeLabels() sets the status category, suffix the nif_status
  // with the skywave risk tier so it doubles as a meaningful NIF advisory
  // rather than just mirroring the compliance label.
  // skywave_risk_level is the same for all candidates (determined by station
  // class + channel, not by candidate location within a regional search area).
  for (const c of scored){
    if (!c.nif_status || c.nif_status === LABEL_SCREENING) continue;
    if (c.treaty_zone){
      c.nif_status += ' — TREATY COORDINATION REQUIRED';
    } else if (skywave_risk_level === 'HIGH'){
      c.nif_status += ' — HIGH skywave risk (§73.182 NIF study required)';
    } else if (skywave_risk_level === 'MODERATE'){
      c.nif_status += ' — MODERATE skywave risk';
    }
    // LOW risk (local channel ≤250 W): no suffix — the label is already clear.
  }

  // ---- 11. Recommended actions ----
  // Engine-synthesized next-step list based on the overall findings.
  const recommended_actions = buildRecommendedActions({
    baseline, returned, scored, candidate_count_by_status,
    fcc_class, pattern_mode, chanClass, skywave_risk_level, warnings,
    community_of_license_polygon
  });

  // ---- 12. FCC Form 301-AM pre-filing checklist ----
  const form_301_checklist = buildForm301Checklist({
    fcc_class, tpo_kw, pattern_mode, frequency_khz,
    channel_class: chanClass, skywave_risk_level,
    asr_registration_required: quarter_wave_m > ASR_THRESHOLD_M,
    community_of_license_polygon: !!community_of_license_polygon,
    col_centroid: col_centroid || null,
    // Pass aggregated candidate context so checklist can surface station-level items
    // that depend on whether ANY promising candidate triggers a given requirement.
    has_treaty_candidates: scored.some(c => !!c.treaty_zone),
    any_poor_conductivity:  scored.some(c => (c.ground_sigma_mS_m ?? 4) < 2),
    any_zone_table_sigma:   scored.some(c => c.ground_sigma_filing_grade !== 'filing')
  });

  // ---- 13. Candidate shortlist — top 3 PROMISING (or best available) candidates ----
  // A compact summary for display and handoff to the engineering team.  Each entry
  // gets a 2-sentence action statement synthesized from the screening metrics.
  const candidate_shortlist = (() => {
    // Prefer PROMISING candidates; fall back to any non-NON_COMPLIANT if none exist.
    const promising = returned.filter(c => c.status_category === 'PROMISING');
    const pool = promising.length > 0 ? promising : returned.filter(c => c.status_category !== 'NON_COMPLIANT');
    return pool.slice(0, 3).map(c => {
      const dist = c.distance_from_current_km != null ? `${c.distance_from_current_km.toFixed(1)} km ${c.cardinal_direction ?? ''}` : 'unknown distance';
      const col  = c.col_coverage_pct != null ? `${(c.col_coverage_pct * 100).toFixed(0)}%` : '?%';
      const sigma = c.ground_sigma_quality ?? 'unknown';
      const band = c.score_confidence_band;
      const bandStr = band ? `score ${c.score.toFixed(1)} [${band.score_low}–${band.score_high}]` : `score ${c.score?.toFixed(1) ?? '?'}`;
      const action = c.status_category === 'PROMISING'
        ? `Advance to full §73.182 NIF study and parcel investigation.`
        : c.status_category === 'RECOVERABLE_WITH_POWER_INCREASE'
        ? `Increase TPO to ≥${c.minimum_tpo_for_col_coverage_kw} kW to achieve §73.24(j) compliance, then advance to NIF study.`
        : c.status_category === 'RECOVERABLE_WITH_DA'
        ? `Commission §73.150 directional antenna study to push 5 mV/m contour toward community of license.`
        : c.status_category === 'TREATY_REVIEW'
        ? `Initiate FCC International Bureau treaty coordination before any other action.`
        : `Engineering review required before advancing — see per_candidate_engineering_checklist.`;
      return {
        rank: c.rank,
        lat: c.lat, lon: c.lon,
        status_category: c.status_category,
        score_with_band: bandStr,
        summary: `Rank ${c.rank} @ ${dist}: COL coverage ${col}, σ=${c.ground_sigma_mS_m ?? '?'} mS/m (${sigma}), reach ${c.daytime_reach_km?.toFixed(0) ?? '?'} km. ${action}`,
        recommended_next_step: action
      };
    });
  })();

  // ---- 14. Candidate set diversity ----
  // Cross-candidate analysis: directional spread, conductivity spread, score spread.
  // Helps operators identify if the search returned a geographically clustered or
  // informationally redundant set.
  const candidate_set_diversity = (() => {
    if (returned.length < 2) return { note: 'Insufficient candidates for diversity analysis.' };
    const bearings = returned.map(c => c.bearing_deg).filter(b => b != null);
    const sigmas   = returned.map(c => c.ground_sigma_mS_m).filter(s => s != null);
    const scores   = returned.map(c => c.score).filter(s => s != null);
    const dists    = returned.map(c => c.distance_from_current_km).filter(d => d != null);

    // Bearing spread: max angular difference in the returned set.
    let bearingSpreadDeg = null;
    if (bearings.length >= 2){
      const sorted = [...bearings].sort((a, b) => a - b);
      let maxGap = 0;
      for (let i = 1; i < sorted.length; i++){
        maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
      }
      const wraparound = 360 - sorted.at(-1) + sorted[0];
      maxGap = Math.max(maxGap, wraparound);
      bearingSpreadDeg = round2(360 - maxGap); // the actual arc covered
    }

    const sigmaRange = sigmas.length >= 2 ? round2(Math.max(...sigmas) - Math.min(...sigmas)) : null;
    const scoreRange = scores.length >= 2 ? round2(Math.max(...scores) - Math.min(...scores)) : null;
    const distRange  = dists.length >= 2 ? round2(Math.max(...dists) - Math.min(...dists)) : null;

    const directionalCoverage = bearingSpreadDeg == null ? 'UNKNOWN'
      : bearingSpreadDeg >= 270 ? 'EXCELLENT (>270° compass arc covered)'
      : bearingSpreadDeg >= 180 ? 'GOOD (>180° arc)'
      : bearingSpreadDeg >= 90  ? 'MODERATE (>90° arc — consider candidates in other quadrants)'
      : 'POOR (<90° arc — candidates are clustered in one direction; expand search)';

    const sigmaVariety = sigmaRange == null ? 'UNKNOWN'
      : sigmaRange >= 6 ? 'HIGH — wide range of conductivity environments sampled'
      : sigmaRange >= 3 ? 'MODERATE'
      : 'LOW — candidates have similar conductivity; all subject to same σ uncertainty';

    return {
      n_candidates: returned.length,
      bearing_spread_deg: bearingSpreadDeg,
      directional_coverage_assessment: directionalCoverage,
      sigma_range_msm: sigmaRange,
      sigma_variety_assessment: sigmaVariety,
      score_range: scoreRange,
      distance_range_km: distRange,
      recommendation: bearingSpreadDeg != null && bearingSpreadDeg < 90
        ? 'EXPAND SEARCH: candidates are directionally clustered. Try a larger search radius or adjust grid_spacing_km to sample all compass quadrants.'
        : returned.length < 5
        ? 'LIMITED POOL: fewer than 5 candidates returned — increase search_radius_km or reduce grid_spacing_km for a more complete search.'
        : 'ADEQUATE: candidate set shows reasonable geographic spread for screening.'
    };
  })();

  // ---- 14a. Candidate scoring audit ----
  // Transparency report on how many candidates were scored vs. returned, with
  // distribution of truncated-out candidates by status.  Helps engineers
  // understand what they might be missing above the candidate_limit cutoff.
  const candidate_scoring_audit = (() => {
    const truncated = scored.length - returned.length;
    const truncatedByStatus = {};
    for (const c of scored.slice(returned.length)) {
      const s = c.status_category ?? 'UNKNOWN';
      truncatedByStatus[s] = (truncatedByStatus[s] ?? 0) + 1;
    }
    const returnedScores = returned.map(c => c.score);
    const lowestReturnedScore = returnedScores.length ? Math.min(...returnedScores) : null;
    const truncatedScores = scored.slice(returned.length).map(c => c.score);
    const highestTruncatedScore = truncatedScores.length ? Math.max(...truncatedScores) : null;

    // Tie detection: are any truncated candidates within 1 point of the last returned?
    const tiedCandidates = truncatedScores.filter(s => s != null && lowestReturnedScore != null
      && Math.abs(s - lowestReturnedScore) < 1.0).length;

    const warnings_out = [];
    if (tiedCandidates > 0) {
      warnings_out.push(`${tiedCandidates} truncated candidate(s) within 1 score point of the cutoff — consider increasing candidate_limit to resolve the tie.`);
    }
    if (truncated > 0 && (truncatedByStatus.PROMISING ?? 0) > 0) {
      warnings_out.push(`${truncatedByStatus.PROMISING} PROMISING candidate(s) were truncated due to candidate_limit. Increase limit to see all PROMISING sites.`);
    }

    return {
      total_scored: scored.length,
      total_returned: returned.length,
      total_truncated: truncated,
      truncated_by_status: truncated > 0 ? truncatedByStatus : null,
      lowest_returned_score: lowestReturnedScore,
      highest_truncated_score: highestTruncatedScore,
      score_gap_at_cutoff: (lowestReturnedScore != null && highestTruncatedScore != null)
        ? round2(lowestReturnedScore - highestTruncatedScore) : null,
      tied_at_cutoff: tiedCandidates > 0,
      audit_warnings: warnings_out.length > 0 ? warnings_out : null
    };
  })();

  // ---- 14b. Candidate set statistics ----
  // Aggregate numeric statistics across returned candidates for UI charts/summaries.
  const candidate_set_statistics = (() => {
    if (returned.length === 0) return null;
    const nums = (arr) => arr.filter(v => v != null && isFinite(v));
    const mean = (arr) => { const n = nums(arr); return n.length ? round2(n.reduce((a, b) => a + b, 0) / n.length) : null; };
    const minOf = (arr) => { const n = nums(arr); return n.length ? round2(Math.min(...n)) : null; };
    const maxOf = (arr) => { const n = nums(arr); return n.length ? round2(Math.max(...n)) : null; };
    const median = (arr) => {
      const n = nums(arr).sort((a, b) => a - b);
      if (!n.length) return null;
      const m = Math.floor(n.length / 2);
      return n.length % 2 === 0 ? round2((n[m - 1] + n[m]) / 2) : n[m];
    };

    const scores = returned.map(c => c.score);
    const reaches = returned.map(c => c.daytime_reach_km);
    const cols = returned.map(c => c.col_coverage_pct != null ? round2(c.col_coverage_pct * 100) : null);
    const sigmas = returned.map(c => c.ground_sigma_mS_m);
    const risks = returned.map(c => c.regulatory_risk_score?.risk_score ?? null);
    const overlaps = returned.map(c => c.coverage_overlap_analysis?.overlap_fraction ?? null);
    const dists = returned.map(c => c.distance_from_current_km ?? null);

    const continuity_distribution = {};
    for (const c of returned) {
      const cc = c.coverage_overlap_analysis?.coverage_continuity ?? 'UNKNOWN';
      continuity_distribution[cc] = (continuity_distribution[cc] ?? 0) + 1;
    }
    const status_distribution = {};
    for (const c of returned) {
      const s = c.status_category ?? 'UNKNOWN';
      status_distribution[s] = (status_distribution[s] ?? 0) + 1;
    }
    const risk_distribution = {};
    for (const c of returned) {
      const r = c.regulatory_risk_score?.risk_category ?? 'UNKNOWN';
      risk_distribution[r] = (risk_distribution[r] ?? 0) + 1;
    }

    return {
      n: returned.length,
      score:         { mean: mean(scores),  min: minOf(scores),  max: maxOf(scores),  median: median(scores) },
      daytime_reach: { mean: mean(reaches), min: minOf(reaches), max: maxOf(reaches), median: median(reaches), unit: 'km' },
      col_coverage:  { mean: mean(cols),    min: minOf(cols),    max: maxOf(cols),    median: median(cols),   unit: 'pct' },
      sigma:         { mean: mean(sigmas),  min: minOf(sigmas),  max: maxOf(sigmas),  unit: 'mS/m' },
      risk_score:    { mean: mean(risks),   min: minOf(risks),   max: maxOf(risks),   median: median(risks) },
      overlap_fraction: { mean: mean(overlaps), min: minOf(overlaps), max: maxOf(overlaps), median: median(overlaps) },
      distance_km:   { mean: mean(dists),   min: minOf(dists),   max: maxOf(dists),   median: median(dists) },
      status_distribution,
      risk_distribution,
      continuity_distribution
    };
  })();

  // ---- 15. Candidate comparison table ----
  // Compact tabular view of all returned candidates on the 7 key screening metrics.
  // Useful for UI comparison tables and quick-scan decision making.
  // Supplements `candidates` (which has full details) with a lighter structure.
  const candidate_comparison_table = returned.map(c => ({
    rank:                   c.rank,
    go_no_go:               c.site_viability_summary?.go_no_go ?? null,
    viability_confidence:   c.site_viability_summary?.confidence ?? null,
    lat:                    c.lat,
    lon:                    c.lon,
    distance_km:            c.distance_from_current_km,
    direction:              c.cardinal_direction,
    score:                  c.score,
    status:                 c.status_category,
    col_coverage_pct:       c.col_coverage_pct,
    daytime_reach_km:       c.daytime_reach_km,
    blanket_pop_pct:        c.blanket_population_pct,
    sigma_msm:              c.ground_sigma_mS_m,
    sigma_quality:          c.ground_sigma_quality,
    treaty_zone:            c.treaty_zone ?? null,
    score_confidence:       c.score_confidence,
    uncertainty_pts:        c.score_confidence_band?.uncertainty_pts ?? null,
    feasibility_verdict:    c.coverage_feasibility_assessment?.verdict ?? null,
    pathway_weeks:          c.compliance_pathway?.estimated_weeks_to_filing ?? null,
    pathway_min_weeks:      c.compliance_pathway?.estimated_weeks_min ?? null,
    timeline_label:         c.compliance_pathway?.timeline_label ?? null,
    risk_score:             c.regulatory_risk_score?.risk_score ?? null,
    risk_category:          c.regulatory_risk_score?.risk_category ?? null,
    score_delta:            c.score_delta_vs_baseline ?? null,
    col_coverage_gap_pct:   c.col_coverage_gap_pct ?? null,
    min_tpo_for_col_kw:     c.minimum_tpo_for_col_coverage_kw ?? null,
    nighttime_eligibility:  c.nighttime_classification?.eligibility ?? null,
    nif_complexity:         c.nighttime_classification?.nif_complexity ?? null,
    spacing_verdict:        c.co_channel_spacing_estimate?.screening_verdict ?? null,
    fence_m:                c.mpe_rf_exposure_summary?.recommended_fence_distance_m ?? null,
    blanket_km:             c.blanket_1000mvm_km ?? null,
    field_at_col_mvm:       c.field_at_col_centroid_mvm ?? null,
    people_per_kw:          c.power_efficiency_metrics?.people_per_kw ?? null,
    km2_per_kw:             c.power_efficiency_metrics?.km2_per_kw ?? null,
    efficiency_tier:        c.power_efficiency_metrics?.efficiency_tier ?? null,
    da_applicable:          c.da_gain_potential?.applicable ?? null,
    da_col_pct_estimate:    c.da_gain_potential?.da_col_coverage_estimate_pct ?? null,
    da_would_recover:       c.da_gain_potential?.would_recover_col_compliance ?? null,
    estimated_erp_kw:       c.antenna_system_summary?.estimated_erp_kw ?? null,
    erp_efficiency_pct:     c.antenna_system_summary?.erp_vs_tpo_ratio != null
      ? round2(c.antenna_system_summary.erp_vs_tpo_ratio * 100) : null,
    land_use_class:         c.land_use_classification?.class ?? null,
    density_factor:         c.land_use_classification?.density_factor ?? null,
    overlap_fraction:       c.coverage_overlap_analysis?.overlap_fraction ?? null,
    coverage_continuity:    c.coverage_overlap_analysis?.coverage_continuity ?? null,
    cost_tier:              c.tower_cost_estimate?.cost_tier ?? null,
    cost_low_usd:           c.tower_cost_estimate?.total_low_usd ?? null,
    cost_high_usd:          c.tower_cost_estimate?.total_high_usd ?? null,
    seasonal_variability:   c.seasonal_conductivity_note?.seasonal_variability ?? null,
    seasonal_risk:          c.seasonal_conductivity_note?.risk_level ?? null,
    power_upgrade_verdict:  c.power_upgrade_analysis?.verdict ?? null,
    headroom_kw:            c.power_upgrade_analysis?.headroom_kw ?? null,
    da_study_recommended:   c.directional_antenna_study_guide?.recommended ?? null,
    da_study_type:          c.directional_antenna_study_guide?.study_type ?? null,
    skywave_advisory_level: c.skywave_protection_advisory?.advisory_level ?? null,
    feedline_loss_db:       c.transmission_line_analysis?.feedline_options?.find(f => f.id === (c.transmission_line_analysis?.recommended_feedline_id))?.total_loss_db_at_60m ?? null,
    erp_at_antenna_kw:      c.transmission_line_analysis?.feedline_options?.find(f => f.id === (c.transmission_line_analysis?.recommended_feedline_id))?.erp_at_antenna_kw ?? null,
    soft_cost_low_usd:      c.permit_and_engineering_cost_estimate?.total_soft_cost_low_usd ?? null,
    soft_cost_high_usd:     c.permit_and_engineering_cost_estimate?.total_soft_cost_high_usd ?? null,
    soft_cost_tier:         c.permit_and_engineering_cost_estimate?.cost_tier ?? null
  }));

  // ---- 16a. Frequency allocation context ----
  // Response-level block describing the operator's channel class and the key
  // regulatory obligations that flow from it.  Gives FCC counsel and engineers
  // an at-a-glance reference before they dig into per-candidate detail.
  const frequency_allocation_context = (() => {
    const isClear    = chanClass === 'clear_channel';
    const isRegional = chanClass === 'regional';
    const isLocal    = chanClass === 'local';

    const channel_class_label = isClear ? 'Clear Channel' : isRegional ? 'Regional Channel' : 'Local Channel';
    const channel_class_cfr   = isClear ? '47 CFR §73.21(a)' : isRegional ? '47 CFR §73.21(b)' : '47 CFR §73.21(c)';

    // Does this frequency have an FCC-designated dominant (Class A) station?
    // We approximate: clear-channel freqs in the 640-1210 kHz set are all
    // designated clear channels per §73.25/§73.26.  The station itself may
    // or may not be the dominant.
    const dominant_station_note = isClear
      ? `${frequency_khz} kHz is a clear channel with a designated Class A dominant station. All other stations (Class B/D) must protect the dominant's primary service area at night.`
      : isRegional
      ? `${frequency_khz} kHz is a regional channel. Class B stations share the frequency with §73.37 co-channel protections; no single dominant station exists.`
      : `${frequency_khz} kHz is a local channel. Class C stations operate at 250 W maximum with simplified §73.37 separations. Daytime-only or limited-time operations are common.`;

    // NIF obligation
    const nif_obligation = isLocal
      ? 'NOT REQUIRED'
      : isClear ? 'REQUIRED — full Class A skywave NIF protection study (§73.182). High complexity; typically 6–12 consultant-weeks.'
      : 'REQUIRED — Class B skywave NIF protection study (§73.182). Moderate complexity; typically 3–8 consultant-weeks.';

    // Power ceiling at this class
    const pwr = FCC_CLASS_POWER_KW[fcc_class] ?? null;
    const power_ceiling_note = pwr
      ? `Class ${fcc_class} TPO range: ${pwr.min}–${pwr.max} kW (47 CFR §73.21).`
      : `Class ${fcc_class}: see 47 CFR §73.21 for TPO limits.`;

    // Adjacent-channel clear-channel note
    const adjChannels = [-10, 10].map(d => frequency_khz + d).filter(f => CLEAR_CHANNEL_KHZ.has(f));
    const adj_clear_note = adjChannels.length > 0
      ? `±10 kHz adjacent channel(s) ${adjChannels.join(', ')} kHz are clear channels — extra §73.37 first-adjacent protection applies.`
      : null;

    // Nighttime summary
    const nighttime_summary = isClear
      ? 'RESTRICTED — Must protect the dominant Class A skywave contour. Directional antenna (§73.150) or daytime-only STA is typical for Class B/D relocations.'
      : isRegional
      ? 'MODERATE — Class B nighttime requires §73.182 NIF study but no dominant station protection. DA pattern may expand nighttime authority.'
      : 'FLEXIBLE — Class C local channel; §73.182 study not required but short spacing coordination with co-channel licensees is still needed.';

    const implications = [
      power_ceiling_note,
      dominant_station_note,
      adj_clear_note,
      `NIF obligation: ${nif_obligation}`,
      `Nighttime authority: ${nighttime_summary}`
    ].filter(Boolean);

    return {
      frequency_khz,
      channel_class: chanClass,
      channel_class_label,
      channel_class_cfr,
      fcc_class,
      nif_required: !isLocal,
      nighttime_flexibility: isLocal ? 'HIGH' : isClear ? 'LOW' : 'MODERATE',
      adj_clear_channel_frequencies: adjChannels.length > 0 ? adjChannels : null,
      implications
    };
  })();

  // ---- 16. Engineering summary (executive-level synthesis) ----
  // A structured plain-language summary suitable for inclusion in an engineering
  // report, legal memo, or FCC counsel briefing.  Synthesizes the top findings
  // across all candidates into 3-5 actionable statements.
  const engineering_summary = (() => {
    const promising = returned.filter(c => c.status_category === 'PROMISING');
    const nCompliant = candidate_count_by_status.NON_COMPLIANT ?? 0;
    const nPromising = candidate_count_by_status.PROMISING ?? 0;
    const nReview    = candidate_count_by_status.REVIEW_REQUIRED ?? 0;
    const bestCandidate = returned[0] ?? null;
    const treatyCandidates = returned.filter(c => !!c.treaty_zone);

    // Headline: how many usable sites were found?
    const sitePoolStatement = nPromising > 0
      ? `Screening of ${scored.length} grid candidates within ${search_radius_km} km of ${callsign}'s current site (${current_site.lat.toFixed(4)}°N, ${Math.abs(current_site.lon).toFixed(4)}°W) identified ${nPromising} PROMISING candidate(s) and ${nReview} candidates requiring engineering review.`
      : nCompliant < scored.length
      ? `Screening of ${scored.length} grid candidates identified no PROMISING candidates — ${nCompliant} are non-compliant with §73.24(j)/(g) at current TPO and ${scored.length - nCompliant} require engineering review.`
      : `All ${scored.length} grid candidates evaluated at ${tpo_kw} kW TPO are non-compliant at current power. Power increase or DA pattern may recover some candidates.`;

    // Top candidate statement
    let topStatement = null;
    if (bestCandidate){
      const dir = bestCandidate.cardinal_direction ?? '';
      const dist = bestCandidate.distance_from_current_km != null ? `${bestCandidate.distance_from_current_km.toFixed(1)} km ${dir}` : '';
      const col = bestCandidate.col_coverage_pct != null ? `${(bestCandidate.col_coverage_pct * 100).toFixed(0)}% COL coverage` : null;
      const reach = bestCandidate.daytime_reach_km != null ? `${bestCandidate.daytime_reach_km.toFixed(0)} km daytime reach` : null;
      const risk = bestCandidate.regulatory_risk_score?.risk_category ?? null;
      const parts = [col, reach].filter(Boolean).join(', ');
      topStatement = `The top-ranked site (${dist}) achieves ${parts || 'competitive screening metrics'} at ${tpo_kw} kW TPO on ${frequency_khz} kHz.${risk ? ` Regulatory risk: ${risk}.` : ''}`;
    }

    // Conductivity statement
    const poorSigmaCandidates = returned.filter(c => (c.ground_sigma_mS_m ?? 4) < 2).length;
    const conductivityStatement = !rasterLoaded
      ? `Conductivity data uses the FCC M3 zone table (15-zone fallback). Deploying the AM_m3.tif GeoTIFF raster will improve ranking precision and bring conductivity sub-scores to filing-grade accuracy.`
      : poorSigmaCandidates > 0
      ? `${poorSigmaCandidates} returned candidate(s) have POOR conductivity (σ < 2 mS/m); extended ground systems and §73.190 surveys will be required before site commitment.`
      : null;

    // ASR statement
    const asrRequired = quarter_wave_m > 60.96;
    const asrStatement = asrRequired
      ? `At ${frequency_khz} kHz, all standard antenna heights (λ/4 = ${quarter_wave_m} m) exceed the §17.7 200-ft (60.96 m) ASR threshold — every candidate requires FCC Form 854 registration and FAA aeronautical study before construction.`
      : null;

    // Treaty statement
    const treatyStatement = treatyCandidates.length > 0
      ? `${treatyCandidates.length} candidate(s) fall within an international treaty zone — FCC International Bureau coordination is a blocking prerequisite for those sites.`
      : null;

    // NIF statement
    const nifStatement = chanClass !== 'local'
      ? `As a ${chanClass} channel station (${frequency_khz} kHz Class ${fcc_class}), a §73.182 nighttime NIF study is required at any selected site before Form 301-AM can be filed. ${skywave_risk_level === 'HIGH' ? 'Clear-channel NIF is complex — budget 4–12 weeks of consulting time.' : ''}`
      : null;

    const statements = [sitePoolStatement, topStatement, conductivityStatement, asrStatement, treatyStatement, nifStatement]
      .filter(Boolean);

    return {
      callsign,
      frequency_khz,
      fcc_class,
      tpo_kw,
      n_candidates_evaluated: scored.length,
      n_promising: nPromising,
      n_review_required: nReview,
      n_non_compliant: nCompliant,
      overall_feasibility: nPromising > 0 ? 'SITES_AVAILABLE'
        : (nReview > 0 || (candidate_count_by_status.RECOVERABLE_WITH_POWER_INCREASE ?? 0) > 0) ? 'SITES_RECOVERABLE'
        : 'NO_SITES_AT_CURRENT_PARAMETERS',
      statements,
      caveats: [
        'This is a SCREENING-GRADE analysis only — field measurements, §73.182 NIF study, and full engineering design are required before filing.',
        'Candidate scores use FCC M3 groundwave curves and population proxies; actual coverage contours must be computed per §73.183/§73.184.',
        'Parcel availability, lease feasibility, zoning, and environmental review are outside the scope of this analysis.'
      ]
    };
  })();

  // ---- 18. Filing complexity score ----
  const filing_complexity_score = buildFilingComplexityScore({
    chanClass, fcc_class, frequency_khz, returned, asr_threshold_m: ASR_THRESHOLD_M
  });

  // ---- 19. Total project cost estimate ----
  // Response-level summary combining soft costs (filing + engineering) and
  // hard costs (tower + ground + construction) for each top candidate.
  // Enables stakeholder budget conversations before committing to site selection.
  const total_project_cost_estimate = (() => {
    const rows = returned.slice(0, 5).map(c => {
      const soft   = c.permit_and_engineering_cost_estimate;
      const hard   = c.tower_cost_estimate;
      if (!soft && !hard) return null;
      const soft_low  = soft?.total_soft_cost_low_usd ?? 0;
      const soft_high = soft?.total_soft_cost_high_usd ?? 0;
      const hard_low  = hard?.total_low_usd ?? 0;
      const hard_high = hard?.total_high_usd ?? 0;
      const total_low  = Math.round(soft_low  + hard_low);
      const total_high = Math.round(soft_high + hard_high);
      return {
        rank:           c.rank,
        status:         c.status_category,
        soft_cost_low:  soft_low,
        soft_cost_high: soft_high,
        hard_cost_low:  hard_low,
        hard_cost_high: hard_high,
        total_low_usd:  total_low,
        total_high_usd: total_high,
        range_label:    `$${(total_low / 1000).toFixed(0)}k–$${(total_high / 1000).toFixed(0)}k`,
        cost_tier:      total_high > 800000 ? 'VERY_HIGH'
          : total_high > 400000 ? 'HIGH'
          : total_high > 150000 ? 'MODERATE'
          : 'LOW'
      };
    }).filter(Boolean);

    const best = rows.length ? rows.reduce((a, b) => a.total_low_usd < b.total_low_usd ? a : b) : null;

    return {
      top_candidates: rows,
      lowest_cost_candidate_rank: best?.rank ?? null,
      lowest_total_low_usd:  best?.total_low_usd ?? null,
      lowest_total_high_usd: best?.total_high_usd ?? null,
      note: 'All figures 2024 USD, screening-grade. Does not include land/lease costs, transmitter equipment, or facility upgrades. Add 20–35% contingency for accurate project budgeting.'
    };
  })();

  return {
    available: true,
    method: 'grid-search + per-goal sub-scoring (SCREENING ONLY)',
    n_candidates_evaluated: scored.length,
    n_candidates_returned:  returned.length,
    scoring_time_ms,
    candidate_count_by_status,
    top_candidates_summary,
    candidate_shortlist,
    candidate_set_diversity,
    candidate_comparison_table,
    engineering_summary,
    frequency_allocation_context,
    candidate_set_statistics,
    candidate_scoring_audit,
    filing_complexity_score,
    total_project_cost_estimate,
    current_site_baseline:  baselineSummary(baseline),
    candidates: returned,
    score_stats,
    score_histogram,
    optimization_confidence,
    conductivity_mode,
    frequency_channel_class: chanClass,
    skywave_risk_level,
    protection_class_advisory,
    recommended_actions,
    form_301_checklist,
    protection_requirements: buildProtectionRequirements({
      fcc_class, frequency_khz, channel_class: chanClass
    }),
    minimum_spacing_reference: buildMinimumSpacingReference({ fcc_class, channel_class: chanClass }),
    regulatory_timeline_estimate: buildRegulatoryTimeline({
      fcc_class, channel_class: chanClass, skywave_risk_level,
      asr_required: quarter_wave_m > ASR_THRESHOLD_M,
      has_treaty_candidates: returned.some(c => !!c.treaty_zone),
      any_poor_sigma: returned.some(c => (c.ground_sigma_mS_m ?? 4) < 2),
      n_promising: candidate_count_by_status.PROMISING ?? 0
    }),
    tower_reference,
    inputs_echo: {
      callsign, frequency_khz, current_site, search_radius_km,
      grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
      goals_enabled: Object.entries(goals).filter(([_, v]) => v).map(([k]) => k),
      community_of_license_polygon_provided: !!community_of_license_polygon,
      col_centroid_provided: !!col_centroid,
      col_centroid: col_centroid || null,
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

  // Optional COL centroid — when provided, field_at_col_centroid_mvm is
  // computed using the distance from each candidate to this point rather
  // than to the current transmitter site.
  let col_centroid = null;
  if (body.col_centroid){
    const clat = Number(body.col_centroid.lat), clon = Number(body.col_centroid.lon);
    if (Number.isFinite(clat) && clat >= -90 && clat <= 90 &&
        Number.isFinite(clon) && clon >= -180 && clon <= 180){
      col_centroid = { lat: clat, lon: clon };
    } else {
      warnings.push({ code: 'COL_CENTROID_INVALID',
        message: 'col_centroid.lat/lon invalid — ignoring; field_at_col_centroid_mvm will use distance to current_site instead.' });
    }
  }

  return {
    ok: true,
    value: {
      callsign, frequency_khz,
      current_site: { lat, lon },
      search_radius_km, grid_spacing_km, tpo_kw,
      pattern_mode, fcc_class,
      community_of_license_polygon: body.community_of_license_polygon || null,
      col_centroid,
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
  const { frequency_khz, tpo_kw, fcc_class, pattern_mode, current_site, goals,
          community_of_license_polygon, col_centroid, reach_scale_km = 200 } = ctx;

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
  // Land-use classification — distance-based proxy for urban/rural character.
  // Candidates close to the current site (assumed metro/suburban) get higher density;
  // remote candidates get lower.  Conductivity is a secondary signal: high σ in
  // the US correlates with agricultural flatlands (moderate density, not urban).
  const dist_km = pt.distance_from_current_km ?? 0;
  let land_use_class, land_use_density_factor;
  if (dist_km < 15) {
    land_use_class = 'SUBURBAN';  land_use_density_factor = 1.8;   // close to current city
  } else if (dist_km < 35) {
    land_use_class = 'SUBURBAN_RURAL'; land_use_density_factor = 1.0;  // mixed
  } else if (dist_km < 80) {
    land_use_class = 'RURAL';    land_use_density_factor = 0.55;  // regional rural
  } else {
    land_use_class = 'REMOTE';   land_use_density_factor = 0.30;  // remote / large radius
  }
  // High σ (≥8 mS/m) in the US = agriculture-dominated flatlands → lower density than suburban
  if (sigma_msm >= 8 && land_use_density_factor > 0.55) land_use_density_factor = Math.min(land_use_density_factor, 0.80);
  const regional_density_per_km2 = round2(US_AVG_POP_DENSITY_PER_KM2 * land_use_density_factor);

  let daytime_reach_km = null;
  let estimated_daytime_population_served = null;
  try {
    const r = fccAmDistanceKm({
      frequency_khz,
      target_mvm: DAYTIME_REACH_TARGET_MVM,
      conductivity_msm: sigma_msm,
      erp_kw: tpo_kw
    });
    daytime_reach_km = r.distance_km;
    if (daytime_reach_km > 0){
      const reach_area_km2 = Math.PI * daytime_reach_km * daytime_reach_km;
      // Distance-adjusted density: near-city candidates serve denser areas;
      // far/remote candidates serve rural areas.  National avg × factor.
      estimated_daytime_population_served = Math.round(reach_area_km2 * regional_density_per_km2);
    }
  } catch (e){
    // M3 / range errors fall through to NOT-EVALUATED for this candidate.
    warnings.push({ code: 'CURVE_LOOKUP_FAILED', message: `fccAmDistanceKm failed at (${pt.lat.toFixed(3)}, ${pt.lon.toFixed(3)}): ${e.message}` });
  }

  // 1b. Multi-contour population reach bands.
  //     Five standard field-strength contours: 5.0, 2.0, 1.0, 0.5, 0.25 mV/m.
  //     Each band gives: distance_km, area_km2, and estimated_population (density proxy).
  //     Useful for comparing relative audience reach across candidates without full §73.183 study.
  const population_reach_bands = (() => {
    const targets = [
      { mvm: 5.0,  label: '5 mV/m (§73.24(j) principal community)' },
      { mvm: 2.0,  label: '2 mV/m (urban fringe / primary coverage)' },
      { mvm: 1.0,  label: '1 mV/m (rural primary)' },
      { mvm: 0.5,  label: '0.5 mV/m (§73.24 secondary daytime)' },
      { mvm: 0.25, label: '0.25 mV/m (fringe / distant secondary)' }
    ];
    const bands = [];
    for (const { mvm, label } of targets) {
      try {
        const r = fccAmDistanceKm({ frequency_khz, target_mvm: mvm, conductivity_msm: sigma_msm, erp_kw: tpo_kw });
        const dist_km = r.distance_km;
        const area_km2 = round2(Math.PI * dist_km * dist_km);
        const est_pop = Math.round(area_km2 * regional_density_per_km2);
        bands.push({
          target_mvm: mvm,
          label,
          distance_km: round2(dist_km),
          area_km2,
          estimated_population: est_pop
        });
      } catch (_) {
        bands.push({ target_mvm: mvm, label, distance_km: null, area_km2: null, estimated_population: null });
      }
    }
    return { bands, note: 'Screening-grade circular-area population estimate using distance-adjusted density proxy. Not a §73.183 propagation contour.' };
  })();

  // 2. Principal-community coverage (§73.24(j)).  When a polygon was
  //    supplied we compute the fraction of the COL boundary inside the
  //    5 mV/m daytime contour (modeled as a circle of radius =
  //    fccAmDistanceKm(target=5 mV/m)).  When no polygon was supplied
  //    we estimate "coverage" as the fraction of the COL polygon
  //    proxy (a 10-km disc centered on the current site, treated as a
  //    rough community) inside the 5-mV/m circle.
  let coverage_pct = null;
  let coverage_computed_from = 'none';
  let principal_community_5mvm_km = null;
  try {
    const r5 = fccAmDistanceKm({
      frequency_khz,
      target_mvm: 5.0,
      conductivity_msm: sigma_msm,
      erp_kw: tpo_kw
    });
    const r5km = r5.distance_km;
    principal_community_5mvm_km = round2(r5km);
    if (community_of_license_polygon){
      coverage_pct = polygonCoverageFraction({
        polygon: community_of_license_polygon,
        circle_center: pt,
        circle_radius_km: r5km
      });
      coverage_computed_from = 'polygon-overlap (Monte-Carlo)';
    } else {
      // Proxy COL = 10 km disc centered on the community of license.
      // When col_centroid is provided, use it; otherwise fall back to the
      // current transmitter site as a rough proxy for the COL location.
      const colCenter = col_centroid ?? current_site;
      coverage_pct = discCoverageFraction({
        circle_center: pt,
        circle_radius_km: r5km,
        disc_center: colCenter,
        disc_radius_km: 10
      });
      coverage_computed_from = col_centroid
        ? 'disc-disc analytical proxy (10 km COL at supplied centroid)'
        : 'disc-disc analytical proxy (10 km COL at current site)';
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
  let blanket_1000mvm_km = null;
  try {
    const r1000 = fccAmDistanceKm({
      frequency_khz, target_mvm: 1000, conductivity_msm: sigma_msm, erp_kw: tpo_kw
    }).distance_km;
    if (r1000 > 0){
      blanket_1000mvm_km = round2(r1000);
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

  // 3a-c. Groundwave contour table — distances to the four key FCC service contours.
  // 25 mV/m = §73.24(j) "principal community" service for dominant stations;
  //  5 mV/m = §73.24(j) standard COL floor;
  //  2 mV/m = §73.24 secondary service;
  //  0.5 mV/m = protected daytime contour.
  // Reuses the same M3 conductivity already computed above.
  // Returns null for a contour if the curve lookup throws.
  const groundwave_contour_table = (() => {
    const levels = [
      { mvm: 25,  label: '25 mV/m', note: '§73.24(j) dominant principal-community contour' },
      { mvm: 5,   label: '5 mV/m',  note: '§73.24(j) COL service floor' },
      { mvm: 2,   label: '2 mV/m',  note: 'Secondary service area' },
      { mvm: 0.5, label: '0.5 mV/m', note: 'Protected daytime contour' }
    ];
    return levels.map(({ mvm, label, note }) => {
      try {
        const r = fccAmDistanceKm({ frequency_khz, target_mvm: mvm, conductivity_msm: sigma_msm, erp_kw: tpo_kw });
        return { mvm, label, distance_km: round2(r.distance_km), note };
      } catch (_){
        return { mvm, label, distance_km: null, note };
      }
    });
  })();

  // 3a-d. Field strength profile at key distances — used by engineers to
  // assess service at specific community locations without running a full
  // contour study.  6 canonical distances: 1, 5, 10, 25, 50, 100 km.
  const field_strength_profile = (() => {
    const distances = [1, 5, 10, 25, 50, 100];
    return distances.map(d => {
      try {
        const mvm = fccAmFieldMvmAtDistance({ frequency_khz, distance_km: d, conductivity_msm: sigma_msm, erp_kw: tpo_kw });
        const mvmR = Math.round(mvm * 1000) / 1000;
        return {
          distance_km: d,
          field_mvm: mvmR,
          // FCC service tier labels.
          tier: mvmR >= 1000 ? 'blanket (§73.24(g))'
              : mvmR >= 25   ? 'local dominant (25 mV/m)'
              : mvmR >= 5    ? 'COL service (§73.24(j))'
              : mvmR >= 2    ? 'secondary service'
              : mvmR >= 0.5  ? 'protected daytime'
              : mvmR >= 0.1  ? 'fringe'
              : 'below fringe'
        };
      } catch (_){
        return { distance_km: d, field_mvm: null, tier: null };
      }
    });
  })();

  // 3a-e. TPO-to-coverage table — minimum TPO (kW) required to produce 5 mV/m
  // at each of several canonical COL-centroid distances.  Uses binary search
  // on fccAmFieldMvmAtDistance (O(1) per call) rather than fccAmDistanceKm.
  const tpo_to_coverage_table = (() => {
    const classCeil = FCC_CLASS_POWER_KW[fcc_class]?.max ?? 50;
    const distances = [5, 10, 15, 20, 30, 50];
    return distances.map(d => {
      try {
        // Binary-search TPO in [0.001, classCeil×2] so that field at d km = 5 mV/m.
        // fccAmFieldMvmAtDistance is a direct table lookup — much faster than fccAmDistanceKm.
        let lo = 0.001, hi = classCeil * 2;
        for (let iter = 0; iter < 25; iter++){
          const mid = (lo + hi) / 2;
          const f = fccAmFieldMvmAtDistance({ frequency_khz, distance_km: d, conductivity_msm: sigma_msm, erp_kw: mid });
          if (f < 5.0) lo = mid; else hi = mid;
        }
        const tpoNeeded = round2((lo + hi) / 2);
        return {
          col_distance_km: d,
          tpo_needed_kw: tpoNeeded,
          within_class_ceiling: tpoNeeded <= classCeil,
          rule: '47 CFR §73.24(j) 5 mV/m floor'
        };
      } catch (_){
        return { col_distance_km: d, tpo_needed_kw: null, within_class_ceiling: null, rule: '47 CFR §73.24(j) 5 mV/m floor' };
      }
    });
  })();

  // 3b. Minimum-TPO for §73.24(g) compliance — only computed when blanket
  //     pop fails (blanket_population_pct > 1%).  Binary search on TPO to
  //     find the highest power where the proxy blanket pop stays ≤ 1%.
  let minimum_tpo_for_compliance_kw = null;
  if (blanket_population_pct != null && blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT){
    try {
      const dist = pt.distance_from_current_km ?? 0;
      const urbanFactor = 1.0 + 4.0 * Math.max(0, 1 - Math.min(1, dist / 50));
      const regional_density = US_AVG_POP_DENSITY_PER_KM2 * urbanFactor;
      // Target r1000 such that π × r² × density / US_POP × 100 = 1.0
      const r_target_km = Math.sqrt((US_POPULATION_M * 0.01) / (Math.PI * regional_density));
      // Binary-search TPO in [0.01, tpo_kw] for r1000 ≤ r_target_km.
      let lo = 0.01, hi = tpo_kw;
      for (let iter = 0; iter < 40; iter++){
        const mid = (lo + hi) / 2;
        const r = fccAmDistanceKm({ frequency_khz, target_mvm: 1000, conductivity_msm: sigma_msm, erp_kw: mid }).distance_km;
        if (r <= r_target_km){ lo = mid; } else { hi = mid; }
      }
      minimum_tpo_for_compliance_kw = round2(lo);
    } catch (_){ /* leave null */ }
  }

  // 3c. Field strength at the COL centroid — inverts the FCC groundwave curve
  //     via binary search on target_mvm to find the field at the distance from
  //     this candidate to the community of license.  When a col_centroid is
  //     supplied we use the great-circle distance from the candidate to that
  //     point; otherwise we fall back to the candidate's distance from the
  //     current transmitter site as a proxy.
  //     §73.24(j) requires the community receive ≥ 5 mV/m daytime.
  let field_at_col_centroid_mvm = null;
  const colDist = col_centroid
    ? greatCircleKm(pt.lat, pt.lon, col_centroid.lat, col_centroid.lon)
    : pt.distance_from_current_km;
  if (colDist != null && colDist >= 0.5 && sigma_msm != null){
    try {
      // Binary search: find X s.t. fccAmDistanceKm(target_mvm=X).distance_km ≈ colDist.
      // Greater X (stronger field req) → shorter distance.  So:
      //   dist_at_mid > colDist → X is too low → lo = mid
      //   dist_at_mid < colDist → X is too high → hi = mid
      let lo = 0.001, hi = 1e5;
      for (let i = 0; i < 50; i++){
        const mid = (lo + hi) / 2;
        const r = fccAmDistanceKm({ frequency_khz, target_mvm: mid, conductivity_msm: sigma_msm, erp_kw: tpo_kw }).distance_km;
        if (r > colDist) lo = mid; else hi = mid;
      }
      field_at_col_centroid_mvm = round2((lo + hi) / 2);
    } catch (_){ /* leave null */ }
  }

  // 3d. Minimum TPO for §73.24(j) COL coverage compliance.
  //     Only computed when field_at_col_centroid_mvm < 5 mV/m (coverage fails).
  //     Binary-searches TPO to find the minimum power where the 5 mV/m contour
  //     extends to the COL centroid distance.  Limited to [tpo_kw, 50 kW] so
  //     we don't recommend power beyond the Class A ceiling.
  let minimum_tpo_for_col_coverage_kw = null;
  if (field_at_col_centroid_mvm != null && field_at_col_centroid_mvm < 5
      && colDist != null && colDist >= 0.5 && sigma_msm != null){
    try {
      // Binary search on TPO: higher TPO → longer 5 mV/m reach.
      // Find min TPO where fccAmDistanceKm(target=5).distance_km >= colDist.
      let lo = tpo_kw, hi = 50;
      // Check if 50 kW is even sufficient; if not, leave null.
      const r_hi = fccAmDistanceKm({ frequency_khz, target_mvm: 5, conductivity_msm: sigma_msm, erp_kw: hi }).distance_km;
      if (r_hi >= colDist){
        for (let iter = 0; iter < 40; iter++){
          const mid = (lo + hi) / 2;
          const r = fccAmDistanceKm({ frequency_khz, target_mvm: 5, conductivity_msm: sigma_msm, erp_kw: mid }).distance_km;
          if (r >= colDist) hi = mid; else lo = mid;
        }
        minimum_tpo_for_col_coverage_kw = round2(hi);
      }
    } catch (_){ /* leave null */ }
  }

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
    // Sqrt scale: groundwave path-loss improvement diminishes with increasing σ.
    // sigma=1→2 mS/m gains ~40% reach; sigma=7→8 gains ~5%. sqrt(σ/8)×100
    // captures this better than linear σ/8×100.
    conductivity: Math.max(0, Math.min(100, Math.sqrt(sigma_msm / SIGMA_PREFERRED_MIN_MSM) * 100)),
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

  // Confidence dampening — candidates scored without filing-grade conductivity
  // data or a real COL polygon carry more physical uncertainty.  Apply a small
  // haircut so well-constrained candidates rank ahead of estimates derived from
  // zone-table σ and a 10-km disc proxy when scores are close.
  // HIGH (filing σ AND polygon): no adjustment.
  // MEDIUM (one of the two): −3%.
  // LOW (neither — zone σ + disc proxy): −7%.
  const _confTier = (ground_sigma_filing_grade === 'filing' && community_of_license_polygon) ? 'HIGH'
    : (ground_sigma_filing_grade === 'filing' || community_of_license_polygon) ? 'MEDIUM'
    : 'LOW';
  const _confFactor = { HIGH: 1.00, MEDIUM: 0.97, LOW: 0.93 }[_confTier];
  const score_final = round2(score * _confFactor);
  // Record the penalty in the breakdown for transparency; omit when zero.
  const _confPenalty = round2(score_final - score);
  if (_confPenalty !== 0) score_breakdown.confidence_penalty = _confPenalty;

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

  // --- candidate narrative summary (plain-English 3-sentence briefing) ---
  const candidate_narrative_summary = (() => {
    const colPctNum   = coverage_pct != null ? Math.round(coverage_pct * 100) : null;
    const colStatus   = coverage_pct == null  ? 'unknown COL coverage'
      : coverage_pct >= COL_COVERAGE_HARD_FLOOR
        ? `${colPctNum}% COL coverage (§73.24(j) PASS)`
        : `${colPctNum}% COL coverage (BELOW §73.24(j) 80% floor)`;
    const sigmaDesc   = sigma_msm >= 8 ? 'excellent' : sigma_msm >= 4 ? 'good' : sigma_msm >= 2 ? 'fair' : 'poor';
    const blankNote   = blanket_population_pct != null && blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT
      ? ` Blanket pop ${round2(blanket_population_pct)}% exceeds §73.24(g) 1% limit — DA pattern or TPO reduction required.`
      : '';
    const treatyNote  = treaty_zone ? ` In ${treaty_zone} treaty zone — FCC IB coordination required.` : '';
    const chanCls     = LOCAL_CHANNEL_KHZ.has(frequency_khz) ? 'local'
      : CLEAR_CHANNEL_KHZ.has(frequency_khz) ? 'clear' : 'regional';
    const nightNote   = chanCls === 'local' ? 'No §73.182 NIF required (local channel).'
      : chanCls === 'clear' && fcc_class !== 'A'
        ? 'Secondary on §73.25 clear channel — §73.182 NIF + DA-N pattern likely required at night.'
        : `§73.182 NIF required (${chanCls} channel).`;
    const remedy      = coverage_pct != null && coverage_pct < COL_COVERAGE_HARD_FLOOR
      ? minimum_tpo_for_col_coverage_kw != null
        ? ` Remedy: increase TPO to ≥${minimum_tpo_for_col_coverage_kw} kW.`
        : ` Remedy: §73.150 DA study toward COL bearing.`
      : '';

    const s1 = `${round2(pt.distance_from_current_km ?? 0)} km ${cardinalDir(pt.bearing_deg ?? null)} of current site (score ${score_final}/100): ${colStatus}.${remedy}`;
    const s2 = `Ground conductivity σ=${sigma_msm} mS/m (${sigmaDesc}); daytime reach ${daytime_reach_km != null ? round2(daytime_reach_km) + ' km' : '?'} to 0.5 mV/m.${blankNote}${treatyNote}`;
    const s3 = nightNote;

    const is_compliant = coverage_pct != null && coverage_pct >= COL_COVERAGE_HARD_FLOOR
      && (blanket_population_pct == null || blanket_population_pct <= BLANKET_POP_HARD_CEIL_PCT);

    return {
      summary:        [s1, s2, s3].filter(Boolean).join(' '),
      status_phrase:  flags.length === 0 ? 'Screening-compliant'
        : `${flags.length} compliance flag(s): ${flags.slice(0,2).join('; ')}`,
      recommendation: is_compliant
        ? 'Advance to site investigation, parcel check, and §73.182 NIF study.'
        : coverage_pct != null && coverage_pct < COL_COVERAGE_HARD_FLOOR
        ? 'Resolve COL coverage gap before advancing to full engineering.'
        : 'Review compliance flags before committing engineering resources.'
    };
  })();

  // --- signal propagation profile (key contour distances) ---
  // Computes field strength at specific regulatory and operational distances:
  //   0.5 mV/m daytime secondary service contour (§73.24 reach metric)
  //   5.0 mV/m principal community 5-mV/m city grade signal
  //   0.1 mV/m interfering contour (DAYTIME I-contour protection boundary)
  //   25 µV/m skywave protected contour radius (OET-72 approximation)
  //   1000 mV/m blanket interference contour radius
  // All distances in km from the candidate transmitter site.
  const signal_propagation_profile = (() => {
    const targets = [
      { id: 'DAYTIME_5MVM',    mvm: 5.0,    label: '5 mV/m (city-grade / §73.24(j) COL floor)' },
      { id: 'DAYTIME_2MVM',    mvm: 2.0,    label: '2 mV/m (primary service contour)' },
      { id: 'DAYTIME_05MVM',   mvm: 0.5,    label: '0.5 mV/m (secondary daytime / §73.24 reach)' },
      { id: 'DAYTIME_01MVM',   mvm: 0.1,    label: '0.1 mV/m (daytime interference floor)' },
      { id: 'BLANKET_1000MVM', mvm: 1000.0, label: '1000 mV/m (§73.24(g) blanket contour)' },
    ];
    const contours = [];
    for (const t of targets){
      try {
        const r = fccAmDistanceKm({ frequency_khz, target_mvm: t.mvm, conductivity_msm: sigma_msm, erp_kw: tpo_kw });
        contours.push({
          id:           t.id,
          label:        t.label,
          target_mvm:   t.mvm,
          distance_km:  r?.distance_km != null ? round2(r.distance_km) : null,
          area_km2:     r?.distance_km != null ? round2(Math.PI * r.distance_km * r.distance_km) : null
        });
      } catch(_) {
        contours.push({ id: t.id, label: t.label, target_mvm: t.mvm, distance_km: null, area_km2: null });
      }
    }
    // Skywave 25 µV/m OET-72 approximation (textbook; not FCC software).
    const sky_km = round2(1700 * Math.sqrt(Math.min(50, tpo_kw) / 1000));
    return {
      frequency_khz,
      tpo_kw,
      sigma_msm,
      contours,
      skywave_25uvm_est_km: sky_km,
      note: 'Groundwave contours use FCC gwave curves (§73.184) at this σ and TPO. Skywave 25 µV/m estimate uses OET-72 textbook approximation — actual NIF requires FCC skywave propagation software.'
    };
  })();

  // --- ranking_rationale sentence ---
  const rationale = buildRationale({
    coverage_pct, daytime_reach_km, blanket_population_pct,
    principal_community_5mvm_km, field_at_col_centroid_mvm,
    minimum_tpo_for_col_coverage_kw, minimum_tpo_for_compliance_kw,
    sigma_msm, distance_from_current_km: pt.distance_from_current_km,
    bearing_deg: pt.bearing_deg ?? null,
    treaty_zone, flags, score: score_final, score_breakdown
  });

  return {
    lat: round6(pt.lat),
    lon: round6(pt.lon),
    distance_from_current_km: round2(pt.distance_from_current_km),
    bearing_deg:         pt.bearing_deg ?? null,
    cardinal_direction:  cardinalDir(pt.bearing_deg ?? null),
    score: score_final,
    candidate_narrative_summary,
    signal_propagation_profile,
    col_coverage_pct:        coverage_pct == null ? null : round2(coverage_pct),
    principal_community_5mvm_km,
    nif_status,
    daytime_reach_km:        daytime_reach_km == null ? null : round2(daytime_reach_km),
    estimated_daytime_population_served,
    population_reach_bands,
    // Land-use classification — distance + σ proxy for population density context.
    land_use_classification: { class: land_use_class, density_per_km2: regional_density_per_km2,
      density_factor: round2(land_use_density_factor),
      note: `Distance ${round2(dist_km)} km from current site → ${land_use_class}; σ=${sigma_msm} mS/m adjustment applied` },
    blanket_population_pct:  blanket_population_pct == null ? null : round2(blanket_population_pct),
    // Qualitative §73.24(g) blanket-population risk tier.
    // OK: well clear of limit; ELEVATED: monitoring warranted; HIGH: near limit; EXCEEDS_LIMIT: non-compliant.
    blanket_pop_risk: blanket_population_pct == null ? null
      : blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT ? 'EXCEEDS_LIMIT'
      : blanket_population_pct >= 0.8 ? 'HIGH'
      : blanket_population_pct >= 0.5 ? 'ELEVATED'
      : 'OK',
    // Structured per-candidate FCC compliance table.  Each entry: status, numeric value, threshold, rule cite.
    regulatory_compliance_summary: {
      col_coverage: {
        status: coverage_pct == null ? 'NOT_EVALUATED'
          : coverage_pct >= COL_COVERAGE_HARD_FLOOR ? 'PASS' : 'FAIL',
        value: coverage_pct == null ? null : round2(coverage_pct),
        threshold: COL_COVERAGE_HARD_FLOOR,
        rule: '47 CFR §73.24(j)'
      },
      blanket_pop: {
        status: blanket_population_pct == null ? 'NOT_EVALUATED'
          : blanket_population_pct <= BLANKET_POP_HARD_CEIL_PCT ? 'PASS' : 'FAIL',
        value: blanket_population_pct == null ? null : round2(blanket_population_pct),
        threshold: BLANKET_POP_HARD_CEIL_PCT,
        rule: '47 CFR §73.24(g)'
      },
      class_power: {
        status: (FCC_CLASS_POWER_KW[fcc_class] && tpo_kw <= FCC_CLASS_POWER_KW[fcc_class].max) ? 'PASS' : 'ADVISORY',
        value: tpo_kw,
        ceiling: FCC_CLASS_POWER_KW[fcc_class]?.max ?? null,
        rule: '47 CFR §73.21'
      },
      treaty_zone: {
        status: treaty_zone ? 'ADVISORY' : 'CLEAR',
        value: treaty_zone ?? null,
        rule: 'US/MX 1986 Agreement; US/CA 1991 LOU'
      }
    },
    groundwave_contour_table,
    field_strength_profile,
    tpo_to_coverage_table,
    // Antenna system summary — efficiency estimate, power headroom, service area proxy.
    antenna_system_summary: (() => {
      // Antenna efficiency range: based on empirical M3 conductivity correlations.
      // Excellent soil (σ ≥ 8): standard 120-radial system nearly ideal, ~0 dB loss.
      // Good (σ ≥ 4): minor ground losses, ~-0.5 dB.
      // Fair (σ ≥ 2): noticeable losses without extended ground system, ~-1.5 dB.
      // Poor (σ < 2): significant losses even with deep-driven rods, ~-3.5 dB.
      const effRange = sigma_msm >= 8 ? { min_db: 0.0, max_db:  0.5, label: 'minimal loss' }
        : sigma_msm >= 4 ? { min_db: -0.5, max_db: 0.0, label: 'low loss' }
        : sigma_msm >= 2 ? { min_db: -2.0, max_db: -0.5, label: 'moderate loss — extended ground system advisable' }
        : { min_db: -4.0, max_db: -2.0, label: 'high loss — deep-driven rods + extended radials required' };
      const classMax = FCC_CLASS_POWER_KW[fcc_class]?.max ?? null;
      const service_area_km2 = daytime_reach_km != null ? round2(Math.PI * daytime_reach_km * daytime_reach_km) : null;

      // Estimated ERP (effective radiated power) from TPO after antenna efficiency loss.
      // Uses the midpoint of the efficiency range as a screening-grade ERP estimate.
      // FCC Form 302-AM reports antenna efficiency as the ratio of radiated power to
      // input power; for a λ/4 monopole on a typical ground system it's ~90% (−0.5 dB).
      const midEffDb = (effRange.min_db + effRange.max_db) / 2;
      const erp_efficiency_factor = Math.pow(10, midEffDb / 10);  // linear power ratio
      const estimated_erp_kw = round2(tpo_kw * erp_efficiency_factor);

      return {
        efficiency_range_db: effRange,
        estimated_erp_kw,
        erp_vs_tpo_ratio: round2(erp_efficiency_factor),
        tpo_headroom_to_class_max_kw: classMax != null ? round2(classMax - tpo_kw) : null,
        effective_service_area_km2: service_area_km2,
        note: `Based on M3 zone σ=${sigma_msm} mS/m (${sigmaQuality(sigma_msm)}). Actual efficiency depends on tower design and installed ground system.`
      };
    })(),
    // Coverage feasibility assessment — synthesizes coverage, power, and class limits
    // into a single engineer-facing verdict.  Tells the operator whether this site can
    // satisfy §73.24(j) 80% COL coverage at any power within class limits.
    coverage_feasibility_assessment: (() => {
      const classCeil = FCC_CLASS_POWER_KW[fcc_class]?.max ?? null;
      const colMet    = coverage_pct == null ? null : coverage_pct >= COL_COVERAGE_HARD_FLOOR;
      const blankMet  = blanket_population_pct == null ? null : blanket_population_pct <= BLANKET_POP_HARD_CEIL_PCT;

      // Can a power increase within the class ceiling fix coverage?
      const powerFixFeasible = minimum_tpo_for_col_coverage_kw != null
        && classCeil != null
        && minimum_tpo_for_col_coverage_kw <= classCeil;

      // DA reshaping potential: coverage between 50–80% is a strong DA candidate;
      // below 50% is unlikely to be rescued by DA alone.
      const daPotential = coverage_pct != null && coverage_pct >= 0.50 && coverage_pct < COL_COVERAGE_HARD_FLOOR;

      // Site is infeasible when: coverage fails AND the 5 mV/m field at the COL
      // is below 0.5 mV/m even at 50 kW, and site is not DA-rescuable.
      const infeasible = !colMet
        && field_at_col_centroid_mvm != null
        && field_at_col_centroid_mvm < 0.5
        && !daPotential
        && !powerFixFeasible;

      let verdict;
      if (coverage_pct == null) {
        verdict = 'NOT_EVALUATED';
      } else if (colMet && blankMet !== false) {
        verdict = 'MEETS_ALL_FLOORS';
      } else if (colMet && blankMet === false) {
        verdict = 'COL_OK_BLANKET_FAILS';
      } else if (powerFixFeasible && blankMet !== false) {
        verdict = 'FEASIBLE_WITH_POWER_INCREASE';
      } else if (daPotential) {
        verdict = 'POTENTIALLY_DA_RESCUABLE';
      } else if (infeasible) {
        verdict = 'INFEASIBLE_AT_CLASS_CEILING';
      } else {
        verdict = 'REQUIRES_ENGINEERING_REVIEW';
      }

      const summaryParts = [];
      if (coverage_pct != null){
        summaryParts.push(`COL coverage ${(coverage_pct * 100).toFixed(0)}% (floor 80%)`);
      }
      if (minimum_tpo_for_col_coverage_kw != null && !colMet){
        summaryParts.push(
          powerFixFeasible
            ? `${minimum_tpo_for_col_coverage_kw} kW achieves floor (class ceiling ${classCeil} kW)`
            : `${minimum_tpo_for_col_coverage_kw} kW needed but exceeds class ceiling ${classCeil} kW`
        );
      }
      if (daPotential) summaryParts.push('DA pattern shaping may close coverage gap');
      if (blankMet === false) summaryParts.push(`blanket pop ${round2(blanket_population_pct)}% exceeds §73.24(g) 1% limit`);

      return {
        verdict,
        col_coverage_pct:        coverage_pct == null ? null : round2(coverage_pct),
        col_coverage_meets_floor: colMet,
        tpo_needed_for_col_floor_kw: minimum_tpo_for_col_coverage_kw,
        tpo_needed_within_class_ceiling: minimum_tpo_for_col_coverage_kw == null ? null : powerFixFeasible,
        class_power_ceiling_kw:  classCeil,
        blanket_pop_pct:         blanket_population_pct == null ? null : round2(blanket_population_pct),
        blanket_pop_meets_limit: blankMet,
        da_pattern_may_resolve:  daPotential,
        summary: summaryParts.join('; ') || 'Insufficient data for feasibility assessment'
      };
    })(),
    // Site viability summary — single go/no-go verdict with one-line rationale.
    // The simplest possible distillation: can a licensed AM station operate at this
    // location within its FCC class limits?  Intended as the first field a PM, FCC
    // counsel, or LLM reads before diving into detail.
    site_viability_summary: (() => {
      const colOk   = coverage_pct == null ? null : coverage_pct >= COL_COVERAGE_HARD_FLOOR;
      const blankOk = blanket_population_pct == null ? null : blanket_population_pct <= BLANKET_POP_HARD_CEIL_PCT;
      const classCeil = FCC_CLASS_POWER_KW[fcc_class]?.max ?? null;
      const powerFixAvailable = minimum_tpo_for_col_coverage_kw != null
        && classCeil != null
        && minimum_tpo_for_col_coverage_kw <= classCeil;

      let go_no_go, confidence, one_line;

      if (colOk === true && blankOk !== false && !treaty_zone) {
        go_no_go = 'GO';
        confidence = 'PROMISING';
        one_line = `Meets §73.24(j) COL floor (${Math.round((coverage_pct ?? 0) * 100)}%) and §73.24(g) blanket limit at current TPO.`;
      } else if (colOk === true && blankOk !== false && treaty_zone) {
        go_no_go = 'CONDITIONAL';
        confidence = 'TREATY_REVIEW';
        one_line = `Meets coverage floors but falls in ${treaty_zone} treaty zone — FCC International Bureau coordination required before any commitment.`;
      } else if (colOk === false && powerFixAvailable && blankOk !== false) {
        go_no_go = 'CONDITIONAL';
        confidence = 'RECOVERABLE';
        one_line = `COL coverage recoverable at ${minimum_tpo_for_col_coverage_kw} kW (within Class ${fcc_class} ceiling). Blanket limit OK.`;
      } else if (colOk === false && coverage_pct != null && coverage_pct >= 0.50) {
        go_no_go = 'CONDITIONAL';
        confidence = 'DA_OPTION';
        one_line = `COL coverage ${Math.round((coverage_pct ?? 0) * 100)}% — gap is DA-rescuable (§73.150); directional pattern required before filing.`;
      } else if (colOk === true && blankOk === false) {
        go_no_go = 'CONDITIONAL';
        confidence = 'BLANKET_ISSUE';
        one_line = `COL coverage OK but §73.24(g) blanket population (${round2(blanket_population_pct)}%) exceeds 1% limit. Power reduction or DA required.`;
      } else if (colOk === false) {
        go_no_go = 'NO_GO';
        confidence = 'NON_COMPLIANT';
        one_line = `COL coverage ${coverage_pct != null ? Math.round(coverage_pct * 100) + '%' : 'unavailable'} — below §73.24(j) 80% floor with no feasible recovery within class limits at current frequency/power.`;
      } else {
        go_no_go = 'INSUFFICIENT_DATA';
        confidence = 'LOW';
        one_line = 'COL polygon not provided; §73.24(j) compliance cannot be screened. Provide community_of_license_polygon for a complete assessment.';
      }

      return { go_no_go, confidence, one_line, evaluated_at_tpo_kw: tpo_kw };
    })(),
    // Tower cost estimate — screening-grade construction cost model for a new λ/4
    // self-supporting or guyed monopole.  Based on industry rule-of-thumb ranges:
    //   AM monopole: $50–150/m of tower height for guyed stick
    //   Ground system: 120 standard radials ≈ $80–120k; poor σ adds 30-60% for
    //     extended copper system.
    //   FAA lighting (if ASR required): $20–60k fixed.
    //   Site work / civil: $50–150k depending on terrain.
    // All ranges are 2024 USD SCREENING ESTIMATES — not for budgeting.
    tower_cost_estimate: (() => {
      const lambdaM    = 300000 / frequency_khz;
      const qwM        = lambdaM / 4;
      const asrNeeded  = qwM > 60.96;

      // Tower steel — guyed monopole rule of thumb (lower for shorter towers)
      const towerLow  = Math.round(qwM * 50  / 1000) * 1000;
      const towerHigh = Math.round(qwM * 150 / 1000) * 1000;

      // Ground system copper — standard 120 radials; σ penalty for poor soil
      const gndBase = sigma_msm < 2 ? 120000 : sigma_msm < 4 ? 100000 : 80000;
      const gndPenalty = sigma_msm < 2 ? 0.60 : sigma_msm < 4 ? 0.30 : 0;
      const gndLow  = Math.round(gndBase / 1000) * 1000;
      const gndHigh = Math.round(gndBase * (1 + gndPenalty) / 1000) * 1000;

      // FAA lighting if ASR threshold exceeded
      const faaLow  = asrNeeded ? 20000 : 0;
      const faaHigh = asrNeeded ? 60000 : 0;

      // Site work / civil
      const civilLow  = 50000;
      const civilHigh = 150000;

      const totalLow  = towerLow  + gndLow  + faaLow  + civilLow;
      const totalHigh = towerHigh + gndHigh + faaHigh + civilHigh;

      // Order-of-magnitude tier
      const midCost = (totalLow + totalHigh) / 2;
      const cost_tier = midCost < 300000 ? 'LOW'
        : midCost < 600000 ? 'MODERATE'
        : midCost < 1200000 ? 'HIGH'
        : 'VERY_HIGH';

      const fmtK = (n) => `$${Math.round(n / 1000)}k`;

      return {
        tower_height_m:        round2(qwM),
        asr_lighting_required: asrNeeded,
        cost_tier,
        total_low_usd:         totalLow,
        total_high_usd:        totalHigh,
        range_label:           `${fmtK(totalLow)}–${fmtK(totalHigh)} (2024 USD, screening only)`,
        breakdown: {
          tower_steel:  { low: towerLow,  high: towerHigh,  note: `Guyed λ/4 monopole at ${Math.round(qwM)} m` },
          ground_system:{ low: gndLow,    high: gndHigh,    note: `120-radial copper; σ=${sigma_msm} mS/m soil factor` },
          faa_lighting: { low: faaLow,    high: faaHigh,    note: asrNeeded ? 'ASR threshold exceeded (47 CFR §17.7)' : 'Below ASR threshold — no lighting required' },
          civil_work:   { low: civilLow,  high: civilHigh,  note: 'Grading, access road, fence, foundation' }
        },
        disclaimer: 'SCREENING ESTIMATE ONLY. Actual costs depend on tower supplier quotes, soil borings, utility access, local labor market, and environmental permitting. Commission a civil/RF engineering feasibility study before budgeting.'
      };
    })(),
    // Seasonal conductivity note — AM groundwave propagation is sensitive to seasonal
    // soil moisture variation, particularly for low-σ sites (poor / fair quality).
    // The FCC M3 map provides annual-average values; actual σ can vary ±40% peak-to-trough.
    // High-σ (agricultural) flatland sites are more stable; desert/rocky sites most variable.
    seasonal_conductivity_note: (() => {
      // Seasonal variability proxy based on σ class
      let variability, risk_level, notes;
      if (sigma_msm >= 8) {
        variability = 'LOW';
        risk_level  = 'MINIMAL';
        notes = [
          `High-conductivity soil (σ=${sigma_msm} mS/m) is typically deep clay or agricultural flatland — seasonal moisture variation is modest (±10–20%) and unlikely to affect §73.24(j) compliance.`,
          'Annual-average FCC M3 value is a reliable proxy for filing-grade conductivity at this site.'
        ];
      } else if (sigma_msm >= 4) {
        variability = 'MODERATE';
        risk_level  = 'LOW';
        notes = [
          `Moderate-conductivity soil (σ=${sigma_msm} mS/m) may show ±20–30% seasonal variation (wet winter vs. dry summer).`,
          'Commission a multi-season resistivity survey (at least wet-season and dry-season) before finalizing ground system design.',
          'FCC Form 302-AM ground system calculations should use measured dry-season values as the conservative case.'
        ];
      } else if (sigma_msm >= 2) {
        variability = 'MODERATE_HIGH';
        risk_level  = 'ELEVATED';
        notes = [
          `Fair-conductivity soil (σ=${sigma_msm} mS/m) often shows ±30–45% seasonal swing — a wet-season σ may be acceptable but a dry-season σ near 1 mS/m could drop effective groundwave reach significantly.`,
          'Mandatory: multi-season Wenner-array soil resistivity survey before site commitment.',
          'Engineering budget for an extended radial ground system (≥180 radials or copper mesh) to compensate for summer conductivity degradation.',
          'At low-σ sites, a DA pattern angled away from low-conductivity terrain may partially compensate.'
        ];
      } else {
        variability = 'HIGH';
        risk_level  = 'HIGH';
        notes = [
          `Poor-conductivity soil (σ=${sigma_msm} mS/m) will exhibit large seasonal swings — a dry-season effective σ could fall below 1 mS/m, severely limiting groundwave reach and potentially dropping §73.24(j) COL coverage below the 80% floor.`,
          'This site carries high seasonal risk. Commission at least three-season soil resistivity surveys before site commitment.',
          'Consider requiring a contractual TPO cap reduction during certified dry seasons to maintain §73.24(g) blanket compliance.',
          'If no alternative sites are available, engineer for the worst-case (dry-season) conductivity throughout the ground system design.'
        ];
      }

      return {
        sigma_msm,
        sigma_quality: sigmaQuality(sigma_msm),
        seasonal_variability: variability,
        risk_level,
        notes,
        rule: '47 CFR §73.190; FCC M3 conductivity map (annual average)',
        disclaimer: 'Seasonal variability is a screening-grade proxy based on σ class. Site-specific multi-season Wenner-array measurements are required before filing.'
      };
    })(),
    // Antenna height options — three standard AM monopole electrical heights with
    // estimated efficiency gains (relative to 0.19λ base) and ASR implications.
    // Based on standard FCC groundwave efficiency table (FCC R-4) for λ/4 = 0 dB ref.
    // Ref: FCC OET Bulletin 69; AM antenna efficiency curves vs. electrical height.
    antenna_height_options: (() => {
      const lambdaM = 300000 / frequency_khz;
      const qwM     = lambdaM / 4;

      // Efficiency gain in dB relative to a λ/4 monopole (standard reference).
      // 5/8λ: approx +1.7 dB gain over λ/4 (empirical from AM engineering tables)
      // λ/4:  reference, 0 dB
      // 0.19λ: approx -3.0 dB (commonly used for co-located or compact towers)
      const options = [
        {
          id:              '5_8_LAMBDA',
          label:           '5/8 λ (optimum)',
          electrical_deg:  225,
          height_m:        round2(lambdaM * 0.625),
          height_ft:       Math.round(lambdaM * 0.625 * 3.28084),
          gain_vs_qw_db:   1.7,
          erp_vs_tpo_ratio: round2(tpo_kw * Math.pow(10, 1.7 / 10) / tpo_kw),
          estimated_erp_kw: round2(tpo_kw * Math.pow(10, 1.7 / 10)),
          asr_required:    (lambdaM * 0.625) > 60.96,
          pros:            '~1.7 dB ERP gain over λ/4; maximum groundwave efficiency for most soil types.',
          cons:            'Taller physical structure; always triggers §17.7 ASR + FAA study at most AM frequencies. Higher construction cost.'
        },
        {
          id:              'QUARTER_WAVE',
          label:           'λ/4 (standard)',
          electrical_deg:  90,
          height_m:        round2(qwM),
          height_ft:       Math.round(qwM * 3.28084),
          gain_vs_qw_db:   0.0,
          erp_vs_tpo_ratio: 1.0,
          estimated_erp_kw: round2(tpo_kw),
          asr_required:    qwM > 60.96,
          pros:            'Industry standard; FCC groundwave curves calibrated to λ/4 reference. Simplest engineering.',
          cons:            'Not maximum efficiency. At most AM frequencies (< 1.6 MHz), λ/4 exceeds ASR threshold (200 ft = 60.96 m).'
        },
        {
          id:              '0_19_LAMBDA',
          label:           '0.19 λ (compact)',
          electrical_deg:  68,
          height_m:        round2(lambdaM * 0.19),
          height_ft:       Math.round(lambdaM * 0.19 * 3.28084),
          gain_vs_qw_db:   -3.0,
          erp_vs_tpo_ratio: round2(Math.pow(10, -3.0 / 10)),
          estimated_erp_kw: round2(tpo_kw * Math.pow(10, -3.0 / 10)),
          asr_required:    (lambdaM * 0.19) > 60.96,
          pros:            'May avoid ASR/FAA at some frequencies (check exact height_m). Lower steel cost. Useful for DA-in, series-capacitor base tuning.',
          cons:            '~3 dB ERP penalty vs. λ/4; requires larger ground system to partially compensate. Coverage loss may push below §73.24(j) floor.'
        }
      ];

      return {
        frequency_khz,
        full_wavelength_m: round2(lambdaM),
        reference_tpo_kw:  tpo_kw,
        options,
        note: 'Efficiency figures are engineering approximations from FCC R-4 table for σ-independent electrical height comparison. Actual efficiency depends on soil conductivity, ground system design, and base impedance matching.'
      };
    })(),
    // Power upgrade analysis — models coverage at the FCC class maximum power.
    // Many operators run significantly below their ceiling; upgrading TPO is often
    // the fastest (though most expensive) path to COL coverage compliance.
    // Also checks whether max power would cause §73.24(g) blanket population violations.
    power_upgrade_analysis: (() => {
      const classCeil = FCC_CLASS_POWER_KW[fcc_class]?.max ?? null;
      if (classCeil == null || classCeil <= tpo_kw + 0.01) {
        return {
          applicable: false,
          reason: tpo_kw >= (classCeil ?? 50) ? `Already at Class ${fcc_class} ceiling (${tpo_kw} kW).` : 'Class ceiling unavailable.',
          max_class_power_kw: classCeil
        };
      }
      const headroom_kw = round2(classCeil - tpo_kw);
      const headroom_pct = round2(((classCeil - tpo_kw) / tpo_kw) * 100);

      // Estimate COL coverage at max class power using the same binary-search approach.
      let col_coverage_at_max_pct = null;
      let reach_at_max_km = null;
      try {
        const rMax = fccAmDistanceKm({ frequency_khz, target_mvm: 5.0, conductivity_msm: sigma_msm, erp_kw: classCeil });
        reach_at_max_km = round2(rMax.distance_km);
        // Use colDist proxy for COL coverage estimate
        if (colDist != null && reach_at_max_km != null) {
          col_coverage_at_max_pct = colDist <= reach_at_max_km ? 1.0 : round2(reach_at_max_km / colDist);
        }
      } catch (_) { /* leave null */ }

      // Blanket pop at max power — estimate 1000 mV/m contour radius at class ceiling.
      let blanket_concern_at_max = null;
      try {
        const rBlanket = fccAmDistanceKm({ frequency_khz, target_mvm: 1000, conductivity_msm: sigma_msm, erp_kw: classCeil });
        const blanketArea = Math.PI * rBlanket.distance_km * rBlanket.distance_km;
        const blanketPop = blanketArea * regional_density_per_km2;
        const blanketPct = round2((blanketPop / (US_POPULATION_M * 1_000_000)) * 100);
        blanket_concern_at_max = {
          blanket_1000mvm_km: round2(rBlanket.distance_km),
          estimated_blanket_pop_pct: blanketPct,
          would_exceed_limit: blanketPct > BLANKET_POP_HARD_CEIL_PCT
        };
      } catch (_) { /* leave null */ }

      const col_would_comply = col_coverage_at_max_pct != null && col_coverage_at_max_pct >= COL_COVERAGE_HARD_FLOOR;
      const blanket_ok = blanket_concern_at_max?.would_exceed_limit === false;

      let verdict;
      if (col_would_comply && blanket_ok) {
        verdict = 'UPGRADE_RESOLVES_COL';
      } else if (col_would_comply && blanket_concern_at_max?.would_exceed_limit) {
        verdict = 'UPGRADE_CAUSES_BLANKET_VIOLATION';
      } else if (!col_would_comply) {
        verdict = 'UPGRADE_INSUFFICIENT_FOR_COL';
      } else {
        verdict = 'REVIEW_REQUIRED';
      }

      return {
        applicable: true,
        current_tpo_kw: tpo_kw,
        max_class_power_kw: classCeil,
        headroom_kw,
        headroom_pct,
        col_coverage_estimate_at_max_pct: col_coverage_at_max_pct == null ? null : round2(col_coverage_at_max_pct * 100),
        reach_at_max_class_power_km: reach_at_max_km,
        col_would_comply_at_max: col_would_comply,
        blanket_concern_at_max,
        verdict,
        note: `Class ${fcc_class} ceiling is ${classCeil} kW (+${headroom_kw} kW / +${headroom_pct}% over current TPO).`
      };
    })(),
    // Transmission line analysis — feedline type selection and loss budget.
    // AM broadcast transmission lines run from the transmitter output to the
    // antenna base matching network.  At AM frequencies (530–1700 kHz) coaxial
    // cable has higher attenuation per unit length than open-wire parallel lines,
    // but coax is preferred for modern installations due to interference immunity,
    // weathering, and NEC/fire code compliance.  ERP loss = 10^(loss_dB/10).
    // This is a SCREENING-GRADE estimate; actual feedline must be engineered to
    // match the antenna base impedance (typically 25–75 Ω for λ/4 monopole).
    transmission_line_analysis: (() => {
      const freq_mhz  = frequency_khz / 1000;
      const freq_sqrt = Math.sqrt(freq_mhz);  // used in coax attenuation formula

      // Conservative feedline run assumption: transmitter building at 60 m from
      // tower base (adequate for a minimal building setback + safe distance).
      // Actual run depends on site layout; operator may need to add length.
      const assumed_run_m = 60;

      // Coaxial attenuation approximation (dB / 100 m) using classical skin-effect model:
      //   A_total ≈ A_cond × sqrt(f_MHz) + A_diel × f_MHz
      // Reference values for EIA standard hardline at 1 MHz (manufacturer data sheets):
      //   7/8" EIA 50-Ω: A_cond ≈ 0.18, A_diel ≈ 0.004
      //   1-5/8" EIA 50-Ω: A_cond ≈ 0.10, A_diel ≈ 0.002
      //   3-1/8" EIA 50-Ω: A_cond ≈ 0.063, A_diel ≈ 0.001
      // Open-wire 600-Ω: extremely low loss — typical 0.01–0.03 dB/100m at AM freqs.
      const feedlines = [
        { id: 'EIA_7_8_IN',   label: '7/8" EIA 50-Ω hardline',   a_cond: 0.18,  a_diel: 0.004,  max_power_kw: 30,  note: 'Common AM broadcast choice; good balance of loss and handling.' },
        { id: 'EIA_1_5_8_IN', label: '1-5/8" EIA 50-Ω hardline', a_cond: 0.10,  a_diel: 0.002,  max_power_kw: 80,  note: 'Lower loss; preferred for higher-power AM (>25 kW).' },
        { id: 'EIA_3_1_8_IN', label: '3-1/8" EIA 50-Ω hardline', a_cond: 0.063, a_diel: 0.001,  max_power_kw: 250, note: 'Lowest coax loss; used for Class A 50 kW installations.' },
        { id: 'OPEN_WIRE',    label: 'Open-wire parallel (600 Ω)', a_cond: 0.012, a_diel: 0.0005, max_power_kw: 999, note: 'Lowest loss option. Requires impedance matching transformer at both ends. Cannot be used indoors.' }
      ];

      const results = feedlines.map(fl => {
        const atten_db_per_100m = round2(fl.a_cond * freq_sqrt + fl.a_diel * freq_mhz);
        const total_loss_db     = round2(atten_db_per_100m * (assumed_run_m / 100));
        const loss_factor       = Math.pow(10, -total_loss_db / 10);
        const erp_at_antenna_kw = round2(tpo_kw * loss_factor);
        const power_reduction_pct = round2((1 - loss_factor) * 100);
        const suitable_for_tpo  = tpo_kw <= fl.max_power_kw;
        return {
          id:                   fl.id,
          label:                fl.label,
          attenuation_db_per_100m: atten_db_per_100m,
          total_loss_db_at_60m: total_loss_db,
          erp_at_antenna_kw,
          power_reduction_pct,
          max_power_rating_kw:  fl.max_power_kw,
          suitable_for_tpo,
          note:                 fl.note
        };
      });

      // Recommended feedline based on TPO.
      let recommended_id;
      if (tpo_kw > 50) {
        recommended_id = 'EIA_3_1_8_IN';
      } else if (tpo_kw > 25) {
        recommended_id = 'EIA_1_5_8_IN';
      } else {
        recommended_id = 'EIA_7_8_IN';
      }
      const bestCoax = results.find(r => r.id === recommended_id);

      return {
        assumed_feedline_run_m: assumed_run_m,
        frequency_khz,
        reference_tpo_kw:   tpo_kw,
        feedline_options:   results,
        recommended_feedline_id: recommended_id,
        recommended_summary: bestCoax
          ? `Recommended: ${bestCoax.label} — ${bestCoax.attenuation_db_per_100m} dB/100m at ${frequency_khz} kHz → ${bestCoax.total_loss_db_at_60m} dB loss over ${assumed_run_m} m → ${bestCoax.erp_at_antenna_kw} kW ERP at antenna base (−${bestCoax.power_reduction_pct}% from TPO).`
          : null,
        note: `Attenuation modeled with skin-effect formula (A_cond×√f + A_diel×f). Actual loss depends on connectors, VSWR, temperature, and installation quality. Feedline run assumed ${assumed_run_m} m (transmitter building at tower base).`,
        rule: 'FCC Form 302-AM Part III / Broadcast Engineering (Whitaker 2013) §11.5'
      };
    })(),
    // Antenna base impedance estimate — radiation resistance and approximate ground
    // loss resistance for the λ/4 monopole at this frequency and conductivity.
    // Inputs to the impedance matching network design (L-network, T-network, or
    // antenna tuning unit).  The closer R_total → R_r (radiation resistance), the
    // more efficient the antenna system.
    //
    // MODEL:
    //   R_r (radiation resistance) = 36.6 Ω × correction for electrical height
    //     (λ/4 reference: R_r ≈ 36.6 Ω for a lossless monopole over perfect ground)
    //   R_g (ground loss) = empirical approximation from Terman (1943) and
    //     FCC AM Antenna Design Manual:
    //       R_g ≈ 120 / (σ_mSm × N_radials × L_radial_m) × k_f(frequency)
    //     where k_f accounts for skin-depth frequency scaling.
    //   We use 120 radials at λ/4 as the reference ground system.
    //   R_total = R_r + R_g
    //   Efficiency = R_r / R_total
    antenna_base_impedance: (() => {
      const lambdaM = 300000 / frequency_khz;
      const qwM     = lambdaM / 4;
      const feM     = lambdaM * 5 / 8;

      // Radiation resistance for vertical monopole (per NEC / FCC engineering model).
      // At λ/4 (90°): R_r = 36.6 Ω (lossless monopole over perfect infinite ground).
      // At 5/8λ (225°): R_r ≈ 50 Ω (close to standard 50-Ω line — useful for direct match).
      // At 0.19λ (68°): R_r ≈ 9-12 Ω (low; requires step-up matching network).
      const rrQw = 36.6;  // Ω, λ/4
      const rrFe = 49.8;  // Ω, 5/8λ (from NEC antenna impedance database)
      const rrC  = 10.5;  // Ω, 0.19λ compact (approximate)

      // Ground loss resistance estimate.
      // Empirical formula from Terman (Electronics and Radio Engineering, 1955):
      //   R_g ≈ (120 × ρ_ohm_m) / (N × L)
      // where ρ = soil resistivity (Ω·m) = 1/(σ × 0.001) = 1000/σ_mSm
      // Using 120 radials at λ/4 length as reference ground system.
      // Skin-depth correction: actual R_g scales roughly as sqrt(f) for surface-wave,
      // but the dominant term is the soil resistivity.
      const rho_ohm_m   = 1000 / sigma_msm;         // soil resistivity (Ω·m) from σ
      const N_radials   = 120;
      const L_radial_m  = qwM;
      const rg_formula  = round2(Math.min(30, (120 * rho_ohm_m) / (N_radials * L_radial_m)));

      // Extended ground system (180 radials at 1.5×λ/4) reduces R_g further.
      const rg_extended = round2(Math.min(30, (120 * rho_ohm_m) / (180 * qwM * 1.5)));

      const r_total_qw      = round2(rrQw + rg_formula);
      const r_total_qw_ext  = round2(rrQw + rg_extended);
      const efficiency_qw   = round2(rrQw / r_total_qw * 100);
      const efficiency_ext  = round2(rrQw / r_total_qw_ext * 100);

      // Reactance at base of λ/4 monopole is approximately 0 Ω (pure resistance at resonance).
      // For off-resonance heights, base reactance is non-zero; must be tuned out.
      // At 5/8λ: X_base ≈ +45j Ω (inductive — requires series capacitor to tune).
      // At 0.19λ: X_base ≈ −100 to −200j Ω (capacitive — requires series inductor).
      const reactances = [
        { height_id: 'QUARTER_WAVE',   X_ohm: 0,    tuning: 'Self-resonant — no base reactance; minimal ATU needed' },
        { height_id: 'FIVE_EIGHTHS',   X_ohm: +45,  tuning: 'Series capacitor at base to cancel +45j Ω inductive reactance' },
        { height_id: 'COMPACT_019',    X_ohm: -150, tuning: 'Series inductor + capacitor L-network to cancel ~−150j Ω capacitive reactance' }
      ];

      // Matching assessment: can the feedline (50 Ω or 75 Ω) be matched to the base impedance?
      const mismatch_qw = round2(Math.sqrt(r_total_qw / 50));  // VSWR at 50-Ω line
      const mismatch_note = mismatch_qw < 1.5 ? 'Excellent match — simple ATU or direct connection possible.'
        : mismatch_qw < 2.5 ? 'Moderate mismatch — L-network or T-network ATU required.'
        : 'High mismatch — transformer-based ATU required; consult antenna specialist.';

      return {
        frequency_khz,
        sigma_msm,
        reference_radial_system: { count: N_radials, length_m: round2(L_radial_m) },
        quarter_wave: {
          height_m: round2(qwM),
          radiation_resistance_ohm: rrQw,
          ground_loss_standard_ohm: rg_formula,
          ground_loss_extended_ohm: rg_extended,
          total_base_resistance_ohm: r_total_qw,
          efficiency_standard_pct: efficiency_qw,
          efficiency_extended_pct: efficiency_ext,
          base_reactance_ohm: 0,
          vswr_vs_50ohm: round2(mismatch_qw > 1 ? mismatch_qw : 1 / mismatch_qw)
        },
        five_eighths_wave: {
          height_m: round2(feM),
          radiation_resistance_ohm: rrFe,
          base_reactance_ohm: +45,
          tuning_required: 'Series capacitor to cancel +45j Ω',
          note: '5/8λ close to 50-Ω coax impedance — excellent feedline match after tuning'
        },
        base_reactance_table: reactances,
        matching_network_complexity: mismatch_note,
        design_note: `Ground loss R_g estimated from Terman formula: ρ=${Math.round(rho_ohm_m)} Ω·m (σ=${sigma_msm} mS/m), ${N_radials} radials at ${round2(L_radial_m)} m. ${efficiency_qw < 80 ? 'POOR efficiency — extended ground system strongly recommended.' : efficiency_qw < 90 ? 'FAIR efficiency — soil resistivity survey and ground system optimization recommended.' : 'GOOD efficiency — standard 120-radial system adequate.'}`,
        rule: 'IEEE Std 802.11 AM antenna impedance / FCC Form 302-AM Part III'
      };
    })(),
    // Permit and engineering cost estimate — soft-cost budget for FCC filing,
    // engineering studies, and legal review.  Does NOT include construction/hardware
    // costs (see tower_cost_estimate for those).  All figures are 2024 USD screening
    // estimates; actual costs depend on consultant selection and filing complexity.
    permit_and_engineering_cost_estimate: (() => {
      const lambdaM_pe = 300000 / frequency_khz;
      const qwM_pe     = lambdaM_pe / 4;
      const asrRequired = qwM_pe > 60.96;
      const daRecommended = coverage_pct != null && coverage_pct < COL_COVERAGE_HARD_FLOOR
        || blanket_population_pct != null && blanket_population_pct >= 0.8
        || !!treaty_zone
        || (CLEAR_CHANNEL_KHZ.has(frequency_khz) && fcc_class !== 'A');
      const isClearCh = CLEAR_CHANNEL_KHZ.has(frequency_khz);

      const line_items = [];

      // 1. FCC Form 301-AM (construction permit application)
      const fcc_301_fee = fcc_class === 'A' ? 660 : fcc_class === 'C' ? 330 : 490;
      line_items.push({
        id: 'FCC_FORM_301',
        label: 'FCC Form 301-AM construction permit',
        low_usd: fcc_301_fee, high_usd: fcc_301_fee,
        note: `FCC Schedule of Regulatory Fees (2024). Class ${fcc_class} AM station.`
      });

      // 2. FCC Form 302-AM (license to cover)
      line_items.push({
        id: 'FCC_FORM_302',
        label: 'FCC Form 302-AM license to cover',
        low_usd: 330, high_usd: 330,
        note: 'Filed after construction completion; flat fee regardless of class.'
      });

      // 3. ASR registration (Form 854)
      if (asrRequired){
        line_items.push({
          id: 'FCC_FORM_854_ASR',
          label: 'FCC Form 854 ASR registration',
          low_usd: 175, high_usd: 175,
          note: `λ/4 ≈ ${Math.round(qwM_pe)} m > §17.7 60.96 m — tower registration required.`
        });
      }

      // 4. FAA aeronautical study (7460-1) — consultant cost (no gov fee)
      if (asrRequired){
        line_items.push({
          id: 'FAA_AERO_STUDY',
          label: 'FAA 7460-1 aeronautical study (consultant)',
          low_usd: 2000, high_usd: 6000,
          note: 'No government fee; consultant prepares filing. Time-critical: start before site lease.'
        });
      }

      // 5. Soil resistivity survey (always required for §73.190 certification)
      line_items.push({
        id: 'SOIL_RESISTIVITY_SURVEY',
        label: 'Soil resistivity survey (Wenner array)',
        low_usd: sigma_msm < 2 ? 3000 : 2000,
        high_usd: sigma_msm < 2 ? 10000 : 6000,
        note: sigma_msm < 2
          ? `POOR σ=${sigma_msm} mS/m — extended investigation and multiple measurement points required.`
          : `Required for FCC Form 302-AM §73.190 certification regardless of conductivity quality.`
      });

      // 6. NIF study (§73.182)
      const isLocalCh = LOCAL_CHANNEL_KHZ.has(frequency_khz);
      if (!isLocalCh && fcc_class !== 'C'){
        const nif_low  = isClearCh ? 25000 : 10000;
        const nif_high = isClearCh ? 60000 : 25000;
        line_items.push({
          id: 'NIF_STUDY',
          label: `§73.182 NIF study (${isClearCh ? 'clear channel — azimuthal' : 'regional'})`,
          low_usd: nif_low, high_usd: nif_high,
          note: isClearCh
            ? 'Clear-channel azimuthal NIF study with 1° resolution — specialist required; expect higher-end cost.'
            : 'Regional channel NIF study; cost scales with number of co-channel stations in region.'
        });
      }

      // 7. DA engineering study (if recommended)
      if (daRecommended){
        const isFull = treaty_zone || (CLEAR_CHANNEL_KHZ.has(frequency_khz) && fcc_class !== 'A'
          && (coverage_pct == null || coverage_pct < COL_COVERAGE_HARD_FLOOR));
        const da_low  = isFull ? 30000 : 15000;
        const da_high = isFull ? 80000 : 35000;
        line_items.push({
          id: 'DA_ENGINEERING',
          label: `§73.150 DA ${isFull ? 'day+night' : 'daytime'} pattern study`,
          low_usd: da_low, high_usd: da_high,
          note: `Includes antenna array design, NEC modeling, pattern iteration, and §73.316 radial table. ${isFull ? 'Full day+night DA significantly increases engineering hours.' : ''}`
        });
      }

      // 8. RF exposure (MPE) study — required for all AM stations
      line_items.push({
        id: 'RF_EXPOSURE_STUDY',
        label: 'RF exposure / MPE study (OET-65 / §1.1307)',
        low_usd: 500, high_usd: 2500,
        note: 'Near-field boundary calculation and field strength survey of the fenced exclusion zone.'
      });

      // 9. Treaty coordination (FCC IB)
      if (treaty_zone){
        line_items.push({
          id: 'TREATY_COORDINATION',
          label: `FCC IB treaty coordination (${treaty_zone})`,
          low_usd: 5000, high_usd: 25000,
          note: 'FCC IB filing preparation + binational review cost (engineering and legal). Timeline: 12–52 weeks.'
        });
      }

      // 10. FCC broadcast counsel (legal review + filing preparation)
      const counsel_low = 8000;
      const counsel_high = treaty_zone ? 40000 : daRecommended ? 22000 : 15000;
      line_items.push({
        id: 'FCC_COUNSEL',
        label: 'FCC broadcast counsel (legal + filing)',
        low_usd: counsel_low, high_usd: counsel_high,
        note: 'Covers application preparation, FCC staff communications, STA if needed, and license grant tracking.'
      });

      const total_low  = Math.round(line_items.reduce((s, l) => s + l.low_usd, 0));
      const total_high = Math.round(line_items.reduce((s, l) => s + l.high_usd, 0));
      const cost_tier  = total_high > 150000 ? 'VERY_HIGH'
        : total_high > 75000 ? 'HIGH'
        : total_high > 35000 ? 'MODERATE'
        : 'LOW';

      return {
        total_soft_cost_low_usd:  total_low,
        total_soft_cost_high_usd: total_high,
        cost_tier,
        range_label: `$${(total_low / 1000).toFixed(0)}k–$${(total_high / 1000).toFixed(0)}k (2024 USD, screening)`,
        line_items,
        note: 'Soft-cost budget only (filing fees, engineering studies, legal). Does NOT include tower, ground system, transmitter, or site work. See tower_cost_estimate for construction costs.',
        rule: 'FCC Schedule of Regulatory Fees (2024) + industry engineering cost data'
      };
    })(),
    // Per-candidate engineering checklist — what studies must be done if this site
    // is selected for detailed engineering evaluation.  Derived from the candidate's
    // physical characteristics; complements the station-level form_301_checklist.
    per_candidate_engineering_checklist: (() => {
      const items = [];
      const asrThresh = 60.96; // 200 ft in metres — 47 CFR §17.7
      const lambdaM   = 300000 / frequency_khz;
      const qwM       = lambdaM / 4;
      // 1. Soil resistivity — always required if conductivity is screening-grade or poor.
      if (ground_sigma_filing_grade !== 'filing'){
        items.push({
          id: 'SOIL_RESISTIVITY_SURVEY',
          priority: 'REQUIRED',
          label: 'Soil resistivity survey',
          note: `Zone-table σ=${sigma_msm} mS/m used for screening. §73.190 and FCC Form 302-AM require measured ρ (Ω·m) for the ground system design. Commission a 4-electrode Wenner array survey at this candidate location.`
        });
      }
      // 2. ASR — every AM quarter-wave antenna triggers §17.7 at most frequencies.
      if (qwM > asrThresh){
        items.push({
          id: 'ASR_REGISTRATION',
          priority: 'REQUIRED',
          label: 'ASR registration (47 CFR §17.7)',
          note: `λ/4 ≈ ${Math.round(qwM)} m at ${frequency_khz} kHz exceeds the §17.7 200-ft (60.96 m) threshold. File FCC Form 854 before construction; may require FAA aeronautical study and lighting compliance.`
        });
      }
      // 3. RF exposure — mandatory for all licensed AM stations.
      items.push({
        id: 'MPE_STUDY',
        priority: 'REQUIRED',
        label: 'RF exposure (MPE) evaluation (OET-65 / §1.1307)',
        note: `AM stations must file an RF exposure evaluation (OET Bulletin 65, §3.B near-field study). Near-field boundary λ/(2π) ≈ ${Math.round(lambdaM / (2 * Math.PI))} m at ${frequency_khz} kHz.`
      });
      // 4. Treaty zone.
      if (treaty_zone){
        items.push({
          id: 'INTERNATIONAL_BORDER_COORDINATION',
          priority: 'REQUIRED',
          label: 'International border coordination',
          note: `Site is within treaty zone: ${treaty_zone}. FCC International Bureau coordination required before filing; may impose power, pattern, or frequency restrictions.`
        });
      }
      // 5. COL coverage fails.
      if (coverage_pct != null && coverage_pct < COL_COVERAGE_HARD_FLOOR){
        items.push({
          id: 'COL_COVERAGE_REMEDY',
          priority: 'REQUIRED',
          label: 'COL coverage remedy engineering',
          note: `${(coverage_pct * 100).toFixed(0)}% COL coverage < §73.24(j) 80% floor. Engineering options: (a) power increase to ${minimum_tpo_for_col_coverage_kw != null ? `${minimum_tpo_for_col_coverage_kw} kW` : '>50 kW'}, (b) DA pattern design (§73.150), or (c) COL boundary amendment. Commission a full §73.24(j) coverage study.`
        });
      }
      // 6. Blanket pop fails.
      if (blanket_population_pct != null && blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT){
        items.push({
          id: 'BLANKET_POP_STUDY',
          priority: 'REQUIRED',
          label: 'Blanket population study (§73.24(g))',
          note: `Estimated blanket pop ${round2(blanket_population_pct)}% > 1% limit. Requires actual Census-block sum inside the 1000 mV/m contour. Consider power reduction or DA-N pattern to reduce the 1000 mV/m footprint.`
        });
      }
      // 7. Poor soil — extended ground system advisory.
      if (sigma_msm < 2){
        items.push({
          id: 'EXTENDED_GROUND_SYSTEM',
          priority: 'HIGH',
          label: 'Extended ground system design (§73.190)',
          note: `σ=${sigma_msm} mS/m (POOR). Standard 120-radial system will have significant losses. Commission deep-driven rod grid and extended buried radial design before finalizing tower height.`
        });
      }
      // 8. DA pattern — if the station already operates DA.
      if (/DA/i.test(pattern_mode)){
        items.push({
          id: 'DA_PATTERN_DESIGN',
          priority: 'REQUIRED',
          label: `DA-${pattern_mode.slice(-1) || 'D'} antenna pattern design (§73.150)`,
          note: `pattern_mode=${pattern_mode}: full directional antenna (§73.150) horizontal radiation pattern must be designed, measured, and filed on Form 301-AM. Anticipate 3–6 months of antenna range time.`
        });
      }
      return items;
    })(),
    // Compliance pathway — ordered engineering steps to bring this candidate to
    // FCC filing readiness.  Keyed to the site's physical characteristics and the
    // coverage_feasibility verdict; gives engineers a linear task sequence.
    compliance_pathway: (() => {
      const steps = [];

      // Step 1 — always first: site investigation
      steps.push({
        step: 1,
        phase: 'SITE_INVESTIGATION',
        action: 'Conduct site survey: parcel availability, lease terms, zoning, setbacks, environmental triggers',
        timeline_weeks: '2–4',
        blocking: true
      });

      // Step 2 — soil survey (always needed for filing; critical if poor σ)
      steps.push({
        step: 2,
        phase: 'SOIL_SURVEY',
        action: sigma_msm < 2
          ? `Urgent soil resistivity survey: POOR σ=${sigma_msm} mS/m — ground system design critically depends on measured ρ (Ω·m)`
          : `Commission soil resistivity survey (4-electrode Wenner array) — required for §73.190 ground system certification and FCC Form 302-AM`,
        timeline_weeks: sigma_msm < 2 ? '2–3' : '4–8',
        blocking: sigma_msm < 2
      });

      // Step 3 — ASR/FAA coordination (if height triggers §17.7)
      const lambdaM_cp = 300000 / frequency_khz;
      const qwM_cp = lambdaM_cp / 4;
      if (qwM_cp > 60.96){
        steps.push({
          step: 3,
          phase: 'ASR_FAA_COORDINATION',
          action: `File FAA Form 7460-1 aeronautical study and FCC Form 854 ASR registration — λ/4 = ${Math.round(qwM_cp)} m at ${frequency_khz} kHz exceeds 60.96 m §17.7 threshold`,
          timeline_weeks: '8–16',
          blocking: true
        });
      }

      // Step 4 — treaty coordination (if in treaty zone)
      if (treaty_zone){
        steps.push({
          step: steps.length + 1,
          phase: 'TREATY_COORDINATION',
          action: `Initiate FCC International Bureau coordination for ${treaty_zone} — required before any Form 301-AM can be processed`,
          timeline_weeks: '12–52',
          blocking: true
        });
      }

      // Step 5 — coverage remedy (if COL coverage fails)
      const colFails = coverage_pct != null && coverage_pct < COL_COVERAGE_HARD_FLOOR;
      if (colFails){
        if (minimum_tpo_for_col_coverage_kw != null){
          steps.push({
            step: steps.length + 1,
            phase: 'POWER_ENGINEERING',
            action: `Increase TPO to ≥${minimum_tpo_for_col_coverage_kw} kW to satisfy §73.24(j) 5 mV/m COL floor (current coverage ${coverage_pct != null ? (coverage_pct * 100).toFixed(0) : '?'}%)`,
            timeline_weeks: '1–2',
            blocking: false
          });
        } else if (/DA/i.test(pattern_mode) || (coverage_pct != null && coverage_pct >= 0.50)){
          steps.push({
            step: steps.length + 1,
            phase: 'DA_PATTERN_ENGINEERING',
            action: `Commission §73.150 DA pattern design to reshape 5 mV/m contour toward community of license — coverage currently ${coverage_pct != null ? (coverage_pct * 100).toFixed(0) : '?'}%`,
            timeline_weeks: '12–24',
            blocking: true
          });
        } else {
          steps.push({
            step: steps.length + 1,
            phase: 'COL_BOUNDARY_REVIEW',
            action: `COL coverage ${coverage_pct != null ? (coverage_pct * 100).toFixed(0) : '?'}% is below 80% floor and cannot be resolved by power alone at this location — consult FCC counsel on COL boundary amendment`,
            timeline_weeks: '24–52',
            blocking: true
          });
        }
      }

      // Step 6 — NIF study (always for non-local channels)
      const lambdaM_cp2 = 300000 / frequency_khz;
      const isLocalFreq = [1230, 1240, 1340, 1400, 1450, 1490].includes(frequency_khz);
      if (!isLocalFreq){
        steps.push({
          step: steps.length + 1,
          phase: 'NIF_STUDY',
          action: `Commission §73.182 nighttime interference (NIF) study — required for all non-local-channel AM stations at a new transmitter site`,
          timeline_weeks: '4–12',
          blocking: true
        });
      }

      // Step 7 — Form 301-AM filing
      steps.push({
        step: steps.length + 1,
        phase: 'FCC_FILING',
        action: 'File FCC Form 301-AM construction permit with all exhibits (antenna efficiency, coverage contour, NIF study, environmental checklist, ASR if required)',
        timeline_weeks: '4–8 + FCC processing',
        blocking: true
      });

      const maxWeeks = steps.reduce((acc, s) => {
        const wks = s.timeline_weeks.split('–');
        return acc + (parseInt(wks[wks.length - 1], 10) || 0);
      }, 0);
      const minWeeks = steps.reduce((acc, s) => {
        const wks = s.timeline_weeks.split('–');
        return acc + (parseInt(wks[0], 10) || 0);
      }, 0);
      const blockingCount = steps.filter(s => s.blocking).length;
      const timelineLabel = maxWeeks > 52
        ? `${Math.round(minWeeks / 4)}–${Math.round(maxWeeks / 4)} months`
        : `${minWeeks}–${maxWeeks} weeks`;
      return {
        total_steps: steps.length,
        blocking_steps: blockingCount,
        estimated_weeks_min: minWeeks,
        estimated_weeks_to_filing: maxWeeks,
        timeline_label: timelineLabel,
        steps
      };
    })(),
    // Sigma sensitivity analysis — quantifies the benefit of a filed-grade soil
    // resistivity survey by projecting what the reach and score WOULD be if actual σ
    // were one quality tier better.  Only meaningful when zone-table σ is in use.
    // Returns null when σ is already filing-grade (raster loaded).
    sigma_sensitivity_analysis: ground_sigma_filing_grade === 'filing' ? null : (() => {
      // Next-tier σ values — what a 4-electrode Wenner array survey might reveal.
      const nextTierSigma = sigma_msm < 2  ? 3.0   // POOR → FAIR (realistic improvement in non-desert soils)
        : sigma_msm < 4  ? 6.0             // FAIR → GOOD
        : sigma_msm < 8  ? 10.0            // GOOD → EXCELLENT
        : null;                            // EXCELLENT already — no upgrade possible

      if (nextTierSigma == null){
        return { upgrade_possible: false, note: `σ already in EXCELLENT range (${sigma_msm} mS/m) — filing-grade survey still required for §73.190 design but score impact would be minimal.` };
      }

      let upgrade_reach_km = null;
      let upgrade_col_5mvm_km = null;
      try {
        const r = fccAmDistanceKm({ frequency_khz, target_mvm: DAYTIME_REACH_TARGET_MVM, conductivity_msm: nextTierSigma, erp_kw: tpo_kw });
        upgrade_reach_km = round2(r.distance_km);
      } catch (_){ /* leave null */ }
      try {
        const r5 = fccAmDistanceKm({ frequency_khz, target_mvm: 5.0, conductivity_msm: nextTierSigma, erp_kw: tpo_kw });
        upgrade_col_5mvm_km = round2(r5.distance_km);
      } catch (_){ /* leave null */ }

      const reach_delta_km = daytime_reach_km != null && upgrade_reach_km != null
        ? round2(upgrade_reach_km - daytime_reach_km) : null;
      const col_5mvm_delta_km = principal_community_5mvm_km != null && upgrade_col_5mvm_km != null
        ? round2(upgrade_col_5mvm_km - principal_community_5mvm_km) : null;

      // Rough score impact: conductivity sub-score at upgrade vs current σ.
      const subCurrent = Math.max(0, Math.min(100, Math.sqrt(sigma_msm / SIGMA_PREFERRED_MIN_MSM) * 100));
      const subUpgrade = Math.max(0, Math.min(100, Math.sqrt(nextTierSigma / SIGMA_PREFERRED_MIN_MSM) * 100));
      const conductivity_score_delta = goals.prefer_high_conductivity
        ? round2((subUpgrade - subCurrent) / 100 * (weightPool.prefer_high_conductivity || 0) * (100 / Math.max(Object.values(weightPool).reduce((a, b) => a + b, 0), 1)))
        : null;

      return {
        upgrade_possible: true,
        current_sigma_msm: sigma_msm,
        current_sigma_quality: sigmaQuality(sigma_msm),
        projected_sigma_msm: nextTierSigma,
        projected_sigma_quality: sigmaQuality(nextTierSigma),
        projected_daytime_reach_km: upgrade_reach_km,
        daytime_reach_delta_km: reach_delta_km,
        projected_col_5mvm_km: upgrade_col_5mvm_km,
        col_5mvm_delta_km,
        conductivity_score_delta,
        survey_recommendation: reach_delta_km != null && reach_delta_km > 5
          ? 'HIGH VALUE — reach improvement > 5 km projected; survey strongly recommended before site commitment.'
          : reach_delta_km != null && reach_delta_km > 2
          ? 'MODERATE VALUE — some reach improvement projected; survey recommended if site is a finalist.'
          : 'LIMITED VALUE — conductivity upgrade would have minor coverage impact; survey still required for §73.190 ground system design.'
      };
    })(),
    // Antenna height profile — standard vertical heights for this frequency and their
    // regulatory implications.  All heights in meters.
    // §17.7: any structure > 60.96 m (200 ft) AGL requires ASR registration.
    // The FCC M3 groundwave model assumes optimal λ/4 (90°) electrical height;
    // reduced antenna heights lower radiation efficiency approximately as sin²(h/λ·360°).
    antenna_height_profile: (() => {
      const ASR_M = 60.96;           // 200 ft — §17.7 ASR trigger
      const lambdaM = 300000 / frequency_khz;
      const qw  = round2(lambdaM / 4);       // 90° — standard, optimal radiation resistance
      const hw  = round2(lambdaM / 2);       // 180° — null pattern above; rarely used
      const fe  = round2(lambdaM * 5 / 8);  // 225° — maximum gain, used on some Class A clear-channel

      // Relative radiation efficiency vs. quarter-wave baseline.
      // M3 groundwave tables assume 90° (λ/4) electrical height.
      // Shorter antennas have less radiation resistance, reducing ERP.
      // Approximate effective gain vs. 90° using sin²(electrical_deg * π/180).
      const relEfficiency = (deg) => {
        const sinVal = Math.sin(deg * Math.PI / 180);
        return round2(sinVal * sinVal / 1.0); // normalized to 1.0 at 90°
      };

      // What's the maximum physical height allowed without ASR complications?
      // ASR_M = 60.96 m; compute the electrical height in degrees at that limit.
      const asr_limited_deg = round2((ASR_M / lambdaM) * 360);
      const asr_limited_eff = relEfficiency(Math.min(asr_limited_deg, 90));

      return {
        frequency_khz,
        wavelength_m: round2(lambdaM),
        asr_threshold_m: ASR_M,
        quarter_wave_m: qw,
        five_eighths_wave_m: fe,
        half_wave_m: hw,
        quarter_wave_asr_required: qw > ASR_M,
        // Electrical height (degrees) if ASR precludes a full λ/4 tower.
        // Only relevant at frequencies where λ/4 > 60.96 m (< ~1230 kHz for all AM).
        if_asr_constrained: qw > ASR_M ? {
          max_physical_height_m: ASR_M,
          electrical_height_deg: asr_limited_deg,
          relative_efficiency_vs_quarter_wave: asr_limited_eff,
          efficiency_loss_db: round2(10 * Math.log10(asr_limited_eff)),
          note: `ASR constraint (no FAA exemption): max height ${ASR_M} m → ${asr_limited_deg}° electrical height. Efficiency vs. λ/4 baseline: ${(asr_limited_eff * 100).toFixed(0)}%. File FCC Form 854 before construction.`
        } : null,
        note: `At ${frequency_khz} kHz: λ/4=${qw} m, 5λ/8=${fe} m, λ/2=${hw} m. ${qw > ASR_M ? `ALL standard heights EXCEED the §17.7 60.96 m ASR trigger — FCC Form 854 and FAA 7460-1 aeronautical study required.` : `λ/4 is within ASR limit (${ASR_M} m); ASR registration not required at standard height.`}`
      };
    })(),
    // TPO power sweep — for 4-5 representative transmitter power levels within the
    // FCC class ceiling, shows what groundwave coverage metrics you'd get.
    // Answers the screening question: "what's the optimal TPO for this site?"
    // Each row: daytime reach, 5 mV/m (COL) radius, 1000 mV/m (blanket) radius,
    // estimated COL coverage %, estimated blanket pop %, and a compliant flag.
    tpo_power_sweep: (() => {
      const classCeil = FCC_CLASS_POWER_KW[fcc_class]?.max ?? 50;
      const classMin  = FCC_CLASS_POWER_KW[fcc_class]?.min ?? 0.001;
      // Deduplicated, sorted sweep points spanning class range + current TPO
      const rawPoints = [
        round2(classMin),
        round2(Math.max(classMin, tpo_kw / 2)),
        round2(tpo_kw),
        round2(Math.min(classCeil, tpo_kw * 2)),
        round2(classCeil)
      ];
      const sweepTpos = [...new Set(rawPoints.filter(t => t >= classMin && t <= classCeil))].sort((a, b) => a - b);

      // COL center reference: same as main score (col_centroid ?? current_site).
      const colCenter = col_centroid ?? current_site;
      const colDistKm = greatCircleKm(pt.lat, pt.lon, colCenter.lat, colCenter.lon);

      return sweepTpos.map(sweepTpo => {
        let reach_km = null, col_5mvm_km = null, blanket_km = null;
        try {
          reach_km = round2(fccAmDistanceKm({ frequency_khz, target_mvm: DAYTIME_REACH_TARGET_MVM, conductivity_msm: sigma_msm, erp_kw: sweepTpo }).distance_km);
        } catch(_){}
        try {
          col_5mvm_km = round2(fccAmDistanceKm({ frequency_khz, target_mvm: 5.0, conductivity_msm: sigma_msm, erp_kw: sweepTpo }).distance_km);
        } catch(_){}
        try {
          const rb = fccAmDistanceKm({ frequency_khz, target_mvm: 1000, conductivity_msm: sigma_msm, erp_kw: sweepTpo });
          blanket_km = round2(rb.distance_km);
        } catch(_){}

        // COL coverage estimate via disc proxy — same 10 km disc as main score.
        let col_coverage_pct_est = null;
        if (col_5mvm_km != null && !community_of_license_polygon){
          col_coverage_pct_est = round2(discCoverageFraction({
            circle_center: pt,
            circle_radius_km: col_5mvm_km,
            disc_center: colCenter,
            disc_radius_km: 10
          }));
        }

        // Blanket pop estimate via same proxy as main score.
        let blanket_pop_pct_est = null;
        if (blanket_km != null){
          const urbanFactor = Math.max(1.0, Math.min(5.0, 1.0 + (colDistKm < 10 ? 4.0 : colDistKm < 25 ? 2.0 : colDistKm < 50 ? 1.0 : 0.5)));
          blanket_pop_pct_est = round2(Math.PI * blanket_km * blanket_km * US_AVG_POP_DENSITY_PER_KM2 * urbanFactor / US_POPULATION_M * 100);
        }

        const col_meets_floor = col_coverage_pct_est != null ? col_coverage_pct_est >= COL_COVERAGE_HARD_FLOOR : null;
        const blanket_pop_ok  = blanket_pop_pct_est != null ? blanket_pop_pct_est <= BLANKET_POP_HARD_CEIL_PCT : null;

        return {
          tpo_kw: sweepTpo,
          is_current_tpo: Math.abs(sweepTpo - tpo_kw) < 0.001,
          daytime_reach_km: reach_km,
          col_5mvm_km,
          blanket_1000mvm_km: blanket_km,
          col_coverage_pct_est,
          blanket_pop_pct_est,
          col_meets_floor,
          blanket_pop_ok,
          compliant: col_meets_floor === true && blanket_pop_ok !== false
        };
      });
    })(),
    // Co-channel and adjacent-channel §73.37 minimum spacing estimate.
    // Computes whether this candidate's distance from the current transmitter site
    // satisfies the §73.37 minimum for the proposed station's class vs. itself
    // (treating the current site as the closest potential co-channel station of the
    // same class — a conservative screening proxy for identifying candidates that
    // may be too close to the current site to be legally viable at the same frequency).
    // NOTE: In practice §73.37 applies against LMS-licensed stations; this checks
    // only the current-site-to-candidate distance as a red-flag filter.
    co_channel_spacing_estimate: (() => {
      // §73.37(a) co-channel minimums for proposed class vs. same class.
      const CO_SAME_CLASS_KM = { A: 1037, B: 953, C: 354, D: 953 };
      // §73.37(b) first adjacent (±10 kHz) minimums for proposed vs. same class.
      const ADJ10_SAME_CLASS_KM = { A: 805, B: 724, C: 177, D: 724 };
      const ADJ20_SAME_CLASS_KM = { A: 402, B: 354, C:  96, D: 354 };

      const cls = fcc_class in CO_SAME_CLASS_KM ? fcc_class : 'D';
      const dist_km = pt.distance_from_current_km ?? 0;

      const co_min  = CO_SAME_CLASS_KM[cls];
      const adj10_min = ADJ10_SAME_CLASS_KM[cls];
      const adj20_min = ADJ20_SAME_CLASS_KM[cls];

      const co_ok   = dist_km >= co_min;
      const adj10_ok = dist_km >= adj10_min;
      const adj20_ok = dist_km >= adj20_min;

      return {
        candidate_distance_km: round2(dist_km),
        co_channel: {
          min_separation_km: co_min,
          meets_separation: co_ok,
          note: `Proposed Class ${cls} vs. existing Class ${cls} co-channel (§73.37(a)): ${co_ok ? 'MEETS' : 'FAILS'} ${co_min} km minimum (distance ${round2(dist_km)} km)`
        },
        adjacent_10khz: {
          min_separation_km: adj10_min,
          meets_separation: adj10_ok,
          note: `Proposed Class ${cls} vs. existing Class ${cls} ±10 kHz (§73.37(b)): ${adj10_ok ? 'MEETS' : 'FAILS'} ${adj10_min} km minimum`
        },
        adjacent_20khz: {
          min_separation_km: adj20_min,
          meets_separation: adj20_ok,
          note: `Proposed Class ${cls} vs. existing Class ${cls} ±20 kHz (§73.37(b)): ${adj20_ok ? 'MEETS' : 'FAILS'} ${adj20_min} km minimum`
        },
        // Does the candidate site have adequate separation from the current site to
        // operate on the same frequency, first adjacent, or second adjacent channel?
        screening_verdict: co_ok ? 'CO_CHANNEL_ELIGIBLE'
          : adj10_ok ? 'FIRST_ADJACENT_ELIGIBLE'
          : adj20_ok ? 'SECOND_ADJACENT_ELIGIBLE'
          : 'BELOW_ALL_SPACING_MINIMUMS',
        rule: '47 CFR §73.37 (daytime, proposed station vs. same class)',
        caveat: 'This checks only the current-site distance as a proxy. A filing requires separation analysis against ALL co-channel and adjacent-channel stations in the FCC LMS database using the §73.182 field-intensity method.'
      };
    })(),
    // Max TPO (kW) allowed under 47 CFR §73.21 for this station's FCC class.
    power_class_ceiling_kw: FCC_CLASS_POWER_KW[fcc_class]?.max ?? null,
    // OET Bulletin 65 / 47 CFR §1.1307 RF exposure summary.
    // All licensed AM stations must perform an MPE evaluation.
    // Near-field boundary = λ/(2π); general public exclusion zone derived from
    // OET-65 §3.B maximum permissible exposure limits for uncontrolled environments.
    // These are SCREENING estimates; actual exclusion distances require a full
    // near-field study with the specific antenna and ground system design.
    mpe_evaluation_required: true,
    mpe_rf_exposure_summary: (() => {
      const lambdaM_mpe = 300000 / frequency_khz;
      // Near-field boundary (reactive near-field): r < λ/(2π)
      const near_field_boundary_m = round2(lambdaM_mpe / (2 * Math.PI));
      // Far-field MPE limit for general public (uncontrolled environment):
      // 47 CFR §1.1310 Table 1: 0.3–3 MHz → S = f²/300 mW/cm² where f in MHz.
      // For AM broadcast (0.53–1.7 MHz): f² / 300 mW/cm²
      const freq_mhz = frequency_khz / 1000;
      // Round to 4 decimal places so small values at lower AM frequencies are non-zero.
      const mpe_limit_mw_cm2 = Math.round((freq_mhz * freq_mhz) / 300 * 10000) / 10000;
      // Power density at distance r (far-field, free-space):
      // S = P_ERP / (4π r²) × unit_conversions
      // Exclusion distance where S = MPE_LIMIT:
      // r = sqrt(P_W / (4π × MPE_W_m2)) where MPE_W_m2 = mpe_limit_mw_cm2 × 10
      const erp_w    = tpo_kw * 1000;  // assume ERP ≈ TPO for vertical monopole (screening)
      const mpe_w_m2 = mpe_limit_mw_cm2 * 10;  // convert mW/cm² → W/m²
      const exclusion_m = round2(Math.sqrt(erp_w / (4 * Math.PI * mpe_w_m2)));
      // Practical minimum fence distance: max of near-field boundary and exclusion radius.
      const fence_distance_m = round2(Math.max(near_field_boundary_m, exclusion_m));
      return {
        evaluation_required: true,
        rule: '47 CFR §1.1307 / OET Bulletin 65 §3.B',
        frequency_mhz: round2(freq_mhz),
        near_field_boundary_m,
        mpe_limit_mw_cm2,
        far_field_exclusion_m: exclusion_m,
        recommended_fence_distance_m: fence_distance_m,
        note: `AM stations require an RF exposure evaluation at every new/modified site. Near-field boundary: ${near_field_boundary_m} m (λ/(2π) at ${frequency_khz} kHz). Estimated public exclusion zone: ${exclusion_m} m at ${tpo_kw} kW TPO. Minimum fence distance: ${fence_distance_m} m. Actual exclusion zone must be computed with the filed antenna pattern — this is a free-space screening estimate.`
      };
    })(),
    // Nighttime service classification — station-class and channel-based
    // assessment of nighttime eligibility.  AM nighttime operation is governed
    // by §73.182 (skywave NIF), §73.25 (clear-channel protection), and
    // §73.27 (local channel).  This is a STATION-LEVEL assessment
    // (same for all candidates) but included per-candidate for API completeness.
    nighttime_classification: (() => {
      const isLocal = LOCAL_CHANNEL_KHZ.has(frequency_khz);
      const isClear = CLEAR_CHANNEL_KHZ.has(frequency_khz);
      const isClassA = fcc_class === 'A';
      const isClassB = fcc_class === 'B';
      const isClassC = fcc_class === 'C';

      let eligibility, nif_complexity, protection_class, key_constraint, nighttime_power_max_kw;

      if (isLocal){
        // Local channels: 6 clear local channels at ≤250 W daytime; limited/shared nighttime.
        eligibility = 'LIMITED';
        nif_complexity = 'LOW';
        protection_class = 'local_channel';
        key_constraint = `Local channel (${frequency_khz} kHz, §73.27): nighttime operation at ≤250 W with sharing on most local channels. §73.182 NIF not required for local-channel stations — share the channel with others.`;
        nighttime_power_max_kw = 0.25;
      } else if (isClassA && isClear){
        // Class A dominant on clear channel — full nighttime, most protected status.
        eligibility = 'YES';
        nif_complexity = 'VERY_HIGH';
        protection_class = 'class_A_dominant_clear_channel';
        key_constraint = `Class A dominant on clear channel (${frequency_khz} kHz, §73.25): full nighttime operation; must file §73.182 NIF to demonstrate no increase in interference to OTHER stations' protected contours. Typically requires detailed skywave contour study + DA-N pattern.`;
        nighttime_power_max_kw = 50;
      } else if (isClear && !isClassA){
        // Secondary station on clear channel — nighttime operation VERY restricted.
        eligibility = 'RESTRICTED';
        nif_complexity = 'VERY_HIGH';
        protection_class = `class_${fcc_class}_secondary_clear_channel`;
        key_constraint = `Class ${fcc_class} secondary on clear channel (${frequency_khz} kHz, §73.25): nighttime operation restricted — must not increase interference to dominant Class A protected contours (0.5 mV/m and 25 µV/m). Complex §73.182 NIF study required; authorization may be limited or denied.`;
        nighttime_power_max_kw = fcc_class === 'B' ? 50 : fcc_class === 'C' ? 0.25 : 50;
      } else if (isClassA){
        // Class A on regional channel.
        eligibility = 'YES';
        nif_complexity = 'HIGH';
        protection_class = 'class_A_regional';
        key_constraint = `Class A on regional channel (${frequency_khz} kHz): nighttime operation at up to 50 kW. §73.182 NIF required — must not cause objectionable interference to other stations' protected contours.`;
        nighttime_power_max_kw = 50;
      } else if (isClassB){
        // Class B regional.
        eligibility = 'YES';
        nif_complexity = 'MODERATE';
        protection_class = 'class_B_regional';
        key_constraint = `Class B on regional channel (${frequency_khz} kHz): nighttime operation up to 50 kW. §73.182 NIF required; typically straightforward on uncrowded regional channels.`;
        nighttime_power_max_kw = 50;
      } else if (isClassC){
        // Class C local.
        eligibility = 'LIMITED';
        nif_complexity = 'LOW';
        protection_class = 'class_C_local';
        key_constraint = `Class C local (${frequency_khz} kHz, §73.27): ≤250 W with same-channel sharing. Full §73.182 NIF not required — follow local sharing framework.`;
        nighttime_power_max_kw = 0.25;
      } else {
        // Class D regional.
        eligibility = 'LIMITED';
        nif_complexity = 'MODERATE';
        protection_class = 'class_D_regional';
        key_constraint = `Class D secondary (${frequency_khz} kHz): daytime-only authorization is common. Nighttime requires §73.182 NIF demonstrating no interference — Class D nighttime is discretionary and may be denied.`;
        nighttime_power_max_kw = 50; // daytime limit; nighttime may be less
      }

      if (treaty_zone){
        eligibility = eligibility === 'YES' ? 'RESTRICTED' : eligibility;
        key_constraint += ` Additionally in treaty zone (${treaty_zone}): international coordination adds nighttime power constraints.`;
      }

      return {
        eligibility,
        nif_complexity,
        protection_class,
        key_constraint,
        nighttime_power_max_kw,
        nif_study_required: !isLocal && !isClassC,
        rule: isLocal || isClassC ? '47 CFR §73.27 (local channel sharing)' : '47 CFR §73.182 / §73.25'
      };
    })(),
    blanket_1000mvm_km,
    minimum_tpo_for_compliance_kw,
    minimum_tpo_for_col_coverage_kw,
    ground_sigma_mS_m:         sigma_msm,
    ground_sigma_quality:      sigmaQuality(sigma_msm),
    ground_sigma_source,
    ground_sigma_filing_grade,
    ground_radial_advisory:  buildGroundRadialAdvisory(sigma_msm, frequency_khz),
    // Per-candidate scoring confidence based on available data layers.
    // HIGH: filing-grade σ raster AND polygon provided.
    // MEDIUM: one of the two present.
    // LOW: both absent (zone-table σ, disc-proxy COL).
    score_confidence: ground_sigma_filing_grade === 'filing' && community_of_license_polygon ? 'HIGH'
      : ground_sigma_filing_grade === 'filing' || community_of_license_polygon ? 'MEDIUM'
      : 'LOW',
    // Numeric uncertainty bounds on the composite score.
    // Not a statistical confidence interval — a practical range showing how much
    // the score could shift if the operator supplies higher-quality input data.
    // Uncertainty sources:
    //   zone-table σ  → ±12 pts (measured conductivity can flip POOR↔GOOD)
    //   missing COL polygon → ±10 pts (disc proxy vs real polygon boundary)
    //   missing COL centroid → ±5 pts (field at centroid uses best-guess geography)
    score_confidence_band: (() => {
      const factors = [];
      let uncertainty = 0;
      if (ground_sigma_filing_grade !== 'filing'){
        factors.push(`zone-table conductivity (±12 pts): measured σ could shift conductivity sub-score — commission soil survey to resolve`);
        uncertainty += 12;
      }
      if (!community_of_license_polygon){
        factors.push(`COL disc proxy (±10 pts): polygon-based coverage analysis could differ materially from 10 km radius disc`);
        uncertainty += 10;
      }
      if (!col_centroid){
        factors.push(`COL centroid not provided (±5 pts): field at community center computed from best-guess geography`);
        uncertainty += 5;
      }
      return {
        score_low:         round2(Math.max(0,   score_final - uncertainty)),
        score_high:        round2(Math.min(100, score_final + uncertainty)),
        uncertainty_pts:   uncertainty,
        uncertainty_factors: factors
      };
    })(),
    // Regulatory risk score — composite 0-100 risk index (lower = less risk).
    // Synthesizes filing-difficulty factors that are independent of the optimization
    // score: treaty zone, ASR, poor σ, blanket-pop proximity, COL coverage failure,
    // NIF complexity, and DA pattern requirements.  Designed so a PROMISING site with
    // high regulatory risk still gets flagged for early mitigation planning.
    regulatory_risk_score: (() => {
      const lambdaM_r = 300000 / frequency_khz;
      const qwM_r     = lambdaM_r / 4;
      const asrRequired = qwM_r > 60.96;
      const risks = [];
      let total = 0;

      if (treaty_zone){
        risks.push({ factor: 'TREATY_ZONE', points: 40, note: `In treaty zone (${treaty_zone}): FCC IB coordination adds 12–52 weeks; power/pattern restrictions likely` });
        total += 40;
      }
      if (asrRequired){
        risks.push({ factor: 'ASR_REQUIRED', points: 15, note: `λ/4=${Math.round(qwM_r)} m > 60.96 m §17.7 threshold: FAA 7460-1 + FCC Form 854 required before construction; adds 8–16 weeks` });
        total += 15;
      }
      if (sigma_msm < 2){
        risks.push({ factor: 'POOR_CONDUCTIVITY', points: 20, note: `σ=${sigma_msm} mS/m (POOR): extended ground system required; adds cost, time, and uncertainty to §73.190 certification` });
        total += 20;
      } else if (sigma_msm < 4){
        risks.push({ factor: 'FAIR_CONDUCTIVITY', points: 10, note: `σ=${sigma_msm} mS/m (FAIR): soil resistivity survey strongly recommended before ground system design` });
        total += 10;
      } else if (sigma_msm < 8){
        risks.push({ factor: 'MODERATE_CONDUCTIVITY', points: 5, note: `σ=${sigma_msm} mS/m (GOOD): standard 120-radial system adequate but soil survey still required for §73.190 certification` });
        total += 5;
      }
      if (blanket_population_pct != null && blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT){
        risks.push({ factor: 'BLANKET_POP_EXCEEDS_LIMIT', points: 25, note: `Estimated blanket pop ${round2(blanket_population_pct)}% > §73.24(g) 1% limit: filing cannot proceed without power reduction or DA-N pattern` });
        total += 25;
      } else if (blanket_population_pct != null && blanket_population_pct >= 0.8){
        risks.push({ factor: 'BLANKET_POP_HIGH', points: 10, note: `Estimated blanket pop ${round2(blanket_population_pct)}% approaching §73.24(g) 1% limit: minor power or DA change could trigger non-compliance` });
        total += 10;
      } else if (blanket_population_pct != null && blanket_population_pct >= 0.5){
        risks.push({ factor: 'BLANKET_POP_ELEVATED', points: 5, note: `Estimated blanket pop ${round2(blanket_population_pct)}% in elevated range: monitor but not yet a hard constraint` });
        total += 5;
      }
      if (coverage_pct != null && coverage_pct < COL_COVERAGE_HARD_FLOOR){
        const gap = Math.round((COL_COVERAGE_HARD_FLOOR - coverage_pct) * 100);
        risks.push({ factor: 'COL_COVERAGE_FAILS', points: gap > 20 ? 20 : 10, note: `COL coverage ${(coverage_pct * 100).toFixed(0)}% < §73.24(j) 80% floor (gap ${gap}%): coverage remedy required before filing` });
        total += gap > 20 ? 20 : 10;
      }
      if (!LOCAL_CHANNEL_KHZ.has(frequency_khz)){
        const nifPoints = CLEAR_CHANNEL_KHZ.has(frequency_khz) ? 20
          : (fcc_class === 'A' || fcc_class === 'B') ? 10 : 5;
        const nifNote = CLEAR_CHANNEL_KHZ.has(frequency_khz)
          ? `Clear channel (${frequency_khz} kHz): §73.182 NIF study most complex — dominant Class A skywave protection applies`
          : `§73.182 NIF study required for all non-local-channel stations at a new transmitter site`;
        risks.push({ factor: 'NIF_STUDY_REQUIRED', points: nifPoints, note: nifNote });
        total += nifPoints;
      }
      if (/DA/i.test(pattern_mode)){
        risks.push({ factor: 'DA_PATTERN_REQUIRED', points: 10, note: `${pattern_mode} operation: §73.150 DA pattern design + antenna range measurement adds 3–6 months to filing timeline` });
        total += 10;
      }

      const risk_score = Math.min(100, total);
      const risk_category = risk_score >= 61 ? 'VERY_HIGH'
        : risk_score >= 41 ? 'HIGH'
        : risk_score >= 21 ? 'MODERATE'
        : 'LOW';

      return {
        risk_score,
        risk_category,
        risk_factors: risks,
        interpretation: risk_score >= 61
          ? `VERY HIGH regulatory complexity — multiple blocking issues; recommend deprioritizing unless site has exceptional propagation advantages.`
          : risk_score >= 41
          ? `HIGH regulatory risk — at least one major filing barrier present; budget additional time and legal/engineering resources.`
          : risk_score >= 21
          ? `MODERATE risk — routine but non-trivial filing requirements; plan for soil survey, ASR, or NIF as applicable.`
          : `LOW risk — straightforward filing path; standard Form 301-AM process without exceptional barriers.`
      };
    })(),
    field_at_col_centroid_mvm,
    // Power-efficiency metrics — people served and service-area km² per kW of TPO.
    // Useful for comparing cost-effectiveness across sites at identical TPO.
    // Both are screening-grade proxies using the national average density.
    power_efficiency_metrics: (() => {
      if (tpo_kw == null || tpo_kw <= 0) return null;
      const ppl_per_kw = estimated_daytime_population_served != null
        ? Math.round(estimated_daytime_population_served / tpo_kw)
        : null;
      const service_area_km2 = daytime_reach_km != null
        ? round2(Math.PI * daytime_reach_km * daytime_reach_km)
        : null;
      const km2_per_kw = service_area_km2 != null
        ? round2(service_area_km2 / tpo_kw)
        : null;
      const col_pct_per_kw = coverage_pct != null
        ? round2((coverage_pct * 100) / tpo_kw)
        : null;
      let efficiency_tier;
      if (ppl_per_kw == null) efficiency_tier = 'UNKNOWN';
      else if (ppl_per_kw > 5000) efficiency_tier = 'HIGH';
      else if (ppl_per_kw > 1500) efficiency_tier = 'MODERATE';
      else efficiency_tier = 'LOW';
      return {
        tpo_kw,
        people_per_kw: ppl_per_kw,
        km2_per_kw,
        col_coverage_pct_per_kw: col_pct_per_kw,
        efficiency_tier,
        note: `At ${tpo_kw} kW TPO: ~${ppl_per_kw != null ? ppl_per_kw.toLocaleString() : '?'} people/kW, ${km2_per_kw != null ? km2_per_kw.toLocaleString() : '?'} km²/kW service area (national avg density proxy)`
      };
    })(),
    // DA gain potential — assessed when COL coverage is below 100% but not catastrophically low.
    // Identifies candidates where a directional antenna study could push the 5 mV/m contour
    // toward the community of license to recover or improve compliance.
    da_gain_potential: (() => {
      if (coverage_pct == null || /DA/i.test(pattern_mode)) return null;
      // DA is most useful when NDA coverage is between 40–95%: too low means DA can't
      // bridge the gap; at ≥100% it's already compliant.
      const pct = coverage_pct * 100;
      if (pct >= 100) return { applicable: false, reason: 'Already ≥100% NDA COL coverage — DA not needed for §73.24(j)' };
      if (pct < 40)   return { applicable: false, reason: `NDA coverage ${pct.toFixed(0)}% is too low for DA to recover §73.24(j) compliance at current TPO — power increase required first` };

      // A DA pattern can redistribute ERP asymmetrically toward the COL centroid.
      // Typical DA gain toward the target bearing: +3 to +6 dB relative to NDA.
      // In groundwave terms, +3 dB ERP roughly scales field by √2 (≈+41% at a given distance).
      // We model the best-case DA recovery as a 4× ERP boost in the preferred direction
      // (equivalent to doubling the ERP in kW — i.e., TPO × 4 directional weighting),
      // which translates to roughly +1.4–2× in km on the FCC groundwave curves.
      const DA_ERP_BOOST_FACTOR = 4; // conservative upper-bound for a well-optimized pattern
      let da_col_pct_estimate = null;
      try {
        const erp_da = tpo_kw * DA_ERP_BOOST_FACTOR;
        const r5_da = fccAmDistanceKm({ frequency_khz, target_mvm: 5.0, conductivity_msm: sigma_msm, erp_kw: erp_da });
        const r5_nda = fccAmDistanceKm({ frequency_khz, target_mvm: 5.0, conductivity_msm: sigma_msm, erp_kw: tpo_kw });
        if (r5_da != null && r5_nda != null && r5_nda > 0){
          // Scale coverage_pct by (r5_da/r5_nda)² (area scales as radius²)
          const area_scale = Math.min(4.0, (r5_da / r5_nda) ** 2);
          da_col_pct_estimate = round2(Math.min(100, pct * area_scale));
        }
      } catch (_) { /* ignore curve errors */ }

      const gap_pct = round2(80 - pct); // gap to §73.24(j) 80% floor
      const would_recover = da_col_pct_estimate != null && da_col_pct_estimate >= 80;
      return {
        applicable: true,
        nda_col_coverage_pct: round2(pct),
        col_gap_to_floor_pct: Math.max(0, gap_pct),
        da_col_coverage_estimate_pct: da_col_pct_estimate,
        would_recover_col_compliance: would_recover,
        da_erp_boost_modeled: `${DA_ERP_BOOST_FACTOR}× NDA ERP toward COL bearing (best-case pattern)`,
        recommendation: would_recover
          ? `DA pattern likely recovers §73.24(j) compliance — commission §73.150 DA study toward COL bearing`
          : da_col_pct_estimate != null && da_col_pct_estimate > pct
          ? `DA pattern improves coverage to ~${da_col_pct_estimate.toFixed(0)}% but may not reach §73.24(j) floor; consider DA + TPO increase`
          : `DA pattern analysis inconclusive — full §73.150 study required before ruling out`,
        rule: '47 CFR §73.150 / §73.24(j)'
      };
    })(),
    // Directional antenna study guide — actionable guidance on whether to pursue
    // a §73.150 DA study for this candidate and what kind of study to commission.
    // Distinct from da_gain_potential (COL-focused): this covers ALL reasons a
    // DA could be needed — COL recovery, blanket suppression, treaty compliance,
    // or clear-channel secondary nighttime protection.
    directional_antenna_study_guide: (() => {
      const colPct        = coverage_pct == null ? null : round2(coverage_pct * 100);
      const colNeedsDA    = colPct != null && colPct < 80 && colPct >= 40;
      const blankHigh     = blanket_population_pct != null && blanket_population_pct >= 0.8;
      const isClear       = CLEAR_CHANNEL_KHZ.has(frequency_khz);
      const isClassA      = fcc_class === 'A';
      const secondaryClear = isClear && !isClassA;
      const isLocal       = LOCAL_CHANNEL_KHZ.has(frequency_khz);
      const isClassC      = fcc_class === 'C';

      // Local/Class C: DA not applicable (250 W max; no meaningful pattern optimization).
      if (isLocal || isClassC) {
        return {
          recommended: false,
          primary_reason: 'NOT_APPLICABLE',
          note: `Class ${fcc_class} on local channel — DA not applicable at ≤250 W. No §73.150 study needed.`
        };
      }

      const triggers = [];

      if (colNeedsDA) {
        triggers.push({
          trigger:  'COL_COVERAGE_GAP',
          detail:   `NDA coverage ${colPct.toFixed(0)}% < §73.24(j) 80% floor. DA with maximum ERP toward the COL centroid bearing can recover compliance.`,
          cfr:      '47 CFR §73.150 / §73.24(j)'
        });
      }
      if (blankHigh) {
        triggers.push({
          trigger:  'BLANKET_POP_SUPPRESSION',
          detail:   `Blanket pop ${round2(blanket_population_pct)}% approaching/exceeding §73.24(g) 1% limit. DA pattern nulls the 1000 mV/m lobe away from population centers.`,
          cfr:      '47 CFR §73.24(g) / §73.150'
        });
      }
      if (treaty_zone) {
        triggers.push({
          trigger:  'TREATY_CONSTRAINT',
          detail:   `Within ${treaty_zone} treaty zone. DA likely required to reduce power toward the border while maintaining COL coverage.`,
          cfr:      '1986 US/Mexico AM Agreement / US-Canada AM Treaty'
        });
      }
      if (secondaryClear) {
        triggers.push({
          trigger:  'CLEAR_CHANNEL_SECONDARY_NIGHTTIME',
          detail:   `Secondary Class ${fcc_class} on clear channel ${frequency_khz} kHz. DA-N (nighttime directional) almost always required to protect dominant Class A skywave contours.`,
          cfr:      '47 CFR §73.25 / §73.182'
        });
      }

      const recommended   = triggers.length > 0;
      const primary_reason = triggers.length > 0 ? triggers[0].trigger : 'NONE';

      if (!recommended) {
        return {
          recommended: false,
          primary_reason: 'NONE',
          note: `NDA operation appears sufficient: COL ${colPct != null ? colPct.toFixed(0)+'%' : 'unknown'}, blanket pop within limits, no treaty zone, not secondary on clear channel. Full §73.37 analysis may still reveal interference constraints.`
        };
      }

      // Determine study type from trigger mix
      const needsDaN  = secondaryClear;              // clear-channel secondary → DA-N required
      const needsDaD  = colNeedsDA || blankHigh || treaty_zone;
      const study_type = needsDaN && needsDaD ? 'FULL_DA_STUDY_DAY_NIGHT'
        : needsDaN ? 'DA_N_NIGHTTIME_ONLY'
        : 'DA_D_DAYTIME_ONLY';

      const key_constraints = [];
      if (colNeedsDA)     key_constraints.push(`Maximize ERP toward COL centroid bearing (§73.24(j) ≥80% coverage goal).`);
      if (blankHigh)      key_constraints.push(`Null 1000 mV/m contour away from populated areas (§73.24(g) ≤1% blanket limit).`);
      if (treaty_zone)    key_constraints.push(`Reduce power toward ${treaty_zone} border for binational coordination.`);
      if (secondaryClear) key_constraints.push(`DA-N pattern must protect Class A dominant's 0.5 mV/m and 25 µV/m contours.`);
      key_constraints.push(`§73.316: horizontal pattern filed in 5° increments (72 tabulated values + 0°).`);
      key_constraints.push(`Typical AM DA array: 2–4 tower elements; ground system must be extended to all towers.`);

      const add_wks_min = study_type === 'FULL_DA_STUDY_DAY_NIGHT' ? 16 : 8;
      const add_wks_max = study_type === 'FULL_DA_STUDY_DAY_NIGHT' ? 32 : 16;

      return {
        recommended,
        primary_reason,
        study_type,
        triggers,
        key_constraints,
        pattern_radials_required: 72,  // §73.316: 5° increments
        additional_engineering_weeks_min: add_wks_min,
        additional_engineering_weeks_max: add_wks_max,
        note: `Commission a ${study_type.replace(/_/g, ' ')} study before filing. DA engineering adds ${add_wks_min}–${add_wks_max} weeks; budget for multiple antenna modeling iterations.`,
        rule: '47 CFR §73.150 / §73.316'
      };
    })(),
    // Signal environment advisory — characterizes the directional interference
    // environment for this candidate based on bearing and distance context.
    // Complements co_channel_spacing_estimate with geographic framing.
    signal_environment_advisory: (() => {
      const bearing = pt.bearing_deg ?? null;
      const dist = pt.distance_from_current_km ?? 0;

      // Bearing quadrant label — used for geographic framing.
      const quadrant = bearing == null ? null
        : bearing < 45  ? 'NORTH_SECTOR'
        : bearing < 135 ? 'EAST_SECTOR'
        : bearing < 225 ? 'SOUTH_SECTOR'
        : bearing < 315 ? 'WEST_SECTOR'
        : 'NORTH_SECTOR';

      // Near (<25 km): within the primary service area of the current site —
      // relocation here means the new and old towers are likely to mutually
      // interfere on-channel during construction overlap.  Coordination required.
      // Mid (25–80 km): regional; co-channel risk depends on class separation rules.
      // Far (>80 km): likely in a different propagation region; full §73.37 study needed.
      const proximity_tier = dist < 25 ? 'NEAR'
        : dist < 80 ? 'MID'
        : 'FAR';

      const notes = [];
      if (proximity_tier === 'NEAR'){
        notes.push(`At ${round2(dist)} km from current site, temporary co-channel interference with current tower during construction overlap is a practical concern — coordinate with FCC on STA (Special Temporary Authorization) and signal shutdown protocol.`);
      }
      if (treaty_zone){
        notes.push(`Treaty zone ${treaty_zone} at this bearing imposes directional power or pattern constraints on the ${quadrant?.replace('_', ' ') ?? ''} lobe.`);
      }
      const isClear = CLEAR_CHANNEL_KHZ.has(frequency_khz);
      if (isClear && proximity_tier !== 'FAR'){
        notes.push(`${frequency_khz} kHz is a §73.25 clear channel. Dominant Class A stations at this frequency may project skywave interference across this ${quadrant?.replace('_', ' ') ?? ''} bearing; NIF study must include full §73.182 azimuthal analysis.`);
      }
      if (sigma_msm < 2){
        notes.push(`POOR ground conductivity (σ=${sigma_msm} mS/m) reduces groundwave propagation — signal environment may be more benign than high-σ sites but limits both service coverage AND useful co-channel analysis distance.`);
      }

      return {
        bearing_deg: bearing != null ? round2(bearing) : null,
        quadrant,
        proximity_tier,
        distance_km: round2(dist),
        notes: notes.length > 0 ? notes : [`No specific signal environment alerts for this candidate location.`],
        caution: `This is a screening-grade directional assessment only. Full §73.37 co-channel/adjacent-channel separation must be measured to all licensed stations in the region before filing.`
      };
    })(),
    // Skywave protection advisory — quantifies the nighttime skywave NIF burden
    // for this candidate and identifies the key interference constraint class.
    // Complements nighttime_classification with a location-specific risk level and
    // estimated 25 µV/m protected contour radius.  Screening-grade only — the real
    // §73.182 NIF uses FCC skywave propagation software with 1° azimuthal resolution.
    skywave_protection_advisory: (() => {
      const isLocal  = LOCAL_CHANNEL_KHZ.has(frequency_khz);
      const isClear  = CLEAR_CHANNEL_KHZ.has(frequency_khz);
      const isClassA = fcc_class === 'A';
      const isClassC = fcc_class === 'C';

      // Local and Class C channels: no skywave NIF burden.
      if (isLocal || isClassC) {
        return {
          advisory_level:  'NONE',
          nif_required:    false,
          note:            `${frequency_khz} kHz Class ${fcc_class}: no §73.182 skywave NIF required under local-channel framework (§73.27).`,
          rule:            '47 CFR §73.27'
        };
      }

      // Estimate 25 µV/m skywave protected contour radius.
      // FCC skywave curves (OET-72 methodology): approximate D_25uv ≈ 1700 * sqrt(ERP_kw/1000).
      // This is a textbook approximation; actual FCC skywave computation uses
      // F(50,10) curves with seasonal/geographic correction.
      const erp_ref_kw = isClassA ? Math.min(50, tpo_kw) : Math.min(tpo_kw, FCC_CLASS_POWER_KW[fcc_class]?.max ?? 50);
      const protected_contour_25uvm_est_km = round2(1700 * Math.sqrt(erp_ref_kw / 1000));

      // 0.5 mV/m groundwave protected radius (already computed as daytime_reach_km at 0.5 mV/m target).
      const groundwave_05mvm_est_km = daytime_reach_km ?? null;

      const advisory_items = [];
      let advisory_level;
      let key_risk;

      if (isClear && !isClassA) {
        // Secondary on clear channel — hardest constraint class.
        advisory_items.push(`Secondary Class ${fcc_class} on clear channel ${frequency_khz} kHz: must not INCREASE nighttime interference to dominant Class A station's 0.5 mV/m groundwave AND 25 µV/m skywave contours.`);
        advisory_items.push(`The §73.182 NIF must demonstrate interference is not materially increased from the current authorized site — this is a delta comparison, not an absolute limit.`);
        advisory_items.push(`Clear-channel secondary NIF requires 1° azimuthal resolution (360 bearings × standard skip-distance increments).`);
        if (treaty_zone) {
          advisory_items.push(`TREATY ZONE ${treaty_zone}: binational skywave coordination required — FCC IB review adds 12–52 weeks. Pattern authorization may be restricted in directions toward the border.`);
        }
        advisory_level = treaty_zone ? 'CRITICAL' : 'HIGH';
        key_risk = `Secondary on §73.25 clear channel — must not increase interference to Class A dominant's protected contours (0.5 mV/m groundwave / 25 µV/m skywave)`;
      } else if (isClear && isClassA) {
        // Dominant Class A — protected but still must file NIF for changes.
        advisory_items.push(`Class A dominant on clear channel ${frequency_khz} kHz: full nighttime authorization with strongest §73.25 protection rights.`);
        advisory_items.push(`§73.182 NIF still required for any site change — must demonstrate that the NEW location does not cause additional interference to OTHER co-channel or adjacent-channel protected stations.`);
        advisory_items.push(`NIF submission for Class A relocation typically includes skywave field strength in all 1° bearings at distances from the first skip-zone out to 3200 km.`);
        if (treaty_zone) {
          advisory_items.push(`TREATY ZONE ${treaty_zone}: FCC IB staff review required even for dominant Class A relocations. Binational agreement may restrict nighttime power or pattern toward border.`);
        }
        advisory_level = treaty_zone ? 'HIGH' : 'MODERATE';
        key_risk = `Class A dominant filing — §73.182 NIF required to demonstrate no NEW interference to other protected stations`;
      } else {
        // Regional channel (Class B/D).
        advisory_items.push(`Regional channel ${frequency_khz} kHz (Class ${fcc_class}): §73.182 NIF required. Demonstrate no increase in interference to co-channel stations' 0.5 mV/m groundwave and 25 µV/m skywave protected contours.`);
        advisory_items.push(`Regional NIF complexity depends on co-channel station density. Typically simpler than clear-channel studies; commission §73.37 spacing analysis simultaneously.`);
        if (treaty_zone) {
          advisory_items.push(`TREATY ZONE ${treaty_zone}: international coordination adds 12–52 weeks even for regional channels — File FCC IB coordination request in parallel with domestic NIF.`);
        }
        advisory_level = treaty_zone ? 'MODERATE' : 'LOW';
        key_risk = `Regional channel — §73.182 NIF required; complexity scales with co-channel station density in the region`;
      }

      const nif_study_type = isClear
        ? `§73.182 full azimuthal skywave NIF (1° bearings, standard skip-zone increments, OET-72 methodology)`
        : `§73.182 skywave NIF (regional channel format — co-channel and adj-channel stations in region)`;

      return {
        advisory_level,
        nif_required:                     true,
        nif_study_type,
        protected_contour_25uvm_est_km,
        groundwave_05mvm_est_km,
        advisory_items,
        key_risk,
        treaty_factor:                    treaty_zone ?? null,
        rule:                             isClear ? '47 CFR §73.25 / §73.182' : '47 CFR §73.182'
      };
    })(),
    // Coverage overlap analysis — two-circle intersection model.
    // Estimates what fraction of the current site's 0.5 mV/m service area
    // would be covered by this candidate at the same TPO.  Zero distance (current
    // site itself) = 100% overlap.  Useful for evaluating listener continuity
    // during the relocation: a candidate far away may serve a completely different
    // geographic area from the current license.
    coverage_overlap_analysis: (() => {
      const dist = pt.distance_from_current_km ?? 0;
      if (daytime_reach_km == null) return null;
      const r = daytime_reach_km;  // candidate reach radius (km)
      // Current site reach — approximate with same TPO + conductivity
      // (we don't have the current site σ here, so use the same σ as this candidate
      // as a conservative proxy — if current site is better soil it has wider reach).
      let current_reach_km = null;
      try {
        const rCur = fccAmDistanceKm({ frequency_khz, target_mvm: DAYTIME_REACH_TARGET_MVM, conductivity_msm: sigma_msm, erp_kw: tpo_kw });
        current_reach_km = rCur?.distance_km ?? null;
      } catch (_){ /* ignore */ }
      if (current_reach_km == null) return null;
      const R = current_reach_km;  // current site reach radius (km)
      const d = dist;              // distance between towers (km)

      let overlap_area_km2 = null;
      let overlap_fraction = null;
      if (d === 0){
        // Same location — 100% overlap
        overlap_area_km2 = round2(Math.PI * R * R);
        overlap_fraction = 1.0;
      } else if (d >= R + r){
        // Circles don't overlap at all
        overlap_area_km2 = 0;
        overlap_fraction = 0;
      } else if (d + r <= R){
        // Candidate circle fully inside current circle
        overlap_area_km2 = round2(Math.PI * r * r);
        overlap_fraction = round2((r * r) / (R * R));
      } else if (d + R <= r){
        // Current circle fully inside candidate circle
        overlap_area_km2 = round2(Math.PI * R * R);
        overlap_fraction = 1.0;
      } else {
        // Partial overlap — circular segment formula
        const a1 = 2 * Math.acos(Math.min(1, (d * d + R * R - r * r) / (2 * d * R)));
        const a2 = 2 * Math.acos(Math.min(1, (d * d + r * r - R * R) / (2 * d * r)));
        const area = 0.5 * R * R * (a1 - Math.sin(a1)) + 0.5 * r * r * (a2 - Math.sin(a2));
        overlap_area_km2 = round2(Math.max(0, area));
        const current_area_km2 = Math.PI * R * R;
        overlap_fraction = round2(Math.max(0, Math.min(1, area / current_area_km2)));
      }

      const coverage_continuity = overlap_fraction == null ? 'UNKNOWN'
        : overlap_fraction >= 0.70 ? 'HIGH'
        : overlap_fraction >= 0.40 ? 'MODERATE'
        : overlap_fraction >= 0.10 ? 'LOW'
        : 'MINIMAL';
      return {
        candidate_reach_km: round2(r),
        current_site_reach_km_proxy: round2(R),
        tower_separation_km: round2(d),
        overlap_area_km2,
        overlap_fraction,
        coverage_continuity,
        note: `Screening-grade 2-circle model using same TPO (${tpo_kw} kW) and σ=${sigma_msm} mS/m. Current site σ may differ; a measured σ at both locations would refine this estimate.`,
        rule: '§73.24 service area continuity — not an FCC filing requirement, but relevant for listener base analysis'
      };
    })(),
    treaty_zone,
    fuel_risk:               LABEL_NOT_EVALUATED,
    notes: buildNotes({ coverage_pct, sigma_msm, blanket_population_pct, distance_from_current_km: pt.distance_from_current_km }),
    explanation: {
      score_breakdown: roundBreakdown(score_breakdown),
      // Raw (unweighted) sub-scores: each on 0–100 scale before goal weighting.
      // These show the underlying physical metric regardless of which goals are enabled.
      score_components_raw: {
        col_coverage:    sub.col_coverage    == null ? null : round2(sub.col_coverage),
        population:      sub.population      == null ? null : round2(sub.population),
        blanket:         sub.blanket         == null ? null : round2(sub.blanket),
        conductivity:    round2(sub.conductivity),
        wildfire:        sub.wildfire,
        treaty_zone:     sub.treaty_zone     == null ? null : round2(sub.treaty_zone)
      },
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

  const hasFlags  = c._flags && c._flags.length > 0;
  const colFail   = hasFlags && c._flags.some(f => /COL/i.test(f));
  const blankFail = hasFlags && c._flags.some(f => /Blanket/i.test(f));

  if (c.treaty_zone){
    // Treaty zone takes highest priority — FCC IB coordination required
    // before any other action regardless of coverage/blanket status.
    if (hasFlags) labels.add(LABEL_NON_COMPLIANT); else labels.add(LABEL_REVIEW_REQUIRED);
    c.nif_status = hasFlags ? LABEL_NON_COMPLIANT : LABEL_REVIEW_REQUIRED;
    c.status_category = 'TREATY_REVIEW';
  } else if (!hasFlags){
    // No hard compliance failures.
    if (c.score >= scoreCutoff){
      labels.add(LABEL_PROMISING);
      c.nif_status = LABEL_PROMISING;
      c.status_category = 'PROMISING';
    } else {
      labels.add(LABEL_REVIEW_REQUIRED);
      c.nif_status = LABEL_REVIEW_REQUIRED;
      c.status_category = 'REVIEW_REQUIRED';
    }
  } else {
    // At least one hard failure — classify recovery pathway.
    labels.add(LABEL_NON_COMPLIANT);
    c.nif_status = LABEL_NON_COMPLIANT;

    if (blankFail && !colFail){
      // Only blanket pop fails: reduce power to fix.
      c.status_category = 'RECOVERABLE_WITH_REDUCED_POWER';
    } else if (colFail && !blankFail){
      // Only COL coverage fails — classify by most specific recovery path.
      if (c.minimum_tpo_for_col_coverage_kw != null){
        // Engine found a feasible TPO (≤50 kW) that reaches the §73.24(j) 5 mV/m floor —
        // direct power increase is the most actionable fix.
        c.status_category = 'RECOVERABLE_WITH_POWER_INCREASE';
      } else if (c.field_at_col_centroid_mvm != null && c.field_at_col_centroid_mvm < 0.5){
        // Field so weak that even 50 kW cannot reach the COL — a community boundary
        // amendment is the only viable path.
        c.status_category = 'RECOVERABLE_WITH_COL_CHANGE';
      } else if (c.col_coverage_pct != null && c.col_coverage_pct >= 0.50){
        // Coverage close to the 80% floor — DA shaping may push the contour over.
        c.status_category = 'RECOVERABLE_WITH_DA';
      } else {
        // Default: DA pattern design is the primary engineering tool.
        c.status_category = 'RECOVERABLE_WITH_DA';
      }
    } else {
      // Both fail or unrecognized combination.
      c.status_category = 'NON_COMPLIANT';
    }
  }

  c.status_labels = Array.from(labels);
  // Lift the flags to limitations and remove the private field.
  if (hasFlags){
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
    blanket_population_pct:          b.blanket_population_pct,
    minimum_tpo_for_compliance_kw:   b.minimum_tpo_for_compliance_kw ?? null,
    minimum_tpo_for_col_coverage_kw: b.minimum_tpo_for_col_coverage_kw ?? null,
    field_at_col_centroid_mvm:       b.field_at_col_centroid_mvm ?? null,
    estimated_daytime_population_served: b.estimated_daytime_population_served ?? null,
    col_coverage_gap_pct:    b.col_coverage_gap_pct ?? null,
    score_confidence: b.score_confidence ?? null,
    ground_sigma_mS_m:         b.ground_sigma_mS_m,
    ground_sigma_quality:      b.ground_sigma_quality,
    ground_sigma_source:       b.ground_sigma_source,
    ground_sigma_filing_grade: b.ground_sigma_filing_grade,
    nif_status:             b.nif_status,
    treaty_zone:            b.treaty_zone,
    status_labels:          b.status_labels,
    score_breakdown:        b.explanation?.score_breakdown ?? null,
    regulatory_compliance_summary: b.regulatory_compliance_summary ?? null,
    power_class_ceiling_kw: b.power_class_ceiling_kw ?? null,
    mpe_evaluation_required: b.mpe_evaluation_required ?? null
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

// FCC AM channel classification (§73.25 clear, §73.27 local, §73.26 regional).
function frequencyChannelClass(frequency_khz){
  if (LOCAL_CHANNEL_KHZ.has(frequency_khz)) return 'local';
  if (CLEAR_CHANNEL_KHZ.has(frequency_khz)) return 'clear_channel';
  return 'regional';
}

// Ground radial system sizing — §73.190 FCC ground system engineering reference.
// Returns a structured object with recommended radial count, length, copper estimate,
// and certification method.  Based on the FCC AM Antenna Systems engineering guide and
// standard 120-radial buried-copper system practice.
//
// Key references:
//   - 47 CFR §73.190: Ground conductivity measurement method
//   - FCC Form 302-AM: Ground system certification
//   - Terman (1943) / Belrose (1975) radial length / count tradeoff empirical data
//   - NBS Tech. Note 300 (Wait & Spies, 1969): effect of radial count on ERP
function buildGroundRadialAdvisory(sigma_msm, frequency_khz){
  if (sigma_msm == null || !Number.isFinite(sigma_msm)) return null;

  // Quarter-wave radial length for this frequency.
  const lambda_m   = frequency_khz ? round2(300000 / frequency_khz) : null;
  const qw_radial_m = lambda_m ? round2(lambda_m / 4) : null;

  // Standard system: 120 radials at λ/4 length buried ≥5 cm.
  // Extended system: 120–180 radials at λ/4–λ/2, + deep-driven rods, for poor σ.
  // Copper weight: 120 × radial_length × AWG #10 wire (4.66 g/m) for rough cost estimate.
  // AWG #10 is commonly used; #8 is preferred for high-power installations.
  const aWireGPerM = 4.66;  // AWG #10 copper, g/m
  const copperKg = (count, lenM) => round2(count * lenM * aWireGPerM / 1000);

  const stdCount   = 120;
  const extCount   = 180;
  const stdLen     = qw_radial_m;                           // λ/4 = standard
  const extLen     = qw_radial_m ? round2(qw_radial_m * 1.5) : null; // λ×3/8 for poor σ

  const stdCopperKg = stdLen ? copperKg(stdCount, stdLen) : null;
  const extCopperKg = extLen ? copperKg(extCount, extLen) : null;

  const certMethod = '§73.190(c) Appendix A conductivity measurement (4-electrode Wenner array) — results must be filed on FCC Form 302-AM exhibit';

  if (sigma_msm >= 4){
    return {
      advisory_level: 'STANDARD',
      sigma_quality: sigmaQuality(sigma_msm),
      recommended_radial_count: stdCount,
      recommended_radial_length_m: stdLen,
      radial_length_description: 'λ/4 (quarter-wave) — optimal for σ ≥ 4 mS/m',
      extended_system_required: false,
      deep_driven_rods_required: false,
      estimated_copper_kg: stdCopperKg,
      certification_method: certMethod,
      note: `Standard 120-radial system at λ/4 (${stdLen ?? '?'} m) adequate for σ=${sigma_msm} mS/m. §73.190 survey still required for Form 302-AM certification.`
    };
  }
  if (sigma_msm >= 2){
    return {
      advisory_level: 'ADVISORY',
      sigma_quality: sigmaQuality(sigma_msm),
      recommended_radial_count: stdCount,
      recommended_radial_length_m: stdLen,
      radial_length_description: 'λ/4 (quarter-wave) — minimum adequate for σ ≥ 2 mS/m',
      extended_system_required: false,
      deep_driven_rods_required: false,
      estimated_copper_kg: stdCopperKg,
      certification_method: certMethod,
      note: `FAIR conductivity (σ=${sigma_msm} mS/m): 120-radial system at λ/4 (${stdLen ?? '?'} m) should be adequate; verify soil resistivity before site commitment. Extended system may be cost-effective if survey confirms σ < 3 mS/m.`
    };
  }
  return {
    advisory_level: 'REQUIRED',
    sigma_quality: sigmaQuality(sigma_msm),
    recommended_radial_count: extCount,
    recommended_radial_length_m: extLen,
    radial_length_description: '3λ/8 (1.5× quarter-wave) — extended for poor σ',
    extended_system_required: true,
    deep_driven_rods_required: true,
    estimated_copper_kg: extCopperKg,
    estimated_standard_copper_kg: stdCopperKg,
    certification_method: certMethod,
    note: `POOR conductivity (σ=${sigma_msm} mS/m): §73.190 extended ground system required. Recommend ${extCount} radials at 3λ/8 (${extLen ?? '?'} m) + deep-driven copper rods (≥3 m at 3 m centers). Estimated copper: ${extCopperKg ?? '?'} kg. Soil survey urgently needed before site commitment.`
  };
}

// Minimum spacing reference — §73.37 Table of Minimum Separations for AM stations.
// Returns co-channel and adjacent-channel minimum mileage rows for the proposed station's
// class vs. each existing station class. Values from 47 CFR §73.37(a) (daytime, km).
// Adjacent-channel separations are from §73.37(b) Table B1.
// NOTE: These are the FCC-specified distances for initial screening; actual required separation
// depends on the exact power, height, and pattern of BOTH stations — file-grade separation
// studies must use the FCC LMS database and the applicable §73.182 D/U methodology.
function buildMinimumSpacingReference({ fcc_class, channel_class }){
  // §73.37(a) co-channel minimum distances (km), daytime.
  // Rows = proposed station class; columns = existing station class A/B/C/D.
  // Values extracted from Table 1 of §73.37.
  const CO_CHANNEL_KM = {
    A: { A: 1037, B: 1037, C:  805, D: 1037 },
    B: { A: 1037, B:  953, C:  724, D:  953 },
    C: { A:  805, B:  724, C:  354, D:  724 },
    D: { A: 1037, B:  953, C:  724, D:  953 }
  };
  // §73.37(b) Table B1 — first adjacent channel (±10 kHz) minimum distances (km), daytime.
  const ADJ10_KM = {
    A: { A: 805, B: 805, C: 402, D: 805 },
    B: { A: 805, B: 724, C: 402, D: 724 },
    C: { A: 402, B: 402, C: 177, D: 402 },
    D: { A: 805, B: 724, C: 402, D: 724 }
  };
  // §73.37(b) Table B2 — second adjacent channel (±20 kHz) minimum distances (km), daytime.
  const ADJ20_KM = {
    A: { A: 402, B: 402, C: 177, D: 402 },
    B: { A: 402, B: 354, C: 177, D: 354 },
    C: { A: 177, B: 177, C:  96, D: 177 },
    D: { A: 402, B: 354, C: 177, D: 354 }
  };

  const proposed = fcc_class in CO_CHANNEL_KM ? fcc_class : 'D';
  const existingClasses = ['A', 'B', 'C', 'D'];

  const co_channel = existingClasses.map(ex => ({
    existing_class: ex,
    min_separation_km: CO_CHANNEL_KM[proposed]?.[ex] ?? null,
    note: `Proposed Class ${proposed} vs. existing Class ${ex} — co-channel (0 kHz)`
  }));
  const adjacent_10khz = existingClasses.map(ex => ({
    existing_class: ex,
    min_separation_km: ADJ10_KM[proposed]?.[ex] ?? null,
    note: `Proposed Class ${proposed} vs. existing Class ${ex} — ±10 kHz adjacent channel`
  }));
  const adjacent_20khz = existingClasses.map(ex => ({
    existing_class: ex,
    min_separation_km: ADJ20_KM[proposed]?.[ex] ?? null,
    note: `Proposed Class ${proposed} vs. existing Class ${ex} — ±20 kHz second adjacent`
  }));

  return {
    rule: '47 CFR §73.37',
    proposed_class: proposed,
    channel_class,
    caveat: 'These are screening-grade minimums from the §73.37 table. Actual required separation for a specific site pair must be computed using the FCC groundwave field-intensity method (§73.182) against all stations in the LMS database.',
    co_channel,
    adjacent_10khz,
    adjacent_20khz
  };
}

// Regulatory timeline estimate — phase-by-phase timeline for a full AM relocation.
// Weeks are realistic ranges based on FCC processing times (2022-2025 data) and
// typical consulting/construction durations.  Not a legal guarantee.
function buildRegulatoryTimeline({ fcc_class, channel_class, skywave_risk_level,
  asr_required, has_treaty_candidates, any_poor_sigma, n_promising }){

  const isClear = channel_class === 'clear_channel';
  const isLocal = channel_class === 'local';
  const highNif  = isClear || skywave_risk_level === 'HIGH';

  const phases = [
    {
      id:    'SITE_SELECTION',
      label: 'Site selection & parcel diligence',
      weeks: '4–12',
      description: 'Finalize candidate shortlist, negotiate lease options, zoning pre-check, environmental screening.',
      blocking: true
    },
    {
      id:    'ENGINEERING_DESIGN',
      label: 'Engineering design',
      weeks: any_poor_sigma ? '12–24' : '8–16',
      description: `Soil resistivity surveys, antenna system design (§73.316/§73.45), ${any_poor_sigma ? 'extended ground system engineering (poor σ), ' : ''}RF exposure study (OET-65 §1.1307).`,
      blocking: true
    },
    {
      id:    'ASR_FAA',
      label: 'ASR registration + FAA aeronautical study',
      weeks: asr_required ? '6–16' : '0–2',
      description: asr_required
        ? 'File FCC Form 854; trigger FAA aeronautical study. FAA processing averages 10–14 weeks for complex sites.'
        : 'Tower height below §17.7 threshold — minimal ASR requirement.',
      blocking: asr_required
    },
    {
      id:    'NIF_STUDY',
      label: `§73.182 NIF protection study`,
      weeks: highNif ? '8–20' : isLocal ? '0–2' : '4–10',
      description: highNif
        ? `Clear-channel NIF study — complex skywave modeling required. Budget 8–20 weeks for consultant.`
        : isLocal
        ? 'Local channel — §73.182 NIF not required.'
        : `Regional channel NIF study — moderate complexity. Budget 4–10 weeks.`,
      blocking: !isLocal
    },
    {
      id:    'TREATY_COORD',
      label: 'International treaty coordination (if applicable)',
      weeks: has_treaty_candidates ? '12–52' : '0',
      description: has_treaty_candidates
        ? 'FCC International Bureau coordination required for treaty-zone candidates. Timing highly variable — plan 3–12 months.'
        : 'No treaty-zone candidates in this search; skip if final site is confirmed outside treaty zone.',
      blocking: has_treaty_candidates
    },
    {
      id:    'FCC_FILING',
      label: 'FCC Form 301-AM filing preparation',
      weeks: '4–8',
      description: 'Assemble all exhibits, certifications, engineering studies. File FCC Form 301-AM (major modification).',
      blocking: true
    },
    {
      id:    'FCC_PROCESSING',
      label: 'FCC processing — major modification',
      weeks: '12–26',
      description: `FCC Media Bureau processing for AM major modification (§73.3573). Current average processing time 3–6 months. Clear-channel or contested applications may take longer.`,
      blocking: true
    },
    {
      id:    'CONSTRUCTION',
      label: 'Tower construction',
      weeks: '16–40',
      description: 'Tower erection, ground system installation, transmitter installation, proof of performance (§73.62).',
      blocking: true
    }
  ];

  const activePhasesWeeks = phases
    .filter(p => p.blocking)
    .map(p => p.weeks.split('–').map(Number));

  const totalMin = activePhasesWeeks.reduce((a, r) => a + (r[0] || 0), 0);
  const totalMax = activePhasesWeeks.reduce((a, r) => a + (r[r.length - 1] || 0), 0);

  const totalMonthsMin = Math.round(totalMin / 4.3);
  const totalMonthsMax = Math.round(totalMax / 4.3);

  return {
    fcc_class,
    channel_class,
    asr_required,
    total_estimated_weeks_min: totalMin,
    total_estimated_weeks_max: totalMax,
    total_estimated_months_range: `${totalMonthsMin}–${totalMonthsMax} months`,
    phases,
    disclaimer: 'Timeline is a screening-grade estimate based on typical FCC processing and construction durations (2022–2025). Actual timelines depend on FCC workload, site complexity, environmental review, treaty coordination, and construction contractor availability.'
  };
}

// Protection class advisory — §73.182 skywave risk guidance based on the
// station's FCC class and channel type.  Returns { protection_class_advisory, skywave_risk_level }.
function buildProtectionAdvisory({ fcc_class, frequency_khz, channel_class, pattern_mode }){
  const isDa = /DA/i.test(pattern_mode);
  if (channel_class === 'local'){
    return {
      skywave_risk_level: 'LOW',
      protection_class_advisory:
        `Class ${fcc_class} on local channel (${frequency_khz} kHz, §73.27). ` +
        `Maximum 250 W ERP. Skywave (§73.182) nighttime interference is minimal at this power level. ` +
        `Focus engineering effort on §73.24(j) principal-community 5 mV/m daytime coverage.`
    };
  }
  if (channel_class === 'clear_channel'){
    if (fcc_class === 'A'){
      return {
        skywave_risk_level: 'HIGH',
        protection_class_advisory:
          `Class A dominant station on clear channel ${frequency_khz} kHz (§73.25). ` +
          `A full §73.182 nighttime skywave NIF contour study is required at the new site — ` +
          `the dominant Class A must demonstrate its exclusive 0.5 mV/m nighttime skywave coverage ` +
          `is maintained within its protected territory.  ` +
          (isDa ? `DA-${pattern_mode.slice(-1)}: nighttime pattern must also be designed per §73.150. ` : '') +
          `Anticipate 750–2500 mile co-channel protection contours.`
      };
    }
    return {
      skywave_risk_level: 'HIGH',
      protection_class_advisory:
        `Class ${fcc_class} secondary station on clear channel ${frequency_khz} kHz (§73.25). ` +
        `The dominant Class A retains protected skywave status; your new site must NOT increase ` +
        `nighttime interference into the dominant's protected 0.5 mV/m or 25 µV/m contours (§73.182). ` +
        `A §73.182 NIF study demonstrating no new interference at the candidate site is required for filing. ` +
        (isDa ? `DA pattern (§73.150) required at filing. ` : '')
    };
  }
  // Regional channel.
  return {
    skywave_risk_level: 'MODERATE',
    protection_class_advisory:
      `Class ${fcc_class} on regional channel ${frequency_khz} kHz (§73.26). ` +
      `Standard §73.182 nighttime interference screening required to show no increase in ` +
      `inter-station interference.  ` +
      (isDa ? `DA pattern (§73.150) required at filing. ` : '') +
      `Candidate sites close to the US/MX or US/CA border may also require treaty consultation.`
  };
}

// Protection requirements summary — §73.182 co-channel / adjacent-channel rules.
// Returns a structured object describing what protection the station receives
// and what it must demonstrate before filing.
function buildProtectionRequirements({ fcc_class, frequency_khz, channel_class }){
  const isLocal = channel_class === 'local';
  const isClear = channel_class === 'clear_channel';
  const isRegional = channel_class === 'regional';
  const isClassA = fcc_class === 'A';

  // Co-channel protection the station receives from others.
  let receives_co_channel;
  if (isLocal){
    receives_co_channel = {
      type: 'MINIMAL',
      description: 'Local channel (§73.27) — no exclusive skywave protection; field-intensity protection only.',
      protected_contour_mvm: null,
      rule: '47 CFR §73.27'
    };
  } else if (isClear && isClassA){
    receives_co_channel = {
      type: 'DOMINANT_EXCLUSIVE',
      description: 'Class A dominant on clear channel — exclusive 0.5 mV/m skywave contour is protected from all other stations.',
      protected_contour_mvm: 0.5,
      rule: '47 CFR §73.25 / §73.182'
    };
  } else if (isClear){
    receives_co_channel = {
      type: 'SECONDARY',
      description: `Class ${fcc_class} secondary on clear channel — must not interfere with dominant Class A; 0.5 mV/m and 25 µV/m Class A contours are absolute constraints.`,
      protected_contour_mvm: null,
      rule: '47 CFR §73.25 / §73.182'
    };
  } else {
    receives_co_channel = {
      type: 'REGIONAL_SHARING',
      description: `Class ${fcc_class} regional station — standard §73.182 D/U ratio protection from co-channel stations; sharing with other same-class stations common.`,
      protected_contour_mvm: null,
      rule: '47 CFR §73.26 / §73.182'
    };
  }

  // Interference the station must not cause.
  const must_protect = [];
  if (isClear && !isClassA){
    must_protect.push({
      constraint: 'Must not increase interference to dominant Class A 0.5 mV/m skywave contour',
      threshold: '0 additional interference persons (NIF standard)',
      rule: '47 CFR §73.182(k)'
    });
    must_protect.push({
      constraint: 'Must not increase interference to Class A 25 µV/m skywave contour',
      threshold: 'No new interference at this contour',
      rule: '47 CFR §73.182(k)'
    });
  }
  must_protect.push({
    constraint: 'Must maintain §73.37 minimum distance separations from co-channel and adjacent-channel stations',
    threshold: isLocal ? 'Local channel: refer to §73.37 Table B-2' : isClear ? '§73.25 clear-channel separations' : '§73.37 Table B-1 regional separations',
    rule: '47 CFR §73.37'
  });
  if (!isLocal){
    must_protect.push({
      constraint: 'Demonstrate no objectionable interference to other stations via §73.182 field-intensity method',
      threshold: 'D/U ratio per §73.182 Table 1 at receiving station 0.5 mV/m (skywave) or 5 mV/m (groundwave) contour',
      rule: '47 CFR §73.182'
    });
  }

  // NIF study requirement.
  const nif_study_required = !isLocal;
  const nif_study_notes = isLocal
    ? 'Local channel stations do not typically require a §73.182 NIF study.'
    : isClear && isClassA
    ? 'Full §73.182 NIF contour study required at new site to demonstrate dominant 0.5 mV/m skywave coverage is maintained.'
    : isClear
    ? 'Full §73.182 NIF study required — new site must not increase nighttime interference to Class A dominant station contours.'
    : 'Standard §73.182 nighttime interference screening required; NIF study format recommended.';

  // Adjacent-channel protection ratios (§73.182 Table 1 typical values).
  const adjacent_channel_advisory = {
    minus_10khz: { protection_db: 6, note: '1st adjacent lower: 6 dB D/U (§73.182 Table 1)' },
    plus_10khz:  { protection_db: 6, note: '1st adjacent upper: 6 dB D/U' },
    minus_20khz: { protection_db: 14, note: '2nd adjacent lower: 14 dB D/U' },
    plus_20khz:  { protection_db: 14, note: '2nd adjacent upper: 14 dB D/U' },
    note: 'D/U ratios are at the undesired station\'s 0.5 mV/m skywave or 5 mV/m groundwave contour (§73.182 Table 1). Exact values depend on class and time of operation.'
  };

  return {
    station_class: fcc_class,
    channel_class,
    frequency_khz,
    receives_co_channel_protection: receives_co_channel,
    must_protect_against_interference: must_protect,
    nif_study_required,
    nif_study_notes,
    adjacent_channel_advisory
  };
}

// Engine-synthesized recommended-actions list.
// Returns an ordered array of { priority, action, rationale } objects.
// Priority: 'URGENT', 'HIGH', 'MEDIUM', 'INFORMATIONAL'.
function buildRecommendedActions({
  baseline, returned, scored, candidate_count_by_status,
  fcc_class, pattern_mode, chanClass, skywave_risk_level, warnings,
  community_of_license_polygon
}){
  const actions = [];

  // 1. URGENT: current site is already non-compliant.
  if (baseline && baseline.status_category === 'NON_COMPLIANT'){
    actions.push({
      priority: 'URGENT',
      action: 'File an STA or Minor Modification for the current site immediately.',
      rationale: `The current site baseline scores ${baseline.score?.toFixed(1) ?? '?'} and is flagged NON_COMPLIANT on the screening rubric (§73.24(j) coverage or §73.24(g) blanket pop). Do not wait for relocation — address the existing non-compliance first.`
    });
  }

  // 2. URGENT: no promising sites found in the grid.
  const nPromising = candidate_count_by_status?.PROMISING ?? 0;
  const nTotal = scored?.length ?? 0;
  if (nTotal > 0 && nPromising === 0){
    actions.push({
      priority: 'URGENT',
      action: 'Expand search radius or reduce TPO — no PROMISING sites in current grid.',
      rationale: `${nTotal} sites evaluated; none reached the PROMISING threshold. Try a larger search radius, lower power, or relax optimization goals to surface more candidate options.`
    });
  }

  // 3. HIGH: advance the top PROMISING candidate.
  const top = returned?.[0];
  if (top && top.status_category === 'PROMISING'){
    const topDist = top.distance_from_current_km ?? 0;
    const distStr = topDist < 0.5
      ? 'at current location'
      : `${topDist.toFixed(0)} km ${top.cardinal_direction ? top.cardinal_direction : ''} of current site`;
    actions.push({
      priority: 'HIGH',
      action: `Advance Rank 1 candidate (score ${top.score != null ? top.score.toFixed(1) : '?'}, ${distStr}) to full §73.182 NIF study and parcel investigation.`,
      rationale: `This is the top-scoring site with no hard rule failures on the screening rubric. A full engineer-grade analysis (§73.182 nighttime NIF, ground radial system design, parcel/zoning check) is the recommended next step.`
    });
  }

  // 4. HIGH: DA pattern required on any promising candidate.
  const daNeeded = returned?.some(c => c.status_category === 'RECOVERABLE_WITH_DA' && c.rank <= 5);
  if (daNeeded || /DA/i.test(pattern_mode)){
    actions.push({
      priority: 'HIGH',
      action: 'Commission a §73.150 directional antenna pattern study.',
      rationale: /DA/i.test(pattern_mode)
        ? `pattern_mode=${pattern_mode} was requested — a §73.150 DA pattern design and §73.182 nighttime NIF study are mandatory before filing.`
        : `One or more top-5 candidates are classified RECOVERABLE_WITH_DA — a DA pattern pushing the 5 mV/m contour toward the community of license could bring these into compliance.`
    });
  }

  // 5. HIGH: power reduction needed on RECOVERABLE_WITH_REDUCED_POWER candidates.
  const pwrNeeded = returned?.some(c => c.status_category === 'RECOVERABLE_WITH_REDUCED_POWER' && c.rank <= 5);
  if (pwrNeeded){
    const topPwr = returned.find(c => c.status_category === 'RECOVERABLE_WITH_REDUCED_POWER');
    actions.push({
      priority: 'HIGH',
      action: `Evaluate TPO reduction for blanket-pop-failing candidates${topPwr?.minimum_tpo_for_compliance_kw ? ` (Rank ${topPwr.rank}: reduce to ≤${topPwr.minimum_tpo_for_compliance_kw} kW)` : ''}.`,
      rationale: `One or more top-5 candidates exceed the §73.24(g) 1% blanket population limit. Reducing TPO shrinks the 1000 mV/m contour; the engine has pre-computed the maximum compliant power where available.`
    });
  }

  // 6. HIGH: direct TPO increase available for RECOVERABLE_WITH_POWER_INCREASE candidates.
  const pwrIncrCandidates = returned?.filter(c =>
    c.status_category === 'RECOVERABLE_WITH_POWER_INCREASE' && c.rank <= 5
  ) ?? [];
  if (pwrIncrCandidates.length > 0){
    const topPwrIncr = pwrIncrCandidates[0];
    actions.push({
      priority: 'HIGH',
      action: `Increase TPO to resolve §73.24(j) COL coverage on ${pwrIncrCandidates.length} candidate(s)${topPwrIncr ? ` (Rank ${topPwrIncr.rank}: increase to ≥${topPwrIncr.minimum_tpo_for_col_coverage_kw} kW)` : ''}.`,
      rationale: `The engine found a feasible power level (≤50 kW) at which the §73.24(j) 5 mV/m groundwave contour reaches the community-of-license centroid. This is the most direct fix — no DA pattern study required. Verify the increased TPO is within the licensed class ceiling (§73.21) and does not create new §73.24(g) blanket-population problems before filing.`
    });
  } else {
    // Fallback: any candidate with a computed COL power fix not already in RECOVERABLE_WITH_POWER_INCREASE.
    const colPwrCandidates = returned?.filter(c =>
      c.minimum_tpo_for_col_coverage_kw != null &&
      c.status_category !== 'RECOVERABLE_WITH_POWER_INCREASE' && c.rank <= 5
    ) ?? [];
    if (colPwrCandidates.length > 0){
      const topCol = colPwrCandidates[0];
      actions.push({
        priority: 'MEDIUM',
        action: `Evaluate TPO increase for §73.24(j) COL coverage on ${colPwrCandidates.length} candidate(s)${topCol ? ` (Rank ${topCol.rank}: increase to ≥${topCol.minimum_tpo_for_col_coverage_kw} kW)` : ''}.`,
        rationale: `One or more top-5 candidates fail the §73.24(j) 5 mV/m principal-community floor at the proposed power. The engine has pre-computed the minimum TPO at which the 5 mV/m groundwave contour reaches the community-of-license centroid distance. Verify the increased power is within the licensed class ceiling (§73.21) and does not create new §73.24(g) blanket population problems.`
      });
    }
  }

  // 7. MEDIUM: treaty zone consultation needed.
  const treatyCandidates = returned?.filter(c => c.treaty_zone && c.rank <= 10) ?? [];
  if (treatyCandidates.length > 0){
    actions.push({
      priority: 'MEDIUM',
      action: `Initiate treaty consultation for ${treatyCandidates.length} candidate(s) in international border zones.`,
      rationale: `Candidate(s) rank ${treatyCandidates.map(c => c.rank).join(', ')} are inside treaty zones (US/MX 1986 agreement or US/CA letter of understanding). These require FCC International Bureau coordination before filing.`
    });
  }

  // 8. MEDIUM: COL polygon not provided — upgrade to polygon for better coverage scoring.
  if (!community_of_license_polygon){
    actions.push({
      priority: 'MEDIUM',
      action: 'Supply the community-of-license GeoJSON polygon for filing-grade COL coverage scoring.',
      rationale: `Current run uses a 10 km disc proxy for §73.24(j) coverage. Providing the actual COL boundary as a GeoJSON Polygon enables Monte-Carlo polygon overlap scoring and significantly increases confidence in the coverage sub-score.`
    });
  }

  // 9. MEDIUM: clear channel — full NIF required regardless.
  if (chanClass === 'clear_channel' || skywave_risk_level === 'HIGH'){
    actions.push({
      priority: 'MEDIUM',
      action: 'Commission §73.182 nighttime skywave NIF study before selecting any candidate site.',
      rationale: `The operating frequency is a §73.25 clear channel or the station class carries high skywave risk. A complete NIF analysis is mandatory for any change of community or transmitter site; this should precede site acquisition to avoid committing to a site that fails nighttime skywave protection.`
    });
  }

  // 10. INFORMATIONAL: ASR pre-application.
  const asrNeeded = scored?.some(c => c.status_category === 'PROMISING');
  if (asrNeeded){
    actions.push({
      priority: 'INFORMATIONAL',
      action: 'Begin 47 CFR §17.7 ASR pre-application process for promising candidate sites.',
      rationale: `AM towers at the typical λ/4 height commonly exceed the 200-ft (60.96 m) §17.7 threshold requiring FAA notification and ASR registration. Starting the FAA/FCC coordination early avoids delays in the tower permit timeline.`
    });
  }

  // 11. INFORMATIONAL: ground radial system design needed for low-σ candidates.
  const poorSigma = returned?.some(c => c.ground_sigma_quality === 'POOR' || c.ground_sigma_quality === 'FAIR');
  if (poorSigma){
    actions.push({
      priority: 'INFORMATIONAL',
      action: 'Commission soil resistivity survey at POOR/FAIR conductivity candidate sites.',
      rationale: `One or more top candidates have FAIR or POOR ground conductivity (σ < 4 mS/m). The §73.190 ground radial system requirements and achievable antenna efficiency are highly sensitive to soil resistivity at these levels. A resistivity survey before site commitment can avoid costly ground system overruns.`
    });
  }

  return actions;
}

function buildNotes({ coverage_pct, sigma_msm, blanket_population_pct, distance_from_current_km }){
  const parts = [];
  if (coverage_pct != null) parts.push(`${(coverage_pct * 100).toFixed(0)}% city-coverage`);
  if (sigma_msm   != null) parts.push(`σ=${sigma_msm} mS/m`);
  if (blanket_population_pct != null) parts.push(`${blanket_population_pct.toFixed(1)}% blanket pop`);
  parts.push(`${distance_from_current_km.toFixed(0)} km from current`);
  return parts.join(', ') + '.';
}

// FCC Form 301-AM pre-filing checklist.
// Returns an array of { id, description, status, rule, note } items.
// status: 'REQUIRED' | 'CONDITIONAL' | 'ADVISORY'
function buildForm301Checklist({ fcc_class, tpo_kw, pattern_mode, frequency_khz,
  channel_class, skywave_risk_level, asr_registration_required,
  community_of_license_polygon, col_centroid,
  has_treaty_candidates = false, any_poor_conductivity = false,
  any_zone_table_sigma = false }){
  const items = [];
  const isDa = /DA/i.test(pattern_mode);

  items.push({
    id: 'SITE_SURVEY',
    description: 'Conduct professional site survey (zoning, lease availability, setbacks)',
    status: 'REQUIRED',
    rule: 'General engineering practice; FCC Form 301 §I',
    note: null
  });

  items.push({
    id: 'ANTENNA_STUDY',
    description: `Design and model AM vertical antenna system for ${frequency_khz} kHz`,
    status: 'REQUIRED',
    rule: '47 CFR §73.316 / §73.45',
    note: isDa
      ? 'DA pattern specified — §73.316 directional antenna measurements required (24 radials, theoretical and measured patterns)'
      : 'Non-directional antenna — standard §73.45 field intensity / efficiency certification required'
  });

  const asrNote = asr_registration_required
    ? 'ASR REGISTRATION REQUIRED: typical antenna height at this frequency exceeds the 200-ft (60.96 m) §17.7 threshold'
    : 'Verify final antenna height; register with FCC ASR if height > 200 ft (60.96 m) AGL per §17.7';
  items.push({
    id: 'ASR_REGISTRATION',
    description: 'Verify tower height; file FCC ASR registration if > 200 ft (60.96 m)',
    status: asr_registration_required ? 'REQUIRED' : 'CONDITIONAL',
    rule: '47 CFR §17.7',
    note: asrNote
  });

  items.push({
    id: 'RF_EXPOSURE_MPE',
    description: 'Prepare RF exposure (MPE) evaluation per OET Bulletin 65',
    status: 'REQUIRED',
    rule: '47 CFR §1.1307 / OET Bulletin 65',
    note: `AM broadcast stations must demonstrate compliance with general population MPE limits. ERP = ${tpo_kw} kW.`
  });

  items.push({
    id: 'COL_COVERAGE',
    description: 'Document ≥ 80% community-of-license coverage by the 5 mV/m daytime contour',
    status: 'REQUIRED',
    rule: '47 CFR §73.24(j)',
    note: community_of_license_polygon
      ? 'COL polygon provided — coverage computation is polygon-based (filing-grade)'
      : 'No COL polygon provided — coverage proxy used; polygon-based analysis required for filing'
  });

  items.push({
    id: 'COL_CENTROID_FIELD',
    description: 'Verify predicted field strength at COL centroid meets 5 mV/m floor',
    status: 'REQUIRED',
    rule: '47 CFR §73.24(j)',
    note: col_centroid
      ? `COL centroid provided (${col_centroid.lat.toFixed(4)}, ${col_centroid.lon.toFixed(4)})`
      : 'Use geographic center of COL boundary if centroid not separately specified'
  });

  items.push({
    id: 'BLANKET_POPULATION',
    description: 'Demonstrate blanket-area population does not exceed 1% of total service population',
    status: 'REQUIRED',
    rule: '47 CFR §73.24(g)',
    note: `Station TPO = ${tpo_kw} kW; engineer must compute 1000 mV/m contour area and census population.`
  });

  items.push({
    id: 'PROTECTION_STUDIES',
    description: 'Submit co-channel and adjacent-channel interference protection studies',
    status: 'REQUIRED',
    rule: '47 CFR §73.182 / §73.37',
    note: null
  });

  if (channel_class === 'clear_channel' || skywave_risk_level === 'HIGH'){
    items.push({
      id: 'SKYWAVE_NIF',
      description: 'Prepare skywave interference analysis (NIF study) for nighttime operations',
      status: 'REQUIRED',
      rule: '47 CFR §73.182',
      note: channel_class === 'clear_channel'
        ? `Clear channel (${frequency_khz} kHz) — full §73.182 NIF study required before nighttime authorization`
        : `Class ${fcc_class} on regional/local channel — HIGH skywave risk; NIF study strongly advised`
    });
  } else if (skywave_risk_level === 'MODERATE'){
    items.push({
      id: 'SKYWAVE_NIF',
      description: 'Evaluate skywave interference potential (NIF study may be required)',
      status: 'CONDITIONAL',
      rule: '47 CFR §73.182',
      note: `MODERATE skywave risk for Class ${fcc_class} on ${channel_class} channel — consult §73.182 protection ratios`
    });
  }

  if (isDa){
    items.push({
      id: 'DA_PATTERN',
      description: 'File theoretical and measured horizontal radiation pattern per §73.316',
      status: 'REQUIRED',
      rule: '47 CFR §73.316',
      note: 'DA pattern: 25 spaced radials at 15° increments required for measured patterns; suppression ratios must satisfy §73.207/§73.215 D/U spacing'
    });
  }

  items.push({
    id: 'NEPA_ENVIRONMENTAL',
    description: 'Complete NEPA environmental checklist (§1.1306); file EA if any triggers apply',
    status: 'REQUIRED',
    rule: '47 CFR §1.1306 / §1.1307',
    note: 'Check for protected species, historic properties (NHPA §106), floodplains, wetlands, wilderness areas'
  });

  items.push({
    id: 'FAA_AERONAUTICAL',
    description: 'File FAA Form 7460-1 (aeronautical study) for any structure > 200 ft or near airports',
    status: 'CONDITIONAL',
    rule: '47 CFR §17.7; 14 CFR Part 77',
    note: 'Required if tower height > 200 ft AGL or if within obstacle free zone of an airport'
  });

  // HAAT calculation — required for all AM tower site submissions.
  // Height Above Average Terrain must be computed over 50 radials at 3.2 km intervals
  // per §73.684 procedure even though §73.684 is primarily FM; AM engineers use the
  // same metric for comparative analysis and NIF study inputs.
  items.push({
    id: 'HAAT_CALCULATION',
    description: 'Compute Height Above Average Terrain (HAAT) over 50 radials at 3.2 km intervals',
    status: 'REQUIRED',
    rule: '47 CFR §73.684 procedure (AM engineering practice)',
    note: 'HAAT is required as input to NIF study and §73.182 interference calculations; compute using USGS DEM data over 50 radials (360° / 7.2° spacing) at 3.2 km to 16 km from the proposed site.'
  });

  // License modification / construction permit notice.
  items.push({
    id: 'CP_OR_LICENSE_MOD',
    description: 'File FCC Form 301-AM for construction permit (or Form 302-AM for license); existing CP may require modification if previously filed',
    status: 'REQUIRED',
    rule: '47 CFR §73.1690 / FCC Form 301-AM',
    note: `Class ${fcc_class} AM station relocation requires a new or modified construction permit (CP). If a prior CP exists for the current site, file a CP modification. License is filed on Form 302-AM after construction and proof-of-performance.`
  });

  // International treaty coordination — surface only when at least one candidate
  // is near a treaty zone border so the operator plans for IB coordination early.
  if (has_treaty_candidates){
    items.push({
      id: 'INTERNATIONAL_TREATY_COORDINATION',
      description: 'Initiate FCC International Bureau coordination for US/MX or US/CA treaty compliance',
      status: 'REQUIRED',
      rule: 'US/Mexico AM Agreement (1986); US/Canada Letter of Understanding (1991); 47 CFR §73.1205',
      note: 'One or more candidate sites fall within treaty coordination zones. FCC IB approval is required before filing; the process adds 3–12 months. Power limits, antenna pattern restrictions, and frequency assignments may be modified as a result.'
    });
  }

  // Conductivity field study — surface when screening data reveals poor conductivity
  // in the candidate pool; the engineer should budget for a Wenner array survey.
  if (any_poor_conductivity || any_zone_table_sigma){
    items.push({
      id: 'CONDUCTIVITY_FIELD_SURVEY',
      description: 'Commission 4-electrode Wenner array soil conductivity survey at finalist sites',
      status: any_poor_conductivity ? 'REQUIRED' : 'CONDITIONAL',
      rule: '47 CFR §73.190 / FCC Form 302-AM ground system certification',
      note: any_poor_conductivity
        ? 'One or more candidates have POOR conductivity (σ < 2 mS/m). FCC Form 302-AM requires measured soil resistivity (ρ, Ω·m) for ground system certification. Survey is mandatory before construction permit submission.'
        : 'Candidate screening used M3 zone-table conductivity estimates. For any finalist site, a Wenner array survey (or equivalent) should be conducted to confirm σ before committing to a ground system design.'
    });
  }

  return items;
}

function cardinalDir(deg){
  if (deg == null || !Number.isFinite(deg)) return null;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function buildRationale({ coverage_pct, daytime_reach_km, blanket_population_pct,
                          principal_community_5mvm_km, field_at_col_centroid_mvm,
                          minimum_tpo_for_col_coverage_kw, minimum_tpo_for_compliance_kw,
                          sigma_msm, distance_from_current_km, bearing_deg,
                          treaty_zone, flags, score, score_breakdown }){
  if (flags.length){
    // More specific NON_COMPLIANT message: distinguish which hard limit failed.
    const colFail = flags.some(f => /COL/i.test(f));
    const blanketFail = flags.some(f => /Blanket/i.test(f));
    const failDesc = [];
    if (colFail && field_at_col_centroid_mvm != null){
      const colNote = minimum_tpo_for_col_coverage_kw != null
        ? ` (increase TPO to ≥${minimum_tpo_for_col_coverage_kw} kW to fix)`
        : ' (even at 50 kW, COL coverage cannot be achieved from this location)';
      failDesc.push(`§73.24(j): field at COL centroid ${field_at_col_centroid_mvm.toFixed(2)} mV/m is below the 5 mV/m floor${colNote}`);
    } else if (colFail && principal_community_5mvm_km != null)
      failDesc.push(`§73.24(j): 5 mV/m radius ${principal_community_5mvm_km.toFixed(1)} km does not cover the COL`);
    else if (colFail) failDesc.push(`§73.24(j): COL coverage below 80% floor`);
    if (blanketFail){
      const blankNote = minimum_tpo_for_compliance_kw != null
        ? ` (reduce to ≤${minimum_tpo_for_compliance_kw} kW to fix)`
        : '';
      failDesc.push(`§73.24(g): blanket pop >1%${blankNote}`);
    }
    if (!failDesc.length) failDesc.push(...flags);
    return `Non-compliant on screening: ${failDesc.join('; ')}.  Engineer-grade analysis required before filing.`;
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
  if (field_at_col_centroid_mvm != null && distance_from_current_km >= 0.5){
    if (field_at_col_centroid_mvm >= 5){
      bits.push(`COL field ${field_at_col_centroid_mvm.toFixed(1)} mV/m (≥§73.24(j) floor)`);
    } else if (field_at_col_centroid_mvm >= 0.5){
      bits.push(`COL field ${field_at_col_centroid_mvm.toFixed(2)} mV/m (below 5 mV/m §73.24(j) — coverage risk)`);
    } else {
      bits.push(`COL field ${field_at_col_centroid_mvm.toFixed(3)} mV/m (far below secondary service threshold)`);
    }
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

function buildTopSummary(top, baseline, nEvaluated){
  if (!top || top.length === 0) return null;
  const r1 = top[0];
  const parts = [];

  // Lead: top candidate score + distance/bearing.
  const card1 = cardinalDir(r1.bearing_deg);
  const distStr = r1.distance_from_current_km < 0.5
    ? 'at current location'
    : `${r1.distance_from_current_km.toFixed(0)} km ${card1 ? `${card1} of` : 'from'} current site`;
  parts.push(`Rank 1 scores ${r1.score.toFixed(1)} (${r1.status_category || 'REVIEW_REQUIRED'}), ${distStr}, σ=${r1.ground_sigma_mS_m} mS/m (${r1.ground_sigma_quality || '—'})`);

  // COL field at rank 1 if available.
  if (r1.field_at_col_centroid_mvm != null){
    const fStr = r1.field_at_col_centroid_mvm >= 5
      ? `COL field ${r1.field_at_col_centroid_mvm.toFixed(1)} mV/m (≥§73.24(j) 5 mV/m floor)`
      : r1.field_at_col_centroid_mvm >= 0.5
        ? `COL field ${r1.field_at_col_centroid_mvm.toFixed(2)} mV/m (below 5 mV/m §73.24(j) floor${r1.minimum_tpo_for_col_coverage_kw != null ? `; increase TPO to ≥${r1.minimum_tpo_for_col_coverage_kw} kW to fix` : ''})`
        : `COL field ${r1.field_at_col_centroid_mvm.toFixed(3)} mV/m (far below secondary service${r1.minimum_tpo_for_col_coverage_kw != null ? `; ≥${r1.minimum_tpo_for_col_coverage_kw} kW needed` : ''})`;
    parts.push(fStr);
  }

  // Improvement vs baseline.
  if (baseline){
    const dScore = r1.score - (baseline.score || 0);
    const dReach = r1.daytime_reach_km != null && baseline.daytime_reach_km != null
      ? r1.daytime_reach_km - baseline.daytime_reach_km : null;
    const sign = s => s >= 0 ? `+${s.toFixed(1)}` : s.toFixed(1);
    const deltas = [];
    if (Math.abs(dScore) > 0.1) deltas.push(`score ${sign(dScore)}`);
    if (dReach != null && Math.abs(dReach) > 0.5) deltas.push(`reach ${sign(dReach)} km`);
    if (deltas.length) parts.push(`vs current site: ${deltas.join(', ')}`);
  }

  // Estimated population at rank 1.
  if (r1.estimated_daytime_population_served != null && r1.estimated_daytime_population_served > 0){
    const pop = r1.estimated_daytime_population_served;
    const popStr = pop >= 1e6 ? `${(pop / 1e6).toFixed(1)}M` : pop >= 1e3 ? `${Math.round(pop / 1e3)}K` : String(Math.round(pop));
    parts.push(`est. ${popStr} served @0.5 mV/m`);
  }

  // Conductivity summary across top N.
  const qualityCount = {};
  for (const c of top){ qualityCount[c.ground_sigma_quality || 'UNKNOWN'] = (qualityCount[c.ground_sigma_quality || 'UNKNOWN'] || 0) + 1; }
  const qSummary = Object.entries(qualityCount).map(([q, n]) => `${n}×${q}`).join(', ');
  parts.push(`top ${top.length} σ quality: ${qSummary}`);

  // Status breakdown.
  const statusCount = {};
  for (const c of top){ statusCount[c.status_category || 'UNKNOWN'] = (statusCount[c.status_category || 'UNKNOWN'] || 0) + 1; }
  const sBits = Object.entries(statusCount).map(([s, n]) => `${n} ${s}`).join(', ');
  parts.push(`statuses: ${sBits} (out of ${nEvaluated} evaluated)`);

  // Score confidence note: flag when all top candidates are LOW confidence.
  const confCounts = {};
  for (const c of top) confCounts[c.score_confidence || 'LOW'] = (confCounts[c.score_confidence || 'LOW'] || 0) + 1;
  if (confCounts.LOW === top.length){
    parts.push(`all top-${top.length} ranked at LOW confidence (zone-table σ + disc-proxy COL) — provide filing-grade inputs for more reliable ranking`);
  } else if (r1.score_confidence === 'LOW'){
    parts.push(`Rank 1 scored at LOW confidence — upgrade to raster σ and COL polygon for a more reliable #1 site selection`);
  }

  return parts.join('. ') + '.';
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
// box × 2048 samples — deterministic via a seeded RNG so results are
// stable across calls.  2048 gives ≈ ±2% Monte-Carlo error at screening
// quality, which is acceptable for §73.24(j) pre-screening.
function polygonCoverageFraction({ polygon, circle_center, circle_radius_km, n_samples = 2048 }){
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

// ---------- public helpers ----------

// buildFilingComplexityScore — extracted so colocationOpportunities can reuse it.
// Accepts the same shape of data that the GRID path uses internally:
//   { chanClass, fcc_class, frequency_khz, returned, ASR_THRESHOLD_M }
// where `returned` is the already-scored candidate array.
export function buildFilingComplexityScore({ chanClass, fcc_class, frequency_khz, returned, asr_threshold_m }){
  const ASR_THRESH = asr_threshold_m ?? 60.96;
  let score = 0;
  const factors = [];

  const isClearCh = chanClass === 'clear_channel';
  const isLocalCh = chanClass === 'local';
  if (isClearCh) {
    score += 40;
    factors.push({ factor: 'CLEAR_CHANNEL', points: 40, note: `${frequency_khz} kHz is a §73.25 clear channel — §73.182 full azimuthal skywave NIF required; FCC IB scrutiny is highest on clear channels.` });
  } else if (isLocalCh) {
    score += 5;
    factors.push({ factor: 'LOCAL_CHANNEL', points: 5, note: `${frequency_khz} kHz local channel — no §73.182 NIF required; simplified filing pathway.` });
  } else {
    score += 20;
    factors.push({ factor: 'REGIONAL_CHANNEL', points: 20, note: `${frequency_khz} kHz regional channel — §73.182 NIF required; complexity scales with co-channel station density.` });
  }
  if (fcc_class === 'A') {
    score += 10;
    factors.push({ factor: 'CLASS_A', points: 10, note: 'Class A authorization — highest-tier filing; any coverage/power change requires full NIF re-study.' });
  } else if (fcc_class === 'D') {
    score += 5;
    factors.push({ factor: 'CLASS_D_SECONDARY', points: 5, note: 'Class D secondary — daytime authorization may be straightforward but nighttime is discretionary.' });
  }
  if (returned.some(c => !!c.treaty_zone)) {
    score += 25;
    factors.push({ factor: 'TREATY_ZONE_CANDIDATES', points: 25, note: 'One or more top candidates are within a US/MX or US/CA treaty zone — FCC IB international coordination required, adding 12–52 weeks.' });
  }
  const qwM_fcs = (300000 / frequency_khz) / 4;
  if (qwM_fcs > ASR_THRESH) {
    score += 10;
    factors.push({ factor: 'ASR_REQUIRED', points: 10, note: `λ/4 ≈ ${Math.round(qwM_fcs)} m > §17.7 ${ASR_THRESH} m threshold — FAA 7460-1 aeronautical study + FCC Form 854 required for any standard tower.` });
  }
  const anyFullDA = returned.some(c => c.directional_antenna_study_guide?.study_type === 'FULL_DA_STUDY_DAY_NIGHT');
  const anyDaRec  = returned.some(c => c.directional_antenna_study_guide?.recommended === true);
  if (anyFullDA) {
    score += 15;
    factors.push({ factor: 'FULL_DA_STUDY_LIKELY', points: 15, note: 'Top candidates suggest a full day+night DA study is likely — §73.150 pattern engineering + §73.182 DA-N NIF add significant pre-filing time.' });
  } else if (anyDaRec) {
    score += 8;
    factors.push({ factor: 'DA_STUDY_LIKELY', points: 8, note: 'One or more top candidates recommend a DA study — §73.150 pattern engineering adds 8–16 weeks to the timeline.' });
  }
  const poorSigmaCount = returned.filter(c => (c.ground_sigma_mS_m ?? 4) < 2).length;
  if (poorSigmaCount > 0) {
    score += 5;
    factors.push({ factor: 'POOR_CONDUCTIVITY_CANDIDATES', points: 5, note: `${poorSigmaCount} top candidate(s) have σ<2 mS/m — soil resistivity surveys, extended ground systems, and §73.190 re-certification add complexity.` });
  }
  const nonCompliantCount = returned.filter(c => c.status_category === 'NON_COMPLIANT').length;
  if (nonCompliantCount > 0) {
    score += 5;
    factors.push({ factor: 'NON_COMPLIANT_TOP_CANDIDATES', points: 5, note: `${nonCompliantCount} top candidate(s) fail §73.24(j) COL floor — power upgrade or DA required before any of these can be filed.` });
  }
  const total = Math.min(100, Math.round(score));
  const complexity_tier = total >= 75 ? 'VERY_HIGH'
    : total >= 50 ? 'HIGH'
    : total >= 25 ? 'MODERATE'
    : 'LOW';
  const tier_interpretation = {
    VERY_HIGH: 'Expect 18–36+ months from site selection to on-air. Retain experienced FCC broadcast counsel before site selection is finalized.',
    HIGH:      'Expect 12–24 months. Commission NIF study, DA engineering (if applicable), and ASR process in parallel to avoid sequential delays.',
    MODERATE:  'Expect 9–18 months. Standard filing with NIF study; complexity is manageable with experienced engineering firm.',
    LOW:       'Expect 6–12 months. Simplified filing pathway; no international coordination or DA study required.'
  }[complexity_tier];
  return {
    total_score: total,
    complexity_tier,
    tier_interpretation,
    factors,
    note: 'Filing complexity score is a SCREENING-GRADE composite index — not a substitute for a broadcast engineering filing timeline estimate from qualified FCC counsel.'
  };
}

// ---------- public test-only export ----------
// Exposed for unit tests.  Not part of the public API contract.
export { buildTopSummary, frequencyChannelClass, buildRegulatoryTimeline };

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
  frequencyChannelClass,
  buildGroundRadialAdvisory,
  buildProtectionAdvisory,
  buildMinimumSpacingReference,
  buildRecommendedActions,
  buildForm301Checklist,
  FCC_CLASS_POWER_KW,
  LOCAL_CHANNEL_KHZ,
  CLEAR_CHANNEL_KHZ,
  KNOWN_GOALS
};
