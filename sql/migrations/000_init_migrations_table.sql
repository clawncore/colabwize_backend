-- Manual SQL migration system: tracks which migration files have been applied.
-- This is the ONLY table the migration runner writes to.
-- All schema changes live as numbered .sql files under backend/sql/migrations/.
CREATE TABLE IF NOT EXISTS _sql_migrations (
    id            SERIAL PRIMARY KEY,
    filename      TEXT NOT NULL,
    applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum      TEXT NOT NULL,
    UNIQUE (filename)
);