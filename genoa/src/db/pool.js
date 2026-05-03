// Postgres pool, fail-soft.  If DATABASE_URL is missing the API still
// boots (engine + exports + readiness all work without persistence;
// only POST/GET /api/exhibits and the exhibit lookup routes return 503).

import pg from 'pg';

const PG_SSL        = (process.env.PG_SSL        || 'false').toLowerCase() === 'true';
const PG_SSL_REJECT = (process.env.PG_SSL_REJECT || 'false').toLowerCase() === 'true';

let _pool = null;
let _initErr = null;

if (process.env.DATABASE_URL){
  try {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:              PG_SSL ? { rejectUnauthorized: PG_SSL_REJECT } : false,
      max:              10,
      idleTimeoutMillis: 30_000
    });
    _pool.on('error', (err) => console.warn('[genoa] pg pool error:', err.message));
    console.log('[genoa] pg pool constructed');
  } catch (e){
    _initErr = e;
    console.warn('[genoa] pg pool construction failed:', e.message);
    _pool = null;
  }
}

export function pool(){ return _pool; }
export function poolReady(){ return !!_pool; }
export async function dbHealthy(){
  if (!_pool) return false;
  try { await _pool.query('SELECT 1'); return true; }
  catch { return false; }
}
export function poolInitError(){ return _initErr; }
