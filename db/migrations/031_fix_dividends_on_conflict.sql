-- 031_fix_dividends_on_conflict.sql
--
-- distribute_competition_dividends (migration 012) upserts into `dividends`
-- with `ON CONFLICT (portfolio_id, nation_id, round)`, but migration 012's
-- own section 13 later changed the table's actual unique constraint to
-- `(portfolio_id, competition_id, nation_id, round)`. The two were never
-- reconciled — the function's ON CONFLICT target doesn't match any
-- constraint/index, so every call fails with 42P10 ("no unique or exclusion
-- constraint matching the ON CONFLICT specification"). This never surfaced
-- before because the `dividends` table itself was missing (see 030) until
-- now — recreating it just exposed this second, pre-existing bug.

CREATE OR REPLACE FUNCTION distribute_competition_dividends(
  p_competition_id INTEGER,
  p_team_id        TEXT,
  p_round          TEXT,
  p_rate           NUMERIC,
  p_price          NUMERIC,
  p_day_index      INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  INTEGER := 0;
  rec      RECORD;
  v_amount NUMERIC(12,2);
BEGIN
  FOR rec IN
    SELECT h.portfolio_id, h.quantity
    FROM holdings h
    WHERE h.nation_id = p_team_id
      AND h.competition_id = p_competition_id
      AND h.quantity > 0
  LOOP
    v_amount := ROUND(rec.quantity * p_price * p_rate, 1);
    IF v_amount <= 0 THEN CONTINUE; END IF;

    UPDATE portfolios SET cash = cash + v_amount, updated_at = NOW()
    WHERE id = rec.portfolio_id;

    INSERT INTO dividends (portfolio_id, nation_id, competition_id, round, amount, shares, day_index)
    VALUES (rec.portfolio_id, p_team_id, p_competition_id, p_round, v_amount, rec.quantity, p_day_index)
    ON CONFLICT (portfolio_id, competition_id, nation_id, round) DO UPDATE
      SET amount = dividends.amount + EXCLUDED.amount;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
