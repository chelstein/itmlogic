// Genoa standalone worker — Postgres-backed async job runner.
//
// This process polls engineering_export_jobs for QUEUED rows that
// weren't claimed by an API worker (e.g. because the creating instance
// crashed, or the operator enqueued a batch job directly into PG).
//
// JOB ARCHITECTURE
//   Normal path: API POST → createJob() → scheduleJob() → runJob()
//     runs in-process on the API worker via setImmediate.
//
//   This worker: polls PG every POLL_MS for any QUEUED row whose
//     updated_at hasn't moved in CLAIM_AFTER_MS (default 60 s).
//     Uses FOR UPDATE SKIP LOCKED so concurrent workers don't
//     double-claim the same row.  Claims by flipping status to
//     RUNNING, hydrates the in-process job map from the DB row,
//     then calls runJob() from the same pipeline the API workers use.
//
// STATELESS
//   Does not touch FCC math, contour logic, parity, or report
//   content.  It is a dispatcher and nothing more.

import { pool, poolReady, dbHealthy } from '../db/pool.js';
import { runJob }    from '../api/services/jobRunner.js';
import {
  JOB_STATUS, JOB_KIND,
  getJob, updateJob, failJob,
  startOrphanReaper
} from '../api/services/jobStore.js';

const POLL_MS       = parseInt(process.env.WORKER_POLL_MS       || '5000',  10);
const CLAIM_AFTER_MS= parseInt(process.env.WORKER_CLAIM_AFTER_MS|| '60000', 10);
const MAX_PER_TICK  = parseInt(process.env.WORKER_MAX_PER_TICK  || '2',     10);

// ─────────── helpers ───────────

// Claim up to MAX_PER_TICK QUEUED rows that are old enough to not be
// running on an API worker, using FOR UPDATE SKIP LOCKED to prevent
// duplicate claims across concurrent worker instances.  Returns an
// array of hydrated in-process record ids.
async function claimJobs(){
  const p = pool();
  const cutoff = new Date(Date.now() - CLAIM_AFTER_MS).toISOString();

  const r = await p.query(
    `UPDATE engineering_export_jobs
        SET status           = $1,
            progress_message = 'Claimed by standalone worker',
            updated_at       = NOW()
      WHERE id IN (
        SELECT id FROM engineering_export_jobs
         WHERE status = $2 AND updated_at < $3
         ORDER BY created_at ASC
         LIMIT $4
           FOR UPDATE SKIP LOCKED
      )
      RETURNING id, kind, status,
                input_json, options_json,
                created_at, updated_at`,
    [JOB_STATUS.RUNNING, JOB_STATUS.QUEUED, cutoff, MAX_PER_TICK]
  );

  const ids = [];
  for (const row of r.rows){
    // Hydrate into the in-process map so runJob() can read getJob(id).
    const existing = getJob(row.id);
    if (!existing){
      // Build a minimal in-process record from the DB row — only
      // the fields runJob()/setProgress()/failJob()/completeJob() use.
      const rec = {
        id:               row.id,
        kind:             row.kind,
        status:           row.status,
        progress_message: 'Claimed by standalone worker',
        input:            row.input_json   || {},
        options:          row.options_json || {},
        result:           null,
        artifact:         null,
        artifact_url:     null,
        error:            null,
        created_at:       row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updated_at:       row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      };
      updateJob(row.id, rec);
    }
    ids.push(row.id);
  }
  return ids;
}

async function tick(){
  if (!poolReady()) return;
  if (!(await dbHealthy())) return;

  let ids;
  try {
    ids = await claimJobs();
  } catch (e){
    console.warn(`[genoa-worker] claimJobs error:`, e.message);
    return;
  }
  if (ids.length === 0) return;

  console.log(`[genoa-worker] claimed ${ids.length} job(s): ${ids.join(', ')}`);
  for (const id of ids){
    if (!Object.values(JOB_KIND).includes(getJob(id)?.kind)){
      failJob(id, Object.assign(new Error(`unknown job kind: ${getJob(id)?.kind}`), { code: 'UNKNOWN_KIND' }));
      continue;
    }
    runJob(id).catch((e) => {
      console.error(`[genoa-worker] runJob(${id}) threw:`, e?.message || e);
    });
  }
}

async function main(){
  console.log(`[genoa-worker] started; poll=${POLL_MS}ms claim_after=${CLAIM_AFTER_MS}ms db=${poolReady() ? 'configured' : 'none'}`);
  if (poolReady()){
    startOrphanReaper({ logger: console });
  }
  setInterval(() => {
    tick().catch((e) => console.warn('[genoa-worker] tick error:', e?.message || e));
  }, POLL_MS);
}

main().catch((err) => {
  console.error('[genoa-worker] fatal:', err?.stack || err);
  process.exit(1);
});
