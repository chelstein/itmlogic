// Regression tests for 3 KJIM post-PR audit bugs.
//
// Bug 1: Blocker count contradiction — annotations-sourced blockers counted by
//        FilingHeroBanner (App.jsx) but not by FilingReadinessGauge (TelemetryRack).
//        Fix: TelemetryRack merges exhibit.blockers + exhibit.annotations blockers.
//
// Bug 2: AM map preview labels — MapPreview default contours use FM dBu labels;
//        fix derives contours from exhibit.polygons (field_strength.unit = mV/m for AM).
//
// Bug 3: KJIM directional_pattern_applied=false / pattern_source=none —
//        pattern_day (facility-record DA pattern) not promoted to pattern_table
//        before engine compute.

import test from 'node:test';
import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1: Single source of truth for blocker count
// ─────────────────────────────────────────────────────────────────────────────

// Simulate the merged-blocker logic now used in TelemetryRack.
function mergedBlockerCount(exhibit) {
  const annBlockers = (exhibit?.annotations || []).filter(a => (a?.severity || a?.level) === 'blocker');
  return (exhibit?.blockers || []).length + annBlockers.length;
}
// Same formula used by FilingHeroBanner in App.jsx.
function heroBannerBlockerCount(exhibit) {
  return (exhibit?.blockers?.length || 0)
       + (exhibit?.annotations || []).filter(a => (a?.severity || a?.level) === 'blocker').length;
}

test('Bug 1: annotation blocker adds to both hero banner and readiness gauge count', () => {
  const exhibit = {
    blockers:    [],   // no engine-level blockers
    warnings:    [],
    annotations: [
      { severity: 'blocker', code: 'AM_NIGHT_NIF_FAIL', message: 'NIF fail' }
    ]
  };
  assert.equal(heroBannerBlockerCount(exhibit), 1, 'hero banner should count annotation blocker');
  assert.equal(mergedBlockerCount(exhibit),     1, 'gauge must match banner');
});

test('Bug 1: engine blocker without annotation — both paths agree', () => {
  const exhibit = {
    blockers:    [{ severity: 'blocker', code: 'CURVE_VALIDATION_MISSING' }],
    warnings:    [{ severity: 'blocker', code: 'CURVE_VALIDATION_MISSING' }],
    annotations: []
  };
  assert.equal(heroBannerBlockerCount(exhibit), 1);
  assert.equal(mergedBlockerCount(exhibit),     1);
});

test('Bug 1: no blockers anywhere — both return 0', () => {
  const exhibit = { blockers: [], warnings: [], annotations: [] };
  assert.equal(heroBannerBlockerCount(exhibit), 0);
  assert.equal(mergedBlockerCount(exhibit),     0);
});

test('Bug 1: annotation severity "warning" does not inflate blocker count', () => {
  const exhibit = {
    blockers:    [],
    annotations: [{ severity: 'warning', code: 'AM_NIGHT_NIF_REVIEW' }]
  };
  assert.equal(heroBannerBlockerCount(exhibit), 0);
  assert.equal(mergedBlockerCount(exhibit),     0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 2: AM map preview labels (field_strength.unit = mV/m)
// ─────────────────────────────────────────────────────────────────────────────

// Simulate the mapPreviewContours derivation from App.jsx.
function deriveMapPreviewContours(exhibit, CONTOUR_COLORS) {
  const polys = (exhibit?.polygons || []).filter(p => p.mean_radial_km > 0);
  if (!polys.length) return undefined;
  return polys.map((p, i) => ({
    name:  p.label,
    field: p.field_strength ? `${p.field_strength.value} ${p.field_strength.unit}` : '',
    color: CONTOUR_COLORS[i] || '#9fdcb1',
    km:    p.mean_radial_km
  }));
}

const CONTOUR_COLORS = ['#ffb347', '#d6a36a', '#6fd3ff'];

test('Bug 2: AM exhibit polygons produce mV/m field labels in map preview', () => {
  const exhibit = {
    polygons: [
      { label: '25 mV/m (service)',   field_strength: { value: 25,  unit: 'mV/m' }, mean_radial_km: 45.2, closed: true },
      { label: '5 mV/m (city grade)', field_strength: { value: 5,   unit: 'mV/m' }, mean_radial_km: 120.3, closed: true },
      { label: '2 mV/m (primary)',    field_strength: { value: 2,   unit: 'mV/m' }, mean_radial_km: 180.1, closed: true },
    ]
  };
  const contours = deriveMapPreviewContours(exhibit, CONTOUR_COLORS);
  assert.ok(contours, 'should return contours for AM exhibit with valid polygons');
  assert.equal(contours.length, 3);
  assert.match(contours[0].field, /mV\/m/, 'first contour field label must contain mV/m');
  assert.match(contours[1].field, /mV\/m/, 'second contour field label must contain mV/m');
  assert.ok(!contours[0].field.includes('dBu'), 'AM contour labels must NOT include dBu');
});

test('Bug 2: FM exhibit polygons produce dBu field labels in map preview', () => {
  const exhibit = {
    polygons: [
      { label: '60 dBu (1 mV/m service)', field_strength: { value: 60, unit: 'dBu' }, mean_radial_km: 55.3, closed: true },
      { label: '54 dBu (city grade)',      field_strength: { value: 54, unit: 'dBu' }, mean_radial_km: 30.1, closed: true },
    ]
  };
  const contours = deriveMapPreviewContours(exhibit, CONTOUR_COLORS);
  assert.ok(contours);
  assert.match(contours[0].field, /dBu/);
  assert.match(contours[1].field, /dBu/);
});

test('Bug 2: no polygons → returns undefined (MapPreview uses own defaults)', () => {
  const contours = deriveMapPreviewContours({ polygons: [] }, CONTOUR_COLORS);
  assert.equal(contours, undefined);
});

test('Bug 2: polygons with mean_radial_km=null are excluded', () => {
  const exhibit = {
    polygons: [
      { label: '25 mV/m', field_strength: { value: 25, unit: 'mV/m' }, mean_radial_km: null },
      { label: '5 mV/m',  field_strength: { value: 5,  unit: 'mV/m' }, mean_radial_km: 80.2 },
    ]
  };
  const contours = deriveMapPreviewContours(exhibit, CONTOUR_COLORS);
  assert.ok(contours);
  assert.equal(contours.length, 1);
  assert.equal(contours[0].km, 80.2);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 3: pattern_day promoted to pattern_table in exhibitService step 6e
// ─────────────────────────────────────────────────────────────────────────────

// Simulate the step 6e logic that was added: promote pattern_day → pattern_table.
function step6e(inputs, evidence) {
  // NEC pattern wins over facility record
  if (!inputs.pattern_table && evidence.nec_pattern_table) {
    inputs.pattern_table = evidence.nec_pattern_table;
  }
  // Facility-record DA pattern: promote pattern_day → pattern_table when
  // no operator-supplied or NEC-derived pattern is already present.
  if (!inputs.pattern_table && inputs.pattern_day) {
    inputs.pattern_table = inputs.pattern_day;
  }
  return inputs;
}

// Simulate amProfile directional_pattern_applied logic.
function amProfileDpa(inputs, evidence) {
  return !!(inputs.pattern_table || inputs.pattern_day || evidence.nec_pattern_table);
}

const DA_PATTERN = [[0,1.0],[45,0.8],[90,0.6],[135,0.4],[180,0.3],[225,0.4],[270,0.6],[315,0.8]];

test('Bug 3: pattern_day promoted to pattern_table when no operator pattern_table set', () => {
  const inputs   = { pattern_day: DA_PATTERN, pattern_table: null, pattern_mode: 'DA-2' };
  const evidence = {};
  step6e(inputs, evidence);
  assert.equal(inputs.pattern_table, DA_PATTERN, 'pattern_table must be set from pattern_day');
});

test('Bug 3: operator pattern_table wins over pattern_day', () => {
  const opPattern = [[0,1.0],[90,0.9]];
  const inputs    = { pattern_day: DA_PATTERN, pattern_table: opPattern };
  const evidence  = {};
  step6e(inputs, evidence);
  assert.equal(inputs.pattern_table, opPattern, 'operator-supplied pattern_table must not be overwritten');
});

test('Bug 3: NEC pattern wins over pattern_day', () => {
  const necPat = [[0,1.0],[90,0.7]];
  const inputs = { pattern_day: DA_PATTERN, pattern_table: null };
  const evidence = { nec_pattern_table: necPat };
  step6e(inputs, evidence);
  assert.equal(inputs.pattern_table, necPat, 'NEC pattern must win over pattern_day');
});

test('Bug 3: directional_pattern_applied is true when only pattern_day provided', () => {
  const inputs   = { pattern_day: DA_PATTERN, pattern_table: null };
  const evidence = {};
  step6e(inputs, evidence);
  const dpa = amProfileDpa(inputs, evidence);
  assert.equal(dpa, true);
});

test('Bug 3: directional_pattern_applied is false when neither pattern source present', () => {
  const inputs   = { pattern_day: null, pattern_table: null };
  const evidence = {};
  step6e(inputs, evidence);
  const dpa = amProfileDpa(inputs, evidence);
  assert.equal(dpa, false);
});
