// Derive a §73.215 directional-antenna (DA) pattern table from the
// FCC's published contour polygon.
//
// PURPOSE
//   Hatfield-Dawson-grade FM/LPFM/FX studies require the station's
//   directional pattern (per-azimuth relative-field factor) to run
//   §73.215 contour protection and §74.1204 D/U analysis with real
//   nulls.  Genoa's input form lets an engineer paste a pattern table
//   manually, but the AUTHORITATIVE source is the pattern that's
//   already on file with the FCC — encoded in the contour polygon
//   the FCC publishes at geo.fcc.gov/api/contours/entity.json.
//
//   This module inverts that contour: given (azimuth, distance, haat)
//   per radial and the station's published ERP + frequency, it solves
//   for the ERP_radial that produces the FCC's distance through the
//   same vendored §73.333 curves Genoa uses everywhere else.  The
//   relative-field factor at each azimuth is then sqrt(ERP_radial /
//   ERP_total), normalised so the peak is 1.0.
//
// SCIENTIFIC RIGOR
//   - No fabrication: every radial's factor is back-calculated from
//     a single FCC-published distance with the same FCC §73.333
//     bivariate cubic surface fit (vendored tvfm_curves.js).  The
//     resulting pattern is, by construction, the one that the FCC's
//     own engine would generate the FCC's published contour from.
//   - For an ND station the FCC contour is (approximately) circular
//     and this routine returns factors very close to 1.0 across all
//     azimuths.  For a DA station the FCC contour has lobes and
//     nulls, and this routine recovers them.
//   - HAAT is taken from the same contour radial (NOT the input flat
//     HAAT) — the FCC computed the distance using the per-radial HAAT,
//     so the inverse must do the same to recover the correct factor.
//
// CALLSITE CONTRACT
//   const result = derivePatternFromFccContour({
//     contourResp:    fccContoursClient response object,
//     erp_total_kw:   station ERP (kW) — denominator for the factor,
//     target_dBu:     contour field strength (defaults to props.field_strength),
//     frequency_mhz:  carrier frequency (used to map to FCC channel),
//     mode:           '50,50' | '50,10' | '50,90' (default 50,50)
//   })
//   →
//   { available: true,
//     pattern_table: [[az_deg, factor], ...],
//     n_radials, max_factor, min_factor, mean_factor,
//     normalised_to_max_one: true,
//     source: 'fcc-contour-inverse',
//     endpoint, fetched_at, target_dBu, mode,
//     diagnostics: { n_solved, n_failed, max_residual_km } }
//
//   On failure (no contour, no contourData, etc.):
//   { available: false, error: 'reason' }

import { fccDistanceKm } from '../engine/curves/fcc/index.mjs';

const DEFAULT_TARGET_DBU = 60;   // FM service contour
const BISECTION_ITERS    = 32;
const ERP_MIN_KW         = 1e-4; // FCC routine treats erp < 1e-4 as zero
const ERP_MAX_MULT       = 4;    // upper bound = ERP_total × this

// Solve for the ERP that produces a given target distance via the
// FCC vendored curve.  The curve is monotonic in ERP (more power →
// larger distance) so a bisection converges in <32 steps to <1 m.
function findErpForDistance({ target_dist_km, haat_m, target_dBu, mode, frequency_mhz, erp_max_kw }){
  let lo = ERP_MIN_KW;
  let hi = erp_max_kw;

  // Sanity: if the maximum ERP can't even reach target_dist, the
  // pattern factor is >1 (gain) — clamp at 1 and surface diagnostic.
  let highDist;
  try {
    highDist = fccDistanceKm({ erp_kw: hi, haat_m, target_dBu, mode, frequency_mhz }).distance_km;
  } catch { return { erp_kw: hi, residual_km: NaN, clamped_high: true }; }
  if (highDist < target_dist_km){
    // Even at 4× nominal ERP we don't reach this radial — pattern
    // factor would be > 1 (i.e. station has antenna gain beyond what
    // the input ERP_total reflects).  Clamp the factor at the upper
    // bound; orchestrator can warn.
    return { erp_kw: hi, residual_km: target_dist_km - highDist, clamped_high: true };
  }

  let lowDist;
  try {
    lowDist = fccDistanceKm({ erp_kw: lo, haat_m, target_dBu, mode, frequency_mhz }).distance_km;
  } catch { return { erp_kw: lo, residual_km: NaN, clamped_low: true }; }
  if (lowDist > target_dist_km){
    // Floor ERP already over-reaches — radial is shorter than the
    // engine can produce at minimum power.  Pattern factor ≈ 0.
    return { erp_kw: lo, residual_km: lowDist - target_dist_km, clamped_low: true };
  }

  for (let i = 0; i < BISECTION_ITERS; i++){
    const mid = 0.5 * (lo + hi);
    let d;
    try {
      d = fccDistanceKm({ erp_kw: mid, haat_m, target_dBu, mode, frequency_mhz }).distance_km;
    } catch {
      // Engine failed at this point — abort with current best-guess.
      return { erp_kw: mid, residual_km: NaN };
    }
    if (d < target_dist_km) lo = mid;
    else hi = mid;
  }
  const erp_kw = 0.5 * (lo + hi);
  let residual_km;
  try {
    residual_km = fccDistanceKm({ erp_kw, haat_m, target_dBu, mode, frequency_mhz }).distance_km - target_dist_km;
  } catch { residual_km = NaN; }
  return { erp_kw, residual_km };
}

export function derivePatternFromFccContour({
  contourResp,
  erp_total_kw,
  target_dBu     = null,
  frequency_mhz  = null,
  mode           = '50,50',
  azimuth_step_deg = 1
}){
  if (!contourResp?.available || !contourResp.contour){
    return { available: false, error: 'no FCC contour available' };
  }
  const features = contourResp.contour.features;
  if (!Array.isArray(features) || features.length === 0){
    return { available: false, error: 'FCC contour has no features' };
  }
  const props = features[0].properties || {};
  const contourData = props.contourData;
  if (!Array.isArray(contourData) || contourData.length === 0){
    return { available: false, error: 'FCC contour has no contourData' };
  }
  if (!Number.isFinite(Number(erp_total_kw)) || Number(erp_total_kw) <= 0){
    return { available: false, error: 'erp_total_kw must be a positive number' };
  }

  // Field strength target: prefer caller-supplied, else read from FCC
  // properties, else default to 60 dBu (FM service).
  const target = Number.isFinite(Number(target_dBu)) ? Number(target_dBu)
              : (Number.isFinite(Number(props.field_strength?.value))
                     ? Number(props.field_strength.value) : DEFAULT_TARGET_DBU);
  const target_dBu_used = Number.isFinite(target) ? target : DEFAULT_TARGET_DBU;

  const erp_total = Number(erp_total_kw);
  const erp_max   = erp_total * ERP_MAX_MULT;
  const step      = Number(azimuth_step_deg) || 1;

  const factors_unnormalised = [];   // [{az, factor_raw, residual_km}]
  let n_solved = 0;
  let n_failed = 0;
  let max_residual_km = 0;

  for (const pt of contourData){
    const az = Number(pt.azimuth);
    if (!Number.isFinite(az)) continue;
    if (az % step !== 0) continue;
    const dist = Number(pt.distance);
    const haat = Number(pt.haat);
    if (!Number.isFinite(dist) || !Number.isFinite(haat)){
      n_failed++;
      continue;
    }
    const sol = findErpForDistance({
      target_dist_km: dist,
      haat_m:         haat,
      target_dBu:     target_dBu_used,
      mode,
      frequency_mhz,
      erp_max_kw:     erp_max
    });
    const factor_raw = Math.sqrt(Math.max(0, sol.erp_kw / erp_total));
    factors_unnormalised.push({
      az,
      factor_raw,
      residual_km:    sol.residual_km,
      clamped_high:   !!sol.clamped_high,
      clamped_low:    !!sol.clamped_low
    });
    if (Number.isFinite(sol.residual_km) && Math.abs(sol.residual_km) > max_residual_km){
      max_residual_km = Math.abs(sol.residual_km);
    }
    n_solved++;
  }

  if (factors_unnormalised.length === 0){
    return { available: false, error: 'no usable contour radials (all missing distance/haat)' };
  }

  // Normalise so the peak factor is 1.0.  This matches the
  // pattern_table convention used elsewhere in the engine
  // (genoa/src/engine/pattern/factor.js).
  const max_raw = factors_unnormalised.reduce((m, x) => Math.max(m, x.factor_raw), 0);
  const norm    = max_raw > 0 ? max_raw : 1;

  const pattern_table = factors_unnormalised
    .sort((a, b) => a.az - b.az)
    .map(x => [x.az, x.factor_raw / norm]);

  const factors_norm = pattern_table.map(([_, f]) => f);
  const max_factor   = Math.max(...factors_norm);
  const min_factor   = Math.min(...factors_norm);
  const mean_factor  = factors_norm.reduce((a, b) => a + b, 0) / factors_norm.length;

  return {
    available:               true,
    pattern_table,
    n_radials:               pattern_table.length,
    max_factor,
    min_factor,
    mean_factor,
    normalised_to_max_one:   true,
    peak_unnormalised:       max_raw,
    source:                  'fcc-contour-inverse',
    method:                  'per-radial inverse of FCC §73.333 curves applied to FCC-published contourData[].distance + .haat',
    endpoint:                contourResp.endpoint || null,
    fetched_at:              contourResp.fetched_at || new Date().toISOString(),
    target_dBu:              target_dBu_used,
    mode,
    erp_total_kw,
    diagnostics: {
      n_solved,
      n_failed,
      max_residual_km,
      n_clamped_high: factors_unnormalised.filter(x => x.clamped_high).length,
      n_clamped_low:  factors_unnormalised.filter(x => x.clamped_low).length
    }
  };
}
