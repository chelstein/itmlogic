// Source Attestation Framework v2 — unit tests.
//
// Covers the sprint definition-of-done test list:
//   primary-over-secondary, secondary-only-when-primary-missing,
//   operator-only warning, HAAT tolerance conflict, coordinate
//   meter-distance tolerance, manual override governance, filing-status
//   derivation (conflicts block VERIFIED; rule fail → NON_COMPLIANT;
//   unmeasured evidence does not fail math), exhibit JSON integration,
//   PDF section rendering, and deterministic payload hashing for the
//   replay/provenance chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_TYPE, AUTHORITY_LEVEL,
  makeAttestedValue, wrapLegacyScalar,
  resolveOperativeValue, RESOLUTION_STATUS,
  deriveFilingStatus, buildStatusDimensions,
  MATH_STATUS, SOURCE_STATUS, RULE_STATUS, EVIDENCE_STATUS, FILING_STATUS,
  buildAttestedExhibitValues, collectFieldCandidates
} from '../attestation/index.js';
import { buildSourceAttestationSection } from '../exports/engineeringReport/sections/sourceAttestation.js';

const lmsHaat = (v = 506) => makeAttestedValue({
  key: 'haat_m', value: v, unit: 'm',
  source_type: SOURCE_TYPE.FCC_LMS, source_label: 'FCC LMS facility record',
  fetched_at: '2026-06-08T20:34:01Z'
});
const demHaat = (v = 533.2) => makeAttestedValue({
  key: 'haat_m', value: v, unit: 'm',
  source_type: SOURCE_TYPE.USGS_DEM, source_label: 'Terrain-derived HAAT',
  fetched_at: '2026-06-08T20:35:00Z'
});
const opHaat = (v = 500) => makeAttestedValue({
  key: 'haat_m', value: v, unit: 'm',
  source_type: SOURCE_TYPE.OPERATOR_INPUT
});

test('primary source wins over secondary when values conflict (KNIX HAAT case)', () => {
  const r = resolveOperativeValue('haat_m', [demHaat(533.2), lmsHaat(506)]);
  assert.equal(r.operative_value, 506, 'FCC LMS value must control');
  assert.equal(r.operative_source_type, SOURCE_TYPE.FCC_LMS);
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED_WITH_CONFLICT);
  assert.ok(r.warnings.includes('SOURCE_CONFLICT_HAAT'), 'must raise SOURCE_CONFLICT_HAAT');
  const dem = r.candidates.find(c => c.source_type === SOURCE_TYPE.USGS_DEM);
  assert.equal(dem.operative, false);
  assert.equal(dem.conflicts.length, 1);
  assert.equal(dem.conflicts[0].against_source_type, SOURCE_TYPE.FCC_LMS);
  assert.equal(dem.conflicts[0].code, 'SOURCE_CONFLICT_HAAT');
  assert.ok(Math.abs(dem.conflicts[0].delta - 27.2) < 0.01, `delta ≈ 27.2, got ${dem.conflicts[0].delta}`);
});

test('secondary source wins only when primary is missing', () => {
  const r = resolveOperativeValue('rcamsl_m', [
    makeAttestedValue({ key: 'rcamsl_m', value: 612, unit: 'm', source_type: SOURCE_TYPE.USGS_DEM })
  ]);
  assert.equal(r.operative_value, 612);
  assert.equal(r.operative_source_type, SOURCE_TYPE.USGS_DEM);
  assert.equal(r.status, RESOLUTION_STATUS.RESOLVED);

  // ...but loses the moment a primary appears.
  const r2 = resolveOperativeValue('rcamsl_m', [
    makeAttestedValue({ key: 'rcamsl_m', value: 612, unit: 'm', source_type: SOURCE_TYPE.USGS_DEM }),
    makeAttestedValue({ key: 'rcamsl_m', value: 612.5, unit: 'm', source_type: SOURCE_TYPE.FCC_LMS })
  ]);
  assert.equal(r2.operative_source_type, SOURCE_TYPE.FCC_LMS);
});

test('operator input alone produces OPERATOR_SUPPLIED_ONLY', () => {
  const r = resolveOperativeValue('haat_m', [opHaat(500)]);
  assert.equal(r.operative_value, 500);
  assert.ok(r.warnings.includes('OPERATOR_SUPPLIED_ONLY'));
  // haat_m has blocker_if_primary_missing: true → PRIMARY_SOURCE_MISSING blocker
  assert.ok(r.blockers.includes('PRIMARY_SOURCE_MISSING'));
});

test('HAAT conflict over tolerance produces SOURCE_CONFLICT_HAAT; within tolerance does not', () => {
  const over = resolveOperativeValue('haat_m', [lmsHaat(506), demHaat(510)]);  // Δ4 > max(3, 5.1)? rel 1% of 510 = 5.1 → tol 5.1, Δ4 → no conflict
  assert.equal(over.status, RESOLUTION_STATUS.RESOLVED, '4 m delta is inside the 1%-relative band at 510 m');
  const conflict = resolveOperativeValue('haat_m', [lmsHaat(506), demHaat(533.2)]);
  assert.equal(conflict.status, RESOLUTION_STATUS.RESOLVED_WITH_CONFLICT);
  assert.ok(conflict.warnings.includes('SOURCE_CONFLICT_HAAT'));
  const within = resolveOperativeValue('haat_m', [lmsHaat(506), demHaat(508)]);
  assert.equal(within.status, RESOLUTION_STATUS.RESOLVED);
  assert.equal(within.warnings.length, 0);
});

test('coordinate conflict uses meter-distance tolerance, not degree delta', () => {
  const base = { lat: 33.4484, lon: -112.0740 };
  // ~0.00005° lat ≈ 5.6 m — inside the 10 m tolerance even though the
  // degree delta would look "different" to a naive comparison.
  const near = { lat: 33.44845, lon: -112.0740 };
  // ~0.0002° lat ≈ 22 m — beyond tolerance.
  const far  = { lat: 33.4486, lon: -112.0740 };

  const mk = (v, st) => makeAttestedValue({ key: 'coordinates_lat_lon', value: v, unit: 'deg', source_type: st });

  const ok = resolveOperativeValue('coordinates_lat_lon', [mk(base, SOURCE_TYPE.FCC_LMS), mk(near, SOURCE_TYPE.OPERATOR_INPUT)]);
  assert.equal(ok.status, RESOLUTION_STATUS.RESOLVED, '5.6 m apart must not conflict');

  const bad = resolveOperativeValue('coordinates_lat_lon', [mk(base, SOURCE_TYPE.FCC_LMS), mk(far, SOURCE_TYPE.OPERATOR_INPUT)]);
  assert.equal(bad.status, RESOLUTION_STATUS.RESOLVED_WITH_CONFLICT);
  assert.ok(bad.warnings.includes('SOURCE_CONFLICT_COORDINATES'));
  const op = bad.candidates.find(c => c.source_type === SOURCE_TYPE.OPERATOR_INPUT);
  assert.ok(op.conflicts[0].delta > 10 && op.conflicts[0].delta < 30,
    `delta must be meters (~22), got ${op.conflicts[0].delta}`);
  assert.equal(op.conflicts[0].tolerance, 10);
});

test('manual override requires reason and reviewer', () => {
  const bare = makeAttestedValue({
    key: 'haat_m', value: 520, unit: 'm',
    source_type: SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE,
    override: { reason: '', reviewer: '' }
  });
  const r = resolveOperativeValue('haat_m', [bare, lmsHaat(506)]);
  assert.equal(r.operative_value, 506, 'invalid override must not become operative');
  assert.ok(r.blockers.includes('OVERRIDE_INVALID'));

  const good = makeAttestedValue({
    key: 'haat_m', value: 520, unit: 'm',
    source_type: SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE,
    override: { reason: 'Field survey supersedes LMS record pending amendment', reviewer: 'C. Helstein, PE' }
  });
  const r2 = resolveOperativeValue('haat_m', [good, lmsHaat(506), demHaat(533.2)]);
  assert.equal(r2.operative_value, 520, 'valid override outranks everything');
  assert.equal(r2.operative_source_type, SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE);
});

test('two same-rank primaries in conflict → MANUAL_OVERRIDE_REQUIRED, no operative value', () => {
  const lms = makeAttestedValue({ key: 'erp_kw', value: 100, unit: 'kW', source_type: SOURCE_TYPE.FCC_LMS });
  const cdb = makeAttestedValue({ key: 'erp_kw', value: 50,  unit: 'kW', source_type: SOURCE_TYPE.FCC_CDBS });
  const r = resolveOperativeValue('erp_kw', [lms, cdb]);
  assert.equal(r.status, RESOLUTION_STATUS.MANUAL_OVERRIDE_REQUIRED);
  assert.equal(r.operative_value, null);
  assert.ok(r.blockers.includes('MANUAL_OVERRIDE_REQUIRED'));
});

test('ADVISORY sources never become operative', () => {
  const meteo = makeAttestedValue({ key: 'ground_elevation_m', value: 350, unit: 'm', source_type: SOURCE_TYPE.OPEN_METEO });
  const r = resolveOperativeValue('ground_elevation_m', [meteo]);
  assert.equal(r.operative_value, null);
  assert.equal(r.status, RESOLUTION_STATUS.UNRESOLVED);
});

test('unresolved source conflict prevents VERIFIED filing status', () => {
  const fs = deriveFilingStatus({
    math_status:     MATH_STATUS.PASS,
    source_status:   SOURCE_STATUS.SOURCE_CONFLICT,
    rule_status:     RULE_STATUS.PASS,
    evidence_status: EVIDENCE_STATUS.MEASURED
  });
  assert.equal(fs, FILING_STATUS.BLOCKED);

  const fs2 = deriveFilingStatus({
    math_status:     MATH_STATUS.PASS,
    source_status:   SOURCE_STATUS.RESOLVED_WITH_CONFLICT,
    rule_status:     RULE_STATUS.PASS,
    evidence_status: EVIDENCE_STATUS.MEASURED
  });
  assert.equal(fs2, FILING_STATUS.REVIEW, 'resolved-with-conflict is REVIEW, never VERIFIED');
});

test('math fail always blocks; rule fail with math pass produces NON_COMPLIANT', () => {
  assert.equal(deriveFilingStatus({
    math_status: MATH_STATUS.FAIL, source_status: SOURCE_STATUS.RESOLVED,
    rule_status: RULE_STATUS.PASS, evidence_status: EVIDENCE_STATUS.MEASURED
  }), FILING_STATUS.BLOCKED);

  assert.equal(deriveFilingStatus({
    math_status: MATH_STATUS.PASS, source_status: SOURCE_STATUS.RESOLVED,
    rule_status: RULE_STATUS.FAIL, evidence_status: EVIDENCE_STATUS.MEASURED
  }), FILING_STATUS.NON_COMPLIANT);
});

test('unmeasured evidence does not fail FCC curve math (advisory unless required)', () => {
  assert.equal(deriveFilingStatus({
    math_status: MATH_STATUS.PASS, source_status: SOURCE_STATUS.RESOLVED,
    rule_status: RULE_STATUS.PASS, evidence_status: EVIDENCE_STATUS.UNMEASURED,
    evidence_required: false
  }), FILING_STATUS.VERIFIED, 'unmeasured + not required → still VERIFIED');

  assert.equal(deriveFilingStatus({
    math_status: MATH_STATUS.PASS, source_status: SOURCE_STATUS.RESOLVED,
    rule_status: RULE_STATUS.PASS, evidence_status: EVIDENCE_STATUS.UNMEASURED,
    evidence_required: true
  }), FILING_STATUS.REVIEW, 'unmeasured + required → REVIEW');
});

test('legacy scalar wrap produces OPERATOR_SUPPLIED / LOW and stays visible', () => {
  const av = wrapLegacyScalar('erp_kw', 6.0, 'kW');
  assert.equal(av.source_type, SOURCE_TYPE.OPERATOR_INPUT);
  assert.equal(av.authority_level, AUTHORITY_LEVEL.OPERATOR_SUPPLIED);
  assert.equal(av.confidence, 'LOW');
  assert.equal(av.legacy_wrapped, true);
  assert.equal(wrapLegacyScalar('erp_kw', null), null, 'null passthrough must not throw');
  const r = resolveOperativeValue('erp_kw', [av]);
  assert.ok(r.warnings.includes('OPERATOR_SUPPLIED_ONLY'));
});

// ---- exhibit integration ----

function fakeExhibit(){
  return {
    station_inputs: {
      call: 'KNIX', facility_id: 12345, frequency: 102.5, frequency_unit: 'MHz',
      lat: 33.3328, lon: -112.0636, erp_kw: 100, fcc_class: 'C',
      overall_height_m: 160, overall_height_amsl_m: 1580, service: 'FM'
    },
    evidence: {
      fcc_lms: {
        available: true, fetched_at: '2026-06-08T20:34:01Z',
        license: { facility_id: 12345, call: 'KNIX', fcc_class: 'C', frequency: 102.5, erp_kw: 100, haat_m: 506, lat: 33.3328, lon: -112.0636 }
      },
      asr: { lat: 33.33285, lon: -112.0636, overall_height_m: 162, asr_number: 1001234 }
    },
    haat_lineage:  { operator_entered_m: 506, terrain_mean_m: 533.2, operative_source: 'fcc_license' },
    rcamsl_lineage: { source: 'derived', value_m: 1582, ground_elev_m: 1420, elevation_source: 'usgs_3dep' },
    erp_lineage:   { licensed_erp_kw: 100, proposed_erp_kw: 100, variance_pct: 0 },
    class_lineage: { raw: 'C', licensed_class: 'C' },
    frequency_lineage: { value: 102.5, unit: 'MHz' },
    method_versions: { curve_dataset: 'fcc-curves-2025-11' },
    build_attestation: { sha: 'abc123def456' },
    validation_context: { curve_reference_validation: { pass: true, n_pass: 36, n_run: 36 } },
    filing_readiness: { status: 'READY' },
    pattern: [{ az: 0, field: 1 }, { az: 10, field: 0.98 }],
    replay_digest: { exhibit_sha256: 'aaa', inputs_sha256: 'bbb', evidence_sha256: 'ccc' }
  };
}

test('attested values appear in exhibit JSON with all filing-relevant fields', () => {
  const ex = fakeExhibit();
  const att = buildAttestedExhibitValues(ex, ex.evidence);
  assert.equal(att.schema, 'source-attestation/v2');
  for (const key of ['facility_id', 'callsign', 'frequency_mhz', 'erp_kw', 'haat_m',
                     'rcamsl_m', 'ground_elevation_m', 'coordinates_lat_lon', 'fcc_class',
                     'antenna_pattern', 'asr_id', 'asr_height_agl_m', 'terrain_source',
                     'curve_dataset', 'engine_version']){
    assert.ok(att.fields[key], `missing attested field ${key}`);
  }
  // KNIX-style HAAT conflict is first-class: LMS 506 wins, DEM 533.2 conflicts.
  const haat = att.fields.haat_m;
  assert.equal(haat.operative_value, 506);
  assert.equal(haat.operative_source_type, SOURCE_TYPE.FCC_LMS);
  assert.equal(haat.status, RESOLUTION_STATUS.RESOLVED_WITH_CONFLICT);
  assert.ok(haat.warnings.includes('SOURCE_CONFLICT_HAAT'));
  // statuses block is derived, with filing_status from the other four
  assert.equal(att.statuses.math_status, 'PASS');
  assert.equal(att.statuses.source_status, SOURCE_STATUS.RESOLVED_WITH_CONFLICT);
  assert.equal(att.statuses.filing_status, FILING_STATUS.REVIEW, 'HAAT conflict must hold filing at REVIEW');
});

test('payload hash is deterministic and committed for the replay/provenance chain', () => {
  const a = buildAttestedExhibitValues(fakeExhibit(), fakeExhibit().evidence);
  const b = buildAttestedExhibitValues(fakeExhibit(), fakeExhibit().evidence);
  assert.equal(a.payload_sha256, b.payload_sha256, 'same exhibit → same payload hash');
  assert.match(a.payload_sha256, /^[0-9a-f]{64}$/);

  const changed = fakeExhibit();
  changed.haat_lineage.terrain_mean_m = 540;   // different attestation content
  const c = buildAttestedExhibitValues(changed, changed.evidence);
  assert.notEqual(a.payload_sha256, c.payload_sha256, 'changed attestation content → different hash');
});

test('PDF source attestation section renders operative + conflicting rows and narrative', () => {
  const ex = fakeExhibit();
  ex.source_attestation_v2 = buildAttestedExhibitValues(ex, ex.evidence);
  const sec = buildSourceAttestationSection(ex, {});
  assert.ok(sec, 'section must render when v2 block present');
  assert.equal(sec.heading, 'SOURCE ATTESTATION');
  assert.equal(sec.type, 'table-with-summary');

  const haatRow = sec.table.rows.find(r => r.field === 'HAAT (filing-controlling)');
  assert.ok(haatRow, 'HAAT operative row present');
  assert.match(haatRow.value, /506/);
  assert.equal(haatRow.source, 'FCC LMS');
  assert.equal(haatRow.authority, 'PRIMARY');
  assert.equal(haatRow.status, 'RESOLVED_WITH_CONFLICT');

  const demRow = sec.table.rows.find(r => /HAAT \(filing-controlling\) \(non-operative\)/.test(r.field) && r.source === 'USGS DEM');
  assert.ok(demRow, 'non-operative DEM HAAT row present');
  assert.match(demRow.value, /533\.2/);
  assert.match(demRow.status, /NON_OPERATIVE_CONFLICT \(SOURCE_CONFLICT_HAAT\)/);

  assert.match(sec.summary, /filing-controlling HAAT used in this exhibit/);
  assert.match(sec.summary, /basis-selection issue/);

  assert.equal(buildSourceAttestationSection({}, {}), null, 'legacy exhibits self-defer');
});

test('collectFieldCandidates honors attestation_overrides with governance', () => {
  const ex = fakeExhibit();
  ex.attestation_overrides = {
    haat_m: { value: 520, unit: 'm', reason: 'survey-grade re-measurement', reviewer: 'PE-12345' }
  };
  const att = buildAttestedExhibitValues(ex, ex.evidence);
  assert.equal(att.fields.haat_m.operative_value, 520);
  assert.equal(att.fields.haat_m.operative_source_type, SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE);
});

test('buildStatusDimensions rolls up per-field blockers into BLOCKED filing status', () => {
  const resolutions = {
    erp_kw: { status: 'UNRESOLVED', warnings: [], blockers: ['PRIMARY_SOURCE_MISSING'] }
  };
  const st = buildStatusDimensions({
    math_status: MATH_STATUS.PASS, rule_status: RULE_STATUS.PASS,
    evidence_status: EVIDENCE_STATUS.MEASURED, resolutions
  });
  assert.equal(st.source_status, SOURCE_STATUS.UNRESOLVED);
  assert.equal(st.filing_status, FILING_STATUS.BLOCKED);
});
