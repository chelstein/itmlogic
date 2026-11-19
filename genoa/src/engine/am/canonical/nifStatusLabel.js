// Single source for the human-readable NIF status label derived from a
// canonical RegulatoryDecision (candidate.canonical.regulatory.nif).
//
// Previously this exact mapping was independently duplicated in
// src/engine/am/siteOptimizer.js and src/engine/am/colocationOpportunities.js
// (byte-identical, with a comment acknowledging the duplication), and a
// third copy was about to be added client-side in CandidateDetailDrawer.jsx
// for the real-NIF-study feature — eliminated here instead, since three
// independently-maintained copies of a regulatory-status label mapping is
// exactly the "two different answers to the same question" defect class
// this whole canonical-consistency effort exists to remove.
//
// NEVER re-derive this label from anything other than a canonical
// RegulatoryDecision's required/completion/result fields — it must say
// 'REQUIRED — NOT EVALUATED', never a compliance-category claim.

export function nifStatusFromCanonical(nif){
  if (!nif) return 'SCREENING ONLY';
  if (nif.required === false) return 'NOT REQUIRED';
  if (nif.required === true){
    if (nif.completion === 'RUN'){
      if (nif.result === 'PASS') return 'REQUIRED — STUDY PASSED';
      if (nif.result === 'FAIL') return 'REQUIRED — STUDY FAILED';
      return 'REQUIRED — STUDY INCONCLUSIVE';
    }
    return 'REQUIRED — NOT EVALUATED';
  }
  return 'REQUIREMENT UNKNOWN';
}
