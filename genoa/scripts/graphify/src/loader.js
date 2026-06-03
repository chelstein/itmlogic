// Standalone graph loader — no imports from src/
// Supports same 4-shape detection as graphAtlasLoader.js
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './report.js';

const FETCH_TIMEOUT_MS = 20_000;

export function isUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

async function fetchRaw(source) {
  if (isUrl(source)) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(source, { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${source}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }
  return fs.readFileSync(source, 'utf8');
}

export function normalizeGraph(parsed) {
  let rawNodes = [];
  let rawEdges = [];

  if (Array.isArray(parsed?.nodes) && Array.isArray(parsed?.edges)) {
    rawNodes = parsed.nodes;
    rawEdges = parsed.edges;
  } else if (Array.isArray(parsed?.graph?.nodes)) {
    rawNodes = parsed.graph.nodes;
    rawEdges = parsed.graph.edges || [];
  } else if (Array.isArray(parsed?.elements?.nodes)) {
    // Cytoscape.js export
    rawNodes = parsed.elements.nodes.map(n => n.data || n);
    rawEdges = parsed.elements.edges.map(e => ({
      source: (e.data || e).source,
      target: (e.data || e).target,
      label: (e.data || e).label,
      type: (e.data || e).type,
    }));
  } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    // Adjacency map: { "nodeId": ["dep1", "dep2"], ... }
    for (const [id, deps] of Object.entries(parsed)) {
      rawNodes.push({ id });
      for (const dep of (Array.isArray(deps) ? deps : [])) {
        rawEdges.push({ source: id, target: dep });
      }
    }
  }

  const nodes = new Map();
  for (const n of rawNodes) {
    const id = String(n.id ?? n.name ?? n.label ?? '');
    if (!id) continue;
    nodes.set(id, {
      id,
      label: n.label ?? n.name ?? id,
      type: n.type ?? n.group ?? null,
      file: n.file ?? n.path ?? null,
      line: n.line ?? null,
      meta: n,
    });
  }

  const edges = [];
  for (const e of rawEdges) {
    const source = String(e.source ?? e.from ?? e.src ?? '');
    const target = String(e.target ?? e.to ?? e.dst ?? '');
    if (!source || !target) continue;
    if (!nodes.has(source)) nodes.set(source, { id: source, label: source, type: null, file: null, line: null, meta: {} });
    if (!nodes.has(target)) nodes.set(target, { id: target, label: target, type: null, file: null, line: null, meta: {} });
    edges.push({ source, target, label: e.label ?? null, type: e.type ?? null });
  }

  return { nodes, edges };
}

/**
 * Load graph from path, URL, or cache.
 * Priority: localPath arg → GRAPH_ATLAS_URL env → cacheFile → error
 * When fetched from URL, saves to cacheFile.
 */
export async function loadGraph({ graphPath, outDir } = {}) {
  const cacheFile = outDir ? path.join(outDir, 'global_graph_cache.json') : null;

  let source = null;
  let fromUrl = false;

  if (graphPath) {
    source = graphPath;
  } else if (process.env.GRAPH_ATLAS_URL) {
    source = process.env.GRAPH_ATLAS_URL;
    fromUrl = isUrl(source);
  } else if (cacheFile && fs.existsSync(cacheFile)) {
    source = cacheFile;
  } else {
    throw new Error(
      'No graph source found. Provide --graph <path>, set GRAPH_ATLAS_URL, or ensure ' +
      (cacheFile ? `${cacheFile} exists.` : 'a cache file is available.')
    );
  }

  let raw;
  try {
    raw = await fetchRaw(source);
  } catch (e) {
    throw new Error(`Failed to load graph from ${source}: ${e.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON parse failed for graph from ${source}: ${e.message}`);
  }

  // Cache if fetched from URL
  if (fromUrl && cacheFile) {
    try {
      ensureDir(path.dirname(cacheFile));
      fs.writeFileSync(cacheFile, raw, 'utf8');
    } catch (_) {
      // Non-fatal
    }
  }

  const { nodes, edges } = normalizeGraph(parsed);
  return { nodes, edges, source };
}
