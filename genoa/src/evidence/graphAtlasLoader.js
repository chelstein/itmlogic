// Graph Atlas loader — fetches global_graph.json once, caches for process lifetime.
//
// Environment:
//   GRAPH_ATLAS_URL         — HTTP(S) URL or file path to global_graph.json
//                             Default: http://159.223.153.153:8969/reference/global_graph.json
//   GRAPH_ATLAS_REPORT_URL  — HTTP(S) URL or file path to GRAPH_REPORT.md (informational only)
//
// Supported graph JSON shapes (auto-detected):
//   { nodes: [...], edges: [...] }
//   { graph: { nodes: [...], edges: [...] } }
//   { elements: { nodes: [...], edges: [...] } }   (Cytoscape export)
//   Adjacency map: { "nodeId": ["dep1", "dep2"], ... }
//
// Node schema (normalized internally):
//   { id, label, type?, file?, line?, meta? }
//
// Edge schema (normalized internally):
//   { source, target, label?, type? }
//
// Exported query API:
//   graphQuery(term)      — fuzzy-match nodes by id/label
//   graphExplain(nodeId)  — in-edges + out-edges for a node
//   graphAffected(nodeId) — transitive downstream nodes (BFS from source)
//   graphAtlasStats()     — { loaded, node_count, edge_count, source }
//   loadGraphAtlas()      — explicit trigger; no-op if already loading/loaded

import fs   from 'node:fs';
import crypto from 'node:crypto';

export const DEFAULT_GRAPH_URL =
  process.env.GRAPH_ATLAS_URL
  || 'http://159.223.153.153:8969/reference/global_graph.json';

export const DEFAULT_REPORT_URL =
  process.env.GRAPH_ATLAS_REPORT_URL
  || 'http://159.223.153.153:8969/reference/GRAPH_REPORT.md';

const FETCH_TIMEOUT_MS = 20_000;

// ── Module-level singleton ────────────────────────────────────────────────────

let _graph   = null;   // { nodes: Map<id, node>, edges: Edge[], sha256, source }
let _loading = null;   // in-flight Promise

// ── URL detection (mirrors countyBoundaryLoader pattern) ──────────────────────

export function isUrl(s){
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

// ── Raw fetch / file read ─────────────────────────────────────────────────────

async function _fetchRaw(source){
  if (isUrl(source)){
    const ac    = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(source, { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${source}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }
  // File path
  return fs.readFileSync(source, 'utf8');
}

// ── Graph normalizer — handles multiple common JSON shapes ────────────────────

function _normalize(parsed){
  let rawNodes = [];
  let rawEdges = [];

  if (Array.isArray(parsed?.nodes) && Array.isArray(parsed?.edges)){
    rawNodes = parsed.nodes;
    rawEdges = parsed.edges;
  } else if (Array.isArray(parsed?.graph?.nodes)){
    rawNodes = parsed.graph.nodes;
    rawEdges = parsed.graph.edges || [];
  } else if (Array.isArray(parsed?.elements?.nodes)){
    // Cytoscape.js export: { elements: { nodes: [{data:{id,...}}, ...], edges: [...] } }
    rawNodes = parsed.elements.nodes.map(n => n.data || n);
    rawEdges = parsed.elements.edges.map(e => ({
      source: (e.data || e).source,
      target: (e.data || e).target,
      label:  (e.data || e).label
    }));
  } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)){
    // Adjacency map: { "nodeId": ["dep1", "dep2"], ... }
    for (const [id, deps] of Object.entries(parsed)){
      rawNodes.push({ id });
      for (const dep of (Array.isArray(deps) ? deps : [])){
        rawEdges.push({ source: id, target: dep });
      }
    }
  }

  // Normalize node objects
  const nodes = new Map();
  for (const n of rawNodes){
    const id = String(n.id ?? n.name ?? n.label ?? '');
    if (!id) continue;
    nodes.set(id, {
      id,
      label: n.label ?? n.name ?? id,
      type:  n.type  ?? n.group ?? null,
      file:  n.file  ?? n.path  ?? null,
      line:  n.line  ?? null,
      meta:  n
    });
  }

  // Normalize edge objects; auto-register unknown endpoint nodes
  const edges = [];
  for (const e of rawEdges){
    const source = String(e.source ?? e.from ?? e.src ?? '');
    const target = String(e.target ?? e.to   ?? e.dst ?? '');
    if (!source || !target) continue;
    if (!nodes.has(source)) nodes.set(source, { id: source, label: source, type: null, file: null, line: null, meta: {} });
    if (!nodes.has(target)) nodes.set(target, { id: target, label: target, type: null, file: null, line: null, meta: {} });
    edges.push({ source, target, label: e.label ?? e.type ?? null, type: e.type ?? null });
  }

  return { nodes, edges };
}

// ── Core load ─────────────────────────────────────────────────────────────────

async function _load(source){
  let raw;
  try {
    raw = await _fetchRaw(source);
  } catch (e){
    return {
      ok:           false,
      error:        'GRAPH_ATLAS_UNAVAILABLE',
      detail:       `Failed to fetch graph atlas from ${source}: ${e.message}`,
      source
    };
  }

  const sha256 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e){
    return {
      ok:     false,
      error:  'GRAPH_ATLAS_PARSE_ERROR',
      detail: `JSON parse failed: ${e.message}`,
      source,
      sha256
    };
  }

  const { nodes, edges } = _normalize(parsed);

  return {
    ok:         true,
    source,
    sha256,
    nodes,      // Map<id, node>
    edges,      // Edge[]
    node_count: nodes.size,
    edge_count: edges.length,
    loaded_at:  new Date().toISOString()
  };
}

// ── Public: explicit load trigger ────────────────────────────────────────────

export async function loadGraphAtlas(pathOrUrl){
  if (_graph)   return _graph;
  if (_loading) return _loading;

  const source = pathOrUrl || DEFAULT_GRAPH_URL;
  _loading = _load(source).then(g => {
    _graph   = g;
    _loading = null;
    if (g.ok){
      console.log(`[graph-atlas] loaded ${g.node_count} nodes, ${g.edge_count} edges from ${g.source}`);
    } else {
      console.warn(`[graph-atlas] ${g.error}: ${g.detail}`);
    }
    return g;
  });
  return _loading;
}

// Warm the cache at module import time (non-blocking).
loadGraphAtlas().catch(() => {});

// ── Public: stats / health ────────────────────────────────────────────────────

export function graphAtlasStats(){
  if (!_graph) return { loaded: false };
  if (!_graph.ok) return { loaded: false, error: _graph.error, detail: _graph.detail };
  return {
    loaded:     true,
    source:     _graph.source,
    sha256:     _graph.sha256,
    node_count: _graph.node_count,
    edge_count: _graph.edge_count,
    loaded_at:  _graph.loaded_at
  };
}

// ── Public: query API ─────────────────────────────────────────────────────────

// Fuzzy-match nodes by id or label (case-insensitive substring).
export async function graphQuery(term){
  const g = await loadGraphAtlas();
  if (!g.ok) return { ok: false, error: g.error, results: [] };

  const q = String(term || '').toLowerCase();
  const results = [];
  for (const node of g.nodes.values()){
    if (node.id.toLowerCase().includes(q) || node.label.toLowerCase().includes(q)){
      results.push({
        id:    node.id,
        label: node.label,
        type:  node.type,
        file:  node.file,
        line:  node.line,
        in_degree:  g.edges.filter(e => e.target === node.id).length,
        out_degree: g.edges.filter(e => e.source === node.id).length
      });
    }
  }
  results.sort((a, b) => {
    // Exact id matches first, then label matches, then alphabetical.
    const aExact = a.id.toLowerCase() === q ? 0 : (a.label.toLowerCase() === q ? 1 : 2);
    const bExact = b.id.toLowerCase() === q ? 0 : (b.label.toLowerCase() === q ? 1 : 2);
    return aExact - bExact || a.id.localeCompare(b.id);
  });
  return { ok: true, term, results };
}

// Explain a node: return its immediate predecessors and successors.
export async function graphExplain(nodeId){
  const g = await loadGraphAtlas();
  if (!g.ok) return { ok: false, error: g.error, node: null };

  const node = g.nodes.get(nodeId);
  if (!node){
    // Try case-insensitive fallback.
    const lower = nodeId.toLowerCase();
    const match = [...g.nodes.values()].find(n => n.id.toLowerCase() === lower || n.label.toLowerCase() === lower);
    if (!match) return { ok: false, error: 'NODE_NOT_FOUND', node: nodeId };
    return graphExplain(match.id);
  }

  const in_edges = g.edges
    .filter(e => e.target === nodeId)
    .map(e => ({ from: e.source, label: e.label, node: g.nodes.get(e.source) }));

  const out_edges = g.edges
    .filter(e => e.source === nodeId)
    .map(e => ({ to: e.target, label: e.label, node: g.nodes.get(e.target) }));

  return {
    ok:        true,
    node:      { id: node.id, label: node.label, type: node.type, file: node.file, line: node.line },
    in_edges,
    out_edges
  };
}

// Transitive downstream: all nodes reachable from nodeId following directed edges.
export async function graphAffected(nodeId){
  const g = await loadGraphAtlas();
  if (!g.ok) return { ok: false, error: g.error, node: nodeId, affected: [] };

  // Case-insensitive resolution.
  let resolvedId = nodeId;
  if (!g.nodes.has(nodeId)){
    const lower = nodeId.toLowerCase();
    const match = [...g.nodes.values()].find(n => n.id.toLowerCase() === lower || n.label.toLowerCase() === lower);
    if (!match) return { ok: false, error: 'NODE_NOT_FOUND', node: nodeId, affected: [] };
    resolvedId = match.id;
  }

  // BFS over out-edges.
  const visited = new Set([resolvedId]);
  const queue   = [resolvedId];
  const affected = [];

  while (queue.length > 0){
    const current = queue.shift();
    for (const e of g.edges){
      if (e.source === current && !visited.has(e.target)){
        visited.add(e.target);
        queue.push(e.target);
        const n = g.nodes.get(e.target);
        affected.push({ id: e.target, label: n?.label ?? e.target, type: n?.type ?? null, file: n?.file ?? null, via: current });
      }
    }
  }

  return { ok: true, node: resolvedId, affected };
}

// For tests.
export function _resetGraphCache(){
  _graph   = null;
  _loading = null;
}
