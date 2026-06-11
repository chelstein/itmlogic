// Community boundary resolver — fetches the legal city-limits polygon for a
// principal community of license so §73.24(i) can run the 5 mV/m coverage
// check rather than returning NOT_MEASURED.
//
// Two-tier lookup (US-focused, no API key required):
//   Tier 1 — US Census TIGER Web REST (authoritative US legal boundaries,
//             no rate limit, returns exact incorporated-place polygons).
//   Tier 2 — Nominatim/OpenStreetMap (international fallback; 1 req/s
//             limit per Nominatim's terms, used only when TIGER misses).
//
// Results are cached in-process (LRU-like Map, 30-entry cap, 30-min TTL)
// so repeated compute runs for the same station don't hammer the upstream.
//
// Usage:
//   const client = makeCommunityBoundaryClient();
//   const result = await client.getByName({ community: 'Sherman', state: 'TX' });
//   // → { available: true, geojson: GeoJSON.Feature<Polygon>, source, ... }
//
// The returned geojson shape matches what §73.24(i)'s extractFirstPolygon()
// expects: a GeoJSON Feature or FeatureCollection in WGS-84.

const TIGER_BASE  = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/56/query';
const NOMINATIM   = 'https://nominatim.openstreetmap.org/search';
const CACHE_TTL   = 30 * 60 * 1000;   // 30 min
const CACHE_MAX   = 30;

// Static US state abbr → FIPS code lookup (USPS 2-letter → Census 2-digit).
const STATE_FIPS = {
  AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',
  FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',
  KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',
  MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',
  NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',
  SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',
  WI:'55',WY:'56',DC:'11',PR:'72',VI:'78',GU:'66',AS:'60',MP:'69'
};

// Parse community+state from a string like "Sherman, TX" → { name, stateAbbr }.
export function parseCommunityState(raw){
  if (!raw) return { name: null, stateAbbr: null };
  const m = String(raw).trim().match(/^(.+?),\s*([A-Z]{2})$/i);
  if (m) return { name: m[1].trim(), stateAbbr: m[2].toUpperCase() };
  return { name: String(raw).trim(), stateAbbr: null };
}

const _cache = new Map();   // key → { ts, result }

function cacheGet(key){ const e = _cache.get(key); return e && (Date.now() - e.ts < CACHE_TTL) ? e.result : null; }
function cacheSet(key, result){ if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value); _cache.set(key, { ts: Date.now(), result }); }

export function makeCommunityBoundaryClient({ fetchFn = (typeof fetch === 'function' ? fetch : null) } = {}){
  if (!fetchFn) return null;

  return {
    /**
     * Fetch the legal city-limits polygon.
     * @param {{ community:string, state?:string }} opts
     *   community — city name (e.g. "Sherman" or "Sherman, TX")
     *   state     — optional 2-letter USPS code; parsed from community if omitted
     * @returns {{ available:boolean, geojson?, source?, community?, state?, error? }}
     */
    async getByName({ community, state } = {}){
      const parsed     = parseCommunityState(community);
      const cityName   = parsed.name   || community;
      const stateAbbr  = (state ? String(state).trim().toUpperCase() : null)
                       || parsed.stateAbbr;
      if (!cityName) return { available: false, error: 'community name required' };

      const cacheKey = `${cityName.toLowerCase()}|${stateAbbr || ''}`;
      const cached   = cacheGet(cacheKey);
      if (cached) return cached;

      // Tier 1: Census TIGER Web (US only; requires FIPS code).
      const stateFips = stateAbbr ? STATE_FIPS[stateAbbr] : null;
      if (stateFips){
        try {
          const where  = `NAME='${cityName.replace(/'/g,"''")}' AND STATEFP='${stateFips}'`;
          const params = new URLSearchParams({
            where,
            outFields:       'GEOID,NAME,LSADC,STATEFP',
            returnGeometry:  'true',
            geometryPrecision: '6',
            outSR:           '4326',
            f:               'geojson'
          });
          const url  = `${TIGER_BASE}?${params}`;
          const resp = await fetchFn(url, {
            headers: { Accept: 'application/json' },
            signal:  AbortSignal.timeout(8000)
          });
          if (resp.ok){
            const fc = await resp.json();
            const feat = (fc.features || []).find(f =>
              f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
            if (feat){
              const result = {
                available:  true,
                geojson:    feat,
                source:     'census-tiger',
                community:  cityName,
                state:      stateAbbr,
                geoid:      feat.properties?.GEOID || null,
                endpoint:   url
              };
              cacheSet(cacheKey, result);
              return result;
            }
          }
        } catch { /* fall through to Nominatim */ }
      }

      // Tier 2: Nominatim / OpenStreetMap.
      try {
        const q      = stateAbbr ? `${cityName}, ${stateAbbr}, USA` : cityName;
        const params = new URLSearchParams({
          q,
          format:          'geojson',
          polygon_geojson: '1',
          limit:           '5',
          addressdetails:  '1'
        });
        const url  = `${NOMINATIM}?${params}`;
        const resp = await fetchFn(url, {
          headers: {
            Accept:     'application/json',
            'User-Agent': 'Genoa-FCC-Studio/1.0 (broadcast engineering; chuck@mellowmountainradio.com)'
          },
          signal: AbortSignal.timeout(8000)
        });
        if (resp.ok){
          const fc   = await resp.json();
          const feat = (fc.features || []).find(f =>
            (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') &&
            (f.properties?.category === 'boundary' || f.properties?.type === 'administrative'
             || f.properties?.addresstype === 'city' || f.properties?.addresstype === 'town'));
          if (feat){
            const result = {
              available:  true,
              geojson:    feat,
              source:     'nominatim-osm',
              community:  cityName,
              state:      stateAbbr,
              endpoint:   url
            };
            cacheSet(cacheKey, result);
            return result;
          }
        }
      } catch { /* fall through */ }

      const result = {
        available: false,
        source:    'DATA SOURCE ERROR',
        community: cityName,
        state:     stateAbbr,
        error:     `Community boundary not found for "${cityName}"${stateAbbr ? `, ${stateAbbr}` : ''} — Census TIGER and Nominatim returned no polygon.  Attach inputs.community_boundary_geojson manually.`
      };
      cacheSet(cacheKey, result);
      return result;
    }
  };
}
