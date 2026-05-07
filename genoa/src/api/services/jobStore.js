// In-process + DB-backed job store for engineering export jobs.
//
// PURPOSE
// -------
// HTTP exhibit/export requests can take 10–60 s (compute + parity +
// PDF render).  Behind a strict platform proxy these requests die with
// HTTP 504.  This store + the runner that lives next door let the API
// return immediately with a job_id and let the work continue in the
// background.  Clients poll GET /api/exhibit/jobs/:id.
//
// PERSISTENCE
// -----------
// State lives in two places:
//   1. In-process Map  — fast path; serves the instance that ran the job.
//   2. Postgres        — durable; serves OTHER instances behind the load
//                        balancer.  Without this, /api/exhibit/jobs/:id
//                        polls returned 404 whenever the request was
//                        routed to an instance other than the one that
//                        ran setImmediate(runJob).  Also survives a
//                        process restart so an in-flight artifact can
//                        still be downloaded after a deploy.
//
// Artifact bytes (PDF / TXT) are written to engineering_export_jobs as
// BYTEA via migration 004.  ~50–200 KB rows; TOAST handles them.
//
// Falls back to in-process-only when DATABASE_URL is unset or migrations
// 003/004 haven't run.  This keeps unit tests and stateless dev
// deployments working unchanged.

import { randomUUID } from 'node:crypto';
import { pool, poolReady } from '../../db/pool.js';

export const JOB_STATUS = Object.freeze({
  QUEUED:   'queued',
  RUNNING:  'running',
  COMPLETE: 'complete',
  FAILED:   'failed'
});

export const JOB_KIND = Object.freeze({
  EXHIBIT:                 'exhibit',
  ENGINEERING_REPORT_TXT:  'engineering_report_txt',
  ENGINEERING_REPORT_PDF:  'engineering_report_pdf'
});

const memory = new Map();    // job_id → record (full record incl. artifact)
let dbAvailable = poolReady();

export function createJob({ kind, input = {}, options = {} }){
  if (!Object.values(JOB_KIND).includes(kind)){
    const err = new Error(`unknown job kind: ${kind}`);
    err.code = 'BAD_KIND';
    throw err;
  }
  const id  = randomUUID();
  const now = new Date().toISOString();
  const record = {
    id,
    kind,
    status:           JOB_STATUS.QUEUED,
    progress_message: 'Queued',
    input:            structuredClone(input),
    options:          structuredClone(options),
    result:           null,
    artifact:         null,    // { content_type, body, filename }
    artifact_url:     null,
    error:            null,
    created_at:       now,
    updated_at:       now
  };
  memory.set(id, record);
  persist(record).catch(() => { /* best-effort */ });
  return id;
}

// Sync read of in-process state ONLY.  Use getJobAsync when the caller
// can fall back to the DB (i.e. behind a load balancer where the job
// may have been created on a sibling instance).
export function getJob(id){
  return memory.get(id) || null;
}

// Cross-instance read.  Tries in-process first (zero-latency for the
// instance that ran the job), then the DB.  Hydrates the in-process
// map on a DB hit so subsequent polls on this instance are fast.
export async function getJobAsync(id){
  const m = memory.get(id);
  if (m) return m;
  if (!dbAvailable) return null;
  const row = await readDbRow(id);
  if (!row) return null;
  memory.set(id, row);   // hydrate cache for this instance
  return row;
}

export function listJobs(){
  return Array.from(memory.values()).map(toView);
}

export function updateJob(id, patch){
  const r = memory.get(id);
  if (!r) return null;
  Object.assign(r, patch, { updated_at: new Date().toISOString() });
  persist(r).catch(() => { /* best-effort */ });
  return r;
}

export function setProgress(id, message){
  return updateJob(id, { status: JOB_STATUS.RUNNING, progress_message: message });
}

export function completeJob(id, { result = null, artifact = null, artifact_url = null } = {}){
  return updateJob(id, {
    status:           JOB_STATUS.COMPLETE,
    progress_message: 'Complete',
    result,
    artifact,
    artifact_url,
    error:            null
  });
}

export function failJob(id, err){
  const message = (err && (err.message || err.toString())) || 'unknown error';
  const code    = (err && err.code) || 'JOB_FAILED';
  return updateJob(id, {
    status:           JOB_STATUS.FAILED,
    progress_message: 'Failed',
    error:            { code, message, stack: (err && err.stack) || null }
  });
}

// JSON-serializable view (omits the heavy artifact body).
export function toView(r){
  if (!r) return null;
  return {
    job_id:           r.id,
    kind:             r.kind,
    status:           r.status,
    progress_message: r.progress_message || null,
    artifact_url:     r.artifact_url || null,
    error:            r.error || null,
    created_at:       r.created_at,
    updated_at:       r.updated_at
  };
}

// ─────────── DB mirror (best-effort, optional) ───────────

async function persist(r){
  if (!dbAvailable) return;
  try {
    const p = pool();
    await p.query(
      `INSERT INTO engineering_export_jobs
         (id, kind, status, progress_message, input_json, options_json,
          result_json, artifact_url, error_json,
          artifact_body, artifact_content_type, artifact_filename,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         status                = EXCLUDED.status,
         progress_message      = EXCLUDED.progress_message,
         result_json           = EXCLUDED.result_json,
         artifact_url          = EXCLUDED.artifact_url,
         error_json            = EXCLUDED.error_json,
         artifact_body         = COALESCE(EXCLUDED.artifact_body,         engineering_export_jobs.artifact_body),
         artifact_content_type = COALESCE(EXCLUDED.artifact_content_type, engineering_export_jobs.artifact_content_type),
         artifact_filename     = COALESCE(EXCLUDED.artifact_filename,     engineering_export_jobs.artifact_filename),
         updated_at            = EXCLUDED.updated_at`,
      [
        r.id, r.kind, r.status, r.progress_message,
        JSON.stringify(r.input || {}),
        JSON.stringify(r.options || {}),
        r.result ? JSON.stringify(r.result) : null,
        r.artifact_url || null,
        r.error ? JSON.stringify(r.error) : null,
        r.artifact?.body || null,
        r.artifact?.content_type || null,
        r.artifact?.filename || null,
        r.created_at, r.updated_at
      ]
    );
  } catch (e){
    // Migration 003 / 004 may not be applied yet, OR the new BYTEA
    // columns are missing.  Try the legacy 13-arg insert (sans artifact
    // bytes) once before giving up — keeps writes flowing while a
    // deploy with the new schema rolls out.
    try {
      const p = pool();
      await p.query(
        `INSERT INTO engineering_export_jobs
           (id, kind, status, progress_message, input_json, options_json,
            result_json, artifact_url, error_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           status           = EXCLUDED.status,
           progress_message = EXCLUDED.progress_message,
           result_json      = EXCLUDED.result_json,
           artifact_url     = EXCLUDED.artifact_url,
           error_json       = EXCLUDED.error_json,
           updated_at       = EXCLUDED.updated_at`,
        [
          r.id, r.kind, r.status, r.progress_message,
          JSON.stringify(r.input || {}),
          JSON.stringify(r.options || {}),
          r.result ? JSON.stringify(r.result) : null,
          r.artifact_url || null,
          r.error ? JSON.stringify(r.error) : null,
          r.created_at, r.updated_at
        ]
      );
    } catch {
      // Real failure (table missing entirely, DB down, etc) — drop into
      // in-process-only mode for this process's lifetime.
      dbAvailable = false;
    }
  }
}

async function readDbRow(id){
  if (!dbAvailable) return null;
  try {
    const p = pool();
    const r = await p.query(
      `SELECT id, kind, status, progress_message,
              input_json, options_json, result_json,
              artifact_url, error_json,
              artifact_body, artifact_content_type, artifact_filename,
              created_at, updated_at
         FROM engineering_export_jobs
        WHERE id = $1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id:               row.id,
      kind:             row.kind,
      status:           row.status,
      progress_message: row.progress_message,
      input:            row.input_json   || {},
      options:          row.options_json || {},
      result:           row.result_json  || null,
      artifact:         row.artifact_body
        ? {
            body:         row.artifact_body,                          // pg returns Buffer for BYTEA
            content_type: row.artifact_content_type || 'application/octet-stream',
            filename:     row.artifact_filename     || null
          }
        : null,
      artifact_url:     row.artifact_url || null,
      error:            row.error_json   || null,
      created_at:       (row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at),
      updated_at:       (row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at)
    };
  } catch {
    return null;
  }
}

// ─────────── Test-only helpers ───────────

export function _resetForTests(){
  memory.clear();
  dbAvailable = poolReady();
}
