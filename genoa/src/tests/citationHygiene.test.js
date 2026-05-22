// Citation-hygiene regression tests (PR-D — fcc-attorney F-001..F-004).
//
// Each test pins a specific citation/provenance defect the attorney
// agent flagged in audit cycles 2026-05-22T13:02 → 2026-05-22T21:07.
// Adding them here makes the fix permanent: any future regression
// (e.g. a typo reintroducing '§73.x', a swap back to '§73.183
// Figure M3', a wording revert on §73.315) shows up as a test
// failure rather than as a fresh attorney finding three cycles
// later.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FORM_301_FM_META } from '../exports/lmsFiling/form301fm.js';
import { wordingFor }       from '../engine/finding/serviceWording.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_SRC  = join(__dirname, '..');

// Files the attorney flagged as carrying user-facing '§73.x'
// placeholder text.  Reading the source files directly (rather than
// rendering an exhibit) catches both the rendered-string case AND any
// JSX/template literal that would render '§73.x' under some branch
// not covered by the sample fixtures.
const EXPORT_FILES_FOR_SECTION73X_CHECK = [
  'exports/lmsFiling/form301fm.js',
  'exports/lmsFiling/mapping.js',
  'exports/engineeringReport/sections/conclusion.js',
  'exports/engineeringReport/sections/populationMethodology.js',
  'exports/engineeringReport/sections/validationVerdict.js',
  'exports/engineeringReport/sections/measurements.js',
  'exports/engineeringReport/sections/assumptions.js',
  'exports/engineeringReport/sections/vectorCharts.js',
  'exports/engineeringReport/sections/references.js',
];

// Same hygiene rule on the UI surface — the workbench and dialogs are
// the operator-facing surface and Login.jsx is visible to anyone
// hitting the page.
const UI_FILES_FOR_SECTION73X_CHECK = [
  'ui/App.jsx',
  'components/ui/Login.jsx',
  'components/ui/PeCertifyDialog.jsx',
];

// ── F-002: no rendered '§73.x' placeholder text ──────────────────────

test('F-002 — no rendered export file contains the literal "§73.x" placeholder', () => {
  for (const rel of EXPORT_FILES_FOR_SECTION73X_CHECK){
    const path = join(REPO_SRC, rel);
    const src  = readFileSync(path, 'utf8');
    // Strip JS line comments so we ignore "// historical context: §73.x …"
    // notes the engineer might leave behind.  Rendered text lives in
    // string literals / template literals, never inside `//` comments.
    const stripped = src.replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      stripped.includes('§73.x'),
      false,
      `${rel} still contains the literal "§73.x" in rendered text`
    );
  }
});

test('F-002 — no rendered UI file contains the literal "§73.x" placeholder', () => {
  for (const rel of UI_FILES_FOR_SECTION73X_CHECK){
    const path = join(REPO_SRC, rel);
    const src  = readFileSync(path, 'utf8');
    const stripped = src.replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      stripped.includes('§73.x'),
      false,
      `${rel} still contains the literal "§73.x" in rendered text`
    );
  }
});

// ── F-001: Form 301-FM submission checklist §73.315 wording ──────────

test('F-001 — Form 301-FM submission checklist quotes §73.315 by channel-band, not by Class', () => {
  const checklist = FORM_301_FM_META.submission_checklist;
  const pcLine    = checklist.find((s) => /§73\.315/.test(s));
  assert.ok(pcLine, 'expected at least one submission_checklist line citing §73.315');

  assert.match(pcLine, /70 dBµV\/m/,
    '§73.315 line must state the principal-community contour in dBµV/m, not legacy dBu');
  assert.doesNotMatch(pcLine, /60 dBu Class C/i,
    '§73.315 does not prescribe a Class-C-series variant; the 60 dBµV/m figure is §73.211');
  assert.doesNotMatch(pcLine, /Class C-series/i,
    '"Class C-series" is not a §73.315 distinction');
});

// ── F-003: Figure M3 belongs to §73.190, not §73.183 ─────────────────

test('F-003 — facilityParameters AM conductivity row attributes Figure M3 to §73.190', () => {
  const src = readFileSync(
    join(REPO_SRC, 'exports/engineeringReport/sections/facilityParameters.js'),
    'utf8'
  );
  assert.match(src, /§73\.190 Figure M3/,
    'facilityParameters.js must cite §73.190 Figure M3');
  assert.doesNotMatch(src, /§73\.183 Figure M3/,
    'facilityParameters.js must not cite §73.183 Figure M3 (M3 lives in §73.190)');
});

test('F-003 — assumptions ground-conductivity sentence attributes Figure M3 to §73.190', () => {
  const src = readFileSync(
    join(REPO_SRC, 'exports/engineeringReport/sections/assumptions.js'),
    'utf8'
  );
  assert.match(src, /§73\.190 Figure M3/,
    'assumptions.js must cite §73.190 Figure M3');
  assert.doesNotMatch(src, /§73\.183 Figure M3/,
    'assumptions.js must not cite §73.183 Figure M3');
});

// ── F-004: serviceWording AM.interference_cite = §73.182(k) ──────────

test('F-004 — wordingFor("AM").interference_cite is §73.182(k), not §73.183', () => {
  // §73.183 is "Groundwave signals" and defines service-class field
  // strengths.  It does NOT carry D/U interference ratios — those live
  // in §73.182 (Engineering standards of allocation), with the
  // nighttime NIF binding rule at §73.182(k).  The serviceWording
  // token flows into conclusion.js narratives like
  //   "X/Y evaluated azimuths fail the ${vocab.interference_cite} D/U
  //    protection ratio"
  // so an incorrect cite there ships into customer-facing exhibits.
  const am = wordingFor('AM');
  assert.equal(am.interference_cite, '§73.182(k)',
    'AM interference_cite must point at the rule that actually carries D/U / NIF binding');
  // Spot-check the adjacent cite fields stayed correct.
  assert.equal(am.allocation_rule_cite, '§73.182');
  assert.equal(am.skywave_cite,         '§73.190(c)');
  assert.equal(am.daytime_cite,         '§73.182(a)');
  assert.equal(am.nighttime_cite,       '§73.182(k)');
});

// FM and LPFM interference cites should be untouched by PR-D.
test('F-004 — FM and LPFM interference_cite values are unchanged by PR-D', () => {
  assert.equal(wordingFor('FM').interference_cite,    '§73.215');
  assert.equal(wordingFor('LPFM').interference_cite,  '§73.809');
});
