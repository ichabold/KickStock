-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 027_offline_ranking_registered.sql
--
-- Crée get_offline_ranking() : classement offline des joueurs ENREGISTRÉS
-- uniquement (user_id IS NOT NULL), 1 ligne par joueur (meilleur score
-- toutes compétitions confondues), trié best_score DESC.
--
-- Raisons :
--  • Séparer clairement offline (simulation) vs online (live).
--  • Éviter la pollution par les guests anonymes.
--  • Un joueur avec plusieurs compétitions n'apparaît qu'une fois.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION get_offline_ranking(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  user_id    UUID,
  username   TEXT,
  country    TEXT,
  best_score NUMERIC,
  rank       BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH best AS (
    SELECT
      p.user_id,
      pr.username,
      pr.country,
      MAX(p.best_score) AS best_score
    FROM portfolios p
    JOIN profiles pr ON pr.id = p.user_id
    WHERE p.user_id IS NOT NULL
      AND p.best_score IS NOT NULL
      AND pr.username IS NOT NULL
    GROUP BY p.user_id, pr.username, pr.country
  )
  SELECT
    best.user_id,
    best.username,
    best.country,
    best.best_score,
    RANK() OVER (ORDER BY best.best_score DESC) AS rank
  FROM best
  ORDER BY best.best_score DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_offline_ranking(INTEGER) TO anon, authenticated;
