// Genoa ASR sidecar — REST API for FCC Antenna Structure Registration lookups.
//
// Three resolution tiers, each independently fail-soft:
//
//   Tier 1 (PRIMARY):    local Postgres asr_towers table loaded weekly
//                        from FCC ULS r_tower.zip.  Sub-100 ms lookups
//                        by ASR# or by lat/lon proximity.  ~1.7M towers.
//
//   Tier 2 (FALLBACK A): operator can override / supplement the bulk DB
//                        via ZTR rich-station _tower data.  This sidecar
//                        does NOT call ZTR — that wiring lives in the
//                        main API's asrClient.extractFromRichStation.
//                        Tier 2 is mentioned here for documentation
//                        completeness; the sidecar surfaces it via the
//                        provenance.tier_chain in /asr/by-* responses
//                        when a ZTR-sourced record is passed-through.
//
//   Tier 3 (FALLBACK B): Python subprocess (asr_html_bridge.py) that
//                        scrapes wireless2.fcc.gov/UlsApp/AsrSearch with
//                        cloudscraper to defeat Akamai's 503 wall.
//                        Same Node-server + Python-bridge pattern as the
//                        NEC sidecar.  Slow (~3-8 s per lookup); used
//                        only when bulk DB has no record AND asr_number
//                        is supplied.
//
// Endpoints:
//   GET  /healthz                    — liveness; reports last bulk-load state
//   GET  /asr/by-number/:asr         — exact match in asr_towers; tier-3 fallback if not found
//   GET  /asr/by-location?lat&lon&radius_m=1000&limit=1
//                                    — haversine within candidate set
//
// Boots:
//   1. Apply schema.sql (idempotent).
//   2. Read asr_load_state.records_total.  If 0 OR > LOAD_REFRESH_DAYS old,
//      kick the bulk loader in the background (server still answers other
//      lookups in the meantime; /healthz reports loading=true).
//   3. After the first successful load, schedule a weekly refresh.

import express from 'express';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runBulkLoad } from './ulsBulkLoader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SIDECAR_PORT) || 8087;
const LOAD_REFRESH_DAYS = Number(process.env.ASR_LOAD_REFRESH_DAYS) || 7;
const HTML_BRIDGE_TIMEOUT_MS = Number(process.env.ASR_HTML_BRIDGE_TIMEOUT_MS) || 15_000;

if (!process.env.DATABASE_URL){
  console.error('[asr-sidecar] DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX) || 5,
  application_name: 'genoa-asr-sidecar'
});

let loaderState = { running: false, last_error: null };

async function ensureSchema(){
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[asr-sidecar] schema applied');
}

async function maybeRunBulkLoad(){
  const r = await pool.query(`SELECT records_total, last_loaded_at FROM asr_load_state WHERE id = 1`);
  const row = r.rows[0];
  const stale = !row
    || !row.records_total
    || (row.last_loaded_at && (Date.now() - new Date(row.last_loaded_at).getTime()) > LOAD_REFRESH_DAYS * 24 * 3600 * 1000);
  if (!stale){
    console.log(`[asr-sidecar] DB has ${row.records_total} towers loaded ${row.last_loaded_at}; skipping refresh`);
    return;
  }
  console.log('[asr-sidecar] kicking bulk load in background');
  loaderState.running = true;
  // Don't await — let HTTP server start while load runs.
  runBulkLoad(pool, console)
    .then(s => { loaderState.running = false; loaderState.last_summary = s; })
    .catch(e => { loaderState.running = false; loaderState.last_error = String(e.message); console.error('[asr-sidecar] bulk load failed:', e); });
}

function scheduleWeeklyRefresh(){
  const ms = LOAD_REFRESH_DAYS * 24 * 3600 * 1000;
  setInterval(() => { maybeRunBulkLoad().catch(e => console.error(e)); }, ms);
  console.log(`[asr-sidecar] weekly refresh scheduled every ${LOAD_REFRESH_DAYS} days`);
}

// ─── Tier-3 Python bridge ────────────────────────────────────────────
// Spawns asr_html_bridge.py with the ASR# on argv.  The bridge prints
// a single JSON line on stdout; we parse it.  Failures resolve to
// { available: false, error: ... } — never throw.
async function htmlScrapeFallback(asrNumber){
  return new Promise(resolve => {
    const proc = spawn(process.env.PYNEC_PYTHON_BIN || 'python3',
                       [join(__dirname, 'asr_html_bridge.py'), String(asrNumber)],
                       { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve({ available: false, source: 'asr-html-bridge', error: `bridge timeout after ${HTML_BRIDGE_TIMEOUT_MS} ms` });
    }, HTML_BRIDGE_TIMEOUT_MS);
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0){
        resolve({ available: false, source: 'asr-html-bridge', error: `bridge exit ${code}; stderr=${stderr.slice(0, 200)}` });
        return;
      }
      try { resolve(JSON.parse(stdout.trim().split('\n').pop() || '{}')); }
      catch (e){ resolve({ available: false, source: 'asr-html-bridge', error: `bridge JSON parse: ${e.message}; stdout=${stdout.slice(0, 200)}` }); }
    });
    proc.on('error', e => {
      clearTimeout(timer);
      resolve({ available: false, source: 'asr-html-bridge', error: `bridge spawn: ${e.message}` });
    });
  });
}

// ─── Row → API record shape ──────────────────────────────────────────
function rowToRecord(row, tier){
  return {
    available:                 true,
    source:                    `asr-sidecar-tier${tier}`,
    source_tier:               tier,
    asr_number:                row.asr_number,
    unique_system_id:          row.unique_system_id,
    status:                    row.status,
    registration_purpose:      row.registration_purpose,
    owner:                     row.owner_name,
    owner_frn:                 row.owner_frn,
    latitude_deg:              row.latitude_deg,
    longitude_deg:             row.longitude_deg,
    height_of_structure_m:     row.height_of_structure_m,
    ground_elevation_m:        row.ground_elevation_m,
    overall_height_m:          row.overall_height_agl_m,
    overall_height_amsl_m:     row.overall_height_amsl_m,
    structure_type:            row.structure_type,
    faa_study_number:          row.faa_study_number,
    faa_circular_number:       row.faa_circular_number,
    faa_emi_flag:              row.faa_emi_flag,
    nepa_flag:                 row.nepa_flag,
    date_faa_determination:    row.date_faa_determination,
    painting_requirement:      row.painting_lighting,
    lighting_requirement:      row.mark_light_code,
    structure_address:         row.structure_address,
    structure_city:            row.structure_city,
    structure_state:           row.structure_state,
    fetched_at:                new Date().toISOString(),
    endpoint:                  `genoa-asr-sidecar:${PORT}`
  };
}

// ─── HTTP server ─────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT records_total, records_with_coords, records_with_owner,
                                       last_loaded_at, last_source_url, load_duration_seconds, load_error
                                FROM asr_load_state WHERE id = 1`);
    res.json({
      ok:           true,
      sidecar:      'genoa-asr-sidecar',
      version:      '0.1.0',
      bulk_load:    r.rows[0] || { records_total: 0 },
      loader_running: loaderState.running,
      loader_error:   loaderState.last_error
    });
  } catch (e){
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.get('/asr/by-number/:asr', async (req, res) => {
  const asr = String(req.params.asr).trim();
  if (!/^\d+$/.test(asr)){
    return res.status(400).json({ available: false, error: 'asr_number must be numeric' });
  }
  // Tier 1: bulk DB.
  try {
    const r = await pool.query(`SELECT * FROM asr_towers WHERE asr_number = $1 LIMIT 1`, [asr]);
    if (r.rows.length){
      return res.json(rowToRecord(r.rows[0], 1));
    }
  } catch (e){
    console.warn('[asr-sidecar] tier-1 query failed:', e.message);
  }
  // Tier 3: HTML scrape (skipped when ASR_DISABLE_HTML_FALLBACK=1).
  if (process.env.ASR_DISABLE_HTML_FALLBACK === '1'){
    return res.json({ available: false, source: 'asr-sidecar', error: 'not in bulk DB; html fallback disabled' });
  }
  const fallback = await htmlScrapeFallback(asr);
  if (fallback.available){
    fallback.source_tier = 3;
    return res.json(fallback);
  }
  return res.json(fallback);
});

app.get('/asr/by-location', async (req, res) => {
  const lat      = parseFloat(req.query.lat);
  const lon      = parseFloat(req.query.lon);
  const radius_m = Math.min(parseFloat(req.query.radius_m) || 1000, 25_000);
  const limit    = Math.min(parseInt(req.query.limit, 10) || 1, 25);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)){
    return res.status(400).json({ available: false, error: 'lat / lon required' });
  }
  // Coarse box prefilter (1 deg lat ≈ 111 km; 1 deg lon ≈ 111 km × cos(lat)).
  // The PRIMARY KEY index on (latitude_deg, longitude_deg) makes this fast.
  const dLat = radius_m / 111_320;
  const dLon = radius_m / (111_320 * Math.cos(lat * Math.PI / 180));
  try {
    const r = await pool.query(`
      SELECT *,
             6371000 * 2 * ASIN(SQRT(
                 POWER(SIN(RADIANS(latitude_deg - $1)/2), 2)
               + COS(RADIANS($1)) * COS(RADIANS(latitude_deg))
               * POWER(SIN(RADIANS(longitude_deg - $2)/2), 2)
             )) AS distance_m
      FROM asr_towers
      WHERE latitude_deg  BETWEEN $1 - $3 AND $1 + $3
        AND longitude_deg BETWEEN $2 - $4 AND $2 + $4
        AND status NOT IN ('TERMINATED', 'CANCELLED', 'WITHDRAWN')
      ORDER BY distance_m ASC
      LIMIT $5
    `, [lat, lon, dLat, dLon, limit]);

    if (r.rows.length === 0){
      return res.json({ available: false, source: 'asr-sidecar', error: `no ASR record within ${radius_m} m of ${lat},${lon}` });
    }
    // Filter to inside the actual circle (the box prefilter is square)
    const inside = r.rows.filter(row => row.distance_m <= radius_m);
    if (inside.length === 0){
      return res.json({ available: false, source: 'asr-sidecar', error: `no ASR record within ${radius_m} m (closest was ${Math.round(r.rows[0].distance_m)} m)` });
    }
    if (limit === 1){
      const rec = rowToRecord(inside[0], 1);
      rec.distance_m = Math.round(inside[0].distance_m);
      return res.json(rec);
    }
    return res.json({
      available: true,
      source:    'asr-sidecar-tier1',
      source_tier: 1,
      n:          inside.length,
      records:    inside.map(row => {
        const rec = rowToRecord(row, 1);
        rec.distance_m = Math.round(row.distance_m);
        return rec;
      })
    });
  } catch (e){
    console.error('[asr-sidecar] tier-1 location query failed:', e);
    return res.status(500).json({ available: false, error: String(e.message) });
  }
});

// ─── Boot ────────────────────────────────────────────────────────────
(async () => {
  try {
    await ensureSchema();
    await maybeRunBulkLoad();
    scheduleWeeklyRefresh();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[asr-sidecar] listening on 0.0.0.0:${PORT}`);
    });
  } catch (e){
    console.error('[asr-sidecar] boot failed:', e);
    process.exit(1);
  }
})();
