// POST /api/exhibits/certify         — stamp an exhibit with a PE seal
// POST /api/exhibits/verify-cert     — recompute the hash, confirm the seal
//
// Stateless: the route does not persist exhibits.  Caller posts the
// current exhibit + engineer payload and gets back the same exhibit
// with `pe_certification` attached.  Saving / exporting is the caller's
// responsibility.

import express from 'express';
import { buildCertification, verifyCertification, validateEngineer } from '../../engine/regulatory/peCertification.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.post('/exhibits/certify', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const exhibit = body.exhibit;
  const engineer = body.engineer;
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({
      error:  'BAD_REQUEST',
      detail: 'exhibit is required'
    });
  }
  let valid;
  try {
    valid = validateEngineer(engineer);
  } catch (err){
    return res.status(400).json({
      error:  'BAD_REQUEST',
      detail: String(err.message || err)
    });
  }

  const { pe_certification, exhibit_hash } = buildCertification(exhibit, valid);
  const sealed = { ...exhibit, pe_certification };
  res.json({
    exhibit:        sealed,
    exhibit_hash,
    pe_certification
  });
}));

r.post('/exhibits/verify-cert', asyncHandler(async (req, res) => {
  const exhibit = req.body?.exhibit;
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({
      error:  'BAD_REQUEST',
      detail: 'exhibit is required'
    });
  }
  const result = verifyCertification(exhibit);
  res.json(result);
}));

export default r;
