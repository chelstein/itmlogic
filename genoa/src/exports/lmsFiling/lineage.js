// Filing Field Lineage — full provenance for every Form 301-FM field.
//
// buildLineageReport(exhibit, applicant?) → {
//   schema, generated_at, exhibit_metadata, form, summary, fields
// }
//
// Per-field lineage record:
//   id                    field ID (stable kebab key)
//   lms_label             FCC LMS field label
//   section / subsection
//   required / advisory
//   value                 resolved value (null when not filled)
//   status                FILLED | SUGGESTED | NEEDS_INPUT | EVIDENCE_MISSING |
//                         INVALID | CONFLICT | NOT_APPLICABLE
//   blocking              true when required && status is a filing gap
//   source_system         FCC-FMQ | FCC-LMS | FCC-ASR | FAA-OE | terrain-sidecar |
//                         genoa-engine | operator-input | census-sidecar | unknown
//   source_path           dot-path into the exhibit where value was found,
//                         or 'computed:<description>' for derived values
//   confidence            high | medium | low | advisory | unknown
//   timestamp             ISO-8601 fetched_at/updated_at from the source, or null
//   validation_result     { valid: bool, reason: string|null }
//   provenance            raw provenance object from mapping.js
//   expected_source       for EVIDENCE_MISSING: where value should come from
//   conflict_values       for CONFLICT: [{ path, value, source_system }]
//   invalid_reason        for INVALID: error string from validateFilingField

import { mapFilingPackage, validateFilingField } from './mapping.js';
import { isFilingGap }                           from './_readiness.js';

// ── Path resolution helpers ───────────────────────────────────────────────────

function dotGet(obj, path){
  if (!obj || !path) return undefined;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

// Walk a list of candidate paths and return { path, value } for the first
// non-empty hit, or null if none match.
function firstFilledPath(exhibit, paths){
  for (const p of paths){
    const v = dotGet(exhibit, p);
    if (v !== undefined && v !== null && !(typeof v === 'string' && !v.trim())){
      return { path: p, value: v };
    }
  }
  return null;
}

// ── Candidate-path hints for every derive()-based FM field ───────────────────
//
// These mirror the firstNonEmptyPath() calls in form301fm.js so the lineage
// reporter can identify WHICH path in the exhibit provided the resolved value.
// For fields with math-only derive (channel-number, compliance-rule-path, etc.)
// we annotate with a compute description instead.

const LINEAGE_PATHS = {
  'station-call-sign':      { paths: ['station_inputs.call'] },
  'facility-id':            { paths: ['station_inputs.facility_id'] },
  'community-of-license':   {
    paths: [
      'station_inputs.community', 'station_inputs.community_of_license',
      'station_inputs.licensing_community', 'station_inputs.city',
      'evidence.fcc_lms.city', 'evidence.fcc_lms.community',
      'evidence.fcc_lms.community_of_license',
      'evidence.fcc_lms.license.community', 'evidence.fcc_lms.license.community_of_license',
      'evidence.fcc_lms.license.city',
      'facility_metadata.raw.city', 'facility_metadata.raw.community',
      'facility_metadata.raw.community_of_license',
      'facility_metadata.community', 'facility_metadata.community_of_license',
      'facility_metadata.city'
    ],
    expected_source: 'FCC FMQ facility record (facility_metadata.raw.city) or operator station_inputs.community'
  },
  'service':                { paths: ['station_inputs.service'] },
  'fcc-class':              {
    paths: [
      'station_inputs.fcc_class', 'station_inputs.class', 'station_inputs.station_class',
      'evidence.fcc_lms.license.fcc_class', 'evidence.fcc_lms.license.station_class',
      'evidence.fcc_lms.license.class',
      'facility_metadata.fcc_class', 'facility_metadata.class', 'facility_metadata.station_class'
    ],
    expected_source: 'Operator input (station_inputs.fcc_class) or FCC LMS license record'
  },
  'frequency-mhz':          { paths: ['station_inputs.frequency'] },
  'channel-number':         {
    computed: 'Math: round((frequency_mhz − 88.1) / 0.2) + 201',
    depends:  ['station_inputs.frequency']
  },
  'erp-kw-horizontal':      { paths: ['station_inputs.erp_kw'] },
  'erp-kw-vertical':        { paths: ['station_inputs.erp_v_kw'],
                              expected_source: 'Engineer-supplied ERP-V, or equals ERP-H for ND antennas' },
  'haat-m':                 {
    paths: ['station_inputs.haat_m_input', 'station_inputs.haat_m'],
    expected_source: 'Operator-supplied filing HAAT from station_inputs.haat_m_input'
  },
  'haat-terrain-advisory-m': {
    computed: 'Mean of evidence.terrain_haat_per_radial[].haat_computed_m',
    depends:  ['evidence.terrain_haat_per_radial']
  },
  'rcamsl-m':               {
    paths: ['evidence.terrain.rcamsl_m'],
    expected_source: 'Terrain sidecar (evidence.terrain.rcamsl_m) — requires terrain analysis run'
  },
  'rcagl-m':                {
    paths: [],
    expected_source: 'Engineer-supplied: tower height AGL + antenna mounting offset (not auto-derivable)'
  },
  'antenna-pattern':        { computed: 'Array.isArray(station_inputs.pattern) → DA, else ND' },
  'antenna-pattern-table':  { paths: ['station_inputs.pattern'] },
  'coordinates-nad83':      {
    computed: 'Object { lat, lon } from station_inputs.lat / station_inputs.lon',
    depends:  ['station_inputs.lat', 'station_inputs.lon']
  },
  'antenna-make-model':     { paths: [], expected_source: 'Engineer-supplied (manufacturer + model number)' },
  'compliance-rule-path':   {
    computed: 'Inferred from regulatory_compliance structure: presence of section_73_207 / pass field',
    depends:  ['regulatory_compliance'],
    expected_source: 'Requires regulatory_compliance block (FM contour engine output)'
  },
  'compliance-pass':        {
    computed: 'regulatory_compliance.pass → PASS/FAIL/PASS-via-73.215',
    depends:  ['regulatory_compliance'],
    expected_source: 'Requires regulatory_compliance block (FM contour engine output)'
  },
  'service-contour-distance-mean-km': {
    computed: 'polygons[].mean_radial_km where label matches /service|60/',
    depends:  ['polygons'],
    expected_source: 'Contour engine polygons[] output (60 dBu service contour)'
  },
  'protected-contour-distance-mean-km': {
    computed: 'polygons[].mean_radial_km where label matches /protected|40/',
    depends:  ['polygons'],
    expected_source: 'Contour engine polygons[] output (40 dBu protected contour)'
  },
  'interfering-contour-distance-mean-km': {
    computed: 'polygons[].mean_radial_km where label matches /interf|f5010/',
    depends:  ['polygons'],
    expected_source: 'Contour engine polygons[] output (F(50,10) interfering contour)'
  },
  'short-spacing-pairs':    {
    computed: 'regulatory_compliance.section_73_207.violations.length ?? 0',
    depends:  ['regulatory_compliance.section_73_207']
  },
  'short-spacing-resolution': {
    computed: 'Derived text when §73.207 fails but §73.215 passes',
    depends:  ['regulatory_compliance']
  },
  'population-served':      {
    paths: ['population_estimate.primary'],
    expected_source: 'Census/ACS dispatch (population_estimate.primary)'
  },
  'oet-65-boundary-pass':   {
    computed: 'oet65.compliance.boundary_check.pass → PASS/FAIL/NEAR-FIELD-REQUIRED/SKIPPED',
    depends:  ['oet65']
  },
  'oet-65-controlled-distance-m':   { paths: ['oet65.compliance.controlled.distance_m'] },
  'oet-65-uncontrolled-distance-m': { paths: ['oet65.compliance.uncontrolled.distance_m'] },
  'asr-number':             {
    paths: ['station_inputs.asr_number', 'evidence.asr.asr_number', 'tower_compliance'],
    expected_source: 'FCC ASR database (evidence.asr.asr_number) or operator input (station_inputs.asr_number)'
  },
  'tower-overall-height-agl-m': {
    paths: ['station_inputs.overall_height_m', 'evidence.asr.overall_height_m', 'tower_compliance.height_agl_m'],
    expected_source: 'FCC ASR record (evidence.asr.overall_height_m) or operator input (station_inputs.overall_height_m)'
  },
  'faa-determination':      {
    paths: ['evidence.faa_oe.determination', 'tower_compliance'],
    expected_source: 'FAA OE/AAA Form 7460-2 determination (evidence.faa_oe.determination)'
  },
  'tower-painting':         {
    paths: ['evidence.asr.painting_requirement'],
    expected_source: 'FCC ASR record (evidence.asr.painting_requirement) or tower_compliance.marking'
  },
  'tower-lighting':         {
    paths: ['evidence.asr.lighting_requirement'],
    expected_source: 'FCC ASR record (evidence.asr.lighting_requirement) or tower_compliance.lighting'
  },
  'engineering-statement-exhibit': { computed: 'Generated filename from call + date' },
  'contour-map-exhibit':           { computed: 'Embedded in Engineering Statement PDF' },
  'section-73-215-study-exhibit':  { computed: 'Embedded in Engineering Statement PDF (when §73.215 basis)' },
  'oet-65-statement-exhibit':      { computed: 'Embedded in Engineering Statement PDF' }
};

// ── Source system inference ───────────────────────────────────────────────────

function inferSourceSystem(sourcePath, exhibit){
  if (!sourcePath) return 'unknown';
  if (sourcePath.startsWith('computed:')) return 'genoa-engine';
  if (sourcePath.startsWith('facility_metadata.raw.') ||
      sourcePath.startsWith('facility_metadata.') && !sourcePath.includes('raw')){
    const src = exhibit?.facility_metadata?.facility_lookup_source;
    if (src && /fmq/i.test(src)) return 'FCC-FMQ';
    if (src && /ztr/i.test(src)) return 'ZTR';
    if (src) return src;
    return 'facility-record';
  }
  if (sourcePath.startsWith('station_inputs.')){
    // If facility lookup populated station_inputs, credit the source; otherwise operator.
    // Normalize the raw lookup source string to the same canonical tokens used
    // in inferConfidence (FCC-FMQ, ZTR, etc.) so the confidence switch matches.
    const fm  = exhibit?.facility_metadata;
    const src = fm?.facility_lookup_source;
    if (src){
      if (/fmq/i.test(src)) return 'FCC-FMQ';
      if (/ztr/i.test(src)) return 'ZTR';
      return src;
    }
    return 'operator-input';
  }
  if (sourcePath.startsWith('evidence.fcc_lms'))   return 'FCC-LMS';
  if (sourcePath.startsWith('evidence.terrain'))   return 'terrain-sidecar';
  if (sourcePath.startsWith('evidence.asr'))       return 'FCC-ASR';
  if (sourcePath.startsWith('evidence.faa_oe'))    return 'FAA-OE';
  if (sourcePath.startsWith('evidence.am_physics')) return 'SOMNEC2D';
  if (sourcePath.startsWith('evidence.am_physics_fccgw')) return 'FCCGW';
  if (sourcePath.startsWith('population_estimate')) return 'census-sidecar';
  if (sourcePath.startsWith('regulatory_compliance')) return 'genoa-engine';
  if (sourcePath.startsWith('oet65'))              return 'genoa-engine';
  if (sourcePath.startsWith('polygons'))           return 'genoa-engine';
  if (sourcePath.startsWith('tower_compliance'))   return 'genoa-engine';
  return 'genoa-engine';
}

function inferConfidence(sourceSystem, def, exhibit){
  if (def?.advisory) return 'advisory';
  switch (sourceSystem){
    case 'FCC-FMQ':          return 'high';
    case 'FCC-LMS':          return 'high';
    case 'FCC-ASR':          return 'high';
    case 'FAA-OE':           return 'high';
    case 'ZTR':              return 'high';
    case 'terrain-sidecar':  {
      // Downgrade to 'medium' when running on flat HAAT (no DEM).
      const t = exhibit?.evidence?.terrain;
      if (!t?.available) return 'low';
      return t.dem?.source ? 'high' : 'medium';
    }
    case 'operator-input':   return 'medium';
    case 'census-sidecar':   return 'medium';
    case 'genoa-engine':     return 'high';
    case 'SOMNEC2D':         return 'advisory';
    case 'FCCGW':            return 'advisory';
    default:                 return 'unknown';
  }
}

function inferTimestamp(sourceSystem, exhibit){
  switch (sourceSystem){
    case 'FCC-FMQ':
    case 'ZTR':
    case 'facility-record':
      return exhibit?.facility_metadata?.facility_updated_at || null;
    case 'FCC-LMS':
      return exhibit?.evidence?.fcc_lms?.fetched_at || null;
    case 'FCC-ASR':
      return exhibit?.evidence?.asr?.fetched_at || null;
    case 'FAA-OE':
      return exhibit?.evidence?.faa_oe?.fetched_at || null;
    case 'terrain-sidecar':
      return exhibit?.evidence?.terrain?.fetched_at || null;
    case 'census-sidecar':
      return exhibit?.population_estimate?.fetched_at || null;
    case 'SOMNEC2D':
      return exhibit?.evidence?.am_physics?.fetched_at || null;
    case 'FCCGW':
      return exhibit?.evidence?.am_physics_fccgw?.fetched_at || null;
    default:
      return exhibit?.generated_at || null;
  }
}

// ── Source path resolution ────────────────────────────────────────────────────

function resolveSourcePath(fieldId, def, exhibit, resolvedValue){
  const hint = LINEAGE_PATHS[fieldId];

  // Computed (math / logic) — no single exhibit path.
  if (hint?.computed){
    return `computed:${hint.computed}`;
  }

  // Try hint candidate paths first.
  if (hint?.paths?.length){
    const hit = firstFilledPath(exhibit, hint.paths);
    if (hit) return hit.path;
  }

  // Fall back to def.mapping (simple dot-path fields).
  if (def?.mapping){
    const v = dotGet(exhibit, def.mapping);
    if (v !== undefined && v !== null && String(v).trim() !== '') return def.mapping;
  }

  // Could not find the value in any known path — mark unknown.
  return resolvedValue !== null && resolvedValue !== undefined
    ? 'unknown-path'
    : null;
}

// ── Conflict detection ────────────────────────────────────────────────────────
//
// For fields that can be populated from multiple independent authoritative
// sources, check if those sources disagree.  Returns an array of
// { path, value, source_system } when conflict exists, or null.

function detectConflicts(fieldId, def, exhibit, primaryValue){
  // Only check certain fields where multiple authoritative sources exist.
  const CONFLICT_CHECKS = {
    'haat-m': [
      'station_inputs.haat_m_input',
      'station_inputs.haat_m',
      'facility_metadata.raw.haat_m',
      'evidence.fcc_lms.haat_m'
    ],
    'erp-kw-horizontal': [
      'station_inputs.erp_kw',
      'facility_metadata.raw.erp_kw',
      'evidence.fcc_lms.erp_kw'
    ],
    'frequency-mhz': [
      'station_inputs.frequency',
      'facility_metadata.raw.frequency',
      'evidence.fcc_lms.frequency'
    ]
  };

  const candidates = CONFLICT_CHECKS[fieldId];
  if (!candidates || primaryValue === null || primaryValue === undefined) return null;

  const found = [];
  for (const p of candidates){
    const v = dotGet(exhibit, p);
    if (v === undefined || v === null) continue;
    const n = Number.isFinite(Number(primaryValue)) ? Number(v) : v;
    if (found.length === 0){
      found.push({ path: p, value: v, source_system: inferSourceSystem(p, exhibit) });
    } else {
      const first = Number.isFinite(Number(found[0].value)) ? Number(found[0].value) : found[0].value;
      const cur   = Number.isFinite(Number(v)) ? Number(v) : v;
      // Report conflict when numeric values diverge by >0.5% or strings differ.
      const differs = typeof first === 'number'
        ? Math.abs(first - cur) / (Math.abs(first) || 1) > 0.005
        : String(first).toUpperCase() !== String(cur).toUpperCase();
      if (differs){
        found.push({ path: p, value: v, source_system: inferSourceSystem(p, exhibit) });
      }
    }
  }

  return found.length > 1 ? found : null;
}

// ── Per-field lineage enrichment ──────────────────────────────────────────────

function enrichField(mappedField, allDefs, exhibit){
  const def        = allDefs.find(d => d.id === mappedField.id) || {};
  const hint       = LINEAGE_PATHS[mappedField.id] || {};
  const status     = mappedField.status;
  const value      = mappedField.value;
  const advisory   = !!def.advisory;
  const blocking   = !!mappedField.required && isFilingGap(status);

  // Source path.
  const sourcePath   = resolveSourcePath(mappedField.id, def, exhibit, value);
  const sourceSystem = inferSourceSystem(sourcePath, exhibit);
  const confidence   = inferConfidence(sourceSystem, def, exhibit);
  const timestamp    = inferTimestamp(sourceSystem, exhibit);

  // Validation.
  let validationResult;
  if (status === 'invalid'){
    // The invalid_reason is in provenance.note (set by validateFilingField in mapping.js).
    validationResult = { valid: false, reason: mappedField.provenance?.note || 'failed safety check' };
  } else if (status === 'filled'){
    const err = validateFilingField({ def, value });
    validationResult = err ? { valid: false, reason: err } : { valid: true, reason: null };
  } else {
    validationResult = { valid: false, reason: `status: ${status}` };
  }

  // Conflict detection (for FILLED fields that have multiple source candidates).
  const conflictValues = (status === 'filled' || status === 'conflict')
    ? detectConflicts(mappedField.id, def, exhibit, value)
    : null;

  // Expected source for EVIDENCE_MISSING.
  const expectedSource = (status === 'unknown' || status === 'EVIDENCE_MISSING')
    ? (hint.expected_source || def.notes || null)
    : null;

  // Invalid reason for INVALID.
  const invalidReason = status === 'invalid'
    ? (mappedField.provenance?.note || null)
    : null;

  return {
    id:           mappedField.id,
    lms_label:    mappedField.lms_label,
    section:      mappedField.section,
    subsection:   mappedField.subsection,
    required:     !!mappedField.required,
    advisory,
    filing_critical: !advisory && !!mappedField.required,
    value,
    status,
    blocking,
    source_system: sourceSystem,
    source_path:   sourcePath,
    confidence,
    timestamp,
    validation_result: validationResult,
    provenance:    mappedField.provenance || null,
    expected_source:  expectedSource,
    conflict_values:  conflictValues,
    invalid_reason:   invalidReason,
    notes:            mappedField.notes || def.notes || null,
    engineer_confirmation_required: mappedField.engineer_confirmation_required || false
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildLineageReport(exhibit, applicant = {}){
  if (!exhibit || typeof exhibit !== 'object'){
    throw new Error('buildLineageReport: exhibit is required');
  }

  const mapped = mapFilingPackage(exhibit, applicant);

  // Import field defs for the selected service (via the mapped schema).
  // We need the original def objects (with physical_dimension, advisory, etc.)
  // to enrich the fields.  Reconstruct from the mapped fields — they carry
  // all def keys except derive/suggest (stripped as non-serializable).
  const allDefs = mapped.fields;   // mapped fields carry the schema shape

  const fields = mapped.fields.map(f => enrichField(f, allDefs, exhibit));

  const blockingGaps   = fields.filter(f => f.blocking);
  const advisoryFields = fields.filter(f => f.advisory);
  const invalidFields  = fields.filter(f => f.status === 'invalid');
  const conflictFields = fields.filter(f => f.conflict_values && f.conflict_values.length > 1);

  const summary = {
    total:            fields.length,
    filled:           fields.filter(f => f.status === 'filled').length,
    suggested:        fields.filter(f => f.status === 'suggested').length,
    needs_input:      fields.filter(f => f.status === 'gap' || f.status === 'NEEDS_INPUT').length,
    evidence_missing: fields.filter(f => f.status === 'unknown' || f.status === 'EVIDENCE_MISSING').length,
    invalid:          invalidFields.length,
    conflict:         conflictFields.filter(f => f.status === 'conflict').length,
    not_applicable:   fields.filter(f => f.status === 'na' || f.status === 'NOT_APPLICABLE').length,
    blocking_gaps:    blockingGaps.length,
    advisory_count:   advisoryFields.length,
    filing_ready:     mapped.filing_ready,
    gating_reason:    mapped.gating_reason ?? null,
    compliance_pass:  mapped.compliance_pass ?? null
  };

  return {
    schema:           'genoa.filing_lineage.v1',
    generated_at:     new Date().toISOString(),
    exhibit_metadata: mapped.exhibit_metadata,
    form:             mapped.form,
    summary,
    fields
  };
}
