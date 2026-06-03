import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

import { normalizeGraph } from '../src/loader.js';
import { buildSnapshot, computeDelta, runDrift } from '../src/drift.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'small_graph.json');

function loadFixture() {
  const parsed = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return normalizeGraph(parsed);
}

function tmpDir() {
  const dir = path.join(os.tmpdir(), `graphify-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('drift', () => {
  let nodes, edges;
  let testDirs = [];

  before(() => {
    ({ nodes, edges } = loadFixture());
  });

  afterEach(() => {
    // Cleanup temp dirs
    for (const dir of testDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
    testDirs = [];
  });

  it('buildSnapshot returns correct shape', () => {
    const snap = buildSnapshot(nodes, edges);
    assert.ok(snap.timestamp, 'should have timestamp');
    assert.equal(typeof snap.nodes, 'number');
    assert.equal(typeof snap.edges, 'number');
    assert.equal(typeof snap.communities, 'number');
    assert.equal(typeof snap.inferred_edges, 'number');
    assert.equal(typeof snap.weak_nodes, 'number');
    assert.ok(Array.isArray(snap.top_god_nodes), 'top_god_nodes should be array');
    assert.ok(typeof snap.community_cohesion === 'object', 'community_cohesion should be object');
  });

  it('buildSnapshot top_god_nodes has at most 10 entries', () => {
    const snap = buildSnapshot(nodes, edges);
    assert.ok(snap.top_god_nodes.length <= 10);
  });

  it('buildSnapshot top_god_nodes entries have id and degree', () => {
    const snap = buildSnapshot(nodes, edges);
    for (const entry of snap.top_god_nodes) {
      assert.ok(entry.id, 'should have id');
      assert.equal(typeof entry.degree, 'number', 'should have numeric degree');
    }
  });

  it('buildSnapshot node count matches fixture', () => {
    const snap = buildSnapshot(nodes, edges);
    assert.equal(snap.nodes, nodes.size);
  });

  it('buildSnapshot edge count matches fixture', () => {
    const snap = buildSnapshot(nodes, edges);
    assert.equal(snap.edges, edges.length);
  });

  it('buildSnapshot inferred_edges counts type=inferred edges', () => {
    const snap = buildSnapshot(nodes, edges);
    const expected = edges.filter(e => e.type === 'inferred').length;
    assert.equal(snap.inferred_edges, expected);
  });

  it('computeDelta computes correct deltas', () => {
    const prev = { nodes: 10, edges: 20, communities: 3, inferred_edges: 2, weak_nodes: 5 };
    const curr = { nodes: 15, edges: 25, communities: 4, inferred_edges: 1, weak_nodes: 6 };
    const delta = computeDelta(prev, curr);
    assert.equal(delta.nodes, 5);
    assert.equal(delta.edges, 5);
    assert.equal(delta.communities, 1);
    assert.equal(delta.inferred_edges, -1);
    assert.equal(delta.weak_nodes, 1);
  });

  it('computeDelta handles zero baseline', () => {
    const prev = { nodes: 0, edges: 0, communities: 0, inferred_edges: 0, weak_nodes: 0 };
    const curr = { nodes: 5, edges: 10, communities: 2, inferred_edges: 1, weak_nodes: 3 };
    const delta = computeDelta(prev, curr);
    assert.equal(delta.nodes, 5);
    assert.equal(delta.edges, 10);
  });

  it('runDrift baseline run: writes metrics file and report', () => {
    const outDir = tmpDir();
    testDirs.push(outDir);

    const result = runDrift({ nodes, edges }, outDir);
    assert.ok(existsSync(result.metricsFile), 'metrics file should exist');
    assert.ok(existsSync(result.mdPath), 'drift report should exist');
    assert.equal(result.previous, null, 'first run should have null previous');

    const report = readFileSync(result.mdPath, 'utf8');
    assert.ok(report.includes('Baseline run'), 'baseline run should say "Baseline run"');
  });

  it('runDrift second run: computes delta vs previous', () => {
    const outDir = tmpDir();
    testDirs.push(outDir);

    // First run
    runDrift({ nodes, edges }, outDir);

    // Second run with same data
    const result2 = runDrift({ nodes, edges }, outDir);
    assert.ok(result2.previous !== null, 'second run should have previous metrics');
    assert.ok(result2.delta !== null, 'second run should have delta');

    const report = readFileSync(result2.mdPath, 'utf8');
    assert.ok(report.includes('Delta vs Previous'), 'should include delta section');
  });

  it('runDrift saves current snapshot to metrics file', () => {
    const outDir = tmpDir();
    testDirs.push(outDir);

    const result = runDrift({ nodes, edges }, outDir);
    const saved = JSON.parse(readFileSync(result.metricsFile, 'utf8'));
    assert.equal(saved.nodes, nodes.size);
    assert.equal(saved.edges, edges.length);
    assert.ok(saved.timestamp, 'saved snapshot should have timestamp');
  });

  it('runDrift report contains top god nodes table', () => {
    const outDir = tmpDir();
    testDirs.push(outDir);

    const result = runDrift({ nodes, edges }, outDir);
    const report = readFileSync(result.mdPath, 'utf8');
    assert.ok(report.includes('Top God Nodes'), 'report should contain god nodes section');
  });
});
