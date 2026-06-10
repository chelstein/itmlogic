// HAAT BASIS AND GOVERNANCE section
//
// Renders a structured exhibit section that explicitly declares:
//   1. The FCC-authorized HAAT (if applicable)
//   2. The Genoa-computed §73.313 radial HAAT (if terrain evidence exists)
//   3. The operator-declared HAAT
//   4. The filing-controlling basis and which value was used for RF calculations
//   5. Any conflicts, blockers, or review requirements
//
// This section is always rendered for FM/LPFM/FX exhibits and omitted for AM
// (AM groundwave does not use HAAT per §73.184).

export function buildHaatBasisGovernanceSection(exhibit, options = {}) {
  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();

  // AM groundwave is conductivity-based, not HAAT-based — skip
  if (svc === 'AM') return null;

  const ha = exhibit?.haat_authority;
  if (!ha) return null;

  const lines = [];

  lines.push('This section declares which HAAT value controls the RF engineering calculations');
  lines.push('and the filed exhibit. Three distinct HAAT concepts are maintained and never conflated:');
  lines.push('');

  // ------------------------------------------------------------------
  // 1. FCC-Authorized HAAT
  // ------------------------------------------------------------------
  lines.push('1. FCC-AUTHORIZED HAAT (facility license / CP)');
  if (ha.authorized_haat_m != null) {
    lines.push(`   Value:  ${ha.authorized_haat_m} m`);
    lines.push('   This is the HAAT value appearing on the station\'s current license or Construction Permit.');
    lines.push('   It is a factual regulatory record and cannot be changed without a new license or CP.');
  } else {
    lines.push('   Not available — no FCC license data was attached to this exhibit.');
  }
  lines.push('');

  // ------------------------------------------------------------------
  // 2. Genoa-Computed §73.313 Radial HAAT
  // ------------------------------------------------------------------
  lines.push('2. GENOA-COMPUTED §73.313 RADIAL HAAT (terrain-derived)');
  if (ha.computed_average_haat_m != null) {
    const radialCount = ha.computed_radial_haat_m?.length ?? ha.provenance?.radial_count_used ?? '—';
    lines.push(`   Mean:   ${ha.computed_average_haat_m} m  (${radialCount} radials)`);
    lines.push('   Method: 47 CFR §73.313 — terrain elevation sampling via multi-source DEM;');
    lines.push('           per-radial HAAT = transmitter AMSL minus mean ground elevation over 3–16 km.');
    lines.push('   This value is used for contour recomputation studies and engineering analysis.');
    lines.push('   It is an engineering-analysis value, not a licensed value.');
  } else {
    lines.push('   Not available — no terrain-derived per-radial HAAT data was attached.');
    lines.push('   Terrain DEM unavailable; per-radial HAAT computation was not performed.');
  }
  lines.push('');

  // ------------------------------------------------------------------
  // 3. Operator-Declared HAAT
  // ------------------------------------------------------------------
  lines.push('3. OPERATOR-DECLARED HAAT (form input)');
  if (ha.operator_declared_haat_m != null) {
    lines.push(`   Value:  ${ha.operator_declared_haat_m} m`);
    lines.push('   This is the value entered by the operator or licensee into the engineering study form.');
    lines.push('   It may match the FCC-authorized HAAT, a tower AGL height, or a prior study value.');
    lines.push('   It is captured for audit and display but is not blindly trusted for RF calculations.');
  } else {
    lines.push('   Not provided — no operator HAAT input was found.');
  }
  lines.push('');

  // ------------------------------------------------------------------
  // 4. Filing-Controlling HAAT
  // ------------------------------------------------------------------
  lines.push('4. FILING-CONTROLLING HAAT');
  if (ha.filing_controlling_haat_m != null) {
    lines.push(`   Value:  ${ha.filing_controlling_haat_m} m`);
    const basisLabel = {
      FCC_AUTHORIZED:          'FCC-authorized (licensed facility HAAT)',
      GENOA_COMPUTED_73_313:   'Genoa-computed §73.313 terrain-derived mean',
      ENGINEER_OVERRIDE_LOCKED: 'Engineer override (locked — immutable in exhibit hash)',
      OPERATOR_DECLARED:       'Operator-declared (no terrain or FCC evidence available)'
    }[ha.filing_controlling_haat_basis] || ha.filing_controlling_haat_basis || '—';
    lines.push(`   Basis:  ${basisLabel}`);
    lines.push(`   Source: ${ha.filing_controlling_haat_source || '—'}`);
    lines.push('   This is the HAAT value used for all §73.333 contour calculations in this exhibit.');
  } else {
    lines.push('   UNRESOLVED — no filing-controlling HAAT could be determined.');
    lines.push('   See BLOCKERS below.');
  }
  lines.push('');

  // ------------------------------------------------------------------
  // 5. Conflict / review status
  // ------------------------------------------------------------------
  lines.push('5. HAAT BASIS REVIEW STATUS');
  const statusLabels = {
    RESOLVED:        'RESOLVED — Values agree within tolerance; basis is unambiguous.',
    REVIEW_REQUIRED: 'REVIEW REQUIRED — FCC-authorized and computed §73.313 HAAT differ; engineer must confirm basis.',
    BLOCKER:         'BLOCKER — A required value is missing or a conflict cannot be resolved; this exhibit cannot be filed as-is.'
  };
  lines.push(`   Status: ${statusLabels[ha.haat_conflict_status] || ha.haat_conflict_status || '—'}`);
  lines.push('');

  if (ha.haat_review_messages?.length) {
    for (const m of ha.haat_review_messages) {
      lines.push(`   ${m}`);
      lines.push('');
    }
  }

  if (ha.haat_blockers?.length) {
    lines.push('   BLOCKERS:');
    for (const b of ha.haat_blockers) {
      lines.push(`   [${b.code}] ${b.message}`);
    }
    lines.push('');
  }

  if (ha.haat_warnings?.length) {
    lines.push('   WARNINGS:');
    for (const w of ha.haat_warnings) {
      lines.push(`   [${w.code}] ${w.message}`);
    }
    lines.push('');
  }

  // ------------------------------------------------------------------
  // 6. Engineer override audit trail (PII-stripped)
  // ------------------------------------------------------------------
  if (ha.engineer_override) {
    lines.push('6. ENGINEER OVERRIDE (LOCKED)');
    lines.push(`   Override value:   ${ha.engineer_override.value_m} m`);
    if (ha.engineer_override.original_value_m != null) {
      lines.push(`   Original value:   ${ha.engineer_override.original_value_m} m`);
    }
    lines.push(`   Evidence ref:     ${ha.engineer_override.evidence_ref}`);
    lines.push(`   Override time:    ${ha.engineer_override.timestamp}`);
    lines.push('   Engineer identity and reason are recorded in the server-side attestation log.');
    lines.push('   This override is immutable in the exhibit hash and replay token.');
    lines.push('');
  }

  // ------------------------------------------------------------------
  // Regulatory note
  // ------------------------------------------------------------------
  lines.push('REGULATORY STATEMENT:');
  lines.push('The FCC-authorized HAAT is the factual licensed facility value. Genoa-computed');
  lines.push('§73.313 radial HAAT is shown for engineering review and contour recomputation.');
  lines.push('A difference between these values is not automatically a defect; it is a');
  lines.push('basis-selection issue that must be explicitly declared by the engineer of record.');
  lines.push('Final certification of the HAAT basis is the responsibility of the qualified');
  lines.push('broadcast engineer of record per 47 CFR §73.801 / §73.1690.');

  return {
    id:      'haat-basis-governance',
    type:    'text',
    heading: 'HAAT BASIS AND GOVERNANCE',
    content: lines.join('\n'),
    haat_conflict_status: ha.haat_conflict_status,
    filing_controlling_haat_m:     ha.filing_controlling_haat_m,
    filing_controlling_haat_basis: ha.filing_controlling_haat_basis
  };
}
