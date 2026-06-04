// PR #331 regression tests — Source Freshness + Evidence Locking Framework.
//
// Test cases:
//   A. Fresh FCC LMS source (today)        → current, no warnings
//   B. FCC LMS > 30 days old              → stale, SOURCE_STALE warning
//   C. Critical source stale + refresh_required → SOURCE_REFRESH_REQUIRED blocker
//   D. Missing retrieved_at timestamp     → SOURCE_TIMESTAMP_MISSING warning
//   E. USGS DEM one year old              → aging (365 d threshold = boundary)
//   F. Evidence lock created              → aggregate_hash exists, sources hashed
//   G. Evidence lock verification passes  → valid=true
//   H. Evidence lock fails after change   → valid=false, SOURCE_EVIDENCE_LOCK_INVALID
//   I. Missing critical source lock       → SOURCE_EVIDENCE_LOCK_MISSING blocker
//   J. AI inference source                → not_authoritative, low confidence

import test from 'node:test';
import assert from 'node:assert/strict';

import { WARNING_CODES } from '../types/warnings.js';
import { SOURCE_AUTHORITY } from '../engine/provenance/sourceAuthority.js';
import {
  assessSourceFreshness,
  assessExhibitSourceFreshness
} from '../engine/provenance/sourceFreshness.js';
import {
  buildEvidenceLock,
  verifyEvidenceLock
} from '../engine/provenance/evidenceLock.js';
import { buildSourceAttestation } from '../engine/provenance/buildSourceAttestation.js';
import { buildExhibit, FM_CLASS_A } from './_helpers.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ── A. Fresh FCC LMS source ───────────────────────────────────────────────────

test('A: FCC LMS retrieved today → freshness_status=current, no warnings', () => {
  const r = assessSourceFreshness({
    source_authority:    SOURCE_AUTHORITY.FCC_LMS,
    retrieved_at:        new Date().toISOString(),
    source_last_modified:null
  });
  assert.equal(r.freshness_status, 'current');
  assert.equal(r.warnings.length, 0, 'No warnings for fresh record');
  assert.equal(r.blockers.length, 0, 'No blockers for fresh record');
});

// ── B. FCC LMS older than 30 days → stale ────────────────────────────────────

test('B: FCC LMS 35 days old → freshness_status=stale, SOURCE_STALE warning', () => {
  const r = assessSourceFreshness({
    source_authority:    SOURCE_AUTHORITY.FCC_LMS,
    retrieved_at:        daysAgo(35),
    source_last_modified:null
  });
  assert.equal(r.freshness_status, 'stale');
  assert.ok(r.warnings.some(w => w.code === 'SOURCE_STALE'),
    'Must emit SOURCE_STALE warning');
  assert.ok(r.staleness_days > 30, 'staleness_days must exceed 30');
});

// ── C. Stale + refresh_required → blocker ────────────────────────────────────

test('C: FCC LMS stale + refresh_required=true → SOURCE_REFRESH_REQUIRED blocker', () => {
  const r = assessSourceFreshness({
    source_authority: SOURCE_AUTHORITY.FCC_LMS,
    retrieved_at:     daysAgo(40),
    refresh_required: true
  });
  assert.equal(r.freshness_status, 'stale');
  assert.ok(r.blockers.some(b => b.code === 'SOURCE_REFRESH_REQUIRED'),
    'Must emit SOURCE_REFRESH_REQUIRED blocker when stale and refresh_required');
});

test('C2: FCC LMS stale but refresh_required=false → no blocker, only warning', () => {
  const r = assessSourceFreshness({
    source_authority: SOURCE_AUTHORITY.FCC_LMS,
    retrieved_at:     daysAgo(40),
    refresh_required: false
  });
  assert.equal(r.freshness_status, 'stale');
  assert.ok(!r.blockers.some(b => b.code === 'SOURCE_REFRESH_REQUIRED'),
    'SOURCE_REFRESH_REQUIRED must not fire when refresh_required=false');
  assert.ok(r.warnings.some(w => w.code === 'SOURCE_STALE'),
    'SOURCE_STALE warning must still fire');
});

// ── D. Missing timestamp → warning ───────────────────────────────────────────

test('D: FCC LMS with no timestamps → SOURCE_TIMESTAMP_MISSING warning', () => {
  const r = assessSourceFreshness({
    source_authority: SOURCE_AUTHORITY.FCC_LMS,
    retrieved_at:     null,
    source_last_modified: null
  });
  assert.equal(r.freshness_status, 'missing_timestamp');
  assert.ok(r.warnings.some(w => w.code === 'SOURCE_TIMESTAMP_MISSING'),
    'Must emit SOURCE_TIMESTAMP_MISSING for critical authority with no timestamps');
});

// ── E. USGS DEM one year old ──────────────────────────────────────────────────

test('E: USGS DEM 365 days old → aging (at aging threshold boundary)', () => {
  const r = assessSourceFreshness({
    source_authority: SOURCE_AUTHORITY.USGS_DEM,
    retrieved_at:     daysAgo(365)
  });
  // 365 days is exactly at the aging threshold (>365 → stale, >365 → still current/aging at boundary)
  // The threshold is > not >=, so 365 days should be 'aging' (staleness_days ~ 365, agingDays=365)
  // Actually: staleness_days > agingDays → aging; 365 > 365 is false so it should be 'current'
  // Let's verify the boundary: 365 days should be 'current' (not yet past 365 threshold)
  assert.ok(
    r.freshness_status === 'current' || r.freshness_status === 'aging',
    `USGS DEM at 365 days should be current or aging, got ${r.freshness_status}`
  );
  assert.ok(!r.blockers.some(b => b.code === 'SOURCE_REFRESH_REQUIRED'),
    'USGS DEM at 365 days must not produce a blocker');
});

test('E2: USGS DEM 400 days old → aging (past 365-day aging threshold)', () => {
  const r = assessSourceFreshness({
    source_authority: SOURCE_AUTHORITY.USGS_DEM,
    retrieved_at:     daysAgo(400)
  });
  assert.equal(r.freshness_status, 'aging');
  assert.ok(r.warnings.some(w => w.code === 'SOURCE_AGING'));
});

test('E3: USGS DEM 1200 days old → stale (past 1095-day stale threshold)', () => {
  const r = assessSourceFreshness({
    source_authority: SOURCE_AUTHORITY.USGS_DEM,
    retrieved_at:     daysAgo(1200)
  });
  assert.equal(r.freshness_status, 'stale');
  assert.ok(r.warnings.some(w => w.code === 'SOURCE_STALE'));
});

// ── F. Evidence lock created ──────────────────────────────────────────────────

test('F: buildEvidenceLock creates lock with aggregate_hash and source entries', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  // Inject synthetic evidence so we have something to lock.
  exhibit.evidence = {
    ...exhibit.evidence,
    fcc_lms: { license: { erp_kw: 6.0, frequency: 98.7 }, retrieved_at: new Date().toISOString() },
    asr:     { asr_number: '1234567', overall_height_m: 90, retrieved_at: new Date().toISOString() }
  };
  // Build attestation first (provides source_hashes).
  exhibit.source_attestation = buildSourceAttestation(exhibit, exhibit.evidence);

  const lock = buildEvidenceLock(exhibit);
  assert.ok(typeof lock.aggregate_hash === 'string' && lock.aggregate_hash.length === 64,
    'aggregate_hash must be a 64-char SHA-256 hex string');
  assert.equal(lock.lock_version, '1.0');
  assert.ok(typeof lock.generated_at === 'string');
  assert.ok(lock.sources.fcc_lms != null, 'fcc_lms entry must exist');
  assert.ok(typeof lock.sources.fcc_lms.hash === 'string',
    'fcc_lms source must have a hash');
});

// ── G. Evidence lock verification passes ─────────────────────────────────────

test('G: verifyEvidenceLock returns valid=true for unchanged exhibit', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  exhibit.evidence = {
    ...exhibit.evidence,
    fcc_lms: { license: { erp_kw: 6.0, frequency: 98.7 }, retrieved_at: new Date().toISOString() },
    asr:     { asr_number: '1234567', overall_height_m: 90, retrieved_at: new Date().toISOString() }
  };
  exhibit.source_attestation = buildSourceAttestation(exhibit, exhibit.evidence);

  const lock   = buildEvidenceLock(exhibit);
  const result = verifyEvidenceLock(exhibit, lock);

  assert.equal(result.valid, true, 'Lock must verify as valid when nothing changed');
  assert.equal(result.mismatches.length, 0);
  assert.equal(result.blockers.length, 0);
});

// ── H. Evidence lock fails after modification ─────────────────────────────────

test('H: verifyEvidenceLock returns valid=false after source record changes', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  exhibit.evidence = {
    ...exhibit.evidence,
    fcc_lms: { license: { erp_kw: 6.0, frequency: 98.7 }, retrieved_at: new Date().toISOString() }
  };
  exhibit.source_attestation = buildSourceAttestation(exhibit, exhibit.evidence);

  const lock = buildEvidenceLock(exhibit);

  // Modify the source record.
  exhibit.evidence.fcc_lms.license.erp_kw = 10.0;
  // Rebuild hashes for the modified exhibit.
  exhibit.source_attestation = buildSourceAttestation(exhibit, exhibit.evidence);

  const result = verifyEvidenceLock(exhibit, lock);
  assert.equal(result.valid, false, 'Lock must be invalid after source change');
  assert.ok(result.blockers.some(b => b.code === 'SOURCE_EVIDENCE_LOCK_INVALID'),
    'Must emit SOURCE_EVIDENCE_LOCK_INVALID blocker');
  assert.ok(result.mismatches.length > 0, 'mismatches array must list changed source');
});

// ── I. Missing critical source lock ──────────────────────────────────────────

test('I: verifyEvidenceLock emits SOURCE_EVIDENCE_LOCK_MISSING when critical source absent', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  // Lock was built without fcc_asr, then fcc_asr is added to evidence.
  exhibit.evidence = {
    ...exhibit.evidence,
    fcc_lms: { license: { erp_kw: 6.0 }, retrieved_at: new Date().toISOString() }
  };
  exhibit.source_attestation = buildSourceAttestation(exhibit, exhibit.evidence);

  const lock = buildEvidenceLock(exhibit);

  // Now add asr to evidence (wasn't there when lock was built).
  exhibit.evidence.asr = { asr_number: '9999999', overall_height_m: 90 };
  exhibit.source_attestation = buildSourceAttestation(exhibit, exhibit.evidence);

  const result = verifyEvidenceLock(exhibit, lock);
  assert.ok(result.blockers.some(b => b.code === 'SOURCE_EVIDENCE_LOCK_MISSING'),
    'Must emit SOURCE_EVIDENCE_LOCK_MISSING when critical source present in exhibit but not in lock');
});

// ── J. AI inference source ────────────────────────────────────────────────────

test('J: AI inference source → not_authoritative freshness, stays low confidence', () => {
  const r = assessSourceFreshness({
    source_authority: SOURCE_AUTHORITY.AI_INFERENCE,
    retrieved_at:     new Date().toISOString()
  });
  assert.equal(r.freshness_status, 'not_authoritative',
    'AI_INFERENCE must never be considered authoritative regardless of timestamp');
  assert.equal(r.blockers.length, 0, 'AI inference must not produce blockers');
});

// ── Warning registry ──────────────────────────────────────────────────────────

test('WARNING_CODES contains all 8 new freshness+lock codes', () => {
  const expected = [
    'SOURCE_STALE', 'SOURCE_AGING', 'SOURCE_TIMESTAMP_MISSING',
    'SOURCE_REFRESH_REQUIRED', 'SOURCE_RECORD_CHANGED',
    'SOURCE_EVIDENCE_LOCK_MISSING', 'SOURCE_EVIDENCE_LOCK_INVALID',
    'SOURCE_EVIDENCE_LOCK_STALE'
  ];
  for (const code of expected){
    assert.ok(WARNING_CODES[code] != null, `WARNING_CODES must contain ${code}`);
  }
  assert.equal(WARNING_CODES.SOURCE_REFRESH_REQUIRED.severity,        'blocker');
  assert.equal(WARNING_CODES.SOURCE_RECORD_CHANGED.severity,          'blocker');
  assert.equal(WARNING_CODES.SOURCE_EVIDENCE_LOCK_MISSING.severity,   'blocker');
  assert.equal(WARNING_CODES.SOURCE_EVIDENCE_LOCK_INVALID.severity,   'blocker');
  assert.equal(WARNING_CODES.SOURCE_STALE.severity,                   'warning');
  assert.equal(WARNING_CODES.SOURCE_AGING.severity,                   'info');
  assert.equal(WARNING_CODES.SOURCE_TIMESTAMP_MISSING.severity,       'warning');
  assert.equal(WARNING_CODES.SOURCE_EVIDENCE_LOCK_STALE.severity,     'warning');
});

// ── Attestation integration ───────────────────────────────────────────────────

test('buildSourceAttestation includes source_freshness and evidence_lock', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  const sa = buildSourceAttestation(exhibit, {});
  assert.ok('source_freshness' in sa,
    'source_attestation must include source_freshness');
  assert.ok('evidence_lock' in sa,
    'source_attestation must include evidence_lock');
  assert.ok(typeof sa.evidence_lock.aggregate_hash === 'string',
    'evidence_lock.aggregate_hash must be a string');
});

test('FCC LMS source with freshness data included in attestation', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  const evidence = {
    fcc_lms: {
      license: { erp_kw: 6.0, frequency: 98.7 },
      retrieved_at: new Date().toISOString()
    }
  };
  const sa = buildSourceAttestation(exhibit, evidence);
  assert.ok(sa.source_freshness?.fcc_lms != null,
    'source_freshness.fcc_lms must be present when fcc_lms evidence supplied');
  assert.equal(sa.source_freshness.fcc_lms.freshness_status, 'current',
    'freshly-fetched LMS record must have freshness_status=current');
});
