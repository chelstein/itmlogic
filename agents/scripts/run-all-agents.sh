#!/usr/bin/env bash
# run-all-agents.sh — invoke every agent in the order defined by
# agents/runtime/compute-budget.json parallelism_rules.
#
# Concurrent groups run in parallel; serialized agents wait for all
# parallel groups to drain before starting.
#
# Usage:
#   run-all-agents.sh                       # one full pass
#   run-all-agents.sh --since-deploy        # only agents that depend on prod state

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${REPO_ROOT}/agents/scripts/run-agent.sh"
RULES="${REPO_ROOT}/agents/runtime/compute-budget.json"

# Parallel groups
GROUPS_COUNT=$(jq '.parallelism_rules.concurrent_groups | length' "${RULES}")
echo "[run-all] ${GROUPS_COUNT} concurrent groups + serialized tail"

for ((G=0; G<GROUPS_COUNT; G++)); do
  GROUP=$(jq -r ".parallelism_rules.concurrent_groups[$G][]" "${RULES}")
  echo "[run-all] group $((G+1))/${GROUPS_COUNT}: ${GROUP//$'\n'/ }"
  PIDS=()
  for AGENT in ${GROUP}; do
    "${RUNNER}" "${AGENT}" &
    PIDS+=($!)
  done
  # Wait for the group to drain before moving to the next group
  EXIT=0
  for PID in "${PIDS[@]}"; do
    wait "${PID}" || EXIT=$?
  done
  if (( EXIT != 0 )); then
    echo "[run-all] group $((G+1)) had failures (exit ${EXIT}) — continuing to next group"
  fi
done

# Serialized tail (technical-pmp, program-director)
TAIL=$(jq -r '.parallelism_rules.serialized_after_all[]' "${RULES}")
for AGENT in ${TAIL}; do
  echo "[run-all] serialized: ${AGENT}"
  "${RUNNER}" "${AGENT}"
done

# After all agents, dedupe + file issues
"${REPO_ROOT}/agents/scripts/create-issues-from-findings.sh"
echo "[run-all] full agent pass complete"
