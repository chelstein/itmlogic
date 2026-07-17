// Canonical proof-of-performance rule.
//
// Replaces the contradictory proof predicates catalogued in
// docs/architecture-contradiction-origins.md §4, where NDA was
// simultaneously "8-radial proof required", "no proof required", and
// "required if <120 radials", and DA proof radials ranged 16/24/72
// depending on which guide answered.
//
// SINGLE RULE, keyed off the canonical modeled antenna mode.
// Rule bases verified against the codified CFR (2026-07-03):
//   DA modeled  → DA_FULL_PROOF per §73.151(a): field strength
//                 measurements on 6 radials for simple patterns, up to
//                 12 for complex patterns; monitoring points required.
//                 (The 72 five-degree azimuths of §73.150 are TABULATED
//                 PATTERN values, not measurement radials — legacy code
//                 conflated the two.)
//   NDA modeled → NDA_FIELD_PROOF per §73.186(a)(1): measurements on
//                 six or more radials, at least 15 measurements per
//                 radial; filed with FCC Form 302-AM.
//                 (The legacy "8 radials §73.154(b)" claim confused the
//                 PARTIAL-proof per-radial measurement count with the
//                 initial-proof radial count.)
//   MOM: §73.151(c) moment-method computer modeling is the alternative
//        to a measured DA proof (series-fed arrays) — noted in the
//        rationale, never auto-selected.
//   §73.154 governs PARTIAL proofs (≥8 measurements per radial on the
//   radials of the last complete proof) — post-licensing, not the CP
//   construction proof this module evaluates.

'use strict';

import { decision, ev, ANTENNA_MODES, EVALUATION_STATES, COMPLETION_STATES, CONFIDENCE_TIERS } from '../types.js';
import { isDirectionalMode } from './antennaMode.js';

const SOURCE = 'canonical/rules/proofOfPerformance';

export const PROOF_TYPES = Object.freeze({
  NDA_FIELD_PROOF: 'NDA_FIELD_PROOF',
  DA_FULL_PROOF: 'DA_FULL_PROOF',
  MOM_PROOF: 'MOM_PROOF',
  NONE: 'NONE',
  UNKNOWN: 'UNKNOWN',
});

const DA_RADIALS_MIN = 6;    // §73.151(a): 6 radials sufficient for simple patterns
const DA_RADIALS_MAX = 12;   // §73.151(a): up to 12 for complex patterns
const NDA_RADIALS_MIN = 6;   // §73.186(a)(1): six or more radials
const NDA_MEASUREMENTS_PER_RADIAL = 15;  // §73.186(a)(1): at least 15 per radial

/** Accept either a bare canonical mode string or an EngineeringValue. */
function modeOf(x) {
  if (x == null) return null;
  if (typeof x === 'string') return x;
  if (typeof x === 'object' && 'value' in x) return x.value ?? null;
  if (typeof x === 'object' && 'mode' in x) return x.mode ?? null;
  return null;
}

/**
 * What construction-permit proof of performance will the MODELED design
 * need, and does the likely-required mode change that answer for the
 * eventual filing design?
 *
 * @param {Object} p
 * @param {string|Object}  p.patternModeModeled   canonical mode (or ev/{mode})
 * @param {?string|Object} [p.patternModeRequired] canonical mode (or ev/{mode})
 * @returns {{
 *   constructionProofRequired: ?boolean,
 *   proofType: string,
 *   radialCount: ?number,
 *   monitorPointsRequired: ?boolean,
 *   form302Exhibits: string[],
 *   rationale: string,
 *   decision: Object,
 * }}
 */
export function evaluateProofRequirement({
  patternModeModeled,
  patternModeRequired = null,
} = {}) {
  const modeled = modeOf(patternModeModeled);
  const required = modeOf(patternModeRequired);

  const inputsUsed = [
    ev(modeled, {
      unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: ['canonical modeled antenna mode (what screening actually ran)'],
    }),
    ev(required, {
      unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: ['canonical likely-required antenna mode (WARN-grade)'],
    }),
  ];

  // ── Unknown modeled mode: refuse to guess ───────────────────────────
  if (modeled == null || !Object.values(ANTENNA_MODES).includes(modeled)) {
    const rationale =
      'Modeled antenna mode is missing or not a canonical AntennaMode; the ' +
      'proof-of-performance type cannot be determined. ' +
      'Inputs: patternModeModeled, patternModeRequired.';
    return {
      constructionProofRequired: null,
      proofType: PROOF_TYPES.UNKNOWN,
      radialCount: null,
      monitorPointsRequired: null,
      form302Exhibits: [],
      rationale,
      decision: decision({
        state: EVALUATION_STATES.UNKNOWN,
        required: null,
        completion: COMPLETION_STATES.NOT_RUN,
        result: EVALUATION_STATES.NOT_EVALUATED,
        ruleReferences: ['47 CFR §73.151', '47 CFR §73.186'],
        rationale,
        blockers: ['Modeled antenna mode unknown — proof type undetermined'],
        inputsUsed,
      }),
    };
  }

  const modeledIsDA = isDirectionalMode(modeled);
  const requiredIsDA = required != null && isDirectionalMode(required);
  const daGap = requiredIsDA && !modeledIsDA;

  if (modeledIsDA) {
    const rationale =
      `Modeled design is directional (${modeled}): a full directional proof of ` +
      `performance is required at construction — field strength measurements on ` +
      `${DA_RADIALS_MIN} radials for simple patterns, up to ${DA_RADIALS_MAX} for ` +
      'complex patterns (§73.151(a)), plus monitoring-point descriptions, filed ' +
      'with FCC Form 302-AM. The 72 five-degree azimuths of §73.150 are tabulated ' +
      'pattern values, not measurement radials. Alternative (not selected here): ' +
      '§73.151(c) moment-method (MoM) computer modeling proof may substitute for ' +
      'the measured full proof for series-fed arrays. ' +
      'Inputs: patternModeModeled.';
    return {
      constructionProofRequired: true,
      proofType: PROOF_TYPES.DA_FULL_PROOF,
      radialCount: DA_RADIALS_MIN,   // regulatory minimum; 6–12 by pattern complexity
      monitorPointsRequired: true,
      form302Exhibits: [
        'FCC Form 302-AM application for license',
        `Full directional proof of performance (${DA_RADIALS_MIN}–${DA_RADIALS_MAX} radials per §73.151(a))`,
        'Monitoring point descriptions and field-strength values',
        'Sampling system description',
      ],
      rationale,
      decision: decision({
        state: EVALUATION_STATES.WARN, // an obligation exists; not yet run
        required: true,
        completion: COMPLETION_STATES.RUN,
        result: EVALUATION_STATES.NOT_EVALUATED,
        ruleReferences: ['47 CFR §73.151(a)', '47 CFR §73.151(c)'],
        rationale,
        blockers: [],
        inputsUsed,
      }),
    };
  }

  // ── NDA modeled ──────────────────────────────────────────────────────
  const blockers = daGap
    ? [
        `Filing design will instead need ${PROOF_TYPES.DA_FULL_PROOF}: the ` +
        `likely-required mode is ${required}, but the modeled design is NDA — ` +
        'this proof determination applies only to the MODELED (NDA proxy) design.',
      ]
    : [];
  const rationale =
    `Modeled design is non-directional (${modeled}): an NDA field-strength ` +
    `proof is required — measurements on ${NDA_RADIALS_MIN} or more radials, at ` +
    `least ${NDA_MEASUREMENTS_PER_RADIAL} measurements per radial (§73.186(a)(1)), ` +
    'filed with FCC Form 302-AM.' +
    (daGap
      ? ` NOTE: the likely-required mode is ${required} (directional); the ` +
        `eventual filing design would need a ${PROOF_TYPES.DA_FULL_PROOF} ` +
        `(${DA_RADIALS_MIN}–${DA_RADIALS_MAX} radials, §73.151(a)) or the ` +
        '§73.151(c) moment-method alternative.'
      : '') +
    ' Inputs: patternModeModeled, patternModeRequired.';

  return {
    constructionProofRequired: true,
    proofType: PROOF_TYPES.NDA_FIELD_PROOF,
    radialCount: NDA_RADIALS_MIN,  // regulatory minimum ("six or more" per §73.186(a)(1))
    monitorPointsRequired: false,
    form302Exhibits: [
      'FCC Form 302-AM application for license',
      `NDA field-strength proof (≥${NDA_RADIALS_MIN} radials × ≥${NDA_MEASUREMENTS_PER_RADIAL} measurements per §73.186(a)(1))`,
    ],
    rationale,
    decision: decision({
      state: daGap ? EVALUATION_STATES.WARN : EVALUATION_STATES.WARN,
      required: true,
      completion: COMPLETION_STATES.RUN,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences: daGap
        ? ['47 CFR §73.186(a)(1)', '47 CFR §73.151(a)', '47 CFR §73.151(c)']
        : ['47 CFR §73.186(a)(1)'],
      rationale,
      blockers,
      inputsUsed,
    }),
  };
}
