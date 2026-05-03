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

export function makeFacilityClient({
  ztrUrl     = process.env.ZERO_TRUST_RADIO_READONLY_URL || null,
  n8nBaseUrl = process.env.N8N_BASE_URL || null,
  n8nSecret  = process.env.N8N_WEBHOOK_SECRET || null,
  timeoutMs  = DEFAULT_TIMEOUT_MS
} = {}){
  if (!ztrUrl && !n8nBaseUrl) return null;

  return {
    ztrUrl,
    n8nBaseUrl,
    hasN8n: !!n8nBaseUrl,

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
      // Primary: ZTR with the new ?q= filter (PR chelstein/zerotrustradio#242).
      if (ztrUrl){
        try {
          const u = joinUrl(ztrUrl, `/api/broadcast/stations?q=${encodeURIComponent(q.trim())}&limit=${limit}`);
          const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
          if (r.ok){
            const j = await r.json();
            return {
              rows:   (j.rows || []).map(row => normalizeZtrRow(row, u)),
              count:  (j.rows || []).length,
              source: 'zerotrustradio'
            };
          }
        } catch (_){/* fall through */}
      }
      // Fallback: n8n station/analyze webhook.
      const n8n = await callN8nStationAnalyze({ n8nBaseUrl, n8nSecret, timeoutMs, q });
      if (n8n) return { rows: n8n.rows, count: n8n.rows.length, source: 'n8n' };
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
