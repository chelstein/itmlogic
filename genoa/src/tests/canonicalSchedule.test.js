// Tests for canonical/schedule.js — canonical-consistency-audit-followup,
// Phase 4 item 1.

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSchedule, SCHEDULE_PHASES } from '../engine/am/canonical/schedule.js';
import { buildCanonicalCandidateResult } from '../engine/am/canonical/buildCanonicalCandidateResult.js';
import { KAZM_BUILD_ARGS } from './fixtures/kazmCanonical.js';

test('deriveSchedule: 8 phases in dependency order, environmental review and FAA/ASR marked parallel with each other', () => {
  const s = deriveSchedule({});
  assert.equal(s.phases.length, 8);
  const ids = s.phases.map((p) => p.id);
  assert.deepEqual(ids, [
    SCHEDULE_PHASES.PRE_FILING_DUE_DILIGENCE,
    SCHEDULE_PHASES.ENGINEERING_STUDIES,
    SCHEDULE_PHASES.ENVIRONMENTAL_REVIEW,
    SCHEDULE_PHASES.FAA_ASR,
    SCHEDULE_PHASES.FCC_APPLICATION_PREP,
    SCHEDULE_PHASES.FCC_PROCESSING,
    SCHEDULE_PHASES.CONSTRUCTION,
    SCHEDULE_PHASES.PROOF_AND_LICENSE_TO_COVER,
  ]);
  const env = s.phases.find((p) => p.id === SCHEDULE_PHASES.ENVIRONMENTAL_REVIEW);
  const faa = s.phases.find((p) => p.id === SCHEDULE_PHASES.FAA_ASR);
  assert.deepEqual(env.parallelWith, [SCHEDULE_PHASES.FAA_ASR]);
  assert.deepEqual(faa.parallelWith, [SCHEDULE_PHASES.ENVIRONMENTAL_REVIEW]);
});

test('deriveSchedule: parallel phases are combined with max(), not +, inside time_to_filing', () => {
  const s = deriveSchedule({ asrRequired: true }); // FAA/ASR (8-16wk) > environmental (4-12wk)
  const preFiling = s.phases.find((p) => p.id === SCHEDULE_PHASES.PRE_FILING_DUE_DILIGENCE);
  const engineering = s.phases.find((p) => p.id === SCHEDULE_PHASES.ENGINEERING_STUDIES);
  const env = s.phases.find((p) => p.id === SCHEDULE_PHASES.ENVIRONMENTAL_REVIEW);
  const faa = s.phases.find((p) => p.id === SCHEDULE_PHASES.FAA_ASR);
  const appPrep = s.phases.find((p) => p.id === SCHEDULE_PHASES.FCC_APPLICATION_PREP);

  const sequentialSum = preFiling.weeksLow + engineering.weeksLow + env.weeksLow + faa.weeksLow + appPrep.weeksLow;
  const parallelSum = preFiling.weeksLow + engineering.weeksLow + Math.max(env.weeksLow, faa.weeksLow) + appPrep.weeksLow;

  assert.equal(s.timeToFiling.value.low, parallelSum);
  assert.notEqual(s.timeToFiling.value.low, sequentialSum,
    'time_to_filing must not silently equal the fully-sequential sum when the parallel pair has different durations');
  assert.ok(s.timeToFiling.value.low < sequentialSum,
    'combining the parallel pair with max() must produce a SHORTER time_to_filing than naive sequential addition');
});

test('deriveSchedule: fcc_processing_time is a distinct figure, never merged into time_to_filing', () => {
  const s = deriveSchedule({ isClearChannel: true, treatyZonePresent: true });
  assert.ok(s.fccProcessingTime.value.low > 0);
  // time_to_filing must NOT include any FCC-processing-only extension
  // (clear-channel / treaty inflate fccProcessingTime but must not also
  // silently inflate timeToFiling).
  const base = deriveSchedule({});
  assert.equal(s.timeToFiling.value.low, base.timeToFiling.value.low,
    'clear-channel/treaty status must not change time_to_filing -- those extend FCC processing, a separate phase, not pre-filing diligence');
});

test('deriveSchedule: total_project_duration = time_to_filing + fcc_processing_time + construction_period + proof_and_license_period (fully sequential end-to-end)', () => {
  const s = deriveSchedule({ isDirectional: true, asrRequired: true, highPower: true });
  const expectedLow = s.timeToFiling.value.low + s.fccProcessingTime.value.low
    + s.constructionPeriod.value.low + s.proofAndLicensePeriod.value.low;
  const expectedHigh = s.timeToFiling.value.high + s.fccProcessingTime.value.high
    + s.constructionPeriod.value.high + s.proofAndLicensePeriod.value.high;
  assert.equal(s.totalProjectDuration.value.low, expectedLow);
  assert.equal(s.totalProjectDuration.value.high, expectedHigh);
});

test('deriveSchedule: DA, treaty, ASR, high-power, clear-channel each independently extend the schedule (reuses licensing_timeline_estimate\'s existing multipliers, no new figures invented)', () => {
  const base = deriveSchedule({});
  const da = deriveSchedule({ isDirectional: true });
  const treaty = deriveSchedule({ treatyZonePresent: true });
  const asr = deriveSchedule({ asrRequired: true });
  const highPower = deriveSchedule({ highPower: true });
  const clearChannel = deriveSchedule({ isClearChannel: true });

  assert.ok(da.timeToFiling.value.high > base.timeToFiling.value.high, 'DA must extend time_to_filing (engineering + application prep)');
  assert.ok(treaty.fccProcessingTime.value.high > base.fccProcessingTime.value.high, 'treaty zone must extend FCC processing');
  assert.ok(asr.constructionPeriod.value.high > base.constructionPeriod.value.high, 'ASR must extend construction');
  assert.ok(highPower.constructionPeriod.value.low > base.constructionPeriod.value.low, 'high power must extend construction');
  assert.ok(clearChannel.fccProcessingTime.value.low > base.fccProcessingTime.value.low, 'clear channel must extend FCC processing');
});

test('canonical.schedule is attached to the assembled result and is internally consistent', () => {
  const r = buildCanonicalCandidateResult(KAZM_BUILD_ARGS);
  assert.ok(r.schedule, 'result.schedule must be present');
  assert.equal(r.schedule.phases.length, 8);
  assert.ok(r.schedule.totalProjectDuration.value.low >= r.schedule.timeToFiling.value.low);
  assert.ok(r.schedule.totalProjectDuration.value.low > r.schedule.fccProcessingTime.value.low,
    'total must be strictly greater than any single sub-phase figure');
});
