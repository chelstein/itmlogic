// Directional-pattern mitigation advisor for §73.215 D/U violations.
//
// LICENSE BOUNDARY
//   This module calls the NEC sidecar via the HTTP client in
//   src/evidence/nec/client.js.  It never imports or links PyNEC / NEC2++
//   directly.  The GPL boundary is preserved by the sidecar architecture.
//
// REGULATORY BASIS
//   47 CFR §73.215 — FM full-service contour protection.
//   47 CFR §73.62  — directional antenna pattern authorization.
//
// DETERMINISM GUARANTEE
//   All recommended phase values come directly from the NEC coarse grid
//   search (nec_bridge.py optimize_pattern()).  This module never invents
//   or fabricates antenna recommendations.

import { necOptimalPatternTable } from '../../evidence/nec/client.js';
import { studyContourPair } from './_du_pair_study.js';

/**
 * suggestDirectionalMitigation
 *
 * Given one failing §73.215 D/U pair and an antenna geometry,
 * asks the NEC sidecar to find a directional pattern that fixes it,
 * then re-runs the D/U study with the optimized pattern to confirm.
 *
 * Returns null if NEC is unavailable or optimization did not converge.
 * Never invents or fabricates recommendations — all values come from
 * the deterministic NEC optimizer.
 *
 * @param {object} params
 * @param {object} params.violation
 *   Output object from studyContourPair() — must include:
 *     bearing_u_to_d (via violation.bearings.u_to_d_deg),
 *     du_threshold_db, du_actual_db, plus the full U-station shape
 *     so we can re-run the D/U study.
 * @param {object} params.antenna_geometry
 *   { frequency_khz, ground, towers: [...] } — the subject station's
 *   NEC model (am-array spec format).
 * @param {object|null} params.necClient
 *   Result of makeNecClient().  If null, returns null immediately.
 * @param {object} [params.options]
 *   { phase_step_deg?, max_iterations? }
 *
 * Violation shape expected (from studyContourPair / section_73_215.js):
 *   violation.du_threshold_db   — required suppression threshold
 *   violation.du_actual_db      — actual D/U achieved (failing, so < threshold)
 *   violation.bearings.u_to_d_deg — bearing from U toward D
 *   violation.u_call, violation.u_facility_id  — U station identifiers
 *   violation.d_call, violation.d_facility_id  — D station identifiers
 *   (plus all other studyContourPair() fields for the re-run)
 */
export async function suggestDirectionalMitigation({
  violation,
  antenna_geometry,
  necClient,
  options = {}
}){
  // Gate 1: NEC sidecar must be available.
  if (!necClient) return null;

  // Gate 2: violation must carry the fields we need.
  const du_threshold   = Number(violation?.du_threshold_db);
  const du_actual      = Number(violation?.du_actual_db);
  const bearing_u_to_d = Number(violation?.bearings?.u_to_d_deg);

  if (!Number.isFinite(du_threshold) || !Number.isFinite(du_actual) ||
      !Number.isFinite(bearing_u_to_d)){
    return null;
  }

  // Required suppression = how much we need to improve the D/U, plus 1 dB margin.
  // D/U shortfall = du_threshold - du_actual (positive when failing).
  // We need to reduce U's ERP at the bearing_u_to_d by at least this much.
  const required_suppression_db = (du_threshold - du_actual) + 1;

  // Call the NEC optimizer.
  let optimizeResp;
  try {
    optimizeResp = await necClient.optimizePattern({
      base_model:             antenna_geometry,
      target_bearing_deg:     bearing_u_to_d,
      desired_suppression_db: required_suppression_db,
      phase_step_deg:         options.phase_step_deg  ?? 10,
      max_iterations:         options.max_iterations  ?? 36
    });
  } catch (e){
    // If the sidecar throws (network error, etc.), return null gracefully.
    return null;
  }

  // If the HTTP call itself failed (ok: false), return null.
  if (!optimizeResp?.ok) return null;

  const achieved = Number(optimizeResp.achieved_suppression_db);

  // Optimizer did not converge.
  if (optimizeResp.converged !== true){
    return {
      converged:              false,
      achieved_suppression_db: Number.isFinite(achieved) ? achieved : null,
      reason:                 'optimizer_did_not_converge'
    };
  }

  // Extract the optimal pattern table.
  const pattern_table = necOptimalPatternTable(optimizeResp);
  if (!pattern_table){
    return {
      converged:              false,
      achieved_suppression_db: achieved,
      reason:                 'pattern_table_extraction_failed'
    };
  }

  // Re-run the D/U study with the optimized pattern applied to the U station.
  // The violation object IS a studyContourPair result; we need the original
  // U and D station objects.  They are embedded in the violation as top-level
  // fields from the study — reconstruct minimal shapes for re-run.
  //
  // Note: studyContourPair() needs lat/lon/erp_kw/haat_m/frequency_mhz on U & D.
  // These are present on the violation via its parent study; the caller passes
  // the full studyContourPair result (forward or reverse leg) which has
  // u_erp_effective_kw, u_field_dbu_at_d_edge, etc. but NOT the raw station
  // objects.  We reconstruct from violation fields using u_station / d_station
  // if supplied (preferred), falling back to the flat fields the pair study
  // exposes (separation_km etc. are derived; lat/lon/haat come from the caller).
  const u_station = violation.u_station || null;
  const d_station = violation.d_station || null;

  let recheck = null;
  if (u_station && d_station){
    const u_with_pattern = { ...u_station, pattern_table };
    try {
      const recheckStudy = studyContourPair(u_with_pattern, d_station, {
        relationship:        violation.relationship       || 'co-channel',
        du_threshold_db:     du_threshold,
        protected_field_dbu: violation.d_protected_field_dbu ?? violation.protected_field_dbu ?? 60,
        protected_mode:      violation.protected_mode    || '50,50',
        interfering_mode:    violation.interfering_mode  || '50,10'
      });
      recheck = {
        du_actual_db:              recheckStudy.du_actual_db,
        pass:                      recheckStudy.pass,
        directional_pattern_applied: recheckStudy.directional_pattern_applied
      };
    } catch (e){
      recheck = {
        du_actual_db:              null,
        pass:                      null,
        directional_pattern_applied: true,
        recheck_error:             String(e?.message || e)
      };
    }
  }

  return {
    converged:               true,
    required_suppression_db: round4(required_suppression_db),
    achieved_suppression_db: round4(achieved),
    optimal_phases_deg:      optimizeResp.optimal_phases_deg || [],
    pattern_table,
    recheck
  };
}

function round4(n){ return Math.round(n * 10000) / 10000; }
