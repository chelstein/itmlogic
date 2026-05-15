// HTTP-backed raster sampler.
//
// Used when Genoa runs in an environment that can't see the /opt/genoa
// corpus directly (e.g. DO App Platform).  Calls the geodata sidecar
// running on the droplet next to the FORTRAN sidecar — see
// `genoa/src/sidecars/geodata/`.
//
// Returns the exact same shape as the local rasterSampler in
// rasterSampler.js so the per-layer interpreters in layers.js don't
// care which transport produced the value.
//
// Selected by config: when GEODATA_SIDECAR_URL is set, the geodata
// service uses this; otherwise it falls back to local gdallocationinfo
// (which is fine for unit tests + the droplet itself).

export function makeHttpRasterSampler({
  baseUrl,
  apiToken,
  fetchFn = globalThis.fetch,
  timeoutMs = 8_000
} = {}){
  if (!baseUrl) throw new Error('makeHttpRasterSampler: baseUrl required');
  const base = String(baseUrl).replace(/\/+$/, '');
  const auth = apiToken ? { authorization: `Bearer ${apiToken}` } : {};

  async function fetchJson(url){
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchFn(url, { headers: auth, signal: ctrl.signal });
      const txt = await r.text();
      let j; try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
      return { ok: r.ok, status: r.status, body: j, raw: txt };
    } finally { clearTimeout(to); }
  }

  async function sampleRaster({ tif, lon, lat }){
    const url = `${base}/raster/sample?path=${encodeURIComponent(tif)}`
              + `&lon=${encodeURIComponent(String(lon))}`
              + `&lat=${encodeURIComponent(String(lat))}`;
    const replayLocal = `gdallocationinfo -wgs84 -valonly ${tif} ${lon} ${lat}`;
    let r;
    try { r = await fetchJson(url); }
    catch (e){
      return { available: false, reason: 'sidecar_unreachable',
               error: String(e?.message || e), replay: replayLocal };
    }
    if (!r.ok){
      return { available: false, reason: 'sidecar_error',
               status: r.status, body: r.body, replay: replayLocal };
    }
    // The sidecar returns a response in the canonical rasterSampler
    // shape, so we can pass it through.  We still defensively include
    // a `replay` if the sidecar omitted one.
    const out = r.body || {};
    if (!out.replay) out.replay = replayLocal;
    return out;
  }

  async function statRaster(absPath){
    const url = `${base}/raster/status?path=${encodeURIComponent(absPath)}`;
    try {
      const r = await fetchJson(url);
      if (!r.ok) return { exists: false, sidecar_status: r.status };
      return r.body || { exists: false };
    } catch (e){
      return { exists: false, error: String(e?.message || e) };
    }
  }

  return { sampleRaster, statRaster };
}
