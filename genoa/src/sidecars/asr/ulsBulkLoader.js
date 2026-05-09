// FCC ULS r_tower.zip bulk loader.
//
// Source: https://data.fcc.gov/download/pub/uls/complete/r_tower.zip
//   ~37 MB, ~1.7M tower records.  FCC publishes weekly (Sunday).
//
// Format: pipe-delimited records, multiple files in one zip.  We need
//   RA.dat — Antenna Structure Registration (one row per ASR / USI)
//   CO.dat — Coordinates (one row per USI; T = tower)
//   EN.dat — Entity (one row per USI per entity-type; we keep RB = Registered Business)
//
// Field reference: https://www.fcc.gov/sites/default/files/pubacc_tower_definitions_05.pdf
//
// Strategy: stream the zip; for each entry, parse pipe-delimited rows
// into an in-memory map keyed by USI; after all 3 files parsed,
// upsert into Postgres in batches of 5_000.  Memory ceiling ~500 MB
// during load — well within the apps-s-1vcpu-1gb instance the sidecar
// runs on.
//
// Failure handling: any per-row parse error logs and skips; the
// loader doesn't blow up on a single bad record.  asr_load_state
// records the duration + counts so the sidecar's /healthz exposes
// "last loaded N records at T".

import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import unzipper from 'unzipper';

const BULK_URL = process.env.ASR_BULK_URL
              || 'https://data.fcc.gov/download/pub/uls/complete/r_tower.zip';

const FT_PER_M = 0.3048;

// Decode FCC coordinate triple (degrees, minutes, seconds, hemisphere)
// to signed decimal degrees.  Empty fields yield null.
function dms(d, m, s, hemi){
  const dd = parseFloat(d);
  const mm = parseFloat(m);
  const ss = parseFloat(s);
  if (!Number.isFinite(dd)) return null;
  let deg = dd + (Number.isFinite(mm) ? mm / 60 : 0) + (Number.isFinite(ss) ? ss / 3600 : 0);
  if (hemi === 'S' || hemi === 'W') deg = -deg;
  return deg;
}

function ftToM(ft){
  const f = parseFloat(ft);
  return Number.isFinite(f) ? f * FT_PER_M : null;
}

function parseDate(s){
  if (!s || !s.trim()) return null;
  // ULS format: MM/DD/YYYY
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function emptyToNull(s){
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

// Stream-parse pipe-delimited file lines.  Yields each row as an
// array of fields (no quoting in ULS dump; pipes are the only
// delimiter).
async function* parsePipeFile(stream){
  let buf = '';
  for await (const chunk of stream){
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0){
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line) yield line.split('|');
    }
  }
  if (buf) yield buf.split('|');
}

/**
 * Run the full bulk load: download zip → parse RA + CO + EN →
 * upsert into asr_towers → update asr_load_state.  Returns a summary
 * object with counts + duration.  Throws on fatal errors (network,
 * disk, DB).  Per-record parse errors are logged and skipped.
 */
export async function runBulkLoad(pool, log = console){
  const startedAt = Date.now();
  log.info('[asr-loader] start; source =', BULK_URL);

  // 1. Download
  const zipPath = join(tmpdir(), `r_tower-${Date.now()}.zip`);
  log.info('[asr-loader] downloading to', zipPath);
  const r = await fetch(BULK_URL, {
    headers: { 'user-agent': 'genoa-asr-sidecar/0.1 (chelstein/itmlogic)' }
  });
  if (!r.ok) throw new Error(`bulk download HTTP ${r.status}`);
  const etag = r.headers.get('etag') || null;
  const lastMod = r.headers.get('last-modified') || null;
  const zipBuf = Buffer.from(await r.arrayBuffer());
  await writeFile(zipPath, zipBuf);
  const sz = zipBuf.length;
  const sha256 = createHash('sha256').update(zipBuf).digest('hex');
  log.info(`[asr-loader] downloaded ${(sz/1e6).toFixed(1)} MB (etag=${etag}, sha256=${sha256.slice(0,16)}…)`);

  // 2. Parse — first pass: index every entry name so we know what's in there
  //    Then per-entry stream-parse the records we need.
  const towers = new Map();           // USI → tower record
  const coordsByUsi = new Map();      // USI → {lat, lon}
  const ownerByUsi = new Map();       // USI → owner name (first RB entity wins)

  const directory = await unzipper.Open.file(zipPath);
  const want = ['RA.dat', 'CO.dat', 'EN.dat'];

  for (const name of want){
    const entry = directory.files.find(f => f.path.endsWith(name));
    if (!entry){
      log.warn(`[asr-loader] zip missing ${name}; some fields will be null`);
      continue;
    }
    log.info(`[asr-loader] parsing ${name} (${(entry.uncompressedSize/1e6).toFixed(1)} MB uncompressed)`);
    let n = 0;
    for await (const fields of parsePipeFile(entry.stream())){
      n++;
      if (n % 200000 === 0) log.info(`[asr-loader]   ${name}: ${n} rows`);
      try {
        if (name === 'RA.dat')      handleRA(fields, towers);
        else if (name === 'CO.dat') handleCO(fields, coordsByUsi);
        else if (name === 'EN.dat') handleEN(fields, ownerByUsi);
      } catch (e){
        // skip bad rows silently after the first few; uniform parse
        // errors across millions of rows would flood logs.
        if (n < 5) log.warn(`[asr-loader] ${name} row ${n} parse error: ${e.message}`);
      }
    }
    log.info(`[asr-loader] ${name}: ${n} total rows parsed`);
  }

  // Merge coords + owner into towers
  let nWithCoords = 0, nWithOwner = 0;
  for (const t of towers.values()){
    const c = coordsByUsi.get(t.unique_system_id);
    if (c){
      t.latitude_deg  = c.lat;
      t.longitude_deg = c.lon;
      if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) nWithCoords++;
    }
    const o = ownerByUsi.get(t.unique_system_id);
    if (o){
      t.owner_name = o.name;
      t.owner_frn  = o.frn;
      if (o.name) nWithOwner++;
    }
  }

  log.info(`[asr-loader] merged: ${towers.size} towers; ${nWithCoords} w/coords; ${nWithOwner} w/owner`);

  // 3. Bulk upsert in batches of 5_000
  await pool.query('BEGIN');
  try {
    await pool.query('TRUNCATE asr_towers');
    const all = [...towers.values()];
    const BATCH = 5_000;
    for (let i = 0; i < all.length; i += BATCH){
      const slice = all.slice(i, i + BATCH);
      const cols = [
        'asr_number', 'unique_system_id', 'status', 'registration_purpose',
        'date_issued', 'date_constructed', 'date_action',
        'latitude_deg', 'longitude_deg',
        'height_of_structure_m', 'ground_elevation_m',
        'overall_height_agl_m', 'overall_height_amsl_m',
        'structure_type', 'faa_study_number', 'faa_circular_number',
        'faa_emi_flag', 'nepa_flag', 'date_faa_determination',
        'painting_lighting', 'mark_light_code',
        'structure_address', 'structure_city', 'structure_state',
        'owner_name', 'owner_frn'
      ];
      const placeholders = [];
      const values = [];
      slice.forEach((t, j) => {
        const base = j * cols.length;
        placeholders.push(`(${cols.map((_, k) => `$${base + k + 1}`).join(',')})`);
        values.push(
          t.asr_number, t.unique_system_id, t.status, t.registration_purpose,
          t.date_issued, t.date_constructed, t.date_action,
          t.latitude_deg ?? null, t.longitude_deg ?? null,
          t.height_of_structure_m, t.ground_elevation_m,
          t.overall_height_agl_m, t.overall_height_amsl_m,
          t.structure_type, t.faa_study_number, t.faa_circular_number,
          t.faa_emi_flag, t.nepa_flag, t.date_faa_determination,
          t.painting_lighting, t.mark_light_code,
          t.structure_address, t.structure_city, t.structure_state,
          t.owner_name ?? null, t.owner_frn ?? null
        );
      });
      const sql = `INSERT INTO asr_towers (${cols.join(',')}) VALUES ${placeholders.join(',')}
                   ON CONFLICT (asr_number) DO NOTHING`;
      await pool.query(sql, values);
      if ((i / BATCH) % 10 === 0) log.info(`[asr-loader]   inserted ${Math.min(i+BATCH, all.length)} / ${all.length}`);
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    await pool.query(`
      INSERT INTO asr_load_state (id, last_loaded_at, last_source_url, last_source_etag,
                                  last_source_last_modified, records_total, records_with_coords,
                                  records_with_owner, load_duration_seconds, load_error)
      VALUES (1, now(), $1, $2, $3, $4, $5, $6, $7, NULL)
      ON CONFLICT (id) DO UPDATE SET
        last_loaded_at = EXCLUDED.last_loaded_at,
        last_source_url = EXCLUDED.last_source_url,
        last_source_etag = EXCLUDED.last_source_etag,
        last_source_last_modified = EXCLUDED.last_source_last_modified,
        records_total = EXCLUDED.records_total,
        records_with_coords = EXCLUDED.records_with_coords,
        records_with_owner = EXCLUDED.records_with_owner,
        load_duration_seconds = EXCLUDED.load_duration_seconds,
        load_error = NULL
    `, [BULK_URL, etag, lastMod ? new Date(lastMod) : null,
        towers.size, nWithCoords, nWithOwner, elapsed]);

    // 4. Archive the raw zip + rotate off anything > 28 days.  The
    //    archive lets operators diff this week's data against any of
    //    the prior 3 weekly publications.  Rolling 4-week window with
    //    oldest aging off; the asr_zip_archive table holds the raw
    //    bytea so we don't depend on container-ephemeral disk.
    await pool.query(`
      INSERT INTO asr_zip_archive
        (snapshot_date, source_url, source_etag, source_last_modified, size_bytes, sha256, zip_data)
      VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6)
      ON CONFLICT (snapshot_date) DO UPDATE SET
        source_url           = EXCLUDED.source_url,
        source_etag          = EXCLUDED.source_etag,
        source_last_modified = EXCLUDED.source_last_modified,
        size_bytes           = EXCLUDED.size_bytes,
        sha256               = EXCLUDED.sha256,
        zip_data             = EXCLUDED.zip_data,
        archived_at          = now()
    `, [BULK_URL, etag, lastMod ? new Date(lastMod) : null, sz, sha256, zipBuf]);

    const purged = await pool.query(`
      DELETE FROM asr_zip_archive
       WHERE archived_at < (now() - INTERVAL '28 days')
       RETURNING snapshot_date
    `);
    if (purged.rowCount > 0){
      log.info(`[asr-loader] archive: rotated off ${purged.rowCount} snapshot(s) older than 28 days: ${purged.rows.map(r => r.snapshot_date).join(', ')}`);
    }

    await pool.query('COMMIT');
    log.info(`[asr-loader] DONE ${towers.size} rows + ${(sz/1e6).toFixed(1)} MB zip archived in ${elapsed}s`);
    await unlink(zipPath).catch(() => {});
    return {
      records_total:        towers.size,
      records_with_coords:  nWithCoords,
      records_with_owner:   nWithOwner,
      load_duration_seconds: elapsed,
      archive_size_bytes:   sz,
      archive_sha256:       sha256,
      archive_purged:       purged.rowCount
    };
  } catch (e){
    await pool.query('ROLLBACK');
    await pool.query(`
      INSERT INTO asr_load_state (id, last_loaded_at, load_error)
      VALUES (1, now(), $1)
      ON CONFLICT (id) DO UPDATE SET last_loaded_at = now(), load_error = EXCLUDED.load_error
    `, [String(e.message).slice(0, 500)]);
    throw e;
  }
}

// ─── per-record handlers ────────────────────────────────────────────
//
// FCC ULS r_tower.zip pubacc record layout (verified against actual
// 2026 file content; pubacc_tower_definitions doc is misleading because
// it lists the LOGICAL columns omitting the universal pubacc prefix):
//
//   f[0] = record_type                   ('RA' | 'CO' | 'EN')
//   f[1] = record_status                 ('REG' typically)
//   f[2] = uls_file_number               ('A0094609')
//   f[3] = unique_system_identifier      (BIGINT; the join key)
//   f[4] = registration / call_sign      (ASR # for RA records)
//   ... per-record fields from f[5] onward
//
// ALL indexes below are zero-based on the raw pipe-split row.

// RA record (Antenna Structure Registration).
function handleRA(f, towers){
  if (f[0] !== 'RA') return;
  const usi = parseInt(f[3], 10);
  if (!Number.isFinite(usi)) return;          // skip records w/ no USI
  const asr = emptyToNull(f[4]);              // registration_number
  if (!asr) return;
  towers.set(usi, {
    asr_number:               asr,
    unique_system_id:         usi,
    registration_purpose:     emptyToNull(f[5]),       // application_purpose (NE/MD/AM/etc)
    status:                   emptyToNull(f[8]),       // status_code (A/T/C/W)
    date_issued:              parseDate(f[11]),
    date_constructed:         parseDate(f[12]),
    date_action:              parseDate(f[14]),
    structure_address:        emptyToNull(f[23]),
    structure_city:           emptyToNull(f[24]),
    structure_state:          emptyToNull(f[25]),
    height_of_structure_m:    ftToM(f[28]),
    ground_elevation_m:       ftToM(f[29]),
    overall_height_agl_m:     ftToM(f[30]),            // overall_height_above_ground
    overall_height_amsl_m:    ftToM(f[31]),            // overall_height_amsl
    structure_type:           emptyToNull(f[32]),
    date_faa_determination:   parseDate(f[33]),
    faa_study_number:         emptyToNull(f[34]),
    faa_circular_number:      emptyToNull(f[35]),
    painting_lighting:        emptyToNull(f[37]),      // painting_and_lighting
    mark_light_code:          emptyToNull(f[38]),
    faa_emi_flag:             emptyToNull(f[41]),
    nepa_flag:                emptyToNull(f[42]),
    latitude_deg:             null,           // filled by handleCO merge
    longitude_deg:            null,
    owner_name:               null,           // filled by handleEN merge
    owner_frn:                null
  });
}

// CO record (Coordinates).  Layout:
//   record_type | record_status | file_number | usi | reg_number |
//   coordinate_type ('T' tower / 'P' point) |
//   lat_deg | lat_min | lat_sec | lat_dir |
//   lon_deg | lon_min | lon_sec | lon_dir
function handleCO(f, coordsByUsi){
  if (f[0] !== 'CO') return;
  const usi = parseInt(f[3], 10);
  if (!Number.isFinite(usi)) return;
  // Coord triples start at f[6] (lat) and f[10] (lon).  Many CO rows
  // in r_tower omit the lat/min and only fill seconds=0.0 — we accept
  // them and just produce 0/0 if neither component is parseable, which
  // dms() returns as null and the caller skips.
  const lat = dms(f[6], f[7], f[8], f[9]);
  const lon = dms(f[10], f[11], f[12], f[13]);
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)){
    coordsByUsi.set(usi, { lat, lon });
  }
}

// EN record (Entity).  Layout:
//   record_type | record_status | file_number | usi | call_sign |
//   entity_type | license_id | entity_name | first_name | last_name |
//   ... | frn | applicant_type_code | ...
// Entity types per FCC pubacc:
//   'O'  = Owner             (most common for towers; we want this)
//   'RB' = Registered Business
//   'CL' = Client
//   'L'  = Licensee
//   'AT' = Attorney
//   'CO' = Contact
//   'E'  = Engineer
// Tower-owner records use 'O' overwhelmingly.  First-wins per USI.
function handleEN(f, ownerByUsi){
  if (f[0] !== 'EN') return;
  const usi = parseInt(f[3], 10);
  if (!Number.isFinite(usi)) return;
  const entityType = emptyToNull(f[5]);
  if (!['O', 'RB', 'CL', 'L'].includes(entityType)) return;
  if (ownerByUsi.has(usi)) return;
  // entity_name is at f[9] in r_tower's EN layout (verified against
  // actual file content).  When entity_name is empty the row may be
  // an individual owner — concatenate first + last name.
  let name = emptyToNull(f[9]);
  if (!name){
    const first = emptyToNull(f[10]);
    const last  = emptyToNull(f[12]);
    if (last) name = first ? `${first} ${last}` : last;
  }
  if (!name) return;
  // FRN typically appears in the trailing portion of the row; pubacc
  // varies the position across vintages, so we don't pin it.
  ownerByUsi.set(usi, { name, frn: null });
}
