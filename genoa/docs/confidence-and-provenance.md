# Confidence and provenance

How the canonical pipeline says what it knows, how well it knows it, and
what it does not know yet. Modules: `src/engine/am/canonical/types.js`,
`confidence.js`, `formatters.js`;
`src/engine/regulatory/regulatoryConstants.js`.

## The EngineeringValue contract

Every derived fact is built through `ev()` (`types.js`) and is a frozen
`{value, unit, source, confidence, assumptions, uncertainty}` record.
Provenance is **mandatory**: `ev()` throws unless `source` is a non-empty
string and `confidence` is a known tier. A number with no origin cannot
exist in a canonical result.

## Tier vocabulary

`CONFIDENCE_TIERS` (`types.js`): `FILING_GRADE` > `ENGINEERING_GRADE` >
`SCREENING` > `LOW` (ranked in `confidence.js` `TIER_RANK`). Tiers label
individual values *and* whole candidate axes.

## The four confidence axes — never collapsed

`deriveConfidence()` (`confidence.js`) returns four axes side by side,
with deliberately **no** overall/combined score. Collapsing them is what
produced the legacy defects (origins §10: a layer-counting
`optimization_confidence` that a proxy layer could *raise*, and a
compliance verdict wearing the word "confidence").

| Axis | Question it answers | How it is computed |
|---|---|---|
| `rankingSignalQuality` | How trustworthy is the ORDERING of candidates? | Agreement among independent (non-proxy) scoring layers only; `isProxy: true` layers are counted and reported but excluded by construction — a proxy can never raise this axis |
| `engineeringDataConfidence` | How good are the physical INPUTS? | Minimum tier across `{conductivitySource, colGeometry, populationBasis}`; missing input counts as LOW; reports `limitedBy` |
| `regulatoryCompleteness` | What fraction of required decisions actually RAN? | `completedCount / requiredCount` over decisions with `required === true` and `completion === 'RUN'`; names `pendingDecisions` |
| `filingReadiness` | Can this candidate be filed today — and if not, exactly what blocks it? | `ready` only when no required decision is NOT_RUN/UNKNOWN, no screening-or-lower input remains where filing grade is required, and invariant validation passed; otherwise an explicit `blockers[]` list |

What they must never be collapsed into: a single "confidence %" — a
well-ranked candidate with screening inputs, a filing-ready candidate with
a shaky ranking, and an unvalidated candidate are three different
situations that one number cannot distinguish.

## Freshness gate on regulatory constants

Every catalog in `regulatoryConstants.js` carries `cite`, the Federal
Register amendment, and `verified_at` (last checked against the codified
CFR — currently 2026-07-03). `regulatoryConstants.test.js` fails the build
when any `verified_at` is older than `MAX_VERIFICATION_AGE_DAYS` (365) —
the audit found a fee set two amendment cycles stale despite being
internally consistent and cited.

## Rounding-by-confidence formatters

`formatters.js` coarsens SCREENING/LOW values at render time so a ±50%
estimate cannot masquerade as a filing-grade figure:
- `approx(value, tier)` / `approxString(value, tier)` — 3 significant
  figures with an explicit `≈` marker for coarse tiers
  (`approxString(319482, 'SCREENING') → '≈319,000'`);
- `costRangeString(low, high, tier)` — `'$540K–$990K'` for coarse tiers,
  exact figures otherwise;
- `scoreString(score, band)` — `'64 ± 27'`;
- unit guards: `assertFraction()`, `percentToFraction()`,
  `fractionToPercentString()` (canonical internal unit is the decimal
  fraction; percent exists only at the formatting edge).

## Output classification

| Class | Outputs |
|---|---|
| **Authoritative** | Regulatory constants catalog (`APPLICATION_FEES_1104`, `ANNUAL_REG_FEES_1153`, `ASR_THRESHOLD_17_7`, `MPE_LIMITS_1_1310`, …) under the freshness gate; the CFR rule logic in `rules/*` (requirement predicates and thresholds); wavelength / λ-fraction reference values and coordinate formatting (FILING_GRADE `ev`s) |
| **Modeled (engineering-grade)** | Operator-`requested_height_m` as the selected design height (ENGINEERING_GRADE); non-proxy census-based blanket population when supplied |
| **Screening-grade** | Density-proxy population (`population_basis_tier: 'LOW'` in the KAZM fixture — the weakest input); disc-proxy COL coverage fraction; class-default tower height (`CLASS_TYPICAL_DEFAULT` selection basis) and everything it drives (ASR/FAA screening answers, tower costs); zone-table conductivity (±50%, `sigma_source_tier: 'SCREENING'`); Terman ground loss and efficiency estimate; OET-65 distances; the entire cost model (`confidence: SCREENING`) |
| **Placeholders** | The 3 m `MIN_PRACTICAL_FENCE_M` when the MPE distance is unavailable (explicitly "NOT a compliance result"); §1.1153 fee tier selections made from proxy population (`amAnnualRegFeeUsd()` returns an honest min–max range when population is undetermined) |
| **Not yet evaluated** | NIF result until the nighttime study runs (`regulatory.nif` is `NOT_EVALUATED`/`NOT_RUN`, never inferred from daytime screening); `externalSpacingStudy` (always `NOT_EVALUATED` at screening); blanket verdict when no population figure was computed; the §17.7(c) airport prong when `nearAirportTrigger` is null |
