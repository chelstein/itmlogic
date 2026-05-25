// §73.215 / §73.207 "path to compliance" remediation analysis.
//
// When an exhibit is NON-COMPLIANT on distance/contour-protection, this
// runs a BOUNDED, free-space ERP × HAAT parameter sweep (reusing the
// existing sweep engine + scorer) to find the least-power configuration
// that would qualify under §73.207 OR §73.215 — i.e. the engineering
// "alternative route" to authorization.  STRICTLY ADVISORY: it never
// changes the compliance determination; it surfaces a remediation
// option for the engineer of record.
//
// Recursion-safe by construction: the sweep calls the engine compute()
// directly (never the job runner / this module), and this module is
// only invoked from the job layer — so a sweep combo can never
// re-trigger another remediation.

import { sweepParameters } from './sweepEngine.js';

// True when the exhibit failed the distance/contour-protection gates
// (§73.207 spacing or §73.215 contour protection) — the only failures a
// power/height/pattern sweep can address.
export function needsRemediation(exhibit){
  const reg = exhibit?.regulatory_compliance;
  if (!reg) return false;
  const cite = String(reg.cite || '');
  const failedContour = reg.pass === false && /73\.215|73\.207/.test(cite);
  const failed207     = reg.section_73_207 && reg.section_73_207.pass === false;
  return !!(failedContour || failed207);
}

// Build a downward ERP × HAAT envelope from the current facility: ERP
// from ~10% up to current (≈6 points), HAAT from the §73.333 30 m floor
// up to current (≈4 points) → ≤ ~24 combos.  Reducing either shrinks
// the interfering contour and recovers D/U margin.
export function buildRemediationRanges(baseInputs){
  const ranges = {};
  const erp  = Number(baseInputs?.erp_kw ?? baseInputs?.erp);
  const haat = Number(baseInputs?.haat_m ?? baseInputs?.haat);
  if (Number.isFinite(erp) && erp > 0.1){
    const min  = Math.max(0.1, +(erp * 0.1).toFixed(2));
    const step = Math.max(0.1, +((erp - min) / 5).toFixed(2));
    ranges.erp_kw = { min, max: erp, step };
  }
  if (Number.isFinite(haat) && haat > 30){
    const step = Math.max(10, Math.round((haat - 30) / 3));
    ranges.haat_m = { min: 30, max: haat, step };
  }
  return ranges;
}

export async function runRemediationSweep({
  baseInputs,
  evidence    = {},
  validation,
  computeFn,
  maxCombos   = 24
} = {}){
  const ranges = buildRemediationRanges(baseInputs);
  if (!Object.keys(ranges).length){
    return { available: false, reason: 'no ERP/HAAT available to vary' };
  }
  // Strip per-radial terrain so each combo's haat_m drives a flat HAAT
  // profile (same reasoning as the /sweep route); keep other evidence.
  // eslint-disable-next-line no-unused-vars
  const { terrain_haat_per_radial, terrain_haat_requested, ...ev } = evidence || {};

  const sweep = await sweepParameters({
    baseInputs,
    sweepRanges: ranges,
    evidence:    ev,
    validation,
    options:     { max_combinations: maxCombos, top_n: 5, only_compliant: true },
    computeFn
  });

  const best = sweep.best;
  return {
    available:   true,
    none_found:  !best,
    evaluated:   sweep.total_evaluated,
    searched:    ranges,
    recommended: best ? {
      erp_kw:          best.combo?.erp_kw ?? null,
      haat_m:          best.combo?.haat_m ?? null,
      service_km2:     best.coverage_km2 ?? null,
      compliance_path: best.compliance?.distance_path || '§73.215'
    } : null,
    candidates: (sweep.top_compliant || []).slice(0, 5).map(r => ({
      erp_kw:      r.combo?.erp_kw ?? null,
      haat_m:      r.combo?.haat_m ?? null,
      service_km2: r.coverage_km2 ?? null
    }))
  };
}
