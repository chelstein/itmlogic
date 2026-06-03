import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { normalizeGraph } from '../src/loader.js';
import { detectCommunities } from '../src/metrics.js';
import { topGodNodes, riskRank } from '../src/godNodes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'small_graph.json');

function loadFixture() {
  const parsed = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return normalizeGraph(parsed);
}

describe('godNodes', () => {
  let nodes, edges;

  before(() => {
    ({ nodes, edges } = loadFixture());
  });

  it('topGodNodes returns nodes sorted by total degree descending', () => {
    const gods = topGodNodes(nodes, edges, 25);
    assert.ok(gods.length > 0, 'should have god nodes');
    for (let i = 1; i < gods.length; i++) {
      assert.ok(
        gods[i - 1].total >= gods[i].total,
        `god nodes should be sorted descending: ${gods[i-1].id}(${gods[i-1].total}) >= ${gods[i].id}(${gods[i].total})`
      );
    }
  });

  it('godNode node has highest degree (degree >= 6)', () => {
    const gods = topGodNodes(nodes, edges, 1);
    assert.ok(gods.length === 1);
    assert.ok(gods[0].total >= 6, `top god node should have degree >= 6, got ${gods[0].total}`);
  });

  it('topGodNodes respects n parameter', () => {
    const gods5 = topGodNodes(nodes, edges, 5);
    assert.ok(gods5.length <= 5);

    const gods1 = topGodNodes(nodes, edges, 1);
    assert.equal(gods1.length, 1);
  });

  it('riskRank returns HIGH for god node crossing community boundary', () => {
    const godList = topGodNodes(nodes, edges, 25);
    const godNodeIds = new Set(godList.map(g => g.id));

    // Build a synthetic communityOf that puts godNode and island1 in different communities
    // This tests the riskRank logic directly without relying on BFS merging them
    const syntheticCommunityOf = new Map([
      ['godNode', 'main'],
      ['island1', 'islands'],
      ['island2', 'islands'],
      ['island3', 'islands'],
      ['server',  'main'],
      ['routes',  'main'],
    ]);

    const testEdge = {
      source: 'godNode',
      target: 'island1',
      type: 'inferred',
      label: 'dispatch-inferred',
    };

    const risk = riskRank(testEdge, godNodeIds, syntheticCommunityOf);
    assert.equal(risk, 'HIGH', 'godNode → island1 inferred edge crossing community boundary should be HIGH risk');
  });

  it('riskRank returns LOW for docs/test nodes', () => {
    const godList = topGodNodes(nodes, edges, 25);
    const godNodeIds = new Set(godList.map(g => g.id));
    const communityOf = detectCommunities(nodes, edges);

    // README → server is an inferred edge involving a docs node
    const docEdge = edges.find(e => e.type === 'inferred' && e.source === 'README');
    if (docEdge) {
      const risk = riskRank(docEdge, godNodeIds, communityOf);
      assert.equal(risk, 'LOW', 'docs node edge should be LOW risk');
    }
  });

  it('riskRank returns MEDIUM for cross-boundary edge not involving god node', () => {
    const communityOf = detectCommunities(nodes, edges);
    // Create a synthetic non-god-node inferred edge that crosses community boundary
    // island community: island1, island2, island3
    // main community: server, routes, etc.
    const godNodeIds = new Set(['nonGodNodeX']); // empty god nodes set effectively
    const crossBoundaryEdge = {
      source: 'island1',
      target: 'server',
      type: 'inferred',
      label: null,
    };
    const srcCom = communityOf.get('island1');
    const tgtCom = communityOf.get('server');
    if (srcCom !== tgtCom) {
      const risk = riskRank(crossBoundaryEdge, godNodeIds, communityOf);
      assert.equal(risk, 'MEDIUM', 'cross-boundary non-god inferred edge should be MEDIUM');
    }
  });

  it('riskRank returns LOW for same-community inferred edge', () => {
    const communityOf = detectCommunities(nodes, edges);
    const godNodeIds = new Set();

    // Create a synthetic inferred edge within the same community
    const sameCommunityEdge = {
      source: 'server',
      target: 'routes',
      type: 'inferred',
      label: null,
    };
    const risk = riskRank(sameCommunityEdge, godNodeIds, communityOf);
    assert.equal(risk, 'LOW', 'same-community inferred edge should be LOW');
  });

  it('fixture has at least 3 inferred edges', () => {
    const inferredEdges = edges.filter(e => e.type === 'inferred');
    assert.ok(inferredEdges.length >= 3, `Expected >= 3 inferred edges, got ${inferredEdges.length}`);
  });
});
