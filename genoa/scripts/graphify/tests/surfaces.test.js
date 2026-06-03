import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { normalizeGraph } from '../src/loader.js';
import {
  SURFACES,
  findSurfaceNodes,
  expandOnehop,
  buildSubgraph,
} from '../src/surfaces.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'small_graph.json');

function loadFixture() {
  const parsed = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return normalizeGraph(parsed);
}

describe('surfaces', () => {
  let nodes, edges;

  before(() => {
    ({ nodes, edges } = loadFixture());
  });

  it('SURFACES contains expected keys', () => {
    assert.ok(SURFACES.readiness);
    assert.ok(SURFACES.trust);
    assert.ok(SURFACES['pdf-export']);
    assert.ok(SURFACES.api);
    assert.ok(SURFACES['fcc-engine']);
  });

  it('findSurfaceNodes finds readiness nodes by file path', () => {
    const patterns = SURFACES.readiness;
    const matches = findSurfaceNodes(nodes, patterns);
    // 'readinessRoute' has file 'src/exports/readiness/index.js'
    assert.ok(matches.has('readinessRoute'), 'should find readinessRoute');
  });

  it('findSurfaceNodes finds api nodes by file path', () => {
    const patterns = SURFACES.api;
    const matches = findSurfaceNodes(nodes, patterns);
    // server.js matches 'server.js' pattern
    assert.ok(matches.has('server'), 'should find server node');
    // routes matches 'routes/'
    assert.ok(matches.has('routes'), 'should find routes node');
    // middleware matches 'middleware/'
    assert.ok(matches.has('middleware'), 'should find middleware node');
  });

  it('findSurfaceNodes finds pdf-export nodes', () => {
    const patterns = SURFACES['pdf-export'];
    const matches = findSurfaceNodes(nodes, patterns);
    assert.ok(matches.has('pdfExport'), 'should find pdfExport');
    assert.ok(matches.has('pdfkit'), 'should find pdfkit');
  });

  it('findSurfaceNodes finds fcc-engine nodes', () => {
    const patterns = SURFACES['fcc-engine'];
    const matches = findSurfaceNodes(nodes, patterns);
    assert.ok(matches.has('engineCore'), 'should find engineCore');
    assert.ok(matches.has('evidenceLoader'), 'should find evidenceLoader');
  });

  it('expandOnehop includes direct neighbors', () => {
    const seedIds = new Set(['readinessRoute']);
    const expanded = expandOnehop(seedIds, edges);
    // readinessRoute has edges to/from routes, godNode, dbClient
    assert.ok(expanded.has('readinessRoute'));
    assert.ok(expanded.has('routes'), 'routes should be in 1-hop');
    assert.ok(expanded.has('godNode'), 'godNode should be in 1-hop');
    assert.ok(expanded.has('dbClient'), 'dbClient should be in 1-hop');
  });

  it('expandOnehop includes reverse edges', () => {
    const seedIds = new Set(['pdfkit']);
    const expanded = expandOnehop(seedIds, edges);
    // pdfExport → pdfkit and pdfkit → pdfExport
    assert.ok(expanded.has('pdfExport'), 'pdfExport should be neighbor of pdfkit');
  });

  it('buildSubgraph returns only edges where both endpoints are in nodeIds', () => {
    const nodeIds = new Set(['server', 'routes', 'middleware']);
    const sub = buildSubgraph(nodeIds, nodes, edges);
    assert.equal(sub.nodes.size, 3);
    for (const e of sub.edges) {
      assert.ok(nodeIds.has(e.source), `edge source ${e.source} should be in subgraph`);
      assert.ok(nodeIds.has(e.target), `edge target ${e.target} should be in subgraph`);
    }
  });

  it('buildSubgraph nodes match expected set', () => {
    const nodeIds = new Set(['pdfExport', 'pdfkit']);
    const sub = buildSubgraph(nodeIds, nodes, edges);
    assert.ok(sub.nodes.has('pdfExport'));
    assert.ok(sub.nodes.has('pdfkit'));
    assert.ok(sub.edges.length > 0, 'should have edges between pdfExport and pdfkit');
  });

  it('throws for unknown surface name', () => {
    assert.throws(
      () => { const p = SURFACES['nonexistent-surface']; if (!p) throw new Error('Unknown surface'); },
      /Unknown surface/
    );
  });

  it('readiness surface seed nodes do not include unrelated nodes', () => {
    const patterns = SURFACES.readiness;
    const matches = findSurfaceNodes(nodes, patterns);
    assert.ok(!matches.has('engineCore'), 'engineCore should NOT be a readiness seed');
    assert.ok(!matches.has('dbClient'), 'dbClient should NOT be a readiness seed');
  });
});
