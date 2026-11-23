// Regression test for the map-sidecar /readyz reporting gap.
//
// Production symptom (user-reported, via the ServiceHealthPanel UI):
// "Map render" always showed OFFLINE with no latency, even though the
// map sidecar is an actual deployed DigitalOcean App Platform service
// (not simply unconfigured). Root cause: src/api/services/sidecars.js's
// `sidecars` registry never had a `map` property at all -- the comment
// there explicitly said "no sidecars.map property needed" because
// fetchMapRender() (sidecars/mapClient.js) calls MAP_SIDECAR_URL
// directly for actual rendering. But sidecarStatus() only ever iterates
// `Object.entries(sidecars)` -- with no `map` key, it never produces a
// `sidecars.map` entry in the /readyz JSON at all, so the frontend's
// `ledFor(undefined)` fell through to 'offline' unconditionally,
// regardless of whether MAP_SIDECAR_URL was set or whether the sidecar
// was actually healthy.
//
// This proves the fix (adding a bare `{ baseUrl }` map entry) actually
// makes /readyz report real configured/healthy/latency_ms state for
// map, using probeOne() directly against a real local HTTP server --
// not a mock -- so a future regression that silently drops the `map`
// key again, or that makes the health probe logic bypass bare-object
// clients, is actually caught.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { probeOne, sidecars } from '../api/services/sidecars.js';

function startServer(handler){
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('sidecars registry: map is present (regression -- it used to be entirely absent)', () => {
  assert.ok('map' in sidecars, '"map" must be a key in the sidecars registry so sidecarStatus() reports it');
});

test('probeOne: map entry unconfigured (null, matching every other factory\'s "no baseUrl -> return null" ' +
     'convention) reports configured:false, matching ServiceHealthPanel OFFLINE', async () => {
  const [name, entry] = await probeOne('map', null);
  assert.equal(name, 'map');
  assert.equal(entry.configured, false);
  assert.equal(entry.healthy, false);
});

test('probeOne: a truthy object with baseUrl:null (the WRONG unconfigured representation) still reports ' +
     'configured:true -- documents exactly why sidecars.map must be bare `null`, not `{ baseUrl: null }`, ' +
     'when MAP_SIDECAR_URL is unset (this is what the first version of the map-health fix got wrong)', async () => {
  const [, entry] = await probeOne('map', { baseUrl: null });
  assert.equal(entry.configured, true);
});

test('probeOne: map entry configured + real /health 200 reports configured:true, healthy:true, numeric latency_ms', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/health'){
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404); res.end();
    }
  });
  const { port } = server.address();
  try {
    const [name, entry] = await probeOne('map', { baseUrl: `http://127.0.0.1:${port}` });
    assert.equal(name, 'map');
    assert.equal(entry.configured, true);
    assert.equal(entry.healthy, true);
    assert.equal(typeof entry.latency_ms, 'number');
    assert.ok(entry.latency_ms >= 0);
  } finally {
    server.close();
  }
});

test('probeOne: map entry configured but server returns non-2xx reports configured:true, healthy:false -- matches ' +
     'ServiceHealthPanel BLOCKED ("unreachable"), not OFFLINE', async () => {
  const server = await startServer((req, res) => { res.writeHead(500); res.end(); });
  const { port } = server.address();
  try {
    const [, entry] = await probeOne('map', { baseUrl: `http://127.0.0.1:${port}` });
    assert.equal(entry.configured, true);
    assert.equal(entry.healthy, false);
  } finally {
    server.close();
  }
});

test('probeOne: map entry configured but nothing listening reports configured:true, healthy:false (connection refused), ' +
     'not configured:false -- the distinction the UI uses to tell "never set up" from "down"', async () => {
  // Use a port deliberately not listening, local-only (127.0.0.1) so this
  // never depends on external network reachability.
  const [, entry] = await probeOne('map', { baseUrl: 'http://127.0.0.1:1' });
  assert.equal(entry.configured, true);
  assert.equal(entry.healthy, false);
});

test('sidecars.map reads MAP_SIDECAR_URL the same way every other registry entry reads its own env var ' +
     '(reconciliation: the real registry entry, not just a hand-built test fixture, behaves correctly)', async () => {
  // sidecars.map was built at module-import time from whatever
  // MAP_SIDECAR_URL was at that point in *this* test run -- just prove
  // probeOne() on the REAL registry entry doesn't throw and returns the
  // expected shape, whatever that env var happened to be.
  const [name, entry] = await probeOne('map', sidecars.map);
  assert.equal(name, 'map');
  assert.equal(typeof entry.configured, 'boolean');
  assert.equal(typeof entry.healthy, 'boolean');
  // sidecars.map itself must be null when MAP_SIDECAR_URL is unset
  // (matching every other entry's factory convention, e.g.
  // makeIdentityClient's `if (!baseUrl) return null;`) -- a truthy
  // object with baseUrl:null would make probeOne() report
  // configured:true even when nothing was ever configured.
  if (sidecars.map === null){
    assert.equal(entry.configured, false);
  } else {
    assert.equal(entry.configured, true);
    assert.equal(entry.baseUrl ?? null, sidecars.map.baseUrl ?? null);
  }
});
