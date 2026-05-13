// NOAA NCEI / NGDC ground-conductivity lookup adapter.
//
// Tier 3 in Genoa's σ resolution chain (after FCC + ZTR).  NOAA's
// National Centers for Environmental Information host the underlying
// geophysical data the FCC §73.190 / Figure M3 map was derived from.
// When the FCC's own endpoint AND ZTR's M3 proxy are both unreachable,
// NOAA NCEI is the authoritative US-government fallback.
//
// ENDPOINT
//   The default URL points at NOAA's geomag/conductivity lookup
//   namespace.  Operators MUST verify NOAA_CONDUCTIVITY_URL against
//   the current NCEI service catalog and override the env var for
//   their deploy if NOAA has moved the endpoint.  No data is
//   synthesized here — when the service returns nothing usable, the
//   client surfaces { available:false } and the caller falls through
//   to Tier 4.

const DEFAULT_BASE_URL   = process.env.NOAA_CONDUCTIVITY_URL
                        || 'https://www.ngdc.noaa.gov/geomag-web/calculators/groundconductivity';
const DEFAULT_TIMEOUT_MS = 8_000;

export function makeNoaaConductivityClient({
  baseUrl   = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn) return null;
  return {
    baseUrl,

    /**
     * Resolve σ (mS/m) at the given lat/lon from NOAA NCEI's ground-
     * conductivity service.  Same response contract as the other tiers.
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
          return { available: false, source: null, endpoint: url, fetched_at,
                   error: `HTTP ${r.status} from NOAA NCEI conductivity` };
        }
        const j = await r.json();
        const row = (j?.result && j.result[0])
                 || (j?.results && j.results[0])
                 || j;
        const sigma = pickFinite(row?.conductivity_mS_per_m,
                                 row?.conductivity_msm,
                                 row?.conductivity,
                                 row?.sigma_mS_m,
                                 // NOAA sometimes reports S/m — convert
                                 row?.conductivity_S_per_m != null
                                   ? Number(row.conductivity_S_per_m) * 1000 : null);
        if (sigma == null){
          return { available: false, source: null, endpoint: url, fetched_at,
                   error: 'no conductivity value in NOAA response' };
        }
        return {
          available:   true,
          sigma_mS_m:  sigma,
          zone:        row?.zone_label || row?.region || null,
          source:      'noaa-ncei',
          endpoint:    url,
          fetched_at
        };
      } catch (e){
        return { available: false, source: null, endpoint: url, fetched_at,
                 error: String(e?.message || e) };
      }
    }
  };
}

function pickFinite(...vals){
  for (const v of vals){
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
