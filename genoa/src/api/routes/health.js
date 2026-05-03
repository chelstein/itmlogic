import express from 'express';
import { dbHealthy, poolReady } from '../../db/pool.js';
import { sidecarStatus } from '../services/sidecars.js';

const r = express.Router();

// Liveness — never blocks, never touches DB / sidecars.
r.get('/healthz', (_req, res) => res.type('text').send('ok'));
r.get('/health',  (_req, res) => res.type('text').send('ok'));

// Readiness — DB is required, sidecars are optional.
r.get('/readyz', async (_req, res) => {
  const db = await dbHealthy();
  const sc = await sidecarStatus();
  const ok = db || !poolReady();   // stateless mode is also "ready"
  res.status(ok ? 200 : 503).json({
    ok,
    db_configured: poolReady(),
    db_healthy:    db,
    sidecars:      sc
  });
});

export default r;
