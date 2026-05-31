// AM-aware engineering-report sections — Appendix B + C + D + E,
// Facility Parameters, Methodology.
//
// Bugs fixed (visible on the 2026-05-13 KRDM PDF):
//   1. Appendix B for AM showed §73.207/§73.215 columns (FM-only rules)
//      with every cell "—".  Should show §73.187/§73.190 + populated
//      Freq (kHz), Relationship, Dist (km), Pair.
//   2. Appendices C/D/E read non-existent keys (exhibit.method_versions
//      .dataset, exhibit.provenance.engine_version, ...) and rendered
//      "—" everywhere.  Must read method_versions.curve_dataset.* and
//      exhibit.engine_signature.* — the keys the engine actually writes.
//   3. Facility Parameters showed "HAAT: —" + DEM terrain rows for AM
//      stations.  AM uses ground conductivity (σ) and no DEM.
//   4. Methodology repeated the same hollow rows for AM.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAppendixSections }       from '../exports/engineeringReport/sections/appendices.js';
import { buildFacilityParametersSection } from '../exports/engineeringReport/sections/facilityParameters.js';
import { buildMethodologySection }     from '../exports/engineeringReport/sections/methodology.js';
import { buildAssumptionsSection }     from '../exports/engineeringReport/sections/assumptions.js';

// Minimal KRDM-shaped exhibit fixture.  Mirrors the actual engine
// output: method_versions.curve_dataset (object), engine_signature
// (the build attestation), per-station rules under .rules.section_*.
function makeAmExhibit(){
  return {
    station_inputs: {
      call: 'KRDM', facility_id: '129314', service: 'AM',
      fcc_class: 'C', frequency: 1240, frequency_unit: 'kHz',
      erp_kw: 1.0, ground_sigma_mS_m: 8,
      lat: 44.277889, lon: -121.146694,
      radial_step_deg: 10
    },
    method_versions: {
      curve_dataset: {
        curve_version: '2024-09', meta_sha256: 'e277dce5107133333333',
        dataset_sha256: {}, source_dir: 'src/engine/curves/datasets'
      },
      curve_engine: null,        // AM uses gwave.js, not fcc-canonical
      fcc_orchestration: { commit: 'b55870d3f20618e886cd02379008ef980229d44b' }
    },
    engine_signature: {
      module: 'genoa-engine', version: '2.0.0',
      hash: 'b55870d3f20618e886cd02379008ef980229d44b',
      release_tag: 'v2.0.0', build_time: '2026-05-13T16:00:00Z',
      node: 'v20.11.0',
      fingerprint_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    },
    generated_at: '2026-05-13T16:53:13.037Z',
    evidence: {
      nearby_primaries: [
        { call: 'KSLM', facility_id: '10963', fcc_class: 'D',
          frequency_khz: 1240, frequency_unit: 'kHz',
          distance_km: 415.2, channel_relationship: 'cochannel' },
        { call: 'KRYN', facility_id: '51210', fcc_class: 'C',
          frequency_khz: 1240, frequency_unit: 'kHz',
          distance_km: 1190.4, channel_relationship: 'cochannel' }
      ]
    },
    interference_study: {
      n_stations: 2, n_pass: 2, n_fail: 0, filing_qualifies: true,
      stations: [
        {
          call: 'KSLM', facility_id: '10963', fcc_class: 'D',
          frequency_khz: 1240,
          channel_relationship: 'cochannel',
          distance_km: 415.2,
          rules: { section_73_187: { pass: true, cite: '47 CFR §73.187 + §73.190 (Wang skywave)' } },
          pass_overall: true, qualified_via: ['§73.187'], failed_rules: []
        },
        {
          // Second station: missing distance_km on the station row;
          // appendix must fall back to evidence.nearby_primaries.
          call: 'KRYN', facility_id: '51210', fcc_class: 'C',
          frequency_khz: 1240,
          channel_relationship: 'cochannel',
          rules: { section_73_187: { pass: true } },
          pass_overall: true
        }
      ]
    },
    radial_table: []
  };
}

/* ────────────── Appendix B ────────────── */

test('AM Appendix B: columns are §73.182(k)/§73.190 (not §73.207/§73.215)', () => {
  // PR-CITE2 (F-005): AM nighttime skywave protection column header
  // updated from the prior mis-attribution "§73.187 / §73.190" to the
  // correct statutory basis "§73.182(k) / §73.190".  §73.187 is the
  // daytime-radiation rule and is not the basis for nighttime checks.
  // See engine/regulatory/citations.js for the canonical cite catalog.
  const x = makeAmExhibit();
  const ab = buildAppendixSections(x).find(s => s.id === 'appendix-b');
  const labels = ab.table.columns.map(c => c.label);
  assert.ok(labels.includes('§73.182(k) / §73.190'),
    `AM must show §73.182(k)/§73.190 column; got ${labels.join('|')}`);
  assert.ok(!labels.includes('§73.207'), 'AM must NOT show §73.207 column');
  assert.ok(!labels.includes('§73.215'), 'AM must NOT show §73.215 column');
  assert.ok(labels.includes('Freq (kHz)'), 'AM must show kHz unit');
});

test('AM Appendix B: rows are populated (no all-dashes regression)', () => {
  const x = makeAmExhibit();
  const ab = buildAppendixSections(x).find(s => s.id === 'appendix-b');
  const r0 = ab.table.rows[0];
  assert.equal(r0.call,         'KSLM');
  assert.equal(r0.facility_id,  '10963');
  assert.equal(r0.fcc_class,    'D');
  assert.equal(r0.frequency,    '1240');
  assert.equal(r0.relationship, 'cochannel');
  assert.equal(r0.distance_km,  '415.20');
  assert.equal(r0.rule_187,     'PASS');
  assert.equal(r0.pair_pass,    'PASS');
});

test('AM Appendix B: distance falls back to evidence.nearby_primaries when station row lacks it', () => {
  const x = makeAmExhibit();
  const ab = buildAppendixSections(x).find(s => s.id === 'appendix-b');
  const r1 = ab.table.rows[1];
  assert.equal(r1.call,        'KRYN');
  // KRYN station row has no distance_km; appendix must pull it from
  // evidence.nearby_primaries (1190.4 km).
  assert.equal(r1.distance_km, '1190.40');
});

test('FM Appendix B: still shows §73.207 + §73.215 columns', () => {
  const fm = {
    station_inputs: { call: 'WFM', service: 'FM' },
    interference_study: {
      n_stations: 1, n_pass: 1, n_fail: 0,
      stations: [{
        call: 'WOTHER', facility_id: '54321', fcc_class: 'B',
        frequency_mhz: 98.7, channel_relationship: 'cochannel', distance_km: 150,
        rules: { section_73_207: { pass: true }, section_73_215: { pass: true } },
        pass_overall: true
      }]
    }
  };
  const ab = buildAppendixSections(fm).find(s => s.id === 'appendix-b');
  const labels = ab.table.columns.map(c => c.label);
  assert.ok(labels.includes('§73.207'));
  assert.ok(labels.includes('§73.215'));
  assert.equal(ab.table.rows[0].rule_207, 'PASS');
  assert.equal(ab.table.rows[0].rule_215, 'PASS');
});

/* ────────────── Appendix C — Validation evidence ────────────── */

test('Appendix C: reads method_versions.curve_dataset.* (not the missing flat keys)', () => {
  const x = makeAmExhibit();
  const ac = buildAppendixSections(x).find(s => s.id === 'appendix-c');
  const get = (key) => ac.rows.find(r => r[0] === key)?.[1];
  assert.match(get('Curve dataset'),         /gwave\.js|73\.184/i, 'AM curve dataset label must reference gwave/§73.184');
  assert.equal(get('Curve dataset SHA-256'), 'e277dce5107133333333');
  assert.match(get('Curve engine'),          /gwave/i, 'AM curve engine row must not be "—"');
  assert.equal(get('FCC orchestration commit'),
               'b55870d3f20618e886cd02379008ef980229d44b');
});

/* ────────────── Appendix D — Provenance ────────────── */

test('Appendix D: reads engine_signature.* (the keys the engine actually writes)', () => {
  const x = makeAmExhibit();
  const ad = buildAppendixSections(x).find(s => s.id === 'appendix-d');
  const get = (key) => ad.rows.find(r => r[0] === key)?.[1];
  assert.equal(get('Engine version'),   '2.0.0');
  assert.equal(get('Engine commit'),    'b55870d3f20618e886cd02379008ef980229d44b');
  assert.equal(get('Release tag'),      'v2.0.0');
  assert.equal(get('Build timestamp'),  '2026-05-13T16:00:00Z');
  assert.equal(get('Compute timestamp'),'2026-05-13T16:53:13.037Z');
  assert.equal(get('Build fingerprint'),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(get('Node runtime'),     'v20.11.0');
});

/* ────────────── Appendix E — Replay determinism ────────────── */

test('Appendix E: surfaces deterministic identifiers even when no bundle file is generated', () => {
  const x = makeAmExhibit();
  const ae = buildAppendixSections(x).find(s => s.id === 'appendix-e');
  const get = (key) => ae.rows.find(r => r[0] === key)?.[1];
  assert.match(get('Determinism contract'), /same engine.*same.*inputs.*same numbers/i);
  assert.equal(get('Engine fingerprint'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(get('Curve dataset hash'), 'e277dce5107133333333');
  assert.match(get('Reproduction'),       /genoa replay/);
});

/* ────────────── Facility Parameters (AM-aware) ────────────── */

test('Facility Parameters: AM shows σ (ground conductivity), suppresses HAAT + DEM rows', () => {
  const x = makeAmExhibit();
  const fp = buildFacilityParametersSection(x);
  const labels = fp.rows.map(r => r[0]);
  assert.ok(!labels.includes('HAAT'), 'AM must not show HAAT row');
  assert.ok(labels.includes('Ground conductivity (σ)'), `AM must show σ row; got ${labels.join('|')}`);
  const sigmaRow = fp.rows.find(r => r[0] === 'Ground conductivity (σ)');
  assert.match(sigmaRow[1], /8\s*mS\/m/);
  assert.ok(!labels.includes('Terrain source'), 'AM must not show DEM terrain source');
  assert.ok(labels.includes('Allocation basis'));
});

test('Facility Parameters: FM still shows HAAT + Terrain source (no regression)', () => {
  const fm = {
    station_inputs: { service: 'FM', frequency: 98.7, erp_kw: 6, haat_m: 100,
                      lat: 37, lon: -95, radial_step_deg: 10 }
  };
  const fp = buildFacilityParametersSection(fm);
  const labels = fp.rows.map(r => r[0]);
  assert.ok(labels.includes('HAAT'));
  assert.ok(labels.includes('Terrain source'));
  assert.ok(!labels.includes('Ground conductivity (σ)'));
});

/* ────────────── Methodology (AM-aware) ────────────── */

test('Methodology: AM lists curve dataset by name, suppresses DEM rows, mentions σ interp', () => {
  const x = makeAmExhibit();
  const m = buildMethodologySection(x);
  const get = (key) => m.rows.find(r => r[0] === key)?.[1];
  assert.match(get('Curve dataset'),         /gwave\.js|73\.184/i);
  assert.equal(get('Curve dataset SHA-256'), 'e277dce5107133333333');
  assert.match(get('Curve engine'),          /gwave/i);
  assert.match(get('Interpolation — σ'),     /73\.184|Figure M3/);
  // DEM rows must NOT be present on an AM methodology page.
  assert.equal(get('Terrain source'), undefined);
  assert.equal(get('DEM dataset'),    undefined);
});

/* ────────────── G-011: σ rounding disclosure in Assumptions ────────────── */

// G-011: when the engine clamped or rounded the typed σ to the nearest FCC M3
// integer grid point, buildAssumptionsSection must disclose the rounding in the
// groundLine paragraph — the PE reviewer needs to know which boundary curve
// was actually used.
test('G-011: Assumptions discloses σ rounding when sigma_rounding != 0', () => {
  const x = makeAmExhibit();
  // Inject ground_constants with a non-zero rounding (typed 2.7 → used 3 mS/m)
  x.evidence = {
    ...x.evidence,
    ground_constants: {
      sigma_input:    2.7,
      sigma_used:     3,
      sigma_rounding: 0.3,
      sigma_clamp:    null
    }
  };
  const sec = buildAssumptionsSection(x);
  const groundParagraph = sec.paragraphs.find(p =>
    typeof p === 'string' && p.includes('Ground conductivity')
  );
  assert.ok(groundParagraph, 'should produce a ground conductivity paragraph');
  assert.match(groundParagraph, /NOTE.*σ.*2\.7.*rounded.*3/i,
    'must disclose σ rounding: input 2.7 rounded to 3');
  assert.match(groundParagraph, /mS\/m/,
    'units must be stated');
});

test('G-011: Assumptions discloses clamp direction when sigma_clamp is set', () => {
  const x = makeAmExhibit();
  // Inject ground_constants with a clamped σ (typed 9 mS/m, clamped to 8 mS/m max)
  x.evidence = {
    ...x.evidence,
    ground_constants: {
      sigma_input:    9,
      sigma_used:     8,
      sigma_rounding: -1,
      sigma_clamp:    'max'
    }
  };
  const sec = buildAssumptionsSection(x);
  const groundParagraph = sec.paragraphs.find(p =>
    typeof p === 'string' && p.includes('Ground conductivity')
  );
  assert.ok(groundParagraph, 'should produce a ground conductivity paragraph');
  assert.match(groundParagraph, /max-clamped/i, 'must say "max-clamped"');
  assert.match(groundParagraph, /9.*8|8.*9/i, 'must mention both sigma values');
});

test('G-011: Assumptions does NOT insert σ rounding note when sigma_rounding = 0', () => {
  const x = makeAmExhibit();
  x.evidence = {
    ...x.evidence,
    ground_constants: {
      sigma_input:    8,
      sigma_used:     8,
      sigma_rounding: 0,
      sigma_clamp:    null
    }
  };
  const sec = buildAssumptionsSection(x);
  const groundParagraph = sec.paragraphs.find(p =>
    typeof p === 'string' && p.includes('Ground conductivity')
  );
  assert.ok(groundParagraph, 'should produce a ground conductivity paragraph');
  assert.doesNotMatch(groundParagraph, /NOTE.*σ/i,
    'must not insert a rounding note when sigma_rounding is 0');
});

/* ────────────── G-017: Full AM report structural snapshot ────────────── */

// G-017: render every section builder on a full AM exhibit and assert the
// section model is structurally complete — correct IDs, non-empty content,
// no FM vocabulary leaking into AM output.  This is a structural snapshot:
// it pins the shape and critical fields rather than byte-for-byte text, so
// it catches regressions without being brittle to minor wording changes.
test('G-017: full AM exhibit produces structurally complete report sections', () => {
  const x = makeAmExhibit();
  x.evidence = {
    ...x.evidence,
    ground_constants: { sigma_input: 8, sigma_used: 8, sigma_rounding: 0, sigma_clamp: null }
  };

  // Assumptions
  const assumptions = buildAssumptionsSection(x);
  assert.equal(assumptions.id,   'assumptions', 'assumptions id');
  assert.equal(assumptions.type, 'paragraphs',  'assumptions type');
  assert.ok(Array.isArray(assumptions.paragraphs) && assumptions.paragraphs.length >= 7,
    'assumptions must have at least 7 paragraphs');
  const joined = assumptions.paragraphs.join(' ');
  // AM-specific vocabulary must appear
  assert.match(joined, /73\.184|groundwave/i, 'assumptions must cite §73.184 / groundwave');
  assert.match(joined, /conductivity/i,       'assumptions must mention conductivity');
  // HAAT must only appear in the "does not apply" disclaimer, not as a prescribed value.
  // Check it is not used as an affirmative FM-style assumption line.
  assert.doesNotMatch(joined, /HAAT:\s*\d/,   'AM assumptions must not prescribe a HAAT value');
  assert.doesNotMatch(joined, /§73\.316/,     'AM assumptions must not cite FM §73.316');

  // Facility Parameters
  const fp = buildFacilityParametersSection(x);
  assert.equal(fp.id,   'parameters', 'facility-parameters id');
  assert.ok(Array.isArray(fp.rows) && fp.rows.length >= 5, 'must have at least 5 rows');
  const fpLabels = fp.rows.map(r => r[0]);
  assert.ok(fpLabels.includes('Ground conductivity (σ)'), 'must have σ row');
  assert.ok(!fpLabels.includes('HAAT'), 'must not have HAAT row');

  // Methodology
  const m = buildMethodologySection(x);
  assert.equal(m.id, 'methodology', 'methodology id');
  assert.ok(Array.isArray(m.rows) && m.rows.length >= 4, 'must have at least 4 rows');

  // Appendices B/C/D/E
  const appendices = buildAppendixSections(x);
  const appIds = appendices.map(a => a.id);
  for (const required of ['appendix-b', 'appendix-c', 'appendix-d', 'appendix-e']){
    assert.ok(appIds.includes(required), `must include ${required}`);
  }
  const ab = appendices.find(a => a.id === 'appendix-b');
  assert.ok(ab.table.rows.length === 2, 'appendix-b must have 2 station rows for KRDM');
  // Verify no FM column labels leaked into AM appendix B
  const abLabels = ab.table.columns.map(c => c.label);
  assert.ok(!abLabels.includes('§73.207'), 'appendix-b must not show §73.207 for AM');
  assert.ok(!abLabels.includes('§73.215'), 'appendix-b must not show §73.215 for AM');
});
