// Feature 1: Critical Surface Mode
import path from 'node:path';
import { buildDegreeMap, detectCommunities, computeCohesion } from './metrics.js';
import { writeReport, estimateTokens } from './report.js';

export const SURFACES = {
  readiness:    ['src/exports/readiness', 'exports/readiness'],
  trust:        ['trustRoutes', 'auditPackage', 'buildAttestation', 'readiness'],
  'pdf-export': ['src/exports/pdf', 'exports/pdf', 'pdfkit', 'pdfme'],
  api:          ['src/api/', 'routes/', 'middleware/', 'server.js'],
  'fcc-engine': ['src/engine/', 'src/evidence/', 'src/sidecars/'],
};

/**
 * Find nodes whose file or id contains any pattern.
 */
export function findSurfaceNodes(nodes, patterns) {
  const matches = new Set();
  for (const [id, node] of nodes.entries()) {
    for (const pattern of patterns) {
      if (id.includes(pattern) || (node.file && node.file.includes(pattern))) {
        matches.add(id);
        break;
      }
    }
  }
  return matches;
}

/**
 * Expand to include 1-hop neighbors (both directions).
 */
export function expandOnehop(seedIds, edges) {
  const expanded = new Set(seedIds);
  for (const e of edges) {
    if (seedIds.has(e.source)) expanded.add(e.target);
    if (seedIds.has(e.target)) expanded.add(e.source);
  }
  return expanded;
}

/**
 * Build subgraph from a set of node ids.
 */
export function buildSubgraph(nodeIds, nodes, edges) {
  const subNodes = new Map();
  for (const id of nodeIds) {
    if (nodes.has(id)) subNodes.set(id, nodes.get(id));
  }
  const subEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  return { nodes: subNodes, edges: subEdges };
}

/**
 * Compute and write surface report.
 * Returns { mdPath, jsonPath, subgraph, seedIds }
 */
export function runSurface(name, { nodes, edges }, outDir) {
  const patterns = SURFACES[name];
  if (!patterns) {
    throw new Error(`Unknown surface "${name}". Valid: ${Object.keys(SURFACES).join(', ')}`);
  }

  const seedIds = findSurfaceNodes(nodes, patterns);
  const expandedIds = expandOnehop(seedIds, edges);
  const sub = buildSubgraph(expandedIds, nodes, edges);

  const degreeMap = buildDegreeMap(sub.nodes, sub.edges);
  const communityOf = detectCommunities(sub.nodes, sub.edges);
  const cohesion = computeCohesion(communityOf, sub.edges, 5);

  const inferredCount = sub.edges.filter(e => e.type === 'inferred').length;

  // Build Markdown
  const lines = [
    `# Surface Report: ${name}`,
    '',
    `**Patterns**: ${patterns.map(p => `\`${p}\``).join(', ')}`,
    `**Seed nodes**: ${seedIds.size}`,
    `**Total nodes (with 1-hop)**: ${sub.nodes.size}`,
    `**Edges in subgraph**: ${sub.edges.length}`,
    `**Inferred edges**: ${inferredCount}`,
    '',
    '## Seed Nodes',
    '',
  ];

  for (const id of [...seedIds].sort()) {
    const node = nodes.get(id);
    const deg = degreeMap.get(id) || { in: 0, out: 0 };
    lines.push(`- \`${id}\` (in:${deg.in} out:${deg.out})${node?.file ? ` — \`${node.file}\`` : ''}`);
  }

  lines.push('', '## Expanded Neighbors', '');
  for (const id of [...expandedIds].sort()) {
    if (seedIds.has(id)) continue;
    const node = nodes.get(id);
    const deg = degreeMap.get(id) || { in: 0, out: 0 };
    lines.push(`- \`${id}\` (in:${deg.in} out:${deg.out})${node?.file ? ` — \`${node.file}\`` : ''}`);
  }

  lines.push('', '## Community Cohesion (top 5)', '');
  for (const [cId, val] of Object.entries(cohesion)) {
    lines.push(`- Community \`${cId}\`: ${(val * 100).toFixed(1)}%`);
  }

  const md = lines.join('\n');
  const json = JSON.stringify({
    surface: name,
    patterns,
    seed_count: seedIds.size,
    expanded_count: sub.nodes.size,
    edge_count: sub.edges.length,
    inferred_edge_count: inferredCount,
    seed_nodes: [...seedIds],
    expanded_nodes: [...expandedIds],
    edges: sub.edges,
    cohesion,
  }, null, 2);

  const mdPath = writeReport(outDir, `SURFACE_${name}.md`, md);
  const jsonPath = writeReport(outDir, `SURFACE_${name}.json`, json);

  return { mdPath, jsonPath, subgraph: sub, seedIds, expandedIds };
}
