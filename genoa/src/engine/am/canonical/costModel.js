// Canonical cost-model stage — ONE composable component set, ONE total.
//
// Replaces the five competing "grand/project totals" catalogued in
// docs/architecture-contradiction-origins.md §11 (11-item dynamic /
// 17-item static / 9-category no-land / 7-item 90-radial / 10-item
// with land+EAS, three of which the UI rendered as headline totals).
//
// The parametric bases are the SAME ones siteOptimizer's
// am_station_relocation_total_project_cost_proforma guide (~line 8975)
// uses (tower $/ton by guyed/self-support, radial wire $/ft, $/kW
// transmitter tiers, $/sqft building, 15%/25% contingency, land-use
// lease tiers) — but parameterized EXCLUSIVELY on the canonical
// selected design height and the canonical selected ground scenario.
// FCC fee lines come from the regulatory constants catalog
// (APPLICATION_FEES_1104 / ASR_FORM_854_FEE), never re-declared here.
//
// Invariants honored by construction (and enforced by validation.js):
//   (c) total.low/high === exact sum of components[].low/high;
//   (d) costs.tower.inputs.towerHeightM === antenna.selectedDesignHeightM;
//   (e) costs.groundSystem.inputs.radialCount ===
//       groundSystem.selectedScenario.radialCount.
//
// Component records carry BOTH `lowUsd/highUsd` (explicit unit) and
// `low/high` (aliases consumed by validation.js invariant c).

'use strict';

import { ev, CONFIDENCE_TIERS } from './types.js';
import {
  APPLICATION_FEES_1104,
  ASR_FORM_854_FEE,
  ASR_THRESHOLD_17_7,
} from '../../regulatory/regulatoryConstants.js';

const SOURCE = 'canonical/costModel';

/** All cost figures are expressed in this base-year's dollars. */
export const COST_BASE_YEAR = '2026';

export const CONTINGENCY_LOW_FRACTION = 0.15;
export const CONTINGENCY_HIGH_FRACTION = 0.25;

const M_TO_FT = 3.28084;

/** Land-use lease tiers ($/month), same tiers as the siteOptimizer land-use guide. */
const LEASE_TIERS = Object.freeze({
  RURAL: Object.freeze({ lowMo: 500, highMo: 1500 }),
  SUBURBAN: Object.freeze({ lowMo: 1200, highMo: 3500 }),
  URBAN: Object.freeze({ lowMo: 3000, highMo: 8000 }),
});

function leaseTierFor(land_use_class) {
  const s = String(land_use_class ?? '').toLowerCase();
  if (/rural|industrial|agricult/.test(s)) return { key: 'RURAL', ...LEASE_TIERS.RURAL };
  if (/urban|downtown|high/.test(s)) return { key: 'URBAN', ...LEASE_TIERS.URBAN };
  return { key: 'SUBURBAN', ...LEASE_TIERS.SUBURBAN };
}

const unwrap = (x) => (x != null && typeof x === 'object' && 'value' in x ? x.value : x);

function component({ key, low, high, quantityBasis, scenario = 'BASE', inputs = null }) {
  const lo = Math.round(low);
  const hi = Math.round(high);
  const c = {
    key,
    lowUsd: lo,
    highUsd: hi,
    low: lo,   // alias consumed by validation.js invariant (c)
    high: hi,  // alias consumed by validation.js invariant (c)
    baseYear: COST_BASE_YEAR,
    quantityBasis,
    scenario,
    source: SOURCE,
  };
  if (inputs) c.inputs = inputs;
  return Object.freeze(c);
}

function sumBound(components, bound) {
  return components.reduce((s, c) => s + c[bound], 0);
}

function subtotal(name, componentKeys, byKey) {
  const comps = componentKeys.map((k) => byKey[k]).filter(Boolean);
  return Object.freeze({
    name,
    componentKeys: Object.freeze(componentKeys.filter((k) => byKey[k])),
    lowUsd: sumBound(comps, 'lowUsd'),
    highUsd: sumBound(comps, 'highUsd'),
  });
}

/**
 * Build the canonical composable cost model.
 *
 * @param {Object}  p
 * @param {Object}  p.antennaDesign   from deriveAntennaDesign()
 * @param {Object}  p.groundSystem    from deriveGroundSystem()
 * @param {Object}  [p.regulatory]    canonical regulatory decisions (informational)
 * @param {?string} [p.land_use_class]
 * @param {boolean} [p.isDirectional=false]
 * @param {number}  [p.towersCount=1]
 * @param {number}  p.tpo_kw          transmitter power output, kW (explicit — no default)
 * @returns {Object} canonical cost model (see module header)
 */
export function buildCostModel({
  antennaDesign,
  groundSystem,
  regulatory = {},
  land_use_class = null,
  isDirectional = false,
  towersCount = 1,
  tpo_kw,
} = {}) {
  if (!antennaDesign || !antennaDesign.selectedDesignHeightM) {
    throw new TypeError('buildCostModel(): antennaDesign with selectedDesignHeightM is required');
  }
  if (!groundSystem || !groundSystem.selectedScenario) {
    throw new TypeError('buildCostModel(): groundSystem with selectedScenario is required');
  }
  const tpo = Number(tpo_kw);
  if (!Number.isFinite(tpo) || tpo <= 0) {
    throw new TypeError(`buildCostModel(): tpo_kw must be a positive finite number, got ${tpo_kw} (no silent default — see contradiction audit §12)`);
  }

  const h_m = Number(unwrap(antennaDesign.selectedDesignHeightM));
  const h_ft = Math.round(h_m * M_TO_FT);
  const towers = Math.max(1, Math.round(Number(towersCount) || 1));
  const scen = groundSystem.selectedScenario;
  const daLabel = isDirectional ? 'DA' : 'NDA';

  const components = [];

  // ── landAndLease ─────────────────────────────────────────────────────
  const lease = leaseTierFor(land_use_class);
  components.push(component({
    key: 'landAndLease',
    low: lease.lowMo * 120,
    high: lease.highMo * 120,
    scenario: lease.key,
    quantityBasis:
      `10-year site lease capitalized at $${lease.lowMo}–$${lease.highMo}/mo ` +
      `(${lease.key.toLowerCase()} land-use tier "${land_use_class ?? 'unspecified'}"); ` +
      'ground-system footprint sized by the SELECTED radial length',
  }));

  // ── tower (steel + erection + foundation + lighting if ASR trips) ───
  const isGuyed = h_ft < 400;
  const lbsPerFt = isGuyed ? 110 : 200;
  const steelTons = (lbsPerFt * h_ft) / 2000;
  const towerLow = steelTons * 1800 * towers + h_ft * 200 * towers;
  const towerHigh = steelTons * 2800 * towers + h_ft * 350 * towers;
  // Lighting/painting priced on the SAME canonical height the ASR rule read.
  const asrHeightTrips = h_m > ASR_THRESHOLD_17_7.height_m;
  const asrRequired = regulatory?.asr?.required === true || asrHeightTrips;
  const ltgLow = asrRequired ? (h_ft * 18 + 8500) * towers : 0;
  const ltgHigh = asrRequired ? (h_ft * 30 + 15000) * towers : 0;
  components.push(component({
    key: 'tower',
    low: towerLow + ltgLow,
    high: towerHigh + ltgHigh,
    scenario: isGuyed ? 'GUYED' : 'SELF_SUPPORT',
    quantityBasis:
      `${towers} × ${h_ft} ft (${h_m} m canonical selected design height) ` +
      `${isGuyed ? 'guyed' : 'self-support'} tower(s): ${Math.round(steelTons * 100) / 100} tons ` +
      'steel at $1,800–$2,800/ton installed + foundation $200–$350/ft' +
      (asrRequired
        ? `; FAA lighting/painting included (${h_ft} ft exceeds the §17.7 ${ASR_THRESHOLD_17_7.height_ft} ft threshold)`
        : '; no FAA lighting (below §17.7 threshold)'),
    inputs: {
      towerHeightM: ev(h_m, {
        unit: 'm', source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
        assumptions: ['identical to antenna.selectedDesignHeightM — the single canonical height'],
      }),
      towersCount: towers,
    },
  }));

  // ── groundSystem ─────────────────────────────────────────────────────
  const wireFt = Number(scen.wireLengthM) * M_TO_FT;
  components.push(component({
    key: 'groundSystem',
    low: wireFt * 0.53,
    high: wireFt * 0.85,
    scenario: scen.key,
    quantityBasis:
      `SELECTED ${scen.key} scenario: ${scen.radialCount} radials × ${scen.radialLengthM} m × ` +
      `${scen.towersCount} tower(s) = ${scen.wireLengthM} m ` +
      `(${Math.round(wireFt).toLocaleString('en-US')} ft) buried copper at $0.53–$0.85/ft installed`,
    inputs: {
      radialCount: ev(scen.radialCount, {
        unit: null, source: SOURCE, confidence: CONFIDENCE_TIERS.SCREENING,
        assumptions: ['identical to groundSystem.selectedScenario.radialCount — only the selected scenario feeds costs'],
      }),
      wireLengthM: scen.wireLengthM,
    },
  }));

  // ── transmitterBuilding ─────────────────────────────────────────────
  const paEff = 0.875;
  const heatKw = tpo * (1 - paEff);
  const hvacTons = Math.ceil((heatKw * 3412) / 12000);
  const sqftLow = Math.max(400, Math.round(tpo * 30 + 300));
  const sqftHigh = sqftLow + 200;
  components.push(component({
    key: 'transmitterBuilding',
    low: sqftLow * 95 + hvacTons * 2800,
    high: sqftHigh * 150 + hvacTons * 4200,
    quantityBasis:
      `${sqftLow}–${sqftHigh} sqft at $95–$150/sqft + ${hvacTons}-ton HVAC ` +
      `(heat load ${Math.round(heatKw * 100) / 100} kW at ${paEff * 100}% PA efficiency, ${tpo} kW TPO)`,
  }));

  // ── transmitterAndATU ───────────────────────────────────────────────
  const xmtrPerKw = tpo <= 1 ? 8000 : tpo <= 5 ? 5000 : 3500;
  const xmtrLow = tpo * xmtrPerKw * 0.90;
  const xmtrHigh = tpo * xmtrPerKw * 1.50;
  const atuLow = isDirectional ? 40000 + 25000 * towers : 15000;
  const atuHigh = isDirectional ? 80000 + 45000 * towers : 30000;
  const feedrunFt = Math.round((h_m + 30) * M_TO_FT);
  const cablePerFt = tpo <= 5 ? 12 : 22;
  const txlLow = feedrunFt * cablePerFt * 0.85;
  const txlHigh = feedrunFt * cablePerFt * 1.30;
  components.push(component({
    key: 'transmitterAndATU',
    low: xmtrLow + atuLow + txlLow,
    high: xmtrHigh + atuHigh + txlHigh,
    scenario: daLabel,
    quantityBasis:
      `${tpo} kW solid-state transmitter at $${xmtrPerKw.toLocaleString('en-US')}/kW (×0.90–×1.50) + ` +
      (isDirectional
        ? `phasor and ${towers} tower ATUs`
        : 'single ATU (NDA)') +
      ` + ${feedrunFt} ft ${tpo <= 5 ? '7/8"' : '1-5/8"'} transmission line ` +
      '(feedrun = canonical selected height + 30 m shack run)',
  }));

  // ── electricalAndGenerator ──────────────────────────────────────────
  components.push(component({
    key: 'electricalAndGenerator',
    low: 35000 + tpo * 1500,
    high: 80000 + tpo * 3000,
    quantityBasis:
      `utility service entrance, ATS and standby generator sized for ${tpo} kW TPO ` +
      '($35K–$80K base + $1.5K–$3K/kW)',
  }));

  // ── siteAccessAndUtilities ──────────────────────────────────────────
  const access = lease.key === 'RURAL'
    ? { low: 30000, high: 90000 }
    : lease.key === 'URBAN'
      ? { low: 15000, high: 45000 }
      : { low: 20000, high: 60000 };
  components.push(component({
    key: 'siteAccessAndUtilities',
    low: access.low,
    high: access.high,
    scenario: lease.key,
    quantityBasis:
      `access road, security fencing and utility extension for a ${lease.key.toLowerCase()} site ` +
      '(rural sites carry longer road/utility runs)',
  }));

  // ── engineering (consulting + NIF study + proof of performance) ────
  const engLow = (isDirectional ? 35000 : 18000) + (isDirectional ? 12000 : 6000) + (isDirectional ? 13500 : 6000);
  const engHigh = (isDirectional ? 75000 : 45000) + (isDirectional ? 28000 : 15000) + (isDirectional ? 32000 : 13000);
  components.push(component({
    key: 'engineering',
    low: engLow,
    high: engHigh,
    scenario: daLabel,
    quantityBasis:
      `${daLabel} pathway consulting engineering + nighttime interference (NIF/RSS) study + ` +
      'proof of performance field work (Form 302-AM)',
  }));

  // ── legalAndFiling (FCC fees from the §1.1104 catalog) ─────────────
  const fees = APPLICATION_FEES_1104.am;
  const fccFees =
    fees.major_change_cp_usd +
    fees.license_to_cover_usd +
    (isDirectional ? fees.directional_antenna_usd : 0) +
    ASR_FORM_854_FEE.filing_fee_usd;
  components.push(component({
    key: 'legalAndFiling',
    low: 8000 + fccFees,
    high: 22000 + fccFees,
    scenario: daLabel,
    quantityBasis:
      'FCC counsel $8K–$22K + FCC application fees per ' +
      `${APPLICATION_FEES_1104.cite} (${APPLICATION_FEES_1104.fr_citation}): ` +
      `Form 301-AM major change CP $${fees.major_change_cp_usd.toLocaleString('en-US')}, ` +
      `license to cover $${fees.license_to_cover_usd}` +
      (isDirectional ? `, DA exhibit $${fees.directional_antenna_usd.toLocaleString('en-US')}` : '') +
      `; Form 854 ASR filing fee $${ASR_FORM_854_FEE.filing_fee_usd} (${ASR_FORM_854_FEE.cite})`,
  }));

  // ── environmental ───────────────────────────────────────────────────
  const env = lease.key === 'URBAN'
    ? { low: 8000, high: 35000 }
    : { low: 5000, high: 15000 };
  components.push(component({
    key: 'environmental',
    low: env.low,
    high: env.high,
    scenario: lease.key,
    quantityBasis:
      'Phase I ESA (ASTM E1527-21) + NEPA/NHPA §106 desktop review; ' +
      `${lease.key.toLowerCase()} tier (urban sites carry higher SHPO consultation exposure)`,
  }));

  // ── contingency (last, on the subtotal of everything above) ────────
  const preLow = sumBound(components, 'lowUsd');
  const preHigh = sumBound(components, 'highUsd');
  components.push(component({
    key: 'contingency',
    low: preLow * CONTINGENCY_LOW_FRACTION,
    high: preHigh * CONTINGENCY_HIGH_FRACTION,
    quantityBasis:
      `${CONTINGENCY_LOW_FRACTION * 100}% (low) / ${CONTINGENCY_HIGH_FRACTION * 100}% (high) ` +
      'of the pre-contingency component subtotal',
  }));

  const byKey = Object.fromEntries(components.map((c) => [c.key, c]));
  const allKeys = components.map((c) => c.key);

  const totalLow = sumBound(components, 'lowUsd');
  const totalHigh = sumBound(components, 'highUsd');

  const subtotals = Object.freeze({
    constructionOnly: subtotal('constructionOnly', [
      'tower', 'groundSystem', 'transmitterBuilding', 'transmitterAndATU',
      'electricalAndGenerator', 'siteAccessAndUtilities',
    ], byKey),
    softCostsOnly: subtotal('softCostsOnly', [
      'engineering', 'legalAndFiling', 'environmental',
    ], byKey),
    antennaSystemOnly: subtotal('antennaSystemOnly', [
      'tower', 'groundSystem', 'transmitterAndATU',
    ], byKey),
    totalProjectCapital: subtotal('totalProjectCapital', allKeys, byKey),
  });

  return Object.freeze({
    baseYear: COST_BASE_YEAR,
    confidence: CONFIDENCE_TIERS.SCREENING,
    source: SOURCE,
    components: Object.freeze(components),
    // The ONE total — exact sum of components (validation invariant c).
    total: Object.freeze({ low: totalLow, high: totalHigh, lowUsd: totalLow, highUsd: totalHigh }),
    subtotals,
    // Named input echoes consumed by validation invariants (d) and (e).
    tower: byKey.tower ? { inputs: byKey.tower.inputs } : null,
    groundSystem: byKey.groundSystem ? { inputs: byKey.groundSystem.inputs } : null,
    parametricBasis:
      'same parametric bases as the siteOptimizer relocation cost pro forma ' +
      '(tower $/ton, radial wire $/ft, $/kW transmitter tiers, $/sqft building, ' +
      '15%/25% contingency), parameterized exclusively on the canonical selected ' +
      'design height and selected ground scenario',
  });
}
