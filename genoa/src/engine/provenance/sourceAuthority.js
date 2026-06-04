// Source authority registry.
//
// Maps named authority identifiers to their canonical trust scores.
// Trust scores are used by the source confidence engine to compute
// per-field and overall exhibit confidence.  An exhibit built entirely
// from operator input has an overall confidence near 0.50; one fully
// cross-checked against FCC LMS, ASR, and terrain DEM approaches 1.00.
//
// Trust score semantics:
//   1.00 — authoritative regulatory record (FCC LMS, ASR, FAA OE/AAA)
//   0.95 — authoritative terrain measurement (USGS / SRTM DEM)
//   0.90 — deterministic engine computation from trusted inputs
//   0.50 — operator-entered value, not yet cross-checked
//   0.10 — AI inference or model estimate (advisory only)
//   0.00 — unknown or unresolved origin

export const SOURCE_AUTHORITY = Object.freeze({
  FCC_LMS:        'fcc_lms',
  FCC_FMQ:        'fcc_fmq',
  FCC_ASR:        'fcc_asr',
  FAA_OEAAA:      'faa_oeaaa',
  USGS_DEM:       'usgs_dem',
  OPERATOR_INPUT: 'operator_input',
  ENGINE_DERIVED: 'engine_derived',
  AI_INFERENCE:   'ai_inference',
  UNKNOWN:        'unknown'
});

export const AUTHORITY_TRUST = Object.freeze({
  [SOURCE_AUTHORITY.FCC_LMS]:        1.00,
  [SOURCE_AUTHORITY.FCC_FMQ]:        1.00,
  [SOURCE_AUTHORITY.FCC_ASR]:        1.00,
  [SOURCE_AUTHORITY.FAA_OEAAA]:      1.00,
  [SOURCE_AUTHORITY.USGS_DEM]:       0.95,
  [SOURCE_AUTHORITY.ENGINE_DERIVED]: 0.90,
  [SOURCE_AUTHORITY.OPERATOR_INPUT]: 0.50,
  [SOURCE_AUTHORITY.AI_INFERENCE]:   0.10,
  [SOURCE_AUTHORITY.UNKNOWN]:        0.00
});

// Human-readable labels for the UI / narrative.
export const AUTHORITY_LABEL = Object.freeze({
  [SOURCE_AUTHORITY.FCC_LMS]:        'FCC LMS (authoritative)',
  [SOURCE_AUTHORITY.FCC_FMQ]:        'FCC FMQ/AMQ database',
  [SOURCE_AUTHORITY.FCC_ASR]:        'FCC ASR (registered structure)',
  [SOURCE_AUTHORITY.FAA_OEAAA]:      'FAA OE/AAA determination',
  [SOURCE_AUTHORITY.USGS_DEM]:       'USGS / terrain DEM',
  [SOURCE_AUTHORITY.ENGINE_DERIVED]: 'Genoa engine (derived)',
  [SOURCE_AUTHORITY.OPERATOR_INPUT]: 'Operator-entered (unverified)',
  [SOURCE_AUTHORITY.AI_INFERENCE]:   'AI inference (advisory only)',
  [SOURCE_AUTHORITY.UNKNOWN]:        'Unknown / unresolved'
});
