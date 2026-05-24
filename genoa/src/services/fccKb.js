// FCC Part 73 knowledge-base retrieval client.
//
// Queries the operator's DO Knowledge Base (verbatim 47 CFR Part 73,
// including the §73.190 skywave formulas, §73.182 RSS/NIF rules, the
// §73.333 FM curves, etc.) so advisory reasoning can be GROUNDED in the
// actual rule text instead of paraphrase.
//
// Credentials from env, never source:
//   FCC_KB_URL    retrieve endpoint (…/v1/<kb-id>/retrieve)
//   FCC_KB_TOKEN  KB/agent-scoped bearer (NOTE: distinct from the router
//                 MODEL_ACCESS_KEY — that key is router-scoped and the
//                 retrieve endpoint 403s with it)
//
// Degrades to { available:false } when unset/unauthorized, so the
// advisory layer runs ungrounded (router-only) rather than failing.

const DEFAULT_TIMEOUT_MS = 20_000;

export function isEnabled(){
  return !!(String(process.env.FCC_KB_URL || '').trim() && String(process.env.FCC_KB_TOKEN || '').trim());
}

// Retrieve top-k chunks for a query.  Tolerant of the response-shape
// variations DO has shipped ({results|data|retrieved_chunks|chunks}).
export async function retrieve(query, { k = 4, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  const url   = String(process.env.FCC_KB_URL || '').trim();
  const token = String(process.env.FCC_KB_TOKEN || '').trim();
  if (!url || !token) return { available: false, reason: 'FCC_KB_URL/FCC_KB_TOKEN unset', chunks: [] };
  if (!query)         return { available: false, reason: 'no query', chunks: [] };
  const fetchFn = (typeof fetch === 'function') ? fetch : null;
  if (!fetchFn) return { available: false, reason: 'fetch unavailable', chunks: [] };

  try {
    const r = await fetchFn(url, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: String(query), k }),
      signal:  AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok){
      const body = await r.text().catch(() => '');
      return { available: false, reason: `HTTP ${r.status}`, detail: body.slice(0, 160), chunks: [] };
    }
    const j = await r.json();
    const raw = j?.results || j?.data || j?.retrieved_chunks || j?.chunks || [];
    const chunks = (Array.isArray(raw) ? raw : []).map(c => ({
      text:   c?.text || c?.content || c?.chunk || (typeof c === 'string' ? c : ''),
      score:  c?.score ?? c?.relevance ?? null,
      source: c?.source || c?.document || c?.metadata?.source || null
    })).filter(c => c.text);
    return { available: chunks.length > 0, chunks };
  } catch (e){
    return { available: false, reason: String(e?.message || e), chunks: [] };
  }
}
