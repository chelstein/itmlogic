// Canonical nighttime interference (NIF) requirement rule — 47 CFR
// §73.182 / §73.37.
//
// SINGLE SOURCE replacing the five divergent NIF predicates catalogued in
// docs/architecture-contradiction-origins.md §3 ("!isLocal";
// "!isLocal && class≠C"; "isClear || (!isLocal && class≠C)";
// "isClear && class≠A"; "always required").
//
// This module answers ONLY the requirement/completion/result questions.
// It never runs the RSS solver itself (that is nifContour.js /
// nightOrchestrator.js) and it NEVER infers nighttime compliance from
// daytime screening — when a study is required and has not been run the
// state is NOT_EVALUATED, full stop.

'use strict';

import { decision, ev, EVALUATION_STATES, COMPLETION_STATES, CONFIDENCE_TIERS } from '../types.js';
import { isClearChannel, isLocalChannel } from './channelSets.js';

const SOURCE = 'canonical/rules/nighttimeInterference';

/**
 * Map a raw night-study result token to a canonical EvaluationState.
 * @param {*} raw
 * @returns {'PASS'|'FAIL'|'NOT_EVALUATED'}
 */
function mapStudyResult(raw) {
  if (raw == null) return EVALUATION_STATES.NOT_EVALUATED;
  const t = String(raw).trim().toUpperCase();
  if (t === 'PASS' || t === 'COMPLIANT' || t === 'PASSED') return EVALUATION_STATES.PASS;
  if (t === 'FAIL' || t === 'NON_COMPLIANT' || t === 'NONCOMPLIANT' || t === 'FAILED') {
    return EVALUATION_STATES.FAIL;
  }
  return EVALUATION_STATES.NOT_EVALUATED;
}

/**
 * Is a nighttime interference (NIF/RSS) study required, has it been run,
 * and what did it find?
 *
 * Requirement rule (one predicate, replacing five):
 *   - Required for ALL classes EXCEPT Class C stations on §73.27 local
 *     channels.  Class C stations on local channels operate under the
 *     §73.182(o) local-channel regime and are not required to protect
 *     co-channel Class C stations at night (basis: §73.182(o) / §73.27),
 *     so no individual nighttime interference showing is required.
 *   - Clear-channel (§73.25) stations that are NOT the dominant Class A
 *     are secondary stations: the study is required AND carries full
 *     clear-channel complexity (skywave protection of the dominant
 *     station's 0.5 mV/m 50% skywave contour), making a DA-N
 *     (directional-night) pattern likely.
 *
 * Requirement, completion, and result are DISTINCT:
 *   required   — from class/channel only.
 *   completion — 'RUN' iff a night study was actually performed.
 *   result     — the study's verdict, or NOT_EVALUATED.
 *
 * @param {Object}   p
 * @param {number}   p.frequency_khz
 * @param {string}   p.fcc_class            'A'|'B'|'C'|'D'
 * @param {?string}  [p.pattern_mode]       raw pattern mode (informational)
 * @param {boolean}  [p.night_study_present=false]
 * @param {*}        [p.night_study_result=null]  raw solver verdict
 * @returns {import('../types.js').RegulatoryDecision}
 */
export function evaluateNighttimeInterferenceRequirement({
  frequency_khz,
  fcc_class,
  pattern_mode = null,
  night_study_present = false,
  night_study_result = null,
} = {}) {
  const cls = String(fcc_class ?? '').trim().toUpperCase();
  const isClear = isClearChannel(frequency_khz);
  const isLocal = isLocalChannel(frequency_khz);
  const clearSecondary = isClear && cls !== 'A';

  const inputsUsed = [
    ev(Number(frequency_khz), {
      unit: 'kHz', source: SOURCE, confidence: CONFIDENCE_TIERS.FILING_GRADE,
      assumptions: ['operator-supplied frequency'],
    }),
    ev(cls, {
      unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.FILING_GRADE,
      assumptions: ['operator-supplied FCC class'],
    }),
    ev(pattern_mode, {
      unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: ['raw pattern mode, informational only for this rule'],
    }),
    ev(Boolean(night_study_present), {
      unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.FILING_GRADE,
      assumptions: ['whether a nighttime RSS/NIF study artifact exists'],
    }),
  ];

  const ruleReferences = ['47 CFR §73.182', '47 CFR §73.37'];

  // ── Not required: Class C on a local channel ────────────────────────
  if (cls === 'C' && isLocal) {
    return decision({
      state: EVALUATION_STATES.NOT_REQUIRED,
      required: false,
      completion: night_study_present ? COMPLETION_STATES.RUN : COMPLETION_STATES.NOT_RUN,
      result: mapStudyResult(night_study_present ? night_study_result : null),
      ruleReferences: [...ruleReferences, '47 CFR §73.182(o)', '47 CFR §73.27'],
      rationale:
        `Class C station on ${frequency_khz} kHz, a §73.27 local channel: under ` +
        '§73.182(o) local-channel operation, Class C stations on local channels ' +
        'are not required to protect co-channel Class C stations at night, so no ' +
        'individual nighttime interference showing is required. ' +
        'Inputs: fcc_class, frequency_khz (local-channel membership).',
      blockers: [],
      inputsUsed,
    });
  }

  // ── Required for everything else ────────────────────────────────────
  const completion = night_study_present ? COMPLETION_STATES.RUN : COMPLETION_STATES.NOT_RUN;
  const result = mapStudyResult(night_study_present ? night_study_result : null);

  const clearNote = clearSecondary
    ? ` The station is a secondary (non-Class-A) occupant of §73.25 clear channel ${frequency_khz} kHz: the study must protect the dominant Class A station's skywave service, carries full clear-channel NIF complexity, and a DA-N (directional night) pattern is likely to be needed.`
    : '';

  if (!night_study_present) {
    return decision({
      state: EVALUATION_STATES.NOT_EVALUATED,
      required: true,
      completion,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences: clearSecondary
        ? [...ruleReferences, '47 CFR §73.25', '47 CFR §73.182(k)']
        : ruleReferences,
      rationale:
        `A nighttime interference (RSS/NIF) study is required for a Class ${cls || '?'} ` +
        `station on ${frequency_khz} kHz (${isClear ? 'clear' : isLocal ? 'local' : 'regional'} ` +
        'channel) and has not been completed. Nighttime compliance is NEVER inferred ' +
        'from daytime screening results.' + clearNote +
        ' Inputs: fcc_class, frequency_khz (channel-class membership), night_study_present.',
      blockers: ['Nighttime NIF study not completed'],
      inputsUsed,
    });
  }

  // Study present — state follows the study's own verdict.
  const state = result; // PASS, FAIL, or NOT_EVALUATED (unrecognized verdict)
  return decision({
    state,
    required: true,
    completion,
    result,
    ruleReferences: clearSecondary
      ? [...ruleReferences, '47 CFR §73.25', '47 CFR §73.182(k)']
      : ruleReferences,
    rationale:
      `Nighttime interference study required for Class ${cls || '?'} on ` +
      `${frequency_khz} kHz and was run; solver verdict maps to ${result}.` +
      clearNote +
      ' Inputs: fcc_class, frequency_khz, night_study_present, night_study_result.',
    blockers: result === EVALUATION_STATES.NOT_EVALUATED
      ? ['Night study present but verdict token unrecognized — cannot map to PASS/FAIL']
      : [],
    inputsUsed,
  });
}
