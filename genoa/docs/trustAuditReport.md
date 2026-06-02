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

2. **OET-65 RF exposure** — No MPE field, no conclusion, no advisory even. Any station with ERP > 5 kW and antenna height < 50 m should trigger an OET-65 advisory at minimum.

3. **Part 17 ASR blocking** — Towers >60.96 m with no ASR number are advisory-only. Industry standard is to treat this as a filing blocker (FCC LMS rejects filings with unregistered towers).

4. **DA pattern suppression** — §73.316 requires the horizontal pattern to meet suppression ratio requirements. The engine captures pattern data but does not compute or verify the suppression ratio.

5. **Replay token in engineer flows** — The `/api/exhibits/engineer-review` and `/api/exhibits/audit-score` endpoints call `enrichTowerEvidence()` but no replay token is stamped on the resulting provenance. Audit packages built via these endpoints will always score 0/5 on replay_token provenance.
