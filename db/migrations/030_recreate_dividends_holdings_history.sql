-- 030_recreate_dividends_holdings_history.sql
--
-- Migration 013 ("cleanup_legacy") dropped `dividends` and `holdings_history`
-- as legacy single-competition tables, but the multi-competition RPCs added
-- in migration 012 (distribute_competition_dividends) and updated in 028
-- (liquidate_competition_eliminated) still INSERT into them. Any KO win/
-- elimination for a team someone actually holds has been silently failing
-- since 013 — and since these functions have no exception handler, the
-- failure rolls back the whole RPC call (cash credit included), not just the
-- history row.
--
-- Recreated in their final (post-012) shape directly: nation_id now
-- references `teams(id)` (the `nations` table itself is long gone), and
-- dividends.round accepts the round keys actually used by the app
-- ('3rd', not the original 'final').

CREATE TABLE IF NOT EXISTS holdings_history (
  id              BIGSERIAL PRIMARY KEY,
  holdings_id     UUID    NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  quantity_before INTEGER NOT NULL,
  quantity_after  INTEGER NOT NULL,
  delta           INTEGER NOT NULL,
  reason          TEXT    NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE holdings_history ENABLE ROW LEVEL SECURITY;
-- No client-facing SELECT policy: written only by SECURITY DEFINER RPCs,
-- never read directly by app code (matches the original 001/FULL_SETUP setup).

CREATE TABLE IF NOT EXISTS dividends (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id   UUID          NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  nation_id      TEXT          NOT NULL REFERENCES teams(id),
  competition_id INTEGER       REFERENCES competitions(id),
  round          TEXT          NOT NULL CHECK (round IN ('r32','r16','qf','sf','3rd','champion')),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  shares         INTEGER       NOT NULL CHECK (shares >= 0),
  day_index      INTEGER       NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (portfolio_id, competition_id, nation_id, round)
);

CREATE INDEX IF NOT EXISTS idx_dividends_portfolio ON dividends(portfolio_id);

ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dividends_select_own"
  ON dividends FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
