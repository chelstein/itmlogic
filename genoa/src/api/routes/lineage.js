// Filing Field Lineage endpoint.
//
//   POST /api/exhibits/lineage
//     body: { exhibit, applicant?: { engineer?: {...} } }
//     returns: {
//       schema, generated_at, exhibit_metadata, form,
//       summary: { total, filled, suggested, needs_input, evidence_missing,
//                  invalid, conflict, not_applicable, blocking_gaps,
//                  advisory_count, filing_ready, gating_reason, compliance_pass },
//       fields: [ { id, lms_label, section, subsection, required, advisory,
//                   filing_critical, value, status, blocking,
//                   source_system, source_path, confidence, timestamp,
//                   validation_result, provenance, expected_source,
//                   conflict_values, invalid_reason, notes,
//                   engineer_confirmation_required }, ... ]
//     }
//
// Auth-gated by requireAuth (mounted in server.js before this route).
// Pure computation — no DB or network calls.

import express from 'express';
import { buildLineageReport } from '../../exports/lmsFiling/lineage.js';
import { asyncHandler } from '../middleware/errors.js';
import { enrichTowerEvidence } from '../services/enrichTowerEvidence.js';

const r = express.Router();

r.post('/exhibits/lineage', asyncHandler(async (req, res) => {
  const exhibit   = req.body?.exhibit;
  const applicant = req.body?.applicant || {};

  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }

  // Enrich tower evidence (ASR + FAA OE) the same way the filing-package
  // route does, so source_system / source_path reflect live tower data.
  await enrichTowerEvidence(exhibit, console);

  const report = buildLineageReport(exhibit, applicant);
  res.json(report);
}));

export default r;
