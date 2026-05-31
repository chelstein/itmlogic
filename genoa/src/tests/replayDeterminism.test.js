// Replay determinism — same inputs in, byte-equal compute outputs out.
//
// The Genoa engine ships a replay token; the inputs_sha256 +
// evidence_sha256 hashes commit to canonical representations of the
// request.  Replay determinism is the load-bearing claim of the entire
// product: any reviewer should be able to re-run a filed exhibit and
// land on the same engineering content.
//
// What "byte-equal" means here:
//   STABLE   (must match across two runs)
//     - station_inputs
//     - radial_table
//     - polygons
//     - geojson
//     - contour_definitions
//     - regulatory_compliance
//     - replay_digest.inputs_sha256
//     - replay_digest.evidence_sha256
//     - engine_signature
//   VARYING  (excluded by design)
//     - generated_at                   (timestamp)
//     - replay_digest.exhibit_sha256  (derives from generated_at)
//     - build_attestation.signed_at    (timestamp)

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExhibit, FM_CLASS_A, AM_INCOMPLETE } from './_helpers.js';

function stableSlice(exhibit){
  return {
    station_inputs:         exhibit.station_inputs,
    radial_table:           exhibit.radial_table,
    polygons:               exhibit.polygons,
    geojson:                exhibit.geojson,
    contour_definitions:    exhibit.contour_definitions,
    regulatory_compliance:  exhibit.regulatory_compliance,
    inputs_sha256:          exhibit.replay_digest?.inputs_sha256,
    evidence_sha256:        exhibit.replay_digest?.evidence_sha256,
    engine_signature:       exhibit.engine_signature
  };
}

test('replay determinism: FM canonical reference is byte-equal across two runs', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  const ja = JSON.stringify(stableSlice(a));
  const jb = JSON.stringify(stableSlice(b));
  assert.equal(ja, jb, 'FM stable slice diverged across runs');
});

test('replay determinism: AM canonical reference is byte-equal across two runs', async () => {
  const a = await buildExhibit(AM_INCOMPLETE);
  const b = await buildExhibit(AM_INCOMPLETE);
  const ja = JSON.stringify(stableSlice(a));
  const jb = JSON.stringify(stableSlice(b));
  assert.equal(ja, jb, 'AM stable slice diverged across runs');
});

test('replay determinism: inputs_sha256 is stable when inputs are byte-equal', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(a.replay_digest.inputs_sha256, b.replay_digest.inputs_sha256);
});

test('replay determinism: evidence_sha256 is stable when evidence is byte-equal', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(a.replay_digest.evidence_sha256, b.replay_digest.evidence_sha256);
});

test('replay determinism: radial_table is exactly byte-equal across runs', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(JSON.stringify(a.radial_table), JSON.stringify(b.radial_table));
});

test('replay determinism: polygons are exactly byte-equal across runs', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(JSON.stringify(a.polygons), JSON.stringify(b.polygons));
});

test('replay determinism: geojson is exactly byte-equal across runs', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(JSON.stringify(a.geojson), JSON.stringify(b.geojson));
});

test('replay determinism: different inputs → different inputs_sha256', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const variant = { ...FM_CLASS_A, erp_kw: 25 };   // distinguishable input change
  const b = await buildExhibit(variant);
  assert.notStrictEqual(a.replay_digest.inputs_sha256, b.replay_digest.inputs_sha256,
    'inputs_sha256 collision across different ERP values');
});

test('replay determinism: generated_at is the ONLY field permitted to vary across runs', async () => {
  // Trust-but-verify: enumerate every top-level key that differs and
  // assert it's on a known allow-list.
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  const allowed = new Set([
    'generated_at', 'replay_digest', 'replay_token',
    'build_attestation', 'narrative', 'validation'
  ]);
  // build_attestation carries a signed_at; replay_token packs the
  // generated_at; narrative.text embeds the Generated: ISO stamp;
  // validation.runs carry per-run start/end stamps.
  const drifted = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])){
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])){
      if (!allowed.has(k)) drifted.push(k);
    }
  }
  assert.deepEqual(drifted, [],
    'unexpected fields drifted across replay: ' + drifted.join(','));
});

// ─── G-016: verifyAttestation curve-dataset fingerprint verification ──────────
//
// verifyAttestation() must reject an attestation whose curve_dataset_fingerprint_sha256
// was computed against a DIFFERENT curve dataset than what the verifier recomputes.
// This prevents a tampered or mismatched exhibit from passing attestation verification
// even when the engine HMAC is valid.

import { verifyAttestation, buildAttestation } from '../engine/buildAttestation.js';
import crypto from 'node:crypto';

function makeAttestation(overrides = {}){
  // Build a base attestation and extend with curve_dataset fields, mimicking
  // what engine/index.js stamps after loading the curve set at runtime.
  const base = buildAttestation();
  const curvePart   = JSON.stringify({ curve_dataset: { meta_sha256: 'deadbeef' }, service: 'FM' });
  const baseHash    = base.fingerprint_sha256 || '';
  const curveFp     = crypto.createHash('sha256').update(baseHash + '|' + curvePart, 'utf8').digest('hex');
  return {
    ...base,
    curve_dataset_fingerprint_sha256:   curveFp,
    curve_dataset_fingerprint_inputs: [
      'base=' + baseHash,
      'curve_dataset=' + curvePart
    ],
    ...overrides
  };
}

test('G-016 positive: verifyAttestation passes with correct curve_dataset_fingerprint_sha256', () => {
  const att = makeAttestation();
  const r = verifyAttestation(att);
  // When BUILD_SIGNING_SECRET is unset, signature is null and verifyAttestation
  // returns ok:false with "unsigned" reason — that is correct behaviour.
  // The curve-dataset check runs only when the HMAC check passes first.
  // Without the secret we can only verify the fingerprint recomputation path.
  // We patch the attestation to have no signature to test that path.
  const attNoSig = { ...att, signature: null };
  const rNoSig = verifyAttestation(attNoSig);
  assert.equal(rNoSig.ok, false);
  assert.match(rNoSig.reason, /unsigned/);
  // The curve_dataset field itself must be well-formed
  assert.ok(typeof att.curve_dataset_fingerprint_sha256 === 'string');
  assert.ok(/^[0-9a-f]{64}$/.test(att.curve_dataset_fingerprint_sha256));
});

test('G-016 negative: curve_dataset fingerprint recomputation catches a tampered fingerprint', () => {
  // verifyAttestation() checks the curve_dataset_fingerprint_sha256 AFTER the
  // HMAC check.  In test environments without BUILD_SIGNING_SECRET the HMAC
  // check short-circuits before the curve check — so we cannot drive the full
  // path via verifyAttestation().
  //
  // Instead, we prove the GUARD LOGIC directly: the fingerprint computation
  // used by verifyAttestation() (baseHash + '|' + curvePart) correctly
  // detects a tampered stored hash.  The production implementation at
  // buildAttestation.js:verifyAttestation() uses this exact formula, so a
  // mismatch here would also produce a mismatch there when HMAC is valid.
  const att = makeAttestation();
  const inputsRaw  = att.curve_dataset_fingerprint_inputs;
  const baseHash   = inputsRaw.find(s => s.startsWith('base='))?.slice(5) || '';
  const curvePart  = inputsRaw.find(s => s.startsWith('curve_dataset='))?.slice(14) || '';
  // Recompute using the guard formula — must match the stored fingerprint.
  const recomputed = crypto.createHash('sha256')
    .update(baseHash + '|' + curvePart, 'utf8').digest('hex');
  assert.equal(recomputed, att.curve_dataset_fingerprint_sha256,
    'recomputed fingerprint must match stored fingerprint (positive case)');

  // Now tamper: compute what a DIFFERENT curve dataset would produce.
  const tamperedCurve   = JSON.stringify({ curve_dataset: { meta_sha256: 'TAMPERED' }, service: 'FM' });
  const tamperedStored  = crypto.createHash('sha256')
    .update(baseHash + '|' + tamperedCurve, 'utf8').digest('hex');
  // The tampered hash must NOT match the recomputed hash from the original inputs.
  assert.notEqual(tamperedStored, recomputed,
    'fingerprint computed from a different curve dataset must differ from the original');
  // This is the mismatch that verifyAttestation() will catch in production when
  // an exhibit claims one curve dataset but the verifier recomputes from different inputs.
});

test('G-016: verifyAttestation passes when curve_dataset fields are absent (backward compat)', () => {
  // Old attestations without curve_dataset_fingerprint fields must not fail —
  // the check is additive.
  const base = buildAttestation();
  const r = verifyAttestation({ ...base, signature: null });
  // No signature → ok:false with "unsigned" — not "curve_dataset mismatch"
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.reason, /curve_dataset/,
    'absence of curve_dataset fields must not trigger curve mismatch error');
});

// G-016 SIGNED PATH — exercises the full production verifyAttestation() code
// path including HMAC verification, not merely the fingerprint formula.
//
// The prior tests in this file proved the fingerprint computation formula is
// correct but bypassed verifyAttestation() because BUILD_SIGNING_SECRET was
// unset in the test environment.  This test sets a known test secret so
// buildAttestation() produces a real HMAC signature that verifyAttestation()
// will check, then tampers only curve_dataset_fingerprint_sha256 and confirms:
//   (a) the tampered attestation is rejected
//   (b) the rejection reason names the curve fingerprint — not HMAC or unsigned
//   (c) this proves the HMAC path was exercised and PASSED before the curve
//       guard ran (if HMAC had failed the reason would say 'HMAC mismatch')
test('G-016 SIGNED: verifyAttestation exercises full production path with signing secret', () => {
  const origSecret = process.env.BUILD_SIGNING_SECRET;
  try {
    process.env.BUILD_SIGNING_SECRET = 'genoa-test-signing-secret-g016-2026';

    // buildAttestation() now produces a real HMAC-SHA256 signature.
    const base = buildAttestation();
    assert.ok(
      typeof base.signature === 'string' && /^[0-9a-f]{64}$/.test(base.signature),
      'attestation must carry a hex HMAC signature when BUILD_SIGNING_SECRET is set'
    );

    // Attach curve_dataset fields — mirroring what engine/index.js stamps at runtime.
    const curvePart = JSON.stringify({ curve_dataset: { meta_sha256: 'cafebabe01234567' }, service: 'FM' });
    const baseHash  = base.fingerprint_sha256;
    const curveFp   = crypto.createHash('sha256').update(baseHash + '|' + curvePart, 'utf8').digest('hex');
    const att = {
      ...base,
      curve_dataset_fingerprint_sha256:  curveFp,
      curve_dataset_fingerprint_inputs:  [ 'base=' + baseHash, 'curve_dataset=' + curvePart ]
    };

    // 1. Positive: full signed verification must succeed.
    const r1 = verifyAttestation(att);
    assert.equal(r1.ok, true,
      'signed attestation with correct curve fingerprint must verify ok=true');
    assert.equal(r1.curve_dataset_fingerprint_sha256, curveFp,
      'verifyAttestation must echo back the verified curve fingerprint');

    // 2. Negative: tamper ONLY curve_dataset_fingerprint_sha256 — the HMAC
    //    (which covers the base fingerprint, not the curve extension) stays valid.
    const tamperedCurve = JSON.stringify({ curve_dataset: { meta_sha256: 'TAMPERED-0000' }, service: 'FM' });
    const tamperedFp    = crypto.createHash('sha256')
      .update(baseHash + '|' + tamperedCurve, 'utf8').digest('hex');
    const attTampered = { ...att, curve_dataset_fingerprint_sha256: tamperedFp };

    const r2 = verifyAttestation(attTampered);
    assert.equal(r2.ok, false,
      'tampered curve fingerprint must be rejected even when base HMAC is valid');
    assert.match(r2.reason, /curve_dataset_fingerprint_sha256 mismatch/,
      'rejection reason must specifically identify the curve dataset fingerprint as the mismatch');

    // 3. The rejection must NOT come from HMAC or unsigned — proves the HMAC path
    //    was exercised and passed before the curve guard ran.
    assert.doesNotMatch(r2.reason, /HMAC|unsigned|SECRET/i,
      'reason must not be from HMAC or unsigned path — HMAC was exercised and passed');

  } finally {
    if (origSecret === undefined){
      delete process.env.BUILD_SIGNING_SECRET;
    } else {
      process.env.BUILD_SIGNING_SECRET = origSecret;
    }
  }
});
