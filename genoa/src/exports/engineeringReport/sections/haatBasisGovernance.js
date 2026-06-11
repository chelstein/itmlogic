// HAAT BASIS AND GOVERNANCE section — filing-grade governance block.
//
// Declares, in one place, which HAAT value controls the RF engineering
// calculations and the filed exhibit:
//   1. The study intent and facility status that drive basis selection
//   2. The FCC-authorized HAAT (if applicable)
//   3. The Genoa-computed §73.313 radial HAAT mean and per-radial range
//   4. The filing-controlling HAAT, its basis, and its source
//   5. The conflict/review status with a plain-language reason
// plus a visual governance table that shows every HAAT concept side by
// side with its source, role, and whether it controls the filing.
//
// Rendered as a 'considerations' section (kvRows + table + summary) so
// both renderPdf.js and renderText.js produce the full governance block.
// (The previous 'text'/content shape was silently dropped by both
// renderers' default branches — the section printed a heading and
// nothing else.)
//
// This section is always rendered for FM/LPFM/FX exhibits and omitted for AM
// (AM groundwave does not use HAAT per §73.184).

const STUDY_INTENT_LABEL = {
  existing_facility_review: 'Existing Licensed Facility Review',
  cp_application:           'Construction Permit Application',
  modification:             'Facility Modification Study',
  proposed:                 'Proposed Facility Study',
  allocation_study:         'Allocation Study'
};

const FACILITY_STATUS_LABEL = {
  licensed:   'Licensed Facility',
  cp_granted: 'Construction Permit Granted',
  proposed:   'Proposed Facility'
};

const BASIS_LABEL = {
  FCC_AUTHORIZED:           'FCC_AUTHORIZED — licensed facility HAAT controls',
  GENOA_COMPUTED_73_313:    'GENOA_COMPUTED_73_313 — terrain-derived §73.313 mean controls',
  ENGINEER_OVERRIDE_LOCKED: 'ENGINEER_OVERRIDE_LOCKED — engineer override (immutable in exhibit hash)',
  OPERATOR_DECLARED:        'OPERATOR_DECLARED — operator input (no terrain or FCC evidence available)'
};

// Display mapping for the conflict status.  The resolver emits
// RESOLVED | REVIEW_REQUIRED | BLOCKER; the exhibit displays the
// engineer-facing labels.
const CONFLICT_DISPLAY = {
  RESOLVED:        'RESOLVED',
  REVIEW_REQUIRED: 'REVIEW',
  BLOCKER:         'BLOCKER'
};

function fmtM(v){
  return (v === null || v === undefined || !Number.isFinite(Number(v))) ? '—' : `${v} m`;
}

export function buildHaatBasisGovernanceSection(exhibit, options = {}) {
  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();

  // AM groundwave is conductivity-based, not HAAT-based — skip
  if (svc === 'AM') return null;

  const ha = exhibit?.haat_authority;
  if (!ha) return null;

  const prov           = ha.provenance || {};
  const studyIntent    = STUDY_INTENT_LABEL[prov.study_intent] || prov.study_intent || '—';
  const facilityStatus = FACILITY_STATUS_LABEL[prov.facility_status] || prov.facility_status || '—';
  const isLicensed     = prov.facility_status === 'licensed';
  const conflictDisplay = CONFLICT_DISPLAY[ha.haat_conflict_status] || ha.haat_conflict_status || '—';

  // Per-radial range from the validated radial array.
  const radials = Array.isArray(ha.computed_radial_haat_m) ? ha.computed_radial_haat_m : [];
  const radialRange = radials.length
    ? `${Math.min(...radials).toFixed(1)} m – ${Math.max(...radials).toFixed(1)} m  (${radials.length} radials)`
    : 'Not available — terrain DEM evidence absent';

  // ------------------------------------------------------------------
  // Governance block (key/value) — the headline declaration.
  // ------------------------------------------------------------------
  const kvRows = [
    ['Study Intent',             studyIntent],
    ['Facility Status',          facilityStatus],
    ['FCC Authorized HAAT',      fmtM(ha.authorized_haat_m)],
    ['Genoa Computed Mean HAAT', fmtM(ha.computed_average_haat_m)],
    ['Computed Radial Range',    radialRange],
    ['Operator-Declared HAAT',   fmtM(ha.operator_declared_haat_m)],
    ['Filing-Controlling HAAT',  fmtM(ha.filing_controlling_haat_m)],
    ['Filing-Controlling Basis', ha.filing_controlling_haat_basis || 'UNRESOLVED'],
    ['Filing Source',            ha.filing_controlling_haat_source || '—'],
    ['Conflict Status',          conflictDisplay]
  ];

  // Plain-language reason for the declared conflict status.
  let reason;
  if (ha.haat_conflict_status === 'REVIEW_REQUIRED' && isLicensed){
    reason =
      'Existing licensed facilities may possess a licensed HAAT that differs from ' +
      'terrain-derived recalculations.  The FCC-authorized HAAT remains the ' +
      'filing-controlling value unless an engineer override or facility ' +
      'modification changes the declared basis.';
  } else if (ha.haat_conflict_status === 'REVIEW_REQUIRED'){
    reason =
      'Two HAAT evidence sources differ beyond tolerance.  The engineer of record ' +
      'must confirm the declared filing-controlling basis before filing.';
  } else if (ha.haat_conflict_status === 'BLOCKER'){
    reason =
      'A required HAAT value is missing or a conflict cannot be resolved.  This ' +
      'exhibit cannot be filed as-is; see the blockers listed below.';
  } else {
    reason =
      'All available HAAT evidence agrees within tolerance; the filing-controlling ' +
      'basis is unambiguous.';
  }
  kvRows.push(['Reason', reason]);

  // ------------------------------------------------------------------
  // Visual governance table — every HAAT concept side by side.
  // ------------------------------------------------------------------
  const basis = ha.filing_controlling_haat_basis;
  const tableRows = [
    {
      concept:  'FCC-Authorized HAAT',
      value_m:  ha.authorized_haat_m != null ? String(ha.authorized_haat_m) : '—',
      source:   'FCC license / CP (LMS)',
      role:     'Factual regulatory record',
      controls: basis === 'FCC_AUTHORIZED' ? 'YES — CONTROLS FILING' : 'No'
    },
    {
      concept:  'Genoa-Computed §73.313 Mean',
      value_m:  ha.computed_average_haat_m != null ? String(ha.computed_average_haat_m) : '—',
      source:   'Terrain DEM (§73.313 radial method)',
      role:     'Engineering-analysis value',
      controls: basis === 'GENOA_COMPUTED_73_313' ? 'YES — CONTROLS FILING' : 'No — retained for review'
    },
    {
      concept:  'Operator-Declared HAAT',
      value_m:  ha.operator_declared_haat_m != null ? String(ha.operator_declared_haat_m) : '—',
      source:   'Study form input',
      role:     'Captured for audit',
      controls: basis === 'OPERATOR_DECLARED' ? 'YES — CONTROLS FILING' : 'No'
    }
  ];
  if (ha.engineer_override){
    tableRows.push({
      concept:  'Engineer Override (locked)',
      value_m:  ha.engineer_override.value_m != null ? String(ha.engineer_override.value_m) : '—',
      source:   `Evidence: ${ha.engineer_override.evidence_ref || '—'}`,
      role:     'Immutable in exhibit hash',
      controls: basis === 'ENGINEER_OVERRIDE_LOCKED' ? 'YES — CONTROLS FILING' : 'No'
    });
  }

  // ------------------------------------------------------------------
  // Summary — review messages, blockers/warnings, override audit, and
  // the standing regulatory statement.
  // ------------------------------------------------------------------
  const summaryParts = [];

  if (ha.haat_review_messages?.length){
    summaryParts.push('REVIEW NOTES:\n' + ha.haat_review_messages.map(m => `• ${m}`).join('\n'));
  }
  if (ha.haat_blockers?.length){
    summaryParts.push('BLOCKERS:\n' + ha.haat_blockers.map(b => `• [${b.code}] ${b.message}`).join('\n'));
  }
  if (ha.haat_warnings?.length){
    summaryParts.push('WARNINGS:\n' + ha.haat_warnings.map(w => `• [${w.code}] ${w.message}`).join('\n'));
  }
  if (ha.engineer_override){
    const eo = ha.engineer_override;
    summaryParts.push(
      'ENGINEER OVERRIDE (LOCKED):\n' +
      `• Override value: ${fmtM(eo.value_m)}` +
      (eo.original_value_m != null ? `\n• Original value: ${fmtM(eo.original_value_m)}` : '') +
      `\n• Evidence ref: ${eo.evidence_ref}` +
      `\n• Override time: ${eo.timestamp}` +
      '\n• Engineer identity and reason are recorded in the server-side attestation log; ' +
      'this override is immutable in the exhibit hash and replay token.'
    );
  }

  summaryParts.push(
    'REGULATORY STATEMENT:  The FCC-authorized HAAT is the factual licensed facility ' +
    'value.  The Genoa-computed §73.313 radial HAAT is shown for engineering review ' +
    'and contour recomputation.  A difference between these values is not ' +
    'automatically a defect; it is a basis-selection issue that must be explicitly ' +
    'declared by the engineer of record.  Final certification of the HAAT basis is ' +
    'the responsibility of the qualified broadcast engineer of record per ' +
    '47 CFR §1.17 and §73.1015 (truthful and accurate statements); ' +
    'transmission system modifications are governed by §73.1690.'
  );

  return {
    id:      'haat-basis-governance',
    type:    'considerations',
    heading: 'HAAT BASIS AND GOVERNANCE',
    preface:
      'This section declares which HAAT value controls the RF engineering ' +
      'calculations and the filed exhibit.  Three distinct HAAT concepts are ' +
      'maintained and never conflated: the FCC-authorized HAAT (the licensed ' +
      'facility record), the Genoa-computed 47 CFR §73.313 terrain-derived radial ' +
      'HAAT (an engineering-analysis value), and the operator-declared HAAT (a ' +
      'form input captured for audit).  The filing-controlling value and its basis ' +
      'are declared below.',
    kvRows,
    table: {
      columns: [
        { key: 'concept',  label: 'HAAT Concept',     width: 0.26 },
        { key: 'value_m',  label: 'Value (m)',        width: 0.10 },
        { key: 'source',   label: 'Source',           width: 0.26 },
        { key: 'role',     label: 'Role',             width: 0.18 },
        { key: 'controls', label: 'Controls Filing?', width: 0.20 }
      ],
      rows: tableRows
    },
    summary: summaryParts.join('\n\n'),
    // Machine-readable pass-through (unchanged shape for downstream consumers).
    haat_conflict_status: ha.haat_conflict_status,
    filing_controlling_haat_m:     ha.filing_controlling_haat_m,
    filing_controlling_haat_basis: ha.filing_controlling_haat_basis
  };
}
