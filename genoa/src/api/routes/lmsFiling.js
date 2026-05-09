// LMS filing-package endpoints.
//
//   POST /api/exhibits/filing-package
//     body: { exhibit, applicant?: { engineer?: {...} } }
//     returns: { summary, filing_ready, fields[], json, html, plain_text, fields_csv, filename_stem }
//
//   GET  /api/exhibits/filing-package/cheatsheet?format=html|txt|csv|json
//     proxy that re-runs mapForm301Fm and emits the cheatsheet directly
//     as text/html or text/plain or text/csv or application/json.  Used
//     by the workbench "Download cheatsheet" button so the browser
//     drops a file straight into the user's downloads folder.
//
// Both routes are auth-gated by the requireAuth middleware mounted
// before any /api route in server.js.  Filing-package generation is
// pure (no DB, no network) — it just maps the supplied exhibit through
// the static FORM_301_FM_FIELDS schema.

import express from 'express';
import { buildFilingPackage } from '../../exports/lmsFiling/packager.js';
import { mapForm301Fm } from '../../exports/lmsFiling/mapping.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

// Late-binding ASR + FAA OE enrichment.  When the compute exhibit
// shipped without evidence.asr (operator typed facility_id + coords
// only; ZTR rich-station response carried no tower data; no ASR # in
// inputs), the LMS Filing Package's Section III 3E rows would render
// EVIDENCE MISSING — even though the FCC ASR Socrata DB knows the
// tower from its lat/lon.  Same story for FAA OE/AAA: when the ASR
// record on file references a faa_study_number, the form's FAA
// determination / painting / lighting rows can fill from that record.
//
// This enricher mutates the supplied exhibit (only for this request's
// in-memory copy — exhibits are not persisted by these routes) so the
// downstream form301fm.js derive() functions see populated evidence
// and produce filled rows.  Fail-soft: a Socrata outage just leaves
// the rows as-is.
async function enrichExhibitForLmsFiling(exhibit){
  if (!exhibit || typeof exhibit !== 'object') return;
  exhibit.evidence = exhibit.evidence || {};

  // ASR by lat/lon proximity.
  if (!exhibit.evidence.asr?.available){
    const lat = Number(exhibit.station_inputs?.lat);
    const lon = Number(exhibit.station_inputs?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      try {
        const { makeAsrClient, checkAsrAgainstApplication } = await import('../../evidence/asrClient.js');
        const asrClient = makeAsrClient();
        if (!asrClient){
          console.warn('[lmsFiling] enrichASR: asrClient is null (no ASR_SIDECAR_URL / ZTR / Socrata configured)');
        } else {
          const radius_m = Number(process.env.ASR_LOCATION_RADIUS_M) || 1000;
          console.log(`[lmsFiling] enrichASR: getByLocation lat=${lat} lon=${lon} radius_m=${radius_m}`);
          const byLoc = await asrClient.getByLocation({ lat, lon, radius_m });
          console.log(`[lmsFiling] enrichASR: result available=${byLoc.available} source=${byLoc.source || '-'} asr=${byLoc.asr_number || '-'} err=${byLoc.error || '-'}`);
          if (byLoc.available){
            const asrResult = checkAsrAgainstApplication({
              asr: byLoc,
              application: {
                asr_number:            exhibit.station_inputs?.asr_number || null,
                lat, lon,
                overall_height_m:      exhibit.station_inputs?.overall_height_m || null,
                overall_height_amsl_m: exhibit.station_inputs?.overall_height_amsl_m || null
              }
            });
            exhibit.evidence.asr = asrResult;
          }
        }
      } catch (err){
        console.warn('[lmsFiling] enrichASR: threw:', err?.message || err);
      }
    } else {
      console.log(`[lmsFiling] enrichASR: skipped — station_inputs lat/lon not finite (lat=${exhibit.station_inputs?.lat}, lon=${exhibit.station_inputs?.lon})`);
    }
  }

  // FAA OE/AAA by Aeronautical Study Number on the ASR record.
  if (!exhibit.evidence.faa_oe?.available
      && exhibit.evidence.asr?.faa_study_number){
    try {
      const { makeFaaOeClient, checkFaaAgainstAsr } = await import('../../evidence/faaOeClient.js');
      const faaClient = makeFaaOeClient();
      if (faaClient){
        const faa = await faaClient.getByStudyNumber(exhibit.evidence.asr.faa_study_number);
        if (faa.available || faa.error){
          exhibit.evidence.faa_oe = checkFaaAgainstAsr({ faa, asr: exhibit.evidence.asr });
        }
      }
    } catch { /* fail-soft */ }
  }

  // Rules-derived tower compliance (lighting / painting recommendation
  // per §17.21 / §17.23 / AC 70/7460-1L).  Only adds when ASR resolved
  // a height above threshold AND tower_compliance not already present.
  if (!exhibit.tower_compliance?.applicable
      && exhibit.evidence.asr?.available){
    try {
      const { requiredTowerCompliance, compareToAsr } =
        await import('../../engine/tower/index.js');
      const compliance = requiredTowerCompliance({
        height_agl_m:   exhibit.evidence.asr.overall_height_m
                          ?? exhibit.station_inputs?.overall_height_m
                          ?? null,
        height_amsl_m:  exhibit.evidence.asr.overall_height_amsl_m ?? null,
        structure_type: exhibit.station_inputs?.structure_type || 'TOWER',
        near_airport:   !!exhibit.station_inputs?.near_airport
      });
      if (compliance.applicable){
        exhibit.tower_compliance = compareToAsr({ compliance, asr: exhibit.evidence.asr });
      }
    } catch { /* fail-soft */ }
  }
}

r.post('/exhibits/filing-package', asyncHandler(async (req, res) => {
  const exhibit  = req.body?.exhibit;
  const applicant = req.body?.applicant || {};
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }
  await enrichExhibitForLmsFiling(exhibit);
  const pkg = buildFilingPackage(exhibit, applicant);
  res.json(pkg);
}));

// Direct download endpoint — Content-Disposition: attachment so
// browsers save instead of rendering inline.
r.post('/exhibits/filing-package/download', asyncHandler(async (req, res) => {
  const exhibit  = req.body?.exhibit;
  const applicant = req.body?.applicant || {};
  const format   = String(req.query?.format || req.body?.format || 'html').toLowerCase();
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }
  await enrichExhibitForLmsFiling(exhibit);
  const pkg = buildFilingPackage(exhibit, applicant);
  const stem = pkg.filename_stem;
  const variants = {
    html: { mime: 'text/html; charset=utf-8',         body: pkg.html,        ext: 'html' },
    txt:  { mime: 'text/plain; charset=utf-8',         body: pkg.plain_text,  ext: 'txt'  },
    csv:  { mime: 'text/csv; charset=utf-8',           body: pkg.fields_csv,  ext: 'csv'  },
    json: { mime: 'application/json; charset=utf-8',   body: pkg.json,        ext: 'json' }
  };
  const v = variants[format] || variants.html;
  res.setHeader('Content-Type', v.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${stem}.${v.ext}"`);
  res.send(v.body);
}));

// Lightweight summary endpoint (no body content, just counts).  Used
// by the FilingPackagePanel to render the readiness header without
// pulling 30KB of HTML on every state change.
r.post('/exhibits/filing-package/summary', asyncHandler(async (req, res) => {
  const exhibit  = req.body?.exhibit;
  const applicant = req.body?.applicant || {};
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }
  await enrichExhibitForLmsFiling(exhibit);
  const m = mapForm301Fm(exhibit, applicant);
  res.json({
    form:           m.form,
    summary:        m.summary,
    filing_ready:   m.filing_ready,
    blockers_count: m.blockers_count,
    compliance_pass: m.compliance_pass,
    fields:         m.fields.map(({ derive, ...rest }) => rest)   // strip non-serializable derive fn
  });
}));

export default r;
