// DO knowledge-base retrieval client (knowledge-base-05282026, ID 677cd4af).
//
// Queries the operator's DO Knowledge Base so advisory reasoning can be
// GROUNDED in source documents instead of paraphrase.  Mirrors fccKb.js
// exactly in structure and degradation behaviour.
//
// Credentials from env, never source:
//   DO_KB_URL         kbaas retrieve endpoint
//                     (already set: …/v1/677cd4af-5ad3-11f1-b074-4e013e2ddde4/retrieve)
//   DO_KB_TOKEN       DO API PAT for the kbaas endpoint.  The kbaas retrieve
//                     endpoint authorises with a DO account PAT (dop_v1_…),
//                     NOT a model-access key — those 403.  Try the same PAT
//                     used for FCC_KB_TOKEN first.
//
// OpenSearch-direct backend (VPC or public with trusted-source allowlist):
//   DO_KB_OS_HOST     genai-halibut-do-user-6795049-0.m.db.ondigitalocean.com
//   DO_KB_OS_PORT     25060 (default)
//   DO_KB_OS_USER     doadmin (default)
//   DO_KB_OS_PASS     cluster password (AVNS_…)
//
// Degrades to { available:false } when unconfigured so the advisory layer
// runs ungrounded (router-only) rather than failing.

import https from 'node:https';

const DEFAULT_TIMEOUT_MS = 20_000;

export function isEnabled(){
  return kbaasEnabled() || openSearchEnabled();
}
function kbaasEnabled(){
  return !!(String(process.env.DO_KB_URL || '').trim() && String(process.env.DO_KB_TOKEN || '').trim());
}
function openSearchEnabled(){
  return !!(String(process.env.DO_KB_OS_HOST || '').trim() && String(process.env.DO_KB_OS_PASS || '').trim());
}

// ---- OpenSearch-direct backend ------------------------------------------
// The DO Knowledge Base stores its chunks + embeddings in the managed
// OpenSearch cluster (genai-halibut).  When a kb-scoped token for the
// kbaas endpoint isn't available, fall back to BM25 text search directly
// against the OpenSearch cluster (no embedding model needed).  Works from
// inside the DO VPC or any trusted-source IP.

export function pickKbIndex(indexNames, kbIdFragment){
  const names = (indexNames || []).filter(n => n && !String(n).startsWith('.'));
  if (!names.length) return null;
  if (kbIdFragment){
    const byId = names.find(n => n.includes(kbIdFragment));
    if (byId) return byId;
  }
  return names.find(n => /kb|knowledge|chunk|doc|embed/i.test(n)) || names[0];
}

export function hitsToChunks(searchJson, indexName){
  const hits = searchJson?.hits?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.map(h => {
    const s = h?._source || {};
    const text = s.content || s.text || s.chunk || s.body || s.passage || s.page_content || '';
    return { text: String(text || '').trim(), score: h?._score ?? null, source: indexName || null };
  }).filter(c => c.text);
}

function osRequest(method, path, body, timeoutMs){
  return new Promise((resolve, reject) => {
    const host = String(process.env.DO_KB_OS_HOST || '').trim();
    const port = Number(process.env.DO_KB_OS_PORT) || 25060;
    const user = String(process.env.DO_KB_OS_USER || 'doadmin').trim();
    const pass = String(process.env.DO_KB_OS_PASS || '').trim();
    const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host, port, path, method,
      headers: { Authorization: auth, 'Content-Type': 'application/json',
                 ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      rejectUnauthorized: false,
      timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
    }, res => {
      let buf = '';
      res.on('data', d => { buf += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }); }
        catch { resolve({ status: res.statusCode, json: null, raw: buf }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('opensearch timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function retrieveViaOpenSearch(query, { k = 4, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  try {
    const cat = await osRequest('GET', '/_cat/indices?format=json&h=index', null, timeoutMs);
    const names = Array.isArray(cat.json) ? cat.json.map(r => r.index) : [];
    const index = pickKbIndex(names, '677cd4af');
    if (!index) return { available: false, reason: 'no KB index found', chunks: [] };
    const res = await osRequest('POST', `/${encodeURIComponent(index)}/_search`, {
      size: k,
      query: { simple_query_string: { query: String(query), fields: ['*'], default_operator: 'or' } }
    }, timeoutMs);
    const chunks = hitsToChunks(res.json, index);
    return { available: chunks.length > 0, chunks, index, backend: 'opensearch' };
  } catch (e){
    return { available: false, reason: String(e?.message || e), chunks: [] };
  }
}

export async function retrieve(query, { k = 4, alpha = 0.75, filters = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  if (!query) return { available: false, reason: 'no query', chunks: [] };
  const url   = String(process.env.DO_KB_URL   || '').trim();
  const token = String(process.env.DO_KB_TOKEN || '').trim();
  if (!(url && token)){
    if (openSearchEnabled()) return retrieveViaOpenSearch(query, { k, timeoutMs });
    return { available: false, reason: 'no KB backend configured (need DO_KB_URL+DO_KB_TOKEN or DO_KB_OS_*)', chunks: [] };
  }
  const fetchFn = (typeof fetch === 'function') ? fetch : null;
  if (!fetchFn) return { available: false, reason: 'fetch unavailable', chunks: [] };

  const payload = { query: String(query), num_results: k, alpha };
  if (filters) payload.filters = filters;

  try {
    const r = await fetchFn(url, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok){
      const body = await r.text().catch(() => '');
      return { available: false, reason: `HTTP ${r.status}`, detail: body.slice(0, 160), chunks: [] };
    }
    const j = await r.json();
    const raw = j?.results || j?.data || j?.retrieved_chunks || j?.chunks || [];
    const chunks = (Array.isArray(raw) ? raw : []).map(c => ({
      text:   c?.text_content || c?.text || c?.content || c?.chunk || c?.page_content
                || c?.document_chunk || (typeof c === 'string' ? c : ''),
      score:  c?.score ?? c?.relevance ?? c?.distance ?? null,
      source: c?.source || c?.document || c?.metadata?.source
                || c?.metadata?.item_name || c?.index_name || null
    })).filter(c => c.text);
    return { available: chunks.length > 0, chunks };
  } catch (e){
    return { available: false, reason: String(e?.message || e), chunks: [] };
  }
}
