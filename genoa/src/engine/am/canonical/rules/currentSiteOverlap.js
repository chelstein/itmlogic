// Canonical current-site relationship rule.
//
// Replaces the mis-framing catalogued in
// docs/architecture-contradiction-origins.md §9, where three different
// §73.37 mileage tables and a contour-overlap framing were applied to
// distance_from_current_km — i.e. against the station's OWN current
// site — producing spacing "eligibility verdicts" that a real
// external-station study could reverse.
//
// The distance to the station's own current site is NOT a §73.37 spacing
// question.  It is a TRANSITION-PLANNING concern (construction overlap,
// temporary simultaneous operation, STA coordination, shutdown
// sequencing).  The actual spacing question — protection of OTHER
// licensed facilities — is returned explicitly as NOT_EVALUATED until a
// full co-channel/adjacent-channel study is run.

'use strict';

import { decision, ev, EVALUATION_STATES, COMPLETION_STATES, CONFIDENCE_TIERS } from '../types.js';

const SOURCE = 'canonical/rules/currentSiteOverlap';

const EXTERNAL_STUDY_TEXT =
  'Full co-channel and adjacent-channel spacing study against external ' +
  'licensed facilities not completed';

/**
 * Transition-planning assessment of the candidate's relationship to the
 * station's OWN current site.  Never a spacing verdict.
 *
 * @param {Object}  p
 * @param {?number} p.distance_from_current_km
 * @returns {{
 *   constructionOverlapRisk: 'HIGH'|'MODERATE'|'LOW'|'UNKNOWN',
 *   temporarySimultaneousOperationRisk: 'HIGH'|'MODERATE'|'LOW'|'UNKNOWN',
 *   staCoordinationRequired: ?boolean,
 *   shutdownSequenceRequired: ?boolean,
 *   decision: Object,            // WARN, informational transition-planning
 *   externalSpacingStudy: Object // NOT_EVALUATED until the real study runs
 * }}
 */
export function evaluateCurrentSiteRelationship({
  distance_from_current_km = null,
} = {}) {
  const d = Number(distance_from_current_km);
  const known = distance_from_current_km != null && Number.isFinite(d) && d >= 0;

  const inputsUsed = [
    ev(known ? d : null, {
      unit: 'km', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: [
        'great-circle distance from the station\'s OWN current site',
        'this input answers transition-planning questions only — never external spacing',
      ],
    }),
  ];

  let constructionOverlapRisk;
  let temporarySimultaneousOperationRisk;
  let staCoordinationRequired;
  let shutdownSequenceRequired;

  if (!known) {
    constructionOverlapRisk = 'UNKNOWN';
    temporarySimultaneousOperationRisk = 'UNKNOWN';
    staCoordinationRequired = null;
    shutdownSequenceRequired = null;
  } else if (d < 1) {
    // Same or adjacent parcel: rebuild-in-place scenario.
    constructionOverlapRisk = 'HIGH';
    temporarySimultaneousOperationRisk = 'HIGH';
    staCoordinationRequired = true;
    shutdownSequenceRequired = true;
  } else if (d < 10) {
    constructionOverlapRisk = 'MODERATE';
    temporarySimultaneousOperationRisk = 'MODERATE';
    staCoordinationRequired = true;
    shutdownSequenceRequired = false;
  } else {
    constructionOverlapRisk = 'LOW';
    temporarySimultaneousOperationRisk = 'LOW';
    staCoordinationRequired = false;
    shutdownSequenceRequired = false;
  }

  const transitionDecision = decision({
    state: EVALUATION_STATES.WARN, // informational — planning attention, not a verdict
    required: null,
    completion: known ? COMPLETION_STATES.RUN : COMPLETION_STATES.NOT_RUN,
    result: EVALUATION_STATES.NOT_EVALUATED,
    ruleReferences: [], // deliberately empty: no CFR spacing rule applies to the own-site distance
    rationale:
      (known
        ? `Candidate is ${d.toFixed(1)} km from the station's own current site. `
        : 'Distance from the station\'s own current site is unknown. ') +
      'This own-site relationship is a TRANSITION-PLANNING concern ' +
      '(construction overlap, temporary simultaneous operation, STA ' +
      'coordination, shutdown sequencing) — it is NOT a spacing or ' +
      'eligibility verdict. Protection of other licensed facilities is a ' +
      'separate study reported under externalSpacingStudy. ' +
      'Inputs: distance_from_current_km.',
    blockers: [],
    inputsUsed,
  });

  const externalSpacingStudy = decision({
    state: EVALUATION_STATES.NOT_EVALUATED,
    required: true,
    completion: COMPLETION_STATES.NOT_RUN,
    result: EVALUATION_STATES.NOT_EVALUATED,
    ruleReferences: ['47 CFR §73.37', '47 CFR §73.182'],
    rationale: EXTERNAL_STUDY_TEXT + '. Inputs: (none — study not run).',
    blockers: [EXTERNAL_STUDY_TEXT],
    inputsUsed: [],
  });

  return {
    constructionOverlapRisk,
    temporarySimultaneousOperationRisk,
    staCoordinationRequired,
    shutdownSequenceRequired,
    decision: transitionDecision,
    externalSpacingStudy,
  };
}
