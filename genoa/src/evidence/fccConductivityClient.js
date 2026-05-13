// FCC ground-conductivity lookup adapter.
//
// Resolves the §73.190 / Figure M3 effective ground conductivity (σ,
// in mS/m) at a given lat/lon from geo.fcc.gov.  Used by AM groundwave
// compute and the NEC sidecar Sommerfeld-real-ground antenna model
// where the operator hasn't supplied an explicit σ.
//
// ENDPOINT
//   GET https://geo.fcc.gov/api/contours/conductivity.json
//        ?lat=<deg>&lon=<deg>&format=json
//
//   The endpoint URL is configurable via the FCC_CONDUCTIVITY_URL env
//   var so an operator can swap in a cached / vendored / proxied
//   version without code changes.  When the upstream is unreachable
//   or returns a non-200, this client returns { available: false,
//   error } and the caller falls back through the chain (ZTR proxy →
//   §73.182 typical synthetic default with disclosure).
//
// RESPONSE
//   Live FCC response shape (subject to FCC change without notice):
//     { results: [{ conductivity_mS_per_m: 4, zone_label: 'M3-12', … }] }
//   This client extracts conductivity_mS_per_m (preferred), then
//   conductivity_msm / conductivity, returning null if no usable value.
//
// LICENSE BOUNDARY
//   Genoa never embeds FCC M3 raster data; every value is pulled live
//   from the public FCC endpoint.  Provenance is stamped on every
//   evidence record so reviewers can re-run the exact query.

const DEFAULT_BASE_URL   = 'https://geo.fcc.gov/api/contours/conductivity.json';
const DEFAULT_TIMEOUT_MS = 8_000;

export function makeFccConductivityClient({
  baseUrl   = process.env.FCC_CONDUCTIVITY_URL || DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn) return null;
  return {
    baseUrl,

    /**
     * Resolve σ (mS/m) at the given lat/lon from the FCC §73.190 / M3
     * conductivity layer.
     *
     * @param {object} args
     * @param {number} args.lat  decimal degrees, WGS-84
     * @param {number} args.lon  decimal degrees, WGS-84
     * @returns {Promise<{available:boolean, sigma_mS_m?:number,
     *                    zone?:string, source:string, endpoint:string,
     *                    fetched_at:string, error?:string}>}
     */
    async lookupSigma({ lat, lon } = {}){
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))){
        return { available: false, source: null, error: 'lat/lon required (finite)' };
      }
      const url = `${baseUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json`;
      const fetched_at = new Date().toISOString();
      try {
        const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok){
          return { available: false, source: null, endpoint: url,
                   fetched_at, error: `HTTP ${r.status} from FCC conductivity API` };
        }
        const j = await r.json();
        const row = (j?.results && j.results[0]) || j;
        const sigma_mS_m = pickFinite(row?.conductivity_mS_per_m,
                                      row?.conductivity_msm,
                                      row?.conductivity);
        if (sigma_mS_m == null){
          return { available: false, source: null, endpoint: url,
                   fetched_at, error: 'no conductivity value in FCC response' };
        }
        return {
          available:   true,
          sigma_mS_m,
          zone:        row?.zone_label || row?.zone || row?.m3_zone || null,
          source:      'fcc-m3',
          endpoint:    url,
          fetched_at
        };
      } catch (e){
        return { available: false, source: null, endpoint: url,
                 fetched_at, error: String(e?.message || e) };
      }
    }
  };
}

function pickFinite(...vals){
  for (const v of vals){
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
