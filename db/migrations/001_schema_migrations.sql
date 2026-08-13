-- 001_schema_migrations.sql
-- First migration. Creates only the migration ledger itself.
-- No product tables in Phase 1 (v4 T1.6).
--
-- R11 exempts infrastructure tables from is_synthetic; this is one. The column
-- lands on product-data tables (entries, customers, service history) in Phase 2,
-- in the same migration that creates them, never retrofitted.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text        PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    checksum    text        NOT NULL
);
