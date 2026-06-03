// Base graph metrics: counts, degree map, community detection, cohesion

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
 * BFS connected-components (undirected view of the graph).
 * Returns Map<nodeId, communityId> where communityId is the smallest node id in the component.
 */
export function detectCommunities(nodes, edges) {
  // Build adjacency list (undirected)
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
    // BFS
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
    // Community id = first node encountered (stable label)
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
 * Cohesion = internal_edges / (size * (size - 1) / 2) for top N communities by size.
 * Returns { communityId: cohesion } for top N.
 */
export function computeCohesion(communityOf, edges, topN = 5) {
  const sizes = communitySizes(communityOf);
  // Sort by size desc, take top N
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
    for (const e of edges) {
      if (communityOf.get(e.source) === cId && communityOf.get(e.target) === cId) {
        internal++;
      }
    }
    cohesion[cId] = maxEdges > 0 ? internal / maxEdges : 0;
  }
  return cohesion;
}

/**
 * Compute all base metrics from a loaded graph.
 */
export function computeMetrics(nodes, edges) {
  const nodeCount = nodes.size;
  const edgeCount = edges.length;
  const inferredEdgeCount = edges.filter(e => e.type === 'inferred').length;

  const degreeMap = buildDegreeMap(nodes, edges);
  const weakNodes = [...degreeMap.entries()]
    .filter(([, d]) => d.total <= 1)
    .map(([id]) => id);

  const communityOf = detectCommunities(nodes, edges);
  const sizes = communitySizes(communityOf);
  const communityCount = sizes.size;
  const cohesion = computeCohesion(communityOf, edges, 5);

  return {
    nodeCount,
    edgeCount,
    inferredEdgeCount,
    weakNodeCount: weakNodes.length,
    degreeMap,
    communityOf,
    communityCount,
    communityCount_top5_cohesion: cohesion,
  };
}
