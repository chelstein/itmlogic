// Canonical AM pipeline core — types, formatters, invariant engine.
//
// Pins the remediation layer described in
// docs/architecture-contradiction-origins.md: strongly-typed enums and
// constructors (contradictions rejected at construction time), shared
// formatters (hemisphere, fraction-vs-percent, rounding-by-confidence),
// and the cross-field invariant validator that refuses to render
// internally inconsistent candidates.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIDENCE_TIERS,
  EVALUATION_STATES,
  COMPLETION_STATES,
  ANTENNA_MODES,
  RECOMMENDATION_LEVELS,
  ev,
  decision,
} from '../engine/am/canonical/types.js';

import {
  formatLatitude,
  formatLongitude,
  formatCoordinatePair,
  fractionToPercentString,
  percentToFraction,
  assertFraction,
  formatBlanketLimit,
  BLANKET_LIMIT_FRACTION,
  approx,
  approxString,
  costRangeString,
  scoreString,
} from '../engine/am/canonical/formatters.js';

import { validateCandidateResult } from '../engine/am/canonical/validation.js';

/* ════════════════════════ types.js ═══════════════════════════════════ */

test('enum objects are frozen and carry the exact canonical vocabulary', () => {
  for (const e of [CONFIDENCE_TIERS, EVALUATION_STATES, COMPLETION_STATES,
                   ANTENNA_MODES, RECOMMENDATION_LEVELS]) {
    assert.ok(Object.isFrozen(e));
  }
  assert.deepEqual(Object.keys(CONFIDENCE_TIERS).sort(),
    ['ENGINEERING_GRADE', 'FILING_GRADE', 'LOW', 'SCREENING']);
  assert.deepEqual(Object.keys(EVALUATION_STATES).sort(),
    ['FAIL', 'NOT_EVALUATED', 'NOT_REQUIRED', 'PASS', 'UNKNOWN', 'WARN']);
  assert.deepEqual(Object.keys(COMPLETION_STATES).sort(),
    ['NOT_RUN', 'PARTIAL', 'RUN']);
  assert.deepEqual(Object.keys(ANTENNA_MODES).sort(),
    ['DA_DAY', 'DA_DAY_AND_NIGHT', 'DA_NIGHT', 'NDA']);
  assert.deepEqual(Object.keys(RECOMMENDATION_LEVELS).sort(),
    ['ADVANCE_TO_DESK_STUDY', 'ADVANCE_TO_FIELD_VALIDATION',
     'ADVANCE_TO_PARCEL_NEGOTIATION', 'ENGINEERING_READY',
     'FILING_READY', 'REJECT', 'SCREEN_FURTHER']);
  // Each enum maps key === value so callers cannot typo.
  for (const [k, v] of Object.entries(RECOMMENDATION_LEVELS)) assert.equal(k, v);
  assert.throws(() => { CONFIDENCE_TIERS.BOGUS = 'BOGUS'; }, TypeError);
});

test('ev() builds a frozen EngineeringValue with full provenance', () => {
  const height = ev(95.2, {
    unit: 'm',
    source: 'antennaDesign.classHeightRule',
    confidence: CONFIDENCE_TIERS.ENGINEERING_GRADE,
    assumptions: ['5/8-wavelength class B design'],
  });
  assert.equal(height.value, 95.2);
  assert.equal(height.unit, 'm');
  assert.equal(height.source, 'antennaDesign.classHeightRule');
  assert.equal(height.confidence, 'ENGINEERING_GRADE');
  assert.deepEqual([...height.assumptions], ['5/8-wavelength class B design']);
  assert.equal(height.uncertainty, null);
  assert.ok(Object.isFrozen(height));
  assert.ok(Object.isFrozen(height.assumptions));
});

test('ev() applies defaults: unit null, assumptions [], uncertainty null', () => {
  const v = ev(1, { source: 's', confidence: 'SCREENING' });
  assert.equal(v.unit, null);
  assert.deepEqual([...v.assumptions], []);
  assert.equal(v.uncertainty, null);
});

test('ev() throws when source is missing or empty (provenance is mandatory)', () => {
  assert.throws(() => ev(1, { confidence: 'SCREENING' }), /source/);
  assert.throws(() => ev(1, { source: '', confidence: 'SCREENING' }), /source/);
  assert.throws(() => ev(1, { source: '   ', confidence: 'SCREENING' }), /source/);
});

test('ev() throws when confidence is missing or not a known tier', () => {
  assert.throws(() => ev(1, { source: 's' }), /confidence/);
  assert.throws(() => ev(1, { source: 's', confidence: null }), /confidence/);
  assert.throws(() => ev(1, { source: 's', confidence: 'MEDIUM' }), /ConfidenceTier/);
});

test('ev() throws without an options object at all', () => {
  assert.throws(() => ev(1), TypeError);
  assert.throws(() => ev(1, null), TypeError);
});

test('decision() builds a frozen RegulatoryDecision with defaults', () => {
  const d = decision({
    state: EVALUATION_STATES.NOT_EVALUATED,
    required: true,
    rationale: 'Class B non-local: nighttime interference-free study required',
    ruleReferences: ['§73.182(k)'],
    blockers: ['NIF solver not yet run'],
  });
  assert.equal(d.state, 'NOT_EVALUATED');
  assert.equal(d.required, true);
  assert.equal(d.completion, 'NOT_RUN');      // default
  assert.equal(d.result, 'NOT_EVALUATED');    // default
  assert.deepEqual([...d.ruleReferences], ['§73.182(k)']);
  assert.deepEqual([...d.blockers], ['NIF solver not yet run']);
  assert.deepEqual([...d.inputsUsed], []);
  assert.ok(Object.isFrozen(d));
  assert.ok(Object.isFrozen(d.blockers));
});

test('decision() throws on invalid state', () => {
  assert.throws(
    () => decision({ state: 'MAYBE', required: false, rationale: 'r' }),
    /EvaluationState/);
});

test('decision() throws when rationale is missing or empty', () => {
  assert.throws(() => decision({ state: 'PASS', required: true }), /rationale/);
  assert.throws(
    () => decision({ state: 'PASS', required: true, rationale: '' }), /rationale/);
});

test('decision() throws the contradiction required===true + state NOT_REQUIRED', () => {
  assert.throws(
    () => decision({
      state: 'NOT_REQUIRED',
      required: true,
      rationale: 'contradictory on purpose',
    }),
    /contradictory/);
});

test('decision() accepts required===false with state NOT_REQUIRED', () => {
  const d = decision({
    state: 'NOT_REQUIRED',
    required: false,
    completion: 'RUN',
    result: 'NOT_REQUIRED',
    rationale: 'Local channel class: no NIF study applies',
  });
  assert.equal(d.state, 'NOT_REQUIRED');
  assert.equal(d.required, false);
});

test('decision() validates completion, result, and required types', () => {
  const base = { state: 'PASS', required: true, rationale: 'r' };
  assert.throws(() => decision({ ...base, completion: 'DONE' }), /CompletionState/);
  assert.throws(() => decision({ ...base, result: 'OK' }), /EvaluationState/);
  assert.throws(() => decision({ ...base, required: 'yes' }), /required/);
  // null required (unknown) is allowed, and omitted required normalizes to null.
  assert.equal(decision({ ...base, required: null }).required, null);
  assert.equal(decision({ state: 'PASS', rationale: 'r' }).required, null);
});

/* ═════════════════════ formatters.js — coordinates ═══════════════════ */

test('formatLongitude(-111.82) renders the western hemisphere exactly', () => {
  const s = formatLongitude(-111.82);
  assert.equal(s, '111.82° W');
  assert.ok(s.includes('W'));
  assert.ok(!s.includes('E'));
});

test('formatLongitude positive renders E; zero renders E', () => {
  assert.equal(formatLongitude(2.3522), '2.3522° E');
  assert.ok(formatLongitude(151.2)?.endsWith('E'));
  assert.ok(formatLongitude(0)?.endsWith('E'));
});

test('formatLatitude renders N for positive, S for negative', () => {
  assert.equal(formatLatitude(40.7562), '40.7562° N');
  assert.equal(formatLatitude(-33.8688), '33.8688° S');
});

test('coordinate formatters are null-safe', () => {
  for (const bad of [null, undefined, NaN, Infinity, 'x']) {
    assert.equal(formatLatitude(bad), null);
    assert.equal(formatLongitude(bad), null);
  }
  assert.equal(formatCoordinatePair(null, -111.82), null);
  assert.equal(formatCoordinatePair(40.5, undefined), null);
});

test('coordinate precision defaults to 4 with sensible trailing-zero trim', () => {
  assert.equal(formatLatitude(40.5), '40.5° N');          // not 40.5000
  assert.equal(formatLongitude(-111.82005), '111.82° W'); // rounds then trims
  assert.equal(formatLongitude(-111.825555, 2), '111.83° W');
  assert.equal(formatLatitude(-7, 4), '7° S');
});

test('formatCoordinatePair combines both hemispheres', () => {
  assert.equal(
    formatCoordinatePair(40.7562, -111.82),
    '40.7562° N, 111.82° W');
});

/* ═══════════════ formatters.js — fraction/percent canon ══════════════ */

test('fractionToPercentString(0.01) is "1.0%" — never "0.01%" or "100%"', () => {
  const s = fractionToPercentString(0.01);
  assert.equal(s, '1.0%');
  assert.notEqual(s, '0.01%');
  assert.notEqual(s, '100%');
  assert.equal(fractionToPercentString(0.6), '60.0%');
  assert.equal(fractionToPercentString(0.0123, 2), '1.23%');
  assert.equal(fractionToPercentString(null), null);
});

test('percentToFraction inverts to the canonical fraction unit', () => {
  assert.equal(percentToFraction(1), 0.01);
  assert.equal(percentToFraction(60), 0.6);
  assert.equal(percentToFraction(null), null);
  assert.equal(percentToFraction(undefined), null);
});

test('assertFraction accepts [0,1] and null, throws on percent leaks', () => {
  assert.equal(assertFraction(0), 0);
  assert.equal(assertFraction(1), 1);
  assert.equal(assertFraction(0.01), 0.01);
  assert.equal(assertFraction(null), null);
  assert.equal(assertFraction(undefined), undefined);
  assert.throws(() => assertFraction(60, 'blanketPopulation'), /blanketPopulation/);
  assert.throws(() => assertFraction(1.5), RangeError);
  assert.throws(() => assertFraction(-0.1), RangeError);
  assert.throws(() => assertFraction(NaN), RangeError);
});

test('formatBlanketLimit derives "1%" from the canonical 0.01 fraction', () => {
  assert.equal(BLANKET_LIMIT_FRACTION, 0.01);
  assert.equal(formatBlanketLimit(), '1%');
});

/* ═══════════════ formatters.js — rounding by confidence ══════════════ */

test('approx coarsens SCREENING/LOW to 3 significant figures', () => {
  assert.equal(approx(319482, 'SCREENING'), 319000);
  assert.equal(approx(319482, 'LOW'), 319000);
  assert.equal(approx(986, 'SCREENING'), 986);
  assert.equal(approx(0, 'SCREENING'), 0);
  assert.equal(approx(null, 'SCREENING'), null);
});

test('approx keeps full precision for FILING_GRADE / ENGINEERING_GRADE', () => {
  assert.equal(approx(319482, 'FILING_GRADE'), 319482);
  assert.equal(approx(319482, 'ENGINEERING_GRADE'), 319482);
});

test('approxString marks coarse tiers with the approx sign', () => {
  assert.equal(approxString(319482, 'SCREENING'), '≈319,000');
  assert.equal(approxString(319482, 'LOW'), '≈319,000');
  assert.equal(approxString(319482, 'FILING_GRADE'), '319,482');
  assert.equal(approxString(319482, 'ENGINEERING_GRADE'), '319,482');
  assert.equal(approxString(null, 'SCREENING'), null);
});

test('costRangeString coarsens screening dollars to 2 sig figs with K/M', () => {
  assert.equal(costRangeString(541511, 988581, 'SCREENING'), '$540K–$990K');
  assert.equal(costRangeString(541511, 988581, 'LOW'), '$540K–$990K');
  assert.equal(costRangeString(1234567, 2765432, 'SCREENING'), '$1.2M–$2.8M');
});

test('costRangeString keeps exact figures at filing/engineering grade', () => {
  assert.equal(costRangeString(541511, 988581, 'FILING_GRADE'),
    '$541,511–$988,581');
  assert.equal(costRangeString(541511, 988581, 'ENGINEERING_GRADE'),
    '$541,511–$988,581');
});

test('costRangeString is null-safe on either bound', () => {
  assert.equal(costRangeString(null, 988581, 'SCREENING'), null);
  assert.equal(costRangeString(541511, undefined, 'FILING_GRADE'), null);
  assert.equal(costRangeString(NaN, 1, 'SCREENING'), null);
});

test('scoreString renders integer score with integer band', () => {
  assert.equal(scoreString(63.6, 27), '64 ± 27');
  assert.equal(scoreString(63.6, 26.7), '64 ± 27');
  assert.equal(scoreString(63.6), '64');
  assert.equal(scoreString(63.6, null), '64');
  assert.equal(scoreString(null, 27), null);
});

/* ═════════════════════ validation.js — invariant engine ══════════════ */

// Minimal internally-consistent fixture that exercises every invariant.
function consistentResult() {
  return {
    candidate: { longitude: -111.82, longitudeFormatted: '111.82° W' },
    regulatory: {
      nif: { state: 'NOT_EVALUATED', required: true, completion: 'RUN',
             rationale: 'r', source: 'rules.nif' },
      asr: {
        state: 'PASS', required: true, completion: 'RUN', rationale: 'r',
        inputsUsed: [{ name: 'towerHeightM', value: 95.2, source: 'facts.height' }],
      },
    },
    antenna: {
      patternModeModeled: { value: 'NDA', source: 'antennaDesign' },
      selectedDesignHeightM: { value: 95.2, source: 'antennaDesign' },
    },
    proof: { proofType: { value: 'NDA_PROOF', source: 'proofPlanner' } },
    costs: {
      total: { low: 300, high: 700 },
      components: [
        { low: 100, high: 200, source: 'costs.tower' },
        { low: 200, high: 500, source: 'costs.groundSystem' },
      ],
      tower: { inputs: { towerHeightM: { value: 95.2, source: 'costs.tower' } } },
      groundSystem: { inputs: { radialCount: 120 } },
    },
    groundSystem: { selectedScenario: { radialCount: 120 } },
    blanket: { populationFraction: { value: 0.006, source: 'blanketModel' } },
    filingReadiness: { ready: false },
    recommendations: [{ level: 'ADVANCE_TO_DESK_STUDY' }],
  };
}

test('a fully consistent candidate validates clean', () => {
  const report = validateCandidateResult(consistentResult());
  assert.deepEqual(report, { consistent: true, violations: [] });
});

test('null-tolerance: an empty result object is consistent (nothing to contradict)', () => {
  assert.equal(validateCandidateResult({}).consistent, true);
  // Sparse modules and NOT_EVALUATED states never false-positive.
  const sparse = {
    regulatory: { nif: { state: 'NOT_EVALUATED', required: null } },
    antenna: {},
    costs: { total: { low: 5 } },          // no components → skip (c)
    blanket: { populationFraction: null }, // absent → skip (f)
  };
  assert.equal(validateCandidateResult(sparse).consistent, true);
});

test('invariant (a): NIF required===true with state NOT_REQUIRED is a violation', () => {
  const r = consistentResult();
  r.regulatory.nif = { state: 'NOT_REQUIRED', required: true, source: 'guide.nif.v3' };
  const report = validateCandidateResult(r);
  assert.equal(report.consistent, false);
  const v = report.violations.find((x) => x.invariant.startsWith('a:'));
  assert.ok(v);
  assert.ok(v.fields.some((f) => f.includes('regulatory.nif.required')));
  assert.ok(v.fields.some((f) => f.includes('NOT_REQUIRED')));
  assert.match(v.detail, /guide\.nif\.v3/); // names the source module
});

test('invariant (a): required===false with NOT_REQUIRED does not trip', () => {
  const r = consistentResult();
  r.regulatory.nif = { state: 'NOT_REQUIRED', required: false };
  assert.equal(validateCandidateResult(r).consistent, true);
});

test('invariant (b): NDA pattern with DA_FULL_PROOF is a violation', () => {
  const r = consistentResult();
  r.proof.proofType = { value: 'DA_FULL_PROOF', source: 'guide.proof.v1' };
  const report = validateCandidateResult(r);
  const v = report.violations.find((x) => x.invariant.startsWith('b:'));
  assert.ok(v);
  assert.ok(v.fields.some((f) => f.includes('patternModeModeled=NDA')));
  assert.ok(v.fields.some((f) => f.includes('guide.proof.v1')));
});

test('invariant (b): DA pattern with DA_FULL_PROOF is fine; absent proof skips', () => {
  const r = consistentResult();
  r.antenna.patternModeModeled = { value: 'DA_DAY_AND_NIGHT', source: 'antennaDesign' };
  r.proof.proofType = { value: 'DA_FULL_PROOF', source: 'proofPlanner' };
  assert.equal(validateCandidateResult(r).consistent, true);
  const r2 = consistentResult();
  delete r2.proof;
  assert.equal(validateCandidateResult(r2).consistent, true);
});

test('invariant (c): total.low differing from component sum is a violation', () => {
  const r = consistentResult();
  r.costs.total = { low: 999, high: 700 }; // low broken, high still consistent
  const report = validateCandidateResult(r);
  const vs = report.violations.filter((x) => x.invariant.startsWith('c:'));
  assert.equal(vs.length, 1);
  assert.ok(vs[0].fields.some((f) => f.includes('costs.total.low=999')));
  assert.ok(vs[0].fields.some((f) => f.includes('=300'))); // the true sum
});

test('invariant (c): both bounds broken yields two violations; 0.01 tolerance honored', () => {
  const r = consistentResult();
  r.costs.total = { low: 100, high: 100 };
  const report = validateCandidateResult(r);
  assert.equal(report.violations.filter((x) => x.invariant.startsWith('c:')).length, 2);
  // integer-cents tolerance: off by exactly 0.01 is NOT a violation
  const r2 = consistentResult();
  r2.costs.total = { low: 300.01, high: 700 };
  assert.equal(validateCandidateResult(r2).consistent, true);
});

test('invariant (c): components as an object map also sums correctly', () => {
  const r = consistentResult();
  r.costs.components = {
    tower: { low: 100, high: 200 },
    ground: { low: 200, high: 500 },
  };
  assert.equal(validateCandidateResult(r).consistent, true);
  r.costs.components.ground.low = 250;
  assert.equal(validateCandidateResult(r).consistent, false);
});

test('invariant (d): design height disagreeing with ASR input is a violation', () => {
  const r = consistentResult();
  r.regulatory.asr.inputsUsed = [
    { name: 'towerHeightM', value: 47.6, source: 'guide.asr.quarterWave' },
  ];
  const report = validateCandidateResult(r);
  const v = report.violations.find((x) => x.invariant.startsWith('d:'));
  assert.ok(v);
  assert.ok(v.fields.some((f) => f.includes('selectedDesignHeightM=95.2')));
  assert.ok(v.fields.some((f) => f.includes('guide.asr.quarterWave')));
});

test('invariant (d): design height disagreeing with tower-cost input is a violation', () => {
  const r = consistentResult();
  r.costs.tower.inputs.towerHeightM = { value: 60, source: 'costs.tower.menu' };
  const report = validateCandidateResult(r);
  const v = report.violations.find((x) => x.invariant.startsWith('d:'));
  assert.ok(v);
  assert.ok(v.fields.some((f) => f.includes('costs.tower.inputs.towerHeightM=60')));
});

test('invariant (d): skipped when any leg is absent', () => {
  const r = consistentResult();
  delete r.antenna.selectedDesignHeightM;
  r.costs.tower.inputs.towerHeightM = 60; // would conflict if design present
  assert.equal(validateCandidateResult(r).consistent, true);
});

test('invariant (e): radial count mismatch between design and costs is a violation', () => {
  const r = consistentResult();
  r.costs.groundSystem.inputs.radialCount = 60;
  const report = validateCandidateResult(r);
  const v = report.violations.find((x) => x.invariant.startsWith('e:'));
  assert.ok(v);
  assert.ok(v.fields.some((f) => f.includes('radialCount=120')));
  assert.ok(v.fields.some((f) => f.includes('radialCount=60')));
});

test('invariant (e): skipped when either side is absent', () => {
  const r = consistentResult();
  delete r.groundSystem;
  assert.equal(validateCandidateResult(r).consistent, true);
});

test('invariant (f): populationFraction outside [0,1] is a violation (percent leak)', () => {
  const r = consistentResult();
  r.blanket.populationFraction = { value: 60, source: 'guide.blanket.percentBasis' };
  const report = validateCandidateResult(r);
  const v = report.violations.find((x) => x.invariant.startsWith('f:'));
  assert.ok(v);
  assert.match(v.detail, /fraction/i);
  assert.ok(v.fields.some((f) => f.includes('guide.blanket.percentBasis')));
  const r2 = consistentResult();
  r2.blanket.populationFraction = -0.2;
  assert.equal(validateCandidateResult(r2).consistent, false);
});

test('invariant (f): 0, 1, and in-between fractions pass; absent skips', () => {
  for (const f of [0, 1, 0.01, 0.999]) {
    const r = consistentResult();
    r.blanket.populationFraction = f;
    assert.equal(validateCandidateResult(r).consistent, true, `fraction ${f}`);
  }
  const r = consistentResult();
  delete r.blanket;
  assert.equal(validateCandidateResult(r).consistent, true);
});

test('invariant (g): rendered longitude with the wrong hemisphere is a violation', () => {
  const r = consistentResult();
  r.candidate.longitudeFormatted = '111.82° E'; // west coordinate shown as E
  const report = validateCandidateResult(r);
  const v = report.violations.find((x) => x.invariant.startsWith('g:'));
  assert.ok(v);
  assert.ok(v.fields.some((f) => f.includes('candidate.longitude=-111.82')));
  assert.match(v.detail, /111\.82° W/); // canonical rendering named
});

test('invariant (g): correct hemisphere passes; no rendered string self-checks clean', () => {
  const r = consistentResult(); // has the correct '111.82° W'
  assert.equal(validateCandidateResult(r).consistent, true);
  const r2 = consistentResult();
  delete r2.candidate.longitudeFormatted;
  assert.equal(validateCandidateResult(r2).consistent, true);
  const r3 = consistentResult();
  r3.candidate = { longitude: 151.2, longitudeFormatted: '151.2° E' };
  assert.equal(validateCandidateResult(r3).consistent, true);
});

test('invariant (h): ready===true with a required NOT_RUN decision is a violation', () => {
  const r = consistentResult();
  r.filingReadiness = { ready: true };
  r.regulatory.nif = { state: 'NOT_EVALUATED', required: true,
                       completion: 'NOT_RUN', source: 'rules.nif' };
  const report = validateCandidateResult(r);
  const v = report.violations.find((x) => x.invariant.startsWith('h:'));
  assert.ok(v);
  assert.ok(v.fields.includes('filingReadiness.ready=true'));
  assert.ok(v.fields.some((f) => f.includes('regulatory.nif')));
});

test('invariant (h): ready===false, or required decisions all RUN, passes', () => {
  const r = consistentResult(); // nif required but ready=false
  r.regulatory.nif.completion = 'NOT_RUN';
  assert.equal(validateCandidateResult(r).consistent, true);
  const r2 = consistentResult();
  r2.filingReadiness = { ready: true };
  r2.regulatory.nif.completion = 'RUN';
  assert.equal(validateCandidateResult(r2).consistent, true);
  // non-required NOT_RUN decisions do not block readiness
  const r3 = consistentResult();
  r3.filingReadiness = { ready: true };
  r3.regulatory.nif = { state: 'NOT_REQUIRED', required: false, completion: 'NOT_RUN' };
  assert.equal(validateCandidateResult(r3).consistent, true);
});

test('invariant (i): FILING_READY recommendation while ready===false is a violation', () => {
  const r = consistentResult();
  r.recommendations = [{ level: 'FILING_READY' }];
  const report = validateCandidateResult(r);
  const v = report.violations.find((x) => x.invariant.startsWith('i:'));
  assert.ok(v);
  assert.ok(v.fields.includes('filingReadiness.ready=false'));
  // also detected for bare-string recommendation entries
  const r2 = consistentResult();
  r2.recommendations = ['FILING_READY'];
  assert.equal(
    validateCandidateResult(r2).violations.some((x) => x.invariant.startsWith('i:')),
    true);
});

test('invariant (i): FILING_READY is fine when ready===true; other levels always fine', () => {
  const r = consistentResult();
  r.filingReadiness = { ready: true };
  r.regulatory.nif.completion = 'RUN';
  r.recommendations = [{ level: 'FILING_READY' }];
  assert.equal(validateCandidateResult(r).consistent, true);
  const r2 = consistentResult();
  r2.recommendations = [{ level: 'REJECT' }, 'SCREEN_FURTHER'];
  assert.equal(validateCandidateResult(r2).consistent, true);
});

test('development mode throws an AggregateError naming every violation', () => {
  const r = consistentResult();
  r.regulatory.nif = { state: 'NOT_REQUIRED', required: true };
  r.blanket.populationFraction = 60;
  assert.throws(
    () => validateCandidateResult(r, { mode: 'development' }),
    (err) => {
      assert.ok(err instanceof AggregateError);
      assert.equal(err.errors.length, 2);
      assert.match(err.message, /a:nif-required-vs-not-required/);
      assert.match(err.message, /f:blanket-population-fraction-range/);
      return true;
    });
});

test('production mode returns the report instead of throwing', () => {
  const r = consistentResult();
  r.regulatory.nif = { state: 'NOT_REQUIRED', required: true };
  const report = validateCandidateResult(r); // default mode
  assert.equal(report.consistent, false);
  assert.equal(report.violations.length, 1);
});

test('validateCandidateResult rejects non-object input and unknown modes', () => {
  assert.throws(() => validateCandidateResult(null), TypeError);
  assert.throws(
    () => validateCandidateResult({}, { mode: 'staging' }), /unknown mode/);
});
