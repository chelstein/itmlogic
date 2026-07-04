// Regulatory-constants catalog: value pinning + freshness gate.
//
// Two jobs:
//   1. Pin every catalog value to the CFR amounts transcribed from the
//      codified rule text (§1.1104 per 90 FR 17013; §1.1153 per
//      89 FR 78509; §73.21; §73.182; §73.215(a)(1); §1.1310; §17.7).
//      A drive-by edit to any constant fails here first.
//   2. FRESHNESS GATE: every catalog carries verified_at — the date the
//      values were last checked against the codified CFR.  When any
//      verified_at is older than MAX_VERIFICATION_AGE_DAYS this suite
//      FAILS THE BUILD, forcing re-verification instead of silent
//      schedule drift.  (The 2026 audit found the prior "FY2024" fee
//      set was two amendment cycles stale despite being internally
//      consistent and fully cited.)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VERIFICATION_AGE_DAYS,
  APPLICATION_FEES_1104,
  WIRELESS_SITE_BASED_FEES_1102,
  ASR_FORM_854_FEE,
  ANNUAL_REG_FEES_1153,
  AM_POWER_LIMITS_73_21,
  AM_DU_RATIOS_73_182,
  FM_PROTECTED_CONTOURS_73_215,
  MPE_LIMITS_1_1310,
  ASR_THRESHOLD_17_7,
  ALL_REGULATORY_CATALOGS,
  amAnnualRegFeeUsd
} from '../engine/regulatory/regulatoryConstants.js';

/* ───────────────────────── freshness gate ───────────────────────── */

test('FRESHNESS GATE: every regulatory catalog re-verified within the ceiling', () => {
  const now = Date.now();
  const stale = [];
  for (const [name, cat] of Object.entries(ALL_REGULATORY_CATALOGS)){
    assert.ok(cat.verified_at, `${name} must carry verified_at`);
    const ageDays = (now - Date.parse(cat.verified_at)) / 86_400_000;
    assert.ok(Number.isFinite(ageDays) && ageDays >= 0, `${name}.verified_at must be a valid past date`);
    if (ageDays > MAX_VERIFICATION_AGE_DAYS) stale.push(`${name} (verified ${cat.verified_at}, ${Math.round(ageDays)} days ago)`);
  }
  assert.deepEqual(stale, [],
    `STALE REGULATORY CONSTANTS — re-verify against the codified CFR (eCFR) and update verified_at: ${stale.join('; ')}. ` +
    `Application fees are CPI-adjusted and annual fees turn over every fiscal year; do not extend the ceiling instead of re-verifying.`);
});

test('every catalog names its CFR citation', () => {
  for (const [name, cat] of Object.entries(ALL_REGULATORY_CATALOGS)){
    assert.match(String(cat.cite || ''), /47 CFR §/, `${name}.cite must name the 47 CFR section`);
  }
});

/* ─────────────────── §1.1104 application fees ───────────────────── */

test('§1.1104 AM application fees match 90 FR 17013', () => {
  const am = APPLICATION_FEES_1104.am;
  assert.equal(am.major_change_cp_usd,         4675);
  assert.equal(am.major_change_cp_auction_usd, 5350);
  assert.equal(am.minor_modification_cp_usd,   1910);
  assert.equal(am.license_to_cover_usd,         755);
  assert.equal(am.directional_antenna_usd,     1480);
  assert.equal(am.renewal_usd,                  365);
  assert.equal(am.assignment_long_form_usd,    1180);
  assert.equal(am.assignment_short_form_usd,    500);
  assert.equal(am.call_sign_usd,                190);
  assert.equal(am.sta_usd,                      325);
  assert.equal(am.biennial_ownership_usd,        95);
  assert.equal(APPLICATION_FEES_1104.fr_citation, '90 FR 17013');
});

test('§1.1104 FM + translator fees match 90 FR 17013', () => {
  assert.equal(APPLICATION_FEES_1104.fm.major_change_cp_usd,       3870);
  assert.equal(APPLICATION_FEES_1104.fm.minor_modification_cp_usd, 1485);
  assert.equal(APPLICATION_FEES_1104.fm.license_to_cover_usd,       275);
  assert.equal(APPLICATION_FEES_1104.fm.directional_antenna_usd,    705);
  assert.equal(APPLICATION_FEES_1104.fm_translator.major_change_cp_usd, 830);
});

test('Part 74 STL site-based fees and Form 854 no-fee status', () => {
  assert.equal(WIRELESS_SITE_BASED_FEES_1102.new_or_major_mod_usd, 105);
  assert.equal(WIRELESS_SITE_BASED_FEES_1102.renewal_usd,           35);
  assert.equal(WIRELESS_SITE_BASED_FEES_1102.sta_usd,              150);
  assert.equal(ASR_FORM_854_FEE.filing_fee_usd, 0,
    'Form 854 carries no FCC filing fee under the current §1.1102 schedule');
});

/* ─────────────────── §1.1153 annual regulatory fees ─────────────── */

test('§1.1153 AM tier tables match 89 FR 78509 (all 36 cells)', () => {
  const t = ANNUAL_REG_FEES_1153.am_tiers_usd;
  assert.deepEqual([...t.A], [560, 935, 1405, 2105, 3160, 4730, 7105, 10650, 15980]);
  assert.deepEqual([...t.B], [405, 675, 1015, 1520, 2280, 3415, 5130,  7690, 11535]);
  assert.deepEqual([...t.C], [350, 585,  880, 1315, 1975, 2960, 4445,  6665, 10000]);
  assert.deepEqual([...t.D], [385, 645,  970, 1450, 2180, 3265, 4900,  7345, 11025]);
  assert.equal(ANNUAL_REG_FEES_1153.am_cp_holder_usd,   585);
  assert.equal(ANNUAL_REG_FEES_1153.fm_cp_holder_usd,  1025);
  assert.equal(ANNUAL_REG_FEES_1153.fm_translator_usd,  245);
});

test('§1.1153 tier structure: 8 bounds, 9 labels, strictly ascending fees per class', () => {
  assert.equal(ANNUAL_REG_FEES_1153.tier_upper_bounds.length, 8);
  assert.equal(ANNUAL_REG_FEES_1153.tier_labels.length, 9);
  for (const [cls, tiers] of Object.entries(ANNUAL_REG_FEES_1153.am_tiers_usd)){
    assert.equal(tiers.length, 9, `AM Class ${cls} must have 9 tiers`);
    for (let i = 1; i < tiers.length; i++){
      assert.ok(tiers[i] > tiers[i - 1], `AM Class ${cls} tiers must ascend (index ${i})`);
    }
  }
});

test('amAnnualRegFeeUsd: tier selection by population served', () => {
  assert.equal(amAnnualRegFeeUsd('D', 9000).fee_usd,      385);   // ≤10,000
  assert.equal(amAnnualRegFeeUsd('D', 10000).fee_usd,     385);   // boundary inclusive
  assert.equal(amAnnualRegFeeUsd('D', 10001).fee_usd,     645);   // next tier
  assert.equal(amAnnualRegFeeUsd('A', 7_000_000).fee_usd, 15980); // >6M top tier
  assert.equal(amAnnualRegFeeUsd('B', 400_000).fee_usd,   2280);  // 150,001–500,000
});

test('amAnnualRegFeeUsd: unknown population yields an honest range, not a fabricated flat value', () => {
  const r = amAnnualRegFeeUsd('D', null);
  assert.equal(r.fee_usd, null);
  assert.equal(r.fee_low_usd,   385);
  assert.equal(r.fee_high_usd, 11025);
  assert.equal(r.population_basis, 'not determined');
  assert.match(r.tier_label, /population-dependent/);
});

/* ─────────────────── engineering constants ─────────────────────── */

test('§73.21 AM power limits', () => {
  assert.deepEqual(AM_POWER_LIMITS_73_21.day_kw.D, { min: 0.25, max: 50 });
  assert.deepEqual(AM_POWER_LIMITS_73_21.day_kw.C, { min: 0.25, max: 1 });
  assert.equal(AM_POWER_LIMITS_73_21.night_kw.D, 0.25);
  assert.equal(AM_POWER_LIMITS_73_21.pssa_max_w, 500);
});

test('§73.182 D/U ratios', () => {
  assert.equal(AM_DU_RATIOS_73_182.co_channel_db,     26);
  assert.equal(AM_DU_RATIOS_73_182.first_adjacent_db,  6);
  assert.equal(AM_DU_RATIOS_73_182.second_adjacent_db, 0);
});

test('§73.215(a)(1) FM protected contours', () => {
  assert.equal(FM_PROTECTED_CONTOURS_73_215.B_dbu,  54);
  assert.equal(FM_PROTECTED_CONTOURS_73_215.B1_dbu, 57);
  assert.equal(FM_PROTECTED_CONTOURS_73_215.all_other_classes_dbu, 60);
});

test('§1.1310 MPE limits (AM band) and §17.7 ASR thresholds', () => {
  assert.equal(MPE_LIMITS_1_1310.occupational.e_v_per_m, 614);
  assert.equal(MPE_LIMITS_1_1310.occupational.s_mw_cm2,  100);
  assert.equal(MPE_LIMITS_1_1310.general_population.below_1_34_mhz.e_v_per_m, 614);
  assert.equal(ASR_THRESHOLD_17_7.height_m, 60.96);
  assert.equal(ASR_THRESHOLD_17_7.airport_long_runway_ft,  20000);
  assert.equal(ASR_THRESHOLD_17_7.airport_short_runway_ft, 10000);
  assert.equal(ASR_THRESHOLD_17_7.heliport_ft,              5000);
});
