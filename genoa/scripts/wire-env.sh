#!/usr/bin/env bash
# Wire Genoa's encrypted env vars into the live App Platform deployment.
#
# Reads the THREE secrets from your local shell environment, fetches the
# current app spec from DO, splices the env vars in (marked as SECRET so
# App Platform encrypts them at rest), applies the new spec, and lets
# App Platform deploy. The secrets never touch git: they live in your
# shell for the duration of this script and in DO's encrypted metadata
# afterwards.
#
# Prerequisites:
#   doctl   (https://docs.digitalocean.com/reference/doctl/)
#   doctl auth init
#   python3 with PyYAML (pip install pyyaml)  — for safe spec editing
#
# Usage:
#   export APP_ID=$(doctl apps list --format ID,Spec.Name --no-header \
#                   | awk '$2=="genoa"{print $1}')
#   export DATABASE_URL='postgresql://doadmin:<NEW_PASSWORD>@db-postgresql-sfo3-78863-do-user-14684436-0.m.db.ondigitalocean.com:25060/defaultdb?sslmode=require'
#   export SPACES_KEY='<rotated-key-id>'
#   export SPACES_SECRET='<rotated-secret>'
#   bash genoa/scripts/wire-env.sh
#
# After this completes, App Platform will redeploy automatically with
# DATABASE_URL / SPACES_KEY / SPACES_SECRET set on the web component.

set -euo pipefail

: "${APP_ID:?APP_ID required — find it with: doctl apps list}"
: "${DATABASE_URL:?DATABASE_URL required (postgresql://...sslmode=require)}"
: "${SPACES_KEY:?SPACES_KEY required}"
: "${SPACES_SECRET:?SPACES_SECRET required}"

command -v doctl   >/dev/null || { echo "doctl not found"; exit 1; }
command -v python3 >/dev/null || { echo "python3 not found"; exit 1; }

tmp=$(mktemp -t genoa-spec.XXXXXX.yaml)
trap 'rm -f "$tmp"' EXIT

echo "→ fetching current app spec for $APP_ID"
doctl apps spec get "$APP_ID" > "$tmp"

echo "→ splicing DATABASE_URL / SPACES_KEY / SPACES_SECRET (SECRET, RUN_TIME, web)"
python3 - "$tmp" <<'PY'
import os, sys, yaml
path = sys.argv[1]
with open(path) as f:
    spec = yaml.safe_load(f)

services = spec.get('services') or []
web = next((s for s in services if s.get('name') == 'web'), None)
if web is None:
    print('!! no service named "web" in spec', file=sys.stderr); sys.exit(2)

envs = web.setdefault('envs', [])
def upsert(key, value):
    for e in envs:
        if e.get('key') == key:
            e['value'] = value
            e['type']  = 'SECRET'
            e['scope'] = 'RUN_TIME'
            return
    envs.append({'key': key, 'value': value, 'type': 'SECRET', 'scope': 'RUN_TIME'})

upsert('DATABASE_URL',  os.environ['DATABASE_URL'])
upsert('SPACES_KEY',    os.environ['SPACES_KEY'])
upsert('SPACES_SECRET', os.environ['SPACES_SECRET'])

with open(path, 'w') as f:
    yaml.safe_dump(spec, f, sort_keys=False)
PY

echo "→ applying spec (this triggers a new deployment)"
doctl apps update "$APP_ID" --spec "$tmp"

echo "✓ Genoa env vars wired. Watch the deploy:"
echo "    doctl apps logs $APP_ID --follow"
echo "  Then verify:"
echo "    curl -fsS https://<your-genoa-url>/readyz"
