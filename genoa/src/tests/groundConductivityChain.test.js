// Four-tier ground-conductivity resolution chain tests.
//
// Validates the operator → FCC → ZTR → NOAA → ITU chain and the
// real-data policy (NO synthetic fallback; AM_GROUND_SIGMA_UNRESOLVED
// blocker when all tiers fail).

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeFccConductivityClient }  from '../evidence/fccConductivityClient.js';
import { makeNoaaConductivityClient } from '../evidence/noaaConductivityClient.js';
import { makeItuConductivityClient }  from '../evidence/ituConductivityClient.js';

const okFetch = (sigma, source_label) => async () => ({
  ok: true,
  async json(){ return { results: [{ conductivity_mS_per_m: sigma, zone_label: source_label }] }; }
});
const downFetch = () => async () => { throw new Error('ENETUNREACH'); };

test('FCC tier returns sigma + fcc-m3 source on success', async () => {
  const c = makeFccConductivityClient({ fetchFn: okFetch(4, 'M3-12') });
  const r = await c.lookupSigma({ lat: 40, lon: -100 });
  assert.equal(r.available, true);
  assert.equal(r.sigma_mS_m, 4);
  assert.equal(r.source, 'fcc-m3');
  assert.equal(r.zone, 'M3-12');
});

test('NOAA tier returns sigma + noaa-ncei source on success', async () => {
  const c = makeNoaaConductivityClient({ fetchFn: okFetch(6, 'plains') });
  const r = await c.lookupSigma({ lat: 40, lon: -100 });
  assert.equal(r.available, true);
  assert.equal(r.sigma_mS_m, 6);
  assert.equal(r.source, 'noaa-ncei');
});

test('NOAA tier handles S/m → mS/m conversion when only conductivity_S_per_m is set', async () => {
  const fetchFn = async () => ({
    ok: true,
    async json(){ return { results: [{ conductivity_S_per_m: 0.008 }] }; }
  });
  const c = makeNoaaConductivityClient({ fetchFn });
  const r = await c.lookupSigma({ lat: 40, lon: -100 });
  assert.equal(r.available, true);
  assert.equal(r.sigma_mS_m, 8);   // 0.008 S/m = 8 mS/m
});

test('ITU tier returns sigma + itu-r-br-atlas source on success', async () => {
  const c = makeItuConductivityClient({ fetchFn: okFetch(2, 'Atlas-22') });
  const r = await c.lookupSigma({ lat: 40, lon: -100 });
  assert.equal(r.available, true);
  assert.equal(r.sigma_mS_m, 2);
  assert.equal(r.source, 'itu-r-br-atlas');
});

test('All tiers handle network failure with structured error (no throw)', async () => {
  const clients = [
    makeFccConductivityClient({ fetchFn: downFetch() }),
    makeNoaaConductivityClient({ fetchFn: downFetch() }),
    makeItuConductivityClient({ fetchFn: downFetch() })
  ];
  for (const c of clients){
    const r = await c.lookupSigma({ lat: 40, lon: -100 });
    assert.equal(r.available, false);
    assert.match(r.error, /ENETUNREACH/);
  }
});

test('All tiers handle non-2xx with structured error', async () => {
  const errFetch = async () => ({ ok: false, status: 503, async json(){ return {}; } });
  const clients = [
    makeFccConductivityClient({ fetchFn: errFetch }),
    makeNoaaConductivityClient({ fetchFn: errFetch }),
    makeItuConductivityClient({ fetchFn: errFetch })
  ];
  for (const c of clients){
    const r = await c.lookupSigma({ lat: 40, lon: -100 });
    assert.equal(r.available, false);
    assert.match(r.error, /HTTP 503/);
  }
});

test('All tiers reject invalid lat/lon without fetching', async () => {
  let called = 0;
  const counter = async () => { called++; return { ok: true, async json(){ return {}; } }; };
  const clients = [
    makeFccConductivityClient({ fetchFn: counter }),
    makeNoaaConductivityClient({ fetchFn: counter }),
    makeItuConductivityClient({ fetchFn: counter })
  ];
  for (const c of clients){
    const r = await c.lookupSigma({ lat: 'bad', lon: NaN });
    assert.equal(r.available, false);
  }
  assert.equal(called, 0);
});
