-- Oracle → PostgreSQL sync storage
-- Run once against your Neon DATABASE_URL to create the two tables.

CREATE TABLE IF NOT EXISTS oracle_raw (
  id          BIGSERIAL PRIMARY KEY,
  source_table TEXT    NOT NULL,   -- e.g. 'DTC102', 'VW_SALE_D'
  source_key   TEXT    NOT NULL,   -- TRMID, ITEMID, or computed composite
  fy           SMALLINT,           -- fiscal year short: 24 25 26 …
  data         JSONB   NOT NULL,   -- full Oracle row as-is
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_table, source_key)
);

CREATE INDEX IF NOT EXISTS oracle_raw_table_idx  ON oracle_raw(source_table);
CREATE INDEX IF NOT EXISTS oracle_raw_fy_idx     ON oracle_raw(source_table, fy);
-- No GIN index on data: queries extract with ->> (never @>), so it was 53 MB
-- of never-scanned weight that also slowed every upsert. Dropped 2026-07-29.

CREATE TABLE IF NOT EXISTS oracle_sync_log (
  id           SERIAL PRIMARY KEY,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mode         TEXT NOT NULL,        -- 'daily' | 'backfill' | 'manual'
  source_table TEXT,                 -- NULL = all tables
  from_date    TEXT,
  to_date      TEXT,
  rows_upserted INT  DEFAULT 0,
  duration_ms   INT,
  status       TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'done' | 'error'
  error        TEXT
);
