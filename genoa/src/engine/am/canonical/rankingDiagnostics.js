// Canonical-adjacent ranking-diagnostics module.
//
// The optimizer ranks candidates 1..N even when many share an identical
// or near-identical score (see canonical/scoring.js's per-candidate
// tiedWithinModelPrecision/tieGroupSize, which already answers "is THIS
// candidate tied"). This module answers the GLOBAL question once per run:
// how much of the 1..N ordering is actually meaningful, and how much of
// the score is being driven by sub-factors that don't even vary across
// the candidate set (canonical-consistency-audit-followup, Phase 3
// item 1)?
//
// Deliberately NOT computed per-candidate (unlike scoring.js) — this is
// one summary object over the whole scored set, exposed as the top-level
// `ranking_diagnostics` response field.

'use strict';

const SOURCE = 'canonical/rankingDiagnostics';

// Tie-detection epsilon. Reuses the SAME constant canonical/scoring.js
// defaults to (minimumMeaningfulDelta = 2 score points) so "tied" means
// the same thing here as it does on every individual candidate's
// tied_within_model_precision / tie_group_size fields — one tie
// definition, not two.
export const DEFAULT_TIE_EPSILON = 2;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round2 = (x) => (isNum(x) ? Math.round(x * 100) / 100 : x);

/**
 * Count "unique" scores by sequential clustering: sort ascending, start a
 * new cluster whenever the gap to the previous score is >= epsilon. This
 * is a chained/sequential clustering (A-B-C can each be < epsilon from
 * their immediate neighbor while A and C differ by more than epsilon) —
 * documented here because it is a judgment call, not a single obvious
 * definition of "unique score."
 */
function countUniqueScoreClusters(sortedScores, epsilon) {
  let count = 0;
  let prev = null;
  for (const s of sortedScores) {
    if (prev === null || s - prev >= epsilon) count++;
    prev = s;
  }
  return count;
}

/**
 * Compute ranking diagnostics once across the full scored candidate set.
 *
 * @param {Object}   p
 * @param {Object[]} p.scored     the full scored candidate array (every
 *   evaluated candidate, not just the returned/top-N slice) — each with
 *   .score and .explanation.score_breakdown (the per-goal sub-scores,
 *   already normalized 0..100-weighted, from scoreCandidate()).
 * @param {number}   [p.epsilon=DEFAULT_TIE_EPSILON]
 * @returns {{
 *   evaluatedCandidates: number,
 *   uniqueScores: number,
 *   topScoreTieCount: number,
 *   activeFeatures: string[],
 *   zeroVarianceFeatures: string[],
 *   rankingConfidence: 'HIGH'|'MEDIUM'|'LOW'|'NONE',
 *   rankingConfidenceBasis: string,
 *   epsilon: number,
 *   source: string,
 * }}
 */
export function computeRankingDiagnostics({ scored = [], epsilon = DEFAULT_TIE_EPSILON } = {}) {
  const evaluatedCandidates = scored.length;
  const scores = scored.map((c) => c.score).filter(isNum);

  if (evaluatedCandidates === 0 || scores.length === 0) {
    return Object.freeze({
      evaluatedCandidates,
      uniqueScores: 0,
      topScoreTieCount: 0,
      activeFeatures: Object.freeze([]),
      zeroVarianceFeatures: Object.freeze([]),
      rankingConfidence: 'NONE',
      rankingConfidenceBasis: 'no candidates were scored — ranking confidence is undefined, not LOW',
      epsilon,
      source: SOURCE,
    });
  }

  const sorted = scores.slice().sort((a, b) => a - b);
  const uniqueScores = countUniqueScoreClusters(sorted, epsilon);

  const maxScore = sorted[sorted.length - 1];
  const topScoreTieCount = scores.filter((s) => Math.abs(s - maxScore) < epsilon).length;

  // ── Active vs. zero-variance scoring sub-factors ────────────────────
  // Reads each candidate's explanation.score_breakdown (the per-goal
  // sub-score contribution, already weight-normalized — see
  // scoreCandidate()'s `score_breakdown`). A sub-factor that is bitwise
  // identical (within a tight rounding tolerance) across every candidate
  // in the run is contributing zero real differentiation to the ranking,
  // even though it is nominally part of the score (e.g. a goal disabled
  // for this run always contributes 0; a goal whose input is identical
  // for every candidate in a tight cluster, such as wildfire risk zone
  // when every candidate falls in the same geographic region).
  const allKeys = new Set();
  for (const c of scored) {
    const bd = c.explanation?.score_breakdown ?? {};
    for (const k of Object.keys(bd)) allKeys.add(k);
  }
  const activeFeatures = [];
  const zeroVarianceFeatures = [];
  // Rounding tolerance for "same value" — score_breakdown values are
  // already round2()'d by scoreCandidate(), so exact equality after a
  // fresh round2() is a legitimate identity check, not an approximation.
  for (const key of allKeys) {
    const vals = scored
      .map((c) => c.explanation?.score_breakdown?.[key])
      .filter(isNum)
      .map(round2);
    const distinct = new Set(vals);
    if (distinct.size <= 1) zeroVarianceFeatures.push(key);
    else activeFeatures.push(key);
  }
  activeFeatures.sort();
  zeroVarianceFeatures.sort();

  // ── rankingConfidence ────────────────────────────────────────────────
  // Judgment-call thresholds (documented, not hidden):
  //   NONE   — fewer than 2 candidates evaluated; "ranking" isn't
  //            meaningful with a single data point.
  //   LOW    — the TOP score has 3 or more candidates tied within
  //            epsilon (the operator's "best" pick is a 3-way-or-more
  //            coin flip at this screening resolution), OR fewer than a
  //            third of the scoring sub-factors that appear in this run
  //            actually vary across the candidate set (most of the score
  //            is dead weight).
  //   MEDIUM — exactly 2 candidates tied at the top, OR less than
  //            two-thirds of sub-factors are active.
  //   HIGH   — a clear top score (no tie at the top within epsilon) AND
  //            at least two-thirds of the run's active scoring
  //            sub-factors actually differentiate candidates.
  const totalFeatures = activeFeatures.length + zeroVarianceFeatures.length;
  const activeRatio = totalFeatures > 0 ? activeFeatures.length / totalFeatures : 0;

  let rankingConfidence;
  let rankingConfidenceBasis;
  if (evaluatedCandidates < 2) {
    rankingConfidence = 'NONE';
    rankingConfidenceBasis = 'fewer than 2 candidates evaluated — ranking is not a comparison.';
  } else if (topScoreTieCount >= 3) {
    rankingConfidence = 'LOW';
    rankingConfidenceBasis = `${topScoreTieCount} candidates are tied within ±${epsilon} points at the top score — the #1 rank is not a meaningful single-winner pick at this screening resolution.`;
  } else if (totalFeatures > 0 && activeRatio < (1 / 3)) {
    rankingConfidence = 'LOW';
    rankingConfidenceBasis = `only ${activeFeatures.length}/${totalFeatures} scoring sub-factors actually vary across the candidate set (< 1/3) — most of the score is not differentiating these candidates.`;
  } else if (topScoreTieCount === 2) {
    rankingConfidence = 'MEDIUM';
    rankingConfidenceBasis = `2 candidates are tied within ±${epsilon} points at the top score.`;
  } else if (totalFeatures > 0 && activeRatio < (2 / 3)) {
    rankingConfidence = 'MEDIUM';
    rankingConfidenceBasis = `${activeFeatures.length}/${totalFeatures} scoring sub-factors actually vary across the candidate set (< 2/3).`;
  } else {
    rankingConfidence = 'HIGH';
    rankingConfidenceBasis = `a clear top score (no tie within ±${epsilon} points) and ${activeFeatures.length}/${totalFeatures || activeFeatures.length} scoring sub-factors actively differentiate candidates.`;
  }

  return Object.freeze({
    evaluatedCandidates,
    uniqueScores,
    topScoreTieCount,
    activeFeatures: Object.freeze(activeFeatures),
    zeroVarianceFeatures: Object.freeze(zeroVarianceFeatures),
    rankingConfidence,
    rankingConfidenceBasis,
    epsilon,
    source: SOURCE,
  });
}
