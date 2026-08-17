-- 010_predicted_wait.sql
-- C4 prerequisite, Build Order 3.
--
-- ADDITIVE ONLY. Two nullable integer columns and their grants.
--
-- WHY THIS EXISTS. C4 requires "estimate calibration: predicted range against
-- observed duration, which is how you learn whether the agent is any good."
-- That comparison is IMPOSSIBLE without the prediction: nothing in the schema
-- records what the customer was told, so after the fact there is no way to know
-- whether the agent was right. Recomputing an estimate later would compare
-- today's model against today's data and always look accurate, which is worse
-- than no calibration because it would read as evidence.
--
-- Both nullable. Entries joined before this migration were never given a
-- prediction, and inventing one would be fabrication of exactly the number the
-- calibration is meant to audit.
--
-- NOTE ON THE OTHER CALIBRATION. C2's `wait_match` is the SUBJECTIVE signal:
-- what the customer felt relative to what they expected. These columns are the
-- OBJECTIVE one: what we said against what happened. They answer different
-- questions and the dashboard shows both, because a branch can be accurate and
-- still feel slow.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS predicted_low_minutes  integer;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS predicted_high_minutes integer;

-- A prediction is a range or it is nothing. This makes R-G structural for
-- stored predictions too: a row cannot carry a single number, because a point
-- value is exactly what R-G forbids showing a customer.
ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_prediction_is_a_range;
ALTER TABLE entries ADD CONSTRAINT entries_prediction_is_a_range CHECK (
    (predicted_low_minutes IS NULL AND predicted_high_minutes IS NULL)
    OR (predicted_low_minutes IS NOT NULL
        AND predicted_high_minutes IS NOT NULL
        AND predicted_high_minutes > predicted_low_minutes)
);

GRANT INSERT (predicted_low_minutes, predicted_high_minutes) ON entries TO hms_rw;
GRANT UPDATE (predicted_low_minutes, predicted_high_minutes) ON entries TO hms_rw;

DO $$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n FROM entries WHERE predicted_low_minutes IS NOT NULL;
    RAISE NOTICE 'C4: entries carrying a stored prediction = % (0 expected; nothing is backfilled)', n;
END
$$;
