// Population evidence client — env-hook only.
//
// POPULATION_EVIDENCE_URL points at a future Census/ACS adapter.  When
// unset (today's state), Genoa keeps the placeholder estimate and the
// POPULATION_PLACEHOLDER warning.  When set, the adapter is expected
// to return:
//
//   POST {POPULATION_EVIDENCE_URL}/v1/population/contour
//   { geojson, contour_label }
//   ->
//   { source, dataset, vintage, persons, sha256, fetched_at }
//
// Genoa never fabricates population numbers; if this client returns
// null the warning persists.

const DEFAULT_TIMEOUT_MS = 15_000;

export function makePopulationClient({ baseUrl = process.env.POPULATION_EVIDENCE_URL || null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  if (!baseUrl) return null;
  return {
    baseUrl,
    async populationForContour({ geojson, contour_label }){
      try {
        const r = await fetch(joinUrl(baseUrl, '/v1/population/contour'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ geojson, contour_label }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; }
    }
  };
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}
