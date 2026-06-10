// SOURCE ATTESTATION report section (Source Attestation Framework v2).
//
// Renders immediately BEFORE the build-attestation/provenance section.
// Shows, for every filing-relevant field: the operative value, the
// source it came from, authority level, confidence, and resolution
// status — plus every non-operative conflicting candidate with its
// conflict code, so a KNIX-style HAAT/RCAMSL disagreement is a first-
// class table row rather than an AI advisory note.
//
// Self-deferring: returns null when exhibit.source_attestation_v2 is
// absent (legacy exhibits keep rendering unchanged).

const AUTHORITY_LABEL = {
  PRIMARY:           'PRIMARY',
  SECONDARY:         'SECONDARY',
  TERTIARY:          'TERTIARY',
  ADVISORY:          'ADVISORY',
  OPERATOR_SUPPLIED: 'OPERATOR',
  UNKNOWN:           'UNKNOWN'
};

const SOURCE_LABEL = {
  FCC_LMS:                  'FCC LMS',
  FCC_CDBS:                 'FCC CDBS',
  FCC_ASR:                  'FCC ASR',
  FAA_OEAAA:                'FAA OE/AAA',
  USGS_DEM:                 'USGS DEM',
  SRTM_DEM:                 'SRTM DEM',
  OPEN_METEO:               'Open-Meteo',
  OPERATOR_INPUT:           'Operator input',
  ENGINE_DERIVED:           'Genoa engine',
  SDR_MEASUREMENT:          'SDR measurement',
  MANUAL_ENGINEER_OVERRIDE: 'Engineer override'
};

function fmtValue(v, unit){
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object' && Number.isFinite(v.lat) && Number.isFinite(v.lon)){
    return `${v.lat.toFixed(6)}, ${v.lon.toFixed(6)}`;
  }
  if (Array.isArray(v)) return `[pattern, ${v.length} points]`;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')) : String(v);
  return unit ? `${s} ${unit}` : s;
}

const FIELD_LABEL = {
  facility_id:         'Facility ID',
  callsign:            'Callsign',
  frequency_mhz:       'Frequency',
  channel:             'Channel',
  erp_kw:              'ERP',
  haat_m:              'HAAT (filing-controlling)',
  rcamsl_m:            'RCAMSL',
  ground_elevation_m:  'Ground elevation',
  coordinates_lat_lon: 'Coordinates',
  fcc_class:           'FCC class',
  antenna_pattern:     'Antenna pattern',
  asr_id:              'ASR ID',
  asr_height_agl_m:    'Tower height (AGL)',
  asr_height_amsl_m:   'Tower height (AMSL)',
  faa_study_number:    'FAA study number',
  terrain_source:      'Terrain source',
  curve_dataset:       'Curve dataset',
  engine_version:      'Engine version/SHA'
};

export function buildSourceAttestationSection(exhibit, options){
  const att = exhibit?.source_attestation_v2;
  if (!att || !att.fields) return null;

  const rows = [];
  const conflictNarratives = [];

  for (const [key, r] of Object.entries(att.fields)){
    const label = FIELD_LABEL[key] || key;
    rows.push({
      field:      label,
      value:      fmtValue(r.operative_value, r.operative_unit),
      source:     SOURCE_LABEL[r.operative_source_type] || r.operative_source_type || '—',
      authority:  (r.candidates || []).find(c => c.operative)?.authority_level
                    ? AUTHORITY_LABEL[(r.candidates || []).find(c => c.operative).authority_level]
                    : '—',
      confidence: r.confidence || '—',
      status:     r.status
    });

    // Non-operative conflicting candidates get their own rows.
    for (const c of (r.candidates || [])){
      if (c.operative || !(c.conflicts || []).length) continue;
      rows.push({
        field:      `  ↳ ${label} (non-operative)`,
        value:      fmtValue(c.value, c.unit),
        source:     SOURCE_LABEL[c.source_type] || c.source_type,
        authority:  AUTHORITY_LABEL[c.authority_level] || c.authority_level,
        confidence: c.confidence || '—',
        status:     `NON_OPERATIVE_CONFLICT (${c.conflicts[0]?.code || 'SOURCE_CONFLICT'})`
      });
      const op = (r.candidates || []).find(x => x.operative);
      if (op){
        // Humanized conflict panel — written the way a consulting engineer
        // reads, not the way the resolver stores it.  The machine-readable
        // codes stay in the table rows above; this panel is the prose the
        // PDF reader actually uses.
        const isHaatField = key === 'haat_m';
        const opSource    = SOURCE_LABEL[op.source_type] || op.source_type;
        const altSource   = SOURCE_LABEL[c.source_type] || c.source_type;
        const opIsLicensed = op.source_type === 'FCC_LMS' || op.source_type === 'FCC_CDBS';
        const statusLine  = opIsLicensed
          ? 'Licensed value controls.'
          : op.source_type === 'MANUAL_ENGINEER_OVERRIDE'
            ? 'Engineer override controls.'
            : `${opSource} value controls (highest-authority source).`;
        if (isHaatField) {
          // A difference between an FCC-authorized HAAT and a Genoa-computed
          // §73.313 HAAT is a basis-selection issue, NOT a math failure.
          conflictNarratives.push(
            `HAAT\n\n` +
            `Controlling Value:\n${fmtValue(op.value, op.unit)}\n\n` +
            `Source:\n${opSource}\n\n` +
            `Status:\n${statusLine}\n\n` +
            `Additional Evidence:\n${altSource} HAAT = ${fmtValue(c.value, c.unit)}\n\n` +
            `Review Note:\nDifference exceeds tolerance ` +
            `(Δ ${c.conflicts[0]?.delta ?? '—'} vs tolerance ${c.conflicts[0]?.tolerance ?? '—'}).  ` +
            `Retained for engineering review.  Does not control filing calculations.\n\n` +
            `The filing-controlling HAAT used in this exhibit's RF calculations is ` +
            `${fmtValue(op.value, op.unit)} from ${opSource}.  A difference between the ` +
            `FCC-authorized HAAT and the Genoa-computed §73.313 radial HAAT is a ` +
            `basis-selection issue, not a math failure; it must be explicitly declared by ` +
            `the engineer of record.  See HAAT BASIS AND GOVERNANCE for the declared basis.`
          );
        } else {
          conflictNarratives.push(
            `${label.toUpperCase()}\n\n` +
            `Controlling Value:\n${fmtValue(op.value, op.unit)}\n\n` +
            `Source:\n${opSource}\n\n` +
            `Status:\n${statusLine}\n\n` +
            `Additional Evidence:\n${altSource} = ${fmtValue(c.value, c.unit)}\n\n` +
            `Review Note:\nDifference exceeds tolerance ` +
            `(Δ ${c.conflicts[0]?.delta ?? '—'} vs tolerance ${c.conflicts[0]?.tolerance ?? '—'}).  ` +
            `Retained for engineering review.  Does not control filing calculations ` +
            `unless reviewed and promoted by the engineer of record.`
          );
        }
      }
    }
  }

  const st = att.statuses || {};
  const blockerCount = (att.blockers || []).length;
  const warningCount = (att.warnings || []).length;

  const paragraphs = [
    'Every filing-relevant engineering value in this exhibit carries a source ' +
    'attestation: the originating source, its authority level under the Genoa ' +
    'source-governance hierarchy (PRIMARY regulatory record → SECONDARY ' +
    'measurement → TERTIARY derivation → operator input; ADVISORY sources never ' +
    'control filing values), its confidence, and its conflict status.  The ' +
    'operative value for each field was selected deterministically by authority ' +
    'rank.  Status codes in the table are machine-readable audit values retained ' +
    'for traceability; each conflicting value is explained in plain language ' +
    'below the table.',
    ...conflictNarratives,
    `Status dimensions — math: ${st.math_status || '—'}; source: ${st.source_status || '—'}; ` +
    `rule: ${st.rule_status || '—'}; evidence: ${st.evidence_status || '—'}; ` +
    `filing readiness (derived): ${st.filing_status || '—'}.  ` +
    `${blockerCount} source blocker(s), ${warningCount} source warning(s).`
  ];

  return {
    id:      'source_attestation',
    type:    'table-with-summary',
    heading: 'SOURCE ATTESTATION',
    preface: paragraphs[0],
    table: {
      columns: [
        { key: 'field',      label: 'Field',           width: 0.20 },
        { key: 'value',      label: 'Operative Value', width: 0.20 },
        { key: 'source',     label: 'Source',          width: 0.14 },
        { key: 'authority',  label: 'Authority',       width: 0.11 },
        { key: 'confidence', label: 'Confidence',      width: 0.10 },
        { key: 'status',     label: 'Status',          width: 0.25 }
      ],
      rows
    },
    summary: paragraphs.slice(1).join('\n\n')
  };
}
