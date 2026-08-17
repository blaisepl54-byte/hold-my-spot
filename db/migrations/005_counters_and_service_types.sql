-- 005_counters_and_service_types.sql
-- C0, Build Order 3. The identities everything downstream keys on.
--
-- ADDITIVE ONLY. Two new tables, two new nullable columns on entries, and
-- grants. No DROP, no destructive ALTER, no change to the status set, no change
-- to any grant proven in B2. The B0 through B6 proofs must pass unmodified
-- after this, and `npm run b2` is the specific one that would catch a
-- regression in the joined_at grants.
--
-- NO STAFF TABLE. NO PERSON IS MODELLED. Per R-F, all measurement is keyed on
-- the counter, never on a named human. That is a constraint on the SCHEMA, not
-- only on the dashboard, because a table that can hold a name will eventually
-- hold one.
--
-- WHY COUNTERS BECOME REAL. Migration 004 modelled a counter as a text label on
-- the entry and flagged the simplification. A service cannot be attributed to
-- where it happened when the place is a string typed into a form: two spellings
-- become two counters, and a renamed counter silently splits its own history.

-- ---------------------------------------------------------------------------
-- counters
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counters (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id uuid        NOT NULL REFERENCES locations (id),
    label       text        NOT NULL,
    active      boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (location_id, label)
);

-- ---------------------------------------------------------------------------
-- service_types. DATA, not schema, per R-I: a branch changes its own list
-- without a migration. `code` is the stable key, `label` is what a human reads,
-- so relabelling "General enquiry" does not orphan its history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_types (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id uuid        NOT NULL REFERENCES locations (id),
    code        text        NOT NULL,
    label       text        NOT NULL,
    active      boolean     NOT NULL DEFAULT true,
    sort_order  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (location_id, code)
);

-- ---------------------------------------------------------------------------
-- entries gains the two references. BOTH NULLABLE, and that is a correctness
-- decision rather than convenience: entries created before this migration have
-- neither, and backfilling an invented value would be fabrication. A null here
-- reads as "not recorded", which is true, instead of a guess that reads as fact.
-- ---------------------------------------------------------------------------
ALTER TABLE entries ADD COLUMN IF NOT EXISTS counter_id      uuid REFERENCES counters (id);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS service_type_id uuid REFERENCES service_types (id);

CREATE INDEX IF NOT EXISTS entries_counter_idx      ON entries (counter_id);
CREATE INDEX IF NOT EXISTS entries_service_type_idx ON entries (service_type_id);

-- ---------------------------------------------------------------------------
-- GRANTS, in the same migration as the tables, never retrofitted.
--
-- hms_rw: SELECT, INSERT, UPDATE. NO DELETE, matching how entries and events
-- are already treated. A counter is decommissioned by setting active = false,
-- which keeps its history attributable; deleting it would orphan every service
-- ever performed there.
--
-- Column-level grants on entries again, because 002 replaced the table-level
-- grant. A new column is unwritable until named. joined_at remains absent from
-- both lists and nothing here widens I1.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON counters      TO hms_rw;
GRANT SELECT, INSERT, UPDATE ON service_types TO hms_rw;
GRANT SELECT ON counters      TO hms_ro;
GRANT SELECT ON service_types TO hms_ro;

GRANT INSERT (counter_id, service_type_id) ON entries TO hms_rw;
GRANT UPDATE (counter_id, service_type_id) ON entries TO hms_rw;

-- ---------------------------------------------------------------------------
-- BACKFILL, and it REPORTS rather than assumes.
--
-- The existing `counter` label column is RETAINED and NOT dropped. Dropping it
-- would break the B6 proof, which asserts the label on a called entry. It
-- becomes derived display only.
--
-- Counters are derived from labels that actually occur in the data. Nothing is
-- invented: if a branch has no history, it gets no counters here and the seed
-- script supplies them explicitly.
--
-- The matched and unmatched counts are RAISED, not inferred. A backfill that
-- reports nothing is indistinguishable from a backfill that did nothing, and
-- this project has already shipped one guarantee that read as present and was
-- unreachable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    created_counters integer;
    matched          integer;
    unmatched        integer;
    total_labelled   integer;
BEGIN
    INSERT INTO counters (location_id, label)
    SELECT DISTINCT e.location_id, e.counter
      FROM entries e
     WHERE e.counter IS NOT NULL
       AND e.counter <> ''
    ON CONFLICT (location_id, label) DO NOTHING;

    GET DIAGNOSTICS created_counters = ROW_COUNT;

    UPDATE entries e
       SET counter_id = c.id
      FROM counters c
     WHERE c.location_id = e.location_id
       AND c.label = e.counter
       AND e.counter_id IS NULL;

    GET DIAGNOSTICS matched = ROW_COUNT;

    SELECT count(*) INTO total_labelled
      FROM entries WHERE counter IS NOT NULL AND counter <> '';

    unmatched := total_labelled - matched;

    RAISE NOTICE 'C0 backfill: counters created from observed labels = %', created_counters;
    RAISE NOTICE 'C0 backfill: entries with a counter label          = %', total_labelled;
    RAISE NOTICE 'C0 backfill: counter_id MATCHED                    = %', matched;
    RAISE NOTICE 'C0 backfill: counter_id UNMATCHED, left null       = %', unmatched;

    IF unmatched > 0 THEN
        RAISE NOTICE 'C0 backfill: % entries keep a label with no counter row. Left NULL rather than guessed.', unmatched;
    END IF;
END
$$;
