// Canonical scoring-context stage — ties are first-class citizens.
//
// Replaces the ranking defects catalogued in
// docs/architecture-contradiction-origins.md §10: ties were ranked by
// grid insertion order and never represented, and candidates separated
// by less than the model's own noise floor were labeled "superior".
//
// This module derives a DISPLAY-HONEST scoring context:
//   * a delta below minimumMeaningfulDelta is never called better;
//   * candidates within model precision of each other are TIED and say so.

'use strict';

const SOURCE = 'canonical/scoring';

/** The exact tie label the UI must render — asserted by tests. */
export const TIE_LABEL = 'Tied at current screening resolution';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Derive the canonical scoring context for one candidate.
 *
 * @param {Object}   p
 * @param {number}   p.candidateScore
 * @param {?number}  [p.baselineScore=null]   score of the current site / baseline
 * @param {number[]} [p.allScores=[]]         scores of ALL candidates in the run
 *   (may or may not include candidateScore itself; handled either way)
 * @param {number}   [p.minimumMeaningfulDelta=2]  score points below which a
 *   difference is not a real difference at screening resolution
 * @param {number}   [p.modelPrecision]       tie window; defaults to
 *   minimumMeaningfulDelta
 * @returns {{
 *   absoluteScore: number,
 *   baselineScore: ?number,
 *   deltaFromBaseline: ?number,
 *   percentile: ?number,
 *   materiallyBetterThanBaseline: ?boolean,
 *   tiedWithinModelPrecision: boolean,
 *   tieGroupSize: number,
 *   minimumMeaningfulDelta: number,
 *   modelPrecision: number,
 *   displayLabel: string,
 *   source: string,
 * }}
 */
export function deriveScoringContext({
  candidateScore,
  baselineScore = null,
  allScores = [],
  minimumMeaningfulDelta = 2,
  modelPrecision,
} = {}) {
  if (!isNum(candidateScore)) {
    throw new TypeError(`deriveScoringContext(): candidateScore must be a finite number, got ${candidateScore}`);
  }
  const precision = isNum(modelPrecision) ? modelPrecision : minimumMeaningfulDelta;

  const delta = isNum(baselineScore) ? candidateScore - baselineScore : null;
  const materiallyBetterThanBaseline =
    delta === null ? null : delta > minimumMeaningfulDelta;

  // Peers: every other score in the run (drop ONE instance of the
  // candidate's own score if the caller included it).
  const scores = (Array.isArray(allScores) ? allScores : []).filter(isNum);
  const peers = scores.slice();
  const selfIdx = peers.findIndex((s) => s === candidateScore);
  if (selfIdx !== -1) peers.splice(selfIdx, 1);

  // Tie detection: nearest neighbor within model precision.
  let nearestDelta = null;
  for (const s of peers) {
    const d = Math.abs(candidateScore - s);
    if (nearestDelta === null || d < nearestDelta) nearestDelta = d;
  }
  const tiedWithinModelPrecision = nearestDelta !== null && nearestDelta < precision;
  const tieGroupSize = 1 + peers.filter((s) => Math.abs(candidateScore - s) < precision).length;

  // Percentile among the full field (candidate counted once).
  const field = peers.concat([candidateScore]);
  const percentile = field.length <= 1
    ? null
    : Math.round((field.filter((s) => s <= candidateScore).length / field.length) * 1000) / 10;

  // ── Display label: never 'superior' inside the noise floor ──────────
  let displayLabel;
  if (tiedWithinModelPrecision) {
    displayLabel = TIE_LABEL;
  } else if (delta === null) {
    displayLabel = `Score ${round1(candidateScore)} (no baseline supplied)`;
  } else if (materiallyBetterThanBaseline) {
    displayLabel = `Scores ${round1(delta)} points above baseline (exceeds the ±${minimumMeaningfulDelta} screening noise floor)`;
  } else if (delta < -minimumMeaningfulDelta) {
    displayLabel = `Scores ${round1(Math.abs(delta))} points below baseline (exceeds the ±${minimumMeaningfulDelta} screening noise floor)`;
  } else {
    displayLabel = `Within ±${minimumMeaningfulDelta} points of baseline — not a meaningful difference at screening resolution`;
  }

  return Object.freeze({
    absoluteScore: candidateScore,
    baselineScore: isNum(baselineScore) ? baselineScore : null,
    deltaFromBaseline: delta,
    percentile,
    materiallyBetterThanBaseline,
    tiedWithinModelPrecision,
    tieGroupSize,
    minimumMeaningfulDelta,
    modelPrecision: precision,
    displayLabel,
    source: SOURCE,
  });
}

function round1(x) {
  return Math.round(x * 10) / 10;
}
