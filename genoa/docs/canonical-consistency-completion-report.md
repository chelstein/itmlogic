# Canonical Consistency Audit — Follow-up Completion Report

**Branch:** `canonical-consistency-audit-followup`
**Scope:** TOP-LEVEL category-5 duplicate fields identified by four read-only
audit passes over `src/engine/am/siteOptimizer.js`,
`src/engine/am/colocationOpportunities.js`, and the SiteOptimizer UI
components (Phase 1), plus a Phase 2 extension request adding explicit
scenario/antenna-design typing and a four-boundary RF-exposure model to
the canonical pipeline. Guide-internal (namespaced sub-object) duplicates
remain explicitly out of scope — see "What was NOT fixed" below.

**Final commit on this branch (through Phase 2):** `7032583`.

Commits in this effort, in order:
```
a2b0724  feat: guide-registry structural guarantees + static canonical contract test
1627296  wip: rewire siteOptimizer/colocationOpportunities top-level fields to canonical (partial)
860c280  wip: rewire filing-autofill UI + remaining comparison-table/cost columns to canonical
0dd742d  test: update comparison-table assertions for collapsed duplicate columns
ace3613  canonical-consistency-audit-followup: finish Group 4 cost rewiring + add reconciliation proofs
df5d47e  docs: add canonical-consistency-audit-followup completion report (draft)
684810a  Phase 2 item 1: rewire remaining NIF-derivation functions to canonical.regulatory.nif
2940ef2  Phase 2 item 2: add canonical.scenario (OperatingScenario/AntennaDesign labeling)
7032583  Phase 2 item 3: RF exposure evaluationMethod + expose all 4 boundaries to consumers
```

## Phase 2 addendum (post-Phase-1 extension)

A larger follow-up spec arrived requesting the canonical pipeline be
extended toward a more detailed TypeScript-shaped model (CandidateAnalysis,
OperatingScenario/AntennaDesign union types, a 4-tier RF exposure model,
ranking diagnostics, typed ground-system alternatives, a cost/schedule
dependency graph, a developer truth panel, LLM narrative guardrails).
Phase 2 scoped the three highest-priority, highest-real-world-risk items
from that spec; the rest (ranking diagnostics/tie-grouping, ground-system
alternatives typing, schedule dependency graph, developer truth panel,
narrative guardrails) is explicitly deferred to a later phase, not
attempted here.

**Phase 2 item 1 — finished the remaining Group 3 NIF-derivation items**
(commit `684810a`). `buildProtectionAdvisory()`, `buildProtectionRequirements()`,
`buildRegulatoryTimeline()`, and `buildForm301Checklist()` all
independently re-derived "is NIF required" from `channel_class`
(`!isLocal`/`isLocal`) instead of `canonical.regulatory.nif`. This exposed
a genuine, previously-shipping correctness bug, not just a duplication:
the §73.182(o) local-channel NIF exemption applies **only to Class C**
stations — a Class A/B/D station on a local channel has always required
NIF, and these four functions silently said the opposite for every
local-channel station regardless of class. All four now accept the
station-level canonical NIF decision and gate on `nif.required`.
`buildForm301Checklist()`'s `ANTENNA_STUDY` item text was also factually
wrong (conflated the §73.150 72-azimuth pattern table with §73.151(a)/
§73.186(a)(1) measurement-radial counts, and stated an NDA figure — "8
radials at 45° intervals" — matching neither rule); it now reads
`candidate.canonical.proof`. Two `amSiteOptimizer.test.js` assertions that
encoded the old (incorrect) behavior were split into two tests: one
pinning the real Class-C exemption case, one proving Class D on a local
channel still requires NIF (documenting exactly why the old assertion was
wrong, per the "fix implementation, not weaken assertions unless
demonstrably incorrect" policy). **Not addressed:** `nighttime_classification`'s
own independent `isLocal`-based NIF predicate (same bug pattern,
discovered but never in the Phase 2 task list) and
`regulatory_risk_score`'s `NIF_STUDY_REQUIRED` factor — both left
untouched, out of explicit scope.

**Phase 2 item 2 — `canonical.scenario`** (commit `2940ef2`). New
`src/engine/am/canonical/scenario.js`, wired into
`buildCanonicalCandidateResult.js` as `canonical.scenario`. A pure
naming/labeling layer — it invents no new engineering selection, only
names facts already assembled (antenna mode, selected design height, NIF
decision).
- `OperatingScenario` (`OPERATING_SCENARIOS` in `types.js`):
  `CURRENT_AUTHORIZED_BASELINE`, `RELOCATION_NDA_DAY_ONLY`,
  `RELOCATION_NDA_WITH_NIGHT_AUTHORITY`, `RELOCATION_DA_NIGHT`,
  `RELOCATION_DA_FULL_TIME`, `POWER_UPGRADE_STUDY`.
- `AntennaDesignCategory` (`ANTENNA_DESIGN_CATEGORIES` in `types.js`):
  `QUARTER_WAVE`, `COMPACT`, `FIVE_EIGHTHS_WAVE`,
  `EXISTING_STRUCTURE_COLOCATION`, `CUSTOM_DA_ARRAY`.
- `primary_scenario_label` (plus the two raw enum values) added to
  `candidate_comparison_table`; `CandidateDetailDrawer.jsx`'s header shows
  the label prominently, e.g. *"5 kW daytime NDA relocation using a
  144.23 m compact radiator"*.
- **Documented, tested gaps, not fabricated:** `POWER_UPGRADE_STUDY` can
  never be returned — the engine passes exactly one `tpo_kw` per run,
  used identically for the baseline site and every relocation candidate,
  so there is no distinct "currently authorized power" input to compare
  against; `canonicalScenario.test.js` exhaustively sweeps the reachable
  input space and asserts this enum member never appears. `DA_DAY`
  (daytime-only directional) has no dedicated `OperatingScenario` member;
  it falls back to `RELOCATION_DA_FULL_TIME` with an explicit
  machine-checkable basis string flagging the gap rather than silently
  mislabeling.

**Phase 2 item 3 — RF-exposure boundary model** (commit `7032583`).
`canonical.rfExposure` already produced four distinct labeled distances
(`reactiveNearFieldBoundaryM`, `controlledMpeBoundaryM`,
`uncontrolledMpeBoundaryM`, `recommendedFenceDistanceM`) from earlier work
on this branch — that part of the requested "rebuild" was already done
and did not need re-doing. What was actually missing: (1) a single
top-level `evaluationMethod` tag (`ANALYTIC`/`CONSERVATIVE_SCREEN`/
`NOT_EVALUATED`/`MEASUREMENT`, the last documented as unreachable — no
field-measurement input path exists in this engine); (2) `candidate_comparison_table`
only ever surfaced one of the four boundaries (`fence_m`) — the other
three were computed but invisible at the top level, added as
`rf_reactive_near_field_m`/`rf_controlled_mpe_m`/`rf_uncontrolled_mpe_m`/
`rf_evaluation_method`; (3) `CandidateDetailDrawer.jsx`'s "RF exposure /
MPE" summary panel was reading its own guide's numbers
(`mpe_rf_exposure_summary`) rather than `canonical.rfExposure`, so it
could silently show a different fence distance than the comparison table
— rewired. A new test explicitly proves the four values are never
silently equal-and-conflated (the reactive near-field boundary must never
equal any MPE-derived distance — the actual historical bug this rule
replaces); two of the test's initial assumptions were corrected against
real physics-model output rather than the implementation being weakened
to match a wrong assumption (documented inline: `controlledMpe`/
`uncontrolledMpe` can legitimately coincide at some frequency/power
combinations, and `tpo_kw: null` evaluates to a *known* zero power, not
"unknown"). **Not touched:** the more detailed
`am_rf_exposure_mpe_guide` panel elsewhere in `CandidateDetailDrawer.jsx`
already labels its near-field/uncontrolled-distance figures distinctly
(no conflation bug present) and was left as supplementary guide detail,
consistent with the cost-panel precedent from Phase 1.

## Phase 2 test counts

| Suite | Result |
|---|---|
| `src/tests/canonicalScenario.test.js` (new) | 12/12 pass |
| `src/tests/canonicalRules.test.js` (rfExposure additions) | 30/30 pass |
| `src/tests/canonicalCore/Pipeline/Rules/Contract/Reconciliation/Scenario` combined | 133/133 pass |
| `src/tests/amSiteOptimizer.test.js` (re-run after Phase 2) | 1901/1901 pass |
| **Full repo suite**, re-run after Phase 2 | 4507 total — 4477 pass, 23 fail, 7 skipped. Same 23 pre-existing `countyBoundary.test.js` docker-fixture failures as Phase 1's run (down from 39 in the very first full-suite run because that run also counted `api.test.js`'s environment-dependent tests as failures rather than skips) — confirmed unrelated to any file touched in Phase 2. |

## Test counts (Phase 1 baseline, superseded by the Phase 2 addendum above for amSiteOptimizer/full-suite counts)

| Suite | Result |
|---|---|
| `src/tests/canonicalContract.test.js` | 4/4 pass |
| `src/tests/canonicalCore.test.js`, `canonicalPipeline.test.js`, `canonicalRules.test.js` | 108/108 pass (combined) |
| `src/tests/canonicalReconciliation.test.js` (new) | 11/11 pass |
| `src/tests/colocationOpportunities.test.js` | 340/340 pass |
| `src/tests/siteOptimizerUiFormat.test.js` | 29/29 pass |
| `src/tests/guideRegistry.test.js` | 9/9 pass |
| `src/tests/amSiteOptimizer.test.js` | 1900/1900 pass |
| **Full repo suite** (`node --test src/tests/*.test.js`) | 4481 total — 4435 pass, 39 fail, 7 skipped. **All 39 failures are pre-existing environmental gaps** in `api.test.js` (needs a live server / `DATABASE_URL`, not configured in this sandbox) and `countyBoundary.test.js` (needs Docker fixtures via `just start`, no Docker daemon available here) — confirmed to touch neither `siteOptimizer.js`, `colocationOpportunities.js`, nor any canonical/UI file changed in this effort. |

No `justfile` or ESLint config exists in this repo (that tooling reference
is from an unrelated project's `CLAUDE.md`), so there is no `just lint` step
to run here.

## What was fixed, domain by domain

Every item below is a TOP-LEVEL field (an exported response field, a
`candidate_comparison_table` column, or a UI headline value) that
independently recomputed a fact instead of reading
`candidate.canonical.*` — the single source of truth built by
`src/engine/am/canonical/buildCanonicalCandidateResult.js`.

### Group 1 — confidence / filing-readiness / recommendation

1. **`_confTier`/`_confFactor` (siteOptimizer.js)** — the confidence
   dampening multiplier that feeds the actual ranking score. Rewired to
   read `canonical.confidence.engineeringDataConfidence.inputTiers.{conductivitySource,colGeometry}`
   (the two per-input tiers this multiplier actually needs — see "blocked
   items" below for why the tier's own collapsed `.tier` value could not be
   used directly). The `canonical` object is now built *before* the score
   is computed (moved earlier in `scoreCandidate()`), since it feeds the
   score itself.
2. **`site_viability_summary.go_no_go`/`.confidence`** — `blankOk` rewired
   to `canonical.blanket`; `colOk` and the `confidence` field are **BLOCKED**
   (see below).
3. **`score_confidence`** — rewired to reuse the already-canonical `_confTier`
   local (removes a second independent re-derivation of the same two inputs).
4. **`filing_ready`** (both the response-envelope flag and the per-candidate
   flag) — rewired from a hardcoded `false` constant to
   `candidate.canonical.filingReadiness.ready` (per-candidate) /
   `scored.some(c => c.canonical.filingReadiness.ready === true)`
   (response-level).
5. **`nif_status`** (Group 3 item 1, listed here because it's a
   confidence/recommendation-adjacent field) — `finalizeLabels()` used to
   overwrite the correctly-canonical-set `nif_status` with a compliance-
   category label (`PROMISING`/`NON-COMPLIANT`/`REVIEW REQUIRED`). That
   overwrite is removed; `nif_status` is now set once, immediately after
   `canonical` is built, via a new `nifStatusFromCanonical()` helper that
   mirrors the identical helper already in `colocationOpportunities.js`
   (documented as the single shared mapping in both files). No new
   `compliance_category` field was introduced — `status_category` (already
   a distinct, pre-existing field) already carries that information.

**Blocked (not fixed) in Group 1:**
- `site_viability_summary.colOk` and its `confidence` field: canonical has
  **no §73.24(i) COL-coverage rule** (only blanket/NIF/ASR/proof-of-
  performance/RF-exposure/current-site rules exist under
  `canonical.regulatory`). Rewiring this to canonical would require
  fabricating a rule that doesn't exist.
- `candidate_shortlist[].recommended_next_step` and other per-candidate
  "next step" narratives keyed off `status_category`: `canonical.
  recommendation.level` is gated by `engineeringDataConfidence`, which is
  the MIN of three input tiers including `populationBasis` — and
  `populationBasis` is unconditionally `LOW` at screening time (density-
  proxy only). This means `canonical.recommendation.level` collapses to the
  same `ADVANCE_TO_DESK_STUDY` ceiling for **every** candidate during
  screening, regardless of whether it's COL-compliant, treaty-blocked, or
  fully non-compliant. Rewiring these differentiated narratives to
  `canonical.recommendation` would silently replace real per-candidate
  differentiation with an identical value for all candidates — a
  regression, not a fix — so they were left local.
- `propagation_confidence_interval.confidence_level`: a genuinely finer-
  grained HIGH/MEDIUM/LOW signal (measured / raster / zone-table, 8%/18%/
  35% uncertainty) than `canonical.confidence.engineeringDataConfidence`
  can express (same MIN-of-three-tiers collapse issue above, plus canonical
  has no "measured" conductivity tier distinct from "filing-grade").

### Group 2 — tower height / ground-system radials

1. **`candidate_comparison_table`** (the highest-priority item): collapsed
   6 disagreeing radial-count columns (`grd_num_radials_ideal`,
   `gnd_total_radials`, `gnd_std_n_radials`, `grs_std_n_radials`, plus the
   two that survive) down to **one**, `gnd_recommended_radials`, sourced
   from `candidate.canonical.groundSystem.selectedScenario.radialCount`.
   Collapsed 5 radial-length columns (`grd_radial_length_ft`,
   `grs_radial_length_m`, `gnd_insp_radial_length_ft`,
   `gnd_std_radial_len_m`, plus the survivor) down to **one**,
   `gnd_radial_length_ft`, sourced from `...selectedScenario.radialLengthM`
   (converted to feet). Added a new single canonical height column,
   `design_h_m` (`candidate.canonical.antenna.selectedDesignHeightM.value`),
   replacing the non-canonical `teh_qwave_height_m`.
2. **`src/components/ui/SiteOptimizer/CandidateDetailDrawer.jsx`** — both
   the "Promote to Studio" autofill payload and the "FCC Filing Auto-Fill
   Preview" panel (lines ~294–388 in the current file) now read tower
   height from `canonical.antenna.selectedDesignHeightM.value`, radial
   count/length from `canonical.groundSystem.selectedScenario`, and ASR
   from `canonical.regulatory.asr.required`, instead of
   `am_tower_lighting_and_painting_compliance_guide`/
   `am_ground_radial_system_design_guide`. This feeds a real FCC filing
   autofill, so this was treated as the highest real-world-risk item in
   the whole effort.
3. **`src/components/ui/SiteOptimizer/TowerReferencePanel.jsx`** — two
   fixes: (a) the frequency-only client-side fallback (used when the
   `towerReference` prop is absent) no longer fabricates an ASR verdict
   from λ/4 — it now honestly reports "ASR requirement unknown" rather
   than guessing, since it cannot know the true selected design height
   (class/requested/host-structure height) from frequency alone; (b) a
   **real, previously-shipping bug** was found and fixed in the same code
   path: the component read `tr.asr_registration_required_at_quarter_wave`,
   but the real API (`tower_reference` in `siteOptimizer.js`) has always
   emitted the field as `asr_registration_required_at_design_height` — the
   old prop name never matched, so for every real production API response
   this panel silently showed "ASR may not be required at λ/4" regardless
   of the actual answer. Also relabeled the λ/4 row from "std. height" to
   "reference only", matching canonical's treatment of λ/4 as a physics
   reference, never the selected design height.
4. **`ground_radial_advisory`**: left as-is on inspection — it is a
   distinct advisory (soil-conductivity-driven radial guidance text), not
   a duplicate of the selected-scenario radial count/length; not in the
   explicit duplicate list.

### Group 3 — NIF / DA / proof-of-performance / ASR / MPE / current-site-spacing

1. **`nif_status`** — see Group 1 item 5 above.
2–6. **`buildProtectionAdvisory()`, `buildProtectionRequirements()`,
   `buildRegulatoryTimeline()`, the `engineering_summary` NIF statement,
   and `buildForm301Checklist()`'s `ANTENNA_STUDY`/`SKYWAVE_NIF` text**:
   **NOT ADDRESSED in this pass** — these were part of the original
   assignment but the coordinator's explicit remaining-work checklists in
   this session were scoped to the comparison table and UI headline
   figures; these five items were not re-flagged for this pass and were
   not touched. They remain open work (see "What was NOT fixed" below).
7. **`candidate_comparison_table`** — collapsed:
   - 5 independent NIF-required booleans (`int_nighttime_nif`,
     `du_nif_required`, `sky_nif_required`, `fsc_nif_required`,
     `cpe_nif_required`) into **one** new `nif_required` column, sourced
     from the already-canonical `candidate.nif_required`
     (`canonical.regulatory.nif.required`).
   - 2 DA-recommended booleans (`da_study_recommended`,
     `ap_da_recommended`) into **one**: `da_study_recommended`, sourced
     from `canonical.antenna.patternModeRequired` via
     `isDirectionalMode()`.
   - 2 proof-radial-count columns (`tpg_proof_radials`, `proof_radials`)
     into **one**: `proof_radials`, sourced from
     `canonical.proof.radialCount` (the now-correct canonical
     proof-of-performance rule: 6–12 DA measurement radials per
     §73.151(a), or ≥6 NDA radials per §73.186(a)(1) — never the §73.150
     72-azimuth pattern table).
   - **13 independent ASR-required booleans** (`acq_asr_required`,
     `twr_asr_required`, `tower_asr_required`, `f301_asr_required`,
     `faa_ltg_asr_required`, `ltg_asr_required`, `cpe_asr_required`,
     `rdb_asr_required`, `faa_asr_required`, `ins_asr_required`,
     `asr_required_height`, `asr_requires_asr`, `tia_asr_triggered_qw` —
     the last still on a quarter-wave-only basis) into **one**:
     `asr_required_design`, sourced from
     `canonical.regulatory.asr.required`.
   - MPE fields `mpe_compliance_status`/`mpe_excl_radius_m` (a fabricated
     PASS/FAIL verdict canonical never issues) removed; the single
     canonical-sourced MPE figure is `fence_m`
     (`canonical.rfExposure.recommendedFenceDistanceM`).
   - `spacing_verdict` rewired to `canonical.transition.
     constructionOverlapRisk` (HIGH/MODERATE/LOW/UNKNOWN) — a
     transition-planning risk tier against the station's OWN current
     site, replacing a fabricated §73.37-style eligibility verdict that
     canonical deliberately never produces (`externalSpacingStudy` stays
     `NOT_EVALUATED` until a real study runs). `spacing_risk_tier`,
     `spacing_n_required`, `spacing_chan_class`, and `du_cc_spacing_km` (a
     third independent §73.37 mileage-table figure) were deleted outright
     — there is no legitimate replacement value for a mis-framed
     computation.
8. **`colocationOpportunities.js`'s reuse of `buildProtectionAdvisory`** —
   verified: it imports the function directly from `siteOptimizer.js`, so
   it inherits whatever `buildProtectionAdvisory` does. Since items 2–6
   above were not addressed, this inherits the same unfixed state (see
   "What was NOT fixed").

### Group 4 — blanket-population % and project-total cost

1. **`blanket_pop_risk`** — rewired to `canonical.blanket.populationFraction`
   vs `canonical.blanket.limitFraction` (proportional thresholds preserved:
   HIGH at 0.8× the limit, ELEVATED at 0.5×), instead of the local
   `blanket_population_pct`/`BLANKET_POP_HARD_CEIL_PCT` percent constant.
2. **`regulatory_compliance_summary.blanket_pop`** — same rewire; value and
   threshold both read from `canonical.blanket` (converted to percent for
   display).
3. **`sub.blanket` ranking sub-score** — rewired to
   `canonical.blanket.populationFraction / canonical.blanket.limitFraction`
   (this feeds the actual ranking score, so the `canonical` object build
   was moved to before the `sub` scores are computed).
4. **`colocationOpportunities.js`** — `assignStatusCategory()`'s
   `blanketFail` and `collectHardFails()`'s blanket check rewired to
   `c.canonical.blanket`; the mirrored local `BLANKET_POP_HARD_CEIL_PCT`
   constant removed.
5. **`total_project_cost_estimate`** — now sums
   `candidate.canonical.costs.total` across the top-5 candidates, instead
   of independently summing `permit_and_engineering_cost_estimate` (soft)
   + `tower_cost_estimate` (hard), which were not guaranteed to reconcile
   with the canonical cost model (which sums ALL cost components: tower,
   ground system, transmitter building, transmitter/ATU,
   electrical/generator, site access/utilities, engineering, legal/filing,
   environmental, contingency — parameterized on the canonical selected
   design height and ground scenario).
6. **`candidate_set_recommendation.cost_tier`** — rewired from
   `permit_and_engineering_cost_estimate`'s soft-cost-only tier to a tier
   derived from `canonical.costs.total.high` (same VERY_HIGH/HIGH/
   MODERATE/LOW thresholds used elsewhere).
7. **`candidate_comparison_table`** cost columns — collapsed 9
   independently-computed "total cost" columns (`pfg_total_low_usd`,
   `tpc_grand_total_low_usd`, `pf_grand_total_low_usd`,
   `tccg_cost_typ_usd`, `tpupg_total_low_usd`, `dcom_total_low_usd`,
   `reloc_cost_low`, `soft_cost_tier`, and `tower_cost_estimate`'s
   `cost_tier`) down to **two**: `cost_low_usd`/`cost_high_usd` (sourced
   from `canonical.costs.total`) and a single canonical-sourced
   `cost_tier`.
8. **`CandidateDetailDrawer.jsx`** — the three competing "Total Project
   Cost" headline figures (the proforma grand-total banner, the
   `am_total_project_cost_summary_guide` panel's "TOTAL (w/ contingency)"
   line, and the `station_total_project_cost_pro_forma_guide` panel's
   Total-low/high/typical grid) are all rewired to read
   `candidate.canonical.costs.total` as the headline number, with the
   per-guide breakdowns left visible as clearly-subordinate supplementary
   detail (each panel is still shown, just no longer the authoritative
   figure).

## Reconciliation proofs added (`src/tests/canonicalReconciliation.test.js`, 11/11 pass)

Production-path (`runSiteOptimizer()`, not the isolated canonical
assembler) integration tests proving:
(a) cost-sum equality between `canonical.costs.total`,
`candidate_comparison_table`, and `total_project_cost_estimate`;
(b) tower-height threading (`tower_reference`, comparison table,
`canonical.antenna`, and the ASR gate all agree);
(c) ground-scenario radial count/length threading;
(d) NIF decision-field consistency (`nif_status` is a deterministic
function of `nif_required`/`nif_completion`/`nif_result`, which all equal
`canonical.regulatory.nif`'s fields);
(e) recommendation suppression on validation failure;
(g) canonical fractional-percentage storage (never a raw percent >1 in a
fraction slot); plus production-path sanity checks (real API entry point,
longitude hemisphere formatting, `filing_ready` gate correctness) and
(h) CSV-export column equality, with an **honest documented gap**: the
current client-side CSV export (`CandidateTable.jsx`) does not include
tower-height/radial/ASR columns at all, so full export/UI equality for
those specific fields cannot be exercised through that export path today.

Item (f) — "no PASS color for UNKNOWN/NOT_EVALUATED/NOT_REQUIRED" — was
**not duplicated**; it already exists in `siteOptimizerUiFormat.test.js`
and was reconfirmed green (29/29) against every change in this effort,
per the coordinator's instruction not to duplicate it.

A production-path KAZM snapshot (full canonical result + comparison-table
row + `tower_reference` + `total_project_cost_estimate`) was saved to
`src/tests/fixtures/kazmProductionPathSnapshot.json` for future regression
detection.

## What was NOT fixed (explicit, acknowledged scope boundaries)

**Guide-internal long-tail duplicates — hundreds, by design out of scope.**
The codebase has ~262 inline `some_guide: (() => {...})()` IIFEs in
`scoreCandidate()`'s return object. This effort only touched TOP-LEVEL
fields (response fields, comparison-table columns, UI headline values) —
duplicates that live entirely *inside* a single guide's own namespaced
sub-object were never in scope and were never touched. `canonicalContract.
test.js` and `guideRegistry.test.js` (added earlier in this branch, before
this session) prove there is no *key-name collision* between any guide and
any reserved canonical field name — that is a real, structural guarantee.
It is **not** a guarantee that every number inside every guide agrees with
canonical; it only guarantees no guide can silently *overwrite* a
canonical-authoritative top-level key. The long tail of guide-internal
duplication (e.g., a guide's own internal radial-count field that
disagrees with `canonical.groundSystem` but is never exposed at the guide's
top level) remains unaudited technical debt.

**Group 3 items 2–6 — FIXED in Phase 2 item 1** (`684810a`):
`buildProtectionAdvisory`, `buildProtectionRequirements`,
`buildRegulatoryTimeline`, and `buildForm301Checklist`'s `ANTENNA_STUDY`/
`SKYWAVE_NIF` items all now read `canonical.regulatory.nif` /
`canonical.proof` instead of independently re-deriving NIF requirement
from `channel_class` or stating hardcoded (and factually wrong)
proof-radial text. See the Phase 2 addendum above for the real
correctness bug this uncovered (the §73.182(o) local-channel exemption is
Class-C-only, not blanket-local). The `engineering_summary` NIF statement
(originally listed as Group 3 item 5) turned out to already be correctly
wired to `canonical.regulatory.nif` from earlier work on this branch —
verified, not re-touched.

**Newly discovered during Phase 2, NOT fixed** (same `!isLocal`/`isLocal`
bug pattern as Group 3 items 2–6, but never named in any task list for
this effort): `nighttime_classification`'s own independent
`LOCAL_CHANNEL_KHZ.has(frequency_khz)`-based NIF predicate, and
`regulatory_risk_score`'s `NIF_STUDY_REQUIRED` risk factor. Both are
per-candidate blocks inside `scoreCandidate()`, distinct from the four
functions fixed above, and were left untouched per "never touch anything
not explicitly listed."

**Group 1's colOk / recommended_next_step narratives / propagation
confidence interval** — blocked, not fixed, for the documented reasons
above (canonical has no COL-coverage rule; canonical's recommendation
ladder and engineering-data-confidence axis collapse to a constant value
during screening and would destroy real per-candidate differentiation if
forced onto these fields).

**`SiteOptimizerApp.jsx`'s `DEMO_RESULT`/`DEMO_COLOCATION_RESULT`** — the
hardcoded offline-preview mock payload (used when the app can't reach a
live backend) predates this entire canonical effort: it has **zero**
`canonical` keys anywhere on its mock candidates, and its `tower_reference`
literally still uses the old field name
`asr_registration_required_at_quarter_wave` that `TowerReferencePanel.jsx`
no longer reads (see Group 2 item 3). In demo/offline mode, the UI will
now correctly show "ASR requirement unknown" (honest) rather than a
fabricated verdict, and `CandidateDetailDrawer`'s canonical-sourced
autofill/status banner will render blank for demo candidates, since there
is no `canonical` object to read. This is real, user-visible demo-mode
degradation until `DEMO_RESULT` is regenerated from a real production
`runSiteOptimizer()` (or `runColocationOpportunities()`) response.

**No JSON/CSV server-side export exists specifically for AM site-optimizer
candidates.** `src/exports/json/exporter.js` / `src/api/routes/exhibits.js`
serve a different, broader "exhibit" concept unrelated to site-optimizer
candidates. The only export mechanism today is the client-side CSV builder
in `CandidateTable.jsx`, which (per the reconciliation test's documented
gap above) does not currently include tower-height/radial/ASR columns.

## What "no UI/export/guide/narrative path independently decides authoritative engineering facts" now means

Be precise about what changed:

- **TOP-LEVEL fields are now canonical-sourced**, for the specific facts
  enumerated above: confidence tier feeding the score, filing-readiness,
  NIF status/requirement, tower design height, ground-system radial
  count/length, ASR-required, blanket-population risk tier, cost totals,
  and current-site transition risk. Every one of those facts now has
  exactly ONE column in `candidate_comparison_table`, ONE code path in the
  two UI components audited, and reconciliation tests proving they agree
  with `candidate.canonical` on the real production path.
- **Guide-internal sub-objects are NOT policed** beyond the structural
  no-shadowing guarantee `canonicalContract.test.js`/`guideRegistry.test.js`
  already proved (no guide key can collide with — i.e., silently overwrite
  — a reserved canonical-authoritative top-level field name). A guide can
  still carry its own internal recomputation of, say, a radial count deep
  inside its own sub-object, and that internal figure is not compared
  against canonical anywhere. That is real, deliberate, acknowledged scope
  — this pass never claimed to audit ~262 guides' internals, only the
  narrow top-level surface an operator, the comparison table, or the
  filing-autofill UI would actually read.
- This is **real progress, not full completion**. The specific, named,
  highest-impact contradictions (a candidate showing 6 different radial
  counts in one exported row; a filing autofill silently pulling from a
  stale guide instead of canonical; a UI panel checking a field name that
  never matched the real API) are gone. The long tail is not.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
