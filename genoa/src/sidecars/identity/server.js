// Genoa identity sidecar — THIN ADAPTER.
//
// Wraps:
//   - chelstein/massdns        (RadioDNS resolution via DNS CNAME lookup)
//   - chelstein/EAS-Tools      (browser-side only; no server API)
//   - chelstein/zerotrustradio (read-only facility metadata)
//
// Resolves station identity by calling these upstream tools and
// normalizing their results into Genoa's identity-evidence shape.
// This sidecar must NOT reimplement RDS / RadioDNS / EAS logic.
//
// Endpoints:
//   GET  /health                -> 200 "ok"
//   GET  /version               -> { sidecar, upstream_tools }
//   POST /v1/identity/resolve   -> { available, sources[], confirmations[] }
//
// RadioDNS FQDN format (FM, ECC-based, per RadioDNS spec v3):
//   {freq_100khz:05d}.{pi_4hex}.{gcc}.fm.radiodns.org
//   e.g. 10620.c460.ce1.fm.radiodns.org  (Heart UK, 106.2 MHz)
//
// massdns /resolve streams ndjson; each line is a DNS response object:
//   { name, type, class, status, data: { answers: [{ type, data, ... }] } }

import express from 'express';

const PORT = parseInt(process.env.SIDECAR_PORT || process.env.PORT || '8083', 10);
const VERSION = '0.2.0';

const RADIODNS_RESOLVER_URL = process.env.RADIODNS_RESOLVER_URL || null;
const MASSDNS_RESOLVER_URL  = process.env.MASSDNS_RESOLVER_URL  || null;
const EAS_TOOLS_URL         = process.env.EAS_TOOLS_URL         || null;
const ZTR_READONLY_URL      = process.env.ZERO_TRUST_RADIO_READONLY_URL || null;

// Timeout for upstream calls (ms)
const UPSTREAM_TIMEOUT_MS = 5_000;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.disable('x-powered-by');

app.get('/health',  (_req, res) => res.type('text').send('ok'));
app.get('/version', (_req, res) => res.json({
  sidecar: { name: 'genoa-identity-sidecar', version: VERSION },
  upstream_tools: {
    'chelstein/massdns':        { url: MASSDNS_RESOLVER_URL  || RADIODNS_RESOLVER_URL,
                                  available: !!(MASSDNS_RESOLVER_URL || RADIODNS_RESOLVER_URL),
                                  role: 'RadioDNS CNAME resolution (FM stations)' },
    'chelstein/EAS-Tools':      { url: EAS_TOOLS_URL,         available: false,
                                  role: 'EAS/SAME decoder — browser-only, no server API' },
    'chelstein/zerotrustradio': { url: ZTR_READONLY_URL,      available: !!ZTR_READONLY_URL,
                                  role: 'read-only facility metadata' }
  },
  notes: 'This sidecar is an adapter, not a new implementation. It calls upstream chelstein/* tools and normalizes their JSON for the genoa engine.'
}));

app.post('/v1/identity/resolve', async (req, res) => {
  const b = req.body || {};
  const sources = [];
  const confirmations = [];

  sources.push(await callRadioDns(b));
  sources.push({ kind: 'eas_same', status: 'unavailable', detail: 'EAS-Tools (chelstein/EAS-Tools) is a browser-only decoder; no server API available for sidecar wiring' });
  sources.push({ kind: 'rds',      status: 'unavailable', detail: 'wire to a fielded RDS scan output (PI/PS/PTY) — not in scope of identity sidecar' });
  sources.push({ kind: 'audio_fp', status: 'unavailable', detail: 'audio fingerprint: no server-side API available from current upstream tools' });

  for (const s of sources){
    if (s.status === 'confirmed' || s.status === 'mismatch') confirmations.push(s);
  }

  res.json({
    available:    confirmations.length > 0,
    requested_at: new Date().toISOString(),
    sources,
    confirmations
  });
});

// ---------------------------------------------------------------------------
// RadioDNS — calls massdns /resolve to do a DNS CNAME lookup.
//
// FQDN format (RadioDNS spec v3, ECC-based):
//   FM: {freq_100khz:05d}.{pi_4hex}.{gcc}.fm.radiodns.org
//
// massdns streams ndjson; we read the full body and parse CNAME answers.
// ---------------------------------------------------------------------------

async function callRadioDns(b){
  const resolverBase = RADIODNS_RESOLVER_URL || MASSDNS_RESOLVER_URL;
  if (!resolverBase){
    return { kind: 'radiodns', status: 'unavailable',
             detail: 'RADIODNS_RESOLVER_URL / MASSDNS_RESOLVER_URL not configured (chelstein/massdns)' };
  }

  const fqdn = radioDnsFqdn(b);
  if (!fqdn){
    return { kind: 'radiodns', status: 'unavailable', fqdn: null,
             detail: 'insufficient inputs to build RadioDNS FQDN (need frequency_mhz + pi_hex + ecc or gcc)' };
  }

  const resolveUrl = resolverBase.replace(/\/+$/, '') + '/resolve';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const resp = await fetch(resolveUrl, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ domains: [fqdn + '.'], type: 'CNAME' }),
      signal:  ctrl.signal
    });

    if (!resp.ok){
      return { kind: 'radiodns', status: 'error', fqdn,
               detail: `massdns /resolve returned HTTP ${resp.status}` };
    }

    const text = await resp.text();
    const cname = extractCname(text);

    if (cname){
      return { kind: 'radiodns', status: 'confirmed', fqdn, service_fqdn: cname,
               detail: `RadioDNS CNAME resolved: ${fqdn} → ${cname}` };
    }
    return { kind: 'radiodns', status: 'not_found', fqdn,
             detail: 'No CNAME answer — station has no RadioDNS service registered' };

  } catch (e){
    if (e?.name === 'AbortError'){
      return { kind: 'radiodns', status: 'error', fqdn,
               detail: `massdns /resolve timed out after ${UPSTREAM_TIMEOUT_MS} ms` };
    }
    return { kind: 'radiodns', status: 'error', fqdn, detail: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Parse ndjson from massdns /resolve; return the first CNAME target or null.
// massdns -o Je per-record shape:
//   { name, type, class, status, data: { answers: [{ type, data, ... }] } }
function extractCname(text){
  for (const line of text.split('\n')){
    const l = line.trim();
    if (!l) continue;
    try {
      const rec = JSON.parse(l);
      const answers = rec?.data?.answers ?? rec?.answers ?? [];
      for (const ans of answers){
        if (String(ans?.type || '').toUpperCase() === 'CNAME' && ans.data){
          return String(ans.data).replace(/\.$/, '');
        }
      }
    } catch { /* skip malformed line */ }
  }
  return null;
}

// Build RadioDNS FM FQDN (ECC-based, spec v3):
//   {freq_100khz:05d}.{pi_4hex}.{gcc}.fm.radiodns.org
//
// Inputs from the identity-resolve request body:
//   frequency_mhz  — FM frequency in MHz (e.g. 106.2)
//   pi             — RDS PI code, 4 hex digits (e.g. "c460")
//   ecc            — ECC byte, 2 hex digits (e.g. "e1")
//   gcc            — GCC (3 hex) if caller pre-computed it; overrides pi[0]+ecc
//
// Returns null if frequency or pi are missing/invalid.
function radioDnsFqdn({ frequency_mhz, pi, ecc, gcc }){
  const f = Number(frequency_mhz);
  if (!Number.isFinite(f) || f <= 0) return null;

  const piStr = String(pi || '').trim().toLowerCase().replace(/^0x/, '');
  if (!piStr || piStr.length !== 4 || !/^[0-9a-f]{4}$/.test(piStr)) return null;

  let gccStr = String(gcc || '').trim().toLowerCase();
  if (!gccStr || gccStr.length !== 3){
    const eccStr = String(ecc || '').trim().toLowerCase().replace(/^0x/, '');
    if (!eccStr || eccStr.length !== 2) return null;
    gccStr = piStr[0] + eccStr; // gcc = pi[0] + ecc (2-hex ECC)
  }

  // freq in 100 Hz units = MHz * 10 000; for FM 87.5–108 MHz → 3 to 5 digits → pad to 5
  const freqUnits = Math.round(f * 10000);
  return `${String(freqUnits).padStart(5, '0')}.${piStr}.${gccStr}.fm.radiodns.org`;
}

app.listen(PORT, '0.0.0.0', () => console.log(`[genoa-identity-sidecar] listening on 0.0.0.0:${PORT} version=${VERSION}`));
