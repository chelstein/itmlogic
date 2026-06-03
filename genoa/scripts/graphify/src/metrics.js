// Base graph metrics: counts, degree map, community detection, cohesion

/**
 * Edge types by label. Structural edges are the authoritative dependency signal.
 */
export const STRUCTURAL_LABELS = new Set([
  'calls', 'imports', 'imports_from', 'references', 'implements', 'inherits',
]);

/**
 * Classify a single edge into one of four categories:
 *   structural   — calls / imports / imports_from / references / implements / inherits
 *   containment  — label='contains' or type='contains'
 *   inferred     — type='inferred'
 *   semantic     — everything else (uses, mounts, feeds, renders, …)
 *
 * Classification order: inferred beats structural/containment.
 */
export function classifyEdge(edge) {
  if (edge.type === 'inferred') return 'inferred';
  if (edge.label === 'contains' || edge.type === 'contains') return 'containment';
  if (STRUCTURAL_LABELS.has(edge.label)) return 'structural';
  return 'semantic';
}

/**
 * Build degree map: { nodeId: { in, out, total } }
 */
export function buildDegreeMap(nodes, edges) {
  const degreeMap = new Map();
  for (const id of nodes.keys()) {
    degreeMap.set(id, { in: 0, out: 0, total: 0 });
  }
  for (const e of edges) {
    if (degreeMap.has(e.source)) {
      const d = degreeMap.get(e.source);
      d.out++;
      d.total++;
    }
    if (degreeMap.has(e.target)) {
      const d = degreeMap.get(e.target);
      d.in++;
      d.total++;
    }
  }
  return degreeMap;
}

/**
 * BFS connected-components using ALL edges (undirected view).
 * Returns Map<nodeId, communityId> where communityId is the first node encountered in the component.
 */
export function detectCommunities(nodes, edges) {
  const adj = new Map();
  for (const id of nodes.keys()) {
    adj.set(id, new Set());
  }
  for (const e of edges) {
    if (adj.has(e.source)) adj.get(e.source).add(e.target);
    if (adj.has(e.target)) adj.get(e.target).add(e.source);
  }

  const communityOf = new Map();
  const visited = new Set();

  for (const startId of nodes.keys()) {
    if (visited.has(startId)) continue;
    const component = [];
    const queue = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const cur = queue.shift();
      component.push(cur);
      for (const neighbor of (adj.get(cur) || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    const communityId = component[0];
    for (const id of component) {
      communityOf.set(id, communityId);
    }
  }

  return communityOf;
}

/**
 * Compute community sizes from communityOf map.
 * Returns Map<communityId, size>
 */
export function communitySizes(communityOf) {
  const sizes = new Map();
  for (const cId of communityOf.values()) {
    sizes.set(cId, (sizes.get(cId) || 0) + 1);
  }
  return sizes;
}

/**
 * Cohesion = internal_structural_edges / (size * (size - 1) / 2) for top N communities.
 * Uses ONLY structural edges in the numerator — containment edges are excluded so
 * JSON-containment noise does not inflate cohesion scores.
 */
export function computeCohesion(communityOf, edges, topN = 5) {
  // Filter to structural edges only for the numerator
  const structuralEdges = edges.filter(e => classifyEdge(e) === 'structural');

  const sizes = communitySizes(communityOf);
  const top = [...sizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([cId]) => cId);

  const cohesion = {};
  for (const cId of top) {
    const size = sizes.get(cId);
    if (size < 2) {
      cohesion[cId] = 0;
      continue;
    }
    const maxEdges = (size * (size - 1)) / 2;
    let internal = 0;
    for (const e of structuralEdges) {
      if (communityOf.get(e.source) === cId && communityOf.get(e.target) === cId) {
        internal++;
      }
    }
    cohesion[cId] = maxEdges > 0 ? internal / maxEdges : 0;
  }
  return cohesion;
}

/**
 * Known generic JSON scalar key names that are metadata unless structurally referenced.
 */
export const JSON_SCALAR_NAMES = new Set([
  'id', 'version', 'method', 'value', 'type', 'key', 'data', 'name',
  'label', 'code', 'status', 'message', 'result', 'error', 'params',
  'options', 'config', 'source', 'target', 'path', 'url', 'host', 'port',
  'schema', 'field', 'A_factor', 'B_factor', 'D_Lf', 'mdvar', 'klim', 'q',
]);

/**
 * Count nodes that are exclusively connected via containment edges (or disconnected)
 * AND whose id/label matches a known JSON scalar field name.
 * These inflate isolated-node counts when they should be treated as metadata.
 */
export function countWeakJsonFieldNodes(nodes, edges, degreeMap) {
  // Collect nodes that appear in any non-containment edge
  const structurallyConnected = new Set();
  for (const e of edges) {
    if (classifyEdge(e) !== 'containment') {
      structurallyConnected.add(e.source);
      structurallyConnected.add(e.target);
    }
  }

  let count = 0;
  for (const [id, node] of nodes.entries()) {
    const deg = degreeMap.get(id);
    // Must be involved in at least one containment edge (not merely orphaned)
    if (!deg || deg.total === 0) continue;
    const isContainmentOnly = !structurallyConnected.has(id);
    if (!isContainmentOnly) continue;
    const nameToCheck = (node.label || id || '').trim();
    if (JSON_SCALAR_NAMES.has(nameToCheck)) {
      count++;
    }
  }
  return count;
}

/**
 * Compute all base metrics from a loaded graph.
 */
export function computeMetrics(nodes, edges) {
  const degreeMap = buildDegreeMap(nodes, edges);

  const edgesByType = { structural: 0, containment: 0, semantic: 0, inferred: 0 };
  for (const e of edges) {
    edgesByType[classifyEdge(e)]++;
  }

  const weakNodes = [...degreeMap.entries()]
    .filter(([, d]) => d.total <= 1)
    .map(([id]) => id);

  const communityOf = detectCommunities(nodes, edges);
  const sizes = communitySizes(communityOf);
  const communityCount = sizes.size;
  const cohesion = computeCohesion(communityOf, edges, 5);
  const weakJsonFieldNodeCount = countWeakJsonFieldNodes(nodes, edges, degreeMap);

  const structuralRatio = edges.length > 0
    ? edgesByType.structural / edges.length
    : 0;

  return {
    nodeCount: nodes.size,
    edgeCount: edges.length,
    structuralEdgeCount: edgesByType.structural,
    containmentEdgeCount: edgesByType.containment,
    semanticEdgeCount: edgesByType.semantic,
    inferredEdgeCount: edgesByType.inferred,
    structuralRatio,
    weakNodeCount: weakNodes.length,
    weakJsonFieldNodeCount,
    degreeMap,
    communityOf,
    communityCount,
    communityCount_top5_cohesion: cohesion,
  };
}
