// End-to-end tests for the canonical candidate pipeline
// (src/engine/am/canonical/) against the KAZM fixture.
//
// Asserts the 12 required outcomes from the remediation plan
// (docs/architecture-contradiction-origins.md) plus overall invariant
// consistency and validator sensitivity on a deliberately corrupted
// variant.  Also unit-covers the new stages (antenna design, ground
// system, cost model, confidence axes, scoring, recommendation ladder).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCanonicalCandidateResult }
  from '../engine/am/canonical/buildCanonicalCandidateResult.js';
import { deriveAntennaDesign, HEIGHT_SELECTION_BASES }
  from '../engine/am/canonical/antennaDesign.js';
import { deriveGroundSystem, GROUND_SCENARIOS }
  from '../engine/am/canonical/groundSystem.js';
import { buildCostModel } from '../engine/am/canonical/costModel.js';
import { deriveConfidence } from '../engine/am/canonical/confidence.js';
import { deriveScoringContext, TIE_LABEL } from '../engine/am/canonical/scoring.js';
import { deriveRecommendation, GATE_LADDER, ladderRank }
  from '../engine/am/canonical/recommendation.js';
import { validateCandidateResult } from '../engine/am/canonical/validation.js';
import { RECOMMENDATION_LEVELS } from '../engine/am/canonical/types.js';
import { KAZM_BUILD_ARGS } from './fixtures/kazmCanonical.js';

// Frozen fixture in, plain object out — keeps tests free to tweak copies.
const build = () => buildCanonicalCandidateResult(JSON.parse(JSON.stringify(KAZM_BUILD_ARGS)));

const RESULT = build();

// ── (1) longitude renders W ───────────────────────────────────────────

test('outcome 1 — candidate longitude renders with W hemisphere, never E', () => {
  assert.equal(typeof RESULT.candidate.longitudeFormatted, 'string');
  assert.ok(RESULT.candidate.longitudeFormatted.includes('W'),
    `expected W hemisphere, got "${RESULT.candidate.longitudeFormatted}"`);
  assert.ok(!RESULT.candidate.longitudeFormatted.includes('E'));
  assert.match(RESULT.candidate.longitudeFormatted, /111\.8419° W/);
  assert.match(RESULT.station.longitudeFormatted, /111\.82° W/);
});

// ── (2) engineering data confidence is honest ─────────────────────────

test('outcome 2 — engineeringDataConfidence is LOW or SCREENING (screening σ, absent COL polygon)', () => {
  const tier = RESULT.confidence.engineeringDataConfidence.tier;
  assert.ok(['LOW', 'SCREENING'].includes(tier), `got ${tier}`);
  // COL polygon absent → colGeometry is the LOW-tier limiter.
  assert.equal(tier, 'LOW');
  assert.equal(RESULT.confidence.engineeringDataConfidence.limitedBy, 'colGeometry');
});

// ── (3) filing readiness false, night study among the blockers ───────

test('outcome 3 — filingReadiness.ready === false with a night-study blocker', () => {
  assert.equal(RESULT.filingReadiness.ready, false);
  assert.ok(RESULT.filingReadiness.blockers.length > 0);
  assert.ok(RESULT.filingReadiness.blockers.some((b) => /night/i.test(b)),
    `expected a nighttime-study blocker in: ${JSON.stringify(RESULT.filingReadiness.blockers)}`);
});

// ── (4) nighttime compliance is never asserted ─────────────────────────

test('outcome 4 — no assertion of nighttime compliance anywhere (nif NOT_EVALUATED)', () => {
  assert.equal(RESULT.regulatory.nif.state, 'NOT_EVALUATED');
  assert.equal(RESULT.regulatory.nif.result, 'NOT_EVALUATED');
  assert.equal(RESULT.regulatory.nif.completion, 'NOT_RUN');
  assert.notEqual(RESULT.regulatory.nif.state, 'PASS');
  // Nothing in the serialized result may CLAIM nighttime compliance.
  const s = JSON.stringify(RESULT);
  assert.doesNotMatch(s, /night(?:time)?[ -]compliant/i);
  assert.doesNotMatch(s,
    /night(?:time)? compliance (?:is )?(?:demonstrated|confirmed|shown|met|verified|assured)/i);
});

// ── (5) nif is not self-contradictory ─────────────────────────────────

test('outcome 5 — nif required === true and state !== NOT_REQUIRED (780 kHz clear channel, class D)', () => {
  assert.equal(RESULT.regulatory.nif.required, true);
  assert.notEqual(RESULT.regulatory.nif.state, 'NOT_REQUIRED');
});

// ── (6) one tower height everywhere ────────────────────────────────────

test('outcome 6 — exactly one selectedDesignHeightM; ASR and cost inputs carry the same number', () => {
  const h = RESULT.antenna.selectedDesignHeightM.value;
  assert.ok(Number.isFinite(h));
  // Class D default is 3/8λ = 0.375 × (300000/780) ≈ 144.23 m — never 5/8λ.
  assert.ok(Math.abs(h - 144.23) < 0.02, `expected ≈144.23 m (3/8λ), got ${h}`);
  assert.equal(RESULT.antenna.selectionBasis, HEIGHT_SELECTION_BASES.CLASS_TYPICAL_DEFAULT);
  assert.equal(RESULT.antenna.selectedDesignHeightM.confidence, 'SCREENING');
  assert.ok(RESULT.antenna.selectedDesignHeightM.assumptions.some((a) =>
    /NOT auto-selected for efficiency/.test(a)));

  // ASR decision evaluated exactly this height.
  assert.equal(RESULT.regulatory.asr.required, true); // 144 m > 60.96 m
  const asrHeightInput = RESULT.regulatory.asr.inputsUsed.find(
    (i) => i && i.unit === 'm' && Number.isFinite(i.value));
  assert.ok(asrHeightInput, 'ASR decision must carry its height input');
  assert.equal(asrHeightInput.value, h);
  assert.match(RESULT.regulatory.asr.rationale, new RegExp(h.toFixed(2).replace('.', '\\.')));

  // Cost model priced exactly this height.
  assert.equal(RESULT.costs.tower.inputs.towerHeightM.value, h);

  // The λ/4 and 5/8λ figures exist ONLY as labeled references.
  assert.ok(RESULT.antenna.quarterWaveReferenceM.assumptions.includes('reference only'));
  assert.ok(RESULT.antenna.fiveEighthsReferenceM.assumptions.includes('reference only'));
  assert.notEqual(RESULT.antenna.quarterWaveReferenceM.value, h);
  assert.notEqual(RESULT.antenna.fiveEighthsReferenceM.value, h);
});

// ── (7) one selected ground scenario drives costs ─────────────────────

test('outcome 7 — one SELECTED ground scenario; cost model consumed its radial count', () => {
  const scen = RESULT.groundSystem.selectedScenario;
  assert.equal(scen.role, 'SELECTED');
  assert.equal(scen.key, 'STANDARD_120');
  assert.equal(scen.radialCount, 120);
  assert.equal(RESULT.costs.groundSystem.inputs.radialCount.value, scen.radialCount);
  // Alternatives exist but are labeled and never feed costs.
  assert.ok(RESULT.groundSystem.scenarios.length >= 2);
  for (const alt of RESULT.groundSystem.scenarios) {
    assert.equal(alt.role, 'ALTERNATIVE');
  }
  // The ground-system cost line names the selected scenario.
  const gsComponent = RESULT.costs.components.find((c) => c.key === 'groundSystem');
  assert.equal(gsComponent.scenario, 'STANDARD_120');
});

// ── (8) one total that is the exact component sum ─────────────────────

test('outcome 8 — one totalProjectCapital equal to the exact component sum', () => {
  const comps = RESULT.costs.components;
  const sumLow = comps.reduce((s, c) => s + c.low, 0);
  const sumHigh = comps.reduce((s, c) => s + c.high, 0);
  assert.equal(RESULT.costs.total.low, sumLow);
  assert.equal(RESULT.costs.total.high, sumHigh);
  const tpc = RESULT.costs.subtotals.totalProjectCapital;
  assert.equal(tpc.lowUsd, sumLow);
  assert.equal(tpc.highUsd, sumHigh);
  assert.deepEqual([...tpc.componentKeys].sort(), comps.map((c) => c.key).sort());
  // Named subtotals each declare their component keys.
  for (const name of ['constructionOnly', 'softCostsOnly', 'antennaSystemOnly']) {
    const sub = RESULT.costs.subtotals[name];
    assert.ok(Array.isArray(sub.componentKeys) && sub.componentKeys.length > 0, name);
    const expected = sub.componentKeys
      .map((k) => comps.find((c) => c.key === k))
      .reduce((s, c) => s + c.lowUsd, 0);
    assert.equal(sub.lowUsd, expected, name);
  }
});

// ── (9) one RF-exposure interpretation ─────────────────────────────────

test('outcome 9 — fence distance is the OET-65 MPE result, never the λ/2π near-field boundary', () => {
  const rf = RESULT.rfExposure;
  assert.match(rf.reactiveNearFieldBoundaryM.label, /NOT a fence distance/);
  assert.equal(rf.reactiveNearFieldBoundaryM.method, 'lambda/2pi');
  assert.notEqual(rf.recommendedFenceDistanceM.method, 'lambda/2pi');
  assert.match(rf.recommendedFenceDistanceM.method, /OET-65/);
  // λ/2π at 780 kHz ≈ 61.2 m; the fence figure must be a different number
  // from a different method.
  assert.ok(Math.abs(rf.reactiveNearFieldBoundaryM.value_m - 61.2) < 0.5);
  assert.notEqual(rf.recommendedFenceDistanceM.value_m, rf.reactiveNearFieldBoundaryM.value_m);
});

// ── (10) own-site distance is transition planning, not a spacing FAIL ──

test('outcome 10 — currentSiteOverlap carries no spacing FAIL against the OWN site', () => {
  assert.notEqual(RESULT.regulatory.currentSiteTransition.state, 'FAIL');
  assert.equal(RESULT.regulatory.externalSpacingStudy.state, 'NOT_EVALUATED');
  assert.notEqual(RESULT.regulatory.externalSpacingStudy.state, 'FAIL');
  // ≈2.8 km from the current site → moderate transition-planning risk.
  assert.ok(RESULT.candidate.distance_from_current_km > 2.5);
  assert.ok(RESULT.candidate.distance_from_current_km < 3.2);
  assert.equal(RESULT.transition.constructionOverlapRisk, 'MODERATE');
});

// ── (11) ties are ties ─────────────────────────────────────────────────

test('outcome 11 — equal scores are tied within model precision and labeled as such', () => {
  assert.equal(RESULT.scoring.tiedWithinModelPrecision, true);
  assert.equal(RESULT.scoring.displayLabel, 'Tied at current screening resolution');
  assert.equal(RESULT.scoring.displayLabel, TIE_LABEL);
  assert.ok(RESULT.scoring.tieGroupSize >= 2);
  assert.doesNotMatch(RESULT.scoring.displayLabel, /superior/i);
  assert.notEqual(RESULT.scoring.materiallyBetterThanBaseline, true);
});

// ── (12) recommendation stays on the study-continuation rungs ─────────

test('outcome 12 — recommendation is at most ADVANCE_TO_DESK_STUDY (NIF absent, parcel data absent)', () => {
  const level = RESULT.recommendation.level;
  assert.ok(
    [RECOMMENDATION_LEVELS.SCREEN_FURTHER, RECOMMENDATION_LEVELS.ADVANCE_TO_DESK_STUDY].includes(level),
    `expected a study-continuation level, got ${level}`);
  assert.notEqual(level, RECOMMENDATION_LEVELS.ENGINEERING_READY);
  assert.notEqual(level, RECOMMENDATION_LEVELS.FILING_READY);
  assert.notEqual(level, RECOMMENDATION_LEVELS.REJECT);
  assert.ok(ladderRank(level) <= ladderRank(RECOMMENDATION_LEVELS.ADVANCE_TO_DESK_STUDY));
  // The pending-NIF gate must be among the applied gates.
  assert.ok(RESULT.recommendation.gatesApplied.some(
    (g) => g.gate === 'R:requiredDecisionsPending' && /nif/.test(g.reason)));
  // recommendations[] mirrors the single recommendation.
  assert.equal(RESULT.recommendations.length, 1);
  assert.equal(RESULT.recommendations[0].level, level);
});

// ── validation: fixture consistent; corrupted variant caught ──────────

test('KAZM fixture result passes all cross-field invariants', () => {
  assert.equal(RESULT.validation.consistent, true);
  assert.deepEqual(RESULT.validation.violations, []);
});

test('validator catches a deliberately corrupted variant (height fork + total drift + hemisphere flip)', () => {
  const corrupted = JSON.parse(JSON.stringify(RESULT));
  // Reintroduce three legacy contradiction classes:
  corrupted.costs.tower.inputs.towerHeightM.value =
    corrupted.antenna.quarterWaveReferenceM.value;          // (d) λ/4 fork
  corrupted.costs.total.low += 1000;                        // (c) total ≠ sum
  corrupted.candidate.longitudeFormatted = '111.8419° E';   // (g) hemisphere flip
  const report = validateCandidateResult(corrupted, { mode: 'production' });
  assert.equal(report.consistent, false);
  const ids = report.violations.map((v) => v.invariant);
  assert.ok(ids.some((i) => i.startsWith('d:')), `missing d — got ${ids}`);
  assert.ok(ids.some((i) => i.startsWith('c:')), `missing c — got ${ids}`);
  assert.ok(ids.some((i) => i.startsWith('g:')), `missing g — got ${ids}`);
  // And development mode refuses to render it at all.
  assert.throws(() => validateCandidateResult(corrupted, { mode: 'development' }),
    AggregateError);
});

// ── stage-level unit coverage ──────────────────────────────────────────

test('antennaDesign — requested height beats host height beats class default; 5/8λ never silently applied to C/D', () => {
  const base = { frequency_khz: 780, fcc_class: 'D' };
  const requested = deriveAntennaDesign({ ...base, requested_height_m: 100, host_structure_height_m: 80 });
  assert.equal(requested.selectionBasis, HEIGHT_SELECTION_BASES.REQUESTED_HEIGHT);
  assert.equal(requested.selectedDesignHeightM.value, 100);

  const host = deriveAntennaDesign({ ...base, host_structure_height_m: 80 });
  assert.equal(host.selectionBasis, HEIGHT_SELECTION_BASES.HOST_STRUCTURE);
  assert.equal(host.selectedDesignHeightM.value, 80);

  const classDefault = deriveAntennaDesign(base);
  assert.equal(classDefault.selectionBasis, HEIGHT_SELECTION_BASES.CLASS_TYPICAL_DEFAULT);
  assert.ok(Math.abs(classDefault.selectedDesignHeightM.value - 0.375 * (300000 / 780)) < 0.02);

  const classA = deriveAntennaDesign({ frequency_khz: 780, fcc_class: 'A' });
  assert.ok(Math.abs(classA.selectedDesignHeightM.value - 0.625 * (300000 / 780)) < 0.02);

  // Electrical height: 360·h/λ — 3/8λ ≡ 135°.
  assert.ok(Math.abs(classDefault.electricalHeightDeg.value - 135) < 0.1);
});

test('groundSystem — Terman loss matches the siteOptimizer formula; unknown scenario throws', () => {
  const gs = deriveGroundSystem({ frequency_khz: 780, sigma_msm: 2 });
  const scen = gs.selectedScenario;
  assert.equal(scen.radialCount, GROUND_SCENARIOS.STANDARD_120.radialCount);
  // R_g = min(30, 120·(1000/2)/(120·0.35λ)); 0.35λ = 134.62 m → 3.71 Ω
  const expected = Math.min(30, (120 * (1000 / 2)) / (120 * scen.radialLengthM));
  assert.ok(Math.abs(scen.groundLossOhm.value - expected) < 0.01);
  assert.match(gs.groundLossFormula, /Terman/);
  assert.equal(scen.wireLengthM, Math.round(120 * scen.radialLengthM * 100) / 100);
  // Efficiency is a SCREENING-grade fraction.
  assert.equal(gs.efficiencyEstimate.confidence, 'SCREENING');
  assert.ok(gs.efficiencyEstimate.value > 0 && gs.efficiencyEstimate.value < 1);
  assert.throws(() => deriveGroundSystem({ frequency_khz: 780, sigma_msm: 2, selectedScenarioKey: 'NOPE' }),
    RangeError);
});

test('costModel — refuses a missing TPO instead of silently defaulting', () => {
  const antennaDesign = deriveAntennaDesign({ frequency_khz: 780, fcc_class: 'D' });
  const groundSystem = deriveGroundSystem({ frequency_khz: 780, sigma_msm: 2 });
  assert.throws(() => buildCostModel({ antennaDesign, groundSystem }), TypeError);
});

test('confidence — a proxy layer can never raise rankingSignalQuality', () => {
  const base = {
    inputTiers: { conductivitySource: 'SCREENING', colGeometry: 'LOW', populationBasis: 'LOW' },
    regulatory: {},
    validation: { consistent: true, violations: [] },
  };
  const oneReal = deriveConfidence({
    ...base,
    rankingLayers: [{ name: 'coverage', isProxy: false, agreesWithTopChoice: true }],
  });
  const oneRealPlusProxies = deriveConfidence({
    ...base,
    rankingLayers: [
      { name: 'coverage', isProxy: false, agreesWithTopChoice: true },
      { name: 'proxyA', isProxy: true, agreesWithTopChoice: true },
      { name: 'proxyB', isProxy: true, agreesWithTopChoice: true },
      { name: 'proxyC', isProxy: true, agreesWithTopChoice: true },
    ],
  });
  assert.equal(oneReal.rankingSignalQuality.tier, oneRealPlusProxies.rankingSignalQuality.tier);
  assert.equal(oneRealPlusProxies.rankingSignalQuality.proxyLayerCount, 3);
  assert.equal(oneRealPlusProxies.rankingSignalQuality.independentLayerCount, 1);
});

test('scoring — a delta at or below the noise floor is never labeled better', () => {
  const s = deriveScoringContext({
    candidateScore: 64.9, baselineScore: 63.6,
    allScores: [64.9, 51.2], minimumMeaningfulDelta: 2,
  });
  assert.equal(s.materiallyBetterThanBaseline, false);
  assert.doesNotMatch(s.displayLabel, /above baseline/);
  assert.doesNotMatch(s.displayLabel, /superior/i);
  const clear = deriveScoringContext({
    candidateScore: 70, baselineScore: 63.6,
    allScores: [70, 51.2], minimumMeaningfulDelta: 2,
  });
  assert.equal(clear.materiallyBetterThanBaseline, true);
  assert.equal(clear.tiedWithinModelPrecision, false);
});

test('recommendation — inconsistent validation forces SCREEN_FURTHER with a technical warning', () => {
  const confidence = deriveConfidence({
    inputTiers: { conductivitySource: 'FILING_GRADE', colGeometry: 'FILING_GRADE', populationBasis: 'FILING_GRADE' },
    regulatory: {},
    validation: { consistent: false, violations: [{ invariant: 'c:test', fields: [], detail: 'x' }] },
  });
  const rec = deriveRecommendation({
    confidence,
    regulatory: {},
    scoring: null,
    validation: { consistent: false, violations: [{ invariant: 'c:test', fields: [], detail: 'x' }] },
  });
  assert.equal(rec.level, RECOMMENDATION_LEVELS.SCREEN_FURTHER);
  assert.ok(rec.technicalWarning);
  assert.match(rec.rationale, /inconsistent|invariant/i);
});

test('recommendation — REJECT fires only on a verified (RUN) hard FAIL', () => {
  const failDecision = {
    state: 'FAIL', required: true, completion: 'RUN', result: 'FAIL',
    ruleReferences: ['47 CFR §73.24(g)'], rationale: 'blanketing limit exceeded (census basis)',
    blockers: [], inputsUsed: [],
  };
  const notRunDecision = {
    state: 'NOT_EVALUATED', required: true, completion: 'NOT_RUN', result: 'NOT_EVALUATED',
    ruleReferences: [], rationale: 'study pending', blockers: ['pending'], inputsUsed: [],
  };
  const confidence = deriveConfidence({
    inputTiers: {}, regulatory: { blanket: failDecision },
    validation: { consistent: true, violations: [] },
  });
  const rejected = deriveRecommendation({
    confidence, regulatory: { blanket: failDecision },
    validation: { consistent: true, violations: [] },
  });
  assert.equal(rejected.level, RECOMMENDATION_LEVELS.REJECT);
  assert.match(rejected.rationale, /blanketing limit exceeded/);

  const pendingOnly = deriveRecommendation({
    confidence: deriveConfidence({
      inputTiers: {}, regulatory: { nif: notRunDecision },
      validation: { consistent: true, violations: [] },
    }),
    regulatory: { nif: notRunDecision },
    validation: { consistent: true, violations: [] },
  });
  assert.notEqual(pendingOnly.level, RECOMMENDATION_LEVELS.REJECT);
  assert.ok(ladderRank(pendingOnly.level) <= ladderRank(RECOMMENDATION_LEVELS.ADVANCE_TO_DESK_STUDY));
});

test('gate ladder is exported, ordered, and FILING_READY-terminated', () => {
  assert.equal(GATE_LADDER[0], RECOMMENDATION_LEVELS.SCREEN_FURTHER);
  assert.equal(GATE_LADDER[GATE_LADDER.length - 1], RECOMMENDATION_LEVELS.FILING_READY);
  assert.equal(ladderRank(RECOMMENDATION_LEVELS.REJECT), null);
});
