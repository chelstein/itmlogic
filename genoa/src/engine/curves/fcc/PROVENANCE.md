# Vendored FCC source — provenance

## What's vendored

| File | Role |
|---|---|
| `tvfm_curves.js` | FM/TV propagation curves (F(50,50), F(50,10), F(50,90)) — `geo.fcc.gov/api/contours/distance.json` engine. |
| `gwave.js` | AM groundwave per 47 CFR §73.184 — Sommerfeld-Norton attenuation. Backs `geo.fcc.gov/api/contours/amField.json` and `amDistance.json`. |
| `data/gwave_field.json` | FCC pre-tabulated AM field strengths (120 frequencies × 8 conductivity values × 230 distances). |

## Upstream

- Repository: <https://github.com/fcc/contours-api-node>
- Commit:     `b55870d3f20618e886cd02379008ef980229d44b` (master tip at vendor time)
- Vendored:   2026-05-04

| Vendored file | Upstream path | Upstream sha256 | Modifications |
|---|---|---|---|
| `tvfm_curves.js` | `controllers/tvfm_curves.js` | `58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a` | none (byte-identical) |
| `gwave.js` | `controllers/gwave.js` | `0ba81eca1bda166e36d34906dfdbc72c730a976d91a3356c12b1ccde2a8b059f` | **one line**: `'../data/gwave_field.json'` → `'./data/gwave_field.json'` (line 10) |
| `data/gwave_field.json` | `data/gwave_field.json` | `81e90fd493d2ef1be46ab71096d647fca45d51b2b0ca1a8306f20e390780412e` | none (byte-identical) |

The single line changed in `gwave.js` is the relative `require()` path
to the data file.  Upstream layout has `controllers/gwave.js` and
`data/gwave_field.json` two levels apart; Genoa keeps the data file
co-located inside the vendor directory so all FCC code is in one
tree.  No other content of the FCC source is touched; the change is
marked inline at the affected line with `// [Genoa vendor]`.

## License

The FCC is a US Government agency.  Works produced by US Government
employees in the course of their official duties are not subject to
copyright protection in the United States (17 U.S.C. § 105) and are
in the public domain.  The repository at <https://github.com/fcc> has
no explicit LICENSE file at vendor time, but the federal-work-product
status applies regardless.

Genoa vendors the code under that public-domain status with explicit
attribution back to the FCC source above.

## Why vendored vs. called as a sidecar

Genoa's engine is required to be deterministic and offline at compute
time (no network calls during `compute()`).  Calling
`geo.fcc.gov/api/contours/...` on every compute would violate that
invariant and add a hard dependency on a third-party service that can
rate-limit or go down.  Vendoring locally preserves the engine
contract while making Genoa's deterministic output FCC-canonical.

## Why no modifications

- **Trust** — byte-identical vendors match FCC's published hashes;
  reviewers can verify via `sha256sum`.
- **Safety** — no porting bugs in a 1727-line bivariate cubic
  interpolator (FM) or 1847-line Sommerfeld-Norton routine (AM).
- **Auditability** — future bumps are a single re-vendor step against
  the upstream commit with fresh sha256s.

## Layout vs. upstream require paths

The FCC `controllers/gwave.js` does:

```js
var gwave_field = require('../data/gwave_field.json');
```

That path resolves relative to the vendored file location.  In Genoa's
layout the file lives at `src/engine/curves/fcc/gwave.js`, which would
resolve `../data/gwave_field.json` to `src/engine/curves/data/...`
(outside the vendor boundary).  To keep `gwave.js` byte-identical, the
ESM adapter at `index.mjs` **pre-injects** the JSON into Node's
`require.cache` under that resolved path *before* loading `gwave.js`.
Result: the require resolves cleanly to the same data object that the
adapter loaded directly.

This is documented inline in `index.mjs` and is the only "non-trivial"
plumbing between Genoa and the vendored FCC code.

## Runtime dependencies

Both vendored FCC files require `mathjs` (FM uses `mathjs.round` only;
AM uses `mathjs.complex`, `mathjs.add`, `mathjs.multiply`, etc. —
extensive complex-arithmetic in the Sommerfeld-Norton evaluation).
Genoa already carries `mathjs` as a runtime dependency for the FM
adapter; AM uses the same install.

## Adapter

The ESM adapter at `index.mjs` exposes a clean Genoa-shaped surface
without leaking the FCC code's internal calling conventions:

```
fccDistanceKm({ haat_m, target_dBu, erp_kw, mode, frequency_mhz })
  → { distance_km, source, method, channel, flags, upstream }   // FM

fccAmDistanceKm({ frequency_khz, target_mvm, conductivity_msm,
                  dielectric, erp_kw })
  → { distance_km, source, method, upstream }                  // AM
```

Engine modules import only the adapter.
