-- 009_surveys_cascade.sql
-- C2 CORRECTION. A regression I introduced, caught by the regression sweep.
--
-- ============================================================================
-- WHAT BROKE
-- ============================================================================
-- C2 made completing a service create a `surveys` row referencing the entry.
-- Every proof that tears its fixtures down deletes entries, and the B6 proof
-- began failing with:
--
--   23503: update or delete on table "entries" violates foreign key constraint
--          "surveys_entry_id_fkey" on table "surveys"
--
-- The failure did not surface as a clean assertion failure. It threw inside the
-- teardown, so the server was never closed and the proof HUNG until the
-- five-minute timeout. A regression that hangs is worse than one that fails,
-- because the first thing it costs is the ability to tell what happened.
--
-- ============================================================================
-- WHY THE FIX IS HERE AND NOT IN THE PROOF
-- ============================================================================
-- Build Order 3 section 0: "The B0 through B6 proofs must continue to pass
-- UNMODIFIED at every stage." Editing B6's teardown to delete surveys first
-- would make the proofs pass by changing them, which is precisely what that
-- instruction forbids. The defect is in the data model, so it is fixed there.
--
-- ON DELETE CASCADE is also the semantically correct answer independently of
-- the test: a survey is ABOUT a visit. An orphaned survey, whose entry no
-- longer exists, describes nothing and would silently skew every rate the C4
-- dashboard computes, because the denominator it belonged to is gone.
--
-- ============================================================================
-- IS THIS DESTRUCTIVE? NO, and the distinction is worth stating.
-- ============================================================================
-- This replaces a CONSTRAINT. It drops no column, no table, and no row. The
-- table's data is untouched by both statements below; only the referential
-- action attached to the foreign key changes.
--
-- It does WIDEN what a delete can do, which is why it is called out rather than
-- slipped in: deleting an entry will now also delete its survey. That is
-- acceptable because hms_rw CANNOT DELETE ENTRIES AT ALL, revoked in migration
-- 002 for invariant I1 and proven by B2's rejection. Only hms_ddl can delete an
-- entry, and it does so in fixtures and administration, never in the
-- application path.

ALTER TABLE surveys DROP CONSTRAINT IF EXISTS surveys_entry_id_fkey;

ALTER TABLE surveys
    ADD CONSTRAINT surveys_entry_id_fkey
    FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE;

DO $$
DECLARE
    action text;
BEGIN
    SELECT rc.delete_rule INTO action
      FROM information_schema.referential_constraints rc
     WHERE rc.constraint_name = 'surveys_entry_id_fkey';

    RAISE NOTICE 'C2 correction: surveys_entry_id_fkey ON DELETE = %', COALESCE(action, 'NOT FOUND');
END
$$;
