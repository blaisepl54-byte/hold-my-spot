-- 007_service_record.sql
-- C1, Build Order 3. The service record.
--
-- Renumbered from the order's 006 because that number was taken by the C0
-- correction, which forward-only made unavoidable. Disclosed in 006's header.
--
-- ADDITIVE ONLY. Two nullable columns and grants. No new table: per C1, DO NOT
-- create a separate service_records table. THE ENTRY IS THE SERVICE RECORD. A
-- second table would be a second thing to keep consistent with the first, and
-- the two would drift the first time a write touched one and not the other.
--
-- Service duration is currently unknowable because nothing records when service
-- began or ended. `served` tells you it finished, not how long it took.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS serving_started_at timestamptz;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS serving_ended_at   timestamptz;

-- DURATION IS DERIVED, NEVER STORED. Deliberately no `duration_seconds` column:
-- a stored duration is a third fact that can disagree with the two it is
-- computed from, and there is no way to tell which one is wrong afterwards.
-- This index makes the derivation cheap without materialising it.
CREATE INDEX IF NOT EXISTS entries_serving_window_idx
    ON entries (location_id, serving_ended_at)
    WHERE serving_ended_at IS NOT NULL;

-- Column-level grants again. 002 replaced the table-level grant, so a new
-- column is unwritable until named. joined_at stays absent from both lists and
-- nothing here widens I1: the B2 rejection proof is re-run after this migration.
GRANT INSERT (serving_started_at, serving_ended_at) ON entries TO hms_rw;
GRANT UPDATE (serving_started_at, serving_ended_at) ON entries TO hms_rw;

-- ===========================================================================
-- FOLDED IN ON KING B'S INSTRUCTION, 2026-08-17: the migration-ledger revoke.
--
-- Found by migration 006's own report, which counted one table still granting
-- DELETE to hms_rw after the correction. That table is `schema_migrations`,
-- where hms_rw held DELETE, INSERT, SELECT and UPDATE.
--
-- WHY IT MATTERS. `schema_migrations` is the record of which migrations have
-- run. A write path able to delete a row from it could make the runner
-- RE-APPLY a migration, and able to update one could defeat the checksum guard
-- that makes migrations forward-only. That guard is proven by B1's
-- break-restore, and it is worth exactly as much as the grants underneath it.
--
-- hms_rw has no business touching the ledger at all. The runner connects as
-- hms_ddl, which is the only role that should. SELECT is retained so a read
-- path can report schema state without a second connection.
--
-- This is PRE-EXISTING, from roles.sql defaults plus migration 001, and was
-- reported rather than fixed inside C0's scope. Folded here on instruction.
-- ===========================================================================
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM hms_rw;

DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(DISTINCT table_name, ', ' ORDER BY table_name) INTO offenders
      FROM information_schema.table_privileges
     WHERE grantee = 'hms_rw'
       AND privilege_type IN ('DELETE')
       AND table_schema = 'public';

    RAISE NOTICE 'C1: tables where hms_rw still holds DELETE = %', COALESCE(offenders, 'NONE');

    SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO offenders
      FROM information_schema.table_privileges
     WHERE grantee = 'hms_rw' AND table_name = 'schema_migrations';

    RAISE NOTICE 'C1: hms_rw on schema_migrations = %', COALESCE(offenders, 'NONE');
END
$$;
