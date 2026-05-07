// Engineering export job runner.
//
// Dispatches a queued job to the appropriate compute / render pipeline.
// Updates progress messages so the UI can show "Computing exhibit…",
// "Running FCC validation…", "Rendering engineering statement…" while
// the long work runs in the background.
//
// PURE EXECUTION ARCHITECTURE — does not modify FCC math, contour
// logic, parity logic, or report content.  It just calls the same
// pipelines that the synchronous endpoints already call.

import {
  JOB_KIND, JOB_STATUS,
  getJob, setProgress, completeJob, failJob, updateJob
} from './jobStore.js';
import { computeExhibit }                  from './exhibitService.js';
import { applyComputeOptionDefaults }      from './computeOptionDefaults.js';
import { buildEngineeringReport }          from '../../exports/engineeringReport/index.js';
import { renderEngineeringReportText }     from '../../exports/engineeringReport/renderText.js';
import { renderEngineeringReportPdf }      from '../../exports/engineeringReport/renderPdf.js';

const PROGRESS = Object.freeze({
  COMPUTING:        'Computing exhibit…',
  VALIDATING:       'Running FCC validation…',
  BUILDING_REPORT:  'Building engineering statement…',
  RENDERING_TXT:    'Rendering engineering statement (TXT)…',
  RENDERING_PDF:    'Rendering engineering statement (PDF)…',
  FINALIZING:       'Finalizing artifact…'
});

export async function runJob(id){
  const r = getJob(id);
  if (!r) throw new Error(`runJob: no such job ${id}`);
  if (r.status !== JOB_STATUS.QUEUED && r.status !== JOB_STATUS.RUNNING){
    return r;  // already terminal
  }
  try {
    switch (r.kind){
      case JOB_KIND.EXHIBIT:                 await runExhibitJob(r);   break;
      case JOB_KIND.ENGINEERING_REPORT_TXT:  await runReportJob(r, 'txt'); break;
      case JOB_KIND.ENGINEERING_REPORT_PDF:  await runReportJob(r, 'pdf'); break;
      default: throw new Error(`unknown job kind: ${r.kind}`);
    }
  } catch (err){
    failJob(id, err);
  }
  return getJob(id);
}

// Schedule a job to run on the next macrotask so the POST handler can
// return immediately.  Errors inside runJob are captured by failJob;
// nothing here may throw to the event loop.
export function scheduleJob(id){
  setImmediate(() => { runJob(id).catch(() => { /* failJob already ran */ }); });
}

// Wrap the job record's POST body into the shape computeExhibit expects.
// The HTTP body the UI POSTs is `{ kind, input: {...form fields}, options }`.
// The job store keeps `r.input` as the form fields and `r.options` as
// the option bag — both flat.  computeExhibit reads `req.inputs` (plural)
// and `req.options`, so without this re-wrap the engine would run with
// an empty inputs map and produce the FACILITY_COORDINATES_MISSING /
// FCC_METHOD_MISSING blockers despite a fully populated form.
//
// applyComputeOptionDefaults() is then called to fill in server-side
// defaults the caller didn't set (e.g. options.use_terrain = true for
// non-AM stations).  See computeOptionDefaults.js for the full table.
function computeReq(r){
  return applyComputeOptionDefaults({
    inputs:  r.input   || {},
    options: r.options || {}
  });
}

// ─────────── kind dispatchers ───────────

async function runExhibitJob(r){
  setProgress(r.id, PROGRESS.COMPUTING);
  const exhibit = await computeExhibit(computeReq(r));
  setProgress(r.id, PROGRESS.FINALIZING);
  completeJob(r.id, {
    result:       { exhibit },
    artifact_url: artifactUrl(r.id)
  });
}

async function runReportJob(r, ext){
  // 1. Compute (the input may already be a full exhibit; prefer that
  //    path when the caller has done it).
  setProgress(r.id, PROGRESS.COMPUTING);
  const exhibit = (r.input && r.input.exhibit && typeof r.input.exhibit === 'object')
    ? r.input.exhibit
    : await computeExhibit(computeReq(r));

  // 2. Validation pass — exhibitService.computeExhibit already runs the
  //    standard validation.  Surfacing the milestone separately is
  //    informational (so the UI can show "Running FCC validation…").
  setProgress(r.id, PROGRESS.VALIDATING);
  // (No additional work here; computeExhibit attaches validation.)

  // 3. Build report model.
  setProgress(r.id, PROGRESS.BUILDING_REPORT);
  const doc = buildEngineeringReport(exhibit, r.options || {});

  // 4. Render TXT or PDF.
  if (ext === 'txt'){
    setProgress(r.id, PROGRESS.RENDERING_TXT);
    const body = renderEngineeringReportText(doc);
    completeJob(r.id, {
      result: {
        kind:         'engineering_report_txt',
        filename:     reportFilename(exhibit, 'txt'),
        size_bytes:   Buffer.byteLength(body, 'utf8')
      },
      artifact: {
        content_type: 'text/plain; charset=utf-8',
        body:         Buffer.from(body, 'utf8'),
        filename:     reportFilename(exhibit, 'txt')
      },
      artifact_url: artifactUrl(r.id)
    });
  } else {
    setProgress(r.id, PROGRESS.RENDERING_PDF);
    const body = await renderEngineeringReportPdf(doc);
    completeJob(r.id, {
      result: {
        kind:         'engineering_report_pdf',
        filename:     reportFilename(exhibit, 'pdf'),
        size_bytes:   body.length
      },
      artifact: {
        content_type: 'application/pdf',
        body,
        filename:     reportFilename(exhibit, 'pdf')
      },
      artifact_url: artifactUrl(r.id)
    });
  }
}

// ─────────── helpers ───────────

function artifactUrl(id){
  return `/api/exhibit/jobs/${id}/artifact`;
}

function reportFilename(exhibit, ext){
  const call = (exhibit?.station_inputs?.call || 'exhibit')
                 .toString().replace(/[^A-Za-z0-9]/g, '_');
  const ts   = new Date().toISOString().slice(0, 10);
  return `genoa-engineering-statement-${call}-${ts}.${ext}`;
}
