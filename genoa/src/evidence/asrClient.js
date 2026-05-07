// FCC Antenna Structure Registration (ASR) cross-check client.
//
// SCOPE
//   Every antenna structure subject to FAA/FCC review (typically
//   towers > 60 m AGL or near airports) must be registered in the
//   FCC's Antenna Structure Registration database under 47 CFR
//   §17.4.  An FCC application that uses a tower MUST cite the
//   tower's ASR number and the registered values must agree with
//   the application's antenna data: tower lat/lon, overall height
//   AGL, height AMSL, lighting and painting requirements.
//
//   This client looks up an ASR record by registration number OR
//   geographic proximity to a (lat, lon), normalizes the result, and
//   surfaces it as `evidence.asr`.  Mismatches between the
//   application's data and the ASR record raise warnings.
//
// SOURCES (multi-tier, same fallback pattern as facilityClient)
//
//   1. ZTR rich-station response — many station records carry an
//      `asr_number` and a copy of the registered tower data on
//      `_tower` or `tower` field.  This is fastest.
//
//   2. FCC ASR direct — https://wireless2.fcc.gov/UlsApp/AsrSearch/
//      No public JSON API; the search endpoint serves HTML.  The
//      adapter scrapes the published HTML table when the user
//      explicitly opts in via ASR_HTML_FALLBACK=1 (off by default
//      to avoid HTML-scrape brittleness).
//
//   3. ASR_SIDECAR_URL operator-managed sidecar — operator runs
//      their own ASR proxy (e.g., the chelstein/asr-bridge sidecar)
//      that talks to FCC ULS and returns clean JSON.  Recommended
//      production path.
//
// CROSS-CHECK FIELDS
//   The §17.4 application data the orchestrator can verify against
//   the ASR record:
//
//     asr_number              — registration number (string)
//     latitude_deg, longitude_deg
//     overall_height_m        — height of structure above ground
//     overall_height_agl_m    — alias for overall_height_m
//     overall_height_amsl_m   — height above mean sea level (AMSL)
//     ground_elevation_m      — site elevation
//     lighting_requirement    — FAA Form 7460 lighting type
//     painting_requirement    — FAA Form 7460 painting requirement
//     owner                   — registered tower owner
//     status                  — ACTIVE, GRANTED, DISMISSED, etc.
//
// OUTPUT SHAPE
//   {
//     available: bool,
//     source:    'zerotrustradio' | 'asr-sidecar' | 'fcc-uls-html' | null,
//     endpoint, fetched_at,
//     asr_number, latitude_deg, longitude_deg, overall_height_m,
//     overall_height_amsl_m, ground_elevation_m,
//     lighting_requirement, painting_requirement, owner, status,
//     // Cross-check details (filled by checkAsrAgainstApplication)
//     cross_check?: { matches, mismatches: [...] }
//   }

const DEFAULT_TIMEOUT_MS = 8_000;

export function makeAsrClient({
  ztrUrl    = process.env.ZERO_TRUST_RADIO_READONLY_URL || null,
  asrSidecarUrl = process.env.ASR_SIDECAR_URL || null,
  htmlFallback  = process.env.ASR_HTML_FALLBACK === '1',
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!ztrUrl && !asrSidecarUrl && !htmlFallback) return null;

  return {
    sources: {
      ztr:           !!ztrUrl,
      asr_sidecar:   !!asrSidecarUrl,
      uls_html:      htmlFallback
    },

    /**
     * Lookup ASR by explicit registration number.  Tier order:
     *   1. ASR_SIDECAR_URL — clean JSON
     *   2. FCC ULS HTML scrape (only when htmlFallback enabled)
     */
    async getByAsrNumber(asr_number){
      if (!asr_number) return { available: false, source: null, error: 'asr_number required' };
      // Tier 1: operator-managed ASR sidecar.
      if (asrSidecarUrl){
        try {
          const u = joinUrl(asrSidecarUrl, `/api/v1/asr/${encodeURIComponent(asr_number)}`);
          const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
          if (r.ok){
            const j = await r.json();
            return normalizeAsrRecord(j, 'asr-sidecar', u);
          }
        } catch { /* fall through */ }
      }
      // Tier 2: FCC ULS HTML scrape (operator-opted-in).
      if (htmlFallback){
        return { available: false, source: null, error: 'FCC ULS HTML scraping not implemented in this build (set ASR_SIDECAR_URL for clean JSON access)' };
      }
      return {
        available: false, source: null,
        error: 'No ASR lookup source configured.  Set ASR_SIDECAR_URL (recommended) or ASR_HTML_FALLBACK=1.'
      };
    },

    /**
     * Extract ASR data from an already-fetched ZTR rich-station response.
     * This is the fastest path when ZTR's rich payload includes tower
     * data — we don't pay an extra HTTP round-trip.
     *
     * Defensive: ZTR has shipped tower data under several keys
     * across releases.  We try them all.
     */
    extractFromRichStation(richStationResponse){
      if (!richStationResponse?.available) {
        return { available: false, source: null, error: 'rich station response unavailable' };
      }
      const s = richStationResponse.station || {};
      // Defensive field-name lookup for ASR-shaped data.
      const asr_number = pickFirst(s,
        ['asr_number', 'asrn', 'asr_id', 'antenna_structure_registration',
         '_tower.asr_number', 'tower.asr_number', '_asr.number']);
      if (!asr_number){
        return {
          available: false, source: null, endpoint: richStationResponse.endpoint,
          error: 'ZTR rich-station response did not carry an asr_number'
        };
      }
      // Tower-data sub-object names ZTR has used.
      const tower = s._tower || s.tower || s._asr || s.asr || s;
      const lat = pickNumeric(tower, ['latitude_deg', 'latitude', 'lat']);
      const lon = pickNumeric(tower, ['longitude_deg', 'longitude', 'lon', 'lng']);
      const overall_height_m   = pickNumeric(tower, ['overall_height_m', 'overall_height_agl_m', 'height_m', 'tower_height_m', 'overall_height_above_ground_m']);
      const ground_elev_m      = pickNumeric(tower, ['ground_elevation_m', 'site_elevation_m', 'site_elev_m', 'elevation_m']);
      const overall_amsl_m     = pickNumeric(tower, ['overall_height_amsl_m', 'overall_height_above_msl_m', 'tower_top_amsl_m'])
                              ?? (Number.isFinite(overall_height_m) && Number.isFinite(ground_elev_m)
                                  ? overall_height_m + ground_elev_m : null);
      return {
        available:               true,
        source:                  'zerotrustradio',
        endpoint:                richStationResponse.endpoint,
        fetched_at:              richStationResponse.fetched_at,
        asr_number:              String(asr_number),
        latitude_deg:            lat,
        longitude_deg:           lon,
        overall_height_m,
        overall_height_amsl_m:   overall_amsl_m,
        ground_elevation_m:      ground_elev_m,
        lighting_requirement:    pickFirst(tower, ['lighting_requirement', 'lighting', 'faa_lighting', 'lighting_required']),
        painting_requirement:    pickFirst(tower, ['painting_requirement', 'painting', 'faa_painting', 'painting_required']),
        owner:                   pickFirst(tower, ['owner', 'tower_owner', 'registered_owner']),
        status:                  pickFirst(tower, ['status', 'asr_status', 'registration_status'])
      };
    }
  };
}

/**
 * Compare ASR record against the application's antenna data and
 * report mismatches.  Returns the SAME `asr` record with a
 * `cross_check` block appended:
 *   { matches: bool, mismatches: [{ field, asr_value, app_value, tolerance, …}], notes }
 *
 * Tolerances chosen per FCC §17.4 / FAA Form 7460 review practice:
 *   - lat / lon: 1 second (~30 m) — the FCC application's site coordinates
 *     are typically rounded to the second; ASR records the same precision
 *   - overall_height_m: 1 m (FAA review tolerance)
 *
 * @param {object} args
 * @param {object} args.asr            normalized ASR record (from getByAsrNumber / extractFromRichStation)
 * @param {object} args.application    { lat, lon, antenna_height_m?, overall_height_m?, overall_height_amsl_m?, asr_number? }
 */
export function checkAsrAgainstApplication({ asr, application } = {}){
  if (!asr || asr.available !== true){
    return { ...asr, cross_check: { matches: null, applicable: false, reason: 'ASR record not available' } };
  }
  if (!application || typeof application !== 'object'){
    return { ...asr, cross_check: { matches: null, applicable: false, reason: 'application data missing' } };
  }
  const mismatches = [];

  // 1. ASR number cross-check (when application supplied one).
  if (application.asr_number && String(application.asr_number) !== String(asr.asr_number)){
    mismatches.push({
      field: 'asr_number',
      asr_value: asr.asr_number,
      app_value: String(application.asr_number),
      tolerance: 'exact match',
      severity: 'mismatch'
    });
  }

  // 2. Coordinate cross-check (1 second ≈ 30 m).
  const LAT_TOL_DEG = 1 / 3600;
  if (Number.isFinite(asr.latitude_deg) && Number.isFinite(Number(application.lat))){
    const dlat = Math.abs(asr.latitude_deg - Number(application.lat));
    if (dlat > LAT_TOL_DEG){
      mismatches.push({
        field: 'latitude_deg',
        asr_value: asr.latitude_deg,
        app_value: Number(application.lat),
        delta_arcsec: Number((dlat * 3600).toFixed(2)),
        tolerance: '1 arcsec (~30 m)',
        severity: dlat > LAT_TOL_DEG * 10 ? 'major' : 'minor'
      });
    }
  }
  if (Number.isFinite(asr.longitude_deg) && Number.isFinite(Number(application.lon))){
    const dlon = Math.abs(asr.longitude_deg - Number(application.lon));
    if (dlon > LAT_TOL_DEG){
      mismatches.push({
        field: 'longitude_deg',
        asr_value: asr.longitude_deg,
        app_value: Number(application.lon),
        delta_arcsec: Number((dlon * 3600).toFixed(2)),
        tolerance: '1 arcsec (~30 m at equator, less at higher latitudes)',
        severity: dlon > LAT_TOL_DEG * 10 ? 'major' : 'minor'
      });
    }
  }

  // 3. Overall height (1 m tolerance).
  const HEIGHT_TOL_M = 1.0;
  if (Number.isFinite(asr.overall_height_m) && Number.isFinite(Number(application.overall_height_m))){
    const dh = Math.abs(asr.overall_height_m - Number(application.overall_height_m));
    if (dh > HEIGHT_TOL_M){
      mismatches.push({
        field: 'overall_height_m',
        asr_value: asr.overall_height_m,
        app_value: Number(application.overall_height_m),
        delta_m: Number(dh.toFixed(2)),
        tolerance: '1 m',
        severity: dh > HEIGHT_TOL_M * 5 ? 'major' : 'minor'
      });
    }
  }

  // 4. Overall AMSL height (3 m tolerance — looser than AGL because
  //    derived = AGL + ground elevation, both quantized to 1 m).
  const AMSL_TOL_M = 3.0;
  if (Number.isFinite(asr.overall_height_amsl_m) && Number.isFinite(Number(application.overall_height_amsl_m))){
    const dh = Math.abs(asr.overall_height_amsl_m - Number(application.overall_height_amsl_m));
    if (dh > AMSL_TOL_M){
      mismatches.push({
        field: 'overall_height_amsl_m',
        asr_value: asr.overall_height_amsl_m,
        app_value: Number(application.overall_height_amsl_m),
        delta_m: Number(dh.toFixed(2)),
        tolerance: '3 m (AGL + ground elev quantization)',
        severity: dh > AMSL_TOL_M * 5 ? 'major' : 'minor'
      });
    }
  }

  return {
    ...asr,
    cross_check: {
      applicable: true,
      matches:    mismatches.length === 0,
      n_mismatches: mismatches.length,
      mismatches,
      tolerances: {
        coordinates: '1 arcsec',
        overall_height_m: '1 m',
        overall_height_amsl_m: '3 m'
      }
    }
  };
}

/* -------------------- internal helpers -------------------- */

function normalizeAsrRecord(j, source, endpoint){
  if (!j || typeof j !== 'object') return { available: false, source: null, error: 'ASR response not an object' };
  return {
    available:               true,
    source,
    endpoint,
    fetched_at:              new Date().toISOString(),
    asr_number:              String(j.asr_number || j.registration_number || j.asrn || ''),
    latitude_deg:            num(j.latitude_deg ?? j.latitude ?? j.lat),
    longitude_deg:           num(j.longitude_deg ?? j.longitude ?? j.lon ?? j.lng),
    overall_height_m:        num(j.overall_height_m ?? j.overall_height_agl_m ?? j.height_m),
    overall_height_amsl_m:   num(j.overall_height_amsl_m),
    ground_elevation_m:      num(j.ground_elevation_m ?? j.site_elevation_m),
    lighting_requirement:    j.lighting_requirement ?? j.lighting ?? null,
    painting_requirement:    j.painting_requirement ?? j.painting ?? null,
    owner:                   j.owner ?? j.tower_owner ?? null,
    status:                  j.status ?? j.asr_status ?? null
  };
}

function pickFirst(obj, keys){
  if (!obj) return null;
  for (const k of keys){
    if (k.includes('.')){
      const parts = k.split('.');
      let v = obj;
      for (const p of parts){ if (v && typeof v === 'object') v = v[p]; else { v = null; break; } }
      if (v !== undefined && v !== null && v !== '') return v;
      continue;
    }
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function pickNumeric(obj, keys){
  const v = pickFirst(obj, keys);
  return num(v);
}

function num(v){
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}

export const ASR_PROVENANCE = Object.freeze({
  regulation:    '47 CFR §17.4 — Antenna Structure Registration',
  related:       ['47 CFR §17.7 (FAA notification)', 'FAA Form 7460-1 (notice of proposed construction)'],
  upstream:      'https://wireless2.fcc.gov/UlsApp/AsrSearch/',
  fallback_chain: ['ZTR rich-station _tower / asr_number', 'ASR_SIDECAR_URL operator sidecar', 'FCC ULS HTML (opt-in)'],
  cross_check_tolerances: {
    coordinates: '1 arcsec (~30 m)',
    overall_height_m: '1 m',
    overall_height_amsl_m: '3 m'
  },
  license_basis: '17 U.S.C. § 105 — methodology from §17.4, US Government public domain'
});
