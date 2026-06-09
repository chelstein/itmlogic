// Source Attestation Framework v2 — public surface.
export {
  AUTHORITY_LEVEL, AUTHORITY_RANK, SOURCE_TYPE, SOURCE_REGISTRY,
  resolveSourceType, compareAuthority, validateManualOverride
} from './sourceAuthority.js';
export { ISSUE_CODES, resolveIssueCode, makeIssue } from './issueCodes.js';
export { FIELD_TOLERANCES, DEFAULT_TOLERANCE, toleranceFor, compareValues, coordDistanceM } from './tolerances.js';
export { makeAttestedValue, wrapLegacyScalar, validateAttestedValue, hashValue } from './attestedValue.js';
export { resolveOperativeValue, RESOLUTION_STATUS } from './resolveOperativeValue.js';
export {
  MATH_STATUS, SOURCE_STATUS, RULE_STATUS, EVIDENCE_STATUS, FILING_STATUS,
  rollupSourceStatus, deriveFilingStatus, buildStatusDimensions
} from './statusDimensions.js';
export { buildAttestedExhibitValues, collectFieldCandidates } from './buildAttestedExhibitValues.js';
