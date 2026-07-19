// Canonical operating-scenario / antenna-design labeling stage.
//
// A NAMING/labeling layer over facts buildCanonicalCandidateResult() has
// already selected (antenna mode, selected design height, NIF decision) —
// this module invents NO new engineering selection. It exists to give the
// UI and comparison table ONE field that names "which of the several
// mixed configurations this report is actually about" instead of forcing
// a reader to reconstruct that from four separate facts scattered across
// the result (canonical-consistency-audit-followup, Phase 2 item 2).
//
// Two axes:
//   OperatingScenario   — what regulatory/operational posture is this?
//                          (current baseline vs a relocation candidate,
//                          NDA-day-only vs NDA-with-night-authority vs
//                          DA-night vs DA-full-time, or a power-upgrade
//                          study)
//   AntennaDesignCategory — what kind of radiator/structure is this?
//                          (quarter-wave, compact 3/8-wave, 5/8-wave,
//                          existing-structure colocation, or a custom DA
//                          array)

'use strict';

import { ANTENNA_MODES, OPERATING_SCENARIOS, ANTENNA_DESIGN_CATEGORIES } from './types.js';
import { isDirectionalMode } from './rules/antennaMode.js';
import { HEIGHT_SELECTION_BASES } from './antennaDesign.js';

const SOURCE = 'canonical/scenario';

// Height-fraction-of-wavelength bands for AntennaDesignCategory, when the
// selection basis is not HOST_STRUCTURE (colocation) and the mode is not
// directional (array). These are physical-design bands, not regulatory
// rules — QUARTER_WAVE and FIVE_EIGHTHS_WAVE are the two industry-standard
// heights (also the canonical quarterWaveReferenceM / fiveEighthsReferenceM
// physics references); anything meaningfully between them (including the
// 3/8-wave Class-C/D class-typical default) is labeled COMPACT rather than
// forced into one of the two standard bands.
const QUARTER_WAVE_BAND_MAX = 0.30;   // h/lambda <= this -> QUARTER_WAVE
const FIVE_EIGHTHS_BAND_MIN = 0.55;   // h/lambda >= this -> FIVE_EIGHTHS_WAVE

/**
 * Classify the selected antenna design into one of the five formalized
 * categories. Never a new selection — purely a label over
 * antennaDesign.selectionBasis / selectedDesignHeightM / wavelengthM and
 * the resolved antenna mode.
 *
 * @param {Object} p
 * @param {Object} p.antennaDesign   the object returned by deriveAntennaDesign()
 * @param {?string} p.modeledMode    canonical.antenna.patternModeModeled.value
 * @returns {{ category: string, basis: string }}
 */
export function classifyAntennaDesign({ antennaDesign, modeledMode = null }) {
  if (isDirectionalMode(modeledMode)) {
    return {
      category: ANTENNA_DESIGN_CATEGORIES.CUSTOM_DA_ARRAY,
      basis: `modeled antenna mode is directional (${modeledMode}) — a multi-tower array design, ` +
        'not a single standard-height radiator.',
    };
  }
  if (antennaDesign.selectionBasis === HEIGHT_SELECTION_BASES.HOST_STRUCTURE) {
    return {
      category: ANTENNA_DESIGN_CATEGORIES.EXISTING_STRUCTURE_COLOCATION,
      basis: 'selectedDesignHeightM.selectionBasis is HOST_STRUCTURE — the design height is an ' +
        'existing structure being reused (colocation), not a purpose-built radiator height.',
    };
  }
  const h = antennaDesign.selectedDesignHeightM?.value;
  const lambda = antennaDesign.wavelengthM?.value;
  if (h == null || lambda == null || !Number.isFinite(lambda) || lambda <= 0) {
    return {
      category: ANTENNA_DESIGN_CATEGORIES.COMPACT,
      basis: 'height or wavelength unavailable — defaulting to COMPACT rather than guessing a ' +
        'standard-height match (screening-grade fallback, not a confirmed classification).',
    };
  }
  const ratio = h / lambda;
  if (ratio <= QUARTER_WAVE_BAND_MAX) {
    return {
      category: ANTENNA_DESIGN_CATEGORIES.QUARTER_WAVE,
      basis: `selected height ${h} m is ${(ratio).toFixed(3)}lambda (<= ${QUARTER_WAVE_BAND_MAX}lambda band) — ` +
        'classic quarter-wave-class radiator.',
    };
  }
  if (ratio >= FIVE_EIGHTHS_BAND_MIN) {
    return {
      category: ANTENNA_DESIGN_CATEGORIES.FIVE_EIGHTHS_WAVE,
      basis: `selected height ${h} m is ${(ratio).toFixed(3)}lambda (>= ${FIVE_EIGHTHS_BAND_MIN}lambda band) — ` +
        '5/8-wave-class antifade radiator (or taller).',
    };
  }
  return {
    category: ANTENNA_DESIGN_CATEGORIES.COMPACT,
    basis: `selected height ${h} m is ${(ratio).toFixed(3)}lambda — between the quarter-wave and ` +
      '5/8-wave bands (this is where the Class-C/D 3/8-wave class-typical default falls); labeled ' +
      'COMPACT rather than forced into one of the two standard-height categories.',
  };
}

/**
 * Classify the operating scenario. Reads only facts
 * buildCanonicalCandidateResult() has already assembled — never a new
 * regulatory determination.
 *
 * KNOWN GAP (documented, not fabricated): POWER_UPGRADE_STUDY cannot be
 * derived from the current inputs. The engine passes exactly one tpo_kw
 * per run, used identically for the baseline site AND every relocation
 * candidate — there is no distinct "currently authorized power" input
 * separate from the candidate/target TPO to compare against. Until the
 * engine threads a separate current-authorized-power input through to
 * this stage, this function can never return POWER_UPGRADE_STUDY; callers
 * must not fabricate that comparison from tpo_kw alone.
 *
 * @param {Object}  p
 * @param {boolean} p.isBaselineCandidate  true only for the current-site
 *   row itself (e.g. distance_from_current_km ~ 0) — the ONE case this
 *   function labels CURRENT_AUTHORIZED_BASELINE.
 * @param {?string} p.modeledMode          canonical.antenna.patternModeModeled.value
 * @param {Object}  p.nif                  canonical.regulatory.nif (RegulatoryDecision)
 * @returns {{ scenario: string, basis: string }}
 */
export function classifyOperatingScenario({ isBaselineCandidate = false, modeledMode = null, nif = null }) {
  if (isBaselineCandidate) {
    return {
      scenario: OPERATING_SCENARIOS.CURRENT_AUTHORIZED_BASELINE,
      basis: 'this row is the current/authorized site itself, not a relocation candidate.',
    };
  }

  if (modeledMode === ANTENNA_MODES.DA_NIGHT) {
    return {
      scenario: OPERATING_SCENARIOS.RELOCATION_DA_NIGHT,
      basis: 'modeled antenna mode is DA_NIGHT — directional pattern used for nighttime protection only.',
    };
  }
  if (modeledMode === ANTENNA_MODES.DA_DAY_AND_NIGHT) {
    return {
      scenario: OPERATING_SCENARIOS.RELOCATION_DA_FULL_TIME,
      basis: 'modeled antenna mode is DA_DAY_AND_NIGHT — directional pattern used around the clock.',
    };
  }
  if (modeledMode === ANTENNA_MODES.DA_DAY) {
    // KNOWN GAP: the given OperatingScenario enum has no
    // "day-only directional" member. A DA_DAY-only station operates
    // directionally in the daytime and (typically) does not have
    // nighttime authority at all -- RELOCATION_DA_FULL_TIME would
    // overstate nighttime operation, and RELOCATION_DA_NIGHT would
    // misstate the pattern as night-only. Falling back to
    // RELOCATION_DA_FULL_TIME is the closer of the two (both are
    // "directional array" scenarios, and it does not fabricate a
    // day-only-specific label that does not exist in the enum) -- flagged
    // here explicitly rather than silently picked.
    return {
      scenario: OPERATING_SCENARIOS.RELOCATION_DA_FULL_TIME,
      basis: 'modeled antenna mode is DA_DAY (daytime-only directional) — the given OperatingScenario ' +
        'enum has no day-only-directional member; classified as RELOCATION_DA_FULL_TIME as the ' +
        'closer of the two DA scenarios (documented gap, not a confirmed full-time authority claim).',
    };
  }

  // NDA (or unresolved -- resolveAntennaModes() defaults modeled to NDA
  // when no assumption is supplied, so this is also the honest default).
  const nightAuthorityConfirmed = nif != null
    && nif.completion === 'RUN'
    && nif.result === 'PASS';
  if (nightAuthorityConfirmed) {
    return {
      scenario: OPERATING_SCENARIOS.RELOCATION_NDA_WITH_NIGHT_AUTHORITY,
      basis: 'modeled mode is NDA and canonical.regulatory.nif shows a completed study with a PASS ' +
        'result -- nighttime authority is confirmed, not merely assumed.',
    };
  }
  return {
    scenario: OPERATING_SCENARIOS.RELOCATION_NDA_DAY_ONLY,
    basis: nif != null && nif.completion === 'RUN'
      ? `modeled mode is NDA; a night study ran but did not confirm nighttime authority (result: ${nif.result}) -- day-only until resolved.`
      : 'modeled mode is NDA and no night study has been run (screening never runs the §73.182 solver) -- day-only is the honest default, never inferred as authorized.',
  };
}

/**
 * Build the top-level canonical.scenario block and its display label.
 *
 * @param {Object}  p
 * @param {Object}  p.antennaDesign
 * @param {?string} p.modeledMode
 * @param {Object}  p.nif
 * @param {boolean} [p.isBaselineCandidate=false]
 * @param {number}  p.tpo_kw
 * @returns {{
 *   operatingScenario: string,
 *   operatingScenarioBasis: string,
 *   antennaDesignCategory: string,
 *   antennaDesignCategoryBasis: string,
 *   primaryScenarioLabel: string,
 *   source: string,
 * }}
 */
export function buildScenario({ antennaDesign, modeledMode = null, nif = null, isBaselineCandidate = false, tpo_kw = null }) {
  const { category, basis: designBasis } = classifyAntennaDesign({ antennaDesign, modeledMode });
  const { scenario, basis: scenarioBasis } = classifyOperatingScenario({ isBaselineCandidate, modeledMode, nif });

  const heightM = antennaDesign.selectedDesignHeightM?.value;
  const designWord = {
    [ANTENNA_DESIGN_CATEGORIES.QUARTER_WAVE]: 'quarter-wave',
    [ANTENNA_DESIGN_CATEGORIES.COMPACT]: 'compact',
    [ANTENNA_DESIGN_CATEGORIES.FIVE_EIGHTHS_WAVE]: '5/8-wave',
    [ANTENNA_DESIGN_CATEGORIES.EXISTING_STRUCTURE_COLOCATION]: 'existing-structure colocation',
    [ANTENNA_DESIGN_CATEGORIES.CUSTOM_DA_ARRAY]: 'directional array',
  }[category] ?? category.toLowerCase();

  const scenarioWord = {
    [OPERATING_SCENARIOS.CURRENT_AUTHORIZED_BASELINE]: 'current authorized baseline',
    [OPERATING_SCENARIOS.RELOCATION_NDA_DAY_ONLY]: 'daytime NDA relocation',
    [OPERATING_SCENARIOS.RELOCATION_NDA_WITH_NIGHT_AUTHORITY]: 'NDA relocation with confirmed nighttime authority',
    [OPERATING_SCENARIOS.RELOCATION_DA_NIGHT]: 'DA-N nighttime-directional relocation',
    [OPERATING_SCENARIOS.RELOCATION_DA_FULL_TIME]: 'full-time directional relocation',
    [OPERATING_SCENARIOS.POWER_UPGRADE_STUDY]: 'power-upgrade study',
  }[scenario] ?? scenario.toLowerCase();

  const power = Number.isFinite(Number(tpo_kw)) ? `${tpo_kw} kW ` : '';
  const heightPart = heightM != null && category !== ANTENNA_DESIGN_CATEGORIES.EXISTING_STRUCTURE_COLOCATION
    && category !== ANTENNA_DESIGN_CATEGORIES.CUSTOM_DA_ARRAY
    ? ` using a ${heightM} m ${designWord} radiator`
    : ` using ${designWord === 'directional array' ? 'a' : 'an'} ${designWord}${category === ANTENNA_DESIGN_CATEGORIES.EXISTING_STRUCTURE_COLOCATION && heightM != null ? ` (${heightM} m)` : ''}`;

  const primaryScenarioLabel = `${power}${scenarioWord}${heightPart}`.trim();

  return Object.freeze({
    operatingScenario: scenario,
    operatingScenarioBasis: scenarioBasis,
    antennaDesignCategory: category,
    antennaDesignCategoryBasis: designBasis,
    primaryScenarioLabel,
    source: SOURCE,
  });
}
