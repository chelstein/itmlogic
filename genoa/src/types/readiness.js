// Filing readiness scoring.  Pure function of the warnings array + the
// presence of required exhibit blocks.  No AI, no fudge.
//
// Score band:
//   100..85 → filing_candidate
//    84..50 → engineering_review
//    49..0  → demo
//
// Any blocker forces status = demo and score ≤ 49 regardless of math.

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

  if (status !== 'filing_candidate'){
    if (blockers.find(b => b.code === 'CURVE_VALIDATION_MISSING'))
      recommendations.push('Run the reference validation suite against the active curve dataset.');
    if (blockers.find(b => b.code === 'AM_ENGINE_NOT_IMPLEMENTED'))
      recommendations.push('Engage a qualified broadcast engineer for AM filings until the §73.184 sigma-aware curve grid is ingested.');
    if (w_codes.find(w => w.code === 'CONSTANT_HAAT_ASSUMED'))
      recommendations.push('Enable the terrain sidecar to compute per-radial §73.313 arc-averaged HAAT.');
    if (w_codes.find(w => w.code === 'POPULATION_PLACEHOLDER'))
      recommendations.push('Replace the uniform-density population estimate with a Census/ACS dispatch.');
    if (w_codes.find(w => w.code === 'SDR_MEASUREMENTS_MISSING' || w.code === 'SDR_MEASUREMENTS_NOT_CALIBRATED'))
      recommendations.push('Attach calibrated SigMF SDR captures to populate the measurement appendix.');
  } else {
    recommendations.push('Engineering review required prior to FCC filing. Genoa does not certify; the licensed engineer does.');
  }

  return {
    score,
    status,
    blockers,
    warnings: w_codes,
    recommendations
  };
}
