// Unit tests for the canonical AM regulatory rule modules
// (src/engine/am/canonical/rules/) — the single-source replacements for
// the divergent predicates catalogued in
// docs/architecture-contradiction-origins.md §§3–9.
//
// KAZM fixture: 780 kHz (a §73.25 clear channel), Class D, licensed NDA,
// no nighttime study run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CLEAR_CHANNEL_KHZ, LOCAL_CHANNEL_KHZ, isClearChannel, isLocalChannel, isRegionalChannel }
  from '../engine/am/canonical/rules/channelSets.js';
import { evaluateNighttimeInterferenceRequirement }
  from '../engine/am/canonical/rules/nighttimeInterference.js';
import { normalizeAntennaMode, resolveAntennaModes, isDirectionalMode }
  from '../engine/am/canonical/rules/antennaMode.js';
import { evaluateProofRequirement, PROOF_TYPES }
  from '../engine/am/canonical/rules/proofOfPerformance.js';
import { evaluateAsrFaa }
  from '../engine/am/canonical/rules/asrFaa.js';
import { evaluateRfExposure, MIN_PRACTICAL_FENCE_M }
  from '../engine/am/canonical/rules/rfExposure.js';
import { evaluateBlanket, fromPercent, formatFractionAsPercent, BLANKET_LIMIT_FRACTION }
  from '../engine/am/canonical/rules/blanket.js';
import { evaluateCurrentSiteRelationship }
  from '../engine/am/canonical/rules/currentSiteOverlap.js';
import { ANTENNA_MODES } from '../engine/am/canonical/types.js';

const KAZM = Object.freeze({
  frequency_khz: 780,
  fcc_class: 'D',
  pattern_mode: 'NDA',
  night_study_present: false,
  night_study_result: null,
});

// ── channelSets ───────────────────────────────────────────────────────

test('channelSets — 780 kHz is clear, 1240 kHz is local, 1450 in local set', () => {
  assert.equal(isClearChannel(780), true);
  assert.equal(isLocalChannel(780), false);
  assert.equal(isLocalChannel(1240), true);
  assert.equal(LOCAL_CHANNEL_KHZ.has(1450), true);
  assert.equal(CLEAR_CHANNEL_KHZ.has(780), true);
  assert.equal(isRegionalChannel(1490), false);   // local
  assert.equal(isRegionalChannel(1580), true);    // neither clear nor local
});

// ── nighttimeInterference ─────────────────────────────────────────────

test('NIF — KAZM (780 clear, class D, no study): required, NOT_RUN, NOT_EVALUATED, never NOT_REQUIRED/PASS', () => {
  const nif = evaluateNighttimeInterferenceRequirement(KAZM);
  assert.equal(nif.required, true);
  assert.equal(nif.completion, 'NOT_RUN');
  assert.equal(nif.result, 'NOT_EVALUATED');
  assert.notEqual(nif.state, 'NOT_REQUIRED');
  assert.notEqual(nif.state, 'PASS');
  assert.equal(nif.state, 'NOT_EVALUATED');
  assert.ok(nif.blockers.includes('Nighttime NIF study not completed'));
  // Clear-channel secondary: rationale must flag clear-channel complexity
  // and DA-N likelihood.
  assert.match(nif.rationale, /clear-channel/i);
  assert.match(nif.rationale, /DA-N/);
  assert.ok(nif.inputsUsed.length > 0);
  assert.ok(nif.ruleReferences.some((r) => r.includes('73.182')));
});

test('NIF — Class C on local channel is NOT_REQUIRED with §73.182(o)/§73.27 basis', () => {
  const nif = evaluateNighttimeInterferenceRequirement({
    frequency_khz: 1240, fcc_class: 'C', pattern_mode: 'NDA',
  });
  assert.equal(nif.required, false);
  assert.equal(nif.state, 'NOT_REQUIRED');
  assert.ok(nif.ruleReferences.some((r) => r.includes('73.182(o)')));
  assert.ok(nif.ruleReferences.some((r) => r.includes('73.27')));
  assert.match(nif.rationale, /local channel/i);
});

test('NIF — Class C on a REGIONAL channel is still required (predicate is class AND channel)', () => {
  const nif = evaluateNighttimeInterferenceRequirement({
    frequency_khz: 1580, fcc_class: 'C', pattern_mode: 'NDA',
  });
  assert.equal(nif.required, true);
  assert.equal(nif.state, 'NOT_EVALUATED');
});

test('NIF — study present maps solver verdict to result; state follows result', () => {
  const pass = evaluateNighttimeInterferenceRequirement({
    ...KAZM, night_study_present: true, night_study_result: 'PASS',
  });
  assert.equal(pass.completion, 'RUN');
  assert.equal(pass.result, 'PASS');
  assert.equal(pass.state, 'PASS');

  const fail = evaluateNighttimeInterferenceRequirement({
    ...KAZM, night_study_present: true, night_study_result: 'FAIL',
  });
  assert.equal(fail.result, 'FAIL');
  assert.equal(fail.state, 'FAIL');
});

test('NIF — never infers nighttime compliance from daytime screening (no study => no PASS, ever)', () => {
  for (const cls of ['A', 'B', 'D']) {
    for (const f of [780, 1580, 1030]) {
      const nif = evaluateNighttimeInterferenceRequirement({
        frequency_khz: f, fcc_class: cls, night_study_present: false,
      });
      assert.notEqual(nif.state, 'PASS', `class ${cls} @ ${f} kHz must not PASS without a study`);
      assert.equal(nif.result, 'NOT_EVALUATED');
    }
  }
});

// ── antennaMode ───────────────────────────────────────────────────────

test('antennaMode — normalizeAntennaMode maps all raw vocabularies to the canonical enum', () => {
  assert.equal(normalizeAntennaMode('NDA').mode, 'NDA');
  assert.equal(normalizeAntennaMode('ND').mode, 'NDA');
  assert.equal(normalizeAntennaMode('omni').mode, 'NDA');
  assert.equal(normalizeAntennaMode('DA-D').mode, 'DA_DAY');
  assert.equal(normalizeAntennaMode('DA-N').mode, 'DA_NIGHT');
  assert.equal(normalizeAntennaMode('DA-2').mode, 'DA_DAY_AND_NIGHT');
  assert.equal(normalizeAntennaMode('DA').mode, 'DA_DAY_AND_NIGHT');
  const unk = normalizeAntennaMode('DA-3');
  assert.equal(unk.mode, null);
  assert.match(unk.warning, /unrecognized/i);
  assert.equal(isDirectionalMode(ANTENNA_MODES.DA_NIGHT), true);
  assert.equal(isDirectionalMode(ANTENNA_MODES.NDA), false);
});

test('antennaMode — KAZM: required DA_NIGHT (WARN, likelihood), modeled NDA, filingReady false', () => {
  const r = resolveAntennaModes({
    licensedMode: 'NDA',
    screeningAssumptionMode: 'NDA',
    frequency_khz: 780,
    fcc_class: 'D',
  });
  assert.equal(r.patternModeLicensed.value, 'NDA');
  assert.equal(r.patternModeModeled.value, 'NDA');
  assert.equal(r.patternModeRequired.mode, 'DA_NIGHT');
  assert.equal(r.patternModeRequired.decision.state, 'WARN');
  // Likelihood, not a hard fact:
  assert.notEqual(r.patternModeRequired.decision.required, true);
  assert.match(r.patternModeRequired.decision.rationale, /likel/i);
  assert.equal(r.filingImpact.filingReady, false);
  assert.ok(r.filingImpact.blockers.includes(
    'Directional pattern required but not synthesized (NDA proxy modeled)'));
});

test('antennaMode — Class A on clear channel is not a clear-channel secondary (no DA_NIGHT forcing)', () => {
  const r = resolveAntennaModes({
    licensedMode: 'NDA', screeningAssumptionMode: 'NDA',
    frequency_khz: 780, fcc_class: 'A',
  });
  assert.notEqual(r.patternModeRequired.mode, 'DA_NIGHT');
  assert.equal(r.filingImpact.filingReady, true);
});

test('antennaMode — missing screening assumption defaults modeled to the NDA proxy with a stated assumption', () => {
  const r = resolveAntennaModes({
    licensedMode: 'DA-2', screeningAssumptionMode: null,
    frequency_khz: 1580, fcc_class: 'B',
  });
  assert.equal(r.patternModeModeled.value, 'NDA');
  assert.ok(r.patternModeModeled.assumptions.some((a) => /NDA proxy/.test(a)));
});

// ── proofOfPerformance ────────────────────────────────────────────────

test('proof — modeled NDA with required DA_NIGHT: NDA_FIELD_PROOF, 8 radials, DA blocker noted', () => {
  const p = evaluateProofRequirement({
    patternModeModeled: 'NDA',
    patternModeRequired: 'DA_NIGHT',
  });
  assert.equal(p.proofType, PROOF_TYPES.NDA_FIELD_PROOF);
  assert.equal(p.radialCount, 6);   // §73.186(a)(1): six or more radials (regulatory minimum)
  assert.equal(p.monitorPointsRequired, false);
  assert.equal(p.constructionProofRequired, true);
  assert.ok(p.form302Exhibits.some((x) => /302-AM/.test(x)));
  assert.ok(p.decision.blockers.some((b) => b.includes('DA_FULL_PROOF')),
    'blocker must state the filing design will need DA_FULL_PROOF');
  assert.match(p.rationale, /DA_FULL_PROOF/);
});

test('proof — modeled DA: DA_FULL_PROOF, 6-12 radials per §73.151(a), monitor points, MoM alternative in rationale only', () => {
  const p = evaluateProofRequirement({ patternModeModeled: 'DA_DAY_AND_NIGHT' });
  assert.equal(p.proofType, PROOF_TYPES.DA_FULL_PROOF);
  assert.equal(p.radialCount, 6);   // §73.151(a) minimum (6 simple / up to 12 complex)
  assert.equal(p.monitorPointsRequired, true);
  assert.match(p.rationale, /73\.151\(c\)/);
  assert.match(p.rationale, /moment-method|MoM/i);
  assert.notEqual(p.proofType, PROOF_TYPES.MOM_PROOF, 'MoM is an alternative, never auto-selected');
});

test('proof — accepts EngineeringValue-shaped inputs and refuses to guess on unknown mode', () => {
  const viaEv = evaluateProofRequirement({
    patternModeModeled: { value: 'NDA' },
    patternModeRequired: { mode: 'DA_NIGHT' },
  });
  assert.equal(viaEv.proofType, PROOF_TYPES.NDA_FIELD_PROOF);

  const unk = evaluateProofRequirement({ patternModeModeled: 'DA-3' });
  assert.equal(unk.proofType, PROOF_TYPES.UNKNOWN);
  assert.equal(unk.constructionProofRequired, null);
  assert.equal(unk.decision.state, 'UNKNOWN');
});

// ── asrFaa ────────────────────────────────────────────────────────────

test('asrFaa — single height input: > 60.96 m trips ASR and FAA 7460-1', () => {
  const r = evaluateAsrFaa({ selectedDesignHeightM: 75 });
  assert.equal(r.asr.required, true);
  assert.equal(r.faaNotice.required, true);
  assert.equal(r.heightUsedM, 75);
  assert.equal(r.thresholdM, 60.96);
  // Exactly ONE height in inputsUsed (plus the airport prong record):
  const heights = r.asr.inputsUsed.filter((i) => i.unit === 'm');
  assert.equal(heights.length, 1, 'exactly one height input recorded');
  assert.equal(heights[0].value, 75);
});

test('asrFaa — strictly-greater comparator: exactly 60.96 m does NOT trip the height prong', () => {
  const r = evaluateAsrFaa({ selectedDesignHeightM: 60.96, nearAirportTrigger: false });
  assert.equal(r.asr.required, false);
  assert.equal(r.asr.state, 'NOT_REQUIRED');
  assert.equal(r.faaNotice.required, false);
});

test('asrFaa — short tower with UNKNOWN airport prong is UNKNOWN, not NOT_REQUIRED', () => {
  const r = evaluateAsrFaa({ selectedDesignHeightM: 45 });
  assert.equal(r.asr.state, 'UNKNOWN');
  assert.equal(r.asr.required, null);
  assert.equal(r.faaNotice.state, 'UNKNOWN');
  assert.ok(r.asr.blockers.length > 0);
});

test('asrFaa — airport prong alone (short tower) trips both decisions', () => {
  const r = evaluateAsrFaa({ selectedDesignHeightM: 45, nearAirportTrigger: true });
  assert.equal(r.asr.required, true);
  assert.equal(r.faaNotice.required, true);
});

// ── rfExposure ────────────────────────────────────────────────────────

test('rfExposure — four distinct labeled distances; λ/2π is never the fence', () => {
  const r = evaluateRfExposure({ frequency_khz: 780, tpo_kw: 5 });

  // All four present with label + method fields.
  for (const key of ['reactiveNearFieldBoundaryM', 'controlledMpeBoundaryM',
    'uncontrolledMpeBoundaryM', 'recommendedFenceDistanceM']) {
    assert.ok(r[key], `${key} present`);
    assert.equal(typeof r[key].label, 'string');
    assert.equal(typeof r[key].method, 'string');
    assert.equal(typeof r[key].value_m, 'number');
  }

  // Reactive near-field is explicitly labeled NOT a fence, method lambda/2pi.
  assert.match(r.reactiveNearFieldBoundaryM.label, /NOT a fence/);
  assert.equal(r.reactiveNearFieldBoundaryM.method, 'lambda/2pi');

  // The fence's method must never be lambda/2pi.
  assert.notEqual(r.recommendedFenceDistanceM.method, 'lambda/2pi');
  assert.match(r.recommendedFenceDistanceM.method, /OET-65/);

  // Fence = uncontrolled MPE distance (>= 3 m practical minimum).
  assert.ok(r.recommendedFenceDistanceM.value_m >=
    Math.min(r.uncontrolledMpeBoundaryM.value_m, MIN_PRACTICAL_FENCE_M));
  assert.equal(r.recommendedFenceDistanceM.value_m,
    Math.max(r.uncontrolledMpeBoundaryM.value_m, MIN_PRACTICAL_FENCE_M));

  // Controlled and uncontrolled boundaries are distinct values with
  // distinct labels (uncontrolled MPE is stricter → larger distance).
  assert.ok(r.uncontrolledMpeBoundaryM.value_m >= r.controlledMpeBoundaryM.value_m);
  assert.notEqual(r.controlledMpeBoundaryM.label, r.uncontrolledMpeBoundaryM.label);

  // λ/2π at 780 kHz ≈ 61.2 m — sanity-check the physics.
  assert.ok(Math.abs(r.reactiveNearFieldBoundaryM.value_m - 61.17) < 1);
});

test('rfExposure — > 1 kW requires routine evaluation; ≤ 1 kW is WARN "exemption criteria must be verified"', () => {
  const big = evaluateRfExposure({ frequency_khz: 780, tpo_kw: 5 });
  assert.equal(big.evaluationRequired.required, true);
  assert.match(big.evaluationRequired.rationale, /1\.1307\(a\)\(4\)/);

  const small = evaluateRfExposure({ frequency_khz: 1240, tpo_kw: 1 });
  assert.equal(small.evaluationRequired.state, 'WARN');
  assert.notEqual(small.evaluationRequired.required, true);
  assert.ok(small.evaluationRequired.blockers.some((b) => /exemption criteria must be verified/.test(b)));
});

// ── blanket ───────────────────────────────────────────────────────────

test('blanket — canonical fraction unit: 0.01 formats to 1%, fromPercent(1) === 0.01', () => {
  assert.equal(formatFractionAsPercent(0.01), '1%');
  assert.equal(formatFractionAsPercent(BLANKET_LIMIT_FRACTION), '1%');
  assert.equal(fromPercent(1), 0.01);
  assert.equal(fromPercent(60), 0.6);
});

test('blanket — fraction guards: values > 1 (percent leakage) are rejected', () => {
  assert.throws(() => evaluateBlanket({ populationFraction: 1.5, populationBasis: 'CENSUS_BLOCK' }), RangeError);
  assert.throws(() => evaluateBlanket({ populationFraction: 60, populationBasis: 'CENSUS_BLOCK' }), RangeError);
  assert.throws(() => evaluateBlanket({ populationFraction: -0.1, populationBasis: 'CENSUS_BLOCK' }), RangeError);
  assert.throws(() => formatFractionAsPercent(60), RangeError);
  assert.throws(() => fromPercent(101), RangeError);
});

test('blanket — verified basis yields PASS/FAIL against the single 0.01 limit', () => {
  const pass = evaluateBlanket({ populationFraction: 0.005, populationBasis: 'CENSUS_BLOCK' });
  assert.equal(pass.decision.state, 'PASS');
  assert.equal(pass.limitFraction, 0.01);

  const fail = evaluateBlanket({ populationFraction: 0.02, populationBasis: 'CENSUS_BLOCK' });
  assert.equal(fail.decision.state, 'FAIL');
});

test('blanket — proxy basis caps the state at WARN and names the proxy in the rationale', () => {
  const over = evaluateBlanket({
    populationFraction: 0.02,
    populationBasis: 'DENSITY_PROXY',
    methodNote: 'national-average density heuristic',
  });
  assert.equal(over.decision.state, 'WARN', 'a proxy cannot issue a verified FAIL');
  assert.match(over.decision.rationale, /DENSITY_PROXY/);
  assert.match(over.decision.rationale, /proxy/i);

  const under = evaluateBlanket({ populationFraction: 0.001, populationBasis: 'density heuristic' });
  assert.equal(under.decision.state, 'WARN', 'a proxy cannot issue a verified PASS either');
});

test('blanket — missing figure is NOT_EVALUATED with a blocker', () => {
  const r = evaluateBlanket({ populationBasis: 'CENSUS_BLOCK' });
  assert.equal(r.decision.state, 'NOT_EVALUATED');
  assert.ok(r.decision.blockers.length > 0);
});

// ── currentSiteOverlap ────────────────────────────────────────────────

test('currentSiteOverlap — returns transition-planning facts, never a spacing FAIL', () => {
  for (const d of [0.2, 5, 25, 100, null]) {
    const r = evaluateCurrentSiteRelationship({ distance_from_current_km: d });
    assert.notEqual(r.decision.state, 'FAIL', `own-site distance ${d} km must never FAIL`);
    assert.notEqual(r.decision.state, 'PASS', 'nor PASS — it is not a verdict at all');
    assert.equal(r.decision.state, 'WARN');
    assert.match(r.decision.rationale, /transition-planning/i);
    assert.match(r.decision.rationale, /NOT a spacing/i);
  }
});

test('currentSiteOverlap — close-in candidate flags STA coordination and shutdown sequencing', () => {
  const near = evaluateCurrentSiteRelationship({ distance_from_current_km: 0.3 });
  assert.equal(near.constructionOverlapRisk, 'HIGH');
  assert.equal(near.staCoordinationRequired, true);
  assert.equal(near.shutdownSequenceRequired, true);

  const far = evaluateCurrentSiteRelationship({ distance_from_current_km: 40 });
  assert.equal(far.constructionOverlapRisk, 'LOW');
  assert.equal(far.staCoordinationRequired, false);
});

test('currentSiteOverlap — externalSpacingStudy is explicitly NOT_EVALUATED with the study blocker', () => {
  const r = evaluateCurrentSiteRelationship({ distance_from_current_km: 12 });
  assert.equal(r.externalSpacingStudy.state, 'NOT_EVALUATED');
  assert.equal(r.externalSpacingStudy.completion, 'NOT_RUN');
  assert.ok(r.externalSpacingStudy.blockers.some((b) =>
    /spacing study against external licensed facilities not completed/.test(b)));
  assert.ok(r.externalSpacingStudy.ruleReferences.some((x) => x.includes('73.37')));
});

// ── cross-module KAZM pipeline coherence ─────────────────────────────

test('KAZM end-to-end coherence — modes flow from antennaMode into proofOfPerformance without contradiction', () => {
  const modes = resolveAntennaModes({
    licensedMode: KAZM.pattern_mode,
    screeningAssumptionMode: KAZM.pattern_mode,
    frequency_khz: KAZM.frequency_khz,
    fcc_class: KAZM.fcc_class,
  });
  const proof = evaluateProofRequirement({
    patternModeModeled: modes.patternModeModeled,
    patternModeRequired: modes.patternModeRequired.mode,
  });
  // Proof answers for the MODELED design (NDA), with the DA gap surfaced
  // as a blocker — never two contradictory proof verdicts.
  assert.equal(proof.proofType, PROOF_TYPES.NDA_FIELD_PROOF);
  assert.equal(proof.radialCount, 6);  // §73.186(a)(1) minimum
  assert.ok(proof.decision.blockers.length > 0);

  const nif = evaluateNighttimeInterferenceRequirement(KAZM);
  assert.equal(nif.required, true);
  assert.equal(nif.state, 'NOT_EVALUATED');
});
