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
import { execSync } from 'node:child_process';
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

// ── PRF-008 (PR-CITE2): AM interference_cite covers day AND night ────

test('PRF-008 — wordingFor("AM") splits interference into daytime and nighttime variants', () => {
  // Day-agnostic narratives (e.g. COMPLIANT_VIA_ALT_RULE in conclusion.js)
  // used to render only the nighttime cite §73.182(k) for both day and
  // night AM exhibits.  PR-CITE2 split the AM vocabulary into explicit
  // daytime_interference_cite (§73.187 — Limitation on daytime radiation)
  // and nighttime_interference_cite (§73.182(k) — NIF / RSS), with the
  // generic interference_cite naming BOTH so the narrative is correct
  // under either regime.  Nighttime-specific narratives in conclusion.js
  // now consume vocab.nighttime_interference_cite directly.
  const am = wordingFor('AM');
  assert.equal(am.daytime_interference_cite,   '§73.187',
    'AM daytime interference cite must be §73.187 (Limitation on daytime radiation)');
  assert.equal(am.nighttime_interference_cite, '§73.182(k)',
    'AM nighttime interference cite must be §73.182(k) (NIF / RSS)');
  assert.match(am.interference_cite, /§73\.182(?:\(k\))?\b/,
    'AM generic interference_cite must name §73.182 (or §73.182(k)) — nighttime regime');
  assert.match(am.interference_cite, /§73\.187\b/,
    'AM generic interference_cite must also name §73.187 — daytime regime');
  // Spot-check the adjacent cite fields stayed correct.
  assert.equal(am.allocation_rule_cite, '§73.182');
  assert.equal(am.skywave_cite,         '§73.190(c)');
  assert.equal(am.daytime_cite,         '§73.182(a)');
  assert.equal(am.nighttime_cite,       '§73.182(k)');
});

// FM and LPFM interference cites should be untouched.
test('F-004 / PRF-008 — FM and LPFM interference_cite values are unchanged', () => {
  assert.equal(wordingFor('FM').interference_cite,    '§73.215');
  assert.equal(wordingFor('LPFM').interference_cite,  '§73.809');
});

// ── PR-CITE2 F-005: §73.187 mis-attribution sweep ────────────────────

// User-facing surfaces where §73.187 was being mis-cited as the basis
// for AM NIGHTTIME skywave protection.  The actual statutory basis is
// §73.182(k) (NIF / RSS) + §73.190 (SS-1/SS-2 charts).  §73.187 is
// "Limitation on daytime radiation" per current eCFR; using it for
// nighttime mis-tells the reviewer which rule the engine evaluated.
const F005_SURFACES = [
  'exports/engineeringReport/sections/conclusion.js',
  'exports/engineeringReport/sections/executiveSummary.js',
  'exports/engineeringReport/sections/methodology.js',
  'exports/engineeringReport/sections/appendices.js',
  'exports/engineeringReport/sections/_fmReasoning.js',
  'exports/engineeringReport/sections/populationMethodology.js',
  'exports/engineeringReport/sections/validationVerdict.js',
  'exports/engineeringReport/sections/measurements.js',
  'exports/engineeringReport/sections/assumptions.js',
  'types/warnings.js',
  'engine/regulatory/internationalBorderDetect.js',
];

// Phrases that pair §73.187 with nighttime / skywave / NIF semantics —
// each one represents the mis-attribution PR-CITE2 swept.
// Comments are stripped before matching so engineers can leave
// "// historical: §73.187 nighttime ..." notes in source without
// re-tripping the gate; only RENDERED string literals fail.
const NIGHTTIME_VOCAB = /(nighttime|skywave|NIF)/i;

test('PR-CITE2 F-005 — no rendered surface pairs §73.187 with nighttime / skywave / NIF wording', () => {
  for (const rel of F005_SURFACES){
    const src = readFileSync(join(REPO_SRC, rel), 'utf8');
    const stripped = src
      .replace(/^\s*\/\/.*$/gm, '')       // strip line comments
      .replace(/\/\*[\s\S]*?\*\//g, '');  // strip block comments
    // Pair-match: any §73.187 reference within ±120 chars of nighttime/
    // skywave/NIF vocabulary in the remaining (rendered) text is a fail.
    const re = /§73\.187[^\n]{0,120}(nighttime|skywave|NIF)|(nighttime|skywave|NIF)[^\n]{0,120}§73\.187/i;
    const m = stripped.match(re);
    assert.equal(m, null,
      `${rel} still pairs §73.187 with nighttime/skywave/NIF wording — fragment: ${m ? m[0].slice(0, 200) : ''}`);
  }
});

test('PR-CITE2 F-005 — engine emits §73.182(k) or §73.190 for nighttime skywave narratives', () => {
  // executiveSummary, methodology, appendices preface for AM all carry
  // the actual statutory basis — assert at least one of the canonical
  // nighttime cites is present in each rendered surface.
  const surfaces = [
    'exports/engineeringReport/sections/executiveSummary.js',
    'exports/engineeringReport/sections/methodology.js',
    'exports/engineeringReport/sections/appendices.js',
    'types/warnings.js',
  ];
  for (const rel of surfaces){
    const src = readFileSync(join(REPO_SRC, rel), 'utf8');
    assert.match(src, /§73\.182\(k\)|§73\.190/,
      `${rel} must cite §73.182(k) and/or §73.190 as the nighttime-skywave basis`);
  }
});

// ── PR-CITE2 F-006: Form 349 "within or overlapping" → "entirely within" ─

test('PR-CITE2 F-006 — form349.js fill-in note states the contour is ENTIRELY WITHIN, not "within or overlapping"', () => {
  const src = readFileSync(join(REPO_SRC, 'exports/lmsFiling/form349.js'), 'utf8');
  assert.doesNotMatch(src, /within or overlapping/i,
    'form349.js must not use the loose "within or overlapping" phrasing — §74.1201(g) requires the translator service contour entirely within the primary protected contour');
  assert.match(src, /entirely within/i,
    'form349.js must explicitly state "entirely within" for the fill-in contour requirement');
});

test('PR-CITE2 F-006 — form349.js submission_checklist no longer mis-cites §74.1232(d)/(e)', () => {
  // §74.1232(e) is about financial-support prohibitions, NOT fill-in
  // contour scope.  §74.1232(d) is about coverage-area ownership
  // restrictions, NOT AM-primary cross-service.  Fill-in is §74.1201(g);
  // AM-primary translator-area defaults are §74.1231(i).
  const src = readFileSync(join(REPO_SRC, 'exports/lmsFiling/form349.js'), 'utf8');
  assert.doesNotMatch(src, /§74\.1232\(e\)[^\n]*fill-in/i,
    'form349.js must not claim §74.1232(e) is the fill-in cite — fill-in lives in §74.1201(g)');
  assert.doesNotMatch(src, /§74\.1232\(d\)[^\n]*cross-service/i,
    'form349.js must not claim §74.1232(d) is the cross-service-for-AM-primary cite — that lives in §74.1231');
});

// ── PR-CITE2 F-007: peCertification.js header cites real authority ───

test('PR-CITE2 F-007 — peCertification.js header does not cite "§73.x"', () => {
  const src = readFileSync(join(REPO_SRC, 'engine/regulatory/peCertification.js'), 'utf8');
  assert.doesNotMatch(src, /§73\.x/,
    'peCertification.js must not cite the non-existent "§73.x" placeholder; PE authority is state PE registration boards + §73.1610 / §73.3539');
  assert.match(src, /§73\.1610/,
    'peCertification.js must name §73.1610 as part of the PE-stamp regulatory basis');
  assert.match(src, /§73\.3539/,
    'peCertification.js must name §73.3539 as part of the PE-stamp regulatory basis');
});

// ── PR-CITE2: §73.x placeholder cannot live in ANY *.js under engine/ or exports/ ─

test('PR-CITE2 — repository-wide: no rendered §73.x placeholder anywhere under engine/ or exports/', () => {
  // Belt + suspenders to the per-file F-002 tests above.  Walks every
  // .js / .mjs source file under src/engine/ and src/exports/, strips
  // comments, and fails if "§73.x" appears in any remaining string
  // literal.  (engine/regulatory/citations.js intentionally describes
  // every real rule by section number — but never as "§73.x"; the test
  // catches any reintroduction.)
  const repoRoot = join(REPO_SRC, '..');
  const out = execSync(
    "git ls-files -z 'src/engine/**/*.js' 'src/engine/**/*.mjs' 'src/exports/**/*.js' 'src/exports/**/*.mjs'",
    { cwd: repoRoot, encoding: 'utf8' }
  );
  const files = out.split('\0').filter(Boolean);
  assert.ok(files.length > 0, 'glob should match at least one engine/exports source file');
  const offenders = [];
  for (const rel of files){
    const src = readFileSync(join(repoRoot, rel), 'utf8');
    const stripped = src
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    if (stripped.includes('§73.x')) offenders.push(rel);
  }
  assert.equal(offenders.length, 0,
    `the literal "§73.x" appears in rendered text of: ${offenders.join(', ')}`);
});

// ── CFR-AUDIT (batches 88–92): nonexistent Part 73 sections stay dead ─

test('CFR-AUDIT — no source file cites a nonexistent/repealed §73.35xx section', () => {
  // These sections either never existed or were repealed and must not be
  // cited as live rules anywhere in the source tree:
  //   §73.3522 — does not exist (minor-mod processing is §73.3571(e))
  //   §73.3525 — does not exist (application fees: 47 U.S.C. §158 / FCC fee schedule)
  //   §73.3556 — removed 2020 (former program-duplication rule)
  //   §73.3561 — does not exist (no CFR rule sets FCC review timelines)
  //   §73.3562 — does not exist (COL change: §73.3533 + §73.3571)
  //   §73.3597 — does not exist (assignment processing: §73.3580/§73.3584/§73.3591)
  // Comments are stripped first so historical notes remain allowed.
  const BANNED = [/§73\.3522/, /§73\.3525/, /§73\.3556/, /§73\.3561/, /§73\.3562/, /§73\.3597/];
  const repoRoot = join(REPO_SRC, '..');
  const out = execSync(
    "git ls-files -z 'src/engine/**/*.js' 'src/exports/**/*.js' 'src/review/**/*.js' 'src/components/**/*.jsx' 'src/ui/*.jsx' 'src/data/**/*.json'",
    { cwd: repoRoot, encoding: 'utf8' }
  );
  const files = out.split('\0').filter(Boolean);
  assert.ok(files.length > 0, 'glob should match at least one source file');
  const offenders = [];
  for (const rel of files){
    const src = readFileSync(join(repoRoot, rel), 'utf8');
    const stripped = src
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of BANNED){
      if (re.test(stripped)) offenders.push(`${rel} (${re.source})`);
    }
  }
  assert.equal(offenders.length, 0,
    `nonexistent/repealed CFR sections cited in: ${offenders.join('; ')}`);
});

test('CFR-AUDIT — AM engine/UI never cite the FM application-processing rule §73.3573', () => {
  // §73.3573 is real but FM-only.  AM application processing is §73.3571.
  const repoRoot = join(REPO_SRC, '..');
  const out = execSync(
    "git ls-files -z 'src/engine/**/*.js' 'src/components/**/*.jsx'",
    { cwd: repoRoot, encoding: 'utf8' }
  );
  const files = out.split('\0').filter(Boolean).filter(rel =>
    rel.includes('src/engine/am/') || rel.includes('src/components/ui/SiteOptimizer/'));
  assert.ok(files.length > 0, 'glob should match at least one AM source file');
  const offenders = files.filter(rel =>
    /§73\.3573/.test(readFileSync(join(repoRoot, rel), 'utf8')));
  assert.equal(offenders.length, 0,
    `AM-context files cite FM rule §73.3573 (use §73.3571): ${offenders.join(', ')}`);
});

test('CFR-AUDIT — AM engine/UI DA pattern sections never cite FM-only §73.316 as the rule (only as clarifying FM note)', () => {
  // §73.316 is the FM transmitting antenna systems rule.  AM DA patterns are governed by §73.150.
  // AM engine/SiteOptimizer files may mention §73.316 ONLY in comments that explicitly
  // note "§73.316 is FM" — not as the operative cited rule in rule: '...' fields or
  // note/description strings that direct the user to file under §73.316.
  const repoRoot = join(REPO_SRC, '..');
  const out = execSync(
    "git ls-files -z 'src/engine/**/*.js' 'src/components/**/*.jsx'",
    { cwd: repoRoot, encoding: 'utf8' }
  );
  const files = out.split('\0').filter(Boolean).filter(rel =>
    rel.includes('src/engine/am/') || rel.includes('src/components/ui/SiteOptimizer/'));
  assert.ok(files.length > 0, 'glob should match at least one AM source file');
  // Allow §73.316 only when it is followed immediately by a phrase making clear it is FM-only
  // (e.g., "§73.316 is FM", "§73.316 (FM)", "not §73.316 which applies to FM").
  // Ban any occurrence that appears as the operative rule without such a qualifier.
  const FM_ONLY_QUALIFIER = /§73\.316\s*(is FM|governs FM|\(FM\)|not AM|applies to FM| — FM|\/§73\.150|which applies to FM)/;
  const BARE_316 = /§73\.316(?!\s*(is FM|governs FM|\(FM\)|not AM|applies to FM| — FM|\/§73\.150|which applies to FM))/;
  const offenders = files.filter(rel => {
    const src = readFileSync(join(repoRoot, rel), 'utf8');
    if (!BARE_316.test(src)) return false;
    // Check each line — allow comment lines that explain FM context
    const lines = src.split('\n');
    return lines.some((line, i) => {
      if (!BARE_316.test(line)) return false;
      // Permit comment lines that contain "§73.316 is FM / not AM" anywhere on the line
      if (/§73\.316.*(?:is FM|governs FM|\(FM\)|not AM|applies to FM|FM —|FM,|FM\/|\/§73\.150)/.test(line)) return false;
      if (/(?:is FM|governs FM|not AM|applies to FM|FM —|FM,|FM\/|§73\.316.*FM).*§73\.316/.test(line)) return false;
      return true;
    });
  });
  assert.equal(offenders.length, 0,
    `AM-context files cite FM DA rule §73.316 as operative rule (use §73.150): ${offenders.join(', ')}`);
});

test('CFR-AUDIT — AM engine/UI never cite FM-only §73.209 or §73.213 as operative AM channel rules', () => {
  // §73.209 = FM 2nd-adjacent channel protection rule (FM only)
  // §73.213 = FM 3rd-adjacent channel protection rule (FM only)
  // AM adjacent-channel D/U requirements are in §73.182(r) / §73.37(a).
  // These sections may appear only in comments explicitly noting "is FM" / "not AM".
  const repoRoot = join(REPO_SRC, '..');
  const out = execSync(
    "git ls-files -z 'src/engine/**/*.js' 'src/components/**/*.jsx'",
    { cwd: repoRoot, encoding: 'utf8' }
  );
  const files = out.split('\0').filter(Boolean).filter(rel =>
    rel.includes('src/engine/am/') || rel.includes('src/components/ui/SiteOptimizer/'));
  assert.ok(files.length > 0, 'glob should match at least one AM source file');
  const BARE_FM_ADJ = /§73\.(209|213)(?!.*(?:is FM|FM 2nd|FM 3rd|\(FM\)|not AM|applies to FM|FM —|FM rule))/;
  const offenders = files.filter(rel => {
    const src = readFileSync(join(repoRoot, rel), 'utf8');
    if (!BARE_FM_ADJ.test(src)) return false;
    const lines = src.split('\n');
    return lines.some(line => {
      if (!BARE_FM_ADJ.test(line)) return false;
      // Allow lines that explicitly state FM-only context
      if (/§73\.(209|213).*(?:is FM|FM 2nd|FM 3rd|\(FM\)|not AM|applies to FM|FM —|FM rule)/.test(line)) return false;
      if (/(?:is FM|FM 2nd|FM 3rd|not AM|applies to FM).*§73\.(209|213)/.test(line)) return false;
      return true;
    });
  });
  assert.equal(offenders.length, 0,
    `AM-context files cite FM channel rules §73.209/§73.213 as operative AM rules (use §73.182(r)/§73.37): ${offenders.join(', ')}`);
});

// ── CFR-AUDIT: §73.24(i) vs §73.24j label drift ─────────────────────

test('CFR-AUDIT — AM engine/UI never use the bare shorthand "§73.24j" (should be §73.24(i))', () => {
  // The rule for AM principal community coverage is §73.24(i).
  // §73.24(j) is the general public-interest standard (not the coverage rule).
  // The file section_73_24j.js is a legacy-named file that IMPLEMENTS §73.24(i).
  // Any label/note/cite string using the bare "§73.24j" form (without the
  // parenthesized (i)) is a citation error.  Allow only the legacy filename
  // reference in comments.
  const repoRoot = join(REPO_SRC, '..');
  const out = execSync(
    "git ls-files -z 'src/engine/**/*.js' 'src/components/**/*.jsx'",
    { cwd: repoRoot, encoding: 'utf8' }
  );
  const files = out.split('\0').filter(Boolean).filter(rel =>
    rel.includes('src/engine/am/') || rel.includes('src/components/ui/SiteOptimizer/'));
  assert.ok(files.length > 0, 'glob should match at least one AM source file');
  // Ban §73.24j in rendered strings; allow only in comments that reference the legacy filename
  const BARE_24J = /§73\.24j/;
  const offenders = files.filter(rel => {
    const src = readFileSync(join(repoRoot, rel), 'utf8');
    if (!BARE_24J.test(src)) return false;
    const lines = src.split('\n');
    return lines.some(line => {
      if (!BARE_24J.test(line)) return false;
      // Allow comment lines that reference the legacy file / legacy label
      if (/^\s*\/\//.test(line) && /legacy|section_73_24j|file.name|filename/.test(line)) return false;
      return true;
    });
  });
  assert.equal(offenders.length, 0,
    `AM-context files use bare "§73.24j" shorthand (use §73.24(i)): ${offenders.join(', ')}`);
});

test('CFR-AUDIT — AM engine/UI never use the bare shorthand "§73.24g" (should be §73.24(g))', () => {
  // §73.24(g) is the blanketing interference rule.  The bare shorthand §73.24g
  // (without parentheses) omits the paragraph marker and could be confused with
  // the subsection letter.  All rendered citations must use the parenthesized form.
  const repoRoot = join(REPO_SRC, '..');
  const out = execSync(
    "git ls-files -z 'src/engine/**/*.js' 'src/components/**/*.jsx'",
    { cwd: repoRoot, encoding: 'utf8' }
  );
  const files = out.split('\0').filter(Boolean).filter(rel =>
    rel.includes('src/engine/am/') || rel.includes('src/components/ui/SiteOptimizer/'));
  assert.ok(files.length > 0, 'glob should match at least one AM source file');
  const BARE_24G = /§73\.24g/;
  const offenders = files.filter(rel => {
    const src = readFileSync(join(repoRoot, rel), 'utf8');
    if (!BARE_24G.test(src)) return false;
    const lines = src.split('\n');
    return lines.some(line => {
      if (!BARE_24G.test(line)) return false;
      if (/^\s*\/\//.test(line) && /legacy|section_73_24g|file.name|filename/.test(line)) return false;
      return true;
    });
  });
  assert.equal(offenders.length, 0,
    `AM-context files use bare "§73.24g" shorthand (use §73.24(g)): ${offenders.join(', ')}`);
});
