// 47 CFR §73.99 — Pre-Sunrise / Post-Sunset Authority (PSRA/PSSA).
//
// REGULATION
//   §73.99(a) — Class B, C, and D AM stations licensed for daytime-only
//   or limited-time operation may operate during the Pre-Sunrise hours
//   (6:00 a.m. local time to local sunrise) and Post-Sunset hours
//   (local sunset to 6:00 p.m. local time) at REDUCED power, calculated
//   to limit interference to other stations.
//
//   §73.99(b)(1) — power for PSRA/PSSA is computed via a §73.99
//   formula that takes the station's daytime ERP, the nighttime
//   skywave RSS contribution from each interfering station along the
//   path, and a class-pair-specific protection ratio.  Reduced power
//   is capped at 500 W for both PSRA and PSSA.
//
//   Operating mode at any moment is one of:
//
//     daytime    sunrise          → sunset                  full ERP
//     pssa       sunset           → sunset + 2 hours        §73.99 reduced power
//     nighttime  sunset + 2 h     → next-day 6 AM local     0 W (or licensed night ERP for full-time stations)
//     psra       local 6 AM       → sunrise                 §73.99 reduced power
//
//   PSRA commences at 6:00 a.m. LOCAL TIME regardless of how late
//   sunrise is (§73.99 limits the POWER, not the window), and PSSA
//   runs for two hours after sunset with no fixed-clock cap.
//
//   §73.99(e) — "Local time" means the standard time of the
//   transmitter site's FCC timezone code.  FCC authorizations do NOT
//   follow Daylight Saving by default; operator may file for DST
//   adjustment per §73.1209(b).
//
// SCOPE OF THIS MODULE
//
//   This module implements the TIME-WINDOW + MODE-DISPOSITION layer:
//     - Given sunrise + sunset (from src/evidence/fccSunClient.js +
//       the FCC SRSSTIME sidecar), build the 4 windows.
//     - Given an optional "now" wall-clock-local time, classify the
//       current mode.
//
//   It does NOT compute the §73.99 reduced power formula yet — that
//   requires per-interferer nighttime skywave RSS contributions
//   (FCCAM call chain).  Once the PSRA/PSSA power engine ships, it
//   will consume the windows + mode this module emits.  Keeping the
//   two layers separate so the windows can be rendered in the AM
//   Sunrise/Sunset Authority panel without paying the FCCAM fan-out
//   latency.

const LOCAL_MORNING_BOUNDARY_HHMM = '06:00';   // §73.99 start of PSRA (6 a.m. local)
const PSSA_DURATION_MINUTES       = 120;       // §73.99 PSSA: sunset → sunset + 2 hours

/**
 * @param {string} hhmm   "HH:MM" 24-hour local time
 * @returns {number}      minutes since local midnight (0..1439), NaN on bad input
 */
export function hhmmToMinutes(hhmm){
  const m = String(hhmm ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = Number(m[1]); const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return NaN;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return NaN;
  return h * 60 + mm;
}

/**
 * @param {number} minutes  since local midnight
 * @returns {string}        "HH:MM" 24-hour
 */
export function minutesToHhmm(minutes){
  if (!Number.isFinite(minutes)) return '—';
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h  = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Build the §73.99 daytime / PSRA / PSSA / nighttime windows for a
 * given sunrise/sunset pair.  All times are in the station's
 * standard local time (FCC tz code per §73.99(e)).
 *
 * @param {object} input
 * @param {string} input.sunrise        "HH:MM" local
 * @param {string} input.sunset         "HH:MM" local
 * @param {string} [input.timezone_label]
 * @returns {{
 *   ok: boolean,
 *   sunrise: string, sunset: string,
 *   windows: {
 *     daytime:   { start, end, duration_minutes },
 *     pssa:      { start, end, duration_minutes, applicable },
 *     nighttime: { start, end, duration_minutes },
 *     psra:      { start, end, duration_minutes, applicable }
 *   },
 *   regulation: '47 CFR §73.99 / §73.1209'
 * }}
 */
export function buildPsraPssaWindows({ sunrise, sunset, timezone_label = null } = {}){
  const srMin = hhmmToMinutes(sunrise);
  const ssMin = hhmmToMinutes(sunset);
  if (!Number.isFinite(srMin) || !Number.isFinite(ssMin)){
    return { ok: false, error: 'sunrise and sunset must be "HH:MM" 24-hour strings' };
  }
  if (srMin >= ssMin){
    return { ok: false, error: `sunrise ${sunrise} must precede sunset ${sunset}` };
  }
  const morningBoundary = hhmmToMinutes(LOCAL_MORNING_BOUNDARY_HHMM);  // 360

  // PSRA: 6 AM local → local sunrise (§73.99).  The window commences at
  // 6:00 a.m. local time regardless of how late sunrise is — the rule
  // limits the operating POWER, not the window length.  When sunrise is
  // at/before 6 AM the window is empty (station is already in daytime).
  const psraStart = morningBoundary;
  const psraEnd   = srMin;
  const psraDur   = Math.max(0, psraEnd - psraStart);
  const psraApplicable = psraDur > 0;

  // PSSA: local sunset → two hours after sunset (§73.99).  There is no
  // fixed-clock (6 PM) cap; a 20:30 summer sunset yields a 20:30→22:30
  // window.  End time may pass midnight at extreme latitudes; the HH:MM
  // rendering wraps.
  const pssaStart = ssMin;
  const pssaEnd   = ssMin + PSSA_DURATION_MINUTES;
  const pssaDur   = PSSA_DURATION_MINUTES;
  const pssaApplicable = true;

  // Daytime: sunrise → sunset (full ERP).
  const dayDur = ssMin - srMin;

  // Nighttime: end of PSSA (sunset + 2 h) → next-day 6 AM local (start
  // of PSRA), or → sunrise when sunrise is at/before 6 AM.  Wraps
  // midnight so we report it as two-arc; duration is straightforward.
  const nightStart = pssaEnd % 1440;
  const nightEnd   = Math.min(morningBoundary, srMin);
  const nightDur   = ((nightEnd - nightStart) % 1440 + 1440) % 1440;

  return {
    ok:        true,
    sunrise,   sunset,
    timezone_label,
    windows: {
      daytime:   { start: minutesToHhmm(srMin), end: minutesToHhmm(ssMin),
                   duration_minutes: dayDur },
      pssa:      { start: minutesToHhmm(pssaStart), end: minutesToHhmm(pssaEnd),
                   duration_minutes: pssaDur, applicable: pssaApplicable,
                   note: null },
      nighttime: { start: minutesToHhmm(nightStart), end: minutesToHhmm(nightEnd),
                   duration_minutes: nightDur,
                   wraps_midnight: nightStart > nightEnd },
      psra:      { start: minutesToHhmm(psraStart), end: minutesToHhmm(psraEnd),
                   duration_minutes: psraDur, applicable: psraApplicable,
                   note: psraApplicable ? null
                         : 'sunrise is at/before 6 AM local — no PSRA window' }
    },
    regulation: '47 CFR §73.99 / §73.1209'
  };
}

/**
 * Classify the current §73.99 operating mode given a wall-clock
 * local time and the windows from buildPsraPssaWindows().
 *
 * @param {object} windowsPayload   output of buildPsraPssaWindows()
 * @param {string} nowHhmm          current local time "HH:MM"
 * @returns {{
 *   mode: 'daytime' | 'psra' | 'pssa' | 'nighttime' | 'unknown',
 *   in_window: { start, end, duration_minutes, applicable? },
 *   notes: string[]
 * }}
 */
export function classifyMode(windowsPayload, nowHhmm){
  const notes = [];
  if (!windowsPayload || !windowsPayload.ok){
    return { mode: 'unknown', in_window: null, notes: ['windowsPayload missing or invalid'] };
  }
  const now = hhmmToMinutes(nowHhmm);
  if (!Number.isFinite(now)){
    return { mode: 'unknown', in_window: null, notes: [`bad nowHhmm "${nowHhmm}"`] };
  }
  const w   = windowsPayload.windows;
  const sr  = hhmmToMinutes(windowsPayload.sunrise);
  const ss  = hhmmToMinutes(windowsPayload.sunset);
  const mb  = hhmmToMinutes(LOCAL_MORNING_BOUNDARY_HHMM);
  const pssaEnd = ss + PSSA_DURATION_MINUTES;   // may pass midnight at extreme latitudes

  // Daytime: sunrise ≤ now < sunset
  if (now >= sr && now < ss){
    return { mode: 'daytime', in_window: w.daytime, notes };
  }
  // PSSA: sunset ≤ now < sunset + 2 h (§73.99 — no fixed-clock cap).
  // Handle the end-past-midnight case (pssaEnd > 1440) by also matching
  // early-morning times before the wrapped end.
  if (now >= ss && now < pssaEnd){
    return { mode: 'pssa', in_window: w.pssa, notes };
  }
  if (pssaEnd > 1440 && now < pssaEnd - 1440){
    return { mode: 'pssa', in_window: w.pssa, notes };
  }
  // PSRA: 6 AM ≤ now < sunrise (only when sunrise is after 6 AM)
  if (w.psra.applicable && now >= mb && now < sr){
    return { mode: 'psra', in_window: w.psra, notes };
  }
  // Nighttime: everything else — from sunset + 2 h to 6 AM (or sunrise
  // when sunrise is at/before 6 AM), wrapping midnight.
  return { mode: 'nighttime', in_window: w.nighttime, notes };
}

/**
 * Convenience: build the full 12-month PSRA/PSSA schedule from the
 * sun sidecar's monthly payload (output of /api/am/sun).  Returns
 * one row per month with the windows for that month's
 * sunrise/sunset pair.  Useful for the AM Sunrise/Sunset Authority
 * panel and the §73.1209 service-hour exhibit appendix.
 *
 * @param {object} sidecarPayload    { available, monthly: {1..12: {sunrise,sunset}} }
 * @returns {{ ok: boolean, months?: Array, error?: string }}
 */
export function buildMonthlySchedule(sidecarPayload){
  if (!sidecarPayload || sidecarPayload.available === false){
    return { ok: false, error: sidecarPayload?.error || 'sun sidecar payload unavailable' };
  }
  const monthly = sidecarPayload.monthly;
  if (!monthly || typeof monthly !== 'object'){
    return { ok: false, error: 'sun sidecar payload missing monthly block' };
  }
  const months = [];
  for (let m = 1; m <= 12; m++){
    const row = monthly[String(m)] || monthly[m] || {};
    const windows = buildPsraPssaWindows({
      sunrise:        row.sunrise,
      sunset:         row.sunset,
      timezone_label: sidecarPayload.timezone_label || null
    });
    months.push({
      month: m,
      sunrise: row.sunrise || null,
      sunset:  row.sunset  || null,
      ok:      windows.ok,
      windows: windows.ok ? windows.windows : null,
      error:   windows.ok ? null : windows.error
    });
  }
  return {
    ok: true,
    timezone_code:  sidecarPayload.timezone_code || null,
    timezone_label: sidecarPayload.timezone_label || null,
    months,
    regulation: '47 CFR §73.99 / §73.1209'
  };
}

export const PSRA_PSSA_PROVENANCE = Object.freeze({
  module:        'src/engine/am/psraPssa.js',
  regulation:    '47 CFR §73.99 (Pre-Sunrise / Post-Sunset Authority) + §73.1209 (time references = local time; §73.1209(b) DST adjustment)',
  modeled: [
    'PSRA window (6 AM local → local sunrise), applicable test',
    'PSSA window (local sunset → sunset + 2 hours)',
    'Daytime + Nighttime windows with midnight-wrap accounting',
    'Current-mode classifier (daytime / psra / pssa / nighttime)',
    'Monthly 12-row schedule builder over the sun sidecar payload'
  ],
  not_modeled: [
    '§73.99(b)(1) reduced-power formula — needs per-interferer skywave RSS (FCCAM call chain); separate module',
    'Daylight Saving Time observance — FCC default is Standard time per §73.99(e); operator filing handles overrides',
    'Limited-time / share-time operations (§73.1730 et al.) — separate framework'
  ],
  license_basis: '17 USC §105 (FCC rules, US Government public domain)'
});
