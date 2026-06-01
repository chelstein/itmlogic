# Graph Audit Prompt — Genoa Evidence Pipeline

## Instructions

Read `graphify-out/GRAPH_REPORT.md` first to understand the full dependency graph
before issuing any code-level verdicts.

Then perform the audit described below.

---

## Audit Scope

Audit the following three entry points and every module they transitively reach:

- `computeExhibit()` in `src/api/services/exhibitService.js`
- `buildEngineeringReport()` (wherever it is defined — search the graph first)
- `renderNarrative()` in `src/narrative/generator.js`

---

## What to Find

For each of the following evidence/analysis systems, determine whether it is:

1. **Fully wired** — the system produces output that reaches the final engineering report
   and/or the narrative via a direct dependency path.
2. **Partially wired** — the system runs and produces output, but the output is silently
   dropped before reaching `buildEngineeringReport()` or `renderNarrative()`.
3. **Orphaned** — the system exists in the codebase but has no dependency path to the
   exhibit entry points above.  Its output never reaches the report.
4. **Missing** — the system is referenced in comments or configuration but not yet
   implemented.

Systems to classify:

| System | Key function / module |
|--------|----------------------|
| County boundary analysis | `computeCountyOverlay()` in `countyIntersectionClient.js` |
| M3 conductivity | `conductivityEvidence` / `m3Client` or equivalent |
| FCC Ground Wave (FCCGW) | `fccgwClient.js` or `fortranFccClient.js` |
| AM physics (SOMNEC2D) | `amPhysicsClient.js` |
| MPE / OET-65 | `mpeClient.js` or equivalent |
| EAS evidence | `easClient.js` or equivalent |

---

## For each orphaned or partially-wired system, report:

1. **Where it breaks**: the last node in the graph that has a path to the final report,
   and the first node that does not.
2. **What is missing**: the specific call site, import, or field assignment that would
   close the gap.
3. **Severity**: blocker (the FCC exhibit is incomplete without it) vs. advisory
   (evidence is informational).
4. **Suggested fix**: one-sentence code-level recommendation.

---

## Output format

```
## County Boundary Analysis
Status: [FULLY WIRED | PARTIALLY WIRED | ORPHANED | MISSING]
Break point: ...
Missing: ...
Severity: ...
Fix: ...

## M3 Conductivity
...
```

---

## Additional checks

After classifying the six systems above, scan the graph for any other nodes that:

- Have `out_degree == 0` (no dependents) but are NOT leaf output nodes
  (i.e., they are not PDF exporters, JSON serializers, or API response handlers)
- Have `in_degree == 0` (no dependencies) but are NOT top-level entry points
  (i.e., they are not `server.js`, `worker.js`, or CLI scripts)

List those as **orphan candidates** with a one-line description of what they do
and whether they look intentional or like a forgotten wire-up.

---

## Graph API commands available

The Graph Atlas is live at `/api/atlas/*`.  You can use these during the audit:

```
GET /api/atlas/search?q=county          — find county-related nodes
GET /api/atlas/explain?node=computeExhibit()  — show immediate in/out edges
GET /api/atlas/affected?node=computeCountyOverlay()  — show all downstream nodes
GET /api/atlas/stats                    — confirm graph is loaded
```
