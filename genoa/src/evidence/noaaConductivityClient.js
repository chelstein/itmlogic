// NOAA NCEI / NGDC ground-conductivity lookup adapter.
//
// Tier 3 in Genoa's σ resolution chain (after FCC + ZTR).  NOAA's
// National Centers for Environmental Information host the underlying
// geophysical data the FCC §73.190 / Figure M3 map was derived from.
// When the FCC's own endpoint AND ZTR's M3 proxy are both unreachable,
// NOAA NCEI is the authoritative US-government fallback.
//
// CONFIGURATION
//   This client is OPT-IN.  NOAA NCEI exposes several conductivity
//   datasets but no single stable JSON endpoint with consistent
//   schema — operators must point Genoa at a deployment-specific URL
//   (the NCEI service catalog endpoint that fits their use case, or
//   an in-house proxy that normalises the response).  Set
//   NOAA_CONDUCTIVITY_URL on the deploy to enable; unset →
//   makeNoaaConductivityClient() returns null and the sidecar shows
//   "not configured" instead of BLOCKED.

const DEFAULT_TIMEOUT_MS = 8_000;

export function makeNoaaConductivityClient({
  baseUrl   = process.env.NOAA_CONDUCTIVITY_URL || null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn || !baseUrl) return null;
  return {
    baseUrl,

    // Liveness probe — any HTTP response = host reachable.  Avoids
    // BLOCKED-mark for endpoints that exist but have no record for
    // the probe coordinate.
    async health(){
      try {
        const r = await fetchFn(
          `${baseUrl}?lat=37.0902&lon=-95.7129&format=json`,
          { signal: AbortSignal.timeout(3000) });
        return r.status >= 200 && r.status < 600;
      } catch { return false; }
    },

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
