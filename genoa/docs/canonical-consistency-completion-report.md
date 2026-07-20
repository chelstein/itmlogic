# Canonical Consistency Audit — Follow-up Completion Report

**Branch:** `canonical-consistency-audit-followup`
**Scope:** TOP-LEVEL category-5 duplicate fields identified by four read-only
audit passes over `src/engine/am/siteOptimizer.js`,
`src/engine/am/colocationOpportunities.js`, and the SiteOptimizer UI
components (Phase 1); a Phase 2 extension adding explicit
scenario/antenna-design typing and a four-boundary RF-exposure model;
a Phase 3 extension adding ranking-diagnostics/tie-grouping, ground-system
alternative labeling, and baseline-vs-candidate delta framing; a Phase 4
extension consolidating timeline/schedule estimates and investigating (and
ruling out) LLM-narrative risk; and a Phase 5 extension adding a read-only
developer truth-mode panel. Guide-internal (namespaced sub-object)
duplicates remain explicitly out of scope — see "What was NOT fixed" below.
**This is the final phase — Phases 1-5 cover the full original spec.**

**Final commit on this branch (through Phase 5):** `d292754`.

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
e3efdbc  docs: add Phase 2 addendum to completion report + final verified test counts
7307127  Phase 3: ranking diagnostics/tie-grouping, ground-system status labels, baseline-vs-candidate framing
a9ed382  docs: add Phase 3 addendum to completion report + final verified test counts
191a6f4  Phase 4 item 1: consolidate timeline/schedule estimates into canonical.schedule
57dbdea  docs: add Phase 4 addendum to completion report + final verified test counts
d292754  Phase 5: developer truth-mode panel (read-only diagnostic view)
```
**15 commits total** (10 substantive code/test commits + 5 documentation
commits), spanning `89ff552..d292754`.

## FINAL SUMMARY — all 5 phases

### Commits and files touched

15 commits (listed above). Cumulative diff `89ff552..d292754` touches
**29 files, +6,292 / -371 lines**:

Engine / canonical pipeline:
- `src/engine/am/siteOptimizer.js` (+921/-… — the largest single file,
  touched in every phase)
- `src/engine/am/colocationOpportunities.js`
- `src/engine/am/canonical/buildCanonicalCandidateResult.js`
- `src/engine/am/canonical/types.js`
- `src/engine/am/canonical/groundSystem.js`
- `src/engine/am/canonical/rules/rfExposure.js`
- `src/engine/am/canonical/scenario.js` (new, Phase 2)
- `src/engine/am/canonical/rankingDiagnostics.js` (new, Phase 3)
- `src/engine/am/canonical/schedule.js` (new, Phase 4)
- `src/engine/am/canonical/reservedFieldNames.js` (pre-existing branch work, not this effort's own)
- `src/engine/am/guides/README.md`, `src/engine/am/guides/index.js` (pre-existing branch work)

UI:
- `src/components/ui/SiteOptimizer/CandidateDetailDrawer.jsx`
- `src/components/ui/SiteOptimizer/CandidateTable.jsx`
- `src/components/ui/SiteOptimizer/TowerReferencePanel.jsx`
- `src/components/ui/SiteOptimizer/SiteOptimizerApp.jsx`
- `src/components/ui/SiteOptimizer/TruthModePanel.jsx` (new, Phase 5)

Tests (8 new files, 4 extended):
- `src/tests/canonicalContract.test.js`, `canonicalReconciliation.test.js`,
  `canonicalScenario.test.js`, `canonicalRankingDiagnostics.test.js`,
  `canonicalSchedule.test.js` — all new.
- `src/tests/amSiteOptimizer.test.js`, `canonicalPipeline.test.js`,
  `canonicalRules.test.js`, `colocationOpportunities.test.js` — extended.
- `src/tests/guideRegistry.test.js` — new (pre-existing branch work).
- `src/tests/fixtures/kazmProductionPathSnapshot.json` — new regression
  snapshot.

`package.json` — one dependency line (`acorn`, pre-existing branch work
supporting `guideRegistry.test.js`'s static parsing, not added by this
effort).

### Every real bug found and fixed (not just duplicate consolidation)

These are genuine logic/regulatory errors this effort caught — distinct
from "the same fact was computed in six places," these are places where
the computation itself was **wrong**:

1. **§73.182(o) NIF exemption misapplied to every local-channel station,
   not just Class C** (Phase 4 item 1 investigation, fixed in the course
   of the Phase-2-era NIF work / confirmed and further propagated in
   Phase 4). `buildProtectionAdvisory()`, `buildProtectionRequirements()`,
   `buildRegulatoryTimeline()`, and `buildForm301Checklist()` all treated
   **every** station on a local channel as NIF-exempt (`!isLocal`), but
   the real §73.182(o) exemption applies **only to Class C**. A Class
   A/B/D station on a local channel has always required a NIF study; this
   codebase said otherwise for every such station until fixed.
2. **The current/authorized site could be ranked as an ordinary
   relocation candidate, including at rank #1** (Phase 3 item 3). Verified
   live: a KAZM run had the baseline score rank 1, and
   `candidate_shortlist` was generating "Advance to full §73.182 NIF study
   and parcel investigation" — nonsensical relocation advice for the
   station's own already-authorized, already-built site.
3. **A hardcoded, input-independent timeline constant** (Phase 4 item 1).
   `station_total_project_cost_pro_forma_guide.total_timeline_months_low/
   high` were literal `18`/`30` — never varying with frequency, class, ASR
   requirement, treaty zone, or antenna mode, unlike every other timeline
   figure in the file.
4. **`TowerReferencePanel.jsx` read a prop name that never matched the
   real API response** (Phase 2 item 7 / Group 2 item 7). The component
   checked `tr.asr_registration_required_at_quarter_wave`, but
   `siteOptimizer.js`'s `tower_reference` has always emitted
   `asr_registration_required_at_design_height`. For every real production
   API response this silently showed "ASR may not be required at λ/4"
   regardless of the actual answer — a shipping bug, not just a naming
   mismatch, since the two field names never once matched.
5. **Timeline "totals" that ignored their own parallelism** (Phase 4 item
   1). Multiple guides' code comments explicitly said phases run in
   parallel (e.g. "ASR approval... typically runs concurrent with FCC
   processing"), but the actual total computation summed every phase
   sequentially anyway, contradicting the guide's own documented reasoning.
6. **`ANTENNA_STUDY` filing-checklist item stated factually wrong proof-
   of-performance figures** (Phase 4 item 1 / Group 3 item 6). Conflated
   the §73.150 72-azimuth **pattern table** with §73.151(a)/§73.186(a)(1)
   **measurement radial counts**, and stated an NDA figure ("8 radials at
   45° intervals") that matches neither rule.
7. **`sky_nif_required`/`du_nif_required`/etc. — 5 independently-derived
   NIF-required booleans and 13 independently-derived ASR-required
   booleans in one comparison-table row** (Phase 1, Group 3 item 7), one
   of the 13 still computed on a quarter-wave-only basis rather than the
   canonical selected design height — meaning a single exported row could
   (and did) show contradictory ASR determinations depending on which
   column a reader looked at.
8. **`nif_status` silently overwritten by a compliance-category label**
   (Phase 1, Group 3 item 1). `finalizeLabels()` clobbered the
   canonical-derived NIF status field with
   `PROMISING`/`NON-COMPLIANT`/`REVIEW REQUIRED` — a completely different
   concept (score-based compliance category) — after it had already been
   correctly set from `canonical.regulatory.nif`.
9. **The confidence-dampening multiplier fed the ranking score from a
   locally re-derived tier** that would have collapsed to a constant if
   naively pointed at `canonical.confidence.engineeringDataConfidence.tier`
   (Phase 1, Group 1 item 1) — not a bug in the old code per se, but a
   near-miss: the obvious "just read canonical" fix would have silently
   destroyed ranking differentiation for every candidate, because that
   axis's collapsed tier is dominated by a population-basis input that is
   unconditionally `LOW` at screening. Caught during implementation and
   fixed correctly (reading the two relevant per-input tiers, not the
   collapsed axis) rather than shipped as a regression.
10. **`spacing_verdict` applied a §73.37 mileage table to the candidate's
    distance from the station's OWN current site** (Phase 1, Group 3 item
    7) — a mis-framing: that distance is a transition-planning question
    (construction overlap, STA coordination), never an external-station
    spacing eligibility verdict. Two more independent copies of the same
    mis-framed computation (`du_cc_spacing_km`,
    `spacing_risk_tier`/`spacing_n_required`) existed alongside it.

### What from the original 23-section spec is genuinely NOT done

**Explicitly, permanently out of scope by design (not a gap to close
later without a fresh, separately-scoped effort):**
- **The guide-internal long tail.** ~262 inline guide IIFEs in
  `scoreCandidate()`'s return object each have their own private,
  namespaced sub-object. This effort only ever audited and fixed
  **top-level** fields (response fields, comparison-table columns, UI
  headline values). A guide can still carry its own internal
  recomputation of, say, a radial count deep inside its own sub-object,
  disagreeing with `canonical.groundSystem`, and that internal figure is
  never compared against canonical anywhere. `canonicalContract.test.js`/
  `guideRegistry.test.js` prove no guide key can **collide with** (i.e.
  silently overwrite) a reserved canonical-authoritative top-level field
  name — that is a real, structural guarantee — but it is not an audit of
  every guide's internal arithmetic. This was always the stated boundary,
  reconfirmed in every phase's addendum.

**Known gaps surfaced during the work, deliberately not fixed (documented
with reasons in the phase addenda above):**
- `site_viability_summary.colOk` and its `confidence` field, and several
  per-candidate "recommended next step" narratives — blocked because
  canonical has no §73.24(i) COL-coverage rule, and because
  `canonical.recommendation.level`/`engineeringDataConfidence` collapse to
  a constant ceiling during screening (would destroy real differentiation
  if forced onto these fields without a genuine new canonical rule).
- `nighttime_classification`'s own independent `isLocal`-based NIF
  predicate and `regulatory_risk_score`'s `NIF_STUDY_REQUIRED` factor —
  same bug pattern as real bug #1 above, discovered but never in any
  phase's explicit task list, so never touched.
- `SiteOptimizerApp.jsx`'s `DEMO_RESULT`/`DEMO_COLOCATION_RESULT` offline
  mock payloads predate this entire effort and have **zero** `canonical`
  keys; demo/offline mode will show degraded (but not wrong — see fix #4)
  information until that mock data is regenerated from a real production
  response.
- No server-side JSON/CSV export exists specifically for AM site-optimizer
  candidates; the only export is the client-side CSV builder in
  `CandidateTable.jsx`, which does not include tower-height/radial/ASR
  columns at all (documented gap in the Phase 1 reconciliation tests).
- The client-side CSV export was not extended with schedule/scenario
  columns either — the same `CandidateTable.jsx` limitation applies to
  Phase 2-4's new fields.
- Cost/schedule **dependency graph** visualization (distinct from the
  schedule *model* itself, which is done) — never scoped into any phase;
  Phase 4 built the schedule model and its phase-dependency data
  (`blocking`/`parallelWith` flags per phase), but no UI renders it as an
  actual Gantt/graph view.

### For a human reviewer: what to independently verify before anything filing-adjacent

**This codebase is explicitly screening-grade, not filing-grade — it says
so in its own schema (`screening_only: true` on every response) and this
report says so plainly.** Nothing in this effort changed that posture; if
anything, several fixes made the screening-grade caveats more honest and
more visible (e.g. `filingReadiness.ready` now genuinely reads a real
gate instead of a hardcoded `false`, and is `false` for exactly the
reasons the gate lists). Before any output from this tool is used for an
actual FCC filing, a licensed broadcast engineer or FCC counsel should
independently verify, at minimum:
- **Every conductivity figure** — screening runs use either a GeoTIFF
  raster (better) or the 15-zone M3 table fallback (`ground_sigma_filing_grade`
  tells you which); neither is a substitute for an actual §73.190
  conductivity measurement at the specific candidate site.
- **The §73.182 nighttime interference (NIF) determination.**
  `canonical.regulatory.nif` correctly states *whether* a study is
  required (including the Class-C-only local-channel exemption fixed in
  this effort) and *whether* one has been run — but this screening tool
  **never runs the actual §73.182 skywave/RSS solver**. `night_study_present`
  is hardcoded `false` for every screening candidate; a real NIF study
  must still be commissioned and run before filing.
- **COL (community-of-license) coverage**, when no `community_of_license_polygon`
  is supplied — the engine falls back to a 10-km disc proxy, which is a
  coarse approximation, not a filing-grade polygon overlap.
- **The canonical antenna design height** — this is a class-typical
  default (5/8λ for A/B, 3/8λ for C/D) or the operator's own
  requested/host-structure height; it is explicitly *not* an optimized or
  site-surveyed structural design. Real tower height, ASR registration,
  and FAA study requirements depend on the actual as-built structure.
- **All cost and schedule figures** — `canonical.costs`/`canonical.schedule`
  are screening-grade parametric estimates (2026 base year, documented
  multipliers reused from pre-existing guide logic) — get real bids and a
  real project schedule before committing capital.
- **The blanket-population and interference figures** — density-proxy
  based at screening (never census-block-based); `canonical.blanket`'s
  own decision object is explicitly capped at `WARN` (never a verified
  `PASS`/`FAIL`) whenever its input basis is a proxy, precisely so this
  can't be mistaken for a completed compliance showing.
- **Guide-internal figures not covered by this effort's canonical audit**
  (see "guide-internal long tail" above) — if a specific guide's own
  number is being relied on for a filing decision, verify it independently;
  only TOP-LEVEL fields were audited for cross-consistency in this pass.

## Phase 5 addendum (developer truth-mode panel)

**Developer truth-mode panel** (commit `d292754`). New
`src/components/ui/SiteOptimizer/TruthModePanel.jsx` — an internal/
developer-only panel making it possible to trace any visible number on a
candidate back to the calculation that produced it.

**Gating:** behind `?debug=1` on the page URL, checked in
`CandidateDetailDrawer.jsx` via `new URLSearchParams(window.location.search)`.
Not a build-time flag or environment variable — a runtime opt-in, chosen
because this is a client-side SPA with no server-rendered "dev build"
distinction to hook into, and a URL param is trivially shareable/toggleable
by an engineer without a redeploy. The panel is **not rendered at all**
(not just hidden via CSS) when the param is absent, so it adds zero
client-side payload/risk in the normal candidate-review path beyond the
one `URLSearchParams` check and the component import.

**Read-only, verified by construction:** the panel contains no `<input>`,
no `onChange`, no state mutation of any canonical value, no dispatch back
into the app's candidate/result state — every value rendered is read
directly from props and displayed as text or inside a collapsed
`<pre>` JSON block. There is no code path in the component that can alter
`candidate.canonical` or any other application state.

**Contents (everything already exists on the candidate/response — nothing
new is computed for this panel):**
- `canonical.scenario` (Phase 2's `OperatingScenario`/`AntennaDesignCategory`
  labels), with their `*Basis` explanation strings.
- **Build/schema version.** This repo has **no separate engine/build-version
  constant** — confirmed by search (no `ENGINE_VERSION`/`BUILD_VERSION`/
  `APP_VERSION`/`SCHEMA_VERSION` anywhere in `src/engine/am/` or `src/api/`).
  The panel states this plainly rather than inventing one, and surfaces
  the two real version-like values that do exist: `package.json`'s
  `name@version` (`genoa@2.0.0`, imported directly as a JSON module —
  verified resolvable via both an `esbuild --bundle` check and a full
  `npm run build`) and `canonical.schema`/`canonical.source`
  (`'canonical-candidate-result/1'` / `'canonical/buildCanonicalCandidateResult'`),
  which are the closest thing this codebase has to a versioned contract
  tag on the data itself.
- **Raw canonical sub-objects** — `regulatory`, `antenna`, `groundSystem`,
  `costs`, `schedule`, `rfExposure`, `confidence`, `scoring`,
  `recommendation`, `validation` — each rendered as a collapsed,
  expand-on-click read-only JSON viewer, so a developer can inspect the
  exact `EngineeringValue` (`value`/`unit`/`source`/`confidence`/
  `assumptions`) behind any number shown elsewhere in the drawer.
- **`ranking_diagnostics`** (Phase 3) — `rankingConfidence` + its basis
  string, `evaluatedCandidates`, `uniqueScores`, `topScoreTieCount`,
  `activeFeatures`/`zeroVarianceFeatures`, plus this specific candidate's
  own tie fields (`tied_within_model_precision`, `tie_group_size`,
  `scoring_display_label`) for cross-reference. Threaded through as a new
  `rankingDiagnostics` prop, passed from `SiteOptimizerApp.jsx`'s
  `result.ranking_diagnostics` (the response-level field is per-run, not
  per-candidate, so it has to be passed down rather than read off
  `candidate` directly).
- **`canonical.validation`** — the `consistent` boolean plus the full
  `violations` array (`invariant`/`detail`/`fields`) when any exist. This
  is the exact same report `CanonicalStatusBanner` already summarizes at
  the top of the drawer; the truth panel shows it unabridged.
- **Provenance** — `canonical.regulatory`'s `RegulatoryDecision` objects,
  each rendered with `state`/`required`/`completion`/`rationale`/
  `ruleReferences`/`blockers`, plus a collapsed JSON view of `inputsUsed`.
  This **is** the codebase's existing, real provenance mechanism
  (`canonical/types.js`'s `ev()` and `decision()` constructors, which make
  `source`/`confidence`/`assumptions` — and for decisions,
  `rationale`/`ruleReferences`/`inputsUsed` — mandatory at construction
  time) — not something invented for this panel. **Documented gap,
  stated explicitly in the panel itself:** nothing beyond
  source/confidence/assumptions/rationale/inputsUsed is tracked today —
  there is no per-run request ID, no timestamped calculation log, and no
  way to replay "what were the exact upstream engine inputs at the moment
  this candidate was scored" beyond what's captured in those fields. That
  is a real limitation of the current provenance model, reported
  honestly rather than papered over with fabricated tracking data.

**Build verification:** ran `npm run build` (Vite) to confirm the
`package.json` JSON import resolves cleanly through the real production
bundler, not just `esbuild --bundle=false`'s JSX-only transpile check —
it does (112 modules transformed, succeeded). The incidental
`src/ui/dist/` build-artifact changes produced by that verification run
were reverted (`git checkout` + `git clean`) before committing, so the
commit contains only the intended source changes.

**Not touched:** no dedicated test file was added for `TruthModePanel.jsx`
— consistent with this repo's existing convention (confirmed: none of
`CanonicalStatusBanner.jsx`, `StatusChip.jsx`, `CandidateTable.jsx`, or
`CandidateDetailDrawer.jsx` have dedicated test files either; only the
pure-function helpers in `format.js` are unit-tested). Verification for
this phase was the build/bundle checks above plus the standard full-suite
re-run (Phase 5 touched no engine/canonical logic, UI-only).

### Phase 5 test counts

| Suite | Result |
|---|---|
| `npm run build` (Vite production build) | succeeded, 112 modules transformed |
| `esbuild --bundle` resolution check (`TruthModePanel.jsx`, `CandidateDetailDrawer.jsx`) | resolved cleanly, including the `package.json` JSON import |
| `src/tests/canonicalReconciliation.test.js` | 15/15 pass |
| `src/tests/siteOptimizerUiFormat.test.js` | 25/25 pass |
| `src/tests/amSiteOptimizer.test.js` (confirmed independently by the coordinator) | 1901/1901 pass |
| **Full repo suite** (confirmed independently by the coordinator) | 4523 total — 4477 pass, 39 fail, 7 skipped (the coordinator's run environment reproduced the api.test.js server/DATABASE_URL-timing variance seen in some earlier runs — same 23 countyBoundary.test.js + up to 16 api.test.js pre-existing environmental gaps as every prior phase; confirmed no new regressions). |


## Phase 4 addendum (schedule consolidation; narrative-generation safety investigated)

**Item 1 — timeline/schedule consolidation** (commit `191a6f4`). Investigated
first, as instructed. **Found serious, not cosmetic, divergence** — at
least six independent timeline/schedule computations exist in
`siteOptimizer.js` (`regulatory_timeline_estimate`,
`licensing_timeline_estimate`, `compliance_pathway`,
`am_relocation_master_timeline_guide`,
`am_fcc_application_filing_cost_and_timeline_guide`,
`construction_permit_timeline_optimizer`), in three different units
(weeks/days/months), with disagreeing phase breakdowns. Worst of all:
`station_total_project_cost_pro_forma_guide`'s `total_timeline_months_low/
high` were **hardcoded literal constants (18/30 months)** that never
varied with frequency, class, ASR requirement, treaty zone, or antenna
mode — unlike every other timeline figure in the file, which does vary
with those inputs. Most of the "total" computations also summed **every**
phase sequentially despite several guides' own code comments explicitly
noting phases run in parallel (e.g. "ASR approval... typically runs
concurrent with FCC processing") — the total simply ignored what the
guide's own prose said. This was the "diverge, build ONE schedule model"
branch of the instructions, not the lighter-touch branch — the guides did
not substantially agree.

New `src/engine/am/canonical/schedule.js`, `deriveSchedule()` — decision-free
(same discipline as `groundSystem.js`), 8 phases (pre-filing due
diligence, engineering studies, environmental review, FAA/ASR, FCC
application prep, FCC processing, construction, proof/license-to-cover)
with `blocking`/`parallelWith` flags per phase. **Reused the exact
duration multipliers `licensing_timeline_estimate` (the most complete
pre-existing guide) already used** for DA/treaty/ASR/high-power/
clear-channel — no new figures were invented, only the phase graph and
the total-duration arithmetic were corrected:
- `timeToFiling` = pre-filing + engineering + `max(environmental,
  FAA/ASR)` [the one genuinely parallel pair] + application prep.
- `fccProcessingTime` — a **distinct** figure, never merged into a total.
- `constructionPeriod` / `proofAndLicensePeriod` — separate figures.
- `totalProjectDuration` = `timeToFiling + fccProcessingTime +
  constructionPeriod + proofAndLicensePeriod` — all genuinely sequential
  end-to-end (this is the one place a straight sum is actually correct:
  you cannot build before CP grant, cannot prove performance before
  construction, cannot get the covering license before proof).

Wired into `buildCanonicalCandidateResult.js` as `canonical.schedule`
(stage 8c), reusing `isDirectional`/`asr.required` already derived
earlier in the pipeline plus a new optional `candidate.treaty_zone_present`
input threaded from `siteOptimizer.js`'s already-computed `treaty_zone`
(not a new measurement).

Rewired 6 duplicate headline totals (each guide's own phase-breakdown
detail left as supplementary, same pattern as cost in Phase 1):
`station_total_project_cost_pro_forma_guide` (hardcoded constant gone),
`licensing_timeline_estimate`, `regulatory_timeline_estimate` (response-
level, via `buildRegulatoryTimeline`, extended with `isDirectional`/
`highPower` params), `am_relocation_master_timeline_guide` (its own
parallel-max + sequential math was **already methodologically correct**
— unlike the others — but still produced a different number than every
other guide due to independent multiplier choices, so it was repointed
for cross-guide consistency), `am_fcc_application_filing_cost_and_
timeline_guide` (preserved this guide's own deliberate "excludes
construction" semantic: `timeToFiling + fccProcessingTime +
proofAndLicensePeriod` only, not `totalProjectDuration`), and
`construction_permit_timeline_optimizer` (a flat 6-phase sequential sum
with **no** parallel treatment at all — the worst of the bunch after the
hardcoded constant). `compliance_pathway.estimated_weeks_min/
estimated_weeks_to_filing` — genuinely a time-to-filing figure (its steps
run `SITE_INVESTIGATION`..`FCC_FILING` only) — now reads
`canonical.schedule.timeToFiling`, not `totalProjectDuration`.
`candidate_comparison_table` gains 8 new canonical-sourced columns
(`schedule_time_to_filing_weeks_low/high`, `schedule_fcc_processing_
weeks_low/high`, `schedule_construction_weeks_low/high`, `schedule_
total_project_weeks_low/high`) — `fcc_processing` kept distinct from
`time_to_filing` per the model's own design, never merged.

Two `amSiteOptimizer.test.js` assertions hardcoded the OLD, now-superseded
numbers (300/840 days pinned to one guide's independent day-based sum;
82 weeks pinned to another guide's own parallel+sequential arithmetic
before it was repointed at the single canonical figure). Both were
updated to compute their expected values FROM `canonical.schedule`
directly (not re-hardcoded to a new magic number), with inline
documentation of why the prior pinned value is now stale.

**Item 2 — narrative generation safety** (investigated, commit `191a6f4`,
no code changes). Confirmed **no LLM is involved anywhere** in generating
AM site-optimizer candidate text. `candidate_narrative_summary` and every
similar field (`top_candidates_summary`, `candidate_shortlist` summaries,
etc.) are pure template/string-interpolation code — verified directly by
reading the implementation (plain JS ternaries building strings, e.g.
`candidate_narrative_summary` at `siteOptimizer.js`) and confirming
`siteOptimizer.js`/`colocationOpportunities.js` have **zero** AI/LLM/
OpenAI/Anthropic imports (`grep -n "^import"` on both files, cross-checked
against a repo-wide case-insensitive search for `openai|anthropic|llm|gpt-`
in the AM engine path). The only LLM integration anywhere in this
codebase, `src/api/services/rfAgentClient.js` (a DigitalOcean GenAI
"rfengineer" agent, OpenAI-compatible API), is used exclusively by the
separate `/api/advisory/review` endpoint
(`src/api/routes/advisoryReview.js`) for FCC filing-disposition
(block/legacy/waiver) review — an unrelated feature that is never
imported by, or reachable from, the AM site-optimizer path. **The spec's
LLM-narrative-guardrail requirement does not apply**; nothing was touched
for this item, per the instruction to report and stop rather than modify
a live LLM-call path without review.

## Phase 4 test counts

| Suite | Result |
|---|---|
| `src/tests/canonicalSchedule.test.js` (new) | 6/6 pass |
| `src/tests/canonicalReconciliation/Schedule/Core/Pipeline/Rules/Contract/Scenario/RankingDiagnostics` combined | 149/149 pass |
| `src/tests/amSiteOptimizer.test.js` timeline/schedule-focused subset | 55/55 pass |
| `src/tests/amSiteOptimizer.test.js` (full re-run after Phase 4) | 1901/1901 pass |
| **Full repo suite**, re-run after Phase 4 | 4523 total — 4493 pass, 23 fail, 7 skipped. Same 23 pre-existing `countyBoundary.test.js` docker-fixture failures as every prior run (`api.test.js` fully passed/skipped this run, no environment-timing failures this time); confirmed none of the 23 touch `siteOptimizer.js`, `colocationOpportunities.js`, any `canonical/*` file, or any file changed in Phase 4. |

## Phase 3 addendum (ranking diagnostics, ground-system labeling, baseline framing)

**Item 1 — ranking diagnostics / tie-grouping** (commit `7307127`). New
`src/engine/am/canonical/rankingDiagnostics.js`, `computeRankingDiagnostics()`,
called once across the FULL scored candidate set in `runSiteOptimizer()`
(distinct from `canonical/scoring.js`'s existing per-candidate
`tied_within_model_precision`/`tie_group_size` fields, which answer "is
THIS candidate tied" — this module answers the global question once).
Produces `evaluatedCandidates`, `uniqueScores` (sequential score
clustering using the SAME ±2-point epsilon `canonical/scoring.js` already
defaults to — one tie definition, not two), `topScoreTieCount`,
`activeFeatures`/`zeroVarianceFeatures` (which `score_breakdown`
sub-factors actually vary vs. are dead weight across the candidate set),
and `rankingConfidence` (HIGH/MEDIUM/LOW/NONE). Thresholds are a
documented judgment call, not hidden: LOW when ≥3 candidates tie within
epsilon at the top score OR fewer than 1/3 of the run's sub-factors are
active; MEDIUM at exactly 2 tied at the top OR <2/3 active; NONE for
fewer than 2 candidates evaluated; HIGH otherwise. Exposed as the new
top-level `ranking_diagnostics` response field, plus
`tied_screening_group`/`tie_group_size` columns on
`candidate_comparison_table`. `CandidateTable.jsx`'s rank cell now shows
a "tied×N" badge for 3-way-or-more ties, with a tooltip explaining the
rank number is display order at that point, not an individual
engineering rank.

**Item 2 — ground-system alternatives typing** (commit `7307127`).
`canonical/groundSystem.js` already carried a `role` field
(`SELECTED`/`ALTERNATIVE`) on every scenario from earlier work on this
branch. Added `recommendationStatus` as an explicit alias using the
spec's requested field name, rather than renaming the existing `role`
field. `NOT_RECOMMENDED` is never emitted: the module is deliberately
decision-free (see its own file header) and has no rule basis to
disqualify the `COMPACT` or `EXTENDED` scenarios — inventing that
judgment without a rule basis was explicitly out of scope, per this
item's own instruction ("only if the rule engine already has a basis for
this"). Separately, `CandidateDetailDrawer.jsx`'s
`ground_system_design_guide` panel (a distinct, guide-internal scenario
list — NOT the same data as `canonical.groundSystem`, different field
names entirely) previously highlighted its first row with color only and
no text label, implying it was "the" recommended design; it now carries
an explicit "ALTERNATIVE" tag on every row plus a note pointing at the
canonical selected design (already the source for the comparison table,
filing autofill, and `tower_reference` since Phase 1) as authoritative.

**Item 3 — baseline-vs-candidate delta framing** (commit `7307127`,
investigated first as instructed). **Confirmed real bug, not
already-handled:** the current/authorized site is scored and ranked
through the identical `scoreCandidate()` pipeline as every relocation
candidate (`baseline = scored.find(c => coordsEqual(c, current_site))` —
literally the same array element, not a separate object) and can land at
**any** rank, including #1, with nothing distinguishing it from a
genuine relocation recommendation. Verified against a live KAZM run
(`{frequency_khz:780, current_site:{34.86,-111.82}, tpo_kw:5, fcc_class:D}`):
the baseline scored rank 1, and `candidate_shortlist` was generating
"Advance to full §73.182 NIF study and parcel investigation" — nonsensical
relocation advice for the operator's own already-authorized, already-built
site. Fixes:
- Added `c.is_baseline` (object-identity match against the same
  `baseline` reference every existing delta computation already uses —
  consistent with, not independent from, `canonical.scenario.
  operatingScenario === CURRENT_AUTHORIZED_BASELINE` from Phase 2).
- `candidate_shortlist` now excludes `is_baseline` rows before building
  recommendation actions.
- `buildTopSummary()` leads with "Current site (baseline) scores X.X...
  no relocation candidate in this search beat the status quo" instead of
  "Rank 1 scores X.X..." when the top-scoring row is the baseline.
- Extended the **already-existing** per-candidate `delta` object (score,
  population, COL field, conductivity, COL coverage, daytime reach vs.
  baseline, from earlier work on this branch) with
  `cost_low_usd_delta`/`cost_high_usd_delta` (from `canonical.costs.total`),
  `timeline_weeks_to_filing_delta` (from `compliance_pathway.
  estimated_weeks_to_filing`), and a `confidence_tier_changed` flag
  (`score_confidence`) — extended the existing structure per the
  instruction to "use existing baseline data already computed elsewhere,"
  rather than adding a redundant new `baseline_delta` field duplicating
  it.
- `CandidateTable.jsx`'s rank cell shows a "baseline" badge (distinct
  color from the tie badge) for the baseline row.
- One `amSiteOptimizer.test.js` assertion hardcoded "summary must mention
  Rank 1" — with the KAZM fixture, rank 1 genuinely IS the baseline in
  that test's configuration, so the corrected (and now actual) text is
  "Current site (baseline)...". The test now checks for whichever framing
  is actually correct for that run's real top-scoring row, rather than
  the prior fixed assumption.

**Not touched (deliberately, per the Phase 3 scope boundary):** the
cost/schedule dependency graph, developer truth panel, and LLM narrative
guardrails — explicitly reserved for a later phase. `OptimizerMap.jsx`'s
map markers (which also use `rankColor(c.rank)`) were not given a
baseline/tie visual treatment — only `CandidateTable.jsx`, the primary
ranked list, was in scope ("candidate list/table, wherever rank is
displayed" was interpreted as the table; the map is a supplementary
visualization, not re-audited here).

## Phase 3 test counts

| Suite | Result |
|---|---|
| `src/tests/canonicalRankingDiagnostics.test.js` (new) | 9/9 pass |
| `src/tests/canonicalPipeline.test.js` (groundSystem `recommendationStatus` addition) | 23/23 pass |
| `src/tests/canonicalReconciliation/Scenario/RankingDiagnostics/Contract/Pipeline/Core/Rules` combined | 143/143 pass |
| `src/tests/amSiteOptimizer.test.js` (re-run after Phase 3) | 1901/1901 pass |
| **Full repo suite**, re-run after Phase 3 | 4517 total — 4471 pass, 39 fail, 7 skipped. 23 are the same pre-existing `countyBoundary.test.js` docker-fixture failures as every prior run; the other 16 are `api.test.js` tests that need a live server/`DATABASE_URL` — this run counted them as failures rather than skips (an environment-timing difference between runs, not a regression: confirmed none of the 39 failing tests touch `siteOptimizer.js`, `colocationOpportunities.js`, any `canonical/*` file, or the two UI files changed in Phase 3). |

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
