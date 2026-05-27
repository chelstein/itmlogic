// Vector-tile reverse proxy — /tiles/* → pg_tileserv (droplet).
//
// The browser fetches tiles same-origin over HTTPS (https://host/tiles/…)
// so there's no mixed-content block and the tile server is never exposed
// to clients directly.  Read-only (GET); forwards path + query verbatim
// and streams the upstream body (binary .pbf or .json metadata) back with
// its content-type.
//
//   PG_TILESERV_URL     upstream base (default: the current droplet)
//   PG_TILESERV_SECRET  optional shared secret sent as x-tiles-secret,
//                       for when the droplet firewalls :7800 to require it
//                       (no-op while unset).
//
// Mounted PUBLIC (before the /api auth gate): pg_tileserv is already a
// public endpoint, so gating adds no security but would risk breaking
// tile loads.  Move under requireAuth later if tiles should be gated.

import express from 'express';

const router   = express.Router();
const UPSTREAM  = String(process.env.PG_TILESERV_URL || 'http://165.245.171.116:7800').replace(/\/+$/, '');
const SECRET    = process.env.PG_TILESERV_SECRET || '';

router.get('/*', async (req, res) => {
  // req.url is relative to the /tiles mount, e.g. /geo.stations/6/10/25.pbf
  const target = UPSTREAM + req.url;
  try {
    const upstream = await fetch(target, SECRET ? { headers: { 'x-tiles-secret': SECRET } } : undefined);
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.set('cache-control', upstream.headers.get('cache-control') || 'public, max-age=300');
    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'tile upstream unreachable', upstream: UPSTREAM, detail: String(err?.message || err) });
  }
});

export default router;
