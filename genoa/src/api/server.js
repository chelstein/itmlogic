// Genoa API entry.  Hardened startup, fail-soft on every optional
// dependency.  Health binds synchronously; migrations / sidecar polling
// happen in the background after the server is already listening.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import healthRoutes    from './routes/health.js';
import curveRoutes     from './routes/curves.js';
import exhibitRoutes   from './routes/exhibits.js';
import facilityRoutes  from './routes/facilities.js';
import { errorHandler } from './middleware/errors.js';
import { migrate }   from '../db/migrate.js';
import { poolReady } from '../db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

process.on('uncaughtException',  (err) => { console.error('[genoa] uncaughtException:',  err && err.stack || err); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error('[genoa] unhandledRejection:', err && err.stack || err); process.exit(1); });

const PORT     = parseInt(process.env.PORT || '8080', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

// Health (mount before everything; keep it cheap).
app.use(healthRoutes);

// Static UI.  In production the React app is built to src/ui/dist/.
// During local dev (vite dev server on :5173) this directory may not
// exist yet; serve whichever path is present so the API still boots.
const distDir   = path.resolve(__dirname, '../ui/dist');
const publicDir = path.resolve(__dirname, '../ui/public');
const uiRoot    = (await import('node:fs')).existsSync(distDir) ? distDir : publicDir;
console.log(`[genoa-api] serving UI from ${path.relative(process.cwd(), uiRoot)}`);
app.use(express.static(uiRoot, {
  index: 'index.html',
  maxAge: NODE_ENV === 'production' ? '1h' : 0
}));

// API routes
app.use('/api', curveRoutes);
app.use('/api', facilityRoutes);
app.use('/api', exhibitRoutes);

// Last-resort error handler
app.use(errorHandler);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[genoa-api] listening on 0.0.0.0:${PORT} (${NODE_ENV}) node=${process.versions.node}`);
  console.log(`[genoa-api] db_configured=${poolReady()} terrain_sidecar=${!!process.env.TERRAIN_SIDECAR_URL} measurement_sidecar=${!!process.env.MEASUREMENT_SIDECAR_URL} identity_sidecar=${!!process.env.IDENTITY_SIDECAR_URL}`);
});
server.on('error', (err) => { console.error('[genoa-api] listen error:', err && err.stack || err); process.exit(1); });

(async () => {
  if (poolReady()){
    try { const r = await migrate(); console.log('[genoa-api] migrations applied:', r.applied); }
    catch (e){ console.warn('[genoa-api] migration skipped:', e.message); }
  } else {
    console.warn('[genoa-api] DATABASE_URL not set — running in stateless mode (compute / exports work; persistence routes return 503)');
  }
})();

const stop = (sig) => () => {
  console.log(`[genoa-api] received ${sig}, draining`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', stop('SIGTERM'));
process.on('SIGINT',  stop('SIGINT'));
