-- 002_queue_tables.sql
-- B2, Build Order 2 rev 2. The two tables that are the product, plus branch
-- configuration. Grants land in THIS migration, never retrofitted.
--
-- Domain model taken from PRIMARY text, not from quotation:
--   seven statuses  v2 line 278, corroborated at v4 line 199
--   channels        v4 line 201: whatsapp, qr, reception
--   grace 300s      v4 line 228, "Grace default 300 seconds per location"
--   is_synthetic    R11, product-data tables carry it, infrastructure exempt
--
-- CARRIED OBLIGATIONS DISCHARGED HERE:
--   CO-4 / I1  REVOKE UPDATE(joined_at) ON entries   v4 R5 line 84
--   CO-1 / I8a REVOKE UPDATE, DELETE ON events       X7, absent from the
--              remediation package, carried by B2
--
-- ============================================================================
-- DEVIATION FROM THE ORDER'S LITERAL SQL, reported not absorbed
-- ============================================================================
-- B2 states the entries revoke as:
--     REVOKE INSERT (joined_at), UPDATE (joined_at) ON entries FROM hms_rw;
--
-- That form CANNOT WORK here, and the reason is a PostgreSQL rule rather than
-- a preference. `ALTER DEFAULT PRIVILEGES` in db/roles.sql grants hms_rw
-- TABLE-LEVEL INSERT and UPDATE on every table hms_ddl creates. A table-level
-- privilege authorises every column, and a column-level REVOKE does not
-- subtract from it. The statement would succeed silently and joined_at would
-- still be writable, which is the exact failure shape this project keeps
-- finding: a guarantee that reads as present and is unreachable.
--
-- Implemented instead as: drop the table-level grant, then re-grant column by
-- column, omitting joined_at from both lists. The ORDER'S INTENT is preserved
-- exactly, its literal text is not. The five runtime rejections B2 requires are
-- the check on whether this was done right, and they are observed, not read.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- locations. Branch configuration. Infrastructure, so R11-exempt: it holds no
-- customer data. Flagged rather than assumed, since "product table" is the test
-- R11 states and a branch record sits near the line.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text        NOT NULL,
    close_of_day_policy text        NOT NULL DEFAULT 'reset'
                                    CHECK (close_of_day_policy IN ('reset', 'roll_forward')),
    timezone            text        NOT NULL DEFAULT 'America/Jamaica',
    grace_seconds       integer     NOT NULL DEFAULT 300 CHECK (grace_seconds > 0),
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- entries. Product data, so it carries is_synthetic per R11.
--
-- joined_at has a server-side DEFAULT and is excluded from every grant below.
-- The client cannot supply it and cannot change it, so "order is join time"
-- stops being a convention the API happens to respect (I1, W9).
--
-- prompt_sent / prompt_delivered are NOT statuses, per X9b. They are the
-- nullable timestamp columns below, so the status set stays at v2's seven.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entries (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id         uuid        NOT NULL REFERENCES locations (id),
    joined_at           timestamptz NOT NULL DEFAULT now(),
    status              text        NOT NULL
                                    CHECK (status IN ('provisional', 'waiting', 'called',
                                                      'serving', 'served', 'noshow', 'left')),
    channel             text        NOT NULL
                                    CHECK (channel IN ('whatsapp', 'qr', 'reception')),
    is_synthetic        boolean     NOT NULL DEFAULT true,
    prompt_sent_at      timestamptz,
    prompt_delivered_at timestamptz,
    prompt_failed_at    timestamptz,
    confirmed_at        timestamptz,
    undeliverable_at    timestamptz,
    left_reason         text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entries_location_joined_idx
    ON entries (location_id, joined_at);

-- ----------------------------------------------------------------------------
-- events. The fairness log. Append-only, and append-only is made STRUCTURAL by
-- the revoke below rather than claimed in a comment (X7 / I8a).
--
-- approver is unauthenticated free text per R13. It is recorded, not trusted.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    location_id uuid        NOT NULL REFERENCES locations (id),
    entry_id    uuid        REFERENCES entries (id),
    kind        text        NOT NULL,
    from_status text,
    to_status   text,
    actor       text,
    reason      text,
    approver    text,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_entry_idx ON events (entry_id);

-- ============================================================================
-- GRANTS. Same migration as the CREATE, per B2. Order matters: every statement
-- below must run AFTER its table exists, and the table-level revoke must run
-- before the column-level grant that replaces it.
-- ============================================================================

-- entries, invariant I1. joined_at appears in NEITHER grant list, which is what
-- makes it unwritable. CO-4 discharged.
REVOKE INSERT, UPDATE ON entries FROM hms_rw;

GRANT INSERT (id, location_id, status, channel, is_synthetic,
              prompt_sent_at, prompt_delivered_at, prompt_failed_at,
              confirmed_at, undeliverable_at, left_reason)
    ON entries TO hms_rw;

GRANT UPDATE (status, prompt_sent_at, prompt_delivered_at, prompt_failed_at,
              confirmed_at, undeliverable_at, left_reason)
    ON entries TO hms_rw;

-- I1 again: an entry is never removed, so a place in line cannot be erased.
REVOKE DELETE ON entries FROM hms_rw;

-- events, invariant I8a. INSERT is deliberately RETAINED: append-only means
-- insert-yes, alter-no. Revoking INSERT would stop the log being written at
-- all. CO-1 discharged, and this is finding X7.
REVOKE UPDATE, DELETE ON events FROM hms_rw;

-- locations is configuration, not queue state. hms_rw keeps read access and is
-- given no write path, since branch policy is set at configuration time and a
-- mid-operation flip is what R-B exists to prevent.
REVOKE INSERT, UPDATE, DELETE ON locations FROM hms_rw;
