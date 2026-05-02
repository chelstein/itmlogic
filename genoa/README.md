# Genoa

> Carries the signal farther on a single tack.

Genoa is a **standalone** FCC propagation studio for **AM / FM / LPFM / FM-translators**. It produces engineer-reviewable contour exhibits — not AI opinions. Every number is reproducible from the published §73.183 / §73.184 / §73.313 / §73.333 / §74.1204 curves.

## Architecture (3 layers)

1. **Official FCC method** — F(50,50) / F(50,10) for FM-family, §73.184 groundwave for AM. Deterministic engine; the source of truth.
2. **Scientific evidence** — terrain DEM, antenna patterns, ground conductivity, SDR captures (SigMF), RDS / RadioDNS validation, timestamped measurement logs with uncertainty bands.
3. **AI assistant** — flags bad inputs, explains contour-vs-measurement deltas, drafts exhibits in plain engineering English. Commentary, not citation.

## Deploy (Digital Ocean App Platform)

Genoa is designed to **deploy first, attach storage later**. The service boots in stateless mode and only the storage-backed endpoints (`POST /api/exhibits`, `POST /api/assets`) return 503 until DB / Spaces are wired up. The deterministic compute engine works the whole time.

The App Platform spec lives at the **repo root** (`.do/app.yaml`) so DO's "Create App from GitHub" auto-detect picks it up. It declares a Dockerfile-based build pointing at `genoa/Dockerfile` with build context `/genoa`, which sidesteps the parent itmlogic Python project entirely.

1. **Create the app (web service only):**
   ```sh
   doctl apps create --spec .do/app.yaml
   ```
   *Or in the DO console:* Create App → From GitHub → choose `chelstein/itmlogic` → it will auto-detect `.do/app.yaml` and offer to use it. Accept.

2. **Attach managed Postgres** (DO console → Apps → genoa → *Create/Attach Database* → PostgreSQL).
   Copy the connection string from the database's *Connection Details* page and add it on the web component as an **encrypted** env var:
   ```
   DATABASE_URL = postgresql://...
   ```
   Genoa runs `db/migrate.sql` idempotently on every boot — the schema appears on the next deploy.
3. **Attach Spaces** — create a Space (e.g. `genoa-exhibits`) and a Spaces access key, then set on the web component as **encrypted** env vars:
   ```
   SPACES_KEY     = ...
   SPACES_SECRET  = ...
   ```
   `SPACES_BUCKET`, `SPACES_REGION`, `SPACES_ENDPOINT` already have sane defaults in `.do/app.yaml`; override them if you put the bucket in a different region.

### Repairing an existing app that was created without the spec

If you already created the app via DO console "Deploy from GitHub" before `.do/app.yaml` lived at the repo root, App Platform autodetected the parent itmlogic Python buildpack and the build will fail on `fiona` / GDAL. Two console-only paths to fix:

- **Re-apply the spec (preserves env vars):**
  Apps → *(your app)* → **Settings** → scroll to **App Spec** → **Edit** → paste the contents of `.do/app.yaml` from the repo root → **Save**. App Platform replaces the component config and redeploys via the Dockerfile. Your encrypted env vars (`DATABASE_URL`, `SPACES_KEY`, `SPACES_SECRET`) survive.
- **Or fix the component in place:**
  Apps → *(your app)* → **Components** → *(component)* → **Edit Source** → set **Source Directory** to `/genoa`, switch resource type to **Dockerfile**, set **Dockerfile Path** to `Dockerfile` (relative to source dir). Save → redeploy.

### Wiring all three secrets in one shot

If you have `doctl` set up, you can splice `DATABASE_URL`, `SPACES_KEY`, and `SPACES_SECRET` into the live spec without touching the console (and **without** committing them to git):

```sh
export APP_ID=$(doctl apps list --format ID,Spec.Name --no-header | awk '$2=="genoa"{print $1}')
export DATABASE_URL='postgresql://doadmin:<password>@db-postgresql-sfo3-78863-do-user-14684436-0.m.db.ondigitalocean.com:25060/defaultdb?sslmode=require'
export SPACES_KEY='<key-id>'
export SPACES_SECRET='<secret>'
bash genoa/scripts/wire-env.sh
```

The script fetches the current spec, marks the three values as `SECRET` (encrypted at rest by App Platform), and applies it — triggering a redeploy. Secrets live only in your shell environment for the duration of the script.

> **Why not put them in `app.yaml`?**  The `value:` field of an env var is committed to git in plaintext, even with `type: SECRET` (that flag controls encryption *at rest in App Platform*, not in your repo). Use the helper script or the console — never the spec file.

## Run locally

```sh
cp .env.example .env     # edit DATABASE_URL etc.
npm install
npm start                # http://localhost:8080
```

## Endpoints

| Method | Path                       | Purpose                                         |
| ------ | -------------------------- | ----------------------------------------------- |
| GET    | `/`                        | Web UI (the studio)                             |
| GET    | `/healthz`                 | Liveness probe                                  |
| GET    | `/readyz`                  | Readiness (DB + Spaces)                         |
| POST   | `/api/exhibits`            | Persist a computed exhibit (JSON body)          |
| GET    | `/api/exhibits`            | List most-recent exhibits                       |
| GET    | `/api/exhibits/:id`        | Full exhibit record                             |
| POST   | `/api/assets`              | Upload an asset (SigMF / PDF / PNG) to Spaces   |
| GET    | `/api/assets/:id/url`      | Signed download URL (10 min)                    |

## Data isolation

Genoa **never** writes to upstream systems. It maintains its own Postgres tables (`genoa_exhibit`, `genoa_asset`) and its own Spaces bucket. The `zerotrustradio` / buoyIQ database is consulted (if at all) only via published read-only APIs.

## Backend kernels

| Repo                       | Role                                            |
| -------------------------- | ----------------------------------------------- |
| `chelstein/itmlogic`       | ITS Irregular Terrain Model (host)              |
| `chelstein/splat`          | Terrain-aware coverage (SPLAT!)                 |
| `chelstein/ZTRpsITS`       | ITS p2p / area mode reference                   |
| `chelstein/SigMF`          | SDR measurement schema                          |
| `chelstein/EAS-Tools`      | Audio / SAME identity validation                |
| `chelstein/zerotrustradio` | Read-only facility catalog & SDR metadata       |
| `chelstein/massdns`        | RadioDNS resolver                               |
