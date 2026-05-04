// Genoa adapter for the vendored FCC contours-api-node tvfm_curves.js.
//
// PURPOSE
//   Expose the FCC's canonical FM/TV propagation-curve computation
//   (F(50,50) / F(50,10) / F(50,90)) under a clean Genoa-shaped surface
//   without leaking the FCC code's CommonJS / 8-positional-argument
//   calling convention into the rest of the engine.
//
// PROVENANCE
//   See ./PROVENANCE.md.  Source: github.com/fcc/contours-api-node
//   commit b55870d3f20618e886cd02379008ef980229d44b, file
//   controllers/tvfm_curves.js, sha256 58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// The FCC code emits a debug console.log on every entry into
// tvfmfs_metric().  Silence it ONLY around our calls so server logs
// stay readable; we restore the original after each call.
const _origLog = console.log;
const _silent  = () => {};

const fcc = require('./tvfm_curves.js');

// fcc.tvfmfs_metric signature:
//   tvfmfs_metric(erp, haat, channel, field, distance, fs_or_dist, curve, flag)
//
//   fs_or_dist:
//     1 → compute field   (returns dBu given distance)
//     2 → compute distance (returns km  given dBu)        ← Genoa uses this
//     3 → compute ERP     (returns kW  given distance + dBu)
//   curve:
//     0 → F(50,50)
//     1 → F(50,10)
//     2 → F(50,90)
//   channel:
//     2..6   → Low VHF
//     7..13  → High VHF
//     14..83 → UHF
//     200..300 → FM (88..108 MHz)  ← FM uses Low-VHF tables
//   flag: out parameter (array of 19 ints).  flag[1..19] != 0 → input or
//         range error; we surface a structured error in that case.

const CURVE_F5050 = 0;
const CURVE_F5010 = 1;
const CURVE_F5090 = 2;

const FS_OR_DIST_FIELD    = 1;
const FS_OR_DIST_DISTANCE = 2;
const FS_OR_DIST_ERP      = 3;

// Map an FM frequency in MHz to an FCC FM channel number (200..300)
// per 47 CFR §73.201.  88.1 MHz = channel 201, 100.1 = 261, etc.
//   channel = round((frequency_mhz - 87.9) / 0.2) + 200
// Returns 200 (88.1) for FM frequencies even slightly outside band; the
// FCC code itself accepts 200..300 and gates ERP/HAAT separately.
export function fmFrequencyToChannel(frequency_mhz){
  const f = Number(frequency_mhz);
  if (!Number.isFinite(f)) return 261;            // ~100.1 MHz default
  const ch = Math.round((f - 87.9) / 0.2) + 200;
  return Math.max(200, Math.min(300, ch));
}

// Compute distance (km) at which the engine reaches `target_dBu` for a
// given `erp_kw` and `haat_m`.  Returns:
//   { distance_km, source: 'fcc-tvfm_curves', flags: [...] }
// Throws an Error when the FCC routine flags an input/range failure
// that makes the result unreliable.
export function fccDistanceKm({
  haat_m,
  target_dBu,
  erp_kw,
  mode = '50,50',
  channel = null,
  frequency_mhz = null
}){
  const ch = channel ?? (frequency_mhz != null ? fmFrequencyToChannel(frequency_mhz) : 261);
  const curve = mode === '50,10' ? CURVE_F5010
              : mode === '50,90' ? CURVE_F5090
              :                    CURVE_F5050;
  const flag = new Array(19).fill(0);

  // The FCC fn returns the computed distance in km (positive) when
  // fs_or_dist === 2 succeeds.  When inputs are out of range it sets
  // entries in `flag` (1..18) and may early-return 0 / NaN.
  console.log = _silent;
  let result;
  try {
    result = fcc.tvfmfs_metric(
      Number(erp_kw),       // erp (kW)
      Number(haat_m),       // haat (m)
      Number(ch),           // channel
      Number(target_dBu),   // field (dBu) — input for fs_or_dist=2
      0,                    // distance — placeholder; FCC fills via curve walk
      FS_OR_DIST_DISTANCE,  // fs_or_dist = 2 → return distance
      curve,                // 0/1/2
      flag                  // out: 19-element array
    );
  } finally {
    console.log = _origLog;
  }

  // flag[3]  → channel out of range
  // flag[5]  → fs_or_dist invalid
  // flag[6]  → erp < 0.0001 (clamped)
  // flag[9]  → negative input (auto-abs)
  // flag[15] → distance > 300 km on F(50,50) / F(50,90)
  // flag[16] → distance > 500 km on F(50,10)
  // Most are warnings, not failures.  The hard-fail markers are
  // flag[3] (channel) and flag[5] (mode).
  if (flag[3]){
    throw Object.assign(new Error('FCC: channel out of range'), { code: 'FCC_CHANNEL_OUT_OF_RANGE', flag });
  }
  if (flag[5]){
    throw Object.assign(new Error('FCC: fs_or_dist invalid'), { code: 'FCC_FSDIST_INVALID', flag });
  }
  if (!Number.isFinite(result) || result <= 0){
    throw Object.assign(new Error('FCC: tvfmfs_metric returned non-positive distance'), { code: 'FCC_NO_RESULT', flag, result });
  }

  return {
    distance_km: Number(result),
    source:      'fcc-tvfm_curves',
    method:      curve === CURVE_F5050 ? '47 CFR §73.333 F(50,50)' :
                 curve === CURVE_F5010 ? '47 CFR §73.333 F(50,10)' :
                                          '47 CFR §73.333 F(50,90)',
    channel:     ch,
    flags:       flag.slice(0, 19),
    upstream: {
      repo:   'github.com/fcc/contours-api-node',
      commit: 'b55870d3f20618e886cd02379008ef980229d44b',
      file:   'controllers/tvfm_curves.js',
      sha256: '58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a'
    }
  };
}

export const FCC_PROVENANCE = Object.freeze({
  repo:    'github.com/fcc/contours-api-node',
  commit:  'b55870d3f20618e886cd02379008ef980229d44b',
  file:    'controllers/tvfm_curves.js',
  sha256:  '58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a',
  vendor_path: 'src/engine/curves/fcc/tvfm_curves.js',
  vendored_at: '2026-05-04',
  license_basis: '17 U.S.C. § 105 — US Government work product, public domain in the United States'
});
