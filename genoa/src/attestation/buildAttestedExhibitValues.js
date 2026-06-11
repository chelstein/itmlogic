// Source Attestation Framework v2 — exhibit integration.
//
// Maps an exhibit + resolved evidence into attested-value candidates
// for every filing-relevant field, runs the deterministic operative-
// value resolver per field, and assembles the exhibit-level
// source_attestation_v2 block:
//
//   {
//     schema: 'source-attestation/v2',
//     fields: { haat_m: <resolution>, ... },
//     statuses: { math_status, source_status, rule_status,
//                 evidence_status, filing_status },
//     warnings: [issue], blockers: [issue],
//     generated_at
//   }
//
// This FEEDS the existing v1 provenance/replay logic — it does not
// replace it.  The v2 block lands on the exhibit before
// buildAttestation() computes the replay token, so the replay/
// provenance hashes commit the attestation payload.

import { makeAttestedValue, wrapLegacyScalar, hashValue } from './attestedValue.js';
import { resolveOperativeValue } from './resolveOperativeValue.js';
import { buildStatusDimensions, MATH_STATUS, RULE_STATUS, EVIDENCE_STATUS } from './statusDimensions.js';
import { SOURCE_TYPE } from './sourceAuthority.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function pushCandidate(list, spec){
  if (spec.value === null || spec.value === undefined) return;
  if (typeof spec.value === 'number' && !Number.isFinite(spec.value)) return;
  list.push(makeAttestedValue(spec));
}

/**
 * Collect attested-value candidates per field from the exhibit + evidence.
 * Exported for tests.
 */
export function collectFieldCandidates(exhibit, evidence){
  const si  = exhibit.station_inputs   || {};
  const ev  = evidence || exhibit.evidence || {};
  const lms = ev.fcc_lms?.license      || {};
  const asr = ev.asr                   || {};
  const faa = ev.faa_oe                || exhibit.evidence?.faa_oe || {};
  const hl  = exhibit.haat_lineage     || {};
  const rl  = exhibit.rcamsl_lineage   || {};
  const el  = exhibit.erp_lineage      || {};
  const cl  = exhibit.class_lineage    || {};
  const fl  = exhibit.frequency_lineage || {};

  const lmsFetchedAt = ev.fcc_lms?.fetched_at || null;
  const lmsLabel     = 'FCC LMS facility record';
  const fields = {};
  const F = (k) => (fields[k] ??= []);

  // ---- facility_id ----
  pushCandidate(F('facility_id'), { key: 'facility_id', value: si.facility_id ?? null, source_type: SOURCE_TYPE.OPERATOR_INPUT });
  pushCandidate(F('facility_id'), { key: 'facility_id', value: lms.facility_id ?? null, source_type: SOURCE_TYPE.FCC_LMS, source_label: lmsLabel, fetched_at: lmsFetchedAt });

  // ---- callsign ----
  pushCandidate(F('callsign'), { key: 'callsign', value: si.call ?? si.callsign ?? null, source_type: SOURCE_TYPE.OPERATOR_INPUT });
  pushCandidate(F('callsign'), { key: 'callsign', value: lms.call ?? null, source_type: SOURCE_TYPE.FCC_LMS, source_label: lmsLabel, fetched_at: lmsFetchedAt });

  // ---- frequency ----
  const freqUnit = fl.unit || si.frequency_unit || 'MHz';
  pushCandidate(F('frequency_mhz'), { key: 'frequency_mhz', value: num(si.frequency ?? fl.value), unit: freqUnit, source_type: SOURCE_TYPE.OPERATOR_INPUT });
  pushCandidate(F('frequency_mhz'), { key: 'frequency_mhz', value: num(lms.frequency), unit: lms.frequency_unit || freqUnit, source_type: SOURCE_TYPE.FCC_LMS, source_label: lmsLabel, fetched_at: lmsFetchedAt });

  // ---- channel ----
  pushCandidate(F('channel'), { key: 'channel', value: si.channel ?? null, source_type: SOURCE_TYPE.OPERATOR_INPUT });
  pushCandidate(F('channel'), { key: 'channel', value: lms.channel ?? null, source_type: SOURCE_TYPE.FCC_LMS, source_label: lmsLabel, fetched_at: lmsFetchedAt });

  // ---- ERP ----
  pushCandidate(F('erp_kw'), { key: 'erp_kw', value: num(el.proposed_erp_kw ?? si.erp_kw), unit: 'kW', source_type: SOURCE_TYPE.OPERATOR_INPUT });
  pushCandidate(F('erp_kw'), { key: 'erp_kw', value: num(el.licensed_erp_kw ?? lms.erp_kw), unit: 'kW', source_type: SOURCE_TYPE.FCC_LMS, source_label: lmsLabel, fetched_at: lmsFetchedAt });

  // ---- HAAT ----
  pushCandidate(F('haat_m'), { key: 'haat_m', value: num(hl.operator_entered_m), unit: 'm', source_type: SOURCE_TYPE.OPERATOR_INPUT });
  pushCandidate(F('haat_m'), { key: 'haat_m', value: num(lms.haat_m ?? hl.fcc_authorized_m), unit: 'm', source_type: SOURCE_TYPE.FCC_LMS, source_label: lmsLabel, fetched_at: lmsFetchedAt });
  // Terrain-derived HAAT — DEM source per rcamsl elevation_source when stated.
  const demType = /srtm/i.test(String(rl.elevation_source || '')) ? SOURCE_TYPE.SRTM_DEM : SOURCE_TYPE.USGS_DEM;
  pushCandidate(F('haat_m'), { key: 'haat_m', value: num(hl.terrain_mean_m), unit: 'm', source_type: demType, source_label: 'Terrain-derived HAAT (DEM radial mean)' });

  // ---- RCAMSL ----
  pushCandidate(F('rcamsl_m'), { key: 'rcamsl_m', value: num(si.overall_height_amsl_m ?? si.rcamsl_m), unit: 'm', source_type: SOURCE_TYPE.OPERATOR_INPUT });
  if (rl.source && rl.source !== 'not_resolved'){
    pushCandidate(F('rcamsl_m'), { key: 'rcamsl_m', value: num(rl.value_m), unit: 'm', source_type: SOURCE_TYPE.ENGINE_DERIVED, source_label: `RCAMSL derived (${rl.source})` });
  }

  // ---- ground elevation ----
  pushCandidate(F('ground_elevation_m'), { key: 'ground_elevation_m', value: num(rl.ground_elev_m), unit: 'm', source_type: demType, source_label: `Ground elevation (${rl.elevation_source || 'DEM'})` });
  pushCandidate(F('ground_elevation_m'), { key: 'ground_elevation_m', value: num(si.ground_elevation_m), unit: 'm', source_type: SOURCE_TYPE.OPERATOR_INPUT });

  // ---- coordinates ----
  const siCoord  = (Number.isFinite(num(si.lat)) && Number.isFinite(num(si.lon))) ? { lat: num(si.lat), lon: num(si.lon) } : null;
  const lmsCoord = (Number.isFinite(num(lms.lat)) && Number.isFinite(num(lms.lon))) ? { lat: num(lms.lat), lon: num(lms.lon) } : null;
  const asrCoord = (Number.isFinite(num(asr.lat)) && Number.isFinite(num(asr.lon))) ? { lat: num(asr.lat), lon: num(asr.lon) } : null;
  if (siCoord)  pushCandidate(F('coordinates_lat_lon'), { key: 'coordinates_lat_lon', value: siCoord,  unit: 'deg', source_type: SOURCE_TYPE.OPERATOR_INPUT });
  if (lmsCoord) pushCandidate(F('coordinates_lat_lon'), { key: 'coordinates_lat_lon', value: lmsCoord, unit: 'deg', source_type: SOURCE_TYPE.FCC_LMS, source_label: lmsLabel, fetched_at: lmsFetchedAt });
  if (asrCoord) pushCandidate(F('coordinates_lat_lon'), { key: 'coordinates_lat_lon', value: asrCoord, unit: 'deg', source_type: SOURCE_TYPE.FCC_ASR, source_label: 'FCC ASR registered coordinates', fetched_at: asr.fetched_at || null });

  // ---- FCC class ----
  pushCandidate(F('fcc_class'), { key: 'fcc_class', value: cl.raw ?? si.fcc_class ?? null, source_type: SOURCE_TYPE.OPERATOR_INPUT });
  pushCandidate(F('fcc_class'), { key: 'fcc_class', value: cl.licensed_class ?? null, source_type: SOURCE_TYPE.FCC_LMS, source_label: lmsLabel, fetched_at: lmsFetchedAt });

  // ---- antenna pattern ----
  if (Array.isArray(exhibit.pattern) && exhibit.pattern.length > 0){
    pushCandidate(F('antenna_pattern'), {
      key: 'antenna_pattern', value: exhibit.pattern,
      source_type: si.pattern_table ? SOURCE_TYPE.OPERATOR_INPUT : SOURCE_TYPE.ENGINE_DERIVED,
      source_label: si.pattern_table ? 'Operator-supplied pattern table' : 'Engine-computed pattern'
    });
  }

  // ---- ASR ID + tower height ----
  pushCandidate(F('asr_id'), { key: 'asr_id', value: asr.asr_number ?? asr.registration_number ?? si.asr_id ?? null, source_type: asr.asr_number || asr.registration_number ? SOURCE_TYPE.FCC_ASR : SOURCE_TYPE.OPERATOR_INPUT, fetched_at: asr.fetched_at || null });
  // Operator-entered tower height: 0 is a sentinel meaning "unknown".
  // ASR (PRIMARY) outranks OPERATOR_INPUT in authority; when both exist the
  // resolver picks the ASR value and marks the 0m entry as non-operative.
  const siHeightAgl = num(si.overall_height_m);
  pushCandidate(F('asr_height_agl_m'), { key: 'asr_height_agl_m', value: siHeightAgl, unit: 'm', source_type: SOURCE_TYPE.OPERATOR_INPUT });
  pushCandidate(F('asr_height_agl_m'), { key: 'asr_height_agl_m', value: num(asr.overall_height_m), unit: 'm', source_type: SOURCE_TYPE.FCC_ASR, source_label: 'FCC ASR registered height AGL', fetched_at: asr.fetched_at || null });
  pushCandidate(F('asr_height_amsl_m'), { key: 'asr_height_amsl_m', value: num(asr.overall_height_amsl_m), unit: 'm', source_type: SOURCE_TYPE.FCC_ASR, source_label: 'FCC ASR registered height AMSL', fetched_at: asr.fetched_at || null });

  // ---- FAA study number ----
  pushCandidate(F('faa_study_number'), { key: 'faa_study_number', value: faa.study_number ?? null, source_type: SOURCE_TYPE.FAA_OEAAA, source_label: 'FAA OE/AAA determination', fetched_at: faa.fetched_at || null });

  // ---- terrain source / curve dataset / engine version ----
  pushCandidate(F('terrain_source'), { key: 'terrain_source', value: rl.elevation_source ?? hl.terrain_source ?? null, source_type: SOURCE_TYPE.ENGINE_DERIVED, source_label: 'Terrain dataset used for radial HAAT' });
  const mv = exhibit.method_versions || {};
  pushCandidate(F('curve_dataset'), { key: 'curve_dataset', value: mv.curves ?? mv.curve_dataset ?? mv.fcc_curves ?? null, source_type: SOURCE_TYPE.ENGINE_DERIVED, source_label: 'FCC propagation curve dataset' });
  pushCandidate(F('engine_version'), { key: 'engine_version', value: exhibit.build_attestation?.sha ?? exhibit.build_attestation?.version ?? null, source_type: SOURCE_TYPE.ENGINE_DERIVED, source_label: 'Genoa engine build SHA' });

  // ---- manual overrides supplied via exhibit.attestation_overrides ----
  // Shape: { haat_m: { value, unit, reason, reviewer }, ... }
  const overrides = exhibit.attestation_overrides || {};
  for (const [k, o] of Object.entries(overrides)){
    if (!o || o.value === undefined) continue;
    pushCandidate(F(k), {
      key: k, value: o.value, unit: o.unit ?? null,
      source_type:  SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE,
      source_label: 'Manual engineer override',
      override:     { reason: o.reason, reviewer: o.reviewer }
    });
  }

  // Drop fields with zero candidates.
  for (const k of Object.keys(fields)){
    if (fields[k].length === 0) delete fields[k];
  }
  return fields;
}

// ---- upstream status derivation ----

function deriveMathStatus(exhibit){
  const v  = exhibit.validation_context || exhibit.validation || {};
  const cr = v.curve_reference_validation || null;
  if (!cr) return MATH_STATUS.NOT_RUN;
  if (cr.pass === true  || cr.result === 'pass') return MATH_STATUS.PASS;
  if (cr.pass === false || cr.result === 'fail') return MATH_STATUS.FAIL;
  return MATH_STATUS.NOT_RUN;
}

function deriveRuleStatus(exhibit){
  // Check interference_study directly — filing_readiness is stamped BEFORE
  // buildInterferenceStudy() runs (engine/index.js lines 928 vs 931), so
  // filing_readiness.status may not reflect interference failures.
  // buildAttestedExhibitValues runs after both, so we can check here.
  const isr = exhibit.interference_study;
  if (isr && isr.filing_qualifies === false) return RULE_STATUS.FAIL;

  const fr = exhibit.filing_readiness || null;
  if (!fr || !fr.status) return RULE_STATUS.NOT_RUN;
  const s = String(fr.status).toUpperCase();
  if (s === 'BLOCKED' || s === 'NON_COMPLIANT' || s === 'FAIL') return RULE_STATUS.FAIL;
  if (s === 'REVIEW'  || s === 'NEEDS_REVIEW')                  return RULE_STATUS.REVIEW;
  return RULE_STATUS.PASS;
}

function deriveEvidenceStatus(exhibit){
  const ms = exhibit.measurements || exhibit.evidence?.measurements || null;
  const sdr = exhibit.evidence?.sdr_residuals || exhibit.evidence?.sdr_captures || null;
  if ((Array.isArray(ms) && ms.length > 0) || sdr) return EVIDENCE_STATUS.MEASURED;
  return EVIDENCE_STATUS.UNMEASURED;
}

/**
 * Build the full source_attestation_v2 block for an exhibit.
 *
 * @param {object} exhibit   exhibit (post-compute, lineage stamped)
 * @param {object} evidence  resolved evidence (or null → exhibit.evidence)
 * @param {object} options   { evidence_required, now }
 */
export function buildAttestedExhibitValues(exhibit, evidence, options = {}){
  const fields = collectFieldCandidates(exhibit, evidence);

  const resolutions = {};
  const warnings = [];
  const blockers = [];

  // "NEW" facility sentinel — callsign or facility_id string "NEW" means the FCC
  // has not yet assigned a callsign / facility_id (new-station applications).
  // The identity is SOURCE_UNVERIFIED until the LMS application is accepted; add
  // a blocker so filing_status reflects BLOCKED rather than silently showing VERIFIED.
  {
    const si = exhibit.station_inputs || {};
    const evLms = (evidence || exhibit.evidence || {})?.fcc_lms?.license || {};
    const rawCall = (si.call ?? si.callsign ?? evLms.call ?? '');
    const rawFid  = (si.facility_id ?? evLms.facility_id ?? '');
    const isNewCall = String(rawCall).trim().toUpperCase() === 'NEW';
    const isNewFid  = String(rawFid).trim().toUpperCase() === 'NEW'
                   || String(rawFid).trim() === '';
    if (isNewCall){
      blockers.push({ code: 'SOURCE_UNVERIFIED_CALLSIGN',  key: 'callsign',
        message: 'Callsign is "NEW" — facility not yet assigned by FCC; identity SOURCE_UNVERIFIED.  Re-run after LMS application is accepted to resolve.',
        severity: 'BLOCKER' });
    }
    if (isNewFid && isNewCall){
      blockers.push({ code: 'SOURCE_UNVERIFIED_FACILITY_ID', key: 'facility_id',
        message: 'facility_id is unassigned (new-station application) — identity SOURCE_UNVERIFIED.  Re-run after FCC issues a facility_id.',
        severity: 'BLOCKER' });
    }
  }
  for (const [key, candidates] of Object.entries(fields)){
    const r = resolveOperativeValue(key, candidates, options);
    resolutions[key] = r;
    for (const issue of r.issues || []){
      const bucket = issue.severity === 'BLOCKER' ? blockers : warnings;
      if (!bucket.some(x => x.code === issue.code && x.key === issue.key)) bucket.push(issue);
    }
  }

  const statuses = buildStatusDimensions({
    math_status:       deriveMathStatus(exhibit),
    rule_status:       deriveRuleStatus(exhibit),
    evidence_status:   deriveEvidenceStatus(exhibit),
    evidence_required: options.evidence_required === true,
    resolutions
  });

  // Deterministic payload hash — projection of the resolution content
  // EXCLUDING volatile timestamps (fetched_at, generated_at) so two
  // computes of the same exhibit produce the same hash.  This is the
  // value the replay/provenance chain commits.
  const projection = Object.fromEntries(Object.entries(resolutions).map(([k, r]) => [k, {
    operative_value:       r.operative_value,
    operative_source_type: r.operative_source_type,
    confidence:            r.confidence,
    status:                r.status,
    warnings:              r.warnings,
    blockers:              r.blockers,
    candidates: (r.candidates || []).map(c => ({
      source_type:     c.source_type,
      authority_level: c.authority_level,
      value:           c.value,
      unit:            c.unit ?? null,
      confidence:      c.confidence,
      operative:       !!c.operative,
      conflicts:       c.conflicts || []
    }))
  }]));
  const payload_sha256 = hashValue({ fields: projection, statuses });

  // Strip override.reason / override.reviewer from candidates before returning —
  // those fields contain engineer PII and must not reach external API callers.
  // The payload_sha256 projection above already excludes them; here we match that
  // for the public fields surface, keeping all other resolution metadata intact.
  const publicResolutions = Object.fromEntries(Object.entries(resolutions).map(([k, r]) => [k, {
    ...r,
    candidates: (r.candidates || []).map(({ override: _override, notes: _notes, ...rest }) => rest)
  }]));

  return {
    schema:       'source-attestation/v2',
    fields:       publicResolutions,
    statuses,
    warnings,
    blockers,
    payload_sha256,
    generated_at: new Date().toISOString()
  };
}

export { wrapLegacyScalar };
