-- 028_fix_liquidation_price.sql
-- Eliminated teams no longer crash to a price of 1 KC (see applyResult: KO
-- losers now simply lose 50% of their value, like any other match loss).
-- liquidate_competition_eliminated must credit cash at the team's real
-- post-match price, not a hardcoded 1.

CREATE OR REPLACE FUNCTION liquidate_competition_eliminated(
  p_competition_id INTEGER,
  p_team_id        TEXT,
  p_day_index      INTEGER,
  p_price          NUMERIC DEFAULT 1
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec     RECORD;
  v_count INTEGER := 0;
  v_cash  NUMERIC;
BEGIN
  FOR rec IN
    SELECT h.id, h.portfolio_id, h.quantity
    FROM holdings h
    WHERE h.nation_id = p_team_id
      AND h.competition_id = p_competition_id
      AND h.quantity > 0
  LOOP
    v_cash := ROUND(rec.quantity * p_price, 1);

    UPDATE portfolios SET cash = cash + v_cash, updated_at = NOW()
    WHERE id = rec.portfolio_id;

    INSERT INTO holdings_history (holdings_id, quantity_before, quantity_after, delta, reason)
    VALUES (rec.id, rec.quantity, 0, -rec.quantity, 'liquidation');

    DELETE FROM holdings WHERE id = rec.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
