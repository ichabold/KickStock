-- KickStock · Migration 013 · Nettoyage des objets legacy
-- Prérequis : migrations 001–012 appliquées
-- Prérequis : tables legacy vides (vérifier avec la requête ci-dessous avant d'exécuter)
-- Run on Supabase SQL Editor

-- Vérification préalable OBLIGATOIRE — exécuter d'abord, procéder uniquement si tout retourne 0 :
-- SELECT 'nations'       AS t, COUNT(*) FROM nations
-- UNION ALL SELECT 'positions',    COUNT(*) FROM positions
-- UNION ALL SELECT 'trades',       COUNT(*) FROM trades
-- UNION ALL SELECT 'price_history',COUNT(*) FROM price_history
-- UNION ALL SELECT 'game_state',   COUNT(*) FROM game_state
-- UNION ALL SELECT 'nation_prices',COUNT(*) FROM nation_prices
-- UNION ALL SELECT 'group_standings',COUNT(*) FROM group_standings
-- UNION ALL SELECT 'knockout_pools', COUNT(*) FROM knockout_pools
-- UNION ALL SELECT 'holdings_history',COUNT(*) FROM holdings_history
-- UNION ALL SELECT 'dividends',    COUNT(*) FROM dividends;

-- ─── 1. Supprimer les RPCs legacy ────────────────────────────────────────────

DROP FUNCTION IF EXISTS execute_trade(
  p_device_id TEXT, p_user_id UUID,
  p_team_id TEXT, p_mode TEXT, p_quantity INTEGER
);

DROP FUNCTION IF EXISTS get_or_create_portfolio(
  p_device_id TEXT, p_user_id UUID
);

DROP FUNCTION IF EXISTS distribute_dividends(
  p_portfolio_id UUID, p_nation_id TEXT, p_div_key TEXT
);

DROP FUNCTION IF EXISTS liquidate_eliminated(
  p_portfolio_id UUID, p_nation_id TEXT
);

-- ─── 2. Supprimer le trigger legacy ──────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_sync_nation_price ON nation_prices;
DROP FUNCTION IF EXISTS sync_nation_current_price();

-- ─── 3. Supprimer les tables legacy dans l'ordre des dépendances ─────────────

DROP TABLE IF EXISTS holdings_history CASCADE;
DROP TABLE IF EXISTS dividends        CASCADE;
DROP TABLE IF EXISTS nation_prices    CASCADE;
DROP TABLE IF EXISTS group_standings  CASCADE;
DROP TABLE IF EXISTS knockout_pools   CASCADE;

DROP TABLE IF EXISTS price_history    CASCADE;
DROP TABLE IF EXISTS positions        CASCADE;
DROP TABLE IF EXISTS trades           CASCADE;
DROP TABLE IF EXISTS nations          CASCADE;

DROP TABLE IF EXISTS game_state       CASCADE;
DROP TABLE IF EXISTS groups           CASCADE;

-- ─── 4. Vérification post-migration ──────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
-- → ne doit plus lister : nations, positions, trades, price_history,
--                         game_state, nation_prices, group_standings,
--                         knockout_pools, holdings_history, dividends, groups
