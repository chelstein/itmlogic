# Readiness Trust Audit — Authority Chain Matrix

**Date:** 2026-06-03  
**Scope:** Every BLOCKER, WARNING, ADVISORY, and determination outcome produced by `buildReadinessReport()`.  
**Purpose:** No readiness finding should appear unless its authority chain is explicit and reproducible.

---

## Legend

**Severity:** BLOCKER | WARNING | ADVISORY | DETERMINATION  
**Classification:** REGULATORY | ENGINEERING | PROVENANCE | ADVISORY  
**Confidence:** HIGH | MEDIUM | LOW  
**Flags:** `[HEURISTIC]` `[INFERRED]` `[ENGINEERING-JUDGMENT]` `[GENOA-INTERNAL]` `[NO-CFR-BASIS]`

---

## BLOCKERS

### 1. `COMPLIANCE_FAILURE`

| Attribute | Value |
|-----------|-------|
| **Severity** | BLOCKER (-25 pts) |
| **Classification** | REGULATORY |
| **Authority** | 47 CFR §73.207 (co-channel / first-adjacent spacing); 47 CFR §73.215 (short-spacing waiver showing) |
| **Trigger** | `regulatory_compliance.pass === false` |
| **Evidence source** | `regulatory_compliance.violations[]` — produced by FM contour engine |
| **Rule assigned** | §73.207 when `section_73_207.pass === false`; §73.215 otherwise |
| **Confidence** | HIGH when `violations[].message` contains specific rule citation; MEDIUM when violations array is empty (generic fallback fires) |
| **Flags** | None when violations array is populated. `[INFERRED]` when violations array is empty and rule is guessed from `section_73_207.pass` alone |

**Trust note:** The `rule` field on the emitted blocker is inferred from the compliance block structure, not from any per-violation `rule` property. If `violations` is empty but `pass === false`, the rule assignment (`§73.207` vs `§73.215`) is structural inference and should be verified against the engine's own output.

---

### 2. `FIELD_INVALID`

| Attribute | Value |
|-----------|-------|
| **Severity** | BLOCKER (-25 pts) |
| **Classification** | ENGINEERING |
| **Authority** | FCC Form 301-FM field validation (internal `mapping.js` / `validateFilingField()`) |
| **Trigger** | Lineage field `status === 'invalid'` or `'INVALID'` |
| **Evidence source** | `lineage.fields[].invalid_reason` from `buildLineageReport()` |
| **Confidence** | HIGH — validation rules are explicit in mapping.js |
| **Flags** | None |

---

### 3. `FIELD_AUTO_MISSING`

| Attribute | Value |
|-----------|-------|
| **Severity** | BLOCKER (-15 pts) |
| **Classification** | REGULATORY |
| **Authority** | FCC Form 301-FM required field (Section III / LMS) — the specific field determines the citation |
| **Trigger** | Required lineage field is `blocking === true` AND `source === 'genoa-auto'` |
| **Evidence source** | `lineage.fields[].blocking`, `lineage.fields[].expected_source` |
| **Confidence** | HIGH — Form 301-FM requirements are enumerated in lineage.js |
| **Flags** | None |

---

### 4. `FIELD_ENGINEER_REQUIRED`

| Attribute | Value |
|-----------|-------|
| **Severity** | BLOCKER (-5 pts) |
| **Classification** | ENGINEERING |
| **Authority** | FCC Form 301-FM required field; value must be supplied by a licensed engineer (e.g., `rcagl-m`, `antenna-make-model`) |
| **Trigger** | Required lineage field is `blocking === true` AND `source === 'manual-engineer'` |
| **Evidence source** | `lineage.fields[].blocking`, `lineage.fields[].expected_source` |
| **Confidence** | HIGH |
| **Flags** | None |

---

### 5. `FIELD_APPLICANT_REQUIRED`

| Attribute | Value |
|-----------|-------|
| **Severity** | BLOCKER (-10 pts) |
| **Classification** | REGULATORY |
| **Authority** | FCC Form 301-FM required field; value must be supplied by applicant (e.g., `community-of-license`, `fcc-class`) |
| **Trigger** | Required lineage field is `blocking === true` AND `source === 'manual-applicant'` |
| **Evidence source** | `lineage.fields[].blocking`, `lineage.fields[].expected_source` |
| **Confidence** | HIGH |
| **Flags** | None |

---

### 6. `ASR_UNREGISTERED`

| Attribute | Value |
|-----------|-------|
| **Severity** | BLOCKER (-20 pts) |
| **Classification** | REGULATORY |
| **Authority** | 47 CFR §17.7 — "Any construction or alteration of more than 60.96 meters (200 feet) in height above ground level at its site shall be registered with the Commission." |
| **Trigger** | `overall_height_m > 60.96` AND no ASR number in `station_inputs.asr_number` or `evidence.asr.asr_number` |
| **Evidence source** | `station_inputs.overall_height_m` or `evidence.asr.overall_height_m` |
| **Threshold** | 60.96 m — **confirmed exact CFR text** (§17.7, verified 2026-06-03) |
| **Confidence** | HIGH |
| **Flags** | None |

---

### 7. `DA_PATTERN_MISSING`

| Attribute | Value |
|-----------|-------|
| **Severity** | BLOCKER (-20 pts) |
| **Classification** | REGULATORY |
| **Authority** | 47 CFR §73.316 — horizontal radiation pattern table required for FM directional antenna stations (Form 301-FM Section III) |
| **Trigger** | `station_inputs.pattern_mode === 'DA'` or `'D'` AND no pattern table in any of four evidence paths |
| **Evidence source** | `evidence.nec_pattern_table`, `station_inputs.pattern`, `evidence.da_pattern`, `evidence.pattern_data` |
| **Confidence** | HIGH |
| **Flags** | None |

---

### 8. `DA_PATTERN_INVALID`

| Attribute | Value |
|-----------|-------|
| **Severity** | BLOCKER (-25 pts) |
| **Classification** | ENGINEERING |
| **Authority** | 47 CFR §73.316 — pattern must be valid for FCC filing acceptance |
| **Trigger** | Any pattern entry with: non-numeric azimuth/field, `azimuth_deg < 0` or `>= 360`, `relative_field < 0` or `> 2.0` |
| **Evidence source** | Pattern entries from resolved pattern source |
| **Confidence** | HIGH for azimuth/NaN checks; MEDIUM for `relative_field > 2.0` boundary |
| **Flags** | `[HEURISTIC]` — the `relative_field > 2.0` upper bound is a Genoa engineering heuristic. §73.316 specifies normalization to 1.000 at maximum; the 2.0 ceiling is a data-error detector, not a CFR threshold. A value of 1.05 (slightly over-normalized) would pass this check but technically violates §73.316 normalization. |

---

## WARNINGS

### 9. `HAAT_DISCREPANCY`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | ENGINEERING |
| **Authority** | No direct CFR citation. Engineering judgment: significant deviation between filed HAAT and terrain-computed HAAT increases deficiency letter risk. |
| **Trigger** | `|filedHaat − terrainHaat| / terrainHaat > 20%` |
| **Evidence source** | `station_inputs.haat_m_input` vs mean of `evidence.terrain_haat_per_radial[].haat_computed_m` |
| **Threshold** | 20% — **Genoa engineering heuristic. No CFR basis.** |
| **Confidence** | MEDIUM |
| **Flags** | `[HEURISTIC]` `[ENGINEERING-JUDGMENT]` — 20% is internally chosen. FCC issues deficiency letters for HAAT discrepancies but no statutory percentage trigger exists. |

---

### 10. `ENGINEER_CONFIRMATION_NEEDED`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | ENGINEERING |
| **Authority** | Internal Genoa lineage workflow — field was auto-suggested but not confirmed by a licensed PE |
| **Trigger** | `lineage field status === 'suggested'` AND `engineer_confirmation_required === true` |
| **Evidence source** | `lineage.fields[].status`, `lineage.fields[].engineer_confirmation_required` |
| **Confidence** | HIGH (lineage field is explicitly tagged) |
| **Flags** | `[GENOA-INTERNAL]` — this is a workflow control, not a CFR requirement |

---

### 11. `TERRAIN_EVIDENCE_MISSING`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | ENGINEERING |
| **Authority** | Engineering best practice for HAAT computation. No strict CFR requirement to use terrain analysis (operator-supplied HAAT is accepted on Form 301-FM). |
| **Trigger** | `service === 'FM'` AND `evidence.terrain_haat_per_radial` is absent or empty |
| **Evidence source** | Absence of `evidence.terrain_haat_per_radial` |
| **Confidence** | MEDIUM |
| **Flags** | `[ENGINEERING-JUDGMENT]` `[GENOA-INTERNAL]` — terrain analysis is strongly recommended but not mandated. FCC accepts operator-supplied HAAT on Form 301-FM without ITM terrain verification. |

---

### 12. `ENGINE_BLOCKER`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-15 pts) |
| **Classification** | PROVENANCE |
| **Authority** | **UNKNOWN** — passes through `exhibit.blockers[]` verbatim. The authority chain depends entirely on whatever upstream process populated `exhibit.blockers`. |
| **Trigger** | `exhibit.blockers` array is non-empty |
| **Evidence source** | `exhibit.blockers[].message` — no rule, code, or source required by schema |
| **Confidence** | LOW |
| **Flags** | `[NO-CFR-BASIS]` `[INFERRED]` — **this is the most significant trust gap in the readiness system.** An `ENGINE_BLOCKER` can appear in an engineer's readiness report with no authority, no rule citation, and no reproducibility guarantee. The source of `exhibit.blockers` is not validated or typed. A malformed or AI-generated blocker message passes through without scrutiny. |

---

### 13. `FIELD_CONFLICT` — sub-type: `tower-overall-height-agl-m`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | ENGINEERING |
| **Authority** | FCC ASR database is authoritative for registered tower height (47 CFR Part 17) |
| **Trigger** | `pctDiff(station_inputs.overall_height_m, evidence.asr.overall_height_m) > 5%` |
| **Threshold** | 5% — **Genoa engineering judgment. No CFR basis for tolerance.** |
| **Confidence** | HIGH (conflict is real); MEDIUM (5% threshold) |
| **Flags** | `[HEURISTIC]` — 5% was chosen to suppress rounding noise |

---

### 14. `FIELD_CONFLICT` — sub-type: `coordinates-nad83`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | ENGINEERING |
| **Authority** | FCC LMS coordinate accuracy. NAD83 coordinate discrepancies can cause HAAT miscalculation and spacing errors. |
| **Trigger** | `|siLat − fmLat| > 0.001°` OR `|siLon − fmLon| > 0.001°` |
| **Threshold** | 0.001° ≈ 111 m — **Genoa engineering judgment. No CFR basis for this tolerance.** |
| **Confidence** | MEDIUM |
| **Flags** | `[HEURISTIC]` — 0.001° was chosen as a "close enough" floor. FCC does not specify a coordinate tolerance in 47 CFR §73. |

---

### 15. `FIELD_CONFLICT` — sub-type: `erp-kw-horizontal`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | ENGINEERING |
| **Authority** | FCC LMS records are authoritative for licensed ERP |
| **Trigger** | `pctDiff` between any two ERP sources `> 5%` |
| **Threshold** | 5% — **Genoa engineering judgment** |
| **Confidence** | HIGH (conflict is real); MEDIUM (5% threshold) |
| **Flags** | `[HEURISTIC]` |

---

### 16. `FIELD_CONFLICT` — sub-type: `frequency-mhz`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | REGULATORY |
| **Authority** | FCC LMS frequency assignment; frequency mismatch would cause filing rejection |
| **Trigger** | `|station_inputs.frequency − facility_metadata.raw.frequency| > 0.1 MHz` |
| **Threshold** | 0.1 MHz — **engineering judgment**, roughly half an FM channel spacing |
| **Confidence** | HIGH (conflict is real); MEDIUM (0.1 MHz threshold) |
| **Flags** | `[HEURISTIC]` |

---

### 17. `DA_PATTERN_UNCONFIRMED`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | ENGINEERING |
| **Authority** | 47 CFR §73.316 — DA stations must declare `pattern_mode` and file a pattern table |
| **Trigger** | Pattern data is present but `station_inputs.pattern_mode` is not `'DA'` or `'D'` |
| **Evidence source** | Presence of `station_inputs.pattern` or `evidence.{nec_pattern_table,da_pattern,pattern_data}` |
| **Confidence** | MEDIUM |
| **Flags** | `[INFERRED]` `[ENGINEERING-JUDGMENT]` — presence of pattern data does not conclusively prove a DA station. The pattern could be exploratory NEC output for an omni station. The inference is reasonable but not definitive. |

---

### 18. `DA_PATTERN_INCOMPLETE`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | REGULATORY |
| **Authority** | 47 CFR §73.316(c) — "Values shall be tabulated at each 10 degree azimuth, starting at 0 degrees True North, for the entire 360 degrees of azimuth." |
| **Trigger** | Normalized pattern entry count < 36 |
| **Threshold** | 36 radials — **confirmed exact CFR text** (§73.316(c), verified 2026-06-03) |
| **Confidence** | HIGH |
| **Flags** | None |

---

### 19. `DA_PATTERN_UNNORMALIZED`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | ENGINEERING |
| **Authority** | 47 CFR §73.316 — "The maximum value of the standard horizontal pattern … shall be normalized to a value of 1" |
| **Trigger** | `max(relative_field) < 0.95` |
| **Threshold** | 0.95 — **Genoa engineering tolerance. §73.316 says normalize to 1.000.** |
| **Confidence** | MEDIUM |
| **Flags** | `[HEURISTIC]` — 0.95 was chosen as a measurement-uncertainty floor. The CFR requires normalization to exactly 1.000. Values in 0.95–0.999 technically violate §73.316 but the code does not warn on them. An adversarial reviewer could challenge any max < 1.000. |

---

### 20. `DA_SUPPRESSION_UNVERIFIED`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | ENGINEERING |
| **Authority** | 47 CFR §73.316 (DA compliance broadly). No explicit suppression ratio is required by §73.316 text — protection is governed by D/U spacing under §73.207/§73.215. |
| **Trigger** | No `evidence.suppression_db` or `evidence.pattern_suppression` present |
| **Evidence source** | Absence of suppression evidence |
| **Confidence** | MEDIUM |
| **Flags** | `[ENGINEERING-JUDGMENT]` — suppression ratio calculation is Genoa engineering best practice, not a mandatory §73.316 filing item. FCC does not require a standalone suppression calculation to be filed with Form 301-FM. This warning is appropriate as an advisory quality check but should not be presented as a regulatory requirement. |

---

### 21. `OET65_REQUIRED`

| Attribute | Value |
|-----------|-------|
| **Severity** | WARNING (-8 pts) |
| **Classification** | REGULATORY |
| **Authority** | OET Bulletin 65 / 47 CFR §§1.1307(b)(3)(i), 1.1310 |
| **Trigger** | `oet65` is absent AND `erp_kw >= 5` (or `power_day_kw >= 5` for AM) |
| **Threshold** | 5 kW — **formula approximation.** Actual §1.1307(b)(3)(i) threshold = 3.83 × R² watts. At R ≈ 36 m → 4,964 W ≈ 5 kW. |
| **Confidence** | MEDIUM |
| **Flags** | `[HEURISTIC]` — 5 kW is a conservative constant approximating the distance-dependent formula. The actual exclusion threshold depends on site-specific minimum accessible distance. The approximation errs toward more warnings (conservative). |

---

## ADVISORIES

### 22. `OET65_MISSING`

| Attribute | Value |
|-----------|-------|
| **Severity** | ADVISORY (no score penalty) |
| **Classification** | REGULATORY |
| **Authority** | OET Bulletin 65 / 47 CFR §§1.1307(b)(3)(i), 1.1310 |
| **Trigger** | `oet65` absent AND `erp_kw < 5` |
| **Confidence** | MEDIUM (same formula approximation as `OET65_REQUIRED`) |
| **Flags** | `[HEURISTIC]` — same 5 kW threshold note applies |

---

### 23. `SDR_MISSING`

| Attribute | Value |
|-----------|-------|
| **Severity** | ADVISORY (no score penalty) |
| **Classification** | ADVISORY |
| **Authority** | **None. No CFR, FCC form, or OET bulletin requires SDR drive-test captures.** |
| **Trigger** | `evidence.sdr_captures` is absent |
| **Evidence source** | Absence of SDR evidence |
| **Confidence** | HIGH (as Genoa advisory); **LOW** (as regulatory signal) |
| **Flags** | `[NO-CFR-BASIS]` `[GENOA-INTERNAL]` — SDR drive tests are a Genoa engineering quality practice. An FCC reviewer would not cite this as a deficiency. It should be clearly labeled as an internal Genoa quality check, not a regulatory requirement. |

---

### 24. `AM_PHYSICS_MISSING`

| Attribute | Value |
|-----------|-------|
| **Severity** | ADVISORY (no score penalty) |
| **Classification** | ADVISORY |
| **Authority** | **None. SOMNEC2D is a Genoa-internal AM analysis tool. No CFR requires a SOMNEC2D output in a filing.** AM groundwave analysis is required (§73.183) but method is not specified by CFR. |
| **Trigger** | `service === 'AM'` AND `evidence.am_physics` absent |
| **Evidence source** | Absence of `evidence.am_physics` |
| **Confidence** | HIGH (as Genoa advisory); **LOW** (as regulatory signal) |
| **Flags** | `[NO-CFR-BASIS]` `[GENOA-INTERNAL]` `[ENGINEERING-JUDGMENT]` — this advisory correctly identifies a quality gap but misattributes the authority. §73.183 requires AM groundwave analysis but does not mandate SOMNEC2D or any specific tool. Should be labeled as "Genoa internal quality check" to avoid the appearance of a regulatory requirement. |

---

## DETERMINATIONS

### 25. `NOT_READY`

| Attribute | Value |
|-----------|-------|
| **Severity** | DETERMINATION |
| **Classification** | PROVENANCE |
| **Authority** | Genoa internal rule: any blocker present → NOT_READY |
| **Confidence** | HIGH (rule is exact) |
| **Flags** | `[GENOA-INTERNAL]` — the NOT_READY gate is conservative: if any one blocker fires, the determination is NOT_READY regardless of score. This is appropriate for filing defensibility. |

---

### 26. `REVIEW`

| Attribute | Value |
|-----------|-------|
| **Severity** | DETERMINATION |
| **Classification** | PROVENANCE |
| **Authority** | Genoa internal rule: no blockers AND `readiness_score < 80` → REVIEW |
| **Threshold** | 80 — **Genoa-internal. No regulatory basis.** |
| **Confidence** | MEDIUM |
| **Flags** | `[GENOA-INTERNAL]` `[HEURISTIC]` — the 80-point threshold for REVIEW vs READY is entirely internal. An exhibit at 79 vs 81 is essentially equivalent. The threshold should be documented as a Genoa quality gate, not a regulatory requirement. |

---

### 27. `READY`

| Attribute | Value |
|-----------|-------|
| **Severity** | DETERMINATION |
| **Classification** | PROVENANCE |
| **Authority** | Genoa internal rule: no blockers AND `readiness_score >= 80` → READY |
| **Confidence** | MEDIUM |
| **Flags** | `[GENOA-INTERNAL]` — same threshold note as REVIEW. READY does not mean "will be granted by FCC"; it means "Genoa's automated checks found no blocking gaps." |

---

## Summary Matrix

| # | Code | Severity | Classification | Authority | Confidence | Flags |
|---|------|----------|---------------|-----------|------------|-------|
| 1 | `COMPLIANCE_FAILURE` | BLOCKER | REGULATORY | 47 CFR §73.207 / §73.215 | HIGH / MEDIUM† | †INFERRED when violations array empty |
| 2 | `FIELD_INVALID` | BLOCKER | ENGINEERING | Form 301-FM mapping.js validation | HIGH | — |
| 3 | `FIELD_AUTO_MISSING` | BLOCKER | REGULATORY | FCC Form 301-FM required fields | HIGH | — |
| 4 | `FIELD_ENGINEER_REQUIRED` | BLOCKER | ENGINEERING | Form 301-FM engineer-supplied fields | HIGH | — |
| 5 | `FIELD_APPLICANT_REQUIRED` | BLOCKER | REGULATORY | Form 301-FM applicant-supplied fields | HIGH | — |
| 6 | `ASR_UNREGISTERED` | BLOCKER | REGULATORY | 47 CFR §17.7 (exact text verified) | HIGH | — |
| 7 | `DA_PATTERN_MISSING` | BLOCKER | REGULATORY | 47 CFR §73.316 | HIGH | — |
| 8 | `DA_PATTERN_INVALID` | BLOCKER | ENGINEERING | 47 CFR §73.316 + Genoa bounds | HIGH / MEDIUM† | †relative_field > 2.0 is HEURISTIC |
| 9 | `HAAT_DISCREPANCY` | WARNING | ENGINEERING | No CFR — engineering judgment | MEDIUM | HEURISTIC (20% threshold) |
| 10 | `ENGINEER_CONFIRMATION_NEEDED` | WARNING | ENGINEERING | Genoa workflow rule | HIGH | GENOA-INTERNAL |
| 11 | `TERRAIN_EVIDENCE_MISSING` | WARNING | ENGINEERING | Engineering best practice | MEDIUM | ENGINEERING-JUDGMENT |
| 12 | `ENGINE_BLOCKER` | WARNING | PROVENANCE | **UNKNOWN** | LOW | NO-CFR-BASIS, INFERRED ⚠ |
| 13 | `FIELD_CONFLICT` (tower height) | WARNING | ENGINEERING | 47 CFR Part 17 / Genoa 5% threshold | HIGH / MEDIUM† | †5% threshold is HEURISTIC |
| 14 | `FIELD_CONFLICT` (coordinates) | WARNING | ENGINEERING | FCC LMS / Genoa 0.001° threshold | MEDIUM | HEURISTIC |
| 15 | `FIELD_CONFLICT` (ERP) | WARNING | ENGINEERING | FCC LMS / Genoa 5% threshold | HIGH / MEDIUM† | †5% threshold is HEURISTIC |
| 16 | `FIELD_CONFLICT` (frequency) | WARNING | REGULATORY | FCC LMS / Genoa 0.1 MHz threshold | HIGH / MEDIUM† | †0.1 MHz threshold is HEURISTIC |
| 17 | `DA_PATTERN_UNCONFIRMED` | WARNING | ENGINEERING | 47 CFR §73.316 | MEDIUM | INFERRED, ENGINEERING-JUDGMENT |
| 18 | `DA_PATTERN_INCOMPLETE` | WARNING | REGULATORY | 47 CFR §73.316(c) (exact text verified) | HIGH | — |
| 19 | `DA_PATTERN_UNNORMALIZED` | WARNING | ENGINEERING | 47 CFR §73.316 + Genoa 0.95 floor | MEDIUM | HEURISTIC (0.95 ≠ 1.000) |
| 20 | `DA_SUPPRESSION_UNVERIFIED` | WARNING | ENGINEERING | 47 CFR §73.316 broadly | MEDIUM | ENGINEERING-JUDGMENT |
| 21 | `OET65_REQUIRED` | WARNING | REGULATORY | OET Bul. 65 / §§1.1307(b)(3)(i), 1.1310 | MEDIUM | HEURISTIC (5 kW approximates formula) |
| 22 | `OET65_MISSING` | ADVISORY | REGULATORY | OET Bul. 65 / §§1.1307(b)(3)(i), 1.1310 | MEDIUM | HEURISTIC |
| 23 | `SDR_MISSING` | ADVISORY | ADVISORY | **None** | LOW | NO-CFR-BASIS, GENOA-INTERNAL ⚠ |
| 24 | `AM_PHYSICS_MISSING` | ADVISORY | ADVISORY | **None** (§73.183 ≠ SOMNEC2D) | LOW | NO-CFR-BASIS, GENOA-INTERNAL ⚠ |
| 25 | `NOT_READY` | DETERMINATION | PROVENANCE | Genoa rule: any blocker → NOT_READY | HIGH | GENOA-INTERNAL |
| 26 | `REVIEW` | DETERMINATION | PROVENANCE | Genoa rule: score < 80 | MEDIUM | GENOA-INTERNAL, HEURISTIC |
| 27 | `READY` | DETERMINATION | PROVENANCE | Genoa rule: score >= 80 | MEDIUM | GENOA-INTERNAL, HEURISTIC |

---

## Trust Gaps Requiring Action

These findings have authority chain problems that should be addressed in the next trust sprint:

### Gap A — `ENGINE_BLOCKER` has no authority chain ⚠ HIGH PRIORITY

**Problem:** `exhibit.blockers[]` is promoted to a WARNING with a penalty of -15 pts but carries no rule citation, no source, and no verifiable authority. Any string in `exhibit.blockers` becomes a readiness warning.

**Risk:** An engineer reviewing the readiness report cannot distinguish an `ENGINE_BLOCKER` from a CFR-backed warning. The source could be an AI-generated message, a test artifact, or a malformed engine output.

**Recommended fix:** Require `exhibit.blockers[]` entries to include a `code` and `source` field. In `buildReadinessReport()`, emit `ENGINE_BLOCKER` only when the blocker has a verifiable `code`, and add `source: 'engine'` to the emitted warning so reviewers know it is not a regulatory finding.

---

### Gap B — `SDR_MISSING` and `AM_PHYSICS_MISSING` are presented without classification ⚠ MEDIUM PRIORITY

**Problem:** Both advisories have no CFR authority. A recipient of the readiness report cannot distinguish them from regulatory advisories (`OET65_MISSING`).

**Recommended fix:** Add `authority: 'genoa-internal'` to the advisory object emitted for both codes. This does not require any logic change — it is a labeling fix that makes the authority chain explicit in the output artifact.

---

### Gap C — Heuristic thresholds are not labeled as such MEDIUM PRIORITY

**Problem:** `HAAT_DISCREPANCY` (20%), `DA_PATTERN_UNNORMALIZED` (0.95), all `FIELD_CONFLICT` percentage thresholds, and the REVIEW/READY score boundary (80) are engineering heuristics with no CFR source. They appear in the output without any indication that they are internally chosen.

**Recommended fix:** Add `authority: 'genoa-heuristic'` to warnings emitted for `HAAT_DISCREPANCY`, `DA_PATTERN_UNNORMALIZED`, and all `FIELD_CONFLICT` entries. Update `DA_PATTERN_UNNORMALIZED` remedy to note that §73.316 requires normalization to exactly 1.000.

---

### Gap D — `DA_PATTERN_INVALID` relative_field > 2.0 is undocumented LOWER PRIORITY

**Problem:** The 2.0 upper bound for `relative_field` is a Genoa engineering heuristic. A value of 1.05 (slightly over-normalized) passes this check but technically violates §73.316's normalization requirement.

**Recommended fix:** Change the check from `relative_field > 2.0` to `relative_field > 1.0` to align with the §73.316 normalization requirement, or add a separate DA_PATTERN_UNNORMALIZED path for values in 1.0–2.0. Either way, document the reasoning.

---

## Confirmed-Correct Findings (No Action Required)

| Code | Basis |
|------|-------|
| `COMPLIANCE_FAILURE` | §73.207 / §73.215 — engine-backed |
| `FIELD_INVALID` | mapping.js validation — explicit |
| `FIELD_AUTO_MISSING` | Form 301-FM — enumerated in lineage.js |
| `FIELD_ENGINEER_REQUIRED` | Form 301-FM — enumerated in lineage.js |
| `FIELD_APPLICANT_REQUIRED` | Form 301-FM — enumerated in lineage.js |
| `ASR_UNREGISTERED` | §17.7 — exact CFR text verified 2026-06-03 |
| `DA_PATTERN_MISSING` | §73.316 — Form 301-FM Section III |
| `DA_PATTERN_INCOMPLETE` | §73.316(c) — exact CFR text verified 2026-06-03 |
| `OET65_REQUIRED` / `OET65_MISSING` | §§1.1307(b)(3)(i), 1.1310 — formula derived, conservative |
| `NOT_READY` | Genoa gate — correctly conservative |
