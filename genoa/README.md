# Genoa

> Carries the signal farther on a single tack.

Genoa is a **standalone** FCC propagation studio for **AM / FM / LPFM / FM-translators**. It produces engineer-reviewable contour exhibits — not AI opinions. Every number is reproducible from the published §73.183 / §73.184 / §73.313 / §73.333 / §74.1204 curves.

## Architecture (3 layers)

1. **Official FCC method** — F(50,50) / F(50,10) for FM-family, §73.184 groundwave for AM. Deterministic engine; the source of truth.
2. **Scientific evidence** — terrain DEM, antenna patterns, ground conductivity, SDR captures (SigMF), RDS / RadioDNS validation, timestamped measurement logs with uncertainty bands.
3. **AI assistant** — flags bad inputs, explains contour-vs-measurement deltas, drafts exhibits in plain engineering English. Commentary, not citation.

## Deploy (Digital Ocean App Platform)

Genoa is designed to **deploy first, attach storage later**. The service boots in stateless mode and only the storage-backed endpoints (`POST /api/exhibits`, `POST /api/assets`) return 503 until DB / Spaces are wired up. The deterministic compute engine works the whole time.

1. **Create the app (web service only):**
   ```sh
   doctl apps create --spec .do/app.yaml
   ```
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
   `SPACES_BUCKET`, `SPACES_REGION`, `SPACES_ENDPOINT` already have sane defaults in `app.yaml`; override them if you put the bucket in a different region.

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
