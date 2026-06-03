import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { normalizeGraph } from '../src/loader.js';
import {
  classifyEdge,
  computeMetrics,
  countWeakJsonFieldNodes,
  JSON_SCALAR_NAMES,
} from '../src/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'small_graph.json');

function loadFixture() {
  const parsed = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return normalizeGraph(parsed);
}

describe('classifyEdge', () => {
  it('classifies structural labels correctly', () => {
    for (const label of ['calls', 'imports', 'imports_from', 'references', 'implements', 'inherits']) {
      assert.equal(classifyEdge({ label, type: 'normal' }), 'structural', `expected structural for label=${label}`);
    }
  });

  it('classifies containment edges by label', () => {
    assert.equal(classifyEdge({ label: 'contains', type: 'normal' }), 'containment');
  });

  it('classifies containment edges by type', () => {
    assert.equal(classifyEdge({ label: 'whatever', type: 'contains' }), 'containment');
  });

  it('classifies inferred edges by type (beats structural label)', () => {
    assert.equal(classifyEdge({ label: 'calls', type: 'inferred' }), 'inferred');
  });

  it('classifies semantic edges (uses, mounts, renders, feeds, etc.)', () => {
    for (const label of ['uses', 'mounts', 'renders', 'feeds', 'queries', 'stores']) {
      assert.equal(classifyEdge({ label, type: 'normal' }), 'semantic', `expected semantic for label=${label}`);
    }
  });
});

describe('computeMetrics edge type counts', () => {
  let nodes, edges, metrics;

  before(() => {
    ({ nodes, edges } = loadFixture());
    metrics = computeMetrics(nodes, edges);
  });

  it('edge type counts sum to total edge count', () => {
    const { structuralEdgeCount, containmentEdgeCount, semanticEdgeCount, inferredEdgeCount, edgeCount } = metrics;
    assert.equal(structuralEdgeCount + containmentEdgeCount + semanticEdgeCount + inferredEdgeCount, edgeCount);
  });

  it('fixture has structural edges (imports)', () => {
    assert.ok(metrics.structuralEdgeCount > 0, 'expected structural edges');
  });

  it('fixture has containment edges', () => {
    assert.ok(metrics.containmentEdgeCount > 0, 'expected containment edges from json scalar nodes');
  });

  it('fixture has semantic edges (uses, mounts, etc.)', () => {
    assert.ok(metrics.semanticEdgeCount > 0, 'expected semantic edges');
  });

  it('fixture has inferred edges', () => {
    assert.ok(metrics.inferredEdgeCount > 0, 'expected inferred edges');
  });

  it('structural_ratio is between 0 and 1', () => {
    assert.ok(metrics.structuralRatio >= 0 && metrics.structuralRatio <= 1);
  });

  it('structural_ratio = structuralEdgeCount / edgeCount', () => {
    const expected = metrics.structuralEdgeCount / metrics.edgeCount;
    assert.equal(metrics.structuralRatio, expected);
  });

  it('returns weakJsonFieldNodeCount', () => {
    assert.ok(typeof metrics.weakJsonFieldNodeCount === 'number');
  });
});

describe('JSON_SCALAR_NAMES', () => {
  it('contains expected ITM scalar names', () => {
    for (const name of ['A_factor', 'B_factor', 'D_Lf', 'mdvar', 'klim', 'q']) {
      assert.ok(JSON_SCALAR_NAMES.has(name), `expected ${name} in JSON_SCALAR_NAMES`);
    }
  });

  it('contains common JSON field names', () => {
    for (const name of ['id', 'version', 'method', 'value', 'type', 'name', 'status']) {
      assert.ok(JSON_SCALAR_NAMES.has(name), `expected ${name} in JSON_SCALAR_NAMES`);
    }
  });
});

describe('countWeakJsonFieldNodes — regression: JSON scalar nodes must not inflate isolated counts', () => {
  let nodes, edges, metrics;

  before(() => {
    ({ nodes, edges } = loadFixture());
    metrics = computeMetrics(nodes, edges);
  });

  it('json scalar nodes connected only via contains do not appear in possible-missing-edge pool', () => {
    // The fixture adds json::id, json::version, json::method, field::A_factor, field::klim
    // — all connected only via contains edges with JSON scalar labels.
    // weakJsonFieldNodeCount must be >= 5 (one per scalar node added to fixture).
    assert.ok(metrics.weakJsonFieldNodeCount >= 5,
      `expected at least 5 weak JSON field nodes, got ${metrics.weakJsonFieldNodeCount}`);
  });

  it('weakJsonFieldNodeCount is less than weakNodeCount (not all weak nodes are json fields)', () => {
    assert.ok(metrics.weakJsonFieldNodeCount < metrics.weakNodeCount,
      `weakJsonFieldNodeCount (${metrics.weakJsonFieldNodeCount}) should be < weakNodeCount (${metrics.weakNodeCount})`);
  });

  it('json scalar nodes are NOT considered structurally connected', () => {
    // Build the set of nodes that appear in any non-containment edge
    const structurallyConnected = new Set();
    for (const e of edges) {
      if (classifyEdge(e) !== 'containment') {
        structurallyConnected.add(e.source);
        structurallyConnected.add(e.target);
      }
    }
    for (const scalarId of ['json::id', 'json::version', 'json::method', 'engine.A_factor', 'engine.klim']) {
      assert.ok(!structurallyConnected.has(scalarId),
        `${scalarId} should not appear in non-containment edges`);
    }
  });
});
