-- KickStock · Migration 016 · upsert_fixture — nation_a/b dans DO UPDATE SET
--
-- Avant: nation_a et nation_b n'étaient jamais mis à jour lors d'un conflit.
-- Problème: les fixtures KO sont d'abord insérés avec des placeholders
-- ("KO_WINNERA", "KO_RUNNERB"). Quand l'API affecte les vraies équipes,
-- le prochain sync doit mettre à jour ces champs.
--
-- Fix: ajouter nation_a et nation_b au DO UPDATE SET.
-- Les scores, processed_at et trade_lock_until restent protégés.

CREATE OR REPLACE FUNCTION upsert_fixture(
  p_fixture_id     INTEGER,
  p_competition_id INTEGER,
  p_nation_a       TEXT,
  p_nation_b       TEXT,
  p_day_index      INTEGER,
  p_phase          TEXT,
  p_league_round   TEXT,
  p_venue          TEXT,
  p_scheduled_at   TIMESTAMPTZ,
  p_api_status     TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO matches (
    id,
    fixture_id, competition_id,
    nation_a, nation_b,
    day_index, phase,
    league_round, venue,
    scheduled_at, api_status
  ) VALUES (
    'm_api_' || p_fixture_id,
    p_fixture_id, p_competition_id,
    p_nation_a, p_nation_b,
    p_day_index, p_phase,
    p_league_round, p_venue,
    p_scheduled_at, p_api_status
  )
  ON CONFLICT (fixture_id) DO UPDATE SET
    nation_a     = EXCLUDED.nation_a,      -- ← mise à jour placeholder → vraie équipe
    nation_b     = EXCLUDED.nation_b,      -- ← idem
    scheduled_at = EXCLUDED.scheduled_at,
    api_status   = EXCLUDED.api_status,
    league_round = EXCLUDED.league_round,
    venue        = EXCLUDED.venue,
    day_index    = EXCLUDED.day_index,
    phase        = EXCLUDED.phase;
    -- processed_at     → NOT updated
    -- score_a, score_b → NOT updated
    -- trade_lock_until → NOT updated
    -- result_data      → NOT updated
END;
$$;
