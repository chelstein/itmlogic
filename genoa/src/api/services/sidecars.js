// Resolves environment-configured sidecars into ready-to-use clients.
// Missing sidecar URL → null client → engine still runs.

import { makeTerrainClient }    from '../../evidence/terrain/client.js';
import { makeSplatClient }      from '../../evidence/terrain/splatClient.js';
import { makeIdentityClient }   from '../../evidence/identity/index.js';
import { makeFacilityClient }   from './facilityClient.js';
import { makePopulationClient } from '../../evidence/populationClient.js';
import { makeFccCensusClient }  from '../../evidence/fccCensusClient.js';

// Population evidence priority:
//   1. POPULATION_EVIDENCE_URL — operator-managed sidecar (any source)
//   2. FCC Census Block API direct — geo.fcc.gov/api/census/area, no
//      sidecar required (default ON; disable with
//      POPULATION_DISABLE_FCC_CENSUS=1).
//   3. null — POPULATION_PLACEHOLDER warning persists.
function buildPopulationClient(){
  const sidecar = makePopulationClient();
  if (sidecar) return sidecar;
  if (process.env.POPULATION_DISABLE_FCC_CENSUS === '1') return null;
  return makeFccCensusClient({
    censusYear:  Number(process.env.POPULATION_CENSUS_YEAR) || 2020,
    samples:     Number(process.env.POPULATION_SAMPLES)     || undefined,
    concurrency: Number(process.env.POPULATION_CONCURRENCY) || undefined
  });
}

export const sidecars = Object.freeze({
  terrain:     makeTerrainClient ({ baseUrl: process.env.TERRAIN_SIDECAR_URL  }),
  // SPLAT sidecar (chelstein/splat — Genoa Flask sidecar).  When set,
  // Genoa probes its capability and surfaces SPLAT availability /
  // DEM-provisioning state as evidence provenance.
  splat:       makeSplatClient   ({ baseUrl: process.env.SPLAT_SIDECAR_URL    }),
  identity:    makeIdentityClient({ baseUrl: process.env.IDENTITY_SIDECAR_URL }),
  measurement: process.env.MEASUREMENT_SIDECAR_URL ? { baseUrl: process.env.MEASUREMENT_SIDECAR_URL } : null,
  // Facility lookup is not a sidecar in the propagation sense — it's a
  // read-only adapter into chelstein/zerotrustradio (and optionally the
  // n8n station/analyze webhook).  Lives here so the same /readyz block
  // can report all upstreams.
  facility:    makeFacilityClient(),
  // Population evidence: operator sidecar first, FCC Census API
  // fallback (always available unless explicitly disabled).
  population:  buildPopulationClient()
});

export async function sidecarStatus(){
  const out = {};
  for (const [name, c] of Object.entries(sidecars)){
    if (!c){ out[name] = { configured: false, healthy: false }; continue; }
    let healthy = false;
    if (typeof c.health === 'function'){
      try { healthy = !!(await c.health()); } catch { healthy = false; }
    } else {
      try {
        const r = await fetch(c.baseUrl.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(3000) });
        healthy = r.ok;
      } catch { healthy = false; }
    }
    out[name] = { configured: true, healthy, baseUrl: c.baseUrl || null };
  }
  return out;
}
