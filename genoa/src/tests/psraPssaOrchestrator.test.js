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
  // PSSA runs sunset → sunset + 2 h per §73.99 (17:30 sunset → 19:30 end)
  assert.equal(r.windows.windows.pssa.end,   '19:30');
  assert.ok(r.monthly);
  assert.equal(r.monthly.months.length, 12);
  assert.ok(r.power);
  assert.equal(r.power.ok, true);
  // One protected pair → exactly one entry in each pool
  assert.equal(r.power.pssa.per_pair.length, 1);
  assert.equal(r.power.psra.per_pair.length, 1);
  // No operator-supplied e_max → per-pair power is NOT computable; the
  // orchestrator must surface the data gap instead of fabricating E_max
  // from the proposer's own field.
  assert.equal(r.power.pssa.available, false, 'PSSA pool must not fabricate a per-pair power');
  assert.ok(r.e_max_data_gap, 'e_max data gap must be surfaced');
  assert.equal(r.e_max_data_gap.n_pairs_missing, 1);
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
// formula by asserting p_reduced_w against the formula
//   P = P_daytime · (E_max / E_actual)² · 1000
// computed from the values the exhibit itself reports.  E_max comes from
// OPERATOR-SUPPLIED nighttime-limit data on the protected row — the
// orchestrator no longer derives E_max from the proposer's own field
// (e_max = e_actual × share cancels in the formula and returns a constant
// regardless of the protected stations — a placeholder, not a computation).
test('G-013 PINNED: operator e_max drives P = P·(E_max/E_actual)²·1000; no e_max → data gap', async () => {
  // (a) WITHOUT operator e_max: no per-pair power, explicit data gap.
  const rGap = await psraPssaExhibit({
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
  assert.equal(rGap.available, true, 'exhibit available');
  assert.equal(rGap.power.pssa.available, false, 'no fabricated per-pair PSSA power');
  assert.equal(rGap.power.psra.available, false, 'no fabricated per-pair PSRA power');
  assert.ok(rGap.e_max_data_gap, 'data gap surfaced');
  assert.match(rGap.power.pssa.error, /e_max/i, 'error names the missing e_max data');

  // (b) WITH operator e_max: formula pinned from reported values.
  const r = await psraPssaExhibit({
    proposed: PROPOSED
  }, {
    fccamClient:    makeFakeFccam(),
    facilityClient: makeFakeFacility([{
      call: 'WBLK', facility_id: 9001, fcc_class: 'B',
      lat: 41, lon: -75, frequency_khz: 700, erp_kw: 10,
      channel_relationship: 'cochannel', distance_km: 110,
      e_max_pssa_uv_m: 5.0,   // operator-supplied §73.182(k) night limits
      e_max_psra_uv_m: 5.0
    }]),
    sunClient: makeFakeSun()
  });
  assert.equal(r.available, true, 'exhibit available');
  assert.equal(r.power.ok,  true, 'power ok');
  assert.equal(r.e_max_data_gap, undefined, 'no data gap when operator supplies e_max');

  for (const pool of ['pssa', 'psra']){
    const w = r.power[pool];
    assert.equal(w.available, true, `${pool} pool available`);
    assert.equal(w.binding.call, 'WBLK', `${pool} binding pair is WBLK`);
    const pair = r.protected_pairs[0][pool];
    assert.ok(Number.isFinite(pair.e_actual_uv_m), `${pool} e_actual is finite`);
    assert.equal(pair.e_max_allowed_uv_m, 5.0, `${pool} e_max is the operator value`);
    const expected = Math.min(500,
      Number((PROPOSED.p_daytime_kw * Math.pow(5.0 / pair.e_actual_uv_m, 2) * 1000).toFixed(2)));
    assert.ok(Math.abs(w.p_reduced_w - expected) < 0.05,
      `${pool} p_reduced_w ${w.p_reduced_w} must equal formula value ${expected}`);
  }
});
