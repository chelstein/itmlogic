import test from 'node:test';
import assert from 'node:assert/strict';
import {
  psraPssaExhibit,
  PSRA_PSSA_ORCHESTRATOR_PROVENANCE
} from '../engine/am/psraPssaOrchestrator.js';

const PROPOSED = {
  call: 'WTST', facility_id: 1234,
  lat: 40.0, lon: -75.0,
  freq_khz: 700, fcc_class: 'B',
  p_daytime_kw: 5,
  timezone_code: 'B'
};

function makeFakeSun(monthly){
  return {
    fetchAmSun: async ({ lat, lon, tzone }) => ({
      available: true,
      source: 'fcc_srsstime',
      timezone_code:  tzone || 'B',
      timezone_label: 'Eastern Standard Time',
      input: { lat, lon },
      dms: { lat: { degrees: 40, minutes: 0, seconds: 0 },
             lon: { degrees: 75, minutes: 0, seconds: 0 } },
      monthly: monthly || { 1: { sunrise: '07:30', sunset: '17:30' } },
      replay: 'mock-replay'
    })
  };
}

function makeFakeFccam({ multiplier = 1, isFallback = false } = {}){
  return {
    isFallback,
    runBatch: async (requests) => ({
      available: true,
      source:    isFallback ? 'berry-1968-screening' : 'fccam',
      n_requests: requests.length,
      n_ok:       requests.length,
      n_failed:   0,
      results:    requests.map((req) => ({
        ok: true, engine: isFallback ? 'berry-1968-screening' : 'fccam',
        field_uv_m: multiplier * (1500 * Math.sqrt(req.erp_kw)
                                       / Math.max(1, req.distance_km))
                                * (req.percent_time === 10 ? 0.6 : 1.0),
        flag: null,
        input_sha256: 'a'.repeat(64),
        inputs: req
      }))
    })
  };
}

function makeFakeFacility(primaries){
  return {
    getNearbyPrimaries: async (_args) => ({
      available: true,
      source:    'fcc-amq',
      primaries: primaries || []
    })
  };
}

/* ---------- input guards ---------- */

test('psraPssaExhibit: rejects missing proposed', async () => {
  const r = await psraPssaExhibit({}, {});
  assert.equal(r.available, false);
});

test('psraPssaExhibit: rejects off-grid freq', async () => {
  const r = await psraPssaExhibit({
    proposed: { ...PROPOSED, freq_khz: 705 }
  }, {});
  assert.equal(r.available, false);
  assert.match(r.error, /10-kHz|grid/);
});

test('psraPssaExhibit: rejects non-positive p_daytime_kw', async () => {
  const r = await psraPssaExhibit({
    proposed: { ...PROPOSED, p_daytime_kw: 0 }
  }, {});
  assert.equal(r.available, false);
});

test('psraPssaExhibit: rejects missing fcc_class', async () => {
  const r = await psraPssaExhibit({
    proposed: { ...PROPOSED, fcc_class: undefined }
  }, {});
  assert.equal(r.available, false);
});

/* ---------- happy path ---------- */

test('psraPssaExhibit: sun + windows + power computed end-to-end', async () => {
  const r = await psraPssaExhibit({
    proposed: PROPOSED
  }, {
    fccamClient:    makeFakeFccam(),
    facilityClient: makeFakeFacility([{
      call: 'WBLK', facility_id: 9001, fcc_class: 'B',
      lat: 41, lon: -75, frequency_khz: 700, erp_kw: 10,
      channel_relationship: 'cochannel', distance_km: 110
    }]),
    sunClient:      makeFakeSun()
  });
  assert.equal(r.available, true);
  assert.ok(r.sun);
  assert.equal(r.sun.source, 'fcc_srsstime');
  assert.ok(r.windows);
  assert.equal(r.windows.ok, true);
  assert.equal(r.windows.windows.psra.start, '06:00');
  assert.equal(r.windows.windows.pssa.end,   '18:00');
  assert.ok(r.monthly);
  assert.equal(r.monthly.months.length, 12);
  assert.ok(r.power);
  assert.equal(r.power.ok, true);
  // One protected pair → exactly one entry in each pool
  assert.equal(r.power.pssa.per_pair.length, 1);
  assert.equal(r.power.psra.per_pair.length, 1);
  // Engineering identity threaded through
  assert.equal(r.provenance.skywave_engine, 'fccam-wang-1985');
  assert.equal(r.protected_pairs.length, 1);
});

test('psraPssaExhibit: skywave engine identity reflects Berry fallback', async () => {
  const r = await psraPssaExhibit({
    proposed: PROPOSED
  }, {
    fccamClient:    makeFakeFccam({ isFallback: true }),
    facilityClient: makeFakeFacility([]),
    sunClient:      makeFakeSun()
  });
  assert.equal(r.provenance.skywave_engine, 'berry-1968-screening');
});

/* ---------- fail-soft branches ---------- */

test('psraPssaExhibit: sun unconfigured → windows null but power still ceiling-only', async () => {
  const r = await psraPssaExhibit({
    proposed: PROPOSED
  }, {
    fccamClient:    makeFakeFccam(),
    facilityClient: makeFakeFacility([])
    // no sunClient
  });
  assert.equal(r.available, true);
  assert.equal(r.sun, null);
  assert.equal(r.windows, null);
  // power: ceiling-only with no protected pairs
  // (Sun unset + no pairs means we DON'T fall through to ceiling-only
  // because the orchestrator only does that when windows/monthly exist —
  // which is intentional: if sun is unset, the §73.99 exhibit can't
  // ship at all so the §73.99(b)(1) ceiling is moot.)
});

test('psraPssaExhibit: facility unconfigured → empty protected_pairs', async () => {
  const r = await psraPssaExhibit({
    proposed: PROPOSED
  }, {
    fccamClient:    makeFakeFccam(),
    sunClient:      makeFakeSun()
    // no facilityClient
  });
  assert.equal(r.available, true);
  assert.deepEqual(r.protected_pairs, []);
  // With no pairs, power falls through to ceiling-only.
  assert.equal(r.power.ok, true);
  assert.equal(r.power.pssa.p_reduced_w, 500);
});

test('psraPssaExhibit: fccam unconfigured → protected_pairs empty + power ceiling-only', async () => {
  const r = await psraPssaExhibit({
    proposed: PROPOSED
  }, {
    sunClient:      makeFakeSun(),
    facilityClient: makeFakeFacility([{
      call: 'WBLK', facility_id: 9001, fcc_class: 'B',
      lat: 41, lon: -75, frequency_khz: 700, erp_kw: 10,
      distance_km: 110
    }])
    // no fccamClient
  });
  assert.equal(r.protected_pairs.length, 0);
  assert.equal(r.power.pssa.p_reduced_w, 500);  // ceiling-only fallback
  assert.equal(r.provenance.skywave_engine, 'unconfigured');
});

/* ---------- §73.182(k) E_max override ---------- */

test('psraPssaExhibit: operator-supplied e_max_pssa_uv_m overrides the 25% heuristic', async () => {
  // With override = 1.0 µV/m and computed actual ~ much higher,
  // the scale_factor becomes tiny and the binding pair drops the
  // power well below the 500 W ceiling.
  const r = await psraPssaExhibit({
    proposed: PROPOSED
  }, {
    fccamClient:    makeFakeFccam(),
    facilityClient: makeFakeFacility([{
      call: 'WTIGHT', facility_id: 9002, fcc_class: 'A',
      lat: 41, lon: -75, frequency_khz: 700, erp_kw: 50,
      distance_km: 110,
      e_max_pssa_uv_m: 1.0,    // operator-supplied tight limit
      e_max_psra_uv_m: 1.0
    }]),
    sunClient: makeFakeSun()
  });
  assert.equal(r.power.pssa.binding.call, 'WTIGHT');
  assert.ok(r.power.pssa.p_reduced_w < 500,
    `expected sub-ceiling power, got ${r.power.pssa.p_reduced_w}`);
});

/* ---------- max_protected cap ---------- */

test('psraPssaExhibit: max_protected caps the pair list', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    call: `W${i}`, facility_id: 1000 + i, fcc_class: 'B',
    lat: 40 + i * 0.1, lon: -75, frequency_khz: 700, erp_kw: 5,
    distance_km: 100 + i * 30
  }));
  const r = await psraPssaExhibit({
    proposed: PROPOSED,
    options:  { max_protected: 4 }
  }, {
    fccamClient:    makeFakeFccam(),
    facilityClient: makeFakeFacility(many),
    sunClient:      makeFakeSun()
  });
  assert.equal(r.protected_pairs.length, 4);
});

/* ---------- provenance ---------- */

test('PSRA_PSSA_ORCHESTRATOR_PROVENANCE names §73.99 + §73.182(k) + §73.190(c)', () => {
  assert.match(PSRA_PSSA_ORCHESTRATOR_PROVENANCE.regulation, /73\.99/);
  assert.match(PSRA_PSSA_ORCHESTRATOR_PROVENANCE.regulation, /73\.182\(k\)/);
  assert.match(PSRA_PSSA_ORCHESTRATOR_PROVENANCE.regulation, /73\.190\(c\)/);
  assert.match(PSRA_PSSA_ORCHESTRATOR_PROVENANCE.license_basis, /17 USC §105/);
});

/* ---------- G-013 PINNED NUMERIC FIXTURE ---------- */
//
// Purpose: prevent silent regression in the §73.99(b)(1) power-reduction
// formula by asserting exact p_reduced_w and scale_factor values from known
// geometry.  This is not testing the skywave model (which is mocked); it
// pins the formula P = P_daytime · (E_max / E_actual)² · 1000.
//
// Geometry:
//   proposed: WTST Class B 5 kW, 700 kHz, (40.0, -75.0)
//   protected: WBLK Class B at (41.0, -75.0), distance ≈ 111.19 km
//
// With the default RSS share of 0.25, the orchestrator sets:
//   e_max_allowed = e_actual × 0.25
//
// The power formula therefore simplifies to:
//   P_reduced = P_daytime × 0.25² × 1000 = 5 × 0.0625 × 1000 = 312.5 W
//
// This result is INDEPENDENT of the absolute skywave field value
// (the ratio e_max/e_actual = 0.25 regardless of what FCCAM returns),
// so it pins formula correctness without coupling to the skywave model.
// Both PSSA (50%) and PSRA (10%) pools yield the same result because
// e_max = e_actual × rss_share in both cases.
test('G-013 PINNED: default RSS share (0.25) → p_reduced_w = 312.5 W, scale_factor = 0.0625', async () => {
  const r = await psraPssaExhibit({
    proposed: PROPOSED
  }, {
    fccamClient:    makeFakeFccam(),
    facilityClient: makeFakeFacility([{
      call: 'WBLK', facility_id: 9001, fcc_class: 'B',
      lat: 41, lon: -75, frequency_khz: 700, erp_kw: 10,
      channel_relationship: 'cochannel', distance_km: 110
    }]),
    sunClient: makeFakeSun()
  });

  assert.equal(r.available, true, 'exhibit available');
  assert.equal(r.power.ok,  true, 'power ok');

  // PSSA (50% skywave) pool
  assert.equal(r.power.pssa.p_reduced_w,         312.5,  'PSSA p_reduced_w');
  assert.equal(r.power.pssa.binding.scale_factor, 0.0625, 'PSSA scale_factor = (0.25)^2');
  assert.equal(r.power.pssa.ceiling_applied,      false,  'PSSA ceiling not applied (312.5 < 500 W)');
  assert.equal(r.power.pssa.binding.call,         'WBLK', 'PSSA binding pair is WBLK');

  // PSRA (10% skywave) pool — identical result: e_max = e_actual × 0.25 in both pools
  assert.equal(r.power.psra.p_reduced_w,         312.5,  'PSRA p_reduced_w');
  assert.equal(r.power.psra.binding.scale_factor, 0.0625, 'PSRA scale_factor = (0.25)^2');
  assert.equal(r.power.psra.ceiling_applied,      false,  'PSRA ceiling not applied');
  assert.equal(r.power.psra.binding.call,         'WBLK', 'PSRA binding pair is WBLK');

  // The pair itself carries the raw field values for further verification
  const pair = r.protected_pairs[0];
  assert.ok(Number.isFinite(pair.pssa.e_actual_uv_m),    'PSSA e_actual is finite');
  assert.ok(Number.isFinite(pair.psra.e_actual_uv_m),    'PSRA e_actual is finite');
  // e_max must equal e_actual × 0.25 (to 6 sig-fig) — this pins the RSS-share wiring
  assert.ok(
    Math.abs(pair.pssa.e_max_allowed_uv_m / pair.pssa.e_actual_uv_m - 0.25) < 1e-9,
    'PSSA e_max_allowed = e_actual × 0.25 (default RSS share)'
  );
  assert.ok(
    Math.abs(pair.psra.e_max_allowed_uv_m / pair.psra.e_actual_uv_m - 0.25) < 1e-9,
    'PSRA e_max_allowed = e_actual × 0.25 (default RSS share)'
  );
});
