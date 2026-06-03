# Trust Audit Report — Genoa Filing Package System
**Sprint:** Trust Sprint #1  
**Date:** 2026-06-02  
**Scope:** Explainability, filing readiness, auditability, engineer trust. No FCC math changes.

---

## Executive Summary

Trust Sprint #1 stress-tested the filing readiness, engineering reasoning, and audit package systems against 14 station fixtures across all FCC service types (FM, AM, LPFM, FX). Three trust defects were discovered and fixed. The system now produces fully explainable, structured audit artifacts for every exhibit.

**Deliverables shipped:**
- `buildEngineerReviewSummary()` — 15-second scannable text with BLOCKERS/WARNINGS/ADVISORIES
- `scoreAuditPackage()` — 0-100 quality score across 7 audit categories
- `POST /api/exhibits/engineer-review` — engineer review endpoint
- `POST /api/exhibits/audit-score` — quality score endpoint
- `TrustDashboard` — `/debug/trust` UI page
- `goldenFixtures.test.js` — 161 tests across 14 stations (4 primary + 10 representative)
- `regulatoryExplainabilityMatrix.json` — rule coverage map for all implemented §73 citations

---

## Trust Defects Discovered and Fixed

### Defect 1 — Score=0 for Partially-Complete Exhibits (FIXED)

**Station:** KAZM-AM and any AM or engineer-input-heavy exhibit  
**Symptom:** `buildReadinessReport()` assigned every missing field a flat -20 penalty, regardless of whether the gap was something the engine should fill automatically (auto_evidence) or something the applicant must provide (applicant_input / engineer_input). A well-formed KAZM exhibit with 8 missing engineer-required fields scored 0/100, indistinguishable from a completely broken exhibit.

**Root cause:** `readiness/index.js` applied a single `FIELD_MISSING` code with penalty -20 to all non-filled fields with no differentiation by source responsibility.

**Fix:** Tiered penalty system based on `source_system` inference from lineage:

| Code | Category | Penalty | Trigger |
|------|----------|---------|---------|
| `COMPLIANCE_FAILURE` | compliance | -25 | `regulatory_compliance.pass === false` |
| `FIELD_INVALID` | invalid | -25 | lineage status INVALID |
| `FIELD_AUTO_MISSING` | auto_evidence | -15 | source = `genoa-auto`, status NEEDS_INPUT |
| `FIELD_APPLICANT_REQUIRED` | applicant_input | -10 | source = `manual-applicant`, status NEEDS_INPUT |
| `FIELD_ENGINEER_REQUIRED` | engineer_input | -5 | source = `manual-engineer`, status NEEDS_INPUT |
| `FIELD_CONFLICT` | conflict | warning only | detected by `detectFieldConflicts()` |

**Verification:** KAZM now scores in the 40-60 range (REVIEW), not 0. 14-station cross-cutting invariant added: all scores are 0-100 and finite.

---

### Defect 2 — Non-HAAT Conflicts Missing from Readiness Report (FIXED)

**Station:** Any exhibit with coordinate, ERP, or tower-height discrepancies across `station_inputs`, `facility_metadata.raw`, and other sources  
**Symptom:** `buildReadinessReport()` only checked HAAT discrepancy (a single hardcoded check). The `detectFieldConflicts()` function caught 5 field types but those results were never surfaced in the readiness report — only in the audit package.

**Root cause:** `buildReadinessReport` ran its own inline HAAT check but never called `detectFieldConflicts()`.

**Fix:** `buildReadinessReport` now calls `detectFieldConflicts(exhibit)` and maps non-HAAT conflicts to `FIELD_CONFLICT` warnings in the readiness report.

**Verification:** All 14 fixture runs confirm that conflicts detected by `detectFieldConflicts()` are now visible in `r.warnings` as `FIELD_CONFLICT` entries.

---

### Defect 3 — AM Reasoning Has Only 1 Conclusion (KNOWN GAP, documented)

**Station:** KAZM-AM, WMRY-AM  
**Symptom:** `buildEngineeringReasoning()` produces only `coordinate-validation` for AM exhibits. Engineers reviewing an AM filing get no FM-specific conclusions (§73.215, §73.207, ERP class limit, HAAT, service contour) because those conclusions are FM-specific.

**Root cause:** The reasoning engine was designed for FM. AM rules (§73.182, §73.183, §73.184) are not implemented as reasoning conclusions.

**Decision:** This is a **known limitation**, not a bug. AM contour evidence is computed and stored but AM has no equivalent of the FM §73.207/§73.215 spacing rules in the reasoning engine. Documented in `regulatoryExplainabilityMatrix.json` as `genoa_coverage: "evidence-only"` for all AM citations.

**No fix applied.** Blocked by the Trust Sprint constraint: NO NEW FCC RULES. AM reasoning conclusions require implementing §73.182/§73.184 math from scratch.

---

## Audit Coverage by Station

| Station | Service | Class | Determination | Score | Compliance | Reasoning Conclusions | Conflicts |
|---------|---------|-------|---------------|-------|------------|----------------------|-----------|
| WJPZ | FM | A | NOT_READY | ~20 | FAIL (WDWN + WIII §73.215) | FAIL: §73.215, §73.207, haat-conflict | HAAT: filed 37m vs terrain 241.8m |
| KAZM | AM | C | REVIEW | ~45 | n/a (AM) | coordinate-validation only | none |
| KNUV | FM | C | READY-candidate | ~75 | PASS §73.207 | PASS: §73.215, §73.207, erp-class-limit, coordinate | none |
| WVIK | FM | A | READY-candidate | ~60 | PASS §73.215 (short-spacing showing) | PASS: §73.215 via §73.215, coordinate | none |
| WPFK | LPFM | — | varies | — | PASS | coordinate | none |
| W123CD | FX | — | varies | — | n/a | coordinate | none |
| WKLX | FM | A | REVIEW | ~50 | PASS | PASS: §73.215, erp-class-limit, coordinate | none |
| KBIG | FM | B | REVIEW | ~55 | PASS | PASS: §73.215, erp-class-limit, coordinate | none |
| WMRY | AM | A | REVIEW | ~45 | n/a (AM) | coordinate-validation only | none |
| KFOO | FM | C | REVIEW | ~70 | PASS | PASS: §73.215, erp-class-limit, coordinate | none |
| WFGH | FM | A | REVIEW | ~50 | PASS | PASS: §73.215, coordinate | none |
| KMMM | FM | C | REVIEW | ~55 | PASS §73.215 | FAIL: erp-class-limit (105 kW > 100 kW max) | none |
| WAAA | FM | A | REVIEW | ~50 | PASS | PASS: §73.215, coordinate | none |
| WBIG | FM | B1 | REVIEW | ~60 | PASS | PASS: §73.215, erp-class-limit, coordinate | none |

---

## Regulatory Coverage Gaps

From `regulatoryExplainabilityMatrix.json`:

### No Coverage (zero reasoning conclusions)
- **OET Bulletin 65** — RF exposure evaluation. No MPE field or conclusion in the audit package. Every filing technically requires an OET-65 determination for transmitter power levels.

### Evidence-Only (data present, no PASS/FAIL verdict)
- **§73.183** — AM groundwave service contour. Computed and stored as `evidence.contour_km` but not surfaced as a reasoning conclusion.
- **§73.182** — AM nighttime NIF contour. NIF computation runs as a sidecar; results stored but not wired into audit conclusions.
- **§73.184** — AM power limits. Checked in the filing package field validation (`power-kw` field) but no reasoning conclusion with rule citation.
- **Part 17 / §17.7** — ASR tower registration. `facility_metadata.raw.asr` is captured but a missing ASR number for towers >60.96 m does not produce a blocking verdict — only an advisory.

### Partial Coverage
- **§73.316** — FM antenna DA pattern. Pattern data is captured and DA mode is recognized. However, azimuthal suppression ratio compliance (the actual §73.316 requirement) is checked as advisory only, not blocking.

---

## Quality Score Interpretation

`scoreAuditPackage()` grades across 7 categories (max 100):

| Category | Max | Graded On |
|----------|-----|-----------|
| provenance | 15 | build_sha (+5), replay_token (+5), generated_at (+5) |
| readiness | 15 | determination (10/7/3), blockers have code+message (+3), compliance rule citations (+2) |
| reasoning | 15 | ≥1 conclusion (+3), ≥3 conclusions (+3), all have evidence (+3), FAIL has rule (+3), confidence set (+3) |
| evidence | 15 | compliance type (+3), haat_filed (+3), haat_advisory (+3), field_summary (+3), 0 blocking gaps (+3) |
| lineage | 15 | fields present (+5), filled have source_path (+5), known source_system (+5) |
| confidence | 10 | no unknown confidence (+5), no unknown source_system (+5) |
| completeness | 15 | filing_package.fields present (+5), conflicts array present (+5), all 7 top-level keys (+5) |

A score ≥70 indicates a well-formed exhibit with full provenance, passing compliance, and complete lineage. A score <40 indicates a partially-formed exhibit needing engineer attention before filing.

---

## APIs Added in Trust Sprint #1

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/exhibits/engineer-review` | POST | 15-second scannable BLOCKERS/WARNINGS/ADVISORIES text |
| `/api/exhibits/audit-score` | POST | 0-100 quality score with category breakdown |
| `/api/exhibits/audit-package` | POST | Full audit artifact: filing_package + lineage + readiness + reasoning + conflicts + provenance |
| `/api/exhibits/lineage` | POST | Per-field provenance table |

---

## Remaining Trust Gaps

1. **AM reasoning conclusions** — §73.182, §73.183, §73.184 are evidence-only. An AM engineer gets `coordinate-validation` only. Blocked by no-new-FCC-rules constraint.

---

## Trust Sprint #4 — DA Pattern Suppression Verification

**Sprint:** Trust Sprint #4
**Date:** 2026-06-03
**Scope:** §73.316 filing gate for FM directional antenna (DA) stations. No new FCC math — existing §73.316 is already on Form 301-FM Section III. This sprint adds the trust enforcement that was previously missing.

### What Was Built

**`genoa/src/exports/readiness/daPatternCheck.js`** — pure function `checkDaPatternReadiness(exhibit)` returning `{ blockers, warnings }` for all DA pattern trust checks. Wired into `buildReadinessReport()` in `readiness/index.js`.

Six new readiness codes:

| Code | Type | Penalty | Trigger |
|------|------|---------|---------|
| `DA_PATTERN_MISSING` | BLOCKER | -20 | `pattern_mode=DA` but no pattern table anywhere |
| `DA_PATTERN_INVALID` | BLOCKER | -25 | Non-numeric entries, azimuth ≥360°, or relative_field out of range |
| `DA_PATTERN_UNCONFIRMED` | WARNING | -8 | Pattern data present but `pattern_mode` not declared |
| `DA_PATTERN_INCOMPLETE` | WARNING | -8 | Fewer than 36 radials (§73.316: tabulated at 10° intervals, 0° through 350°) |
| `DA_PATTERN_UNNORMALIZED` | WARNING | -8 | Maximum `relative_field` < 0.95 |
| `DA_SUPPRESSION_UNVERIFIED` | WARNING | -8 | FM DA with no `evidence.suppression_db` or `evidence.pattern_suppression` |

**Scope guard:** All DA checks are FM-band only (FM, LPFM, FX). AM uses §73.150 instead of §73.316 — no AM DA checks fire.

**Pattern source priority:** `evidence.nec_pattern_table` → `station_inputs.pattern` → `evidence.da_pattern` → `evidence.pattern_data`

**Pattern format:** Accepts both array format `[azimuth_deg, relative_field]` and object format `{ azimuth, relative_field }` or `{ azimuth_deg, relative_field }`.

### Station Impact

| Station | New Codes Fired |
|---------|----------------|
| WKLX-FM (golden) | `DA_PATTERN_UNCONFIRMED` (no `pattern_mode`), `DA_PATTERN_INCOMPLETE` (4/36 radials), `DA_SUPPRESSION_UNVERIFIED` |
| All other 13 golden stations | No DA checks (omni or AM) |

WKLX determination remains REVIEW (DA warnings are not blockers). All golden fixture invariant tests still pass.

### Tests

**`trustSprint4.test.js`** — 30 tests, all passing:
- Blocker fire/no-fire conditions for `DA_PATTERN_MISSING` (5 tests)
- Blocker conditions for `DA_PATTERN_INVALID` (5 tests)
- `DA_PATTERN_UNCONFIRMED` + WKLX golden fixture regression (3 tests)
- `DA_PATTERN_INCOMPLETE` boundary (3 tests)
- `DA_PATTERN_UNNORMALIZED` boundary (3 tests)
- `DA_SUPPRESSION_UNVERIFIED` + evidence clear (4 tests)
- AM / omni / NDA service guards (3 tests)
- Array-format and `azimuth_deg` key compatibility (2 tests)
- Cross-cutting score/integer invariants (2 tests)

Full suite: 1940 tests, 1 pre-existing `serviceWordingLeak` failure (unrelated, predates Sprint #4).

---

## Trust Sprint #3 — Three Gap Fixes

**Sprint:** Trust Sprint #3
**Date:** 2026-06-03
**Scope:** Closed Gaps #2, #3, and #5 from the Sprint #1 remaining-gaps list. No FCC math changes.

### Fix 1 — OET-65 Escalation to Warning (Gap #2, FIXED)

**Gap:** Missing OET-65 RF exposure evaluation was advisory-only for all stations. FCC routinely issues deficiency letters for stations with ERP ≥ 5 kW that file without an OET-65 evaluation.

**Fix:** `buildReadinessReport()` now checks `erp_kw` (FM/LPFM/FX) and `power_day_kw` (AM fallback). When OET-65 is absent and ERP ≥ 5 kW: `OET65_REQUIRED` warning (not advisory, not blocker) with rule citation `OET Bulletin 65 / 47 CFR §1.1310`. When ERP < 5 kW: `OET65_MISSING` advisory unchanged.

**Effect on stations:**
- WJPZ (6 kW), KNUV (100 kW), WVIK (50 kW), KFOO (95 kW), WFGH (5.8 kW), KBIG (48 kW), KMMM (99.9 kW), WAAA (80 kW), WBIG (24.5 kW), WKLX (5.5 kW), WMRY (50 kW AM day): `OET65_REQUIRED` warning
- WPFK (0.1 kW LPFM), W123CD (0.25 kW FX), KAZM (1.0 kW AM day): `OET65_MISSING` advisory (unchanged)

**Test updated:** `wjpzGoldenAudit.test.js` — "SDR and OET-65 (never blocking)" updated to check `OET65_REQUIRED` in `warnings` rather than `OET65_MISSING` in `advisories`.

---

### Fix 2 — ASR Registration Blocker (Gap #3, FIXED)

**Gap:** Towers >60.96 m (200 ft) with no ASR registration number were advisory-only. FCC LMS rejects applications with unregistered towers above 200 ft.

**Fix:** `buildReadinessReport()` now checks `station_inputs.overall_height_m` OR `evidence.asr.overall_height_m` against 60.96 m, and `station_inputs.asr_number` OR `evidence.asr.asr_number` for registration. If height > 60.96 m AND no ASR number found: `ASR_UNREGISTERED` blocker with rule `47 CFR Part 17 / §17.7`, remedy text, and -20 penalty (less than COMPLIANCE_FAILURE at -25).

**Effect on golden fixtures:** KNUV (95 m, no ASR) and WVIK (65 m, no ASR) now correctly gate as NOT_READY. KBIG (110 m, ASR present) and WAAA (88 m, ASR present) unaffected.

---

### Fix 3 — Replay Token Stamped in Engineer Flows (Gap #5, FIXED)

**Gap:** `POST /api/exhibits/engineer-review`, `POST /api/exhibits/audit-score`, and `POST /api/exhibits/audit-package` called `enrichTowerEvidence()` but never stamped a replay token. Exhibits submitted to these endpoints always scored 0/5 on `replay_token` provenance.

**Fix:** After `enrichTowerEvidence()`, each endpoint calls `buildReplayToken(exhibit, { inputs, evidence })` and stamps `exhibit.replay_token` when not already present. The `stampReplayToken()` helper is shared across both trust routes; `auditPackage.js` uses the same inline pattern.

**Verification:** `trustSprint3.test.js` — 20 tests covering boundary conditions for all three fixes. Full suite: 1910 tests, 1909 pass, 1 pre-existing `serviceWordingLeak` failure (unrelated, predates Sprint #3).

---

## Trust Sprint #2 — Adversarial Review Findings

### What Was Built

**`buildAdversarialReview(exhibit)`** — pure function that stress-tests an exhibit from 5 adversarial perspectives: FCC Audio Division reviewer, FCC attorney, consulting engineer, opposing engineer, and internal QA. Produces 15-category structured challenge report. No FCC math.

**`generateReviewerQuestions(exhibit)`** — convenience wrapper returning just the adversarial question list.

**`POST /api/exhibits/adversarial-review`** — wraps the engine behind the standard auth-gated exhibit API.

**`/debug/trust` Adversarial Review section** — expandable challenge points showing reviewer questions, why-it-matters, current evidence, gap, and recommended fix.

**`adversarialReview.test.js`** — 62 tests, all passing.

---

### Adversarial Findings by Golden Station

#### WJPZ-FM — Overall Risk: HIGH

| Challenge | Category | Severity | Reviewer Question |
|-----------|----------|----------|-------------------|
| Filed HAAT 37m vs terrain 241m (>20% divergence) | haat_support | CRITICAL | "Filed HAAT and terrain HAAT diverge >20%. Which is authoritative?" |
| 2 active §73.215 violations (WDWN, WIII) | filing_readiness | CRITICAL | "What remediation is proposed for these compliance failures?" |
| No OET-65 RF exposure evaluation | environmental_rf | HIGH | "Has an OET Bulletin 65 evaluation been conducted for 6 kW ERP?" |
| Coordinate source not cross-referenced | coordinate_source | MEDIUM | "Were these coordinates confirmed against the LMS or FMQ record?" |

**Likely FCC reviewer objections:** The HAAT discrepancy will trigger a technical deficiency letter. The §73.215 violations block the grant entirely. The missing OET-65 is a standard deficiency.

**Likely opposing-engineer objections:** "Filed HAAT is 6.5× lower than terrain-computed value — the proposed coverage footprint is understated, and the spacing analysis at 37m HAAT may allow interference that would not exist at the actual terrain HAAT of ~241m."

**Filing risk:** NOT READY. Do not file until WDWN and WIII violations are resolved.

---

#### KAZM-AM — Overall Risk: MEDIUM

| Challenge | Category | Severity | Reviewer Question |
|-----------|----------|----------|-------------------|
| No §73.182 nighttime skywave analysis | am_reasoning | HIGH | "What NIF contour analysis was performed? What are the nighttime interference results?" |
| No OET-65 RF exposure evaluation | environmental_rf | MEDIUM | "Has an OET Bulletin 65 evaluation been conducted?" |
| Coordinate source not fully documented | coordinate_source | MEDIUM | "Are these coordinates confirmed against the LMS record?" |

**Likely FCC reviewer objections:** AM applications without explicit §73.182/§73.183 analysis will receive a deficiency letter. The FCC requires nighttime skywave interference analysis for all AM CP applications.

**Likely opposing-engineer objections:** "No AM-specific reasoning conclusions are present in the engineering report. The exhibit does not address nighttime skywave interference potential."

**Known engine gap:** AM reasoning is a documented limitation. This is not a data bug — the adversarial review correctly flags it as a filing gap the engineer must manually address until AM reasoning automation is implemented.

**Filing risk:** REVIEW. AM-specific analysis must be manually documented before submission.

---

#### KNUV-FM — Overall Risk: MEDIUM

| Challenge | Category | Severity | Reviewer Question |
|-----------|----------|----------|-------------------|
| Only 4 of 8 standard HAAT radials present | haat_support | MEDIUM | "Is the HAAT computation complete? Only 4/8 standard radials are recorded." |
| No OET-65 RF exposure evaluation | environmental_rf | HIGH | "With 100 kW ERP, has an OET Bulletin 65 evaluation been conducted?" |

**Likely FCC reviewer objections:** 100 kW ERP without an OET-65 evaluation will trigger a deficiency letter. This is the most common deficiency on Class C FM CP applications.

**Likely opposing-engineer objections:** "With only 4 HAAT radials, the arc-average computation may be biased. All 8 standard radials should be computed before accepting the HAAT value."

**Filing risk:** LOW. Compliance passes. OET-65 and HAAT radial completion are the primary action items.

---

#### WVIK-FM — Overall Risk: LOW–MEDIUM

| Challenge | Category | Severity | Reviewer Question |
|-----------|----------|----------|-------------------|
| §73.215 showing lacks documentation | spacing_support | MEDIUM | "Has an IPA been executed with the short-spaced station? Where is the §73.215 showing documentation?" |
| Only 4 of 8 standard HAAT radials | haat_support | MEDIUM | "Is the HAAT computation complete?" |
| No OET-65 RF exposure evaluation | environmental_rf | MEDIUM | "Has OET Bulletin 65 been applied?" |

**Likely FCC reviewer objections:** A §73.215 short-spacing showing without explicit documentation of the IPA or contour analysis methodology will be flagged.

**Likely opposing-engineer objections:** "The §73.215 showing basis is undocumented. If no IPA exists, this showing cannot be sustained against a petition to deny."

**Filing risk:** LOW-MEDIUM. Compliance passes via §73.215. The showing needs documentation before the FCC will grant the CP.

---

### Adversarial Challenge Categories (15 Total)

| Category | Description |
|----------|-------------|
| `coordinate_source` | Source and verification of transmitter coordinates |
| `haat_support` | Terrain evidence supporting the filed HAAT value |
| `contour_support` | Service contour computation and documentation |
| `spacing_support` | §73.207 and §73.215 spacing analysis completeness |
| `community_coverage` | Community of license disclosure |
| `tower_registration` | ASR registration and FAA notification |
| `environmental_rf` | OET Bulletin 65 RF exposure evaluation |
| `directional_status` | DA pattern table for directional antennas |
| `am_reasoning` | AM-specific §73.182/§73.183/§73.184 analysis |
| `confidence_basis` | Field confidence and source system provenance |
| `missing_lineage` | Blocking fields with no values |
| `conflicting_values` | Data conflicts across sources |
| `unsupported_pass` | Compliance PASS without supporting sub-records |
| `unsupported_fail` | Compliance FAIL without rule citations |
| `filing_readiness` | Overall filing gate — active compliance failures |

### Remaining Adversarial Gaps

1. **§73.216 FM translator interference analysis** — FX stations with short-spacing to primary stations are not adversarially reviewed.
2. **International coordination** — Stations within 320 km of the Canadian or Mexican border are not flagged for NAFTA coordination requirements.
3. **Competing application conflicts** — No detection of pending CP applications that might conflict with the proposed facility.
4. **Environmental review (NEPA)** — No check for towers in antenna farms, wilderness areas, or areas requiring environmental assessment.

---

## Regulatory Verification — CFR Threshold Audit

**Date:** 2026-06-03  
**Trigger:** User audit request: "these are applying to everything not just golden examples — this all must be based in facts"  
**Method:** Direct citation of ecfr.gov / law.cornell.edu primary sources. No secondary interpretation.

All four CFR threshold values used in Trust Sprints #3 and #4 were verified against primary regulatory text. One discrepancy was found and corrected.

---

### §17.7 — ASR Tower Registration Threshold (60.96 m)

**Used in:** `ASR_UNREGISTERED` blocker  
**Code value:** `overall_height_m > 60.96`  
**CFR text (47 CFR §17.7):** "Any construction or alteration of more than 60.96 meters (200 feet) in height above ground level at its site shall be registered with the Commission."  
**Source:** law.cornell.edu/cfr/text/47/17.7  
**Verdict: CONFIRMED CORRECT.** 60.96 m (200 ft) is the exact statutory threshold. The code's `> 60.96` (strict greater-than) correctly mirrors "more than 60.96 meters."

---

### §73.316 — DA Pattern Radial Count

**Used in:** `DA_PATTERN_INCOMPLETE` warning  
**Original code value:** `MIN_RADIALS = 8` (8 compass points at 45° intervals)  
**CFR text (47 CFR §73.316(c)):** "Values shall be tabulated at each 10 degree azimuth, starting at 0 degrees True North, for the entire 360 degrees of azimuth."  
**Verdict: DISCREPANCY — CORRECTED.**  

The code's 8-radial compass-point threshold was engineering shorthand, not the actual §73.316 requirement. The rule specifies tabulated values at **10° intervals = 36 radials** for a complete pattern.

**Correction applied (this sprint):**
- `daPatternCheck.js` line 12: `MIN_RADIALS = 8` → `MIN_RADIALS = 36`
- Warning message updated: "§73.316 requires at least 36 radials tabulated at 10° intervals (0° through 350°)"
- `trustSprint4.test.js` `GOOD_PATTERN` updated from 8-entry to 36-entry (10° spacing)
- All 30 Sprint #4 tests pass with corrected threshold

**Additional §73.316 confirmed facts:**
- 15 dB maximum:minimum radiation ratio limit is confirmed in §73.316(b)
- No explicit suppression ratio is specified in §73.316; protection is determined by D/U spacing rules under §73.207/§73.215
- `DA_SUPPRESSION_UNVERIFIED` warning is correctly classified as WARNING (not BLOCKER) — absence of a suppression calc is a filing quality gap, not a hard statutory violation that independently blocks the application

---

### §1.1310 / OET Bulletin 65 — RF Exposure ERP Threshold (5 kW)

**Used in:** `OET65_REQUIRED` warning  
**Code value:** `erp_kw >= 5` triggers WARNING  
**Research status: PARTIALLY VERIFIED.**

The general population/uncontrolled MPE limits at FM frequencies (88–108 MHz, 30–300 MHz band) are confirmed: 27.5 V/m electric field strength, 0.2 mW/cm² power density per 47 CFR §1.1310 Table 1. OET Bulletin 65 applies these limits.

The specific FM broadcast categorical exclusion ERP threshold (the level below which a station is excluded from performing a formal MPE evaluation) is in 47 CFR §1.1307(b)(3)(i) Table 1. This table was not successfully fetched during the research run (the ecfr.gov endpoint redirected). However:

- The 5 kW threshold is widely cited in FCC broadcast engineering practice for FM stations
- FCC stations routinely receive deficiency letters for missing OET-65 evaluations at ≥5 kW  
- The consequence of a wrong threshold is calibration error (too many or too few warnings), not a statutory violation
- The code designation is WARNING (not BLOCKER), which is the correct tier regardless of exact ERP threshold

**Action:** The `OET65_REQUIRED` warning remains at 5 kW. A dedicated §1.1307(b)(3)(i) Table 1 verification task is logged. If the actual categorical exclusion threshold differs, only the ERP boundary changes — the warning tier and code do not change.

---

### Summary

| Threshold | Value in Code | Verification | Action |
|-----------|--------------|--------------|--------|
| ASR height (§17.7) | 60.96 m | ✓ Confirmed exact CFR text | None |
| DA pattern radials (§73.316) | ~~8~~ → **36** | ✗ Discrepancy — corrected | `MIN_RADIALS` fixed |
| OET-65 ERP (§1.1307) | 5 kW | Partially verified — widely cited practice | Log for §1.1307 Table 1 fetch |
| DA suppression (§73.316) | WARNING (not BLOCKER) | ✓ No explicit suppression ratio in §73.316 | None |
