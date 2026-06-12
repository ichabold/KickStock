-- KickStock · Migration 019 · Fix handle_new_user() ON CONFLICT target
--
-- Problem: migration 017 dropped the single-column unique constraint
-- portfolios_user_id_key (replaced by the partial composite index
-- portfolios_user_competition_uidx on (user_id, competition_id) WHERE
-- user_id IS NOT NULL). The handle_new_user() trigger (from migration 009)
-- still does `ON CONFLICT (user_id) DO NOTHING`, which no longer matches any
-- constraint/index — Postgres raises 42P10 "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification". Since this trigger runs
-- AFTER INSERT ON auth.users, the whole signup transaction fails with
-- "Database error saving new user" (500) for every new email/Google signup.
--
-- Fix: target the partial composite index that actually exists.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
  v_is_auto  BOOLEAN;
BEGIN
  -- Email signup passes { username: '<pseudo>' } in options.data
  IF (NEW.raw_user_meta_data->>'username') IS NOT NULL
     AND length(trim(COALESCE(NEW.raw_user_meta_data->>'username', ''))) >= 3
  THEN
    v_username := trim(NEW.raw_user_meta_data->>'username');
    v_is_auto  := FALSE;
  ELSE
    -- Fallback: derive from email local-part + 8-char UUID hex (guaranteed unique)
    v_username := COALESCE(
      NULLIF(
        left(lower(regexp_replace(
          split_part(COALESCE(NEW.email, ''), '@', 1),
          '[^a-z0-9_]', '_', 'g'
        )), 12),
        ''
      ),
      'user'
    ) || '_' || substr(replace(NEW.id::TEXT, '-', ''), 1, 8);
    v_is_auto := TRUE;
  END IF;

  INSERT INTO profiles (id, username, is_auto)
    VALUES (NEW.id, v_username, v_is_auto)
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO portfolios (user_id, cash)
    VALUES (NEW.id, 10000)
    ON CONFLICT (user_id, competition_id) WHERE user_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;
