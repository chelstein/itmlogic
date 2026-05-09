#!/usr/bin/env bash
# Wire Genoa's env vars into the live App Platform deployment.
#
# Reads the THREE secrets from your shell environment and sets the FIVE
# non-secret config defaults inline. Splices them into the live App
# Platform spec for service "itmlogic" (component name on the live
# seahorse-app), applies the spec, and triggers a deploy.
#
# Secrets never touch git or this file: they live in your shell for the
# duration of this script and in DO's encrypted metadata afterwards.
#
# Prerequisites:
#   doctl   (https://docs.digitalocean.com/reference/doctl/)
#   doctl auth init
#   python3 with PyYAML (pip install pyyaml)
#
# Usage:
#   export DATABASE_URL='postgresql://doadmin:<password>@<host>:25060/defaultdb?sslmode=require'
#   export SPACES_KEY='<key-id>'
#   export SPACES_SECRET='<secret>'
#   bash genoa/scripts/wire-env.sh
#
# Optional overrides (defaults shown):
#   export APP_NAME=seahorse-app
#   export COMPONENT=itmlogic
#   export SPACES_BUCKET=ztrps
#   export SPACES_REGION=sfo3
#   export SPACES_ENDPOINT=https://sfo3.digitaloceanspaces.com

set -euo pipefail

APP_NAME="${APP_NAME:-seahorse-app}"
COMPONENT="${COMPONENT:-itmlogic}"
SPACES_BUCKET="${SPACES_BUCKET:-ztrps}"
SPACES_REGION="${SPACES_REGION:-sfo3}"
SPACES_ENDPOINT="${SPACES_ENDPOINT:-https://sfo3.digitaloceanspaces.com}"

: "${DATABASE_URL:?DATABASE_URL required (export it before running)}"
: "${SPACES_KEY:?SPACES_KEY required}"
: "${SPACES_SECRET:?SPACES_SECRET required}"

export DATABASE_URL SPACES_KEY SPACES_SECRET
export APP_NAME COMPONENT SPACES_BUCKET SPACES_REGION SPACES_ENDPOINT

command -v doctl   >/dev/null || { echo "doctl not found"; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found"; exit 1; }

# Resolve APP_ID
APP_ID="${APP_ID:-$(doctl apps list --format ID,Spec.Name --no-header \
                   | awk -v n="$APP_NAME" '$2==n{print $1}')}"
if [[ -z "${APP_ID:-}" ]]; then
  echo "!! could not find app named '$APP_NAME' — set APP_ID env or APP_NAME"; exit 1
fi
export APP_ID
echo "→ APP_ID=$APP_ID  (app=$APP_NAME, component=$COMPONENT)"

tmp=$(mktemp -t genoa-spec.XXXXXX)
trap 'rm -f "$tmp"' EXIT

echo "→ fetching current app spec"
doctl apps spec get "$APP_ID" > "$tmp"
export SPEC_FILE="$tmp"

echo "→ splicing 3 SECRET + 5 plain env vars on component $COMPONENT"
python3 <<'PY'
import os
from yaml import safe_load
from yaml import safe_dump as dump

path = os.environ['SPEC_FILE']
component_name = os.environ['COMPONENT']
with open(path) as f:
    spec = safe_load(f)

services = spec.get('services') or []
svc = next((s for s in services if s.get('name') == component_name), None)
if svc is None:
    raise SystemExit(f"no service named {component_name!r} in spec; got {[s.get('name') for s in services]}")

envs = svc.setdefault('envs', [])

WANT = [
    ('DATABASE_URL',     os.environ['DATABASE_URL'],   True),
    ('SPACES_KEY',       os.environ['SPACES_KEY'],     True),
    ('SPACES_SECRET',    os.environ['SPACES_SECRET'],  True),
    ('PG_SSL',           'true',                        False),
    ('PG_SSL_REJECT',    'false',                       False),
    ('SPACES_BUCKET',    os.environ['SPACES_BUCKET'],   False),
    ('SPACES_REGION',    os.environ['SPACES_REGION'],   False),
    ('SPACES_ENDPOINT',  os.environ['SPACES_ENDPOINT'], False),
]

def upsert(key, value, secret):
    for e in envs:
        if e.get('key') == key:
            e['value'] = value
            e['scope'] = 'RUN_TIME'
            if secret:
                e['type'] = 'SECRET'
            elif 'type' in e:
                del e['type']
            return
    new = {'key': key, 'value': value, 'scope': 'RUN_TIME'}
    if secret:
        new['type'] = 'SECRET'
    envs.append(new)

for k, v, s in WANT:
    upsert(k, v, s)

with open(path, 'w') as f:
    f.write(dump(spec, sort_keys=False))
print("  ok — env block updated")
PY

echo "→ applying spec (triggers a new deployment)"
doctl apps update "$APP_ID" --spec "$tmp"

echo
echo "✓ env wired. Watch the deploy:"
echo "    doctl apps logs $APP_ID --type deploy --follow"
echo "  Once live:"
echo "    doctl apps logs $APP_ID --type run --follow"
echo "    curl -fsS https://seahorse-app-pbc7a.ondigitalocean.app/readyz"
