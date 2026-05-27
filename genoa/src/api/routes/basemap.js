// Self-hosted basemap proxy — /basemap → a PMTiles file on Spaces.
//
// PMTiles is a single-file tile archive read over HTTP *range* requests,
// so this forwards the Range header and passes back 206 / Content-Range.
// Serving it same-origin (https://host/basemap) means the basemap renders
// even when an ad-blocker / privacy extension blocks third-party CDNs —
// the failure mode we hit with the external CARTO basemap.
//
//   BASEMAP_URL  full URL of the .pmtiles object (e.g. a DO Spaces URL).
//
// The map style then references it as:
//   { "type": "vector", "url": "pmtiles://https://<host>/basemap" }
//
// Mounted PUBLIC (before the /api auth gate); returns 503 until configured.

import express from 'express';

const router = express.Router();
const BASEMAP_URL = process.env.BASEMAP_URL || '';

router.get('/*', async (req, res) => {
  if (!BASEMAP_URL){
    return res.status(503).json({
      error: 'BASEMAP_URL not configured',
      hint:  'set BASEMAP_URL to the Spaces URL of the basemap .pmtiles file'
    });
  }
  try {
    const range    = req.headers.range;
    const upstream = await fetch(BASEMAP_URL, range ? { headers: { Range: range } } : undefined);
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']){
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('cache-control', upstream.headers.get('cache-control') || 'public, max-age=86400');
    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'basemap upstream unreachable', detail: String(err?.message || err) });
  }
});

export default router;
