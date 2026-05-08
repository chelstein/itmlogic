// Shared-password session-cookie auth.  HMAC-SHA256 over a JSON
// payload `{iat, exp}`; cookie format is `<b64url(payload)>.<b64url(sig)>`.
// No DB, no session store — the cookie itself is the session.  Verified
// constant-time; expired or tampered tokens return null from verifySession().
//
// Required env:
//   AUTH_PASSWORD_HASH            scrypt$<saltHex>$<hashHex>  (login.js owns the verify)
//   AUTH_SESSION_SECRET           hex string, ≥32 bytes recommended
//   AUTH_SESSION_MAX_AGE_SECONDS  default 2592000 (30 days)
//   AUTH_COOKIE_NAME              default 'genoa_session'

import crypto from 'node:crypto';

export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'genoa_session';
const MAX_AGE_S = parseInt(process.env.AUTH_SESSION_MAX_AGE_SECONDS || '2592000', 10);

function getSecret(){
  const s = process.env.AUTH_SESSION_SECRET;
  if (!s) return null;
  return Buffer.from(s, 'utf8');
}

function b64url(buf){
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s){
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

export function signSession(payload){
  const secret = getSecret();
  if (!secret) throw new Error('AUTH_SESSION_SECRET not set');
  const body = b64url(JSON.stringify(payload));
  const sig  = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token){
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const secret = getSecret();
  if (!secret) return null;
  const expectedSig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')); }
  catch { return null; }
  if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function parseCookies(header){
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')){
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function cookieAttrs(){
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure'
  ];
}

export function newSessionCookie(){
  const now = Math.floor(Date.now() / 1000);
  const token = signSession({ iat: now, exp: now + MAX_AGE_S });
  return [`${COOKIE_NAME}=${token}`, `Max-Age=${MAX_AGE_S}`, ...cookieAttrs()].join('; ');
}

export function clearSessionCookie(){
  return [`${COOKIE_NAME}=`, 'Max-Age=0', ...cookieAttrs()].join('; ');
}

export function requireAuth(req, res, next){
  if (!process.env.AUTH_PASSWORD_HASH || !process.env.AUTH_SESSION_SECRET){
    // Fail closed: with auth misconfigured, every request is denied
    // rather than silently allowing through.
    return res.status(503).json({
      error: 'AUTH_NOT_CONFIGURED',
      detail: 'Server is missing AUTH_PASSWORD_HASH or AUTH_SESSION_SECRET; auth gate cannot run.'
    });
  }
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[COOKIE_NAME]);
  if (!session){
    return res.status(401).json({ error: 'UNAUTHENTICATED', detail: 'Login required.' });
  }
  req.session = session;
  next();
}
