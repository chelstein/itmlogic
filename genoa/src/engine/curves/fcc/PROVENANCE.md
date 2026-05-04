# Vendored FCC source — provenance

## What's vendored

`tvfm_curves.js` — the FCC's official FM/TV propagation-curve module
(F(50,50), F(50,10), F(50,90)) used by `geo.fcc.gov/api/contours/`.

## Upstream

- Repository: https://github.com/fcc/contours-api-node
- Path:       `controllers/tvfm_curves.js`
- Commit:     `b55870d3f20618e886cd02379008ef980229d44b` (master tip at vendor time)
- Vendored:   2026-05-04

## Integrity

- File:           `tvfm_curves.js`
- sha256:         `58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a`
- Modifications:  **none** (byte-identical with upstream).  Genoa loads
  this file via `createRequire` from the ESM adapter at `index.mjs`;
  the directory carries a sub-`package.json` declaring
  `"type":"commonjs"` so Node treats `tvfm_curves.js` as CJS even
  though Genoa's root package.json is ESM.

## License

The FCC is a US Government agency.  Works produced by US Government
employees in the course of their official duties are not subject to
copyright protection in the United States (17 U.S.C. § 105) and are
in the public domain.  The repository at github.com/fcc has no
explicit LICENSE file at vendor time, but the federal-work-product
status applies regardless.

Genoa vendors the code under that public-domain status with explicit
attribution back to the FCC source above.

## Why vendored vs. called as a sidecar

Genoa's engine is required to be deterministic and offline at compute
time (no network calls during `compute()`).  Calling
`geo.fcc.gov/api/contours/distance.json` on every compute would
violate that invariant and add a hard dependency on a third-party
service that can rate-limit or go down.  Vendoring the same code
locally preserves the engine's contract while making Genoa's
deterministic output FCC-canonical.

## Why no modifications

- Trust:        a byte-identical vendor matches the FCC's published
                hash; reviewers can verify via `sha256sum`.
- Safety:       no chance of introducing porting bugs in a 1727-line
                bivariate cubic interpolator.
- Auditability: future bumps are a single re-vendor step against the
                upstream commit, with a fresh sha256.

## Runtime dependency

The vendored file `require()`s `mathjs` (only for `mathjs.round`).
Genoa carries `mathjs` as a runtime dependency in
`genoa/package.json`.  An alternative — patching the FCC file to drop
mathjs — was considered and rejected to preserve byte-fidelity.

## Adapter

The ESM adapter at `index.mjs` exposes a clean Genoa-shaped surface
(`fccDistanceKm({ haat_m, target_dBu, erp_kw, mode, channel })`)
without exposing the FCC code's internal calling convention to the
rest of the engine.  Engine modules import only the adapter.
