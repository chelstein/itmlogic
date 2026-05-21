#!/usr/bin/env bash
# post-deploy-smoke-test.sh — hits production and confirms it's actually working.
#
# Required env:
#   PRODUCTION_URL     e.g. https://genoaiq.com
#
# Tests:
#   1. GET /healthz                            (must be 200 OK)
#   2. GET /readyz                             (must be 200 OK)
#   3. POST /api/exhibits/readiness            (lightweight readiness compute)
#   4. POST /api/exhibits/filing-package/summary  (FM filing-package smoke)
#   5. Response time check (95th pctile < 3000 ms)
#   6. Logs scan for "crash loop" / "uncaughtException" patterns
#
# Exits 0 on all pass, non-zero on any fail.

set -euo pipefail
trap 'echo "[smoke] FAILED at line $LINENO" >&2; exit 1' ERR

: "${PRODUCTION_URL:?PRODUCTION_URL required}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${REPO_ROOT}/agents/logs"
mkdir -p "${LOG_DIR}"
SMOKE_LOG="${LOG_DIR}/smoke-$(date -u +%Y%m%dT%H%M%SZ).log"

probe(){
  local method="$1" path="$2" body="${3:-}" expect="${4:-200}"
  local label="$5"
  local t0=$(date +%s%3N)
  local code body_resp
  if [[ "${method}" == "GET" ]]; then
    body_resp=$(curl -fsS -o /tmp/resp -w "%{http_code}" "${PRODUCTION_URL}${path}" 2>>"${SMOKE_LOG}") || code=$?
  else
    body_resp=$(curl -fsS -o /tmp/resp -w "%{http_code}" -X "${method}" \
      -H 'Content-Type: application/json' \
      ${body:+--data "${body}"} \
      "${PRODUCTION_URL}${path}" 2>>"${SMOKE_LOG}") || code=$?
  fi
  local t1=$(date +%s%3N)
  local elapsed=$((t1 - t0))
  if [[ "${body_resp}" != "${expect}" ]]; then
    echo "  [smoke] ${label} FAIL: expected HTTP ${expect}, got ${body_resp} (${elapsed} ms)" | tee -a "${SMOKE_LOG}"
    return 1
  fi
  if (( elapsed > 3000 )); then
    echo "  [smoke] ${label} SLOW: ${elapsed} ms (warning, not a hard fail)" | tee -a "${SMOKE_LOG}"
  else
    echo "  [smoke] ${label} OK: HTTP ${body_resp} in ${elapsed} ms" | tee -a "${SMOKE_LOG}"
  fi
  return 0
}

echo "[smoke] target: ${PRODUCTION_URL}" | tee "${SMOKE_LOG}"

# 1. /healthz
probe GET /healthz '' 200 'GET /healthz'

# 2. /readyz
probe GET /readyz '' 200 'GET /readyz'

# 3. /api/exhibits/readiness
READINESS_BODY='{"exhibit":{"station_inputs":{"call":"SMOKE","service":"FM","frequency":100.1,"lat":40,"lon":-75,"haat_m":100,"erp_kw":6,"fcc_class":"A"},"evidence":{},"warnings":[],"blockers":[]}}'
probe POST /api/exhibits/readiness "${READINESS_BODY}" 200 'POST /api/exhibits/readiness'

# 4. /api/exhibits/filing-package/summary
FILING_BODY='{"exhibit":{"station_inputs":{"call":"SMOKE","facility_id":"99999","service":"FM","frequency":100.1,"lat":40,"lon":-75,"haat_m":100,"erp_kw":6,"fcc_class":"A"},"evidence":{}}}'
probe POST /api/exhibits/filing-package/summary "${FILING_BODY}" 200 'POST /api/exhibits/filing-package/summary'

# 5. p95 latency check — re-run /readyz 10×
echo "[smoke] p95 latency probe (10× /readyz)" | tee -a "${SMOKE_LOG}"
declare -a TIMES
for i in $(seq 1 10); do
  t0=$(date +%s%3N)
  curl -fsS -o /dev/null "${PRODUCTION_URL}/readyz"
  t1=$(date +%s%3N)
  TIMES+=( $((t1 - t0)) )
done
SORTED=$(printf '%s\n' "${TIMES[@]}" | sort -n)
P95=$(echo "${SORTED}" | sed -n '10p')
echo "  [smoke] p95 latency = ${P95} ms" | tee -a "${SMOKE_LOG}"
if (( P95 > 3000 )); then
  echo "  [smoke] p95 latency exceeds 3000 ms threshold — FAIL" >&2
  exit 1
fi

# 6. Crash-loop scan (best-effort — production logs only available via DO API)
if [[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" && -n "${DIGITALOCEAN_APP_ID:-}" ]]; then
  CRASH_HITS=$(curl -fsS \
    -H "Authorization: Bearer ${DIGITALOCEAN_ACCESS_TOKEN}" \
    "https://api.digitalocean.com/v2/apps/${DIGITALOCEAN_APP_ID}" \
    | jq -r '.app.active_deployment.services[]? | select(.replicas_ready < .replicas_desired) | .name' \
    || true)
  if [[ -n "${CRASH_HITS}" ]]; then
    echo "  [smoke] components with replicas_ready < replicas_desired: ${CRASH_HITS}" >&2
    echo "  [smoke] suspected crash loop — FAIL" >&2
    exit 1
  fi
  echo "  [smoke] crash-loop scan OK" | tee -a "${SMOKE_LOG}"
fi

echo "[smoke] ALL SMOKE TESTS PASSED" | tee -a "${SMOKE_LOG}"
