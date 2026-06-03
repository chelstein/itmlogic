#!/usr/bin/env node
// Graphify CLI — graph analysis tool for the Genoa codebase
import { loadGraph } from './src/loader.js';
import { runSurface, SURFACES } from './src/surfaces.js';
import { runGodNodes } from './src/godNodes.js';
import { runWeakNodes } from './src/weakNodes.js';
import { runDrift } from './src/drift.js';
import { runAuditPacket } from './src/auditPacket.js';

const USAGE = `
Graphify — Genoa graph analysis CLI

Usage:
  graphify surface <name>
  graphify god-nodes
  graphify weak-nodes
  graphify drift
  graphify audit-packet <surface> [--budget <n>]
  graphify all

Options:
  --graph <path>     local path to global_graph.json
  --out <dir>        output directory (default: graphify-out)
  --budget <n>       token budget for audit-packet (default: 20000)

Valid surfaces: ${Object.keys(SURFACES).join(', ')}
`.trim();

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    command: null,
    commandArg: null,
    graph: null,
    out: 'graphify-out',
    budget: 20_000,
  };

  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--graph') {
      opts.graph = args[++i];
    } else if (a === '--out') {
      opts.out = args[++i];
    } else if (a === '--budget') {
      opts.budget = parseInt(args[++i], 10);
    } else if (!opts.command) {
      opts.command = a;
    } else if (!opts.commandArg) {
      opts.commandArg = a;
    }
    i++;
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.command || opts.command === '--help' || opts.command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  console.log(`[graphify] Loading graph...`);
  let graph;
  try {
    graph = await loadGraph({ graphPath: opts.graph, outDir: opts.out });
    console.log(`[graphify] Loaded ${graph.nodes.size} nodes, ${graph.edges.length} edges from ${graph.source}`);
  } catch (e) {
    console.error(`[graphify] ERROR: ${e.message}`);
    process.exit(1);
  }

  const outDir = opts.out;

  try {
    switch (opts.command) {
      case 'surface': {
        if (!opts.commandArg) {
          console.error(`[graphify] ERROR: surface command requires a surface name.`);
          console.error(`  Valid surfaces: ${Object.keys(SURFACES).join(', ')}`);
          process.exit(1);
        }
        const result = runSurface(opts.commandArg, graph, outDir);
        console.log(`[graphify] Wrote ${result.mdPath}`);
        console.log(`[graphify] Wrote ${result.jsonPath}`);
        break;
      }

      case 'god-nodes': {
        const result = runGodNodes(graph, outDir);
        console.log(`[graphify] Wrote ${result.mdPath}`);
        break;
      }

      case 'weak-nodes': {
        const result = runWeakNodes(graph, outDir);
        console.log(`[graphify] Wrote ${result.mdPath}`);
        break;
      }

      case 'drift': {
        const result = runDrift(graph, outDir);
        console.log(`[graphify] Wrote ${result.mdPath}`);
        console.log(`[graphify] Saved metrics to ${result.metricsFile}`);
        break;
      }

      case 'audit-packet': {
        if (!opts.commandArg) {
          console.error(`[graphify] ERROR: audit-packet command requires a surface name.`);
          console.error(`  Valid surfaces: ${Object.keys(SURFACES).join(', ')}`);
          process.exit(1);
        }
        const result = runAuditPacket(opts.commandArg, graph, outDir, opts.budget);
        console.log(`[graphify] Wrote ${result.mdPath} (~${result.tokens} tokens)`);
        break;
      }

      case 'all': {
        console.log('[graphify] Running all analyses...');

        // god-nodes
        const godResult = runGodNodes(graph, outDir);
        console.log(`[graphify] god-nodes → ${godResult.mdPath}`);

        // weak-nodes
        const weakResult = runWeakNodes(graph, outDir);
        console.log(`[graphify] weak-nodes → ${weakResult.mdPath}`);

        // drift
        const driftResult = runDrift(graph, outDir);
        console.log(`[graphify] drift → ${driftResult.mdPath}`);

        // surfaces
        for (const surfaceName of Object.keys(SURFACES)) {
          try {
            const surfResult = runSurface(surfaceName, graph, outDir);
            console.log(`[graphify] surface:${surfaceName} → ${surfResult.mdPath}`);
          } catch (e) {
            console.warn(`[graphify] WARN surface:${surfaceName} failed: ${e.message}`);
          }
        }

        // audit packets
        for (const surfaceName of Object.keys(SURFACES)) {
          try {
            const apResult = runAuditPacket(surfaceName, graph, outDir, opts.budget);
            console.log(`[graphify] audit-packet:${surfaceName} → ${apResult.mdPath}`);
          } catch (e) {
            console.warn(`[graphify] WARN audit-packet:${surfaceName} failed: ${e.message}`);
          }
        }

        break;
      }

      default:
        console.error(`[graphify] Unknown command: ${opts.command}`);
        console.error(USAGE);
        process.exit(1);
    }
  } catch (e) {
    console.error(`[graphify] ERROR: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
}

main();
