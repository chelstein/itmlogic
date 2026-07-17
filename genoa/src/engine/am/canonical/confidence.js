// Canonical confidence stage — FOUR SEPARATED AXES, never collapsed.
//
// Replaces the two parallel uncertainty systems and the
// compliance-verdict-wearing-the-word-"confidence" catalogued in
// docs/architecture-contradiction-origins.md §10.  In particular it
// fixes the defect where optimization_confidence counted enabled goal
// LAYERS so that adding a PROXY layer RAISED confidence: here a proxy
// layer can never raise rankingSignalQuality — proxies are counted and
// reported, but excluded from the agreement signal by construction.
//
// The four axes answer four different questions and MUST stay separate:
//   rankingSignalQuality      — how trustworthy is the ORDERING of candidates?
//   engineeringDataConfidence — how good are the physical INPUTS?
//   regulatoryCompleteness    — what fraction of required decisions RAN?
//   filingReadiness           — can this candidate be filed today, and if
//                               not, exactly what blocks it?
// There is deliberately NO overall/combined score.

'use strict';

import { CONFIDENCE_TIERS } from './types.js';

const SOURCE = 'canonical/confidence';

/** Tier ordering for min-of-tiers reasoning (higher = better). */
const TIER_RANK = Object.freeze({
  [CONFIDENCE_TIERS.FILING_GRADE]: 3,
  [CONFIDENCE_TIERS.ENGINEERING_GRADE]: 2,
  [CONFIDENCE_TIERS.SCREENING]: 1,
  [CONFIDENCE_TIERS.LOW]: 0,
});

const tierOf = (t) => (Object.prototype.hasOwnProperty.call(TIER_RANK, t) ? t : CONFIDENCE_TIERS.LOW);

function looksLikeDecision(d) {
  return d !== null && typeof d === 'object' &&
    (Object.prototype.hasOwnProperty.call(d, 'state') ||
     Object.prototype.hasOwnProperty.call(d, 'completion')) &&
    Object.prototype.hasOwnProperty.call(d, 'required');
}

/**
 * Collect [name, decision] pairs from a canonical regulatory block.
 * Accepts bare decisions and rule outputs nesting one under `.decision`.
 */
export function collectRegulatoryDecisions(regulatory) {
  const found = [];
  if (!regulatory || typeof regulatory !== 'object') return found;
  for (const [name, v] of Object.entries(regulatory)) {
    if (looksLikeDecision(v)) found.push([name, v]);
    else if (v && typeof v === 'object' && looksLikeDecision(v.decision)) {
      found.push([name, v.decision]);
    }
  }
  return found;
}

/**
 * Derive the four separated confidence axes.
 *
 * @param {Object}   p
 * @param {Array}    [p.rankingLayers=[]]   scoring layers:
 *   {name, isProxy: boolean, agreesWithTopChoice: ?boolean}.  A layer with
 *   isProxy === true NEVER contributes to rankingSignalQuality — a proxy
 *   cannot corroborate a ranking it did not independently measure.
 * @param {Object}   [p.inputTiers={}]      confidence tier of each
 *   engineering input: {conductivitySource, colGeometry, populationBasis}
 *   (ConfidenceTier each; a missing entry counts as LOW).
 * @param {Object}   [p.regulatory={}]      canonical regulatory decisions.
 * @param {?Object}  [p.validation=null]    validateCandidateResult report.
 * @param {string[]} [p.filingGradeRequiredInputs] which inputTiers keys
 *   must be filing/engineering grade before filing (default: all three).
 * @returns {{
 *   rankingSignalQuality: Object,
 *   engineeringDataConfidence: Object,
 *   regulatoryCompleteness: Object,
 *   filingReadiness: { ready: boolean, blockers: string[] },
 * }}
 */
export function deriveConfidence({
  rankingLayers = [],
  inputTiers = {},
  regulatory = {},
  validation = null,
  filingGradeRequiredInputs = ['conductivitySource', 'colGeometry', 'populationBasis'],
} = {}) {
  // ── Axis 1: rankingSignalQuality ────────────────────────────────────
  const layers = Array.isArray(rankingLayers) ? rankingLayers : [];
  const proxyLayers = layers.filter((l) => l && l.isProxy === true);
  const independentLayers = layers.filter((l) => l && l.isProxy !== true);
  const agreeing = independentLayers.filter((l) => l.agreesWithTopChoice === true);

  let rankingTier;
  if (independentLayers.length >= 3 && agreeing.length === independentLayers.length) {
    rankingTier = CONFIDENCE_TIERS.ENGINEERING_GRADE;
  } else if (independentLayers.length >= 2 && agreeing.length >= 2) {
    rankingTier = CONFIDENCE_TIERS.SCREENING;
  } else {
    rankingTier = CONFIDENCE_TIERS.LOW;
  }

  const rankingSignalQuality = Object.freeze({
    tier: rankingTier,
    independentLayerCount: independentLayers.length,
    agreeingLayerCount: agreeing.length,
    proxyLayerCount: proxyLayers.length,
    proxyLayersExcluded: Object.freeze(proxyLayers.map((l) => String(l.name ?? 'unnamed'))),
    basis:
      'layer agreement among INDEPENDENT (non-proxy) scoring layers only; ' +
      'proxy layers are reported but can never raise this axis — a proxy ' +
      'cannot corroborate a ranking it did not independently measure',
    source: SOURCE,
  });

  // ── Axis 2: engineeringDataConfidence (min of input tiers) ─────────
  const keys = ['conductivitySource', 'colGeometry', 'populationBasis'];
  const tiers = keys.map((k) => [k, tierOf(inputTiers[k])]);
  let minKey = tiers[0][0];
  let minTier = tiers[0][1];
  for (const [k, t] of tiers) {
    if (TIER_RANK[t] < TIER_RANK[minTier]) { minTier = t; minKey = k; }
  }
  const engineeringDataConfidence = Object.freeze({
    tier: minTier,
    limitedBy: minKey,
    inputTiers: Object.freeze(Object.fromEntries(tiers)),
    basis: 'minimum tier across engineering inputs (a chain is as good as its weakest input); a missing input counts as LOW',
    source: SOURCE,
  });

  // ── Axis 3: regulatoryCompleteness ──────────────────────────────────
  const decisions = collectRegulatoryDecisions(regulatory);
  const required = decisions.filter(([, d]) => d.required === true);
  const run = required.filter(([, d]) => d.completion === 'RUN');
  const pending = required.filter(([, d]) => d.completion !== 'RUN');
  const regulatoryCompleteness = Object.freeze({
    fraction: required.length === 0 ? null : run.length / required.length,
    requiredCount: required.length,
    completedCount: run.length,
    pendingDecisions: Object.freeze(pending.map(([name]) => name)),
    basis: 'fraction of required regulatory decisions whose evaluation actually RAN',
    source: SOURCE,
  });

  // ── Axis 4: filingReadiness ─────────────────────────────────────────
  const blockers = [];

  for (const [name, d] of required) {
    if (d.completion === 'NOT_RUN' || d.state === 'UNKNOWN') {
      const detail = Array.isArray(d.blockers) && d.blockers.length > 0
        ? d.blockers.join('; ')
        : 'required decision has not been run';
      blockers.push(`${name}: ${detail}`);
    }
  }
  // Required-unknown decisions (required === null with UNKNOWN state) also block.
  for (const [name, d] of decisions) {
    if (d.required === null && d.state === 'UNKNOWN') {
      const detail = Array.isArray(d.blockers) && d.blockers.length > 0
        ? d.blockers.join('; ')
        : 'requirement itself is unresolved';
      blockers.push(`${name}: ${detail}`);
    }
  }

  for (const key of filingGradeRequiredInputs) {
    const t = tierOf(inputTiers[key]);
    if (TIER_RANK[t] <= TIER_RANK[CONFIDENCE_TIERS.SCREENING]) {
      blockers.push(`${key}: ${t}-grade input where a filing-grade input is required`);
    }
  }

  if (!validation || typeof validation !== 'object') {
    blockers.push('validation: invariant validation has not been run');
  } else if (validation.consistent !== true) {
    const n = Array.isArray(validation.violations) ? validation.violations.length : '?';
    blockers.push(`validation: candidate result is internally inconsistent (${n} invariant violation(s))`);
  }

  const filingReadiness = Object.freeze({
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
    basis:
      'ready only when no required decision is NOT_RUN/UNKNOWN, no screening-grade ' +
      'input remains where filing-grade is required, and invariant validation passed',
    source: SOURCE,
  });

  // Four axes, returned side by side — never collapsed into one number.
  return Object.freeze({
    rankingSignalQuality,
    engineeringDataConfidence,
    regulatoryCompleteness,
    filingReadiness,
  });
}
