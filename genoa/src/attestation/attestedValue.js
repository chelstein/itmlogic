// Source Attestation Framework v2 — attested value object.
//
// Every filing-relevant engineering value is represented as an
// attested value: the value plus its source type, authority level,
// confidence, evidence hash, operative flag, and any conflicts.
//
// makeAttestedValue() normalizes a raw candidate into this shape.
// wrapLegacyScalar() is the backward-compatibility path: old
// pipelines that supply bare scalars get an OPERATOR_INPUT /
// OPERATOR_SUPPLIED / LOW wrapper with an OPERATOR_SUPPLIED_ONLY
// warning, so nothing crashes but weak source quality stays visible.

import crypto from 'node:crypto';
import { resolveSourceType, AUTHORITY_LEVEL, SOURCE_TYPE } from './sourceAuthority.js';

const CONFIDENCE_LEVELS = new Set(['HIGH', 'MEDIUM', 'LOW']);

/** Canonical-JSON SHA-256 of a value (stable key order). */
export function hashValue(value){
  const canon = JSON.stringify(value, (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)){
      return Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {});
    }
    return v;
  });
  return crypto.createHash('sha256').update(canon ?? 'null', 'utf8').digest('hex');
}

/**
 * Build an attested value.
 *
 * @param {object} spec
 *   key            field key (e.g. 'haat_m')           — required
 *   value          the value                            — required (may be object for coordinates)
 *   unit           unit string or null
 *   source_type    one of SOURCE_TYPE                   — required
 *   source_label   human label; defaults from registry description
 *   confidence     'HIGH'|'MEDIUM'|'LOW'; defaults from registry
 *   fetched_at     ISO timestamp the source was fetched; defaults now
 *   evidence_hash  hash of upstream evidence payload; computed from value when absent
 *   override       { reason, reviewer } — required for MANUAL_ENGINEER_OVERRIDE
 *   notes          string[]
 */
export function makeAttestedValue(spec){
  if (!spec || typeof spec !== 'object') throw new Error('makeAttestedValue: spec object required');
  if (!spec.key) throw new Error('makeAttestedValue: key is required');
  if (spec.value === undefined) throw new Error(`makeAttestedValue(${spec.key}): value is required`);

  const reg = resolveSourceType(spec.source_type);
  const confidence = CONFIDENCE_LEVELS.has(spec.confidence) ? spec.confidence : reg.confidence_default;

  const av = {
    key:             spec.key,
    value:           spec.value,
    unit:            spec.unit ?? null,
    source_type:     reg.source_type,
    source_label:    spec.source_label || reg.description,
    authority_level: reg.authority_level,
    confidence,
    fetched_at:      spec.fetched_at || new Date().toISOString(),
    evidence_hash:   spec.evidence_hash || hashValue(spec.value),
    operative:       false,            // resolver assigns
    conflicts:       [],               // resolver assigns
    notes:           Array.isArray(spec.notes) ? [...spec.notes] : []
  };
  if (spec.override) av.override = { reason: spec.override.reason ?? null, reviewer: spec.override.reviewer ?? null };
  return av;
}

/**
 * Backward compatibility: wrap a raw scalar from an old pipeline as an
 * operator-supplied attested value.  Never throws on null/undefined —
 * returns null instead so callers can skip absent fields.
 */
export function wrapLegacyScalar(key, value, unit = null){
  if (value === undefined || value === null) return null;
  const av = makeAttestedValue({
    key,
    value,
    unit,
    source_type:  SOURCE_TYPE.OPERATOR_INPUT,
    source_label: 'Legacy pipeline scalar (wrapped)',
    confidence:   'LOW',
    notes:        ['Wrapped from a raw scalar by the v2 backward-compatibility shim.']
  });
  av.authority_level = AUTHORITY_LEVEL.OPERATOR_SUPPLIED;
  av.legacy_wrapped  = true;
  return av;
}

/**
 * Validate an attested value candidate. Returns { valid, errors }.
 * Used by the resolver before ranking; invalid candidates are excluded
 * from operative selection but still reported.
 */
export function validateAttestedValue(av){
  const errors = [];
  if (!av || typeof av !== 'object'){ return { valid: false, errors: ['candidate is not an object'] }; }
  if (!av.key) errors.push('missing key');
  if (av.value === undefined) errors.push('missing value');
  if (!av.source_type) errors.push('missing source_type');
  if (av.confidence && !CONFIDENCE_LEVELS.has(av.confidence)) errors.push(`invalid confidence "${av.confidence}"`);
  return { valid: errors.length === 0, errors };
}
