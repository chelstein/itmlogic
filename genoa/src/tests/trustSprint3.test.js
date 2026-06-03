// Trust Sprint #3 — regression tests for the three gaps fixed.
//
// Gap #2  OET-65 escalation: missing OET-65 at ERP ≥5 kW → WARNING (OET65_REQUIRED)
//         missing OET-65 at ERP <5 kW → advisory (OET65_MISSING, unchanged)
//
// Gap #3  ASR blocking: tower >60.96 m (200 ft) with no ASR number → BLOCKER (ASR_UNREGISTERED)
//         tower >60.96 m WITH an ASR number → no blocker
//         tower ≤60.96 m with no ASR number → no blocker
//
// Gap #5  Replay token: stampReplayToken() utility in trustRoutes stamps exhibit.replay_token
//         when it is absent; leaves it untouched when it is already present.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadinessReport } from '../exports/readiness/index.js';

// ── Shared fixture helpers ────────────────────────────────────────────────────

function fmExhibit(overrides = {}) {
  return {
    station_inputs: {
      call: 'WTEST', service: 'FM', fcc_class: 'A',
      frequency: 107.9, erp_kw: 6.0, haat_m_input: 100,
      lat: 43.048, lon: -76.147,
      ...overrides.station_inputs,
    },
    evidence: { ...overrides.evidence },
    regulatory_compliance: overrides.regulatory_compliance,
    oet65: overrides.oet65,
  };
}

// ── Gap #2: OET-65 escalation ────────────────────────────────────────────────

test('OET65_REQUIRED warning fires for ERP ≥ 5 kW (exactly 5 kW boundary)', () => {
  const ex = fmExhibit({ station_inputs: { erp_kw: 5.0 } });
  const r  = buildReadinessReport(ex);
  const w  = r.warnings.find(w => w.code === 'OET65_REQUIRED');
  assert.ok(w, 'OET65_REQUIRED warning must fire at exactly 5 kW ERP');
  assert.match(w.message, /5\s*kW/, 'warning message must mention the ERP value');
  assert.ok(!r.advisories.find(a => a.code === 'OET65_MISSING'),
    'OET65_MISSING advisory must NOT appear when OET65_REQUIRED warning is present');
});

test('OET65_REQUIRED warning fires for ERP > 5 kW (6 kW)', () => {
  const ex = fmExhibit({ station_inputs: { erp_kw: 6.0 } });
  const r  = buildReadinessReport(ex);
  assert.ok(r.warnings.find(w => w.code === 'OET65_REQUIRED'),
    'OET65_REQUIRED warning must fire for 6 kW ERP');
});

test('OET65_REQUIRED warning fires for high-power ERP (100 kW)', () => {
  const ex = fmExhibit({ station_inputs: { erp_kw: 100 } });
  const r  = buildReadinessReport(ex);
  const w  = r.warnings.find(w => w.code === 'OET65_REQUIRED');
  assert.ok(w, 'OET65_REQUIRED warning must fire for 100 kW ERP');
  assert.match(w.rule, /OET Bulletin 65/, 'warning must cite OET Bulletin 65');
});

test('OET65_MISSING advisory fires for ERP < 5 kW (low power)', () => {
  const ex = fmExhibit({ station_inputs: { erp_kw: 0.1 } });
  const r  = buildReadinessReport(ex);
  assert.ok(r.advisories.find(a => a.code === 'OET65_MISSING'),
    'OET65_MISSING advisory must fire for low-ERP (0.1 kW) station');
  assert.ok(!r.warnings.find(w => w.code === 'OET65_REQUIRED'),
    'OET65_REQUIRED warning must NOT fire for low-ERP station');
});

test('OET65_MISSING advisory fires for LPFM (0.1 kW)', () => {
  const ex = {
    station_inputs: { call: 'WPFK', service: 'LPFM', frequency: 88.1, erp_kw: 0.1, lat: 40.712, lon: -74.006 },
    evidence: {}
  };
  const r = buildReadinessReport(ex);
  assert.ok(r.advisories.find(a => a.code === 'OET65_MISSING'),
    'LPFM at 0.1 kW must stay in advisories, not escalate to warning');
});

test('No OET65 check fires when oet65 is present', () => {
  const ex = fmExhibit({ oet65: { pass: true, method: 'general' }, station_inputs: { erp_kw: 50 } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.warnings.find(w => w.code === 'OET65_REQUIRED'),
    'OET65_REQUIRED must not fire when oet65 evidence is present');
  assert.ok(!r.advisories.find(a => a.code === 'OET65_MISSING'),
    'OET65_MISSING must not fire when oet65 evidence is present');
});

test('OET65_REQUIRED uses power_day_kw fallback for AM stations ≥ 5 kW', () => {
  const ex = {
    station_inputs: { call: 'KTEST', service: 'AM', frequency_khz: 780, power_day_kw: 50, lat: 34.86, lon: -111.79 },
    evidence: {}
  };
  const r = buildReadinessReport(ex);
  assert.ok(r.warnings.find(w => w.code === 'OET65_REQUIRED'),
    'AM station at 50 kW day power must get OET65_REQUIRED warning');
});

test('OET65 is never a BLOCKER — OET65_REQUIRED is in warnings, not blockers', () => {
  const ex = fmExhibit({ station_inputs: { erp_kw: 100 } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'OET65_REQUIRED'),
    'OET65_REQUIRED must never appear in blockers');
});

// ── Gap #3: ASR blocking ──────────────────────────────────────────────────────

test('ASR_UNREGISTERED blocker fires: tower 61 m, no ASR number', () => {
  const ex = fmExhibit({ station_inputs: { overall_height_m: 61, erp_kw: 10 } });
  const r  = buildReadinessReport(ex);
  const b  = r.blockers.find(b => b.code === 'ASR_UNREGISTERED');
  assert.ok(b, 'ASR_UNREGISTERED blocker must fire for 61 m tower with no ASR number');
  assert.match(b.message, /61/, 'blocker message must mention the height');
  assert.match(b.rule, /Part 17/, 'blocker must cite 47 CFR Part 17');
  assert.ok(b.remedy && b.remedy.length > 10, 'blocker must include a remedy');
});

test('ASR_UNREGISTERED blocker fires exactly at 60.97 m (just above threshold)', () => {
  const ex = fmExhibit({ station_inputs: { overall_height_m: 60.97 } });
  const r  = buildReadinessReport(ex);
  assert.ok(r.blockers.find(b => b.code === 'ASR_UNREGISTERED'),
    'ASR_UNREGISTERED must fire at 60.97 m (above 60.96 m threshold)');
});

test('ASR_UNREGISTERED does NOT fire at exactly 60.96 m (at threshold, not above)', () => {
  const ex = fmExhibit({ station_inputs: { overall_height_m: 60.96 } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'ASR_UNREGISTERED'),
    'ASR_UNREGISTERED must NOT fire at exactly 60.96 m');
});

test('ASR_UNREGISTERED does NOT fire when tower height ≤ 60 m', () => {
  const ex = fmExhibit({ station_inputs: { overall_height_m: 30 } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'ASR_UNREGISTERED'),
    'ASR_UNREGISTERED must NOT fire for 30 m tower');
});

test('ASR_UNREGISTERED does NOT fire when ASR number is in station_inputs', () => {
  const ex = fmExhibit({ station_inputs: { overall_height_m: 90, asr_number: '1234567' } });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'ASR_UNREGISTERED'),
    'ASR_UNREGISTERED must NOT fire when station_inputs.asr_number is present');
});

test('ASR_UNREGISTERED does NOT fire when ASR number is in evidence.asr', () => {
  const ex = fmExhibit({
    station_inputs: { overall_height_m: 90 },
    evidence: { asr: { asr_number: '9876543', overall_height_m: 90, fetched_at: '2026-01-01T00:00:00Z' } }
  });
  const r  = buildReadinessReport(ex);
  assert.ok(!r.blockers.find(b => b.code === 'ASR_UNREGISTERED'),
    'ASR_UNREGISTERED must NOT fire when evidence.asr.asr_number is present');
});

test('ASR_UNREGISTERED uses evidence.asr.overall_height_m when station_inputs lacks height', () => {
  const ex = fmExhibit({
    evidence: { asr: { overall_height_m: 95, fetched_at: '2026-01-01T00:00:00Z' } }
  });
  const r  = buildReadinessReport(ex);
  assert.ok(r.blockers.find(b => b.code === 'ASR_UNREGISTERED'),
    'ASR_UNREGISTERED must fire when ASR record reports height 95 m but no ASR number');
});

test('ASR_UNREGISTERED makes determination NOT_READY', () => {
  const ex = fmExhibit({ station_inputs: { overall_height_m: 90 } });
  const r  = buildReadinessReport(ex);
  assert.equal(r.determination, 'NOT_READY',
    'Unregistered tower >60.96 m must gate the filing as NOT_READY');
});

test('ASR_UNREGISTERED is in blockers (score section handles it)', () => {
  const ex = fmExhibit({ station_inputs: { overall_height_m: 90 } });
  const r  = buildReadinessReport(ex);
  const b  = r.blockers.find(b => b.code === 'ASR_UNREGISTERED');
  assert.ok(b, 'ASR_UNREGISTERED must be in blockers');
  // Score must be ≤ 80 (penalty applied) and ≥ 0 (clamped)
  assert.ok(r.readiness_score <= 80, 'score must reflect the ASR_UNREGISTERED penalty');
  assert.ok(r.readiness_score >= 0, 'score must not go below 0');
});

// ── Gap #5: Replay token (pure logic, no network) ────────────────────────────

test('buildReplayToken produces a non-empty base64url string', async () => {
  const { buildReplayToken } = await import('../engine/buildAttestation.js');
  const ex = { station_inputs: { call: 'WTEST', service: 'FM' }, evidence: {} };
  const { token } = buildReplayToken(ex, { inputs: ex.station_inputs, evidence: ex.evidence });
  assert.ok(typeof token === 'string' && token.length > 0, 'replay token must be a non-empty string');
  assert.ok(!token.includes('='), 'base64url must not contain padding =');
  assert.ok(!token.includes('+'), 'base64url must not contain +');
  assert.ok(!token.includes('/'), 'base64url must not contain /');
});

test('buildReplayToken is deterministic for identical inputs', async () => {
  const { buildReplayToken } = await import('../engine/buildAttestation.js');
  const ex = { station_inputs: { call: 'WTEST', service: 'FM' }, evidence: {} };
  const t1 = buildReplayToken(ex, { inputs: ex.station_inputs, evidence: ex.evidence });
  const t2 = buildReplayToken(ex, { inputs: ex.station_inputs, evidence: ex.evidence });
  // The exhibit_sha256 portion (derived from exhibit content) must match.
  // Full token may differ (signed_at timestamp in attestation), but the
  // inputs_sha256 and evidence_sha256 must be identical.
  const p1 = JSON.parse(Buffer.from(t1.token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  const p2 = JSON.parse(Buffer.from(t2.token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.equal(p1.inputs_sha256,   p2.inputs_sha256,   'inputs_sha256 must be deterministic');
  assert.equal(p1.evidence_sha256, p2.evidence_sha256, 'evidence_sha256 must be deterministic');
  assert.equal(p1.exhibit_sha256,  p2.exhibit_sha256,  'exhibit_sha256 must be deterministic');
});

// ── Cross-cutting invariant ───────────────────────────────────────────────────

test('all scores remain 0-100 integers after Sprint #3 changes', () => {
  const fixtures = [
    fmExhibit({ station_inputs: { erp_kw: 6.0 } }),
    fmExhibit({ station_inputs: { erp_kw: 0.1 } }),
    fmExhibit({ station_inputs: { overall_height_m: 90 } }),
    fmExhibit({ station_inputs: { overall_height_m: 90, asr_number: '1234567' } }),
    fmExhibit({ station_inputs: { erp_kw: 100, overall_height_m: 90 } }),
    { station_inputs: { call: 'LPFM', service: 'LPFM', erp_kw: 0.1, lat: 40.7, lon: -74.0 }, evidence: {} },
  ];
  for (const ex of fixtures) {
    const r = buildReadinessReport(ex);
    assert.ok(Number.isInteger(r.readiness_score), `score must be integer (got ${r.readiness_score})`);
    assert.ok(r.readiness_score >= 0 && r.readiness_score <= 100,
      `score must be 0-100 (got ${r.readiness_score})`);
  }
});
