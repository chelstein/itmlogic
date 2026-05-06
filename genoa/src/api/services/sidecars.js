// Resolves environment-configured sidecars into ready-to-use clients.
// Missing sidecar URL → null client → engine still runs.
//
// CANONICAL FALLBACK MATRIX (probed live at /api/sources/health)
//
//   Query                Primary                 Secondary               Tertiary
//   ----------------     -----------------       ------------------      ---------------------------
//   Facility metadata    ZTR /api/broadcast      FCC FMQ/AMQ direct      n8n station/analyze
//   FCC contour          ZTR _fcc_contour        geo.fcc.gov direct      engine self-computes
//   Per-radial HAAT      FCC contour HAAT        ZTR terrain-haat        USGS + OpenMeteo + OpenTopoData
//   Population/Census    operator pop sidecar    geo.fcc.gov/api/census  —
//   Nearby primaries     FCC FMQ direct          FCC AMQ direct          —
//   Rich station / SDR   ZTR /api/radiodns       —                       — (vendor-locked)
//   Identity / RadioDNS  identity sidecar        —                       — (optional)
//
// Every tier is independent — primary failure does NOT cascade.  The
// orchestrator (exhibitService.js) walks each chain top-down and stops
// at the first tier that returns usable data.  Failed tiers are
// recorded as evidence (e.g., evidence.terrain_ztr_attempted) so the
// exhibit's provenance shows exactly which fallback won.

import { makeTerrainClient }     from '../../evidence/terrain/client.js';
import { makeSplatClient }       from '../../evidence/terrain/splatClient.js';
import { makeIdentityClient }    from '../../evidence/identity/index.js';
import { makeFacilityClient }    from './facilityClient.js';
import { makePopulationClient }  from '../../evidence/populationClient.js';
import { makeFccCensusClient }   from '../../evidence/fccCensusClient.js';
import { makeFccContoursClient } from '../../evidence/fccContoursClient.js';

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
  population:  buildPopulationClient(),
  // FCC Contours direct fallback: used when ZTR doesn't have _fcc_contour
  // or ZTR is not configured.  Always on (geo.fcc.gov is public / no auth).
  // Disable with FCC_CONTOURS_DISABLE=1.
  fccContours: process.env.FCC_CONTOURS_DISABLE === '1' ? null : makeFccContoursClient()
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
