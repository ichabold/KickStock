# KickStock — Architecture du Mode Online

> Document de référence technique pour les conversations futures.  
> Décrit l'intégration API-Football v3 et le mode online ajouté en complément du mode offline existant.

---

## 1. Vue d'ensemble

KickStock a **deux modes de jeu** :

| Mode | Description | Source des données |
|---|---|---|
| **Offline** | Simulation manuelle, le joueur avance les jours | Constantes locales → Bootstrap DB |
| **Online** | Résultats réels automatiques via cron | API-Football v3 (RapidAPI / api-sports.io) |

Le switch de mode est dans `localStorage('kickstock:mode')` = `'online'|'offline'`. Un rechargement de page applique le changement.

---

## 2. Principe architectural : zéro hardcoding

### Avant (état initial)
```
packages/constants/NATIONS   → liste hardcodée des 32 équipes (id, flag, groupe, force, prix)
packages/constants/CALENDAR  → calendrier hardcodé des 34 jours + matchs
```
Ces constantes rendaient impossible le support d'une autre compétition (Ligue des Champions, etc.) sans modifier le code.

### Après (architecture DB-driven)
```
DB: competitions      → registre des compétitions (league_id + season = clé unique)
DB: teams             → remplace NATIONS (peuplé par sync-fixtures)
DB: competition_teams → groupe + prix initial par compétition
DB: competition_days  → remplace CALENDAR (dérivé des fixtures API)
DB: matches           → matchs avec fixture_id API, statut temps réel, processed_at
```

**Règle d'or** : tout ce qui est factuel (équipes, groupes, dates) vient de l'API. Seules les règles métier (PHASE_TO_DIV, seuil d'upset, tiers de prix) restent dans le code.

---

## 3. Migration DB (`db/migrations/010_api_integration.sql`)

### Renommages préalables
L'ancienne table `competitions` (prototype multi-joueur, migration 004, jamais utilisée en prod) est renommée pour libérer le nom :
```sql
ALTER TABLE competition_players RENAME TO game_room_players;
ALTER TABLE competition_trades  RENAME TO game_room_trades;
ALTER TABLE competitions        RENAME TO game_rooms;
```

### Nouvelles tables

```sql
-- Registre des compétitions
CREATE TABLE competitions (
  id           SERIAL PRIMARY KEY,
  league_id    INTEGER NOT NULL,        -- 1 = FIFA WC, 2 = UCL...
  season       INTEGER NOT NULL,        -- 2026
  name         TEXT NOT NULL,
  start_date   DATE,                    -- pour calcul day_index (UTC-5)
  is_active    BOOLEAN DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  UNIQUE (league_id, season)
);

-- Équipes (remplace NATIONS)
CREATE TABLE teams (
  id           TEXT PRIMARY KEY,        -- "BRA", "FRA" (FIFA alpha-3)
  api_team_id  INTEGER UNIQUE,          -- ID API-Football
  name         TEXT NOT NULL,
  logo_url     TEXT,
  flag_emoji   TEXT,                    -- dérivé: isoToFlagEmoji("BR") → 🇧🇷
  confederation TEXT,                   -- "UEFA"|"CONMEBOL"|"CAF"|"AFC"|"CONCACAF"|"OFC"
  strength     INTEGER DEFAULT 75       -- seeded depuis classements FIFA (0–100)
);

-- Groupes + prix par compétition (remplace initialPrice dans NATIONS)
CREATE TABLE competition_teams (
  competition_id INTEGER REFERENCES competitions(id),
  team_id        TEXT REFERENCES teams(id),
  group_code     TEXT,                  -- "A"…"L"
  initial_price  INTEGER DEFAULT 100,   -- KC (seeded depuis seed-team-rankings.ts)
  PRIMARY KEY (competition_id, team_id)
);

-- Calendrier dérivé (remplace CALENDAR)
CREATE TABLE competition_days (
  competition_id INTEGER REFERENCES competitions(id),
  day_index      INTEGER NOT NULL,      -- 0-based
  date_label     TEXT NOT NULL,         -- "Jun 11"
  full_label     TEXT NOT NULL,         -- "Day 1 · Thu Jun 11" | "R32 · Sun Jun 28"
  phase          TEXT NOT NULL,         -- "Groups"|"R32"|"R16"|"QF"|"SF"|"3rd"|"Final"
  is_ko          BOOLEAN DEFAULT FALSE,
  div_key        TEXT,                  -- null|"r32"|"r16"|"qf"|"sf"|"final"
  UNIQUE (competition_id, day_index)
);
```

### Colonnes ajoutées à `matches`

```sql
ALTER TABLE matches ADD COLUMN fixture_id       INTEGER UNIQUE;  -- clé API-Football
ALTER TABLE matches ADD COLUMN competition_id   INTEGER;
ALTER TABLE matches ADD COLUMN api_status       TEXT DEFAULT 'NS';
ALTER TABLE matches ADD COLUMN scheduled_at     TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN processed_at     TIMESTAMPTZ;     -- NULL = pas encore traité
ALTER TABLE matches ADD COLUMN trade_lock_until TIMESTAMPTZ;     -- processed_at + 15min
```

### RPC critique : `upsert_fixture`

```sql
-- Upsert qui ne touche JAMAIS processed_at, score_a, score_b, trade_lock_until
CREATE OR REPLACE FUNCTION upsert_fixture(...)
INSERT INTO matches (fixture_id, ...) VALUES (...)
ON CONFLICT (fixture_id) DO UPDATE SET
  scheduled_at = EXCLUDED.scheduled_at,
  api_status   = EXCLUDED.api_status,
  league_round = EXCLUDED.league_round,
  venue        = EXCLUDED.venue,
  day_index    = EXCLUDED.day_index,
  phase        = EXCLUDED.phase
  -- processed_at, score_a, score_b : NON INCLUS → jamais écrasés
```

### Index performance

```sql
-- Fenêtre de match (requête centrale de isMatchWindowActive)
CREATE INDEX idx_matches_window ON matches (scheduled_at)
  WHERE processed_at IS NULL AND api_status NOT IN ('PST','SUSP','CANC','ABD');

-- Trading lock
CREATE INDEX idx_matches_trade_lock ON matches (trade_lock_until)
  WHERE trade_lock_until IS NOT NULL;
```

---

## 4. Couche API-Football (`apps/web/lib/football-api.ts`)

### Authentification
```ts
// api-sports.io direct (dashboard.api-football.com)
headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
// ⚠️ Si RapidAPI : utiliser 'x-rapidapi-key' + 'x-rapidapi-host' à la place
```

### Fonctions publiques

| Fonction | Usage | Cache |
|---|---|---|
| `fetchAllFixtures(leagueId, season)` | cron sync-fixtures (quotidien) | Redis 3600s, clé: `api:fixtures:{id}:{season}:{YYYY-MM-DD}` |
| `fetchFinishedFixtures(leagueIds, season)` | cron sync-results (30 min) | Redis 1800s, clé: `api:finished:{hash}:{bucket_30min}` |
| `fetchLiveFixtures(leagueIds)` | affichage temps réel | Pas de cache |
| `fetchFifaRankings()` | script one-off seed-team-rankings | Pas de cache |

### Stale-while-revalidate
Si l'API répond 429 ou 5xx, `fetchWithCache` retourne la dernière valeur en cache plutôt que de crasher le cron.

### Budget API (plan Free = 100 req/jour)

| Scénario | Appels/jour |
|---|---|
| Jour sans match | ~1 (sync-fixtures 06h) |
| Jour de match (6h actives) | ~13 (1 + 12 × 30min) |
| Pire cas (2 jours de match) | ~25 |

**Upgrade vers plan Basic** : changer `*/30` → `*/5` dans `vercel.json` + bucket Redis `1_800_000` → `300_000`.

---

## 5. Cron Architecture

### `vercel.json`
```json
{
  "crons": [
    { "path": "/api/cron/sync-fixtures", "schedule": "0 6 * * *" },
    { "path": "/api/cron/sync-results",  "schedule": "*/30 * * * *" }
  ]
}
```

### `GET /api/cron/sync-fixtures` (quotidien 06:00 UTC)

```
1. Charge les competitions actives (is_active = true)
2. Pour chaque competition :
   a. fetchAllFixtures(league_id, season)  → 1 appel API
   b. normalizeFixture() → TeamRow, CompTeamRow, CompDayRow, MatchRow
   c. Upsert teams         (sans toucher strength)
   d. Upsert competition_teams (sans toucher initial_price)
   e. Upsert competition_days
   f. RPC upsert_fixture  (sans toucher processed_at/scores)
   g. Update competitions.last_sync_at
```

Sécurisé par `Authorization: Bearer {CRON_SECRET}`.

### `GET /api/cron/sync-results` (toutes les 30 min)

```
1. Charge competitions actives
2. isMatchWindowActive(compIds) → false = exit immédiat (0 appel API)
3. fetchFinishedFixtures(leagueIds, season)
4. Pour chaque fixture FT/AET/PEN :
   → processRealMatchResult(fixtureId, fixture)
5. Pour chaque competition :
   → checkAndAdvancePhase(competitionId)
```

### `isMatchWindowActive()` (`apps/web/lib/match-window.ts`)

Requête DB : compte les matchs non-traités entre `now - 3h` et `now + 3h`.
- Retourne `false` → cron exit, 0 appel API consommé
- Fail open (erreur DB → retourne `true`, le cron tourne quand même)

---

## 6. Normalizer (`apps/web/lib/normalizer.ts`)

Transforme un `ApiFixture` brut en 4 payloads DB-ready.

### Fonctions clés

```ts
// "Group Stage - 1" → "Groups"
// "Round of 32"     → "R32"
// "Quarter-finals"  → "QF"
leagueRoundToPhase(round: string): string

// Calcule le jour 0-based avec frontière minuit ET (UTC-5)
// start="2026-06-11", fixture="2026-06-12T02:00:00Z" → 0 (encore le Jun 11 ET)
calcDayIndex(fixtureDate, startDate): number

// "BR" → 🇧🇷  (Unicode Regional Indicator Symbols)
isoToFlagEmoji(iso2: string): string

// "https://media.api-sports.io/flags/br.svg" → "BR"
extractIsoFromLogoUrl(logoUrl): string | null

// Mapping phase → clé dividende (règle métier, pas factuelle)
PHASE_TO_DIV = { Groups: null, R32: 'r32', R16: 'r16', QF: 'qf', SF: 'sf', Final: 'final' }
```

---

## 7. Team Mapping (`apps/web/lib/team-mapping/`)

Pont entre les noms API-Football (ex: `"Korea Republic"`) et les IDs KickStock (ex: `"KOR"`).

### Structure

```
team-mapping/
  index.ts      → apiNameToTeamId(apiName, leagueId): string | null
  league_1.ts   → FIFA World Cup (80+ entrées, 2022 + 2026)
  # À créer pour V2 :
  # league_2.ts   → UEFA Champions League
  # league_39.ts  → English Premier League
```

### Cas spéciaux couverts
```ts
'Korea Republic': 'KOR',
'IR Iran':        'IRN',
'Côte d\'Ivoire': 'CIV',
'Ivory Coast':    'CIV',   // alias API-Football
```

### Script de validation (avant déploiement)
```bash
pnpm tsx scripts/validate-team-mapping.ts --league=1 --season=2022
# → Teste sur données passées, liste les noms manquants
```

---

## 8. Processing des résultats (`apps/web/lib/process-real-result.ts`)

### Flow complet

```
processRealMatchResult(fixtureId, fixture)
  1. Charge le match depuis DB (par fixture_id)
  2. Guard idempotence : processed_at !== null → return false
  3. Charge team strengths (A et B)
  4. determineResult(fixture) → 'A'|'B'|'draw'
     - PEN : fixture.score.penalty.home vs away
     - FT/AET : fixture.goals.home vs away
  5. detectUpset() : gap strength > 5 ET équipe plus faible gagne
  6. Charge current prices (nations.current_price)
  7. applyResult(pA, pB, res) → [newPA, newPB]  (game-engine)
  8. RPC update_prices_after_match
  9. Si KO (hors SF/3rd) : RPC liquidate_eliminated(loserId)
  10. Si div_key présent : RPC distribute_dividends(winnerId)
  11. Update matches :
      - score_a, score_b, winner_id, is_upset
      - processed_at = NOW()
      - trade_lock_until = NOW() + 15min
      - result_data = { JSONB complet pour le client }
```

---

## 9. Avancement de phase (`apps/web/lib/check-advance-phase.ts`)

Appelé après chaque batch de résultats. Idempotent.

```
checkAndAdvancePhase(competitionId)
  1. Lit game_state (current_day_index, pools, eliminated)
  2. Compte matchs pending du jour courant → si > 0, return
  3. Met à jour les KO pools depuis les résultats du jour
  4. Si dernier jour de groupes :
     - buildR32Pool(allResults, eliminated)  [game-engine]
     - liquidate_eliminated() pour les équipes éliminées en groupes
  5. Avance game_state.current_day_index + 1
     + met à jour current_phase, r32_pool…final_pool, champion_id
```

---

## 10. Bootstrap client (`apps/web/lib/bootstrap.ts`)

Remplace l'import direct de `NATIONS` et `CALENDAR` côté client.

### Route serveur : `GET /api/competition/bootstrap`

Retourne :
```json
{
  "competition": { "id", "name", "start_date", "league_id", "season" },
  "teams":        [ { "id", "name", "flag_emoji", "group_code", "strength", "initial_price", ... } ],
  "days":         [ { "day_index", "full_label", "date_label", "phase", "is_ko", "div_key" } ],
  "group_fixtures": [ { "day_index", "nation_a", "nation_b", "venue" } ],
  "generated_at": "ISO timestamp"
}
```

Cache-Control: `public, s-maxage=3600, stale-while-revalidate=86400`

### Cache localStorage

```ts
CACHE_KEY = 'kickstock:bootstrap:v1'
CACHE_TTL = 24h

getBootstrap()    → cache → fetch → stale fallback → null
refreshBootstrap() → vide cache → getBootstrap()
bootstrapToTeams(data) → BootstrapTeam[] (snake_case) → TeamMeta[] (camelCase game-engine)
```

---

## 11. Seeding des forces/prix (`scripts/seed-team-rankings.ts`)

### Calcul de `strength`

```ts
// Normalise les points FIFA vers [60, 95]
calcStrength(points, allPoints[]) =
  Math.round(((points - min) / (max - min)) * 35 + 60)
// clampé à [60, 95]
```

### Calcul de `initial_price`

```ts
calcInitialPrice(rankParmiParticipants) =
  rank ≤  4  → 250 KC   (top 4 mondial)
  rank ≤ 12  → 200 KC
  rank ≤ 24  → 150 KC
  rank ≤ 36  → 120 KC
  else       → 100 KC
```

### Usage
```bash
# Dry run (affiche sans écrire)
pnpm tsx scripts/seed-team-rankings.ts --league=1 --season=2026 --dry-run

# Écriture réelle
pnpm tsx scripts/seed-team-rankings.ts --league=1 --season=2026
```

Source : API-Football `/teams/rankings/fifa`, fallback CSV `scripts/data/fifa-rankings.csv`.

---

## 12. Mode switch UI

### `apps/web/hooks/useGameMode.ts`

```ts
export type GameMode = 'online' | 'offline';

useGameMode()        → { mode, switchMode(next) }   // React hook
getGameModeSync()    → GameMode                      // sync, pour init store
// switchMode() écrit dans localStorage + window.location.reload()
```

### `AuthWidget.tsx`

Bouton dans le menu compte :
- En online : `"🎲 Jouer en simulation →"`  → switch vers offline
- En offline : `"⚡ Retour au mode Live →"`  → switch vers online

---

## 13. LiveTab (`apps/web/components/mobile/LiveTab.tsx`)

Remplace `SimulateTab` en mode online. Polling `/api/game/live-matches` toutes les **60 secondes**.

### États d'un match

| `api_status` | Affichage | Couleur |
|---|---|---|
| NS (Not Started) | `-Xmin` | gold |
| 1H / HT / 2H / ET | `EN JEU` | gain (vert) |
| FT / AET / PEN | `score_a–score_b` | muted (gris) |

### Trading lock

```
lockUntil = processed_at + 15min
Si lockUntil > now → affiche 🔒
```

---

## 14. `localGameStore` mis à jour

### Changements majeurs vs version initiale

- **Suppression** des imports `NATIONS`, `CALENDAR`
- **Ajout** : `_bootstrap: BootstrapData | null` + `_teams: TeamMeta[]` (non persistés)
- **`loadBootstrap()`** : appelé par `startSync()` et `fetchState()`, seed les prix si `prices` est vide
- **`advanceDay()`** : utilise `bootstrap.days[dayIndex]` pour les métadonnées (plus `CALENDAR`)
- **`_bootstrap` et `_teams` exclus de `partialize`** (pas sérialisés dans localStorage)

---

## 15. Variables d'environnement requises

```env
# API-Football (api-sports.io direct ou RapidAPI)
API_FOOTBALL_KEY=xxxx
# ⚠️ Si RapidAPI : header 'x-rapidapi-key' au lieu de 'x-apisports-key' dans football-api.ts

# Sécurité crons
CRON_SECRET=<openssl rand -hex 32>

# Cache Redis (optionnel mais recommandé)
UPSTASH_REDIS_REST_URL=https://eu1-xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxxxxxxxx

# Déjà présents
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## 16. Checklist de mise en production

- [ ] Exécuter `db/migrations/010_api_integration.sql` sur Supabase
- [ ] Remplir `API_FOOTBALL_KEY` + `CRON_SECRET` dans `.env.local` et Vercel
- [ ] (Optionnel) Configurer Upstash Redis pour le cache
- [ ] Tester `sync-fixtures` manuellement :
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://ton-app.vercel.app/api/cron/sync-fixtures
  ```
- [ ] Vérifier les tables `teams`, `competition_teams`, `competition_days`, `matches` dans Supabase
- [ ] Lancer `validate-team-mapping.ts` sur la saison 2022 (test sur données passées)
- [ ] Lancer `seed-team-rankings.ts --dry-run` puis sans `--dry-run`
- [ ] Vérifier `/api/competition/bootstrap` retourne des données

---

## 17. Prochaine étape : S5 — onlineGameStore

`apps/web/stores/gameStore.ts` re-exporte encore `localGameStore`.  
S5 consistera à :
1. Implémenter `onlineGameStore` : lit `game_state` depuis Supabase Realtime
2. Switch dans `gameStore.ts` basé sur `getGameModeSync()`
3. Supprimer les fallbacks `NATIONS` restants dans `buildKOMatches.ts`

---

*Dernière mise à jour : Mai 2026*
