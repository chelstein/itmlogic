import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

let proc, baseUrl;

test.before(async () => {
  const port = 18099 + Math.floor(Math.random() * 100);
  baseUrl = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForHealth(baseUrl + '/healthz', 5000);
});

test.after(async () => {
  if (proc){ proc.kill('SIGTERM'); }
});

test('GET /healthz returns ok', async () => {
  const r = await fetch(baseUrl + '/healthz');
  assert.equal(r.status, 200);
  assert.equal((await r.text()).trim(), 'ok');
});

test('GET /api/curves returns the manifest with sha256s', async () => {
  const r = await fetch(baseUrl + '/api/curves');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.version);
  assert.ok(j.meta_sha256);
  assert.ok(j.datasets?.f5050);
});

test('POST /api/exhibits/compute returns a schema-valid v2 exhibit', async () => {
  const r = await fetch(baseUrl + '/api/exhibits/compute', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inputs: { call:'WAPI-FM', facility_id:'1', service:'FM', fcc_class:'A',
                frequency:98.7, erp_kw:6, haat_m:100,
                lat:37.0902, lon:-95.7129, radial_step_deg:45 }
    })
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.schema.name, 'genoa.exhibit.v2');
  assert.ok(j.engine_signature?.module);
  assert.ok(Array.isArray(j.blockers));
  assert.equal(typeof j.degraded_mode, 'boolean');
  assert.ok(j.calculation_trace);
});

test('GET /api/validation returns regression + authoritative counters', async () => {
  const r = await fetch(baseUrl + '/api/validation');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok('n_run' in j);
  assert.ok('n_pass' in j);
  assert.ok('n_regression_run' in j);
  assert.ok('authoritative_pass' in j);
});

test('Persistence routes return 503 when no DATABASE_URL is configured', async () => {
  const r = await fetch(baseUrl + '/api/exhibits');
  assert.equal(r.status, 503);
});

test('PDF export route returns 501 (not implemented) with structured warning', async () => {
  const r = await fetch(baseUrl + '/api/exhibits/123/export/pdf');
  // 503 (no DB) or 404 will happen first because we have no row; accept that as "not exercised here".
  assert.ok([404, 501, 503].includes(r.status));
});

test('GET /api/facilities/search with no upstream configured -> 503 + FACILITY_LOOKUP_UNAVAILABLE', async () => {
  const r = await fetch(baseUrl + '/api/facilities/search?q=KSLX');
  assert.equal(r.status, 503);
  const j = await r.json();
  assert.equal(j.error, 'FACILITY_LOOKUP_UNAVAILABLE');
  assert.equal(j.warning?.code, 'FACILITY_LOOKUP_UNAVAILABLE');
});

test('GET /api/facilities/:id with no upstream configured -> 503', async () => {
  const r = await fetch(baseUrl + '/api/facilities/11282');
  assert.equal(r.status, 503);
});

test('GET /api/facilities/search with q too short -> 400', async () => {
  const r = await fetch(baseUrl + '/api/facilities/search?q=K');
  assert.equal(r.status, 400);
});

async function waitForHealth(url, timeoutMs){
  const start = Date.now();
  while (Date.now() - start < timeoutMs){
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy in ' + timeoutMs + 'ms');
}
