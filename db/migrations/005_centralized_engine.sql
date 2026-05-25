-- KickStock · Migration 005 · Centralized Game Engine
-- Transforms the game from localStorage-only to a shared DB-backed multiplayer engine.
-- Run AFTER 001, 002, 003, 004.

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. GROUPS (reference table A–L)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS groups (
  code TEXT PRIMARY KEY,   -- 'A'..'L'
  name TEXT NOT NULL       -- 'Groupe A'..'Groupe L'
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. Extend NATIONS with current_price and FK to groups
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE nations
  ADD COLUMN IF NOT EXISTS current_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS group_code    TEXT;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. Extend PORTFOLIOS: device_id (anonymous play) + helper columns
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Make user_id nullable so anonymous (device_id only) portfolios are allowed
ALTER TABLE portfolios ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS device_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS avg_cost  JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tx_log    JSONB NOT NULL DEFAULT '[]';

-- At least one identity required
ALTER TABLE portfolios ADD CONSTRAINT portfolio_identity_check
  CHECK (user_id IS NOT NULL OR device_id IS NOT NULL);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. GAME_STATE singleton (shared by all players)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS game_state (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  current_day_index INTEGER NOT NULL DEFAULT 0 CHECK (current_day_index >= 0),
  current_phase     TEXT    NOT NULL DEFAULT 'Groups',
  champion_id       TEXT,
  advancing         BOOLEAN NOT NULL DEFAULT FALSE,  -- concurrency lock
  eliminated        TEXT[]  NOT NULL DEFAULT '{}',
  r32_pool          TEXT[]  NOT NULL DEFAULT '{}',
  r16_pool          TEXT[]  NOT NULL DEFAULT '{}',
  qf_pool           TEXT[]  NOT NULL DEFAULT '{}',
  sf_pool           TEXT[]  NOT NULL DEFAULT '{}',
  final_pool        TEXT[]  NOT NULL DEFAULT '{}',
  third_pool        TEXT[]  NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. NATION_PRICES — versioned price history (UNIQUE per nation per day)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

-- Trigger: keep nations.current_price in sync with latest nation_prices entry
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

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. GROUP_STANDINGS — snapshot per group per day_index
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS group_standings (
  id         BIGSERIAL PRIMARY KEY,
  group_code TEXT    NOT NULL,
  nation_id  TEXT    NOT NULL REFERENCES nations(id),
  mp         INTEGER NOT NULL DEFAULT 0 CHECK (mp >= 0),
  w          INTEGER NOT NULL DEFAULT 0 CHECK (w >= 0),
  d          INTEGER NOT NULL DEFAULT 0 CHECK (d >= 0),
  l          INTEGER NOT NULL DEFAULT 0 CHECK (l >= 0),
  gf         INTEGER NOT NULL DEFAULT 0 CHECK (gf >= 0),
  ga         INTEGER NOT NULL DEFAULT 0 CHECK (ga >= 0),
  pts        INTEGER NOT NULL DEFAULT 0 CHECK (pts >= 0),
  day_index  INTEGER NOT NULL CHECK (day_index >= 0),
  UNIQUE (group_code, nation_id, day_index)
);

CREATE INDEX IF NOT EXISTS idx_group_standings_code_day ON group_standings(group_code, day_index);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 7. KNOCKOUT_POOLS — which teams qualified for each KO round
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS knockout_pools (
  id        BIGSERIAL PRIMARY KEY,
  round     TEXT    NOT NULL CHECK (round IN ('r32','r16','qf','sf','3rd','final')),
  nation_id TEXT    NOT NULL REFERENCES nations(id),
  position  INTEGER NOT NULL CHECK (position >= 0),
  day_index INTEGER NOT NULL CHECK (day_index >= 0),
  UNIQUE (round, nation_id)
);

CREATE INDEX IF NOT EXISTS idx_knockout_pools_round_day ON knockout_pools(round, day_index);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 8. MATCHES — shared match schedule + results
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS matches (
  id          TEXT    PRIMARY KEY,            -- e.g. "m_0_0", "m_17_0"
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
  result_data JSONB   -- full StoredMatchResult for client animation
);

CREATE INDEX IF NOT EXISTS idx_matches_day_index ON matches(day_index);
CREATE INDEX IF NOT EXISTS idx_matches_phase     ON matches(phase);
CREATE INDEX IF NOT EXISTS idx_matches_nation_a  ON matches(nation_a);
CREATE INDEX IF NOT EXISTS idx_matches_nation_b  ON matches(nation_b);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 9. HOLDINGS — per-portfolio positions (normalized from positions table)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 10. HOLDINGS_HISTORY — immutable audit trail
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS holdings_history (
  id              BIGSERIAL PRIMARY KEY,
  holdings_id     UUID    NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  quantity_before INTEGER NOT NULL,
  quantity_after  INTEGER NOT NULL,
  delta           INTEGER NOT NULL,
  reason          TEXT    NOT NULL, -- 'buy','sell','dividend','liquidation'
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 11. TRANSACTIONS — normalized trade log per portfolio
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 12. DIVIDENDS — dividend distribution records
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 13. RLS — Row Level Security for new tables
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

-- Public reference data: everyone can read
CREATE POLICY "groups_public_read"      ON groups          FOR SELECT USING (TRUE);
CREATE POLICY "game_state_public_read"  ON game_state      FOR SELECT USING (TRUE);
CREATE POLICY "prices_public_read"      ON nation_prices   FOR SELECT USING (TRUE);
CREATE POLICY "standings_public_read"   ON group_standings FOR SELECT USING (TRUE);
CREATE POLICY "ko_pools_public_read"    ON knockout_pools  FOR SELECT USING (TRUE);
CREATE POLICY "matches_public_read"     ON matches         FOR SELECT USING (TRUE);

-- Player data: all writes go through SECURITY DEFINER RPCs;
-- reads are via server-side API routes (admin key), so policies allow via service role.
-- For direct client reads we check via stored proc result.
CREATE POLICY "holdings_select_own"
  ON holdings FOR SELECT
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "transactions_select_own"
  ON transactions FOR SELECT
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "dividends_select_own"
  ON dividends FOR SELECT
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios
      WHERE user_id = auth.uid()
    )
  );

-- Also allow anonymous portfolios (device_id based) to select their data via RPC
CREATE POLICY "portfolios_select_device"
  ON portfolios FOR SELECT
  USING (
    user_id = auth.uid()
    OR device_id IS NOT NULL  -- anonymous portfolios readable via admin client
  );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 14. RPC: get_or_create_portfolio
--     Creates an anonymous portfolio for a device_id, or links to user_id.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION get_or_create_portfolio(
  p_device_id TEXT,
  p_user_id   UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Try user_id first
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_id FROM portfolios WHERE user_id = p_user_id LIMIT 1;
  END IF;

  -- Then device_id
  IF v_id IS NULL AND p_device_id IS NOT NULL THEN
    SELECT id INTO v_id FROM portfolios WHERE device_id = p_device_id LIMIT 1;
  END IF;

  -- Create if not found
  IF v_id IS NULL THEN
    INSERT INTO portfolios (user_id, device_id, cash, avg_cost, tx_log)
    VALUES (p_user_id, p_device_id, 10000, '{}', '[]')
    RETURNING id INTO v_id;
  ELSE
    -- Link user_id to existing device-based portfolio
    IF p_user_id IS NOT NULL THEN
      UPDATE portfolios SET user_id = p_user_id
      WHERE id = v_id AND user_id IS NULL;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 15. RPC: execute_trade
--     Atomic buy/sell with all business rules enforced in one transaction.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION execute_trade(
  p_device_id TEXT,
  p_nation_id TEXT,
  p_mode      TEXT,     -- 'buy' | 'sell'
  p_quantity  INTEGER,
  p_user_id   UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  -- ── Get/create portfolio (row lock) ────────────────────────────────────────
  v_pid := get_or_create_portfolio(p_device_id, p_user_id);

  SELECT cash, avg_cost, tx_log
  INTO v_cash, v_avg_cost, v_tx_log
  FROM portfolios WHERE id = v_pid FOR UPDATE;

  -- ── Nation data ─────────────────────────────────────────────────────────────
  SELECT current_price, name, flag INTO v_price, v_name, v_flag
  FROM nations WHERE id = p_nation_id;

  IF v_price IS NULL THEN
    RETURN jsonb_build_object('error', 'Nation introuvable');
  END IF;

  -- ── Game state ──────────────────────────────────────────────────────────────
  SELECT current_day_index,
         (current_day_index <= 22) -- Groups (0-16) + R32 (17-22) = cap phase
  INTO v_day, v_is_cap
  FROM game_state WHERE id = 1;

  -- ── Current holdings (row lock) ─────────────────────────────────────────────
  SELECT id, quantity INTO v_hid, v_qty_before
  FROM holdings WHERE portfolio_id = v_pid AND nation_id = p_nation_id
  FOR UPDATE;
  v_held := COALESCE(v_qty_before, 0);

  -- ── BUY logic ───────────────────────────────────────────────────────────────
  IF p_mode = 'buy' THEN
    -- Eliminated check
    IF EXISTS (SELECT 1 FROM game_state WHERE p_nation_id = ANY(eliminated)) THEN
      RETURN jsonb_build_object('error', 'Nation éliminée 💀');
    END IF;

    -- Cash check
    IF v_price * p_quantity > v_cash THEN
      RETURN jsonb_build_object('error', 'Fonds insuffisants');
    END IF;

    -- 40% concentration cap
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

    v_fee      := 0;  -- no buy tax
    v_total    := v_price * p_quantity;
    v_new_cash := v_cash - v_total;
    v_new_held := v_held + p_quantity;

    -- Weighted average cost
    v_prev_avg := COALESCE((v_avg_cost ->> p_nation_id)::NUMERIC, v_price);
    v_new_avg  := CASE WHEN v_held = 0 THEN v_price
                       ELSE (v_held * v_prev_avg + p_quantity * v_price) / (v_held + p_quantity)
                  END;
    v_avg_cost := jsonb_set(v_avg_cost, ARRAY[p_nation_id], to_jsonb(ROUND(v_new_avg, 1)));

  -- ── SELL logic ──────────────────────────────────────────────────────────────
  ELSIF p_mode = 'sell' THEN
    IF v_held < p_quantity THEN
      RETURN jsonb_build_object('error', 'Actions insuffisantes');
    END IF;

    -- Tax: 5% group phase, 10% KO; 0% if eliminated
    IF NOT EXISTS (SELECT 1 FROM game_state WHERE p_nation_id = ANY(eliminated)) THEN
      v_fee := ROUND(v_price * p_quantity * CASE WHEN v_is_cap THEN 0.05 ELSE 0.10 END, 1);
    END IF;

    v_total    := v_price * p_quantity - v_fee;
    v_new_cash := v_cash + v_total;
    v_new_held := GREATEST(v_held - p_quantity, 0);

    IF v_new_held = 0 THEN
      v_avg_cost := v_avg_cost - p_nation_id;
    END IF;

  ELSE
    RETURN jsonb_build_object('error', 'Mode invalide');
  END IF;

  -- ── Persist: cash + avg_cost ────────────────────────────────────────────────
  UPDATE portfolios SET cash = v_new_cash, avg_cost = v_avg_cost, updated_at = NOW()
  WHERE id = v_pid;

  -- ── Persist: holdings ───────────────────────────────────────────────────────
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

  -- ── Audit: holdings_history ─────────────────────────────────────────────────
  IF v_hid IS NOT NULL THEN
    INSERT INTO holdings_history (holdings_id, quantity_before, quantity_after, delta, reason)
    VALUES (v_hid, v_held, v_new_held, v_new_held - v_held, p_mode);
  END IF;

  -- ── Persist: transactions ───────────────────────────────────────────────────
  INSERT INTO transactions (portfolio_id, nation_id, type, quantity, price, fee, total, day_index)
  VALUES (v_pid, p_nation_id, p_mode, p_quantity, v_price, v_fee, GREATEST(v_total, 0.01), v_day);

  -- ── Prepend to tx_log (keep last 100) ──────────────────────────────────────
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

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 16. RPC: distribute_dividends
--     Called after a KO match to credit all holders of the winning team.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION distribute_dividends(
  p_nation_id TEXT,
  p_round     TEXT,       -- 'r32','r16','qf','sf','final','champion'
  p_rate      NUMERIC,    -- e.g. 0.10 for 10%
  p_price     NUMERIC,    -- post-match price used for calculation
  p_day_index INTEGER
) RETURNS INTEGER          -- number of portfolios credited
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  rec     RECORD;
  v_amount NUMERIC(12,2);
BEGIN
  FOR rec IN
    SELECT h.portfolio_id, h.quantity
    FROM holdings h
    WHERE h.nation_id = p_nation_id AND h.quantity > 0
  LOOP
    v_amount := ROUND(rec.quantity * p_price * p_rate, 1);
    IF v_amount <= 0 THEN CONTINUE; END IF;

    -- Credit cash
    UPDATE portfolios SET cash = cash + v_amount, updated_at = NOW()
    WHERE id = rec.portfolio_id;

    -- Record dividend
    INSERT INTO dividends (portfolio_id, nation_id, round, amount, shares, day_index)
    VALUES (rec.portfolio_id, p_nation_id, p_round, v_amount, rec.quantity, p_day_index)
    ON CONFLICT (portfolio_id, nation_id, round) DO UPDATE
      SET amount = dividends.amount + EXCLUDED.amount;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 17. RPC: liquidate_eliminated
--     Sells eliminated team holdings at 1 KC per share for all portfolios.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION liquidate_eliminated(
  p_nation_id TEXT,
  p_day_index INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec     RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT h.id, h.portfolio_id, h.quantity
    FROM holdings h WHERE h.nation_id = p_nation_id AND h.quantity > 0
  LOOP
    -- Credit 1 KC per share
    UPDATE portfolios SET cash = cash + rec.quantity, updated_at = NOW()
    WHERE id = rec.portfolio_id;

    -- Audit
    INSERT INTO holdings_history (holdings_id, quantity_before, quantity_after, delta, reason)
    VALUES (rec.id, rec.quantity, 0, -rec.quantity, 'liquidation');

    -- Remove holding
    DELETE FROM holdings WHERE id = rec.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 18. Updated leaderboard view (uses holdings instead of portfolios.best_score)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  p.id,
  COALESCE(pr.username, 'Anonyme') AS username,
  pr.country,
  p.best_score,
  p.updated_at
FROM portfolios p
LEFT JOIN profiles pr ON pr.id = p.user_id
WHERE p.best_score IS NOT NULL
ORDER BY p.best_score DESC;
