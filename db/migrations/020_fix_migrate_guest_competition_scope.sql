-- KickStock · Migration 020 · Fix migrate_guest_to_user competition scoping
--
-- Bug: after migration 012/017, portfolios are scoped by (user_id, competition_id)
-- and (device_id, competition_id) — a single user/device can have MULTIPLE
-- portfolio rows, one per competition (competition_id NULL included).
--
-- migrate_guest_to_user() looks up "the" existing user portfolio with
--   SELECT id, best_score FROM portfolios WHERE user_id = p_user_id LIMIT 1
-- with no competition_id filter. Since migration 019, handle_new_user() always
-- successfully inserts a fresh empty portfolio (competition_id IS NULL, cash=10000,
-- best_score IS NULL, device_id IS NULL) for every brand-new auth.users row —
-- created microseconds BEFORE the callback calls migrate_guest_to_user().
--
-- Result: v_user_id_existing always matches this unrelated, empty,
-- different-competition portfolio, so the function always takes the
-- "conflict" branch. With both best_score = 0, it falls into the
-- 'conflict_resolved / kept=user' branch, which (a) never links the guest
-- portfolio to the new user and (b) never returns guest_username — so the
-- guest's chosen pseudo (e.g. "KickStockMaster") is lost and the OAuth user
-- keeps the auto-generated "kickstock_ga_xxxxxxxx" username.
--
-- Fix:
--   1. Scope the "existing user portfolio" lookup to the SAME competition_id
--      as the guest portfolio (NULL-safe via IS NOT DISTINCT FROM), so the
--      trigger-created empty/different-scope portfolio no longer causes a
--      false conflict.
--   2. Always return guest_username (when present) in every branch, so the
--      callback can apply it to profiles.username even when the existing
--      user portfolio's game data is kept.

CREATE OR REPLACE FUNCTION migrate_guest_to_user(
  p_device_id TEXT,
  p_user_id   UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest_id         UUID;
  v_guest_best       NUMERIC;
  v_guest_username   TEXT;
  v_guest_comp       INTEGER;
  v_user_id_existing UUID;
  v_user_best        NUMERIC;
BEGIN
  -- Find guest portfolio (must be unlinked to any user)
  SELECT id, best_score, guest_username, competition_id
  INTO   v_guest_id, v_guest_best, v_guest_username, v_guest_comp
  FROM   portfolios
  WHERE  device_id = p_device_id
    AND  user_id IS NULL
  LIMIT  1;

  IF v_guest_id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_guest');
  END IF;

  -- Check if this user already has a portfolio IN THE SAME COMPETITION SCOPE.
  -- (A freshly created empty portfolio from handle_new_user() has
  -- competition_id IS NULL and must not be confused with a different
  -- competition scope's portfolio.)
  SELECT id, best_score
  INTO   v_user_id_existing, v_user_best
  FROM   portfolios
  WHERE  user_id = p_user_id
    AND  competition_id IS NOT DISTINCT FROM v_guest_comp
  LIMIT  1;

  -- ── Simple case: no existing user portfolio in this scope ────────────────────
  IF v_user_id_existing IS NULL THEN
    UPDATE portfolios
    SET    user_id   = p_user_id,
           device_id = p_device_id
    WHERE  id = v_guest_id;

    RETURN jsonb_build_object(
      'status',         'migrated',
      'guest_username', v_guest_username
    );
  END IF;

  -- ── Conflict: two portfolios exist in the same scope ─────────────────────────
  IF COALESCE(v_guest_best, 0) > COALESCE(v_user_best, 0) THEN
    -- Guest wins: delete old user portfolio, promote guest to user account
    DELETE FROM portfolios WHERE id = v_user_id_existing;
    UPDATE portfolios
    SET    user_id   = p_user_id,
           device_id = p_device_id
    WHERE  id = v_guest_id;

    RETURN jsonb_build_object(
      'status',         'conflict_resolved',
      'kept',           'guest',
      'guest_username', v_guest_username
    );
  ELSE
    -- User portfolio wins: orphan the guest portfolio, but still propagate
    -- the chosen pseudo so it can be applied to profiles.username.
    UPDATE portfolios SET device_id = NULL WHERE id = v_guest_id;

    RETURN jsonb_build_object(
      'status',         'conflict_resolved',
      'kept',           'user',
      'guest_username', v_guest_username
    );
  END IF;
END;
$$;
