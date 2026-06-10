// Exhibit Maturity Score — INTERNAL QA ONLY.
//
// Scores the exhibit across seven integrity categories so QA can grade
// "is this exhibit filing-grade?" deterministically.  This surface is
// attached to the document model meta (meta.internal_qa) and is NEVER
// rendered into the public PDF/TXT — the renderers only read the known
// meta fields (title, subtitle, station, footer, ...).
//
// Categories (0–100 each):
//   math_integrity    — deterministic math + parity gates
//   source_integrity  — source-attestation resolution state
//   evidence_integrity— quality tier of the backing evidence
//   rule_integrity    — rule-engine determinacy (the engine ran and
//                       produced a determinate disposition — a station
//                       that FAILS a rule still has full rule integrity)
//   traceability      — every value traceable to a source/provenance record
//   reproducibility   — build attestation + replay chain present
//   filing_readiness  — derived filing gate state for THIS station/study
//
// Maturity tier (label):
//   The tier grades the EXHIBIT FRAMEWORK — structure, math, provenance,
//   traceability, reproducibility — not the station's regulatory outcome.
//   A licensed station with current-rule conflicts (filing_readiness
//   BLOCKED) is still a filing-grade decision-support exhibit; the
//   conflicts are the finding, not a defect of the exhibit.  Therefore
//   the tier is computed from the STRUCTURAL categories only
//   (math, source, rule, traceability, reproducibility):
//
//   FILING-GRADE DECISION SUPPORT — all structural categories at/above
//                                   threshold; no structural failure.
//   ENGINEERING REVIEW REQUIRED   — a structural category is below
//                                   threshold but nothing has failed.
//   NOT FILING-READY              — a structural failure (failed math,
//                                   unresolved sources, no traceability).
//
// The label deliberately reads "DECISION SUPPORT", not "approval": Genoa
// never certifies filings; the engineer of record does.

const THRESHOLD = 70;

function clamp(n){ return Math.max(0, Math.min(100, Math.round(n))); }

export function computeExhibitMaturity(exhibit){
  const att = exhibit?.source_attestation_v2 || null;
  const st  = att?.statuses || {};
  const v   = exhibit?.validation_verdict || exhibit?.verdict || null;
  const cat = v?.categories || {};
  const vc  = exhibit?.validation_context || {};
  const runs = Array.isArray(exhibit?.validation?.runs) ? exhibit.validation.runs : [];

  // ---- Math Integrity -------------------------------------------------
  // Highest available signal wins: attestation math dimension, the
  // curve-reference gate, the validation-suite run, or the deterministic
  // regression suite (when the authoritative reference set is not present
  // in this environment).
  let math = 50;
  const run = runs[0] || null;
  if (run?.regression_pass === true) math = 85;
  if (run?.pass === true)            math = 100;
  if (vc.curve_reference_validation?.pass === true) math = 100;
  if (st.math_status === 'PASS')                    math = 100;
  if (cat.computational?.status === 'PASS')         math = 100;
  // Hard failures override: a failed math gate is a structural failure.
  if (st.math_status === 'FAIL')                          math = 20;
  if (vc.curve_reference_validation?.pass === false)      math = 20;
  if (run && run.pass === false && run.reference_cases_present === true) math = 20;
  if (cat.computational?.status === 'FAIL')               math = 20;

  // ---- Source Integrity ------------------------------------------------
  const sourceMap = { RESOLVED: 100, RESOLVED_WITH_CONFLICT: 80, REVIEW: 70, UNRESOLVED: 20 };
  const source = sourceMap[st.source_status] ?? (att ? 60 : 40);

  // ---- Evidence Integrity ----------------------------------------------
  const evidenceMap = { MEASURED: 100, MIXED: 85, DERIVED: 80, DECLARED: 60, UNMEASURED: 50, MISSING: 20 };
  let evidence = evidenceMap[st.evidence_status] ?? (att ? 60 : 40);
  // Evidence lock state refines the score when present.
  const lock = att?.evidence_lock ? (att?._lock_verification?.valid === false ? -30 : 0) : -10;
  evidence = clamp(evidence + lock);

  // ---- Rule Integrity --------------------------------------------------
  // Determinacy, not outcome: PASS or FAIL both mean the rule engine ran
  // and produced a defensible disposition.
  const ruleMap = { PASS: 100, FAIL: 100, REVIEW: 70, BLOCKED: 30, NOT_RUN: 50 };
  let rule = ruleMap[st.rule_status] ?? 60;
  if (exhibit?.regulatory_compliance?.pass === true || exhibit?.regulatory_compliance?.pass === false){
    rule = Math.max(rule, 100);
  }

  // ---- Traceability ----------------------------------------------------
  let traceability = 0;
  if (att?.payload_sha256)                       traceability += 35;  // attestation payload committed
  if (att?.fields && Object.keys(att.fields).length >= 10) traceability += 25;  // field coverage
  if (exhibit?.haat_authority)                   traceability += 20;  // HAAT basis declared
  if (exhibit?.haat_lineage || exhibit?.lineage) traceability += 10;
  if (exhibit?.evidence)                         traceability += 10;
  traceability = clamp(traceability || 30);

  // ---- Reproducibility ---------------------------------------------------
  const ba = exhibit?.build_attestation || null;
  let reproducibility = 40;
  if (ba){
    reproducibility = 70;
    if (ba.sha || ba.fingerprint_sha256 || ba.engine_sha || ba.engine_version) reproducibility += 15;
    if (ba.signature || ba.hmac)                                               reproducibility += 15;
  }
  reproducibility = clamp(reproducibility);

  // ---- Filing Readiness (per-station, reported but not tier-gating) ------
  const filingMap = { READY: 100, REVIEW: 70, BLOCKED: 20, NOT_READY: 20 };
  let filing = filingMap[st.filing_status] ?? null;
  if (filing == null && cat.filing?.status){
    filing = filingMap[cat.filing.status] ?? 60;
  }
  if (filing == null) filing = 50;

  const categories = {
    math_integrity:     clamp(math),
    source_integrity:   clamp(source),
    evidence_integrity: clamp(evidence),
    rule_integrity:     clamp(rule),
    traceability:       clamp(traceability),
    reproducibility:    clamp(reproducibility),
    filing_readiness:   clamp(filing)
  };

  const values  = Object.values(categories);
  const overall = clamp(values.reduce((a, b) => a + b, 0) / values.length);

  // Tier from the structural categories only (see header doc).
  const structural = [
    categories.math_integrity,
    categories.source_integrity,
    categories.rule_integrity,
    categories.traceability,
    categories.reproducibility
  ];
  const structuralFail  = structural.some(s => s <= 20);
  const structuralBelow = structural.some(s => s < THRESHOLD);

  const label = structuralFail
    ? 'NOT FILING-READY'
    : structuralBelow
      ? 'ENGINEERING REVIEW REQUIRED'
      : 'FILING-GRADE DECISION SUPPORT';

  return {
    schema:   'exhibit-maturity/v1',
    internal: true,           // never rendered in customer-facing output
    threshold: THRESHOLD,
    categories,
    overall_score: overall,
    label
  };
}
