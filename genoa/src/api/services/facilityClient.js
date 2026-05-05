// Facility lookup adapter.
//
// Genoa does NOT ingest FCC data on its own.  This adapter calls the
// existing read-only facility data source(s) and normalizes their rows
// into Genoa's facility shape:
//
//   {
//     facility_id, call, service, fcc_class, frequency, frequency_unit,
//     erp_kw, haat_m, lat, lon, city, state, country_code,
//     licensee, status, station_name,
//     facility_lookup_source: {
//       upstream:   'zerotrustradio' | 'n8n',
//       endpoint:   string,
//       fetched_at: iso,
//       upstream_source_field: 'fcc' | 'radio-browser' | ...
//     }
//   }
//
// Sources, in priority order:
//   1. zerotrustradio  GET /api/broadcast/stations?facility_id=… | ?q=…
//      (read-only; never writes back; data was already ingested by
//       chelstein/zerotrustradio's src/ingest/broadcast.js from FCC FMQ/AMQ).
//   2. n8n webhook     POST {N8N_BASE_URL}/webhook/station/analyze
//      (existing workflow that runs FCC fetch + parse on demand).
//
// This adapter NEVER fabricates ERP / HAAT / coordinates.  Missing
// fields stay null — the engine emits FACILITY_COORDINATES_MISSING and
// related warnings.

const DEFAULT_TIMEOUT_MS = 8_000;

import { makeFccFmqClient } from '../../evidence/fccFmqClient.js';

export function makeFacilityClient({
  ztrUrl     = process.env.ZERO_TRUST_RADIO_READONLY_URL || null,
  n8nBaseUrl = process.env.N8N_BASE_URL || null,
  n8nSecret  = process.env.N8N_WEBHOOK_SECRET || null,
  timeoutMs  = DEFAULT_TIMEOUT_MS,
  // FCC FMQ/AMQ direct fallback.  Default ON (no auth required, public
  // upstream).  Set FACILITY_DISABLE_FCC_FMQ=1 to suppress.
  fmqClient  = (process.env.FACILITY_DISABLE_FCC_FMQ === '1'
                ? null
                : makeFccFmqClient({ timeoutMs }))
} = {}){
  if (!ztrUrl && !n8nBaseUrl && !fmqClient) return null;

  return {
    ztrUrl,
    n8nBaseUrl,
    hasN8n: !!n8nBaseUrl,
    hasFmq: !!fmqClient,

    async health(){
      if (!ztrUrl) return false;
      try {
        const r = await fetch(joinUrl(ztrUrl, '/healthz'), { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch { return false; }
    },

    async searchByQuery(q, { limit = 25 } = {}){
      if (!q || typeof q !== 'string' || q.trim().length < 2){
        return { rows: [], source: null, error: 'query must be at least 2 characters' };
      }
      let ztrRows = null;          // null = ZTR not reached; [] = reached but empty
      // Primary: ZTR with the ?q= filter (PR chelstein/zerotrustradio#242).
      if (ztrUrl){
        try {
          const u = joinUrl(ztrUrl, `/api/broadcast/stations?q=${encodeURIComponent(q.trim())}&limit=${limit}`);
          const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
          if (r.ok){
            const j = await r.json();
            ztrRows = (j.rows || []).map(row => normalizeZtrRow(row, u));
            if (ztrRows.length > 0){
              return {
                rows:   ztrRows,
                count:  ztrRows.length,
                source: 'zerotrustradio'
              };
            }
          }
        } catch (_){/* fall through */}
      }
      // Fallback chain when ZTR is unreachable OR returns zero rows:
      //   1. FCC FMQ/AMQ direct (transition.fcc.gov pipe-delim) —
      //      catches legacy / historical / out-of-catalog callsigns
      //      that ZTR's nightly FCC FMQ ingest hasn't picked up yet.
      //   2. n8n station/analyze webhook (operator-managed workflow).
      // When all of the above produce no rows AND ZTR was at least
      // reachable, return an empty success (source: 'zerotrustradio',
      // count: 0) so the UI can show a "no matches" hint instead of
      // treating it as a server error.
      if (fmqClient){
        try {
          const fmq = await fmqClient.searchByCallsign(q.trim());
          if (fmq && fmq.rows && fmq.rows.length > 0){
            return { rows: fmq.rows, count: fmq.rows.length, source: 'fcc-fmq' };
          }
        } catch (_){/* fall through to n8n */}
      }
      const n8n = await callN8nStationAnalyze({ n8nBaseUrl, n8nSecret, timeoutMs, q });
      if (n8n && n8n.rows.length > 0){
        return { rows: n8n.rows, count: n8n.rows.length, source: 'n8n' };
      }
      if (Array.isArray(ztrRows)){
        return { rows: [], count: 0, source: 'zerotrustradio' };
      }
      return { rows: [], source: null, error: 'no facility source reachable' };
    },

    async getById(facility_id){
      if (!facility_id) return { facility: null, source: null, error: 'facility_id required' };
      if (ztrUrl){
        try {
          const u = joinUrl(ztrUrl, `/api/broadcast/stations?facility_id=${encodeURIComponent(facility_id)}&limit=1`);
          const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
          if (r.ok){
            const j = await r.json();
            const row = (j.rows || [])[0];
            if (row) return { facility: normalizeZtrRow(row, u), source: 'zerotrustradio' };
          }
        } catch (_){/* fall through */}
      }
      const n8n = await callN8nStationAnalyze({ n8nBaseUrl, n8nSecret, timeoutMs, facility_id });
      if (n8n && n8n.rows[0]) return { facility: n8n.rows[0], source: 'n8n' };
      return { facility: null, source: null, error: 'facility not found in any configured source' };
    },

    // ---- Outcome-A enrichment endpoints (read-only) ----
    // All three return { available, source, endpoint, fetched_at, ... }
    // when ZTR is reachable; { available: false, source: null, error }
    // otherwise.  Genoa does NOT fall back to fabrication; missing data
    // stays missing and the corresponding warning persists.

    async getRichStation(stationId){
      if (!ztrUrl || !stationId) return { available: false, source: null, error: 'ztrUrl or stationId missing' };
      try {
        const u = joinUrl(ztrUrl, `/api/radiodns/station/${encodeURIComponent(stationId)}`);
        const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok) return { available: false, source: null, error: `HTTP ${r.status}` };
        const j = await r.json();
        return {
          available:  true,
          source:     'zerotrustradio',
          endpoint:   u,
          fetched_at: new Date().toISOString(),
          station:    j
        };
      } catch (e){
        return { available: false, source: null, error: String(e.message) };
      }
    },

    async getTerrainHaatRadials({ facility_id, radial_step_deg = 10 }){
      if (!ztrUrl || !facility_id) return { available: false, source: null, error: 'ztrUrl or facility_id missing' };
      try {
        const u = joinUrl(ztrUrl, `/api/broadcast/stations/${encodeURIComponent(facility_id)}/terrain-haat?radial_step_deg=${radial_step_deg}`);
        // Terrain calls are slow (DEM batched at 1 req/sec); allow up to 60s.
        const r = await fetch(u, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) return { available: false, source: null, error: `HTTP ${r.status}` };
        const j = await r.json();
        if (!Array.isArray(j.radials) || !j.radials.length){
          return { available: false, source: null, error: 'no radials returned' };
        }
        return {
          available:  true,
          source:     'zerotrustradio',
          endpoint:   u,
          fetched_at: new Date().toISOString(),
          method:     j.method || '47 CFR §73.313 arc-averaged HAAT',
          arc:        j.arc,
          dem:        j.dem,
          tx:         j.tx,
          n_radials:  j.n_radials,
          radials:    j.radials
        };
      } catch (e){
        return { available: false, source: null, error: String(e.message) };
      }
    },

    // Pull the FCC's own canonical contour out of the rich-station
    // response.  If `rich` (already-fetched) is supplied, reuse it; else
    // fetch it.  The FCC contour comes from
    //   https://geo.fcc.gov/api/contours/entity.json
    // proxied by ZTR's /api/radiodns/station/:id endpoint.
    async getFccContour({ stationId, rich = null }){
      if (!stationId) return { available: false, source: null, error: 'stationId required' };
      const r = rich || await this.getRichStation(stationId);
      if (!r.available) return { available: false, source: null, error: r.error || 'rich station unavailable' };
      const fc = r.station?._fcc_contour;
      if (!fc || fc.type !== 'FeatureCollection' || !(fc.features || []).length){
        return { available: false, source: null, error: 'no _fcc_contour on rich station response' };
      }
      return {
        available:    true,
        source:       'zerotrustradio',
        endpoint:     r.endpoint,
        fetched_at:   r.fetched_at,
        upstream_api: 'https://geo.fcc.gov/api/contours/entity.json',
        feature_count: fc.features.length,
        contour:      fc
      };
    },

    /**
     * 47 CFR §74.1204 nearby-primaries proximity search.
     *
     * Pulls every FM/LPFM/FX/FB/FS station from the FCC FMQ database
     * whose carrier falls on a §74.1204(a)-restricted offset relative
     * to the proposed translator (co-channel, ±200/400/600 kHz, ±10.6/
     * 10.8 MHz IF), then filters to those within `radius_km` great-
     * circle distance of the translator's coordinates.
     *
     * The result is shaped to plug directly into
     * evidence.nearby_primaries — the engine's checkTranslatorInterference
     * consumes that array verbatim and runs the per-station D/U study.
     *
     * @param {object} args
     * @param {number} args.lat,lon            translator coordinates
     * @param {number} args.frequency_mhz      translator carrier
     * @param {number} args.radius_km          search radius (default 300)
     * @param {string} [args.exclude_facility_id]  drop self from results
     */
    async getNearbyPrimaries({ lat, lon, frequency_mhz, radius_km = 300, exclude_facility_id = null } = {}){
      if (lat == null || lon == null || frequency_mhz == null){
        return { available: false, source: null,
                 error: 'lat, lon, and frequency_mhz required for §74.1204 nearby-primaries search' };
      }
      const lat0 = Number(lat), lon0 = Number(lon), f0 = Number(frequency_mhz);
      if (![lat0, lon0, f0].every(Number.isFinite)){
        return { available: false, source: null,
                 error: 'lat, lon, and frequency_mhz must be finite numbers' };
      }
      if (!fmqClient){
        return { available: false, source: null,
                 error: 'FCC FMQ client unavailable (FACILITY_DISABLE_FCC_FMQ=1)' };
      }
      // §74.1204(a)+(c) channel relationships — every offset whose D/U
      // gate the translator must satisfy.  ±10.6 / ±10.8 MHz are the
      // FCC IF-image frequencies of FM receivers (10.7 MHz IF center).
      const RELATIONSHIPS = [
        { rel: 'cochannel',         delta_mhz:  0.0  },
        { rel: 'first_adjacent',    delta_mhz: +0.2  },
        { rel: 'first_adjacent',    delta_mhz: -0.2  },
        { rel: 'second_adjacent',   delta_mhz: +0.4  },
        { rel: 'second_adjacent',   delta_mhz: -0.4  },
        { rel: 'third_adjacent',    delta_mhz: +0.6  },
        { rel: 'third_adjacent',    delta_mhz: -0.6  },
        { rel: 'if_offset',         delta_mhz: +10.6 },
        { rel: 'if_offset',         delta_mhz: -10.6 },
        { rel: 'if_offset',         delta_mhz: +10.8 },
        { rel: 'if_offset',         delta_mhz: -10.8 }
      ];
      const queries = RELATIONSHIPS
        .map(r => ({ rel: r.rel, f: +(f0 + r.delta_mhz).toFixed(1) }))
        .filter(q => q.f >= 88.0 && q.f <= 108.0);

      const settled = await Promise.all(queries.map(q =>
        fmqClient.searchByFrequencyRange(q.f, q.f).then(r => ({ ...q, ...r }))
      ));

      const { vincentyInverse } = await import('../../engine/geometry/wgs84.js');
      const errs = [];
      const collected = new Map();      // facility_id -> closest row
      for (const r of settled){
        if (r.error){ errs.push(`f=${r.f}: ${r.error}`); continue; }
        for (const row of (r.rows || [])){
          if (!row || !row.facility_id) continue;
          if (exclude_facility_id && String(row.facility_id) === String(exclude_facility_id)) continue;
          if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
          if (row.frequency_unit !== 'MHz' || !Number.isFinite(row.frequency)) continue;
          let inv;
          try { inv = vincentyInverse(lat0, lon0, row.lat, row.lon); } catch { continue; }
          if (!Number.isFinite(inv.distance_km) || inv.distance_km > radius_km) continue;
          const prior = collected.get(row.facility_id);
          if (prior && prior.distance_km <= inv.distance_km) continue;
          collected.set(row.facility_id, { ...row, distance_km: inv.distance_km, channel_relationship: r.rel });
        }
      }

      const primaries = [...collected.values()]
        .sort((a, b) => a.distance_km - b.distance_km)
        .map(r => ({
          call:                  r.call,
          facility_id:           r.facility_id,
          fcc_class:             r.fcc_class,
          service:               r.service,
          frequency_mhz:         r.frequency,
          erp_kw:                r.erp_kw,
          haat_m:                r.haat_m,
          lat:                   r.lat,
          lon:                   r.lon,
          distance_km:           +r.distance_km.toFixed(3),
          channel_relationship:  r.channel_relationship,
          source:                'fcc-fmq',
          endpoint:              r.facility_lookup_source?.endpoint || null
        }));

      return {
        available:    true,
        source:       'fcc-fmq',
        method:       '47 CFR §74.1204(a) channel-relationship FMQ search + WGS-84 Vincenty proximity filter',
        upstream_api: 'https://transition.fcc.gov/fcc-bin/fmq',
        fetched_at:   new Date().toISOString(),
        radius_km,
        n_queries:    queries.length,
        n_in_radius:  primaries.length,
        primaries,
        errors:       errs.length ? errs : null
      };
    },

    async getSdrEvidence({ stationId, rich = null }){
      if (!stationId) return { available: false, source: null, error: 'stationId required' };
      const r = rich || await this.getRichStation(stationId);
      if (!r.available) return { available: false, source: null, error: r.error || 'rich station unavailable' };
      const captures = Array.isArray(r.station?._captures) ? r.station._captures : [];
      return {
        available:    captures.length > 0,
        source:       'zerotrustradio',
        endpoint:     r.endpoint,
        fetched_at:   r.fetched_at,
        n_records:    captures.length,
        // ZTR captures don't carry a calibration flag.  Until calibration
        // metadata flows through the SDR ingest, treat them as raw.
        calibrated:   false,
        records:      captures
      };
    }
  };
}

// ---------------- normalization ----------------

function normalizeZtrRow(row, endpoint){
  if (!row) return null;
  const kindToService = { fm: 'FM', am: 'AM', lpfm: 'LPFM', translator: 'FX' };
  const service = kindToService[String(row.kind || '').toLowerCase()] || (row.service ? String(row.service).toUpperCase() : null);
  const freq_khz  = num(row.frequency_khz);
  const frequency = freq_khz === null ? null : (service === 'AM' ? freq_khz : +(freq_khz / 1000).toFixed(4));
  const erp_kw    = num(row.power_watts) === null ? null : +(num(row.power_watts) / 1000).toFixed(4);

  return {
    facility_id:     row.facility_id ? String(row.facility_id) : null,
    call:            row.callsign || null,
    station_name:    row.station_name || null,
    service,
    fcc_class:       null,                 // ZTR row doesn't carry class today
    frequency,
    frequency_unit:  service === 'AM' ? 'kHz' : 'MHz',
    erp_kw,
    haat_m:          num(row.haat_m),
    lat:             num(row.latitude),
    lon:             num(row.longitude),
    city:            row.city  || null,
    state:           row.state || null,
    country_code:    row.country_code || null,
    licensee:        row.licensee || null,
    status:          row.status   || null,
    facility_lookup_source: {
      upstream:              'zerotrustradio',
      endpoint:              endpoint,
      fetched_at:            new Date().toISOString(),
      upstream_source_field: row.source || null,
      ztr_kind:              row.kind   || null,
      ztr_id:                row.id ?? null
    }
  };
}

async function callN8nStationAnalyze({ n8nBaseUrl, n8nSecret, timeoutMs, q, facility_id }){
  if (!n8nBaseUrl) return null;
  const u = joinUrl(n8nBaseUrl, '/webhook/station/analyze');
  const headers = { 'content-type': 'application/json' };
  if (n8nSecret) headers['x-genoa-secret'] = n8nSecret;
  try {
    const r = await fetch(u, {
      method: 'POST',
      headers,
      body: JSON.stringify({ q, facility_id }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!r.ok) return null;
    const j = await r.json();
    // n8n response shape is workflow-defined; accept either { rows: [...] }
    // or a single row-like object.  Normalize generously.
    const rows = Array.isArray(j) ? j
               : Array.isArray(j.rows) ? j.rows
               : (j && typeof j === 'object') ? [j] : [];
    return {
      rows: rows.map(r => normalizeN8nRow(r, u)).filter(Boolean)
    };
  } catch { return null; }
}

function normalizeN8nRow(row, endpoint){
  if (!row || typeof row !== 'object') return null;
  const service =
    (row.service && String(row.service).toUpperCase())
    || (row.kind === 'fm' ? 'FM' : row.kind === 'am' ? 'AM' :
        row.kind === 'lpfm' ? 'LPFM' : row.kind === 'translator' ? 'FX' : null);
  return {
    facility_id:     row.facility_id ? String(row.facility_id) : null,
    call:            row.call || row.callsign || null,
    station_name:    row.station_name || null,
    service,
    fcc_class:       row.fcc_class || row.class || null,
    frequency:       num(row.frequency_mhz ?? row.frequency),
    frequency_unit:  service === 'AM' ? 'kHz' : 'MHz',
    erp_kw:          num(row.erp_kw),
    haat_m:          num(row.haat_m),
    lat:             num(row.lat ?? row.latitude),
    lon:             num(row.lon ?? row.longitude),
    city:            row.city || null,
    state:           row.state || null,
    country_code:    row.country_code || null,
    licensee:        row.licensee || null,
    status:          row.status || null,
    facility_lookup_source: {
      upstream:   'n8n',
      endpoint,
      fetched_at: new Date().toISOString()
    }
  };
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
