import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeBerrySkywaveClient,
  berryFieldUvm,
  BERRY_ENGINE_ID,
  BERRY_SKYWAVE_PROVENANCE
} from '../evidence/berrySkywaveClient.js';

/* ---------- construction ---------- */

test('makeBerrySkywaveClient: enabled by default; null when GENOA_BERRY_SKYWAVE_FALLBACK=false', () => {
  const c1 = makeBerrySkywaveClient();
  assert.ok(c1);
  assert.equal(c1.isFallback, true);
  const c2 = makeBerrySkywaveClient({ enabled: false });
  assert.equal(c2, null);
});

test('makeBerrySkywaveClient: respects GENOA_BERRY_SKYWAVE_FALLBACK=false from env', () => {
  const orig = process.env.GENOA_BERRY_SKYWAVE_FALLBACK;
  process.env.GENOA_BERRY_SKYWAVE_FALLBACK = 'false';
  try {
    assert.equal(makeBerrySkywaveClient(), null);
  } finally {
    if (orig !== undefined) process.env.GENOA_BERRY_SKYWAVE_FALLBACK = orig;
    else delete process.env.GENOA_BERRY_SKYWAVE_FALLBACK;
  }
});

/* ---------- formula behavior ---------- */

test('berryFieldUvm: field decreases monotonically with distance', () => {
  const args = { erp_kw: 50, freq_khz: 700, midpoint_lat: 39, percent_time: 50 };
  const fields = [50, 100, 200, 400, 800, 1500].map((d) =>
    berryFieldUvm({ ...args, distance_km: d })
  );
  for (let i = 1; i < fields.length; i++){
    assert.ok(fields[i] < fields[i - 1],
      `field at ${[50, 100, 200, 400, 800, 1500][i]} km (${fields[i]}) ` +
      `should be less than at ${[50, 100, 200, 400, 800, 1500][i - 1]} km (${fields[i - 1]})`);
  }
});

test('berryFieldUvm: field scales with √ERP at constant distance', () => {
  const args = { freq_khz: 700, distance_km: 500, midpoint_lat: 39, percent_time: 50 };
  const f1   = berryFieldUvm({ ...args, erp_kw: 1 });
  const f100 = berryFieldUvm({ ...args, erp_kw: 100 });
  // E ∝ √P, so 100x ERP → 10x field
  assert.ok(Math.abs(f100 / f1 - 10) < 0.01,
    `100x ERP should give 10x field, got ratio ${f100 / f1}`);
});

test('berryFieldUvm: SS-2 (10%) ≈ 1.4x SS-1 (50%)', () => {
  const args = { erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: 39 };
  const ss1 = berryFieldUvm({ ...args, percent_time: 50 });
  const ss2 = berryFieldUvm({ ...args, percent_time: 10 });
  assert.ok(Math.abs(ss2 / ss1 - 1.4) < 0.01,
    `SS-2/SS-1 should be 1.4, got ${ss2 / ss1}`);
});

test('berryFieldUvm: deterministic — same inputs produce identical output', () => {
  const args = { erp_kw: 25.0, freq_khz: 920, distance_km: 350, midpoint_lat: 41.5, percent_time: 50 };
  const a = berryFieldUvm(args);
  const b = berryFieldUvm(args);
  assert.equal(a, b);
});

/* ---------- input validation ---------- */

test('client.fieldAtDistance: rejects off-grid freq', async () => {
  const c = makeBerrySkywaveClient();
  const r = await c.fieldAtDistance({ erp_kw: 50, freq_khz: 705, distance_km: 400, midpoint_lat: 39 });
  assert.equal(r.available, false);
  assert.match(r.error, /10-kHz/);
});

test('client.fieldAtDistance: rejects out-of-band freq', async () => {
  const c = makeBerrySkywaveClient();
  for (const f of [400, 100_000]){
    const r = await c.fieldAtDistance({ erp_kw: 50, freq_khz: f, distance_km: 400, midpoint_lat: 39 });
    assert.equal(r.available, false);
  }
});

test('client.fieldAtDistance: rejects bad percent_time', async () => {
  const c = makeBerrySkywaveClient();
  const r = await c.fieldAtDistance({ erp_kw: 50, freq_khz: 700, distance_km: 400,
                                       midpoint_lat: 39, percent_time: 25 });
  assert.equal(r.available, false);
  assert.match(r.error, /percent_time/);
});

test('client.fieldAtDistance: rejects non-finite inputs', async () => {
  const c = makeBerrySkywaveClient();
  const r = await c.fieldAtDistance({ erp_kw: NaN, freq_khz: 700, distance_km: 400, midpoint_lat: 39 });
  assert.equal(r.available, false);
});

/* ---------- response shape (matches fccamClient) ---------- */

test('client.fieldAtDistance: success unwraps field_uv_m + replay metadata', async () => {
  const c = makeBerrySkywaveClient();
  const r = await c.fieldAtDistance({ erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: 39 });
  assert.equal(r.available, true);
  assert.equal(r.engine, BERRY_ENGINE_ID);
  assert.equal(r.source, BERRY_ENGINE_ID);
  assert.ok(Number.isFinite(r.field_uv_m));
  assert.match(r.input_sha256, /^[a-f0-9]{64}$/);
  assert.match(r.warning, /SCREENING-GRADE/);
  assert.equal(r.flag, null);
  assert.ok(r.fetched_at);
});

test('client.distanceToField: bisection finds distance where field = target', async () => {
  const c = makeBerrySkywaveClient();
  const args = { erp_kw: 50, freq_khz: 700, midpoint_lat: 39, percent_time: 50 };
  // Pick a target field equal to what berryFieldUvm produces at 500 km.
  const target = berryFieldUvm({ ...args, distance_km: 500 });
  const r = await c.distanceToField({ ...args, field_uv_m: target });
  assert.equal(r.available, true);
  assert.ok(Math.abs(r.distance_km - 500) < 1, `expected ~500 km, got ${r.distance_km}`);
});

/* ---------- runBatch ---------- */

test('runBatch: rejects empty array', async () => {
  const c = makeBerrySkywaveClient();
  const r = await c.runBatch([]);
  assert.equal(r.available, false);
});

test('runBatch: aggregates n_ok / n_failed; per-call inputs validated independently', async () => {
  const c = makeBerrySkywaveClient();
  const r = await c.runBatch([
    { erp_kw: 50, freq_khz: 700, distance_km: 200, midpoint_lat: 39 },
    { erp_kw: 50, freq_khz: 705, distance_km: 200, midpoint_lat: 39 },   // off-grid
    { erp_kw: 50, freq_khz: 700, distance_km: 600, midpoint_lat: 39 }
  ]);
  assert.equal(r.available, true);
  assert.equal(r.n_requests, 3);
  assert.equal(r.n_ok, 2);
  assert.equal(r.n_failed, 1);
  const failed = r.results.find((x) => !x.ok);
  assert.equal(failed.flag, 'INVALID_INPUT');
});

/* ---------- replay determinism ---------- */

test('input_sha256: identical inputs → identical hex', async () => {
  const c = makeBerrySkywaveClient();
  const a = await c.fieldAtDistance({ erp_kw: 25, freq_khz: 920, distance_km: 350, midpoint_lat: 41.5 });
  const b = await c.fieldAtDistance({ erp_kw: 25, freq_khz: 920, distance_km: 350, midpoint_lat: 41.5 });
  assert.equal(a.input_sha256, b.input_sha256);
});

test('input_sha256: different inputs → different hex', async () => {
  const c = makeBerrySkywaveClient();
  const a = await c.fieldAtDistance({ erp_kw: 25, freq_khz: 920, distance_km: 350, midpoint_lat: 41.5 });
  const b = await c.fieldAtDistance({ erp_kw: 50, freq_khz: 920, distance_km: 350, midpoint_lat: 41.5 });
  assert.notEqual(a.input_sha256, b.input_sha256);
});

/* ---------- /version ---------- */

test('client.version: clearly labels SCREENING-GRADE', async () => {
  const v = await makeBerrySkywaveClient().version();
  assert.equal(v.available, true);
  assert.equal(v.engine, BERRY_ENGINE_ID);
  assert.match(v.warning, /SCREENING-GRADE/);
  assert.match(v.regulation, /73\.190\(c\)/);
});

/* ---------- provenance ---------- */

test('BERRY_SKYWAVE_PROVENANCE labels status as SCREENING + cites §73.190(c)', () => {
  assert.match(BERRY_SKYWAVE_PROVENANCE.status, /SCREENING/);
  assert.match(BERRY_SKYWAVE_PROVENANCE.regulation, /73\.190\(c\)/);
  assert.match(BERRY_SKYWAVE_PROVENANCE.license_basis, /17 USC §105/);
});
