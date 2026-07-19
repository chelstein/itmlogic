# Canonical Consistency Audit — Follow-up Completion Report

**Branch:** `canonical-consistency-audit-followup`
**Scope:** TOP-LEVEL category-5 duplicate fields identified by four read-only
audit passes over `src/engine/am/siteOptimizer.js`,
`src/engine/am/colocationOpportunities.js`, and the SiteOptimizer UI
components. Guide-internal (namespaced sub-object) duplicates were
explicitly out of scope for this pass — see "What was NOT fixed" below.

**Final commit on this branch:** `ace3613` (this report is committed
separately after it, see the git log for the exact final hash).

Commits in this effort, in order:
```
a2b0724  feat: guide-registry structural guarantees + static canonical contract test
1627296  wip: rewire siteOptimizer/colocationOpportunities top-level fields to canonical (partial)
860c280  wip: rewire filing-autofill UI + remaining comparison-table/cost columns to canonical
0dd742d  test: update comparison-table assertions for collapsed duplicate columns
ace3613  canonical-consistency-audit-followup: finish Group 4 cost rewiring + add reconciliation proofs
```

## Test counts (final, this branch)

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

**Group 3 items 2–6** (`buildProtectionAdvisory`, `buildProtectionRequirements`,
`buildRegulatoryTimeline`, the `engineering_summary` NIF statement, and
`buildForm301Checklist`'s DA/NDA proof-radial text) — part of the original
task assignment, not re-flagged in this session's remaining-work
checklists, not touched. `buildForm301Checklist`'s `ANTENNA_STUDY` item
still states the pre-audit (incorrect) proof-radial figures/text; the
correct figures are now available at `canonical.proof` (used by the
`proof_radials` comparison-table column) but the checklist's own prose was
never updated to match.

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
