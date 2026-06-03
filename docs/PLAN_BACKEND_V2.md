# Plan Backend — Football Game
> Version finale validée · Next.js 14 App Router · Supabase · Vercel · Redis Upstash

---

## Sommaire

1. [Stack & Architecture](#1-stack--architecture)
2. [Variables d'environnement](#2-variables-denvironnement)
3. [Base de données PostgreSQL](#3-base-de-données-postgresql)
4. [Authentification anonyme](#4-authentification-anonyme)
5. [Structure des routes API](#5-structure-des-routes-api)
6. [Service API-Football + Cache Redis](#6-service-api-football--cache-redis)
7. [Cron `sync-fixtures` — quotidien](#7-cron-sync-fixtures--quotidien)
8. [Cron `sync-results` — toutes les 5 minutes](#8-cron-sync-results--toutes-les-5-minutes)
9. [Moteur de jeu backend](#9-moteur-de-jeu-backend)
10. [Rate Limiting sur `/api/trade`](#10-rate-limiting-sur-apitrade)
11. [Endpoints API — détail complet](#11-endpoints-api--détail-complet)
12. [Middleware Next.js](#12-middleware-nextjs)
13. [Tests](#13-tests)
14. [Documentation](#14-documentation)

---

## 1. Stack & Architecture

### Stack retenue

| Couche | Technologie |
|--------|-------------|
| Framework | **Next.js 14 App Router** (serverless) |
| Déploiement | **Vercel** |
| Base de données | **Supabase** (PostgreSQL managé) |
| Client DB | **Supabase JS SDK** uniquement — pas de connexion `pg` directe |
| Cache | **Upstash Redis** (serverless REST) |
| Auth | **Supabase Auth** (session anonyme → cookie HttpOnly) |
| Monitoring | **Sentry** |
| Crons | **Vercel Cron Jobs** (déclarés dans `vercel.json`) |

### Structure des dossiers

```
apps/web/
├── app/
│   └── api/
│       ├── health/route.ts
│       ├── auth/
│       │   └── session/route.ts
│       ├── trade/route.ts
│       ├── market/route.ts
│       ├── matches/route.ts
│       ├── game/
│       │   ├── state/route.ts
│       │   ├── advance/route.ts
│       │   └── live-matches/route.ts
│       ├── competition/
│       │   ├── bootstrap/route.ts
│       │   └── list/route.ts
│       └── cron/
│           ├── sync-fixtures/route.ts
│           └── sync-results/route.ts
├── lib/
│   ├── football-api.ts
│   ├── redis.ts
│   ├── match-window.ts
│   ├── process-real-result.ts
│   ├── check-advance-phase.ts
│   ├── ko-qualifiers.ts
│   ├── normalizer.ts
│   ├── rate-limit.ts
│   └── supabase/
│       ├── client.ts
│       ├── server.ts
│       └── admin.ts
└── middleware.ts
```

### Principes généraux

- Chaque route API est un fichier `route.ts` avec `export async function GET/POST`.
- `export const dynamic = 'force-dynamic'` sur toutes les routes qui lisent des données fraîches.
- Les opérations critiques (trade, liquidation, dividendes) sont déléguées à des **RPCs Supabase `SECURITY DEFINER`** — la logique métier est exécutée côté base de données avec des verrous `FOR UPDATE`.
- Toute erreur inattendue est capturée par **Sentry**.
- Les crons sont sécurisés par `Authorization: Bearer {CRON_SECRET}`.

---

## 2. Variables d'environnement

### Fichier `.env.local`

```env
# ── Supabase ─────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# ── API-Football (RapidAPI) ──────────────────────────────────────────────────
API_FOOTBALL_KEY=your_rapidapi_key
API_FOOTBALL_HOST=v3.football.api-sports.io

# ── Redis (Upstash) ──────────────────────────────────────────────────────────
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token

# ── Cron ─────────────────────────────────────────────────────────────────────
CRON_SECRET=a_secure_random_string

# ── Sentry ───────────────────────────────────────────────────────────────────
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

### `.env.example` (à committer, valeurs vides)

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
API_FOOTBALL_KEY=
API_FOOTBALL_HOST=v3.football.api-sports.io
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
CRON_SECRET=
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
```

> **Note :** `DATABASE_URL` n'est **pas utilisée**. Toutes les interactions avec la base passent exclusivement par le SDK Supabase JS.

---

## 3. Base de données PostgreSQL

### Création

Utiliser un projet **Supabase** (cloud ou local via `supabase start`).  
Appliquer les migrations SQL dans l'ordre numéroté depuis `db/migrations/`.

### Tables principales

| Table | Rôle |
|-------|------|
| `competitions` | Compétitions (`is_active`, `league_id`, `season`, `last_sync_at`) |
| `teams` | Équipes nationales (`id`, `name`, `flag_emoji`, `logo_url`, `strength`, `confederation`) |
| `competition_teams` | Liaison équipe ↔ compétition (`group_code`, `initial_price`, `current_price`) |
| `competition_days` | Journées du calendrier (`day_index`, `phase`, `is_ko`, `div_key`) |
| `matches` | Matchs (`fixture_id`, `nation_a`, `nation_b`, `scheduled_at`, `api_status`, `processed_at`, `trade_lock_until`, `result_data` JSONB) |
| `competition_game_state` | État global par compétition (pools KO, `eliminated[]`, `champion_id`, `advancing` — verrou CAS) |
| `competition_prices` | Historique des prix indexé par `day_index` |
| `portfolios` | Portefeuille joueur (`cash`, `avg_cost` JSONB, `tx_log` JSONB, `best_score`) |
| `holdings` | Positions joueur par équipe et compétition (`quantity`) |
| `transactions` | Audit log immuable des trades |

### Index à créer

```sql
CREATE INDEX idx_matches_competition_id     ON matches(competition_id);
CREATE INDEX idx_matches_day_index          ON matches(day_index);
CREATE INDEX idx_matches_scheduled_at       ON matches(scheduled_at);
CREATE INDEX idx_matches_processed_at       ON matches(processed_at);
CREATE INDEX idx_holdings_portfolio_id      ON holdings(portfolio_id);
CREATE INDEX idx_transactions_portfolio_id  ON transactions(portfolio_id);
CREATE INDEX idx_comp_prices_competition_id ON competition_prices(competition_id);
```

### RPCs `SECURITY DEFINER`

Fonctions SQL exécutées côté DB avec verrous `FOR UPDATE` — impossibles à contourner depuis le client :

| RPC | Rôle |
|-----|------|
| `execute_competition_trade` | Achat / vente atomique avec vérifications métier |
| `liquidate_competition_eliminated` | Liquide toutes les positions d'une équipe éliminée à 1 KC |
| `distribute_competition_dividends` | Crédite les dividendes sur les portefeuilles des détenteurs |
| `update_competition_prices` | Met à jour les prix courants + insère dans l'historique |
| `upsert_fixture` | Upsert de match sans jamais toucher `processed_at` / scores |
| `get_or_create_competition_portfolio` | Crée le portefeuille si inexistant, retourne son ID |

### Clients Supabase

Trois clients distincts selon le contexte :

```
lib/supabase/client.ts   → Client navigateur (clé anon, RLS activé)
lib/supabase/server.ts   → Client serveur (lit les cookies de session)
lib/supabase/admin.ts    → Client service_role (crons, RPCs — bypasse RLS)
```

---

## 4. Authentification anonyme

### Principe

L'authentification repose sur **Supabase Auth** en mode anonyme. Le frontend n'a pas à gérer de token manuellement : le serveur crée la session, pose un cookie `HttpOnly`, et le navigateur l'envoie automatiquement à chaque requête (`credentials: 'include'`).

### Endpoint `POST /api/auth/session`

**Fonctionnement :**
1. Appeler `supabase.auth.signInAnonymously()`
2. Récupérer `access_token` et `refresh_token`
3. Poser un cookie `HttpOnly` nommé `session` contenant le refresh token
4. Répondre `{ "authenticated": true }`

**En cas d'échec :**
```json
{ "error": "Supabase unavailable" }
```
Statut HTTP `503`.

### Middleware d'authentification (Next.js)

Voir [Point 12](#12-middleware-nextjs) pour l'implémentation complète.

Pour chaque requête vers une route protégée :
1. Lire le cookie `session`
2. Rafraîchir le token via `supabase.auth.refreshSession()`
3. Si cookie absent ou invalide → retourner `401 Unauthorized`

**Routes protégées (session obligatoire) :**
- `POST /api/trade`
- `GET /api/game/state`
- `POST /api/game/advance`

**Routes publiques (aucune session requise) :**
- `GET /api/health`
- `GET /api/competition/bootstrap`
- `GET /api/competition/list`
- `GET /api/matches`
- `GET /api/market`
- `GET /api/game/live-matches`

**Routes cron (protégées par `CRON_SECRET`, pas par session) :**
- `GET /api/cron/sync-fixtures`
- `GET /api/cron/sync-results`

---

## 5. Structure des routes API

### Vue d'ensemble

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| `GET` | `/api/health` | Non | Sanity check du serveur |
| `POST` | `/api/auth/session` | Non | Création session anonyme Supabase |
| `GET` | `/api/competition/bootstrap` | Non | Données offline (équipes, calendrier, fixtures) |
| `GET` | `/api/competition/list` | Non | Liste des compétitions disponibles |
| `GET` | `/api/game/state` | Oui | État complet du jeu + portefeuille joueur |
| `POST` | `/api/game/advance` | Oui | Simule la journée suivante |
| `GET` | `/api/game/live-matches` | Non | Matchs du jour avec statuts live |
| `GET` | `/api/matches` | Non | Matchs d'un `day_index` spécifique |
| `GET` | `/api/market` | Non | Données marché enrichies |
| `POST` | `/api/trade` | Oui | Exécute un achat ou une vente |
| `GET` | `/api/cron/sync-fixtures` | CRON_SECRET | Synchronise le calendrier depuis API-Football |
| `GET` | `/api/cron/sync-results` | CRON_SECRET | Traite les résultats réels terminés |

---

## 6. Service API-Football + Cache Redis

### Client Redis (`lib/redis.ts`)

```typescript
import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
```

### Module `lib/football-api.ts`

Deux fonctions avec cache Redis intégré.

#### `fetchAllFixtures(leagueId, season)`

Appelle : `GET /fixtures?league={leagueId}&season={season}`

**Logique de cache :**
1. Clé Redis : `fixtures:{leagueId}:{season}`
2. Si présent en cache → retourner immédiatement
3. Sinon → appeler l'API, stocker avec **TTL : 1 heure**
4. Retourner la réponse

#### `fetchFinishedFixtures(leagueIds, season)`

Appelle : `GET /fixtures?league={leagueId}&season={season}&status=FT,AET,PEN`

**Logique de cache :**
1. Clé Redis : `finished:{leagueId}:{season}:{YYYYMMDD}`
2. Si présent en cache → retourner immédiatement
3. Sinon → appeler l'API, stocker avec **TTL : 5 minutes**
4. Retourner la réponse

#### Headers obligatoires sur chaque appel

```
x-rapidapi-key:  {API_FOOTBALL_KEY}
x-rapidapi-host: {API_FOOTBALL_HOST}
```

---

## 7. Cron `sync-fixtures` — quotidien

### Planification

```json
{
  "crons": [
    { "path": "/api/cron/sync-fixtures", "schedule": "0 6 * * *" }
  ]
}
```

**Fréquence :** une fois par jour à **06:00 UTC**.

**Sécurité :** le handler vérifie en première ligne :
```
Authorization: Bearer {CRON_SECRET}
```
Réponse `401` si absent ou invalide.

**Déclenchement manuel :**
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://your-app.vercel.app/api/cron/sync-fixtures
```

### Fonctionnement

Pour chaque compétition active (`is_active = true`) :

**1. Récupérer les fixtures**
Appeler `fetchAllFixtures(league_id, season)` — 1 appel API par compétition (servi depuis Redis si déjà en cache).

**2. Dériver la `start_date`**
La calculer depuis les fixtures (première date dans le set) plutôt que depuis la DB — évite les incohérences de cache.

**3. Normaliser chaque fixture**
Via `normalizeFixture(fixture, competition)` → produit les objets `teamA`, `teamB`, `compTeamA`, `compTeamB`, `day`, `match`.

**4. Upsert `teams`**
Colonnes mises à jour : `name`, `logo_url`, `flag_emoji`, `api_team_id`.
**Jamais écraser** : `strength`, `initial_price` (valeurs configurées manuellement par l'admin).

**5. Upsert `competition_teams`**
Colonnes mises à jour : `group_code`.
**Jamais écraser** : `initial_price`, `current_price`.

**6. Upsert `competition_days`**
Colonnes : `day_index`, `date_label`, `full_label`, `phase`, `is_ko`, `div_key`.
Conflit sur `(competition_id, day_index)`.

**7. Upsert `matches`** via le RPC `upsert_fixture`
Le RPC est en SQL pur (`SECURITY DEFINER`) pour garantir qu'aucune colonne critique n'est jamais écrasée.

Colonnes mises à jour uniquement : `scheduled_at`, `api_status`, `league_round`, `venue`.
**Jamais écraser** : `processed_at`, `score_a`, `score_b`, `trade_lock_until`, `result_data`.

**8. Mettre à jour `competitions.last_sync_at = NOW()`**

### Gestion des erreurs

- Chaque upsert est dans un `try/catch` individuel
- Erreur → logger + capturer via Sentry + continuer vers le fixture suivant
- Résumé final retourné :

```json
{
  "ok": true,
  "results": [
    { "competition": "FIFA World Cup 2026", "upserted": 104, "skipped": 0 }
  ],
  "ts": "2026-06-02T06:00:01.000Z"
}
```

---

## 8. Cron `sync-results` — toutes les 5 minutes

### Planification

```json
{
  "crons": [
    { "path": "/api/cron/sync-results", "schedule": "*/5 * * * *" }
  ]
}
```

**Fréquence :** toutes les **5 minutes**.

**Budget API maîtrisé grâce à deux mécanismes :**
1. `isMatchWindowActive()` → court-circuit DB si aucun match n'est en cours (0 appel Redis, 0 appel API)
2. Cache Redis TTL 5 minutes → l'API-Football n'est appelée qu'une seule fois par fenêtre de 5 minutes

**Sécurité :** même vérification `CRON_SECRET` qu'au Point 7.

### Fonctionnement

**Étape 1 — Court-circuit intelligent**

Appeler `isMatchWindowActive(competitionIds)` :

```sql
SELECT COUNT(*) FROM matches
WHERE competition_id IN (...)
  AND processed_at IS NULL
  AND api_status NOT IN ('PST', 'SUSP', 'CANC', 'ABD')
  AND scheduled_at BETWEEN NOW() - INTERVAL '3 hours'
                       AND NOW() + INTERVAL '3 hours'
```

Si le compte est `0` → retourner immédiatement `{ skipped: true, reason: 'no active match window' }`.

**Étape 2 — Récupérer les matchs terminés**

Appeler `fetchFinishedFixtures(leagueIds, season)` — résultat servi depuis Redis si disponible.

**Étape 3 — Traiter chaque fixture**

Pour chaque fixture dont le match en base a `processed_at IS NULL` :

```typescript
await processRealMatchResult(fixture.fixture.id, fixture)
```

**Étape 4 — Avancement de phase**

Pour chaque compétition active :

```typescript
await checkAndAdvancePhase(competitionId)
```

### Réponse

```json
{
  "ok": true,
  "processed": 3,
  "total": 6,
  "errors": [],
  "ts": "2026-06-11T20:05:01.000Z"
}
```

---

## 9. Moteur de jeu backend

### `applyResult(pA, pB, res)` — fonction pure

Aucun effet de bord. Retourne `[newPA, newPB]`.

```
Victoire A : newPA = pA + pB × 0.5     |  newPB = pB × 0.5
Victoire B : newPB = pB + pA × 0.5     |  newPA = pA × 0.5
Match nul  : newPA = pA + pB × 0.25    |  newPB = pB + pA × 0.25
```

Arrondi systématique : `Math.round(x * 10) / 10`
Plancher systématique : `Math.max(1, rawPrice)` — aucune équipe ne peut valoir moins de 1 KC

---

### `processRealMatchResult(fixtureId, fixture)`

#### Idempotence (première vérification)

```sql
SELECT processed_at FROM matches WHERE fixture_id = $fixtureId
```

Si `processed_at IS NOT NULL` → sortir immédiatement (`return false`). Un match ne peut être traité qu'une seule fois.

#### Détermination du résultat réel

```
Si statut === 'PEN' :
  penHome > penAway → 'A'
  penAway > penHome → 'B'
Sinon :
  goals.home > goals.away → 'A'
  goals.away > goals.home → 'B'
  égalité              → 'draw'
```

Statuts reconnus : `FT`, `AET`, `PEN`
Statuts ignorés (le match n'est pas traité) : `PST`, `SUSP`, `CANC`, `ABD`

#### Détection d'upset

```
isUpset = résultat ≠ 'draw'
       ET résultat ≠ équipe favorite (strength la plus haute)
       ET |strA - strB| > 5
```

#### Chaîne d'exécution complète (dans l'ordre)

1. Charger le match depuis `matches` via `fixture_id`
2. Vérifier idempotence → sortir si déjà traité
3. Charger les forces (`teams.strength`) des deux équipes
4. `determineResult(fixture)` → `'A' | 'B' | 'draw'`
5. Charger les prix courants depuis `competition_teams`
6. `applyResult(pA, pB, res)` → `[newPA, newPB]`
7. RPC `update_competition_prices` → met à jour `competition_teams.current_price` + insère dans `competition_prices`
8. Si phase KO (hors `SF` et `3rd place`) et `loserId` → RPC `liquidate_competition_eliminated`
9. Si `day.div_key` et `winnerId` → RPC `distribute_competition_dividends` avec le taux correspondant
10. Si phase `Final` et `loserId` → RPC `distribute_competition_dividends` pour le finaliste perdant (taux `final`)
11. Mettre à jour `matches` : `score_a`, `score_b`, `winner_id`, `is_upset`, `played_at`, `processed_at = NOW()`, `trade_lock_until = NOW() + 15 minutes`, `result_data` (JSONB complet)

---

### `checkAndAdvancePhase(competitionId)`

Idempotente — sûre à appeler plusieurs fois de suite.

#### Étapes

1. Charger `competition_game_state`
2. Vérifier que **tous les matchs** du `current_day_index` ont `processed_at IS NOT NULL`
   (en excluant les statuts `PST` / `SUSP` / `CANC` / `ABD`)
3. Si des matchs sont encore en attente → **sortir sans rien faire**
4. Charger les résultats du jour et reconstituer les pools KO
5. Si c'est le dernier jour des groupes :
   - Appeler `buildKOQualifiers()` → calcul des qualifiés et des éliminés
   - RPC `liquidate_competition_eliminated` pour chaque non-qualifié
6. Incrémenter `current_day_index`, mettre à jour `current_phase`, les pools, `eliminated[]`, `champion_id`

#### `buildKOQualifiers(competitionId, allGroupResults, eliminated, nextPhase)`

Algorithme compétition-agnostique :

1. `totalSpots = (nb matchs de la phase suivante en DB) × 2`
2. Tri de chaque groupe : Points → Différence de buts → Buts marqués → Force FIFA
3. Top 2 de chaque groupe → qualifiés automatiques
4. Meilleurs 3es (même critère de tri) → complètent les places restantes jusqu'à `totalSpots`
5. Tous les autres → ajoutés à `newEliminated`

---

### Taux de dividendes

```
DIV_RATES = {
  r32:      0.10,   // 10% du prix par action (qualification 8es)
  r16:      0.15,   // 15% (qualification 16es)
  qf:       0.20,   // 20% (qualification quarts)
  sf:       0.30,   // 30% (qualification demis)
  final:    0.40,   // 40% (les deux finalistes)
  champion: 0.60,   // 60% (vainqueur — s'additionne au taux final)
}
```

**Formule du dividende par action :**
```
dividende = round(currentPrice × rate × 10) / 10
```
`currentPrice` = prix de l'équipe **après** application du résultat.

---

## 10. Rate Limiting sur `/api/trade`

### Implémentation avec Redis Upstash

```
Clé :    rate:ip:{ip_address}
Limite : 10 requêtes
Fenêtre : 60 secondes
```

**Logique :**

```
ip = x-forwarded-for ?? req.ip
count = redis.INCR("rate:ip:{ip}")
si count === 1 → redis.EXPIRE("rate:ip:{ip}", 60)
si count > 10  → retourner 429
```

**Réponse si limite dépassée :**

```http
HTTP/1.1 429 Too Many Requests

{ "code": "RATE_LIMIT", "error": "Rate limit exceeded. Try again later." }
```

**Pourquoi Redis et non in-memory :**
Vercel déploie les serverless functions sur plusieurs instances parallèles. Un `Map` in-process n'est pas partagé entre instances. Redis est la seule solution correcte pour un rate limit cohérent en environnement serverless multi-instance.

**Placement :** la vérification du rate limit est la **première instruction** du handler `POST /api/trade`, avant toute autre logique.

---

## 11. Endpoints API — détail complet

---

### `GET /api/health`

**Auth :** Aucune.

**Réponse :**
```json
{ "status": "ok", "ts": "2026-06-02T10:00:00.000Z" }
```

---

### `POST /api/auth/session`

**Auth :** Aucune.

**Réponse succès :**
```json
{ "authenticated": true }
```
Cookie `session` (HttpOnly) posé sur la réponse.

**Réponse échec :**
```json
{ "error": "Supabase unavailable" }
```
Statut `503`.

---

### `GET /api/competition/bootstrap`

**Auth :** Aucune.

**Query params :**
- `?competition_id=1` (optionnel — défaut : compétition active)

**Cache :** `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`

**Réponse :**
```json
{
  "competition": {
    "id": 1,
    "name": "FIFA World Cup 2026",
    "start_date": "2026-06-11",
    "league_id": 1,
    "season": 2026
  },
  "teams": [
    {
      "id": "BRA",
      "name": "Brazil",
      "flag_emoji": "🇧🇷",
      "logo_url": "https://...",
      "group_code": "C",
      "strength": 88,
      "initial_price": 200,
      "confederation": "CONMEBOL"
    }
  ],
  "days": [
    {
      "day_index": 0,
      "full_label": "Day 1 · Thu Jun 11",
      "date_label": "Jun 11",
      "phase": "Groups",
      "is_ko": false,
      "div_key": null
    }
  ],
  "group_fixtures": [
    {
      "day_index": 0,
      "nation_a": "MEX",
      "nation_b": "RSA",
      "venue": "Azteca, Mexico City"
    }
  ],
  "generated_at": "2026-06-02T10:00:00.000Z"
}
```

> Les fixtures KO ne sont **pas incluses** — inconnues avant la fin des groupes.

---

### `GET /api/competition/list`

**Auth :** Aucune.

**Réponse :**
```json
{
  "competitions": [
    { "id": 1, "name": "FIFA World Cup 2026", "is_active": true },
    { "id": 2, "name": "FIFA World Cup 2022", "is_active": false }
  ]
}
```

---

### `GET /api/game/state`

**Auth :** Oui (cookie session).

**Headers requis :**
- `X-Competition-ID` (optionnel — défaut : compétition active)

**Optimisation :** retourne `304 Not Modified` si `If-None-Match` correspond à l'ETag courant.

**ETag format :** `"c{competitionId}-d{dayIndex}-p{portfolioId}"`

**Réponse :**
```json
{
  "competitionId": 1,
  "dayIndex": 5,
  "phase": "Groups",
  "champion": null,
  "eliminated": [],
  "r32Pool": [],
  "r16Pool": [],
  "qfPool": [],
  "sfPool": [],
  "finalPool": [],
  "thirdPool": [],
  "prices":       { "BRA": 212.5, "FRA": 200 },
  "priceHistory": { "BRA": [200, 212.5], "FRA": [200, 200] },
  "matchResults": { "0": [...], "1": [...] },
  "cash": 9800,
  "portfolio":  { "BRA": 2 },
  "avgCost":    { "BRA": 200 },
  "txLog": [
    { "dir": "buy", "flag": "🇧🇷", "name": "Brazil", "qty": 2, "price": 200, "day": 0 }
  ],
  "bestScore": 10050
}
```

**Headers de réponse :**
```
ETag: "c1-d5-p42"
Cache-Control: private, no-cache
```

---

### `POST /api/game/advance`

**Auth :** Oui (cookie session).

**Rôle :** Simuler la journée suivante (mode simulation uniquement). Protégé par un **CAS lock** sur `competition_game_state.advancing`.

**Body :**
```json
{ "competitionId": 1, "dayIndex": 5 }
```

**Réponse succès :**
```json
{
  "results": [...],
  "flash": { "BRA": "fu", "MAR": "fd" },
  "newDayIndex": 6,
  "newPhase": "Groups",
  "prices": { "BRA": 212.5 },
  "eliminated": [],
  "r32Pool": [],
  "champion": null,
  "newCash": 9850
}
```

**Codes d'erreur :**
- `409` : `{ "advancing": true }` — avance déjà en cours
- `200` avec `{ "alreadyAdvanced": true }` — client en retard

---

### `GET /api/game/live-matches`

**Auth :** Aucune.

**Réponse :**
```json
{
  "matches": [
    {
      "fixture_id": 12345,
      "nation_a": "BRA",
      "nation_b": "MAR",
      "scheduled_at": "2026-06-13T19:00:00Z",
      "api_status": "1H",
      "score_a": 1,
      "score_b": 0,
      "trade_lock_until": "2026-06-13T21:15:00Z",
      "processed_at": null,
      "phase": "Groups",
      "venue": "MetLife, New York"
    }
  ],
  "teams": {
    "BRA": { "id": "BRA", "name": "Brazil", "flag_emoji": "🇧🇷" }
  }
}
```

---

### `GET /api/matches`

**Auth :** Aucune.

**Query params :**
- `?day_index=5` — si absent, utilise le `current_day_index` de la compétition active
- `?competition_id=1` — optionnel (défaut : compétition active)

**Réponse :**
```json
{
  "day_index": 5,
  "phase": "Groups",
  "is_ko": false,
  "matches": [
    {
      "id": "m_...",
      "nation_a": "FRA",
      "nation_b": "SEN",
      "venue": "MetLife, New York",
      "scheduled_at": "2026-06-16T18:00:00Z",
      "api_status": "NS",
      "score_a": null,
      "score_b": null,
      "winner_id": null,
      "is_upset": false,
      "processed_at": null,
      "trade_lock_until": null,
      "result_data": null
    }
  ]
}
```

**Erreur si `day_index` invalide :** `400 Bad Request`.

---

### `GET /api/market`

**Auth :** Aucune.

**Query params :** `?competition_id=1`

**Réponse :**
```json
{
  "teams": [
    {
      "id": "BRA",
      "name": "Brazil",
      "flag_emoji": "🇧🇷",
      "current_price": 212.5,
      "initial_price": 200,
      "pct_change": 6.3,
      "eliminated": false
    }
  ]
}
```

---

### `POST /api/trade`

**Auth :** Oui (cookie session).

**Body :**
```json
{
  "competitionId": 1,
  "nationId": "BRA",
  "mode": "buy",
  "quantity": 2
}
```

**Vérifications dans l'ordre :**
1. Rate limit Redis (10 req / 60s par IP)
2. Paramètres valides (types, valeurs positives, mode `buy|sell`)
3. Session valide

**Exécution :** RPC `execute_competition_trade` (SECURITY DEFINER, `SELECT FOR UPDATE`).

Vérifications côté DB :
- Équipe non éliminée
- Solde suffisant (achat) / Quantité disponible (vente)
- Plafond de concentration 40% du portefeuille (groupes + R32 uniquement)

**Réponse succès :**
```json
{ "ok": true, "newCash": 9600, "newHeld": 2, "price": 200, "fee": 0 }
```

**Réponse erreur métier (`422`) :**
```json
{ "code": "CONCENTRATION_CAP", "error": "⛔ Plafond 40% atteint" }
```

**Codes d'erreur :**

| Code | Signification |
|------|---------------|
| `INSUFFICIENT_FUNDS` | Cash insuffisant pour l'achat |
| `NATION_ELIMINATED` | Équipe éliminée, trade interdit |
| `NOT_FOUND` | Quantité insuffisante pour la vente |
| `CONCENTRATION_CAP` | Plafond 40% dépassé |
| `RATE_LIMIT` | Trop de requêtes (429) |
| `INVALID_PARAMS` | Paramètres manquants ou invalides |
| `INTERNAL_ERROR` | Erreur serveur inattendue |

---

### `GET /api/cron/sync-fixtures`

**Auth :** `Authorization: Bearer {CRON_SECRET}`.

Voir [Point 7](#7-cron-sync-fixtures--quotidien).

---

### `GET /api/cron/sync-results`

**Auth :** `Authorization: Bearer {CRON_SECRET}`.

Voir [Point 8](#8-cron-sync-results--toutes-les-5-minutes).

---

## 12. Middleware Next.js

Fichier : `middleware.ts` à la racine du projet.

**Rôle :**
- Rafraîchir le token Supabase si expiré (via `@supabase/ssr`)
- Vérifier la session sur les routes protégées
- Retourner `401` si session absente ou invalide sur une route protégée
- Laisser passer les routes publiques et cron sans vérification de session

**Routes couvertes par le matcher :**
```typescript
export const config = {
  matcher: ['/api/trade', '/api/game/state', '/api/game/advance'],
};
```

**Logique :**

```
Pour chaque requête dans le matcher :
  1. Créer un client Supabase SSR (lit les cookies)
  2. supabase.auth.getSession()
  3. Si pas de session → retourner 401 JSON
  4. Sinon → passer la requête (NextResponse.next())
```

---

## 13. Tests

### Framework : Vitest

### Fonctions pures à tester (aucune dépendance DB)

| Fonction | Cas à couvrir |
|----------|---------------|
| `applyResult` | Victoire A, victoire B, nul, prix asymétriques, plancher ≥ 1 KC |
| `calcTax` | Groupes (10%), KO (5%), minimum 10 KC, équipe éliminée (0%) |
| `calcDividend` | r32, r16, qf, sf, final, champion, clé inconnue → 0 |
| `simulate` | Pas de nul possible en KO, nul possible en groupes, favori gagne >70% avec grand écart |
| `genScore` | Nul groupe, victoire 90min, victoire ET, pénalties |

### Tests d'intégration (nécessitent Supabase local)

| Fonction | Cas à couvrir |
|----------|---------------|
| `processRealMatchResult` | Victoire → prix mis à jour, KO → loser liquidé, dividende distribué, idempotence (2e appel = no-op) |
| `checkAndAdvancePhase` | Tous matchs traités → jour avancé, matchs en attente → rien ne se passe |

**Prérequis pour les tests d'intégration :** Supabase local via Docker (`supabase start`).

### Commandes

```bash
# Tests unitaires (fonctions pures)
pnpm --filter @kickstock/game-engine test

# Watch mode
pnpm --filter @kickstock/game-engine test:watch

# Coverage
pnpm --filter @kickstock/game-engine test --coverage
```

---

## 14. Documentation

### README requis

#### Prérequis

- Node.js 18+
- pnpm 8+
- Compte Supabase (cloud ou CLI local)
- Compte Upstash Redis
- Clé API-Football (RapidAPI)

#### Étapes d'installation

```bash
# 1. Installer les dépendances
pnpm install

# 2. Copier et remplir les variables d'environnement
cp apps/web/.env.example apps/web/.env.local

# 3. Appliquer les migrations Supabase
supabase db push
# ou manuellement via l'éditeur SQL Supabase

# 4. Démarrer le serveur de développement
pnpm dev
# → http://localhost:3000
```

#### Variables d'environnement

Documenter toutes les variables listées au [Point 2](#2-variables-denvironnement) avec description et exemple.

#### Commandes utiles

```bash
pnpm dev                                          # Next.js en dev
pnpm build                                        # Build production
pnpm --filter @kickstock/game-engine test         # Tests unitaires

# Déclencher les crons manuellement (dev)
curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/sync-fixtures

curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/sync-results
```

#### Schéma de base de données

Référencer le dossier `db/migrations/` pour le schéma SQL complet.

---

## Récapitulatif des décisions architecturales

| Décision | Choix retenu | Raison |
|----------|-------------|--------|
| Framework | **Next.js 14 App Router** | Cohabitation frontend/backend, déploiement Vercel natif, serverless |
| Client DB | **Supabase JS SDK** exclusivement | Pas de `DATABASE_URL`, pas de `pg` direct |
| Cache API-Football | **Upstash Redis** — TTL 1h (fixtures) / 5min (résultats) | Respecter le quota API |
| Fréquence sync-results | **5 minutes** | Réactivité maximale, quota maîtrisé par Redis + `isMatchWindowActive()` |
| Rate limit | **Upstash Redis** partagé multi-instance | Efficace en serverless, contrairement à in-memory |
| Idempotence `/api/trade` | **Verrou DB** (`SELECT FOR UPDATE` dans RPC) | Suffisant — pas besoin d'Idempotency-Key |
| Auth | **Cookie HttpOnly** + Supabase Auth anonyme | Sécurité, gestion automatique du refresh token |
| Cron | **Vercel Cron Jobs** | Natif Vercel, pas de serveur persistant |
| Opérations critiques | **RPCs SECURITY DEFINER** | Atomicité garantie côté DB |
| Endpoint matchs | **`GET /api/matches?day_index=`** | Clarté de l'API, accès ciblé par journée |
| Route santé | **`GET /api/health`** | Monitoring et vérification de déploiement |
