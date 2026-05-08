// Genoa map sidecar — headless Chromium contour-map renderer.
//
//   POST /render
//     body: { exhibit, options? }
//     resp: image/png  (1500×1000 default, configurable via env)
//
//   GET /health
//     resp: { ok, browser_pid, render_count, uptime_s }
//
//   GET /render-template
//     resp: text/html (the Leaflet page).  Used internally by the
//           render handler via page.goto so the page can fetch
//           /static/* via relative URLs.
//
//   GET /static/states-10m.json     (us-atlas WGS84 TopoJSON)
//   GET /static/counties-10m.json   (us-atlas WGS84 TopoJSON)
//   GET /static/topojson-client.min.js
//     Cartographic data + library bundled at npm-install time.
//
// The Chromium browser is kept warm across requests (start cost ~1 s,
// per-render cost ~400 ms with everything cached).  A fresh page is
// opened per request and closed when the screenshot lands.
//
// Architecture note: switched from page.setContent to page.goto in
// v0.2.  setContent() leaves the page URL at about:blank, which means
// relative-URL fetches from inside render.html fail.  Serving the
// template + cartographic data over Express and using goto means the
// Leaflet page can fetch /static/states-10m.json directly — no inline
// 115 KB JSON literals, no setting baseURL, just normal HTTP.

import express from 'express';
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT          = parseInt(process.env.SIDECAR_PORT || '8086', 10);
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const WIDTH         = parseInt(process.env.RENDER_WIDTH_PX  || '1500', 10);
const HEIGHT        = parseInt(process.env.RENDER_HEIGHT_PX || '1000', 10);
const TIMEOUT_MS    = parseInt(process.env.RENDER_TIMEOUT_MS || '20000', 10);

let browser = null;
let renderCount = 0;
const startedAt = Date.now();

async function getBrowser(){
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: 'new',
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });
  browser.on('disconnected', () => { browser = null; });
  return browser;
}

const app = express();
app.use(express.json({ limit: '32mb' }));

// ─── Static resources used by render.html ──────────────────────────
//
// us-atlas + topojson-client come from npm; we serve them straight out
// of node_modules so there's no copy-on-build step to keep in sync.
// Cache-Control: 1 hour (these are immutable during a deploy).
const ONE_HOUR = 'public, max-age=3600';
app.get('/static/states-10m.json', (_req, res) => {
  res.set('Cache-Control', ONE_HOUR);
  res.sendFile(path.join(__dirname, 'node_modules', 'us-atlas', 'states-10m.json'));
});
app.get('/static/counties-10m.json', (_req, res) => {
  res.set('Cache-Control', ONE_HOUR);
  res.sendFile(path.join(__dirname, 'node_modules', 'us-atlas', 'counties-10m.json'));
});
app.get('/static/topojson-client.min.js', (_req, res) => {
  res.set('Cache-Control', ONE_HOUR);
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(path.join(__dirname, 'node_modules', 'topojson-client', 'dist', 'topojson-client.min.js'));
});

app.get('/render-template', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'render.html'));
});

app.get('/health', (_req, res) => {
  res.json({
    ok:           browser?.connected !== false,
    browser_pid:  browser?.process?.()?.pid ?? null,
    render_count: renderCount,
    uptime_s:     Math.round((Date.now() - startedAt) / 1000)
  });
});

app.post('/render', async (req, res) => {
  const exhibit = req.body?.exhibit;
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }
  const options = req.body?.options || {};
  const t0 = Date.now();
  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

    // Inject exhibit + options BEFORE the page navigates so render.html
    // can read them at module-init time.  evaluateOnNewDocument applies
    // to every navigation in this page (we only do one).
    await page.evaluateOnNewDocument((data, opts) => {
      window.__EXHIBIT__ = data;
      window.__RENDER_OPTIONS__ = opts;
    }, exhibit, options);

    // Navigate to the template via the same Express server we're
    // running.  Using goto (not setContent) means relative URLs inside
    // render.html resolve to http://localhost:PORT/static/* — that's
    // how render.html fetches the bundled cartographic data.
    await page.goto(`http://localhost:${PORT}/render-template`, {
      waitUntil: 'domcontentloaded',
      timeout:   TIMEOUT_MS
    });

    // Wait for the template to signal it's done laying out.
    await page.evaluate((to) => new Promise((resolve, reject) => {
      if (window.__GENOA_MAP_READY__) return resolve();
      const t = setTimeout(() => reject(new Error('map-ready timeout')), to);
      window.addEventListener('genoa-map-ready', () => { clearTimeout(t); resolve(); }, { once: true });
    }), TIMEOUT_MS);

    // Puppeteer-core 22+ returns a Uint8Array, not a Buffer.  Express 4's
    // res.send() distinguishes Buffer (binary) from a generic typed-array
    // by Buffer.isBuffer(body); an unwrapped Uint8Array falls through to
    // the object-serializer path and gets JSON.stringified.  Wrap in
    // Buffer.from so Express writes the raw bytes.
    const png = await page.screenshot({ type: 'png', fullPage: false });
    const pngBuf = Buffer.isBuffer(png) ? png : Buffer.from(png);
    renderCount += 1;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(pngBuf.length));
    res.setHeader('X-Render-Ms', String(Date.now() - t0));
    res.end(pngBuf);
  } catch (err){
    console.error('[map-sidecar] render failed:', err && err.stack || err);
    if (!res.headersSent){
      res.status(500).json({ error: 'RENDER_FAILED', detail: err?.message || String(err) });
    }
  } finally {
    if (page){ try { await page.close(); } catch {} }
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[map-sidecar] listening on 0.0.0.0:${PORT}  chromium=${CHROMIUM_PATH}  ${WIDTH}x${HEIGHT}`);
});

const stop = (sig) => async () => {
  console.log(`[map-sidecar] received ${sig}, draining`);
  try { await browser?.close(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
};
process.on('SIGTERM', stop('SIGTERM'));
process.on('SIGINT',  stop('SIGINT'));
process.on('uncaughtException',  (e) => { console.error('[map-sidecar] uncaughtException:',  e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[map-sidecar] unhandledRejection:', e); process.exit(1); });
