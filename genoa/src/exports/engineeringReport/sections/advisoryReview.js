// Advisory — Automated Exhibit Consistency Review.
//
// Renders the result of the optional AI advisory pass
// (src/analysis/exhibitReview.js) when an export entry point has run it
// and attached it to options.advisory_review.  STRICTLY ADVISORY: it
// never modifies any computed contour distance, HAAT, spacing, or
// 47 CFR Part 73 compliance result — it only surfaces possible internal
// inconsistencies for the engineer of record to weigh.  Returns null
// when no review is attached (no MODEL_ACCESS_KEY / router unavailable),
// so offline and un-keyed runs render exactly as before.

const DISCLAIMER =
  'The following is an automated, advisory consistency review produced by an AI reasoning ' +
  'model (DigitalOcean inference router, engineering-exhibit-validation policy). It is NOT ' +
  'part of the certified engineering determination and does not modify any computed contour ' +
  'distance, HAAT, spacing, or 47 CFR Part 73 compliance result. It is provided solely to ' +
  'surface possible internal inconsistencies for the engineer of record to review.';

const SCOPE_STATEMENT =
  'Scope of this review: the automated pass inspects internal consistency, source ' +
  'provenance, traceability, and missing evidence ONLY.  It does not — and may not — ' +
  'make compliance determinations, assess filing readiness, interpret rules, determine ' +
  'which engineering value is correct, or draw engineering conclusions.  Those ' +
  'determinations belong exclusively to the deterministic engines and the engineer of ' +
  'record.  Findings are categorized as INCONSISTENCY, MISSING_EVIDENCE, ' +
  'UNRESOLVED_CONFLICT, DOCUMENTATION_GAP, or TRACEABILITY_GAP.';

export function buildAdvisoryReviewSection(exhibit, opt){
  const review = opt?.advisory_review;
  if (!review || review.available !== true) return null;

  const paragraphs = [DISCLAIMER, SCOPE_STATEMENT];

  const findings = Array.isArray(review.findings) ? review.findings : [];
  if (findings.length){
    paragraphs.push(`The review flagged ${findings.length} item${findings.length === 1 ? '' : 's'} for engineer review:`);
    for (const f of findings){
      const sev   = String(f?.severity || 'INFO').toUpperCase();
      const issue = String(f?.issue || '').trim();
      const cat   = String(f?.category || '').trim().toUpperCase();
      if (issue) paragraphs.push(`• [${sev}] ${issue}${cat ? `  (${cat})` : ''}`);
    }
  } else {
    paragraphs.push(
      'The review identified no internal contradictions across the validation verdict, ' +
      'engineering conclusion, HAAT basis, and contour summary.'
    );
  }

  const provenance = [];
  if (review.model) provenance.push(`model: ${review.model}`);
  provenance.push(review.grounded ? 'grounded in retrieved 47 CFR Part 73 text' : 'ungrounded (model reasoning only)');
  paragraphs.push(`(Advisory review — ${provenance.join('; ')}.)`);

  return {
    id:       'advisory-review',
    type:     'paragraphs',
    heading:  'ADVISORY — AUTOMATED EXHIBIT CONSISTENCY REVIEW',
    advisory: true,
    paragraphs
  };
}
