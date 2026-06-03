-- KickStock · Migration 014 · Players & Squad Data
-- Stores real squad information fetched from API-Football (/players/squads).
-- Used by genGoals() to display real player names in goal timelines.
-- Run AFTER 001–013.

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. PLAYERS — global player registry
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS players (
  id          INTEGER       PRIMARY KEY,   -- API-Football player ID
  name        TEXT          NOT NULL,
  photo_url   TEXT,
  nationality TEXT,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "players_read_all" ON players FOR SELECT USING (TRUE);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. TEAM_PLAYERS — squad assignments per team per season
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS team_players (
  player_id   INTEGER       NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id     TEXT          NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  season      INTEGER       NOT NULL,
  -- "Goalkeeper" | "Defender" | "Midfielder" | "Attacker"
  position    TEXT,
  number      INTEGER,
  PRIMARY KEY (player_id, team_id, season)
);

CREATE INDEX IF NOT EXISTS idx_team_players_team_season
  ON team_players(team_id, season);

ALTER TABLE team_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_players_read_all" ON team_players FOR SELECT USING (TRUE);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. TEAMS — add strength_updated_at for tracking when strength was last synced
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE teams ADD COLUMN IF NOT EXISTS strength_updated_at TIMESTAMPTZ;
