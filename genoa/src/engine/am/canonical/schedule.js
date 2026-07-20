// Canonical schedule stage — ONE phase-dependency model, decision-free.
//
// Replaces the divergent per-candidate/per-guide timeline estimates
// catalogued during the canonical-consistency-audit-followup Phase 4
// investigation: `regulatory_timeline_estimate` (weeks, phases summed
// sequentially even where its own comments say ASR "typically runs
// concurrent with FCC processing"), `licensing_timeline_estimate` (weeks,
// 5 phases, ALSO summed sequentially despite the same concurrency
// language), `am_fcc_application_filing_cost_and_timeline_guide` (days,
// a different unit and phase breakdown entirely), `construction_permit_
// timeline_optimizer` (days, yet another independent breakdown), and
// `station_total_project_cost_pro_forma_guide`'s total_timeline_months_low/
// high, which were HARDCODED CONSTANTS (18/30 months) that never varied
// with frequency, class, ASR requirement, treaty zone, or antenna mode —
// unlike every other guide's timeline, which does vary with those inputs.
//
// This module is DECISION-FREE (same discipline as groundSystem.js): it
// emits EngineeringValues, never RegulatoryDecisions. It reuses the SAME
// duration multipliers the pre-existing licensing_timeline_estimate guide
// already used (DA pattern design adds time; treaty coordination adds
// time; clear-channel adds FCC processing time; ASR/FAA adds construction
// time; high power adds construction time) — no new figures were
// invented, only the phase graph and the total-duration arithmetic were
// corrected: PARALLEL phases are combined with max(), never +.

'use strict';

import { ev, CONFIDENCE_TIERS } from './types.js';

const SOURCE = 'canonical/schedule';

/** Phase IDs, in the order construction-permit projects actually proceed. */
export const SCHEDULE_PHASES = Object.freeze({
  PRE_FILING_DUE_DILIGENCE: 'PRE_FILING_DUE_DILIGENCE',
  ENGINEERING_STUDIES:      'ENGINEERING_STUDIES',
  ENVIRONMENTAL_REVIEW:     'ENVIRONMENTAL_REVIEW',
  FAA_ASR:                  'FAA_ASR',
  FCC_APPLICATION_PREP:     'FCC_APPLICATION_PREP',
  FCC_PROCESSING:           'FCC_PROCESSING',
  CONSTRUCTION:             'CONSTRUCTION',
  PROOF_AND_LICENSE_TO_COVER: 'PROOF_AND_LICENSE_TO_COVER',
});

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Derive the canonical construction-permit-to-license schedule.
 *
 * @param {Object}   p
 * @param {boolean}  [p.isDirectional=false]     DA pattern (adds design/
 *   proof time to several phases — same multiplier the pre-existing
 *   licensing_timeline_estimate guide used).
 * @param {boolean}  [p.isClearChannel=false]     §73.25 clear channel
 *   (adds FCC processing time — dominant-station coordination).
 * @param {boolean}  [p.asrRequired=false]        candidate.canonical.
 *   regulatory.asr.required (adds FAA/ASR and construction time).
 * @param {boolean}  [p.treatyZonePresent=false]  candidate sits in a
 *   US/MX or US/CA treaty coordination zone (adds pre-filing AND FCC
 *   processing time — CP cannot be granted before treaty clearance).
 * @param {boolean}  [p.highPower=false]          TPO >= 25 kW (adds
 *   construction complexity).
 * @returns {{
 *   phases: Array<{id:string,label:string,weeksLow:number,weeksHigh:number,blocking:boolean,parallelWith:string[]}>,
 *   timeToFiling: Object,          // ev, weeks
 *   fccProcessingTime: Object,     // ev, weeks — DISTINCT, never merged into a total
 *   constructionPeriod: Object,    // ev, weeks (construction phase only)
 *   proofAndLicensePeriod: Object, // ev, weeks
 *   totalProjectDuration: Object,  // ev, weeks — computed from the dependency graph, not a flat sum
 *   source: string,
 * }}
 */
export function deriveSchedule({
  isDirectional = false,
  isClearChannel = false,
  asrRequired = false,
  treatyZonePresent = false,
  highPower = false,
} = {}) {
  // ── Phase 1: pre-filing due diligence (site study, lease, zoning) ────
  // Sequential first phase; treaty pre-screening adds diligence time here
  // (verifying/coordinating treaty-zone status before any filing).
  const preFilingLow  = 2;
  const preFilingHigh = 4 + (treatyZonePresent ? 4 : 0);

  // ── Phase 2: engineering studies (conductivity, antenna/ground design,
  // §73.182 NIF analysis) — DA adds array design + NIF complexity, same
  // multiplier licensing_timeline_estimate used (16-36 wk ND vs 26-52 wk DA).
  const engineeringLow  = isDirectional ? 22 : 12;
  const engineeringHigh = isDirectional ? 44 : 28;

  // ── Phase 3: environmental review (NEPA §1.1306 desktop / NHPA §106) —
  // runs PARALLEL with FAA/ASR (phase 4), not sequential with it.
  const environmentalLow  = 4;
  const environmentalHigh = 12;

  // ── Phase 4: FAA/ASR (Form 7460-1 + FCC Form 854) — only a real
  // schedule driver when the design actually triggers ASR; otherwise a
  // short Part 77 pre-screen. Runs PARALLEL with environmental review.
  const faaAsrLow  = asrRequired ? 8 : 2;
  const faaAsrHigh = asrRequired ? 16 : 4;

  // ── Phase 5: FCC application prep (exhibits, LMS Form 301-AM filing) —
  // sequential, after engineering + the parallel environmental/FAA track
  // both complete. DA adds pattern-exhibit complexity (72-radial HRP).
  const appPrepLow  = 4;
  const appPrepHigh = isDirectional ? 12 : 8;

  // ── Phase 6: FCC processing (comment period + staff review + CP
  // grant) — a SEPARATE figure, never merged into time_to_filing (it
  // happens AFTER filing). Clear-channel and treaty both extend it.
  const fccProcessingLow  = (isClearChannel || isDirectional) ? 26 : 20;
  const fccProcessingHigh = (isClearChannel ? 78 : isDirectional ? 52 : 40)
    + (treatyZonePresent ? 52 : 0);

  // ── Phase 7: construction — ASR-triggered marking/lighting and high
  // power both extend it.
  const constructionLow  = (highPower ? 26 : isDirectional ? 20 : 13);
  const constructionHigh = (highPower ? 52 : isDirectional ? 36 : 26) + (asrRequired ? 8 : 0);

  // ── Phase 8: proof of performance + Form 302-AM (license to cover) —
  // DA proof (multi-radial FI traversals) takes longer than NDA proof.
  const proofLow  = isDirectional ? 8 : 4;
  const proofHigh = isDirectional ? 16 : 8;

  const phases = Object.freeze([
    Object.freeze({
      id: SCHEDULE_PHASES.PRE_FILING_DUE_DILIGENCE,
      label: 'Pre-filing due diligence (site survey, lease, zoning)',
      weeksLow: preFilingLow, weeksHigh: preFilingHigh,
      blocking: true, parallelWith: Object.freeze([]),
    }),
    Object.freeze({
      id: SCHEDULE_PHASES.ENGINEERING_STUDIES,
      label: 'Engineering studies (§73.190 conductivity, antenna/ground design, §73.182 NIF)',
      weeksLow: engineeringLow, weeksHigh: engineeringHigh,
      blocking: true, parallelWith: Object.freeze([]),
    }),
    Object.freeze({
      id: SCHEDULE_PHASES.ENVIRONMENTAL_REVIEW,
      label: 'Environmental review (NEPA §1.1306 desktop, NHPA §106)',
      weeksLow: environmentalLow, weeksHigh: environmentalHigh,
      blocking: true, parallelWith: Object.freeze([SCHEDULE_PHASES.FAA_ASR]),
    }),
    Object.freeze({
      id: SCHEDULE_PHASES.FAA_ASR,
      label: asrRequired
        ? 'FAA Form 7460-1 aeronautical study + FCC ASR Form 854'
        : 'FAA Part 77 pre-screen (ASR not triggered)',
      weeksLow: faaAsrLow, weeksHigh: faaAsrHigh,
      blocking: true, parallelWith: Object.freeze([SCHEDULE_PHASES.ENVIRONMENTAL_REVIEW]),
    }),
    Object.freeze({
      id: SCHEDULE_PHASES.FCC_APPLICATION_PREP,
      label: 'FCC application preparation and LMS Form 301-AM filing',
      weeksLow: appPrepLow, weeksHigh: appPrepHigh,
      blocking: true, parallelWith: Object.freeze([]),
    }),
    Object.freeze({
      id: SCHEDULE_PHASES.FCC_PROCESSING,
      label: 'FCC processing, comment period, and CP grant',
      weeksLow: fccProcessingLow, weeksHigh: fccProcessingHigh,
      blocking: true, parallelWith: Object.freeze([]),
    }),
    Object.freeze({
      id: SCHEDULE_PHASES.CONSTRUCTION,
      label: 'Construction (tower, ground system, transmitter/ATU installation)',
      weeksLow: constructionLow, weeksHigh: constructionHigh,
      blocking: true, parallelWith: Object.freeze([]),
    }),
    Object.freeze({
      id: SCHEDULE_PHASES.PROOF_AND_LICENSE_TO_COVER,
      label: 'Proof of performance and Form 302-AM (license to cover)',
      weeksLow: proofLow, weeksHigh: proofHigh,
      blocking: true, parallelWith: Object.freeze([]),
    }),
  ]);

  // ── time_to_filing: sum of the BLOCKING pre-filing phases, with the
  // environmental/FAA-ASR pair combined by max() (parallel), not +.
  const timeToFilingLow  = preFilingLow + engineeringLow + Math.max(environmentalLow, faaAsrLow) + appPrepLow;
  const timeToFilingHigh = preFilingHigh + engineeringHigh + Math.max(environmentalHigh, faaAsrHigh) + appPrepHigh;

  const timeToFiling = ev(
    { low: round1(timeToFilingLow), high: round1(timeToFilingHigh) },
    {
      unit: 'weeks', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: [
        'sum of blocking pre-filing phases (due diligence + engineering + application prep)',
        'environmental review and FAA/ASR are PARALLEL (max, not +) -- both must complete before application prep, neither blocks the other',
        'excludes FCC processing time (that happens AFTER filing) -- see fccProcessingTime',
      ],
    }
  );

  const fccProcessingTime = ev(
    { low: round1(fccProcessingLow), high: round1(fccProcessingHigh) },
    {
      unit: 'weeks', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: [
        'FCC Media Bureau comment period + staff review + CP grant',
        'a DISTINCT figure from time_to_filing -- never merged into a single "time to filing" total',
        treatyZonePresent ? 'includes treaty-zone extension: CP cannot be granted before FCC IB treaty coordination clears' : 'no treaty-zone extension',
      ],
    }
  );

  const constructionPeriod = ev(
    { low: round1(constructionLow), high: round1(constructionHigh) },
    {
      unit: 'weeks', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: ['construction phase only -- proof of performance/license-to-cover is a separate phase (see proofAndLicensePeriod)'],
    }
  );

  const proofAndLicensePeriod = ev(
    { low: round1(proofLow), high: round1(proofHigh) },
    {
      unit: 'weeks', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: ['proof of performance + Form 302-AM (license to cover), after construction completes'],
    }
  );

  // ── total_project_duration: filing -> FCC processing -> construction ->
  // proof/license-to-cover are ALL sequential (you cannot build before a
  // CP is granted, cannot prove performance before construction, cannot
  // get the covering license before proof) -- this is the one place a
  // straight sum is actually correct, because the dependency really is
  // sequential end-to-end.
  const totalLow  = timeToFilingLow + fccProcessingLow + constructionLow + proofLow;
  const totalHigh = timeToFilingHigh + fccProcessingHigh + constructionHigh + proofHigh;

  const totalProjectDuration = ev(
    { low: round1(totalLow), high: round1(totalHigh) },
    {
      unit: 'weeks', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: [
        'time_to_filing + fcc_processing_time + construction_period + proof_and_license_period, all sequential end-to-end',
        'the internal parallel pairing (environmental review / FAA-ASR) is already resolved with max() inside time_to_filing -- this total does not double-count it',
      ],
    }
  );

  return Object.freeze({
    phases,
    timeToFiling,
    fccProcessingTime,
    constructionPeriod,
    proofAndLicensePeriod,
    totalProjectDuration,
    source: SOURCE,
  });
}
