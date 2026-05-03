// SPLAT sidecar client tests.  All upstreams mocked; no real splat is
// contacted.  The point is to prove:
//
//   - With no SPLAT_SIDECAR_URL configured, makeSplatClient returns null
//     (no provenance row gets attached).
//   - capability() reports reachable when /version 200s.
//   - capability() reports unreachable + error string on failure.
//   - run() forwards body shape to /api/v1/splat/run and reports
//     available iff returncode === 0.
//   - DEM-missing (returncode != 0) surfaces honestly without faking
//     a SPLAT result.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeSplatClient } from '../evidence/terrain/splatClient.js';

function mockFetch(handler){
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts);
  return () => { globalThis.fetch = orig; };
}
function jsonResp(body, ok = true, status){
  return { ok, status: status ?? (ok ? 200 : 502), json: async () => body };
}

test('makeSplatClient returns null when SPLAT_SIDECAR_URL is unset', () => {
  assert.equal(makeSplatClient({ baseUrl: null }), null);
});

test('capability(): reachable sidecar with version metadata', async () => {
  const restore = mockFetch((url) => {
    assert.match(url, /\/version$/);
    return jsonResp({ sidecar: 'genoa-splat-sidecar', splat_bin: '/app/splat', workdir: '/app/work' });
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.capability();
    assert.equal(r.available, true);
    assert.equal(r.source,    'splat-sidecar');
    assert.equal(r.sidecar_name, 'genoa-splat-sidecar');
    assert.equal(r.splat_bin, '/app/splat');
    assert.match(r.endpoint, /\/version$/);
    // DEM provisioning is unknown until a real run; don't claim "yes".
    assert.equal(r.dem_provisioned, null);
  } finally { restore(); }
});

test('capability(): unreachable sidecar reports error', async () => {
  const restore = mockFetch(() => { throw new Error('connect ECONNREFUSED'); });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.capability();
    assert.equal(r.available, false);
    assert.equal(r.reachable, false);
    assert.match(r.error, /ECONNREFUSED/);
  } finally { restore(); }
});

test('capability(): non-2xx /version is treated as unreachable', async () => {
  const restore = mockFetch(() => jsonResp({}, false, 503));
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.capability();
    assert.equal(r.available, false);
    assert.equal(r.reachable, false);
  } finally { restore(); }
});

test('run(): forwards body and reports available when returncode===0', async () => {
  let captured = null;
  const restore = mockFetch((url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return jsonResp({
      command:        ['/app/splat', '-t', 'tx.qth'],
      command_string: 'splat -t tx.qth',
      returncode:     0,
      stdout:         'ok',
      stderr:         ''
    });
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.run({ tx_qth: 'tx.qth', flags: ['-c', '10.0'], timeout_seconds: 10 });
    assert.equal(r.available, true);
    assert.equal(r.source, 'splat-sidecar');
    assert.equal(r.returncode, 0);
    assert.match(captured.url, /\/api\/v1\/splat\/run$/);
    assert.equal(captured.body.tx_qth, 'tx.qth');
    assert.deepEqual(captured.body.flags, ['-c', '10.0']);
    assert.equal(captured.body.timeout_seconds, 10);
  } finally { restore(); }
});

test('run(): returncode!=0 reports available=false (DEM-missing or splat error)', async () => {
  // Real-world case: sidecar reachable, splat ran, but had no DEM
  // tiles → returncode 1 with an error in stderr.  We do NOT pretend
  // SPLAT produced a result.
  const restore = mockFetch(() => jsonResp({
    command:        ['/app/splat', '-t', 'tx.qth'],
    command_string: 'splat -t tx.qth',
    returncode:     1,
    stdout:         '',
    stderr:         'No DEM data found for region.'
  }));
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.run({ tx_qth: 'tx.qth' });
    assert.equal(r.available, false, 'returncode != 0 must NOT be reported as available');
    assert.equal(r.returncode, 1);
    assert.match(r.stderr, /No DEM/);
  } finally { restore(); }
});

test('run(): missing tx_qth short-circuits before network', async () => {
  let called = false;
  const restore = mockFetch(() => { called = true; return jsonResp({}); });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.run({});
    assert.equal(called, false);
    assert.equal(r.available, false);
    assert.match(r.error, /tx_qth required/);
  } finally { restore(); }
});

test('run(): network failure is reported, not silently dropped', async () => {
  const restore = mockFetch(() => { throw new Error('socket hang up'); });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.run({ tx_qth: 'tx.qth' });
    assert.equal(r.available, false);
    assert.match(r.error, /socket hang up/);
  } finally { restore(); }
});
