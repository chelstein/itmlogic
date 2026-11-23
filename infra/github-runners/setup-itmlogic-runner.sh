#!/usr/bin/env bash
# Registers a self-hosted GitHub Actions runner for chelstein/itmlogic,
# mirroring the existing CBRE / mesyselfandi.website / SBE9 runners on
# this box.
#
# The registration token is NEVER hardcoded here. It is a short-lived
# (~1hr) one-time token from GitHub's UI — this script reads it from
# an env var you set right before running, or prompts for it
# interactively (hidden input, like a password) if you don't.
#
# Get a fresh token from:
#   https://github.com/chelstein/itmlogic/settings/actions/runners/new
#
# Usage:
#   sudo ./setup-itmlogic-runner.sh
#   # -> will prompt: "GitHub runner registration token: "
# or:
#   RUNNER_TOKEN=AXXXXXXXXXXXXXXXXXXXXXXXX sudo -E ./setup-itmlogic-runner.sh

set -euo pipefail

REPO_URL="https://github.com/chelstein/itmlogic"
RUNNER_USER="itmlogic-runner"
RUNNER_NAME="itmlogic-runner"
RUNNER_LABELS="itmlogic"
RUNNER_VERSION="2.338.2"
RUNNER_SHA256="baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo ./setup-itmlogic-runner.sh)." >&2
  exit 1
fi

# --- token: env var if set, otherwise prompt (never written to disk/history) ---
if [[ -z "${RUNNER_TOKEN:-}" ]]; then
  read -rsp "GitHub runner registration token (from ${REPO_URL}/settings/actions/runners/new): " RUNNER_TOKEN
  echo
fi
if [[ -z "${RUNNER_TOKEN}" ]]; then
  echo "No token provided — aborting." >&2
  exit 1
fi

# --- create the runner user if needed ---
id "${RUNNER_USER}" >/dev/null 2>&1 || useradd -m -s /bin/bash "${RUNNER_USER}"

RUNNER_HOME="/home/${RUNNER_USER}/actions-runner"
mkdir -p "${RUNNER_HOME}"
chown -R "${RUNNER_USER}:${RUNNER_USER}" "/home/${RUNNER_USER}"

# --- download + verify + extract, as the runner user ---
su - "${RUNNER_USER}" -c "
  set -euo pipefail
  cd '${RUNNER_HOME}'
  if [[ ! -x ./config.sh ]]; then
    curl -o actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz -L \
      https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
    echo '${RUNNER_SHA256}  actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz' | shasum -a 256 -c
    tar xzf actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
  fi
  ./config.sh --url '${REPO_URL}' --token '${RUNNER_TOKEN}' \
    --name '${RUNNER_NAME}' --labels '${RUNNER_LABELS}' --unattended --replace
"

# --- install + start as a systemd service (must run as root) ---
cd "${RUNNER_HOME}"
./svc.sh install "${RUNNER_USER}"
./svc.sh start
./svc.sh status

cat <<EOF

Done. Runner '${RUNNER_NAME}' registered for ${REPO_URL} with label '${RUNNER_LABELS}'.

Next step — in the itmlogic repo, Settings -> Secrets and variables ->
Actions -> Variables, add:

  RUNNER_LABELS = ["self-hosted","linux","itmlogic"]

That flips .github/workflows/agent-safe-prod-write.yml onto this runner.
EOF
