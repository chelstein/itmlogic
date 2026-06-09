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
//
// Why we buffer range responses instead of streaming:
//   Node fetch() transparently decompresses bodies with Content-Encoding:
//   gzip/br.  If the storage backend attaches Content-Encoding to binary
//   objects (some S3-compatible backends do), the forwarded Content-Length
//   reflects the compressed size while the body bytes are decompressed —
//   protomaps rejects this as "content-length exceeding request".
//   Buffering the ArrayBuffer lets us recompute the true byte length and
//   set an accurate Content-Length, which PMTiles requires for range reads.
//   PMTiles range slices are 4 KB – 256 KB, so buffering is safe.

import express from 'express';

const router = express.Router();
const BASEMAP_URL = process.env.BASEMAP_URL || '';
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.BASEMAP_TIMEOUT_MS || '20000', 10);

router.get('/*', async (req, res) => {
  if (!BASEMAP_URL){
    return res.status(503).json({
      error: 'BASEMAP_URL not configured',
      hint:  'set BASEMAP_URL to the Spaces URL of the basemap .pmtiles file'
    });
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  res.on('close', () => clearTimeout(timer));
  try {
    const range    = req.headers.range;
    const upstream = await fetch(BASEMAP_URL, {
      headers: range ? { Range: range } : undefined,
      signal:  ac.signal
    });
    clearTimeout(timer);

    // Buffer the body so we can compute the true byte length.
    // This avoids content-length mismatches when the upstream uses
    // Content-Encoding (fetch decompresses transparently; the original
    // Content-Length would then be wrong for the protomaps client).
    const body = await upstream.arrayBuffer();
    const buf  = Buffer.from(body);

    res.status(upstream.status);
    // Forward metadata headers but NOT content-length — we set it below
    // from the actual buffer size so it is always accurate.
    for (const h of ['content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified']){
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('content-length', buf.byteLength);
    res.setHeader('cache-control', upstream.headers.get('cache-control') || 'public, max-age=86400');
    res.send(buf);
  } catch (err) {
    clearTimeout(timer);
    if (!res.headersSent){
      const aborted = err?.name === 'AbortError';
      res.status(aborted ? 504 : 502).json({
        error:  aborted ? 'basemap upstream timeout' : 'basemap upstream unreachable',
        detail: String(err?.message || err)
      });
    }
  }
});

export default router;

