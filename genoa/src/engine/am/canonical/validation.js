// Canonical AM result pipeline — invariant validation engine.
//
// The audit (docs/architecture-contradiction-origins.md) found candidates
// whose own fields contradict each other: NIF simultaneously required and
// NOT_REQUIRED, NDA candidates told to run a full DA proof, cost totals
// that are not the sum of their components, filing-ready recommendations
// on candidates whose required studies never ran.  This module is the
// layer that refuses to render such a candidate.
//
// validateCandidateResult(result, {mode}) checks every cross-field
// invariant it can, null-tolerantly: an invariant is only evaluated when
// the fields it relates are all present (absence — NOT_EVALUATED,
// missing modules — is never itself a violation).  In 'development' mode
// any violation throws an AggregateError naming all of them; in
// 'production' the report is returned and callers are expected to
// suppress recommendations and surface a technical warning instead.

'use strict';

import { formatLongitude } from './formatters.js';

/* ── helpers ─────────────────────────────────────────────────────────── */

/**
 * Unwrap an EngineeringValue-shaped object to its raw value; pass raw
 * values through.
 * @param {*} x
 * @returns {*}
 */
function val(x) {
  if (x !== null && typeof x === 'object' && !Array.isArray(x) &&
      Object.prototype.hasOwnProperty.call(x, 'value')) {
    return x.value;
  }
  return x;
}

/**
 * Read the provenance source of an EngineeringValue-shaped object, or a
 * fallback label when the field carries no provenance.
 * @param {*}      x
 * @param {string} fallback
 * @returns {string}
 */
function src(x, fallback) {
  if (x !== null && typeof x === 'object' &&
      typeof x.source === 'string' && x.source !== '') {
    return x.source;
  }
  return fallback;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const present = (x) => x !== null && x !== undefined;

/** Safe nested property read: get(obj, 'a', 'b', 'c'). */
function get(obj, ...path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Does this object look like a RegulatoryDecision record?
 * @param {*} d
 * @returns {boolean}
 */
function looksLikeDecision(d) {
  return d !== null && typeof d === 'object' &&
    (Object.prototype.hasOwnProperty.call(d, 'state') ||
     Object.prototype.hasOwnProperty.call(d, 'completion')) &&
    Object.prototype.hasOwnProperty.call(d, 'required');
}

/* ── invariant checks (each pushes zero or more violations) ──────────── */

/**
 * @typedef {Object} InvariantViolation
 * @property {string}   invariant  Short id ('a'…'i') plus a name.
 * @property {string[]} fields     Exact conflicting field paths + sources.
 * @property {string}   detail     Human-readable explanation.
 */

// (a) NIF cannot be simultaneously required and NOT_REQUIRED.
function checkNifContradiction(result, out) {
  const nif = get(result, 'regulatory', 'nif');
  if (!nif) return;
  if (nif.required === true && nif.state === 'NOT_REQUIRED') {
    out.push({
      invariant: 'a:nif-required-vs-not-required',
      fields: [
        'regulatory.nif.required=true',
        'regulatory.nif.state=NOT_REQUIRED',
      ],
      detail: `NIF decision is contradictory: required === true but state === 'NOT_REQUIRED' (source: ${src(nif, 'regulatory.nif')})`,
    });
  }
}

// (b) An NDA candidate cannot carry a full DA proof requirement.
function checkNdaVsDaProof(result, out) {
  const patternMode = get(result, 'antenna', 'patternModeModeled');
  const proofType = get(result, 'proof', 'proofType');
  const mode = val(patternMode);
  const proof = val(proofType);
  if (!present(mode) || !present(proof)) return;
  if (mode === 'NDA' && proof === 'DA_FULL_PROOF') {
    out.push({
      invariant: 'b:nda-vs-da-full-proof',
      fields: [
        `antenna.patternModeModeled=NDA (source: ${src(patternMode, 'antenna')})`,
        `proof.proofType=DA_FULL_PROOF (source: ${src(proofType, 'proof')})`,
      ],
      detail: 'Antenna is modeled non-directional but the proof module demands a full DA proof of performance',
    });
  }
}

// (c) Cost total must equal the sum of its components (low and high).
function checkCostTotals(result, out) {
  const costs = get(result, 'costs');
  if (!costs || !costs.total || !present(costs.components)) return;
  const components = Array.isArray(costs.components)
    ? costs.components
    : Object.values(costs.components);
  if (components.length === 0) return;

  for (const bound of ['low', 'high']) {
    const total = val(get(costs, 'total', bound));
    if (!isNum(total)) continue;
    let sum = 0;
    let allNumeric = true;
    for (const c of components) {
      const v = val(get(c, bound));
      if (!isNum(v)) { allNumeric = false; break; }
      sum += v;
    }
    if (!allNumeric) continue;
    if (Math.abs(total - sum) > 0.01) {
      out.push({
        invariant: 'c:cost-total-vs-component-sum',
        fields: [
          `costs.total.${bound}=${total} (source: ${src(get(costs, 'total', bound), 'costs.total')})`,
          `sum(costs.components[].${bound})=${sum}`,
        ],
        detail: `costs.total.${bound} (${total}) differs from the sum of its components (${sum}) by more than 0.01`,
      });
    }
  }
}

// (d) The selected design height must be the SAME number the ASR decision
//     evaluated and the SAME number the tower cost model priced.
function checkHeightConsistency(result, out) {
  const design = get(result, 'antenna', 'selectedDesignHeightM');
  const designH = val(design);
  if (!isNum(designH)) return;

  const holders = [];

  const inputsUsed = get(result, 'regulatory', 'asr', 'inputsUsed');
  if (Array.isArray(inputsUsed)) {
    const heightInput = inputsUsed.find((i) => {
      const name = (i && (i.name || i.field || i.key)) || '';
      return /height/i.test(String(name));
    });
    if (heightInput && isNum(val(heightInput))) {
      holders.push({
        path: 'regulatory.asr.inputsUsed[height]',
        value: val(heightInput),
        source: src(heightInput, 'regulatory.asr'),
      });
    }
  }

  const towerInput = get(result, 'costs', 'tower', 'inputs', 'towerHeightM');
  if (isNum(val(towerInput))) {
    holders.push({
      path: 'costs.tower.inputs.towerHeightM',
      value: val(towerInput),
      source: src(towerInput, 'costs.tower'),
    });
  }

  for (const h of holders) {
    if (Math.abs(h.value - designH) > 1e-6) {
      out.push({
        invariant: 'd:design-height-consistency',
        fields: [
          `antenna.selectedDesignHeightM=${designH} (source: ${src(design, 'antenna')})`,
          `${h.path}=${h.value} (source: ${h.source})`,
        ],
        detail: `Tower height diverges between modules: antenna design says ${designH} m but ${h.path} carries ${h.value} m`,
      });
    }
  }
}

// (e) Ground-system scenario radial count must match the radial count the
//     cost model was fed.
function checkRadialCountConsistency(result, out) {
  const scenario = get(result, 'groundSystem', 'selectedScenario', 'radialCount');
  const costInput = get(result, 'costs', 'groundSystem', 'inputs', 'radialCount');
  const a = val(scenario);
  const b = val(costInput);
  if (!isNum(a) || !isNum(b)) return;
  if (a !== b) {
    out.push({
      invariant: 'e:radial-count-consistency',
      fields: [
        `groundSystem.selectedScenario.radialCount=${a} (source: ${src(scenario, 'groundSystem')})`,
        `costs.groundSystem.inputs.radialCount=${b} (source: ${src(costInput, 'costs.groundSystem')})`,
      ],
      detail: `Ground system was designed with ${a} radials but costed with ${b}`,
    });
  }
}

// (f) Blanket population figure is a decimal FRACTION (0.01 === 1%) and
//     must lie in [0, 1] — a value of e.g. 60 is a percent leak.
function checkBlanketFraction(result, out) {
  const raw = get(result, 'blanket', 'populationFraction');
  const f = val(raw);
  if (!present(f)) return;
  if (!isNum(f) || f < 0 || f > 1) {
    out.push({
      invariant: 'f:blanket-population-fraction-range',
      fields: [
        `blanket.populationFraction=${f} (source: ${src(raw, 'blanket')})`,
      ],
      detail: `blanket.populationFraction must be a decimal fraction in [0, 1] (canonical §73.24(g) unit; 0.01 === 1%); ${f} looks like a percent or is out of range`,
    });
  }
}

// (g) Any pre-rendered longitude string must agree with the canonical
//     formatter's hemisphere for candidate.longitude.
function checkLongitudeHemisphere(result, out) {
  const lon = val(get(result, 'candidate', 'longitude'));
  if (!isNum(lon)) return;
  const expected = formatLongitude(lon);
  const rendered = get(result, 'candidate', 'longitudeFormatted');

  if (typeof rendered === 'string') {
    const wantHemisphere = lon < 0 ? 'W' : 'E';
    const wrongHemisphere = lon < 0 ? 'E' : 'W';
    if (!rendered.includes(wantHemisphere) || rendered.includes(wrongHemisphere)) {
      out.push({
        invariant: 'g:longitude-hemisphere-consistency',
        fields: [
          `candidate.longitude=${lon}`,
          `candidate.longitudeFormatted="${rendered}"`,
          `canonical=formatLongitude → "${expected}"`,
        ],
        detail: `Rendered longitude "${rendered}" disagrees with the sign of candidate.longitude (${lon}); canonical rendering is "${expected}"`,
      });
    }
  } else {
    // Self-check: the canonical formatter itself must honor the sign.
    const hemisphereOk = lon < 0 ? expected.endsWith('W') : expected.endsWith('E');
    if (!hemisphereOk) {
      out.push({
        invariant: 'g:longitude-hemisphere-consistency',
        fields: [`candidate.longitude=${lon}`, `formatLongitude → "${expected}"`],
        detail: 'Canonical longitude formatter produced a hemisphere inconsistent with the coordinate sign',
      });
    }
  }
}

/** Collect all decision-shaped records under result.regulatory. */
function collectDecisions(result) {
  const reg = get(result, 'regulatory');
  const found = [];
  if (!reg || typeof reg !== 'object') return found;
  for (const [name, d] of Object.entries(reg)) {
    if (looksLikeDecision(d)) found.push([`regulatory.${name}`, d]);
  }
  return found;
}

// (h) A candidate cannot be filing-ready while any required regulatory
//     study never ran.
function checkFilingReadinessVsCompletion(result, out) {
  const ready = get(result, 'filingReadiness', 'ready');
  if (ready !== true) return; // only ready===true can contradict
  const offenders = collectDecisions(result).filter(
    ([, d]) => d.required === true && d.completion === 'NOT_RUN'
  );
  for (const [path, d] of offenders) {
    out.push({
      invariant: 'h:filing-readiness-vs-not-run',
      fields: [
        'filingReadiness.ready=true',
        `${path}.required=true`,
        `${path}.completion=NOT_RUN`,
      ],
      detail: `filingReadiness.ready is true but required decision ${path} never ran (source: ${src(d, path)})`,
    });
  }
}

// (i) Recommendations cannot include FILING_READY on a candidate whose
//     filing readiness is false.
function checkRecommendationsVsReadiness(result, out) {
  const ready = get(result, 'filingReadiness', 'ready');
  const recs = get(result, 'recommendations');
  if (ready !== false || !Array.isArray(recs)) return;
  const levelOf = (r) => (typeof r === 'string' ? r : val(get(r, 'level')));
  const offenders = recs.filter((r) => levelOf(r) === 'FILING_READY');
  if (offenders.length > 0) {
    out.push({
      invariant: 'i:filing-ready-recommendation-vs-readiness',
      fields: [
        'filingReadiness.ready=false',
        "recommendations[] contains level 'FILING_READY'",
      ],
      detail: 'A FILING_READY recommendation is present although filingReadiness.ready === false',
    });
  }
}

/* ── entry point ─────────────────────────────────────────────────────── */

/**
 * Validate a canonical candidate result against all cross-field
 * invariants.  Null-tolerant: invariants are skipped when their inputs
 * are absent; NOT_EVALUATED / missing modules never false-positive.
 *
 * @param {Object} result
 * @param {Object} [opts]
 * @param {'production'|'development'} [opts.mode='production']
 *   'development' throws an AggregateError naming every violation;
 *   'production' returns the report so the caller can suppress
 *   recommendations and render a technical warning.
 * @returns {{ consistent: boolean, violations: InvariantViolation[] }}
 */
export function validateCandidateResult(result, { mode = 'production' } = {}) {
  if (result === null || typeof result !== 'object') {
    throw new TypeError('validateCandidateResult(): result must be an object');
  }
  if (mode !== 'production' && mode !== 'development') {
    throw new TypeError(`validateCandidateResult(): unknown mode "${mode}"`);
  }

  /** @type {InvariantViolation[]} */
  const violations = [];
  checkNifContradiction(result, violations);
  checkNdaVsDaProof(result, violations);
  checkCostTotals(result, violations);
  checkHeightConsistency(result, violations);
  checkRadialCountConsistency(result, violations);
  checkBlanketFraction(result, violations);
  checkLongitudeHemisphere(result, violations);
  checkFilingReadinessVsCompletion(result, violations);
  checkRecommendationsVsReadiness(result, violations);

  const report = { consistent: violations.length === 0, violations };

  if (mode === 'development' && violations.length > 0) {
    const errors = violations.map(
      (v) => new Error(`[${v.invariant}] ${v.detail} — fields: ${v.fields.join(' | ')}`)
    );
    throw new AggregateError(
      errors,
      `Candidate result violates ${violations.length} invariant(s): ` +
      violations.map((v) => v.invariant).join(', ')
    );
  }

  return report;
}
