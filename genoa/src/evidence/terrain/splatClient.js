// Genoa SPLAT client — talks to chelstein/splat's Genoa sidecar
// (Flask + gunicorn, deployed at SPLAT_SIDECAR_URL).
//
// Sidecar API (chelstein/splat#7–#11 reflected here):
//   GET    /healthz                  → "ok"
//   GET    /version                  → { sidecar, splat_bin, splat_version,
//                                      git_commit_sha, build_time, workdir,
//                                      sdf_dir, auth_required }
//   GET    /api/v1/stats             → { total_runs, success_count, ... }
//   POST   /api/v1/splat/run         → { command, command_string, returncode,
//                                      stdout, stderr }
//                                    body: { tx_qth, rx_qth?, output_base?,
//                                             flags?, timeout_seconds? }
//                                    IMPORTANT: tx_qth is a FILE PATH on
//                                    the sidecar's disk.
//   GET    /api/v1/artifacts         → { workdir, count, artifacts: [...] }
//   GET    /api/v1/artifacts/<path>  → file bytes
//   GET    /api/v1/sdf               → { sdf_dir, count, tiles: [...] }
//   POST   /api/v1/sdf/<name>        → { name, size_bytes, ... } 201
//   DELETE /api/v1/sdf/<name>        → { deleted: name }
//
// Auth: when SPLAT_API_TOKEN is set on the Genoa side AND the sidecar's
// own GENOA_API_TOKEN is set, callers must send `Authorization: Bearer
// <token>` on every endpoint except /healthz, /version, /api/v1/stats.
// This client forwards the bearer when configured; otherwise it omits
// the header (backward compatible with sidecars that haven't enabled
// auth).
//
// REALITY CHECK
//   Per-radial HAAT and ITM coverage need DEM tiles co-located on the
//   sidecar's disk under WORKDIR/sdf/.  uploadSdfTile() now exists, so
//   provisioning is wholly an HTTP-driven workflow: probe capability(),
//   if dem_provisioned is false, upload tiles, then run.  capability()
//   surfaces the live tile_count from the sidecar's /api/v1/sdf so the
//   orchestrator can decide whether terrain-aware coverage is realistic
//   or it should fall back to the JS terrain engine.

const DEFAULT_TIMEOUT_MS = 8_000;
const UPLOAD_TIMEOUT_MS  = 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export function makeSplatClient({
  baseUrl   = process.env.SPLAT_SIDECAR_URL || null,
  apiToken  = process.env.SPLAT_API_TOKEN   || null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!baseUrl) return null;

  // Sanitize: empty / whitespace-only token is treated as "no auth".
  const _token = (apiToken && String(apiToken).trim()) || null;

  function _headers(extra = {}){
    const h = { ...extra };
    if (_token) h['Authorization'] = `Bearer ${_token}`;
    return h;
  }

  return {
    baseUrl,
    auth_configured: _token !== null,

    async health(){
      try {
        const r = await fetch(joinUrl(baseUrl, '/healthz'), {
          headers: _headers(),                        // /healthz is open
                                                       // anyway, but cheap to
                                                       // forward.
          signal:  AbortSignal.timeout(3000)
        });
        return r.ok;
      } catch { return false; }
    },

    async version(){
      try {
        const r = await fetch(joinUrl(baseUrl, '/version'), {
          headers: _headers(),
          signal:  AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok) return { reachable: false, status: r.status };
        const j = await r.json();
        return { reachable: true, ...j };
      } catch (e){
        return { reachable: false, error: String(e.message) };
      }
    },

    async run({ tx_qth, rx_qth = null, output_base = null, flags = [], timeout_seconds = 120 }){
      if (!tx_qth) return { available: false, source: null, error: 'tx_qth required' };
      const endpoint = joinUrl(baseUrl, '/api/v1/splat/run');
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: _headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ tx_qth, rx_qth, output_base, flags, timeout_seconds }),
          signal: AbortSignal.timeout((timeout_seconds + 5) * 1000)
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          return { available: false, source: null, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
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

    async predictItmCoverage({ tx, max_distance_km = 80, target_field_dbu = 60,
                                radial_step_deg = 10, climate_code = 5,
                                timeout_seconds = 180 } = {}){
      if (!tx || !Number.isFinite(Number(tx.lat)) || !Number.isFinite(Number(tx.lon))){
        return { available: false, source: null, error: 'tx.lat / tx.lon required' };
      }
      const qthLines = [
        String(tx.call || 'TX'),
        String(tx.lat),
        String(-Number(tx.lon)),
        String((Number(tx.antenna_height_m) || 30) * 3.28084) + ' feet'
      ];
      const inlineEndpoint = joinUrl(baseUrl, '/api/v1/splat/run-inline');
      try {
        const r = await fetch(inlineEndpoint, {
          method:  'POST',
          headers: _headers({ 'content-type': 'application/json' }),
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

    // ------------------------------------------------------------------
    // SDF terrain-tile lifecycle.  Maps to chelstein/splat#11 endpoints.
    // ------------------------------------------------------------------

    async listSdfTiles(){
      const endpoint = joinUrl(baseUrl, '/api/v1/sdf');
      try {
        const r = await fetch(endpoint, {
          headers: _headers(),
          signal:  AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return { available: true, endpoint, ...j };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    async uploadSdfTile(name, bytes){
      if (!name) return { available: false, error: 'name required' };
      if (bytes == null) return { available: false, error: 'bytes required' };
      const endpoint = joinUrl(baseUrl, `/api/v1/sdf/${encodeURIComponent(name)}`);
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: _headers({ 'content-type': 'application/octet-stream' }),
          body:   bytes,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return { available: true, endpoint, ...j };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    async deleteSdfTile(name){
      if (!name) return { available: false, error: 'name required' };
      const endpoint = joinUrl(baseUrl, `/api/v1/sdf/${encodeURIComponent(name)}`);
      try {
        const r = await fetch(endpoint, {
          method:  'DELETE',
          headers: _headers(),
          signal:  AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return { available: true, endpoint, ...j };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    // ------------------------------------------------------------------
    // Run-output artifact retrieval.  Maps to chelstein/splat#10 endpoints.
    // ------------------------------------------------------------------

    async listArtifacts(){
      const endpoint = joinUrl(baseUrl, '/api/v1/artifacts');
      try {
        const r = await fetch(endpoint, {
          headers: _headers(),
          signal:  AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          return { available: false, endpoint, status: r.status, error: j.error || `HTTP ${r.status}` };
        }
        const j = await r.json();
        return { available: true, endpoint, ...j };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    async getArtifact(path){
      if (!path) return { available: false, error: 'path required' };
      const safePath = path.split('/').map(encodeURIComponent).join('/');
      const endpoint = joinUrl(baseUrl, `/api/v1/artifacts/${safePath}`);
      try {
        const r = await fetch(endpoint, {
          headers: _headers(),
          signal:  AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
        });
        if (!r.ok){
          if (r.status === 404) return { available: false, endpoint, status: 404, error: 'not found' };
          return { available: false, endpoint, status: r.status, error: `HTTP ${r.status}` };
        }
        const buf = await r.arrayBuffer();
        return {
          available:    true,
          endpoint,
          path,
          bytes:        new Uint8Array(buf),
          size_bytes:   buf.byteLength,
          content_type: r.headers.get('content-type') || null,
          fetched_at:   new Date().toISOString()
        };
      } catch (e){
        return { available: false, endpoint, error: String(e.message) };
      }
    },

    // ------------------------------------------------------------------
    // Capability probe.  Now reads /version AND /api/v1/sdf so the
    // returned record carries a real dem_provisioned flag instead of
    // null-as-undefined.
    // ------------------------------------------------------------------

    async capability(){
      const v = await this.version();
      if (!v.reachable){
        return {
          available: false,
          source:    null,
          reachable: false,
          error:     v.error || `sidecar unreachable (HTTP ${v.status})`
        };
      }

      // SDF probe.  When this fails (auth wall, 5xx, network), leave
      // tile_count and dem_provisioned as null — we do not silently
      // claim DEM is provisioned.
      let tile_count      = null;
      let dem_provisioned = null;
      const sdfList = await this.listSdfTiles();
      if (sdfList.available && Number.isFinite(Number(sdfList.count))){
        tile_count      = Number(sdfList.count);
        dem_provisioned = tile_count > 0;
      }

      return {
        available:        true,
        source:           'splat-sidecar',
        reachable:        true,
        endpoint:         joinUrl(baseUrl, '/version'),
        sidecar_name:     v.sidecar       || 'genoa-splat-sidecar',
        splat_bin:        v.splat_bin     || null,
        splat_version:    v.splat_version || null,
        git_commit_sha:   v.git_commit_sha || null,
        build_time:       v.build_time    || null,
        workdir:          v.workdir       || null,
        sdf_dir:          v.sdf_dir       || null,
        auth_required:    !!v.auth_required,
        auth_configured:  _token !== null,
        tile_count,
        dem_provisioned,
        notes: dem_provisioned
          ? `SPLAT sidecar reachable with ${tile_count} terrain tile(s).  Coverage runs may use Longley-Rice ITM with terrain-aware HAAT.`
          : (tile_count === 0
              ? 'SPLAT sidecar reachable but no terrain tiles provisioned.  Upload tiles via uploadSdfTile() before requesting terrain-aware coverage.'
              : 'SPLAT sidecar reachable; tile inventory could not be probed (auth failure or transient error).  dem_provisioned is unknown.')
      };
    }
  };
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}
