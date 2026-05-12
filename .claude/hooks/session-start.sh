#!/bin/bash
# SessionStart hook for itmlogic — runs in Claude Code on the web.
#
# Installs the Node dependencies needed by the genoa/ subproject (the
# active dev area: FCC Propagation Studio API + UI + sidecars).  The
# Python root is only the upstream Longley-Rice library and isn't
# touched during active work, so we skip it by default.
#
# Runs synchronously so the session starts with a known-good env —
# tests and linters won't race against a half-installed tree.
set -euo pipefail

# Only run inside Claude Code on the web; locally devs install their
# own deps (and we'd just stomp on whatever local state they have).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}/genoa"

# Prefer npm install over npm ci so the cached container state is
# reused across sessions — see Claude Code on the web caching docs.
# If package-lock.json drifts from package.json this will still
# succeed (npm ci would refuse).
npm install --no-audit --no-fund --loglevel=error
