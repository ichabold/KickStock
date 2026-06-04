# Plan d'intégration API-Football — KickStock Online

> Version : 2026-05-29 rev 5 — rankings FIFA/UEFA pour strength + initial_price  
> Codebase analysée : V16.3  
> Références : kickstock-API-FOOT.md · table_20260529.csv

---

## 1. Décisions architecturales

### 1.1 Nature du jeu en mode online

> **KickStock Online = un fantasy market sur les vrais résultats, en temps réel.**

- Les prix bougent selon les **vrais scores** fournis par l'API, pas les simulés.
- Le moteur `simulate()` et le mode offline restent **intacts** — la simulation est une feature produit.
- Le bouton "Simuler" disparaît en mode online. Les résultats arrivent automatiquement.

### 1.2 Granularité : le match, pas la journée

En offline, le joueur avance par **journée** (Play = simuler tous les matchs du jour d'un coup).  
En online, le marché avance **match par match**, au fil des vrais coups de sifflet.

### 1.3 Trading lock par match

Fenêtre : **T−5 min avant coup d'envoi prévu → T+15 min après fin réelle** (FT/AET/PEN détecté par l'API).  
Lock **chirurgical** : uniquement sur les deux nations qui jouent, les autres restent tradables.

### 1.4 Zéro contenu hardcodé

> **CALENDAR et NATIONS sont supprimés de `packages/constants`.**

Tout ce qu'ils contiennent vient de l'API ou en est dérivé algorithmiquement. Ce qui n'est pas dans l'API (force des équipes, prix initial KC) est un paramètre de **game design** stocké en DB et configurable via l'admin panel — jamais en dur dans le code.

### 1.5 Architecture multi-compétitions dès la V1

La V1 ne supporte que la CdM 2026. Mais rien n'est hardcodé pour elle. Ajouter la Ligue des Champions revient à insérer une ligne dans `competitions` et créer un fichier de mapping.

---

## 2. Architecture cible

```
API-Football (RapidAPI)
        │
        ├─── [Cron daily · 6h00 UTC]  /api/cron/sync-fixtures
        │         │
        │         ├─ lit competitions (is_active = true)
        │         ├─ GET /fixtures?league=X&season=Y  (1 req / compétition)
        │         ├─ auto-découverte des équipes → upsert teams + competition_teams
        │         ├─ dérivation des métadonnées de jour → upsert competition_days
        │         ├─ upsert matches (ne touche JAMAIS processed_at ni les scores)
        │         └─ met à jour competitions.last_sync_at
        │
        └─── [Cron */30 min]  /api/cron/sync-results
                  │
                  ├─ isMatchWindowActive() → non : skip (0 appel API)
                  │                       → oui :
                  ├─ GET /fixtures?status=FT,AET,PEN  (toutes compétitions actives)
                  │    ←→ Redis cache 5 min
                  ├─ pour chaque fixture terminé non traité :
                  │    processRealMatchResult(fixtureId)
                  │      ├─ applyResult() → nouveaux prix
                  │      ├─ nation_prices + nations.current_price
                  │      ├─ group_standings (phase de groupes)
                  │      ├─ liquidate_eliminated() RPC (phase KO)
                  │      ├─ distribute_dividends() RPC
                  │      ├─ matches.processed_at = NOW()
                  │      └─ matches.trade_lock_until = NOW() + 15 min
                  └─ checkAndAdvancePhase()
```

| | `sync-fixtures` (daily) | `sync-results` (every 30 min) |
|--|------------------------|-------------------------------|
| Fréquence | 1× / compétition / jour | 0–12×/jour selon fenêtres |
| Responsabilité | Calendrier, équipes, reports, métadonnées | Résultats, prix, dividendes |
| Écrit `processed_at` | ❌ jamais | ✅ toujours |
| Appel API si rien | 1 (daily inévitable) | 0 (court-circuit) |
| **Plan Free (~100 req/j)** | ✅ 1 req/jour | ✅ ~6 req/jour (fenêtre 3h) |

---

## 3. SWOT — Architecture retenue vs proposition "1 appel/minute" (Eric)

> **Contexte** :
> - **Architecture retenue** : `sync-fixtures` daily + `sync-results` toutes les 5 min avec fenêtre intelligente.
> - **Proposition Eric** : un seul cron toutes les minutes chargeant toutes les compétitions en temps réel.

### 3.1 Ce que fait concrètement la proposition Eric

```
[Cron */1 min]
  ├─ GET /fixtures?league=X&season=Y  (pour chaque compétition active)
  ├─ upsert matches (calendrier + statuts)
  └─ si FT/AET/PEN et processed_at IS NULL → processRealMatchResult()
```

Un seul cron, une seule responsabilité, toujours actif. Séduisant par sa simplicité.

### 3.2 SWOT — Architecture retenue

| Forces ✅ | |
|-----------|---|
| Économie de quota radicale | ~75 req/jour vs 1 440 pour Eric. Plan Basic (~10$/mois) suffisant. |
| Séparation des responsabilités | Calendrier ≠ résultats. Chaque cron debuggable séparément. |
| Règle d'or de l'upsert triviale | `sync-fixtures` n'écrit jamais les scores. Aucun risque de collision. |
| Scalable multi-compétitions | 5 comps : ~80 req/jour (vs 7 200 pour Eric). |
| Cache Redis exploitable | TTL 5 min cohérent avec la fréquence du cron résultats. |

| Faiblesses ⚠️ | |
|----------------|---|
| Lag sur les reports | Jusqu'à 23h59 (détection au prochain daily). Atténuation : bouton "Sync maintenant" en admin. |
| Deux crons à maintenir | Si l'un est désactivé par erreur, le symptôme n'est pas immédiat. |
| `isMatchWindowActive()` point de défaillance | Si toujours `false`, les résultats ne syncent plus. Alerte Sentry obligatoire. |

| Opportunités 🚀 | |
|-----------------|---|
| Budget libre pour d'autres appels | Stats joueurs, classements FIFA, sans dépasser le Basic. |
| Fréquence ajustable sans coût | Passer sync-results à 2 min pendant les matchs coûte ~0 en quota hors-fenêtre. |

| Menaces 🔴 | |
|------------|---|
| Report nuitième | Joueurs voient le match comme prévu jusqu'au prochain daily. Acceptable pour une CdM. |
| Cron Vercel raté | Alerte si `last_sync_at > 26h`. |

### 3.3 SWOT — Proposition Eric

| Forces ✅ | |
|-----------|---|
| Quasi temps réel sur tout | Reports, horaires, nouveaux KO : détectés dans la minute. |
| Architecture plus simple | Un seul cron, une seule logique. |
| Meilleur pour les ligues nationales | PL, Liga : reports fréquents le week-end. |

| Faiblesses ⚠️ | |
|----------------|---|
| Coût API ×19 | 1 440 req/jour vs ~75. Plan Pro obligatoire (~40$/mois). |
| 98% des appels inutiles | Hors fenêtre de match, l'API retourne les mêmes données qu'une minute avant. |
| Scalabilité cassée à 5 compétitions | 7 200 req/jour = limite du plan Pro. |
| Règle d'or de l'upsert difficile | Un seul cron gère calendrier ET résultats. Risque de régression si mal séparé. |
| Cache Redis inutilisable | TTL < 1 min = miss permanent. |

| Menaces 🔴 | |
|------------|---|
| Rate limit per-minute | 30 req/min (Pro). OK pour 1 comp, risque avec 10+ compétitions en peak. |
| Quota épuisé = jeu arrêté | Chaque appel manuel de debug rapproche de la limite. |

### 3.4 Comparaison directe

| Critère | Retenue | Eric | Verdict |
|---------|---------|------|---------|
| Req/jour (1 comp, match day) | ~75 | 1 440 | ✅ Retenue ×19 |
| Req/jour (5 comps) | ~80 | 7 200 | ✅ Retenue ×90 |
| Plan API nécessaire | Basic ~10$/mois | Pro ~40$/mois | ✅ Retenue |
| Lag sur un report | ≤ 23h59 | < 1 min | ✅ Eric |
| Lag sur un résultat | < 5 min | < 1 min | ⚠️ Eric |
| Risque double traitement | Faible | Moyen | ✅ Retenue |
| Scalabilité | Quasi gratuite | Coût ×N | ✅ Retenue |
| Pertinence CdM (reports rares) | ✅ | Overkill | ✅ Retenue |
| Pertinence ligues nationales V2 | ⚠️ | ✅ | ✅ Eric en V2 |

### 3.5 Verdict

Eric a le bon instinct. Mais pour la CdM 2026, les reports en phase de groupes sont rarissimes (dernière occurrence : COVID 2020). La valeur temps réel d'Eric ne se matérialise presque jamais.

**Upgrade en V2 (ligues nationales)** : passer `sync-fixtures` à `*/30 * * * *`. +48 req/jour par compétition, toujours dans le plan Basic. Capture 99% des reports sans brûler le quota.

---

## 4. Suppression complète de CALENDAR et NATIONS

### 4.1 Audit des dépendances actuelles

**CALENDAR** est importé dans :

| Fichier | Usage |
|---------|-------|
| `localGameStore.ts` | `CALENDAR[dayIndex]` — jour courant, `buildMatchesForCurrentDay()` |
| `onlineGameStore.ts` | Idem |
| `ScheduleTab.tsx` | `CALENDAR.map(...)` — rendu calendrier complet |
| `BrowserShell.tsx` | `CALENDAR[dayIndex]`, `.filter(phase)`, `day.matches` |
| `SimulateTab.tsx` | `CALENDAR[dayIndex].label`, `day.phase` |

**NATIONS** est importé dans :

| Fichier | Usage |
|---------|-------|
| `localGameStore.ts` | Prix initiaux `n.p`, info équipe `n.flag`, `n.name` |
| `onlineGameStore.ts` | Idem |
| `buildKOMatches.ts` (game-engine) | `NATIONS.filter(n => n.group === g)`, `n.str` (tiebreaker) |
| `initState.ts` (game-engine) | `NATIONS.map(n => [n.id, n.p])` — initialisation des prix |
| Composants UI | `NATIONS.find(n => n.id === ...)` — flag, name |

### 4.2 Ce que l'API fournit ou permet de dériver

**Pour remplacer CALENDAR :**

| Champ | Source | Dérivation |
|-------|--------|-----------|
| Paires `a/b` | `teams.home/away.name` | `apiNameToTeamId()` |
| `venue` | `fixture.venue.name` | Direct |
| `date_label` ("Jun 11") | `fixture.fixture.date` | `formatDateLabel(date)` |
| `full_label` ("Day 1 · Thu Jun 11") | `fixture.fixture.date` + `day_index` | `buildDayLabel()` |
| `phase` ("Groups"/"R32"…) | `fixture.league.round` | `leagueRoundToPhase()` |
| `is_ko` | phase | `phase !== 'Groups'` |
| `div_key` | phase | `PHASE_TO_DIV[phase]` — règle métier KickStock, pas une donnée |

**Pour remplacer NATIONS :**

| Champ | Source | Dérivation |
|-------|--------|-----------|
| `id` ("BRA") | `teams.home.name` | `apiNameToTeamId()` |
| `name` | `teams.home.name` | Direct |
| `logo_url` | `teams.home.logo` | Direct |
| `flag_emoji` (🇧🇷) | Code ISO 2 lettres | `isoToFlagEmoji("BR")` → 🇧🇷 |
| `group` | `fixture.league.group` | Direct |
| `confederation` | Lookup country→conf | Table statique minimale (20 pays → conf) |
| **`strength` (0–100)** | ❌ Pas dans l'API | **Configurable admin, défaut 75** |
| **`initial_price` (KC)** | ❌ Mécanique de jeu | **Configurable admin par compétition** |

> `strength` et `initial_price` sont des paramètres de **game design** calculés une fois à la création de la compétition depuis le classement FIFA (ou UEFA pour les compétitions européennes). Ils peuvent être ajustés par l'admin avant le J1, puis sont figés au coup d'envoi du premier match.

### 4.3 Dérivation depuis le classement FIFA/UEFA

#### Source des données

**Option A (préférée) :** API-Football fournit les classements FIFA via `GET /teams/rankings/fifa` :
```
GET https://v3.football.api-sports.io/teams/rankings/fifa
Headers: x-rapidapi-key: {key}
```
Response : `[{ team: { id, name }, points, ranking }, ...]`

**Option B (fallback) :** CSV public FIFA téléchargeable sur `https://www.fifa.com/ranking/men/` — importé manuellement une seule fois en CSV.

Le script `seed-team-rankings.ts` tente l'option A ; si l'endpoint n'est pas disponible sur le plan souscrit, il lit le CSV en option B.

#### Formules de calcul

**`strength` (0–100) — depuis les points FIFA :**

```typescript
function calcStrength(fifaPoints: number, allParticipantPoints: number[]): number {
  const min = Math.min(...allParticipantPoints)
  const max = Math.max(...allParticipantPoints)
  // Normalisation linéaire parmi les équipes qualifiées uniquement
  const raw = ((fifaPoints - min) / (max - min)) * 35 + 60
  // → min → 60, max → 95 (les extrêmes mondiaux restent dans [60,95])
  return Math.round(Math.min(95, Math.max(60, raw)))
}
```

> Pourquoi borner entre 60 et 95 ? En deçà de 60, le moteur de simulation produit des rencontres trop déséquilibrées ; au-dessus de 95, les upsets deviennent impossibles.

**`initial_price` (KC) — tiers sur le classement FIFA :**

```typescript
function calcInitialPrice(fifaRankAmongParticipants: number): number {
  if (fifaRankAmongParticipants <= 4)  return 250   // 🔥 Grands favoris
  if (fifaRankAmongParticipants <= 12) return 200   // Favoris
  if (fifaRankAmongParticipants <= 24) return 150   // Solides
  if (fifaRankAmongParticipants <= 36) return 120   // Outsiders
  return 100                                         // Underdog
}
```

> Les prix reflètent les attentes du marché : acheter Brésil coûte 2,5× plus cher qu'un outsider. Cela crée un vrai risque/rendement.

#### Script `scripts/seed-team-rankings.ts`

```typescript
// Usage : pnpm tsx scripts/seed-team-rankings.ts --league=1 --season=2026
// Prérequis : competition + teams + competition_teams déjà insérés par sync-fixtures

async function main() {
  const { league, season } = parseArgs()

  // 1. Récupérer les équipes de la compétition en DB
  const { data: compTeams } = await supabase
    .from('competition_teams ct')
    .select('team_id, teams(api_team_id, name)')
    .eq('competition_id', getCompetitionId(league, season))

  // 2. Récupérer le classement FIFA
  const rankings = await fetchFifaRankings()   // API-Football ou CSV

  // 3. Croiser : trouver le rang FIFA de chaque équipe qualifiée
  const participants = compTeams.map(ct => {
    const rank = rankings.find(r => r.team.id === ct.teams.api_team_id)
    return { team_id: ct.team_id, points: rank?.points ?? null, name: ct.teams.name }
  })

  // 4. Reporter les non-trouvés (log warning, utiliser valeur par défaut)
  const missing = participants.filter(p => p.points === null)
  if (missing.length > 0) {
    console.warn(`⚠️  Classement FIFA introuvable : ${missing.map(m => m.name).join(', ')}`)
    console.warn('   → strength=75, initial_price=120 appliqués par défaut')
  }

  // 5. Calculer strength et initial_price
  const allPoints = participants.filter(p => p.points).map(p => p.points!)
  const ranked = [...participants].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))

  const updates = ranked.map((p, i) => ({
    team_id: p.team_id,
    strength:      p.points ? calcStrength(p.points, allPoints) : 75,
    initial_price: p.points ? calcInitialPrice(i + 1)           : 120,
  }))

  // 6. Upsert en DB
  for (const u of updates) {
    await supabase.from('teams')
      .update({ strength: u.strength }).eq('id', u.team_id)
    await supabase.from('competition_teams')
      .update({ initial_price: u.initial_price })
      .eq('team_id', u.team_id).eq('competition_id', getCompetitionId(league, season))
  }

  console.table(updates.map(u => ({
    team: u.team_id,
    strength: u.strength,
    'price (KC)': u.initial_price,
  })))
  console.log('✅ Rankings seedés. Vérifier dans l\'admin avant le J1.')
}
```

**Sortie attendue (CdM 2026) :**

```
┌─────────┬──────────┬────────────┐
│ team    │ strength │ price (KC) │
├─────────┼──────────┼────────────┤
│ FRA     │     93   │    250     │
│ BRA     │     91   │    250     │
│ ENG     │     88   │    200     │
│ ESP     │     87   │    200     │
│  …      │     …    │     …      │
│ PAN     │     63   │    100     │
│ VNM     │     61   │    100     │
└─────────┴──────────┴────────────┘
```

### 4.4 Ce qui reste dans `packages/constants`

```typescript
// packages/constants/src/index.ts — après nettoyage

export const INIT_CASH = 10_000           // ✅ Règle de jeu, pas une donnée
export const DIV_RATES = { ... }          // ✅ Règle de jeu — mais cohérent avec div_key en DB
export const SCORER_POOL = { ... }        // ✅ Cosmétique (noms de buteurs pour animation)

// ❌ SUPPRIMÉS :
// export const CALENDAR = [...]
// export const NATIONS  = [...]
// export const GROUPS   = [...]
```

`packages/constants/src/nations.ts` → **supprimé entièrement**.

---

## 5. Schéma de données — Migration `010_api_integration.sql`

### 5.1 Table `competitions`

```sql
CREATE TABLE competitions (
  id              SERIAL PRIMARY KEY,
  league_id       INTEGER NOT NULL,
  season          INTEGER NOT NULL,
  name            TEXT    NOT NULL,
  start_date      DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, season)
);

INSERT INTO competitions (league_id, season, name, start_date)
VALUES (1, 2026, 'FIFA World Cup 2026', '2026-06-11');
```

### 5.2 Table `teams` — remplace NATIONS

```sql
CREATE TABLE teams (
  id              TEXT PRIMARY KEY,          -- "BRA", "FRA" (via team-mapping)
  api_team_id     INTEGER UNIQUE,            -- ID API-Football
  name            TEXT NOT NULL,
  logo_url        TEXT,
  flag_emoji      TEXT,
  confederation   TEXT,
  strength        INTEGER NOT NULL DEFAULT 75,  -- tiebreaker + calcul upset (configurable admin)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.3 Table `competition_teams` — groupe + prix par compétition

```sql
CREATE TABLE competition_teams (
  competition_id  INTEGER NOT NULL REFERENCES competitions(id),
  team_id         TEXT    NOT NULL REFERENCES teams(id),
  group_code      TEXT,                       -- "A"…"L" (fixture.league.group)
  initial_price   INTEGER NOT NULL DEFAULT 100, -- KC (configurable admin avant J1)
  PRIMARY KEY (competition_id, team_id)
);
```

### 5.4 Table `competition_days` — remplace CALENDAR (métadonnées)

```sql
CREATE TABLE competition_days (
  id              SERIAL PRIMARY KEY,
  competition_id  INTEGER NOT NULL REFERENCES competitions(id),
  day_index       INTEGER NOT NULL,
  date_label      TEXT    NOT NULL,    -- "Jun 11"
  full_label      TEXT    NOT NULL,    -- "Day 1 · Thu Jun 11" ou "R32 · Sun Jun 28"
  phase           TEXT    NOT NULL,    -- "Groups"|"R32"|"R16"|"QF"|"SF"|"3rd"|"Final"
  is_ko           BOOLEAN NOT NULL DEFAULT FALSE,
  div_key         TEXT,               -- null|"r32"|"r16"|"qf"|"sf"|"final"
  UNIQUE (competition_id, day_index)
);
```

### 5.5 Table `matches` — fixtures (modifiée)

```sql
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS fixture_id       INTEGER UNIQUE,
  ADD COLUMN IF NOT EXISTS competition_id   INTEGER REFERENCES competitions(id),
  ADD COLUMN IF NOT EXISTS api_status       TEXT NOT NULL DEFAULT 'NS',
  ADD COLUMN IF NOT EXISTS league_round     TEXT,
  ADD COLUMN IF NOT EXISTS venue            TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trade_lock_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_matches_window
  ON matches (scheduled_at)
  WHERE processed_at IS NULL
    AND api_status NOT IN ('PST', 'SUSP', 'CANC', 'ABD');
```

### 5.6 Règle d'or de l'upsert

`sync-fixtures` ne touche **jamais** `processed_at`, `score_a`, `score_b`, `trade_lock_until`.

```sql
INSERT INTO matches (fixture_id, competition_id, nation_a, nation_b,
                     day_index, phase, league_round, venue, scheduled_at, api_status)
VALUES (...)
ON CONFLICT (fixture_id) DO UPDATE SET
  scheduled_at = EXCLUDED.scheduled_at,
  api_status   = EXCLUDED.api_status,
  league_round = EXCLUDED.league_round,
  venue        = EXCLUDED.venue;
  -- processed_at, score_a, score_b, trade_lock_until : JAMAIS touchés ici
```

---

## 6. Service API — `apps/web/lib/football-api.ts`

Toutes les fonctions sont paramétrées. Aucune valeur hardcodée.

```typescript
// Tous les fixtures d'une compétition (sync-fixtures daily) — cache Redis 1h
fetchAllFixtures(leagueId: number, season: number): Promise<ApiFixture[]>

// Fixtures FT/AET/PEN de toutes les compétitions actives (sync-results */5min) — cache 5 min
fetchFinishedFixtures(leagueIds: number[], season: number): Promise<ApiFixture[]>

// Fixtures live (optionnel, affichage score temps réel) — pas de cache
fetchLiveFixtures(leagueIds: number[]): Promise<ApiFixture[]>
```

**Cache Redis :**
- `api:fixtures:{leagueId}:{season}:{YYYY-MM-DD}` — TTL 3600 s
- `api:finished:{leagueIds_hash}:{bucket_5min}` — TTL 300 s
- En cas de 429 / 5xx : retourner le cache expiré (stale-while-revalidate).

---

## 7. Mapping équipes — `apps/web/lib/team-mapping/`

```
apps/web/lib/team-mapping/
  index.ts       ← apiNameToTeamId(apiName, leagueId): string | null
  league_1.ts    ← CdM 2026 (48 équipes)
  league_2.ts    ← LdC (V2)
  league_39.ts   ← PL  (V2)
```

```typescript
// league_1.ts
export const LEAGUE_1_MAPPING: Record<string, string> = {
  "Brazil":         "BRA",
  "France":         "FRA",
  "Korea Republic": "KOR",   // pas "South Korea"
  "IR Iran":        "IRN",   // pas "Iran"
  "Côte d'Ivoire":  "CIV",
  // ... 48 entrées
}
```

Tout fichier de mapping manquant → log Sentry + skip du fixture (jamais un crash silencieux).

---

## 8. Normalizer + dérivation — `apps/web/lib/normalizer.ts`

Ce module est le cœur de la transformation API → DB. Il produit les quatre upserts qu'effectue `sync-fixtures` pour chaque fixture.

```typescript
// Constantes de règles métier (pas des données hardcodées)
const PHASE_TO_DIV: Record<string, string | null> = {
  Groups: null, R32: 'r32', R16: 'r16',
  QF: 'qf', SF: 'sf', '3rd': null, Final: 'final',
}

// ── Dérivations depuis l'API ──────────────────────────────────────────────

function leagueRoundToPhase(round: string): string {
  if (round.startsWith('Group'))    return 'Groups'
  if (round === 'Round of 32')      return 'R32'
  if (round === 'Round of 16')      return 'R16'
  if (round === 'Quarter-finals')   return 'QF'
  if (round === 'Semi-finals')      return 'SF'
  if (round === '3rd Place Final')  return '3rd'
  if (round === 'Final')            return 'Final'
  return round
}

function buildDayLabel(dayIndex: number, fixtureDate: string, phase: string): string {
  const d = new Date(fixtureDate)
  const tz = 'America/New_York'
  const dow  = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })
  const mday = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })
  return phase === 'Groups'
    ? `Day ${dayIndex + 1} · ${dow} ${mday}`   // "Day 1 · Thu Jun 11"
    : `${phase} · ${dow} ${mday}`               // "R32 · Sun Jun 28"
}

function isoToFlagEmoji(iso2: string): string {
  // Algorithme Unicode : Regional Indicator Symbols
  return [...iso2.toUpperCase()].map(c =>
    String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
  ).join('')
}

function extractIsoFromLogoUrl(logoUrl: string): string | null {
  // L'API fournit des URLs comme https://media.api-sports.io/flags/br.svg
  const match = logoUrl.match(/\/flags\/([a-z]{2})\.svg/)
  return match ? match[1].toUpperCase() : null
}

// ── Sortie normalisée pour les 4 tables ──────────────────────────────────

export interface NormalizedFixture {
  teamA: TeamRow
  teamB: TeamRow
  compTeamA: CompetitionTeamRow
  compTeamB: CompetitionTeamRow
  day: CompetitionDayRow
  match: MatchRow
}

export function normalizeFixture(
  fixture: ApiFixture,
  competition: Competition
): NormalizedFixture | null {

  const idA = apiNameToTeamId(fixture.teams.home.name, competition.league_id)
  const idB = apiNameToTeamId(fixture.teams.away.name, competition.league_id)
  if (!idA || !idB) return null

  const phase    = leagueRoundToPhase(fixture.league.round)
  const dayIndex = calcDayIndex(fixture.fixture.date, competition.start_date)
  const isoA     = extractIsoFromLogoUrl(fixture.teams.home.logo ?? '')
  const isoB     = extractIsoFromLogoUrl(fixture.teams.away.logo ?? '')

  return {
    teamA: {
      id: idA, api_team_id: fixture.teams.home.id,
      name: fixture.teams.home.name, logo_url: fixture.teams.home.logo,
      flag_emoji: isoA ? isoToFlagEmoji(isoA) : null,
    },
    teamB: {
      id: idB, api_team_id: fixture.teams.away.id,
      name: fixture.teams.away.name, logo_url: fixture.teams.away.logo,
      flag_emoji: isoB ? isoToFlagEmoji(isoB) : null,
    },
    compTeamA: {
      competition_id: competition.id, team_id: idA,
      group_code: fixture.league.group ?? null,
    },
    compTeamB: {
      competition_id: competition.id, team_id: idB,
      group_code: fixture.league.group ?? null,
    },
    day: {
      competition_id: competition.id, day_index: dayIndex,
      date_label: formatDateLabel(fixture.fixture.date),
      full_label: buildDayLabel(dayIndex, fixture.fixture.date, phase),
      phase, is_ko: phase !== 'Groups',
      div_key: PHASE_TO_DIV[phase] ?? null,
    },
    match: {
      fixture_id: fixture.fixture.id, competition_id: competition.id,
      nation_a: idA, nation_b: idB, day_index: dayIndex,
      phase, league_round: fixture.league.round,
      venue: fixture.fixture.venue?.name ?? null,
      scheduled_at: fixture.fixture.date,
      api_status: fixture.fixture.status.short,
    },
  }
}

function calcDayIndex(fixtureDate: string, startDate: string): number {
  const start = new Date(startDate + 'T00:00:00-05:00')  // America/New_York (UTC-5 hors DST)
  const match = new Date(fixtureDate)
  return Math.floor((match.getTime() - start.getTime()) / 86_400_000)
}
```

---

## 9. Cron `sync-fixtures` — `apps/web/app/api/cron/sync-fixtures/route.ts`

```typescript
export async function GET(req: Request) {
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: competitions } = await supabase
    .from('competitions').select('*').eq('is_active', true)

  const results = []

  for (const comp of competitions ?? []) {
    try {
      const fixtures = await fetchAllFixtures(comp.league_id, comp.season)
      let upserted = 0, skipped = 0

      for (const fixture of fixtures) {
        const normalized = normalizeFixture(fixture, comp)
        if (!normalized) { skipped++; continue }

        const { teamA, teamB, compTeamA, compTeamB, day, match } = normalized

        // 1. Teams (auto-découverte — ne touche pas strength ni initial_price)
        await supabase.from('teams').upsert(
          [teamA, teamB],
          { onConflict: 'id', ignoreDuplicates: false }
        )
        // N'écrase PAS strength — déjà configuré par l'admin
        // → La clause DO UPDATE ici n'inclut PAS strength

        // 2. Competition_teams (groupe uniquement — ne touche pas initial_price)
        await supabase.from('competition_teams').upsert(
          [compTeamA, compTeamB],
          { onConflict: 'competition_id,team_id', ignoreDuplicates: false }
        )

        // 3. Competition_days (métadonnées du jour)
        await supabase.from('competition_days').upsert(day, {
          onConflict: 'competition_id,day_index', ignoreDuplicates: false,
        })

        // 4. Match (ne touche JAMAIS processed_at, score_a, score_b)
        await supabase.from('matches').upsert(match, {
          onConflict: 'fixture_id', ignoreDuplicates: false,
        })

        upserted++
      }

      await supabase.from('competitions')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', comp.id)

      results.push({ competition: comp.name, upserted, skipped })
    } catch (err) {
      Sentry.captureException(err, { extra: { competition: comp.name } })
      results.push({ competition: comp.name, error: String(err) })
    }
  }

  return Response.json({ results })
}
```

**Comportement des upserts selon les situations :**

| Situation | teams | competition_teams | competition_days | matches |
|-----------|-------|------------------|-----------------|---------|
| Nouveau fixture | Insère | Insère | Insère | Insère |
| Match reporté (PST) | Inchangé | Inchangé | Inchangé | `scheduled_at` + `api_status` mis à jour |
| Nouveau fixture KO | Insère équipes si inconnues | Insère | Insère | Insère |
| Match déjà traité (FT) | Inchangé | Inchangé | Inchangé | `scheduled_at`, `api_status` mis à jour — `processed_at` intact |
| Admin a changé `strength` | **Intact** (non écrasé) | **Intact** | — | — |

---

## 10. Cron `sync-results` — `apps/web/app/api/cron/sync-results/route.ts`

```typescript
export async function GET(req: Request) {
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: competitions } = await supabase
    .from('competitions').select('id, league_id, season').eq('is_active', true)

  const compIds   = competitions?.map(c => c.id)        ?? []
  const leagueIds = competitions?.map(c => c.league_id) ?? []
  const season    = competitions?.[0]?.season ?? new Date().getFullYear()

  if (!(await isMatchWindowActive(compIds))) {
    return Response.json({ skipped: true, reason: 'no active match window' })
  }

  const finished = await fetchFinishedFixtures(leagueIds, season)
  let processed = 0

  for (const fixture of finished) {
    await processRealMatchResult(fixture.fixture.id, fixture)
    processed++
  }

  for (const comp of competitions ?? []) {
    await checkAndAdvancePhase(comp.id)
  }

  return Response.json({ processed, total: finished.length })
}
```

**`isMatchWindowActive()` :**

```typescript
export async function isMatchWindowActive(competitionIds: number[]): Promise<boolean> {
  const now   = new Date()
  const start = new Date(+now - 2.5 * 3_600_000)
  const end   = new Date(+now + 2.5 * 3_600_000)

  const { count } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('competition_id', competitionIds)
    .is('processed_at', null)
    .not('api_status', 'in', '("PST","SUSP","CANC","ABD")')
    .gte('scheduled_at', start.toISOString())
    .lte('scheduled_at', end.toISOString())

  return (count ?? 0) > 0
}
```

---

## 11. Traitement des résultats — `apps/web/lib/process-real-result.ts`

### 11.1 `processRealMatchResult`

```typescript
export async function processRealMatchResult(
  fixtureId: number, fixture: ApiFixture
): Promise<void> {

  // 1. Idempotence
  const { data: match } = await supabase
    .from('matches')
    .select('id, processed_at, competition_id, nation_a, nation_b, phase, day_index')
    .eq('fixture_id', fixtureId).single()
  if (!match || match.processed_at !== null) return

  // 2. Récupérer strength depuis teams DB (plus depuis NATIONS hardcodé)
  const [teamA, teamB] = await getTeamsMeta([match.nation_a, match.nation_b])
  const [pA, pB]       = await getCurrentPrices(match.nation_a, match.nation_b)

  // 3. Résultat et upset
  const res      = determineResult(fixture)
  const is_upset = detectUpset(res, teamA.strength, teamB.strength)

  // 4. Nouveaux prix (game-engine, inchangé)
  const { newPA, newPB } = applyResult(pA, pB, res)

  // 5. Prix en DB
  await supabase.rpc('update_prices_after_match', {
    p_nation_a: match.nation_a, p_new_price_a: newPA,
    p_nation_b: match.nation_b, p_new_price_b: newPB,
    p_day_index: match.day_index,
  })

  // 6. Standings (groupes) ou liquidation (KO)
  if (match.phase === 'Groups') {
    await recalculateGroupStandings(match.competition_id)
  } else {
    const loserId = res === 'A' ? match.nation_b : match.nation_a
    await supabase.rpc('liquidate_eliminated', { p_nation_id: loserId, p_day_index: match.day_index })
  }

  // 7. Dividendes
  const dayMeta = await getCompetitionDay(match.competition_id, match.day_index)
  if (dayMeta?.div_key) {
    const winnerId = res === 'A' ? match.nation_a : match.nation_b
    await supabase.rpc('distribute_dividends', {
      p_nation_id: winnerId, p_round: dayMeta.div_key,
      p_price: Math.max(newPA, newPB), p_day_index: match.day_index,
    })
  }

  // 8. Finaliser
  const now = new Date()
  await supabase.from('matches').update({
    score_a: fixture.goals.home, score_b: fixture.goals.away,
    result_data: buildResultData(fixture),
    is_upset, played_at: fixture.fixture.date,
    processed_at: now.toISOString(),
    trade_lock_until: new Date(+now + 15 * 60_000).toISOString(),
    api_status: fixture.fixture.status.short,
  }).eq('fixture_id', fixtureId)

  // 9. game_state
  await updateGameState(match.competition_id, match.phase, res, match.nation_a, match.nation_b)
}
```

### 11.2 Trading lock dans la RPC `execute_trade`

```sql
IF EXISTS (
  SELECT 1 FROM matches
  WHERE (nation_a = p_nation_id OR nation_b = p_nation_id)
    AND api_status NOT IN ('PST', 'SUSP', 'CANC', 'ABD')
    AND scheduled_at  <= NOW() + INTERVAL '5 minutes'
    AND (processed_at IS NULL OR trade_lock_until > NOW())
) THEN
  RAISE EXCEPTION 'TRADE_LOCKED';
END IF;
```

### 11.3 `checkAndAdvancePhase`

```typescript
export async function checkAndAdvancePhase(competitionId: number): Promise<void> {
  const gameState = await getGameState(competitionId)
  const dayIndex  = gameState.current_day_index

  const { count: pending } = await supabase
    .from('matches').select('id', { count: 'exact', head: true })
    .eq('competition_id', competitionId).eq('day_index', dayIndex)
    .is('processed_at', null).not('api_status', 'in', '("PST","SUSP","CANC","ABD")')

  if ((pending ?? 1) > 0) return

  await supabase.from('game_state')
    .update({ current_day_index: dayIndex + 1 })
    .eq('competition_id', competitionId)

  // Dernier jour de groupes → pools KO
  // (les fixtures KO seront insérés par le prochain sync-fixtures daily)
  const isLastGroupDay = await isLastDayOfGroupStage(competitionId, dayIndex)
  if (isLastGroupDay) {
    const groupResults = await getAllGroupResults(competitionId)
    // groupResults ← depuis la table group_standings (plus depuis NATIONS hardcodé)
    const r32Pool = buildR32Pool(groupResults, gameState.eliminated)
    await saveKOPools(competitionId, r32Pool)
  }
}
```

---

## 12. Adaptation du game-engine (suppression des imports constants)

Le game-engine ne doit plus importer depuis `@kickstock/constants`. Les données sont injectées.

### `buildKOMatches.ts` — avant / après

```typescript
// AVANT
import { NATIONS, GROUPS } from '@kickstock/constants'

export function deriveGroupStandings(matchResults, eliminated) {
  for (const g of GROUPS) {
    gs[g] = NATIONS.filter(n => n.group === g).map(n => ({ str: n.str, ... }))
  }
}

// APRÈS — données injectées depuis la DB
export interface TeamMeta { id: string; group: string; strength: number }

export function deriveGroupStandings(
  matchResults: Record<number, StoredMatchResult[]>,
  eliminated: string[],
  teams: TeamMeta[]             // ← depuis competition_teams JOIN teams en DB
): Record<string, string[]> {
  const groups = [...new Set(teams.map(t => t.group).filter(Boolean))]
  for (const g of groups) {
    gs[g] = teams.filter(t => t.group === g).map(t => ({ id: t.id, str: t.strength, ... }))
  }
}
```

### `initState.ts` — avant / après

```typescript
// AVANT
import { NATIONS, INIT_CASH } from '@kickstock/constants'
export function initState(): GameState {
  return { prices: Object.fromEntries(NATIONS.map(n => [n.id, n.p])), ... }
}

// APRÈS
import { INIT_CASH } from '@kickstock/constants'   // INIT_CASH reste (règle de jeu)
export function initState(
  teams: Array<{ id: string; initialPrice: number }>  // ← depuis competition_teams DB
): GameState {
  return {
    cash: INIT_CASH,
    prices:       Object.fromEntries(teams.map(t => [t.id, t.initialPrice])),
    priceHistory: Object.fromEntries(teams.map(t => [t.id, [t.initialPrice]])),
    ...
  }
}
```

---

## 13. Mode offline — bootstrap depuis l'API

Le mode offline (`localGameStore`) utilisait CALENDAR et NATIONS directement. Avec leur suppression, il charge ces données **une fois** depuis un endpoint dédié.

### 13.1 Nouvel endpoint `GET /api/competition/bootstrap`

```typescript
// Retourne tout ce dont le mode offline a besoin pour fonctionner
{
  competition: { id, name, start_date, league_id, season },
  teams: [{ id, name, flag_emoji, group_code, strength, initial_price }],
  days:  [{ day_index, full_label, phase, is_ko, div_key }],
  group_fixtures: [{ day_index, nation_a, nation_b, venue }]
  // KO fixtures non inclus : inconnus jusqu'à la fin des groupes
}
```

### 13.2 Cache localStorage

```typescript
const BOOTSTRAP_KEY = 'kickstock:bootstrap:v1'
const BOOTSTRAP_TTL = 24 * 60 * 60 * 1000  // 1 jour

async function getBootstrap(): Promise<Bootstrap> {
  const cached = localStorage.getItem(BOOTSTRAP_KEY)
  if (cached) {
    const { data, fetchedAt } = JSON.parse(cached)
    if (Date.now() - fetchedAt < BOOTSTRAP_TTL) return data
  }
  const fresh = await fetch('/api/competition/bootstrap').then(r => r.json())
  localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify({ data: fresh, fetchedAt: Date.now() }))
  return fresh
}
```

### 13.3 Initialisation du localGameStore

```typescript
// AVANT
const store = initState()   // utilisait NATIONS directement

// APRÈS
const bootstrap = await getBootstrap()
const store = initState(bootstrap.teams)   // injecté depuis DB/API
```

Le mode offline fonctionne ensuite **exactement comme aujourd'hui** — simulation aléatoire, bouton Play, progression par journée — mais alimenté par des données réelles.

---

## 14. `vercel.json`

```json
{
  "crons": [
    { "path": "/api/cron/sync-fixtures", "schedule": "0 6 * * *" },
    { "path": "/api/cron/sync-results",  "schedule": "*/30 * * * *" }
  ]
}
```

**Budget API — Plan Free (~100 req/jour) :**

| Scénario | sync-fixtures/j | sync-results/j | Total | Plan Free OK? |
|----------|----------------|----------------|-------|---------------|
| Hors compétition | 1 | 0 | **1** | ✅ |
| Journée groupes (4 matchs, ~6h fenêtres actives) | 1 | ~12 | **13** | ✅ |
| Journée KO (2 matchs, ~5h) | 1 | ~10 | **11** | ✅ |
| CdM + LdC simultanées | 2 | ~12 | **14** | ✅ |

> **Note :** La granularité passe à 30 min au lieu de 5 min.
> Un but marqué à 87' ne se reflètera dans les prix qu'au prochain tick (max 30 min d'attente).
> Acceptable pour un MVP — monter à 5 min quand le plan Basic (~10$/mois) sera souscrit.

**Upgrade futur (plan Basic) :** changer `*/30` en `*/5` dans `vercel.json` + ajuster le bucket Redis de 1800s → 300s dans `football-api.ts`.

---

## 15. Panneau admin — `apps/web/app/admin/page.tsx`

Accès protégé par service role key. Fonctions clés :

```
┌────────────────────────────────────────────────────────┐
│  COMPÉTITIONS                                          │
│  FIFA World Cup 2026 · is_active ✓                    │
│  last_sync: 2026-06-10 06:00 UTC                      │
│  [Sync fixtures maintenant]  [Désactiver]             │
│  [+ Ajouter une compétition]                          │
├────────────────────────────────────────────────────────┤
│  ÉQUIPES (CdM 2026)                                   │
│  Rankings seedés le 2026-05-15 (classement FIFA mai)  │
│  [Re-seed depuis FIFA rankings]                       │
│                                                       │
│  BRA  🇧🇷 Brazil  #1 FIFA  str:[91]  price:[250 KC]  │
│  FRA  🇫🇷 France  #2 FIFA  str:[93]  price:[250 KC]  │
│  PAN  🇵🇦 Panama  #45 FIFA str:[63]  price:[100 KC]  │
│  ← Valeurs calculées depuis FIFA, modifiables avant J1│
│    [Modifier] → ouvre une modal d'override            │
├────────────────────────────────────────────────────────┤
│  MATCHS DU JOUR                                       │
│  [Sync résultats maintenant]                          │
│  OVERRIDE MANUEL : fixture_id [___] score [_]-[_]    │
│  [Forcer le traitement]                               │
├────────────────────────────────────────────────────────┤
│  LOGS  · [Bootstrap offline cache]                    │
└────────────────────────────────────────────────────────┘
```

**Flux de création d'une compétition :**
1. `INSERT INTO competitions (league_id, season, …)` — via le formulaire admin
2. `[Sync fixtures]` → popule `teams`, `competition_teams`, `competition_days`, `matches`
3. `[Seed rankings FIFA]` → appelle `seed-team-rankings.ts` → `strength` + `initial_price` calculés
4. Révision manuelle optionnelle (modal d'override équipe par équipe)
5. Vérification checklist → go/no-go J1

---

## 16. Tests et validation

### 16.1 Ce que la saison 2022 valide

| Ce que 2022 valide | Ce que 2022 ne valide PAS |
|-------------------|--------------------------|
| ✅ Pipeline API → normalizer → DB | ❌ Mapping 48 équipes 2026 (32 en 2022) |
| ✅ Upsert idempotent | ❌ Round of 32 (inexistant en 2022) |
| ✅ `competition_days` générés | ❌ Fuseaux horaires USA (Qatar en 2022) |
| ✅ `teams` auto-découverts | ❌ Noms équipes 2026 potentiellement différents |
| ✅ `processRealMatchResult` | |
| ✅ Trading lock lifecycle | |

### 16.2 Script de validation mapping

```bash
pnpm tsx scripts/validate-team-mapping.ts --league=1 --season=2026
# Appelle l'API, liste toutes les équipes, vérifie contre league_1.ts
# Affiche : ✅ 47 OK  ❌ 1 manquante : "Ivory Coast" (→ ajouter "Côte d'Ivoire")
```

### 16.3 Checklist pré-lancement (avant le 11 juin 2026)

- [ ] `competitions` contient `(league_id=1, season=2026, is_active=true, start_date='2026-06-11')`
- [ ] Déclencher `sync-fixtures` manuellement → vérifier tables `teams`, `competition_teams`, `competition_days`, `matches` remplies
- [ ] `validate-team-mapping.ts` → 48/48 OK
- [ ] Exécuter `seed-team-rankings.ts --league=1 --season=2026` → vérifier sortie : 48/48 équipes seedées, 0 "classement introuvable"
- [ ] Réviser les valeurs `strength` / `initial_price` dans l'admin si nécessaire (équipes mal classées, considerations game design) — modifiables jusqu'au J1
- [ ] `GET /api/competition/bootstrap` → réponse complète (48 teams, 34 days, group fixtures)
- [ ] Tester le bootstrap offline : cache localStorage rempli, `initState(teams)` fonctionne
- [ ] `sync-results` répond `{ skipped: true }` (pas de fenêtre active avant le 11 juin)
- [ ] Simuler un report : `api_status='PST'` → `isMatchWindowActive()` l'exclut
- [ ] Trading lock : `execute_trade` retourne `TRADE_LOCKED` dans la fenêtre
- [ ] Panneau admin : sync manuel, override, configuration équipes
- [ ] `NEXT_PUBLIC_OFFLINE_MODE` supprimée des env Vercel

---

## 17. UI/UX — Sélection Online / Offline

### 17.1 Principe

> **Online est le mode par défaut.** Offline est un sandbox accessible depuis le menu compte.

Le mode est une préférence `localStorage('kickstock:mode')`. Plus d'env var de build.

### 17.2 Indicateur permanent + point d'entrée

**Mobile header :** `⚡ LIVE` (vert pulsant) ou `🎲 SIMU` (gris). Cliquable.

**Menu compte (`AccountMenu`) :**
```
│  🎲  Jouer en simulation →  │   ← si online
│  ⚡  Retour au mode Live →  │   ← si offline
```

### 17.3 Interface selon le mode

**Online :**
- BottomNav : `[Market] [Fixtures] [⚡LIVE] [Portfolio] [Table]` — FAB Play remplacé par onglet LIVE
- LiveTab : matchs du jour avec statuts NS/En cours/FT, score en direct, animations auto sur FT
- Pas de bouton Simuler

**Offline :**
- Interface identique à aujourd'hui (FAB Play, SimulateTab, progression journalière)
- Badge "SIMULATION" permanent
- Aucun trading lock

### 17.4 Trading lock dans l'UI (online uniquement)

```
🇧🇷 BRÉSIL    200 KC  [🔒 -18min]    ← 18 min avant coup d'envoi
🇭🇷 CROATIE   185 KC  [🔒 EN JEU]    ← match en cours
🇫🇷 FRANCE    220 KC  [ACHETER]      ← tradable (ne joue pas ce match)
```

TradeModal bloquée si nation lockée. Lock chirurgical : uniquement les deux nations qui jouent.

### 17.5 Hook `useGameMode`

```typescript
export function useGameMode() {
  const [mode, setMode] = useState<'online' | 'offline'>(() =>
    (typeof window !== 'undefined'
      ? (localStorage.getItem('kickstock:mode') as 'online' | 'offline')
      : null) ?? 'online'
  )
  function switchMode(next: 'online' | 'offline') {
    localStorage.setItem('kickstock:mode', next)
    window.location.reload()   // intentionnel : évite les bugs de hooks conditionnels
  }
  return { mode, switchMode }
}
```

---

## 18. Fichiers à créer / modifier / supprimer

### Nouveaux fichiers
```
apps/web/lib/football-api.ts                     # Service API (paramétré)
apps/web/lib/normalizer.ts                       # ApiFixture → 4 tables DB
apps/web/lib/match-window.ts                     # isMatchWindowActive()
apps/web/lib/process-real-result.ts              # processRealMatchResult + checkAndAdvancePhase
apps/web/lib/team-mapping/index.ts               # apiNameToTeamId()
apps/web/lib/team-mapping/league_1.ts            # 48 équipes CdM 2026
apps/web/app/api/cron/sync-fixtures/route.ts     # Cron daily
apps/web/app/api/cron/sync-results/route.ts      # Cron */5 min
apps/web/app/api/competition/bootstrap/route.ts  # Endpoint offline
apps/web/app/admin/page.tsx                      # Panneau admin
apps/web/hooks/useGameMode.ts                    # Switch online/offline
apps/web/contexts/GameModeContext.tsx            # Context React mode
apps/web/components/mobile/LiveTab.tsx           # Remplace SimulateTab en online
scripts/validate-team-mapping.ts                 # Validation pré-lancement
scripts/seed-team-rankings.ts                    # One-off : FIFA rankings → strength + initial_price
scripts/test-pipeline.ts                         # Test end-to-end sur 2022
db/migrations/010_api_integration.sql            # competitions, teams, competition_teams,
                                                 # competition_days, colonnes matches
vercel.json                                      # Deux crons
```

### Fichiers modifiés
```
packages/game-engine/src/buildKOMatches.ts    # TeamMeta injecté (suppression import NATIONS)
packages/game-engine/src/initState.ts         # teams[] injecté (suppression import NATIONS)
apps/web/stores/localGameStore.ts             # Bootstrap async, plus d'import CALENDAR/NATIONS
apps/web/stores/onlineGameStore.ts            # Idem
apps/web/stores/gameStore.ts                 # Switch dynamique online/offline
apps/web/components/shared/AuthWidget.tsx    # Entrée menu mode
apps/web/components/mobile/BottomNav.tsx     # FAB → onglet LIVE en online
apps/web/components/mobile/MobileShell.tsx   # Badge mode
apps/web/components/browser/BrowserShell.tsx # Lecture competition_days + matches DB
apps/web/components/mobile/ScheduleTab.tsx   # Idem
apps/web/components/shared/TradeModal.tsx    # État bloqué si lock
apps/web/components/mobile/MarketTab.tsx     # Badge lock sur équipes
apps/web/app/api/game/state/route.ts         # Exposer trade_lock_until
apps/web/.env.local.example                  # + API_FOOTBALL_KEY, CRON_SECRET
```

### Fichiers supprimés
```
packages/constants/src/nations.ts            # ❌ Remplacé par table teams DB
```

### Fichiers modifiés dans constants (pas supprimés)
```
packages/constants/src/index.ts :
  ❌ CALENDAR  supprimé
  ❌ NATIONS   supprimé
  ❌ GROUPS    supprimé
  ✅ INIT_CASH conservé (règle de jeu)
  ✅ DIV_RATES conservé (règle de jeu)
  ✅ SCORER_POOL conservé (cosmétique)
```

---

## 19. Calendrier réaliste

| Semaine | Travail |
|---------|---------|
| **S1** | Compte RapidAPI, env vars, structure DB (`010` migration), tables `competitions/teams/competition_teams/competition_days` |
| **S1–S2** | `football-api.ts`, `normalizer.ts`, `team-mapping/league_1.ts`, `validate-team-mapping.ts`, `seed-team-rankings.ts` |
| **S2** | `sync-fixtures` cron — test sur saison 2022, vérifier les 4 tables peuplées |
| **S3** | `processRealMatchResult`, `checkAndAdvancePhase`, trading lock RPC |
| **S3–S4** | `sync-results` cron, `isMatchWindowActive`, `/api/competition/bootstrap` |
| **S4** | Refacto game-engine (injecter TeamMeta au lieu d'importer NATIONS), localGameStore bootstrap |
| **S4–S5** | Frontend : mode switch, LiveTab, lock UI, suppression imports CALENDAR/NATIONS dans composants |
| **S5** | Tests, panneau admin, `validate-team-mapping` 2026, checklist pré-lancement |
| **J−7** | Sync-fixtures CdM 2026, configuration strength + prix dans admin, go/no-go |

---

## 20. Risques

| Risque | Proba | Impact | Mitigation |
|--------|-------|--------|------------|
| Mapping équipe manquant en prod | Haute | Critique | `validate-team-mapping.ts` avant lancement ; alerte Sentry sur chaque skip |
| `sync-fixtures` écrase `processed_at` | Critique | Critique | Clause `DO UPDATE` explicite ; test d'intégration dédié |
| `strength`/`initial_price` non seedés avant J1 | Faible | Élevé | `seed-team-rankings.ts` fait partie de la checklist pré-lancement ; alerte admin si >10% des équipes ont encore les valeurs par défaut (75/120KC) à J−1 |
| Endpoint FIFA rankings indisponible (plan API trop bas) | Moyenne | Faible | Fallback CSV FIFA public — script détecte l'erreur 403 et bascule automatiquement ; classement FIFA publié mensuellement et téléchargeable librement |
| Game-engine reçoit `teams[]` vide au démarrage | Moyenne | Critique | Bootstrap renvoie une erreur explicite si `competition_teams` est vide |
| Bootstrap offline non rafraîchi → fixtures périmés | Faible | Faible | TTL 24h + version hash ; bouton "Rafraîchir le cache" en mode offline |
| `isMatchWindowActive()` toujours false | Faible | Critique | Alerte Sentry si 0 sync pendant >3h avec match prévu en DB |
| `sync-fixtures` rate son cron (report non détecté) | Faible | Moyen | Alerte si `last_sync_at > 26h` ; bouton admin "Sync maintenant" |
| Trading lock jamais levé | Faible | Élevé | Test : `trade_lock_until = processed_at + 15 min` systématiquement vérifiée |
| Noms équipes 2026 ≠ 2022 | Certaine | Moyen | Valider le mapping sur fixtures 2026 dès publication, pas sur 2022 |
| Fuseau horaire → day_index décalé | Moyenne | Élevé | `start_date` en UTC-5 ; tester les cas limites (match à 00h00 local) |
