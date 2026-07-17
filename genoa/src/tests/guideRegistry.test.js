// Guide-registry structural guarantees.
//
// Two invariants, proven directly (not just asserted by comment):
//   1. buildGuideRegistry() rejects duplicate guide keys and keys that
//      collide with a reserved canonical-authoritative field name — the
//      exact mechanism that made the original "duplicate comparison-table
//      keys silently clobber each other" defect possible.
//   2. The REAL registry (guides/index.js, imported for production) is
//      itself free of duplicates and reserved-name collisions right now.
//
// See src/tests/canonicalContract.test.js for the companion static check
// that the ~262 still-inline guide IIFEs in siteOptimizer.js (not yet
// migrated into this registry) also don't collide with reserved names.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuideRegistry } from '../engine/am/guides/index.js';
import { GUIDE_BUILDERS, GUIDE_KEYS } from '../engine/am/guides/index.js';
import { RESERVED_CANONICAL_FIELD_NAMES } from '../engine/am/canonical/reservedFieldNames.js';

function fakeModule(key, build = () => ({})) {
  return { key, build };
}

/* ── buildGuideRegistry() rejection behavior ─────────────────────────── */

test('buildGuideRegistry: accepts a list of unique, well-formed modules', () => {
  const { GUIDE_KEYS: keys } = buildGuideRegistry([
    fakeModule('guide_a'),
    fakeModule('guide_b'),
  ]);
  assert.deepEqual([...keys].sort(), ['guide_a', 'guide_b']);
});

test('buildGuideRegistry: THROWS on duplicate guide keys', () => {
  assert.throws(
    () => buildGuideRegistry([fakeModule('same_key'), fakeModule('same_key')]),
    /duplicate guide key registered: same_key/,
    'two modules claiming the same key must be rejected, not silently last-wins'
  );
});

test('buildGuideRegistry: THROWS on a module missing a string `key` export', () => {
  assert.throws(() => buildGuideRegistry([{ build: () => ({}) }]), /missing string export `key`/);
  assert.throws(() => buildGuideRegistry([{ key: '', build: () => ({}) }]), /missing string export `key`/);
  assert.throws(() => buildGuideRegistry([{ key: 42, build: () => ({}) }]), /missing string export `key`/);
});

test('buildGuideRegistry: THROWS on a module missing a function `build` export', () => {
  assert.throws(() => buildGuideRegistry([{ key: 'x' }]), /missing function export `build`/);
  assert.throws(() => buildGuideRegistry([{ key: 'x', build: 'not a function' }]), /missing function export `build`/);
});

test('buildGuideRegistry: THROWS when a guide key collides with a reserved canonical field name', () => {
  for (const reserved of RESERVED_CANONICAL_FIELD_NAMES) {
    assert.throws(
      () => buildGuideRegistry([fakeModule(reserved)]),
      /collides with a reserved canonical authoritative field name/,
      `guide key "${reserved}" must be rejected — it shadows a canonical-authoritative field`
    );
  }
});

test('buildGuideRegistry: a custom reservedNames set can be supplied (used by callers that need a narrower/wider check)', () => {
  assert.throws(
    () => buildGuideRegistry([fakeModule('custom_reserved')], new Set(['custom_reserved'])),
    /collides with a reserved canonical authoritative field name/
  );
  // Same key is fine against the DEFAULT reserved set (not actually reserved there).
  assert.doesNotThrow(() => buildGuideRegistry([fakeModule('custom_reserved')]));
});

/* ── the REAL production registry is clean right now ─────────────────── */

test('production registry: guides/index.js has no duplicate keys', () => {
  const seen = new Set();
  for (const k of GUIDE_KEYS) {
    assert.ok(!seen.has(k), `duplicate guide key in production registry: ${k}`);
    seen.add(k);
  }
  assert.equal(GUIDE_KEYS.length, Object.keys(GUIDE_BUILDERS).length);
});

test('production registry: no registered guide key collides with a reserved canonical field name', () => {
  for (const k of GUIDE_KEYS) {
    assert.ok(!RESERVED_CANONICAL_FIELD_NAMES.has(k),
      `registered guide key "${k}" collides with a reserved canonical field name`);
  }
});

test('production registry: every registered builder is callable and returns an object', () => {
  // Minimal gctx covering the fields the three current guide modules read.
  const gctx = {
    pt: { distance_from_current_km: 12 },
    pattern_mode: 'NDA', tpo_kw: 5, land_use_class: 'RURAL',
    frequency_khz: 780, sigma_msm: 8, fcc_class: 'D',
  };
  for (const key of GUIDE_KEYS) {
    const out = GUIDE_BUILDERS[key](gctx);
    assert.equal(typeof out, 'object', `${key} build() must return an object`);
    assert.ok(out !== null, `${key} build() must not return null`);
  }
});
