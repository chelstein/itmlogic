#!/usr/bin/env bash
set -euo pipefail

cd /opt/itmlogic/genoa
source .venv/bin/activate

graphify update .
python scripts/enrich-graph-edges.py

rsync -av graphify-out/ /opt/genoa-cartography/data/reference/
cp graphify-out/graph.json /opt/genoa-cartography/data/reference/genoa_graph.json

jq '.links | group_by(.type) | map({type: .[0].type, count: length}) | sort_by(.count) | reverse' /opt/genoa-cartography/data/reference/genoa_graph.json
