// fccgwClient.js — Genoa client for the FCCGW advisory sidecar.
//
// Wraps the FCC/OET R86-1 Ground Wave sidecar (genoa/src/sidecars/fccgw/).
// The sidecar runs Octave + GroundWaveFCC to compute groundwave field
// strengths and contour distances for AM stations.
//
// REGULATORY POSTURE
//   ALL responses carry advisory:true, filing_effect:'none'.
//   FCCGW output is an independent physics cross-check ONLY.
//   It NEVER substitutes for FCC §73.184 curve-derived contour
//   distances or any other filing-controlling rule calculation.
//
// SERVICE CONTRACT (see genoa/src/sidecars/fccgw/server.js)
//
//   GET  /healthz
//     → { ok, octave_available, fccgw_path, started_at }
//
//   GET  /version
//     → { engine, model, regulation, advisory, filing_effect, label,
//         octave_path, fccgw_path }
//
//   POST /am/fccgw/field
//     body: { freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km? }
//     → { ok, advisory, filing_effect, engine, inputs, distances_km, fields_mvm }
//
//   POST /am/fccgw/contour
//     body: { freq_hz, sigma_s_per_m, epsilon, e1km_mvm, target_field_mvm }
//     → { ok, advisory, filing_effect, engine, inputs,
//         contour_distance_km, field_mvm_at_contour, bracketed_by, n_grid_points }
//
// USE
//   Genoa-side wiring in src/api/services/sidecars.js:
//     fccgw: makeFccgwClient()
//   Consumed by exhibitService.js step 8e-2 for AM physics cross-check.

const DEFAULT_TIMEOUT_MS = 30_000;

export const FCCGW_CLIENT_VERSION = '1.0.0';

/**
 * Provenance descriptor attached to all FCCGW evidence blocks.
 * Frozen to prevent accidental mutation by callers.
 */
export const FCCGW_PROVENANCE = Object.freeze({
  module:      'src/evidence/fccgwClient.js',
  upstream:    'GroundWaveFCC (FCC/OET R86-1 ground wave model, Octave implementation)',
  posture:     'ADVISORY — never substitutes for FCC §73.184 groundwave contour distances',
  envelope:    'advisory:true + filing_effect:none on every response',
  label:       'Independent Physics Validation — FCC/OET R86-1 Ground Wave',
  not_modeled: [
    'FCC §73.184 groundwave contour distance (that remains the FCC curve engine)',
    'Filing-controlling contour math of any kind',
    'AM nighttime skywave (that is §73.190(c) / FCCAM / Berry)',
    'Any §73.182 allocation result',
  ],
});

/**
 * Build the advisory envelope every FCCGW response must conform to.
 * Centralised so callers cannot accidentally drop advisory:true or
 * filing_effect:'none' — those are the contract that keeps FCCGW out
 * of filing math.
 *
 * @param {object} extra  Merged into the envelope.
 * @returns {object}
 */
export function advisoryEnvelope(extra = {}){
  return {
    advisory:      true,
    filing_effect: 'none',
    engine:        'fccgw-oet-r86-1',
    label:         'Independent Physics Validation — FCC/OET R86-1 Ground Wave',
    available:     false,
    ...extra,
  };
}

/**
 * Construct a live FCCGW advisory client.
 *
 * Returns null when FCCGW_SIDECAR_URL is unset so the orchestrator
 * can fail-soft exactly like other advisory sidecars.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.baseUrl=process.env.FCCGW_SIDECAR_URL]
 * @param {string}  [opts.apiToken=process.env.FCCGW_API_TOKEN]
 * @param {number}  [opts.timeoutMs=30000]
 * @returns {{ baseUrl, version, health, runField, runContour } | null}
 */
export function makeFccgwClient({
  baseUrl   = process.env.FCCGW_SIDECAR_URL || null,
  apiToken  = (process.env.FCCGW_API_TOKEN  || '').trim() || null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!baseUrl) return null;

  const url     = baseUrl.replace(/\/$/, '');
  const headers = {
    'Content-Type': 'application/json',
    ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {})
  };

  async function fetchWithTimeout(input, init = {}, overrideMs){
    const ms   = overrideMs ?? timeoutMs;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(input, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl,
    version: FCCGW_CLIENT_VERSION,

    /**
     * Probe sidecar health.
     * Returns true only when the sidecar is reachable AND reports ok:true.
     * Uses a 3 s timeout so /readyz is never stalled by a slow sidecar.
     *
     * @returns {Promise<boolean>}
     */
    async health(){
      try {
        const res = await fetchWithTimeout(`${url}/healthz`, { method: 'GET' }, 3_000);
        if (!res.ok) return false;
        const body = await res.json();
        return body.ok === true;
      } catch {
        return false;
      }
    },

    /**
     * Compute field strength at each supplied distance.
     *
     * @param {object}   params
     * @param {number}   params.freq_hz          Carrier frequency in Hz (530–1710 kHz band)
     * @param {number}   params.sigma_s_per_m    Ground conductivity in S/m (e.g. 0.008)
     * @param {number}   params.epsilon          Relative dielectric constant (≥1)
     * @param {number}   params.e1km_mvm         Reference field at 1 km in mV/m
     * @param {number[]} [params.distances_km]   Distances in km (defaults to 200-point grid)
     * @returns {Promise<{ advisory:true, filing_effect:'none', available:boolean, ... }>}
     */
    async runField({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km } = {}){
      const t0 = Date.now();
      try {
        const res = await fetchWithTimeout(`${url}/am/fccgw/field`, {
          method:  'POST',
          headers,
          body:    JSON.stringify({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, distances_km }),
        });

        if (!res.ok){
          const detail = await res.text().catch(() => '');
          return advisoryEnvelope({
            available:  false,
            status:     'sidecar_error',
            reason:     `FCCGW sidecar returned HTTP ${res.status}: ${detail.slice(0, 200)}`,
            elapsed_ms: Date.now() - t0
          });
        }

        const body = await res.json();
        // Belt-and-suspenders: always enforce advisory contract regardless
        // of what the sidecar returns.  A misconfigured sidecar must not
        // be able to inject filing-controlling data.
        return {
          ...body,
          advisory:      true,
          filing_effect: 'none',
          engine:        'fccgw-oet-r86-1',
          label:         'Independent Physics Validation — FCC/OET R86-1 Ground Wave',
          available:     true,
          elapsed_ms:    Date.now() - t0
        };
      } catch (e){
        return advisoryEnvelope({
          available:  false,
          status:     'sidecar_unreachable',
          reason:     e.message,
          elapsed_ms: Date.now() - t0
        });
      }
    },

    /**
     * Compute the contour distance for a target field strength.
     *
     * @param {object} params
     * @param {number} params.freq_hz           Carrier frequency in Hz
     * @param {number} params.sigma_s_per_m     Ground conductivity in S/m
     * @param {number} params.epsilon           Relative dielectric constant
     * @param {number} params.e1km_mvm          Reference field at 1 km in mV/m
     * @param {number} params.target_field_mvm  Target contour field in mV/m
     * @returns {Promise<{
     *   advisory: true,
     *   filing_effect: 'none',
     *   available: boolean,
     *   contour_distance_km: number | null,
     *   field_mvm_at_contour: number | null,
     *   bracketed_by: object | null,
     *   n_grid_points: number
     * }>}
     */
    async runContour({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, target_field_mvm } = {}){
      const t0 = Date.now();
      try {
        const res = await fetchWithTimeout(`${url}/am/fccgw/contour`, {
          method:  'POST',
          headers,
          body:    JSON.stringify({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, target_field_mvm }),
        });

        if (!res.ok){
          const detail = await res.text().catch(() => '');
          return advisoryEnvelope({
            available:  false,
            status:     'sidecar_error',
            reason:     `FCCGW sidecar returned HTTP ${res.status}: ${detail.slice(0, 200)}`,
            elapsed_ms: Date.now() - t0
          });
        }

        const body = await res.json();
        // Always enforce the advisory contract — belt-and-suspenders.
        return {
          ...body,
          advisory:      true,
          filing_effect: 'none',
          engine:        'fccgw-oet-r86-1',
          label:         'Independent Physics Validation — FCC/OET R86-1 Ground Wave',
          available:     true,
          elapsed_ms:    Date.now() - t0
        };
      } catch (e){
        return advisoryEnvelope({
          available:  false,
          status:     'sidecar_unreachable',
          reason:     e.message,
          elapsed_ms: Date.now() - t0
        });
      }
    }
  };
}
