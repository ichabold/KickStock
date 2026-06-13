-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 023: Block buy/sell while a team's match is in progress (or in the
--      post-match trade-lock window).
--
-- `execute_competition_trade` (the only entry point for online trades, see
-- apps/web/app/api/trade/route.ts) now rejects BUY/SELL for a team that has
-- a match, in the current competition, that is:
--   - currently live (api_status IN '1H','HT','2H','ET','BT','P'), OR
--   - within its post-match lock window (trade_lock_until > NOW(), set by
--     process-real-result.ts to processed_at + 15min)
--
-- NOTE: We deliberately do NOT reuse the existing `is_trade_locked(p_nation_id)`
-- RPC (db/migrations/010:248). That function also flags any unprocessed match
-- with `scheduled_at <= NOW() + 5min` — and the DB contains many legacy
-- competition_id=1 (WC2022) rows with api_status='FT', processed_at=NULL and
-- scheduled_at far in the past, which would make is_trade_locked() return TRUE
-- forever for almost every team. The check below is scoped to the trading
-- competition and only looks at *currently live* status / active lock window,
-- avoiding that trap entirely.
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
  -- ── Trading lock: team's match is live or in its post-match lock window ────
  IF EXISTS (
    SELECT 1 FROM matches
    WHERE competition_id = p_competition_id
      AND (nation_a = p_team_id OR nation_b = p_team_id)
      AND (
        api_status IN ('1H', 'HT', '2H', 'ET', 'BT', 'P')
        OR (trade_lock_until IS NOT NULL AND trade_lock_until > NOW())
      )
  ) THEN
    RETURN jsonb_build_object('error', '🔒 Trading verrouillé pendant le match');
  END IF;

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
