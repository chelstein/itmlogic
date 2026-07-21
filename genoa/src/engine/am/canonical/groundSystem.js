// Canonical ground-system stage — ONE selected scenario, alternatives
// clearly labeled, decision-free.
//
// Replaces the divergent radial specs catalogued in
// docs/architecture-contradiction-origins.md §2 (radial counts
// 120/90/60/30/160, lengths 0.35λ/λ4/λ8/1.5×0.35λ/0.4h, and THREE
// incompatible ground-loss formulas).  Exactly one ground-loss formula
// is used here — the Terman estimate already used by siteOptimizer's
// ground_system_design_specification guide (~line 5156):
//
//   ρ  = 1000 / σ_mS/m                    [Ω·m]   (σ mS/m → S/m is σ×10⁻³;
//                                                   ρ = 1/(σ×10⁻³) = 1000/σ)
//   R_g = min(30 Ω, 120·ρ / (N·L))        [Ω]
//
// Dimensional check: 120 [Ω] · ρ [Ω·m] / (N [1] · L [m]) → the 120
// coefficient is dimensionless in Terman's fit with ρ in Ω·m and L in m,
// leaving Ω·m/m = Ω.  The 30 Ω cap reflects the formula's validity
// ceiling for sparse systems.  This module is DECISION-FREE: it emits
// EngineeringValues only, never RegulatoryDecisions — compliance
// consequences (efficiency showings) belong to the rules layer.
//
// Only selectedScenario may feed the cost model; validation.js
// invariant (e) enforces that the costed radial count equals
// selectedScenario.radialCount.

'use strict';

import { ev, CONFIDENCE_TIERS } from './types.js';
import { WAVELENGTH_NUMERATOR_KM_KHZ } from './antennaDesign.js';

const SOURCE = 'canonical/groundSystem';

export const GROUND_LOSS_FORMULA_NAME =
  'Terman ground-loss estimate R_g = min(30 Ω, 120·ρ/(N·L)), ρ = 1000/σ_mS/m Ω·m ' +
  '(same formula as siteOptimizer ground_system_design_specification)';

/** λ/4 monopole radiation resistance used for the efficiency estimate (Ω). */
export const QUARTER_WAVE_RADIATION_RESISTANCE_OHM = 36.6;

/** The three canonical ground-system scenarios. */
export const GROUND_SCENARIOS = Object.freeze({
  STANDARD_120: Object.freeze({
    key: 'STANDARD_120',
    radialCount: 120,
    radialLengthWavelengths: 0.35,
    basis: '§73.189(b)(4) reference standard',
  }),
  COMPACT: Object.freeze({
    key: 'COMPACT',
    radialCount: 60,
    radialLengthWavelengths: 0.25,
    basis: 'constrained-site engineering practice; requires efficiency showing',
  }),
  EXTENDED: Object.freeze({
    key: 'EXTENDED',
    radialCount: 120,
    radialLengthWavelengths: 0.4,
    basis: 'extended system for poor conductivity / efficiency-certification targets',
  }),
});

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Materialize one scenario at a given frequency/conductivity.
 * @returns scenario record with EngineeringValue-wrapped derived figures.
 */
function materializeScenario(spec, { lambda, sigma_msm, towersCount, role }) {
  const radialLengthM = round2(spec.radialLengthWavelengths * lambda);
  const wireLengthM = round2(spec.radialCount * radialLengthM * towersCount);

  const sigma = Number(sigma_msm);
  const sigmaKnown = Number.isFinite(sigma) && sigma > 0;
  const rho = sigmaKnown ? 1000 / sigma : null;
  const groundLoss = sigmaKnown
    ? round2(Math.min(30, (120 * rho) / (spec.radialCount * radialLengthM)))
    : null;

  const groundLossOhm = ev(groundLoss, {
    unit: 'ohm', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
    assumptions: [
      GROUND_LOSS_FORMULA_NAME,
      sigmaKnown
        ? `ρ = ${round2(rho)} Ω·m from σ = ${sigma} mS/m; N = ${spec.radialCount}; L = ${radialLengthM} m`
        : 'conductivity unknown — ground loss not estimable',
      'per-tower estimate; screening-grade only',
    ],
  });

  return Object.freeze({
    key: spec.key,
    role,
    // recommendationStatus (canonical-consistency-audit-followup, Phase 3
    // item 2): an explicit alias of `role` using the spec's requested
    // field name, so any consumer checking for
    // 'SELECTED'/'ALTERNATIVE'/'NOT_RECOMMENDED' finds it without a
    // rename of the existing `role` field. NOT_RECOMMENDED is never
    // emitted here: this module is deliberately DECISION-FREE (see file
    // header) and has no rule basis to flag any of the three scenarios as
    // unsuitable -- COMPACT and EXTENDED are legitimate alternatives
    // requiring their own showings, not disqualified options. Inventing a
    // NOT_RECOMMENDED judgment without a rule basis was explicitly out of
    // scope for this pass.
    recommendationStatus: role,
    basis: spec.basis,
    radialCount: spec.radialCount,
    radialLengthWavelengths: spec.radialLengthWavelengths,
    radialLengthM,
    towersCount,
    wireLengthM,
    groundLossOhm,
  });
}

/**
 * Derive the canonical ground system: one SELECTED scenario (the only
 * one allowed to feed costs) plus the alternatives, labeled.
 *
 * @param {Object}  p
 * @param {number}  p.frequency_khz
 * @param {?number} p.sigma_msm                 ground conductivity, mS/m
 * @param {string}  [p.selectedScenarioKey='STANDARD_120']
 * @param {boolean} [p.isDirectional=false]
 * @param {number}  [p.towersCount=1]
 * @returns {{
 *   selectedScenario: Object,
 *   efficiencyEstimate: Object,   // ev, SCREENING, fraction 0–1
 *   scenarios: Object[],          // alternatives, role 'ALTERNATIVE'
 *   groundLossFormula: string,
 * }}
 */
export function deriveGroundSystem({
  frequency_khz,
  sigma_msm,
  selectedScenarioKey = 'STANDARD_120',
  isDirectional = false,
  towersCount = 1,
} = {}) {
  const f = Number(frequency_khz);
  if (!Number.isFinite(f) || f <= 0) {
    throw new TypeError(`deriveGroundSystem(): frequency_khz must be a positive finite number, got ${frequency_khz}`);
  }
  if (!Object.prototype.hasOwnProperty.call(GROUND_SCENARIOS, selectedScenarioKey)) {
    throw new RangeError(
      `deriveGroundSystem(): unknown scenario "${selectedScenarioKey}" ` +
      `(expected one of ${Object.keys(GROUND_SCENARIOS).join(', ')})`
    );
  }
  let towers = Number(towersCount);
  if (!Number.isFinite(towers) || towers < 1) towers = 1;
  towers = Math.round(towers);
  if (isDirectional && towers < 2) {
    // Directional arrays need ≥2 towers; keep the supplied count but the
    // assumption is recorded on the selected scenario below.
    towers = Math.max(towers, 2);
  }
  if (!isDirectional) towers = Math.min(towers, 1) || 1;

  const lambda = WAVELENGTH_NUMERATOR_KM_KHZ / f;

  const selectedScenario = materializeScenario(GROUND_SCENARIOS[selectedScenarioKey], {
    lambda, sigma_msm, towersCount: towers, role: 'SELECTED',
  });

  const scenarios = Object.values(GROUND_SCENARIOS)
    .filter((s) => s.key !== selectedScenarioKey)
    .map((s) => materializeScenario(s, {
      lambda, sigma_msm, towersCount: towers, role: 'ALTERNATIVE',
    }));

  const rg = selectedScenario.groundLossOhm.value;
  const rr = QUARTER_WAVE_RADIATION_RESISTANCE_OHM;
  const eta = rg == null ? null : round2(rr / (rr + rg) * 10000) / 10000;
  const efficiencyEstimate = ev(eta, {
    unit: 'fraction', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
    assumptions: [
      `η = R_r/(R_r + R_g) with R_r = ${rr} Ω (λ/4 monopole reference) and R_g from the ${selectedScenarioKey} scenario`,
      'screening-grade proxy; a §73.186 field-strength proof or moment-method model is the authoritative efficiency basis',
      ...(rg == null ? ['conductivity unknown — efficiency not estimable'] : []),
    ],
  });

  return Object.freeze({
    selectedScenario,
    efficiencyEstimate,
    scenarios: Object.freeze(scenarios),
    groundLossFormula: GROUND_LOSS_FORMULA_NAME,
  });
}
