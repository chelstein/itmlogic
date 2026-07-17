// Canonical AM result pipeline — shared formatters.
//
// One formatter per presentation concern, imported everywhere a value is
// rendered.  This kills two whole contradiction classes from the audit:
//   * coordinate hemisphere drift (formatLongitude(-111.82) must always
//     render as '111.82° W', never '111.82° E');
//   * the percent/fraction unit mixup around the §73.24(g) blanketing
//     limit — the CANONICAL internal representation is a decimal FRACTION
//     (0.01 === 1%); percent strings exist only at the formatting edge.
//
// It also implements rounding-by-confidence: SCREENING/LOW values are
// deliberately coarsened at render time so a ±50% screening estimate can
// never masquerade as a filing-grade figure.

'use strict';

import { CONFIDENCE_TIERS } from './types.js';

/* ── internal helpers ────────────────────────────────────────────────── */

/**
 * Format a non-negative magnitude with fixed precision, trimming
 * trailing zeros (and a dangling decimal point) sensibly.
 * 111.82 @4 → '111.82'; 111.8 @4 → '111.8'; 111 @4 → '111'.
 * @param {number} magnitude
 * @param {number} precision
 * @returns {string}
 */
function trimmedFixed(magnitude, precision) {
  let s = magnitude.toFixed(precision);
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

/**
 * Round to n significant figures.
 * @param {number} value
 * @param {number} sigFigs
 * @returns {number}
 */
function roundSig(value, sigFigs) {
  if (!Number.isFinite(value) || value === 0) return value === 0 ? 0 : value;
  const mag = Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** (mag - sigFigs + 1);
  return Math.round(value / factor) * factor;
}

/** Is this tier one whose values must be rendered coarsely? */
function isCoarseTier(tier) {
  return tier === CONFIDENCE_TIERS.SCREENING || tier === CONFIDENCE_TIERS.LOW;
}

/** Thousands-grouped integer string, locale-independent. */
function grouped(value) {
  const neg = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const intPart = Math.trunc(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = abs % 1;
  return neg + intPart + (frac ? String(frac).slice(1) : '');
}

/* ── coordinates ─────────────────────────────────────────────────────── */

/**
 * Format a latitude as an unsigned magnitude plus hemisphere letter.
 * Null-safe: null/undefined/NaN → null.
 * @param {?number} lat        Degrees, positive north.
 * @param {number}  [precision=4]
 * @returns {?string} e.g. '40.7562° N'
 */
export function formatLatitude(lat, precision = 4) {
  if (lat === null || lat === undefined || typeof lat !== 'number' || !Number.isFinite(lat)) {
    return null;
  }
  const hemisphere = lat < 0 ? 'S' : 'N';
  return `${trimmedFixed(Math.abs(lat), precision)}° ${hemisphere}`;
}

/**
 * Format a longitude as an unsigned magnitude plus hemisphere letter.
 * Negative (western hemisphere) ALWAYS renders 'W'; positive renders 'E'.
 * formatLongitude(-111.82) === '111.82° W'.
 * Null-safe: null/undefined/NaN → null.
 * @param {?number} lon        Degrees, positive east.
 * @param {number}  [precision=4]
 * @returns {?string}
 */
export function formatLongitude(lon, precision = 4) {
  if (lon === null || lon === undefined || typeof lon !== 'number' || !Number.isFinite(lon)) {
    return null;
  }
  const hemisphere = lon < 0 ? 'W' : 'E';
  return `${trimmedFixed(Math.abs(lon), precision)}° ${hemisphere}`;
}

/**
 * Format a coordinate pair.  Null-safe: returns null unless BOTH
 * coordinates are formattable.
 * @param {?number} lat
 * @param {?number} lon
 * @param {number}  [precision=4]
 * @returns {?string} e.g. '40.7562° N, 111.82° W'
 */
export function formatCoordinatePair(lat, lon, precision = 4) {
  const latStr = formatLatitude(lat, precision);
  const lonStr = formatLongitude(lon, precision);
  if (latStr === null || lonStr === null) return null;
  return `${latStr}, ${lonStr}`;
}

/* ── percentages (canonical unit: decimal fraction) ──────────────────── */

/**
 * The §73.24(g) blanketing population limit, in the CANONICAL unit:
 * a decimal fraction of the population inside the 25 mV/m contour.
 * 0.01 === 1%.  Never store or compare this as "1.0 percent".
 * @type {number}
 */
export const BLANKET_LIMIT_FRACTION = 0.01;

/**
 * Render a decimal fraction as a percent string.
 * fractionToPercentString(0.01) → '1.0%'.  Null-safe → null.
 * @param {?number} fraction  0.01 === 1%.
 * @param {number}  [digits=1]
 * @returns {?string}
 */
export function fractionToPercentString(fraction, digits = 1) {
  if (fraction === null || fraction === undefined ||
      typeof fraction !== 'number' || !Number.isFinite(fraction)) {
    return null;
  }
  return `${(fraction * 100).toFixed(digits)}%`;
}

/**
 * Convert a percent figure (1 === 1%) to the canonical decimal fraction.
 * percentToFraction(1) → 0.01.  Null-safe → null.
 * @param {?number} pct
 * @returns {?number}
 */
export function percentToFraction(pct) {
  if (pct === null || pct === undefined ||
      typeof pct !== 'number' || !Number.isFinite(pct)) {
    return null;
  }
  return pct / 100;
}

/**
 * Assert a value is a decimal fraction in [0, 1] (or null/undefined,
 * which is tolerated — absence is not a unit error).  Throws RangeError
 * otherwise; catches percent values (e.g. 60 "percent") leaking into
 * fraction-typed fields.
 * @param {?number} x
 * @param {string}  [label='fraction']
 * @returns {?number} the value, for chaining.
 */
export function assertFraction(x, label = 'fraction') {
  if (x === null || x === undefined) return x;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) {
    throw new RangeError(
      `${label} must be a decimal fraction in [0, 1] (0.01 === 1%); got ${x}`
    );
  }
  return x;
}

/**
 * The blanketing limit rendered for display: '1%', derived from the
 * canonical 0.01 fraction — never a hardcoded string elsewhere.
 * @returns {string}
 */
export function formatBlanketLimit() {
  return fractionToPercentString(BLANKET_LIMIT_FRACTION, 0);
}

/* ── rounding-by-confidence ──────────────────────────────────────────── */

/**
 * Coarsen a value according to its confidence tier.  SCREENING/LOW values
 * are rounded to 3 significant figures; FILING_GRADE/ENGINEERING_GRADE
 * values pass through untouched.  Null-safe → null.
 * @param {?number}        value
 * @param {ConfidenceTier} tier
 * @returns {?number}
 */
export function approx(value, tier) {
  if (value === null || value === undefined ||
      typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return isCoarseTier(tier) ? roundSig(value, 3) : value;
}

/**
 * Render a value with tier-appropriate precision and an explicit '≈'
 * marker when coarsened.  approxString(319482, 'SCREENING') → '≈319,000';
 * approxString(319482, 'FILING_GRADE') → '319,482'.  Null-safe → null.
 * @param {?number}        value
 * @param {ConfidenceTier} tier
 * @returns {?string}
 */
export function approxString(value, tier) {
  if (value === null || value === undefined ||
      typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (isCoarseTier(tier)) {
    return `≈${grouped(roundSig(value, 3))}`;
  }
  return grouped(value);
}

/** Format a dollar amount coarsely: 2 sig figs with K/M suffix. */
function coarseMoney(value) {
  const r = roundSig(value, 2);
  const abs = Math.abs(r);
  const sign = r < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${trimmedFixed(abs / 1e6, 2)}M`;
  if (abs >= 1e3) return `${sign}$${trimmedFixed(abs / 1e3, 1)}K`;
  return `${sign}$${grouped(abs)}`;
}

/**
 * Render a low–high cost range with tier-appropriate precision.
 * costRangeString(541511, 988581, 'SCREENING') → '$540K–$990K';
 * filing/engineering grade keeps exact figures:
 * '$541,511–$988,581'.  Null-safe → null when either bound is absent.
 * @param {?number}        low
 * @param {?number}        high
 * @param {ConfidenceTier} tier
 * @returns {?string}
 */
export function costRangeString(low, high, tier) {
  const bad = (v) => v === null || v === undefined ||
    typeof v !== 'number' || !Number.isFinite(v);
  if (bad(low) || bad(high)) return null;
  if (isCoarseTier(tier)) {
    return `${coarseMoney(low)}–${coarseMoney(high)}`;
  }
  return `$${grouped(low)}–$${grouped(high)}`;
}

/**
 * Render a score with its uncertainty band as integers:
 * scoreString(63.6, 27) → '64 ± 27'.  Bandless scores render alone.
 * Null-safe → null.
 * @param {?number} score
 * @param {?number} [band]
 * @returns {?string}
 */
export function scoreString(score, band = null) {
  if (score === null || score === undefined ||
      typeof score !== 'number' || !Number.isFinite(score)) {
    return null;
  }
  const s = Math.round(score);
  if (band === null || band === undefined ||
      typeof band !== 'number' || !Number.isFinite(band)) {
    return String(s);
  }
  return `${s} ± ${Math.round(Math.abs(band))}`;
}
