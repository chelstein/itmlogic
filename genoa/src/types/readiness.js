// Filing readiness scoring.  Pure function of the warnings array + the
// presence of required exhibit blocks + the regulatory-context
// classifier output.
//
// Score band:
//   100..85 → filing_candidate
//    84..50 → engineering_review
//    49..0  → demo
//
// Any blocker forces status = demo and score ≤ 49 regardless of math.
//
// Regulatory-context overrides (when exhibit.regulatoryContext is
// attached, see src/engine/regulatory/context.js):
//
//   - studyIntent='modification' AND fails_current_rules
//       → status='modification_high_risk', score capped at 69, an
//         actionable recommendation is added.
//
//   - facilityStatus='licensed' AND fails_current_rules
//     AND NOT modification
//       → status='licensed_legacy_review' (if otherwise filing_candidate),
//         score capped at 89.  Reviewers see a current-rule conflict on
//         a licensed facility as a legacy/waiver-risk flag, not an
//         automatic illegality finding.
//
//   - facilityStatus='licensed' AND ordinary_compliant
//       → ordinary scoring path; no override.
//
// These overrides DO NOT weaken the engineering math.  Failures still
// emit warnings and still affect the underlying score; the cap +
// label simply preserves the interpretive distinction between an
// existing licensed station with a legacy conflict (medium-risk
// review) and a brand-new proposed filing with the same conflict
// (must redesign or waiver).

import { WARNING_CODES } from './warnings.js';

const POINTS = {
  blocker:  -25,
  warning:  -6,
  info:      0
};

const REQUIRED_BLOCKS = [
  'calculation_method',
  'interpolation',
  'contour_definitions',
  'radial_table',
  'polygons',
  'method_versions',
  'software_versions'
];

export function readiness({ warnings = [], exhibit = {} }){
  let score = 100;
  const blockers = [];
  const w_codes  = [];
  const recommendations = [];

  for (const w of warnings){
    const meta = WARNING_CODES[w.code];
    if (!meta){ continue; }
    score += POINTS[meta.severity] ?? 0;
    if (meta.severity === 'blocker') blockers.push(w);
    if (meta.severity === 'warning') w_codes.push(w);
  }

  const missingBlocks = REQUIRED_BLOCKS.filter(k => !exhibit[k]);
  for (const b of missingBlocks){
    score -= 15;
    blockers.push({ code: 'FCC_METHOD_MISSING', detail: `required exhibit block missing: ${b}`, severity: 'blocker', phase: 'engine' });
  }

  if (blockers.length){
    score = Math.min(score, 49);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  let status = 'demo';
  if (!blockers.length){
    if (score >= 85) status = 'filing_candidate';
    else if (score >= 50) status = 'engineering_review';
  }

  // ---- Regulatory-context overrides ----
  // Cap score + relabel based on the classifier's view of who's filing
  // and whether current rules are cleared.  See src/engine/regulatory/
  // context.js for the contract.
  const ctx = exhibit?.regulatoryContext || null;
  if (ctx){
    const fails = ctx.currentRuleCompliance === 'fails_current_rules';
    if (fails && ctx.studyIntent === 'modification'){
      if (score > 69) score = 69;
      status = 'modification_high_risk';
      recommendations.unshift(
        'Modification may require contour protection redesign, spacing study, waiver showing, or directional/ERP/site mitigation.'
      );
    } else if (fails && ctx.facilityStatus === 'licensed'){
      if (score > 89) score = 89;
      // Promote/demote into the licensed-legacy-review bucket only when
      // the score is high enough to qualify for filing-grade attention.
      if (status === 'filing_candidate' || status === 'engineering_review'){
        status = 'licensed_legacy_review';
      }
      recommendations.unshift(
        'Licensed facility review: current-rule conflict is a risk flag, not an automatic illegality finding.'
      );
    }
  }

  // Blocker-specific recommendations — always shown regardless of status.
  if (blockers.find(b => b.code === 'CURVE_VALIDATION_MISSING'))
    recommendations.push('Run the reference validation suite against the active curve dataset.');
  if (blockers.find(b => b.code === 'AM_DA_PATTERN_COMPLIANCE_FAIL'))
    recommendations.push('Correct the directional antenna pattern to satisfy §73.150 smoothness, max-to-min ratio, and RMS minimum-field requirements before filing.');
  if (blockers.find(b => b.code === 'CONTOUR_MONOTONICITY_VIOLATION'))
    recommendations.push('Contour distance ordering is inconsistent; re-run compute and inspect the radial table for the flagged radials.');
  if (blockers.find(b => b.code === 'AM_73_24G_FAIL'))
    recommendations.push('Submit a §73.88 blanketing-interference remediation plan and commit to receiver-treatment funding before filing (47 CFR §73.24(g); §73.318 is the FM blanketing rule).');
  if (blockers.find(b => b.code === 'AM_73_24J_FAIL'))
    recommendations.push('Increase power, reduce frequency, or modify the site to bring the 5 mV/m groundwave contour around the entire community of license before filing (47 CFR §73.24(i)).');
  if (blockers.find(b => b.code === 'FCCAM_UNAVAILABLE_BERRY_FALLBACK'))
    recommendations.push('Restore the FCCAM Wang 1985 sidecar (FCCAM_SIDECAR_URL) and re-run: Berry 1968 screening is not filing-grade for §73.182 nighttime protection (§73.190(c)).');

  // Warning-level specific recommendations — always shown regardless of status.
  if (w_codes.find(w => w.code === 'CONSTANT_HAAT_ASSUMED'))
    recommendations.push('Enable the terrain sidecar to compute per-radial §73.313 arc-averaged HAAT.');
  if (w_codes.find(w => w.code === 'POPULATION_PLACEHOLDER'))
    recommendations.push('Replace the uniform-density population estimate with a Census/ACS dispatch.');
  if (w_codes.find(w => w.code === 'SDR_MEASUREMENTS_MISSING' || w.code === 'SDR_MEASUREMENTS_NOT_CALIBRATED'))
    recommendations.push('Attach calibrated SigMF SDR captures to populate the measurement appendix.');
  if (w_codes.find(w => w.code === 'AM_INTERNATIONAL_TREATY_ZONE'))
    recommendations.push('Perform bilateral treaty skywave protection study (NARBA / US-Canada agreement) before filing — Genoa does not compute this study automatically.');

  // Generic sign-off — always appended.
  recommendations.push('Engineering review required prior to FCC filing. Genoa does not certify; the licensed engineer does.');

  return {
    score,
    status,
    blockers,
    warnings: w_codes,
    recommendations
  };
}
