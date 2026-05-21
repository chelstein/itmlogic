#!/usr/bin/env bash
# create-issues-from-findings.sh — read each agent's last-report.md, parse
# the JSON findings block, dedupe against agents/state/findings-dedup.json,
# and file GitHub issues for genuinely-new findings.
#
# Expected last-report.md format:
#   ## Findings (JSON)
#   ```json
#   [
#     {
#       "severity": "BLOCKER|WARNING|INFO",
#       "confidence": 0.0-1.0,
#       "affected_files": ["path/to/file.js"],
#       "recommended_fix": "...",
#       "tests_required": ["..."],
#       "deployment_risk": "low|medium|high",
#       "human_review_required": true|false,
#       "reproducibility_notes": "...",
#       "title": "short title for the issue"
#     }
#   ]
#   ```
#
# Skips silently when GITHUB_TOKEN unset (so it's safe in local CI dry-runs).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEDUP="${REPO_ROOT}/agents/state/findings-dedup.json"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "[create-issues] GITHUB_TOKEN unset — skipping issue creation, dedup tracking still updated"
fi

for AGENT_DIR in "${REPO_ROOT}/agents/"*/; do
  [[ -d "${AGENT_DIR}" ]] || continue
  AGENT=$(basename "${AGENT_DIR}")
  REPORT="${AGENT_DIR}last-report.md"
  [[ -f "${REPORT}" ]] || continue

  # Extract the JSON block between ```json and ```
  JSON=$(sed -n '/^```json/,/^```/p' "${REPORT}" | sed '1d;$d')
  [[ -n "${JSON}" ]] || continue
  # Validate
  if ! echo "${JSON}" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "[create-issues] ${AGENT}: malformed JSON, skipping"
    continue
  fi

  COUNT=$(echo "${JSON}" | jq 'length')
  echo "[create-issues] ${AGENT}: ${COUNT} findings"

  echo "${JSON}" | jq -c '.[]' | while read -r FINDING; do
    TITLE=$(echo "${FINDING}" | jq -r '.title')
    SEV=$(echo "${FINDING}" | jq -r '.severity')
    FILES=$(echo "${FINDING}" | jq -r '.affected_files | sort | join(",")')
    FIX_TITLE=$(echo "${FINDING}" | jq -r '.recommended_fix' | head -c 80)
    DEDUP_KEY=$(printf "%s|%s|%s" "${SEV}" "${FILES}" "${FIX_TITLE}" | shasum -a 256 | awk '{print $1}')

    # Dedup lookup
    ALREADY=$(jq --arg k "${DEDUP_KEY}" '.findings[$k] // null' "${DEDUP}")
    if [[ "${ALREADY}" != "null" ]]; then
      # Bump seen_count, update last_seen
      TMP=$(mktemp)
      jq --arg k "${DEDUP_KEY}" --arg t "${NOW}" \
         '.findings[$k].seen_count += 1 | .findings[$k].last_seen = $t' \
         "${DEDUP}" > "${TMP}"
      mv "${TMP}" "${DEDUP}"
      continue
    fi

    # Record + file
    TMP=$(mktemp)
    jq --arg k "${DEDUP_KEY}" --arg t "${NOW}" --arg a "${AGENT}" --arg ti "${TITLE}" \
       '.findings[$k] = {agent:$a, title:$ti, first_seen:$t, last_seen:$t, seen_count:1}' \
       "${DEDUP}" > "${TMP}"
    mv "${TMP}" "${DEDUP}"

    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
      LABEL=$(echo "${SEV}" | tr '[:upper:]' '[:lower:]')
      BODY=$(echo "${FINDING}" | jq -r '
        "**Severity:** \(.severity)\n" +
        "**Confidence:** \(.confidence)\n" +
        "**Reported by:** '"${AGENT}"'\n\n" +
        "## Affected files\n" + (.affected_files | map("- `\(.)`") | join("\n")) + "\n\n" +
        "## Recommended fix\n\(.recommended_fix)\n\n" +
        "## Tests required\n" + (.tests_required | map("- \(.)") | join("\n")) + "\n\n" +
        "**Deployment risk:** \(.deployment_risk)\n" +
        "**Human review required:** \(.human_review_required)\n\n" +
        "## Reproducibility\n\(.reproducibility_notes)\n"
      ')
      curl -fsS \
        -X POST \
        -H "Authorization: token ${GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github.v3+json" \
        -d "$(jq -n --arg t "${TITLE}" --arg b "${BODY}" --arg l "${LABEL}" --arg a "${AGENT}" \
            '{title:$t, body:$b, labels:["agent-finding", $l, ("agent/" + $a)]}')" \
        "https://api.github.com/repos/chelstein/itmlogic/issues" \
        > /tmp/issue-resp.json
      ISSUE_NUMBER=$(jq -r '.number' /tmp/issue-resp.json)
      echo "  filed #${ISSUE_NUMBER}: ${TITLE}"
    fi
  done
done
echo "[create-issues] done"
