// Feature 2: God Node Inference Review
import { buildDegreeMap, detectCommunities } from './metrics.js';
import { writeReport } from './report.js';

const TOP_N = 25;

const RISK = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' };

/**
 * Determine risk level of an inferred edge.
 * HIGH  : attached to a god node AND crosses community boundary
 * MEDIUM: crosses community boundary (any node)
 * LOW   : same community, or involves a docs/test node
 */
export function riskRank(edge, godNodeIds, communityOf) {
  const srcCom = communityOf.get(edge.source);
  const tgtCom = communityOf.get(edge.target);
  const crossesBoundary = srcCom !== tgtCom;
  const attachedToGod = godNodeIds.has(edge.source) || godNodeIds.has(edge.target);

  const isDocsOrTest = (id) =>
    /\.(md)$/i.test(id) ||
    /\/docs\//i.test(id) ||
    /README/i.test(id) ||
    /\.test\.js$/i.test(id) ||
    /\/tests\//i.test(id) ||
    /\/__golden__\//i.test(id) ||
    /\/__samples__\//i.test(id) ||
    /\/fixtures\//i.test(id);

  if (!crossesBoundary || isDocsOrTest(edge.source) || isDocsOrTest(edge.target)) {
    return RISK.LOW;
  }
  if (attachedToGod && crossesBoundary) {
    return RISK.HIGH;
  }
  // crossesBoundary but not god node
  return RISK.MEDIUM;
}

/**
 * Rank all nodes by total degree, return top N.
 */
export function topGodNodes(nodes, edges, n = TOP_N) {
  const degreeMap = buildDegreeMap(nodes, edges);
  return [...degreeMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, n)
    .map(([id, d]) => ({ id, ...d }));
}

/**
 * Run god-nodes analysis and write INFERRED_EDGE_REVIEW.md
 */
export function runGodNodes({ nodes, edges }, outDir) {
  const godList = topGodNodes(nodes, edges, TOP_N);
  const godNodeIds = new Set(godList.map(g => g.id));
  const communityOf = detectCommunities(nodes, edges);

  const inferredEdges = edges.filter(e => e.type === 'inferred');

  // Annotate inferred edges with risk
  const annotated = inferredEdges.map(e => ({
    ...e,
    risk: riskRank(e, godNodeIds, communityOf),
    attachedGodNode: godNodeIds.has(e.source)
      ? e.source
      : godNodeIds.has(e.target)
      ? e.target
      : null,
    srcCommunity: communityOf.get(e.source) ?? '?',
    tgtCommunity: communityOf.get(e.target) ?? '?',
  }));

  // Sort by risk
  const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  annotated.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);

  const high = annotated.filter(e => e.risk === RISK.HIGH);
  const medium = annotated.filter(e => e.risk === RISK.MEDIUM);
  const low = annotated.filter(e => e.risk === RISK.LOW);

  const lines = [
    '# Inferred Edge Review',
    '',
    `**Total inferred edges**: ${inferredEdges.length}`,
    `**HIGH risk**: ${high.length}  **MEDIUM risk**: ${medium.length}  **LOW risk**: ${low.length}`,
    '',
    '## Top God Nodes (by total degree)',
    '',
    '| Rank | Node | In | Out | Total |',
    '|------|------|----|-----|-------|',
  ];

  godList.slice(0, 10).forEach((g, i) => {
    lines.push(`| ${i + 1} | \`${g.id}\` | ${g.in} | ${g.out} | ${g.total} |`);
  });

  lines.push('', '## HIGH Risk Inferred Edges', '');
  if (high.length === 0) {
    lines.push('_None_');
  } else {
    for (const e of high) {
      lines.push(`- **${e.source}** → **${e.target}**`);
      lines.push(`  - God node: \`${e.attachedGodNode}\``);
      lines.push(`  - Communities: \`${e.srcCommunity}\` → \`${e.tgtCommunity}\``);
      lines.push(`  - Label: ${e.label || '(none)'}`);
    }
  }

  lines.push('', '## MEDIUM Risk Inferred Edges', '');
  if (medium.length === 0) {
    lines.push('_None_');
  } else {
    for (const e of medium) {
      lines.push(`- \`${e.source}\` → \`${e.target}\``);
      lines.push(`  - Communities: \`${e.srcCommunity}\` → \`${e.tgtCommunity}\``);
    }
  }

  lines.push('', '## LOW Risk Inferred Edges', '');
  if (low.length === 0) {
    lines.push('_None_');
  } else {
    for (const e of low) {
      lines.push(`- \`${e.source}\` → \`${e.target}\` (same community or docs/test)`);
    }
  }

  const md = lines.join('\n');
  const mdPath = writeReport(outDir, 'INFERRED_EDGE_REVIEW.md', md);
  return { mdPath, godList, annotated };
}
