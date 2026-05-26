-- KickStock · Migration 006 · Guest Auth
-- Adds guest_username to portfolios and updates the leaderboard view.
-- Run AFTER 005_centralized_engine.sql.

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. Add guest_username to portfolios
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS guest_username TEXT;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. Leaderboard view — includes both registered users and guests
--    Replaces the view from 004_competitions.sql / FULL_SETUP.sql.
--    Guests without a username are excluded (not yet onboarded).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DROP VIEW IF EXISTS leaderboard;

CREATE VIEW leaderboard AS
SELECT
  p.id,
  COALESCE(pr.username, p.guest_username)                               AS username,
  pr.country,
  CASE WHEN p.user_id IS NOT NULL THEN 'registered' ELSE 'guest' END   AS user_type,
  p.best_score,
  p.updated_at
FROM portfolios p
LEFT JOIN profiles pr ON pr.id = p.user_id
WHERE p.best_score IS NOT NULL
  AND (pr.username IS NOT NULL OR p.guest_username IS NOT NULL)
ORDER BY p.best_score DESC;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. RPC: set_guest_username
--    Called by POST /api/auth/guest after server-side uniqueness check.
--    Sets guest_username on an existing device_id portfolio.
--    Returns 'ok' on success, 'not_found' if no portfolio for this device_id.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION set_guest_username(
  p_device_id TEXT,
  p_username  TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE portfolios
  SET guest_username = p_username
  WHERE device_id = p_device_id;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  RETURN 'ok';
END;
$$;
