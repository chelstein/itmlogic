// Unit tests for the shared SiteOptimizer UI presentation helpers
// (src/components/ui/SiteOptimizer/format.js).
//
// Pure functions, no React/JSX dependency — testable directly with the
// node:test runner. These are the reconciliation-invariant proofs required
// by the canonical-consistency audit:
//   - one coordinate formatter, hemisphere always sign-derived
//   - PASS color is never used for UNKNOWN, NOT_EVALUATED, or NOT_REQUIRED
//   - missing/unrecognized state always renders gray, never green

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtCoord, latSuffix, lonSuffix, fmtBlanketPct,
  STATE_COLORS, stateColor, requirementColor, passFailColor, violationColor,
} from '../components/ui/SiteOptimizer/format.js';

/* ── coordinates ─────────────────────────────────────────────────────── */

test('fmtCoord: KAZM candidate renders west longitude, never east', () => {
  const s = fmtCoord(34.8420, -111.8419);
  assert.match(s, /111\.8419° W/);
  assert.doesNotMatch(s, /° E/);
  assert.match(s, /34\.8420° N/);
});

test('fmtCoord: negative longitude always renders W, positive always E', () => {
  assert.match(fmtCoord(0, -111.82), /111\.8200° W/);
  assert.match(fmtCoord(0, 111.82), /111\.8200° E/);
  assert.doesNotMatch(fmtCoord(0, -111.82), /° E/);
  assert.doesNotMatch(fmtCoord(0, 111.82), /° W/);
});

test('fmtCoord: negative latitude renders S, positive renders N', () => {
  assert.match(fmtCoord(-34.86, 0), /34\.8600° S/);
  assert.match(fmtCoord(34.86, 0), /34\.8600° N/);
});

test('fmtCoord: null/undefined/non-finite inputs render the placeholder, never a false hemisphere', () => {
  assert.equal(fmtCoord(null, -111.82), '—');
  assert.equal(fmtCoord(34.86, null), '—');
  assert.equal(fmtCoord(undefined, undefined), '—');
  assert.equal(fmtCoord(NaN, -111.82), '—');
});

test('latSuffix / lonSuffix: sign-derived, never a fixed literal', () => {
  assert.equal(latSuffix(34.86), '°N');
  assert.equal(latSuffix(-34.86), '°S');
  assert.equal(lonSuffix(-111.82), '°W');
  assert.equal(lonSuffix(111.82), '°E');
  assert.equal(latSuffix(null), '°');
  assert.equal(lonSuffix(''), '°');
});

/* ── blanket percentage ──────────────────────────────────────────────── */

test('fmtBlanketPct: renders the stored percent as-is, never multiplied by 100', () => {
  // blanket_population_pct is stored as PERCENT (0.6 === 0.6%), so 0.6 in
  // must render "0.60%", not "60.00%" or "0.01%"/"100%"-style scaling bugs.
  assert.equal(fmtBlanketPct(0.6), '0.60%');
  assert.equal(fmtBlanketPct(1), '1.00%');
  assert.equal(fmtBlanketPct(0), '0.00%');
  assert.equal(fmtBlanketPct(null), '—');
});

/* ── five-color state semantics ──────────────────────────────────────── */

test('stateColor: verified PASS-family states render green', () => {
  for (const s of ['PASS', 'COMPLIANT', 'OK', 'CLEAR', 'READY', 'CONSISTENT', 'GO']) {
    assert.equal(stateColor(s), STATE_COLORS.green, `${s} must render green`);
  }
});

test('stateColor: verified FAIL-family states render red', () => {
  for (const s of ['FAIL', 'NON_COMPLIANT', 'EXCEEDS_LIMIT', 'VIOLATION', 'NO_GO', 'BLOCKED']) {
    assert.equal(stateColor(s), STATE_COLORS.red, `${s} must render red`);
  }
});

test('RECONCILIATION INVARIANT: PASS color is never used for UNKNOWN, NOT_EVALUATED, or NOT_REQUIRED', () => {
  assert.notEqual(stateColor('NOT_REQUIRED'), STATE_COLORS.green,
    'NOT_REQUIRED must not share the PASS color — it is a distinct informational fact ' +
    '("this rule does not apply"), not a verified compliance PASS ("this rule was checked and satisfied")');
  assert.notEqual(stateColor('NOT_EVALUATED'), STATE_COLORS.green);
  assert.notEqual(stateColor('UNKNOWN'), STATE_COLORS.green);
  assert.notEqual(stateColor(null), STATE_COLORS.green);
  assert.notEqual(stateColor(undefined), STATE_COLORS.green);

  // Positive assertions on what they DO render as:
  assert.equal(stateColor('NOT_REQUIRED'), STATE_COLORS.blue, 'NOT_REQUIRED is informational (blue)');
  assert.equal(stateColor('NOT_EVALUATED'), STATE_COLORS.gray, 'NOT_EVALUATED is unknown (gray)');
  assert.equal(stateColor('UNKNOWN'), STATE_COLORS.gray, 'UNKNOWN is unknown (gray)');
  assert.equal(stateColor(null), STATE_COLORS.gray, 'missing state is unknown (gray)');
});

test('stateColor: missing or unrecognized state always renders gray (never green)', () => {
  assert.equal(stateColor(null), STATE_COLORS.gray);
  assert.equal(stateColor(undefined), STATE_COLORS.gray);
  assert.equal(stateColor(''), STATE_COLORS.gray);
  assert.equal(stateColor('SOME_UNRECOGNIZED_TOKEN'), STATE_COLORS.gray);
});

test('stateColor: case- and separator-insensitive', () => {
  assert.equal(stateColor('pass'), STATE_COLORS.green);
  assert.equal(stateColor('not-required'), STATE_COLORS.blue);
  assert.equal(stateColor('not required'), STATE_COLORS.blue);
});

/* ── tri-state helpers ───────────────────────────────────────────────── */

test('requirementColor: true=amber, false=blue (never green), null=gray', () => {
  assert.equal(requirementColor(true), STATE_COLORS.amber);
  assert.equal(requirementColor(false), STATE_COLORS.blue);
  assert.notEqual(requirementColor(false), STATE_COLORS.green,
    'a verified-not-required determination must not render as PASS-green');
  assert.equal(requirementColor(null), STATE_COLORS.gray);
  assert.equal(requirementColor(undefined), STATE_COLORS.gray);
});

test('passFailColor: true=green, false=red, missing=gray (never green for missing)', () => {
  assert.equal(passFailColor(true), STATE_COLORS.green);
  assert.equal(passFailColor(false), STATE_COLORS.red);
  assert.equal(passFailColor(null), STATE_COLORS.gray);
  assert.notEqual(passFailColor(null), STATE_COLORS.green);
  assert.notEqual(passFailColor(undefined), STATE_COLORS.green);
});

test('violationColor: true=red, false=green, missing=gray (never green for missing)', () => {
  assert.equal(violationColor(true), STATE_COLORS.red);
  assert.equal(violationColor(false), STATE_COLORS.green);
  assert.equal(violationColor(null), STATE_COLORS.gray);
  assert.notEqual(violationColor(undefined), STATE_COLORS.green);
});
