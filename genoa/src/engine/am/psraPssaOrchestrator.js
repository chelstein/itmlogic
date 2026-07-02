// AM PSRA / PSSA orchestrator — ties the four AM-night primitives
// together into a single callable for the engineering exhibit:
//
//   1. fccSunClient        — sunrise/sunset for the site + FCC tz code
//   2. psraPssa.buildPsraPssaWindows / buildMonthlySchedule
//                          — §73.99 time windows (60-row schedule)
//   3. facilityClient.getNearbyPrimaries
//                          — protected AMs within 1500 km
//   4. fccam / berry skywave + psraPower.computePsraPssaPower
//                          — §73.99(b)(1) reduced-power formula
//
// The orchestrator's job is to glue these — no new regulatory math.
// It returns a single payload the §73.99 appendix + the UI panel can
// both render verbatim.
//
// FAIL-SOFT
//   Every upstream is independently optional.  When the sun sidecar
//   is unset → windows null, power skipped, but the appendix still
//   ships the diagnostic.  Same pattern as #156's §73.182 NIF
//   orchestrator (fail-soft, not fail-fast).
//
// REGULATORY
//   - 47 CFR §73.99       — PSRA / PSSA framework
//   - 47 CFR §73.99(b)(1) — reduced-power formula (psraPower.js)
//   - 47 CFR §73.99(b)(2) — SS-1 vs SS-2 selection
//   - 47 CFR §73.182(k)   — RSS allocation (caller pre-computes share)
//   - 47 CFR §73.190(c)   — skywave engine selection

import { buildMonthlySchedule, buildPsraPssaWindows } from './psraPssa.js';
import { computePsraPssaPower } from './psraPower.js';
import { isValidAmKhz } from './band.js';
import { greatCircleKm, bearingDeg } from './skywave.js';

const DEFAULT_RADIUS_KM       = 1500;   // §73.182 reach
const DEFAULT_MAX_PROTECTED   = 25;     // budget cap on per-pair SPLAT calls
const DEFAULT_TZ              = 'B';    // EST safe default when sun sidecar unset

/**
 * Compose the §73.99 PSRA / PSSA exhibit for one AM facility.
 *
 * @param {object} input
 * @param {object} input.proposed
 *   {
 *     call, facility_id, lat, lon,
 *     freq_khz, fcc_class,
 *     p_daytime_kw,           // proposed daytime ERP
 *     timezone_code?,         // FCC code; defaults via defaultTzForLatLon
 *     pattern_table?,         // §73.150 horizontal pattern
 *     pattern_mode?: 'omni'|'DA'
 *   }
 * @param {object} [input.options]
 *   {
 *     radius_km?, max_protected?,
 *   }
 *   NOTE: per-pair permissible interference (E_max) must be supplied on the
 *   protected rows (e_max_pssa_uv_m / e_max_psra_uv_m) from the protected
 *   station's §73.182(k) nighttime-limit data.  It is NOT derived from the
 *   proposer's own field — a share of the proposer's field is circular and
 *   yields a constant reduced power regardless of the protected stations.
 * @param {object} ctx
 *   {
 *     fccamClient,    // sidecars.fccam (or Berry fallback)
 *     facilityClient, // sidecars.facility (LMS/AMQ)
 *     sunClient,      // sidecars.sun (optional)
 *     budget?         // computeBudget for per-call deadline
 *   }
 *
 * @returns {Promise<{
 *   available: boolean,
 *   sun:    { source, timezone_code, timezone_label, dms, monthly } | null,
 *   windows: { ok, windows: {daytime,psra,pssa,nighttime} } | null,
 *   monthly: { ok, months: [...] } | null,
 *   power:   { ok, pssa: {...}, psra: {...}, ceiling_w, regulation } | null,
 *   protected_pairs: [...],
 *   provenance: { ... },
 *   regulation: '47 CFR §73.99 / §73.182 / §73.190'
 * }>}
 */
export async function psraPssaExhibit(input, ctx = {}){
  const { proposed = null, options = {} } = input || {};
  const { fccamClient = null, facilityClient = null, sunClient = null, budget = null } = ctx;

  if (!proposed){
    return { available: false, error: 'proposed station required' };
  }
  if (!isValidAmKhz(Number(proposed.freq_khz))){
    return { available: false, error: 'proposed.freq_khz must be on the US AM 10-kHz grid' };
  }
  if (!Number.isFinite(Number(proposed.p_daytime_kw)) || Number(proposed.p_daytime_kw) <= 0){
    return { available: false, error: 'proposed.p_daytime_kw (kW) must be > 0' };
  }
  if (!Number.isFinite(Number(proposed.lat)) || !Number.isFinite(Number(proposed.lon))){
    return { available: false, error: 'proposed.lat + proposed.lon required' };
  }
  if (!proposed.fcc_class){
    return { available: false, error: 'proposed.fcc_class required (A/B/C/D)' };
  }

  const out = {
    available:       true,
    proposed,
    sun:             null,
    windows:         null,
    monthly:         null,
    power:           null,
    protected_pairs: [],
    regulation:      '47 CFR §73.99 / §73.182 / §73.190',
    provenance: {
      sun_engine:    sunClient ? 'fcc-srsstime' : 'unconfigured',
      skywave_engine: fccamClient
                       ? (fccamClient.isFallback ? 'berry-1968-screening' : 'fccam-wang-1985')
                       : 'unconfigured',
      facility_lms:  facilityClient ? 'fcc-amq' : 'unconfigured',
      license_basis: '17 USC §105 (FCC engine outputs, US Government public domain)'
    }
  };

  // 1. Sun sidecar — windows + monthly schedule.
  if (sunClient){
    // Resolution chain: operator-supplied → lat/lon-derived default →
    // DEFAULT_TZ.  The middle step was previously missing — a Pacific-
    // coast site with no operator timezone silently fell through to
    // EST sunrise/sunset (DEFAULT_TZ='B'), putting windows off by 3 h.
    // defaultTzForLatLon is conservative (always picks Standard-time
    // variants per §73.99); engineer can still override.
    const { defaultTzForLatLon } = await import('../../evidence/fccSunClient.js');
    const tzone = proposed.timezone_code
      || defaultTzForLatLon(proposed.lat, proposed.lon)
      || DEFAULT_TZ;
    const sun = await sunClient.fetchAmSun({
      lat: Number(proposed.lat),
      lon: Number(proposed.lon),
      tzone
    });
    if (sun?.available){
      out.sun     = sun;
      out.monthly = buildMonthlySchedule(sun);
      // Use the FIRST month with a valid sunrise/sunset as the
      // "today" windows for the power calc.  Operators can request
      // a specific month via input.options.month_for_power later.
      const idx = Math.max(0, Number(options.month_for_power) - 1) || 0;
      const monthRow = out.monthly?.months?.[idx];
      if (monthRow?.ok){
        const w = buildPsraPssaWindows({
          sunrise:        monthRow.sunrise,
          sunset:         monthRow.sunset,
          timezone_label: sun.timezone_label
        });
        if (w.ok) out.windows = w;
      }
    } else {
      out.sun = { available: false, error: sun?.error || 'sun sidecar returned available:false' };
    }
  }

  // 2. Pull protected nearby AMs.
  let protectedRows = [];
  if (facilityClient?.getNearbyPrimaries){
    const radius_km = Number(options.radius_km) || DEFAULT_RADIUS_KM;
    try {
      const pull = budget?.withDeadline
        ? await budget.withDeadline('psra_pssa_primaries',
            () => facilityClient.getNearbyPrimaries({
              lat: Number(proposed.lat),
              lon: Number(proposed.lon),
              frequency_khz: Number(proposed.freq_khz),
              service: 'AM', radius_km,
              exclude_facility_id: proposed.facility_id || null
            }), { minMs: 3_000 })
        : await facilityClient.getNearbyPrimaries({
            lat: Number(proposed.lat),
            lon: Number(proposed.lon),
            frequency_khz: Number(proposed.freq_khz),
            service: 'AM', radius_km,
            exclude_facility_id: proposed.facility_id || null
          });
      if (pull?.available) protectedRows = pull.primaries || [];
    } catch { /* swallow — appendix surfaces unavailable */ }
  }
  // Cap + sort by proximity (strongest skywave usually closest).
  const max_protected = Number(options.max_protected) || DEFAULT_MAX_PROTECTED;
  protectedRows = protectedRows
    .filter((n) => Number.isFinite(Number(n.lat)) && Number.isFinite(Number(n.lon))
                && Number.isFinite(Number(n.erp_kw)) && Number(n.erp_kw) > 0)
    .slice()
    .sort((a, b) => (Number(a.distance_km) || Infinity) - (Number(b.distance_km) || Infinity))
    .slice(0, max_protected);

  // 3. Per-pair skywave (PSSA 50% + PSRA 10%) via FCCAM/Berry.
  if (fccamClient && protectedRows.length){
    // Build a single batch request: 2 entries per pair (50% + 10%).
    const requests = [];
    for (const N of protectedRows){
      const distance_km  = greatCircleKm(proposed.lat, proposed.lon, N.lat, N.lon);
      const midpoint_lat = (Number(proposed.lat) + Number(N.lat)) / 2;
      // Both rows use the PROPOSED station's freq + ERP — we're
      // asking "what is the proposed station's skywave field at
      // N's location?" — pair identity is encoded by request order.
      requests.push({
        erp_kw:       Number(proposed.p_daytime_kw),
        freq_khz:     Number(proposed.freq_khz),
        distance_km,
        midpoint_lat,
        percent_time: 50,    // SS-1 / PSSA
        mode:         'field_at_distance'
      });
      requests.push({
        erp_kw:       Number(proposed.p_daytime_kw),
        freq_khz:     Number(proposed.freq_khz),
        distance_km,
        midpoint_lat,
        percent_time: 10,    // SS-2 / PSRA
        mode:         'field_at_distance'
      });
    }
    const batch = await fccamClient.runBatch(requests).catch((e) =>
      ({ available: false, error: String(e?.message || e) }));
    if (batch?.available && Array.isArray(batch.results)){
      const pairs = [];
      const pairsMissingEmax = [];
      for (let i = 0; i < protectedRows.length; i++){
        const N        = protectedRows[i];
        const pssaResult = batch.results[i * 2];
        const psraResult = batch.results[i * 2 + 1];
        // E_max_allowed must come from the PROTECTED station's §73.182(k)
        // nighttime-limit data (operator-supplied N.e_max_pssa_uv_m /
        // N.e_max_psra_uv_m).  It is never derived from the proposer's own
        // field: e_max = e_actual × share cancels in P·(E_max/E_actual)²
        // and returns a constant regardless of the protected stations.
        const e_pssa_field = Number(pssaResult?.field_uv_m);
        const e_psra_field = Number(psraResult?.field_uv_m);
        const e_max_pssa = Number.isFinite(Number(N.e_max_pssa_uv_m))
          ? Number(N.e_max_pssa_uv_m)
          : NaN;
        const e_max_psra = Number.isFinite(Number(N.e_max_psra_uv_m))
          ? Number(N.e_max_psra_uv_m)
          : NaN;
        if (!Number.isFinite(e_max_pssa) || !Number.isFinite(e_max_psra)){
          pairsMissingEmax.push(N.call || N.facility_id || `row ${i}`);
        }
        pairs.push({
          call:        N.call || null,
          facility_id: N.facility_id || null,
          fcc_class:   N.fcc_class || null,
          relation:    N.channel_relationship || N.relation || 'co_channel',
          distance_km: Number(greatCircleKm(proposed.lat, proposed.lon, N.lat, N.lon).toFixed(2)),
          bearing_deg: Number(bearingDeg(proposed.lat, proposed.lon, N.lat, N.lon).toFixed(1)),
          pssa: pssaResult?.ok
            ? { e_actual_uv_m: e_pssa_field, e_max_allowed_uv_m: e_max_pssa,
                input_sha256: pssaResult.input_sha256 || null }
            : null,
          psra: psraResult?.ok
            ? { e_actual_uv_m: e_psra_field, e_max_allowed_uv_m: e_max_psra,
                input_sha256: psraResult.input_sha256 || null }
            : null
        });
      }
      out.protected_pairs = pairs;
      if (pairsMissingEmax.length){
        out.e_max_data_gap = {
          n_pairs_missing: pairsMissingEmax.length,
          pairs:           pairsMissingEmax,
          detail: 'Permissible-interference limits (e_max_pssa_uv_m / e_max_psra_uv_m) were not supplied for these protected stations. Per-pair §73.99(b)(1) reduced power cannot be computed without the protected station\'s §73.182(k) nighttime-limit data; the 500 W ceiling remains the outer bound but is NOT a filing-grade result for these pairs.'
        };
      }
      out.power = computePsraPssaPower({
        proposed:         { p_daytime_kw: proposed.p_daytime_kw,
                            call: proposed.call, facility_id: proposed.facility_id,
                            freq_khz: proposed.freq_khz, fcc_class: proposed.fcc_class },
        protected_pairs:  pairs
      });
    }
  }

  // 4. If we have NO power result but have everything else, still
  //    surface the 500 W ceiling as the §73.99(b)(1) default — that
  //    is the right answer when there are no protected neighbors.
  if (!out.power && (out.windows || out.monthly)){
    out.power = computePsraPssaPower({
      proposed:        { p_daytime_kw: proposed.p_daytime_kw },
      protected_pairs: []
    });
  }

  return out;
}

export const PSRA_PSSA_ORCHESTRATOR_PROVENANCE = Object.freeze({
  module:        'src/engine/am/psraPssaOrchestrator.js',
  regulation:    '47 CFR §73.99 (PSRA/PSSA) + §73.182(k) RSS allocation + §73.190(c) skywave',
  modeled: [
    'Sun sidecar fetch + 12-month windows + selected-month window for power',
    'Nearby AM pull from facility client (LMS/AMQ), distance-sorted + capped',
    'Single-batch FCCAM/Berry skywave for SS-1 (50%) and SS-2 (10%) per pair',
    'Per-pair §73.182(k) E_max from operator-supplied nighttime-limit data (never derived from the proposer\'s own field — that cancels in the power formula and returns a constant)',
    'Reduced-power formula via psraPower.computePsraPssaPower'
  ],
  not_modeled: [
    'DA-N pattern integration for per-bearing field (orchestrator currently treats proposed as omni at FCCAM call time; pattern factor is applied downstream in nightOrchestrator)',
    'Per-receiver RSS contributor enumeration (§73.182(k) 25% rule — separate pass)',
    'Daylight Saving / pre-sunrise / post-sunset edge cases for stations near tz boundaries'
  ],
  license_basis: '17 USC §105 (FCC rules, US Government public domain)'
});
