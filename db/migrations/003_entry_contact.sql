-- 003_entry_contact.sql
-- B5. A remote entry needs a destination for its confirmation prompt.
--
-- ADDITIVE ONLY. No DROP, no destructive ALTER, no column removed, no type
-- narrowed. `contact` is nullable, so every existing row remains valid and
-- on-site entries (qr, reception) simply never carry one.
--
-- GRANT IN THE SAME MIGRATION, and here that is not a style preference but a
-- correctness requirement. Migration 002 replaced hms_rw's table-level INSERT
-- and UPDATE with COLUMN-LEVEL grants that enumerate each writable column. A
-- column added later is therefore NOT writable by hms_rw until it is named.
-- Omitting these two lines would produce a column the application can read and
-- never populate, failing at runtime rather than at migration time.
--
-- joined_at remains absent from both lists. Nothing here widens I1.
--
-- R11: entries is a product-data table and already carries is_synthetic. A
-- contact is customer data, so it is covered by that flag rather than needing
-- its own.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS contact text;

GRANT INSERT (contact) ON entries TO hms_rw;
GRANT UPDATE (contact) ON entries TO hms_rw;
