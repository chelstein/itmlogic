// Form 301-FM mapping: exhibit → filled fields.
//
// Pure function.  Given (exhibit, optional applicant overrides),
// resolves every field in FORM_301_FM_FIELDS to one of:
//   { ..., status: 'filled',  value }      — Genoa knows it
//   { ..., status: 'gap',     value: null } — manual entry required
//   { ..., status: 'unknown', value: null } — Genoa SHOULD know but evidence missing
//
// The packager renders these into the cheat-sheet HTML / JSON the
// licensee pastes into LMS.

import { FORM_301_FM_FIELDS, FORM_301_FM_META } from './form301fm.js';

function dotPath(obj, path){
  if (!obj || !path) return undefined;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function mapForm301Fm(exhibit, applicant = {}){
  if (!exhibit || typeof exhibit !== 'object'){
    throw new Error('mapForm301Fm: exhibit is required');
  }
  const filled = [];
  for (const def of FORM_301_FM_FIELDS){
    let value = null;
    let status = 'gap';
    if (def.source === 'genoa-auto'){
      if (typeof def.derive === 'function'){
        value = def.derive(exhibit);
      } else if (def.mapping){
        value = dotPath(exhibit, def.mapping);
      }
      if (value !== undefined && value !== null && !(typeof value === 'string' && !value.trim())){
        status = 'filled';
      } else {
        status = 'unknown';
      }
    } else if (def.source === 'manual-engineer'){
      // Surface engineer-provided value if applicant.engineer carries it.
      const v = applicant?.engineer?.[def.id];
      if (v !== undefined && v !== null && v !== ''){
        value = v;
        status = 'filled';
      } else {
        status = 'gap';
      }
    } else {
      // manual-applicant — out of scope; surface as gap.
      status = 'gap';
    }
    filled.push({ ...def, value: value ?? null, status });
  }

  const summary = {
    total:      filled.length,
    filled:     filled.filter(f => f.status === 'filled').length,
    gaps:       filled.filter(f => f.status === 'gap').length,
    unknown:    filled.filter(f => f.status === 'unknown').length,
    required_gaps: filled.filter(f => f.required && f.status !== 'filled').length
  };

  // Filing-readiness: every required field filled, no engine blockers,
  // and the exhibit has at least a §73.207 OR §73.215 pass.
  const compliance_pass = filled.find(f => f.id === 'compliance-pass')?.value;
  const blockers = exhibit.blockers?.length || 0;
  const filing_ready = summary.required_gaps === 0
    && blockers === 0
    && (compliance_pass === 'PASS' || compliance_pass === 'PASS-via-73.215');

  return {
    form:        FORM_301_FM_META,
    fields:      filled,
    summary,
    filing_ready,
    blockers_count: blockers,
    compliance_pass: compliance_pass || null,
    exhibit_metadata: {
      call:        exhibit?.station_inputs?.call || null,
      facility_id: exhibit?.station_inputs?.facility_id || null,
      service:     exhibit?.station_inputs?.service || null,
      build_sha:   exhibit?.build_attestation?.sha || exhibit?.engine_signature?.hash || null,
      replay_token: exhibit?.replay_token || null,
      replay_digest_exhibit_sha256: exhibit?.replay_digest?.exhibit_sha256 || null
    }
  };
}
