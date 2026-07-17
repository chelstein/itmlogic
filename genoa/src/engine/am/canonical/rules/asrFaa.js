// Canonical ASR / FAA notice rule — 47 CFR §17.7 / FAA Form 7460-1.
//
// Replaces the divergent height bases catalogued in
// docs/architecture-contradiction-origins.md §6 (class design height vs
// λ/4 vs per-tier menus, hardcoded 60 m, and >= vs > comparator drift).
//
// EXACTLY ONE height input — the selected design height — and one
// comparator: strictly greater than 60.96 m (200 ft), per §17.7(a)
// ("more than").  The airport-proximity prong (§17.7(c) / 14 CFR
// §77.9(b)) cannot be resolved from height alone; when unknown it is
// reported as UNKNOWN, never silently assumed false.

'use strict';

import { decision, ev, EVALUATION_STATES, COMPLETION_STATES, CONFIDENCE_TIERS } from '../types.js';
import { ASR_THRESHOLD_17_7 } from '../../../regulatory/regulatoryConstants.js';

const SOURCE = 'canonical/rules/asrFaa';

/**
 * Antenna Structure Registration and FAA Form 7460-1 notice triggers for
 * the SELECTED design height.
 *
 * @param {Object}   p
 * @param {number}   p.selectedDesignHeightM  the ONE height input (m AGL)
 * @param {?boolean} [p.nearAirportTrigger=null]
 *   true  — structure is inside a §17.7(c)/14 CFR §77.9(b) airport surface
 *   false — verified outside all notice surfaces
 *   null  — not yet checked (unknown)
 * @returns {{ asr: Object, faaNotice: Object, heightUsedM: number,
 *             thresholdM: number }}
 */
export function evaluateAsrFaa({
  selectedDesignHeightM,
  nearAirportTrigger = null,
} = {}) {
  const h = Number(selectedDesignHeightM);
  const thresholdM = ASR_THRESHOLD_17_7.height_m; // 60.96 m (200 ft)

  const heightInput = ev(Number.isFinite(h) ? h : null, {
    unit: 'm', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
    assumptions: [
      'selected design height AGL — the single canonical height basis for ASR/FAA',
    ],
  });
  const airportInput = ev(nearAirportTrigger, {
    unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
    assumptions: ['airport-proximity prong per §17.7(c) / 14 CFR §77.9(b); null = not checked'],
  });
  const inputsUsed = [heightInput, airportInput];
  const ruleReferences = ['47 CFR §17.7', '47 CFR §17.7(a)'];

  if (!Number.isFinite(h) || h <= 0) {
    const bad = decision({
      state: EVALUATION_STATES.UNKNOWN,
      required: null,
      completion: COMPLETION_STATES.NOT_RUN,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences,
      rationale:
        'Selected design height is missing or non-positive; the §17.7 height ' +
        'trigger cannot be evaluated. Inputs: selectedDesignHeightM.',
      blockers: ['Selected design height not available'],
      inputsUsed,
    });
    return { asr: bad, faaNotice: bad, heightUsedM: null, thresholdM };
  }

  const heightTrips = h > thresholdM; // strictly greater — §17.7(a) "more than"

  // ── ASR (registration) ────────────────────────────────────────────
  let asr;
  if (heightTrips) {
    asr = decision({
      state: EVALUATION_STATES.WARN, // obligation exists — registration needed
      required: true,
      completion: COMPLETION_STATES.RUN,
      result: EVALUATION_STATES.WARN,
      ruleReferences,
      rationale:
        `Selected design height ${h.toFixed(2)} m exceeds the §17.7 threshold of ` +
        `${thresholdM} m (200 ft): antenna structure registration (FCC Form 854) ` +
        'is required. Inputs: selectedDesignHeightM.',
      blockers: [],
      inputsUsed,
    });
  } else if (nearAirportTrigger === true) {
    asr = decision({
      state: EVALUATION_STATES.WARN,
      required: true,
      completion: COMPLETION_STATES.RUN,
      result: EVALUATION_STATES.WARN,
      ruleReferences: [...ruleReferences, '47 CFR §17.7(c)', '14 CFR §77.9(b)'],
      rationale:
        `Selected design height ${h.toFixed(2)} m is at or below ${thresholdM} m, ` +
        'but the structure lies within an airport notice surface (§17.7(c) / ' +
        '14 CFR §77.9(b)): registration is required via the airport prong. ' +
        'Inputs: selectedDesignHeightM, nearAirportTrigger.',
      blockers: [],
      inputsUsed,
    });
  } else if (nearAirportTrigger === false) {
    asr = decision({
      state: EVALUATION_STATES.NOT_REQUIRED,
      required: false,
      completion: COMPLETION_STATES.RUN,
      result: EVALUATION_STATES.PASS,
      ruleReferences: [...ruleReferences, '47 CFR §17.7(c)'],
      rationale:
        `Selected design height ${h.toFixed(2)} m is at or below the ${thresholdM} m ` +
        'threshold and the site is verified outside all airport notice surfaces: ' +
        'no antenna structure registration required. ' +
        'Inputs: selectedDesignHeightM, nearAirportTrigger.',
      blockers: [],
      inputsUsed,
    });
  } else {
    asr = decision({
      state: EVALUATION_STATES.UNKNOWN,
      required: null,
      completion: COMPLETION_STATES.PARTIAL,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences: [...ruleReferences, '47 CFR §17.7(c)', '14 CFR §77.9(b)'],
      rationale:
        `Selected design height ${h.toFixed(2)} m does not trip the ${thresholdM} m ` +
        'height threshold, but the §17.7(c) airport-proximity prong has not been ' +
        'checked — registration may still be required. ' +
        'Inputs: selectedDesignHeightM, nearAirportTrigger (unknown).',
      blockers: ['Airport-proximity check (§17.7(c) / 14 CFR §77.9(b)) not performed'],
      inputsUsed,
    });
  }

  // ── FAA Form 7460-1 notice (same triggers: height OR airport prong) ─
  const faaRefs = ['14 CFR §77.9', '47 CFR §17.7'];
  let faaNotice;
  if (heightTrips || nearAirportTrigger === true) {
    faaNotice = decision({
      state: EVALUATION_STATES.WARN,
      required: true,
      completion: COMPLETION_STATES.RUN,
      result: EVALUATION_STATES.WARN,
      ruleReferences: faaRefs,
      rationale:
        (heightTrips
          ? `Selected design height ${h.toFixed(2)} m exceeds ${thresholdM} m (200 ft): `
          : 'Structure lies within an airport notice surface: ') +
        'FAA Form 7460-1 (Notice of Proposed Construction or Alteration) must be ' +
        'filed and an FAA determination obtained before FCC registration. ' +
        'Inputs: selectedDesignHeightM, nearAirportTrigger.',
      blockers: [],
      inputsUsed,
    });
  } else if (nearAirportTrigger === false) {
    faaNotice = decision({
      state: EVALUATION_STATES.NOT_REQUIRED,
      required: false,
      completion: COMPLETION_STATES.RUN,
      result: EVALUATION_STATES.PASS,
      ruleReferences: faaRefs,
      rationale:
        `Selected design height ${h.toFixed(2)} m is at or below ${thresholdM} m and ` +
        'the site is verified outside all 14 CFR §77.9 notice surfaces: no FAA ' +
        'Form 7460-1 notice required. Inputs: selectedDesignHeightM, nearAirportTrigger.',
      blockers: [],
      inputsUsed,
    });
  } else {
    faaNotice = decision({
      state: EVALUATION_STATES.UNKNOWN,
      required: null,
      completion: COMPLETION_STATES.PARTIAL,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences: faaRefs,
      rationale:
        `Selected design height ${h.toFixed(2)} m does not trip the height prong, ` +
        'but the 14 CFR §77.9(b) airport-proximity prong has not been checked — ' +
        'an FAA Form 7460-1 notice may still be required. ' +
        'Inputs: selectedDesignHeightM, nearAirportTrigger (unknown).',
      blockers: ['Airport-proximity check (14 CFR §77.9(b)) not performed'],
      inputsUsed,
    });
  }

  return { asr, faaNotice, heightUsedM: h, thresholdM };
}
