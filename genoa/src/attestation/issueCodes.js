// Source Attestation Framework v2 — canonical warning/blocker codes.
//
// Every source-governance issue the resolver can raise maps to one of
// these codes.  Each code carries severity, filing impact, a human
// label, and a remediation hint so the PDF / UI / API can render the
// issue without per-call-site wording drift.
//
// severity:       'BLOCKER' | 'WARNING' | 'ADVISORY'
// filing_impact:  'BLOCKED' | 'REVIEW' | 'ADVISORY' | 'NONE'

export const ISSUE_CODES = Object.freeze({
  SOURCE_UNVERIFIED: Object.freeze({
    code:          'SOURCE_UNVERIFIED',
    severity:      'WARNING',
    filing_impact: 'REVIEW',
    human_label:   'Source could not be verified',
    remediation:   'Re-fetch the authoritative record (FCC LMS/ASR) or attach evidence establishing the value’s origin.'
  }),
  SOURCE_CONFLICT: Object.freeze({
    code:          'SOURCE_CONFLICT',
    severity:      'WARNING',
    filing_impact: 'REVIEW',
    human_label:   'Two sources disagree beyond tolerance',
    remediation:   'Review both values; promote the correct one via engineer override or correct the operator input.'
  }),
  SOURCE_CONFLICT_HAAT: Object.freeze({
    code:          'SOURCE_CONFLICT_HAAT',
    severity:      'WARNING',
    filing_impact: 'REVIEW',
    human_label:   'HAAT sources disagree beyond tolerance',
    remediation:   'Compare FCC-licensed HAAT with the terrain-derived value; the engineer of record must select the operative HAAT and document why.'
  }),
  SOURCE_CONFLICT_RCAMSL: Object.freeze({
    code:          'SOURCE_CONFLICT_RCAMSL',
    severity:      'WARNING',
    filing_impact: 'REVIEW',
    human_label:   'RCAMSL sources disagree beyond tolerance',
    remediation:   'Verify ground elevation (DEM) + height AGL against the licensed RCAMSL; correct the inconsistent component.'
  }),
  SOURCE_CONFLICT_COORDINATES: Object.freeze({
    code:          'SOURCE_CONFLICT_COORDINATES',
    severity:      'WARNING',
    filing_impact: 'REVIEW',
    human_label:   'Coordinate sources disagree beyond tolerance',
    remediation:   'Confirm the transmitter site coordinates against FCC LMS and ASR records; a >10 m discrepancy requires explanation in the filing.'
  }),
  SOURCE_CONFLICT_ASR_HEIGHT: Object.freeze({
    code:          'SOURCE_CONFLICT_ASR_HEIGHT',
    severity:      'WARNING',
    filing_impact: 'REVIEW',
    human_label:   'Structure height disagrees with ASR registration',
    remediation:   'Verify overall height against the ASR record (§17.4 tolerance is 3 m); amend the ASR or correct the input.'
  }),
  PRIMARY_SOURCE_MISSING: Object.freeze({
    code:          'PRIMARY_SOURCE_MISSING',
    severity:      'BLOCKER',
    filing_impact: 'BLOCKED',
    human_label:   'No primary (authoritative) source for a filing-critical field',
    remediation:   'Fetch the FCC LMS/ASR record for this facility, or attach a manual engineer override with reason and reviewer.'
  }),
  MANUAL_OVERRIDE_REQUIRED: Object.freeze({
    code:          'MANUAL_OVERRIDE_REQUIRED',
    severity:      'BLOCKER',
    filing_impact: 'BLOCKED',
    human_label:   'Conflict cannot be auto-resolved; engineer override required',
    remediation:   'The engineer of record must select the operative value and record a reason + reviewer identity.'
  }),
  OPERATOR_SUPPLIED_ONLY: Object.freeze({
    code:          'OPERATOR_SUPPLIED_ONLY',
    severity:      'WARNING',
    filing_impact: 'REVIEW',
    human_label:   'Value rests solely on operator input',
    remediation:   'Cross-check against FCC LMS/ASR or terrain data before filing; operator-only values carry LOW confidence.'
  }),
  AUTHORITY_DOWNGRADED: Object.freeze({
    code:          'AUTHORITY_DOWNGRADED',
    severity:      'ADVISORY',
    filing_impact: 'ADVISORY',
    human_label:   'Operative value taken from a lower-authority source',
    remediation:   'A higher-authority source was missing or invalid; verify the downgrade is intentional.'
  }),
  OVERRIDE_INVALID: Object.freeze({
    code:          'OVERRIDE_INVALID',
    severity:      'BLOCKER',
    filing_impact: 'BLOCKED',
    human_label:   'Manual override missing reason or reviewer identity',
    remediation:   'Add override.reason and override.reviewer; un-attributed overrides can never become operative.'
  })
});

/** Look up an issue code descriptor; unknown codes degrade to a generic WARNING. */
export function resolveIssueCode(code){
  return ISSUE_CODES[code] || Object.freeze({
    code:          code || 'UNKNOWN_ISSUE',
    severity:      'WARNING',
    filing_impact: 'REVIEW',
    human_label:   `Unrecognized issue code "${code}"`,
    remediation:   'Inspect the resolver output; this code is not in the canonical registry.'
  });
}

/** Build an issue instance (descriptor + context) ready to attach to a resolution. */
export function makeIssue(code, context = {}){
  const desc = resolveIssueCode(code);
  return {
    code:          desc.code,
    severity:      desc.severity,
    filing_impact: desc.filing_impact,
    human_label:   desc.human_label,
    remediation:   desc.remediation,
    ...context
  };
}
