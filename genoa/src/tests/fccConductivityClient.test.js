// Live FCC §73.190 / Figure M3 ground-conductivity lookup tests.
//
// Covers the new fccConductivityClient that resolves σ (mS/m) at a
// given lat/lon from geo.fcc.gov.  See src/evidence/fccConductivityClient.js
// for the response-shape contract.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeFccConductivityClient } from '../evidence/fccConductivityClient.js';

test('lookupSigma: returns sigma + zone from a 200 OK response', async () => {
  let seenUrl = null;
  const fetchFn = async (url) => {
    seenUrl = url;
    return {
      ok: true,
      async json(){
        return { results: [{ conductivity_mS_per_m: 4, zone_label: 'M3-12' }] };
      }
    };
  };
  const c = makeFccConductivityClient({ baseUrl: "https://example.test/fcc", fetchFn });
  const r = await c.lookupSigma({ lat: 37.0902, lon: -95.7129 });
  assert.equal(r.available, true);
  assert.equal(r.sigma_mS_m, 4);
  assert.equal(r.zone, 'M3-12');
  assert.equal(r.source, 'fcc-m3');
  assert.match(seenUrl, /lat=37\.0902/);
  assert.match(seenUrl, /lon=-95\.7129/);
});

test('lookupSigma: falls back through conductivity_msm and conductivity field names', async () => {
  const fetchFn = async () => ({
    ok: true,
    async json(){ return { results: [{ conductivity: 8 }] }; }
  });
  const c = makeFccConductivityClient({ baseUrl: "https://example.test/fcc", fetchFn });
  const r = await c.lookupSigma({ lat: 40, lon: -100 });
  assert.equal(r.available, true);
  assert.equal(r.sigma_mS_m, 8);
});

test('lookupSigma: invalid lat/lon returns structured error without fetching', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { ok: true, async json(){ return {}; } }; };
  const c = makeFccConductivityClient({ baseUrl: "https://example.test/fcc", fetchFn });
  const r = await c.lookupSigma({ lat: 'bad', lon: NaN });
  assert.equal(called, false);
  assert.equal(r.available, false);
  assert.match(r.error, /finite/);
});

test('lookupSigma: HTTP non-2xx surfaces a structured error', async () => {
  const fetchFn = async () => ({ ok: false, status: 503, async json(){ return {}; } });
  const c = makeFccConductivityClient({ baseUrl: "https://example.test/fcc", fetchFn });
  const r = await c.lookupSigma({ lat: 40, lon: -100 });
  assert.equal(r.available, false);
  assert.match(r.error, /HTTP 503/);
});

test('lookupSigma: response missing conductivity value flags no-data error', async () => {
  const fetchFn = async () => ({
    ok: true,
    async json(){ return { results: [{ zone_label: 'unknown' }] }; }
  });
  const c = makeFccConductivityClient({ baseUrl: "https://example.test/fcc", fetchFn });
  const r = await c.lookupSigma({ lat: 40, lon: -100 });
  assert.equal(r.available, false);
  assert.match(r.error, /no conductivity value/);
});

test('lookupSigma: network exception is caught and reported', async () => {
  const fetchFn = async () => { throw new Error('ENETUNREACH'); };
  const c = makeFccConductivityClient({ baseUrl: "https://example.test/fcc", fetchFn });
  const r = await c.lookupSigma({ lat: 40, lon: -100 });
  assert.equal(r.available, false);
  assert.match(r.error, /ENETUNREACH/);
});
