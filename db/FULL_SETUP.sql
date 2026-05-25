-- ═══════════════════════════════════════════════════════════════════════════════
-- KickStock · FULL SETUP (001 → 002 → 003 → seed → 004 → 005 → seed-001)
-- Colle CE FICHIER EN ENTIER dans l'éditeur SQL Supabase, puis clique Run.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- [001] SCHEMA DE BASE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username   TEXT UNIQUE NOT NULL,
  country    TEXT,
  tut_seen   BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  cash       NUMERIC(12,2) DEFAULT 10000,
  best_score NUMERIC(12,2),
  day_index  INTEGER DEFAULT 0,
  div_paid   JSONB DEFAULT '{}',
  eliminated JSONB DEFAULT '[]',
  r32_pool   JSONB DEFAULT '[]',
  champion   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS positions (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nation_id TEXT NOT NULL,
  quantity  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, nation_id)
);

CREATE TABLE IF NOT EXISTS trades (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nation_id  TEXT NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('buy','sell')),
  quantity   INTEGER NOT NULL,
  price      NUMERIC(10,2) NOT NULL,
  tax        NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(12,2) NOT NULL,
  day_index  INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  flag          TEXT NOT NULL,
  initial_price NUMERIC(10,2) NOT NULL,
  conf          TEXT NOT NULL,
  str           INTEGER NOT NULL,
  grp           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nation_id   TEXT NOT NULL REFERENCES nations(id),
  price       NUMERIC(10,2) NOT NULL,
  day_index   INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user    ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_ph_nation      ON price_history(nation_id, day_index);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- [002] ROW LEVEL SECURITY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades        ENABLE ROW LEVEL SECURITY;
ALTER TABLE nations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"  ON profiles  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own"  ON profiles  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "portfolios_select_own" ON portfolios FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "portfolios_update_own" ON portfolios FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "positions_select_own" ON positions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "positions_insert_own" ON positions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "positions_update_own" ON positions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "positions_delete_own" ON positions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "trades_select_own"    ON trades    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "trades_insert_own"    ON trades    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "nations_public_read"  ON nations       FOR SELECT USING (TRUE);
CREATE POLICY "ph_public_read"       ON price_history FOR SELECT USING (TRUE);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- [003] TRIGGERS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO portfolios (user_id, cash)
  VALUES (NEW.id, 10000)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portfolios_updated_at ON portfolios;
CREATE TRIGGER portfolios_updated_at
  BEFORE UPDATE ON portfolios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- [SEED] 48 NATIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT INTO nations (id, name, flag, initial_price, conf, str, grp) VALUES
  ('MEX','Mexico',       '🇲🇽', 25,  'CONCACAF', 72, 'A'),
  ('RSA','S. Africa',    '🇿🇦', 10,  'CAF',      49, 'A'),
  ('KOR','South Korea',  '🇰🇷', 20,  'AFC',      63, 'A'),
  ('CZE','Czechia',      '🇨🇿', 20,  'UEFA',     61, 'A'),
  ('CAN','Canada',       '🇨🇦', 25,  'CONCACAF', 68, 'B'),
  ('BIH','Bosnia',       '🇧🇦', 20,  'UEFA',     58, 'B'),
  ('QAT','Qatar',        '🇶🇦', 10,  'AFC',      48, 'B'),
  ('SUI','Switzerland',  '🇨🇭', 25,  'UEFA',     70, 'B'),
  ('BRA','Brazil',       '🇧🇷', 200, 'CONMEBOL', 88, 'C'),
  ('MAR','Morocco',      '🇲🇦', 20,  'CAF',      66, 'C'),
  ('HAI','Haiti',        '🇭🇹', 10,  'CONCACAF', 42, 'C'),
  ('SCO','Scotland',     '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 20,  'UEFA',     60, 'C'),
  ('USA','USA',          '🇺🇸', 50,  'CONCACAF', 76, 'D'),
  ('PAR','Paraguay',     '🇵🇾', 20,  'CONMEBOL', 62, 'D'),
  ('AUS','Australia',    '🇦🇺', 20,  'AFC',      58, 'D'),
  ('TUR','Türkiye',      '🇹🇷', 20,  'UEFA',     66, 'D'),
  ('GER','Germany',      '🇩🇪', 100, 'UEFA',     84, 'E'),
  ('CUW','Curaçao',      '🇨🇼', 10,  'CONCACAF', 40, 'E'),
  ('CIV','Ivory Coast',  '🇨🇮', 20,  'CAF',      60, 'E'),
  ('ECU','Ecuador',      '🇪🇨', 25,  'CONMEBOL', 65, 'E'),
  ('NED','Netherlands',  '🇳🇱', 75,  'UEFA',     82, 'F'),
  ('JPN','Japan',        '🇯🇵', 25,  'AFC',      68, 'F'),
  ('SWE','Sweden',       '🇸🇪', 20,  'UEFA',     64, 'F'),
  ('TUN','Tunisia',      '🇹🇳', 20,  'CAF',      55, 'F'),
  ('BEL','Belgium',      '🇧🇪', 50,  'UEFA',     80, 'G'),
  ('EGY','Egypt',        '🇪🇬', 20,  'CAF',      58, 'G'),
  ('IRN','Iran',         '🇮🇷', 20,  'AFC',      56, 'G'),
  ('NZL','New Zealand',  '🇳🇿', 10,  'OFC',      44, 'G'),
  ('ESP','Spain',        '🇪🇸', 200, 'UEFA',     92, 'H'),
  ('CPV','Cape Verde',   '🇨🇻', 10,  'CAF',      48, 'H'),
  ('KSA','Saudi Arabia', '🇸🇦', 10,  'AFC',      52, 'H'),
  ('URU','Uruguay',      '🇺🇾', 35,  'CONMEBOL', 74, 'H'),
  ('FRA','France',       '🇫🇷', 200, 'UEFA',     93, 'I'),
  ('SEN','Senegal',      '🇸🇳', 25,  'CAF',      68, 'I'),
  ('NOR','Norway',       '🇳🇴', 25,  'UEFA',     69, 'I'),
  ('IRQ','Iraq',         '🇮🇶', 10,  'AFC',      46, 'I'),
  ('ARG','Argentina',    '🇦🇷', 200, 'CONMEBOL', 91, 'J'),
  ('ALG','Algeria',      '🇩🇿', 20,  'CAF',      57, 'J'),
  ('AUT','Austria',      '🇦🇹', 20,  'UEFA',     62, 'J'),
  ('JOR','Jordan',       '🇯🇴', 10,  'AFC',      46, 'J'),
  ('POR','Portugal',     '🇵🇹', 100, 'UEFA',     86, 'K'),
  ('COD','DR Congo',     '🇨🇩', 10,  'CAF',      48, 'K'),
  ('UZB','Uzbekistan',   '🇺🇿', 10,  'AFC',      44, 'K'),
  ('COL','Colombia',     '🇨🇴', 25,  'CONMEBOL', 70, 'K'),
  ('ENG','England',      '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 200, 'UEFA',     90, 'L'),
  ('CRO','Croatia',      '🇭🇷', 35,  'UEFA',     74, 'L'),
  ('GHA','Ghana',        '🇬🇭', 20,  'CAF',      57, 'L'),
  ('PAN','Panama',       '🇵🇦', 20,  'CONCACAF', 53, 'L')
ON CONFLICT (id) DO NOTHING;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- [004] COMPETITIONS (Phase 3 — optionnel mais inclus pour cohérence du schéma)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS competitions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','finished')),
  mode           TEXT NOT NULL DEFAULT 'manual'  CHECK (mode IN ('manual','realtime')),
  is_official    BOOLEAN DEFAULT FALSE,
  day_index      INTEGER NOT NULL DEFAULT 0,
  prices         JSONB NOT NULL DEFAULT '{}',
  eliminated     TEXT[] NOT NULL DEFAULT '{}',
  match_results  JSONB NOT NULL DEFAULT '{}',
  champion       TEXT,
  r32_pool       TEXT[] NOT NULL DEFAULT '{}',
  r16_pool       TEXT[] NOT NULL DEFAULT '{}',
  qf_pool        TEXT[] NOT NULL DEFAULT '{}',
  sf_pool        TEXT[] NOT NULL DEFAULT '{}',
  final_pool     TEXT[] NOT NULL DEFAULT '{}',
  third_pool     TEXT[] NOT NULL DEFAULT '{}',
  advancing_lock BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competition_players (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cash           NUMERIC(12,2) NOT NULL DEFAULT 10000,
  portfolio      JSONB NOT NULL DEFAULT '{}',
  avg_cost       JSONB NOT NULL DEFAULT '{}',
  tx_log         JSONB NOT NULL DEFAULT '[]',
  best_score     NUMERIC(12,2),
  joined_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(competition_id, user_id)
);

CREATE TABLE IF NOT EXISTS competition_trades (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nation_id      TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('buy','sell')),
  quantity       INTEGER NOT NULL,
  price          NUMERIC(10,2) NOT NULL,
  tax            NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_amount     NUMERIC(12,2) NOT NULL,
  day_index      INTEGER NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_players_comp  ON competition_players(competition_id);
CREATE INDEX IF NOT EXISTS idx_comp_players_user  ON competition_players(user_id);
CREATE INDEX IF NOT EXISTS idx_comp_trades_comp   ON competition_trades(competition_id);
CREATE INDEX IF NOT EXISTS idx_comp_trades_user   ON competition_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_comp_trades_nation ON competition_trades(nation_id);

ALTER TABLE competitions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_trades  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comp_select_authenticated"      ON competitions        FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "comp_players_select_leaderboard" ON competition_players FOR SELECT USING (TRUE);
CREATE POLICY "comp_players_insert_own"        ON competition_players FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comp_players_update_own"        ON competition_players FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "comp_trades_select_own"         ON competition_trades  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "comp_trades_insert_own"         ON competition_trades  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS competitions_updated_at ON competitions;
CREATE TRIGGER competitions_updated_at
  BEFORE UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- [005] MOTEUR CENTRALISÉ MULTIJOUEUR
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Groupes A–L
CREATE TABLE IF NOT EXISTS groups (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Colonnes supplémentaires sur nations
ALTER TABLE nations
  ADD COLUMN IF NOT EXISTS current_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS group_code    TEXT;

-- Rendre user_id nullable (jeu anonyme via device_id)
ALTER TABLE portfolios ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS device_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS avg_cost  JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tx_log    JSONB NOT NULL DEFAULT '[]';

-- Contrainte : au moins un identifiant requis
DO $$ BEGIN
  ALTER TABLE portfolios ADD CONSTRAINT portfolio_identity_check
    CHECK (user_id IS NOT NULL OR device_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- game_state singleton (partagé par tous les joueurs)
CREATE TABLE IF NOT EXISTS game_state (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  current_day_index INTEGER NOT NULL DEFAULT 0 CHECK (current_day_index >= 0),
  current_phase     TEXT    NOT NULL DEFAULT 'Groups',
  champion_id       TEXT,
  advancing         BOOLEAN NOT NULL DEFAULT FALSE,
  eliminated        TEXT[]  NOT NULL DEFAULT '{}',
  r32_pool          TEXT[]  NOT NULL DEFAULT '{}',
  r16_pool          TEXT[]  NOT NULL DEFAULT '{}',
  qf_pool           TEXT[]  NOT NULL DEFAULT '{}',
  sf_pool           TEXT[]  NOT NULL DEFAULT '{}',
  final_pool        TEXT[]  NOT NULL DEFAULT '{}',
  third_pool        TEXT[]  NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Historique des prix par nation par jour
CREATE TABLE IF NOT EXISTS nation_prices (
  id           BIGSERIAL    PRIMARY KEY,
  nation_id    TEXT         NOT NULL REFERENCES nations(id) ON DELETE CASCADE,
  price        NUMERIC(12,2) NOT NULL CHECK (price > 0),
  day_index    INTEGER      NOT NULL CHECK (day_index >= 0),
  effective_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (nation_id, day_index)
);

CREATE INDEX IF NOT EXISTS idx_nation_prices_nation_day ON nation_prices(nation_id, day_index);
CREATE INDEX IF NOT EXISTS idx_nation_prices_effective  ON nation_prices(nation_id, effective_at DESC);

-- Trigger : synchronise nations.current_price
CREATE OR REPLACE FUNCTION sync_nation_current_price()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE nations SET current_price = NEW.price WHERE id = NEW.nation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_nation_price ON nation_prices;
CREATE TRIGGER trg_sync_nation_price
  AFTER INSERT OR UPDATE ON nation_prices
  FOR EACH ROW EXECUTE FUNCTION sync_nation_current_price();

-- Classements de groupe
CREATE TABLE IF NOT EXISTS group_standings (
  id         BIGSERIAL PRIMARY KEY,
  group_code TEXT    NOT NULL,
  nation_id  TEXT    NOT NULL REFERENCES nations(id),
  mp INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 0,
  d  INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0,
  gf INTEGER NOT NULL DEFAULT 0, ga INTEGER NOT NULL DEFAULT 0,
  pts       INTEGER NOT NULL DEFAULT 0,
  day_index INTEGER NOT NULL CHECK (day_index >= 0),
  UNIQUE (group_code, nation_id, day_index)
);

CREATE INDEX IF NOT EXISTS idx_group_standings_code_day ON group_standings(group_code, day_index);

-- Pools KO
CREATE TABLE IF NOT EXISTS knockout_pools (
  id        BIGSERIAL PRIMARY KEY,
  round     TEXT    NOT NULL CHECK (round IN ('r32','r16','qf','sf','3rd','final')),
  nation_id TEXT    NOT NULL REFERENCES nations(id),
  position  INTEGER NOT NULL CHECK (position >= 0),
  day_index INTEGER NOT NULL CHECK (day_index >= 0),
  UNIQUE (round, nation_id)
);

-- Matchs (planning + résultats)
CREATE TABLE IF NOT EXISTS matches (
  id          TEXT    PRIMARY KEY,
  day_index   INTEGER NOT NULL CHECK (day_index >= 0),
  nation_a    TEXT    NOT NULL REFERENCES nations(id),
  nation_b    TEXT    NOT NULL REFERENCES nations(id),
  venue       TEXT,
  phase       TEXT    NOT NULL CHECK (phase IN ('Groups','R32','R16','QF','SF','3rd','Final')),
  score_a     INTEGER CHECK (score_a >= 0),
  score_b     INTEGER CHECK (score_b >= 0),
  winner_id   TEXT    REFERENCES nations(id),
  is_upset    BOOLEAN NOT NULL DEFAULT FALSE,
  played_at   TIMESTAMPTZ,
  result_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_matches_day_index ON matches(day_index);
CREATE INDEX IF NOT EXISTS idx_matches_phase     ON matches(phase);

-- Holdings (positions normalisées)
CREATE TABLE IF NOT EXISTS holdings (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID    NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  nation_id    TEXT    NOT NULL REFERENCES nations(id),
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (portfolio_id, nation_id)
);

CREATE INDEX IF NOT EXISTS idx_holdings_portfolio ON holdings(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_holdings_nation    ON holdings(nation_id);

-- Audit trail holdings
CREATE TABLE IF NOT EXISTS holdings_history (
  id              BIGSERIAL PRIMARY KEY,
  holdings_id     UUID    NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  quantity_before INTEGER NOT NULL,
  quantity_after  INTEGER NOT NULL,
  delta           INTEGER NOT NULL,
  reason          TEXT    NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID          NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  nation_id    TEXT          NOT NULL REFERENCES nations(id),
  type         TEXT          NOT NULL CHECK (type IN ('buy','sell')),
  quantity     INTEGER       NOT NULL CHECK (quantity > 0),
  price        NUMERIC(12,2) NOT NULL CHECK (price > 0),
  fee          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  total        NUMERIC(14,2) NOT NULL CHECK (total > 0),
  day_index    INTEGER       NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_portfolio ON transactions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created   ON transactions(created_at DESC);

-- Dividendes
CREATE TABLE IF NOT EXISTS dividends (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID          NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  nation_id    TEXT          NOT NULL REFERENCES nations(id),
  round        TEXT          NOT NULL CHECK (round IN ('r32','r16','qf','sf','final','champion')),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  shares       INTEGER       NOT NULL CHECK (shares >= 0),
  day_index    INTEGER       NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (portfolio_id, nation_id, round)
);

CREATE INDEX IF NOT EXISTS idx_dividends_portfolio ON dividends(portfolio_id);

-- ── RLS pour les nouvelles tables ────────────────────────────────────────────

ALTER TABLE groups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE nation_prices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_standings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE knockout_pools   ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "groups_public_read"     ON groups          FOR SELECT USING (TRUE);
CREATE POLICY "game_state_public_read" ON game_state      FOR SELECT USING (TRUE);
CREATE POLICY "prices_public_read"     ON nation_prices   FOR SELECT USING (TRUE);
CREATE POLICY "standings_public_read"  ON group_standings FOR SELECT USING (TRUE);
CREATE POLICY "ko_pools_public_read"   ON knockout_pools  FOR SELECT USING (TRUE);
CREATE POLICY "matches_public_read"    ON matches         FOR SELECT USING (TRUE);

CREATE POLICY "holdings_select_own"
  ON holdings FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "transactions_select_own"
  ON transactions FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "dividends_select_own"
  ON dividends FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "portfolios_select_device"
  ON portfolios FOR SELECT
  USING (user_id = auth.uid() OR device_id IS NOT NULL);

-- ── RPC : get_or_create_portfolio ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_or_create_portfolio(
  p_device_id TEXT,
  p_user_id   UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_id FROM portfolios WHERE user_id = p_user_id LIMIT 1;
  END IF;
  IF v_id IS NULL AND p_device_id IS NOT NULL THEN
    SELECT id INTO v_id FROM portfolios WHERE device_id = p_device_id LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO portfolios (user_id, device_id, cash, avg_cost, tx_log)
    VALUES (p_user_id, p_device_id, 10000, '{}', '[]')
    RETURNING id INTO v_id;
  ELSE
    IF p_user_id IS NOT NULL THEN
      UPDATE portfolios SET user_id = p_user_id
      WHERE id = v_id AND user_id IS NULL;
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- ── RPC : execute_trade ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION execute_trade(
  p_device_id TEXT,
  p_nation_id TEXT,
  p_mode      TEXT,
  p_quantity  INTEGER,
  p_user_id   UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pid        UUID;
  v_cash       NUMERIC(12,2);
  v_avg_cost   JSONB;
  v_tx_log     JSONB;
  v_price      NUMERIC(12,2);
  v_name       TEXT;
  v_flag       TEXT;
  v_held       INTEGER := 0;
  v_hid        UUID;
  v_qty_before INTEGER := 0;
  v_new_held   INTEGER;
  v_new_cash   NUMERIC(12,2);
  v_fee        NUMERIC(12,2) := 0;
  v_total      NUMERIC(12,2);
  v_day        INTEGER;
  v_is_cap     BOOLEAN;
  v_tot_val    NUMERIC(14,2);
  v_prev_avg   NUMERIC(12,2);
  v_new_avg    NUMERIC(12,2);
  v_new_entry  JSONB;
BEGIN
  v_pid := get_or_create_portfolio(p_device_id, p_user_id);

  SELECT cash, avg_cost, tx_log
  INTO v_cash, v_avg_cost, v_tx_log
  FROM portfolios WHERE id = v_pid FOR UPDATE;

  SELECT current_price, name, flag INTO v_price, v_name, v_flag
  FROM nations WHERE id = p_nation_id;

  IF v_price IS NULL THEN
    RETURN jsonb_build_object('error', 'Nation introuvable');
  END IF;

  SELECT current_day_index, (current_day_index <= 22)
  INTO v_day, v_is_cap FROM game_state WHERE id = 1;

  SELECT id, quantity INTO v_hid, v_qty_before
  FROM holdings WHERE portfolio_id = v_pid AND nation_id = p_nation_id FOR UPDATE;
  v_held := COALESCE(v_qty_before, 0);

  IF p_mode = 'buy' THEN
    IF EXISTS (SELECT 1 FROM game_state WHERE p_nation_id = ANY(eliminated)) THEN
      RETURN jsonb_build_object('error', 'Nation éliminée 💀');
    END IF;
    IF v_price * p_quantity > v_cash THEN
      RETURN jsonb_build_object('error', 'Fonds insuffisants');
    END IF;
    IF v_is_cap THEN
      SELECT COALESCE(p.cash, 0) +
             COALESCE((SELECT SUM(h.quantity * n.current_price)
                       FROM holdings h JOIN nations n ON n.id = h.nation_id
                       WHERE h.portfolio_id = v_pid), 0)
      INTO v_tot_val FROM portfolios p WHERE p.id = v_pid;
      IF v_tot_val > 0 AND
         ((v_held + p_quantity)::NUMERIC * v_price) / v_tot_val > 0.40 THEN
        RETURN jsonb_build_object('error', '⛔ Plafond 40% atteint');
      END IF;
    END IF;
    v_fee      := 0;
    v_total    := v_price * p_quantity;
    v_new_cash := v_cash - v_total;
    v_new_held := v_held + p_quantity;
    v_prev_avg := COALESCE((v_avg_cost ->> p_nation_id)::NUMERIC, v_price);
    v_new_avg  := CASE WHEN v_held = 0 THEN v_price
                       ELSE (v_held * v_prev_avg + p_quantity * v_price) / (v_held + p_quantity)
                  END;
    v_avg_cost := jsonb_set(v_avg_cost, ARRAY[p_nation_id], to_jsonb(ROUND(v_new_avg, 1)));

  ELSIF p_mode = 'sell' THEN
    IF v_held < p_quantity THEN
      RETURN jsonb_build_object('error', 'Actions insuffisantes');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM game_state WHERE p_nation_id = ANY(eliminated)) THEN
      v_fee := ROUND(v_price * p_quantity * CASE WHEN v_is_cap THEN 0.05 ELSE 0.10 END, 1);
    END IF;
    v_total    := v_price * p_quantity - v_fee;
    v_new_cash := v_cash + v_total;
    v_new_held := GREATEST(v_held - p_quantity, 0);
    IF v_new_held = 0 THEN v_avg_cost := v_avg_cost - p_nation_id; END IF;
  ELSE
    RETURN jsonb_build_object('error', 'Mode invalide');
  END IF;

  UPDATE portfolios SET cash = v_new_cash, avg_cost = v_avg_cost, updated_at = NOW()
  WHERE id = v_pid;

  IF v_hid IS NOT NULL THEN
    IF v_new_held > 0 THEN
      UPDATE holdings SET quantity = v_new_held, updated_at = NOW() WHERE id = v_hid;
    ELSE
      DELETE FROM holdings WHERE id = v_hid;
      v_hid := NULL;
    END IF;
  ELSIF v_new_held > 0 THEN
    INSERT INTO holdings (portfolio_id, nation_id, quantity)
    VALUES (v_pid, p_nation_id, v_new_held) RETURNING id INTO v_hid;
  END IF;

  IF v_hid IS NOT NULL THEN
    INSERT INTO holdings_history (holdings_id, quantity_before, quantity_after, delta, reason)
    VALUES (v_hid, v_held, v_new_held, v_new_held - v_held, p_mode);
  END IF;

  INSERT INTO transactions (portfolio_id, nation_id, type, quantity, price, fee, total, day_index)
  VALUES (v_pid, p_nation_id, p_mode, p_quantity, v_price, v_fee, GREATEST(v_total, 0.01), v_day);

  v_new_entry := jsonb_build_object(
    'dir', p_mode, 'flag', v_flag, 'name', v_name,
    'qty', p_quantity, 'price', v_price, 'day', v_day
  );
  v_tx_log := jsonb_build_array(v_new_entry) || v_tx_log;
  IF jsonb_array_length(v_tx_log) > 100 THEN
    SELECT jsonb_agg(e) INTO v_tx_log
    FROM (SELECT e FROM jsonb_array_elements(v_tx_log) WITH ORDINALITY t(e, i) WHERE i <= 100) sub;
  END IF;
  UPDATE portfolios SET tx_log = v_tx_log WHERE id = v_pid;

  RETURN jsonb_build_object(
    'ok', TRUE, 'new_cash', v_new_cash, 'new_held', v_new_held,
    'price', v_price, 'fee', v_fee, 'total', v_total
  );
END;
$$;

-- ── RPC : distribute_dividends ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION distribute_dividends(
  p_nation_id TEXT,
  p_round     TEXT,
  p_rate      NUMERIC,
  p_price     NUMERIC,
  p_day_index INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count  INTEGER := 0;
  rec      RECORD;
  v_amount NUMERIC(12,2);
BEGIN
  FOR rec IN
    SELECT h.portfolio_id, h.quantity FROM holdings h
    WHERE h.nation_id = p_nation_id AND h.quantity > 0
  LOOP
    v_amount := ROUND(rec.quantity * p_price * p_rate, 1);
    IF v_amount <= 0 THEN CONTINUE; END IF;
    UPDATE portfolios SET cash = cash + v_amount, updated_at = NOW()
    WHERE id = rec.portfolio_id;
    INSERT INTO dividends (portfolio_id, nation_id, round, amount, shares, day_index)
    VALUES (rec.portfolio_id, p_nation_id, p_round, v_amount, rec.quantity, p_day_index)
    ON CONFLICT (portfolio_id, nation_id, round) DO UPDATE
      SET amount = dividends.amount + EXCLUDED.amount;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ── RPC : liquidate_eliminated ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION liquidate_eliminated(
  p_nation_id TEXT,
  p_day_index INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  rec     RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT h.id, h.portfolio_id, h.quantity FROM holdings h
    WHERE h.nation_id = p_nation_id AND h.quantity > 0
  LOOP
    UPDATE portfolios SET cash = cash + rec.quantity, updated_at = NOW()
    WHERE id = rec.portfolio_id;
    INSERT INTO holdings_history (holdings_id, quantity_before, quantity_after, delta, reason)
    VALUES (rec.id, rec.quantity, 0, -rec.quantity, 'liquidation');
    DELETE FROM holdings WHERE id = rec.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ── Vue leaderboard (remplace celle de 004) ───────────────────────────────────

CREATE OR REPLACE VIEW leaderboard AS
SELECT p.id, COALESCE(pr.username,'Anonyme') AS username, pr.country,
       p.best_score, p.updated_at
FROM portfolios p
LEFT JOIN profiles pr ON pr.id = p.user_id
WHERE p.best_score IS NOT NULL
ORDER BY p.best_score DESC;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- [SEED-001] DONNÉES INITIALES DU JEU
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INSERT INTO groups (code, name) VALUES
  ('A','Groupe A'),('B','Groupe B'),('C','Groupe C'),('D','Groupe D'),
  ('E','Groupe E'),('F','Groupe F'),('G','Groupe G'),('H','Groupe H'),
  ('I','Groupe I'),('J','Groupe J'),('K','Groupe K'),('L','Groupe L')
ON CONFLICT (code) DO NOTHING;

UPDATE nations SET
  current_price = initial_price,
  group_code    = grp
WHERE current_price IS NULL OR group_code IS NULL;

INSERT INTO game_state (id, current_day_index, current_phase)
VALUES (1, 0, 'Groups')
ON CONFLICT (id) DO NOTHING;

INSERT INTO nation_prices (nation_id, price, day_index)
SELECT id, initial_price, 0 FROM nations
ON CONFLICT (nation_id, day_index) DO NOTHING;

INSERT INTO matches (id, day_index, nation_a, nation_b, venue, phase) VALUES
('m_0_0',  0,'MEX','RSA','Azteca, Mexico City','Groups'),
('m_0_1',  0,'KOR','CZE','Akron, Guadalajara','Groups'),
('m_1_0',  1,'CAN','BIH','BMO Field, Toronto','Groups'),
('m_1_1',  1,'USA','PAR','SoFi Stadium, LA','Groups'),
('m_2_0',  2,'QAT','SUI','Levi''s, Santa Clara','Groups'),
('m_2_1',  2,'BRA','MAR','MetLife, New York','Groups'),
('m_2_2',  2,'HAI','SCO','Gillette, Boston','Groups'),
('m_3_0',  3,'AUS','TUR','BC Place, Vancouver','Groups'),
('m_3_1',  3,'GER','CUW','NRG, Houston','Groups'),
('m_3_2',  3,'NED','JPN','AT&T, Dallas','Groups'),
('m_3_3',  3,'CIV','ECU','Lincoln, Phila.','Groups'),
('m_3_4',  3,'SWE','TUN','BBVA, Monterrey','Groups'),
('m_4_0',  4,'ESP','CPV','Benz, Atlanta','Groups'),
('m_4_1',  4,'BEL','EGY','Lumen, Seattle','Groups'),
('m_4_2',  4,'KSA','URU','Hard Rock, Miami','Groups'),
('m_4_3',  4,'IRN','NZL','SoFi, LA','Groups'),
('m_5_0',  5,'FRA','SEN','MetLife, New York','Groups'),
('m_5_1',  5,'IRQ','NOR','Gillette, Boston','Groups'),
('m_5_2',  5,'ARG','ALG','Arrowhead, KC','Groups'),
('m_6_0',  6,'AUT','JOR','Levi''s, Santa Clara','Groups'),
('m_6_1',  6,'POR','COD','NRG, Houston','Groups'),
('m_6_2',  6,'ENG','CRO','AT&T, Dallas','Groups'),
('m_6_3',  6,'GHA','PAN','BMO, Toronto','Groups'),
('m_6_4',  6,'UZB','COL','Azteca, Mexico City','Groups'),
('m_7_0',  7,'CZE','RSA','Benz, Atlanta','Groups'),
('m_7_1',  7,'SUI','BIH','SoFi, LA','Groups'),
('m_7_2',  7,'CAN','QAT','BC Place, Vancouver','Groups'),
('m_7_3',  7,'MEX','KOR','Akron, Guadalajara','Groups'),
('m_8_0',  8,'USA','AUS','Lumen, Seattle','Groups'),
('m_8_1',  8,'SCO','MAR','Gillette, Boston','Groups'),
('m_8_2',  8,'BRA','HAI','Lincoln, Phila.','Groups'),
('m_8_3',  8,'TUR','PAR','Levi''s, Santa Clara','Groups'),
('m_9_0',  9,'NED','SWE','NRG, Houston','Groups'),
('m_9_1',  9,'GER','CIV','BMO, Toronto','Groups'),
('m_9_2',  9,'ECU','CUW','Arrowhead, KC','Groups'),
('m_10_0',10,'TUN','JPN','BBVA, Monterrey','Groups'),
('m_10_1',10,'ESP','KSA','Benz, Atlanta','Groups'),
('m_10_2',10,'BEL','IRN','SoFi, LA','Groups'),
('m_10_3',10,'URU','CPV','Hard Rock, Miami','Groups'),
('m_10_4',10,'NZL','EGY','BC Place, Vancouver','Groups'),
('m_11_0',11,'ARG','AUT','AT&T, Dallas','Groups'),
('m_11_1',11,'FRA','IRQ','Lincoln, Phila.','Groups'),
('m_11_2',11,'NOR','SEN','MetLife, New York','Groups'),
('m_11_3',11,'JOR','ALG','Levi''s, Santa Clara','Groups'),
('m_12_0',12,'POR','UZB','NRG, Houston','Groups'),
('m_12_1',12,'ENG','GHA','Gillette, Boston','Groups'),
('m_12_2',12,'PAN','CRO','BMO, Toronto','Groups'),
('m_12_3',12,'COL','COD','Akron, Guadalajara','Groups'),
('m_13_0',13,'SUI','CAN','BC Place','Groups'),
('m_13_1',13,'BIH','QAT','Lumen','Groups'),
('m_13_2',13,'SCO','BRA','Hard Rock','Groups'),
('m_13_3',13,'MAR','HAI','Benz','Groups'),
('m_13_4',13,'CZE','MEX','Azteca','Groups'),
('m_13_5',13,'RSA','KOR','BBVA','Groups'),
('m_14_0',14,'CUW','CIV','Lincoln','Groups'),
('m_14_1',14,'ECU','GER','MetLife','Groups'),
('m_14_2',14,'JPN','SWE','AT&T','Groups'),
('m_14_3',14,'TUN','NED','Arrowhead','Groups'),
('m_14_4',14,'TUR','USA','SoFi','Groups'),
('m_14_5',14,'PAR','AUS','Levi''s','Groups'),
('m_15_0',15,'NOR','FRA','Gillette','Groups'),
('m_15_1',15,'SEN','IRQ','BMO','Groups'),
('m_15_2',15,'CPV','KSA','NRG','Groups'),
('m_15_3',15,'URU','ESP','Akron','Groups'),
('m_15_4',15,'EGY','IRN','Lumen','Groups'),
('m_15_5',15,'NZL','BEL','BC Place','Groups'),
('m_16_0',16,'PAN','ENG','MetLife','Groups'),
('m_16_1',16,'CRO','GHA','Lincoln','Groups'),
('m_16_2',16,'COL','POR','Hard Rock','Groups'),
('m_16_3',16,'COD','UZB','Benz','Groups'),
('m_16_4',16,'ALG','AUT','Arrowhead','Groups'),
('m_16_5',16,'JOR','ARG','AT&T','Groups')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN — vérifie avec : SELECT table_name FROM information_schema.tables
--                      WHERE table_schema = 'public' ORDER BY table_name;
-- ═══════════════════════════════════════════════════════════════════════════════
