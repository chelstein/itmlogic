// §73.215 path-to-compliance remediation tests.  Uses a mocked computeFn
// (deterministic synthetic exhibits) so no real engine runs are paid.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  needsRemediation,
  buildRemediationRanges,
  runRemediationSweep,
  bindingBearings,
  notchPattern
} from '../engine/parameterSweep/remediation.js';
import { buildRemediationSection } from '../exports/engineeringReport/sections/remediation.js';

// Synthetic compute: §73.207 passes when erp ≤ 50; otherwise §73.215
// passes only when haat ≤ 500; OET-65 fails when erp > 90.  (Mirrors the
// parameterSweep test fixture.)
async function syntheticCompute({ inputs }){
  const erp_kw = Number(inputs.erp_kw);
  const haat_m = Number(inputs.haat_m);
  const area_km2 = (erp_kw + 1) * (haat_m / 100 + 1) * 100;
  const sec207_pass = erp_kw <= 50;
  const sec215_pass = !sec207_pass && haat_m <= 500;
  const oet65_pass  = erp_kw <= 90;
  return {
    polygons: [{ contour_id: 'service_60dbu', closed: true, area_km2 }],
    blockers: oet65_pass ? [] : [{ code: 'OET65_BOUNDARY_VIOLATION' }],
    regulatory_compliance: sec207_pass
      ? { cite: '47 CFR §73.207', pass: true, section_73_207: { pass: true } }
      : sec215_pass
        ? { cite: '47 CFR §73.215', pass: true, section_73_207: { pass: false } }
        : { cite: '47 CFR §73.215', pass: false, section_73_207: { pass: false } },
    station_inputs: { erp_kw, haat_m }
  };
}
const VALIDATION = { runs: [], reference_cases_present: true };

/* ---------- needsRemediation ---------- */

test('needsRemediation: only when genuinely non-compliant on §73.207/§73.215', () => {
  assert.equal(needsRemediation({ regulatory_compliance: { cite: '47 CFR §73.215', pass: false } }), true);
  // COMPLIANT VIA ALTERNATE RULE: §73.207 distance fails but §73.215 saves
  // it (overall pass=true) → NO remediation (regression: KRDR fired a
  // spurious "reduce ERP" path despite being compliant).
  assert.equal(needsRemediation({ regulatory_compliance: { cite: '47 CFR §73.215', pass: true, section_73_207: { pass: false } } }), false);
  assert.equal(needsRemediation({ regulatory_compliance: { section_73_207: { pass: false } } }), false); // 207-only shortfall, no overall fail
  assert.equal(needsRemediation({ regulatory_compliance: { cite: '47 CFR §73.215', pass: true } }), false);
  assert.equal(needsRemediation({ regulatory_compliance: { cite: '47 CFR §73.182', pass: false } }), false); // AM, not contour
  assert.equal(needsRemediation({}), false);
});

/* ---------- buildRemediationRanges ---------- */

test('buildRemediationRanges: downward ERP + HAAT envelope, bounded', () => {
  const r = buildRemediationRanges({ erp_kw: 100, haat_m: 600 });
  assert.equal(r.erp_kw.max, 100);
  assert.ok(r.erp_kw.min < 100 && r.erp_kw.min >= 0.1);
  assert.equal(r.haat_m.max, 600);
  assert.equal(r.haat_m.min, 30);            // §73.333 floor
  // No HAAT range when already at/below the floor; no ERP range when absent.
  assert.equal(buildRemediationRanges({ erp_kw: 5, haat_m: 30 }).haat_m, undefined);
  assert.deepEqual(buildRemediationRanges({}), {});
});

/* ---------- directional: bindingBearings + notchPattern ---------- */

test('bindingBearings: subject→nearby bearings of failing §73.215 pairs (deduped ~10°)', () => {
  const b = bindingBearings({ regulatory_compliance: { studies: [
    { pair_pass: true,  forward: { bearings: { u_to_d_deg: 10 } } },     // passes → ignored
    { pair_pass: false, forward: { bearings: { u_to_d_deg: 92 } } },     // → 90
    { pair_pass: false, forward: { bearings: { u_to_d_deg: 271.4 } } },  // → 270
    { pair_pass: false, forward: { bearings: { u_to_d_deg: 88 } } }      // → 90 (dup)
  ]}});
  assert.deepEqual(b.sort((x, y) => x - y), [90, 270]);
  assert.deepEqual(bindingBearings({}), []);
});

test('notchPattern: peak-normalized 1-D table with a null toward the bearing', () => {
  const pat = notchPattern([90], 0.25, 35);
  assert.equal(pat.length, 36);
  assert.ok(Math.abs(pat.find(p => p[0] === 90)[1] - 0.25) < 1e-6, 'null bottom at the bearing');
  assert.equal(pat.find(p => p[0] === 270)[1], 1, 'peak away from the null');
  assert.ok(pat.every(p => p[1] >= 0.25 - 1e-9 && p[1] <= 1 + 1e-9));
});

test('buildRemediationRanges: adds a directional patterns axis when bearings given', () => {
  const r = buildRemediationRanges({ erp_kw: 50, haat_m: 200 }, [120]);
  assert.ok(Array.isArray(r.patterns) && r.patterns.length === 4);
  assert.equal(r.patterns[0], null);              // ND baseline retained
  assert.ok(Array.isArray(r.patterns[1]));
  assert.equal(buildRemediationRanges({ erp_kw: 50, haat_m: 200 }, []).patterns, undefined);
});

/* ---------- runRemediationSweep ---------- */

test('runRemediationSweep: finds a least-power compliant config', async () => {
  const rem = await runRemediationSweep({
    baseInputs: { erp_kw: 100, haat_m: 600 },   // non-compliant as-is
    evidence: {},
    validation: VALIDATION,
    computeFn: syntheticCompute
  });
  assert.equal(rem.available, true);
  assert.equal(rem.none_found, false);
  assert.ok(rem.recommended, 'a compliant config should be found');
  assert.ok(rem.recommended.erp_kw <= 50, 'recommended ERP should reach a compliant level');
  assert.ok(rem.evaluated > 0);
});

test('runRemediationSweep: recommends a directional pattern when one clears it', async () => {
  // Compliant only when a directional pattern is applied (combo carries
  // pattern_table) — power/height alone never qualifies here.
  const dirCompute = async ({ inputs }) => {
    const hasPattern = Array.isArray(inputs.pattern_table) && inputs.pattern_table.length > 0;
    return {
      polygons: [{ contour_id: 'service', closed: true, area_km2: 4000 }],
      blockers: [],
      regulatory_compliance: hasPattern
        ? { cite: '47 CFR §73.215', pass: true,  section_73_207: { pass: false } }
        : { cite: '47 CFR §73.215', pass: false, section_73_207: { pass: false } },
      station_inputs: { erp_kw: inputs.erp_kw, haat_m: inputs.haat_m }
    };
  };
  const rem = await runRemediationSweep({
    baseInputs: { erp_kw: 50, haat_m: 200 }, bearings: [120],
    evidence: {}, validation: VALIDATION, computeFn: dirCompute
  });
  assert.equal(rem.none_found, false);
  assert.equal(rem.recommended.directional, true);
  assert.deepEqual(rem.recommended.notch_bearings_deg, [120]);
});

test('runRemediationSweep: none_found when nothing in range complies', async () => {
  // computeFn that is never compliant.
  const rem = await runRemediationSweep({
    baseInputs: { erp_kw: 100, haat_m: 600 },
    evidence: {},
    validation: VALIDATION,
    computeFn: async () => ({ regulatory_compliance: { cite: '47 CFR §73.215', pass: false }, blockers: [], polygons: [] })
  });
  assert.equal(rem.available, true);
  assert.equal(rem.none_found, true);
  assert.equal(rem.recommended, null);
});

/* ---------- buildRemediationSection ---------- */

test('buildRemediationSection: null without remediation', () => {
  assert.equal(buildRemediationSection({}, {}), null);
  assert.equal(buildRemediationSection({}, { remediation: { available: false } }), null);
});

test('buildRemediationSection: renders recommended config', () => {
  const sec = buildRemediationSection({}, { remediation: {
    available: true, none_found: false, evaluated: 24,
    recommended: { erp_kw: 14, haat_m: 120, service_km2: 5031, compliance_path: '§73.215' }
  }});
  assert.equal(sec.type, 'paragraphs');
  assert.equal(sec.advisory, true);
  assert.match(sec.heading, /PATH TO COMPLIANCE/);
  const blob = sec.paragraphs.join('\n');
  assert.match(blob, /ERP 14 kW/);
  assert.match(blob, /HAAT 120 m/);
  assert.match(blob, /does not modify the compliance determination/i);
});

test('buildRemediationSection: describes a directional recommendation', () => {
  const sec = buildRemediationSection({}, { remediation: {
    available: true, none_found: false, evaluated: 96, binding_bearings_deg: [120],
    recommended: { erp_kw: 50, haat_m: 200, service_km2: 4000, compliance_path: '§73.215',
                   directional: true, notch_bearings_deg: [120], notch_depth_db: -12 }
  }});
  const blob = sec.paragraphs.join('\n');
  assert.match(blob, /DIRECTIONAL/);
  assert.match(blob, /120°/);
  assert.match(blob, /12 dB/);
  assert.match(blob, /directional-pattern configurations/);   // footer axis label
});

test('buildRemediationSection: none_found points to relocation/waiver', () => {
  const sec = buildRemediationSection({}, { remediation: { available: true, none_found: true, evaluated: 24 } });
  assert.match(sec.paragraphs.join('\n'), /relocation|waiver|directional/i);
});

test('buildRemediationSection: none_found after directional search names the bearings tried', () => {
  const sec = buildRemediationSection({}, { remediation: {
    available: true, none_found: true, evaluated: 72, binding_bearings_deg: [90, 270]
  }});
  const blob = sec.paragraphs.join('\n');
  assert.match(blob, /directional null/i);
  assert.match(blob, /90°/);
  assert.match(blob, /270°/);
});

/* ---------- integration: section flows into the full report ---------- */

test('integration: report includes PATH TO COMPLIANCE only when remediation attached', async () => {
  const { buildExhibit, FM_CLASS_A } = await import('./_helpers.js');
  const { buildEngineeringReport } = await import('../exports/engineeringReport/index.js');
  const { renderEngineeringReportText } = await import('../exports/engineeringReport/renderText.js');
  const x = await buildExhibit(FM_CLASS_A);

  const plain = buildEngineeringReport(x);
  assert.equal(plain.sections.find(s => s.id === 'remediation'), undefined);

  const withRem = buildEngineeringReport(x, { remediation: {
    available: true, none_found: false, evaluated: 24,
    recommended: { erp_kw: 12, haat_m: 100, service_km2: 4200, compliance_path: '§73.215' }
  }});
  assert.ok(withRem.sections.some(s => s.id === 'remediation'), 'remediation section present');
  const txt = renderEngineeringReportText(withRem);
  assert.match(txt, /PATH TO COMPLIANCE/);
  assert.match(txt, /ERP 12 kW/);
});
