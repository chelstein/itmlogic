// FCCAM / Wang 1985 NIF integration tests
//
// Covers the 7 scenarios from the FCCAM integration spec:
//   1. FCCAM configured → source='fccam-wang-1985', filing_grade=true
//   2. FCCAM fail → Berry fallback with FCCAM_UNAVAILABLE_BERRY_FALLBACK warning
//   3. FCCAM NIF fail → regulatory context: fails_current_rules / high risk
//   4. Berry NIF fail → regulatory context: medium-risk advisory
//   5. Report text shows 'FCCAM' when FCCAM ran
//   6. Report text shows Berry fallback framing when FCCAM was unavailable
//   7. Sidecar timeout does not throw / crash compute path
//
// Deliberately does NOT require a live sidecar — all skywave clients are stubs.

import { test }  from 'node:test';
import assert    from 'node:assert/strict';

import { nighttimeNifStudy, normalizePrimary } from '../engine/am/nightOrchestrator.js';
import { classifyRegulatoryContext }           from '../engine/regulatory/context.js';
import { W }                                   from '../types/warnings.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const PROPOSED = {
  lat:       33.6,
  lon:       -96.6,
  freq_khz:  1270,
  erp_kw:    2.5,
  fcc_class: 'D'
};

// Minimal nearby primary that passes normalizePrimary()
const NEARBY_ROW = {
  facility_id: '99999',
  call:        'WXYZ',
  fcc_class:   'C',
  lat:         34.0,
  lon:         -96.0,
  frequency_khz: 1270,
  erp_kw:      5,
  channel_relationship: 'co_channel',
  distance_km: 50
};

// Stub facilityClient — returns one nearby primary
function makeFacilityClient(){
  return {
    async getNearbyPrimaries(){
      return { available: true, primaries: [NEARBY_ROW], source: 'fcc-amq' };
    }
  };
}

// Build a stub skywave client that returns canned contour results.
// engine should be 'fccam-wang-1985' or 'berry-1968-screening'.
//
// runBatch receives an array of { erp_kw, freq_khz, distance_km, ... } requests.
// We differentiate subject vs interferer by erp_kw: proposed=2.5 kW, interferer=5 kW.
// Class D co-channel D/U = 20 dB (×10).  To ensure inner bracket passes:
//   subject field > interferer_rss × 10 → use subject=100000, interferer=0.01 µV/m
// To ensure inner bracket fails (NIF violating, for fail=true):
//   subject field < interferer_rss × 10 → use subject=0.01, interferer=100000
function makeSkywaveStub({ engine = 'fccam-wang-1985', fail = false, rejectWith = null } = {}){
  const isBerry = /berry/i.test(engine);
  return {
    isFallback: isBerry,
    async version(){ return { available: true, engine, source: engine }; },
    async runBatch(reqs){
      if (rejectWith) throw rejectWith;
      const results = (reqs || []).map((req) => {
        // Proposed station has erp_kw=2.5; interferers have erp_kw=5.
        // 'fail' inverts which side is strong so NIF always fails.
        const isProposed = Number(req.erp_kw) <= 2.5;
        const field_uv_m = fail
          ? (isProposed ? 0.01 : 100000)
          : (isProposed ? 100000 : 0.01);
        return { ok: true, field_uv_m, source: engine };
      });
      return { available: true, results, engine, source: engine };
    }
  };
}

// The contour solver is expensive in a real run.  For unit tests we only
// need to verify the orchestrator's wiring.  We make the interferers list
// empty to skip the per-azimuth bisection (with zero interferers the NIF
// radius is always the full skywave distance — all azimuths pass).
// For fail scenarios we use a dedicated stub that returns failing fields.

// ---------------------------------------------------------------------------
// 1. FCCAM configured → filing_grade=true, source='fccam-wang-1985'
// ---------------------------------------------------------------------------

test('scenario 1: FCCAM configured → filing_grade=true, source=fccam-wang-1985', async () => {
  const fccamStub = makeSkywaveStub({ engine: 'fccam-wang-1985' });
  const berryStub = makeSkywaveStub({ engine: 'berry-1968-screening' });

  const result = await nighttimeNifStudy(
    { proposed: PROPOSED, options: { azimuths_deg: [0, 90, 180, 270] } },
    { fccamClient: fccamStub, berryClient: berryStub, facilityClient: makeFacilityClient() }
  );

  assert.equal(result.available,      true,              'study should be available');
  assert.equal(result.filing_grade,   true,              'FCCAM run → filing_grade=true');
  assert.equal(result.source,         'fccam-wang-1985', 'source should be fccam-wang-1985');
  assert.equal(result.skywave_engine, 'FCCAM_WANG_1985', 'skywave_engine canonical ID');
  assert.equal(result.fccam_fallback_used, false,        'no fallback');
  assert.match(result.provenance.upstream_skywave, /Wang 1985|FCCAM/i,
    'provenance should mention FCCAM Wang');
  assert.ok(!/berry/i.test(result.provenance.upstream_skywave),
    'provenance must NOT say Berry when FCCAM ran');
});

// ---------------------------------------------------------------------------
// 2. FCCAM configured but fails → Berry fallback + FCCAM_UNAVAILABLE warning
// ---------------------------------------------------------------------------

test('scenario 2: FCCAM fails → Berry fallback, fccam_fallback_used=true', async () => {
  // FCCAM stub rejects version() → nifContour falls back to engineId='fccam' then runBatch will throw
  const failingFccamStub = {
    isFallback:   false,
    async version(){ throw new Error('sidecar_timeout'); },
    async runBatch(){ throw new Error('sidecar_timeout'); }
  };
  const berryStub = makeSkywaveStub({ engine: 'berry-1968-screening' });

  const result = await nighttimeNifStudy(
    { proposed: PROPOSED, options: { azimuths_deg: [0, 90, 180, 270] } },
    { fccamClient: failingFccamStub, berryClient: berryStub, facilityClient: makeFacilityClient() }
  );

  assert.equal(result.available,           true,   'Berry fallback should produce a result');
  assert.equal(result.filing_grade,        false,  'Berry fallback → filing_grade=false');
  assert.equal(result.fccam_fallback_used, true,   'fccam_fallback_used must be true');
  assert.match(result.source, /berry/i,            'source should contain berry');
  assert.equal(result.skywave_engine, 'BERRY_1968','skywave_engine canonical ID');
  assert.match(result.provenance.upstream_skywave, /Berry/i,
    'provenance should mention Berry when fallback ran');
});

test('scenario 2b: W.make(FCCAM_UNAVAILABLE_BERRY_FALLBACK) does not throw', () => {
  // Verify the warning code is defined in warnings.js
  assert.doesNotThrow(
    () => W.make('FCCAM_UNAVAILABLE_BERRY_FALLBACK', 'sidecar unreachable'),
    'FCCAM_UNAVAILABLE_BERRY_FALLBACK must be a registered warning code'
  );
  const w = W.make('FCCAM_UNAVAILABLE_BERRY_FALLBACK', 'sidecar unreachable');
  // Severity was upgraded to 'blocker' because Berry 1968 is screening-grade
  // (§73.190(c)) and cannot serve as filing-grade NIF evidence.
  assert.equal(w.severity, 'blocker');
  assert.equal(w.phase,    'sidecar');
});

// ---------------------------------------------------------------------------
// 3. FCCAM NIF fails → classifyRegulatoryContext: fails_current_rules / high risk
// ---------------------------------------------------------------------------

test('scenario 3: FCCAM NIF fail → fails_current_rules (proposed) / high risk', () => {
  const fccamNif = {
    available:      true,
    source:         'fccam-wang-1985',
    filing_grade:   true,
    skywave_engine: 'FCCAM_WANG_1985',
    provenance:     { upstream_skywave: 'FCCAM (Fccam.for / Wang 1985)' },
    summary:        { n_failing_azimuths: 12, worst_margin_db: -8.5, azimuths_evaluated: 36 }
  };

  // Proposed (not licensed)
  const r = classifyRegulatoryContext(
    { isProposal: true },
    { am_night_nif: fccamNif },
    { warnings: [], interference_study: { filing_qualifies: true },
      evidence: { am_night_nif: fccamNif } }
  );
  assert.equal(r.currentRuleCompliance, 'fails_current_rules',
    'FCCAM NIF fail for proposed should trigger fails_current_rules');
  assert.equal(r.licenseInterpretation, 'requires_engineering_review');
  assert.equal(r.filingRisk, 'high');
});

test('scenario 3b: FCCAM NIF fail for licensed → fails_current_rules / medium risk', () => {
  const fccamNif = {
    available:      true,
    source:         'fccam-wang-1985',
    filing_grade:   true,
    skywave_engine: 'FCCAM_WANG_1985',
    provenance:     { upstream_skywave: 'FCCAM (Fccam.for / Wang 1985)' },
    summary:        { n_failing_azimuths: 5, worst_margin_db: -4.2, azimuths_evaluated: 36 }
  };

  const r = classifyRegulatoryContext(
    { facility_id: '12345' },
    { fcc_lms: { status: 'LIC' }, am_night_nif: fccamNif },
    { warnings: [], interference_study: { filing_qualifies: true },
      evidence: { am_night_nif: fccamNif } }
  );
  assert.equal(r.currentRuleCompliance, 'fails_current_rules',
    'FCCAM NIF fail for licensed should trigger fails_current_rules');
  assert.equal(r.licenseInterpretation, 'licensed_with_legacy_conflicts');
  assert.equal(r.filingRisk, 'medium');
});

// ---------------------------------------------------------------------------
// 4. Berry NIF fail → medium-risk advisory, NOT fails_current_rules
// ---------------------------------------------------------------------------

test('scenario 4: Berry NIF fail → passes_current_rules, medium risk (advisory)', () => {
  const berryNif = {
    available:      true,
    source:         'berry-1968',
    filing_grade:   false,
    skywave_engine: 'BERRY_1968',
    provenance:     { upstream_skywave: 'Berry 1968 analytical (screening-grade per §73.190(c))' },
    summary:        { n_failing_azimuths: 5, worst_margin_db: -6.1, azimuths_evaluated: 36 }
  };

  const r = classifyRegulatoryContext(
    { isProposal: true },
    { am_night_nif: berryNif },
    { warnings: [], interference_study: { filing_qualifies: true },
      evidence: { am_night_nif: berryNif } }
  );
  assert.equal(r.currentRuleCompliance, 'passes_current_rules',
    'Berry screening fail must NOT trigger fails_current_rules');
  assert.equal(r.filingRisk, 'medium',
    'Berry NIF failure should raise risk to medium');
});

// ---------------------------------------------------------------------------
// 5. Report text shows 'FCCAM' when FCCAM ran
// ---------------------------------------------------------------------------

test('scenario 5: amNightNarrative uses FCCAM text when filing_grade=true', async () => {
  const { buildAmNightNarrative } = await import('../exports/engineeringReport/sections/amNightNarrative.js');
  const fccamNif = {
    available:      true,
    source:         'fccam-wang-1985',
    engine:         'fccam-wang-1985',
    filing_grade:   true,
    skywave_engine: 'FCCAM_WANG_1985',
    provenance:     { upstream_skywave: 'FCCAM (Fccam.for / Wang 1985)' },
    summary:        { n_failing_azimuths: 0, n_azimuths: 36, mean_radius_km: 350,
                      n_interferers_used: 3, n_interferers_seen: 3, interferer_cap: 25,
                      worst_margin_db: 2.1 },
    contour:        [],
    interferers:    [],
    regulation:     '47 CFR §73.182 / §73.183 / §73.190(c)'
  };
  const exhibit = {
    station_inputs: { ...PROPOSED, service: 'AM', frequency: PROPOSED.freq_khz },
    evidence:       { am_night_nif: fccamNif }
  };
  const section = buildAmNightNarrative(exhibit);
  const text = JSON.stringify(section);
  assert.ok(/FCCAM|Wang 1985/i.test(text), 'section should mention FCCAM / Wang 1985');
  assert.ok(!/SCREENING-grade/i.test(text), 'should NOT say SCREENING-grade when FCCAM ran');
});

// ---------------------------------------------------------------------------
// 6. Report text shows Berry fallback framing when filing_grade=false
// ---------------------------------------------------------------------------

test('scenario 6: amNightNarrative uses Berry/screening text when filing_grade=false', async () => {
  const { buildAmNightNarrative } = await import('../exports/engineeringReport/sections/amNightNarrative.js');
  const berryNif = {
    available:      true,
    source:         'berry-1968',
    engine:         'berry-1968',
    filing_grade:   false,
    skywave_engine: 'BERRY_1968',
    fccam_fallback_used: true,
    provenance:     { upstream_skywave: 'Berry 1968 analytical (screening-grade per §73.190(c))' },
    summary:        { n_failing_azimuths: 0, n_azimuths: 36, mean_radius_km: 300,
                      n_interferers_used: 3, n_interferers_seen: 3, interferer_cap: 25,
                      worst_margin_db: 1.0 },
    contour:        [],
    interferers:    [],
    regulation:     '47 CFR §73.182 / §73.183 / §73.190(c)'
  };
  const exhibit = {
    station_inputs: { ...PROPOSED, service: 'AM', frequency: PROPOSED.freq_khz },
    evidence:       { am_night_nif: berryNif }
  };
  const section = buildAmNightNarrative(exhibit);
  const text = JSON.stringify(section);
  assert.ok(/berry|screening/i.test(text), 'section should mention Berry or SCREENING');
});

// ---------------------------------------------------------------------------
// 7. Sidecar timeout does not crash — nighttimeNifStudy returns available:false
// ---------------------------------------------------------------------------

test('scenario 7: sidecar timeout returns available:false without throwing', async () => {
  const timeoutStub = {
    isFallback: false,
    async version(){ throw new Error('ETIMEDOUT'); },
    async runBatch(){ throw new Error('ETIMEDOUT'); }
  };
  // No berry fallback configured
  let result;
  await assert.doesNotReject(async () => {
    result = await nighttimeNifStudy(
      { proposed: PROPOSED, options: { azimuths_deg: [0, 90] } },
      { fccamClient: timeoutStub, berryClient: null, facilityClient: makeFacilityClient() }
    );
  }, 'sidecar timeout must not propagate as an exception');

  assert.equal(result?.available, false, 'result should be available:false on timeout');
  assert.ok(result?.error, 'result should carry an error description');
});

// ---------------------------------------------------------------------------
// 8. normalizePrimary: null lat/lon returns null (safety regression)
// ---------------------------------------------------------------------------

test('normalizePrimary: null lat/lon returns null', () => {
  assert.equal(normalizePrimary({ lat: null, lon: null, frequency_khz: 1270, erp_kw: 5 }), null);
  assert.equal(normalizePrimary({ lat: 33.6, lon: null, frequency_khz: 1270, erp_kw: 5 }), null);
  assert.equal(normalizePrimary(null), null);
});

test('normalizePrimary: valid row is normalized correctly', () => {
  const result = normalizePrimary(NEARBY_ROW);
  assert.ok(result, 'should return a result');
  assert.equal(result.freq_khz, 1270);
  assert.equal(result.erp_kw, 5);
  assert.equal(result.relation, 'co_channel');
});

// ---------------------------------------------------------------------------
// 9. filing_grade field is present and correct on orchestrator output
// ---------------------------------------------------------------------------

test('filing_grade=true present on FCCAM result', async () => {
  const stub = makeSkywaveStub({ engine: 'fccam-wang-1985' });
  const result = await nighttimeNifStudy(
    { proposed: PROPOSED, options: { azimuths_deg: [0, 90] } },
    { fccamClient: stub, berryClient: null, facilityClient: makeFacilityClient() }
  );
  assert.ok('filing_grade' in result, 'filing_grade field must be present');
  assert.equal(typeof result.filing_grade, 'boolean', 'filing_grade should be a boolean');
  assert.equal(result.filing_grade, true);
});

test('filing_grade=false present on Berry-only result', async () => {
  const stub = makeSkywaveStub({ engine: 'berry-1968-screening' });
  const result = await nighttimeNifStudy(
    { proposed: PROPOSED, options: { azimuths_deg: [0, 90] } },
    { fccamClient: null, berryClient: stub, facilityClient: makeFacilityClient() }
  );
  assert.ok('filing_grade' in result, 'filing_grade field must be present');
  assert.equal(result.filing_grade, false);
  assert.equal(result.skywave_engine, 'BERRY_1968');
});
