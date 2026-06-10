// HAAT Authority Resolver — single source of truth for the filing-controlling HAAT.
//
// This module answers one question: which HAAT value controls the RF engineering
// calculations and the filed exhibit, and on what legal/evidentiary basis?
//
// Three HAAT concepts are explicitly distinguished and NEVER conflated:
//
//   1. FCC-authorized HAAT (authorized_haat_m)
//      The HAAT value appearing on the station's current license or CP.
//      Factual. Cannot be changed without a new license/CP.
//
//   2. Genoa-computed §73.313 radial HAAT (computed_average_haat_m / computed_radial_haat_m)
//      Terrain-derived via DEM sampling per 47 CFR §73.313 method.
//      Engineering-analysis value. Used for contour recomputation studies.
//
//   3. Operator-declared HAAT (operator_declared_haat_m)
//      What the operator typed into the form. May be correct, may be an
//      AGL height erroneously entered as HAAT, may be the licensed value.
//      Always captured; never blindly trusted for type-C RF calculations.
//
// Filing-controlling basis enum:
//   FCC_AUTHORIZED         — licensed value controls; computed shown as comparison
//   GENOA_COMPUTED_73_313  — terrain-derived mean controls; FCC shown as comparison
//   ENGINEER_OVERRIDE_LOCKED — explicit engineer override; all evidence captured
//
// Conflict status:
//   RESOLVED        — basis clearly determined, values agree within tolerance
//   REVIEW_REQUIRED — authorized vs computed differ; engineer must declare basis
//   BLOCKER         — missing required evidence, illegal override, or fatal conflict

const TOLERANCE_M         = 30;   // within 30 m: RESOLVED; beyond: REVIEW_REQUIRED
const TOLERANCE_RELATIVE  = 0.15; // 15% relative also triggers REVIEW_REQUIRED

// Engineer overrides require all five fields.
const REQUIRED_OVERRIDE_FIELDS = ['value_m', 'reason', 'engineer', 'timestamp', 'evidence_ref'];

export function resolveHaatAuthority({
  studyIntent        = 'existing_facility_review',
  facilityStatus     = 'licensed',
  fccAuthorizedHaatM = null,
  operatorDeclaredHaatM = null,
  computedRadialHaat = [],           // array from evidence.terrain_haat_per_radial
  rcamslM            = null,
  groundElevationM   = null,
  engineerOverride   = null          // { value_m, reason, engineer, timestamp, evidence_ref, original_value_m }
} = {}) {
  const blockers  = [];
  const warnings  = [];
  const messages  = [];

  const authHaat  = _finite(fccAuthorizedHaatM);
  const opHaat    = _finite(operatorDeclaredHaatM);

  // ------------------------------------------------------------------
  // 1.  Compute terrain-derived §73.313 average from per-radial array
  // ------------------------------------------------------------------
  let computedMean = null;
  const validRadials = (Array.isArray(computedRadialHaat) ? computedRadialHaat : [])
    .map(r => {
      const cv = _finite(r?.haat_computed_m);
      if (cv !== null) return cv;
      return _finite(r?.haat_m);
    })
    .filter(v => v !== null && v > -200);

  if (validRadials.length >= 3) {
    const sum = validRadials.reduce((a, b) => a + b, 0);
    const raw = sum / validRadials.length;
    if (Number.isFinite(raw) && raw > -200) {
      computedMean = Math.round(raw * 10) / 10;
    }
  }

  // ------------------------------------------------------------------
  // 2.  Engineer override — validate completeness first
  // ------------------------------------------------------------------
  let overrideLocked = false;
  if (engineerOverride != null && typeof engineerOverride === 'object') {
    const missing = REQUIRED_OVERRIDE_FIELDS.filter(f => !engineerOverride[f]);
    if (missing.length > 0) {
      blockers.push({
        code:    'ENGINEER_OVERRIDE_INCOMPLETE',
        message: `Engineer override is missing required fields: ${missing.join(', ')}. All five fields (value_m, reason, engineer, timestamp, evidence_ref) are required for an override to be valid.`
      });
    } else if (!Number.isFinite(_finite(engineerOverride.value_m))) {
      blockers.push({
        code:    'ENGINEER_OVERRIDE_INVALID_VALUE',
        message: 'Engineer override value_m is not a finite number.'
      });
    } else {
      overrideLocked = true;
    }
  }

  // ------------------------------------------------------------------
  // 3.  Determine filing-controlling HAAT and basis
  // ------------------------------------------------------------------
  let filingControllingHaatM   = null;
  let filingControllingBasis   = null;
  let filingControllingSource  = null;
  let haat_conflict_status     = 'RESOLVED';

  if (overrideLocked) {
    // Engineer override outranks everything — immutable in exhibit hash
    filingControllingHaatM  = _finite(engineerOverride.value_m);
    filingControllingBasis  = 'ENGINEER_OVERRIDE_LOCKED';
    filingControllingSource = `engineer:${engineerOverride.engineer} at ${engineerOverride.timestamp}`;
    messages.push(`Filing HAAT locked by engineer override: ${filingControllingHaatM} m. Reason: ${engineerOverride.reason}. Evidence: ${engineerOverride.evidence_ref}.`);

  } else if (facilityStatus === 'licensed' && authHaat !== null) {
    // Existing licensed facility: FCC-authorized HAAT is the filing basis.
    // Computed §73.313 HAAT is shown for review, not for filing.
    filingControllingHaatM  = authHaat;
    filingControllingBasis  = 'FCC_AUTHORIZED';
    filingControllingSource = 'evidence.fcc_licensed.haat_m';

    // Check if computed value differs significantly — REVIEW_REQUIRED, not BLOCKER
    if (computedMean !== null) {
      const absDiff     = Math.abs(computedMean - authHaat);
      const relDiff     = authHaat > 0 ? absDiff / authHaat : Infinity;
      if (absDiff > TOLERANCE_M || relDiff > TOLERANCE_RELATIVE) {
        haat_conflict_status = 'REVIEW_REQUIRED';
        messages.push(
          `The FCC-authorized HAAT is ${authHaat} m. ` +
          `Genoa-computed §73.313 radial HAAT mean is ${computedMean} m ` +
          `(difference: ${absDiff.toFixed(1)} m, ${(relDiff * 100).toFixed(1)}%). ` +
          `A difference between these values is not automatically a defect; it is a ` +
          `basis-selection issue that must be explicitly declared. ` +
          `The FCC-authorized HAAT is the factual licensed facility value. ` +
          `Genoa-computed §73.313 radial HAAT is shown for engineering review and ` +
          `contour recomputation. If the computed HAAT is to control the filing, ` +
          `change facilityStatus to 'cp_granted' or 'proposed', or supply an engineer override.`
        );
      } else {
        messages.push(`FCC-authorized HAAT (${authHaat} m) and computed §73.313 mean (${computedMean} m) agree within tolerance — RESOLVED.`);
      }
    } else {
      messages.push(`No terrain-derived radial HAAT available for comparison. Filing under FCC-authorized HAAT: ${authHaat} m.`);
    }

  } else if (computedMean !== null) {
    // CP or proposed: terrain-derived §73.313 mean controls
    filingControllingHaatM  = computedMean;
    filingControllingBasis  = 'GENOA_COMPUTED_73_313';
    filingControllingSource = 'evidence.terrain_haat_per_radial.mean';

    // If rcamsl is missing but HAAT is terrain-derived, check consistency
    if (rcamslM == null && groundElevationM == null) {
      blockers.push({
        code:    'MISSING_RCAMSL_WITH_COMPUTED_BASIS',
        message: 'Terrain-derived HAAT requires RCAMSL (transmitter AMSL). Neither rcamslM nor groundElevationM is available — contour distances cannot be computed without a valid AMSL reference.'
      });
      haat_conflict_status = 'BLOCKER';
    }

    // If operator entered a value, check it against computed
    if (opHaat !== null) {
      const absDiff = Math.abs(computedMean - opHaat);
      const relDiff = opHaat > 0 ? absDiff / opHaat : Infinity;
      if (absDiff > TOLERANCE_M || relDiff > TOLERANCE_RELATIVE) {
        if (facilityStatus === 'proposed' || facilityStatus === 'cp_granted') {
          // Proposed/CP: large operator-vs-computed divergence is a BLOCKER
          // (there is no FCC-authorized value to fall back to)
          blockers.push({
            code:    'OPERATOR_VS_COMPUTED_HAAT_BLOCKER',
            message: `Operator-declared HAAT (${opHaat} m) differs from Genoa-computed §73.313 mean (${computedMean} m) by ${absDiff.toFixed(1)} m (${(relDiff * 100).toFixed(1)}%). For a proposed or CP facility with no FCC-authorized HAAT, this discrepancy must be resolved before filing.`
          });
          haat_conflict_status = 'BLOCKER';
        } else {
          haat_conflict_status = haat_conflict_status === 'BLOCKER' ? 'BLOCKER' : 'REVIEW_REQUIRED';
          warnings.push({
            code:    'OPERATOR_VS_COMPUTED_HAAT_DIVERGE',
            message: `Operator-declared HAAT (${opHaat} m) differs from computed §73.313 mean (${computedMean} m) by ${absDiff.toFixed(1)} m.`
          });
        }
      }
    }

  } else if (opHaat !== null) {
    // Last resort: no terrain, no FCC license — operator value only
    filingControllingHaatM  = opHaat;
    filingControllingBasis  = 'OPERATOR_DECLARED';
    filingControllingSource = 'inputs.haat_m';
    warnings.push({
      code:    'HAAT_OPERATOR_ONLY_NO_TERRAIN',
      message: 'No terrain evidence and no FCC-authorized HAAT available. Operator-declared HAAT is used. Obtain terrain analysis for a defensible filing.'
    });
    if (facilityStatus !== 'licensed') {
      // Proposed/CP with no terrain and no FCC HAAT is a BLOCKER
      blockers.push({
        code:    'PROPOSED_FACILITY_NO_HAAT_EVIDENCE',
        message: 'A proposed or CP-modification facility must have either terrain-derived §73.313 HAAT or FCC-authorized HAAT. Operator-declared value alone is insufficient.'
      });
      haat_conflict_status = 'BLOCKER';
    }

  } else {
    // No HAAT at all
    blockers.push({
      code:    'NO_HAAT_AVAILABLE',
      message: 'No HAAT value is available from any source (FCC license, terrain computation, or operator input). Cannot resolve filing-controlling HAAT.'
    });
    haat_conflict_status = 'BLOCKER';
  }

  // ------------------------------------------------------------------
  // 4.  Source attestation conflict detection
  //     If the contour engine used one HAAT basis but the attestation
  //     block claims another, flag it — but this does NOT downgrade
  //     engine math parity (math is separate from attestation labeling).
  // ------------------------------------------------------------------
  // (Callers can pass attestedBasis to trigger this check; not yet wired
  //  in engine/index.js — reserved for future attestation cross-check.)

  // ------------------------------------------------------------------
  // 5.  Assemble result
  // ------------------------------------------------------------------
  if (blockers.length > 0 && haat_conflict_status !== 'BLOCKER') {
    haat_conflict_status = 'BLOCKER';
  }

  return {
    // The three distinct HAAT concepts — always present when data exists
    authorized_haat_m:         authHaat,
    operator_declared_haat_m:  opHaat,
    computed_average_haat_m:   computedMean,
    computed_radial_haat_m:    validRadials.length > 0 ? validRadials : null,

    // The single value that controls the filing
    filing_controlling_haat_m:      filingControllingHaatM,
    filing_controlling_haat_basis:  filingControllingBasis,   // FCC_AUTHORIZED | GENOA_COMPUTED_73_313 | ENGINEER_OVERRIDE_LOCKED | OPERATOR_DECLARED
    filing_controlling_haat_source: filingControllingSource,

    // Conflict / review status
    haat_conflict_status,   // RESOLVED | REVIEW_REQUIRED | BLOCKER
    haat_review_messages:   messages,
    haat_blockers:          blockers,
    haat_warnings:          warnings,

    // Engineer override — captured for audit (PII stripped at API layer)
    engineer_override: overrideLocked ? {
      value_m:          _finite(engineerOverride.value_m),
      original_value_m: _finite(engineerOverride.original_value_m),
      evidence_ref:     engineerOverride.evidence_ref,
      timestamp:        engineerOverride.timestamp
      // engineer + reason are PII — stripped here; kept only in server-side log
    } : null,

    // Provenance
    provenance: {
      study_intent:      studyIntent,
      facility_status:   facilityStatus,
      radial_count_used: validRadials.length,
      tolerance_m:       TOLERANCE_M,
      tolerance_relative: TOLERANCE_RELATIVE
    }
  };
}

function _finite(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
