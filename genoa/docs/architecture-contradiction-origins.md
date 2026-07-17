# AM Relocation Optimizer — where the contradictions originate

Mapping date: 2026-07-03.  Produced by three exhaustive read-only sweeps of
`src/engine/am/siteOptimizer.js` (34,237 lines, ~332 named guide IIFEs inside
`scoreCandidate()`), `colocationOpportunities.js`, the extracted
`guides/*.js`, `m3.js`, the UI (`src/components/ui/SiteOptimizer/`), and the
exports layer.  This note explains the mechanism behind every contradiction
class; the canonical-result pipeline (`src/engine/am/canonical/`) is the
remediation.

## Root cause (one sentence)

Every guide IIFE closes over the same raw primitives (`frequency_khz`,
`tpo_kw`, `fcc_class`, `pattern_mode`, `sigma_msm`, `coverage_pct`,
`blanket_population_pct`, `pt.distance_from_current_km`) and then
**re-derives** wavelength, tower height, radial spec, DA-ness, NIF
requirement, proof type, MPE distance, and ASR trigger locally — each with
its own constants, defaults, and units — instead of reading shared,
provenance-carrying candidate facts.

## Contradiction mechanisms by domain

1. **Tower height** — the class design rule (5/8λ A/B, 3/8λ C/D) is
   re-implemented ~45 times; a λ/4 family coexists
   (`am_antenna_electrical_design_and_efficiency_guide`,
   `am_coverage_optimization_by_tower_height_guide`, DA array elements, and
   the colocation summary derives ASR from λ/4); the exhibit pipeline uses a
   fourth basis (ASR-registered actual height).  Efficiency tables for the
   same heights disagree (λ/4 = 0.78 in one menu, baseline 1.00 in another).
   Variables named `qw_m`/`qwave_gs_m` hold non-quarter-wave values.

2. **Ground system** — radial count for one candidate: 120 (most sites),
   class-map {A/B 120, C 90, D 60-or-90} (two guides), 160-if-DA (one), 60
   economy, 30 urban, 90 rollup, σ-tiered {120/90/60}.  Radial length: 0.35λ
   dominant, λ/4, λ/8 minimum, 1.5×0.35λ, and 0.4×tower-height (zoning).
   Three incompatible ground-loss formulas (Terman `120ρ/NL`;
   `1.65/(N·σ·10⁻³)`; Brown–Lewis–Epstein `100–300/N`).

3. **NIF requirement** — five divergent predicates: `!isLocal`;
   `!isLocal && class≠C`; `isClear || (!isLocal && class≠C)`;
   `isClear && class≠A` (regional class B gets NO night study in that guide);
   "always required".  One guide invents nighttime authority
   (`night power = clear ? 0 : tpo×0.1`).  Colocation fabricates `nif_status`
   from the *score category*.  None of them call the real solver
   (`nifContour.js`) that the exhibit/filing path uses — screening and filing
   therefore use different NIF facts.

4. **Proof of performance** — NDA is simultaneously "8-radial proof
   required" (3+ sites), "no proof required" (2 sites), and "required if
   <120 radials" (1 site).  DA proof radials: 72 in four sites vs 16/24 in
   another.  One guide decides DA from `pattern_mode`, another infers it from
   clear-channel frequency — the same candidate can be told both DA-proof and
   NDA-proof.

5. **RF exposure** — requirement gate: always / TPO≥5 kW / ERP≥5 kW (the
   canonical §1.1307(b) threshold is >1 kW).  Five fence-distance formulas
   (√(P/4πS); √(30PG)/E; base-current 60·i/E; (1/2π)√(PG/Sη);
   10%-of-tower-height; plus a guy-radius square with no RF basis) — none
   call `regulatory/oet65.js`, which colocation and the PDF report do use.
   λ/2π (reactive near-field) is conflated with fencing distance.

6. **ASR/FAA** — the 60.96 m threshold is (mostly) shared, but the HEIGHT it
   is compared against is not: class design height vs λ/4 vs per-tier menus;
   plus hardcoded 60 m at one site and `>=` vs `>` comparator drift.  One
   response can carry `asr_registration_required_at_quarter_wave = false`
   beside guide-level `asr_required = true`.

7. **Blanket area** — the optimizer computes PERCENT of US population
   (limit constant 1.0); the canonical §73.24(g) module uses a FRACTION
   (0.01) of the population inside the 25 mV/m contour — different unit AND
   different denominator for "the same" 1% rule.  Two in-file density bases
   produce two blanket numbers per candidate.  The UI multiplies the percent
   by 100 again in one table ("60% (limit 100%)").  A fraction/percent mixup
   makes the gate-summary DA proxy a dead branch.

8. **Antenna mode** — four vocabularies (`NDA|DA-D|DA-N|DA-2` input;
   `ND/DA-3` in daModalClassification; `omni|DA` in nightOrchestrator;
   pattern-table-presence in form301am).  DA is decided by anchored regex,
   unanchored regex, frequency-class inference (overriding operator input),
   and four different "DA recommended" heuristics — one of which is a dead
   branch due to the unit mixup in (7).

9. **§73.37 spacing vs own site** — three different mileage tables plus a
   contour-overlap framing are all applied to `distance_from_current_km`,
   i.e. against the station's OWN current site, producing eligibility
   verdicts a real external-station study could reverse.
   `distance_from_current_km` also silently drives land-use density, lease
   tier, line-length proxy, and aux-antenna logic.

10. **Scoring/confidence** — two parallel uncertainty systems (a
    multiplicative 0.97/0.93 haircut baked into `score_final` AND an
    additive ±12–27 pt band around it); ties are ranked by grid insertion
    order and never represented; `optimization_confidence` counts enabled
    goal LAYERS (adding a proxy layer RAISES confidence);
    `site_viability_summary.confidence` is a compliance verdict wearing the
    word "confidence"; colocation duplicates the categorizer with different
    rules under the same enum and overwrites `nif_status` with it.

11. **Cost totals** — five guides each publish a "grand/project total" with
    different component sets (11-item dynamic / 17-item STATIC that ignores
    inputs / 9-category no-land / 7-item 90-radial / 10-item with land+EAS);
    the drawer renders three of them as headline totals and the
    recommendation engine's cost tier reads a sixth (soft+hard only).

12. **Defaults divergence** — `tpo_kw ?? 5` vs `?? 1` (5×);
    seven conductivity schemes (4 canonical / 2 / 5 / 8 / zone buckets /
    getSigma buckets / σ-reused-as-terrain-meters); four
    `distance_from_current_km` defaults (0/10/20/25); fallback coordinates
    scattered across four states; `_m3.filing_grade || 'filing'` silently
    promotes raster hits to filing grade because m3.js never emits the key.

13. **Placeholder flow** — proxy population selects exact §1.1153 fee tiers
    at six sites; the disc-proxy COL geometry issues hard NON_COMPLIANT
    verdicts; synthetic λ-fraction heights drive real FAA/ASR booleans;
    a 4-box wildfire proxy emits NEPA `ea_required` flags; screening σ (±50%)
    flows into 0.01-kW/0.01-mV/m-precision outputs.

## Remediation

`src/engine/am/canonical/` implements the staged pipeline
(normalized facts → geometry → propagation → regulatory rules → antenna
design → costs → confidence → canonical result) with:
- one derivation per fact, carrying `{ value, unit, source, confidence,
  assumptions }` provenance;
- one rule function per regulatory decision returning
  `{ state, required, completion, ruleReferences, rationale, blockers }`;
- an invariant validation layer that refuses to render internally
  inconsistent candidates;
- shared formatters (coordinates, percentages) and confidence axes
  (`rankingSignalQuality`, `engineeringDataConfidence`,
  `regulatoryCompleteness`, `filingReadiness`).

See `docs/engineering-data-flow.md`, `docs/regulatory-rule-engine.md`,
`docs/confidence-and-provenance.md`, `docs/cost-model.md`,
`docs/known-screening-limitations.md` for the target architecture.
