// GET /api/atlas/search?q=<term>
// GET /api/atlas/explain?node=<nodeId>
// GET /api/atlas/affected?node=<nodeId>
// GET /api/atlas/stats

import express from 'express';
import { asyncHandler } from '../middleware/errors.js';
import { graphQuery, graphExplain, graphAffected, graphAtlasStats } from '../../evidence/graphAtlasLoader.js';

const r = express.Router();

r.get('/atlas/stats', asyncHandler(async (_req, res) => {
  res.json(graphAtlasStats());
}));

r.get('/atlas/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q parameter required' });
  res.json(await graphQuery(q));
}));

r.get('/atlas/explain', asyncHandler(async (req, res) => {
  const node = String(req.query.node || '').trim();
  if (!node) return res.status(400).json({ error: 'node parameter required' });
  const result = await graphExplain(node);
  if (!result.ok && result.error === 'NODE_NOT_FOUND') return res.status(404).json(result);
  res.json(result);
}));

r.get('/atlas/affected', asyncHandler(async (req, res) => {
  const node = String(req.query.node || '').trim();
  if (!node) return res.status(400).json({ error: 'node parameter required' });
  const result = await graphAffected(node);
  if (!result.ok && result.error === 'NODE_NOT_FOUND') return res.status(404).json(result);
  res.json(result);
}));

export default r;
