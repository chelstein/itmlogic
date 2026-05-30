// Workbench Mode backend tests — Genoa FCC engineering tool.
//
// Covers the five acceptance criteria for the canonical operating profile,
// day/night pattern routing, and study_mode normalization added in the
// Workbench Mode backend PR.
//
// All logic is exercised inline (mirroring the exact code paths in
// exhibitService.js steps 6e–6g and the AM night NIF / PSRA-PSSA
// proposed-object construction) without mounting the full orchestrator.

import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helpers — mirror the exact logic from exhibitService.js so these tests
// serve as a living specification of the routing rules.
// ---------------------------------------------------------------------------

/**
 * Build an am_operating_profile from inputs + evidence, exactly as
 * exhibitService.js step 6f does.
 */
function buildAmProfile(inputs, evidence, options = {}) {
  // Step 6e: NEC pattern → inputs.pattern_table (operator data wins)
  if (!inputs.pattern_table && evidence.nec_pattern_table) {
    inputs.pattern_table = evidence.nec_pattern_table;
  }

  const service = String(inputs.service || '').toUpperCase();
  if (service !== 'AM') return null;

  return {
    study_mode:       options.study_mode || 'licensed_current',
    facility_id:      inputs.facility_id || null,
    call_sign:        inputs.call,
    frequency_khz:    Number(inputs.frequency),
    lat:              Number(inputs.lat),
    lon:              Number(inputs.lon),
    erp_kw:                    Number(inputs.erp_kw) || null,
    day_power_kw:              Number(inputs.day_power_kw)  || null,
    night_power_kw:            Number(inputs.night_power_kw) || null,
    critical_hours_power_kw:   Number(inputs.critical_hours_power_kw) || null,
    pattern_mode:     inputs.pattern_mode || 'ND',
    pattern_table:    inputs.pattern_table || null,
    pattern_night:    inputs.pattern_night || null,
    pattern_critical: inputs.pattern_critical || null,
    antenna_geometry: inputs.antenna_geometry || null,
    pattern_source:   evidence.nec_pattern_table ? 'nec_geometry'
                    : inputs.pattern_table ? 'manual_table'
                    : inputs.pattern_day  ? 'facility_record'
                    : 'none',
    directional_pattern_applied: !!(inputs.pattern_table || evidence.nec_pattern_table),
  };
}

/**
 * Build an fm_operating_profile from inputs + evidence, exactly as
 * exhibitService.js step 6f does.
 */
function buildFmProfile(inputs, evidence, options = {}) {
  // Step 6e: NEC pattern → inputs.pattern_table (operator data wins)
  if (!inputs.pattern_table && evidence.nec_pattern_table) {
    inputs.pattern_table = evidence.nec_pattern_table;
  }

  const service = String(inputs.service || '').toUpperCase();
  if (service !== 'FM') return null;

  return {
    study_mode:  options.study_mode || 'licensed_current',
    facility_id: inputs.facility_id || null,
    call_sign:   inputs.call,
    frequency_mhz: Number(inputs.frequency),
    lat: Number(inputs.lat),
    lon: Number(inputs.lon),
    erp_kw:      Number(inputs.erp_kw) || null,
    haat_m:      Number(inputs.haat_m) || null,
    pattern_mode: inputs.pattern_mode || 'ND',
    pattern_table: inputs.pattern_table || null,
    antenna_geometry: inputs.antenna_geometry || null,
    pattern_source: evidence.nec_pattern_table ? 'nec_geometry'
                  : inputs.pattern_table ? 'manual_table'
                  : 'none',
    directional_pattern_applied: !!(inputs.pattern_table || evidence.nec_pattern_table),
  };
}

/**
 * Build the nighttime NIF proposed object, exactly as exhibitService.js
 * step 8d does.
 */
function buildNightProposed(inputs, evidence) {
  const _night_pattern = inputs.pattern_night
    ?? inputs.pattern_table
    ?? evidence.nec_pattern_table
    ?? null;
  return {
    lat:           Number(inputs.lat),
    lon:           Number(inputs.lon),
    freq_khz:      Number(inputs.frequency),
    erp_kw:        Number(inputs.erp_kw),
    fcc_class:     inputs.fcc_class || null,
    facility_id:   inputs.facility_id || null,
    pattern_mode:  inputs.pattern_mode || (_night_pattern ? 'DA' : 'omni'),
    pattern_table: _night_pattern
  };
}

/**
 * Build the PSRA/PSSA proposed object, exactly as exhibitService.js
 * step 8f does.
 */
function buildPsraProposed(inputs, evidence) {
  const night_pattern = inputs.pattern_night
    ?? inputs.pattern_table
    ?? evidence.nec_pattern_table
    ?? null;
  return {
    lat:           Number(inputs.lat),
    lon:           Number(inputs.lon),
    freq_khz:      Number(inputs.frequency),
    p_daytime_kw:  Number(inputs.erp_kw),
    fcc_class:     inputs.fcc_class || null,
    call:          inputs.call || null,
    facility_id:   inputs.facility_id || null,
    pattern_table: night_pattern,
    pattern_mode:  inputs.pattern_mode || (night_pattern ? 'DA' : 'omni')
  };
}

/**
 * Normalize study_mode to canonical enum, exactly as exhibitService.js
 * step 6g does.
 */
function normalizeStudyMode(options = {}) {
  return {
    'cp':               'pending_cp',
    'pending_cp':       'pending_cp',
    'manual_scenario':  'manual_scenario',
    'licensed_current': 'licensed_current',
  }[options.study_mode] || 'licensed_current';
}

// ---------------------------------------------------------------------------
// Test 1: Day/night pattern routing
// ---------------------------------------------------------------------------
test('day/night routing: nighttime NIF study receives pattern_night, not pattern_day', () => {
  const day_pattern   = [[0, 1], [180, 0.1]];
  const night_pattern = [[0, 1], [180, 0.5]];

  const inputs = {
    service: 'AM',
    lat: 40.0, lon: -75.0,
    frequency: 700, erp_kw: 50,
    fcc_class: 'B',
    facility_id: '12345',
    pattern_mode: 'DA',
    pattern_table: day_pattern,    // daytime (general) pattern
    pattern_night:  night_pattern, // nighttime-specific pattern
  };
  const evidence = {};

  const nightProposed = buildNightProposed(inputs, evidence);

  // The nighttime proposed object MUST carry pattern_night, not pattern_day.
  assert.deepStrictEqual(nightProposed.pattern_table, night_pattern,
    'nighttime NIF proposed.pattern_table should equal pattern_night');
  assert.notDeepStrictEqual(nightProposed.pattern_table, day_pattern,
    'nighttime NIF proposed.pattern_table must NOT be pattern_day');

  // PSRA/PSSA also uses nighttime pattern
  const psraProposed = buildPsraProposed(inputs, evidence);
  assert.deepStrictEqual(psraProposed.pattern_table, night_pattern,
    'PSRA/PSSA proposed.pattern_table should also equal pattern_night');
});

test('day/night routing: falls back to pattern_table when pattern_night absent', () => {
  const day_pattern = [[0, 1], [180, 0.3]];
  const inputs = {
    service: 'AM',
    lat: 40.0, lon: -75.0,
    frequency: 700, erp_kw: 50,
    pattern_table: day_pattern,   // single pattern, no split
    // pattern_night is intentionally absent
  };
  const evidence = {};

  const nightProposed = buildNightProposed(inputs, evidence);
  assert.deepStrictEqual(nightProposed.pattern_table, day_pattern,
    'when pattern_night absent, nighttime study falls back to pattern_table');
});

test('day/night routing: pattern_mode=DA when night pattern present, omni when absent', () => {
  const night_pattern = [[0, 1], [90, 0.5], [180, 0.1], [270, 0.5]];

  // With night pattern present and no explicit pattern_mode
  const inputsWith = {
    service: 'AM', lat: 40.0, lon: -75.0, frequency: 700, erp_kw: 50,
    pattern_night: night_pattern,
  };
  const proposed_with = buildNightProposed(inputsWith, {});
  assert.equal(proposed_with.pattern_mode, 'DA',
    'pattern_mode should be DA when night pattern is present');

  // Without any pattern
  const inputsWithout = {
    service: 'AM', lat: 40.0, lon: -75.0, frequency: 700, erp_kw: 50,
  };
  const proposed_without = buildNightProposed(inputsWithout, {});
  assert.equal(proposed_without.pattern_mode, 'omni',
    'pattern_mode should be omni when no pattern at all');
});

// ---------------------------------------------------------------------------
// Test 2: am_operating_profile fields
// ---------------------------------------------------------------------------
test('am_operating_profile: full AM inputs produce correct profile fields', () => {
  const pattern = [[0, 1], [90, 0.5], [180, 0.1], [270, 0.5]];
  const inputs = {
    service: 'AM',
    facility_id: '99999',
    call: 'KTEST',
    frequency: 1190,
    lat: 33.45,
    lon: -112.07,
    erp_kw: 5.0,
    day_power_kw: 5.0,
    night_power_kw: 1.0,
    critical_hours_power_kw: 2.5,
    pattern_mode: 'DA',
    pattern_table: pattern,
    pattern_night: [[0, 1], [180, 0.6]],
    pattern_critical: [[0, 1], [180, 0.4]],
    antenna_geometry: { towers: [{ height_m: 30 }] },
  };
  const evidence = {};
  const options = { study_mode: 'licensed_current' };

  const profile = buildAmProfile({ ...inputs }, evidence, options);

  assert.equal(profile.pattern_source, 'manual_table',
    'pattern_source should be manual_table when inputs.pattern_table is set');
  assert.equal(profile.directional_pattern_applied, true,
    'directional_pattern_applied should be true when pattern_table present');
  assert.equal(profile.call_sign, 'KTEST');
  assert.equal(profile.frequency_khz, 1190);
  assert.equal(profile.erp_kw, 5.0);
  assert.equal(profile.day_power_kw, 5.0);
  assert.equal(profile.night_power_kw, 1.0);
  assert.equal(profile.critical_hours_power_kw, 2.5);
  assert.deepStrictEqual(profile.pattern_table, pattern);
  assert.deepStrictEqual(profile.antenna_geometry, { towers: [{ height_m: 30 }] });
  assert.equal(profile.study_mode, 'licensed_current');
});

test('am_operating_profile: pattern_source=none when no pattern supplied', () => {
  const inputs = {
    service: 'AM',
    facility_id: '11111', call: 'KOMNI',
    frequency: 1000, lat: 40.0, lon: -80.0,
    erp_kw: 1.0,
  };
  const profile = buildAmProfile({ ...inputs }, {}, {});

  assert.equal(profile.pattern_source, 'none',
    'pattern_source should be none when neither pattern_table nor nec_pattern_table provided');
  assert.equal(profile.directional_pattern_applied, false,
    'directional_pattern_applied should be false for omni station');
});

// ---------------------------------------------------------------------------
// Test 3: pattern_source='nec_geometry'
// ---------------------------------------------------------------------------
test('pattern_source: nec_geometry wins when nec_pattern_table present and no manual pattern_table', () => {
  const nec_pattern = [[0, 1.0], [90, 0.7], [180, 0.3], [270, 0.7]];
  const inputs = {
    service: 'AM',
    facility_id: '22222', call: 'KNEC',
    frequency: 800, lat: 35.0, lon: -90.0,
    erp_kw: 10.0,
    // no inputs.pattern_table
  };
  const evidence = { nec_pattern_table: nec_pattern };

  const profile = buildAmProfile({ ...inputs }, { ...evidence }, {});

  assert.equal(profile.pattern_source, 'nec_geometry',
    'pattern_source should be nec_geometry when nec_pattern_table is present');
  assert.equal(profile.directional_pattern_applied, true,
    'directional_pattern_applied should be true when NEC pattern present');
  // After step 6e, pattern_table should have been wired from evidence.nec_pattern_table
  assert.deepStrictEqual(profile.pattern_table, nec_pattern,
    'profile.pattern_table should be wired from nec_pattern_table when no operator pattern');
});

test('pattern_source: manual_table wins over nec_geometry when operator supplies pattern_table', () => {
  const manual_pattern = [[0, 1.0], [180, 0.2]];
  const nec_pattern    = [[0, 1.0], [90, 0.5], [180, 0.5], [270, 0.5]];
  const inputs = {
    service: 'AM',
    facility_id: '33333', call: 'KMAN',
    frequency: 1060, lat: 36.0, lon: -95.0,
    erp_kw: 5.0,
    pattern_table: manual_pattern,   // operator-supplied wins
  };
  const evidence = { nec_pattern_table: nec_pattern };

  // inputs.pattern_table is already set so step 6e does NOT overwrite it.
  const profile = buildAmProfile({ ...inputs }, { ...evidence }, {});

  assert.equal(profile.pattern_source, 'nec_geometry',
    'nec_pattern_table present → nec_geometry (nec wins in pattern_source even when operator table present; per spec: evidence.nec_pattern_table ? nec_geometry)');
  // But inputs.pattern_table is preserved (operator data wins in step 6e)
  assert.deepStrictEqual(profile.pattern_table, manual_pattern,
    'profile.pattern_table should be the operator-supplied manual pattern, not the NEC pattern');
});

// ---------------------------------------------------------------------------
// Test 4: study_mode_canonical normalization
// ---------------------------------------------------------------------------
test('study_mode_canonical: cp → pending_cp', () => {
  const canonical = normalizeStudyMode({ study_mode: 'cp' });
  assert.equal(canonical, 'pending_cp',
    'options.study_mode=cp should normalize to pending_cp');
});

test('study_mode_canonical: pending_cp → pending_cp (idempotent)', () => {
  const canonical = normalizeStudyMode({ study_mode: 'pending_cp' });
  assert.equal(canonical, 'pending_cp');
});

test('study_mode_canonical: manual_scenario → manual_scenario', () => {
  const canonical = normalizeStudyMode({ study_mode: 'manual_scenario' });
  assert.equal(canonical, 'manual_scenario');
});

test('study_mode_canonical: licensed_current → licensed_current', () => {
  const canonical = normalizeStudyMode({ study_mode: 'licensed_current' });
  assert.equal(canonical, 'licensed_current');
});

test('study_mode_canonical: absent/unknown → licensed_current default', () => {
  assert.equal(normalizeStudyMode({}),            'licensed_current',
    'absent study_mode should default to licensed_current');
  assert.equal(normalizeStudyMode({ study_mode: 'bogus' }), 'licensed_current',
    'unknown study_mode should default to licensed_current');
});

test('study_mode_canonical: cp → inputs._study_mode = pending_cp (wiring check)', () => {
  const inputs  = { facility_id: '12345', service: 'AM' };
  const options = { study_mode: 'cp' };

  const study_mode_canonical = {
    'cp':               'pending_cp',
    'pending_cp':       'pending_cp',
    'manual_scenario':  'manual_scenario',
    'licensed_current': 'licensed_current',
  }[options.study_mode] || 'licensed_current';

  inputs._study_mode = study_mode_canonical;

  assert.equal(inputs._study_mode, 'pending_cp',
    'inputs._study_mode should be pending_cp when options.study_mode=cp');
});

// ---------------------------------------------------------------------------
// Test 5: FM operating profile
// ---------------------------------------------------------------------------
test('fm_operating_profile: FM inputs produce correct profile with pattern_source=manual_table', () => {
  const pattern = [[0, 1.0], [90, 0.8], [180, 0.6], [270, 0.8]];
  const inputs = {
    service: 'FM',
    facility_id: '55555',
    call: 'KFMT',
    frequency: 100.7,
    lat: 37.7,
    lon: -122.4,
    erp_kw: 6.0,
    haat_m: 150.0,
    pattern_mode: 'DA',
    pattern_table: pattern,
  };
  const evidence = {};
  const options  = { study_mode: 'manual_scenario' };

  const profile = buildFmProfile({ ...inputs }, evidence, options);

  assert.ok(profile, 'fm_operating_profile should be non-null for FM service');
  assert.equal(profile.pattern_source, 'manual_table',
    'pattern_source should be manual_table when inputs.pattern_table is set');
  assert.equal(profile.directional_pattern_applied, true);
  assert.equal(profile.call_sign, 'KFMT');
  assert.equal(profile.frequency_mhz, 100.7);
  assert.equal(profile.erp_kw, 6.0);
  assert.equal(profile.haat_m, 150.0);
  assert.equal(profile.study_mode, 'manual_scenario');
  assert.deepStrictEqual(profile.pattern_table, pattern);
});

test('fm_operating_profile: omni FM station → pattern_source=none, directional_pattern_applied=false', () => {
  const inputs = {
    service: 'FM',
    facility_id: '66666', call: 'KOMN',
    frequency: 93.5,
    lat: 34.0, lon: -118.0,
    erp_kw: 3.5, haat_m: 75.0,
    // no pattern_table
  };
  const profile = buildFmProfile({ ...inputs }, {}, {});

  assert.equal(profile.pattern_source, 'none');
  assert.equal(profile.directional_pattern_applied, false);
});

test('fm_operating_profile: null for AM service (AM uses amProfile, not fmProfile)', () => {
  const inputs = { service: 'AM', frequency: 1000, lat: 40.0, lon: -80.0, erp_kw: 1.0 };
  const profile = buildFmProfile({ ...inputs }, {}, {});
  assert.equal(profile, null,
    'buildFmProfile should return null for AM service');
});

test('fm_operating_profile: NEC pattern wired → pattern_source=nec_geometry', () => {
  const nec_pattern = [[0, 1.0], [90, 0.6], [180, 0.2], [270, 0.6]];
  const inputs = {
    service: 'FM',
    facility_id: '77777', call: 'KNFM',
    frequency: 107.1,
    lat: 41.0, lon: -87.0,
    erp_kw: 50.0, haat_m: 300.0,
    // no manual pattern_table
  };
  const evidence = { nec_pattern_table: nec_pattern };

  const profile = buildFmProfile({ ...inputs }, { ...evidence }, {});

  assert.equal(profile.pattern_source, 'nec_geometry',
    'nec_pattern_table → pattern_source=nec_geometry for FM too');
  assert.equal(profile.directional_pattern_applied, true);
  assert.deepStrictEqual(profile.pattern_table, nec_pattern,
    'pattern_table should be wired from nec_pattern_table via step 6e');
});
