// Canonical blanketing-interference rule — 47 CFR §73.24(g).
//
// Replaces the fraction/percent unit collision catalogued in
// docs/architecture-contradiction-origins.md §7 (optimizer computed
// PERCENT with limit 1.0, canonical module used FRACTION 0.01, and the UI
// multiplied by 100 again).
//
// CANONICAL UNIT: FRACTION of population.  0.01 === 1%.  The limit lives
// in exactly one exported constant; percent inputs must pass through
// fromPercent() at the boundary.

'use strict';

import { decision, ev, EVALUATION_STATES, COMPLETION_STATES, CONFIDENCE_TIERS } from '../types.js';

const SOURCE = 'canonical/rules/blanket';

/**
 * §73.24(g): the population within the 1 V/m (1000 mV/m) blanketing
 * contour must be less than 1% of the population of the area encompassed
 * by the proposed 25 mV/m contour.  Canonical unit: FRACTION (0.01 = 1%).
 */
export const BLANKET_LIMIT_FRACTION = 0.01;

/**
 * Convert a percent figure (1 = 1%) to the canonical fraction (0.01).
 * @param {number} p percent, 0–100
 * @returns {number} fraction, 0–1
 */
export function fromPercent(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new RangeError(`fromPercent(): percent must be a finite number in [0, 100], got ${p}`);
  }
  return n / 100;
}

/**
 * Format a canonical fraction for display (0.01 → "1%").
 * @param {number} fraction 0–1
 * @returns {string}
 */
export function formatFractionAsPercent(fraction) {
  const n = Number(fraction);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new RangeError(`formatFractionAsPercent(): fraction must be in [0, 1], got ${fraction}`);
  }
  const pct = n * 100;
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded}%`;
}

const PROXY_BASIS_RE = /proxy|density|heuristic|estimate|surrogate/i;

/**
 * Evaluate the §73.24(g) blanketing-population limit.
 *
 * @param {Object}  p
 * @param {?number} [p.populationFraction=null]  FRACTION (0.01 = 1%) of the
 *   25 mV/m-contour population inside the blanketing contour.  Values > 1
 *   or < 0 are rejected (they are almost certainly percent values leaking
 *   past the boundary — use fromPercent()).
 * @param {string}  p.populationBasis  what produced the number, e.g.
 *   'CENSUS_BLOCK' or 'DENSITY_PROXY' or free text naming the method.
 * @param {?string} [p.methodNote]     extra method detail for the rationale.
 * @returns {{ populationFraction: ?number, limitFraction: number,
 *             decision: Object }}
 */
export function evaluateBlanket({
  populationFraction = null,
  populationBasis,
  methodNote = null,
} = {}) {
  if (populationFraction != null) {
    const n = Number(populationFraction);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new RangeError(
        `evaluateBlanket(): populationFraction must be a FRACTION in [0, 1] ` +
        `(0.01 = 1%); got ${populationFraction}. Percent inputs must be ` +
        'converted with fromPercent() at the boundary.'
      );
    }
  }

  const basis = String(populationBasis ?? '').trim();
  const isProxy = PROXY_BASIS_RE.test(basis);
  const note = methodNote ? ` Method: ${methodNote}.` : '';

  const inputsUsed = [
    ev(populationFraction, {
      unit: 'fraction', source: SOURCE,
      confidence: isProxy ? CONFIDENCE_TIERS.LOW : CONFIDENCE_TIERS.ENGINEERING_GRADE,
      assumptions: [
        'canonical unit: fraction of 25 mV/m-contour population (0.01 = 1%)',
        `population basis: ${basis || '(unspecified)'}`,
      ],
    }),
  ];
  const ruleReferences = ['47 CFR §73.24(g)'];

  if (populationFraction == null) {
    return {
      populationFraction: null,
      limitFraction: BLANKET_LIMIT_FRACTION,
      decision: decision({
        state: EVALUATION_STATES.NOT_EVALUATED,
        required: true,
        completion: COMPLETION_STATES.NOT_RUN,
        result: EVALUATION_STATES.NOT_EVALUATED,
        ruleReferences,
        rationale:
          'No blanketing-population figure supplied; the §73.24(g) 1% limit ' +
          `(canonical fraction ${BLANKET_LIMIT_FRACTION}) was not evaluated.` + note +
          ' Inputs: populationFraction (missing), populationBasis.',
        blockers: ['Blanketing-contour population not computed'],
        inputsUsed,
      }),
    };
  }

  const overLimit = populationFraction >= BLANKET_LIMIT_FRACTION;
  const figure = `${formatFractionAsPercent(populationFraction)} vs limit ${formatFractionAsPercent(BLANKET_LIMIT_FRACTION)}`;

  let d;
  if (isProxy) {
    // A proxy can flag risk but cannot issue a verified verdict — cap at WARN.
    d = decision({
      state: EVALUATION_STATES.WARN,
      required: true,
      completion: COMPLETION_STATES.PARTIAL,
      result: EVALUATION_STATES.NOT_EVALUATED,
      ruleReferences,
      rationale:
        `Blanketing population ${figure} was derived from a PROXY basis ` +
        `("${basis}"): a proxy can flag §73.24(g) risk but cannot issue a ` +
        `verified ${overLimit ? 'FAIL' : 'PASS'} verdict. ` +
        (overLimit
          ? 'The proxy indicates the 1% limit is likely exceeded — census-grade analysis required.'
          : 'The proxy indicates margin against the 1% limit — census-grade analysis required to verify.') +
        note + ' Inputs: populationFraction, populationBasis (proxy).',
      blockers: ['Census-grade blanketing-population analysis not performed'],
      inputsUsed,
    });
  } else {
    d = decision({
      state: overLimit ? EVALUATION_STATES.FAIL : EVALUATION_STATES.PASS,
      required: true,
      completion: COMPLETION_STATES.RUN,
      result: overLimit ? EVALUATION_STATES.FAIL : EVALUATION_STATES.PASS,
      ruleReferences,
      rationale:
        `Blanketing population ${figure} (basis: ${basis || '(unspecified)'}) ` +
        (overLimit
          ? 'is at or above the §73.24(g) 1% limit.'
          : 'is below the §73.24(g) 1% limit.') +
        note + ' Inputs: populationFraction, populationBasis.',
      blockers: [],
      inputsUsed,
    });
  }

  return {
    populationFraction,
    limitFraction: BLANKET_LIMIT_FRACTION,
    decision: d,
  };
}
