// 47 CFR §74.1204 FM-translator interference — unit tests for the
// regulatory module + integration tests through the engine.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkTranslatorInterference,
  TRANSLATOR_DU_GATES
} from '../engine/regulatory/translator.js';
import { buildExhibit } from './_helpers.js';

const TRANSLATOR = {
  call: 'W250TEST', facility_id: '60001',
  erp_kw: 0.25, haat_m: 30, frequency_mhz: 100.1,
  lat: 37.0902, lon: -95.7129
};

// 1 kW Class A primary at 100 m HAAT is the textbook §73.207 reference.
function classAPrimary({ frequency_mhz, lat, lon, call = 'WCLA', facility_id = '12345' }){
  return { call, facility_id, fcc_class: 'A', frequency_mhz, erp_kw: 6.0, haat_m: 100, lat, lon };
}

test('No primaries: study skipped, MISSING_NEARBY_STATIONS surfaced via flag', () => {
  const r = checkTranslatorInterference({ translator: TRANSLATOR });
  assert.equal(r.cite, '47 CFR §74.1204');
  assert.equal(r.studies.length, 0);
  assert.equal(r.missing_nearby_stations, true);
  assert.equal(r.violations.length, 0);
  // Pass remains true (no violations found) because the study itself was unable to run.
  assert.equal(r.pass, true);
});

test('Co-channel: distant primary passes (D/U > 20 dB)', () => {
  // Class A primary 200 km west of the translator on the same channel.
  const primary = classAPrimary({
    frequency_mhz: 100.1,
    lat:           37.0902,
    lon:           -98.0          // ~200 km west of -95.7129 at lat 37
  });
  const r = checkTranslatorInterference({ translator: TRANSLATOR, primaries: [primary] });
  assert.equal(r.studies.length, 1);
  const s = r.studies[0];
  assert.equal(s.relationship, 'co-channel');
  assert.equal(s.du_threshold_db, TRANSLATOR_DU_GATES.cochannel);
  assert.ok(s.pass, `expected pass for distant co-channel; got D/U=${s.du_actual_db} dB at ${s.translator_distance_to_protected_edge_km} km`);
  assert.equal(r.pass, true);
});

test('Co-channel: very close primary fails (D/U < 20 dB)', () => {
  // Class A primary just 5 km away on the same channel — translator is
  // either inside or near the primary's protected contour, so D/U < 20 dB.
  const primary = classAPrimary({
    frequency_mhz: 100.1,
    lat:           37.13,
    lon:           -95.71         // a few km north
  });
  const r = checkTranslatorInterference({ translator: TRANSLATOR, primaries: [primary] });
  const s = r.studies[0];
  assert.equal(s.relationship, 'co-channel');
  assert.equal(s.pass, false, `expected FAIL on close co-channel; got D/U=${s.du_actual_db} dB`);
  assert.equal(r.pass, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].cite, '47 CFR §74.1204(a)');
});

test('Channel relationship classification is exact', () => {
  // Translator on 100.1; build primaries at 100.1, 100.3, 99.9, 100.7, 89.5.
  const primaries = [
    { call: 'cochan',  fcc_class: 'A', frequency_mhz: 100.1, erp_kw: 6, haat_m: 100, lat: 37.0902, lon: -98.0 },
    { call: 'first+',  fcc_class: 'A', frequency_mhz: 100.3, erp_kw: 6, haat_m: 100, lat: 37.0902, lon: -98.0 },
    { call: 'first-',  fcc_class: 'A', frequency_mhz:  99.9, erp_kw: 6, haat_m: 100, lat: 37.0902, lon: -98.0 },
    { call: 'third+',  fcc_class: 'A', frequency_mhz: 100.7, erp_kw: 6, haat_m: 100, lat: 37.0902, lon: -98.0 },
    { call: 'far',     fcc_class: 'A', frequency_mhz:  95.5, erp_kw: 6, haat_m: 100, lat: 37.0902, lon: -98.0 }
  ];
  const r = checkTranslatorInterference({ translator: TRANSLATOR, primaries });
  const byCall = Object.fromEntries(r.studies.map(s => [s.primary_call, s]));
  assert.equal(byCall.cochan.relationship, 'co-channel');
  assert.equal(byCall['first+'].relationship, '1st-adjacent');
  assert.equal(byCall['first-'].relationship, '1st-adjacent');
  assert.equal(byCall['third+'].relationship, '3rd-adjacent');
  assert.equal(byCall.far.relationship, 'non-restricted');
  assert.equal(byCall.far.skipped, true, 'non-restricted offsets must be skipped');
  assert.equal(byCall.far.pass, true);
});

test('Class B/C primary uses 54 dBu protected contour', () => {
  // A Class B/C station gets a 54 dBu protected field, not 60 dBu.
  const primary = classAPrimary({ frequency_mhz: 100.1, lat: 37.0902, lon: -98.0 });
  primary.fcc_class = 'C';
  const r = checkTranslatorInterference({ translator: TRANSLATOR, primaries: [primary] });
  const s = r.studies[0];
  assert.equal(s.primary_protected_field_dbu, 54,
    'Class C primary must use the 54 dBu protected contour');
});

test('Translator inputs missing -> structured failure, no fabrication', () => {
  const r = checkTranslatorInterference({
    translator: { erp_kw: 0.25, haat_m: 30 }       // no freq / lat / lon
  });
  assert.equal(r.pass, false);
  assert.ok(r.violations.length === 0,
    'no §74.1204 violations until a real study runs');
  // The notes block calls out the missing inputs.
  assert.ok(r.notes.length > 0);
});

test('Engine integration: FX exhibit without primaries has MISSING_NEARBY_STATIONS', async () => {
  const x = await buildExhibit({
    call: 'W250FX', facility_id: '60002',
    service: 'FX', fcc_class: 'D',
    frequency: 100.1, erp_kw: 0.25, haat_m: 30,
    lat: 37.0902, lon: -95.7129,
    radial_step_deg: 30
  });
  assert.ok(x.regulatory_compliance);
  assert.equal(x.regulatory_compliance.cite, '47 CFR §74.1204');
  assert.equal(x.regulatory_compliance.missing_nearby_stations, true);
  assert.ok(x.warnings.find(w => w.code === 'MISSING_NEARBY_STATIONS'),
    'translator without nearby_primaries must surface MISSING_NEARBY_STATIONS');
  assert.ok(!x.warnings.find(w => w.code === 'TRANSLATOR_INTERFERENCE'),
    'must not assert §74.1204 violation when the study did not run');
});

test('Engine integration: FX exhibit with violating primary blocks via TRANSLATOR_INTERFERENCE', async () => {
  const { compute } = await import('../engine/index.js');
  const { runValidationSuite } = await import('../engine/validation/runner.js');
  const validationRun = await runValidationSuite();
  const x = await compute({
    inputs: {
      call: 'W250FX', facility_id: '60002',
      service: 'FX', fcc_class: 'D',
      frequency: 100.1, erp_kw: 0.25, haat_m: 30,
      lat: 37.0902, lon: -95.7129,
      radial_step_deg: 30
    },
    evidence: {
      nearby_primaries: [
        { call: 'WCLOSEA', facility_id: '99', fcc_class: 'A',
          frequency_mhz: 100.1, erp_kw: 6.0, haat_m: 100,
          lat: 37.13, lon: -95.71 }      // ~3 km north — co-channel collision
      ]
    },
    options: {
      validation: { runs: [validationRun], reference_cases_present: validationRun.reference_cases_present }
    }
  });
  assert.equal(x.regulatory_compliance.pass, false);
  assert.ok(x.warnings.find(w => w.code === 'TRANSLATOR_INTERFERENCE'),
    'co-channel collision must produce TRANSLATOR_INTERFERENCE');
  assert.ok(x.blockers.find(b => b.code === 'TRANSLATOR_INTERFERENCE'),
    'TRANSLATOR_INTERFERENCE must surface as a blocker');
});
