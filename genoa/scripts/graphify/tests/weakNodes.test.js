import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { normalizeGraph } from '../src/loader.js';
import { buildDegreeMap } from '../src/metrics.js';
import { classifyWeakNode, CATEGORIES } from '../src/weakNodes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'small_graph.json');

function loadFixture() {
  const parsed = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  return normalizeGraph(parsed);
}

describe('weakNodes', () => {
  let nodes, edges;

  before(() => {
    ({ nodes, edges } = loadFixture());
  });

  it('CATEGORIES contains all expected categories', () => {
    assert.deepEqual(CATEGORIES, [
      'docs-only',
      'config-env',
      'test-only',
      'external-schema',
      'exported-unused',
      'possible-missing-edge',
    ]);
  });

  it('classifyWeakNode: docs-only for .md file', () => {
    const node = { id: 'README', file: 'README.md' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'docs-only');
  });

  it('classifyWeakNode: docs-only for /docs/ path', () => {
    const node = { id: 'someDoc', file: 'src/docs/overview.txt' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'docs-only');
  });

  it('classifyWeakNode: docs-only for id containing README', () => {
    const node = { id: 'README-guide', file: null };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'docs-only');
  });

  it('classifyWeakNode: config-env for .json file', () => {
    const node = { id: 'config.json', file: 'src/config/app.json' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'config-env');
  });

  it('classifyWeakNode: config-env for .env file', () => {
    const node = { id: 'dotenv', file: '.env' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'config-env');
  });

  it('classifyWeakNode: config-env for /config/ path', () => {
    const node = { id: 'appConfig', file: 'src/config/settings.js' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'config-env');
  });

  it('classifyWeakNode: test-only for .test.js file', () => {
    const node = { id: 'auth.test.js', file: 'src/tests/auth.test.js' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'test-only');
  });

  it('classifyWeakNode: test-only for /tests/ path', () => {
    const node = { id: 'someTest', file: 'src/tests/utils.js' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'test-only');
  });

  it('classifyWeakNode: test-only for /__golden__/ path (non-json file)', () => {
    // .json files match config-env first per the spec ordering; use a .js file to test test-only via __golden__
    const node = { id: 'goldenOutput', file: 'src/__golden__/output.js' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'test-only');
  });

  it('classifyWeakNode: test-only for /fixtures/ path (non-json file)', () => {
    // .json files match config-env first per the spec ordering; use a .js file to test test-only via fixtures
    const node = { id: 'fixture1', file: 'tests/fixtures/data.js' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'test-only');
  });

  it('classifyWeakNode: external-schema for null file', () => {
    const node = { id: 'extern::Schema', file: null };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'external-schema');
  });

  it('classifyWeakNode: external-schema for id containing ::', () => {
    const node = { id: 'pkg::Module', file: 'some/external/path.js' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'external-schema');
  });

  it('classifyWeakNode: external-schema for file not starting with src/ or genoa/', () => {
    const node = { id: 'npmPkg', file: 'node_modules/pdfkit/index.js' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'external-schema');
  });

  it('classifyWeakNode: exported-unused for in=0 out>0', () => {
    const node = { id: 'exportedUnused', file: 'src/api/utils/unused.js' };
    const degrees = { in: 0, out: 1 };
    assert.equal(classifyWeakNode(node, degrees), 'exported-unused');
  });

  it('classifyWeakNode: possible-missing-edge for src/ file with no special category', () => {
    const node = { id: 'possibleMissing', file: 'src/api/utils/helper.js' };
    const degrees = { in: 0, out: 0 };
    assert.equal(classifyWeakNode(node, degrees), 'possible-missing-edge');
  });

  it('fixture has nodes matching each category', () => {
    const degreeMap = buildDegreeMap(nodes, edges);
    const weakNodes = [...degreeMap.entries()]
      .filter(([, d]) => d.total <= 1)
      .map(([id, degrees]) => ({ id, node: nodes.get(id), degrees }));

    const categories = new Set(weakNodes.map(w => classifyWeakNode(w.node, w.degrees)));

    // We expect docs-only (README), config-env (config.json), test-only (auth.test.js),
    // external-schema (extern::Schema), exported-unused (exportedUnused), possible-missing-edge (possibleMissing)
    assert.ok(categories.has('docs-only'), 'should have docs-only');
    assert.ok(categories.has('config-env'), 'should have config-env');
    assert.ok(categories.has('test-only'), 'should have test-only');
    assert.ok(categories.has('external-schema'), 'should have external-schema');
    assert.ok(categories.has('exported-unused'), 'should have exported-unused');
    assert.ok(categories.has('possible-missing-edge'), 'should have possible-missing-edge');
  });
});
