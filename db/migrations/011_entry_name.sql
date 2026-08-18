-- 011_entry_name.sql
-- FE-001 commission, backend half. The guest's name.
--
-- ADDITIVE ONLY. One nullable column, two column grants. Nothing about the
-- status set, ordering, or any proven grant changes.
--
-- NULLABLE, DELIBERATELY: every existing row stays valid, and a customer who
-- declines to give a name is a customer, not an error. The console falls back
-- to the channel and time it always showed.
--
-- Name is customer data, covered by the same privacy posture as `contact`
-- (003): it appears on staff surfaces, never in the fairness log's event rows,
-- and the repo stays private.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS name text;

-- INSERT for capture at join (reception form supplies it); UPDATE for the
-- WhatsApp flow, where the name arrives one message AFTER the join.
GRANT INSERT (name) ON entries TO hms_rw;
GRANT UPDATE (name) ON entries TO hms_rw;
