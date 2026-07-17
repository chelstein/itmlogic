// Canonical antenna-design stage — the SINGLE tower-height truth set.
//
// Replaces the ~45 local re-derivations of the class design rule and the
// coexisting λ/4 family catalogued in
// docs/architecture-contradiction-origins.md §1.  Every downstream stage
// (ASR/FAA rule, cost model, RF-exposure geometry) must read
// selectedDesignHeightM from here and NOWHERE else — validation.js
// invariant (d) enforces that the ASR decision and the tower cost line
// were fed exactly this number.
//
// λ/4 and 5/8λ are returned as clearly labeled REFERENCE values only;
// they never silently become the selected height.

'use strict';

import { ev, CONFIDENCE_TIERS } from './types.js';

const SOURCE = 'canonical/antennaDesign';

/**
 * Propagation constant used for wavelength, consistent with the rest of
 * the AM engine (siteOptimizer uses λ_m = 300000 / f_kHz, i.e. c ≈ 3×10⁸ m/s).
 */
export const WAVELENGTH_NUMERATOR_KM_KHZ = 300000;

/** Class-typical design-height fraction of λ: 5/8λ for A/B, 3/8λ for C/D. */
export const CLASS_DESIGN_FRACTION = Object.freeze({
  A: 0.625,
  B: 0.625,
  C: 0.375,
  D: 0.375,
});

/** Selection-basis vocabulary for selectedDesignHeightM. */
export const HEIGHT_SELECTION_BASES = Object.freeze({
  REQUESTED_HEIGHT: 'REQUESTED_HEIGHT',
  HOST_STRUCTURE: 'HOST_STRUCTURE',
  CLASS_TYPICAL_DEFAULT: 'CLASS_TYPICAL_DEFAULT',
});

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Derive the single tower-height truth set for a candidate.
 *
 * Selection rule (strict priority, no silent overrides):
 *   1. requested_height_m   — operator explicitly asked for this height.
 *   2. host_structure_height_m — colocation on an existing structure.
 *   3. class-typical default — 5/8λ for class A/B, 3/8λ for class C/D,
 *      carried at SCREENING confidence with an explicit assumption that
 *      it was NOT auto-selected for efficiency and that the actual
 *      licensed height governs.  5/8λ is NEVER silently picked for C/D.
 *
 * @param {Object}  p
 * @param {number}  p.frequency_khz
 * @param {string}  p.fcc_class                'A'|'B'|'C'|'D'
 * @param {?number} [p.host_structure_height_m=null]
 * @param {?number} [p.requested_height_m=null]
 * @returns {{
 *   wavelengthM: Object,             // ev
 *   quarterWaveReferenceM: Object,   // ev, reference only
 *   fiveEighthsReferenceM: Object,   // ev, reference only
 *   selectedDesignHeightM: Object,   // ev — THE height
 *   selectionBasis: string,          // HEIGHT_SELECTION_BASES member
 *   minimumPracticalHeightM: number,
 *   maximumEvaluatedHeightM: number,
 *   heightEnvelopeBasis: string,
 *   electricalHeightDeg: Object,     // ev
 * }}
 */
export function deriveAntennaDesign({
  frequency_khz,
  fcc_class,
  host_structure_height_m = null,
  requested_height_m = null,
} = {}) {
  const f = Number(frequency_khz);
  if (!Number.isFinite(f) || f <= 0) {
    throw new TypeError(`deriveAntennaDesign(): frequency_khz must be a positive finite number, got ${frequency_khz}`);
  }
  const cls = String(fcc_class ?? '').trim().toUpperCase();
  const knownClass = Object.prototype.hasOwnProperty.call(CLASS_DESIGN_FRACTION, cls);
  const classFraction = knownClass ? CLASS_DESIGN_FRACTION[cls] : CLASS_DESIGN_FRACTION.D;

  const lambda = WAVELENGTH_NUMERATOR_KM_KHZ / f;

  const wavelengthM = ev(round2(lambda), {
    unit: 'm', source: SOURCE, confidence: CONFIDENCE_TIERS.FILING_GRADE,
    assumptions: ['λ = 300000 / f_kHz (c ≈ 3×10⁸ m/s), consistent engine-wide'],
  });

  const quarterWaveReferenceM = ev(round2(lambda / 4), {
    unit: 'm', source: SOURCE, confidence: CONFIDENCE_TIERS.FILING_GRADE,
    assumptions: [
      'reference only',
      'λ/4 physics reference (R_rad ≈ 36.6 Ω) — never the selected design height unless explicitly requested',
    ],
  });

  const fiveEighthsReferenceM = ev(round2(lambda * 0.625), {
    unit: 'm', source: SOURCE, confidence: CONFIDENCE_TIERS.FILING_GRADE,
    assumptions: [
      'reference only',
      '5/8λ antifade reference — never auto-selected for class C/D',
    ],
  });

  // ── The one selection rule ───────────────────────────────────────────
  const req = Number(requested_height_m);
  const host = Number(host_structure_height_m);
  let selectedDesignHeightM;
  let selectionBasis;

  if (requested_height_m != null && Number.isFinite(req) && req > 0) {
    selectionBasis = HEIGHT_SELECTION_BASES.REQUESTED_HEIGHT;
    selectedDesignHeightM = ev(round2(req), {
      unit: 'm', source: SOURCE, confidence: CONFIDENCE_TIERS.ENGINEERING_GRADE,
      assumptions: [
        'operator-requested design height governs over host-structure and class defaults',
        'actual licensed height governs at filing',
      ],
    });
  } else if (host_structure_height_m != null && Number.isFinite(host) && host > 0) {
    selectionBasis = HEIGHT_SELECTION_BASES.HOST_STRUCTURE;
    selectedDesignHeightM = ev(round2(host), {
      unit: 'm', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions: [
        'height of the existing host structure (colocation scenario)',
        'actual licensed height governs at filing',
      ],
    });
  } else {
    selectionBasis = HEIGHT_SELECTION_BASES.CLASS_TYPICAL_DEFAULT;
    const assumptions = [
      'class-typical design height; NOT auto-selected for efficiency — actual licensed height governs',
      `class ${knownClass ? cls : '?'} default fraction ${classFraction}λ ` +
        '(5/8λ for A/B, 3/8λ for C/D — 5/8λ is never silently applied to C/D)',
    ];
    if (!knownClass) {
      assumptions.push(`unrecognized FCC class "${fcc_class}" — treated as class C/D typical (3/8λ)`);
    }
    selectedDesignHeightM = ev(round2(classFraction * lambda), {
      unit: 'm', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
      assumptions,
    });
  }

  const h = selectedDesignHeightM.value;

  const electricalHeightDeg = ev(round2((360 * h) / lambda), {
    unit: 'deg', source: SOURCE, confidence: selectedDesignHeightM.confidence,
    assumptions: ['electrical height G = 360°·h/λ of the selected design height'],
  });

  return Object.freeze({
    wavelengthM,
    quarterWaveReferenceM,
    fiveEighthsReferenceM,
    selectedDesignHeightM,
    selectionBasis,
    minimumPracticalHeightM: round2(0.125 * lambda),
    maximumEvaluatedHeightM: round2(0.625 * lambda),
    heightEnvelopeBasis:
      'screening evaluation envelope: λ/8 practical minimum for a series-fed monopole ' +
      '(shorter towers require a §73.189(b) minimum-height/efficiency showing) up to the ' +
      '5/8λ antifade maximum — an envelope, not a selection',
    electricalHeightDeg,
  });
}
