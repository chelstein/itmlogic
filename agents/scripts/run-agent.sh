#!/usr/bin/env bash
# run-agent.sh — invoke a single named agent.  Honors token + compute budgets.
#
# Usage:
#   run-agent.sh <agent-name>
#
# In this build the actual LLM invocation is delegated to the operator's
# Claude Code on the web session — this script PREPARES the agent's
# working context and validates the budget, but doesn't auto-invoke
# a separate LLM provider.  When AGENT_RUNNER=claude-cli is set and
# the `claude` CLI is on PATH, it'll be invoked with the agent's prompt
# directly.

set -euo pipefail

AGENT="${1:?usage: run-agent.sh <agent-name>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT_DIR="${REPO_ROOT}/agents/${AGENT}"

if [[ ! -d "${AGENT_DIR}" ]]; then
  echo "ERROR: unknown agent '${AGENT}' (no dir at ${AGENT_DIR})" >&2
  exit 2
fi

# Stop-conditions check before we even start
"${REPO_ROOT}/agents/scripts/check-production-lock.sh" >/dev/null 2>&1 || {
  # locked: still allow report_only mode runs
  if [[ "${AGENT_DEPLOY_MODE:-pr_only}" == "safe_prod_write" ]]; then
    echo "[run-agent] production locked + mode=safe_prod_write — downgrading run to pr_only for this invocation"
    export AGENT_DEPLOY_MODE=pr_only
  fi
}

# Budget knobs (overridable per-agent via agent.md frontmatter)
MODE="${AGENT_TOKEN_MODE:-balanced}"
COMPUTE_MODE="${COMPUTE_MODE:-parallel_agents}"
RUN_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Skip if there are no git changes since the last run AND
# STOP_WHEN_NO_NEW_FINDINGS would fire
LAST_RUN_FILE="${AGENT_DIR}/.last-run-sha"
CUR_SHA=$(git -C "${REPO_ROOT}" rev-parse HEAD)
if [[ -f "${LAST_RUN_FILE}" ]]; then
  LAST_SHA=$(cat "${LAST_RUN_FILE}")
  if [[ "${LAST_SHA}" == "${CUR_SHA}" ]]; then
    echo "[run-agent] ${AGENT}: no commits since last run (${CUR_SHA:0:8}) — skipping"
    exit 0
  fi
fi

echo "[run-agent] ${AGENT}  mode=${MODE}  compute=${COMPUTE_MODE}  sha=${CUR_SHA:0:8}  at=${RUN_AT}"

# Render the working prompt: prepend the budget knobs + recent diff
CONTEXT_FILE="${REPO_ROOT}/agents/logs/${AGENT}-context-${RUN_AT//[:]/-}.md"
mkdir -p "$(dirname "${CONTEXT_FILE}")"
{
  echo "# Agent run context — ${AGENT} @ ${RUN_AT}"
  echo "AGENT_TOKEN_MODE=${MODE}"
  echo "COMPUTE_MODE=${COMPUTE_MODE}"
  echo "HEAD_SHA=${CUR_SHA}"
  echo
  echo "## Git diff since last run"
  echo '```diff'
  if [[ -f "${LAST_RUN_FILE}" ]]; then
    git -C "${REPO_ROOT}" diff "$(cat "${LAST_RUN_FILE}")"..HEAD | head -500
  else
    echo "(first run — no baseline diff)"
  fi
  echo '```'
  echo
  echo "## Agent definition"
  cat "${AGENT_DIR}/agent.md"
} > "${CONTEXT_FILE}"
echo "[run-agent] context prepared at ${CONTEXT_FILE}"

# If a CLI runner is configured, invoke it.  Otherwise emit instructions.
if [[ "${AGENT_RUNNER:-}" == "claude-cli" ]] && command -v claude >/dev/null 2>&1; then
  echo "[run-agent] invoking claude CLI…"
  claude --max-tokens "$(jq -r ".modes.${MODE}.max_output_tokens" "${REPO_ROOT}/agents/runtime/budget.json")" \
         --prompt-file "${CONTEXT_FILE}" \
         --write-output "${AGENT_DIR}/last-report.md"
  echo "${CUR_SHA}" > "${LAST_RUN_FILE}"
else
  echo "[run-agent] no AGENT_RUNNER configured."
  echo "  next step: have an operator-driven Claude session read ${CONTEXT_FILE}"
  echo "  and write findings to ${AGENT_DIR}/last-report.md in the AGENTS.md format."
fi
