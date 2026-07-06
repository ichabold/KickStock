-- 032_fix_holdings_history_cascade.sql
--
-- liquidate_competition_eliminated() inserts a holdings_history row and then
-- DELETEs the holdings row it just referenced (028_fix_liquidation_price.sql).
-- Because holdings_history.holdings_id has ON DELETE CASCADE, that delete
-- immediately wipes the audit row we just inserted — every liquidation ever
-- recorded has been silently discarded (0 rows in holdings_history), even
-- though the cash credit + share removal themselves are correct.
--
-- Fix: ON DELETE SET NULL instead of CASCADE, so the audit row survives its
-- parent holdings row being deleted (quantity_before/after/delta/reason are
-- self-contained and don't need the FK to remain meaningful).

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'holdings_history'::regclass
    AND confrelid = 'holdings'::regclass
    AND contype = 'f';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE holdings_history DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE holdings_history ALTER COLUMN holdings_id DROP NOT NULL;

ALTER TABLE holdings_history ADD CONSTRAINT holdings_history_holdings_id_fkey
  FOREIGN KEY (holdings_id) REFERENCES holdings(id) ON DELETE SET NULL;
