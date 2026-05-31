// AM nighttime orchestrator — pulls nearby AM primaries from LMS,
// normalizes their shape into the form solveNifContour() expects,
// runs the per-azimuth bisection, and returns a compact result
// ready for the exhibit appendix + UI overlay.
//
// CONTRACT
//   nighttimeNifStudy({
//     proposed: {
//       lat, lon, freq_khz, erp_kw,
//       fcc_class:    'A'|'B'|'C'|'D',
//       pattern_table?,            // §73.150 horizontal pattern (DA-N)
//       pattern_mode?: 'omni'|'DA'
//     },
//     options?: {
//       radius_km?:        default 1500 (covers §73.182's ~750 mi reach)
//       azimuths_deg?:     default [0,10,...,350]
//       duDbOverride?:     per-relation D/U dB overrides for waiver studies
//       max_interferers?:  cap on the number of co/adjacent stations
//                          considered (default 25; sorted by predicted
//                          field at the proposed station so the strongest
//                          always win when capped)
//     }
//   }, { fccamClient, facilityClient, budget? })
//   → {
//       available:    boolean,
//       contour:      Array<{ az, lat, lon, distance_km, binding, ... }>,
//       polygon:      GeoJSON-friendly closed vertex list,
//       interferers:  Array<{ call, fcc_class, relation, distance_km, ... }>,
//       summary:      { n_failing_azimuths, worst_margin_db, mean_radius_km, ... },
//       provenance:   { ... }
//     }
//
// REGULATORY
//   - 47 CFR §73.182  — engineering standards of allocation, AM nighttime
//   - 47 CFR §73.183  — required protection ratios
//   - 47 CFR §73.190  — engineering charts, Wang skywave model

import { isValidAmKhz } from './band.js';
import { normalizeRelation } from './nightInterference.js';
import { solveNifContour } from './nifContour.js';

const DEFAULT_RADIUS_KM       = 1500;   // §73.182 reach is ~750 mi ≈ 1207 km; round up
const DEFAULT_MAX_INTERFERERS = 25;

/**
 * Convert one LMS-primary row into the shape solveNifContour expects.
 * Returns null when the row is unusable (no coordinates / freq).
 */
export function normalizePrimary(row){
  if (!row) return null;
  // Reject nullish lat/lon up front — JS would otherwise coerce
  // null → 0 (which IS finite, but 0,0 in the Atlantic is not a
  // valid AM station and would propagate as bogus geometry).
  if (row.lat == null || row.lon == null) return null;
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  const freq_khz = Number(row.frequency_khz ?? row.frequency);
  const erp_kw   = Number(row.erp_kw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!isValidAmKhz(freq_khz)) return null;
  if (!Number.isFinite(erp_kw) || erp_kw <= 0) return null;
  return {
    station_id:   row.facility_id || row.station_id || null,
    call:         row.call || null,
    fcc_class:    row.fcc_class || null,
    lat, lon, freq_khz, erp_kw,
    pattern_table: row.pattern_table || row.da_n_pattern || null,
    relation:     normalizeRelation(row.channel_relationship || row.relation || 'co_channel'),
    distance_km:  Number(row.distance_km) || null,
    source:       row.source || 'fcc-amq'
  };
}

/**
 * Run the §73.182 nighttime NIF study for a proposed AM station.
 */
export async function nighttimeNifStudy(input, ctx){
  const { proposed = null, options = {} } = input || {};
  const { fccamClient = null, berryClient = null, facilityClient = null, budget = null } = ctx || {};

  // Select the active skywave client.  FCCAM (Wang 1985) is filing-grade;
  // Berry 1968 is screening-grade.  We prefer FCCAM and fall back to Berry
  // so exhibitService can emit FCCAM_UNAVAILABLE_BERRY_FALLBACK when FCCAM
  // was configured but unreachable.
  const activeClient = fccamClient || berryClient || null;
  const usingFccam   = !!fccamClient;

  if (!activeClient){
    return {
      available: false,
      error:     'No AM skywave engine configured (set FCCAM_SIDECAR_URL or enable Berry fallback)',
      regulation: '47 CFR §73.182 / §73.190(c)'
    };
  }
  if (!proposed?.lat || !proposed?.lon || !isValidAmKhz(proposed?.freq_khz) || !(Number(proposed?.erp_kw) > 0)){
    return {
      available: false,
      error:     'proposed station requires lat, lon, AM-band freq_khz on the 10-kHz grid, and erp_kw > 0'
    };
  }
  if (!proposed.fcc_class){
    return {
      available: false,
      error:     'proposed.fcc_class is required (A/B/C/D) — protection ratios per §73.183 are class-dependent'
    };
  }

  // 1. Pull nearby AMs from LMS.
  const radius_km = Number(options.radius_km) || DEFAULT_RADIUS_KM;
  let primariesResp;
  try {
    const pullArgs = {
      lat:                 Number(proposed.lat),
      lon:                 Number(proposed.lon),
      frequency_khz:       Number(proposed.freq_khz),
      service:             'AM',
      radius_km,
      exclude_facility_id: proposed.facility_id || null
    };
    const clientForLms = facilityClient;
    primariesResp = budget?.withDeadline
      ? await budget.withDeadline('am_night_primaries', () => clientForLms.getNearbyPrimaries(pullArgs), { minMs: 5_000 })
      : await clientForLms.getNearbyPrimaries(pullArgs);
  } catch (e){
    return { available: false, error: `nearby-primaries fetch failed: ${e?.message || e}` };
  }
  if (!primariesResp?.available){
    return {
      available: false,
      error: primariesResp?.error || 'nearby-primaries unavailable',
      regulation: '47 CFR §73.182'
    };
  }

  // 2. Normalize + cap.
  const normalized = (primariesResp.primaries || [])
    .map(normalizePrimary)
    .filter(Boolean);

  const max_interferers = Number(options.max_interferers) || DEFAULT_MAX_INTERFERERS;
  // Pre-sort by ESTIMATED field at the proposed transmitter, not raw
  // distance.  A 50 kW Class A at 600 km contributes far more skywave
  // RSS than a 1 kW Class D at 400 km, but the older distance-only
  // ordering would have dropped the louder station off the bottom of
  // the cap.  Estimator is closed-form (no skywave-engine cost):
  //   E_est ∝ erp_kw / max(1, distance_km^1.2)
  // The exponent 1.2 is the Berry-screening regime in §73.190(c) (≈1.0
  // + a small latitude pull at mid-CONUS); it ranks correctly without
  // claiming a real Wang field at this stage.  Cap is still a budget
  // knob — the §73.182(k) 25% per-receiver rule downstream remains the
  // correctness gate.
  const estField = (x) => {
    const d = Number(x?.distance_km);
    const erp = Number(x?.erp_kw);
    if (!Number.isFinite(erp) || erp <= 0) return 0;
    const denom = Math.max(1, Math.pow(Number.isFinite(d) && d > 0 ? d : 1, 1.2));
    return erp / denom;
  };
  const interferers = normalized
    .slice()
    .sort((a, b) => estField(b) - estField(a))
    .slice(0, max_interferers);

  // 3. Solve.  Use the active skywave client (FCCAM if configured,
  // Berry fallback otherwise).  A try/catch here catches sidecar
  // transport errors (ECONNREFUSED, ETIMEDOUT, etc.) so they surface as
  // available:false instead of propagating to the caller.
  // pattern_table's presence (not pattern_mode) is the authoritative
  // signal for directional-pattern application — see nifContour.js.
  const proposedForSolver = {
    lat:           Number(proposed.lat),
    lon:           Number(proposed.lon),
    freq_khz:      Number(proposed.freq_khz),
    erp_kw:        Number(proposed.erp_kw),
    fcc_class:     proposed.fcc_class,
    pattern_table: (Array.isArray(proposed.pattern_table) && proposed.pattern_table.length > 0)
      ? proposed.pattern_table
      : null
  };
  const solverArgs  = { proposed: proposedForSolver, interferers, azimuths_deg: options.azimuths_deg };
  const solverOpts  = { duDbOverride: options.duDbOverride };

  let contour;
  try {
    contour = await solveNifContour(solverArgs, { fccamClient: activeClient, ...solverOpts });
  } catch (e) {
    contour = { available: false, error: `skywave engine error: ${e?.message || e}` };
  }

  if (!contour.available){
    // If FCCAM was active and failed (transport error or returned available:false),
    // try Berry as a runtime fallback so exhibitService can surface
    // FCCAM_UNAVAILABLE_BERRY_FALLBACK.
    if (usingFccam && berryClient){
      let berryContour;
      try {
        berryContour = await solveNifContour(solverArgs, { fccamClient: berryClient, ...solverOpts });
      } catch (e) {
        berryContour = { available: false, error: `berry engine error: ${e?.message || e}` };
      }
      if (berryContour.available){
        return buildResult({ contour: berryContour, interferers, normalized, max_interferers, primariesResp, isBerry: true, fccamFallbackUsed: true });
      }
    }
    return { available: false, error: contour.error || 'NIF contour solver returned available:false',
             raw: contour };
  }

  // 4. Determine actual engine identity and build result.
  const isBerry = /berry/i.test(String(contour.source || contour.engine || ''));
  return buildResult({ contour, interferers, normalized, max_interferers, primariesResp, isBerry, fccamFallbackUsed: false });
}

/**
 * Build the final nighttimeNifStudy result from a solved contour.
 * Centralises source/filing_grade/provenance stamping so the Berry
 * runtime-fallback path produces the same shape as the happy path.
 */
function buildResult({ contour, interferers, normalized, max_interferers, primariesResp, isBerry, fccamFallbackUsed }){
  const radii   = contour.per_azimuth.filter((p) => p.ok).map((p) => p.distance_km);
  const failing = contour.per_azimuth.filter((p) => p.binding && !p.binding.pass);
  const margins = contour.per_azimuth
    .map((p) => p.binding?.margin_db)
    .filter((x) => Number.isFinite(x));
  const summary = {
    n_azimuths:           contour.per_azimuth.length,
    n_failing_azimuths:   failing.length,
    n_no_service_azimuths: contour.per_azimuth.filter((p) => p.saturated === 'no_service').length,
    n_unbounded_azimuths:  contour.per_azimuth.filter((p) => p.saturated === 'unbounded').length,
    mean_radius_km:       radii.length ? radii.reduce((a, x) => a + x, 0) / radii.length : null,
    min_radius_km:        radii.length ? Math.min(...radii) : null,
    max_radius_km:        radii.length ? Math.max(...radii) : null,
    worst_margin_db:      margins.length ? Math.min(...margins) : null,
    n_interferers_used:   interferers.length,
    n_interferers_seen:   normalized.length,
    interferer_cap:       max_interferers
  };

  // Canonical source identifiers — context.js and the conclusion
  // section detect Berry via /berry/i on source/provenance.
  const source        = isBerry ? 'berry-1968'       : 'fccam-wang-1985';
  const skywave_engine = isBerry ? 'BERRY_1968'       : 'FCCAM_WANG_1985';
  const filing_grade   = !isBerry;
  const upstream_sw    = isBerry
    ? 'Berry 1968 analytical (screening-grade per §73.190(c))'
    : 'FCCAM (Fccam.for / Wang 1985)';

  return {
    available:   true,
    source,
    engine:      contour.engine || source,
    engine_warning: contour.engine_warning || null,
    filing_grade,
    skywave_engine,
    fccam_fallback_used: fccamFallbackUsed,
    fetched_at:  new Date().toISOString(),
    proposed:    contour.proposed,
    interferers,
    interferer_cap_applied: normalized.length > max_interferers,
    contour:     contour.per_azimuth,
    polygon:     contour.polygon,
    du_db_by_relation: contour.du_db_by_relation,
    summary,
    advisory_voacap: null,
    regulation:  '47 CFR §73.182 / §73.183 / §73.190(c)',
    provenance:  {
      module:           'src/engine/am/nightOrchestrator.js',
      upstream_skywave: upstream_sw,
      upstream_lms:     primariesResp.source || 'fcc-amq',
      license_basis:    '17 USC §105 (FCC engine + endpoint, US Government public domain)'
    }
  };
}
