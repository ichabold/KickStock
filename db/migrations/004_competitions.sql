-- KickStock · Migration 004 · Phase 3 — Competitions (temps réel)
-- Run AFTER 001, 002, 003
-- Prépare l'infrastructure pour la compétition synchronisée en temps réel (Phase 3)
-- où tous les joueurs jouent la même compétition avec les vrais résultats FIFA.

-- ── COMPETITIONS ─────────────────────────────────────────────────────────────
-- Une "room" de compétition partagée. En Phase 3, une compétition "officielle"
-- sera créée par l'admin et synchronisée avec les vrais résultats via API FIFA.
CREATE TABLE IF NOT EXISTS competitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,          -- ex: "KICK26" (code de rejoindre)
  name            TEXT NOT NULL,                 -- ex: "KickStock World Cup 2026"
  status          TEXT NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting','active','finished')),
  mode            TEXT NOT NULL DEFAULT 'manual'
                    CHECK (mode IN ('manual','realtime')),
                    -- manual   = Phase 2 (chacun avance à sa guise, résultats simulés)
                    -- realtime = Phase 3 (résultats officiels FIFA, avancement auto)
  is_official     BOOLEAN DEFAULT FALSE,         -- TRUE = compétition principale Phase 3
  day_index       INTEGER NOT NULL DEFAULT 0,
  prices          JSONB   NOT NULL DEFAULT '{}', -- { "FRA": 120.5, "ESP": 95.0, ... }
  eliminated      TEXT[]  NOT NULL DEFAULT '{}',
  match_results   JSONB   NOT NULL DEFAULT '{}', -- { "0": [...StoredMatchResult] }
  champion        TEXT,
  r32_pool        TEXT[]  NOT NULL DEFAULT '{}',
  r16_pool        TEXT[]  NOT NULL DEFAULT '{}',
  qf_pool         TEXT[]  NOT NULL DEFAULT '{}',
  sf_pool         TEXT[]  NOT NULL DEFAULT '{}',
  final_pool      TEXT[]  NOT NULL DEFAULT '{}',
  third_pool      TEXT[]  NOT NULL DEFAULT '{}',
  advancing_lock  BOOLEAN NOT NULL DEFAULT FALSE, -- verrou anti-doublon sur advance_day
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── COMPETITION_PLAYERS ───────────────────────────────────────────────────────
-- État individuel de chaque joueur dans une compétition partagée.
CREATE TABLE IF NOT EXISTS competition_players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cash            NUMERIC(12,2) NOT NULL DEFAULT 10000,
  portfolio       JSONB NOT NULL DEFAULT '{}', -- { "FRA": 3, "ESP": 2 }
  avg_cost        JSONB NOT NULL DEFAULT '{}', -- { "FRA": 110.0 }
  tx_log          JSONB NOT NULL DEFAULT '[]', -- [ { dir, flag, name, qty, price, day } ]
  best_score      NUMERIC(12,2),
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(competition_id, user_id)
);

-- ── COMPETITION_TRADES ────────────────────────────────────────────────────────
-- Log immuable de tous les trades dans une compétition (audit + replay).
CREATE TABLE IF NOT EXISTS competition_trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nation_id       TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('buy','sell')),
  quantity        INTEGER NOT NULL,
  price           NUMERIC(10,2) NOT NULL,
  tax             NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_amount      NUMERIC(12,2) NOT NULL,
  day_index       INTEGER NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_comp_players_comp   ON competition_players(competition_id);
CREATE INDEX IF NOT EXISTS idx_comp_players_user   ON competition_players(user_id);
CREATE INDEX IF NOT EXISTS idx_comp_trades_comp    ON competition_trades(competition_id);
CREATE INDEX IF NOT EXISTS idx_comp_trades_user    ON competition_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_comp_trades_nation  ON competition_trades(nation_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE competitions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_trades  ENABLE ROW LEVEL SECURITY;

-- Competitions: visible par tous les joueurs connectés
CREATE POLICY "comp_select_authenticated"
  ON competitions FOR SELECT
  USING (auth.role() = 'authenticated');

-- Competition players: chacun voit ses propres données + lecture du leaderboard
CREATE POLICY "comp_players_select_own"
  ON competition_players FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "comp_players_select_leaderboard"
  ON competition_players FOR SELECT
  USING (TRUE); -- Tout le monde peut voir le leaderboard

CREATE POLICY "comp_players_insert_own"
  ON competition_players FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "comp_players_update_own"
  ON competition_players FOR UPDATE
  USING (auth.uid() = user_id);

-- Competition trades: insert/read propres trades
CREATE POLICY "comp_trades_select_own"
  ON competition_trades FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "comp_trades_insert_own"
  ON competition_trades FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── TRIGGER: updated_at ───────────────────────────────────────────────────────
CREATE TRIGGER competitions_updated_at
  BEFORE UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── LEADERBOARD VIEW ──────────────────────────────────────────────────────────
-- Vue Phase 2 : meilleur score solo de chaque joueur (toutes parties confondues)
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  p.id,
  p.username,
  p.country,
  po.best_score,
  po.updated_at
FROM profiles p
JOIN portfolios po ON po.user_id = p.id
WHERE po.best_score IS NOT NULL
ORDER BY po.best_score DESC;

-- Vue Phase 3 : classement dans une compétition spécifique
-- Usage: SELECT * FROM competition_leaderboard WHERE competition_id = '...'
CREATE OR REPLACE VIEW competition_leaderboard AS
SELECT
  cp.competition_id,
  cp.user_id,
  p.username,
  p.country,
  cp.cash,
  cp.portfolio,
  cp.best_score,
  -- Valeur totale calculée côté applicatif (prix stockés dans competitions.prices)
  cp.cash AS total_value, -- à enrichir côté app avec prix actuels
  cp.joined_at
FROM competition_players cp
JOIN profiles p ON p.id = cp.user_id
ORDER BY cp.cash DESC; -- ordre approximatif, à trier côté app avec la vraie valeur

-- ── REALTIME ─────────────────────────────────────────────────────────────────
-- Active Supabase Realtime sur competitions pour broadcast des mises à jour
-- (à activer dans le dashboard Supabase : Table Editor → competitions → Realtime ON)
-- ALTER PUBLICATION supabase_realtime ADD TABLE competitions;
-- ALTER PUBLICATION supabase_realtime ADD TABLE competition_players;
