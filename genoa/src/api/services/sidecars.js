// Resolves environment-configured sidecars into ready-to-use clients.
// Missing sidecar URL → null client → engine still runs.

import { makeTerrainClient }  from '../../evidence/terrain/client.js';
import { makeIdentityClient } from '../../evidence/identity/index.js';

export const sidecars = Object.freeze({
  terrain:     makeTerrainClient ({ baseUrl: process.env.TERRAIN_SIDECAR_URL  }),
  identity:    makeIdentityClient({ baseUrl: process.env.IDENTITY_SIDECAR_URL }),
  measurement: process.env.MEASUREMENT_SIDECAR_URL ? { baseUrl: process.env.MEASUREMENT_SIDECAR_URL } : null
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
