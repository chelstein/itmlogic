# Engineering data flow — the canonical candidate pipeline

How one AM relocation candidate becomes one internally consistent result.
The pipeline lives in `src/engine/am/canonical/` and is assembled by a
single call: `buildCanonicalCandidateResult()` in
`src/engine/am/canonical/buildCanonicalCandidateResult.js`.

## Staged pipeline

```
raw station data ─► normalized station facts ─► candidate geometry
      ─► propagation (INPUT, never recomputed)
      ─► antenna design ─► regulatory rule evaluation
      ─► ground system ─► cost model
      ─► confidence / uncertainty ─► scoring ─► recommendation
      ─► validation ─► canonical candidate result
      ─► UI / exports / narratives
```

(Antenna design runs immediately before the regulatory rules because the
ASR/FAA and RF-exposure rules take `selectedDesignHeightM` as their single
height input; the design derivation is pure wavelength/class geometry.)

| Stage | Module | INPUT vs computed |
|---|---|---|
| Normalized station facts | `buildCanonicalCandidateResult.js` (Stage 1) | INPUT: `station.frequency_khz`, `fcc_class`, `tpo_kw` (both frequency and TPO are **required** — no silent `?? 5` / `?? 1` defaults; see contradiction audit §12) |
| Candidate geometry | Stage 2 + `formatters.js` | INPUT: lat/lon; computed: `distance_from_current_km` via `greatCircleKm` (from `../skywave.js`) when not supplied, formatted coordinates |
| Propagation | Stage 3, wrapped by `propEv()` | **INPUT only.** `coverage_fraction`, `blanket_population_fraction`, `contour_distances_km`, `sigma_msm` arrive with provenance from the propagation engine. The result carries `propagation.recomputed: false` — this stage never recomputes physics |
| Antenna design | `antennaDesign.js` → `deriveAntennaDesign()` | Computed: `wavelengthM`, λ/4 and 5/8λ **reference** values, and the one `selectedDesignHeightM` (priority: requested → host structure → class-typical default) |
| Regulatory rules | `rules/*.js` (all seven; see `docs/regulatory-rule-engine.md`) | Computed: one `RegulatoryDecision` per question, collected in the flat `result.regulatory` block |
| Ground system | `groundSystem.js` → `deriveGroundSystem()` | Computed: one SELECTED scenario (STANDARD_120 / COMPACT / EXTENDED), Terman ground-loss estimate, efficiency estimate |
| Cost model | `costModel.js` → `buildCostModel()` | Computed: 11 components, one total (see `docs/cost-model.md`) |
| Confidence | `confidence.js` → `deriveConfidence()` | Computed: four separated axes (see `docs/confidence-and-provenance.md`) |
| Scoring context | `scoring.js` → `deriveScoringContext()` | INPUT: `scoringInputs` (scores from the optimizer run); computed: tie detection, noise-floor-honest display label |
| Recommendation | `recommendation.js` → `deriveRecommendation()` | Computed: gate-ladder level; no independent engineering logic |
| Validation | `validation.js` → `validateCandidateResult()` | Computed: invariant report, attached at `result.validation` (runs twice — once pre-recommendation, once on the final result) |

## Single-writer principle

Every fact has exactly one writer. `selectedDesignHeightM` is written by
`deriveAntennaDesign()` and read — never re-derived — by the ASR/FAA rule,
the RF-exposure rule, and the tower cost line (validation invariant *d*
enforces this). `selectedScenario.radialCount` is written by
`deriveGroundSystem()` and is the only radial count allowed to feed costs
(invariant *e*). Regulatory numbers come only from
`src/engine/regulatory/regulatoryConstants.js`. This is the direct
remediation of the root cause in
`docs/architecture-contradiction-origins.md`: ~332 guide IIFEs each
re-deriving the same facts locally.

Every derived fact is wrapped in an `EngineeringValue` (`ev()` in
`types.js`) carrying `{value, unit, source, confidence, assumptions,
uncertainty}` — construction throws if `source` or `confidence` is missing.

## Integration state (honest)

- The canonical assembler is **implemented and tested**
  (`src/tests/canonicalPipeline.test.js`, `canonicalCore.test.js`,
  `canonicalRules.test.js`, against the KAZM fixture in
  `src/tests/fixtures/kazmCanonical.js`), producing the
  `schema: 'canonical-candidate-result/1'` record with attached
  `.validation`. It is not yet invoked from the production
  `siteOptimizer.js` scoring path — attaching the canonical result per
  candidate in `scoreCandidate()` output is the wiring step.
- The legacy guide IIFEs inside `scoreCandidate()`
  (`src/engine/am/siteOptimizer.js`) **still emit their own sections**,
  with the divergences catalogued in
  `docs/architecture-contradiction-origins.md`.
- Guide decomposition per `src/engine/am/guides/README.md` has begun:
  three modules (`amSiteAccessibilityAndAdaComplianceGuide.js`,
  `amGroundSystemAndRadialFieldInstallationGuide.js`,
  `amFaaTowerLightingAndObstructionMarkingGuide.js`) are extracted and
  registered in `guides/index.js` (`GUIDE_BUILDERS`, duplicate keys throw
  at import time), but `scoreCandidate()` has not yet swapped its inline
  IIFEs for the registry calls. With ~265 guides remaining inline, this
  migration has a long tail; each tranche must stay behavior-neutral under
  the full `amSiteOptimizer` suite.
