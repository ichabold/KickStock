-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Fix: best_score leaking across competitions
--
-- Each user/device has ONE portfolio row PER competition_id (see
-- get_or_create_competition_portfolio, migration 012). The old
-- syncBestScore()/sync_guest_best_score() updated best_score filtered only
-- by user_id/device_id — with no competition_id filter, a high score
-- reached in one competition could be written onto the portfolio row of a
-- different (e.g. brand-new) competition, making its trophy display a
-- value the player never reached there.
--
--  1. sync_guest_best_score now takes p_competition_id and scopes the
--     UPDATE to that competition's portfolio row (mirrors the app-side fix
--     in useAuth.ts's syncBestScore, which now scopes via .eq('competition_id', ...)).
--
--  2. Data cleanup: a portfolio that has never been touched (still at the
--     starting cash=10000, no trades, no holdings) cannot legitimately have
--     a best_score above 10000 — any such value was leaked in from another
--     competition's portfolio by the old unscoped UPDATE. Reset those.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP FUNCTION IF EXISTS sync_guest_best_score(TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION sync_guest_best_score(
  p_device_id      TEXT,
  p_score          NUMERIC,
  p_competition_id INTEGER DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE portfolios
  SET best_score = p_score
  WHERE device_id = p_device_id
    AND user_id IS NULL
    AND competition_id IS NOT DISTINCT FROM p_competition_id
    AND (best_score IS NULL OR best_score < p_score);
END;
$$;

GRANT EXECUTE ON FUNCTION sync_guest_best_score(TEXT, NUMERIC, INTEGER) TO anon, authenticated;

-- ── Data cleanup ────────────────────────────────────────────────────────────
UPDATE portfolios p
SET best_score = NULL
WHERE p.best_score > 10000
  AND p.cash = 10000
  AND p.avg_cost = '{}'::jsonb
  AND p.tx_log = '[]'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM holdings h
    WHERE h.portfolio_id = p.id AND h.quantity > 0
  );
