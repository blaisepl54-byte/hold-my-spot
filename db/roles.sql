-- db/roles.sql
-- The three-role model for Hold My Spot. NOT EXECUTED, NOT COMMITTED, NOT RATIFIED.
--
-- ============================================================================
-- PROVENANCE, READ THIS BEFORE TRUSTING ANY GRANT BELOW
-- ============================================================================
-- RETRACTION, 2026-08-14. An earlier version of this header stated that v4 was
-- "absent and treated as unrecoverable" and that no primary source for these
-- grants existed on this machine. **That was FALSE when written.** v4 had been
-- recovered and recorded in the ledger hours before this file was authored.
-- The header below is the re-derivation, run against the primary.
--
-- The order that commissioned this file said to derive the roles and their
-- exact grants from v2, which the order treated as PRIMARY. That could not be
-- done, and the reason survives the retraction unchanged.
--
-- **v2 IS SILENT ON ROLES.** Negative proof RE-RUN 2026-08-14 against
-- sha256:37805f0c8bd9a31c59706bbda98831ae45fffb1ac6e4dbe614afbdfbe5158056
-- (pin re-derived, matches): zero occurrences of hms_ro, hms_rw, hms_ddl,
-- GRANT, REVOKE, "role" and "privilege". v2's R5 says only "PostgreSQL 18,
-- local, connection-proven", and closes the Phase 0 abstention with a
-- runtime-asserted query. It defines no role model at all.
--
-- The three-role model originates in v4 R5. **v4 IS PRESENT**, pin re-derived
-- 2026-08-14:
--   sha256:9f99b1cca62dc2570c26a926239656cce707c3468d6ee009a8fe1383f1a10768
--   399 lines, 20,587 bytes, matching in all 64 characters.
--
-- **RECOVERABLE IS NOT RATIFIED.** v4 is UNSEALED. Gate round four returned
-- NOT SAFE TO SEAL: 3 CRITICAL, 7 HIGH, 5 MEDIUM, 1 LOW, and X7 is still
-- undispositioned. Citing v4 directly raises the SOURCE of these grants from a
-- quotation to the primary text. It does NOT raise their AUTHORITY. Nothing
-- below became ratified by becoming readable.
--
--   [V4-R5]   primary text of v4 R5, lines 74-90, pin above. Read directly,
--             no longer routed through a quotation and so no longer carrying
--             the quoting document's scope under A12.
--   [PROPOSED] from the remediation package,
--             sha256:a307a2f46f876c160b14c1a791026a443128e67c0c9108e5b5eac00060ed39a0
--             Unsealed. X3 and X7 are proposals, not ratified rules.
--   [CC]      chosen by the implementer because the model is otherwise
--             unenforceable. v4 R5 is silent on these. Flagged, not smuggled.
--
-- The [SCAFFOLD] tag is RETIRED. It cited comments in the committed scaffold
-- that themselves pointed at "v4 R5"; with the primary readable, a comment
-- about the spec is strictly worse evidence than the spec.
--
-- ============================================================================
-- GRANT-BY-GRANT COMPARISON AGAINST PRIMARY v4 R5, run 2026-08-14
-- ============================================================================
-- Every grant in this file was checked against v4 R5 once the primary became
-- readable. This check had never been possible before, because the file was
-- authored under the false belief that no primary existed.
--
--   three-role table, hms_ro / hms_rw / hms_ddl   v4 lines 76-80   MATCHES
--   hms_rw revoke on joined_at                    v4 line 84       MATCHES
--     primary reads: REVOKE UPDATE(joined_at) ON entries FROM hms_rw
--     UPDATE only. The INSERT(joined_at) and DELETE revokes noted at the foot
--     of this file go BEYOND v4 and stay tagged [PROPOSED], not [V4-R5].
--   CONNECT, schema USAGE/CREATE, default privileges   v4 silent   [CC] stands
--
-- **NO grant in this file contradicts primary v4 R5.** The defect was confined
-- to the provenance premise, not to the grants themselves.
--
-- **This file is not reconstruction of v4.** It is an implementation artifact
-- whose provenance is disclosed per line, now against the primary. It still
-- needs King B's ruling before execution, and that requirement is untouched by
-- the recovery.
--
-- ============================================================================
-- PASSWORDS
-- ============================================================================
-- Placeholder tokens only. No real value appears in this file, and none may be
-- added to it. Values are supplied at execution time:
--
--   psql -v HMS_DDL_PASSWORD="..." -v HMS_RW_PASSWORD="..." \
--        -v HMS_RO_PASSWORD="..." -f db/roles.sql
--
-- R12 governs how those values reach the shell. As of 2026-08-13 the only
-- credential path on this machine is a persistent user-scope PGPASSWORD
-- variable, which is NOT the interactive prompt R12 requires. That conflict is
-- unresolved and is why this file is not executed.

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- Roles. Idempotent: CREATE ROLE has no IF NOT EXISTS, so each is guarded.
--
-- DEFECT FIXED 2026-08-15, on this file's FIRST EVER EXECUTION.
-- Each role was previously created inside a single DO $$ ... $$ block carrying
-- :'HMS_*_PASSWORD'. **psql does not substitute its variables inside a
-- dollar-quoted string.** The literal text :'HMS_DDL_PASSWORD' therefore
-- reached the server, which failed with:
--     ERROR: syntax error at or near ":"
-- Nothing was created; ON_ERROR_STOP halted on the first statement.
--
-- The fix splits each role into two statements, and the split is LOAD-BEARING.
-- Do not merge them back:
--   1. CREATE inside the DO block, which needs the guard but NO variable.
--   2. ALTER outside it, as a plain statement, where psql DOES substitute.
--
-- A useful consequence: ALTER runs unconditionally, so re-running this file
-- resets each password to the value currently in .env. .env is authoritative,
-- and a half-finished earlier run cannot leave a role holding a password that
-- no longer matches.
-- ----------------------------------------------------------------------------

-- hms_ddl. The ONLY role holding DDL. Used by db/migrate.ts and nothing else.
-- [V4-R5] v4 line 80, role table: hms_ddl | DDL | db/migrate.ts only.
-- [V4-R5] v4 line 82 gives the reason the third role exists at all, W17:
-- "without a third role, hms_rw silently carries DROP".
-- [CC] NOSUPERUSER, NOCREATEROLE and NOCREATEDB are added because "holds DDL"
-- must not mean "holds everything". v4 R5 does not say this.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_ddl') THEN
    CREATE ROLE hms_ddl NOLOGIN;
  END IF;
END
$$;

ALTER ROLE hms_ddl LOGIN PASSWORD :'HMS_DDL_PASSWORD'
  NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT;

-- hms_rw. SELECT, INSERT, UPDATE, DELETE, and NO DDL.
-- [V4-R5] v4 line 79, role table: hms_rw | SELECT, INSERT, UPDATE, DELETE.
-- **No DDL.** | persistence/write/
-- The round-four gate's X3 quoted this same rule second-hand. The quotation
-- was checked against the primary on 2026-08-14 and is faithful, so the
-- [GATE-Q] route it required is retired rather than merely corrected.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_rw') THEN
    CREATE ROLE hms_rw NOLOGIN;
  END IF;
END
$$;

ALTER ROLE hms_rw LOGIN PASSWORD :'HMS_RW_PASSWORD'
  NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT;

-- hms_ro. SELECT only, so the read path is structurally incapable of writing
-- rather than merely discouraged.
-- [V4-R5] v4 line 78, role table: hms_ro | SELECT only | persistence/read/
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_ro') THEN
    CREATE ROLE hms_ro NOLOGIN;
  END IF;
END
$$;

ALTER ROLE hms_ro LOGIN PASSWORD :'HMS_RO_PASSWORD'
  NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT;

-- ----------------------------------------------------------------------------
-- Database and schema. [CC] throughout: v2 and the gate are both silent here,
-- and without these the role names carry no actual separation.
-- ----------------------------------------------------------------------------

GRANT CONNECT ON DATABASE :"DBNAME" TO hms_ddl, hms_rw, hms_ro;

-- PUBLIC holds CREATE on the public schema in older defaults and holds USAGE
-- broadly. Strip it first so the grants below are the whole story rather than
-- an addition on top of an unknown baseline.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO hms_rw, hms_ro;

-- Only hms_ddl may create objects. This is the line that makes "NO DDL" true
-- for hms_rw rather than conventional.
GRANT USAGE, CREATE ON SCHEMA public TO hms_ddl;
REVOKE CREATE ON SCHEMA public FROM hms_rw, hms_ro;

-- ----------------------------------------------------------------------------
-- Default privileges. [CC] Without these, every future migration must remember
-- to grant, and a forgotten grant fails open in the direction of nobody having
-- access, which is noisy but survivable, or of the owner keeping everything,
-- which is silent. Defaults remove the choice.
--
-- FOR ROLE hms_ddl, because hms_ddl owns every table it creates.
-- ----------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE hms_ddl IN SCHEMA public
  GRANT SELECT ON TABLES TO hms_ro;

ALTER DEFAULT PRIVILEGES FOR ROLE hms_ddl IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hms_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE hms_ddl IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hms_rw;

-- ----------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT IN THIS FILE
-- ----------------------------------------------------------------------------
-- The column-level and table-level revokes that carry invariants I1 and I8
-- CANNOT live here, because they name tables that do not exist yet and a
-- REVOKE on a missing table is an error, not a no-op.
--
-- They belong in the B2 migration that CREATES those tables, in the same
-- migration, never retrofitted. Recorded here so they are not lost:
--
--   entries, invariant I1, order is join time and immutable
--     REVOKE UPDATE (joined_at) ON entries FROM hms_rw;          [V4-R5 L84]
--     REVOKE INSERT (joined_at) ON entries FROM hms_rw;          [PROPOSED X3]
--     REVOKE DELETE ON entries FROM hms_rw;                      [PROPOSED X3]
--   The split is load-bearing: only the UPDATE revoke is in v4. The INSERT and
--   DELETE revokes are the remediation package widening it, and are unsealed.
--
--   events, invariant I8, the fairness log is append-only    [PROPOSED X7]
--     REVOKE UPDATE, DELETE ON events FROM hms_rw;
--
-- X7 is the finding absent from the remediation package, which is why that
-- package's "all sixteen findings" claim is false by one. Without the events
-- revoke the audit trail is editable by the role it exists to audit.
--
-- NOTE the interaction with the default privileges above: ALTER DEFAULT
-- PRIVILEGES grants hms_rw full DML on new tables, so both revokes must run
-- AFTER each CREATE TABLE in the same migration. A revoke that runs before the
-- table exists errors; a revoke that never runs leaves the invariant false
-- while the grant looks correct. This ordering is the mechanism, not a detail.
