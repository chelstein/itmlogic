// Audit Package endpoint — assembles the complete audit artifact for a Genoa filing exhibit.
//
// POST /api/exhibits/audit-package
//   body: { exhibit, applicant?: { engineer?: {...} } }
//   returns: {
//     schema:           'genoa.audit_package.v1',
//     generated_at:     ISO-8601,
//     exhibit_metadata: { ... },
//     filing_package:   { ... },
//     lineage:          { ... },
//     readiness:        { ... },
//     reasoning:        { ... },
//     conflicts:        [...],
//     provenance: {
//       build_sha, replay_token, engine_signature, generated_at
//     }
//   }
//
// Everything a consulting engineer, FCC attorney, investor, or regulator
// needs to audit a Genoa exhibit in a single request.

import express from 'express';
import { asyncHandler }             from '../middleware/errors.js';
import { enrichTowerEvidence }      from '../services/enrichTowerEvidence.js';
import { buildFilingPackage }       from '../../exports/lmsFiling/packager.js';
import { buildLineageReport }       from '../../exports/lmsFiling/lineage.js';
import { buildReadinessReport }     from '../../exports/readiness/index.js';
import { buildEngineeringReasoning } from '../../exports/readiness/reasoning.js';
import { detectFieldConflicts }     from '../../exports/readiness/conflicts.js';

const r = express.Router();

r.post('/exhibits/audit-package', asyncHandler(async (req, res) => {
  const exhibit   = req.body?.exhibit;
  const applicant = req.body?.applicant || {};
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }
  await enrichTowerEvidence(exhibit, console);

  const pkg = buildFilingPackage(exhibit, applicant);

  // All computations are pure and synchronous after enrichment.
  const [lineage, readiness, reasoning, conflicts] = [
    buildLineageReport(exhibit, applicant),
    buildReadinessReport(exhibit, applicant),
    buildEngineeringReasoning(exhibit),
    detectFieldConflicts(exhibit)
  ];

  const provenance = {
    build_sha:        exhibit?.build_attestation?.sha || exhibit?.engine_signature?.hash || null,
    replay_token:     exhibit?.replay_token || null,
    engine_signature: exhibit?.engine_signature?.hash || null,
    generated_at:     new Date().toISOString()
  };

  res.json({
    schema:           'genoa.audit_package.v1',
    generated_at:     provenance.generated_at,
    exhibit_metadata: lineage.exhibit_metadata,
    filing_package:   JSON.parse(pkg.json),
    lineage,
    readiness,
    reasoning,
    conflicts,
    provenance
  });
}));

export default r;
