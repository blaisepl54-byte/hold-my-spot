-- 008_surveys.sql
-- C2, Build Order 3. The survey.
--
-- Renumbered from the order's 007, taken by C1 after the C0 correction claimed
-- 006. Disclosed in each affected header.
--
-- ADDITIVE ONLY. One new table. Nothing about entries, events, the status set
-- or any grant proven in B2 changes.
--
-- TWO QUESTIONS, per R-H, because response rate over WhatsApp collapses past
-- two taps:
--   1. Did you get what you came for?            -> achieved
--   2. How was the wait?                          -> wait_match
--
-- THE SECOND QUESTION IS NOT DECORATION. It is the calibration signal that
-- tells the wait time agent whether its own estimates are landing, and it is
-- the only feedback loop in this system that closes between what was promised
-- and what was experienced. Without it C3 can measure its own consistency but
-- never its accuracy.

CREATE TABLE IF NOT EXISTS surveys (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- UNIQUE, so a customer is asked once. A second survey on one visit would
    -- both annoy and double-count in every rate the dashboard shows.
    entry_id     uuid        NOT NULL UNIQUE REFERENCES entries (id),
    sent_at      timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    achieved     boolean,
    wait_match   text CHECK (wait_match IN ('shorter', 'as_expected', 'longer')),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS surveys_responded_idx ON surveys (responded_at)
    WHERE responded_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- GRANTS, same migration as the table.
--
-- hms_rw: SELECT, INSERT, UPDATE. NO DELETE.
--
-- NOTE ON DELETE, and this migration is the first real test of it: migration
-- 006 removed DELETE from `ALTER DEFAULT PRIVILEGES`, so this table should
-- arrive WITHOUT DELETE rather than needing a revoke. Migration 005 needed one
-- because the default still granted it then. The C2 proof asserts the absence
-- directly, so "the default fix works" is observed on a new table rather than
-- assumed from the earlier one.
--
-- A survey is never deleted. A response withdrawn by deletion would silently
-- change every historical rate computed from it.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON surveys TO hms_rw;
GRANT SELECT ON surveys TO hms_ro;

DO $$
DECLARE
    privs text;
BEGIN
    SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO privs
      FROM information_schema.table_privileges
     WHERE grantee = 'hms_rw' AND table_name = 'surveys';

    RAISE NOTICE 'C2: hms_rw on surveys = %', COALESCE(privs, 'NONE');
    IF privs LIKE '%DELETE%' THEN
        RAISE NOTICE 'C2: WARNING, DELETE is present. Migration 006 was supposed to stop that.';
    ELSE
        RAISE NOTICE 'C2: DELETE absent WITHOUT an explicit revoke, so 006 default fix holds.';
    END IF;
END
$$;
