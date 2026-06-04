import json
from pathlib import Path
from collections import Counter

GRAPH = Path("graphify-out/graph.json")
OUT_MD = Path("graphify-out/INFERRED_EDGE_REVIEW.md")
OUT_JSON = Path("graphify-out/inferred_edges.json")

FOCUS_FILES = {
    "src/api/services/exhibitService.js",
    "src/api/services/enrichTowerEvidence.js",
}

data = json.loads(GRAPH.read_text())

edges = [
    e for e in data.get("links", [])
    if e.get("confidence") == "INFERRED"
]

focus_edges = [
    e for e in edges
    if e.get("source_file") in FOCUS_FILES
]

by_file = Counter(e.get("source_file") or "unknown" for e in edges)

OUT_JSON.write_text(json.dumps({
    "total_inferred_edges": len(edges),
    "focus_inferred_edges": len(focus_edges),
    "by_file": dict(by_file.most_common()),
    "focus_edges": focus_edges,
}, indent=2))

lines = [
    "# Inferred Edge Review",
    "",
    f"Total inferred edges: {len(edges)}",
    f"Focused exhibit-pipeline inferred edges: {len(focus_edges)}",
    "",
    "## Inferred edges by file",
    "",
]

for file, count in by_file.most_common():
    lines.append(f"- `{file}`: {count}")

lines += [
    "",
    "## Focus: Exhibit Pipeline",
    "",
    "Files:",
    "- `src/api/services/exhibitService.js`",
    "- `src/api/services/enrichTowerEvidence.js`",
    "",
]

for e in focus_edges:
    lines.append(
        f"- `{e.get('source_file')}:{e.get('source_location') or ''}` "
        f"`{e.get('source')}` --{e.get('relation')}--> `{e.get('target')}`"
    )

OUT_MD.write_text("\n".join(lines))
print(f"wrote {OUT_JSON}")
print(f"wrote {OUT_MD}")
