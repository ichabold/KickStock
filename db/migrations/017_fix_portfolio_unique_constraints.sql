-- KickStock · Migration 017 · Fix portfolio unique constraints for multi-competition
--
-- Problem: migration 001 created portfolios with UNIQUE(user_id) and migration 005
-- added UNIQUE(device_id). Migration 012 added competition_id scope but never dropped
-- those single-column unique constraints. As a result, a player with an existing
-- portfolio cannot create a second one for a new competition — INSERT fails with
-- duplicate key violation on portfolios_user_id_key or the device_id constraint.
--
-- Fix: drop the single-column unique constraints and replace with composite
-- unique indexes scoped to (user_id, competition_id) and (device_id, competition_id).

-- ── 1. Drop legacy single-column unique constraints ──────────────────────────
ALTER TABLE portfolios DROP CONSTRAINT IF EXISTS portfolios_user_id_key;
ALTER TABLE portfolios DROP CONSTRAINT IF EXISTS portfolios_device_id_key;

-- Some Supabase versions name constraints differently — cover both patterns
ALTER TABLE portfolios DROP CONSTRAINT IF EXISTS portfolios_user_id_unique;
ALTER TABLE portfolios DROP CONSTRAINT IF EXISTS portfolios_device_id_unique;

-- Drop any unique indexes created inline (migration 005 used ADD COLUMN ... UNIQUE)
DROP INDEX IF EXISTS portfolios_user_id_idx;
DROP INDEX IF EXISTS portfolios_device_id_idx;

-- ── 2. Add composite unique constraints scoped to competition ─────────────────
-- One portfolio per (user, competition) — NULLs excluded so guests aren't blocked
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_competition_uidx
  ON portfolios (user_id, competition_id)
  WHERE user_id IS NOT NULL;

-- One portfolio per (device, competition) — NULLs excluded so registered users
-- who cleared their device_id aren't blocked
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_device_competition_uidx
  ON portfolios (device_id, competition_id)
  WHERE device_id IS NOT NULL;
