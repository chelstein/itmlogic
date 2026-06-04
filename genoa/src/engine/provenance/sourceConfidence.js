// Source confidence scoring.
//
// Converts per-field provenance metadata into a numerical confidence
// score (0.0–1.0) and a categorical verification_status.  The per-field
// scores are averaged by buildSourceAttestation() into overall_confidence.
//
// Verification statuses:
//   verified       — authoritative record (FCC/FAA/DEM) with no conflict
//   cross_checked  — confirmed by two independent authoritative sources
//   operator_only  — only source is operator input; no cross-check run
//   conflict       — two sources disagree beyond their tolerance threshold
//   unverified     — data present but authority cannot be confirmed
//   unknown        — no source information at all

import { SOURCE_AUTHORITY, AUTHORITY_TRUST } from './sourceAuthority.js';

const AUTHORITATIVE = new Set([
  SOURCE_AUTHORITY.FCC_LMS,
  SOURCE_AUTHORITY.FCC_FMQ,
  SOURCE_AUTHORITY.FCC_ASR,
  SOURCE_AUTHORITY.FAA_OEAAA,
  SOURCE_AUTHORITY.USGS_DEM
]);

// Score a single field's lineage record.
//
// fieldLineage shape:
//   {
//     field:            string   — field identifier
//     source_authority: string   — one of SOURCE_AUTHORITY values
//     cross_checked:    boolean  — confirmed by a second authoritative source
//     conflict:         boolean  — two sources disagree beyond tolerance
//     conflict_detail:  string?  — human-readable description of the conflict
//   }
export function scoreSource(fieldLineage){
  const authority = fieldLineage.source_authority || SOURCE_AUTHORITY.UNKNOWN;
  const baseTrust = AUTHORITY_TRUST[authority] ?? 0.0;

  const conflictPenalty  = fieldLineage.conflict      ? 0.15 : 0;
  const crossCheckBonus  = fieldLineage.cross_checked ? 0.05 : 0;

  const confidence = Math.max(0, Math.min(1, baseTrust - conflictPenalty + crossCheckBonus));

  let verification_status;
  if (fieldLineage.conflict){
    verification_status = 'conflict';
  } else if (fieldLineage.cross_checked && AUTHORITATIVE.has(authority)){
    verification_status = 'cross_checked';
  } else if (AUTHORITATIVE.has(authority)){
    verification_status = 'verified';
  } else if (authority === SOURCE_AUTHORITY.OPERATOR_INPUT){
    verification_status = 'operator_only';
  } else if (authority === SOURCE_AUTHORITY.UNKNOWN){
    verification_status = 'unknown';
  } else {
    verification_status = 'unverified';
  }

  const blockers = [];
  const warnings_out = [];

  if (confidence === 0.0 && authority === SOURCE_AUTHORITY.UNKNOWN){
    warnings_out.push('SOURCE_AUTHORITY_UNKNOWN');
  }
  if (verification_status === 'operator_only'){
    warnings_out.push('SOURCE_OPERATOR_ONLY');
  }
  if (verification_status === 'conflict'){
    warnings_out.push('SOURCE_CONFLICT');
  }

  return {
    field:               fieldLineage.field,
    source_authority:    authority,
    confidence:          +confidence.toFixed(3),
    verification_status,
    conflict_detail:     fieldLineage.conflict_detail || null,
    blockers,
    warnings:            warnings_out
  };
}

// Score all fields in an exhibit's source_attestation.fields map.
// Returns { overall_confidence, field_scores[], source_blockers[], source_warnings[] }.
export function scoreExhibitSources(fields){
  const scores = Object.values(fields || {});
  if (scores.length === 0) return { overall_confidence: 0, field_scores: [], source_blockers: [], source_warnings: [] };

  const total = scores.reduce((acc, s) => acc + s.confidence, 0);
  const overall_confidence = +(total / scores.length).toFixed(3);

  const source_blockers = [];
  const source_warnings = [];

  if (overall_confidence < 0.70){
    source_blockers.push({
      code:    'SOURCE_UNVERIFIED',
      message: `Overall source confidence ${(overall_confidence * 100).toFixed(0)}% is below the 70% filing-grade threshold.  Too many engineering values lack authoritative cross-check.  Obtain FCC LMS, terrain DEM, and ASR evidence to raise confidence before filing.`
    });
  } else if (overall_confidence < 0.85){
    source_warnings.push({
      code:    'SOURCE_CONFIDENCE_LOW',
      message: `Overall source confidence ${(overall_confidence * 100).toFixed(0)}% is below 85%.  Engineering review required to confirm operator-entered values before filing.`
    });
  }

  for (const s of scores){
    for (const w of s.warnings){
      if (!source_warnings.some(sw => sw.code === w && sw.field === s.field)){
        source_warnings.push({ code: w, field: s.field, message: s.conflict_detail || null });
      }
    }
  }

  return { overall_confidence, field_scores: scores, source_blockers, source_warnings };
}
