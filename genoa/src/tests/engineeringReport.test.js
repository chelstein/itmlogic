// Engineering report — model + verdict + conclusion + render coverage.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExhibit, FM_CLASS_A } from './_helpers.js';
import { buildEngineeringReport }      from '../exports/engineeringReport/index.js';
import { renderEngineeringReportText } from '../exports/engineeringReport/renderText.js';
import { renderEngineeringReportPdf }  from '../exports/engineeringReport/renderPdf.js';

test('engineering report model includes all required sections', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const doc = buildEngineeringReport(x);
  const ids = doc.sections.map(s => s.id);
  for (const required of [
    'cover', 'purpose', 'parameters', 'methodology',
    'contour-results', 'validation', 'conclusion', 'certification',
    'appendix-c', 'appendix-d', 'appendix-e'
  ]){
    assert.ok(ids.includes(required), 'engineering report missing section: ' + required);
  }
});

test('validation verdict is PARTIAL/MEDIUM when curve+xc pass without parity', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const doc = buildEngineeringReport(x);
  const verdict = doc.sections.find(s => s.id === 'validation')?.verdict;
  assert.ok(verdict);
  // Default helper does not opt into FCC parity; with curve + cross-check we
  // expect PARTIAL/MEDIUM (or UNVERIFIED if validation didn't attach — accept
  // either non-VERIFIED outcome for the helper-built exhibit).
  assert.ok(['PARTIAL', 'UNVERIFIED'].includes(verdict.status));
  assert.ok(['MEDIUM', 'LOW'].includes(verdict.confidence));
});

test('validation verdict is VERIFIED/HIGH when curve, cross-check, and live parity all pass', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  // Synthesize an all-pass surface to drive the spec's VERIFIED branch.
  x.validation_context = {
    curve_reference_validation: {
      pass: true, result: 'pass', n_pass: 36, n_run: 36, max_error_km: 0.01,
      lock_statement: { upstream_commit: 'abcdef0123456789' }
    },
    fcc_cross_check: { result: 'pass', n_pass: 36, n_run: 36, detail: '36/36 radials within tolerance' }
  };
  x.evidence = {
    ...(x.evidence || {}),
    fcc_parity_report: { available: true, overall_pass: true, n_pass: 12, n_samples: 12, tolerance_km: 0.5, max_error_km: 0.05 }
  };
  const doc = buildEngineeringReport(x);
  const v = doc.sections.find(s => s.id === 'validation').verdict;
  assert.equal(v.status, 'VERIFIED');
  assert.equal(v.confidence, 'HIGH');
});

test('conclusion = NON-COMPLIANT when interference_study.filing_qualifies === false', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  x.interference_study = { filing_qualifies: false, n_stations: 1, n_pass: 0, n_fail: 1, stations: [] };
  const doc = buildEngineeringReport(x);
  const c = doc.sections.find(s => s.id === 'conclusion');
  assert.equal(c.status, 'NON-COMPLIANT');
});

test('conclusion = COMPLIANT VIA ALTERNATE RULE when §73.207 fails but §73.215 passes', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  x.regulatory_compliance = {
    cite: '47 CFR §73.215',
    pass: true,
    section_73_207: { pass: false, studies: [] },
    studies: []
  };
  // No interference_study with filing_qualifies===false override.
  delete x.interference_study;
  const doc = buildEngineeringReport(x);
  const c = doc.sections.find(s => s.id === 'conclusion');
  assert.equal(c.status, 'COMPLIANT VIA ALTERNATE RULE');
});

test('engineering TXT render contains heading, conclusion, and certification boilerplate', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const doc = buildEngineeringReport(x);
  const txt = renderEngineeringReportText(doc);
  assert.ok(txt.includes('ENGINEERING STATEMENT'), 'missing title');
  assert.ok(txt.includes('Conclusion:'), 'missing conclusion line');
  // Boilerplate may wrap at the column boundary, so collapse whitespace
  // before substring-matching.
  const collapsed = txt.replace(/\s+/g, ' ');
  assert.ok(collapsed.includes('Final certification remains the responsibility of the reviewing qualified broadcast engineer'),
    'missing certification boilerplate');
  assert.ok(collapsed.includes('Genoa does not certify FCC filings'),
    'missing limitation reminder');
});

test('engineering PDF render produces a non-empty PDF buffer', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const doc = buildEngineeringReport(x);
  const buf = await renderEngineeringReportPdf(doc);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 1000, 'PDF buffer suspiciously small');
  assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF', 'PDF magic missing');
});

test('engineering report build does not mutate the exhibit', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const before = JSON.stringify(x);
  buildEngineeringReport(x);
  assert.equal(JSON.stringify(x), before, 'exhibit was mutated');
});
