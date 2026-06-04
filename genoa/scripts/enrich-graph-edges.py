import json
from pathlib import Path

GRAPH = Path("graphify-out/graph.json")

STRUCTURAL = {"calls","imports","imports_from","re_exports","inherits","implements","uses"}
SEMANTIC = {"references","rationale_for","conceptually_related_to","cites","semantically_similar_to","shares_data_with"}
METADATA = {"method"}

def edge_type(rel):
    if rel in STRUCTURAL: return "structural"
    if rel == "contains": return "containment"
    if rel in SEMANTIC: return "semantic"
    if rel in METADATA: return "metadata"
    return "other"

data = json.loads(GRAPH.read_text())

for link in data.get("links", []):
    rel = link.get("relation") or link.get("label")
    link["type"] = edge_type(rel)
    link["risk_relevant"] = link["type"] in {"structural", "semantic"}

GRAPH.write_text(json.dumps(data, indent=2))
print(f"updated {GRAPH}")
