-- KickStock · Migration 012 · Multi-Competition Architecture
-- Replaces the hardcoded single-competition engine with a competition-scoped system.
-- All game state, prices, and holdings are now scoped to a competition_id.
-- Run AFTER 001–011.

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. COMPETITION_GAME_STATE — one row per competition (replaces game_state singleton)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS competition_game_state (
  competition_id    INTEGER       PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
  current_day_index INTEGER       NOT NULL DEFAULT 0 CHECK (current_day_index >= 0),
  current_phase     TEXT          NOT NULL DEFAULT 'Groups',
  champion_id       TEXT,
  advancing         BOOLEAN       NOT NULL DEFAULT FALSE,
  eliminated        TEXT[]        NOT NULL DEFAULT '{}',
  r32_pool          TEXT[]        NOT NULL DEFAULT '{}',
  r16_pool          TEXT[]        NOT NULL DEFAULT '{}',
  qf_pool           TEXT[]        NOT NULL DEFAULT '{}',
  sf_pool           TEXT[]        NOT NULL DEFAULT '{}',
  final_pool        TEXT[]        NOT NULL DEFAULT '{}',
  third_pool        TEXT[]        NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE competition_game_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comp_game_state_read_all" ON competition_game_state FOR SELECT USING (TRUE);

-- Seed initial game state for existing competition (id=1, WC2022 test data)
INSERT INTO competition_game_state (competition_id)
SELECT id FROM competitions
ON CONFLICT (competition_id) DO NOTHING;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. COMPETITION_TEAMS — add current_price (tracks live price per team per competition)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE competition_teams
  ADD COLUMN IF NOT EXISTS current_price NUMERIC(12,2);

-- Seed current_price from initial_price for all existing competition_teams rows
UPDATE competition_teams SET current_price = initial_price WHERE current_price IS NULL;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. COMPETITION_PRICES — versioned price history per competition (replaces nation_prices)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS competition_prices (
  id             BIGSERIAL     PRIMARY KEY,
  competition_id INTEGER       NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id        TEXT          NOT NULL REFERENCES teams(id)        ON DELETE CASCADE,
  price          NUMERIC(12,2) NOT NULL CHECK (price > 0),
  day_index      INTEGER       NOT NULL CHECK (day_index >= 0),
  effective_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (competition_id, team_id, day_index)
);

CREATE INDEX IF NOT EXISTS idx_comp_prices_comp_team ON competition_prices(competition_id, team_id);
CREATE INDEX IF NOT EXISTS idx_comp_prices_effective  ON competition_prices(competition_id, effective_at DESC);

ALTER TABLE competition_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comp_prices_read_all" ON competition_prices FOR SELECT USING (TRUE);

-- Seed day-0 prices from competition_teams.initial_price
INSERT INTO competition_prices (competition_id, team_id, price, day_index)
SELECT competition_id, team_id, initial_price, 0
FROM competition_teams
ON CONFLICT (competition_id, team_id, day_index) DO NOTHING;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. PORTFOLIOS — add competition_id scope
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS competition_id INTEGER REFERENCES competitions(id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. HOLDINGS — drop FK to nations (teams not in nations table would be blocked),
--    add competition_id scope
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE holdings DROP CONSTRAINT IF EXISTS holdings_nation_id_fkey;
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS competition_id INTEGER REFERENCES competitions(id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. TRANSACTIONS — drop FK to nations, add competition_id
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_nation_id_fkey;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS competition_id INTEGER REFERENCES competitions(id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 7. DIVIDENDS — drop FK to nations, add competition_id
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE dividends DROP CONSTRAINT IF EXISTS dividends_nation_id_fkey;
ALTER TABLE dividends ADD COLUMN IF NOT EXISTS competition_id INTEGER REFERENCES competitions(id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 8. RPC: get_or_create_competition_portfolio
--    Creates or retrieves a portfolio scoped to a specific competition.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION get_or_create_competition_portfolio(
  p_competition_id INTEGER,
  p_device_id      TEXT,
  p_user_id        UUID DEFAULT NULL
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
    SELECT id INTO v_id FROM portfolios
    WHERE user_id = p_user_id AND competition_id = p_competition_id LIMIT 1;
  END IF;

  -- Then device_id
  IF v_id IS NULL AND p_device_id IS NOT NULL THEN
    SELECT id INTO v_id FROM portfolios
    WHERE device_id = p_device_id AND competition_id = p_competition_id LIMIT 1;
  END IF;

  -- Create if not found
  IF v_id IS NULL THEN
    INSERT INTO portfolios (user_id, device_id, competition_id, cash, avg_cost, tx_log)
    VALUES (p_user_id, p_device_id, p_competition_id, 10000, '{}', '[]')
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

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 9. RPC: execute_competition_trade
--    Competition-scoped trade: reads prices from competition_teams, enforces
--    game rules from competition_game_state.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION execute_competition_trade(
  p_competition_id INTEGER,
  p_device_id      TEXT,
  p_team_id        TEXT,
  p_mode           TEXT,    -- 'buy' | 'sell'
  p_quantity       INTEGER,
  p_user_id        UUID DEFAULT NULL
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
  v_eliminated TEXT[];
BEGIN
  -- ── Get/create portfolio ───────────────────────────────────────────────────
  v_pid := get_or_create_competition_portfolio(p_competition_id, p_device_id, p_user_id);

  SELECT cash, avg_cost, tx_log
  INTO v_cash, v_avg_cost, v_tx_log
  FROM portfolios WHERE id = v_pid FOR UPDATE;

  -- ── Team data (price from competition_teams, name/flag from teams) ─────────
  SELECT ct.current_price, t.name, t.flag_emoji
  INTO v_price, v_name, v_flag
  FROM competition_teams ct
  JOIN teams t ON t.id = ct.team_id
  WHERE ct.competition_id = p_competition_id AND ct.team_id = p_team_id;

  IF v_price IS NULL THEN
    RETURN jsonb_build_object('error', 'Équipe introuvable dans cette compétition');
  END IF;

  -- ── Game state ─────────────────────────────────────────────────────────────
  SELECT current_day_index, eliminated,
         (current_day_index <= 22)  -- Groups + R32 = cap phase
  INTO v_day, v_eliminated, v_is_cap
  FROM competition_game_state WHERE competition_id = p_competition_id;

  -- ── Current holdings ───────────────────────────────────────────────────────
  SELECT id, quantity INTO v_hid, v_qty_before
  FROM holdings
  WHERE portfolio_id = v_pid AND nation_id = p_team_id AND competition_id = p_competition_id
  FOR UPDATE;
  v_held := COALESCE(v_qty_before, 0);

  -- ── BUY logic ──────────────────────────────────────────────────────────────
  IF p_mode = 'buy' THEN
    IF p_team_id = ANY(v_eliminated) THEN
      RETURN jsonb_build_object('error', 'Équipe éliminée 💀');
    END IF;

    IF v_price * p_quantity > v_cash THEN
      RETURN jsonb_build_object('error', 'Fonds insuffisants');
    END IF;

    -- 40% concentration cap during group + R32 phase
    IF v_is_cap THEN
      SELECT COALESCE(p.cash, 0) +
             COALESCE((
               SELECT SUM(h.quantity * ct.current_price)
               FROM holdings h
               JOIN competition_teams ct
                 ON ct.team_id = h.nation_id AND ct.competition_id = p_competition_id
               WHERE h.portfolio_id = v_pid AND h.competition_id = p_competition_id
             ), 0)
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

    v_prev_avg := COALESCE((v_avg_cost ->> p_team_id)::NUMERIC, v_price);
    v_new_avg  := CASE WHEN v_held = 0 THEN v_price
                       ELSE (v_held * v_prev_avg + p_quantity * v_price) / (v_held + p_quantity)
                  END;
    v_avg_cost := jsonb_set(v_avg_cost, ARRAY[p_team_id], to_jsonb(ROUND(v_new_avg, 1)));

  -- ── SELL logic ─────────────────────────────────────────────────────────────
  ELSIF p_mode = 'sell' THEN
    IF v_held < p_quantity THEN
      RETURN jsonb_build_object('error', 'Actions insuffisantes');
    END IF;

    IF NOT (p_team_id = ANY(v_eliminated)) THEN
      v_fee := ROUND(v_price * p_quantity * CASE WHEN v_is_cap THEN 0.05 ELSE 0.10 END, 1);
    END IF;

    v_total    := v_price * p_quantity - v_fee;
    v_new_cash := v_cash + v_total;
    v_new_held := GREATEST(v_held - p_quantity, 0);

    IF v_new_held = 0 THEN
      v_avg_cost := v_avg_cost - p_team_id;
    END IF;

  ELSE
    RETURN jsonb_build_object('error', 'Mode invalide');
  END IF;

  -- ── Persist: cash + avg_cost ───────────────────────────────────────────────
  UPDATE portfolios SET cash = v_new_cash, avg_cost = v_avg_cost, updated_at = NOW()
  WHERE id = v_pid;

  -- ── Persist: holdings ──────────────────────────────────────────────────────
  IF v_hid IS NOT NULL THEN
    IF v_new_held > 0 THEN
      UPDATE holdings SET quantity = v_new_held, updated_at = NOW() WHERE id = v_hid;
    ELSE
      DELETE FROM holdings WHERE id = v_hid;
      v_hid := NULL;
    END IF;
  ELSIF v_new_held > 0 THEN
    INSERT INTO holdings (portfolio_id, nation_id, competition_id, quantity)
    VALUES (v_pid, p_team_id, p_competition_id, v_new_held)
    RETURNING id INTO v_hid;
  END IF;

  -- ── Persist: transactions ──────────────────────────────────────────────────
  INSERT INTO transactions (portfolio_id, nation_id, competition_id, type, quantity, price, fee, total, day_index)
  VALUES (v_pid, p_team_id, p_competition_id, p_mode, p_quantity, v_price, v_fee, GREATEST(v_total, 0.01), v_day);

  -- ── Prepend to tx_log (keep last 100) ─────────────────────────────────────
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
-- 10. RPC: update_competition_prices
--     Competition-scoped version of update_prices_after_match.
--     Called by process-real-result after each finished match.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION update_competition_prices(
  p_competition_id INTEGER,
  p_team_a         TEXT,
  p_new_price_a    NUMERIC,
  p_team_b         TEXT,
  p_new_price_b    NUMERIC,
  p_day_index      INTEGER
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE competition_teams SET current_price = p_new_price_a
  WHERE competition_id = p_competition_id AND team_id = p_team_a;

  UPDATE competition_teams SET current_price = p_new_price_b
  WHERE competition_id = p_competition_id AND team_id = p_team_b;

  INSERT INTO competition_prices (competition_id, team_id, price, day_index, effective_at)
  VALUES
    (p_competition_id, p_team_a, p_new_price_a, p_day_index, NOW()),
    (p_competition_id, p_team_b, p_new_price_b, p_day_index, NOW())
  ON CONFLICT (competition_id, team_id, day_index) DO UPDATE SET
    price        = EXCLUDED.price,
    effective_at = EXCLUDED.effective_at;
END;
$$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 11. RPC: distribute_competition_dividends
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION distribute_competition_dividends(
  p_competition_id INTEGER,
  p_team_id        TEXT,
  p_round          TEXT,
  p_rate           NUMERIC,
  p_price          NUMERIC,
  p_day_index      INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  INTEGER := 0;
  rec      RECORD;
  v_amount NUMERIC(12,2);
BEGIN
  FOR rec IN
    SELECT h.portfolio_id, h.quantity
    FROM holdings h
    WHERE h.nation_id = p_team_id
      AND h.competition_id = p_competition_id
      AND h.quantity > 0
  LOOP
    v_amount := ROUND(rec.quantity * p_price * p_rate, 1);
    IF v_amount <= 0 THEN CONTINUE; END IF;

    UPDATE portfolios SET cash = cash + v_amount, updated_at = NOW()
    WHERE id = rec.portfolio_id;

    INSERT INTO dividends (portfolio_id, nation_id, competition_id, round, amount, shares, day_index)
    VALUES (rec.portfolio_id, p_team_id, p_competition_id, p_round, v_amount, rec.quantity, p_day_index)
    ON CONFLICT (portfolio_id, nation_id, round) DO UPDATE
      SET amount = dividends.amount + EXCLUDED.amount;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 12. RPC: liquidate_competition_eliminated
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE OR REPLACE FUNCTION liquidate_competition_eliminated(
  p_competition_id INTEGER,
  p_team_id        TEXT,
  p_day_index      INTEGER
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
    FROM holdings h
    WHERE h.nation_id = p_team_id
      AND h.competition_id = p_competition_id
      AND h.quantity > 0
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

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 13. Unique constraint on dividends needs competition_id scope
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE dividends DROP CONSTRAINT IF EXISTS dividends_portfolio_id_nation_id_round_key;
ALTER TABLE dividends ADD CONSTRAINT dividends_portfolio_competition_team_round_key
  UNIQUE (portfolio_id, competition_id, nation_id, round);
