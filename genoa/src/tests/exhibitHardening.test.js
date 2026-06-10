// Exhibit hardening sprint — regression coverage for:
//   1. HAAT BASIS AND GOVERNANCE renders a populated governance block
//   2. AI advisory findings are categorized and judgment-free (scope lock)
//   3. Source attestation conflicts render human-readable panels
//   4. Engineering conclusion distinguishes licensed vs proposed facilities
//   5. Exhibit maturity score is internal-only
//   6. Engineer review checklist precedes the certification page

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExhibit, FM_CLASS_A } from './_helpers.js';
import { buildEngineeringReport } from '../exports/engineeringReport/index.js';
import { renderEngineeringReportText } from '../exports/engineeringReport/renderText.js';
import { buildEngineeringReportVariant } from '../exports/engineeringReport/variants/internalDiagnostics.js';
import { buildHaatBasisGovernanceSection } from '../exports/engineeringReport/sections/haatBasisGovernance.js';
import { buildConclusionSection } from '../exports/engineeringReport/sections/conclusion.js';
import { sanitizeFindings, FINDING_CATEGORIES } from '../analysis/exhibitReview.js';
import { computeExhibitMaturity } from '../exports/engineeringReport/exhibitMaturity.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const LICENSED_HAAT_AUTHORITY = {
  authorized_haat_m: 37,
  operator_declared_haat_m: 37,
  computed_average_haat_m: 241.8,
  computed_radial_haat_m: [220.3, 241.5, 260.1, 255.8, 230.4, 248.2, 241.6, 236.7],
  filing_controlling_haat_m: 37,
  filing_controlling_haat_basis: 'FCC_AUTHORIZED',
  filing_controlling_haat_source: 'evidence.fcc_lms.license.haat_m',
  haat_conflict_status: 'REVIEW_REQUIRED',
  haat_review_messages: ['The FCC-authorized HAAT is 37 m.'],
  haat_blockers: [],
  haat_warnings: [],
  engineer_override: null,
  provenance: { study_intent: 'existing_facility_review', facility_status: 'licensed', radial_count_used: 8 }
};

// ── 1. HAAT governance ──────────────────────────────────────────────────────

test('HAAT governance section renders a populated filing-grade governance block', () => {
  const sec = buildHaatBasisGovernanceSection({
    station_inputs: { service: 'FM' },
    haat_authority: LICENSED_HAAT_AUTHORITY
  });
  assert.ok(sec);
  assert.equal(sec.heading, 'HAAT BASIS AND GOVERNANCE');
  // Renderable type — the old 'text'/content shape was dropped by both renderers.
  assert.equal(sec.type, 'considerations');
  const kv = Object.fromEntries(sec.kvRows);
  assert.equal(kv['Study Intent'], 'Existing Licensed Facility Review');
  assert.equal(kv['Facility Status'], 'Licensed Facility');
  assert.equal(kv['FCC Authorized HAAT'], '37 m');
  assert.equal(kv['Genoa Computed Mean HAAT'], '241.8 m');
  assert.match(kv['Computed Radial Range'], /220\.3 m – 260\.1 m/);
  assert.equal(kv['Filing-Controlling HAAT'], '37 m');
  assert.equal(kv['Filing-Controlling Basis'], 'FCC_AUTHORIZED');
  assert.equal(kv['Conflict Status'], 'REVIEW');
  assert.match(kv['Reason'], /Existing licensed facilities may possess a licensed HAAT/);
  // Visual governance table: FCC row controls, computed row does not.
  const fccRow = sec.table.rows.find(r => /FCC-Authorized/.test(r.concept));
  const cmpRow = sec.table.rows.find(r => /73\.313/.test(r.concept));
  assert.match(fccRow.controls, /YES — CONTROLS FILING/);
  assert.match(cmpRow.controls, /retained for review/);
});

test('HAAT governance section omitted for AM and for exhibits without haat_authority', () => {
  assert.equal(buildHaatBasisGovernanceSection({ station_inputs: { service: 'AM' }, haat_authority: LICENSED_HAAT_AUTHORITY }), null);
  assert.equal(buildHaatBasisGovernanceSection({ station_inputs: { service: 'FM' } }), null);
});

// ── 2. AI scope lock ────────────────────────────────────────────────────────

test('sanitizeFindings drops engineering judgments and categorizes the rest', () => {
  const { findings, suppressed } = sanitizeFindings([
    { issue: 'The terrain-derived mean HAAT of 241.8 m is the correct value', severity: 'WARNING' },
    { issue: 'The FCC value is wrong and the computed mean should be used', severity: 'WARNING' },
    { issue: 'FCC-authorized HAAT and terrain-derived mean differ with no declared override', severity: 'WARNING', category: 'UNRESOLVED_CONFLICT' },
    { issue: 'ASR record not attached', severity: 'INFO', category: 'MISSING_EVIDENCE' },
    { issue: 'READY but conclusion NON-COMPLIANT', severity: 'WARNING' }   // no category → defaults
  ]);
  assert.equal(suppressed.length, 2, 'both judgment findings must be suppressed');
  for (const s of suppressed){
    assert.equal(s.suppressed_reason, 'ENGINEERING_JUDGMENT_OUT_OF_SCOPE');
  }
  assert.equal(findings.length, 3);
  for (const f of findings){
    assert.ok(FINDING_CATEGORIES.includes(f.category), `bad category ${f.category}`);
  }
  // Uncategorized inconsistency finding defaults to INCONSISTENCY (not dropped).
  const def = findings.find(f => /READY but conclusion/.test(f.issue));
  assert.equal(def.category, 'INCONSISTENCY');
});

// ── 3. Conclusion licensed vs proposed ─────────────────────────────────────

function nonCompliantExhibit(extra = {}){
  return {
    station_inputs: { service: 'FM' },
    annotations: [],
    interference_study: {
      filing_qualifies: false, n_stations: 1, n_pass: 0, n_fail: 1,
      rules_evaluated: ['§73.215'],
      stations: [{ call: 'WDWN', pass_overall: false, failed_rules: ['§73.215'] }]
    },
    ...extra
  };
}

test('conclusion: licensed facility displays CURRENT-RULE CONFLICTS IDENTIFIED', () => {
  const c = buildConclusionSection(nonCompliantExhibit({
    haat_authority: LICENSED_HAAT_AUTHORITY,
    regulatory_compliance: { study_intent: 'existing_facility_review', facility_status: 'licensed' }
  }));
  assert.equal(c.status, 'NON-COMPLIANT', 'machine status must stay legacy');
  assert.equal(c.display_status, 'CURRENT-RULE CONFLICTS IDENTIFIED');
  assert.match(c.narrative, /Current-rule contour analysis identified conflicts under/);
  assert.match(c.narrative, /This facility is licensed and operating/);
  assert.match(c.narrative, /grandfathered facilities/);
  assert.match(c.narrative, /Further engineering review is required/);
});

test('conclusion: proposed facility keeps NON-COMPLIANT display status', () => {
  const c = buildConclusionSection(nonCompliantExhibit());
  assert.equal(c.status, 'NON-COMPLIANT');
  assert.equal(c.display_status, 'NON-COMPLIANT');
  assert.match(c.narrative, /redesign|waiver|engineering review/i);
});

// ── 4. checklist + maturity + full-report integration ──────────────────────

test('engineer review checklist sits immediately before certification', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const doc = buildEngineeringReport(x);
  const ids = doc.sections.map(s => s.id);
  const ci = ids.indexOf('engineer-review-checklist');
  assert.ok(ci >= 0, 'checklist section missing');
  assert.ok(ci < ids.indexOf('certification'), 'checklist must precede certification');
  const blob = doc.sections[ci].paragraphs.join('\n');
  for (const item of ['Facility data verified', 'HAAT basis verified', 'Source conflicts reviewed',
                      'AI advisory review reviewed', 'Filing readiness confirmed']){
    assert.ok(blob.includes(item), `missing checklist item: ${item}`);
  }
  const txt = renderEngineeringReportText(doc);
  assert.match(txt, /ENGINEER REVIEW CHECKLIST/);
});

test('exhibit maturity score: internal-only, stripped from customer variants', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const doc = buildEngineeringReport(x);
  const m = doc.meta.internal_qa?.exhibit_maturity;
  assert.ok(m, 'maturity missing from full doc meta');
  assert.equal(m.internal, true);
  for (const cat of ['math_integrity', 'source_integrity', 'evidence_integrity', 'rule_integrity',
                     'traceability', 'reproducibility', 'filing_readiness']){
    assert.ok(Number.isFinite(m.categories[cat]), `missing maturity category ${cat}`);
  }
  assert.ok(['FILING-GRADE DECISION SUPPORT', 'ENGINEERING REVIEW REQUIRED', 'NOT FILING-READY'].includes(m.label));
  // Never rendered.
  const txt = renderEngineeringReportText(doc);
  assert.ok(!txt.includes('exhibit_maturity'), 'maturity leaked into rendered TXT');
  assert.ok(!txt.includes('FILING-GRADE DECISION SUPPORT'), 'maturity label leaked into rendered TXT');
  // Stripped from customer-facing variants.
  for (const variant of ['filing_exhibit', 'exec_summary']){
    const vdoc = buildEngineeringReportVariant(x, { variant });
    assert.equal(vdoc.meta.internal_qa, undefined, `internal_qa must be stripped from ${variant}`);
  }
});

test('maturity tier is structural — a station rule FAIL does not demote the tier by itself', () => {
  const base = {
    source_attestation_v2: {
      payload_sha256: 'a'.repeat(64),
      fields: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, {}])),
      statuses: { math_status: 'PASS', source_status: 'RESOLVED', rule_status: 'PASS', evidence_status: 'MEASURED', filing_status: 'READY' },
      evidence_lock: {}
    },
    haat_authority: LICENSED_HAAT_AUTHORITY,
    evidence: {},
    build_attestation: { sha: 'abc', signature: 'sig' }
  };
  const ready = computeExhibitMaturity(base);
  assert.equal(ready.label, 'FILING-GRADE DECISION SUPPORT');

  // Same structure, but the station fails the rule check and filing is blocked:
  const blocked = computeExhibitMaturity({
    ...base,
    source_attestation_v2: {
      ...base.source_attestation_v2,
      statuses: { ...base.source_attestation_v2.statuses, rule_status: 'FAIL', filing_status: 'BLOCKED' }
    },
    regulatory_compliance: { pass: false }
  });
  assert.equal(blocked.label, 'FILING-GRADE DECISION SUPPORT',
    'a determinate rule FAIL grades the station, not the exhibit framework');
  assert.equal(blocked.categories.filing_readiness, 20, 'filing readiness must still report BLOCKED');

  // A structural failure (failed math) demotes to NOT FILING-READY:
  const broken = computeExhibitMaturity({
    ...base,
    source_attestation_v2: {
      ...base.source_attestation_v2,
      statuses: { ...base.source_attestation_v2.statuses, math_status: 'FAIL' }
    }
  });
  assert.equal(broken.label, 'NOT FILING-READY');
});
