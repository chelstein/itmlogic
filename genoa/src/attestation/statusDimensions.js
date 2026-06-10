// Source Attestation Framework v2 — separated status dimensions.
//
// Stops collapsing exhibit readiness into one label.  Five orthogonal
// dimensions, with filing_status DERIVED from the other four — never
// manually assigned:
//
//   math_status      PASS | FAIL | NOT_RUN
//   source_status    RESOLVED | SOURCE_CONFLICT | SOURCE_UNVERIFIED |
//                    OPERATOR_SUPPLIED_ONLY | UNRESOLVED
//   rule_status      PASS | FAIL | REVIEW | NOT_RUN
//   evidence_status  MEASURED | UNMEASURED | NOT_REQUIRED
//   filing_status    VERIFIED | REVIEW | NON_COMPLIANT | BLOCKED
//
// Derivation rules (deterministic, in precedence order):
//   math FAIL                                   → BLOCKED
//   source UNRESOLVED (primary missing blocker) → BLOCKED
//   unresolved same-rank source conflict        → BLOCKED
//   resolved-with-conflict source state         → REVIEW (at best)
//   rule FAIL                                   → NON_COMPLIANT (math passed)
//   rule REVIEW                                 → REVIEW
//   evidence UNMEASURED + evidence required     → REVIEW
//   evidence UNMEASURED + not required          → advisory only (no demotion)
//   everything pass/resolved                    → VERIFIED

export const MATH_STATUS     = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', NOT_RUN: 'NOT_RUN' });
export const SOURCE_STATUS   = Object.freeze({
  RESOLVED:               'RESOLVED',
  RESOLVED_WITH_CONFLICT: 'RESOLVED_WITH_CONFLICT',
  SOURCE_CONFLICT:        'SOURCE_CONFLICT',
  SOURCE_UNVERIFIED:      'SOURCE_UNVERIFIED',
  OPERATOR_SUPPLIED_ONLY: 'OPERATOR_SUPPLIED_ONLY',
  UNRESOLVED:             'UNRESOLVED'
});
export const RULE_STATUS     = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', REVIEW: 'REVIEW', NOT_RUN: 'NOT_RUN' });
export const EVIDENCE_STATUS = Object.freeze({ MEASURED: 'MEASURED', UNMEASURED: 'UNMEASURED', NOT_REQUIRED: 'NOT_REQUIRED' });
export const FILING_STATUS   = Object.freeze({ VERIFIED: 'VERIFIED', REVIEW: 'REVIEW', NON_COMPLIANT: 'NON_COMPLIANT', BLOCKED: 'BLOCKED' });

/**
 * Roll up per-field resolutions into one exhibit-level source_status.
 */
export function rollupSourceStatus(resolutions){
  const list = Array.isArray(resolutions) ? resolutions : Object.values(resolutions || {});
  if (list.length === 0) return SOURCE_STATUS.UNRESOLVED;

  const statuses = list.map(r => r?.status).filter(Boolean);
  if (statuses.some(s => s === 'UNRESOLVED'))                return SOURCE_STATUS.UNRESOLVED;
  if (statuses.some(s => s === 'MANUAL_OVERRIDE_REQUIRED'))  return SOURCE_STATUS.SOURCE_CONFLICT;
  if (statuses.some(s => s === 'SOURCE_CONFLICT'))           return SOURCE_STATUS.SOURCE_CONFLICT;
  if (statuses.some(s => s === 'RESOLVED_WITH_CONFLICT'))    return SOURCE_STATUS.RESOLVED_WITH_CONFLICT;
  if (statuses.some(s => s === 'SOURCE_UNVERIFIED'))         return SOURCE_STATUS.SOURCE_UNVERIFIED;

  // All RESOLVED — check for operator-only warnings
  const allOperatorOnly = list.length > 0 && list.every(r =>
    (r.warnings || []).includes('OPERATOR_SUPPLIED_ONLY'));
  if (allOperatorOnly) return SOURCE_STATUS.OPERATOR_SUPPLIED_ONLY;

  return SOURCE_STATUS.RESOLVED;
}

/**
 * Derive filing_status from the four upstream dimensions.
 *
 * @param {object} statuses
 *   math_status       MATH_STATUS value
 *   source_status     SOURCE_STATUS value
 *   rule_status       RULE_STATUS value
 *   evidence_status   EVIDENCE_STATUS value
 *   evidence_required boolean — whether measurement evidence is mandated
 *   source_blockers   string[] — blocker codes from resolutions (PRIMARY_SOURCE_MISSING etc.)
 */
export function deriveFilingStatus(statuses){
  const {
    math_status       = MATH_STATUS.NOT_RUN,
    source_status     = SOURCE_STATUS.UNRESOLVED,
    rule_status       = RULE_STATUS.NOT_RUN,
    evidence_status   = EVIDENCE_STATUS.NOT_REQUIRED,
    evidence_required = false,
    source_blockers   = []
  } = statuses || {};

  // math fail → BLOCKED, always.
  if (math_status === MATH_STATUS.FAIL) return FILING_STATUS.BLOCKED;

  // hard source blockers → BLOCKED
  if (source_blockers.length > 0)        return FILING_STATUS.BLOCKED;
  if (source_status === SOURCE_STATUS.UNRESOLVED) return FILING_STATUS.BLOCKED;

  // unresolved same-rank conflict → BLOCKED (no deterministic operative value)
  if (source_status === SOURCE_STATUS.SOURCE_CONFLICT) return FILING_STATUS.BLOCKED;

  // rule fail with math pass → NON_COMPLIANT
  if (rule_status === RULE_STATUS.FAIL) return FILING_STATUS.NON_COMPLIANT;

  // anything that demands review
  if (source_status === SOURCE_STATUS.RESOLVED_WITH_CONFLICT) return FILING_STATUS.REVIEW;
  if (source_status === SOURCE_STATUS.SOURCE_UNVERIFIED)      return FILING_STATUS.REVIEW;
  if (source_status === SOURCE_STATUS.OPERATOR_SUPPLIED_ONLY) return FILING_STATUS.REVIEW;
  if (rule_status === RULE_STATUS.REVIEW)                     return FILING_STATUS.REVIEW;
  if (math_status === MATH_STATUS.NOT_RUN)                    return FILING_STATUS.REVIEW;
  if (rule_status === RULE_STATUS.NOT_RUN)                    return FILING_STATUS.REVIEW;
  if (evidence_status === EVIDENCE_STATUS.UNMEASURED && evidence_required) return FILING_STATUS.REVIEW;

  // evidence unmeasured but not required → advisory only, no demotion
  return FILING_STATUS.VERIFIED;
}

/**
 * Build the full five-dimension status block for an exhibit.
 */
export function buildStatusDimensions({ math_status, rule_status, evidence_status, evidence_required, resolutions, source_blockers }){
  const src = rollupSourceStatus(resolutions);
  const blockerCodes = source_blockers
    ?? (Array.isArray(resolutions) ? resolutions : Object.values(resolutions || {}))
         .flatMap(r => r?.blockers || []);
  const filing = deriveFilingStatus({
    math_status,
    source_status:   src,
    rule_status,
    evidence_status,
    evidence_required,
    source_blockers: blockerCodes
  });
  return {
    math_status:     math_status     ?? MATH_STATUS.NOT_RUN,
    source_status:   src,
    rule_status:     rule_status     ?? RULE_STATUS.NOT_RUN,
    evidence_status: evidence_status ?? EVIDENCE_STATUS.NOT_REQUIRED,
    filing_status:   filing
  };
}
