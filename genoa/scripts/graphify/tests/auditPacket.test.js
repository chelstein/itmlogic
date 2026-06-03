import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

import { normalizeGraph } from '../src/loader.js';
import { buildAuditPacket, bfsPaths } from '../src/auditPacket.js';
import { estimateTokens } from '../src/report.js';
import { findSurfaceNodes } from '../src/surfaces.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'small_graph.json');

function loadFixture() {
  const parsed = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return normalizeGraph(parsed);
}

describe('auditPacket', () => {
  let nodes, edges;

  before(() => {
    ({ nodes, edges } = loadFixture());
  });

  it('buildAuditPacket throws for unknown surface', () => {
    assert.throws(
      () => buildAuditPacket('nonexistent', { nodes, edges }),
      /Unknown surface/
    );
  });

  it('buildAuditPacket returns a string', () => {
    const result = buildAuditPacket('api', { nodes, edges });
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('buildAuditPacket includes all 5 required sections', () => {
    const result = buildAuditPacket('api', { nodes, edges });
    assert.ok(result.includes('## 1. Surface Summary'), 'should have section 1');
    assert.ok(result.includes('## 2. Call Paths'), 'should have section 2');
    assert.ok(result.includes('## 3. High-Risk Inferred Edges'), 'should have section 3');
    assert.ok(result.includes('## 4. Weak Nodes of Concern'), 'should have section 4');
    assert.ok(result.includes('## 5. Suggested Audit Prompt'), 'should have section 5');
  });

  it('buildAuditPacket includes surface name in header', () => {
    const result = buildAuditPacket('api', { nodes, edges });
    assert.ok(result.includes('api'), 'should mention surface name');
  });

  it('buildAuditPacket sections 1 and 5 always present even with tiny budget', () => {
    // Use a very small budget — should still keep sections 1 and 5
    const result = buildAuditPacket('readiness', { nodes, edges }, 500);
    assert.ok(result.includes('## 1. Surface Summary'), 'section 1 must be present');
    assert.ok(result.includes('## 5. Suggested Audit Prompt'), 'section 5 must be present');
  });

  it('token budget enforcement: result fits within budget (within 20% tolerance)', () => {
    const budget = 3000;
    const result = buildAuditPacket('readiness', { nodes, edges }, budget);
    const tokens = estimateTokens(result);
    // Allow some tolerance since trim may not be exact
    assert.ok(
      tokens <= budget * 1.2,
      `tokens ${tokens} should be within 120% of budget ${budget}`
    );
  });

  it('buildAuditPacket with large budget is not trimmed', () => {
    const result = buildAuditPacket('api', { nodes, edges }, 100_000);
    // With large budget, no trimming occurs — result should be full
    assert.ok(result.includes('## 2. Call Paths'), 'call paths should be present');
  });

  it('bfsPaths returns paths from entry nodes', () => {
    const entryIds = new Set(['server']);
    const paths = bfsPaths(entryIds, edges, 2, 50);
    assert.ok(paths.length > 0, 'should find paths from server');
    for (const p of paths) {
      assert.ok(p.startsWith('server'), `all paths should start from server, got: ${p}`);
      assert.ok(p.includes(' → '), 'paths should use → separator');
    }
  });

  it('bfsPaths respects maxPaths limit', () => {
    const entryIds = new Set(['server', 'routes']);
    const paths = bfsPaths(entryIds, edges, 4, 5);
    assert.ok(paths.length <= 5, `should have at most 5 paths, got ${paths.length}`);
  });

  it('bfsPaths respects maxDepth', () => {
    const entryIds = new Set(['server']);
    const paths = bfsPaths(entryIds, edges, 1, 100);
    for (const p of paths) {
      const hops = p.split(' → ').length - 1;
      assert.ok(hops <= 1, `path ${p} has ${hops} hops, should be <= 1`);
    }
  });

  it('bfsPaths returns empty array for empty entry set', () => {
    const paths = bfsPaths(new Set(), edges, 4, 50);
    assert.deepEqual(paths, []);
  });

  it('buildAuditPacket for fcc-engine surface includes engine nodes', () => {
    const result = buildAuditPacket('fcc-engine', { nodes, edges });
    assert.ok(result.includes('engineCore') || result.includes('evidenceLoader'),
      'fcc-engine audit should mention engine nodes');
  });

  it('buildAuditPacket pdf-export includes pdf patterns', () => {
    const result = buildAuditPacket('pdf-export', { nodes, edges });
    assert.ok(result.includes('pdf-export'), 'should include surface name');
  });
});
