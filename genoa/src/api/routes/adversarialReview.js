// Adversarial Review API — POST /api/exhibits/adversarial-review
//
// Returns a structured challenge report: what FCC reviewers, attorneys, and
// opposing engineers will ask; what evidence is missing; and what the engineer
// must fix before filing.
//
// Body: { exhibit, applicant? }
// Returns: {
//   schema, generated_at, station, adversarial_review: {
//     overall_risk,
//     challenge_points[],
//     defensibility_gaps[],
//     evidence_gaps[],
//     questions_reviewer_may_ask[],
//     recommended_engineer_actions[]
//   }
// }

import express from 'express';
import { asyncHandler }           from '../middleware/errors.js';
import { enrichTowerEvidence }    from '../services/enrichTowerEvidence.js';
import { buildAdversarialReview } from '../../review/adversarialReview.js';

const r = express.Router();

r.post('/exhibits/adversarial-review', asyncHandler(async (req, res) => {
  const exhibit   = req.body?.exhibit;
  const applicant = req.body?.applicant || {};

  if (!exhibit || typeof exhibit !== 'object') {
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }

  await enrichTowerEvidence(exhibit, console);

  const adversarial_review = buildAdversarialReview(exhibit);
  const generated_at = new Date().toISOString();

  return res.json({
    schema:            'genoa.adversarial_review.v1',
    generated_at,
    station:           adversarial_review.station,
    adversarial_review
  });
}));

export default r;
