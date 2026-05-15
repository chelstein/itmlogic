// Genoa FORTRAN FCC reference-engine client.
//
// Talks to an external microservice that wraps the FCC/REC TVFMFS_METRIC
// FORTRAN routine (see chelstein operator's fcc-fortran-engine image —
// FastAPI + linked FORTRAN binary deployed on a DigitalOcean droplet).
// The service is the deterministic FCC math; Genoa uses it as a parity
// reference against its own vendored tvfm_curves.js engine so the two
// can be cross-validated on every FM exhibit.
//
// CURRENT SERVICE CONTRACT (as of 2026-05-14)
//
//   GET  /healthz
//     → 200 "ok" (text)
//
//   GET  /version                      (planned, task 5)
//     → { tvfmfs_for_sha256, itplbv_for_sha256, driver_for_sha256, ... }
//
//   POST /run
//     body: {
//       erp_kw:      number,
//       haat_m:      number,
//       field_dbuv:  number,      // target field strength for distance_to_field
//       curve:       "F50_50" | "F50_10",   // mapped server-side to CURVE int
//       channel:     number,      // FM channel; defaults to 221 server-side today
//       mode:        "distance_to_field" | "field_at_distance"   (default "distance_to_field")
//     }
//     → 200 {
//          ok:             true,
//          engine:         "fcc-tvfmfs-fortran",
//          distance_km:    number,
//          distance_miles: number,
//          flag:           null | string,    // FCC TVFMFS_METRIC flags (e.g. "extrapolated")
//          input_sha256:   string,           // hash of normalized inputs (reproducibility)
//          stdout:         string,
//          stderr:         string
//        }
//
//   POST /batch                       (planned, task 6)
//     body: { runs: [ /run input objects ] }
//     → 200 { runs: [ /run output objects ] }
//
// USE
//   Set FORTRAN_FCC_SIDECAR_URL on the API deploy (and optionally
//   FORTRAN_FCC_API_TOKEN for the bearer header once HTTPS/auth ships
//   per the operator's task 7).  When unset, makeFortranFccClient
//   returns null and Genoa runs untouched on its vendored curves
//   dataset — same fail-soft pattern as splatClient / necClient.
//
// DO NOT use this as the primary FCC distance source yet — wire it as
// PARITY EVIDENCE first.  Once the /batch endpoint lands and the FCC
// engine has been side-by-side validated for a representative spread
// of stations, the operator can flip the resolution chain so FORTRAN
// becomes the primary and tvfm_curves.js becomes the fallback.

const DEFAULT_TIMEOUT_MS = 10_000;

export function makeFortranFccClient({
  baseUrl   = process.env.FORTRAN_FCC_SIDECAR_URL || null,
  apiToken  = (process.env.FORTRAN_FCC_API_TOKEN || '').trim() || null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!baseUrl) return null;
  return {
    baseUrl,
    hasToken: !!apiToken,

    // sidecarStatus() in services/sidecars.js iterates over the
    // registered clients and calls health() when present; otherwise
    // it falls back to GET /health on baseUrl.  This service exposes
    // /healthz (text response) so we wrap explicitly.
    async health(){
      try {
        const r = await fetchWithTimeout(joinUrl(baseUrl, '/healthz'),
                                         { headers: authHeaders(apiToken) },
                                         3_000);
        return r.ok;
      } catch { return false; }
    },

    // Service version + FORTRAN source-file SHA-256s, for stamping
    // method_versions.fcc_fortran_engine.* on the exhibit so the
    // parity check carries provenance the reviewer can replay.
    async version(){
      try {
        const r = await fetchWithTimeout(joinUrl(baseUrl, '/version'),
                                         { headers: authHeaders(apiToken) },
                                         5_000);
        if (!r.ok) return { available: false, error: `HTTP ${r.status}` };
        const j = await r.json();
        return { available: true, ...j };
      } catch (e){
        // /version isn't shipped yet on the FORTRAN side — treat absent
        // version endpoint as "service up, version unknown" rather than
        // failing the whole parity probe.
        return { available: false, error: String(e?.message || e) };
      }
    },

    // Single contour-distance computation — the FCC TVFMFS_METRIC
    // call.  See contract block at top of file for input/output shape.
    //
    // Genoa callers should normalize their FM curve naming to
    // "F50_50" / "F50_10" before invoking; the FORTRAN service maps
    // those to its internal CURVE integer.
    async distanceToField({
      erp_kw, haat_m, field_dbuv,
      curve   = 'F50_50',
      channel = 221
    } = {}, opts = {}){
      const body = {
        erp_kw:     Number(erp_kw),
        haat_m:     Number(haat_m),
        field_dbuv: Number(field_dbuv),
        curve,
        channel:    Number(channel) || 221,
        mode:       'distance_to_field'
      };
      if (!Number.isFinite(body.erp_kw)
          || !Number.isFinite(body.haat_m)
          || !Number.isFinite(body.field_dbuv)){
        return { available: false, error: 'erp_kw, haat_m, field_dbuv must all be finite numbers' };
      }
      try {
        const r = await fetchWithTimeout(joinUrl(baseUrl, '/run'), {
          method:  'POST',
          headers: { 'content-type': 'application/json', ...authHeaders(apiToken) },
          body:    JSON.stringify(body)
        }, opts.timeoutMs ?? timeoutMs);
        if (!r.ok){
          return { available: false, error: `HTTP ${r.status}`,
                   endpoint: joinUrl(baseUrl, '/run') };
        }
        const j = await r.json();
        if (!j?.ok){
          return { available: false, error: j?.error || 'engine returned ok=false',
                   endpoint: joinUrl(baseUrl, '/run'), raw: j };
        }
        return {
          available:      true,
          source:         'fcc-tvfmfs-fortran',
          engine:         j.engine || 'fcc-tvfmfs-fortran',
          endpoint:       joinUrl(baseUrl, '/run'),
          fetched_at:     new Date().toISOString(),
          distance_km:    Number(j.distance_km),
          distance_miles: Number(j.distance_miles),
          flag:           j.flag || null,
          input_sha256:   j.input_sha256 || null,
          // Server-supplied diagnostic streams — kept on the response
          // so the orchestrator can stamp them on evidence for replay /
          // debugging.  Both can be large; consumer may strip before
          // persisting the exhibit.
          stdout:         j.stdout || null,
          stderr:         j.stderr || null,
          // Echo the inputs we sent so the parity panel can show
          // "FORTRAN was asked for X km @ Y dBu" alongside "Genoa
          // computed Z km" without re-reading the request body.
          inputs:         body
        };
      } catch (e){
        return { available: false, error: String(e?.message || e),
                 endpoint: joinUrl(baseUrl, '/run') };
      }
    },

    // Batch helper — placeholder for the operator's task 6.  When
    // /batch isn't deployed yet (the service returns 404) the
    // caller should fall back to N sequential distanceToField calls
    // or, for the parity-evidence use, just sample a single radial.
    async runBatch(runs, opts = {}){
      if (!Array.isArray(runs) || runs.length === 0){
        return { available: false, error: 'runs[] must be a non-empty array' };
      }
      try {
        const r = await fetchWithTimeout(joinUrl(baseUrl, '/batch'), {
          method:  'POST',
          headers: { 'content-type': 'application/json', ...authHeaders(apiToken) },
          body:    JSON.stringify({ runs })
        }, opts.timeoutMs ?? (timeoutMs * 6));
        if (r.status === 404){
          return { available: false, error: '/batch not deployed on the FORTRAN service yet (operator task 6)',
                   endpoint: joinUrl(baseUrl, '/batch') };
        }
        if (!r.ok){
          return { available: false, error: `HTTP ${r.status}`,
                   endpoint: joinUrl(baseUrl, '/batch') };
        }
        const j = await r.json();
        return { available: true, source: 'fcc-tvfmfs-fortran',
                 endpoint: joinUrl(baseUrl, '/batch'),
                 fetched_at: new Date().toISOString(),
                 runs: j.runs || [] };
      } catch (e){
        return { available: false, error: String(e?.message || e),
                 endpoint: joinUrl(baseUrl, '/batch') };
      }
    }
  };
}

function authHeaders(apiToken){
  if (!apiToken) return {};
  return { authorization: `Bearer ${apiToken}` };
}

function joinUrl(base, path){
  return String(base).replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
}

async function fetchWithTimeout(url, init = {}, ms = DEFAULT_TIMEOUT_MS){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
