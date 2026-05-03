// Resolves environment-configured sidecars into ready-to-use clients.
// Missing sidecar URL → null client → engine still runs.

import { makeTerrainClient }  from '../../evidence/terrain/client.js';
import { makeIdentityClient } from '../../evidence/identity/index.js';
import { makeFacilityClient } from './facilityClient.js';

export const sidecars = Object.freeze({
  terrain:     makeTerrainClient ({ baseUrl: process.env.TERRAIN_SIDECAR_URL  }),
  identity:    makeIdentityClient({ baseUrl: process.env.IDENTITY_SIDECAR_URL }),
  measurement: process.env.MEASUREMENT_SIDECAR_URL ? { baseUrl: process.env.MEASUREMENT_SIDECAR_URL } : null,
  // Facility lookup is not a sidecar in the propagation sense — it's a
  // read-only adapter into chelstein/zerotrustradio (and optionally the
  // n8n station/analyze webhook).  Lives here so the same /readyz block
  // can report all upstreams.
  facility:    makeFacilityClient()
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
