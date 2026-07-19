// Canonical candidate-result assembler — the staged pipeline in one call.
//
//   normalized facts → geometry → propagation (PASSED IN) → antenna
//   design → regulatory rules (ALL of rules/*) → ground system → costs
//   → confidence → scoring → recommendation → validation
//
// (Antenna design runs immediately before the regulatory rules because
// the ASR/FAA and RF-exposure rules take the selected design height as
// their single height input — the design derivation itself is pure
// wavelength/class geometry with no regulatory dependency.)
//
// This stage does NOT recompute physics.  Coverage fraction, blanketing
// fraction, and contour distances arrive as INPUTS with provenance from
// the propagation engine; they are wrapped in EngineeringValues and
// carried through untouched.
//
// The assembled result is validated by validateCandidateResult() and the
// report is attached at result.validation.  The recommendation stage
// consumes the validation report, so validation runs twice: once on the
// recommendation-free core (the report the recommendation gates read),
// and once on the final result (the report that is attached).

'use strict';

import { ev, CONFIDENCE_TIERS } from './types.js';
import { formatLatitude, formatLongitude, formatCoordinatePair } from './formatters.js';
import { validateCandidateResult } from './validation.js';
import { deriveAntennaDesign } from './antennaDesign.js';
import { deriveGroundSystem } from './groundSystem.js';
import { buildCostModel } from './costModel.js';
import { deriveConfidence } from './confidence.js';
import { deriveScoringContext } from './scoring.js';
import { deriveRecommendation } from './recommendation.js';
import { resolveAntennaModes, isDirectionalMode } from './rules/antennaMode.js';
import { evaluateNighttimeInterferenceRequirement } from './rules/nighttimeInterference.js';
import { evaluateProofRequirement } from './rules/proofOfPerformance.js';
import { evaluateAsrFaa } from './rules/asrFaa.js';
import { evaluateRfExposure } from './rules/rfExposure.js';
import { evaluateBlanket } from './rules/blanket.js';
import { evaluateCurrentSiteRelationship } from './rules/currentSiteOverlap.js';
import { buildScenario } from './scenario.js';
import { greatCircleKm } from '../skywave.js';

const SOURCE = 'canonical/buildCanonicalCandidateResult';

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/** Wrap a caller-supplied propagation figure, preserving its provenance. */
function propEv(field, { unit, defaultSource, defaultAssumptions = [] }) {
  if (field == null) {
    return ev(null, {
      unit, source: defaultSource, confidence: CONFIDENCE_TIERS.LOW,
      assumptions: ['not supplied by the propagation stage', ...defaultAssumptions],
    });
  }
  if (typeof field === 'object' && 'value' in field) {
    // Already provenance-carrying (ev-shaped): re-wrap to guarantee shape.
    return ev(num(field.value), {
      unit: field.unit ?? unit,
      source: field.source ?? defaultSource,
      confidence: field.confidence ?? CONFIDENCE_TIERS.SCREENING,
      assumptions: Array.isArray(field.assumptions)
        ? [...field.assumptions, ...defaultAssumptions]
        : defaultAssumptions,
    });
  }
  return ev(num(field), {
    unit, source: defaultSource, confidence: CONFIDENCE_TIERS.SCREENING,
    assumptions: ['bare figure supplied without provenance — screening grade assumed', ...defaultAssumptions],
  });
}

/**
 * Assemble the canonical candidate result.
 *
 * @param {Object}  p
 * @param {Object}  p.station    { callsign, frequency_khz, fcc_class, tpo_kw,
 *   licensed_pattern_mode, latitude, longitude }
 * @param {Object}  p.candidate  { latitude, longitude,
 *   requested_height_m?, host_structure_height_m?, distance_from_current_km?,
 *   land_use_class?, col_polygon_present?, parcel_data_present?,
 *   near_airport_trigger? }
 * @param {Object}  p.propagation  INPUTS with provenance — never recomputed:
 *   { coverage_fraction?, blanket_population_fraction?,
 *     blanket_population_basis?, contour_distances_km?, sigma_msm,
 *     sigma_source_tier?, population_basis_tier?,
 *     night_study_present?, night_study_result?, ranking_layers? }
 * @param {Object}  [p.scoringInputs]  { candidateScore, baselineScore,
 *   allScores, minimumMeaningfulDelta }
 * @param {Object}  [p.options]  { groundScenarioKey, screeningAssumptionMode,
 *   towersCount, validationMode }
 * @returns {Object} canonical candidate result with attached .validation
 */
export function buildCanonicalCandidateResult({
  station,
  candidate,
  propagation,
  scoringInputs = null,
  options = {},
} = {}) {
  if (!station || typeof station !== 'object') throw new TypeError('buildCanonicalCandidateResult(): station is required');
  if (!candidate || typeof candidate !== 'object') throw new TypeError('buildCanonicalCandidateResult(): candidate is required');
  if (!propagation || typeof propagation !== 'object') throw new TypeError('buildCanonicalCandidateResult(): propagation inputs are required');

  const {
    groundScenarioKey = 'STANDARD_120',
    screeningAssumptionMode = null,
    towersCount = 1,
    validationMode = 'production',
  } = options;

  // ── Stage 1: normalized facts ────────────────────────────────────────
  const frequency_khz = num(station.frequency_khz);
  const fcc_class = String(station.fcc_class ?? '').trim().toUpperCase();
  const tpo_kw = num(station.tpo_kw);
  if (frequency_khz == null) throw new TypeError('buildCanonicalCandidateResult(): station.frequency_khz is required');
  if (tpo_kw == null) throw new TypeError('buildCanonicalCandidateResult(): station.tpo_kw is required (no silent default — see contradiction audit §12)');

  // ── Stage 2: geometry ────────────────────────────────────────────────
  const lat = num(candidate.latitude);
  const lon = num(candidate.longitude);
  let distanceKm = num(candidate.distance_from_current_km);
  if (distanceKm == null && lat != null && lon != null &&
      num(station.latitude) != null && num(station.longitude) != null) {
    const d = greatCircleKm(station.latitude, station.longitude, lat, lon);
    distanceKm = Number.isFinite(d) ? Math.round(d * 1000) / 1000 : null;
  }

  const geometry = {
    latitude: lat,
    longitude: lon,
    latitudeFormatted: formatLatitude(lat),
    longitudeFormatted: formatLongitude(lon),
    coordinatePair: formatCoordinatePair(lat, lon),
    distance_from_current_km: distanceKm,
  };

  // ── Stage 3: propagation — inputs with provenance, never recomputed ─
  const coverageFraction = propEv(propagation.coverage_fraction, {
    unit: 'fraction', defaultSource: 'propagation-engine (caller-supplied)',
    defaultAssumptions: ['COL/coverage fraction is an input to this stage — the canonical pipeline does not recompute propagation physics'],
  });
  const blanketFraction = propEv(propagation.blanket_population_fraction, {
    unit: 'fraction', defaultSource: 'propagation-engine (caller-supplied)',
    defaultAssumptions: ['canonical unit: FRACTION of 25 mV/m-contour population (0.01 = 1%)'],
  });
  const contourDistancesKm = propagation.contour_distances_km ?? null;
  const sigma_msm = num(propagation.sigma_msm);

  // ── Stage 4a: antenna design (pure geometry; feeds the height rules) ─
  const antennaDesign = deriveAntennaDesign({
    frequency_khz,
    fcc_class,
    host_structure_height_m: candidate.host_structure_height_m ?? null,
    requested_height_m: candidate.requested_height_m ?? null,
  });
  const selectedHeightM = antennaDesign.selectedDesignHeightM.value;

  // ── Stage 4b: regulatory rules — ALL of rules/* ─────────────────────
  const modes = resolveAntennaModes({
    licensedMode: station.licensed_pattern_mode ?? null,
    screeningAssumptionMode,
    frequency_khz,
    fcc_class,
    coverage_fraction: coverageFraction.value,
  });
  const modeledMode = modes.patternModeModeled.value;
  const isDirectional = isDirectionalMode(modeledMode);

  const nif = evaluateNighttimeInterferenceRequirement({
    frequency_khz,
    fcc_class,
    pattern_mode: station.licensed_pattern_mode ?? null,
    night_study_present: propagation.night_study_present === true,
    night_study_result: propagation.night_study_result ?? null,
  });

  const proof = evaluateProofRequirement({
    patternModeModeled: modes.patternModeModeled,
    patternModeRequired: modes.patternModeRequired.mode,
  });

  const { asr, faaNotice } = evaluateAsrFaa({
    selectedDesignHeightM: selectedHeightM,
    nearAirportTrigger: candidate.near_airport_trigger ?? null,
  });

  const rfExposure = evaluateRfExposure({
    frequency_khz,
    tpo_kw,
    erp_kw: station.erp_kw ?? null,
    selectedDesignHeightM: selectedHeightM,
  });

  const blanket = evaluateBlanket({
    populationFraction: blanketFraction.value,
    populationBasis: propagation.blanket_population_basis ?? '(unspecified)',
  });

  const currentSite = evaluateCurrentSiteRelationship({
    distance_from_current_km: distanceKm,
  });

  // One flat regulatory block: every RegulatoryDecision lives here so the
  // validator, the confidence axes, and the recommendation gates all read
  // the same records.
  const regulatory = {
    nif,
    asr,
    faaNotice,
    rfExposureEvaluation: rfExposure.evaluationRequired,
    blanket: blanket.decision,
    proofOfPerformance: proof.decision,
    antennaModeRequired: modes.patternModeRequired.decision,
    antennaModeFilingImpact: modes.filingImpact.decision,
    currentSiteTransition: currentSite.decision,
    externalSpacingStudy: currentSite.externalSpacingStudy,
  };

  // ── Stage 5: ground system ──────────────────────────────────────────
  const groundSystem = deriveGroundSystem({
    frequency_khz,
    sigma_msm,
    selectedScenarioKey: groundScenarioKey,
    isDirectional,
    towersCount,
  });

  // ── Stage 6: costs — canonical height + selected scenario only ─────
  const costs = buildCostModel({
    antennaDesign,
    groundSystem,
    regulatory,
    land_use_class: candidate.land_use_class ?? null,
    isDirectional,
    towersCount: groundSystem.selectedScenario.towersCount,
    tpo_kw,
  });

  // ── Stage 7: confidence axes (validation folded in below) ──────────
  const inputTiers = {
    conductivitySource: propagation.sigma_source_tier ?? CONFIDENCE_TIERS.SCREENING,
    colGeometry: candidate.col_polygon_present === true
      ? (propagation.col_geometry_tier ?? CONFIDENCE_TIERS.ENGINEERING_GRADE)
      : CONFIDENCE_TIERS.LOW,
    populationBasis: propagation.population_basis_tier ?? CONFIDENCE_TIERS.LOW,
  };

  // ── Stage 8: scoring context ────────────────────────────────────────
  const scoring = scoringInputs && Number.isFinite(Number(scoringInputs.candidateScore))
    ? deriveScoringContext(scoringInputs)
    : null;

  // ── Stage 8b: scenario labeling — a naming layer, not a new selection ─
  // (canonical-consistency-audit-followup, Phase 2 item 2). distanceKm===0
  // is exactly how siteOptimizer.js's ensureCurrentSiteIncluded() marks
  // the current/authorized-site row.
  const scenario = buildScenario({
    antennaDesign,
    modeledMode,
    nif,
    isBaselineCandidate: distanceKm === 0,
    tpo_kw,
  });

  // ── Assemble the core (recommendation-free) result ──────────────────
  const result = {
    schema: 'canonical-candidate-result/1',
    source: SOURCE,
    station: {
      callsign: station.callsign ?? null,
      frequency_khz,
      fcc_class,
      tpo_kw,
      latitude: num(station.latitude),
      longitude: num(station.longitude),
      longitudeFormatted: formatLongitude(num(station.longitude)),
    },
    candidate: geometry,
    propagation: {
      recomputed: false,
      coverageFraction,
      blanketPopulationFraction: blanketFraction,
      contourDistancesKm,
      sigmaMsm: ev(sigma_msm, {
        unit: 'mS/m', source: 'propagation-engine (caller-supplied)',
        confidence: inputTiers.conductivitySource,
        assumptions: ['ground conductivity as supplied by the propagation stage'],
      }),
    },
    antenna: {
      ...antennaDesign,
      patternModeLicensed: modes.patternModeLicensed,
      patternModeAssumed: modes.patternModeAssumed,
      patternModeRequired: modes.patternModeRequired,
      patternModeModeled: modes.patternModeModeled,
      modeWarnings: modes.warnings,
    },
    proof: {
      proofType: proof.proofType,
      constructionProofRequired: proof.constructionProofRequired,
      radialCount: proof.radialCount,
      monitorPointsRequired: proof.monitorPointsRequired,
      form302Exhibits: proof.form302Exhibits,
    },
    groundSystem,
    rfExposure: {
      reactiveNearFieldBoundaryM: rfExposure.reactiveNearFieldBoundaryM,
      controlledMpeBoundaryM: rfExposure.controlledMpeBoundaryM,
      uncontrolledMpeBoundaryM: rfExposure.uncontrolledMpeBoundaryM,
      recommendedFenceDistanceM: rfExposure.recommendedFenceDistanceM,
    },
    blanket: {
      populationFraction: blanket.populationFraction,
      limitFraction: blanket.limitFraction,
    },
    transition: {
      constructionOverlapRisk: currentSite.constructionOverlapRisk,
      temporarySimultaneousOperationRisk: currentSite.temporarySimultaneousOperationRisk,
      staCoordinationRequired: currentSite.staCoordinationRequired,
      shutdownSequenceRequired: currentSite.shutdownSequenceRequired,
    },
    regulatory,
    costs,
    scoring,
    scenario,
  };

  // ── Stage 9: validation pass 1 → confidence → recommendation ───────
  const coreValidation = validateCandidateResult(result, { mode: validationMode });

  const confidence = deriveConfidence({
    rankingLayers: propagation.ranking_layers ?? [],
    inputTiers,
    regulatory,
    validation: coreValidation,
  });
  result.confidence = {
    rankingSignalQuality: confidence.rankingSignalQuality,
    engineeringDataConfidence: confidence.engineeringDataConfidence,
    regulatoryCompleteness: confidence.regulatoryCompleteness,
  };
  result.filingReadiness = confidence.filingReadiness;

  const recommendation = deriveRecommendation({
    confidence,
    regulatory,
    scoring,
    validation: coreValidation,
    siteControl: { parcelDataPresent: candidate.parcel_data_present ?? null },
  });
  result.recommendation = recommendation;
  result.recommendations = [recommendation];

  // ── Stage 10: validation pass 2 (final, attached) ───────────────────
  result.validation = validateCandidateResult(result, { mode: validationMode });

  return result;
}
