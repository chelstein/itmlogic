// Genoa — FCC propagation studio (standalone)
// Express + Postgres + Digital Ocean Spaces (S3-compatible)
//
// Carries the signal farther on a single tack.
//
// This service is intentionally decoupled from any other system. It NEVER
// writes to upstream data sources (zerotrustradio / buoyIQ / etc.). It
// only persists its own exhibit records in its own Postgres schema and
// uploads exhibit assets to its own Spaces bucket.

import express from 'express';
import multer  from 'multer';
import pg      from 'pg';
import fs      from 'node:fs/promises';
import path    from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT       = parseInt(process.env.PORT || '8080', 10);
const NODE_ENV   = process.env.NODE_ENV || 'development';

/* ------------------------------------------------------------------ */
/* Postgres                                                            */
/* ------------------------------------------------------------------ */
const PG_SSL = (process.env.PG_SSL || 'false').toLowerCase() === 'true';
const PG_SSL_REJECT = (process.env.PG_SSL_REJECT || 'false').toLowerCase() === 'true';

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: PG_SSL ? { rejectUnauthorized: PG_SSL_REJECT } : false,
      max: 5,
      idleTimeoutMillis: 30_000
    })
  : null;

async function dbReady(){
  if (!pool) return false;
  try { await pool.query('SELECT 1'); return true; }
  catch { return false; }
}

async function migrate(){
  if (!pool) return;
  const sql = await fs.readFile(path.join(__dirname, 'db', 'migrate.sql'), 'utf8');
  await pool.query(sql);
}

/* ------------------------------------------------------------------ */
/* Spaces (S3-compatible)                                              */
/* ------------------------------------------------------------------ */
const SPACES_REGION   = process.env.SPACES_REGION   || 'nyc3';
const SPACES_ENDPOINT = process.env.SPACES_ENDPOINT || `https://${SPACES_REGION}.digitaloceanspaces.com`;
const SPACES_BUCKET   = process.env.SPACES_BUCKET;
const SPACES_KEY      = process.env.SPACES_KEY;
const SPACES_SECRET   = process.env.SPACES_SECRET;

const s3 = (SPACES_KEY && SPACES_SECRET && SPACES_BUCKET)
  ? new S3Client({
      region: SPACES_REGION,
      endpoint: SPACES_ENDPOINT,
      forcePathStyle: false,
      credentials: { accessKeyId: SPACES_KEY, secretAccessKey: SPACES_SECRET }
    })
  : null;

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

// Static frontend
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  maxAge: NODE_ENV === 'production' ? '1h' : 0
}));

// Liveness — purposely cheap, never touches the DB.
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// Readiness — DB + Spaces.
app.get('/readyz', async (_req, res) => {
  const db = await dbReady();
  const space = !!s3;
  const ok = db; // Spaces is optional for the read path
  res.status(ok ? 200 : 503).json({ ok, db, space });
});

/* -------- FCC curve datasets (read-only static bundle) ----------
   The frontend fetches these once on load and uses 2D bilinear lookup.
   Bundle ships from /app/data/fcc-curves/<version>/.  Cached aggressively
   in production (curves are immutable per version; rev the version
   directory to ship new ones).
------------------------------------------------------------------ */
const CURVE_VERSION = 'v0.2';
const CURVE_DIR     = path.join(__dirname, 'data', 'fcc-curves', CURVE_VERSION);

app.get('/api/curves', async (_req, res) => {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(CURVE_DIR, 'manifest.json'), 'utf8'));
    res.set('Cache-Control', NODE_ENV === 'production' ? 'public, max-age=86400, immutable' : 'no-cache');
    res.json({ version: CURVE_VERSION, ...manifest });
  } catch (e) {
    res.status(500).json({ error: 'curve manifest unavailable', detail: String(e.message) });
  }
});

app.get('/api/curves/:name', async (req, res) => {
  const safe = String(req.params.name).replace(/[^a-z0-9_]/gi, '');
  const file = path.join(CURVE_DIR, safe + '.json');
  try {
    const buf = await fs.readFile(file);
    res.set('Cache-Control', NODE_ENV === 'production' ? 'public, max-age=86400, immutable' : 'no-cache');
    res.type('application/json').send(buf);
  } catch {
    res.status(404).json({ error: 'curve dataset not found', name: safe });
  }
});

/* -------- Terrain DEM (per-radial HAAT, §73.313) -----------------
   Computes per-radial HAAT by sampling a DEM along the 3–16 km arc
   on each azimuth and averaging.  Results are cached in Postgres so
   repeated compute runs near the same site don't re-hit the provider.
------------------------------------------------------------------ */
const TERRAIN_PROVIDER     = process.env.TERRAIN_PROVIDER     || 'open-elevation';
const OPEN_ELEVATION_URL   = process.env.OPEN_ELEVATION_URL   || 'https://api.open-elevation.com/api/v1/lookup';
const TERRAIN_BATCH_LIMIT  = parseInt(process.env.TERRAIN_BATCH_LIMIT || '512', 10);
const TERRAIN_TIMEOUT_MS   = parseInt(process.env.TERRAIN_TIMEOUT_MS  || '20000', 10);

const R_EARTH_KM = 6371.0088;
function destPointGeo(lat, lon, az_deg, dist_km){
  const br = az_deg * Math.PI / 180;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lon * Math.PI / 180;
  const dr = dist_km / R_EARTH_KM;
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(dr) + Math.cos(φ1)*Math.sin(dr)*Math.cos(br));
  const λ2 = λ1 + Math.atan2(Math.sin(br)*Math.sin(dr)*Math.cos(φ1), Math.cos(dr) - Math.sin(φ1)*Math.sin(φ2));
  return [φ2 * 180 / Math.PI, ((λ2 * 180 / Math.PI + 540) % 360) - 180];
}
const round4 = n => Math.round(n * 1e4) / 1e4;

async function elevationsCached(points){
  // points: [{latitude, longitude}, ...]
  // Returns parallel array of elevations in meters.
  const n = points.length;
  const out = new Array(n).fill(null);
  const need = [];        // indexes still to fetch
  const needSet = new Map();   // key -> [indexes]

  if (pool){
    // Bulk lookup of cached rows.  In Postgres 10+ multiple set-returning
    // functions in the SELECT list no longer zip — they return a
    // Cartesian product.  Use UNNEST(..., ...) in the FROM clause
    // (lockstep zip) joined to the cache table.
    const lats = points.map(p => round4(p.latitude));
    const lons = points.map(p => round4(p.longitude));
    const r = await pool.query(
      `SELECT c.lat_q4, c.lon_q4, c.elev_m
         FROM genoa_terrain_cache c
         JOIN UNNEST($1::numeric[], $2::numeric[]) AS k(lat, lon)
           ON c.lat_q4 = k.lat AND c.lon_q4 = k.lon`,
      [lats, lons]
    );
    const hit = new Map();
    for (const row of r.rows) hit.set(row.lat_q4 + ':' + row.lon_q4, parseFloat(row.elev_m));
    for (let i = 0; i < n; i++){
      const k = lats[i] + ':' + lons[i];
      if (hit.has(k)) out[i] = hit.get(k);
      else {
        need.push(i);
        if (!needSet.has(k)) needSet.set(k, []);
        needSet.get(k).push(i);
      }
    }
  } else {
    for (let i = 0; i < n; i++) need.push(i);
  }

  if (!need.length) return out;

  // Deduplicate: many radials' samples can land in the same 4-decimal cell.
  const uniqKeys = [...needSet.keys()].length ? [...needSet.keys()] : need.map((_,i) => 'i' + i);
  const uniqPts  = needSet.size
    ? [...needSet.keys()].map(k => {
        const [a, o] = k.split(':').map(parseFloat);
        return { latitude: a, longitude: o };
      })
    : need.map(i => points[i]);

  // Batch the provider calls.
  const fetched = [];
  for (let i = 0; i < uniqPts.length; i += TERRAIN_BATCH_LIMIT){
    const slice = uniqPts.slice(i, i + TERRAIN_BATCH_LIMIT);
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), TERRAIN_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(OPEN_ELEVATION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locations: slice }),
        signal: ctrl.signal
      });
    } finally { clearTimeout(tm); }
    if (!resp.ok) throw new Error(`elevation provider HTTP ${resp.status}`);
    const j = await resp.json();
    const arr = (j.results || []).map(r => Number(r.elevation));
    if (arr.length !== slice.length) throw new Error('elevation provider returned wrong length');
    fetched.push(...arr);
  }

  // Map fetched values back to output indexes, write-through to cache.
  const writeRows = [];
  if (needSet.size){
    [...needSet.keys()].forEach((k, j) => {
      const elev = fetched[j];
      for (const idx of needSet.get(k)) out[idx] = elev;
      const [a, o] = k.split(':').map(parseFloat);
      writeRows.push([a, o, elev]);
    });
  } else {
    need.forEach((idx, j) => { out[idx] = fetched[j]; });
  }

  if (pool && writeRows.length){
    // Bulk upsert via UNNEST.  Pass three parallel arrays + the provider.
    const lats = writeRows.map(r => r[0]);
    const lons = writeRows.map(r => r[1]);
    const els  = writeRows.map(r => r[2]);
    await pool.query(
      `INSERT INTO genoa_terrain_cache (lat_q4, lon_q4, elev_m, source)
       SELECT lat, lon, elev, $4
         FROM UNNEST($1::numeric[], $2::numeric[], $3::numeric[]) AS t(lat, lon, elev)
       ON CONFLICT (lat_q4, lon_q4)
         DO UPDATE SET elev_m = EXCLUDED.elev_m, fetched_at = now()`,
      [lats, lons, els, TERRAIN_PROVIDER]
    );
  }

  return out;
}

app.post('/api/terrain/haat', async (req, res) => {
  const b = req.body || {};
  const tx_lat = parseFloat(b.tx_lat);
  const tx_lon = parseFloat(b.tx_lon);
  const tx_amsl = parseFloat(b.tx_amsl_m);
  const from_km = Number.isFinite(b.from_km) ? +b.from_km : 3;
  const to_km   = Number.isFinite(b.to_km)   ? +b.to_km   : 16;
  const samples = Number.isFinite(b.samples) ? +b.samples : 27;
  const radials = Array.isArray(b.radials_deg) ? b.radials_deg.map(Number).filter(Number.isFinite) : [];

  if (!Number.isFinite(tx_lat) || !Number.isFinite(tx_lon)) return res.status(400).json({ error: 'tx_lat / tx_lon required' });
  if (!Number.isFinite(tx_amsl)) return res.status(400).json({ error: 'tx_amsl_m required (antenna center of radiation, m AMSL)' });
  if (!radials.length)            return res.status(400).json({ error: 'radials_deg required (array of azimuths in degrees true)' });
  if (samples < 4 || samples > 256) return res.status(400).json({ error: 'samples out of range (4..256)' });

  const stride = (to_km - from_km) / (samples - 1);
  const points = [];
  for (const az of radials){
    for (let i = 0; i < samples; i++){
      const km = from_km + i * stride;
      const [la, lo] = destPointGeo(tx_lat, tx_lon, az, km);
      points.push({ latitude: la, longitude: lo });
    }
  }

  let elevations;
  try {
    elevations = await elevationsCached(points);
  } catch (e) {
    return res.status(502).json({ error: 'elevation provider failed', detail: String(e.message) });
  }

  const out = [];
  for (let r = 0; r < radials.length; r++){
    const slice = elevations.slice(r * samples, (r + 1) * samples);
    const valid = slice.filter(v => Number.isFinite(v));
    const avg   = valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
    out.push({
      az: radials[r],
      avg_elev_m:    avg,
      min_elev_m:    valid.length ? Math.min(...valid) : null,
      max_elev_m:    valid.length ? Math.max(...valid) : null,
      haat_m:        avg !== null ? (tx_amsl - avg) : null,
      sample_elevs:  slice
    });
  }

  res.json({
    tx:    { lat: tx_lat, lon: tx_lon, amsl_m: tx_amsl },
    arc:   { from_km, to_km, samples },
    provider: TERRAIN_PROVIDER,
    haat_per_radial: out
  });
});

/* -------- Exhibits API ------------------------------------------- */

// POST /api/exhibits — persist a computed exhibit.
app.post('/api/exhibits', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'database not configured' });
  const body = req.body || {};
  if (!body.inputs || !body.contours) {
    return res.status(400).json({ error: 'invalid exhibit payload' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO genoa_exhibit
         (call_sign, facility_id, service, frequency, erp_kw, haat_m,
          lat, lon, method, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       RETURNING id, created_at`,
      [
        body.inputs.call || null,
        body.inputs.facility_id || null,
        body.inputs.service || null,
        body.inputs.frequency || null,
        body.inputs.erp_kw || null,
        body.inputs.haat_m || null,
        body.inputs.lat || null,
        body.inputs.lon || null,
        body.method || null,
        body
      ]
    );
    res.json({ id: r.rows[0].id, created_at: r.rows[0].created_at });
  } catch (e) {
    res.status(500).json({ error: 'insert failed', detail: String(e.message) });
  }
});

// GET /api/exhibits — list (most recent first).
app.get('/api/exhibits', async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'database not configured' });
  const r = await pool.query(
    `SELECT id, call_sign, facility_id, service, frequency, erp_kw, haat_m,
            method, created_at
       FROM genoa_exhibit
      ORDER BY created_at DESC
      LIMIT 200`
  );
  res.json(r.rows);
});

// GET /api/exhibits/:id — full record.
app.get('/api/exhibits/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'database not configured' });
  const r = await pool.query(`SELECT * FROM genoa_exhibit WHERE id = $1`, [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
});

/* -------- Asset upload (Spaces) ---------------------------------- */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

app.post('/api/assets', upload.single('file'), async (req, res) => {
  if (!s3 || !SPACES_BUCKET) return res.status(503).json({ error: 'spaces not configured' });
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const exhibitId = req.body.exhibit_id || 'unbound';
  const safeName  = req.file.originalname.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  const key       = `genoa/${exhibitId}/${Date.now()}-${safeName}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream',
      ACL: 'private'
    }));
    if (pool) {
      await pool.query(
        `INSERT INTO genoa_asset (exhibit_id, kind, key, content_type, size_bytes, created_at)
         VALUES ($1,$2,$3,$4,$5, now())`,
        [exhibitId === 'unbound' ? null : exhibitId, req.body.kind || 'sigmf', key, req.file.mimetype || null, req.file.size]
      );
    }
    res.json({ key, bucket: SPACES_BUCKET, region: SPACES_REGION });
  } catch (e) {
    res.status(500).json({ error: 'upload failed', detail: String(e.message) });
  }
});

// GET /api/assets/:id/url — signed URL for a stored asset.
app.get('/api/assets/:id/url', async (req, res) => {
  if (!s3 || !pool) return res.status(503).json({ error: 'spaces or db not configured' });
  const r = await pool.query(`SELECT key, content_type FROM genoa_asset WHERE id = $1`, [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'not found' });
  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: r.rows[0].key }), { expiresIn: 600 });
    res.json({ url, expires_in: 600, content_type: r.rows[0].content_type });
  } catch (e) {
    res.status(500).json({ error: 'sign failed', detail: String(e.message) });
  }
});

/* ----------------------------------------------------------------- */
const server = app.listen(PORT, async () => {
  console.log(`[genoa] listening on :${PORT} (${NODE_ENV})`);
  if (pool) {
    try { await migrate(); console.log('[genoa] postgres migrations applied'); }
    catch (e) { console.warn('[genoa] migration skipped:', e.message); }
  } else {
    console.warn('[genoa] DATABASE_URL not set — running in stateless mode');
  }
  if (!s3) console.warn('[genoa] SPACES not configured — asset uploads disabled');
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
