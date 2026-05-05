// Direct FCC Contours API client.
//
// Fetches the FCC's published terrain-aware service contour for a
// licensed station directly from geo.fcc.gov — no ZTR proxy required.
//
// ENDPOINT
//   https://geo.fcc.gov/api/contours/entity.json
//   ?facilityId=<id>&serviceType=<FM|AM|LPFM|FX>&unit=km
//
// The endpoint returns a GeoJSON FeatureCollection whose features are
// the FCC's ITM-computed service contours (one feature per contour
// filed — usually one, sometimes multiple for directional stations).
// Properties on each feature include: callsign, facility_id, field
// (dBu for FM/LPFM/FX; mV/m for AM), erp, haat per radial, etc.
//
// OUTPUT SHAPE
//   Same as facilityClient.getFccContour:
//   { available, source, endpoint, upstream_api, feature_count, contour }
//   where `contour` is the raw GeoJSON FeatureCollection from geo.fcc.gov.
//
// SERVICE TYPE MAPPING
//   Genoa service → FCC API serviceType parameter:
//     FM / FS / FB → FM    (FS = FM auxiliary; FB = FM booster)
//     FX           → FX    (FM translator)
//     LPFM / L1    → LPFM
//     AM           → AM

const DEFAULT_BASE_URL   = 'https://geo.fcc.gov/api/contours/entity.json';
const DEFAULT_TIMEOUT_MS = 12_000;

const SERVICE_TO_TYPE = {
  FM:   'FM',
  FS:   'FM',
  FB:   'FM',
  FX:   'FX',
  LPFM: 'LPFM',
  L1:   'LPFM',
  AM:   'AM'
};

export function makeFccContoursClient({
  baseUrl   = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn) return null;

  return {
    baseUrl,

    /**
     * Fetch the FCC published contour for a licensed station.
     *
     * @param {string|number} facilityId  FCC facility ID
     * @param {string}        service     Genoa service code (FM/AM/LPFM/FX/FS/FB)
     * @returns {object}  { available, source, endpoint, upstream_api, feature_count, contour }
     */
    async getContour(facilityId, service){
      if (!facilityId){
        return { available: false, source: null, error: 'facilityId required' };
      }
      const serviceType = SERVICE_TO_TYPE[String(service || '').toUpperCase()] || null;
      if (!serviceType){
        return { available: false, source: null,
                 error: `unknown service "${service}" — cannot map to FCC serviceType` };
      }
      const endpoint = `${baseUrl}?facilityId=${encodeURIComponent(facilityId)}&serviceType=${serviceType}&unit=km`;
      try {
        const r = await fetchFn(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok){
          return { available: false, source: null, endpoint,
                   error: `HTTP ${r.status} from FCC Contours API` };
        }
        const json = await r.json();
        if (json?.status === 'error'){
          return { available: false, source: null, endpoint,
                   error: `FCC Contours API error: ${json.statusMessage || json.statusCode}` };
        }
        if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features) || !json.features.length){
          return { available: false, source: null, endpoint,
                   error: 'FCC Contours API returned no features for this station' };
        }
        return {
          available:     true,
          source:        'fcc-contours-direct',
          endpoint,
          upstream_api:  baseUrl,
          fetched_at:    new Date().toISOString(),
          feature_count: json.features.length,
          contour:       json
        };
      } catch (e){
        return { available: false, source: null, endpoint,
                 error: `FCC Contours API fetch failed: ${e.message}` };
      }
    }
  };
}
