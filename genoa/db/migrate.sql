-- Genoa schema. Idempotent — safe to run on every deploy.
-- All tables are namespaced with the `genoa_` prefix so this service
-- can co-exist in a shared Postgres cluster without colliding with
-- other tenants (e.g. an existing zerotrustradio facility DB used in
-- read-only mode).

CREATE TABLE IF NOT EXISTS genoa_exhibit (
  id              BIGSERIAL PRIMARY KEY,
  call_sign       TEXT,
  facility_id     TEXT,
  service         TEXT,           -- AM | FM | LPFM | FX
  frequency       NUMERIC,        -- MHz for FM/LPFM/FX, kHz for AM
  erp_kw          NUMERIC,
  haat_m          NUMERIC,
  lat             NUMERIC,
  lon             NUMERIC,
  method          TEXT,           -- e.g. "47 CFR §73.313 / §73.333 F(50,50)"
  payload         JSONB NOT NULL, -- full reproducibility package
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS genoa_exhibit_created_at_idx ON genoa_exhibit (created_at DESC);
CREATE INDEX IF NOT EXISTS genoa_exhibit_service_idx    ON genoa_exhibit (service);
CREATE INDEX IF NOT EXISTS genoa_exhibit_call_idx       ON genoa_exhibit (call_sign);

CREATE TABLE IF NOT EXISTS genoa_asset (
  id              BIGSERIAL PRIMARY KEY,
  exhibit_id      BIGINT REFERENCES genoa_exhibit(id) ON DELETE CASCADE,
  kind            TEXT,           -- sigmf | pdf | png | csv | other
  key             TEXT NOT NULL,  -- Spaces object key
  content_type    TEXT,
  size_bytes      BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS genoa_asset_exhibit_idx ON genoa_asset (exhibit_id);

-- ----------------------------------------------------------------
-- Terrain cache. Genoa stores DEM elevations keyed by lat/lon
-- rounded to 4 decimals (~10 m precision) so repeated compute runs
-- near the same site don't re-hit Open-Elevation (or whichever
-- provider TERRAIN_PROVIDER is set to). Caller fetches missing
-- points only and back-fills the cache.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS genoa_terrain_cache (
  lat_q4       NUMERIC(8,4) NOT NULL,   -- rounded latitude
  lon_q4       NUMERIC(9,4) NOT NULL,   -- rounded longitude
  elev_m       NUMERIC      NOT NULL,
  source       TEXT,                    -- e.g. 'open-elevation', 'usgs-epqs', 'srtm-local'
  fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (lat_q4, lon_q4)
);

CREATE INDEX IF NOT EXISTS genoa_terrain_cache_fetched_at_idx ON genoa_terrain_cache (fetched_at);
