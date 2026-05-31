// Genoa VOACAP advisory sidecar client.
//
// Talks to the VOACAP sidecar — a FastAPI wrapper around the NTIA/ITS
// VOACAP (Voice of America Coverage Analysis Program) HF propagation
// prediction tool via the jawatson/voacapl Linux port.  The sidecar
// runs at VOACAP_SIDECAR_URL; when unset, makeVoacapClient() returns
// null and the orchestrator skips advisory_voacap silently.
//
// REGULATORY POSTURE
//   ALL responses carry advisory:true, filing_effect:'none'.
//   VOACAP output provides ionospheric context for AM nighttime skywave
//   studies; it NEVER substitutes for FCC §73.190(c) / §73.182 math.
//
// SERVICE CONTRACT (see genoa/src/sidecars/voacap/main.py)
//
//   GET  /healthz
//     → 200 { ok, binary_present, itshfbc_present, started_at }
//
//   GET  /version
//     → { engine: 'voacap', binary_sha256, itshfbc_path, advisory:true,
//         filing_effect:'none', license_basis, regulation }
//
//   POST /run/path
//     body: {
//       tx_lat, tx_lon,       // transmitter coords (decimal degrees)
//       rx_lat, rx_lon,       // receiver coords
//       freq_mhz: number[],   // HF frequencies; clamped ≥2 MHz in sidecar
//       month:    1..12,
//       ssn?:     0..300,     // smoothed sunspot number (default 50)
//       power_kw?: number,    // transmitter power in kW (default 1.0)
//       required_snr_db?: number  // default 48.0
//     }
//     → 200 {
//         advisory: true, filing_effect: 'none',
//         engine: 'voacap', available: true,
//         month, ssn, power_kw, distance_km, inp_sha256,
//         results: [{
//           freq_mhz, freq_mhz_used,
//           hourly_reliability: number[24] | null,
//           mean_reliability:   number | null,
//           note?: string
//         }],
//         note?: string
//       }
//
// USE
//   Genoa-side wiring in src/api/services/sidecars.js:
//     voacap: makeVoacapClient(),
//   Consumed by nightOrchestrator.js to attach advisory_voacap to
//   the §73.182 NIF result.

const DEFAULT_TIMEOUT_MS = 60_000;

export const VOACAP_CLIENT_VERSION = '1.0.0';

/**
 * Construct a live VOACAP advisory client.
 *
 * Returns null when VOACAP_SIDECAR_URL is unset so the orchestrator
 * can fail-soft exactly like NEC and amPhysics.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.baseUrl=process.env.VOACAP_SIDECAR_URL]
 * @param {string}  [opts.apiToken=process.env.VOACAP_API_TOKEN]
 * @param {number}  [opts.timeoutMs=60000]
 * @returns {{ baseUrl, version, health, runPath } | null}
 */
export function makeVoacapClient({
  baseUrl   = process.env.VOACAP_SIDECAR_URL || null,
  apiToken  = process.env.VOACAP_API_TOKEN   || null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!baseUrl) return null;

  const url    = baseUrl.replace(/\/$/, '');
  const headers = {
    'Content-Type': 'application/json',
    ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {})
  };

  async function fetchWithTimeout(input, init = {}){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(input, { ...init, signal: ctrl.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl,
    version: VOACAP_CLIENT_VERSION,

    /**
     * Probe sidecar health.
     * @returns {{ reachable: boolean, binary_present?: boolean, error?: string }}
     */
    async health(){
      try {
        const res = await fetchWithTimeout(`${url}/healthz`, { method: 'GET' });
        if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
        const body = await res.json();
        return { reachable: true, ...body };
      } catch (e){
        return { reachable: false, error: e.message };
      }
    },

    /**
     * Run a VOACAP path advisory.
     *
     * @param {object} path
     * @param {number} path.tx_lat
     * @param {number} path.tx_lon
     * @param {number} path.rx_lat
     * @param {number} path.rx_lon
     * @param {number[]} path.freq_mhz   HF reference frequencies in MHz; values
     *                                   below 2 MHz are clamped in the sidecar
     * @param {number}  path.month       1–12
     * @param {number}  [path.ssn]       smoothed sunspot number (default 50)
     * @param {number}  [path.power_kw]  (default 1.0)
     * @param {number}  [path.required_snr_db]  (default 48.0)
     * @returns {Promise<{advisory:true, filing_effect:'none', available:boolean, ...}>}
     */
    async runPath(path = {}){
      try {
        const res = await fetchWithTimeout(`${url}/run/path`, {
          method:  'POST',
          headers,
          body:    JSON.stringify(path),
        });
        if (!res.ok){
          const detail = await res.text().catch(() => '');
          return advisoryEnvelope({
            available: false,
            status:    'sidecar_error',
            reason:    `VOACAP sidecar returned HTTP ${res.status}: ${detail.slice(0, 200)}`
          });
        }
        const body = await res.json();
        // Always enforce the advisory contract regardless of what the
        // sidecar returns — belt-and-suspenders so a misconfigured
        // sidecar cannot accidentally inject filing-controlling data.
        return {
          ...body,
          advisory:      true,
          filing_effect: 'none',
          engine:        'voacap',
        };
      } catch (e){
        return advisoryEnvelope({
          available: false,
          status:    'sidecar_unreachable',
          reason:    e.message
        });
      }
    }
  };
}

/**
 * Build the advisory envelope every VOACAP response must conform to.
 * Centralised so callers cannot accidentally drop advisory:true or
 * filing_effect:'none' — those are the contract that keeps VOACAP
 * out of filing math.
 */
export function advisoryEnvelope(extra = {}){
  return {
    advisory:      true,
    filing_effect: 'none',
    engine:        'voacap',
    available:     false,
    ...extra,
  };
}

export const VOACAP_PROVENANCE = Object.freeze({
  module:      'src/evidence/voacapClient.js',
  upstream:    'VOACAP (NTIA/ITS HF propagation prediction, jawatson/voacapl Linux port)',
  posture:     'ADVISORY — never substitutes for FCC §73.190(c) / §73.182 skywave math',
  envelope:    'advisory:true + filing_effect:none on every response',
  not_modeled: [
    'Filing-controlling AM skywave field strength — remains §73.190(c) / Berry-style closed form',
    'Filing-controlling RSS share — remains §73.182(k)',
    'Any FCC allocation / contour math',
  ],
});
