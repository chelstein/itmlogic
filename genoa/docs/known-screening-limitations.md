# Known screening limitations

What the screening pipeline honestly does not know, where each proxy
lives, and what upgrades it to engineering/filing grade. The canonical
pipeline's job is not to hide these — it labels them (`SCREENING`/`LOW`
tiers, WARN-capped verdicts, `NOT_EVALUATED` states) and gates
recommendations on them (`recommendation.js` gate ladder).

## 1. Population is a density proxy

Screening population figures come from regional-density × area estimates
(`siteOptimizer.js`: "π × r² × regional density proxy / US population",
"National-density proxy × land-use class × distance factor"), not
Census-block sums — `population_basis_tier: 'LOW'` in the KAZM fixture.
Consequences: the §73.24(g) blanket verdict is capped at WARN
(`rules/blanket.js` proxy detection), and any **§1.1153 annual-fee tier
selected from this population is an estimate** — the tiers span 9
population brackets (`ANNUAL_REG_FEES_1153` in `regulatoryConstants.js`),
and `amAnnualRegFeeUsd()` returns an honest min–max range when population
is undetermined. **Upgrade:** Census-block (ACS/decennial) population
inside actual computed contours → ENGINEERING/FILING grade.

## 2. 10-km disc COL proxy

Without `community_of_license_polygon`, COL coverage uses a 10-km disc
centered on the current site (or `col_centroid`) — see the explicit
warnings in `siteOptimizer.js` (~lines 380–409). The legacy path issued
hard NON_COMPLIANT verdicts from this disc (origins §13); canonically the
COL geometry tier drops to LOW when `col_polygon_present !== true`
(`buildCanonicalCandidateResult.js` `inputTiers.colGeometry`).
**Upgrade:** supply the GeoJSON COL polygon → polygon-overlap analysis,
§73.24(i) filing-grade.

## 3. Conductivity ±50% zone fallback

Ground conductivity falls back to zone-table values when no M3 raster is
available; even an M3 map read is ±50% (`sigma_source_tier: 'SCREENING'`).
It drives ground loss, efficiency, and contour distances. **Upgrade:**
path-weighted M3 conductivity (see `pathWeightedSigma.test.js`) →
ENGINEERING; measured radial conductivity per §73.186 → FILING.

## 4. Class-default tower heights drive ASR/FAA screening answers

When neither `requested_height_m` nor `host_structure_height_m` is
supplied, `deriveAntennaDesign()` selects a class-typical default (5/8λ
for A/B, 3/8λ for C/D, `selectionBasis: 'CLASS_TYPICAL_DEFAULT'`,
SCREENING tier). The §17.7 ASR trigger and FAA Form 7460-1 answer
(`rules/asrFaa.js`) are then facts about a synthetic height. Additionally,
the §17.7(c) airport-proximity prong stays UNKNOWN/PARTIAL until checked.
**Upgrade:** an operator-committed or surveyed design height plus an
airport-surface check → ENGINEERING; FAA determination → FILING.

## 5. No external-station spacing study

`rules/currentSiteOverlap.js` returns `externalSpacingStudy` as
`required: true`, `state: NOT_EVALUATED`, `completion: NOT_RUN` for every
candidate — no screening output ever claims §73.37/§73.182 spacing
compliance against other licensed facilities (the legacy code misapplied
mileage tables to the station's own site, origins §9). **Upgrade:** a
full co-channel/adjacent-channel study against the licensed-facility
database.

## 6. Nighttime NIF is not run in screening

`rules/nighttimeInterference.js` determines only whether a study is
*required*; with `night_study_present: false` the state is
`NOT_EVALUATED` and it is a filing-readiness blocker. Nighttime compliance
is never inferred from daytime screening. **Upgrade:** run the actual
RSS/NIF solver (`nifContour.js` via `nightOrchestrator.js`).

## 7. Berry skywave is screening-grade; FCCAM is filing-grade

`nightOrchestrator.js` prefers the FCCAM sidecar and falls back to Berry
(1968) only so exhibits can flag `FCCAM_UNAVAILABLE_BERRY_FALLBACK`;
`skywave.js` deliberately does **not** swap to a Berry/NEC fallback for
exhibit fields. Berry-based night numbers are screening-grade. **Upgrade:**
FCCAM (§73.190 figures / FCC skywave method) for all filed nighttime
showings.

## 8. Wildfire and land-use are geographic proxies

Wildfire risk is a four-region geographic proxy (`wildfireRiskLevel()` in
`siteOptimizer.js` — Western/PNW/SE/Midwest zones), yet the legacy path
let it emit NEPA `ea_required` flags (origins §13). `land_use_class` is
itself a proxy computed from distance + conductivity, and it cascades into
lease tiers, access costs, and environmental cost tiers
(`canonical/costModel.js` uses it for the RURAL/SUBURBAN/URBAN pricing
branches). **Upgrade:** USFS FIA / LANDFIRE raster data for parcel-level
fire risk; actual parcel/zoning records (`parcel_data_present`) for land
use — also the gate-P prerequisite for advancing past
ADVANCE_TO_FIELD_VALIDATION in `recommendation.js`.

---

Because `engineeringDataConfidence` is the **minimum** of input tiers and
`filingReadiness` enumerates every blocker, none of these limitations can
be papered over by strengths elsewhere: a candidate with a density-proxy
population and no NIF study can be recommended at most for a desk study,
never called filing-ready (validation invariant *h*).
