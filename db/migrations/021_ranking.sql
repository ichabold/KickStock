-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 021_ranking.sql
--
-- Adds the server-side pieces needed for the "Ranking" feature:
--
--  1. get_online_ranking(competition_id) — live standings (cash + holdings
--     value at current prices) for every player in a competition, ranked
--     descending. Used by the "Online" ranking tab.
--
--  2. sync_guest_best_score(device_id, score) — lets anonymous (guest)
--     players persist their best_score, mirroring what syncBestScore()
--     already does for logged-in users. Without this, guest best scores
--     never reach the `leaderboard` view (used by the "Offline" tab).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. get_online_ranking
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION get_online_ranking(p_competition_id INTEGER)
RETURNS TABLE (
  portfolio_id UUID,
  user_id      UUID,
  device_id    TEXT,
  username     TEXT,
  country      TEXT,
  user_type    TEXT,
  total_value  NUMERIC,
  rank         BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scored AS (
    SELECT
      p.id                                                      AS portfolio_id,
      p.user_id,
      p.device_id,
      COALESCE(pr.username, p.guest_username)                   AS username,
      pr.country,
      CASE WHEN p.user_id IS NOT NULL THEN 'registered' ELSE 'guest' END AS user_type,
      COALESCE(p.cash, 0) + COALESCE(hv.holdings_value, 0)       AS total_value
    FROM portfolios p
    LEFT JOIN profiles pr ON pr.id = p.user_id
    LEFT JOIN LATERAL (
      SELECT SUM(h.quantity * ct.current_price) AS holdings_value
      FROM holdings h
      JOIN competition_teams ct
        ON ct.team_id = h.nation_id AND ct.competition_id = p.competition_id
      WHERE h.portfolio_id = p.id
    ) hv ON TRUE
    WHERE p.competition_id = p_competition_id
      AND (pr.username IS NOT NULL OR p.guest_username IS NOT NULL)
  )
  SELECT
    scored.*,
    RANK() OVER (ORDER BY scored.total_value DESC) AS rank
  FROM scored
  ORDER BY total_value DESC;
$$;

GRANT EXECUTE ON FUNCTION get_online_ranking(INTEGER) TO anon, authenticated;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. sync_guest_best_score
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION sync_guest_best_score(
  p_device_id TEXT,
  p_score     NUMERIC
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
    AND (best_score IS NULL OR best_score < p_score);
END;
$$;

GRANT EXECUTE ON FUNCTION sync_guest_best_score(TEXT, NUMERIC) TO anon, authenticated;
