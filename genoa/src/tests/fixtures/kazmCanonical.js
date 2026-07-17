// KAZM canonical-pipeline fixture.
//
// KAZM, 780 kHz (a §73.25 clear channel), Class D, 5 kW day, licensed
// NDA.  Current site 34.86 / -111.82; relocation candidate at
// 34.8420 / -111.8419 (≈2.8 km away).  Screening-grade conductivity
// (2 mS/m from the M3 map, ±50%), COL polygon ABSENT, nighttime NIF
// study ABSENT, parcel data ABSENT.
//
// This is the exact configuration in which the legacy optimizer emitted
// the contradictions catalogued in
// docs/architecture-contradiction-origins.md; the canonical pipeline
// must instead produce one internally consistent, honestly-hedged result.

'use strict';

export const KAZM_STATION = Object.freeze({
  callsign: 'KAZM',
  frequency_khz: 780,
  fcc_class: 'D',
  tpo_kw: 5,
  licensed_pattern_mode: 'NDA',
  latitude: 34.86,
  longitude: -111.82,
});

export const KAZM_CANDIDATE = Object.freeze({
  latitude: 34.8420,
  longitude: -111.8419,
  requested_height_m: null,
  host_structure_height_m: null,
  land_use_class: 'rural',
  col_polygon_present: false,   // COL polygon absent — disc proxy only
  parcel_data_present: false,   // no parcel/site-control data yet
  near_airport_trigger: null,   // airport prong not checked
});

export const KAZM_PROPAGATION = Object.freeze({
  // Screening propagation INPUTS (the pipeline never recomputes physics).
  coverage_fraction: Object.freeze({
    value: 0.87,
    unit: 'fraction',
    source: 'm3-screening-run 2026-07-14',
    confidence: 'SCREENING',
    assumptions: Object.freeze(['disc-proxy COL geometry (no COL polygon available)']),
  }),
  blanket_population_fraction: null,   // blanketing population not computed
  blanket_population_basis: 'not computed',
  contour_distances_km: Object.freeze({ mv25: 4.1, mv5: 18.6, mv0_5: 61.2 }),
  sigma_msm: 2,
  sigma_source_tier: 'SCREENING',      // M3 map read, ±50%
  population_basis_tier: 'LOW',        // density proxy, not census blocks
  night_study_present: false,
  night_study_result: null,
  ranking_layers: Object.freeze([
    Object.freeze({ name: 'coverage', isProxy: false, agreesWithTopChoice: true }),
    Object.freeze({ name: 'landUseProxy', isProxy: true, agreesWithTopChoice: true }),
  ]),
});

// Candidate scores exactly TIED with its nearest competitor — the case
// the legacy ranker broke by insertion order and labeled "superior".
export const KAZM_SCORING_INPUTS = Object.freeze({
  candidateScore: 63.6,
  baselineScore: 63.6,
  allScores: Object.freeze([63.6, 63.6, 51.2, 44.9]),
  minimumMeaningfulDelta: 2,
});

export const KAZM_BUILD_ARGS = Object.freeze({
  station: KAZM_STATION,
  candidate: KAZM_CANDIDATE,
  propagation: KAZM_PROPAGATION,
  scoringInputs: KAZM_SCORING_INPUTS,
  options: Object.freeze({
    groundScenarioKey: 'STANDARD_120',
    screeningAssumptionMode: 'NDA',
    towersCount: 1,
    validationMode: 'production',
  }),
});
