// Feature 4: Graph Drift Metrics
import fs from 'node:fs';
import path from 'node:path';
import { computeMetrics } from './metrics.js';
import { writeReport, ensureDir } from './report.js';

/**
 * Build the metrics snapshot object from graph data.
 */
export function buildSnapshot(nodes, edges) {
  const m = computeMetrics(nodes, edges);

  // Top 10 god nodes by degree
  const topGodNodes = [...m.degreeMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([id, d]) => ({ id, degree: d.total }));

  return {
    timestamp: new Date().toISOString(),
    nodes: m.nodeCount,
    edges: m.edgeCount,
    structural_edges: m.structuralEdgeCount,
    containment_edges: m.containmentEdgeCount,
    semantic_edges: m.semanticEdgeCount,
    inferred_edges: m.inferredEdgeCount,
    structural_ratio: m.structuralRatio,
    communities: m.communityCount,
    weak_nodes: m.weakNodeCount,
    weak_json_field_nodes: m.weakJsonFieldNodeCount,
    top_god_nodes: topGodNodes,
    community_cohesion: m.communityCount_top5_cohesion,
  };
}

/**
 * Compute delta between two snapshots (numeric fields only).
 */
export function computeDelta(prev, curr) {
  const numericFields = [
    'nodes', 'edges',
    'structural_edges', 'containment_edges', 'semantic_edges', 'inferred_edges',
    'communities', 'weak_nodes', 'weak_json_field_nodes',
  ];
  const delta = {};
  for (const f of numericFields) {
    delta[f] = curr[f] - (prev[f] ?? 0);
  }
  return delta;
}

/**
 * Run drift analysis, save snapshot, write GRAPH_DRIFT_REPORT.md.
 */
export function runDrift({ nodes, edges }, outDir) {
  ensureDir(outDir);
  const metricsFile = path.join(outDir, 'graph_metrics.json');

  const current = buildSnapshot(nodes, edges);

  let previous = null;
  if (fs.existsSync(metricsFile)) {
    try {
      previous = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
    } catch (_) {
      previous = null;
    }
  }

  // Save current snapshot
  fs.writeFileSync(metricsFile, JSON.stringify(current, null, 2), 'utf8');

  const delta = previous ? computeDelta(previous, current) : null;

  // Build report
  const lines = [
    '# Graph Drift Report',
    '',
    `**Generated**: ${current.timestamp}`,
    '',
    '## Current Metrics',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Nodes | ${current.nodes} |`,
    `| Edges | ${current.edges} |`,
    `| Structural edges | ${current.structural_edges} |`,
    `| Containment edges | ${current.containment_edges} |`,
    `| Semantic edges | ${current.semantic_edges} |`,
    `| Inferred edges | ${current.inferred_edges} |`,
    `| Structural ratio | ${(current.structural_ratio * 100).toFixed(1)}% |`,
    `| Communities | ${current.communities} |`,
    `| Weak nodes | ${current.weak_nodes} |`,
    `| Weak JSON field nodes | ${current.weak_json_field_nodes} |`,
    '',
  ];

  if (!previous) {
    lines.push('> **Baseline run** — no previous metrics to compare against. Saved as new baseline.');
    lines.push('');
  } else {
    lines.push('## Delta vs Previous Snapshot');
    lines.push('');
    lines.push(`**Previous timestamp**: ${previous.timestamp}`);
    lines.push('');
    lines.push('| Metric | Previous | Current | Delta |');
    lines.push('|--------|----------|---------|-------|');
    const numericFields = [
      'nodes', 'edges',
      'structural_edges', 'containment_edges', 'semantic_edges', 'inferred_edges',
      'communities', 'weak_nodes', 'weak_json_field_nodes',
    ];
    for (const f of numericFields) {
      const d = delta[f];
      const sign = d > 0 ? '+' : '';
      lines.push(`| ${f} | ${previous[f] ?? '?'} | ${current[f]} | ${sign}${d} |`);
    }
    lines.push('');
  }

  lines.push('## Top God Nodes', '');
  lines.push('| Rank | Node | Degree |');
  lines.push('|------|------|--------|');
  current.top_god_nodes.forEach((g, i) => {
    lines.push(`| ${i + 1} | \`${g.id}\` | ${g.degree} |`);
  });
  lines.push('');

  lines.push('## Community Cohesion (top 5)', '');
  for (const [cId, val] of Object.entries(current.community_cohesion)) {
    lines.push(`- Community \`${cId}\`: ${(val * 100).toFixed(1)}%`);
  }

  const md = lines.join('\n');
  const mdPath = writeReport(outDir, 'GRAPH_DRIFT_REPORT.md', md);

  return { mdPath, metricsFile, current, previous, delta };
}
