-- 006_no_delete_by_default.sql
-- C0 CORRECTION. Caught by the C0 proof, not by review.
--
-- ============================================================================
-- WHAT WENT WRONG
-- ============================================================================
-- Build Order 3 C0 requires: "hms_rw gets SELECT and INSERT and UPDATE on both
-- new tables, no DELETE."
--
-- Migration 005 granted those three explicitly and stopped there. It did not
-- REVOKE anything, and `db/roles.sql` carries:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE hms_ddl IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hms_rw;
--
-- so every table hms_ddl creates arrives with DELETE already granted. The
-- explicit GRANT was therefore a no-op that LOOKED like the constraint being
-- applied, and hms_rw held DELETE on counters and service_types.
--
-- This is the third instance in this project of the same shape: a guarantee
-- that reads as present because someone wrote the permitting half and never
-- checked the forbidding half. B2's column-level revoke was the first, X2's
-- checker scope the second.
--
-- 005 is APPLIED and migrations are FORWARD-ONLY, so it cannot be edited. The
-- correction is this migration.
--
-- ============================================================================
-- NUMBERING DEVIATION, disclosed
-- ============================================================================
-- Build Order 3 assigns 006 to C1 and 007 to C2. This corrective migration
-- takes 006, so C1 becomes 007 and C2 becomes 008. The order's numbers track
-- sequence rather than being a contract, and forward-only leaves no alternative
-- once 005 is applied. Stated here rather than discovered by whoever next reads
-- the order against the migrations directory.

-- ---------------------------------------------------------------------------
-- 1. Take DELETE back on the two tables 005 created.
--
-- A counter is decommissioned by setting active = false. Deleting one would
-- orphan every service ever attributed to it, which is precisely the history
-- the measurement layer exists to keep.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON counters      FROM hms_rw;
REVOKE DELETE ON service_types FROM hms_rw;

-- ---------------------------------------------------------------------------
-- 2. Stop the DEFAULT from handing DELETE to every future table.
--
-- This is the durable half. Fixing only the two tables above would leave the
-- next migration inheriting the same wrong grant and relying on its author to
-- remember a revoke, which is the mechanism that failed here.
--
-- ALTER DEFAULT PRIVILEGES affects FUTURE objects only. It does not touch
-- entries or events, whose grants were proven in B2 and must not move: B2's
-- five rejections are re-run after this migration and must still pass.
--
-- Nothing relies on hms_rw holding DELETE. It is already revoked on entries
-- (invariant I1) and on events (invariant I8a). Making no-DELETE the default
-- aligns the schema with how every existing table already behaves.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE hms_ddl IN SCHEMA public
  REVOKE DELETE ON TABLES FROM hms_rw;

DO $$
DECLARE
    remaining integer;
BEGIN
    SELECT count(*) INTO remaining
      FROM information_schema.table_privileges
     WHERE grantee = 'hms_rw'
       AND privilege_type = 'DELETE'
       AND table_schema = 'public';

    RAISE NOTICE 'C0 correction: tables where hms_rw still holds DELETE = %', remaining;
    IF remaining > 0 THEN
        RAISE NOTICE 'C0 correction: this should be 0. Any table listed above needs an explicit revoke.';
    END IF;
END
$$;
