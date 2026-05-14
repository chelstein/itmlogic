// ITU-R BR ground-conductivity lookup adapter.
//
// Tier 4 (last live tier before the chain exhausts to a hard blocker)
// in Genoa's σ resolution chain.  The International Telecommunication
// Union's Radiocommunication Bureau publishes the "World Atlas of
// Ground Conductivities" — the same dataset that underpins the FCC
// §73.190 / Figure M3 map but extended to global coverage.  Used for
// stations near the US/Canada or US/Mexico border zones where the
// FCC's national map may not extend, AND as the final-tier authority
// when FCC, ZTR, and NOAA are all unreachable.
//
// CONFIGURATION
//   This client is OPT-IN.  ITU publishes the World Atlas as software
//   tools and downloadable datasets rather than a stable public JSON
//   API — operators must point Genoa at their own service (a vendored
//   atlas raster fronted by an HTTP wrapper, or a commercial proxy).
//   Set ITU_CONDUCTIVITY_URL on the deploy to enable; unset →
//   makeItuConductivityClient() returns null and the sidecar shows
//   "not configured" instead of BLOCKED.

const DEFAULT_TIMEOUT_MS = 10_000;     // atlas backends are sometimes slow

export function makeItuConductivityClient({
  baseUrl   = process.env.ITU_CONDUCTIVITY_URL || null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn || !baseUrl) return null;
  return {
    baseUrl,

    // Liveness probe — any HTTP response = host reachable.
    async health(){
      try {
        const r = await fetchFn(
          `${baseUrl}?lat=37.0902&lon=-95.7129&format=json`,
          { signal: AbortSignal.timeout(3000) });
        return r.status >= 200 && r.status < 600;
      } catch { return false; }
    },

    /**
     * Resolve σ (mS/m) at the given lat/lon from ITU-R BR's World
     * Atlas of Ground Conductivities.  Same response contract as the
     * other tiers.
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
                   error: `HTTP ${r.status} from ITU-R BR conductivity atlas` };
        }
        const j = await r.json();
        const row = (j?.result && j.result[0])
                 || (j?.results && j.results[0])
                 || j;
        const sigma = pickFinite(row?.conductivity_mS_per_m,
                                 row?.conductivity_msm,
                                 row?.conductivity,
                                 row?.sigma_mS_m,
                                 row?.conductivity_S_per_m != null
                                   ? Number(row.conductivity_S_per_m) * 1000 : null);
        if (sigma == null){
          return { available: false, source: null, endpoint: url, fetched_at,
                   error: 'no conductivity value in ITU-R response' };
        }
        return {
          available:   true,
          sigma_mS_m:  sigma,
          zone:        row?.zone_label || row?.atlas_region || row?.region || null,
          source:      'itu-r-br-atlas',
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
