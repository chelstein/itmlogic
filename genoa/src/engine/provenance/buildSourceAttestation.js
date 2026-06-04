// Source attestation assembler.
//
// Builds the source_attestation exhibit block that answers: for each
// engineering value in this exhibit, WHERE did it come from, HOW
// authoritative is that source, IS IT cross-checked, and ARE any
// two sources in conflict?
//
// Called from exhibitService.js after compute() and the lineage
// stamping steps.  The attestation block is advisory — its
// blockers/warnings live in source_attestation.blockers/warnings,
// NOT in exhibit.blockers/warnings, so offline test exhibits that
// lack FCC LMS data do not get false blockers.

import { SOURCE_AUTHORITY }                        from './sourceAuthority.js';
import { scoreSource, scoreExhibitSources }        from './sourceConfidence.js';
import { detectProvenanceConflicts }               from './provenanceConflicts.js';
import { hashEvidence }                            from './hashEvidence.js';
import { assessExhibitSourceFreshness,
         collectFreshnessIssues }                  from './sourceFreshness.js';
import { buildEvidenceLock }                       from './evidenceLock.js';

// Map a lineage/evidence combination to a single fieldLineage descriptor
// that scoreSource() can consume.
function classifyField(name, exhibit, evidence){
  const si  = exhibit.station_inputs || {};
  const ev  = evidence || exhibit.evidence || {};
  const lms = ev.fcc_lms?.license || {};
  const asr = ev.asr              || {};
  const rl  = exhibit.rcamsl_lineage  || {};
  const hl  = exhibit.haat_lineage    || {};
  const el  = exhibit.erp_lineage     || {};
  const cl  = exhibit.class_lineage   || {};
  const fl  = exhibit.frequency_lineage || {};

  const hasLms = Object.keys(lms).length > 0;
  const hasAsr = Object.keys(asr).length > 0;
  const hasDem = rl.source && rl.source !== 'not_resolved';

  switch (name){
    case 'frequency': {
      const authority  = hasLms ? SOURCE_AUTHORITY.FCC_LMS : SOURCE_AUTHORITY.OPERATOR_INPUT;
      const crossCheck = hasLms && Number.isFinite(si.frequency) && Number.isFinite(lms.frequency);
      const conflictEntry = null; // provenanceConflicts handles the detail
      return { field: name, source_authority: authority, cross_checked: crossCheck, conflict: false };
    }
    case 'erp': {
      const hasLmsErp  = el.licensed_erp_kw != null;
      const authority  = hasLmsErp ? SOURCE_AUTHORITY.FCC_LMS : SOURCE_AUTHORITY.OPERATOR_INPUT;
      const crossCheck = hasLmsErp;
      const conflict   = hasLmsErp && el.variance_pct != null && el.variance_pct > 5;
      const conflictDetail = conflict
        ? `ERP ${el.proposed_erp_kw} kW vs licensed ${el.licensed_erp_kw} kW (${el.variance_pct}%)`
        : null;
      return { field: name, source_authority: authority, cross_checked: crossCheck && !conflict, conflict, conflict_detail: conflictDetail };
    }
    case 'coordinates': {
      const authority  = hasLms ? SOURCE_AUTHORITY.FCC_LMS : (hasAsr ? SOURCE_AUTHORITY.FCC_ASR : SOURCE_AUTHORITY.OPERATOR_INPUT);
      const crossCheck = hasLms && hasAsr;
      return { field: name, source_authority: authority, cross_checked: crossCheck, conflict: false };
    }
    case 'tower_height': {
      const authority  = hasAsr ? SOURCE_AUTHORITY.FCC_ASR : SOURCE_AUTHORITY.OPERATOR_INPUT;
      const crossCheck = false;
      return { field: name, source_authority: authority, cross_checked: crossCheck, conflict: false };
    }
    case 'haat': {
      const authority  = hl.operative_source === 'terrain_mean'
        ? SOURCE_AUTHORITY.USGS_DEM
        : hl.operative_source === 'fcc_license'
          ? SOURCE_AUTHORITY.FCC_LMS
          : SOURCE_AUTHORITY.OPERATOR_INPUT;
      const crossCheck = hl.operative_source === 'terrain_mean' && hasLms;
      return { field: name, source_authority: authority, cross_checked: crossCheck, conflict: false };
    }
    case 'rcamsl': {
      const authority  = hasDem ? SOURCE_AUTHORITY.USGS_DEM : SOURCE_AUTHORITY.OPERATOR_INPUT;
      const crossCheck = false;
      return { field: name, source_authority: authority, cross_checked: crossCheck, conflict: false };
    }
    case 'fcc_class': {
      const authority = cl.engineering_assumption_source === 'operator_supplied'
        ? SOURCE_AUTHORITY.FCC_LMS
        : SOURCE_AUTHORITY.OPERATOR_INPUT;
      const crossCheck = false;
      return { field: name, source_authority: authority, cross_checked: crossCheck, conflict: false };
    }
    default:
      return { field: name, source_authority: SOURCE_AUTHORITY.UNKNOWN, cross_checked: false, conflict: false };
  }
}

// Stamp conflict flags back onto fieldLineage entries based on detected conflicts.
function applyConflicts(fieldMap, conflicts){
  for (const c of conflicts){
    const entry = fieldMap[c.field];
    if (entry){
      entry.conflict        = true;
      entry.conflict_detail = c.description;
    }
  }
}

export function buildSourceAttestation(exhibit, evidence, options = {}){
  const ev = evidence || exhibit.evidence || {};

  // 1. Classify per-field provenance
  const ATTESTATION_FIELDS = [
    'frequency', 'erp', 'coordinates', 'tower_height', 'haat', 'rcamsl', 'fcc_class'
  ];

  const fieldMap = {};
  for (const name of ATTESTATION_FIELDS){
    fieldMap[name] = classifyField(name, exhibit, ev);
  }

  // 2. Detect cross-source conflicts
  const conflicts = detectProvenanceConflicts(exhibit, ev);

  // 3. Stamp conflict flags onto affected fields
  applyConflicts(fieldMap, conflicts);

  // 4. Score each field
  const scoredFields = {};
  for (const [name, lineage] of Object.entries(fieldMap)){
    scoredFields[name] = scoreSource(lineage);
  }

  // 5. Roll up overall score, blockers, warnings
  const { overall_confidence, field_scores, source_blockers, source_warnings } =
    scoreExhibitSources(scoredFields);

  // 6. Hash the evidence sources
  const source_hashes = hashEvidence(ev);

  // 7. Assess source freshness — pass resolved evidence via a shim so
  //    assessExhibitSourceFreshness can read it regardless of whether it
  //    lives on exhibit.evidence or was supplied as a separate argument.
  const exhibitWithEvidence = ev === exhibit.evidence
    ? exhibit
    : { ...exhibit, evidence: ev };
  const source_freshness = assessExhibitSourceFreshness(exhibitWithEvidence, options);
  const { warnings: freshnessWarnings, blockers: freshnessBlockers } =
    collectFreshnessIssues(source_freshness);

  // 8. Build evidence lock (uses source_hashes computed above)
  //    Pass partial attestation so buildEvidenceLock can read hashes.
  const partialExhibit = { ...exhibit, source_attestation: { source_hashes } };
  const evidence_lock  = buildEvidenceLock(partialExhibit);

  // Merge freshness issues into attestation blockers/warnings (deduped by code+source).
  const mergedBlockers = [...source_blockers];
  const mergedWarnings = [...source_warnings];

  for (const b of freshnessBlockers){
    if (!mergedBlockers.some(x => x.code === b.code && x.source === b.source)){
      mergedBlockers.push(b);
    }
  }
  for (const w of freshnessWarnings){
    if (!mergedWarnings.some(x => x.code === w.code && x.source === w.source)){
      mergedWarnings.push(w);
    }
  }

  return {
    overall_confidence,
    fields: scoredFields,
    field_scores,
    conflicts,
    source_hashes,
    source_freshness,
    evidence_lock,
    blockers: mergedBlockers,
    warnings: mergedWarnings,
    generated_at: new Date().toISOString()
  };
}

// options forwarded from exhibitService (e.g. { now: Date })
export function buildSourceAttestationWithOptions(exhibit, evidence, options = {}){
  return buildSourceAttestation(exhibit, evidence, options);
}
