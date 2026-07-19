// Canonical RF exposure rule — 47 CFR §1.1307/§1.1310 via OET Bulletin 65.
//
// Replaces the five ad-hoc fence-distance formulas and the λ/2π-as-fence
// conflation catalogued in docs/architecture-contradiction-origins.md §5.
// ALL distances here come from regulatory/oet65.js (the same module the
// colocation path and PDF report already use) — no local re-derivations.
//
// Four DISTINCT, individually labeled distances are returned; the
// reactive near-field boundary (λ/2π) is a physics regime boundary and is
// NEVER presented as a fence distance.

'use strict';

import { decision, ev, EVALUATION_STATES, COMPLETION_STATES, CONFIDENCE_TIERS } from '../types.js';
import { complianceDistance_m, nearFieldBoundary_m } from '../../../regulatory/oet65.js';

const SOURCE = 'canonical/rules/rfExposure';

/** Practical minimum fence distance, m (base-insulator/ATU physical exclusion). */
export const MIN_PRACTICAL_FENCE_M = 3;

/** ERP above which routine RF evaluation is unambiguously required (kW). */
export const ROUTINE_EVALUATION_ERP_KW = 1;

/**
 * How the RF-exposure boundaries were derived — a single top-level tag,
 * distinct from the per-boundary `method` string on each labeledDistance
 * (canonical-consistency-audit-followup, Phase 2 item 3).
 *   ANALYTIC          — computed from the OET-65 closed-form distance
 *                        formulas (oet65.complianceDistance_m /
 *                        nearFieldBoundary_m); the normal case.
 *   MEASUREMENT        — derived from an actual field survey. This engine
 *                        has no field-measurement input path today — this
 *                        tag is DOCUMENTED AS UNREACHABLE, not fabricated;
 *                        see evaluateRfExposure()'s doc comment.
 *   CONSERVATIVE_SCREEN — the analytic formula did not resolve (missing
 *                        power/frequency) and a practical-minimum
 *                        placeholder was substituted for the fence
 *                        distance only — NOT a compliance result.
 *   NOT_EVALUATED       — radiated power unknown; no boundary could be
 *                        computed at all.
 * @typedef {'ANALYTIC'|'MEASUREMENT'|'CONSERVATIVE_SCREEN'|'NOT_EVALUATED'} RfExposureEvaluationMethod
 */
export const RF_EXPOSURE_EVALUATION_METHODS = Object.freeze({
  ANALYTIC:             'ANALYTIC',
  MEASUREMENT:          'MEASUREMENT',
  CONSERVATIVE_SCREEN:  'CONSERVATIVE_SCREEN',
  NOT_EVALUATED:        'NOT_EVALUATED',
});

function labeledDistance({ value_m, label, method, assumptions }) {
  return {
    value_m,
    unit: 'm',
    label,
    method,
    ev: ev(value_m, {
      unit: 'm',
      source: SOURCE,
      confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions,
    }),
  };
}

/**
 * RF-exposure distances and evaluation-requirement decision for a
 * candidate AM design.
 *
 * @param {Object}  p
 * @param {number}  p.frequency_khz
 * @param {number}  p.tpo_kw                 transmitter power output, kW
 * @param {?number} [p.erp_kw=null]          radiated power if known; for AM
 *                                           monopoles TPO ≈ radiated power
 * @param {?number} [p.selectedDesignHeightM=null]  informational
 * @returns {{
 *   reactiveNearFieldBoundaryM: Object,
 *   controlledMpeBoundaryM: Object,
 *   uncontrolledMpeBoundaryM: Object,
 *   recommendedFenceDistanceM: Object,
 *   evaluationMethod: RfExposureEvaluationMethod,
 *   evaluationRequired: Object,   // RegulatoryDecision
 * }}
 */
export function evaluateRfExposure({
  frequency_khz,
  tpo_kw,
  erp_kw = null,
  selectedDesignHeightM = null,
} = {}) {
  const f_mhz = Number(frequency_khz) / 1000;
  const power_kw = Number.isFinite(Number(erp_kw)) && erp_kw != null
    ? Number(erp_kw)
    : Number(tpo_kw);
  const powerBasis = erp_kw != null
    ? 'operator-supplied ERP'
    : 'TPO used as radiated power (AM series-fed monopole assumption)';

  const inputsUsed = [
    ev(Number(frequency_khz), {
      unit: 'kHz', source: SOURCE, confidence: CONFIDENCE_TIERS.FILING_GRADE,
      assumptions: ['operator-supplied frequency'],
    }),
    ev(power_kw, {
      unit: 'kW', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: [powerBasis],
    }),
    ev(selectedDesignHeightM, {
      unit: 'm', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: ['selected design height (informational for exposure geometry)'],
    }),
  ];

  // ── 1. Reactive near-field boundary — physics regime, NOT a fence ───
  const rnf = nearFieldBoundary_m(f_mhz);
  const reactiveNearFieldBoundaryM = labeledDistance({
    value_m: rnf == null ? null : Number(rnf.toFixed(2)),
    label: 'reactive near-field boundary — NOT a fence distance',
    method: 'lambda/2pi',
    assumptions: [
      'λ/(2π) marks where far-field power-density formulas become valid',
      'inside this radius OET-65 near-field E/H analysis applies',
      'this boundary must never be used as an MPE fence distance',
    ],
  });

  // ── 2/3. MPE compliance boundaries from oet65.js ────────────────────
  const ctrl = complianceDistance_m({
    erp_kw: power_kw, frequency_mhz: f_mhz, exposure_class: 'controlled',
    ground_reflection: true,
  });
  const unctrl = complianceDistance_m({
    erp_kw: power_kw, frequency_mhz: f_mhz, exposure_class: 'uncontrolled',
    ground_reflection: true,
  });

  const controlledMpeBoundaryM = labeledDistance({
    value_m: ctrl?.distance_m ?? null,
    label: 'controlled (occupational) MPE compliance distance',
    method: ctrl?.formula ?? 'oet65.complianceDistance_m (controlled) — unavailable',
    assumptions: [
      powerBasis,
      'ground-reflection (4×) OET-65 factor applied (conservative)',
      ctrl?.mpe_basis ?? 'MPE basis unavailable',
    ],
  });
  const uncontrolledMpeBoundaryM = labeledDistance({
    value_m: unctrl?.distance_m ?? null,
    label: 'uncontrolled (general population) MPE compliance distance',
    method: unctrl?.formula ?? 'oet65.complianceDistance_m (uncontrolled) — unavailable',
    assumptions: [
      powerBasis,
      'ground-reflection (4×) OET-65 factor applied (conservative)',
      unctrl?.mpe_basis ?? 'MPE basis unavailable',
    ],
  });

  // ── 4. Recommended fence = uncontrolled MPE distance, min 3 m ──────
  const fenceRaw = unctrl?.distance_m ?? null;
  const fence_m = fenceRaw == null
    ? MIN_PRACTICAL_FENCE_M
    : Math.max(fenceRaw, MIN_PRACTICAL_FENCE_M);
  const recommendedFenceDistanceM = labeledDistance({
    value_m: Number(fence_m.toFixed(2)),
    label: 'recommended fence distance (uncontrolled MPE compliance distance, 3 m practical minimum)',
    method:
      'OET-65 uncontrolled MPE compliance distance (oet65.complianceDistance_m), ' +
      `floored at the ${MIN_PRACTICAL_FENCE_M} m practical minimum`,
    assumptions: [
      powerBasis,
      fenceRaw == null
        ? 'MPE distance unavailable — practical minimum used as placeholder, NOT a compliance result'
        : 'fence encloses the region where general-population MPE could be exceeded',
      'reactive near-field boundary (λ/2π) is intentionally NOT the fence basis',
    ],
  });

  // ── Evaluation-required decision — §1.1307(a)(4) (post-2019) ───────
  const refs = ['47 CFR §1.1307(a)(4)', '47 CFR §1.1310', 'OET Bulletin 65'];
  let evaluationRequired;
  if (Number.isFinite(power_kw) && power_kw > ROUTINE_EVALUATION_ERP_KW) {
    evaluationRequired = decision({
      state: EVALUATION_STATES.WARN,
      required: true,
      completion: COMPLETION_STATES.RUN,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences: refs,
      rationale:
        `Radiated power ${power_kw} kW (${powerBasis}) exceeds ` +
        `${ROUTINE_EVALUATION_ERP_KW} kW: under the post-2019 §1.1307(a)(4) / ` +
        'OET-65 framework the station does not qualify for the low-power ' +
        'exemption and a routine RF exposure evaluation is required. The ' +
        'distances above are screening-grade inputs to that evaluation, not ' +
        'the evaluation itself. ' +
        'Inputs: frequency_khz, tpo_kw/erp_kw.',
      blockers: ['Routine RF exposure evaluation not yet performed'],
      inputsUsed,
    });
  } else if (Number.isFinite(power_kw)) {
    evaluationRequired = decision({
      state: EVALUATION_STATES.WARN,
      required: null,
      completion: COMPLETION_STATES.PARTIAL,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences: refs,
      rationale:
        `Radiated power ${power_kw} kW (${powerBasis}) is at or below ` +
        `${ROUTINE_EVALUATION_ERP_KW} kW: the station MAY qualify for a ` +
        '§1.1307(a)(4) exemption, but exemption criteria must be verified ' +
        '(separation distances and aggregate-environment contributions) — ' +
        'exemption is never assumed at screening. ' +
        'Inputs: frequency_khz, tpo_kw/erp_kw.',
      blockers: ['§1.1307(a)(4) exemption criteria must be verified'],
      inputsUsed,
    });
  } else {
    evaluationRequired = decision({
      state: EVALUATION_STATES.UNKNOWN,
      required: null,
      completion: COMPLETION_STATES.NOT_RUN,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences: refs,
      rationale:
        'Radiated power unknown — the §1.1307(a)(4) evaluation trigger cannot ' +
        'be assessed. Inputs: tpo_kw/erp_kw (missing).',
      blockers: ['Radiated power not available'],
      inputsUsed,
    });
  }

  // ── evaluationMethod — a single top-level tag for how the boundaries
  // above were derived; see RF_EXPOSURE_EVALUATION_METHODS for the exact
  // meaning of each value.
  const evaluationMethod = !Number.isFinite(power_kw)
    ? RF_EXPOSURE_EVALUATION_METHODS.NOT_EVALUATED
    : (ctrl?.distance_m != null && unctrl?.distance_m != null)
    ? RF_EXPOSURE_EVALUATION_METHODS.ANALYTIC
    : RF_EXPOSURE_EVALUATION_METHODS.CONSERVATIVE_SCREEN;

  return {
    reactiveNearFieldBoundaryM,
    controlledMpeBoundaryM,
    uncontrolledMpeBoundaryM,
    recommendedFenceDistanceM,
    evaluationMethod,
    evaluationRequired,
  };
}
