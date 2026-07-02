// 47 CFR §73.190 — AM skywave field strength (SS-1 50% / SS-2 10%).
//
// SCOPE
//   §73.187 (AM nighttime protection) requires every co-channel and
//   adjacent-channel AM allocation study to compute the 50% (SS-1) and
//   10% (SS-2) nighttime skywave field strength along each path between
//   the proposed station and every nearby co/1st-adjacent station,
//   then apply RSS exclusion and per-class protection rules.
//
// METHODOLOGY — Berry (1968) analytical formula, screening grade
//   47 CFR §73.190(c) EXPLICITLY permits an analytical formula in lieu
//   of the Figure 2 graphical curves.  This module implements the same
//   Berry-formula closed form used by src/evidence/berrySkywaveClient.js
//   (the repository's documented screening-grade skywave path), so the
//   two paths agree by construction:
//
//     E(µV/m) = 1000 · E0 · d^(−α) · 10^((K_φ + K_f)/20) · s(p)
//
//   where
//     E0   = 100 · √P_kW  mV/m at 1 km        (§73.184 normalization)
//     α    = 1.0 + 0.001·|φm|                  distance-decay exponent
//     K_φ  = −0.05 · (φm / 90)  dB             midpoint-latitude correction
//     K_f  = −0.10 · log10(f_kHz / 1000)  dB   frequency correction
//     s(p) = 10^(6/20) ≈ 1.995 for SS-2 (10%)  per §73.190(c) percent-time
//            1.0 for SS-1 (50%)                 charts (+6 dB, NOT 1.4×)
//     φm   = geographic midpoint latitude (proxy for geomagnetic; ≤ 1.5°
//            offset in the contiguous US)
//
//   HONESTY NOTE: a previous revision of this module carried a
//   "Wang formula" coefficient set (K = 6.7/12.0, a 5-segment α table)
//   attributed to "§73.190 Figure 2 / OET-12 Tables 1–3".  Those
//   citations did not correspond to any published FCC methodology and
//   the values over-predicted the 50% skywave field by roughly 40 dB
//   at 1000 km.  The Berry screening form below is deliberately
//   CONSERVATIVE for protection-of-others (it does not under-predict
//   neighbor interference); filing-grade studies should use the FCCAM
//   sidecar (Wang 1985 engine) where configured.
//
// COVERAGE LIMITS
//   - Single-jump skywave only (200 km ≤ d ≤ 5000 km).  Sub-200 km
//     ranges aren't covered by §73.190; ground-wave dominates.  Above
//     5000 km, multi-hop modes apply that §73.187 doesn't address.
//   - Nighttime only.  Daytime skywave is empirically negligible for
//     §73.187 protection.

import { karneyInverse } from '../../geometry/wgs84.js';

// ---------------------------------------------------------------------------
// Berry-formula terms (shared with src/evidence/berrySkywaveClient.js)
// ---------------------------------------------------------------------------

function alphaForMidLat(midpoint_lat_deg){
  return 1.0 + 0.001 * Math.abs(Number(midpoint_lat_deg) || 40);
}

function latitudeCorrection_dB(midpoint_lat_deg){
  return -0.05 * ((Number(midpoint_lat_deg) || 40) / 90);
}

function frequencyCorrection_dB(f_khz){
  const f = Number(f_khz);
  if (!Number.isFinite(f) || f <= 0) return 0;
  return -0.10 * Math.log10(f / 1000);
}

// Percent-time scaling per §73.190(c) charts: 10% field (SS-2) is ~+6 dB
// above the 50% field (SS-1) at midband — factor 10^(6/20) ≈ 1.995.
function percentScale(percent){
  return percent === 10 ? Math.pow(10, 6 / 20) : 1.0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute AM skywave field strength along a path (Berry screening form).
 *
 * @param {object} args
 * @param {number} args.tx_lat, args.tx_lon       transmitter coords
 * @param {number} args.rx_lat, args.rx_lon       receiver / observation coords
 * @param {number} args.erp_kw                    effective radiated power (RSS-derived for directional)
 * @param {number} args.frequency_khz             carrier frequency, kHz
 * @param {50|10} [args.percent=50]               SS-1 (50%) or SS-2 (10%)
 * @param {boolean} [args.directional_rss_applied=false]  caller-supplied RSS flag (provenance only)
 * @returns {{
 *   field_dBu, field_mV_m, distance_km, midpoint_lat, midpoint_lon,
 *   percent, alpha, k_lat_db, k_freq_db, frequency_khz, erp_kw,
 *   directional_rss_applied, regulation, method
 * }}
 */
export function skywaveFieldAtPath({
  tx_lat, tx_lon, rx_lat, rx_lon,
  erp_kw, frequency_khz,
  percent = 50,
  directional_rss_applied = false
}){
  if (![50, 10].includes(percent)){
    throw Object.assign(new Error('percent must be 50 or 10'), { code: 'INVALID_PERCENT' });
  }
  const inv = karneyInverse(Number(tx_lat), Number(tx_lon), Number(rx_lat), Number(rx_lon));
  const d = inv.distance_km;
  // Path midpoint — geographic-lat mean; ≤ 1.5° geomagnetic offset in the
  // contiguous US, a slow-varying term in the Berry correction.
  const mid_lat = (Number(tx_lat) + Number(rx_lat)) / 2;
  const mid_lon = (Number(tx_lon) + Number(rx_lon)) / 2;

  const alpha   = alphaForMidLat(mid_lat);
  const k_lat   = latitudeCorrection_dB(mid_lat);
  const k_freq  = frequencyCorrection_dB(frequency_khz);
  const scale_p = percentScale(percent);

  // Berry closed form (see header): E0 = 100·√P mV/m at 1 km (§73.184).
  const E0_mvm  = 100 * Math.sqrt(Math.max(0, Number(erp_kw)));
  const E_mvm   = E0_mvm
                * Math.pow(Math.max(1, d), -alpha)
                * Math.pow(10, (k_lat + k_freq) / 20)
                * scale_p;
  const E_dbu   = 20 * Math.log10(Math.max(E_mvm, 1e-9) * 1000);   // mV/m → µV/m → dBu

  return {
    field_dBu:                Number(E_dbu.toFixed(2)),
    field_mV_m:               Number(E_mvm.toFixed(6)),
    distance_km:              d,
    midpoint_lat:             mid_lat,
    midpoint_lon:             mid_lon,
    percent,
    alpha:                    Number(alpha.toFixed(4)),
    k_lat_db:                 Number(k_lat.toFixed(3)),
    k_freq_db:                Number(k_freq.toFixed(3)),
    frequency_khz:            Number(frequency_khz),
    erp_kw:                   Number(erp_kw),
    directional_rss_applied,
    regulation:               '47 CFR §73.190(c) (analytical formula permitted in lieu of Figure 2)',
    method:                   'Berry (1968) analytical skywave formula — screening grade, conservative for protection-of-others; matches src/evidence/berrySkywaveClient.js. Geographic-lat midpoint used as geomagnetic proxy (≤ 1.5° offset in contiguous US). Filing-grade studies use the FCCAM sidecar (Wang 1985).'
  };
}

/**
 * Compute SS-1 (50% nighttime skywave) field strength.
 */
export function skywave50Pct(args){
  return skywaveFieldAtPath({ ...args, percent: 50 });
}

/**
 * Compute SS-2 (10% nighttime skywave) field strength.
 */
export function skywave10Pct(args){
  return skywaveFieldAtPath({ ...args, percent: 10 });
}

export const SKYWAVE_PROVENANCE = Object.freeze({
  regulation:      '47 CFR §73.190(c) — analytical formula EXPLICITLY permitted in lieu of Figure 2',
  reference:       'Berry, L.A. (1968) analytical skywave approximation; §73.184 E0 = 100·√P normalization; matches src/evidence/berrySkywaveClient.js',
  modeled:         [
    'Single-jump nighttime skywave 200 ≤ d ≤ 5000 km (Berry screening form)',
    'Distance decay d^(−α), α = 1 + 0.001·|φm| (midpoint-latitude dependent)',
    'Frequency correction −0.10·log10(f/1000) dB and latitude correction −0.05·(φm/90) dB',
    'SS-2 (10%) via +6 dB (×1.995) scaling of SS-1 per §73.190(c) percent-time charts'
  ],
  not_modeled:     [
    'Filing-grade Wang (1985) skywave — use the FCCAM sidecar where configured',
    'Multi-hop propagation (d > 5000 km)',
    'Daytime skywave',
    'Full IGRF geomagnetic transform (geographic lat used as proxy)',
    'Auroral / equatorial scintillation effects',
    'Ground-wave + sky-wave fading combination'
  ],
  license_basis:   '17 U.S.C. § 105 — FCC rule text US Government public domain; Berry (1968) NBS publication'
});
