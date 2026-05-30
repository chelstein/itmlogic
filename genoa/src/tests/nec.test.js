// NEC client tests (success, failure, timeout) + pattern adapter.
//
// LICENSE BOUNDARY
//   These tests do NOT exercise NEC2++ / PyNEC directly.  They only
//   verify the HTTP client boundary between Genoa and the GPL'd
//   sidecar, using a fake fetch.  The sidecar process itself is
//   tested separately (see src/sidecars/nec/README.md smoke-test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNecClient,
  necPatternToTable,
  necOptimalPatternTable,
  NEC_PROVENANCE
} from '../evidence/nec/client.js';
import { studyContourPair } from '../engine/regulatory/_du_pair_study.js';
import { suggestDirectionalMitigation } from '../engine/regulatory/mitigationAdvisor.js';

function withFetch(fakeFetch, fn){
  const orig = global.fetch;
  global.fetch = fakeFetch;
  return Promise.resolve(fn()).finally(() => { global.fetch = orig; });
}

const REF_PATTERN = {
  theta_deg: [0, 30, 60, 90, 120, 150, 180],
  phi_deg:   [0, 90, 180, 270],
  // gain_dbi[theta][phi] — at theta=90 (horizon, idx 3), peak at phi=0
  gain_dbi: [
    [-10, -10, -10, -10],
    [-5,  -5,  -5,  -5 ],
    [ 0,  -3,  -6,  -3 ],
    [ 3,   0,  -6,   0 ],            // horizon row (idx 3)
    [ 0,  -3,  -6,  -3 ],
    [-5,  -5,  -5,  -5 ],
    [-10, -10, -10, -10]
  ]
};

const REF_RESPONSE = {
  ok: true, model_valid: true, frequency_mhz: 1.0,
  geometry:    { n_wires: 1, total_length_m: 75, n_segments: 21 },
  ground:      { type: 'sommerfeld', conductivity_s_m: 0.005, dielectric_constant: 13 },
  feedpoint:   { r_ohm: 36.5, x_ohm: 21.4, vswr_50: 1.43 },
  pattern:     REF_PATTERN,
  near_field:  [{ x: 10, y: 0, z: 2, e_v_m: 12.3, h_a_m: 0.04, s_mw_cm2: 0.2 }],
  warnings:    [],
  provenance: {
    engine: 'necpp/PyNEC', source: 'NEC2++ sidecar',
    license_boundary: 'external sidecar', sidecar_version: '0.1.0',
    generated_at: '2026-05-06T00:00:00Z',
    model_hash:   'a'.repeat(64)
  }
};

/* ---------------- client construction + health ---------------- */

test('makeNecClient: returns null when NEC_SIDECAR_URL unset', () => {
  const c = makeNecClient({ baseUrl: null });
  assert.equal(c, null);
});

test('makeNecClient: surfaces baseUrl', () => {
  const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
  assert.equal(c.baseUrl, 'http://nec.test:8085');
});

test('client.health: pynec_available=true on a healthy sidecar', async () => {
  await withFetch(async (url) => {
    if (url.endsWith('/health')){
      return { ok: true, status: 200, async json(){ return { ok: true, pynec_available: true, pynec_version: '1.7.4' }; }};
    }
    throw new Error('unexpected URL ' + url);
  }, async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
    const r = await c.health();
    assert.equal(r.reachable, true);
    assert.equal(r.pynec_available, true);
    assert.equal(r.pynec_version, '1.7.4');
  });
});

test('client.health: returns reachable:false when sidecar down', async () => {
  await withFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
    const r = await c.health();
    assert.equal(r.reachable, false);
    assert.match(r.error, /ECONNREFUSED/);
  });
});

/* ---------------- client.run ---------------- */

test('client.run: success returns ok:true with provenance + pattern', async () => {
  await withFetch(async () => ({ ok: true, status: 200, async json(){ return REF_RESPONSE; } }),
    async () => {
      const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
      const r = await c.run({
        frequency_mhz: 1.0,
        ground: { type: 'pec' },
        wires: [{ tag: 1, segments: 21, x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 75, radius_m: 0.25 }],
        excitations: [{ tag: 1, segment: 1, voltage_real: 1, voltage_imag: 0 }]
      });
      assert.equal(r.ok, true);
      assert.equal(r.model_valid, true);
      assert.equal(r.provenance.license_boundary, 'external sidecar');
      assert.equal(r.feedpoint.r_ohm, 36.5);
      assert.equal(r.pattern.theta_deg.length, 7);
    });
});

test('client.run: HTTP 500 surfaces error + http_status', async () => {
  await withFetch(async () => ({ ok: false, status: 500, async json(){ return { ok: false, error: 'PYNEC_BRIDGE_FAILED', detail: 'segfault' }; } }),
    async () => {
      const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
      const r = await c.run({ frequency_mhz: 1.0, wires: [], excitations: [] });
      assert.equal(r.ok, false);
      assert.equal(r.http_status, 500);
      assert.equal(r.error, 'PYNEC_BRIDGE_FAILED');
      assert.match(r.detail, /segfault/);
    });
});

test('client.run: PyNEC missing surfaces PYNEC_NOT_INSTALLED', async () => {
  await withFetch(async () => ({ ok: false, status: 502, async json(){ return { ok: false, error: 'PYNEC_NOT_INSTALLED', detail: 'pip install PyNEC' }; }}),
    async () => {
      const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
      const r = await c.run({ frequency_mhz: 1.0, wires: [], excitations: [] });
      assert.equal(r.ok, false);
      assert.equal(r.error, 'PYNEC_NOT_INSTALLED');
    });
});

test('client.run: timeout surfaces NEC_BRIDGE_TIMEOUT', async () => {
  await withFetch(async (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
    });
  }), async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085', timeoutMs: 50 });
    const r = await c.run({ frequency_mhz: 1.0, wires: [], excitations: [] });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'NEC_BRIDGE_TIMEOUT');
  });
});

test('client.run: connection refused surfaces NEC_SIDECAR_UNREACHABLE', async () => {
  await withFetch(async () => { const e = new Error('ECONNREFUSED'); e.name = 'TypeError'; throw e; },
    async () => {
      const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
      const r = await c.run({ frequency_mhz: 1.0, wires: [], excitations: [] });
      assert.equal(r.ok, false);
      assert.equal(r.error, 'NEC_SIDECAR_UNREACHABLE');
    });
});

/* ---------------- client.runAmArray + runNearField ---------------- */

test('client.runAmArray: forwards spec to /model/am-array', async () => {
  let captured = null;
  await withFetch(async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, async json(){ return REF_RESPONSE; } };
  }, async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
    await c.runAmArray({
      frequency_khz: 1240,
      towers: [{ tag: 1, x_m: 0, y_m: 0, height_m: 75, drive: { amplitude: 1, phase_deg: 0 } }]
    });
    assert.match(captured.url, /\/model\/am-array$/);
    assert.equal(captured.body.frequency_khz, 1240);
  });
});

test('client.runNearField: combines model + extra points to /model/near-field', async () => {
  let captured = null;
  await withFetch(async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, async json(){ return REF_RESPONSE; } };
  }, async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
    await c.runNearField(
      { frequency_mhz: 1, wires: [], excitations: [] },
      [{ x: 10, y: 0, z: 2 }]
    );
    assert.match(captured.url, /\/model\/near-field$/);
    assert.equal(captured.body.points.length, 1);
    assert.equal(captured.body.points[0].x, 10);
  });
});

/* ---------------- pattern adapter ---------------- */

test('necPatternToTable: extracts horizon (theta=90) slice into pattern_table', () => {
  const tbl = necPatternToTable(REF_RESPONSE, { elevation_deg: 0 });
  // horizon row [3, 0, -6, 0] dBi → max=3, factors:
  //   phi=0    f = 10^((3 - 3)/20) = 1.0
  //   phi=90   f = 10^((0 - 3)/20) ≈ 0.708
  //   phi=180  f = 10^((-6 - 3)/20) ≈ 0.355
  //   phi=270  f = 10^((0 - 3)/20) ≈ 0.708
  assert.equal(tbl.length, 4);
  assert.deepEqual(tbl.map(([az]) => az), [0, 90, 180, 270]);
  assert.ok(Math.abs(tbl[0][1] - 1.0)   < 0.01);
  assert.ok(Math.abs(tbl[1][1] - 0.708) < 0.01);
  assert.ok(Math.abs(tbl[2][1] - 0.355) < 0.01);
  assert.ok(Math.abs(tbl[3][1] - 0.708) < 0.01);
});

test('necPatternToTable: returns null on missing pattern', () => {
  assert.equal(necPatternToTable({}), null);
  assert.equal(necPatternToTable({ pattern: { theta_deg: [], phi_deg: [], gain_dbi: [] } }), null);
});

test('necPatternToTable: picks closest theta slice for a non-horizon elevation', () => {
  const tbl = necPatternToTable(REF_RESPONSE, { elevation_deg: 30 });
  // requested theta = 60 (idx 2 in REF_PATTERN); row [0, -3, -6, -3]
  // max=0 → factors [1.0, 0.708, 0.501, 0.708]
  assert.ok(Math.abs(tbl[0][1] - 1.0)   < 0.01);
  assert.ok(Math.abs(tbl[2][1] - 0.501) < 0.01);
});

/* ---------------- provenance ---------------- */

test('NEC_PROVENANCE names NEC2++ + GPL boundary + regulation cites', () => {
  assert.match(NEC_PROVENANCE.upstream_engine, /NEC2\+\+/);
  assert.equal(NEC_PROVENANCE.upstream_license, 'GPL v2');
  assert.match(NEC_PROVENANCE.license_boundary, /external sidecar/);
  assert.ok(NEC_PROVENANCE.regulation_basis.some(r => /73\.62/.test(r)));
  assert.ok(NEC_PROVENANCE.regulation_basis.some(r => /73\.150/.test(r)));
  assert.ok(NEC_PROVENANCE.regulation_basis.some(r => /1\.1310/.test(r)));
});

/* ---------------- NEC pattern → FM D/U wiring integration ---------------- */
//
// This block tests the full wiring introduced by PR #1:
//   necPatternToTable() → pattern_table on the U station → studyContourPair()
// It proves that a non-omnidirectional NEC pattern actually suppresses the
// undesired-signal field in the D/U study (directional_pattern_applied=true,
// u_pattern_factor < 1.0, erp_effective_kw < erp_kw on the null bearing).

// REF_PATTERN horizon row at theta=90:  phi=[0,90,180,270], gain=[3,0,-6,0] dBi
// max_dbi = 3 → factors: phi=0→1.0, phi=90→0.708, phi=180→0.355, phi=270→0.708.
// At ~270° (bearing toward a station roughly west of U) the factor is ≈ 0.708 (−3 dB)
// compared to the omnidirectional peak.  At ~180° it is 0.355 (−9 dB) — a clear null.

test('NEC wiring integration: necPatternToTable returns non-null table for REF_RESPONSE', () => {
  const tbl = necPatternToTable(REF_RESPONSE, { elevation_deg: 0 });
  assert.ok(tbl !== null, 'should extract horizon pattern table from NEC response');
  assert.ok(Array.isArray(tbl), 'pattern_table must be an array');
  assert.ok(tbl.length > 0, 'pattern_table must be non-empty');
  // All entries must be [az_deg, field_factor] pairs with factor in (0,1].
  for (const [az, f] of tbl){
    assert.ok(Number.isFinite(az), `az_deg ${az} is finite`);
    assert.ok(Number.isFinite(f) && f >= 0 && f <= 1, `field_factor ${f} in [0,1]`);
  }
});

test('NEC wiring integration: D/U study with NEC pattern applies directional suppression', () => {
  // Extract pattern from the reference NEC response.
  const pattern_table = necPatternToTable(REF_RESPONSE, { elevation_deg: 0 });
  assert.ok(pattern_table !== null, 'precondition: pattern_table non-null');

  // U station: AM-band parameters, positioned roughly due south of D (bearing ~180°
  // from U toward D) — which aligns with the −6 dBi null in REF_PATTERN's phi=180 slot.
  const U = {
    lat: 35.0,          // U is north of D
    lon: -97.0,
    erp_kw: 5.0,
    haat_m: 100,
    frequency_mhz: 107.9,
    call: 'WXXX',
    pattern_table          // NEC-derived directional pattern wired in
  };

  // D station: further south, such that U→D bearing is roughly 180°.
  const D = {
    lat: 34.0,
    lon: -97.0,
    erp_kw: 10.0,
    haat_m: 150,
    frequency_mhz: 107.9,   // co-channel
    fcc_class: 'C'
  };

  const study_with_pattern = studyContourPair(U, D, {
    relationship:       'co-channel',
    du_threshold_db:    20,
    protected_field_dbu: 40,
    protected_mode:     '50,50',
    interfering_mode:   '50,10'
  });

  // Verify directional suppression was applied.
  assert.equal(study_with_pattern.directional_pattern_applied, true,
    'directional_pattern_applied should be true when pattern_table is wired in');
  assert.ok(study_with_pattern.u_pattern_factor < 1.0,
    `u_pattern_factor (${study_with_pattern.u_pattern_factor}) should be < 1.0 on a null bearing`);
  assert.ok(study_with_pattern.u_erp_effective_kw < U.erp_kw,
    `u_erp_effective_kw (${study_with_pattern.u_erp_effective_kw}) should be < erp_kw (${U.erp_kw}) when pattern suppresses`);

  // Compare with the omni baseline (no pattern_table).
  const U_omni = { ...U, pattern_table: null };
  const study_omni = studyContourPair(U_omni, D, {
    relationship:       'co-channel',
    du_threshold_db:    20,
    protected_field_dbu: 40,
    protected_mode:     '50,50',
    interfering_mode:   '50,10'
  });

  assert.equal(study_omni.directional_pattern_applied, false,
    'omni baseline: directional_pattern_applied should be false');
  assert.equal(study_omni.u_pattern_factor, 1.0,
    'omni baseline: u_pattern_factor should be 1.0');

  // Before (omni) vs after (directional): effective ERP is lower with pattern.
  assert.ok(study_with_pattern.u_erp_effective_kw < study_omni.u_erp_effective_kw,
    `directional ERP (${study_with_pattern.u_erp_effective_kw} kW) should be less than omni ERP (${study_omni.u_erp_effective_kw} kW)`);

  // D/U should be better (higher) with directional pattern because U radiates less
  // toward D along the null bearing.
  if (!study_with_pattern.skipped && !study_omni.skipped
      && Number.isFinite(study_with_pattern.du_actual_db)
      && Number.isFinite(study_omni.du_actual_db)){
    assert.ok(study_with_pattern.du_actual_db > study_omni.du_actual_db,
      `D/U with pattern (${study_with_pattern.du_actual_db.toFixed(2)} dB) should exceed omni D/U (${study_omni.du_actual_db.toFixed(2)} dB)`);
  }
});

/* ---------------- PR #2: necOptimalPatternTable + suggestDirectionalMitigation ---------------- */

test('necOptimalPatternTable: returns null when converged=false', () => {
  const notConverged = { ...REF_RESPONSE, converged: false };
  assert.equal(necOptimalPatternTable(notConverged), null);
});

test('necOptimalPatternTable: returns valid pattern table when converged=true', () => {
  const converged = { ...REF_RESPONSE, converged: true };
  const tbl = necOptimalPatternTable(converged);
  assert.ok(tbl !== null, 'should return a pattern table when converged=true');
  assert.ok(Array.isArray(tbl), 'pattern table must be an array');
  assert.ok(tbl.length > 0, 'pattern table must be non-empty');
  for (const [az, f] of tbl){
    assert.ok(Number.isFinite(az), `az_deg ${az} is finite`);
    assert.ok(Number.isFinite(f) && f >= 0 && f <= 1, `field_factor ${f} in [0,1]`);
  }
});

test('suggestDirectionalMitigation: returns null when necClient is null', async () => {
  const result = await suggestDirectionalMitigation({
    violation:        { du_threshold_db: 20, du_actual_db: 15, bearings: { u_to_d_deg: 180 } },
    antenna_geometry: { frequency_khz: 107900, towers: [] },
    necClient:        null
  });
  assert.equal(result, null);
});

test('suggestDirectionalMitigation: returns { converged: false } when optimizer returns converged=false', async () => {
  const notConvergedResp = {
    ok:                      true,
    converged:               false,
    achieved_suppression_db: 3.5,
    optimal_phases_deg:      [],
    bearing_factor:          0.7,
    pattern:                 REF_PATTERN,
    iterations:              36
  };
  const fakeClient = {
    async optimizePattern(){ return notConvergedResp; }
  };
  const result = await suggestDirectionalMitigation({
    violation: {
      du_threshold_db: 20,
      du_actual_db:    15,
      bearings:        { u_to_d_deg: 180 }
    },
    antenna_geometry: { frequency_khz: 107900, towers: [{ tag: 1, height_m: 75 }] },
    necClient:        fakeClient
  });
  assert.ok(result !== null, 'should return an object (not null) when optimizer returns');
  assert.equal(result.converged, false);
  assert.equal(result.reason, 'optimizer_did_not_converge');
});

test('suggestDirectionalMitigation: converged optimizer produces recheck.pass=true and recheck.directional_pattern_applied=true', async () => {
  // Build a converged optimizer response using the REF_PATTERN which has a
  // clear null at phi=180 (gain -6 dBi vs peak +3 dBi → suppression 9 dB).
  const convergedResp = {
    ok:                      true,
    converged:               true,
    achieved_suppression_db: 9.0,
    optimal_phases_deg:      [{ tag: 1, phase_deg: 0 }, { tag: 2, phase_deg: 90 }],
    bearing_factor:          0.355,
    pattern:                 REF_PATTERN,
    iterations:              9
  };
  const fakeClient = {
    async optimizePattern(){ return convergedResp; }
  };

  // U station (subject) is north of D; bearing U→D ≈ 180°.
  // At phi=180 REF_PATTERN has factor ≈ 0.355 (−9 dBi suppression).
  // With protected_field_dbu=105, erp_kw=50, haat_m=100 and stations
  // ~11 km apart: omni D/U ≈ 11.7 dB (fails at threshold 20) but
  // directional D/U ≈ 20.7 dB (passes).  This is the controlled test case.
  const U = {
    lat: 38.0, lon: -97.0,
    erp_kw: 50.0, haat_m: 100, frequency_mhz: 107.9,
    call: 'WXXX'
  };
  const D = {
    lat: 37.9, lon: -97.0,
    erp_kw: 10.0, haat_m: 150, frequency_mhz: 107.9,
    fcc_class: 'C'
  };
  const PROTECTED_FIELD = 105;

  // Run the omni study to get a realistic failing violation object.
  const omniStudy = studyContourPair(U, D, {
    relationship:       'co-channel',
    du_threshold_db:    20,
    protected_field_dbu: PROTECTED_FIELD,
    protected_mode:     '50,50',
    interfering_mode:   '50,10'
  });

  const violation = {
    ...omniStudy,
    u_station: U,
    d_station: D,
    d_protected_field_dbu: PROTECTED_FIELD
  };

  const result = await suggestDirectionalMitigation({
    violation,
    antenna_geometry: { frequency_khz: 107900, towers: [{ tag: 1, height_m: 75 }] },
    necClient:        fakeClient
  });

  assert.ok(result !== null, 'should return an object');
  assert.equal(result.converged, true, 'converged should be true');
  assert.ok(Array.isArray(result.optimal_phases_deg), 'optimal_phases_deg should be an array');
  assert.ok(Array.isArray(result.pattern_table), 'pattern_table should be an array');
  assert.ok(result.recheck !== null, 'recheck should be present');
  assert.equal(result.recheck.directional_pattern_applied, true,
    'recheck.directional_pattern_applied must be true');
  // With the null-bearing pattern the D/U should improve enough to pass.
  assert.equal(result.recheck.pass, true, 'recheck.pass should be true after applying the optimal pattern');
});
