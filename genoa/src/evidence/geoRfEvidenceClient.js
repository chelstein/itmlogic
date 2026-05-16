// Geo-RF Evidence sidecar client.
//
// Wraps the operator-hosted Geo-RF Evidence sidecar — a microservice that
// surfaces environmental geospatial datasets relevant to RF propagation
// (tree-canopy density, landcover classes, and RF/environment statistical
// model artifacts).  Used for advisory confidence-scoring and observed-
// vs-predicted residual support.
//
// ADVISORY ONLY.  This sidecar produces independent environmental
// evidence.  It never overrides, modifies, or substitutes for FCC
// curve-derived contour distances, allocation results, or any filing-
// controlling rule calculation:
//
//   - FCC §73.184 AM groundwave distances
//   - §73.182 AM nighttime allocation
//   - §73.190 skywave results
//   - §73.313 / §73.333 FM contour distances
//   - §73.207 / §73.215 compliance results
//   - any PASS/FAIL filing determination
//
// CONTRACT
//
//   GET /healthz
//     → 200 {
//         ok: true,
//         service: 'genoa-geo-rf-evidence',
//         datasets: {
//           tree_canopy_conus: true,
//           tau_rf_models:     true,
//           canada_landcover:  true
//         }
//       }
//
//   GET /sample/tree-canopy?lat={lat}&lon={lon}
//     → 200 {
//         ok: true,
//         dataset: 'science_tcc_CONUS_2022_v2023-5',
//         lat, lon,
//         value_raw: '35',      // string from raster sample
//         stderr:    '',
//         advisory:  true
//       }
//
// USE
//   Set GEO_RF_EVIDENCE_SIDECAR_URL on the deploy (and optionally
//   GEO_RF_EVIDENCE_API_TOKEN for bearer auth).  When unset,
//   makeGeoRfEvidenceClient returns null and the exhibit attaches
//   evidence.geo_rf_evidence = { status:'not_configured', advisory:true }
//   instead of failing the study.
//
// REGULATORY POSTURE
//   Environmental RF evidence is advisory only.  Does not modify FCC
//   filing-controlling contour or allocation calculations.

const DEFAULT_TIMEOUT_MS = 30_000;

export function makeGeoRfEvidenceClient({
  baseUrl   = process.env.GEO_RF_EVIDENCE_SIDECAR_URL || null,
  apiToken  = (process.env.GEO_RF_EVIDENCE_API_TOKEN || '').trim() || null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!baseUrl) return null;
  if (!fetchFn) return null;
  return {
    baseUrl,
    hasToken: !!apiToken,

    async health(){
      try {
        const r = await fetchWithTimeout(fetchFn,
          joinUrl(baseUrl, '/healthz'),
          { headers: auth(apiToken) }, 5_000);
        if (!r.ok) return false;
        const j = await r.json().catch(() => ({}));
        return !!j.ok;
      } catch { return false; }
    },

    /**
     * Full health payload (with dataset availability map).  Returns
     * { ok, datasets:{...} } on success, { ok:false } on failure.
     * Never throws.
     */
    async healthDetail(){
      try {
        const r = await fetchWithTimeout(fetchFn,
          joinUrl(baseUrl, '/healthz'),
          { headers: auth(apiToken) }, 5_000);
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
        return await r.json().catch(() => ({ ok: false, error: 'invalid JSON' }));
      } catch (e){
        return { ok: false, error: String(e?.message || e) };
      }
    },

    /**
     * Sample tree-canopy at a point.
     *
     * @returns {Promise<{available:boolean, dataset?, value_raw?,
     *                    value_numeric?, error?, fetched_at?}>}
     */
    async sampleTreeCanopy({ lat, lon } = {}, opts = {}){
      const fLat = Number(lat), fLon = Number(lon);
      if (!Number.isFinite(fLat) || !Number.isFinite(fLon)){
        return { available: false, error: 'lat / lon must be finite numbers' };
      }
      const url = joinUrl(baseUrl, '/sample/tree-canopy')
                  + `?lat=${encodeURIComponent(fLat.toFixed(6))}`
                  + `&lon=${encodeURIComponent(fLon.toFixed(6))}`;
      const t0 = Date.now();
      try {
        const r = await fetchWithTimeout(fetchFn, url,
          { headers: auth(apiToken) }, opts.timeoutMs ?? timeoutMs);
        if (!r.ok){
          return { available: false, error: `HTTP ${r.status}`,
                   endpoint: url, elapsed_ms: Date.now() - t0 };
        }
        const j = await r.json();
        if (j?.ok === false){
          return { available: false,
                   error: j.error || 'sidecar returned ok:false',
                   endpoint: url, elapsed_ms: Date.now() - t0 };
        }
        // value_raw is a string from the raster sample (e.g. "35").
        // Surface both raw and numeric so reviewers and downstream code
        // get the original token AND a parsed numeric they can chart.
        const value_numeric = j?.value_raw === undefined || j?.value_raw === null
          ? null
          : (Number.isFinite(Number(j.value_raw)) ? Number(j.value_raw) : null);
        return {
          available:     true,
          endpoint:      url,
          fetched_at:    new Date().toISOString(),
          elapsed_ms:    Date.now() - t0,
          dataset:       j.dataset || null,
          lat:           j.lat ?? fLat,
          lon:           j.lon ?? fLon,
          value_raw:     j.value_raw ?? null,
          value_numeric,
          stderr:        j.stderr || null,
          advisory:      j.advisory !== false,
          interpretation: interpretCanopy(value_numeric)
        };
      } catch (e){
        return { available: false, error: String(e?.message || e),
                 endpoint: url, elapsed_ms: Date.now() - t0 };
      }
    },

    /**
     * Composite "everything we know for a facility" sample.  Pulls the
     * tree-canopy point sample plus a fresh health probe so we surface
     * which auxiliary datasets are available even though we don't
     * sample tau/landcover for a single point in this pass.
     *
     * @returns the normalized evidence.geo_rf_evidence object shape
     */
    async sampleGeoRfEvidenceForFacility({ lat, lon, service, call, facility_id } = {}, opts = {}){
      // Treat null/undefined/'' as missing — Number(null)===0 would
      // otherwise falsely pass isFinite and try to sample at 0,0.
      const fLat = (lat === null || lat === undefined || lat === '') ? NaN : Number(lat);
      const fLon = (lon === null || lon === undefined || lon === '') ? NaN : Number(lon);
      const inputs = {
        lat:         Number.isFinite(fLat) ? fLat : null,
        lon:         Number.isFinite(fLon) ? fLon : null,
        service:     service     || null,
        call:        call        || null,
        facility_id: facility_id || null
      };
      if (!Number.isFinite(fLat) || !Number.isFinite(fLon)){
        return geoRfEnvelope({
          status: 'failed',
          inputs,
          error:  'coordinates_missing'
        });
      }
      const [health, canopy] = await Promise.all([
        this.healthDetail(),
        this.sampleTreeCanopy({ lat: fLat, lon: fLon }, opts)
      ]);
      const sidecarDatasets = (health && health.ok && health.datasets) || {};
      return geoRfEnvelope({
        status: canopy.available ? 'run' : (health.ok ? 'failed' : 'offline'),
        inputs,
        datasets: {
          tree_canopy_conus: canopy.available
            ? {
                available:      true,
                dataset:        canopy.dataset,
                value_raw:      canopy.value_raw,
                value_numeric:  canopy.value_numeric,
                interpretation: canopy.interpretation
              }
            : {
                available: !!sidecarDatasets.tree_canopy_conus,
                error:     canopy.error || null
              },
          tau_rf_models: {
            available: !!sidecarDatasets.tau_rf_models,
            role:      'RF/environment statistical model artifact'
          },
          canada_landcover: {
            available: !!sidecarDatasets.canada_landcover,
            role:      'available for Canadian coordinates / cross-border studies'
          }
        },
        sidecar_service: health?.service || 'genoa-geo-rf-evidence',
        baseUrl,
        elapsed_ms: canopy.elapsed_ms,
        fetched_at: new Date().toISOString()
      });
    }
  };
}

/* ---------- helpers ---------- */

function geoRfEnvelope({ status, inputs, datasets = {}, error, ...extra }){
  return {
    status,                                // 'run' | 'not_configured' | 'failed' | 'offline'
    advisory:        true,
    filing_effect:   'none',
    inputs,
    datasets,
    notes: [
      'Environmental RF evidence is advisory only.',
      'Does not modify FCC filing-controlling contour or allocation calculations.'
    ],
    ...(error ? { error } : {}),
    ...extra
  };
}

/** Best-effort qualitative interpretation of canopy density (USFS TCC
 *  canopy values are 0–100 % closed canopy).  Used only for the
 *  appendix "interpretation" label; never feeds back into FCC math. */
function interpretCanopy(v){
  if (v == null || !Number.isFinite(v)) return 'unavailable';
  if (v <  10) return 'low canopy / open ground';
  if (v <  30) return 'sparse canopy';
  if (v <  60) return 'moderate canopy / vegetation context';
  if (v <  80) return 'dense canopy';
  return 'very dense canopy';
}

function auth(token){
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

function joinUrl(base, path){
  return String(base).replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
}

async function fetchWithTimeout(fetchFn, url, init = {}, ms = DEFAULT_TIMEOUT_MS){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Build a not_configured envelope without constructing a client (used by
 *  the exhibit orchestrator when GEO_RF_EVIDENCE_SIDECAR_URL is unset). */
export function geoRfNotConfigured(inputs){
  return geoRfEnvelope({
    status: 'not_configured',
    inputs: inputs || { lat: null, lon: null, service: null, call: null, facility_id: null },
    datasets: {
      tree_canopy_conus: { available: false },
      tau_rf_models:     { available: false },
      canada_landcover:  { available: false }
    },
    error: 'GEO_RF_EVIDENCE_SIDECAR_URL unset — sidecar not invoked'
  });
}

export const GEO_RF_EVIDENCE_CLIENT_PROVENANCE = Object.freeze({
  module:        'src/evidence/geoRfEvidenceClient.js',
  upstream:      'genoa-geo-rf-evidence (operator sidecar — environmental geospatial datasets)',
  posture:       'ADVISORY — independent environmental RF evidence only.  Does not modify FCC §73.184 / §73.182 / §73.190 / §73.313 / §73.207 / §73.215 deterministic rule outputs.',
  datasets: [
    'science_tcc_CONUS_2022_v2023-5 (USFS Tree Canopy Cover, CONUS, 2022)',
    'tau_statistic_for_rf_models — RF/environment statistical model artifacts',
    'can_land_cover_2020v2_30m_tif (NRCan Canada landcover, 2020 v2, 30 m) — cross-border studies'
  ],
  modeled: [
    'Per-point canopy density (% closed canopy) at facility transmitter coordinates',
    'Auxiliary dataset availability surfaced via health probe'
  ],
  not_modeled: [
    'FCC §73.184 contour distance — that remains the FCC curve engine',
    'FCC §73.182 / §73.190 AM nighttime allocation',
    'FCC §73.313 / §73.333 FM contour math',
    'Any filing-controlling rule calculation'
  ]
});
