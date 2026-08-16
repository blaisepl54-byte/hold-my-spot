-- 004_entry_counter.sql
-- B6. The prototype's console has named counters, each serving one entry at a
-- time. This carries that association.
--
-- ADDITIVE ONLY. Nullable text, no DROP, no destructive ALTER. An entry that is
-- not called carries NULL, which is every entry until an operator calls it.
--
-- WHY A COLUMN AND NOT A TABLE. A counters table would need its own identity,
-- its own grants, its own referential integrity, and a ruling on whether a
-- counter is branch configuration or queue state. The prototype treats a
-- counter as a LABEL on the entry being served, and B6 asks to match the
-- prototype's BEHAVIOUR. A table is the right shape when counters gain
-- properties of their own; today they have none, so this is the smaller claim.
-- Flagged as a deliberate simplification rather than presented as equivalent.
--
-- GRANT IN THE SAME MIGRATION, for the same reason as 003: hms_rw holds
-- column-level grants that enumerate writable columns, so a new column is
-- unwritable until named. joined_at remains absent from both lists.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS counter text;

GRANT INSERT (counter) ON entries TO hms_rw;
GRANT UPDATE (counter) ON entries TO hms_rw;
