# Regulatory rule engine — one rule function per decision

Modules: `src/engine/am/canonical/rules/*.js`, contract in
`src/engine/am/canonical/types.js`. Each regulatory question is answered
by exactly one exported function returning a `RegulatoryDecision`; the
divergent legacy predicates each module replaces are catalogued in
`docs/architecture-contradiction-origins.md` (section numbers cited below).

## The RegulatoryDecision contract

Built only through `decision()` (`types.js`), which returns a frozen record:

| Field | Meaning |
|---|---|
| `state` | Outcome: `PASS \| FAIL \| WARN \| NOT_REQUIRED \| NOT_EVALUATED \| UNKNOWN` |
| `required` | Is the rule applicable — `true` / `false` / `null` (unknown) |
| `completion` | Did the evaluation machinery actually run: `RUN \| NOT_RUN \| PARTIAL` |
| `result` | Detailed evaluation result (an `EvaluationState`) |
| `ruleReferences` | CFR/rule citations |
| `rationale` | Mandatory non-empty human-readable explanation, naming its inputs |
| `blockers` | What prevents completion |
| `inputsUsed` | The inputs, ideally as `EngineeringValue`s |

**Construction-time contradiction rejection:** `decision()` throws a
`RangeError` when `required === true` is combined with
`state === 'NOT_REQUIRED'` — the exact contradiction class the audit found
live in production output (invariant *a* in `validation.js` double-checks
the assembled result). Requirement, completion, and result are three
distinct facts: "required but not run" is representable and is never
collapsed into a pass or a fail.

## The rule modules

### `nighttimeInterference.js` — `evaluateNighttimeInterferenceRequirement()`
Basis: 47 CFR §73.182 / §73.37 (plus §73.182(o)/§73.27 for the exemption,
§73.25/§73.182(k) for clear-channel secondaries). One predicate: a NIF
study is required for **all** classes except Class C on a §73.27 local
channel. Clear-channel secondaries (non-Class-A on §73.25) get a note that
DA-N is likely. It never runs the RSS solver (that is `nifContour.js` /
`nightOrchestrator.js`) and never infers nighttime compliance from daytime
screening — no study means `NOT_EVALUATED`. Replaces the five divergent
predicates and the invented nighttime authority of origins §3.

### `antennaMode.js` — `normalizeAntennaMode()`, `resolveAntennaModes()`, `isDirectionalMode()`
One normalizer (`RAW_MODE_MAP`) to the canonical
`NDA | DA_DAY | DA_NIGHT | DA_DAY_AND_NIGHT` vocabulary; unrecognized
tokens map to `null` with a warning (never guessed). Keeps four facts
separate: `patternModeLicensed`, `patternModeAssumed`,
`patternModeRequired`, `patternModeModeled`, plus a `filingImpact`
decision when required ≠ modeled. The single "DA required" rule
(clear-channel secondary → DA-N likely, WARN-grade) replaces the four
vocabularies and four DA heuristics of origins §8.

### `proofOfPerformance.js` — `evaluateProofRequirement()`
Keyed solely off the canonical modeled mode. DA → `DA_FULL_PROOF`;
NDA → `NDA_FIELD_PROOF`; unknown mode → `UNKNOWN` (refuses to guess).
Replaces origins §4, where NDA was simultaneously "8-radial proof",
"no proof", and "required if <120 radials", and DA radials ranged 16/24/72.

**CFR-verified corrections** (constants in the module):
- DA proof: `DA_RADIALS_MIN = 6`, `DA_RADIALS_MAX = 12` — §73.151(a)
  requires field-strength measurements on 6 radials for simple patterns,
  up to 12 for complex ones. The legacy "72 radials" conflated the **72
  five-degree tabulated pattern azimuths of §73.150** with measurement
  radials.
- NDA proof: `NDA_RADIALS_MIN = 6`, `NDA_MEASUREMENTS_PER_RADIAL = 15` —
  §73.186(a)(1): six or more radials, at least 15 measurements per radial.
  The legacy "8 radials per §73.154(b)" confused the **partial-proof
  per-radial measurement count** (§73.154 governs post-licensing partial
  proofs, ≥8 measurements per radial) with the initial-proof radial count.
- §73.151(c) moment-method modeling is noted as the alternative for
  series-fed DA arrays, never auto-selected.

### `asrFaa.js` — `evaluateAsrFaa()`
Basis: 47 CFR §17.7 / 14 CFR §77.9. Exactly one height input —
`selectedDesignHeightM` — compared **strictly greater than**
`ASR_THRESHOLD_17_7.height_m` (60.96 m / 200 ft, from the constants
catalog), per §17.7(a) "more than". The §17.7(c) airport-proximity prong
is `UNKNOWN`/`PARTIAL` when `nearAirportTrigger` is null, never silently
false. Returns both `asr` and `faaNotice` (Form 7460-1) decisions.
Replaces the divergent height bases and `>=`/`>` drift of origins §6.

### `rfExposure.js` — `evaluateRfExposure()`
Basis: 47 CFR §1.1307(a)(4) / §1.1310 via OET Bulletin 65. All distances
come from `src/engine/regulatory/oet65.js` (`complianceDistance_m`,
`nearFieldBoundary_m`) — no local formulas. Four individually labeled
distances; the λ/2π reactive near-field boundary is explicitly labeled
"NOT a fence distance". Evaluation required when radiated power >
`ROUTINE_EVALUATION_ERP_KW` (1 kW); at or below, exemption is never
assumed. Replaces the five ad-hoc fence formulas and the λ/2π conflation
of origins §5.

### `blanket.js` — `evaluateBlanket()`
Basis: 47 CFR §73.24(g). Canonical unit is a **fraction**
(`BLANKET_LIMIT_FRACTION = 0.01` = 1%); values outside [0, 1] throw
(percent leaks must pass `fromPercent()` at the boundary). A proxy
population basis (matched by `/proxy|density|heuristic|estimate|surrogate/i`)
caps the decision at WARN — proxies can flag risk but never issue a
verified PASS/FAIL. Replaces the fraction/percent collision of origins §7.

### `currentSiteOverlap.js` — `evaluateCurrentSiteRelationship()`
Distance to the station's **own** current site is reframed as
transition planning (construction overlap, temporary simultaneous
operation, STA coordination, shutdown sequencing) with deliberately empty
`ruleReferences` — no CFR spacing rule applies to the own-site distance.
The real spacing question is returned separately as
`externalSpacingStudy`: `required: true`, `NOT_EVALUATED`, `NOT_RUN` until
a full §73.37/§73.182 co-/adjacent-channel study against external
facilities runs. Replaces the misapplied mileage tables of origins §9.
