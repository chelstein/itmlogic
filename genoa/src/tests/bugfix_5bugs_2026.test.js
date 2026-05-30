// Regression tests for 5 post-Workbench AM engineering bugs.
//
// Bug 1: OET-65 AM frequency unit — 1500 kHz passed as MHz in render path
// Bug 2: FAA notification reason — height vs airport proximity conflated
// Bug 3: AM directional groundwave not applied when pattern_mode not 'DA'
// Bug 4: Contradictory executive summary — "sign and file" despite NIF fail
// Bug 5: NIF azimuth denominator — "36/?" or "36/1" instead of "36/36"

import test from 'node:test';
import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1: OET-65 AM frequency unit
// ─────────────────────────────────────────────────────────────────────────────

import { buildRfExposureSection } from '../exports/engineeringReport/sections/rfExposure.js';
import { checkOet65 } from '../engine/regulatory/oet65.js';

test('Bug 1: OET-65 section renders frequency as MHz (1.5) not kHz (1500) for 1500 kHz AM', () => {
  // Simulate what engine/index.js does: converts 1500 kHz → 1.5 MHz before
  // calling checkOet65, and stores that in study_inputs.frequency_mhz.
  const freq_khz = 1500;
  const freq_mhz = freq_khz / 1000;   // 1.5
  const oet65 = checkOet65({ erp_kw: 1.0, frequency_mhz: freq_mhz, service: 'AM' });

  // study_inputs.frequency_mhz must be 1.5 (the MHz value, NOT 1500)
  assert.equal(oet65.study_inputs.frequency_mhz, 1.5,
    `study_inputs.frequency_mhz should be 1.5 MHz, got ${oet65.study_inputs.frequency_mhz}`);

  // Build an exhibit that mimics what engine/index.js produces for AM
  const exhibit = {
    oet65,
    station_inputs: {
      service: 'AM',
      frequency: 1500,        // raw kHz in station_inputs
      frequency_unit: 'kHz',
      erp_kw: 1.0
    }
  };

  const section = buildRfExposureSection(exhibit);
  const freqRow = section.rows.find(r => r[0] === 'Frequency');
  assert.ok(freqRow, 'Frequency row must be present in OET-65 section');
  const rendered = String(freqRow[1]);
  // Must display 1.5 MHz, NOT 1500 MHz
  assert.match(rendered, /1\.5\s*MHz/,
    `Frequency row should show "1.5 MHz", got: "${rendered}"`);
  assert.doesNotMatch(rendered, /1500\s*MHz/,
    `Frequency row must NOT show "1500 MHz" (kHz unit bug), got: "${rendered}"`);
});

test('Bug 1: compliance distance for 1500 kHz AM uses 1.5 MHz (not 1500 MHz)', () => {
  // At 1.5 MHz (AM band) the MPE is 180/f² = 180/2.25 = 80 mW/cm²
  // At 1500 MHz the MPE would be f/1500 = 1.0 mW/cm²
  // The two produce wildly different compliance distances.
  const result_correct = checkOet65({ erp_kw: 1.0, frequency_mhz: 1.5 });
  const result_wrong   = checkOet65({ erp_kw: 1.0, frequency_mhz: 1500 });
  // Correct (1.5 MHz): distance is small because MPE is high (80 mW/cm²)
  // Wrong  (1500 MHz): distance is larger because MPE is 1.0 mW/cm²
  const d_correct = result_correct.compliance?.uncontrolled?.distance_m;
  const d_wrong   = result_wrong.compliance?.uncontrolled?.distance_m;
  assert.ok(Number.isFinite(d_correct), 'compliance distance at 1.5 MHz must be finite');
  assert.ok(Number.isFinite(d_wrong),   'compliance distance at 1500 MHz must be finite');
  assert.ok(d_correct < d_wrong,
    `At 1.5 MHz (AM) the compliance distance (${d_correct.toFixed(2)} m) should be ` +
    `shorter than at 1500 MHz (${d_wrong.toFixed(2)} m) because the AM-band MPE is higher`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 2: FAA tower notification reason
// ─────────────────────────────────────────────────────────────────────────────

import { requiredTowerCompliance } from '../engine/tower/index.js';
import { buildTowerStudySection }  from '../exports/engineeringReport/sections/towerStudy.js';

test('Bug 2: 60.7 ft (18.5 m) tower, no airport → notification_required false, height_gt_200ft false', () => {
  const r = requiredTowerCompliance({ height_agl_m: 18.5, near_airport: false });
  assert.equal(r.notification_required, false,
    '18.5 m (60.7 ft) is well under 200 ft — notification must not be required');
  assert.equal(r.height_gt_200ft, false,
    'height_gt_200ft must be false for an 18.5 m tower');
  assert.equal(r.airport_proximity, false,
    'airport_proximity must be false when near_airport is not set');
  assert.deepEqual(r.notification_reason, [],
    'notification_reason array must be empty when not triggered');
});

test('Bug 2: 60.7 ft tower near airport → notification required, reason is airport_proximity only', () => {
  const r = requiredTowerCompliance({ height_agl_m: 18.5, near_airport: true });
  assert.equal(r.notification_required, true,
    'Near-airport tower must require notification even at 18.5 m');
  assert.equal(r.height_gt_200ft, false,
    '18.5 m does not trigger height threshold — height_gt_200ft must be false');
  assert.equal(r.airport_proximity, true,
    'airport_proximity must be true when near_airport is set');
  assert.ok(r.notification_reason.includes('airport_proximity'),
    'notification_reason must include "airport_proximity"');
  assert.ok(!r.notification_reason.includes('height_gt_200ft'),
    'notification_reason must NOT include "height_gt_200ft" for a short tower near an airport');
});

test('Bug 2: 210 ft (64 m) tower, no airport → height_gt_200ft true, no airport_proximity', () => {
  const r = requiredTowerCompliance({ height_agl_m: 64.008, near_airport: false });  // 210 ft
  assert.equal(r.notification_required, true,
    '64 m (210 ft) must trigger notification via height threshold');
  assert.equal(r.height_gt_200ft, true,
    'height_gt_200ft must be true for a 210 ft tower');
  assert.equal(r.airport_proximity, false,
    'airport_proximity must be false when near_airport is not set');
  assert.ok(r.notification_reason.includes('height_gt_200ft'),
    'notification_reason must include "height_gt_200ft"');
  assert.ok(!r.notification_reason.includes('airport_proximity'),
    'notification_reason must NOT include "airport_proximity" for a tall tower far from airports');
});

test('Bug 2: tower study section shows correct reason text (airport only, not height) for 18.5 m near airport', () => {
  const cmpl = requiredTowerCompliance({ height_agl_m: 18.5, near_airport: true });
  // Build a minimal exhibit with tower_compliance populated
  const exhibit = { tower_compliance: { ...cmpl, applicable: true } };
  const section = buildTowerStudySection(exhibit);
  const notifRow = section.rows?.find(r => r[0].includes('Notification required'));
  assert.ok(notifRow, 'Notification required row must be present');
  const text = String(notifRow[1]);
  assert.match(text, /YES/i, 'Row should say YES');
  assert.match(text, /airport/i, 'Row should mention airport proximity');
  // Must NOT say "> 200 ft" when that threshold was not triggered
  assert.doesNotMatch(text, />[\s]*200\s*ft/,
    `Row must not claim "> 200 ft" when only airport proximity triggered. Got: "${text}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 3: AM directional groundwave not applied
// ─────────────────────────────────────────────────────────────────────────────

import { amRadialTable } from '../engine/am/groundwave.js';
import { patternFactor } from '../engine/pattern/factor.js';

test('Bug 3: amRadialTable applies pattern when pattern_table has deep null (f=0.1 at 180°)', () => {
  // Synthetic pattern: full ERP at 0/90/270, deep null at 180.
  const patternTable = [[0, 1.0], [90, 1.0], [180, 0.1], [270, 1.0]];
  const patternFactorFn = az => patternFactor(patternTable, az);
  const result = amRadialTable({
    erp_kW: 5,
    frequency_khz: 1190,
    conductivity_msm: 8,
    patternFactorFn,
    radials_deg: [0, 90, 180, 270]
  });
  // Row at 180° must have relative_field ~= 0.1
  const row180 = result.find(r => r.azimuth_deg === 180);
  assert.ok(row180, '180° radial row must exist');
  assert.ok(Math.abs(row180.relative_field - 0.1) < 1e-9,
    `relative_field at 180° should be 0.1, got ${row180.relative_field}`);
  // 5 mV/m contour at 180° must be shorter than at 0° (null direction)
  const d_0   = result.find(r => r.azimuth_deg === 0)?.contour_distances_km?.city_5mvm;
  const d_180 = result.find(r => r.azimuth_deg === 180)?.contour_distances_km?.city_5mvm;
  assert.ok(Number.isFinite(d_0),   '5 mV/m distance at 0° must be finite');
  assert.ok(Number.isFinite(d_180), '5 mV/m distance at 180° must be finite');
  assert.ok(d_180 < d_0,
    `5 mV/m contour at null direction (${d_180.toFixed(2)} km) should be shorter than at main lobe (${d_0.toFixed(2)} km)`);
});

test('Bug 3: nightOrchestrator passes pattern_table without requiring pattern_mode="DA"', async () => {
  // Verify that the orchestrator normalizes proposed correctly:
  // pattern_table non-null → passed through to solveNifContour even when
  // pattern_mode is absent.
  const { normalizePrimary } = await import('../engine/am/nightOrchestrator.js');
  // normalizePrimary is a pure helper — test that NIF-facing proposed
  // pattern wiring works directly by inspecting what nightOrchestrator
  // does to proposed.pattern_table.
  // We can't call nighttimeNifStudy without a live fccamClient, so
  // we just verify the patternFactor function behaves correctly when
  // invoked via the pattern_table path (the engine uses the same path).
  const table = [[0, 1.0], [180, 0.1]];
  const f0   = patternFactor(table, 0);
  const f180 = patternFactor(table, 180);
  assert.ok(Math.abs(f0   - 1.0) < 1e-9, `f(0°) should be 1.0, got ${f0}`);
  assert.ok(Math.abs(f180 - 0.1) < 1e-9, `f(180°) should be 0.1, got ${f180}`);
  // The engine's patternFactorFn = az => patternFactor(pattern, az)
  // is correctly built for ANY non-null pattern — the bug was in
  // nightOrchestrator's guard; confirm the guard is now pattern-table-driven.
  // Verify the fix by checking that the orchestrator source does NOT have
  // an executable assignment that gates on pattern_mode === 'DA'.
  // We strip comment lines first so our own "prior guard" comments don't
  // trip the assertion.
  const { readFileSync } = await import('fs');
  const src = readFileSync(
    new URL('../engine/am/nightOrchestrator.js', import.meta.url), 'utf8');
  // Remove single-line and inline comments before searching
  const srcNoComments = src.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(srcNoComments, /pattern_mode\s*===\s*['"]DA['"]/,
    "nightOrchestrator must not gate pattern on pattern_mode === 'DA' in executable code");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 4: Contradictory executive summary conclusion
// ─────────────────────────────────────────────────────────────────────────────

import { buildExecutiveSummarySection } from '../exports/engineeringReport/sections/executiveSummary.js';

function makeExhibitWithNifFail(opts = {}){
  return {
    station_inputs: {
      call: 'KJIM', service: 'AM', frequency: 1500, frequency_unit: 'kHz',
      fcc_class: 'C', erp_kw: 5, facility_id: '99999',
      lat: 40, lon: -100, radial_step_deg: 10
    },
    filing_readiness: opts.filing_readiness ?? 'CANDIDATE',
    regulatory_compliance: null,
    interference_study:    null,
    engineering_conclusion: { status: opts.conclusion ?? 'NON-COMPLIANT' },
    validation: { status: 'VERIFIED', fcc_curve_parity: { fallback_tier: 1 } },
    evidence: {
      am_night_nif: {
        available: true,
        summary: {
          n_failing_azimuths: 36,
          n_azimuths: 36,
          worst_margin_db: -3.5
        }
      }
    },
    am_blanket_compliance:      null,
    am_da_pattern_compliance:   null,
    am_city_coverage_compliance: null,
    international_border:       null,
    annotations: []
  };
}

test('Bug 4: executive summary with NIF fail does NOT say "no further engineering work"', () => {
  const exhibit = makeExhibitWithNifFail();
  const section = buildExecutiveSummarySection(exhibit);
  const fullText = section.paragraphs.join(' ').toLowerCase();
  assert.doesNotMatch(fullText, /no further engineering work/i,
    'Executive summary must NOT say "no further engineering work" when there is a NIF fail');
});

test('Bug 4: executive summary with NIF fail DOES contain "remediation" language', () => {
  const exhibit = makeExhibitWithNifFail();
  const section = buildExecutiveSummarySection(exhibit);
  const fullText = section.paragraphs.join(' ').toLowerCase();
  assert.match(fullText, /remediation|review.*required|required.*filing/i,
    'Executive summary must mention remediation when a NIF fail is present');
});

test('Bug 4: executive summary with READY status and no blockers CAN say "no further work"', () => {
  const exhibit = {
    station_inputs: {
      call: 'KCLR', service: 'AM', frequency: 1240, frequency_unit: 'kHz',
      fcc_class: 'C', erp_kw: 1, facility_id: '12345',
      lat: 44, lon: -121, radial_step_deg: 10
    },
    filing_readiness: 'READY',
    regulatory_compliance: null,
    interference_study:    null,
    engineering_conclusion: { status: 'COMPLIANT' },
    validation: { status: 'VERIFIED', fcc_curve_parity: { fallback_tier: 1 } },
    evidence: {},
    am_blanket_compliance:       null,
    am_da_pattern_compliance:    null,
    am_city_coverage_compliance: null,
    international_border:        null,
    annotations: []
  };
  const section = buildExecutiveSummarySection(exhibit);
  const fullText = section.paragraphs.join(' ').toLowerCase();
  assert.match(fullText, /no further engineering work/i,
    'Executive summary should say "no further engineering work" when exhibit is READY with no blockers');
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 5: NIF denominator
// ─────────────────────────────────────────────────────────────────────────────

import { buildConclusionSection } from '../exports/engineeringReport/sections/conclusion.js';

function makeExhibitWithNifFailForConclusion(n_azimuths, n_failing){
  return {
    station_inputs: { service: 'AM', call: 'KJIM', fcc_class: 'C', erp_kw: 5, facility_id: '99999' },
    evidence: {
      am_night_nif: {
        available: true,
        source: 'fccam-wang',
        summary: {
          n_azimuths,
          n_failing_azimuths: n_failing,
          worst_margin_db: -4.2,
          azimuths_evaluated: undefined    // intentionally absent (old field name)
        }
      }
    },
    interference_study:    null,
    regulatory_compliance: null,
    annotations: []
  };
}

test('Bug 5: NIF conclusion shows "36/36" denominator (not "36/?" or "36/1")', () => {
  const exhibit = makeExhibitWithNifFailForConclusion(36, 36);
  const section = buildConclusionSection(exhibit);
  const text = section.narrative || '';
  // The narrative must include "36/36"
  assert.match(text, /36\/36/,
    `Conclusion narrative must show "36/36", got: "${text}"`);
  assert.doesNotMatch(text, /36\/\?/,
    `Conclusion narrative must not show "36/?" (undefined denominator), got: "${text}"`);
  assert.doesNotMatch(text, /36\/1\b/,
    `Conclusion narrative must not show "36/1" (wrong denominator), got: "${text}"`);
});

test('Bug 5: NIF conclusion shows correct partial fail fraction (e.g. "5/36")', () => {
  const exhibit = makeExhibitWithNifFailForConclusion(36, 5);
  const section = buildConclusionSection(exhibit);
  const text = section.narrative || '';
  assert.match(text, /5\/36/,
    `Partial-fail conclusion narrative must show "5/36", got: "${text}"`);
});
