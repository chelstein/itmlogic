// Source Attestation Framework v2 — source authority model.
//
// Canonical registry mapping every recognized source type to its
// authority level, default confidence, filing weight, and replay
// requirement.  This is the deterministic decision-tree input for
// resolveOperativeValue(): when two sources disagree, the AUTHORITY
// ORDER below decides which value controls filing calculations.
//
// Relationship to v1 (src/engine/provenance/sourceAuthority.js):
//   v1 scores trust 0..1 for confidence roll-ups and is unchanged.
//   v2 (this module) adds the ordered authority hierarchy and the
//   per-source governance metadata needed for operative-value
//   selection.  v2 feeds v1; it does not replace it.

// ---- Authority levels (ordered, strongest first) ----
export const AUTHORITY_LEVEL = Object.freeze({
  PRIMARY:           'PRIMARY',            // authoritative regulatory record
  SECONDARY:         'SECONDARY',          // authoritative measurement (DEM)
  TERTIARY:          'TERTIARY',           // derived / computed from trusted inputs
  ADVISORY:          'ADVISORY',           // informative only, never operative
  OPERATOR_SUPPLIED: 'OPERATOR_SUPPLIED',  // operator-entered, unverified
  UNKNOWN:           'UNKNOWN'             // unresolved origin
});

// Numeric rank for deterministic comparison — lower = more authoritative.
export const AUTHORITY_RANK = Object.freeze({
  [AUTHORITY_LEVEL.PRIMARY]:           0,
  [AUTHORITY_LEVEL.SECONDARY]:         1,
  [AUTHORITY_LEVEL.TERTIARY]:          2,
  [AUTHORITY_LEVEL.OPERATOR_SUPPLIED]: 3,
  [AUTHORITY_LEVEL.ADVISORY]:          4,
  [AUTHORITY_LEVEL.UNKNOWN]:           5
});

// ---- Source types ----
export const SOURCE_TYPE = Object.freeze({
  FCC_LMS:                  'FCC_LMS',
  FCC_CDBS:                 'FCC_CDBS',
  FCC_ASR:                  'FCC_ASR',
  FAA_OEAAA:                'FAA_OEAAA',
  USGS_DEM:                 'USGS_DEM',
  SRTM_DEM:                 'SRTM_DEM',
  OPEN_METEO:               'OPEN_METEO',
  OPERATOR_INPUT:           'OPERATOR_INPUT',
  ENGINE_DERIVED:           'ENGINE_DERIVED',
  SDR_MEASUREMENT:          'SDR_MEASUREMENT',
  MANUAL_ENGINEER_OVERRIDE: 'MANUAL_ENGINEER_OVERRIDE'
});

// ---- Registry ----
// filing_weight: relative weight (0..1) this source carries toward
//   filing-grade confidence roll-ups.
// replay_required: whether the raw evidence payload from this source
//   must be hashed into the replay/provenance chain for the exhibit
//   to be reproducible.
export const SOURCE_REGISTRY = Object.freeze({
  [SOURCE_TYPE.FCC_LMS]: Object.freeze({
    source_type:        SOURCE_TYPE.FCC_LMS,
    authority_level:    AUTHORITY_LEVEL.PRIMARY,
    confidence_default: 'HIGH',
    filing_weight:      1.00,
    replay_required:    true,
    description:        'FCC Licensing and Management System facility record (current authoritative licensing database)'
  }),
  [SOURCE_TYPE.FCC_CDBS]: Object.freeze({
    source_type:        SOURCE_TYPE.FCC_CDBS,
    authority_level:    AUTHORITY_LEVEL.PRIMARY,
    confidence_default: 'MEDIUM',
    filing_weight:      0.90,
    replay_required:    true,
    description:        'FCC CDBS legacy record (authoritative but frozen; superseded by LMS where both exist)'
  }),
  [SOURCE_TYPE.FCC_ASR]: Object.freeze({
    source_type:        SOURCE_TYPE.FCC_ASR,
    authority_level:    AUTHORITY_LEVEL.PRIMARY,
    confidence_default: 'HIGH',
    filing_weight:      1.00,
    replay_required:    true,
    description:        'FCC Antenna Structure Registration record (authoritative structure height / coordinates)'
  }),
  [SOURCE_TYPE.FAA_OEAAA]: Object.freeze({
    source_type:        SOURCE_TYPE.FAA_OEAAA,
    authority_level:    AUTHORITY_LEVEL.PRIMARY,
    confidence_default: 'HIGH',
    filing_weight:      1.00,
    replay_required:    true,
    description:        'FAA Obstruction Evaluation / Airport Airspace Analysis determination'
  }),
  [SOURCE_TYPE.USGS_DEM]: Object.freeze({
    source_type:        SOURCE_TYPE.USGS_DEM,
    authority_level:    AUTHORITY_LEVEL.SECONDARY,
    confidence_default: 'MEDIUM',
    filing_weight:      0.80,
    replay_required:    true,
    description:        'USGS 3DEP digital elevation model (terrain measurement; authoritative for terrain, secondary to licensed values for filing)'
  }),
  [SOURCE_TYPE.SRTM_DEM]: Object.freeze({
    source_type:        SOURCE_TYPE.SRTM_DEM,
    authority_level:    AUTHORITY_LEVEL.SECONDARY,
    confidence_default: 'MEDIUM',
    filing_weight:      0.70,
    replay_required:    true,
    description:        'SRTM digital elevation model (terrain measurement; lower vertical accuracy than 3DEP)'
  }),
  [SOURCE_TYPE.OPEN_METEO]: Object.freeze({
    source_type:        SOURCE_TYPE.OPEN_METEO,
    authority_level:    AUTHORITY_LEVEL.ADVISORY,
    confidence_default: 'LOW',
    filing_weight:      0.10,
    replay_required:    false,
    description:        'Open-Meteo environmental/elevation API (advisory only; never filing-controlling)'
  }),
  [SOURCE_TYPE.OPERATOR_INPUT]: Object.freeze({
    source_type:        SOURCE_TYPE.OPERATOR_INPUT,
    authority_level:    AUTHORITY_LEVEL.OPERATOR_SUPPLIED,
    confidence_default: 'LOW',
    filing_weight:      0.50,
    replay_required:    true,
    description:        'Operator-entered value, not yet cross-checked against an authoritative record'
  }),
  [SOURCE_TYPE.ENGINE_DERIVED]: Object.freeze({
    source_type:        SOURCE_TYPE.ENGINE_DERIVED,
    authority_level:    AUTHORITY_LEVEL.TERTIARY,
    confidence_default: 'MEDIUM',
    filing_weight:      0.85,
    replay_required:    true,
    description:        'Deterministic Genoa engine computation from trusted inputs (reproducible via replay token)'
  }),
  [SOURCE_TYPE.SDR_MEASUREMENT]: Object.freeze({
    source_type:        SOURCE_TYPE.SDR_MEASUREMENT,
    authority_level:    AUTHORITY_LEVEL.ADVISORY,
    confidence_default: 'MEDIUM',
    filing_weight:      0.30,
    replay_required:    true,
    description:        'Field SDR measurement (observational evidence; advisory to filing values, evidentiary for verification)'
  }),
  [SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE]: Object.freeze({
    source_type:        SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE,
    authority_level:    AUTHORITY_LEVEL.PRIMARY,
    confidence_default: 'HIGH',
    filing_weight:      1.00,
    replay_required:    true,
    description:        'Manual override by the engineer of record (requires reason + reviewer identity; supersedes all automated sources)'
  })
});

/**
 * Resolve a source type string to its registry entry.
 * Unknown types resolve to a frozen UNKNOWN descriptor instead of throwing
 * so legacy pipelines feeding unrecognized labels degrade visibly, not fatally.
 */
export function resolveSourceType(sourceType){
  const entry = SOURCE_REGISTRY[sourceType];
  if (entry) return entry;
  return Object.freeze({
    source_type:        sourceType || 'UNKNOWN',
    authority_level:    AUTHORITY_LEVEL.UNKNOWN,
    confidence_default: 'LOW',
    filing_weight:      0.0,
    replay_required:    false,
    description:        `Unrecognized source type "${sourceType}" — treated as UNKNOWN authority`
  });
}

/**
 * Compare two authority levels. Negative → a more authoritative than b.
 */
export function compareAuthority(a, b){
  const ra = AUTHORITY_RANK[a] ?? AUTHORITY_RANK[AUTHORITY_LEVEL.UNKNOWN];
  const rb = AUTHORITY_RANK[b] ?? AUTHORITY_RANK[AUTHORITY_LEVEL.UNKNOWN];
  return ra - rb;
}

/**
 * Validate a manual engineer override carries the governance fields it
 * needs to become operative: a non-empty reason and a reviewer identity.
 */
export function validateManualOverride(candidate){
  const errors = [];
  const o = candidate?.override || {};
  if (!o.reason || String(o.reason).trim().length === 0){
    errors.push('manual override requires a non-empty reason');
  }
  if (!o.reviewer || String(o.reviewer).trim().length === 0){
    errors.push('manual override requires a reviewer identity');
  }
  return { valid: errors.length === 0, errors };
}
