# Cost model — one composable component set, one total

Module: `src/engine/am/canonical/costModel.js`, entry point
`buildCostModel()`. All figures are screening-grade
(`confidence: 'SCREENING'`) in `COST_BASE_YEAR = '2026'` dollars.

## The composable component model

Eleven components, in order of construction: `landAndLease`, `tower`,
`groundSystem`, `transmitterBuilding`, `transmitterAndATU`,
`electricalAndGenerator`, `siteAccessAndUtilities`, `engineering`,
`legalAndFiling`, `environmental`, `contingency` (last — 15%/25%
(`CONTINGENCY_LOW_FRACTION`/`CONTINGENCY_HIGH_FRACTION`) of the
pre-contingency subtotal).

Each component record (built by the internal `component()` helper, frozen)
carries:

- `lowUsd` / `highUsd` — the range, with `low`/`high` aliases consumed by
  validation invariant *c*;
- `baseYear` — always `COST_BASE_YEAR`;
- `quantityBasis` — a human-readable derivation string naming the actual
  quantities and unit prices used (e.g. tons of steel × $/ton, radial feet
  × $/ft);
- `scenario` — which pricing branch applied (`GUYED`/`SELF_SUPPORT`,
  `RURAL`/`SUBURBAN`/`URBAN`, `DA`/`NDA`, ground scenario key, or `BASE`);
- `source` — `'canonical/costModel'`;
- optional `inputs` — provenance-carrying echoes of load-bearing inputs
  (`tower.inputs.towerHeightM`, `groundSystem.inputs.radialCount`).

The parametric bases are the same ones the legacy pro-forma guide used
(tower $/ton, radial wire $/ft, $/kW transmitter tiers, $/sqft building),
but parameterized **exclusively** on the canonical
`antennaDesign.selectedDesignHeightM` and the canonical
`groundSystem.selectedScenario` — never on locally re-derived heights or
radial counts.

## Exact-sum invariant (validation c)

`costs.total` (`{low, high, lowUsd, highUsd}`) is computed as the exact
sum of `components[]` bounds. `validateCandidateResult()` invariant
`c:cost-total-vs-component-sum` (`src/engine/am/canonical/validation.js`)
flags any divergence greater than $0.01. Related invariants: *d* — the
tower line was priced on exactly `antenna.selectedDesignHeightM`; *e* —
the ground-system line was priced on exactly
`groundSystem.selectedScenario.radialCount`.

## Named subtotals — and the one name rule

`costs.subtotals` provides exactly four named slices, each listing its
`componentKeys`:

| Subtotal | Components |
|---|---|
| `constructionOnly` | tower, groundSystem, transmitterBuilding, transmitterAndATU, electricalAndGenerator, siteAccessAndUtilities |
| `softCostsOnly` | engineering, legalAndFiling, environmental |
| `antennaSystemOnly` | tower, groundSystem, transmitterAndATU |
| `totalProjectCapital` | all eleven |

Rule: **nothing other than `costs.total` / `totalProjectCapital` may be
presented as "total project cost".** Partial slices must be rendered under
their subtotal names. UI rendering of screening-grade ranges should go
through `costRangeString()` (`formatters.js`), which coarsens to
`'$540K–$990K'`-style figures.

## Fee lines come from the catalog

The `legalAndFiling` component imports FCC fees from
`src/engine/regulatory/regulatoryConstants.js` — `APPLICATION_FEES_1104.am`
(Form 301-AM major-change CP $4,675, license to cover $755, DA exhibit
$1,480 when directional) and `ASR_FORM_854_FEE` ($0 — the current §1.1102
schedule has no ASR row). They are never re-declared locally, and the
`quantityBasis` string cites `47 CFR §1.1104` / `90 FR 17013`. The FAA
lighting/painting add-on in the `tower` component trips on
`ASR_THRESHOLD_17_7.height_m`, the same constant the ASR rule reads.

## What it replaces

Origins §11 (`docs/architecture-contradiction-origins.md`): five guides
each published a "grand/project total" with different component sets
(11-item dynamic / 17-item static that ignored inputs / 9-category
no-land / 7-item 90-radial / 10-item with land+EAS), the drawer rendered
three of them as headline totals, and the recommendation engine's cost
tier read a sixth (soft+hard only). Here there is one component list, one
exact-sum total, and named subtotals for every legitimate partial view.
