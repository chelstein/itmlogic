// Live-sidecar integration suite for the FCCAM client.
//
// SKIPPED automatically when FCCAM_SIDECAR_URL is unset (which is
// the CI default).  Run locally against a real sidecar like this:
//
//   FCCAM_SIDECAR_URL=http://localhost:8090 \
//   FCCAM_API_TOKEN="$(cat /etc/genoa/fccam-token)" \
//     node --test genoa/src/tests/fccamClientIntegration.test.js
//
// The suite walks every entry in genoa/data/golden/am_skywave_reference_suite.json
// against the sidecar.  Each entry pins a (station, receiver, expected
// 50% skywave field) tuple computed against the FCC's published nighttime
// allocation tables.  Operators populate this file at bring-up; see the
// file header for sourcing notes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { makeFccamClient, midpointLatitude } from '../evidence/fccamClient.js';

const BASE_URL  = (process.env.FCCAM_SIDECAR_URL || '').trim();
const skipAll   = !BASE_URL;
const skipNote  = 'FCCAM_SIDECAR_URL unset — skipping live-sidecar integration suite';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, '..', '..', 'data', 'golden', 'am_skywave_reference_suite.json');

test('FCCAM sidecar /healthz reports binary present', { skip: skipAll && skipNote }, async () => {
  const c = makeFccamClient();
  assert.ok(c, 'client should construct when FCCAM_SIDECAR_URL is set');
  const ok = await c.health();
  assert.equal(ok, true, 'sidecar /healthz must respond 200');
});

test('FCCAM sidecar /version stamps source_sha256 + binary_sha256', { skip: skipAll && skipNote }, async () => {
  const v = await makeFccamClient().version();
  assert.equal(v.available, true);
  assert.match(v.source_sha256 || '', /^[a-f0-9]{64}$/i, 'source_sha256 missing — image was built without Fccam.for');
  assert.match(v.binary_sha256 || '', /^[a-f0-9]{64}$/i, 'binary_sha256 missing — FCCAM did not compile');
});

test('FCCAM golden suite — every reference station matches within tolerance',
  { skip: skipAll && skipNote }, async () => {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(GOLDEN_PATH, 'utf8'));
  } catch (e){
    assert.fail(`golden manifest not found at ${GOLDEN_PATH}: ${e.message}`);
  }
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  if (cases.length === 0){
    // Operator hasn't populated the manifest yet — surface this as a
    // todo, NOT as a passing test.  Better to make the unpopulated
    // state visible.
    assert.fail('am_skywave_reference_suite.json has no cases populated; ' +
                'see file header for sourcing instructions');
  }
  const c = makeFccamClient();
  const TOLERANCE_UV_M = Number(manifest.tolerance_uv_m) || 5.0;
  const failures = [];
  for (const caseDef of cases){
    const mid = Number.isFinite(caseDef.midpoint_lat)
      ? caseDef.midpoint_lat
      : midpointLatitude(caseDef.tx_lat, caseDef.tx_lon, caseDef.rx_lat, caseDef.rx_lon);
    const r = await c.fieldAtDistance({
      erp_kw:       caseDef.erp_kw,
      freq_khz:     caseDef.freq_khz,
      distance_km:  caseDef.distance_km,
      midpoint_lat: mid,
      percent_time: caseDef.percent_time ?? 50
    });
    if (!r.available){
      failures.push({ id: caseDef.id, reason: r.error });
      continue;
    }
    const delta = Math.abs(r.field_uv_m - caseDef.expected_field_uv_m);
    if (delta > TOLERANCE_UV_M){
      failures.push({
        id: caseDef.id,
        expected: caseDef.expected_field_uv_m,
        got: r.field_uv_m,
        delta,
        tolerance: TOLERANCE_UV_M
      });
    }
  }
  assert.deepEqual(failures, [], `golden cases out of tolerance:\n${JSON.stringify(failures, null, 2)}`);
});
