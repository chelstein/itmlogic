// In-process job store for engineering export jobs.
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
// The store always keeps state in-process so unit tests and stateless
// deployments work without a database.  When DATABASE_URL is configured
// AND migration 003 has run, the same writes mirror to
// `engineering_export_jobs` so a process restart can resume status
// queries.  The artifact body is large (PDF) so it is NOT stored in the
// row — it stays in-process.  An exported job that survives a restart
// will report status:'failed' with code:'ARTIFACT_EVICTED'.

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
    artifact:         null,    // { content_type, body }
    artifact_url:     null,
    error:            null,
    created_at:       now,
    updated_at:       now
  };
  memory.set(id, record);
  persist(record).catch(() => { /* best-effort */ });
  return id;
}

export function getJob(id){
  return memory.get(id) || null;
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
  } catch (e){
    // Table may not exist yet (migration not run) or DB may have gone
    // away.  Drop into in-process-only mode and stop trying for the rest
    // of this process's lifetime.
    dbAvailable = false;
  }
}

// ─────────── Test-only helpers ───────────

export function _resetForTests(){
  memory.clear();
  dbAvailable = poolReady();
}

