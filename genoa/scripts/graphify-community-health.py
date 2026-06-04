import json
from collections import defaultdict
from pathlib import Path

GRAPH = Path("graphify-out/graph.json")
OUT_JSON = Path("graphify-out/community_health.json")
OUT_MD = Path("graphify-out/COMMUNITY_HEALTH.md")

data = json.loads(GRAPH.read_text())

nodes = data.get("nodes", [])
links = data.get("links", [])

node_by_id = {n["id"]: n for n in nodes}

community_nodes = defaultdict(list)
for n in nodes:
    community_nodes[n.get("community", "unknown")].append(n)

stats = defaultdict(lambda: {
    "node_count": 0,
    "internal_edges": 0,
    "external_edges": 0,
    "structural_edges": 0,
    "containment_edges": 0,
    "semantic_edges": 0,
    "metadata_edges": 0,
    "inferred_edges": 0,
    "files": set(),
    "top_nodes": defaultdict(int),
})

for cid, ns in community_nodes.items():
    stats[cid]["node_count"] = len(ns)
    for n in ns:
        if n.get("source_file"):
            stats[cid]["files"].add(n["source_file"])

for e in links:
    src = node_by_id.get(e.get("source"))
    tgt = node_by_id.get(e.get("target"))
    if not src or not tgt:
        continue

    sc = src.get("community", "unknown")
    tc = tgt.get("community", "unknown")
    et = e.get("type", "unknown")

    for cid, node in [(sc, src), (tc, tgt)]:
        stats[cid]["top_nodes"][node.get("label") or node.get("id")] += 1

    target_stats = [sc] if sc == tc else [sc, tc]

    for cid in target_stats:
        if sc == tc:
            stats[cid]["internal_edges"] += 1
        else:
            stats[cid]["external_edges"] += 1

        if et == "structural":
            stats[cid]["structural_edges"] += 1
        elif et == "containment":
            stats[cid]["containment_edges"] += 1
        elif et == "semantic":
            stats[cid]["semantic_edges"] += 1
        elif et == "metadata":
            stats[cid]["metadata_edges"] += 1

        if e.get("confidence") == "INFERRED":
            stats[cid]["inferred_edges"] += 1

rows = []
for cid, s in stats.items():
    node_count = s["node_count"]
    internal = s["internal_edges"]
    external = s["external_edges"]
    structural = s["structural_edges"]
    inferred = s["inferred_edges"]

    possible_internal = max(1, node_count * (node_count - 1))
    cohesion = round(internal / possible_internal, 6)

    risk_score = (
        structural * 3
        + inferred * 5
        + external * 2
        + max(0, node_count - 25)
        - int(cohesion * 10)
    )

    top_nodes = sorted(
        s["top_nodes"].items(),
        key=lambda kv: kv[1],
        reverse=True
    )[:5]

    rows.append({
        "community": cid,
        "node_count": node_count,
        "internal_edges": internal,
        "external_edges": external,
        "structural_edges": structural,
        "containment_edges": s["containment_edges"],
        "semantic_edges": s["semantic_edges"],
        "metadata_edges": s["metadata_edges"],
        "inferred_edges": inferred,
        "file_count": len(s["files"]),
        "cohesion": cohesion,
        "risk_score": risk_score,
        "top_nodes": [{"label": k, "degree": v} for k, v in top_nodes],
        "sample_files": sorted(s["files"])[:8],
    })

rows.sort(key=lambda r: (r["risk_score"], r["structural_edges"], r["node_count"]), reverse=True)

OUT_JSON.write_text(json.dumps(rows, indent=2))

lines = []
lines.append("# Community Health Report")
lines.append("")
lines.append("Communities ranked by structural coupling, inferred edges, external dependencies, size, and cohesion.")
lines.append("")
lines.append("| Rank | Community | Risk | Nodes | Structural | Inferred | External | Cohesion | Top nodes |")
lines.append("|---:|---:|---:|---:|---:|---:|---:|---:|---|")

for i, r in enumerate(rows[:30], 1):
    tops = ", ".join(f"`{n['label']}`" for n in r["top_nodes"][:3])
    lines.append(
        f"| {i} | {r['community']} | {r['risk_score']} | {r['node_count']} | "
        f"{r['structural_edges']} | {r['inferred_edges']} | {r['external_edges']} | "
        f"{r['cohesion']} | {tops} |"
    )

lines.append("")
lines.append("## Interpretation")
lines.append("")
lines.append("- High structural count = architecture-critical subsystem.")
lines.append("- High inferred count = verification risk.")
lines.append("- High external count = cross-community coupling.")
lines.append("- Low cohesion with many nodes may indicate a broad or poorly separated module.")
lines.append("")

OUT_MD.write_text("\n".join(lines))
print(f"wrote {OUT_JSON}")
print(f"wrote {OUT_MD}")
