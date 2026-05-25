-- KickStock · Migration 001 · Schema
-- Run on Supabase SQL Editor (staging first, then prod)

-- ── PROFILES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT UNIQUE NOT NULL,
  country     TEXT,                       -- for leaderboard "BY COUNTRY"
  tut_seen    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── PORTFOLIOS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
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

-- ── POSITIONS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nation_id  TEXT NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, nation_id)
);

-- ── TRADES ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nation_id   TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('buy', 'sell')),
  quantity    INTEGER NOT NULL,
  price       NUMERIC(10,2) NOT NULL,
  tax         NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_amount  NUMERIC(12,2) NOT NULL,
  day_index   INTEGER NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── NATIONS (reference data) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nations (
  id          TEXT PRIMARY KEY,       -- e.g. "BRA", "FRA"
  name        TEXT NOT NULL,
  flag        TEXT NOT NULL,
  initial_price NUMERIC(10,2) NOT NULL,
  conf        TEXT NOT NULL,
  str         INTEGER NOT NULL,
  grp         TEXT NOT NULL           -- group letter A-L
);

-- ── PRICE HISTORY ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nation_id   TEXT NOT NULL REFERENCES nations(id),
  price       NUMERIC(10,2) NOT NULL,
  day_index   INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user    ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_ph_nation      ON price_history(nation_id, day_index);
