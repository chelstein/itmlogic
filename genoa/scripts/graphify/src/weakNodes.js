// Feature 3: Weak Node Classification
import { buildDegreeMap, JSON_SCALAR_NAMES, classifyEdge } from './metrics.js';
import { writeReport } from './report.js';

export const CATEGORIES = [
  'docs-only',
  'config-env',
  'test-only',
  'external-schema',
  'exported-unused',
  'json-field',
  'possible-missing-edge',
];

/**
 * Classify a weak node into a category.
 * Checked in order; first match wins.
 */
export function classifyWeakNode(node, degrees) {
  const { id, file } = node;
  const { in: inDeg, out: outDeg } = degrees;

  // docs-only
  if (
    (file && /\.md$/i.test(file)) ||
    (file && /\/docs\//i.test(file)) ||
    id.includes('README')
  ) {
    return 'docs-only';
  }

  // config-env
  if (
    (file && /\.json$/i.test(file)) ||
    (file && /\.env/i.test(file)) ||
    (file && /\/config\//i.test(file))
  ) {
    return 'config-env';
  }

  // test-only
  if (
    (file && /\.test\.js$/i.test(file)) ||
    (file && /\/tests\//i.test(file)) ||
    (file && /\/__golden__\//i.test(file)) ||
    (file && /\/__samples__\//i.test(file)) ||
    (file && /\/fixtures\//i.test(file))
  ) {
    return 'test-only';
  }

  // external-schema
  if (
    !file ||
    id.includes('::') ||
    (!id.startsWith('src/') && !id.startsWith('genoa/') && !(file && (file.startsWith('src/') || file.startsWith('genoa/'))))
  ) {
    return 'external-schema';
  }

  // exported-unused: in_degree === 0 AND out_degree > 0
  if (inDeg === 0 && outDeg > 0) {
    return 'exported-unused';
  }

  // json-field: label/id matches a known JSON scalar key name (metadata, not a real code node)
  const nameToCheck = (node.label || id || '').trim();
  if (JSON_SCALAR_NAMES.has(nameToCheck)) {
    return 'json-field';
  }

  return 'possible-missing-edge';
}

/**
 * Run weak-nodes analysis and write WEAK_NODE_REVIEW.md.
 */
export function runWeakNodes({ nodes, edges }, outDir) {
  const degreeMap = buildDegreeMap(nodes, edges);

  const weakNodes = [];
  for (const [id, degrees] of degreeMap.entries()) {
    if (degrees.total <= 1) {
      const node = nodes.get(id);
      const category = classifyWeakNode(node, degrees);
      weakNodes.push({ id, node, degrees, category });
    }
  }

  // Group by category
  const byCategory = {};
  for (const cat of CATEGORIES) byCategory[cat] = [];
  for (const w of weakNodes) byCategory[w.category].push(w);

  const lines = [
    '# Weak Node Review',
    '',
    `**Total weak nodes** (degree ≤ 1): ${weakNodes.length}`,
    '',
  ];

  for (const cat of CATEGORIES) {
    const group = byCategory[cat];
    lines.push(`## ${cat} (${group.length})`);
    lines.push('');
    if (group.length === 0) {
      lines.push('_None_');
    } else {
      for (const { id, node, degrees } of group) {
        const filePart = node?.file ? ` — \`${node.file}\`` : '';
        lines.push(`- \`${id}\` (in:${degrees.in} out:${degrees.out})${filePart}`);
      }
    }
    lines.push('');
  }

  const md = lines.join('\n');
  const mdPath = writeReport(outDir, 'WEAK_NODE_REVIEW.md', md);

  return { mdPath, weakNodes, byCategory };
}
