// Audit Package Quality Scorer — grades the completeness and integrity of a
// Genoa audit package so reviewers can trust the filing artifact.

/**
 * scoreAuditPackage({ readiness, reasoning, lineage, conflicts, provenance, filing_package })
 *
 * @returns {{ score, categories, strengths, weaknesses, missing_items }}
 */
export function scoreAuditPackage({
  readiness,
  reasoning,
  lineage,
  conflicts,
  provenance,
  filing_package,
  schema,
} = {}) {
  const categories = {
    provenance:   { score: 0, max: 15, notes: [] },
    readiness:    { score: 0, max: 15, notes: [] },
    reasoning:    { score: 0, max: 15, notes: [] },
    evidence:     { score: 0, max: 15, notes: [] },
    lineage:      { score: 0, max: 15, notes: [] },
    confidence:   { score: 0, max: 10, notes: [] },
    completeness: { score: 0, max: 15, notes: [] },
  };

  // ── provenance (max 15) ───────────────────────────────────────────────────

  if (provenance?.build_sha) {
    categories.provenance.score += 5;
  } else {
    categories.provenance.notes.push('Build SHA missing — exhibit not traceable to engine version');
  }

  if (provenance?.replay_token) {
    categories.provenance.score += 5;
  } else {
    categories.provenance.notes.push('Replay token missing — exhibit cannot be deterministically reproduced');
  }

  if (provenance?.generated_at && isValidIsoDate(provenance.generated_at)) {
    categories.provenance.score += 5;
  } else {
    categories.provenance.notes.push('generated_at is missing or not a valid ISO date');
  }

  // ── readiness (max 15) ────────────────────────────────────────────────────

  if (readiness) {
    const det = readiness.determination;
    if (det === 'READY')      categories.readiness.score += 10;
    else if (det === 'REVIEW') categories.readiness.score += 7;
    else                       categories.readiness.score += 3; // NOT_READY

    const blockers = readiness.blockers ?? [];
    const allBlockersHaveCodeAndMessage = blockers.every(b => b.code && b.message);
    if (allBlockersHaveCodeAndMessage) {
      categories.readiness.score += 3;
    } else {
      categories.readiness.notes.push('Some blockers are missing code or message fields');
    }

    const complianceBlockers = blockers.filter(b => b.code === 'COMPLIANCE_FAILURE');
    const allComplianceHaveRule = complianceBlockers.every(b => b.rule);
    if (allComplianceHaveRule) {
      categories.readiness.score += 2;
    } else {
      categories.readiness.notes.push('Some COMPLIANCE_FAILURE blockers are missing rule citation');
    }
  } else {
    categories.readiness.notes.push('readiness object is absent');
  }

  // ── reasoning (max 15) ────────────────────────────────────────────────────

  const conclusions = reasoning?.conclusions ?? [];

  if (conclusions.length >= 1) {
    categories.reasoning.score += 3;
  } else {
    categories.reasoning.notes.push('No reasoning conclusions present');
  }

  if (conclusions.length >= 3) {
    categories.reasoning.score += 3;
  } else if (conclusions.length >= 1) {
    categories.reasoning.notes.push('Fewer than 3 reasoning conclusions — limited coverage');
  }

  const allHaveEvidence = conclusions.every(c => Array.isArray(c.evidence) && c.evidence.length >= 1);
  if (conclusions.length > 0 && allHaveEvidence) {
    categories.reasoning.score += 3;
  } else if (conclusions.length > 0) {
    categories.reasoning.notes.push('Some conclusions are missing supporting evidence items');
  }

  const failConclusions = conclusions.filter(c => c.result === 'FAIL');
  const allFailHaveRule = failConclusions.every(c => c.rule);
  if (failConclusions.length === 0 || allFailHaveRule) {
    categories.reasoning.score += 3;
  } else {
    categories.reasoning.notes.push('Some FAIL conclusions are missing rule citation');
  }

  const allHaveConfidence = conclusions.every(c => c.confidence);
  if (conclusions.length > 0 && allHaveConfidence) {
    categories.reasoning.score += 3;
  } else if (conclusions.length > 0) {
    categories.reasoning.notes.push('Some conclusions are missing confidence values');
  }

  // ── evidence (max 15) ─────────────────────────────────────────────────────

  const evidenceItems = readiness?.evidence ?? [];
  const evidenceTypes = new Set(evidenceItems.map(e => e.type));

  if (evidenceTypes.has('compliance')) {
    categories.evidence.score += 3;
  } else {
    categories.evidence.notes.push('No compliance evidence item in readiness');
  }

  if (evidenceTypes.has('haat_filed')) {
    categories.evidence.score += 3;
  } else {
    categories.evidence.notes.push('No haat_filed evidence item — filed HAAT not recorded');
  }

  if (evidenceTypes.has('haat_advisory')) {
    categories.evidence.score += 3;
  } else {
    categories.evidence.notes.push('No haat_advisory evidence item — terrain HAAT not computed');
  }

  if (evidenceTypes.has('field_summary')) {
    categories.evidence.score += 3;
  } else {
    categories.evidence.notes.push('No field_summary evidence item');
  }

  // field_summary goal met: "0 blocking gaps" or blocking count === 0
  const fieldSummary = evidenceItems.find(e => e.type === 'field_summary');
  const fieldSummaryGoalMet = fieldSummary && (
    (typeof fieldSummary.value === 'string' && fieldSummary.value.includes('0 blocking gaps')) ||
    (typeof fieldSummary.blocking === 'number' && fieldSummary.blocking === 0)
  );
  if (fieldSummaryGoalMet) {
    categories.evidence.score += 3;
  } else {
    categories.evidence.notes.push('Filing goal not met — blocking gaps remain in field_summary');
  }

  // ── lineage (max 15) ──────────────────────────────────────────────────────

  const lineageFields = lineage?.fields ?? [];

  if (lineageFields.length > 0) {
    categories.lineage.score += 5;
  } else {
    categories.lineage.notes.push('No lineage fields present');
  }

  const filledFields = lineageFields.filter(f => f.status === 'filled' || f.status === 'FILLED');
  const allFilledHaveSourcePath = filledFields.every(f => f.source_path != null);
  if (filledFields.length === 0 || allFilledHaveSourcePath) {
    categories.lineage.score += 5;
  } else {
    categories.lineage.notes.push('Some filled lineage fields are missing source_path');
  }

  const allFilledHaveKnownSystem = filledFields.every(f => f.source_system && f.source_system !== 'unknown');
  if (filledFields.length === 0 || allFilledHaveKnownSystem) {
    categories.lineage.score += 5;
  } else {
    categories.lineage.notes.push('Some filled lineage fields have unknown source_system');
  }

  // ── confidence (max 10) ───────────────────────────────────────────────────

  const requiredFilled = filledFields.filter(f => f.required !== false);

  const noUnknownConfidence = requiredFilled.every(f => f.confidence !== 'unknown');
  if (requiredFilled.length === 0 || noUnknownConfidence) {
    categories.confidence.score += 5;
  } else {
    categories.confidence.notes.push('Some required filled fields have unknown confidence');
  }

  const noUnknownSystem = requiredFilled.every(f => f.source_system !== 'unknown');
  if (requiredFilled.length === 0 || noUnknownSystem) {
    categories.confidence.score += 5;
  } else {
    categories.confidence.notes.push('Some required filled fields have unknown source_system');
  }

  // ── completeness (max 15) ─────────────────────────────────────────────────

  if (filing_package && Array.isArray(filing_package.fields)) {
    categories.completeness.score += 5;
  } else {
    categories.completeness.notes.push('filing_package is absent or missing fields array');
  }

  if (Array.isArray(conflicts)) {
    categories.completeness.score += 5;
  } else {
    categories.completeness.notes.push('conflicts array is absent');
  }

  // All 7 top-level audit package keys present
  const TOP_LEVEL_KEYS = ['schema', 'filing_package', 'lineage', 'readiness', 'reasoning', 'conflicts', 'provenance'];
  const auditArgs = { schema, filing_package, lineage, readiness, reasoning, conflicts, provenance };
  const allTopKeysPresent = TOP_LEVEL_KEYS.every(k => auditArgs[k] != null);
  if (allTopKeysPresent) {
    categories.completeness.score += 5;
  } else {
    const missing = TOP_LEVEL_KEYS.filter(k => auditArgs[k] == null);
    categories.completeness.notes.push(`Missing top-level audit package keys: ${missing.join(', ')}`);
  }

  // ── Totals ────────────────────────────────────────────────────────────────

  const total = Object.values(categories).reduce((s, c) => s + c.score, 0);

  const strengths = [];
  const weaknesses = [];
  const missing_items = [];

  for (const [name, cat] of Object.entries(categories)) {
    if (cat.score >= cat.max * 0.8) {
      strengths.push(`Strong ${name}: ${cat.notes.length === 0 ? 'all checks passed' : cat.notes[0]}`);
    }
    if (cat.score < cat.max * 0.5) {
      weaknesses.push(`Weak ${name}: ${cat.notes[0] ?? 'score below threshold'}`);
    }
    for (const note of cat.notes) {
      missing_items.push(note);
    }
  }

  return {
    score: total,
    categories,
    strengths,
    weaknesses,
    missing_items,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidIsoDate(str) {
  if (typeof str !== 'string') return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}
