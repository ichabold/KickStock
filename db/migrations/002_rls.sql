-- KickStock · Migration 002 · Row Level Security

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades        ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update their own
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Portfolios: users read/update their own
CREATE POLICY "portfolios_select_own" ON portfolios FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "portfolios_update_own" ON portfolios FOR UPDATE USING (auth.uid() = user_id);

-- Positions: users CRUD their own
CREATE POLICY "positions_select_own" ON positions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "positions_insert_own" ON positions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "positions_update_own" ON positions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "positions_delete_own" ON positions FOR DELETE USING (auth.uid() = user_id);

-- Trades: users insert/read their own
CREATE POLICY "trades_select_own" ON trades FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "trades_insert_own" ON trades FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Nations: public read
CREATE POLICY "nations_public_read"  ON nations       FOR SELECT USING (TRUE);
CREATE POLICY "ph_public_read"       ON price_history FOR SELECT USING (TRUE);
