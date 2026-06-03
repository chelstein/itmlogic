// Trust Routes — engineer-facing readiness review and audit quality scoring.
//
// POST /api/exhibits/engineer-review
//   body: { exhibit, applicant?, station?: { call, service, frequency } }
//   returns: { determination, score, sections, text }
//
// POST /api/exhibits/audit-score
//   body: { exhibit, applicant? }
//   returns: { score, categories, strengths, weaknesses, missing_items }

import express from 'express';
import { asyncHandler }              from '../middleware/errors.js';
import { enrichTowerEvidence }       from '../services/enrichTowerEvidence.js';
import { buildReadinessReport }      from '../../exports/readiness/index.js';
import { buildEngineerReviewSummary } from '../../exports/readiness/engineerReview.js';
import { buildLineageReport }        from '../../exports/lmsFiling/lineage.js';
import { buildFilingPackage }        from '../../exports/lmsFiling/packager.js';
import { buildEngineeringReasoning } from '../../exports/readiness/reasoning.js';
import { detectFieldConflicts }      from '../../exports/readiness/conflicts.js';
import { scoreAuditPackage }         from '../../exports/readiness/qualityScore.js';
import { buildReplayToken }          from '../../engine/buildAttestation.js';

function stampReplayToken(exhibit) {
  if (exhibit.replay_token) return;
  const { token } = buildReplayToken(exhibit, {
    inputs:   exhibit.station_inputs,
    evidence: exhibit.evidence,
  });
  exhibit.replay_token = token;
}

const r = express.Router();

// ── POST /api/exhibits/engineer-review ──────────────────────────────────────

r.post('/exhibits/engineer-review', asyncHandler(async (req, res) => {
  const exhibit   = req.body?.exhibit;
  const applicant = req.body?.applicant || {};
  const station   = req.body?.station   || {};

  if (!exhibit || typeof exhibit !== 'object') {
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }

  await enrichTowerEvidence(exhibit, console);
  stampReplayToken(exhibit);

  const readiness = buildReadinessReport(exhibit, applicant);
  const review    = buildEngineerReviewSummary(readiness, station);

  return res.json(review);
}));

// ── POST /api/exhibits/audit-score ──────────────────────────────────────────

r.post('/exhibits/audit-score', asyncHandler(async (req, res) => {
  const exhibit   = req.body?.exhibit;
  const applicant = req.body?.applicant || {};

  if (!exhibit || typeof exhibit !== 'object') {
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }

  await enrichTowerEvidence(exhibit, console);
  stampReplayToken(exhibit);

  const pkg        = buildFilingPackage(exhibit, applicant);
  const lineage    = buildLineageReport(exhibit, applicant);
  const readiness  = buildReadinessReport(exhibit, applicant);
  const reasoning  = buildEngineeringReasoning(exhibit);
  const conflicts  = detectFieldConflicts(exhibit);

  const provenance = {
    build_sha:        exhibit?.build_attestation?.sha || exhibit?.engine_signature?.hash || null,
    replay_token:     exhibit.replay_token || null,
    engine_signature: exhibit?.engine_signature?.hash || null,
    generated_at:     new Date().toISOString(),
  };

  const filingPackageParsed = JSON.parse(pkg.json);

  const result = scoreAuditPackage({
    schema:          'genoa.audit_package.v1',
    filing_package:  filingPackageParsed,
    lineage,
    readiness,
    reasoning,
    conflicts,
    provenance,
  });

  return res.json(result);
}));

export default r;
