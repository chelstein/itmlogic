// AM Co-Location Opportunity Engine — screening-grade host-site finder.
//
// PURPOSE
//   An AM operator who must relocate often has the option of moving to
//   an existing piece of vertical infrastructure (cellular tower,
//   registered antenna structure (ASR), FM/TV transmitter site, or
//   another AM plant) instead of building a brand-new tower farm.  This
//   module screens an inventory of known infrastructure sites within a
//   user-supplied radius of the current site and ranks them on the same
//   coverage / interference rubric used by the AM Site Optimizer, with
//   additional co-location-specific advisories (diplexing risk, ASR
//   notification reminders, structural-engineering caveats, etc.).
//
// SEARCH MODES
//   - GRID            : identical to the AM Site Optimizer (no infra).
//   - INFRASTRUCTURE  : only score real infrastructure sites.
//   - HYBRID (default): grid + infrastructure scored in a single pool.
//
// STATUS CATEGORIES
//   Each candidate gets a single `status_category` from a fixed
//   vocabulary so the UI can render a colored chip per result:
//     PROMISING, REVIEW_REQUIRED, RECOVERABLE_WITH_DA,
//     RECOVERABLE_WITH_POWER_INCREASE, RECOVERABLE_WITH_REDUCED_POWER,
//     RECOVERABLE_WITH_COL_CHANGE, TREATY_REVIEW, NON_COMPLIANT, UNKNOWN_DATA.
//   The recovery-state logic is fully explained in
//   explanation.recovery_reasoning.
//
// PURITY
//   No IO except for the manual JSON inventory load (delegated to
//   manualInfrastructureClient).  All scoring is deterministic.

import { runSiteOptimizer, buildTopSummary, frequencyChannelClass, __test__ as SO } from './siteOptimizer.js';
const { buildProtectionAdvisory, buildRecommendedActions } = SO;
import { fccAmDistanceKm } from '../curves/fcc/index.mjs';
import { m3LoadStatus } from './m3.js';
import { complianceDistance_m, nearFieldBoundary_m } from '../regulatory/oet65.js';
import {
  loadManualInfrastructureSites,
  filterInfrastructureSites
} from '../../evidence/manualInfrastructureClient.js';

const KNOWN_SEARCH_MODES = Object.freeze(['GRID', 'INFRASTRUCTURE', 'HYBRID']);
const KNOWN_SOURCES      = Object.freeze(['MANUAL']);
// Future: 'ASR_REGISTRY', 'FCC_FMQ', 'FCC_AM' — surfaced as warning until wired.

// Co-location-specific thresholds.
const DIPLEX_RADIUS_KM            = 10;   // same-band AM host < 10 km → diplexing required
const SAME_BAND_INTERFERENCE_KHZ  = 20;   // freq delta ≤ this → HIGH risk on AM_SITE host
const COL_COVERAGE_HARD_FLOOR     = 0.80; // mirrors siteOptimizer §73.24(j)
const BLANKET_POP_HARD_CEIL_PCT   = 1.0;  // mirrors siteOptimizer §73.24(g)
const PROMISING_TOP_QUANTILE      = 0.75;
const RECOVERY_SCORE_FLOOR        = 55;   // recoverable categories need a base of usable rf merit
const NEARBY_COMMUNITY_RADIUS_KM  = 25;   // “populated nearby community” heuristic for COL_CHANGE

const HOST_KIND_LABEL = Object.freeze({
  TOWER:   'TOWER',
  ASR:     'ASR',
  AM_SITE: 'AM_SITE',
  FM_SITE: 'FM_SITE',
  TV_SITE: 'TV_SITE'
});

// ---------- public API ----------

/**
 * Run the co-location opportunity screener.
 *
 * @param {object} body  — see route file.
 * @returns {object} ranked candidates with co-location analytics.
 */
export async function runColocationOpportunities(body = {}){
  const warnings = [];

  // ---- 1. validate ----
  const v = validateInputs(body, warnings);
  if (!v.ok){
    return { available: false, error: v.error, inputs_echo: body };
  }
  const {
    callsign, frequency_khz, current_site, search_radius_km,
    grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
    community_of_license_polygon, col_centroid, goals, candidate_limit,
    search_mode, infrastructure_source, infrastructure_filters
  } = v.value;

  // ---- 1b. DA mode notice ----
  if (/DA/i.test(pattern_mode)){
    warnings.push({
      code: 'DA_MODE_REQUIRED',
      message: `pattern_mode=${pattern_mode}: §73.150 DA pattern design and §73.182 nighttime NIF analysis required at filing. Screening scores are daytime/NDA proxies — DA gain pattern optimization not performed.`
    });
  }

  // ---- 1c. FCC class power limit advisory (mirrors siteOptimizer §73.21 check) ----
  const FCC_CLASS_POWER_KW = { A:{min:10,max:50}, B:{min:0.25,max:50}, C:{min:0.001,max:0.25}, D:{min:0.001,max:50} };
  const classLimits = FCC_CLASS_POWER_KW[fcc_class];
  if (classLimits){
    if (tpo_kw > classLimits.max){
      warnings.push({ code: 'TPO_EXCEEDS_CLASS_MAX',
        message: `tpo_kw ${tpo_kw} kW exceeds §73.21 daytime maximum for Class ${fcc_class} (${classLimits.max} kW).` });
    } else if (fcc_class === 'A' && tpo_kw < classLimits.min){
      warnings.push({ code: 'TPO_BELOW_CLASS_MIN',
        message: `tpo_kw ${tpo_kw} kW is below §73.21 minimum for Class A stations (${classLimits.min} kW).` });
    }
  }

  // ---- 2. choose path ----
  if (search_mode === 'GRID'){
    // Pure GRID: delegate to the site optimizer for an apples-to-apples
    // comparison, then re-shape candidates with source/infrastructure_ref
    // null fields and re-classify via our status taxonomy.
    const so = await runSiteOptimizer({
      callsign, frequency_khz, current_site, search_radius_km,
      grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
      community_of_license_polygon, col_centroid,
      optimization_goals: rawGoalFlags(goals),
      candidate_limit: Math.min(candidate_limit, 200)
    });
    if (so.available === false) return so;
    const candidates = so.candidates.map((c) => decorateGridCandidate(c));
    const cutoff = quantile(candidates.map((c) => c.score), PROMISING_TOP_QUANTILE);
    for (const c of candidates) assignStatusCategory(c, cutoff, { current_site });
    return composeResponse({
      method: 'GRID (delegated to siteOptimizer + co-location classifier)',
      candidates,
      n_candidates_evaluated: so.n_candidates_evaluated,
      baseline: so.current_site_baseline,
      inputs_echo: echoInputs({ callsign, frequency_khz, current_site,
        search_radius_km, grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
        goals, candidate_limit, search_mode, infrastructure_source,
        infrastructure_filters, community_of_license_polygon }),
      warnings,
      so_limitations: so.limitations_global || [],
      score_stats: so.score_stats || null,
      optimization_confidence: so.optimization_confidence || null,
      conductivity_mode: so.conductivity_mode || null,
      frequency_channel_class: so.frequency_channel_class || null,
      skywave_risk_level: so.skywave_risk_level ?? null,
      protection_class_advisory: so.protection_class_advisory ?? null,
      recommended_actions: so.recommended_actions ?? [],
      candidate_count_by_status: so.candidate_count_by_status || null,
      n_infrastructure_sites: 0,
      scoring_time_ms: so.scoring_time_ms ?? null,
      score_histogram: so.score_histogram ?? null,
      top_candidates_summary: so.top_candidates_summary ?? null
    });
  }

  // INFRASTRUCTURE-only and HYBRID share the same pool builder.
  // Compute reach_scale_km (max reach at σ=15 mS/m) so population
  // sub-score normalises correctly via scoreCandidate.
  let reach_scale_km = 200;
  try {
    const rMax = fccAmDistanceKm({
      frequency_khz,
      target_mvm: 0.5,       // matches DAYTIME_REACH_TARGET_MVM in siteOptimizer
      conductivity_msm: 15,
      erp_kw: tpo_kw
    });
    if (rMax?.distance_km > 0) reach_scale_km = rMax.distance_km;
  } catch (_) { /* keep fallback */ }

  const ctx = {
    callsign, frequency_khz, tpo_kw, pattern_mode, fcc_class,
    community_of_license_polygon, col_centroid, goals, current_site, reach_scale_km
  };

  const scoringStart = Date.now();

  // ---- 3a. gather GRID candidates if applicable ----
  let gridScored = [];
  if (search_mode === 'HYBRID'){
    const gridPoints = SO.buildGridCandidates({
      center: current_site,
      radius_km: search_radius_km,
      spacing_km: grid_spacing_km
    });
    ensureCurrentSiteIncluded(gridPoints, current_site);
    gridScored = await Promise.all(gridPoints.map(async (pt) => {
      const c = await SO.scoreCandidate(pt, ctx, warnings);
      return decorateGridCandidate(c);
    }));
  }

  // ---- 3b. gather INFRASTRUCTURE candidates ----
  let infraSites = [];
  if (infrastructure_source === 'MANUAL'){
    let raw;
    try {
      raw = loadManualInfrastructureSites();
    } catch (e) {
      warnings.push({ code: 'INFRA_LOAD_FAILED', message: `Manual infrastructure inventory load failed: ${e.message}` });
      raw = [];
    }
    infraSites = filterInfrastructureSites(raw, {
      center: current_site,
      radius_km: search_radius_km,
      filters: infrastructure_filters
    });
  } else {
    warnings.push({ code: 'INFRA_SOURCE_NOT_WIRED', message: `infrastructure_source '${infrastructure_source}' is not yet wired; returning empty infrastructure pool` });
  }

  const infraScored = await Promise.all(infraSites.map((site) => scoreInfrastructureCandidate(site, ctx, warnings)));

  // ---- 4. unify, rank, label ----
  const pool = gridScored.concat(infraScored);
  pool.sort((a, b) => b.score - a.score);

  const cutoff = quantile(pool.map((c) => c.score), PROMISING_TOP_QUANTILE);
  for (const c of pool) assignStatusCategory(c, cutoff, { current_site });

  const nPool = pool.length;
  pool.forEach((c, i) => {
    c.rank = i + 1;
    c.rank_percentile = nPool > 1 ? Math.round(((nPool - i - 1) / (nPool - 1)) * 10000) / 100 : 100;
  });

  // Baseline = score row for the current site, if it's in the pool.
  const baseline = pool.find((c) => coordsEqual(c, current_site));

  const returned = pool.slice(0, candidate_limit);

  // Score distribution stats over the full pool.
  const scoreValues = pool.map(c => c.score);
  const scoreMean = scoreValues.reduce((a, b) => a + b, 0) / Math.max(scoreValues.length, 1);
  const scoreVar  = scoreValues.reduce((a, v) => a + (v - scoreMean) ** 2, 0) / Math.max(scoreValues.length, 1);
  const score_stats = {
    mean:    round2(scoreMean),
    std_dev: round2(Math.sqrt(scoreVar)),
    min:     round2(Math.min(...scoreValues)),
    max:     round2(Math.max(...scoreValues))
  };

  // Confidence level mirrors siteOptimizer logic.
  const rasterLoaded = m3LoadStatus().loaded;
  const confidenceLayers = [];
  if (goals.maximize_col_coverage || goals.maximize_population || goals.minimize_blanket_population){
    confidenceLayers.push('fcc_groundwave_engine');
  }
  if (rasterLoaded){
    confidenceLayers.push('m3_conductivity_raster');
  }
  if (goals.minimize_blanket_population)   confidenceLayers.push('blanket_population_proxy');
  if (goals.minimize_int_treaty_zone)      confidenceLayers.push('international_border_detection');
  if (community_of_license_polygon)        confidenceLayers.push('col_polygon_provided');
  if (infraSites.length > 0)               confidenceLayers.push('infrastructure_inventory');
  const nLayers = confidenceLayers.length;
  const optimization_confidence = {
    level: nLayers >= 4 ? 'HIGH' : nLayers >= 2 ? 'MEDIUM' : 'LOW',
    contributing_layers: confidenceLayers,
    notes: [
      ...(!rasterLoaded && goals.prefer_high_conductivity ? ['Ground conductivity: FCC M3 zone table (15 zones, ±50% vs. raster) — deploy AM_m3.tif for filing-grade σ'] : []),
      ...(goals.avoid_wildfire_risk       ? ['Wildfire scoring is a placeholder — USFS FIA / LANDFIRE not yet integrated'] : []),
      ...(!community_of_license_polygon   ? ['COL coverage uses a 10 km disc proxy; supply community_of_license_polygon for higher confidence'] : []),
      ...(infraSites.length > 0           ? [`${infraSites.length} infrastructure site(s) from ${infrastructure_source} inventory included in pool`] : [])
    ]
  };

  const candidate_count_by_status = {};
  for (const c of pool){
    const s = c.status_category || 'UNKNOWN_DATA';
    candidate_count_by_status[s] = (candidate_count_by_status[s] || 0) + 1;
  }

  const scoring_time_ms = Date.now() - scoringStart;

  // Build score histogram for INFRASTRUCTURE/HYBRID pool.
  const score_histogram = Array.from({ length: 10 }, (_, i) => ({
    bucket: `${i * 10}–${i * 10 + 9}`, min: i * 10, max: i * 10 + 9, count: 0
  }));
  for (const c of pool){
    const idx = Math.min(9, Math.floor(c.score / 10));
    score_histogram[idx].count += 1;
  }

  const chanClass = frequencyChannelClass(frequency_khz);
  const { skywave_risk_level, protection_class_advisory } = buildProtectionAdvisory({
    fcc_class, frequency_khz, channel_class: chanClass, pattern_mode
  });

  const baselineSumm = baseline ? baselineSummary(baseline) : null;
  const recommended_actions = buildRecommendedActions({
    baseline: baselineSumm,
    returned,
    scored: pool,
    candidate_count_by_status,
    fcc_class,
    pattern_mode,
    chanClass,
    skywave_risk_level,
    warnings,
    community_of_license_polygon
  });

  return composeResponse({
    method: `${search_mode} (infrastructure source: ${infrastructure_source})`,
    candidates: returned,
    n_candidates_evaluated: pool.length,
    baseline: baselineSumm,
    inputs_echo: echoInputs({ callsign, frequency_khz, current_site,
      search_radius_km, grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
      goals, candidate_limit, search_mode, infrastructure_source,
      infrastructure_filters, community_of_license_polygon }),
    warnings,
    so_limitations: [],
    score_stats,
    optimization_confidence,
    conductivity_mode: m3LoadStatus().loaded ? 'raster' : 'zone-table',
    frequency_channel_class: chanClass,
    skywave_risk_level,
    protection_class_advisory,
    recommended_actions,
    candidate_count_by_status,
    n_infrastructure_sites: infraSites.length,
    scoring_time_ms,
    score_histogram,
    top_candidates_summary: buildTopSummary(returned.slice(0, 5), baselineSumm, pool.length)
  });
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

  // grid_spacing_km is only meaningful in GRID/HYBRID modes; default safely.
  const rawSpacing = Number(body.grid_spacing_km);
  const grid_spacing_km = Number.isFinite(rawSpacing) && rawSpacing > 0
    ? rawSpacing
    : Math.max(search_radius_km / 5, 1);  // a coarse default if unspecified

  const search_mode = String(body.search_mode || 'HYBRID').toUpperCase();
  if (!KNOWN_SEARCH_MODES.includes(search_mode)){
    return err(`search_mode must be one of ${KNOWN_SEARCH_MODES.join(', ')}`);
  }

  if (search_mode !== 'INFRASTRUCTURE'){
    if (grid_spacing_km > search_radius_km){
      warnings.push({ code: 'GRID_SPACING_LARGE', message: `grid_spacing_km (${grid_spacing_km}) exceeds search_radius_km (${search_radius_km}); only the current-site point will be evaluated` });
    }
    const est_n = Math.ceil((2 * search_radius_km / grid_spacing_km) + 1) ** 2;
    if (est_n > 10_000){
      return err(`grid would generate ~${est_n} candidates (>10,000 limit); increase grid_spacing_km or shrink search_radius_km`);
    }
  }

  const infrastructure_source = String(body.infrastructure_source || 'MANUAL').toUpperCase();
  if (!KNOWN_SOURCES.includes(infrastructure_source)){
    return err(`infrastructure_source must be one of ${KNOWN_SOURCES.join(', ')} (received ${infrastructure_source})`);
  }

  const tpo_kw = Number(body.tpo_kw);
  if (!Number.isFinite(tpo_kw) || tpo_kw <= 0) return err('tpo_kw must be > 0');

  const pattern_mode = String(body.pattern_mode || 'NDA').toUpperCase();
  const fcc_class    = String(body.fcc_class || 'D').toUpperCase();

  const goals = normalizeGoals(body.optimization_goals);

  const candidate_limit = Number.isFinite(Number(body.candidate_limit))
    ? Math.max(1, Math.min(200, Math.floor(Number(body.candidate_limit))))
    : 30;

  const infrastructure_filters = sanitizeFilters(body.infrastructure_filters);

  // Optional COL centroid — passed through to scoreCandidate via siteOptimizer ctx.
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
      candidate_limit,
      search_mode,
      infrastructure_source,
      infrastructure_filters
    }
  };
}

function normalizeGoals(raw){
  const out = {};
  for (const key of SO.KNOWN_GOALS){
    out[key] = !!(raw && raw[key]);
  }
  return out;
}

function rawGoalFlags(goals){
  // Re-emit a plain dict suitable for siteOptimizer's optimization_goals.
  const o = {};
  for (const k of SO.KNOWN_GOALS) o[k] = !!goals[k];
  return o;
}

function sanitizeFilters(raw){
  if (!raw || typeof raw !== 'object') return {};
  const allowedKeys = ['include_towers', 'include_asr', 'include_am_sites',
    'include_fm_sites', 'include_tv_sites', 'min_tower_height_m',
    'max_tower_height_m', 'owner_contains'];
  const out = {};
  for (const k of allowedKeys){
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
}

// ---------- candidate construction ----------

function decorateGridCandidate(c){
  // Returns the same shape as scoreCandidate but with co-location fields.
  // (Pure-grid candidates aren't hosted on any inventory record.)
  const decorated = {
    ...c,
    source: 'GRID',
    infrastructure_ref: null,
    colocation_analysis: {
      distance_to_host_m: null,
      host_kind: null,
      host_owner: null,
      host_height_m: null,
      tower_loading_advisory: 'UNKNOWN',
      same_band_interference_risk: 'LOW',
      structural_engineering_required: true,
      shared_lease_advantage: false,
      diplexing_required: false,
      regulatory_notes: ['New-build site assumed; verify zoning / parcel availability.']
    }
  };
  return decorated;
}

async function scoreInfrastructureCandidate(site, ctx, warnings){
  // The infrastructure site IS the candidate point.  We score it with
  // siteOptimizer's per-candidate scorer (which handles all of the
  // FCC-curve math and the 5 mV/m COL coverage check), then layer the
  // co-location advisory block on top.
  const dist = Number.isFinite(site.distance_from_center_km)
    ? site.distance_from_center_km
    : SO.greatCircleKm(ctx.current_site.lat, ctx.current_site.lon, site.lat, site.lon);
  const bearing = dist < 0.01 ? 0
    : Math.round(SO.bearingDeg(ctx.current_site.lat, ctx.current_site.lon, site.lat, site.lon));
  const pt = {
    lat: site.lat,
    lon: site.lon,
    distance_from_current_km: dist,
    bearing_deg: bearing
  };
  const scored = await SO.scoreCandidate(pt, ctx, warnings);

  const hostKind = HOST_KIND_LABEL[site.kind] || null;
  const sameBandAm = site.kind === 'AM_SITE'
    && Number.isFinite(site.frequency_khz)
    && Math.abs(site.frequency_khz - ctx.frequency_khz) <= SAME_BAND_INTERFERENCE_KHZ;

  const distMeters = 0;  // candidate IS the infrastructure site
  const diplex = (site.kind === 'AM_SITE')
    && SO.greatCircleKm(ctx.current_site.lat, ctx.current_site.lon, site.lat, site.lon) <= DIPLEX_RADIUS_KM;

  const interferenceRisk = sameBandAm
    ? 'HIGH'
    : (site.kind === 'AM_SITE' ? 'MODERATE' : 'LOW');

  const regulatory_notes = [];
  if (site.asr_number){
    regulatory_notes.push(`ASR ${site.asr_number} registered – co-locate notification required (47 CFR §17 / §73.1692).`);
  }
  if (sameBandAm){
    regulatory_notes.push(`Same-band AM host on ${site.frequency_khz} kHz – §73.182 nighttime / IBOC interaction study required.`);
  }
  if (site.kind === 'AM_SITE' && !sameBandAm){
    regulatory_notes.push('Cross-band AM host – diplexer or detuning study recommended.');
  }
  if (site.kind === 'FM_SITE' || site.kind === 'TV_SITE'){
    regulatory_notes.push(`${site.kind} host – evaluate RF safety (47 CFR §1.1310 / OET-65) and IM products.`);
  }
  // MPE screening: compute the §1.1310 near-field boundary and far-field
  // compliance distance for the AM station.  For AM (< 30 MHz) the
  // near-field zone extends λ/(2π) from the antenna and a near-field study
  // is always required regardless of the far-field result.
  try {
    const freq_mhz = ctx.frequency_khz / 1000;
    const nfBound = nearFieldBoundary_m(freq_mhz);
    const mpe = complianceDistance_m({ erp_kw: ctx.tpo_kw, frequency_mhz: freq_mhz, exposure_class: 'uncontrolled' });
    const nfStr = Number.isFinite(nfBound) ? `near-field boundary λ/(2π) ≈ ${Math.round(nfBound)} m` : null;
    const ffStr = (mpe && Number.isFinite(mpe.distance_m)) ? `far-field compliance distance ≈ ${Math.ceil(mpe.distance_m)} m` : null;
    if (nfStr || ffStr){
      const parts = [nfStr, ffStr].filter(Boolean);
      regulatory_notes.push(
        `RF safety (§1.1310 / OET-65): ${parts.join('; ')} at ${ctx.tpo_kw} kW / ${ctx.frequency_khz} kHz.` +
        ` AM < 30 MHz: near-field analysis (OET-65 §3.B) required out to the λ/(2π) boundary.`
      );
    }
  } catch (_){ /* skip if OET-65 lookup fails */ }

  const decorated = {
    ...scored,
    source: 'INFRASTRUCTURE',
    infrastructure_ref: {
      id:             site.id ?? null,
      kind:           site.kind ?? null,
      name:           site.name ?? null,
      owner:          site.owner ?? null,
      lat:            site.lat,
      lon:            site.lon,
      height_m:       site.height_m ?? null,
      structure_type: site.structure_type ?? null,
      asr_number:     site.asr_number ?? null,
      frequency_khz:  site.frequency_khz ?? null,
      station_call:   site.station_call ?? null
    },
    colocation_analysis: {
      distance_to_host_m: distMeters,
      host_kind: hostKind,
      host_owner: site.owner ?? null,
      host_height_m: site.height_m ?? null,
      tower_loading_advisory: site.tower_loading_advisory || 'UNKNOWN',
      same_band_interference_risk: interferenceRisk,
      structural_engineering_required: site.tower_loading_advisory !== 'OK_PER_INVENTORY',
      shared_lease_advantage: true,
      diplexing_required: !!diplex,
      regulatory_notes
    }
  };
  return decorated;
}

// ---------- status classification ----------

function assignStatusCategory(c, scoreCutoff, { current_site }){
  // Pull the hard-fail signals out of the scoreCandidate output.
  const flags = collectHardFails(c);

  const treaty = !!c.treaty_zone;
  const colFail = c.col_coverage_pct != null && c.col_coverage_pct < COL_COVERAGE_HARD_FLOOR;
  const blanketFail = c.blanket_population_pct != null && c.blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT;
  const missing = (c.col_coverage_pct == null) || (c.daytime_reach_km == null);

  const reasoning = [];
  let category;

  if (missing && c.score === 0){
    category = 'UNKNOWN_DATA';
    reasoning.push('Required FCC-curve / coverage metrics returned null; cannot classify.');
  } else if (treaty){
    // Treaty review supersedes the other recoverable categories — the
    // engineer must engage State Dept / FCC IB before any other action.
    category = 'TREATY_REVIEW';
    reasoning.push(`Candidate sits inside ${c.treaty_zone}; cross-border treaty review required.`);
  } else if (colFail && !blanketFail && c.score >= RECOVERY_SCORE_FLOOR){
    // COL coverage fails but the rest of the score is healthy — determine
    // the most specific recovery path.
    if (c.minimum_tpo_for_col_coverage_kw != null){
      // Engine found a feasible power level (≤50 kW) — direct TPO increase is the fix.
      category = 'RECOVERABLE_WITH_POWER_INCREASE';
      reasoning.push(`Engine computed minimum TPO of ${c.minimum_tpo_for_col_coverage_kw} kW to reach §73.24(j) 5 mV/m at COL centroid distance; direct power increase (no DA pattern) is the primary path.`);
    } else if (c.distance_from_current_km <= NEARBY_COMMUNITY_RADIUS_KM){
      category = 'RECOVERABLE_WITH_DA';
      reasoning.push('Principal-community 5 mV/m contour shortfall is plausibly recoverable via directional-antenna design (§73.150).');
    } else {
      category = 'RECOVERABLE_WITH_COL_CHANGE';
      reasoning.push('Candidate is too far from current city of license for DA recovery; a community-of-license change application (§73.3573) may be the cleaner path.');
    }
  } else if (blanketFail && !colFail && c.score >= RECOVERY_SCORE_FLOOR){
    category = 'RECOVERABLE_WITH_REDUCED_POWER';
    reasoning.push(`Blanket population ${c.blanket_population_pct?.toFixed(2) ?? '?'}% exceeds §73.24(g) 1% limit; reducing TPO will shrink the 1000 mV/m blanket contour.`);
  } else if (flags.length >= 2){
    category = 'NON_COMPLIANT';
    reasoning.push(`Multiple hard failures: ${flags.join('; ')}.`);
  } else if (c.score >= scoreCutoff && flags.length === 0){
    category = 'PROMISING';
    reasoning.push('Score in top quantile with no hard rule failures on the screening rubric.');
  } else if (c.score >= scoreCutoff * 0.85){
    category = 'REVIEW_REQUIRED';
    reasoning.push('Score within 15% of the PROMISING cutoff – warrants engineer-grade follow-up before ruling in or out.');
  } else if (flags.length === 1){
    category = 'NON_COMPLIANT';
    reasoning.push(`Single hard failure not in a known recovery path: ${flags[0]}.`);
  } else {
    category = 'REVIEW_REQUIRED';
    reasoning.push('Below the PROMISING cutoff but without any hard failures – manual review recommended.');
  }

  // Co-location-specific overlays — never downgrade from TREATY_REVIEW
  // or NON_COMPLIANT, but DO add to the reasoning.
  if (c.colocation_analysis && c.colocation_analysis.diplexing_required){
    reasoning.push('Same-band AM host within 10 km → diplexer or detuning skirt required.');
  }
  if (c.colocation_analysis && c.colocation_analysis.same_band_interference_risk === 'HIGH'){
    reasoning.push('Same-band AM host on identical / adjacent frequency presents HIGH interference risk.');
  }

  c.status_category = category;
  c.explanation = c.explanation || {};
  c.explanation.recovery_reasoning = reasoning.join(' ');
}

function collectHardFails(c){
  // The siteOptimizer route exposes hard-fail strings via labels and
  // limitations after finalizeLabels(); since we call scoreCandidate
  // directly (without finalizeLabels), reconstruct from the raw fields.
  const flags = [];
  if (c.col_coverage_pct != null && c.col_coverage_pct < COL_COVERAGE_HARD_FLOOR){
    flags.push(`COL coverage ${(c.col_coverage_pct * 100).toFixed(0)}% < §73.24(j) floor`);
  }
  if (c.blanket_population_pct != null && c.blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT){
    flags.push(`Blanket population ${c.blanket_population_pct.toFixed(2)}% > §73.24(g) 1% limit`);
  }
  return flags;
}

// ---------- response composition ----------

function composeResponse({ method, candidates, n_candidates_evaluated,
                            baseline, inputs_echo, warnings, so_limitations,
                            score_stats, score_histogram, top_candidates_summary,
                            optimization_confidence,
                            conductivity_mode, frequency_channel_class,
                            skywave_risk_level, protection_class_advisory,
                            recommended_actions,
                            n_infrastructure_sites,
                            candidate_count_by_status, scoring_time_ms }){
  return {
    available: true,
    method,
    n_candidates_evaluated,
    n_candidates_returned: candidates.length,
    n_infrastructure_sites: n_infrastructure_sites ?? 0,
    candidate_count_by_status: candidate_count_by_status || null,
    top_candidates_summary: top_candidates_summary ?? null,
    current_site_baseline: baseline,
    candidates,
    score_stats,
    score_histogram: score_histogram ?? null,
    optimization_confidence,
    conductivity_mode: conductivity_mode || null,
    frequency_channel_class: frequency_channel_class || null,
    skywave_risk_level: skywave_risk_level ?? null,
    protection_class_advisory: protection_class_advisory ?? null,
    recommended_actions: recommended_actions ?? [],
    scoring_time_ms: scoring_time_ms ?? null,
    inputs_echo,
    warnings,
    limitations_global: [
      'Screening-grade output only; engineer-grade NIF / §73.182 / DA-N analysis is required for any filing.',
      'Co-location host inventory is the MANUAL seed file; not authoritative – verify with the host owner.',
      'No structural / TIA-222 loading study is performed – every infrastructure candidate carries structural_engineering_required:true unless the inventory explicitly marks otherwise.',
      'Diplexing flags are distance-based heuristics only; the actual study requires antenna currents and feedline analysis.',
      ...so_limitations
    ]
  };
}

function baselineSummary(b){
  return {
    lat: b.lat, lon: b.lon,
    score: b.score,
    rank_percentile:              b.rank_percentile,
    col_coverage_pct:             b.col_coverage_pct,
    principal_community_5mvm_km:  b.principal_community_5mvm_km,
    daytime_reach_km:             b.daytime_reach_km,
    blanket_population_pct:       b.blanket_population_pct,
    blanket_1000mvm_km:           b.blanket_1000mvm_km,
    minimum_tpo_for_compliance_kw:   b.minimum_tpo_for_compliance_kw ?? null,
    minimum_tpo_for_col_coverage_kw: b.minimum_tpo_for_col_coverage_kw ?? null,
    ground_sigma_mS_m:            b.ground_sigma_mS_m,
    ground_sigma_quality:         b.ground_sigma_quality,
    ground_sigma_source:          b.ground_sigma_source,
    ground_sigma_filing_grade:    b.ground_sigma_filing_grade,
    nif_status:                   b.nif_status,
    treaty_zone:                  b.treaty_zone,
    status_category:              b.status_category,
    status_labels:                b.status_labels,
    source:                       b.source,
    score_breakdown:              b.explanation?.score_breakdown ?? null,
    // Fields added in recent optimizer upgrades.
    field_at_col_centroid_mvm:            b.field_at_col_centroid_mvm ?? null,
    estimated_daytime_population_served:  b.estimated_daytime_population_served ?? null,
    score_confidence:                     b.score_confidence ?? null
  };
}

function echoInputs(o){
  return {
    callsign: o.callsign,
    frequency_khz: o.frequency_khz,
    current_site: o.current_site,
    search_radius_km: o.search_radius_km,
    grid_spacing_km: o.grid_spacing_km,
    tpo_kw: o.tpo_kw,
    pattern_mode: o.pattern_mode,
    fcc_class: o.fcc_class,
    goals_enabled: Object.entries(o.goals).filter(([_, v]) => v).map(([k]) => k),
    community_of_license_polygon_provided: !!o.community_of_license_polygon,
    col_centroid_provided: !!o.col_centroid,
    col_centroid: o.col_centroid ?? null,
    candidate_limit: o.candidate_limit,
    search_mode: o.search_mode,
    infrastructure_source: o.infrastructure_source,
    infrastructure_filters: o.infrastructure_filters || {}
  };
}

// ---------- small helpers ----------

function ensureCurrentSiteIncluded(points, current){
  if (!points.some((p) => coordsEqual(p, current))){
    points.push({ lat: current.lat, lon: current.lon, distance_from_current_km: 0, bearing_deg: 0 });
  }
}

function coordsEqual(a, b, tol_deg = 1e-9){
  return Math.abs(a.lat - b.lat) < tol_deg && Math.abs(a.lon - b.lon) < tol_deg;
}

function quantile(arr, q){
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

function round2(x){ return Number.isFinite(x) ? Math.round(x * 100) / 100 : x; }

// ---------- test-only export ----------

export const __test__ = {
  validateInputs,
  scoreInfrastructureCandidate,
  decorateGridCandidate,
  assignStatusCategory,
  collectHardFails,
  KNOWN_SEARCH_MODES,
  KNOWN_SOURCES,
  DIPLEX_RADIUS_KM,
  SAME_BAND_INTERFERENCE_KHZ
};
