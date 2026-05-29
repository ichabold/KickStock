-- KickStock · Migration 010 · API-Football Integration
-- Adds infrastructure for real-time competition data from API-Football v3.
-- Run AFTER 001–009.
--
-- What this does:
--   1. Renames the Phase-2 prototype "competitions" table to "game_rooms"
--      (it was never shipped and is empty in prod)
--   2. Creates the new "competitions" table as the API-Football registry
--   3. Creates "teams", "competition_teams", "competition_days" tables
--   4. Adds API columns to the existing "matches" table
--   5. Seeds the FIFA World Cup 2026 competition

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 0. Rename old prototype tables so the "competitions" name is free
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- These tables were created in 004 but never used in production.
-- Renaming is non-destructive (data preserved, FKs updated automatically).

ALTER TABLE IF EXISTS competition_players RENAME TO game_room_players;
ALTER TABLE IF EXISTS competition_trades  RENAME TO game_room_trades;
ALTER TABLE IF EXISTS competitions        RENAME TO game_rooms;

-- Fix FK column name for clarity
ALTER TABLE IF EXISTS game_room_players
  RENAME COLUMN competition_id TO game_room_id;
ALTER TABLE IF EXISTS game_room_trades
  RENAME COLUMN competition_id TO game_room_id;

-- Rename indexes that referenced old table names
ALTER INDEX IF EXISTS idx_comp_players_comp RENAME TO idx_grp_players_room;
ALTER INDEX IF EXISTS idx_comp_players_user RENAME TO idx_grp_players_user;
ALTER INDEX IF EXISTS idx_comp_trades_comp  RENAME TO idx_grp_trades_room;
ALTER INDEX IF EXISTS idx_comp_trades_user  RENAME TO idx_grp_trades_user;
ALTER INDEX IF EXISTS idx_comp_trades_nation RENAME TO idx_grp_trades_nation;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. COMPETITIONS — API-Football competition registry
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS competitions (
  id              SERIAL        PRIMARY KEY,
  league_id       INTEGER       NOT NULL,         -- API-Football league id (1 = FIFA WC)
  season          INTEGER       NOT NULL,         -- e.g. 2026
  name            TEXT          NOT NULL,         -- "FIFA World Cup 2026"
  start_date      DATE,                           -- first match date (used for day_index calc)
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  last_sync_at    TIMESTAMPTZ,                    -- set by sync-fixtures cron
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, season)
);

-- Seed: FIFA World Cup 2026
INSERT INTO competitions (league_id, season, name, start_date)
VALUES (1, 2026, 'FIFA World Cup 2026', '2026-06-11')
ON CONFLICT (league_id, season) DO NOTHING;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. TEAMS — replaces the hardcoded NATIONS constant
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS teams (
  id              TEXT          PRIMARY KEY,      -- "BRA", "FRA" (via team-mapping)
  api_team_id     INTEGER       UNIQUE,           -- API-Football team.id
  name            TEXT          NOT NULL,         -- official name from API
  logo_url        TEXT,                           -- https://media.api-sports.io/football/teams/...
  flag_emoji      TEXT,                           -- derived: isoToFlagEmoji("BR") → 🇧🇷
  confederation   TEXT,                           -- "UEFA"|"CONMEBOL"|"CAF"|"AFC"|"CONCACAF"|"OFC"
  -- Game-design parameters (seeded from FIFA rankings via seed-team-rankings.ts)
  strength        INTEGER       NOT NULL DEFAULT 75   CHECK (strength BETWEEN 0 AND 100),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. COMPETITION_TEAMS — group assignment + price per competition
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS competition_teams (
  competition_id  INTEGER       NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id         TEXT          NOT NULL REFERENCES teams(id)        ON DELETE CASCADE,
  group_code      TEXT,                           -- "A"…"L" from fixture.league.group
  initial_price   INTEGER       NOT NULL DEFAULT 100, -- KC (seeded from FIFA rankings)
  PRIMARY KEY (competition_id, team_id)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. COMPETITION_DAYS — replaces the hardcoded CALENDAR constant
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS competition_days (
  id              SERIAL        PRIMARY KEY,
  competition_id  INTEGER       NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  day_index       INTEGER       NOT NULL CHECK (day_index >= 0),
  date_label      TEXT          NOT NULL,         -- "Jun 11"
  full_label      TEXT          NOT NULL,         -- "Day 1 · Thu Jun 11" | "R32 · Sun Jun 28"
  phase           TEXT          NOT NULL,         -- "Groups"|"R32"|"R16"|"QF"|"SF"|"3rd"|"Final"
  is_ko           BOOLEAN       NOT NULL DEFAULT FALSE,
  div_key         TEXT,                           -- null|"r32"|"r16"|"qf"|"sf"|"final"
  UNIQUE (competition_id, day_index)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. MATCHES — add API-Football columns to existing table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- The matches table already exists (created implicitly by advance/route.ts usage).
-- If it does not exist yet, create it; otherwise, just add the new columns.

CREATE TABLE IF NOT EXISTS matches (
  id          TEXT          PRIMARY KEY,
  day_index   INTEGER,
  nation_a    TEXT,
  nation_b    TEXT,
  venue       TEXT,
  phase       TEXT,
  score_a     INTEGER,
  score_b     INTEGER,
  winner_id   TEXT,
  is_upset    BOOLEAN,
  played_at   TIMESTAMPTZ,
  result_data JSONB
);

-- API-Football columns (idempotent — IF NOT EXISTS guards)
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS fixture_id       INTEGER UNIQUE,
  ADD COLUMN IF NOT EXISTS competition_id   INTEGER REFERENCES competitions(id),
  ADD COLUMN IF NOT EXISTS api_status       TEXT    NOT NULL DEFAULT 'NS',
  ADD COLUMN IF NOT EXISTS league_round     TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trade_lock_until TIMESTAMPTZ;

-- Index for isMatchWindowActive() — only unprocessed, non-cancelled fixtures
CREATE INDEX IF NOT EXISTS idx_matches_window
  ON matches (scheduled_at)
  WHERE processed_at IS NULL
    AND api_status NOT IN ('PST', 'SUSP', 'CANC', 'ABD');

-- Index for trading-lock lookups
CREATE INDEX IF NOT EXISTS idx_matches_trade_lock
  ON matches (nation_a, nation_b, scheduled_at, trade_lock_until)
  WHERE api_status NOT IN ('PST', 'SUSP', 'CANC', 'ABD');

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. GAME_STATE — extend to support multiple competitions
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE game_state
  ADD COLUMN IF NOT EXISTS competition_id INTEGER REFERENCES competitions(id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 7. RLS for new tables
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- competitions: readable by all, writable only by service role
ALTER TABLE competitions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_days  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitions_read_all"
  ON competitions FOR SELECT USING (TRUE);

CREATE POLICY "teams_read_all"
  ON teams FOR SELECT USING (TRUE);

CREATE POLICY "competition_teams_read_all"
  ON competition_teams FOR SELECT USING (TRUE);

CREATE POLICY "competition_days_read_all"
  ON competition_days FOR SELECT USING (TRUE);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 8. TRADING LOCK RPC (Supabase function)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Checks if a nation is currently trade-locked.
-- Called from execute_trade before allowing any buy/sell.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 9. upsert_fixture RPC — CRITICAL: never touches processed_at / scores
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Called exclusively by sync-fixtures cron.
-- Explicit DO UPDATE SET clause guarantees that processed_at, score_a,
-- score_b, trade_lock_until are NEVER overwritten by the daily sync.
CREATE OR REPLACE FUNCTION upsert_fixture(
  p_fixture_id     INTEGER,
  p_competition_id INTEGER,
  p_nation_a       TEXT,
  p_nation_b       TEXT,
  p_day_index      INTEGER,
  p_phase          TEXT,
  p_league_round   TEXT,
  p_venue          TEXT,
  p_scheduled_at   TIMESTAMPTZ,
  p_api_status     TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO matches (
    id,
    fixture_id, competition_id,
    nation_a, nation_b,
    day_index, phase,
    league_round, venue,
    scheduled_at, api_status
  ) VALUES (
    'm_api_' || p_fixture_id,
    p_fixture_id, p_competition_id,
    p_nation_a, p_nation_b,
    p_day_index, p_phase,
    p_league_round, p_venue,
    p_scheduled_at, p_api_status
  )
  ON CONFLICT (fixture_id) DO UPDATE SET
    scheduled_at = EXCLUDED.scheduled_at,
    api_status   = EXCLUDED.api_status,
    league_round = EXCLUDED.league_round,
    venue        = EXCLUDED.venue,
    day_index    = EXCLUDED.day_index,
    phase        = EXCLUDED.phase;
    -- processed_at     → NOT updated (never touched after result processing)
    -- score_a, score_b → NOT updated (set by processRealMatchResult only)
    -- trade_lock_until → NOT updated (set by processRealMatchResult only)
    -- result_data      → NOT updated (set by processRealMatchResult only)
END;
$$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 10. update_prices_after_match RPC
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Updates current prices for both nations and inserts price history rows.
CREATE OR REPLACE FUNCTION update_prices_after_match(
  p_nation_a     TEXT,
  p_new_price_a  NUMERIC,
  p_nation_b     TEXT,
  p_new_price_b  NUMERIC,
  p_day_index    INTEGER
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE nations SET current_price = p_new_price_a WHERE id = p_nation_a;
  UPDATE nations SET current_price = p_new_price_b WHERE id = p_nation_b;

  INSERT INTO nation_prices (nation_id, price, day_index, effective_at)
  VALUES
    (p_nation_a, p_new_price_a, p_day_index, NOW()),
    (p_nation_b, p_new_price_b, p_day_index, NOW())
  ON CONFLICT (nation_id, day_index) DO UPDATE SET
    price        = EXCLUDED.price,
    effective_at = EXCLUDED.effective_at;
END;
$$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 11. is_trade_locked RPC
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION is_trade_locked(p_nation_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM matches
    WHERE (nation_a = p_nation_id OR nation_b = p_nation_id)
      AND api_status NOT IN ('PST', 'SUSP', 'CANC', 'ABD')
      AND scheduled_at  <= NOW() + INTERVAL '5 minutes'
      AND (processed_at IS NULL OR trade_lock_until > NOW())
  );
$$;
