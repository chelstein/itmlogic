// Canonical AM result pipeline — shared vocabulary and provenance-carrying
// value constructors.
//
// This module is the single source of the enums and record shapes used by
// the canonical pipeline (see docs/architecture-contradiction-origins.md,
// "Remediation").  Every derived engineering fact must be wrapped in an
// EngineeringValue (provenance is mandatory), and every regulatory
// decision must be built through decision() so that structurally
// contradictory records (e.g. required === true with state NOT_REQUIRED)
// cannot exist at all — they throw at construction time.

'use strict';

/* ── JSDoc typedefs ──────────────────────────────────────────────────── */

/**
 * Confidence tier for a derived value or a whole candidate axis.
 * @typedef {'FILING_GRADE'|'ENGINEERING_GRADE'|'SCREENING'|'LOW'} ConfidenceTier
 */

/**
 * Outcome of evaluating a regulatory rule.
 * @typedef {'PASS'|'FAIL'|'WARN'|'NOT_REQUIRED'|'NOT_EVALUATED'|'UNKNOWN'} EvaluationState
 */

/**
 * Whether the evaluation machinery for a rule actually executed.
 * @typedef {'RUN'|'NOT_RUN'|'PARTIAL'} CompletionState
 */

/**
 * Canonical antenna-mode vocabulary (replaces the four divergent
 * vocabularies catalogued in the contradiction audit).
 * @typedef {'NDA'|'DA_DAY'|'DA_NIGHT'|'DA_DAY_AND_NIGHT'} AntennaMode
 */

/**
 * Canonical recommendation ladder.
 * @typedef {'SCREEN_FURTHER'|'ADVANCE_TO_DESK_STUDY'|'ADVANCE_TO_FIELD_VALIDATION'|'ADVANCE_TO_PARCEL_NEGOTIATION'|'ENGINEERING_READY'|'FILING_READY'|'REJECT'} RecommendationLevel
 */

/**
 * A derived engineering fact with mandatory provenance.
 * @typedef {Object} EngineeringValue
 * @property {*}              value        The datum itself.
 * @property {?string}        unit         Unit string (null for unitless).
 * @property {string}         source       Module / dataset that derived it.
 * @property {ConfidenceTier} confidence   Confidence tier of the derivation.
 * @property {string[]}       assumptions  Assumptions baked into the value.
 * @property {*}              uncertainty  Optional uncertainty descriptor.
 */

/**
 * One regulatory decision, produced by exactly one rule function.
 * @typedef {Object} RegulatoryDecision
 * @property {EvaluationState} state          Outcome of the rule.
 * @property {?boolean}        required       Is the rule applicable/required.
 * @property {CompletionState} completion     Did the evaluation actually run.
 * @property {EvaluationState} result         Detailed evaluation result.
 * @property {string[]}        ruleReferences CFR/rule references.
 * @property {string}          rationale      Human-readable explanation.
 * @property {string[]}        blockers       What prevents completion.
 * @property {Array<Object>}   inputsUsed     Inputs (ideally EngineeringValues).
 */

/* ── Frozen enum objects ─────────────────────────────────────────────── */

/** @type {Readonly<Record<ConfidenceTier, ConfidenceTier>>} */
export const CONFIDENCE_TIERS = Object.freeze({
  FILING_GRADE:      'FILING_GRADE',
  ENGINEERING_GRADE: 'ENGINEERING_GRADE',
  SCREENING:         'SCREENING',
  LOW:               'LOW',
});

/** @type {Readonly<Record<EvaluationState, EvaluationState>>} */
export const EVALUATION_STATES = Object.freeze({
  PASS:          'PASS',
  FAIL:          'FAIL',
  WARN:          'WARN',
  NOT_REQUIRED:  'NOT_REQUIRED',
  NOT_EVALUATED: 'NOT_EVALUATED',
  UNKNOWN:       'UNKNOWN',
});

/** @type {Readonly<Record<CompletionState, CompletionState>>} */
export const COMPLETION_STATES = Object.freeze({
  RUN:     'RUN',
  NOT_RUN: 'NOT_RUN',
  PARTIAL: 'PARTIAL',
});

/** @type {Readonly<Record<AntennaMode, AntennaMode>>} */
export const ANTENNA_MODES = Object.freeze({
  NDA:              'NDA',
  DA_DAY:           'DA_DAY',
  DA_NIGHT:         'DA_NIGHT',
  DA_DAY_AND_NIGHT: 'DA_DAY_AND_NIGHT',
});

/** @type {Readonly<Record<RecommendationLevel, RecommendationLevel>>} */
export const RECOMMENDATION_LEVELS = Object.freeze({
  SCREEN_FURTHER:                'SCREEN_FURTHER',
  ADVANCE_TO_DESK_STUDY:         'ADVANCE_TO_DESK_STUDY',
  ADVANCE_TO_FIELD_VALIDATION:   'ADVANCE_TO_FIELD_VALIDATION',
  ADVANCE_TO_PARCEL_NEGOTIATION: 'ADVANCE_TO_PARCEL_NEGOTIATION',
  ENGINEERING_READY:             'ENGINEERING_READY',
  FILING_READY:                  'FILING_READY',
  REJECT:                        'REJECT',
});

/* ── Constructors ────────────────────────────────────────────────────── */

/**
 * Build a frozen EngineeringValue.  Provenance is mandatory: a value with
 * no source or no confidence tier cannot be constructed.
 *
 * @param {*} value
 * @param {Object}         opts
 * @param {?string}        [opts.unit]
 * @param {string}         opts.source        REQUIRED — deriving module.
 * @param {ConfidenceTier} opts.confidence    REQUIRED — must be a known tier.
 * @param {string[]}       [opts.assumptions]
 * @param {*}              [opts.uncertainty]
 * @returns {EngineeringValue}
 */
export function ev(value, opts) {
  if (opts === null || typeof opts !== 'object') {
    throw new TypeError('ev(): an options object with source and confidence is required');
  }
  const {
    unit = null,
    source,
    confidence,
    assumptions = [],
    uncertainty = null,
  } = opts;

  if (typeof source !== 'string' || source.trim() === '') {
    throw new TypeError('ev(): source is mandatory (provenance) and must be a non-empty string');
  }
  if (confidence === undefined || confidence === null) {
    throw new TypeError('ev(): confidence is mandatory (provenance)');
  }
  if (!Object.prototype.hasOwnProperty.call(CONFIDENCE_TIERS, confidence)) {
    throw new TypeError(
      `ev(): confidence "${confidence}" is not a known ConfidenceTier ` +
      `(expected one of ${Object.keys(CONFIDENCE_TIERS).join(', ')})`
    );
  }
  if (!Array.isArray(assumptions)) {
    throw new TypeError('ev(): assumptions must be an array of strings');
  }

  return Object.freeze({
    value,
    unit,
    source,
    confidence,
    assumptions: Object.freeze(assumptions.slice()),
    uncertainty,
  });
}

/**
 * Build a frozen RegulatoryDecision.  Throws on structurally contradictory
 * input — most importantly required === true combined with state
 * 'NOT_REQUIRED', which is the contradiction class the audit found live
 * in production output.
 *
 * @param {Object}          opts
 * @param {EvaluationState} opts.state            REQUIRED.
 * @param {?boolean}        opts.required         true / false / null (unknown).
 * @param {CompletionState} [opts.completion]     default 'NOT_RUN'.
 * @param {EvaluationState} [opts.result]         default 'NOT_EVALUATED'.
 * @param {string[]}        [opts.ruleReferences]
 * @param {string}          opts.rationale        REQUIRED.
 * @param {string[]}        [opts.blockers]
 * @param {Array<Object>}   [opts.inputsUsed]
 * @returns {RegulatoryDecision}
 */
export function decision(opts) {
  if (opts === null || typeof opts !== 'object') {
    throw new TypeError('decision(): an options object is required');
  }
  const {
    state,
    required,
    completion = COMPLETION_STATES.NOT_RUN,
    result = EVALUATION_STATES.NOT_EVALUATED,
    ruleReferences = [],
    rationale,
    blockers = [],
    inputsUsed = [],
  } = opts;

  if (!Object.prototype.hasOwnProperty.call(EVALUATION_STATES, state)) {
    throw new TypeError(
      `decision(): state "${state}" is not a valid EvaluationState ` +
      `(expected one of ${Object.keys(EVALUATION_STATES).join(', ')})`
    );
  }
  if (typeof rationale !== 'string' || rationale.trim() === '') {
    throw new TypeError('decision(): rationale is mandatory and must be a non-empty string');
  }
  if (required !== undefined && required !== null && typeof required !== 'boolean') {
    throw new TypeError('decision(): required must be a boolean or null');
  }
  if (!Object.prototype.hasOwnProperty.call(COMPLETION_STATES, completion)) {
    throw new TypeError(
      `decision(): completion "${completion}" is not a valid CompletionState ` +
      `(expected one of ${Object.keys(COMPLETION_STATES).join(', ')})`
    );
  }
  if (!Object.prototype.hasOwnProperty.call(EVALUATION_STATES, result)) {
    throw new TypeError(
      `decision(): result "${result}" is not a valid EvaluationState`
    );
  }
  if (!Array.isArray(ruleReferences) || !Array.isArray(blockers) || !Array.isArray(inputsUsed)) {
    throw new TypeError('decision(): ruleReferences, blockers, and inputsUsed must be arrays');
  }

  // Contradiction rejected at construction time — a rule cannot be both
  // required and NOT_REQUIRED.
  if (required === true && state === EVALUATION_STATES.NOT_REQUIRED) {
    throw new RangeError(
      'decision(): contradictory decision — required === true but state === "NOT_REQUIRED"'
    );
  }

  return Object.freeze({
    state,
    required: required === undefined ? null : required,
    completion,
    result,
    ruleReferences: Object.freeze(ruleReferences.slice()),
    rationale,
    blockers: Object.freeze(blockers.slice()),
    inputsUsed: Object.freeze(inputsUsed.slice()),
  });
}
