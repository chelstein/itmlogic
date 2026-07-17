# siteOptimizer guide modules

Incremental decomposition of the ~265 guide IIFEs inside
`scoreCandidate()` (src/engine/am/siteOptimizer.js) into one module per
guide.  Motivation (2026 audit): a 34k-line single scope made per-guide
review intractable, allowed duplicate comparison-table keys to silently
clobber each other, and let the same regulatory fact be re-declared per
guide.

## Pattern

Each guide module exports:

```js
export const key = 'am_x_guide';          // the exhibit field name
export function build(gctx){ ... }        // pure; returns the guide object
```

- `gctx` is the **guide context** assembled once per candidate in
  `scoreCandidate()`: `{ pt, tpo_kw, fcc_class, frequency_khz,
  pattern_mode, sigma_msm, land_use_class, ... }` — extend it only with
  values that already exist in `scoreCandidate` scope; never compute new
  physics inside the context.
- Regulatory numbers come from `../../regulatory/regulatoryConstants.js`
  imports inside the guide module — never from `gctx`, never re-declared.
- `build()` must be pure (no I/O, no Date.now) and must return exactly
  the object the inline IIFE returned — migration is behavior-neutral
  and is proven by the full amSiteOptimizer suite (1,893 tests) staying
  green.

## Registry

`index.js` builds `GUIDE_BUILDERS`/`GUIDE_KEYS` via the exported
`buildGuideRegistry(modules, reservedNames?)`, which throws at import
time if:
- two modules claim the same key (the duplicate-key clobbering class
  from the audit), or
- a module's key collides with a **reserved canonical-authoritative
  field name** (`../canonical/reservedFieldNames.js`) — a guide may
  never claim a key that reads from `candidate.canonical.*`
  (`canonical`, `nif_status`, `nif_required`, `nif_completion`,
  `nif_result`, and the response-level `optimization_confidence` /
  `candidate_set_recommendation`).

`buildGuideRegistry()` is unit-tested directly in
`src/tests/guideRegistry.test.js` (duplicate-key rejection,
reserved-name rejection, malformed-module rejection), separate from the
production call in `index.js`.

Guides not yet migrated into this registry (still inline IIFEs in
`scoreCandidate()`) are covered by a **different, static** guarantee:
`src/tests/canonicalContract.test.js` parses `siteOptimizer.js`'s actual
source AST and proves the same two invariants (no duplicate top-level
keys, no reserved-name collisions) across the return object's ~262+
keys as they exist in source — this holds regardless of migration
progress, so the "no guide may override a canonical field" guarantee
does not wait on the full migration to be true.

## Migration recipe (per tranche)

1. Copy the IIFE body verbatim into a new module; convert closed-over
   scope variables to `gctx` destructuring; convert regulatory literals
   to catalog imports (they should already be catalog reads).
2. Register the module in `index.js`.
3. In `scoreCandidate()`, replace the inline IIFE with
   `key: GUIDE_BUILDERS[key](gctx)` (explicit call keeps object-literal
   ordering and readability).
4. Gates: citation hygiene, `guideRegistry.test.js`,
   `canonicalContract.test.js`, then the guide's targeted tests, then
   the full suite before commit.
