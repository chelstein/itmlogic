import express from 'express';
import { dbHealthy, poolReady } from '../../db/pool.js';
import { sidecarStatus } from '../services/sidecars.js';
import { probeAllSources } from '../services/sourcesHealth.js';

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

// Per-source fallback-chain health — probes every primary, secondary,
// and tertiary upstream the orchestrator can reach.  Use this to
// answer "if ZTR went down right now, would the next exhibit still
// produce sourced HAAT, FCC contour, population, and nearby primaries?"
// Returns 503 only if at least one critical query has zero reachable
// sources (i.e., a tier-collapse).  Other partial failures are 200 with
// per-tier reachability details so the operator can pick a fallback.
r.get('/api/sources/health', async (_req, res) => {
  const status = await probeAllSources();
  res.status(status.all_critical_have_a_reachable_source ? 200 : 503).json(status);
});

export default r;
