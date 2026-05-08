// Genoa map-sidecar client.
//
// Fetches a printable contour-map PNG from the headless-Chromium map
// sidecar (genoa/src/sidecars/map/) and returns it as a Buffer.  The
// engineering-statement PDF embeds the result as a numbered exhibit
// page; the LMS filing-package contour-map deliverable references the
// same render.
//
// Fail-soft: when MAP_SIDECAR_URL is unset, or the sidecar returns an
// error, this resolves to `null` instead of throwing.  The PDF render
// pipeline then skips the contour-map section gracefully — never
// crashes the export over a sidecar outage.

const DEFAULT_TIMEOUT_MS = 25000;

export async function fetchMapRender(exhibit, options = {}){
  const url = process.env.MAP_SIDECAR_URL;
  if (!url) return null;
  if (!exhibit || typeof exhibit !== 'object') return null;
  // Sidecar requires station_inputs.{lat,lon}; if missing the render
  // will be a "coordinates missing" placeholder, which is still useful
  // as a sanity check, so we send it anyway and let the sidecar decide.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/render`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ exhibit, options }),
      signal:  controller.signal
    });
    if (!r.ok){
      const detail = await r.text().catch(() => '');
      console.warn(`[mapClient] sidecar render failed: HTTP ${r.status}${detail ? ' — ' + detail.slice(0, 200) : ''}`);
      return null;
    }
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } catch (err){
    console.warn('[mapClient] sidecar unreachable:', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Synchronous helper used by section builders that already have the
// rendered image stuffed into options.contour_map_png (Buffer or
// base64 string).  Returns either a Buffer or null.
export function coerceMapBuffer(input){
  if (!input) return null;
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === 'string'){
    // Strip data: URI prefix if present.
    const stripped = input.startsWith('data:') ? input.split(',')[1] : input;
    try { return Buffer.from(stripped, 'base64'); }
    catch { return null; }
  }
  return null;
}
