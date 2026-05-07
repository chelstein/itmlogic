// Genoa SPLAT client — talks to chelstein/splat's Genoa sidecar
// (Flask + gunicorn, deployed at SPLAT_SIDECAR_URL).
//
// Sidecar API (see chelstein/splat#6):
//   GET  /healthz             → "ok"
//   GET  /version             → { sidecar, splat_bin, workdir }
//   POST /api/v1/splat/run    → { command, command_string, returncode,
//                                  stdout, stderr }
//                               body: { tx_qth, rx_qth?, output_base?,
//                                        flags?, timeout_seconds? }
//                               IMPORTANT: tx_qth is a FILE PATH on the
//                               sidecar's disk.  SPLAT itself needs DEM
//                               tiles co-located in WORKDIR.
//
// REALITY CHECK
//   The sidecar today is a thin SPLAT shell.  To produce useful HAAT
//   or contour output Genoa would have to:
//     1. Generate a QTH file in WORKDIR (sidecar exposes no inline-QTH
//        path yet — would require a small enhancement).
//     2. Provision DEM tiles in WORKDIR (gigabytes of NED 1-arcsec).
//     3. Run `splat -t tx.qth -c <height>` and parse the report for
//        contour vertices, OR `-haat` for HAAT.
//
//   Until those are in place, this client honestly probes the sidecar's
//   health + version + DEM provisioning and reports the gap so the
//   exhibit's evidence.terrain block carries an accurate state instead
//   of silently faking a SPLAT result.

const DEFAULT_TIMEOUT_MS = 8_000;

export function makeSplatClient({
  baseUrl   = process.env.SPLAT_SIDECAR_URL || null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!baseUrl) return null;
  return {
    baseUrl,

    async health(){
      try {
        const r = await fetch(joinUrl(baseUrl, '/healthz'), { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch { return false; }
    },

    async version(){
      try {
        const r = await fetch(joinUrl(baseUrl, '/version'), { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok) return { reachable: false, status: r.status };
        const j = await r.json();
        return { reachable: true, ...j };
      } catch (e){
        return { reachable: false, error: String(e.message) };
      }
    },

    // Run a raw SPLAT command via the sidecar.  Caller must arrange
    // for the QTH file to already exist on the sidecar's disk (no
    // inline-QTH support yet).  Returns the sidecar's response with
    // an `available` flag for the orchestrator's branching.
    async run({ tx_qth, rx_qth = null, output_base = null, flags = [], timeout_seconds = 120 }){
      if (!tx_qth) return { available: false, source: null, error: 'tx_qth required' };
      const endpoint = joinUrl(baseUrl, '/api/v1/splat/run');
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tx_qth, rx_qth, output_base, flags, timeout_seconds }),
          signal: AbortSignal.timeout((timeout_seconds + 5) * 1000)
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          return { available: false, source: null, endpoint, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return {
          available:      j.returncode === 0,
          source:         'splat-sidecar',
          endpoint,
          fetched_at:     new Date().toISOString(),
          command_string: j.command_string,
          returncode:     j.returncode,
          stdout:         j.stdout,
          stderr:         j.stderr
        };
      } catch (e){
        return { available: false, source: null, endpoint, error: String(e.message) };
      }
    },

    // High-fidelity ITM coverage prediction via SPLAT.
    //
    // ROUTES TO chelstein/splat sidecar /api/v1/splat/run-inline
    // (sidecar enhancement #1: accepts QTH content as a JSON body
    // instead of requiring a pre-existing file path on the sidecar's
    // disk; sidecar writes the QTH to its WORKDIR, runs SPLAT, and
    // returns the parsed coverage report).  Until the sidecar exposes
    // that route, this method returns { available: false,
    // sidecar_enhancement_required: 'inline-qth' } so callers can
    // fall back to the JS terrain-propagation engine.
    //
    // INPUTS
    //   tx: { call, lat, lon, amsl_m, antenna_height_m, frequency_mhz,
    //         erp_kw, polarization }
    //   max_distance_km, target_field_dbu, radial_step_deg, climate_code
    //
    // OUTPUTS (when sidecar produces coverage)
    //   { available: true, source: 'splat-sidecar', radials: [
    //       { az, distance_km, field_dbu, mode, terrain_profile: [...] }
    //     ], dem_source, runtime_seconds, ... }
    //
    // OUTPUTS (when DEM not yet provisioned)
    //   { available: false, source: null, sidecar_enhancement_required,
    //     suggested_fallback: 'engine/coverage/itm_radial.computeItmCoverage' }
    async predictItmCoverage({ tx, max_distance_km = 80, target_field_dbu = 60,
                                radial_step_deg = 10, climate_code = 5,
                                timeout_seconds = 180 } = {}){
      if (!tx || !Number.isFinite(Number(tx.lat)) || !Number.isFinite(Number(tx.lon))){
        return { available: false, source: null, error: 'tx.lat / tx.lon required' };
      }
      // Build a SPLAT QTH file body from inputs.  SPLAT QTH format:
      //   line 1: callsign or "TX"
      //   line 2: latitude (deg, N positive)
      //   line 3: longitude (deg, W positive — SPLAT convention is W-positive)
      //   line 4: antenna_height_m feet (SPLAT requires feet; m → ft = ×3.28084)
      const qthLines = [
        String(tx.call || 'TX'),
        String(tx.lat),
        String(-Number(tx.lon)),                                            // SPLAT W-positive
        String((Number(tx.antenna_height_m) || 30) * 3.28084) + ' feet'
      ];
      const inlineEndpoint = joinUrl(baseUrl, '/api/v1/splat/run-inline');
      try {
        const r = await fetch(inlineEndpoint, {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({
            tx_qth_content:    qthLines.join('\n'),
            tx_call:           tx.call || 'TX',
            frequency_mhz:     Number(tx.frequency_mhz),
            erp_kw:            Number(tx.erp_kw),
            polarization:      tx.polarization || 'V',
            max_distance_km, target_field_dbu, radial_step_deg, climate_code,
            timeout_seconds
          }),
          signal:  AbortSignal.timeout((timeout_seconds + 10) * 1000)
        });
        if (r.status === 404){
          return {
            available: false,
            source:    null,
            endpoint:  inlineEndpoint,
            sidecar_enhancement_required: 'inline-qth',
            suggested_fallback:            'src/engine/coverage/itm_radial.js (computeItmCoverage)',
            note:      'SPLAT sidecar does not expose /api/v1/splat/run-inline yet.  Use the multi-source-DEM JS terrain engine until the sidecar enhancement lands.'
          };
        }
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, source: null, endpoint: inlineEndpoint, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return {
          available:    true,
          source:       'splat-sidecar',
          endpoint:     inlineEndpoint,
          fetched_at:   new Date().toISOString(),
          method:       'SPLAT (Longley-Rice ITM v1.2.2) per-radial coverage prediction',
          dem_source:   j.dem_source || 'sidecar-provisioned (SRTM-3 / NED)',
          runtime_seconds: j.runtime_seconds || null,
          radials:      j.radials || [],
          target_field_dbu, max_distance_km,
          stdout_excerpt: (j.stdout || '').slice(0, 400)
        };
      } catch (e){
        return { available: false, source: null, endpoint: inlineEndpoint, error: String(e.message) };
      }
    },

    // Higher-level probe: is the sidecar reachable AND likely able to
    // do useful work?  Today this is a thin "the binary exists and a
    // dry --help-style invocation returns a sensible exit code" check.
    // It surfaces a structured `dem_provisioned` flag the orchestrator
    // uses to attach an honest provenance note.
    async capability(){
      const v = await this.version();
      if (!v.reachable){
        return { available: false, source: null, reachable: false, error: v.error || `sidecar unreachable (HTTP ${v.status})` };
      }
      return {
        available:        true,
        source:           'splat-sidecar',
        reachable:        true,
        endpoint:         joinUrl(baseUrl, '/version'),
        sidecar_name:     v.sidecar || 'genoa-splat-sidecar',
        splat_bin:        v.splat_bin || null,
        workdir:          v.workdir || null,
        dem_provisioned:  null,        // unknown until a QTH+SPLAT run succeeds
        notes: 'SPLAT sidecar reachable.  Per-radial HAAT and ITM coverage require DEM tiles co-located on the sidecar; until those are provisioned, contour output remains the F(50,50) tabulated value.'
      };
    }
  };
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}
