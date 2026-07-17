// Canonical antenna-mode normalization and resolution.
//
// Replaces the four divergent antenna-mode vocabularies catalogued in
// docs/architecture-contradiction-origins.md §8 ('NDA|DA-D|DA-N|DA-2'
// input; 'ND/DA-3'; 'omni|DA'; pattern-table presence) and the four
// competing "DA recommended" heuristics with ONE normalizer and ONE
// resolution rule.
//
// Four distinct facts are kept separate — conflating them is the origin
// of the licensed-vs-modeled contradictions:
//   patternModeLicensed  what the license says today
//   patternModeAssumed   what the operator asked screening to assume
//   patternModeRequired  what the rules likely require at the new site
//   patternModeModeled   what the screening run ACTUALLY modeled

'use strict';

import { decision, ev, ANTENNA_MODES, EVALUATION_STATES, COMPLETION_STATES, CONFIDENCE_TIERS } from '../types.js';
import { isClearChannel } from './channelSets.js';

const SOURCE = 'canonical/rules/antennaMode';

/** Raw-token → canonical AntennaMode map (case-insensitive). */
const RAW_MODE_MAP = Object.freeze({
  'NDA': ANTENNA_MODES.NDA,
  'ND': ANTENNA_MODES.NDA,
  'OMNI': ANTENNA_MODES.NDA,
  'DA-D': ANTENNA_MODES.DA_DAY,
  'DA-N': ANTENNA_MODES.DA_NIGHT,
  'DA-2': ANTENNA_MODES.DA_DAY_AND_NIGHT,
  'DA': ANTENNA_MODES.DA_DAY_AND_NIGHT,
  // Canonical values are accepted verbatim (idempotent normalization).
  'DA_DAY': ANTENNA_MODES.DA_DAY,
  'DA_NIGHT': ANTENNA_MODES.DA_NIGHT,
  'DA_DAY_AND_NIGHT': ANTENNA_MODES.DA_DAY_AND_NIGHT,
});

/**
 * Normalize a raw pattern-mode token to the canonical AntennaMode enum.
 *
 * @param {*} rawPatternMode
 * @returns {{ mode: ?string, warning: ?string }}
 *   mode is one of ANTENNA_MODES or null; warning is set when the token
 *   was not recognized (mode null) — the caller must not guess.
 */
export function normalizeAntennaMode(rawPatternMode) {
  if (rawPatternMode == null || String(rawPatternMode).trim() === '') {
    return { mode: null, warning: 'antenna mode missing — cannot normalize' };
  }
  const token = String(rawPatternMode).trim().toUpperCase();
  const mode = RAW_MODE_MAP[token] ?? null;
  if (mode === null) {
    return {
      mode: null,
      warning: `unrecognized antenna mode token "${rawPatternMode}" — not mapped (refusing to guess)`,
    };
  }
  return { mode, warning: null };
}

/** true when the canonical mode involves a directional pattern. */
export function isDirectionalMode(mode) {
  return mode === ANTENNA_MODES.DA_DAY
    || mode === ANTENNA_MODES.DA_NIGHT
    || mode === ANTENNA_MODES.DA_DAY_AND_NIGHT;
}

/**
 * Resolve the four antenna-mode facts for a candidate.
 *
 * The SINGLE "DA required" rule: a clear-channel secondary station
 * (non-Class-A on a §73.25 clear channel) will likely require a DA-N
 * (directional night) pattern to protect the dominant station's skywave
 * service.  This is stated as a WARN-grade likelihood, NOT a hard fact —
 * only the actual nighttime RSS/NIF study (nifContour.js) can confirm it.
 *
 * @param {Object}  p
 * @param {?string} p.licensedMode             raw licensed pattern mode
 * @param {?string} p.screeningAssumptionMode  raw mode screening assumed
 * @param {number}  p.frequency_khz
 * @param {string}  p.fcc_class
 * @param {?number} [p.coverage_fraction]      informational only
 * @returns {{
 *   patternModeLicensed: Object,   // EngineeringValue (value: mode|null)
 *   patternModeAssumed:  Object,   // EngineeringValue
 *   patternModeRequired: { mode: ?string, decision: Object },
 *   patternModeModeled:  Object,   // EngineeringValue — what screening ran
 *   filingImpact: { filingReady: boolean, blockers: string[], decision: Object },
 *   warnings: string[],
 * }}
 */
export function resolveAntennaModes({
  licensedMode = null,
  screeningAssumptionMode = null,
  frequency_khz,
  fcc_class,
  coverage_fraction = null,
} = {}) {
  const warnings = [];
  const cls = String(fcc_class ?? '').trim().toUpperCase();

  const lic = normalizeAntennaMode(licensedMode);
  if (lic.warning && licensedMode != null) warnings.push(`licensedMode: ${lic.warning}`);

  const asm = normalizeAntennaMode(screeningAssumptionMode);
  if (asm.warning && screeningAssumptionMode != null) warnings.push(`screeningAssumptionMode: ${asm.warning}`);

  const patternModeLicensed = ev(lic.mode, {
    unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.FILING_GRADE,
    assumptions: ['normalized from licensed record pattern-mode token'],
  });

  const patternModeAssumed = ev(asm.mode, {
    unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
    assumptions: ['normalized from operator screening assumption'],
  });

  // Modeled = the assumption the screening run ACTUALLY used.  When the
  // assumption is NDA (or missing), screening models the NDA proxy.
  const modeledMode = asm.mode ?? ANTENNA_MODES.NDA;
  const patternModeModeled = ev(modeledMode, {
    unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
    assumptions: asm.mode === null
      ? ['no screening assumption supplied — NDA proxy modeled by default']
      : (modeledMode === ANTENNA_MODES.NDA
        ? ['NDA proxy modeled (screening does not synthesize directional patterns)']
        : ['directional assumption carried through screening']),
  });

  // ── The single "required mode" rule ─────────────────────────────────
  const clearSecondary = isClearChannel(frequency_khz) && cls !== 'A';
  let requiredMode = null;
  let requiredDecision;
  if (clearSecondary) {
    requiredMode = ANTENNA_MODES.DA_NIGHT;
    requiredDecision = decision({
      state: EVALUATION_STATES.WARN,
      required: null, // likelihood, not a confirmed requirement
      completion: COMPLETION_STATES.RUN,
      result: EVALUATION_STATES.WARN,
      ruleReferences: ['47 CFR §73.25', '47 CFR §73.182', '47 CFR §73.37'],
      rationale:
        `Class ${cls || '?'} on ${frequency_khz} kHz is a clear-channel secondary ` +
        '(non-Class-A on a §73.25 clear channel): a DA-N (directional night) ' +
        'pattern is LIKELY required to protect the dominant station. This is a ' +
        'screening-grade likelihood, not a confirmed requirement — only the ' +
        'nighttime RSS/NIF study can confirm the pattern requirement. ' +
        'Inputs: frequency_khz (clear-channel membership), fcc_class.',
      blockers: [],
      inputsUsed: [patternModeLicensed, patternModeAssumed],
    });
  } else {
    requiredMode = lic.mode; // no rule forces a change; licensed mode stands
    requiredDecision = decision({
      state: EVALUATION_STATES.UNKNOWN,
      required: null,
      completion: COMPLETION_STATES.NOT_RUN,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences: ['47 CFR §73.182', '47 CFR §73.37'],
      rationale:
        'No screening-level rule forces a directional pattern for this ' +
        `class/channel combination (Class ${cls || '?'}, ${frequency_khz} kHz); ` +
        'the required mode defaults to the licensed mode and can only be ' +
        'confirmed by a full interference study. ' +
        'Inputs: frequency_khz, fcc_class, licensedMode.',
      blockers: [],
      inputsUsed: [patternModeLicensed, patternModeAssumed],
    });
  }

  // ── Filing impact: required vs modeled mismatch ─────────────────────
  const mismatch = requiredMode !== null && requiredMode !== modeledMode;
  const filingBlockers = mismatch
    ? ['Directional pattern required but not synthesized (NDA proxy modeled)']
    : [];
  const filingImpact = {
    filingReady: !mismatch,
    blockers: filingBlockers,
    decision: decision({
      state: mismatch ? EVALUATION_STATES.WARN : EVALUATION_STATES.PASS,
      required: null,
      completion: COMPLETION_STATES.RUN,
      result: mismatch ? EVALUATION_STATES.WARN : EVALUATION_STATES.PASS,
      ruleReferences: ['47 CFR §73.150', '47 CFR §73.182'],
      rationale: mismatch
        ? `Likely-required mode ${requiredMode} differs from modeled mode ` +
          `${modeledMode}: screening coverage/interference facts are based on ` +
          'a pattern the filing design will not use. Not filing-ready. ' +
          'Inputs: patternModeRequired, patternModeModeled.'
        : `Modeled mode ${modeledMode} matches the likely-required mode ` +
          `${requiredMode ?? '(none identified)'}; no antenna-mode filing gap. ` +
          'Inputs: patternModeRequired, patternModeModeled.',
      blockers: filingBlockers,
      inputsUsed: [patternModeModeled],
    }),
  };

  return {
    patternModeLicensed,
    patternModeAssumed,
    patternModeRequired: { mode: requiredMode, decision: requiredDecision },
    patternModeModeled,
    filingImpact,
    warnings,
    coverage_fraction: coverage_fraction ?? null,
  };
}
