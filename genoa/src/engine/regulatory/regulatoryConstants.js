// Canonical FCC regulatory VALUE catalog.
//
// Companion to citations.js (which registers rule TEXT): this module is
// the single source of truth for every regulatory NUMBER Genoa uses —
// fees, power limits, protection ratios, exposure limits, registration
// thresholds.  The 2026 full-codebase audit found that almost every
// cross-guide contradiction (two STA fees, three STL fees, four IBOC
// levels, ±2° vs ±3°) existed because the same regulatory fact was
// declared independently at multiple call sites.  Declaring each value
// exactly once makes that class of defect structurally impossible.
//
// Rules of this module:
//   1. Every value carries its citation and the Federal Register
//      amendment it was transcribed from, plus verified_at — the date a
//      human/agent last checked the value against the codified CFR.
//   2. regulatoryConstants.test.js enforces a freshness ceiling: when
//      any verified_at is older than MAX_VERIFICATION_AGE_DAYS the build
//      fails, forcing re-verification instead of silent drift.  (The
//      audit found the prior "FY2024" fee set was two amendment cycles
//      stale despite being internally consistent and cited.)
//   3. Call sites import from here.  Never re-declare one of these
//      numbers at a call site; never "fix" a value at a call site.
//
// Sources verified 2026-07-03 against the codified CFR (eCFR via
// Cornell LII):
//   47 CFR §1.1104  [90 FR 17013, eff. Apr. 23, 2025]  (Media Bureau application fees)
//   47 CFR §1.1153  [89 FR 78509, Sept. 25, 2024]      (media annual regulatory fees)
//   47 CFR §1.1102  (wireless application fees; NO Antenna Structure
//                    Registration row — Form 854 carries no filing fee)
//   47 CFR §73.21, §73.182, §73.99, §73.215(a)(1), §17.7, §1.1310

// Freshness policy — the annual-fee schedule turns over every year and
// application fees are CPI-adjusted, so 365 days is the outer bound.
export const MAX_VERIFICATION_AGE_DAYS = 365;

// ─── Application fees — 47 CFR §1.1104 ─────────────────────────────────
export const APPLICATION_FEES_1104 = Object.freeze({
  cite:         '47 CFR §1.1104',
  fr_citation:  '90 FR 17013',
  effective:    '2025-04-23',
  verified_at:  '2026-07-03',
  am: Object.freeze({
    major_change_cp_usd:        4675,   // New or Major Change CP (no auction)
    major_change_cp_auction_usd: 5350,  // New or Major Change CP (auction)
    minor_modification_cp_usd:  1910,
    license_to_cover_usd:        755,   // "New License" (Form 302-AM)
    directional_antenna_usd:    1480,   // AM DA exhibit (additional)
    renewal_usd:                 365,   // Form 303-S
    assignment_long_form_usd:   1180,   // 314/315 long form, per station
    assignment_short_form_usd:   500,   // 316 short form, per station
    call_sign_usd:               190,
    sta_usd:                     325,
    biennial_ownership_usd:       95    // Form 323, per station
  }),
  fm: Object.freeze({
    major_change_cp_usd:        3870,   // no auction
    minor_modification_cp_usd:  1485,
    license_to_cover_usd:        275,
    directional_antenna_usd:     705
  }),
  fm_translator: Object.freeze({
    major_change_cp_usd:         830    // Form 349, no auction
  })
});

// ─── Wireless application fees — 47 CFR §1.1102 (site-based table) ─────
// Covers Part 74 broadcast auxiliary (aural STL, ULS Form 601).
export const WIRELESS_SITE_BASED_FEES_1102 = Object.freeze({
  cite:        '47 CFR §1.1102 (site-based license applications)',
  verified_at: '2026-07-03',
  new_or_major_mod_usd: 105,
  renewal_usd:           35,
  sta_usd:              150
});

// ─── Antenna Structure Registration — Form 854 ──────────────────────────
// The current §1.1102 schedule contains NO ASR row: Form 854 carries no
// FCC filing fee (the pre-2020 $130/$175 fees no longer apply).  FAA
// aeronautical study / consultant costs are separate private costs.
export const ASR_FORM_854_FEE = Object.freeze({
  cite:        '47 CFR §1.1102 (no ASR row in current schedule)',
  verified_at: '2026-07-03',
  filing_fee_usd: 0
});

// ─── Annual regulatory fees — 47 CFR §1.1153 ────────────────────────────
// POPULATION-TIERED per class; nine brackets.  There is no flat per-class
// AM fee in the current schedule.
export const ANNUAL_REG_FEES_1153 = Object.freeze({
  cite:        '47 CFR §1.1153',
  fr_citation: '89 FR 78509',
  effective:   '2024-09-25',
  verified_at: '2026-07-03',
  tier_upper_bounds: Object.freeze([10000, 25000, 75000, 150000, 500000, 1200000, 3000000, 6000000]),
  tier_labels: Object.freeze([
    '≤10,000', '10,001–25,000', '25,001–75,000', '75,001–150,000', '150,001–500,000',
    '500,001–1,200,000', '1,200,001–3,000,000', '3,000,001–6,000,000', '>6,000,000'
  ]),
  am_tiers_usd: Object.freeze({
    A: Object.freeze([560, 935, 1405, 2105, 3160, 4730, 7105, 10650, 15980]),
    B: Object.freeze([405, 675, 1015, 1520, 2280, 3415, 5130,  7690, 11535]),
    C: Object.freeze([350, 585,  880, 1315, 1975, 2960, 4445,  6665, 10000]),
    D: Object.freeze([385, 645,  970, 1450, 2180, 3265, 4900,  7345, 11025])
  }),
  fm_tiers_usd: Object.freeze({
    'A_B1_C3':       Object.freeze([615, 1025, 1540, 2305, 3465, 5185, 7790, 11675, 17515]),
    'B_C_C0_C1_C2':  Object.freeze([700, 1170, 1755, 2635, 3955, 5920, 8890, 13325, 19995])
  }),
  am_cp_holder_usd:      585,   // unbuilt AM CP, flat
  fm_cp_holder_usd:     1025,   // unbuilt FM CP, flat
  fm_translator_usd:     245    // FM translator / LPTV / booster, flat
});

// Fee lookup: class + population served → §1.1153 fee.
// With a finite populationServed: { fee_usd, fee_low_usd, fee_high_usd (== fee_usd),
//   tier_label, population_basis }.
// With unknown population: { fee_usd: null, fee_low_usd (min tier),
//   fee_high_usd (max tier), tier_label: 'population-dependent (§1.1153 tiers)',
//   population_basis: 'not determined' } — an honest range, never a fabricated flat value.
export function amAnnualRegFeeUsd(fccClass, populationServed){
  const cls   = /^[A-D]$/i.test(String(fccClass ?? '')) ? String(fccClass).toUpperCase() : 'D';
  const tiers = ANNUAL_REG_FEES_1153.am_tiers_usd[cls];
  if (Number.isFinite(populationServed) && populationServed >= 0){
    let idx = ANNUAL_REG_FEES_1153.tier_upper_bounds.findIndex(b => populationServed <= b);
    if (idx === -1) idx = tiers.length - 1;
    return {
      fee_usd:      tiers[idx],
      fee_low_usd:  tiers[idx],
      fee_high_usd: tiers[idx],
      tier_label:   ANNUAL_REG_FEES_1153.tier_labels[idx],
      population_basis: Math.round(populationServed)
    };
  }
  return {
    fee_usd:      null,
    fee_low_usd:  tiers[0],
    fee_high_usd: tiers[tiers.length - 1],
    tier_label:   'population-dependent (§1.1153 tiers)',
    population_basis: 'not determined'
  };
}

// ─── AM power limits — 47 CFR §73.21 ────────────────────────────────────
export const AM_POWER_LIMITS_73_21 = Object.freeze({
  cite:        '47 CFR §73.21',
  verified_at: '2026-07-03',
  day_kw: Object.freeze({
    A: Object.freeze({ min: 10,   max: 50 }),   // §73.21(a)
    B: Object.freeze({ min: 0.25, max: 50 }),   // §73.21(b)(1); 10 kW max in 1605–1705 kHz expanded band
    C: Object.freeze({ min: 0.25, max: 1  }),   // §73.21(c)
    D: Object.freeze({ min: 0.25, max: 50 })    // §73.21(b)(2)
  }),
  night_kw: Object.freeze({
    A: 50,
    B: 50,
    C: 1,
    D: 0.25            // §73.21(b)(2): "< 0.25 kW" where authorized (PSSA ≤ 500 W is §73.99)
  }),
  pssa_max_w: 500      // §73.99 post-sunset authority power ceiling
});

// ─── AM protection ratios — 47 CFR §73.182 ──────────────────────────────
export const AM_DU_RATIOS_73_182 = Object.freeze({
  cite:        '47 CFR §73.182',
  verified_at: '2026-07-03',
  co_channel_db:       26,   // 20:1 field ratio, all classes, day and night
  first_adjacent_db:    6,   // ±10 kHz (2:1)
  second_adjacent_db:   0,   // ±20 kHz
  night_second_adjacent_db: -26,
  night_third_adjacent_db:  -50
});

// ─── FM protected contours — 47 CFR §73.215(a)(1) ──────────────────────
export const FM_PROTECTED_CONTOURS_73_215 = Object.freeze({
  cite:        '47 CFR §73.215(a)(1)',
  verified_at: '2026-07-03',
  B_dbu:  54,   // 0.5 mV/m
  B1_dbu: 57,   // 0.7 mV/m
  all_other_classes_dbu: 60   // 1.0 mV/m
});

// ─── RF exposure (MPE) — 47 CFR §1.1310 Table 1 (AM band rows) ──────────
export const MPE_LIMITS_1_1310 = Object.freeze({
  cite:        '47 CFR §1.1310 Table 1',
  verified_at: '2026-07-03',
  // 0.3–3.0 MHz occupational/controlled: E = 614 V/m, S = 100 mW/cm²;
  // 3–30 MHz occupational: E = 1842/f V/m, S = 900/f² mW/cm²
  // (numerators pinned as numbers for call-site formulas).
  occupational: Object.freeze({
    e_v_per_m: 614, s_mw_cm2: 100, band: '0.3–3.0 MHz',
    above_3_mhz: Object.freeze({
      e_numerator_v_per_m: 1842,  // E = 1842/f_MHz V/m
      s_numerator_mw_cm2: 900,    // S = 900/f_MHz² mW/cm²
      e_v_per_m_formula: '1842/f_MHz',
      s_mw_cm2_formula: '900/f_MHz²'
    })
  }),
  // General population: 0.3–1.34 MHz E = 614 V/m, S = 100 mW/cm²;
  // 1.34–30 MHz E = 824/f V/m, S = 180/f² mW/cm² (f in MHz).
  general_population: Object.freeze({
    below_1_34_mhz: Object.freeze({ e_v_per_m: 614, s_mw_cm2: 100 }),
    above_1_34_mhz: Object.freeze({
      e_numerator_v_per_m: 824,   // E = 824/f_MHz V/m
      s_numerator_mw_cm2: 180,    // S = 180/f_MHz² mW/cm²
      e_v_per_m_formula: '824/f_MHz',
      s_mw_cm2_formula: '180/f_MHz²'
    })
  })
});

// ─── Antenna structure registration threshold — 47 CFR §17.7 ────────────
export const ASR_THRESHOLD_17_7 = Object.freeze({
  cite:        '47 CFR §17.7',
  verified_at: '2026-07-03',
  height_m: 60.96,     // 200 ft
  height_ft: 200,
  // §17.7(c) / 14 CFR §77.9(b) airport-proximity notice radii:
  airport_long_runway_ft:  20000,   // runway > 3,200 ft (100:1 surface)
  airport_short_runway_ft: 10000,   // runway ≤ 3,200 ft (50:1 surface)
  heliport_ft:              5000    // 25:1 surface
});

// All catalogs, for the freshness test to iterate.
export const ALL_REGULATORY_CATALOGS = Object.freeze({
  APPLICATION_FEES_1104,
  WIRELESS_SITE_BASED_FEES_1102,
  ASR_FORM_854_FEE,
  ANNUAL_REG_FEES_1153,
  AM_POWER_LIMITS_73_21,
  AM_DU_RATIOS_73_182,
  FM_PROTECTED_CONTOURS_73_215,
  MPE_LIMITS_1_1310,
  ASR_THRESHOLD_17_7
});
