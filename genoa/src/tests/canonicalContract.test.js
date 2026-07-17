// Canonical-authority contract test.
//
// Proves, by parsing the REAL source of scoreCandidate()'s return
// statement (not by trusting a comment or a hand-maintained list), that:
//   1. No two top-level keys in the return object collide with each other
//      — this is the general form of the original "duplicate
//      comparison-table keys silently clobber each other" defect,
//      covering ALL ~262+ top-level keys (the ~262 still-inline guide
//      IIFEs plus every true field), not just the ones already migrated
//      to the guides/ registry.
//   2. No top-level key collides with a RESERVED_CANONICAL_FIELD_NAME —
//      i.e. no guide (registered or still-inline) can ever silently
//      overwrite a field that reads from candidate.canonical.
//
// This is a STATIC, source-level guarantee: it holds regardless of how
// many of the ~262 inline guides get migrated into guides/index.js next,
// and regardless of what any individual guide computes internally for
// its OWN sub-object (a guide is free to model its own NIF/tower-height/
// proof numbers inside its own namespaced key — e.g.
// some_guide.nif_required — that is not a contradiction the canonical
// pipeline needs to police; the contradiction it must prevent is a guide
// key literally overwriting a TOP-LEVEL canonical-sourced field, which
// this test proves is impossible by construction).
//
// Companion: src/tests/guideRegistry.test.js proves the same invariant
// dynamically for buildGuideRegistry() (the path registered guide
// modules go through).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';
import { RESERVED_CANONICAL_FIELD_NAMES } from '../engine/am/canonical/reservedFieldNames.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_OPTIMIZER_PATH = join(__dirname, '../engine/am/siteOptimizer.js');

/**
 * Minimal recursive AST walker — visits every node reachable from `node`,
 * calling `visit(node)` for each. Generic over node shape (iterates own
 * enumerable properties looking for nested nodes/arrays-of-nodes), so it
 * doesn't need a type-specific visitor table and can't silently skip an
 * unfamiliar node type introduced by a future syntax feature.
 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'parent') continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) walk(item, visit);
    } else if (val && typeof val === 'object' && typeof val.type === 'string') {
      walk(val, visit);
    }
  }
}

/**
 * Find the `scoreCandidate` function declaration, then find the return
 * statement inside it whose argument is the MAIN return object (the one
 * with the most top-level properties — the early-exit/error-path returns
 * inside scoreCandidate, if any, have few properties and are not the
 * candidate we care about; the main return also uniquely contains a
 * property literally named "canonical", used as a cross-check).
 *
 * @returns {{ keys: string[], propertyCount: number }}
 */
function extractScoreCandidateReturnKeys(source) {
  const ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true });

  let scoreCandidateFn = null;
  walk(ast, (node) => {
    if (scoreCandidateFn) return;
    if (
      (node.type === 'FunctionDeclaration') &&
      node.id && node.id.name === 'scoreCandidate'
    ) {
      scoreCandidateFn = node;
    }
  });
  assert.ok(scoreCandidateFn, 'scoreCandidate function declaration not found in siteOptimizer.js — has it been renamed or restructured?');

  const candidateObjects = [];
  walk(scoreCandidateFn, (node) => {
    if (node.type === 'ReturnStatement' && node.argument && node.argument.type === 'ObjectExpression') {
      candidateObjects.push(node.argument);
    }
  });
  assert.ok(candidateObjects.length > 0, 'no `return { ... }` object literal found inside scoreCandidate()');

  // The main return object: the one with a literal `canonical` key (unique
  // marker) — falls back to the largest object if that marker is absent
  // (fails loudly below rather than silently picking the wrong object).
  const withCanonicalKey = candidateObjects.filter((obj) =>
    obj.properties.some((p) => p.type === 'Property' && !p.computed &&
      (p.key.type === 'Identifier' ? p.key.name : p.key.value) === 'canonical')
  );
  const mainReturn = withCanonicalKey.length === 1
    ? withCanonicalKey[0]
    : candidateObjects.reduce((a, b) => (b.properties.length > a.properties.length ? b : a));

  assert.ok(mainReturn.properties.length > 100,
    `scoreCandidate()'s main return object has only ${mainReturn.properties.length} top-level properties — ` +
    'expected 100+ (the ~262 guide keys plus true fields). The extraction likely picked the wrong return ' +
    'statement, or the function has been substantially restructured; update this test\'s selection logic.');

  const keys = [];
  for (const prop of mainReturn.properties) {
    if (prop.type === 'SpreadElement') {
      // A top-level spread (...something) can inject arbitrary keys we
      // can't statically resolve — that is itself a risk (it bypasses this
      // very check), so fail loudly rather than silently ignore it.
      assert.fail(
        `scoreCandidate()'s return object contains a top-level spread element at line ${prop.loc.start.line} — ` +
        'this bypasses the static duplicate-key / reserved-name contract check. Replace it with explicit keys, ' +
        'or extend this test to resolve the spread source statically.'
      );
    }
    assert.equal(prop.type, 'Property', `unexpected top-level node type "${prop.type}" in scoreCandidate()'s return object at line ${prop.loc?.start?.line}`);
    const keyName = prop.computed
      ? null // a computed key (`[expr]: value`) can't be resolved statically
      : (prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value));
    assert.ok(keyName !== null,
      `scoreCandidate()'s return object contains a computed key at line ${prop.loc.start.line} — ` +
      'this bypasses the static contract check. Use a literal key name.'
    );
    keys.push(keyName);
  }
  return { keys, propertyCount: mainReturn.properties.length };
}

/* ── the contract ─────────────────────────────────────────────────────── */

let extraction;
test('setup: parse siteOptimizer.js and extract scoreCandidate() return keys', () => {
  const source = readFileSync(SITE_OPTIMIZER_PATH, 'utf8');
  extraction = extractScoreCandidateReturnKeys(source);
  assert.ok(extraction.keys.length > 100, `expected 100+ top-level keys, got ${extraction.keys.length}`);
});

test('CONTRACT: no two top-level keys in scoreCandidate()\'s return object collide', () => {
  const seen = new Map(); // key -> first-seen index
  const duplicates = [];
  extraction.keys.forEach((k, i) => {
    if (seen.has(k)) duplicates.push({ key: k, firstIndex: seen.get(k), duplicateIndex: i });
    else seen.set(k, i);
  });
  assert.deepEqual(duplicates, [],
    `duplicate top-level key(s) in scoreCandidate()'s return object — this is exactly the mechanism that ` +
    `let one guide's contribution silently clobber another's (the original candidate_comparison_table defect): ` +
    `${duplicates.map((d) => d.key).join(', ')}`
  );
});

test('CONTRACT: no top-level key collides with a reserved canonical-authoritative field name', () => {
  // Every key that IS one of the reserved names is expected to be exactly
  // the wiring code's own assignment (canonical, nif_status, nif_required,
  // nif_completion, nif_result) — verify there's exactly ONE occurrence of
  // each reserved name that appears (already proven by the no-duplicates
  // test above), and that every OTHER key in the file is not attempting to
  // also claim that name. Since the no-duplicates test already guarantees
  // uniqueness, this test's job is narrower: confirm the set of reserved
  // names actually PRESENT in the return object is exactly the expected
  // wiring set, and nothing else in RESERVED_CANONICAL_FIELD_NAMES sneaks
  // in from an unexpected (guide) source under a plausible alias.
  const keySet = new Set(extraction.keys);
  const presentReserved = [...RESERVED_CANONICAL_FIELD_NAMES].filter((r) => keySet.has(r));
  // These are expected to be present (the wiring code's own fields).
  // Anything reserved that is present MUST be exactly one of these —
  // response-level names (optimization_confidence, candidate_set_recommendation)
  // must NOT appear as per-candidate keys at all.
  const EXPECTED_PRESENT_PER_CANDIDATE = new Set([
    'canonical', 'nif_status', 'nif_required', 'nif_completion', 'nif_result',
  ]);
  for (const r of presentReserved) {
    assert.ok(EXPECTED_PRESENT_PER_CANDIDATE.has(r),
      `reserved name "${r}" appears as a top-level key in scoreCandidate()'s return object but is not one of ` +
      `the expected wiring fields — a response-level-only reserved name must never appear per-candidate, and ` +
      `no guide may claim it.`
    );
  }
  // And confirm the expected ones ARE present (protects against the wiring
  // itself silently regressing — e.g. someone renames `canonical` back out).
  for (const expected of EXPECTED_PRESENT_PER_CANDIDATE) {
    assert.ok(keySet.has(expected), `expected wiring field "${expected}" is missing from scoreCandidate()'s return object`);
  }
});

test('CONTRACT: every non-reserved top-level key follows the guide-name convention or is a known field (no silent new authority surface)', () => {
  // Soft guard, not a hard fail: report (via console, not assert.fail) any
  // top-level key that is neither a reserved canonical field, nor ends in
  // "_guide" (the established convention for the ~262 inline + 3 migrated
  // guide entries), nor is in the small known-fields allowlist below. This
  // surfaces drift for a human to review without blocking the suite on
  // every new well-named field the optimizer legitimately adds.
  const KNOWN_NON_GUIDE_FIELDS = new Set([
    'id', 'candidate_type', 'lat', 'lon', 'distance_from_current_km', 'bearing_deg',
    'cardinal_direction', 'score', 'candidate_narrative_summary', 'signal_propagation_profile',
    'col_coverage_pct', 'principal_community_5mvm_km', 'daytime_reach_km',
    'estimated_daytime_population_served', 'population_reach_bands', 'land_use_classification',
    'blanket_population_pct', 'blanket_pop_risk', 'regulatory_compliance_summary',
    'groundwave_contour_table', 'field_strength_profile', 'tpo_to_coverage_table',
    'treaty_zone',
  ]);
  const unclassified = extraction.keys.filter((k) =>
    !RESERVED_CANONICAL_FIELD_NAMES.has(k) &&
    !KNOWN_NON_GUIDE_FIELDS.has(k) &&
    !k.endsWith('_guide') &&
    !k.endsWith('_summary') && !k.endsWith('_profile') && !k.endsWith('_table') &&
    !k.endsWith('_analysis') && !k.endsWith('_estimate') && !k.endsWith('_checklist') &&
    !k.endsWith('_assessment') && !k.endsWith('_matrix') && !k.endsWith('_advisory') &&
    !k.endsWith('_reference') && !k.endsWith('_pathway') && !k.endsWith('_timeline') &&
    !k.endsWith('_recommendation') && !k.endsWith('_score') && !k.endsWith('_context')
  );
  // Informational only — does not fail the suite; the point is visibility,
  // not blocking legitimate new fields that don't happen to match a suffix.
  if (unclassified.length > 0) {
    console.log(`[canonicalContract] ${unclassified.length} top-level key(s) outside the known naming conventions (review, not necessarily a defect): ${unclassified.join(', ')}`);
  }
  assert.ok(true);
});
