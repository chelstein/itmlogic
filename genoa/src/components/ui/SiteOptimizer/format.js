// Shared presentation helpers for the SiteOptimizer UI.
//
// ONE coordinate formatter (fmtCoord) — hemisphere is ALWAYS derived from
// the sign of the value, never hardcoded.  '°W' / '°E' / '°N' / '°S'
// string literals must not appear anywhere else in this folder.
//
// ONE state→color mapping (stateColor) implementing the five-color
// semantics used across the optimizer UI:
//   green = verified PASS only
//   red   = verified FAIL
//   amber = required follow-up / WARN
//   gray  = NOT_EVALUATED / unknown / missing
//   blue  = informational / modeled scenario

/* ── coordinates ─────────────────────────────────────────────────────── */

/**
 * Format a lat/lon pair with sign-derived hemisphere letters.
 * fmtCoord(34.86, -111.82) → '34.8600° N, 111.8200° W'.
 * Null-guarded: returns '—' unless BOTH values are finite numbers.
 */
export function fmtCoord(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (lat == null || lon == null || !Number.isFinite(la) || !Number.isFinite(lo)) return '—';
  const latDir = la >= 0 ? 'N' : 'S';
  const lonDir = lo >= 0 ? 'E' : 'W';
  return `${Math.abs(la).toFixed(4)}° ${latDir}, ${Math.abs(lo).toFixed(4)}° ${lonDir}`;
}

/** Hemisphere suffix for a latitude input field, derived from sign. */
export function latSuffix(v) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return '°';
  return n < 0 ? '°S' : '°N';
}

/** Hemisphere suffix for a longitude input field, derived from sign. */
export function lonSuffix(v) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return '°';
  return n < 0 ? '°W' : '°E';
}

/* ── percentages ─────────────────────────────────────────────────────── */

// blanket_population_pct (and the regulatory_compliance_summary
// blanket_pop value / threshold) are stored as PERCENT values
// (e.g. 0.6 === 0.6%, limit 1 === 1%), NOT as 0..1 fractions —
// do NOT multiply by 100.
export function fmtBlanketPct(v, digits = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(digits)}%`;
}

/* ── five-color state semantics ──────────────────────────────────────── */

export const STATE_COLORS = Object.freeze({
  green: '#63d471',
  red:   '#ff5a5a',
  amber: '#ffb347',
  gray:  '#a89c84',
  blue:  '#7ec8e3',
});

const GREEN_STATES = new Set(['PASS', 'COMPLIANT', 'OK', 'NOT_REQUIRED', 'CLEAR', 'READY', 'CONSISTENT', 'GO']);
const RED_STATES   = new Set(['FAIL', 'NON_COMPLIANT', 'EXCEEDS_LIMIT', 'VIOLATION', 'NO_GO', 'BLOCKED']);
const AMBER_STATES = new Set(['WARN', 'WARNING', 'REQUIRED', 'ADVISORY', 'CONDITIONAL', 'ELEVATED', 'HIGH', 'FOLLOW_UP', 'PENDING', 'NOT_READY']);
const BLUE_STATES  = new Set(['INFO', 'INFORMATIONAL', 'MODELED', 'SCENARIO', 'SCREENING', 'ESTIMATE', 'LIKELY']);

/**
 * Map an evaluation/decision state to its display color.
 * Anything missing or unrecognized (including NOT_EVALUATED / UNKNOWN)
 * renders gray — a candidate must never look green just because a field
 * was absent from the payload.
 */
export function stateColor(state) {
  if (state === null || state === undefined || state === '') return STATE_COLORS.gray;
  const s = String(state).toUpperCase().replace(/[\s-]+/g, '_');
  if (GREEN_STATES.has(s)) return STATE_COLORS.green;
  if (RED_STATES.has(s))   return STATE_COLORS.red;
  if (AMBER_STATES.has(s)) return STATE_COLORS.amber;
  if (BLUE_STATES.has(s))  return STATE_COLORS.blue;
  return STATE_COLORS.gray;
}

/**
 * Color for a tri-state "X required" flag:
 *   true  → amber (required follow-up — a requirement is work, not a failure)
 *   false → green (verified not required)
 *   null/undefined → gray (not evaluated — NEVER green)
 */
export function requirementColor(flag) {
  if (flag === true)  return stateColor('REQUIRED');
  if (flag === false) return stateColor('NOT_REQUIRED');
  return stateColor(null);
}

/**
 * Color for a tri-state pass/fail flag (true = verified PASS):
 *   true → green, false → red, missing → gray.
 */
export function passFailColor(pass) {
  if (pass === true)  return stateColor('PASS');
  if (pass === false) return stateColor('FAIL');
  return stateColor(null);
}

/**
 * Color for a tri-state violation flag (true = verified limit exceeded):
 *   true → red, false → green, missing → gray.
 */
export function violationColor(violates) {
  if (violates === true)  return stateColor('FAIL');
  if (violates === false) return stateColor('PASS');
  return stateColor(null);
}
