import json
from collections import defaultdict
from pathlib import Path

GRAPH = Path("graphify-out/graph.json")
OUT_JSON = Path("graphify-out/god_nodes.json")
OUT_MD = Path("graphify-out/GOD_NODE_RISK.md")

data = json.loads(GRAPH.read_text())

nodes = {n["id"]: n for n in data.get("nodes", [])}
stats = defaultdict(lambda: {
    "degree": 0,
    "fan_in": 0,
    "fan_out": 0,
    "structural_edges": 0,
    "containment_edges": 0,
    "semantic_edges": 0,
    "metadata_edges": 0,
    "inferred_edges": 0,
    "communities_touched": set(),
    "files_touched": set(),
})

def bump(node_id, key, edge, other_id):
    if node_id not in nodes:
        return

    s = stats[node_id]
    n = nodes[node_id]
    other = nodes.get(other_id, {})

    s["degree"] += 1
    s[key] += 1

    edge_type = edge.get("type") or "unknown"
    if edge_type == "structural":
        s["structural_edges"] += 1
    elif edge_type == "containment":
        s["containment_edges"] += 1
    elif edge_type == "semantic":
        s["semantic_edges"] += 1
    elif edge_type == "metadata":
        s["metadata_edges"] += 1

    if edge.get("confidence") == "INFERRED":
        s["inferred_edges"] += 1

    if n.get("community") is not None:
        s["communities_touched"].add(n.get("community"))
    if other.get("community") is not None:
        s["communities_touched"].add(other.get("community"))

    if n.get("source_file"):
        s["files_touched"].add(n.get("source_file"))
    if other.get("source_file"):
        s["files_touched"].add(other.get("source_file"))

for e in data.get("links", []):
    src = e.get("source")
    tgt = e.get("target")
    bump(src, "fan_out", e, tgt)
    bump(tgt, "fan_in", e, src)

rows = []
for node_id, s in stats.items():
    n = nodes[node_id]
    communities_touched = len(s["communities_touched"])
    files_touched = len(s["files_touched"])

    risk_score = (
        s["structural_edges"] * 3
        + s["semantic_edges"] * 2
        + s["inferred_edges"] * 4
        + communities_touched * 2
        + max(0, s["degree"] - 20)
    )

    rows.append({
        "id": node_id,
        "label": n.get("label") or node_id,
        "source_file": n.get("source_file"),
        "community": n.get("community"),
        "degree": s["degree"],
        "fan_in": s["fan_in"],
        "fan_out": s["fan_out"],
        "structural_edges": s["structural_edges"],
        "containment_edges": s["containment_edges"],
        "semantic_edges": s["semantic_edges"],
        "metadata_edges": s["metadata_edges"],
        "inferred_edges": s["inferred_edges"],
        "communities_touched": communities_touched,
        "files_touched": files_touched,
        "risk_score": risk_score,
    })

rows.sort(key=lambda r: (r["risk_score"], r["degree"]), reverse=True)
top = rows[:25]

OUT_JSON.write_text(json.dumps(top, indent=2))

lines = []
lines.append("# God Node Risk Report")
lines.append("")
lines.append("Top 25 nodes ranked by structural fan-in/fan-out, inferred edges, cross-community reach, and total degree.")
lines.append("")
lines.append("| Rank | Node | Risk | Degree | Structural | Inferred | Communities | File |")
lines.append("|---:|---|---:|---:|---:|---:|---:|---|")

for i, r in enumerate(top, 1):
    lines.append(
        f"| {i} | `{r['label']}` | {r['risk_score']} | {r['degree']} | "
        f"{r['structural_edges']} | {r['inferred_edges']} | {r['communities_touched']} | "
        f"`{r.get('source_file') or ''}` |"
    )

lines.append("")
lines.append("## Interpretation")
lines.append("")
lines.append("- High structural edges = architecture-critical.")
lines.append("- High inferred edges = verification risk.")
lines.append("- High community count = cross-system coupling.")
lines.append("- Containment-heavy nodes may be navigation hubs rather than true risk.")
lines.append("")

OUT_MD.write_text("\n".join(lines))
print(f"wrote {OUT_JSON}")
print(f"wrote {OUT_MD}")
