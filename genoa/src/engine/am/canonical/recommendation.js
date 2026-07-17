// Canonical recommendation stage — gate-tied levels with an explicit
// ceiling ladder.
//
// Replaces the recommendation defects catalogued in
// docs/architecture-contradiction-origins.md §§10, 13: colocation
// fabricated nif_status from the score category, "filing-ready" labels
// rode on candidates whose required studies never ran, and proxy inputs
// issued hard verdicts.  This module contains NO independent engineering
// logic — every rationale string is composed from the structured inputs
// (confidence axes, regulatory decisions, scoring context, validation
// report) and nothing else.
//
// ── THE GATE LADDER ────────────────────────────────────────────────────
// Levels are ordered; each gate imposes a CEILING (the candidate can
// never be recommended above it) and the final level is the lowest
// ceiling any gate imposed.  REJECT bypasses the ladder and fires only
// on VERIFIED hard failures (a required decision that actually RAN and
// returned FAIL).
//
//   rank 0  SCREEN_FURTHER                (floor; also forced by
//                                          inconsistent validation)
//   rank 1  ADVANCE_TO_DESK_STUDY         ceiling while any required
//                                          decision (e.g. NIF) is NOT_RUN,
//                                          or engineering data is LOW-tier
//   rank 2  ADVANCE_TO_FIELD_VALIDATION   ceiling while engineering data
//                                          is only SCREENING-tier
//   rank 3  ADVANCE_TO_PARCEL_NEGOTIATION ceiling while parcel/site-control
//                                          data is absent... (see gate P)
//   rank 4  ENGINEERING_READY             ceiling while filingReadiness
//                                          is not ready
//   rank 5  FILING_READY                  requires filingReadiness.ready,
//                                          all required decisions RUN, and
//                                          validation.consistent === true
//
// Gates (applied as ceilings, lowest wins):
//   V — validation missing/inconsistent          → SCREEN_FURTHER (+ technicalWarning)
//   R — any required decision NOT_RUN/UNKNOWN    → ADVANCE_TO_DESK_STUDY
//   E — engineeringDataConfidence LOW            → ADVANCE_TO_DESK_STUDY
//       engineeringDataConfidence SCREENING      → ADVANCE_TO_FIELD_VALIDATION
//   P — parcel/site-control data absent          → ADVANCE_TO_FIELD_VALIDATION
//       (cannot advance to parcel negotiation without parcel data)
//   F — filingReadiness.ready !== true           → ENGINEERING_READY
//   REJECT — required decision RAN and FAILed    → REJECT (verified hard fail only;
//       proxy-grade WARNs never reject)

'use strict';

import { RECOMMENDATION_LEVELS, CONFIDENCE_TIERS } from './types.js';
import { collectRegulatoryDecisions } from './confidence.js';

const SOURCE = 'canonical/recommendation';

/** The ladder, low to high. REJECT sits outside the ladder. */
export const GATE_LADDER = Object.freeze([
  RECOMMENDATION_LEVELS.SCREEN_FURTHER,
  RECOMMENDATION_LEVELS.ADVANCE_TO_DESK_STUDY,
  RECOMMENDATION_LEVELS.ADVANCE_TO_FIELD_VALIDATION,
  RECOMMENDATION_LEVELS.ADVANCE_TO_PARCEL_NEGOTIATION,
  RECOMMENDATION_LEVELS.ENGINEERING_READY,
  RECOMMENDATION_LEVELS.FILING_READY,
]);

const RANK = Object.freeze(Object.fromEntries(GATE_LADDER.map((l, i) => [l, i])));

/** Ladder rank of a level (REJECT has no rank). */
export function ladderRank(level) {
  return Object.prototype.hasOwnProperty.call(RANK, level) ? RANK[level] : null;
}

/**
 * Derive the gate-tied recommendation for a candidate.
 *
 * @param {Object}  p
 * @param {Object}  p.confidence   the four axes from deriveConfidence()
 * @param {Object}  [p.regulatory] canonical regulatory decisions
 * @param {?Object} [p.scoring]    deriveScoringContext() output
 * @param {?Object} p.validation   validateCandidateResult() report
 * @param {Object}  [p.siteControl] { parcelDataPresent: ?boolean }
 * @returns {{
 *   level: string,
 *   ladder: string[],
 *   gatesApplied: Array<{gate: string, ceiling: ?string, reason: string}>,
 *   rationale: string,
 *   technicalWarning: ?string,
 *   source: string,
 * }}
 */
export function deriveRecommendation({
  confidence,
  regulatory = {},
  scoring = null,
  validation = null,
  siteControl = {},
} = {}) {
  if (!confidence || typeof confidence !== 'object') {
    throw new TypeError('deriveRecommendation(): confidence (the four axes) is required');
  }

  const gatesApplied = [];
  const decisions = collectRegulatoryDecisions(regulatory);
  const required = decisions.filter(([, d]) => d.required === true);

  // ── REJECT: verified hard fails only ────────────────────────────────
  const hardFails = required.filter(([, d]) => d.completion === 'RUN' && d.state === 'FAIL');
  if (hardFails.length > 0) {
    const reasons = hardFails.map(([name, d]) => `${name}: ${d.rationale}`);
    return Object.freeze({
      level: RECOMMENDATION_LEVELS.REJECT,
      ladder: GATE_LADDER,
      gatesApplied: Object.freeze([{
        gate: 'REJECT',
        ceiling: RECOMMENDATION_LEVELS.REJECT,
        reason: `verified hard failure(s): ${hardFails.map(([n]) => n).join(', ')}`,
      }]),
      rationale: reasons.join(' | '),
      technicalWarning: null,
      source: SOURCE,
    });
  }

  // ── Gate V: validation ──────────────────────────────────────────────
  let technicalWarning = null;
  if (!validation || typeof validation !== 'object' || validation.consistent !== true) {
    const n = validation && Array.isArray(validation.violations)
      ? validation.violations.length
      : null;
    technicalWarning = validation && validation.consistent === false
      ? `candidate result violates ${n} internal invariant(s): ` +
        validation.violations.map((v) => v.invariant).join(', ')
      : 'invariant validation was not run on this candidate result';
    gatesApplied.push({
      gate: 'V:validation',
      ceiling: RECOMMENDATION_LEVELS.SCREEN_FURTHER,
      reason: technicalWarning,
    });
    return Object.freeze({
      level: RECOMMENDATION_LEVELS.SCREEN_FURTHER,
      ladder: GATE_LADDER,
      gatesApplied: Object.freeze(gatesApplied),
      rationale:
        'Recommendation suppressed to SCREEN_FURTHER: ' + technicalWarning +
        '. No advancement recommendation can be issued from an internally ' +
        'inconsistent or unvalidated result.',
      technicalWarning,
      source: SOURCE,
    });
  }

  let ceiling = RECOMMENDATION_LEVELS.FILING_READY;
  const lower = (gate, level, reason) => {
    gatesApplied.push({ gate, ceiling: level, reason });
    if (RANK[level] < RANK[ceiling]) ceiling = level;
  };

  // ── Gate F: filing readiness ────────────────────────────────────────
  const readiness = confidence.filingReadiness ?? {};
  if (readiness.ready !== true) {
    lower('F:filingReadiness', RECOMMENDATION_LEVELS.ENGINEERING_READY,
      `filingReadiness.ready is ${readiness.ready === false ? 'false' : 'unknown'}` +
      (Array.isArray(readiness.blockers) && readiness.blockers.length > 0
        ? ` — blockers: ${readiness.blockers.join('; ')}`
        : ''));
  }

  // ── Gate R: required decisions pending ──────────────────────────────
  const pending = required.filter(([, d]) => d.completion === 'NOT_RUN' || d.state === 'UNKNOWN');
  if (pending.length > 0) {
    lower('R:requiredDecisionsPending', RECOMMENDATION_LEVELS.ADVANCE_TO_DESK_STUDY,
      `required regulatory decision(s) not yet run: ${pending.map(([n]) => n).join(', ')}` +
      ' — at most a desk study can be recommended until they run');
  }

  // ── Gate E: engineering data confidence ─────────────────────────────
  const engTier = confidence.engineeringDataConfidence?.tier ?? CONFIDENCE_TIERS.LOW;
  if (engTier === CONFIDENCE_TIERS.LOW) {
    lower('E:engineeringData', RECOMMENDATION_LEVELS.ADVANCE_TO_DESK_STUDY,
      `engineering data confidence is LOW (limited by ${confidence.engineeringDataConfidence?.limitedBy ?? 'unknown input'})`);
  } else if (engTier === CONFIDENCE_TIERS.SCREENING) {
    lower('E:engineeringData', RECOMMENDATION_LEVELS.ADVANCE_TO_FIELD_VALIDATION,
      `engineering data confidence is SCREENING (limited by ${confidence.engineeringDataConfidence?.limitedBy ?? 'unknown input'})`);
  }

  // ── Gate P: parcel / site-control data ──────────────────────────────
  if (siteControl?.parcelDataPresent !== true) {
    lower('P:parcelData', RECOMMENDATION_LEVELS.ADVANCE_TO_FIELD_VALIDATION,
      siteControl?.parcelDataPresent === false
        ? 'parcel/site-control data absent — cannot advance to parcel negotiation'
        : 'parcel/site-control data not confirmed — cannot advance to parcel negotiation');
  }

  const level = ceiling;

  // ── Rationale: structured inputs only ────────────────────────────────
  const parts = [];
  parts.push(`Recommendation level ${level} (ladder ceiling after ${gatesApplied.length} gate(s)).`);
  for (const g of gatesApplied) {
    parts.push(`[${g.gate} → ceiling ${g.ceiling}] ${g.reason}.`);
  }
  if (scoring && typeof scoring.displayLabel === 'string') {
    parts.push(`Scoring context: ${scoring.displayLabel}.`);
  }
  if (confidence.regulatoryCompleteness) {
    const rc = confidence.regulatoryCompleteness;
    parts.push(
      `Regulatory completeness: ${rc.completedCount}/${rc.requiredCount} required decision(s) run.`
    );
  }

  return Object.freeze({
    level,
    ladder: GATE_LADDER,
    gatesApplied: Object.freeze(gatesApplied),
    rationale: parts.join(' '),
    technicalWarning,
    source: SOURCE,
  });
}
