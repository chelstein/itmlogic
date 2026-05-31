// Tests for KJIM report classification audit fixes.
//
// Covers:
//   1. §73.24(g) overall_pass=null when population ratio NOT run
//   2. classifyRegulatoryContext NIF awareness (Berry vs FCCAM)
//   3. executiveSummary "proposed" → "subject facility" for licensed stations
//   4. Engineering conclusion NIF narrative framing for licensed stations
//   5. Before/after classification matrix (see inline comments)

import { test }     from 'node:test';
import assert       from 'node:assert/strict';

import { checkAm73_24g }            from '../engine/regulatory/section_73_24g.js';
import { classifyRegulatoryContext } from '../engine/regulatory/context.js';
import { buildExecutiveSummarySection } from '../exports/engineeringReport/sections/executiveSummary.js';
import { buildConclusionSection }   from '../exports/engineeringReport/sections/conclusion.js';

// ─── 1. §73.24(g) population PASS bug ────────────────────────────────────────
//
// BEFORE: overall_pass=true when blanket contour present but ratio NOT run.
// AFTER:  overall_pass=null (NOT_MEASURED) when ratio check did not run.
//
// Note: radial_table rows use the real engine format — each row is a radial
// bearing with a contour_distances_km sub-object, not a flat contour_id row.

test('§73.24(g): overall_pass=null when population ratio not measured', () => {
  const exhibit = {
    station_inputs: { service: 'AM' },
    // blanket_1000mvm contour IS present; population not fetched yet
    radial_table: [
      { contour_distances_km: { blanket_1000mvm: 0.15, service_25mvm: 70 } }
    ],
    population_estimate: {
      by_contour: {}  // no population data for either contour
    }
  };
  const result = checkAm73_24g({ exhibit });
  assert.equal(result.applicable, true, 'applicable to AM');
  assert.equal(result.overall_pass, null,
    'overall_pass must be null when ratio check was not measured');
  assert.match(result.summary, /NOT MEASURED/,
    'summary must say NOT MEASURED, not PASS');
});

test('§73.24(g): overall_pass=true when BOTH contours have population and ratio passes', () => {
  const exhibit = {
    station_inputs: { service: 'AM' },
    radial_table: [
      { contour_distances_km: { blanket_1000mvm: 0.15, service_25mvm: 70 } }
    ],
    population_estimate: {
      by_contour: {
        blanket_1000mvm: 100,
        service_25mvm: 50000
      }
    }
  };
  const result = checkAm73_24g({ exhibit });
  assert.equal(result.overall_pass, true,
    '100/50000 = 0.2% < 1.0% limit → should PASS');
});

test('§73.24(g): overall_pass=false when ratio exceeds 1%', () => {
  const exhibit = {
    station_inputs: { service: 'AM' },
    radial_table: [
      { contour_distances_km: { blanket_1000mvm: 0.15, service_25mvm: 70 } }
    ],
    population_estimate: {
      by_contour: {
        blanket_1000mvm: 600,
        service_25mvm: 10000
      }
    }
  };
  const result = checkAm73_24g({ exhibit });
  assert.equal(result.overall_pass, false,
    '600/10000 = 6% > 1.0% limit → should FAIL');
  assert.match(result.summary, /FAILED/);
});

test('§73.24(g): overall_pass=null when blanket contour missing AND no pop data', () => {
  const exhibit = {
    station_inputs: { service: 'AM' },
    radial_table: [],                     // no contours at all
    population_estimate: { by_contour: {} }
  };
  const result = checkAm73_24g({ exhibit });
  assert.equal(result.overall_pass, null,
    'blanket contour missing + no population → NOT_MEASURED (null), not false');
});

// ─── 2. classifyRegulatoryContext NIF awareness ──────────────────────────────
//
// CLASSIFICATION MATRIX (before → after):
//
//  Scenario                        | BEFORE currentRuleCompliance | AFTER
//  --------------------------------|------------------------------|---------------------------
//  A. Licensed, pairwise PASS,     | passes_current_rules         | passes_current_rules
//     no NIF                       | filing_risk: low             | filing_risk: low
//  --------------------------------|------------------------------|---------------------------
//  B. Licensed, pairwise PASS,     | passes_current_rules         | passes_current_rules
//     Berry NIF FAIL               | filing_risk: low             | filing_risk: MEDIUM
//                                  | (NIF invisible to context)   | (notes Berry advisory)
//  --------------------------------|------------------------------|---------------------------
//  C. Licensed, pairwise PASS,     | passes_current_rules         | fails_current_rules
//     FCCAM NIF FAIL               | filing_risk: low             | licensed_with_legacy_conflicts
//                                  | (NIF invisible to context)   | filing_risk: medium
//  --------------------------------|------------------------------|---------------------------
//  D. Proposed, pairwise PASS,     | passes_current_rules         | passes_current_rules
//     Berry NIF FAIL               | filing_risk: low             | filing_risk: medium
//  --------------------------------|------------------------------|---------------------------
//  E. Proposed, pairwise PASS,     | passes_current_rules         | fails_current_rules
//     FCCAM NIF FAIL               | filing_risk: low             | requires_engineering_review
//                                  |                              | filing_risk: high

const berryNif = {
  available: true,
  source: 'berry-1968',
  provenance: { upstream_skywave: 'berry-1968' },
  summary: { n_failing_azimuths: 5, worst_margin_db: -27.31, azimuths_evaluated: 36 }
};

const fccamNif = {
  available: true,
  source: 'fccam-wang-1985',
  provenance: { upstream_skywave: 'wang-1985-fccam' },
  summary: { n_failing_azimuths: 5, worst_margin_db: -27.31, azimuths_evaluated: 36 }
};

// A: Licensed, no NIF → low risk
test('context A: licensed + pairwise pass + no NIF → ordinary_compliant, low risk', () => {
  const r = classifyRegulatoryContext(
    { facility_id: '12345' },
    { fcc_lms: { status: 'LIC' } },
    { warnings: [], interference_study: { filing_qualifies: true } }
  );
  assert.equal(r.currentRuleCompliance, 'passes_current_rules');
  assert.equal(r.licenseInterpretation, 'ordinary_compliant');
  assert.equal(r.filingRisk, 'low');
});

// B: Licensed + Berry NIF fail → medium risk, advisory note
test('context B: licensed + pairwise pass + Berry NIF fail → passes_current_rules, medium risk', () => {
  const r = classifyRegulatoryContext(
    { facility_id: '12345' },
    { fcc_lms: { status: 'LIC' }, am_night_nif: berryNif },
    { warnings: [], interference_study: { filing_qualifies: true },
      evidence: { am_night_nif: berryNif } }
  );
  assert.equal(r.currentRuleCompliance, 'passes_current_rules',
    'Berry screening fail should NOT trigger fails_current_rules for a licensed station');
  assert.equal(r.filingRisk, 'medium',
    'Berry NIF failure should raise risk to medium even for licensed facility');
  assert.ok(r.notes.some(n => /berry/i.test(n)),
    'notes should mention Berry screening advisory');
});

// C: Licensed + FCCAM NIF fail → fails_current_rules / legacy conflict
test('context C: licensed + pairwise pass + FCCAM NIF fail → licensed_with_legacy_conflicts', () => {
  const r = classifyRegulatoryContext(
    { facility_id: '12345' },
    { fcc_lms: { status: 'LIC' }, am_night_nif: fccamNif },
    { warnings: [], interference_study: { filing_qualifies: true },
      evidence: { am_night_nif: fccamNif } }
  );
  assert.equal(r.currentRuleCompliance, 'fails_current_rules',
    'FCCAM-confirmed NIF fail SHOULD trigger fails_current_rules');
  assert.equal(r.licenseInterpretation, 'licensed_with_legacy_conflicts');
  assert.equal(r.filingRisk, 'medium');
  assert.ok(r.notes.some(n => /NIF.*FCCAM/i.test(n) || /modification.*NIF/i.test(n)),
    'notes should mention NIF FCCAM finding');
});

// D: Proposed + Berry NIF fail → passes_current_rules medium risk
test('context D: proposed + pairwise pass + Berry NIF fail → passes_current_rules, medium risk', () => {
  const r = classifyRegulatoryContext(
    { isProposal: true },
    { am_night_nif: berryNif },
    { warnings: [], interference_study: { filing_qualifies: true },
      evidence: { am_night_nif: berryNif } }
  );
  assert.equal(r.currentRuleCompliance, 'passes_current_rules',
    'Berry screening fail should not trigger fails_current_rules for proposed either');
  assert.equal(r.filingRisk, 'medium');
});

// E: Proposed + FCCAM NIF fail → requires_engineering_review, high risk
test('context E: proposed + pairwise pass + FCCAM NIF fail → requires_engineering_review, high risk', () => {
  const r = classifyRegulatoryContext(
    { isProposal: true },
    { am_night_nif: fccamNif },
    { warnings: [], interference_study: { filing_qualifies: true },
      evidence: { am_night_nif: fccamNif } }
  );
  assert.equal(r.currentRuleCompliance, 'fails_current_rules',
    'FCCAM NIF fail for proposed filing should trigger fails_current_rules');
  assert.equal(r.licenseInterpretation, 'requires_engineering_review');
  assert.equal(r.filingRisk, 'high');
});

// ─── 3. executiveSummary "proposed exhibit" → "subject facility" ─────────────

test('executiveSummary: uses "subject facility" for licensed stations, not "proposed exhibit"', () => {
  const exhibit = {
    station_inputs: { call: 'KJIM', service: 'AM', frequency: 1270, lat: 33.6, lon: -96.6,
                      erp_kw: 2.5, haat_m: 25 },
    regulatory_compliance: {
      facility_status: 'licensed',
      study_intent:    'existing_facility_review',
      interpretation:  'ordinary_compliant'
    },
    evidence: {}
  };
  const section = buildExecutiveSummarySection(exhibit);
  const text = (section.paragraphs || []).join('\n');
  assert.ok(!text.includes('proposed exhibit'),
    '"proposed exhibit" must not appear for a licensed facility review');
  assert.ok(text.includes('subject facility') || text.includes('licensed'),
    'should use "subject facility" or "licensed" framing');
});

test('executiveSummary: still uses "proposed" for non-licensed proposals', () => {
  const exhibit = {
    station_inputs: { call: 'WNEW', service: 'FM', frequency: 102.7, lat: 40.7, lon: -74.0,
                      erp_kw: 6, haat_m: 150 },
    evidence: {}
  };
  const section = buildExecutiveSummarySection(exhibit);
  const text = (section.paragraphs || []).join('\n');
  assert.ok(text.includes('proposed'),
    'proposed facility should use "proposed" framing');
});

// ─── 4. Engineering conclusion NIF framing for licensed facility ──────────────
//
// buildConclusionSection returns { narrative: string, ... } not { paragraphs: [] }.
// Tests read section.narrative directly.

test('conclusion: Berry NIF screening for licensed station uses advisory framing', () => {
  const exhibit = {
    station_inputs: { call: 'KJIM', service: 'AM', frequency: 1270, lat: 33.6, lon: -96.6,
                      erp_kw: 2.5, haat_m: 25 },
    annotations: [],
    evidence: { am_night_nif: berryNif },
    regulatory_compliance: {
      facility_status: 'licensed',
      study_intent:    'existing_facility_review'
    }
  };
  const section = buildConclusionSection(exhibit);
  assert.ok(section, 'should build without throwing');
  const text = section.narrative || '';
  // Should NOT say "facility redesign required" (that's for proposed filings)
  assert.ok(!text.includes('facility redesign') || text.includes('advisory') || text.includes('review'),
    'Berry NIF fail for licensed station should be framed as advisory, not as redesign-required');
  // Should mention Berry/screening
  assert.ok(/berry|screening|advisory/i.test(text),
    'should mention Berry 1968 screening advisory character');
});

test('conclusion: Berry NIF for existing facility adds review note, not prohibition', () => {
  const exhibit = {
    station_inputs: { call: 'KJIM', service: 'AM', frequency: 1270, lat: 33.6, lon: -96.6,
                      erp_kw: 2.5, haat_m: 25 },
    annotations: [],
    evidence: { am_night_nif: berryNif },
    regulatory_compliance: {
      facility_status: 'licensed',
      study_intent:    'existing_facility_review'
    }
  };
  const section = buildConclusionSection(exhibit);
  const text = section.narrative || '';
  assert.ok(/existing licensed station|licensed station|existing/i.test(text),
    'should mention this is an existing licensed station for Berry NIF context');
});
