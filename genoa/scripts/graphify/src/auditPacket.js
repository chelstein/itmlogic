// Feature 5: Claude Audit Packet Export
import { findSurfaceNodes, expandOnehop, buildSubgraph, SURFACES } from './surfaces.js';
import { buildDegreeMap, detectCommunities } from './metrics.js';
import { riskRank, topGodNodes } from './godNodes.js';
import { classifyWeakNode } from './weakNodes.js';
import { writeReport, estimateTokens } from './report.js';

const DEFAULT_BUDGET = 20_000;
const BFS_MAX_DEPTH = 4;

/**
 * BFS from entry nodes; returns an array of path strings (node chains).
 * Limits to maxPaths paths.
 */
export function bfsPaths(entryIds, edges, maxDepth, maxPaths) {
  const paths = [];
  // Queue entries: [currentId, pathSoFar]
  const queue = [...entryIds].map(id => [id, [id]]);

  while (queue.length > 0 && paths.length < maxPaths) {
    const [current, pathSoFar] = queue.shift();
    if (pathSoFar.length > 1) {
      paths.push(pathSoFar.join(' → '));
    }
    if (pathSoFar.length >= maxDepth + 1) continue;

    for (const e of edges) {
      if (e.source === current) {
        // Avoid cycles
        if (!pathSoFar.includes(e.target)) {
          queue.push([e.target, [...pathSoFar, e.target]]);
        }
      }
    }
  }

  return paths;
}

/**
 * Get inferred edges annotated with risk, filtered to a set of node ids.
 */
function getHighRiskInferredEdges(nodes, edges, surfaceNodeIds) {
  const godList = topGodNodes(nodes, edges, 25);
  const godNodeIds = new Set(godList.map(g => g.id));
  const communityOf = detectCommunities(nodes, edges);
  const inferredEdges = edges.filter(e => e.type === 'inferred');

  const annotated = inferredEdges.map(e => ({
    ...e,
    risk: riskRank(e, godNodeIds, communityOf),
    attachedGodNode: godNodeIds.has(e.source) ? e.source : godNodeIds.has(e.target) ? e.target : null,
    srcCommunity: communityOf.get(e.source) ?? '?',
    tgtCommunity: communityOf.get(e.target) ?? '?',
  }));

  return annotated.filter(
    e => (e.risk === 'HIGH' || e.risk === 'MEDIUM') &&
      (surfaceNodeIds.has(e.source) || surfaceNodeIds.has(e.target))
  );
}

/**
 * Get weak nodes of category 'possible-missing-edge' in the surface.
 */
function getWeakNodesForSurface(nodes, edges, surfaceNodeIds) {
  const degreeMap = buildDegreeMap(nodes, edges);
  const result = [];
  for (const [id, degrees] of degreeMap.entries()) {
    if (degrees.total <= 1 && surfaceNodeIds.has(id)) {
      const node = nodes.get(id);
      const category = classifyWeakNode(node, degrees);
      if (category === 'possible-missing-edge') {
        result.push({ id, node, degrees });
      }
    }
  }
  return result;
}

/**
 * Build the audit packet markdown string.
 */
export function buildAuditPacket(surfaceName, { nodes, edges }, budget = DEFAULT_BUDGET) {
  const patterns = SURFACES[surfaceName];
  if (!patterns) {
    throw new Error(`Unknown surface "${surfaceName}". Valid: ${Object.keys(SURFACES).join(', ')}`);
  }

  const seedIds = findSurfaceNodes(nodes, patterns);
  const expandedIds = expandOnehop(seedIds, edges);
  const sub = buildSubgraph(expandedIds, nodes, edges);

  // Section 1: Surface Summary
  const sec1Lines = [
    `## 1. Surface Summary: ${surfaceName}`,
    '',
    `**Patterns**: ${patterns.map(p => `\`${p}\``).join(', ')}`,
    `**Seed nodes**: ${seedIds.size}`,
    `**Total nodes (with 1-hop)**: ${sub.nodes.size}`,
    `**Edges in subgraph**: ${sub.edges.length}`,
    '',
    '### Seed Nodes',
    '',
    ...[...seedIds].sort().map(id => {
      const node = nodes.get(id);
      return `- \`${id}\`${node?.file ? ` (${node.file})` : ''}`;
    }),
  ];

  // Section 5: Suggested Audit Prompt (always kept)
  const sec5Lines = [
    '## 5. Suggested Audit Prompt',
    '',
    `You are auditing the **${surfaceName}** surface of the Genoa codebase.`,
    '',
    'Please investigate the following:',
    '',
    `1. For each seed node in the ${surfaceName} surface, trace its call paths and verify all dependencies are correctly wired.`,
    '2. Identify any inferred edges flagged as HIGH or MEDIUM risk — these represent uncertain connections that may indicate missing imports or incorrect wiring.',
    '3. For nodes classified as `possible-missing-edge`, determine if they should have additional inbound or outbound connections.',
    '4. Verify that entry points in this surface reach their expected output nodes (API responses, exported functions, or side effects).',
    '5. Report any orphaned nodes, broken chains, or nodes that appear to be dead code.',
    '',
    `Surface patterns: ${patterns.map(p => `\`${p}\``).join(', ')}`,
  ];

  // Section 3: High-Risk Inferred Edges
  const highRisk = getHighRiskInferredEdges(nodes, edges, expandedIds);
  const sec3Lines = [
    '## 3. High-Risk Inferred Edges (Surface)',
    '',
  ];
  if (highRisk.length === 0) {
    sec3Lines.push('_No high or medium risk inferred edges in this surface._');
  } else {
    for (const e of highRisk) {
      sec3Lines.push(`- [${e.risk}] \`${e.source}\` → \`${e.target}\``);
      if (e.attachedGodNode) sec3Lines.push(`  - God node: \`${e.attachedGodNode}\``);
      sec3Lines.push(`  - Communities: \`${e.srcCommunity}\` → \`${e.tgtCommunity}\``);
    }
  }

  // Section 4: Weak Nodes of Concern
  const weakForSurface = getWeakNodesForSurface(nodes, edges, expandedIds);

  const buildSec4 = (weakList, totalCount) => {
    const lines = [
      '## 4. Weak Nodes of Concern (possible-missing-edge)',
      '',
    ];
    if (weakList.length === 0) {
      lines.push('_No possible-missing-edge nodes in this surface._');
    } else {
      for (const { id, node, degrees } of weakList) {
        lines.push(`- \`${id}\` (in:${degrees.in} out:${degrees.out})${node?.file ? ` — \`${node.file}\`` : ''}`);
      }
      if (totalCount > weakList.length) {
        lines.push(`_... ${totalCount - weakList.length} more nodes trimmed to fit budget._`);
      }
    }
    return lines;
  };

  const headerLines = [
    `# Claude Audit Packet: ${surfaceName}`,
    '',
    `_Generated for surface \`${surfaceName}\` with budget ${budget} tokens._`,
    '',
  ];

  const assemble = (sec2, sec4) => [
    ...headerLines,
    ...sec1Lines,
    '',
    ...sec2,
    '',
    ...sec3Lines,
    '',
    ...sec4,
    '',
    ...sec5Lines,
  ].join('\n');

  // Section 2: Call Paths (BFS)
  let maxPaths = 50;
  let callPaths = bfsPaths(seedIds, edges, BFS_MAX_DEPTH, maxPaths);
  const buildSec2 = (paths) => [
    '## 2. Call Paths (BFS from entry nodes, max depth 4)',
    '',
    ...(paths.length === 0 ? ['_No paths found._'] : paths.map(p => `- ${p}`)),
  ];

  let result = assemble(buildSec2(callPaths), buildSec4(weakForSurface, weakForSurface.length));

  // Trim if over budget: reduce call paths first
  while (estimateTokens(result) > budget && maxPaths > 5) {
    maxPaths = Math.max(5, Math.floor(maxPaths * 0.6));
    callPaths = bfsPaths(seedIds, edges, BFS_MAX_DEPTH, maxPaths);
    result = assemble(buildSec2(callPaths), buildSec4(weakForSurface, weakForSurface.length));
  }

  // Then trim weak nodes
  if (estimateTokens(result) > budget) {
    let weakLimit = Math.min(10, weakForSurface.length);
    while (estimateTokens(result) > budget && weakLimit > 0) {
      weakLimit = Math.max(0, Math.floor(weakLimit * 0.6));
      result = assemble(
        buildSec2(callPaths),
        buildSec4(weakForSurface.slice(0, weakLimit), weakForSurface.length)
      );
    }
  }

  return result;
}

/**
 * Run audit packet and write to file.
 */
export function runAuditPacket(surfaceName, graph, outDir, budget = DEFAULT_BUDGET) {
  const content = buildAuditPacket(surfaceName, graph, budget);
  const filename = `AUDIT_PACKET_${surfaceName}.md`;
  const mdPath = writeReport(outDir, filename, content);
  return { mdPath, content, tokens: estimateTokens(content) };
}
