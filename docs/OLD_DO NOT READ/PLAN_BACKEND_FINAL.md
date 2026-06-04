# Plan Backend Final — KickStock
> Version consolidée · Next.js 14 App Router · Supabase · Vercel · Redis

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
| ORM / client DB | **Supabase JS SDK** (`@supabase/supabase-js`) |
| Cache | **Redis** (Upstash serverless) |
| Auth | **Supabase Auth** (session anonyme) |
| Monitoring | **Sentry** (`@sentry/nextjs`) |
| Crons | **Vercel Cron Jobs** (déclarés dans `vercel.json`) |

### Structure des fichiers backend

```
apps/web/
├── app/
│   └── api/
│       ├── health/
│       │   └── route.ts              ← GET /api/health
│       ├── auth/
│       │   └── session/
│       │       └── route.ts          ← POST /api/auth/session
│       ├── trade/
│       │   └── route.ts              ← POST /api/trade
│       ├── market/
│       │   └── route.ts              ← GET /api/market
│       ├── game/
│       │   ├── state/
│       │   │   └── route.ts          ← GET /api/game/state
│       │   ├── advance/
│       │   │   └── route.ts          ← POST /api/game/advance
│       │   └── live-matches/
│       │       └── route.ts          ← GET /api/game/live-matches
│       ├── matches/
│       │   └── route.ts              ← GET /api/matches?day_index=
│       ├── competition/
│       │   ├── bootstrap/
│       │   │   └── route.ts          ← GET /api/competition/bootstrap
│       │   └── list/
│       │       └── route.ts          ← GET /api/competition/list
│       └── cron/
│           ├── sync-fixtures/
│           │   └── route.ts          ← GET /api/cron/sync-fixtures
│           └── sync-results/
│               └── route.ts          ← GET /api/cron/sync-results
├── lib/
│   ├── football-api.ts               ← Appels API-Football
│   ├── redis.ts                      ← Client Redis (Upstash)
│   ├── match-window.ts               ← isMatchWindowActive()
│   ├── process-real-result.ts        ← processRealMatchResult()
│   ├── check-advance-phase.ts        ← checkAndAdvancePhase()
│   ├── ko-qualifiers.ts              ← buildKOQualifiers()
│   ├── normalizer.ts                 ← normalizeFixture()
│   ├── rateLimit.ts                  ← isRateLimited() via Redis
│   └── supabase/
│       ├── client.ts                 ← Client côté navigateur
│       ├── server.ts                 ← Client côté serveur (cookies)
│       └── admin.ts                  ← Client service_role (crons, RPCs)
└── middleware.ts                     ← Next.js middleware (auth guard)
```

### Principes généraux

- Chaque route API est un fichier `route.ts` avec `export async function GET/POST`.
- `export const dynamic = 'force-dynamic'` sur toutes les routes mutantes.
- Les opérations critiques (trade, liquidation, dividendes) passent par des **RPCs Supabase `SECURITY DEFINER`** — la logique métier est dans la DB, pas dans le handler.
- Toute erreur inattendue est capturée par **Sentry** (`Sentry.captureException`).
- Les crons sont sécurisés par `Authorization: Bearer {CRON_SECRET}`.

---

## 2. Variables d'environnement

### Fichier `.env.local` (développement)

```env
# ── Supabase ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# ── API-Football (RapidAPI) ───────────────────────────────────────────────────
API_FOOTBALL_KEY=your_rapidapi_key
API_FOOTBALL_HOST=v3.football.api-sports.io

# ── Redis (Upstash) ───────────────────────────────────────────────────────────
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token

# ── Cron ─────────────────────────────────────────────────────────────────────
CRON_SECRET=a_secure_random_string

# ── Sentry ───────────────────────────────────────────────────────────────────
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

### `.env.example` (à committer)

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

> **Note :** `DATABASE_URL` n'est **pas utilisée**. Toutes les interactions avec la base passent par le SDK Supabase JS (`@supabase/supabase-js`) — jamais par un client `pg` ou `knex` direct.

---

## 3. Base de données PostgreSQL

### Création

Utiliser un projet **Supabase** (cloud ou local via `supabase start`).

Appliquer les migrations dans l'ordre :
```
db/migrations/001_schema.sql
db/migrations/002_rls.sql
db/migrations/003_triggers.sql
db/migrations/004_rpcs.sql
...
```

### Tables principales

| Table | Rôle |
|-------|------|
| `competitions` | Compétitions actives (`is_active`, `league_id`, `season`, `last_sync_at`) |
| `teams` | Équipes nationales (`id`, `name`, `flag_emoji`, `logo_url`, `strength`, `confederation`) |
| `competition_teams` | Liaison équipe ↔ compétition (`group_code`, `initial_price`, `current_price`) |
| `competition_days` | Journées du calendrier (`day_index`, `phase`, `is_ko`, `div_key`) |
| `matches` | Matchs (`fixture_id`, `nation_a`, `nation_b`, `scheduled_at`, `api_status`, `processed_at`, `trade_lock_until`, `result_data` JSONB) |
| `competition_game_state` | État global par compétition (pools KO, `eliminated[]`, `champion_id`, `advancing` CAS lock) |
| `competition_prices` | Historique des prix jour par jour |
| `portfolios` | Portefeuille joueur (`cash`, `avg_cost` JSONB, `tx_log` JSONB, `best_score`) |
| `holdings` | Positions joueur par équipe et compétition |
| `transactions` | Audit log immuable des trades |

### Index à créer

```sql
-- Performances des requêtes fréquentes
CREATE INDEX idx_matches_competition_id     ON matches(competition_id);
CREATE INDEX idx_matches_day_index          ON matches(day_index);
CREATE INDEX idx_matches_scheduled_at       ON matches(scheduled_at);
CREATE INDEX idx_matches_processed_at       ON matches(processed_at);
CREATE INDEX idx_holdings_portfolio_id      ON holdings(portfolio_id);
CREATE INDEX idx_transactions_portfolio_id  ON transactions(portfolio_id);
CREATE INDEX idx_comp_prices_competition_id ON competition_prices(competition_id);
```

### RPCs `SECURITY DEFINER`

Ces fonctions exécutent la logique critique côté DB avec des verrous `FOR UPDATE` :

| RPC | Rôle |
|-----|------|
| `execute_competition_trade` | Achat / vente atomique avec vérifications (solde, cap, élimination) |
| `liquidate_competition_eliminated` | Liquide toutes les positions d'une équipe éliminée à 1 KC |
| `distribute_competition_dividends` | Crédite les dividendes sur les portefeuilles des détenteurs |
| `update_competition_prices` | Met à jour les prix + historique après un résultat |
| `upsert_fixture` | Upsert de match sans jamais toucher `processed_at` / scores |
| `get_or_create_competition_portfolio` | Crée le portefeuille si inexistant |

### Test de connexion

```typescript
// lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
```

Vérifier avec un `SELECT 1` au démarrage (optionnel en dev).

---

## 4. Authentification anonyme

### Principe

L'authentification repose sur **Supabase Auth** en mode anonyme. Le frontend n'a pas à gérer de token manuellement : le cookie `HttpOnly` est posé par le serveur et renvoyé automatiquement à chaque requête.

### Endpoint `POST /api/auth/session`

```
POST /api/auth/session
```

**Fonctionnement :**
1. Appeler `supabase.auth.signInAnonymously()`
2. Récupérer `access_token` et `refresh_token`
3. Poser un cookie `HttpOnly` nommé `session` contenant le refresh token
4. Répondre :

```json
{ "authenticated": true }
```

**En cas d'échec :**

```json
{ "error": "Supabase unavailable" }
```

Statut HTTP `503`.

### Middleware d'authentification Next.js

Écrit dans `middleware.ts` à la racine du projet.

Pour chaque requête vers une route protégée :
1. Lire le cookie `session`
2. Rafraîchir le token via `supabase.auth.refreshSession()`
3. Attacher l'utilisateur à la requête (via `NextResponse.next()` avec headers)
4. Si cookie absent ou invalide → rediriger ou renvoyer `401`

Les routes **protégées** (nécessitent une session) :
- `POST /api/trade`
- `GET /api/game/state`
- `POST /api/game/advance`

Les routes **publiques** (aucune session requise) :
- `GET /api/health`
- `GET /api/competition/bootstrap`
- `GET /api/competition/list`
- `GET /api/matches`
- `GET /api/market`

Les routes **cron** (protégées par `CRON_SECRET`, pas par session) :
- `GET /api/cron/sync-fixtures`
- `GET /api/cron/sync-results`

---

## 5. Structure des routes API

### Vue d'ensemble

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| `GET`  | `/api/health` | Non | Sanity check du serveur |
| `POST` | `/api/auth/session` | Non | Création session anonyme Supabase |
| `GET`  | `/api/competition/bootstrap` | Non | Données offline (équipes, calendrier, fixtures) |
| `GET`  | `/api/competition/list` | Non | Liste des compétitions disponibles |
| `GET`  | `/api/game/state` | Oui | État complet du jeu + portefeuille joueur |
| `POST` | `/api/game/advance` | Oui | Simule la journée suivante (mode simulation) |
| `GET`  | `/api/game/live-matches` | Non | Matchs du jour avec statuts live |
| `GET`  | `/api/matches` | Non | Matchs d'un `day_index` spécifique |
| `GET`  | `/api/market` | Non | Données marché enrichies |
| `POST` | `/api/trade` | Oui | Exécute un achat ou une vente |
| `GET`  | `/api/cron/sync-fixtures` | CRON_SECRET | Synchronise le calendrier depuis API-Football |
| `GET`  | `/api/cron/sync-results` | CRON_SECRET | Traite les résultats réels terminés |

---

## 6. Service API-Football + Cache Redis

### Variables requises

```env
API_FOOTBALL_KEY=your_rapidapi_key
API_FOOTBALL_HOST=v3.football.api-sports.io
```

### Client Redis (`lib/redis.ts`)

Utiliser **Upstash Redis** (serverless, compatible Vercel) :

```typescript
import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
```

### Module `lib/football-api.ts`

Deux fonctions principales avec cache Redis intégré.

#### `fetchAllFixtures(leagueId, season)`

Appelle :
```
GET /fixtures?league={leagueId}&season={season}
```

**Logique de cache :**
1. Construire la clé : `fixtures:{leagueId}:{season}`
2. Vérifier Redis → si présent, retourner la valeur cachée
3. Sinon, appeler l'API avec les headers RapidAPI
4. Stocker le résultat dans Redis avec **TTL : 1 heure**
5. Retourner la réponse

#### `fetchFinishedFixtures(leagueIds, season)`

Appelle pour chaque `leagueId` :
```
GET /fixtures?league={leagueId}&season={season}&status=FT,AET,PEN
```

**Logique de cache :**
1. Clé : `finished:{leagueId}:{season}:{date_YYYYMMDD}`
2. Vérifier Redis → si présent, retourner
3. Sinon, appeler l'API
4. Stocker dans Redis avec **TTL : 5 minutes**
5. Retourner la réponse

#### Headers RapidAPI (obligatoires)

```typescript
headers: {
  'x-rapidapi-key':  process.env.API_FOOTBALL_KEY!,
  'x-rapidapi-host': process.env.API_FOOTBALL_HOST!,
}
```

---

## 7. Cron `sync-fixtures` — quotidien

### Déclenchement

Planification dans `vercel.json` :
```json
{
  "crons": [
    { "path": "/api/cron/sync-fixtures", "schedule": "0 6 * * *" }
  ]
}
```

**Fréquence :** une fois par jour à **06:00 UTC**.

**Déclenchement manuel :**
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://your-app.vercel.app/api/cron/sync-fixtures
```

**Sécurité :** le handler vérifie `Authorization: Bearer {CRON_SECRET}` en première ligne. Réponse `401` si absent ou invalide.

### Fonctionnement

Pour chaque compétition active (`is_active = true`) :

1. **Récupérer les fixtures** via `fetchAllFixtures(league_id, season)` — 1 seul appel API (servi depuis Redis si déjà en cache)

2. **Normaliser** chaque fixture via `normalizeFixture(fixture, competition)`

3. **Upsert `teams`** — colonnes mises à jour : `name`, `logo_url`, `flag_emoji`, `api_team_id`
   - **Jamais écraser** : `strength`, `initial_price` (valeurs configurées manuellement par l'admin)

4. **Upsert `competition_teams`** — colonnes mises à jour : `group_code`
   - **Jamais écraser** : `initial_price`, `current_price`

5. **Upsert `competition_days`** — colonnes : `day_index`, `date_label`, `full_label`, `phase`, `is_ko`, `div_key`

6. **Upsert `matches`** via le RPC `upsert_fixture` (SQL pur, SECURITY DEFINER)
   - Colonnes pouvant être mises à jour (reports) : `scheduled_at`, `api_status`, `league_round`, `venue`
   - **Jamais écraser** : `processed_at`, `score_a`, `score_b`, `trade_lock_until`, `result_data`

7. **Mettre à jour** `competitions.last_sync_at = NOW()`

### Gestion des erreurs

- Chaque upsert est encapsulé dans un `try/catch` individuel
- En cas d'erreur : logger + capturer via Sentry + continuer vers le fixture suivant
- Le résumé final retourne :
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

### Déclenchement

```json
{
  "crons": [
    { "path": "/api/cron/sync-results", "schedule": "*/5 * * * *" }
  ]
}
```

**Fréquence :** toutes les **5 minutes**.

**Budget API :** grâce au cache Redis (TTL 5min), l'API-Football n'est appelée qu'**une fois** par fenêtre de 5 minutes même si le cron tourne plusieurs fois. Et grâce à `isMatchWindowActive()`, l'appel Redis lui-même est évité si aucun match n'est en cours.

### Fonctionnement

**Étape 1 — Court-circuit intelligent**

Appeler `isMatchWindowActive(competitionIds)` :

```sql
SELECT COUNT(*) FROM matches
WHERE competition_id IN (...)
  AND processed_at IS NULL
  AND api_status NOT IN ('PST','SUSP','CANC','ABD')
  AND scheduled_at BETWEEN NOW() - INTERVAL '3 hours'
                       AND NOW() + INTERVAL '3 hours'
```

Si le compte est `0` → retourner immédiatement `{ skipped: true, reason: 'no active match window' }`. **0 appel Redis, 0 appel API.**

**Étape 2 — Récupérer les matchs terminés**

Appeler `fetchFinishedFixtures(leagueIds, season)` (résultat servi depuis Redis si déjà en cache dans les 5 dernières minutes).

**Étape 3 — Traiter chaque fixture**

Pour chaque fixture dont le match en base a `processed_at IS NULL` :

```typescript
await processRealMatchResult(fixture.fixture.id, fixture)
```

Voir la description détaillée au [Point 9](#9-moteur-de-jeu-backend).

Marquer ensuite :
```sql
processed_at     = NOW()
trade_lock_until = NOW() + INTERVAL '15 minutes'
```

**Étape 4 — Avancement de phase**

Pour chaque compétition active :

```typescript
await checkAndAdvancePhase(competitionId)
```

Voir la description détaillée au [Point 9](#9-moteur-de-jeu-backend).

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

### `applyResult(pA, pB, res)` — `packages/game-engine/src/applyResult.ts`

Fonction **pure**, aucun effet de bord.

```
Victoire A : newPA = pA + pB × 0.5 | newPB = pB × 0.5
Victoire B : newPB = pB + pA × 0.5 | newPA = pA × 0.5
Match nul  : newPA = pA + pB × 0.25 | newPB = pB + pA × 0.25
```

Arrondi : `Math.round(x * 10) / 10`
Plancher : `Math.max(1, rawPrice)`

Retourne `[newPA, newPB]`.

---

### `processRealMatchResult(fixtureId, fixture)` — `lib/process-real-result.ts`

#### Idempotence

**Première vérification :**
```sql
SELECT processed_at FROM matches WHERE fixture_id = $fixtureId
```
Si `processed_at IS NOT NULL` → sortir immédiatement (`return false`).

#### Détermination du résultat

```typescript
// Pénalties
if (status === 'PEN') {
  return penHome > penAway ? 'A' : 'B';
}
// Temps réglementaire ou prolongations
return home > away ? 'A' : away > home ? 'B' : 'draw';
```

#### Détection d'upset

```
isUpset = résultat ≠ 'draw' ET résultat ≠ favori ET |strA - strB| > 5
```

#### Chaîne d'exécution (dans l'ordre)

1. Charger le match depuis `matches` (via `fixture_id`)
2. Vérifier idempotence
3. Charger les forces (`teams.strength`)
4. `determineResult(fixture)` → `'A' | 'B' | 'draw'`
5. Charger les prix courants depuis `competition_teams`
6. `applyResult(pA, pB, res)` → `[newPA, newPB]`
7. RPC `update_competition_prices` → met à jour `competition_teams` + insère dans `competition_prices`
8. Si KO (hors `SF` et `3rd`) et `loserId` → RPC `liquidate_competition_eliminated`
9. Si `day.div_key` et `winnerId` → RPC `distribute_competition_dividends` avec le taux correspondant
10. Si Finale et `loserId` → RPC `distribute_competition_dividends` pour le finaliste perdant (taux `final`)
11. Mettre à jour `matches` : `score_a`, `score_b`, `winner_id`, `is_upset`, `played_at`, `processed_at`, `trade_lock_until`, `result_data` (JSONB complet)

---

### `checkAndAdvancePhase(competitionId)` — `lib/check-advance-phase.ts`

Idempotente — sûre à appeler plusieurs fois.

#### Étapes

1. Charger `competition_game_state` pour la compétition
2. Vérifier que **tous les matchs** du `current_day_index` ont `processed_at IS NOT NULL` (en excluant PST/SUSP/CANC/ABD)
3. Si des matchs sont encore en attente → sortir sans rien faire
4. Reconstituer les pools KO depuis les `result_data` des matchs du jour
5. Si c'est le dernier jour des groupes :
   - Appeler `buildKOQualifiers(competitionId, allGroupResults, eliminated, nextPhase)`
   - Les équipes non qualifiées sont ajoutées à `eliminated`
   - RPC `liquidate_competition_eliminated` pour chaque non-qualifié
6. Incrémenter `current_day_index` et mettre à jour `current_phase`, les pools, les `eliminated`, le `champion_id`

#### `buildKOQualifiers(competitionId, allGroupResults, eliminated, nextPhase)`

Algorithme compétition-agnostique :

1. Compter les places disponibles : `totalSpots = (nb matchs phase suivante en DB) × 2`
2. Trier chaque groupe par : Points → GD → GF → Force FIFA
3. Top 2 de chaque groupe → qualifiés automatiques
4. Meilleurs 3es (classés par le même critère) → comblent les places restantes
5. Tous les autres → ajoutés à `newEliminated`

---

## 10. Rate Limiting sur `/api/trade`

### Implémentation avec Redis

Utiliser le client **Upstash Redis** (`lib/redis.ts`).

**Clé Redis :** `rate:ip:{ip_address}`

**Logique :**
1. Extraire l'IP depuis `req.headers.get('x-forwarded-for')` ou `req.ip`
2. Incrémenter le compteur Redis avec TTL
3. Si compteur > LIMITE → répondre `429`

```typescript
// lib/rateLimit.ts
import { redis } from './redis';

const LIMIT     = 10;
const WINDOW_S  = 60; // 1 minute

export async function isRateLimited(ip: string): Promise<boolean> {
  const key = `rate:ip:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_S);
  return count > LIMIT;
}
```

**Paramètres :**

| Paramètre | Valeur |
|-----------|--------|
| Limite | **10 requêtes** |
| Fenêtre | **60 secondes** |
| Clé | `rate:ip:{ip}` |
| Backend | **Redis Upstash** (partagé entre toutes les instances Vercel) |

**Comportement si limite dépassée :**

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{ "code": "RATE_LIMIT", "error": "Rate limit exceeded. Try again later." }
```

**Placement dans le handler :**

```typescript
// app/api/trade/route.ts
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  if (await isRateLimited(ip)) {
    return NextResponse.json(
      { code: 'RATE_LIMIT', error: 'Rate limit exceeded. Try again later.' },
      { status: 429 }
    );
  }
  // ... suite du handler
}
```

> **Pourquoi Redis et pas in-memory :** Vercel déploie les Functions sur plusieurs instances parallèles. Un `Map` in-process n'est pas partagé entre instances — un joueur peut contourner la limite en distribuant ses requêtes. Redis est le seul moyen d'avoir un rate limit cohérent en environnement serverless multi-instance.

---

## 11. Endpoints API — détail complet

---

### `GET /api/health`

**Auth :** Aucune.

**Rôle :** Vérifier que le serveur répond et que les middlewares de base fonctionnent.

**Réponse :**
```json
{ "status": "ok", "ts": "2026-06-02T10:00:00.000Z" }
```

---

### `POST /api/auth/session`

**Auth :** Aucune.

**Rôle :** Créer une session anonyme Supabase et poser le cookie.

**Réponse succès :**
```json
{ "authenticated": true }
```

**Réponse échec :**
```json
{ "error": "Supabase unavailable" }
```
Statut `503`.

---

### `GET /api/competition/bootstrap`

**Auth :** Aucune.

**Rôle :** Fournir toutes les données nécessaires au mode offline. Appelé une fois au chargement, résultat mis en cache côté client (TTL 24h localStorage) et côté CDN (Vercel Edge, `s-maxage=3600`).

**Query params :** `?competition_id=` (optionnel — défaut : compétition active)

**Réponse :**
```json
{
  "competition": { "id": 1, "name": "FIFA World Cup 2026", "start_date": "2026-06-11", "league_id": 1, "season": 2026 },
  "teams": [
    { "id": "BRA", "name": "Brazil", "flag_emoji": "🇧🇷", "logo_url": "...", "group_code": "C", "strength": 88, "initial_price": 200, "confederation": "CONMEBOL" }
  ],
  "days": [
    { "day_index": 0, "full_label": "Day 1 · Thu Jun 11", "date_label": "Jun 11", "phase": "Groups", "is_ko": false, "div_key": null }
  ],
  "group_fixtures": [
    { "day_index": 0, "nation_a": "MEX", "nation_b": "RSA", "venue": "Azteca, Mexico City" }
  ],
  "generated_at": "2026-06-02T10:00:00.000Z"
}
```

> Les fixtures KO ne sont **pas incluses** (inconnues avant la fin des groupes).

---

### `GET /api/competition/list`

**Auth :** Aucune.

**Rôle :** Lister les compétitions disponibles (pour le sélecteur de compétition en UI).

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

**Auth :** Oui (session cookie ou `X-Device-ID`).

**Headers requis :**
- `X-Device-ID` : UUID v4 identifiant le device (joueur anonyme)
- `X-Competition-ID` (optionnel) : ID de la compétition — défaut : compétition active

**Rôle :** Retourner l'état complet du jeu pour la compétition + le portefeuille du joueur.

**Optimisation :** retourne `304 Not Modified` si le header `If-None-Match` correspond à l'ETag courant (`"c{competitionId}-d{dayIndex}-p{portfolioId}"`).

**Réponse (7 fetches parallèles) :**
```json
{
  "competitionId": 1,
  "dayIndex": 5,
  "phase": "Groups",
  "champion": null,
  "eliminated": [],
  "r32Pool": [], "r16Pool": [], "qfPool": [], "sfPool": [], "finalPool": [], "thirdPool": [],
  "prices":       { "BRA": 212.5, "FRA": 200, "..." : "..." },
  "priceHistory": { "BRA": [200, 200, 212.5], "..." : "..." },
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

**Auth :** Oui.

**Rôle :** Simuler la journée suivante (mode simulation uniquement). Protégé par un **CAS lock** sur `competition_game_state.advancing` pour prévenir la concurrence.

**Body :**
```json
{ "competitionId": 1, "dayIndex": 5 }
```

**Réponse :**
```json
{
  "results": [...],
  "flash": { "BRA": "fu", "MAR": "fd" },
  "newDayIndex": 6,
  "newPhase": "Groups",
  "prices": { "BRA": 212.5 },
  "eliminated": [],
  "r32Pool": [], "r16Pool": [],
  "champion": null,
  "newCash": 9850
}
```

**Codes d'erreur :**
- `409` : `{ "advancing": true }` — une avance est déjà en cours
- `200` avec `{ "alreadyAdvanced": true }` — le client est en retard

---

### `GET /api/game/live-matches`

**Auth :** Aucune.

**Rôle :** Retourner les matchs du jour courant avec leurs statuts live (mode online uniquement).

**Réponse :**
```json
{
  "matches": [
    {
      "fixture_id": 12345,
      "nation_a": "BRA", "nation_b": "MAR",
      "scheduled_at": "2026-06-13T19:00:00Z",
      "api_status": "1H",
      "score_a": 1, "score_b": 0,
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
- `?day_index=5` — obligatoire (jour spécifique)
- `?competition_id=1` — optionnel (défaut : compétition active)

**Rôle :** Retourner la liste des matchs pour un `day_index` donné. Utile pour afficher l'agenda d'une journée précise sans charger tout le game state.

**Réponse :**
```json
{
  "day_index": 5,
  "phase": "Groups",
  "is_ko": false,
  "matches": [
    {
      "id": "m_...",
      "nation_a": "FRA", "nation_b": "SEN",
      "venue": "MetLife, New York",
      "scheduled_at": "2026-06-16T18:00:00Z",
      "api_status": "NS",
      "score_a": null, "score_b": null,
      "winner_id": null,
      "is_upset": false,
      "processed_at": null,
      "trade_lock_until": null,
      "result_data": null
    }
  ]
}
```

Si `day_index` n'est pas fourni → utiliser le jour courant de la compétition active.
Si `day_index` est invalide → `400 Bad Request`.

---

### `GET /api/market`

**Auth :** Aucune.

**Rôle :** Retourner les données enrichies du marché pour toutes les équipes d'une compétition.

**Query params :** `?competition_id=1`

**Réponse :**
```json
{
  "teams": [
    {
      "id": "BRA", "name": "Brazil", "flag_emoji": "🇧🇷",
      "current_price": 212.5, "initial_price": 200,
      "pct_change": 6.3,
      "eliminated": false
    }
  ]
}
```

---

### `POST /api/trade`

**Auth :** Oui.

**Headers requis :**
- `X-Device-ID` : UUID v4

**Body :**
```json
{
  "competitionId": 1,
  "nationId": "BRA",
  "mode": "buy",
  "quantity": 2
}
```

**Vérifications :**
1. Rate limit (10 req/60s via Redis)
2. Paramètres valides (types, valeurs positives, mode buy|sell)
3. `X-Device-ID` présent

**Exécution :** via RPC `execute_competition_trade` (SECURITY DEFINER, `SELECT FOR UPDATE`) qui vérifie côté DB :
- Équipe non éliminée
- Solde suffisant (achat)
- Quantité disponible (vente)
- Plafond de concentration 40% (groupes + R32 uniquement)

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
| `NATION_ELIMINATED` | Équipe éliminée |
| `NOT_FOUND` | Quantité insuffisante pour la vente |
| `CONCENTRATION_CAP` | Plafond 40% dépassé |
| `RATE_LIMIT` | Trop de requêtes |
| `INVALID_PARAMS` | Paramètres invalides |
| `INTERNAL_ERROR` | Erreur serveur |

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

Fichier : `middleware.ts` à la racine.

**Rôle :**
- Protéger les routes qui nécessitent une session
- Rafraîchir le token Supabase si expiré
- Rediriger vers `/login` si la session est absente sur une route protégée
- Laisser passer les routes publiques et cron sans vérification de session

**Implémentation :**

```typescript
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PROTECTED_PATHS = ['/api/trade', '/api/game/state', '/api/game/advance'];

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Routes publiques et cron → laisser passer
  const path = req.nextUrl.pathname;
  const isProtected = PROTECTED_PATHS.some(p => path.startsWith(p));
  if (!isProtected) return res;

  // Vérification session
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { /* read/write from req/res */ } }
  );

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return res;
}

export const config = {
  matcher: ['/api/trade', '/api/game/state', '/api/game/advance'],
};
```

---

## 13. Tests

### Framework

**Vitest** (déjà configuré dans `packages/game-engine/vitest.config.ts`).

### Tests à couvrir

#### Fonctions pures — `packages/game-engine`

| Fonction | Cas à tester |
|----------|-------------|
| `applyResult` | Victoire A, victoire B, nul, prix asymétriques, plancher ≥ 1 |
| `calcTax` | Groupes (10%), KO (5%), minimum 10 KC, éliminée (0%) |
| `calcDividend` | r32, r16, qf, sf, final, champion, clé inconnue |
| `simulate` | Pas de nul en KO, nul possible en groupes, favori gagne >70% sur grand écart |
| `genScore` | Nul groupe, victoire 90min, ET, pénalties |

#### Intégration — `lib/`

| Fonction | Cas à tester | Prérequis |
|----------|-------------|-----------|
| `processRealMatchResult` | Victoire → prix mis à jour, KO → loser liquidé, dividende distribué, idempotence | Supabase local (Docker) |
| `checkAndAdvancePhase` | Tous matchs traités → avancement, matchs en attente → pas d'avancement | Supabase local |

### Commandes

```bash
# Lancer les tests
pnpm --filter @kickstock/game-engine test

# Watch mode
pnpm --filter @kickstock/game-engine test:watch

# Coverage
pnpm --filter @kickstock/game-engine test --coverage
```

---

## 14. Documentation

### README requis

Le `README.md` à la racine doit contenir les sections suivantes.

#### Prérequis

- Node.js 18+
- pnpm 8+
- Compte Supabase (ou Supabase CLI en local)
- Compte Upstash Redis
- Clé API-Football (RapidAPI)

#### Étapes d'installation

```bash
# 1. Cloner le projet
git clone https://github.com/your-org/kickstock.git
cd kickstock

# 2. Installer les dépendances
pnpm install

# 3. Configurer les variables d'environnement
cp apps/web/.env.example apps/web/.env.local
# → remplir les valeurs

# 4. Lancer les migrations Supabase
supabase db push
# ou manuellement dans l'éditeur SQL Supabase

# 5. Démarrer le serveur de développement
pnpm dev
# → http://localhost:3000
```

#### Variables d'environnement

Lister toutes les variables avec description et exemple (voir [Point 2](#2-variables-denvironnement)).

#### Commandes utiles

```bash
pnpm dev               # Démarrer Next.js en dev
pnpm build             # Build de production
pnpm type-check        # Vérification TypeScript
pnpm --filter @kickstock/game-engine test  # Tests unitaires

# Déclencher les crons manuellement
curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/sync-fixtures

curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/sync-results
```

#### Schéma de base de données

Référencer le fichier `db/migrations/` pour le schéma complet.

---

## Récapitulatif des décisions architecturales

| Décision | Choix retenu | Raison |
|----------|-------------|--------|
| Framework backend | **Next.js 14 App Router** | Cohabitation frontend/backend, déploiement Vercel natif, serverless |
| Client DB | **Supabase JS SDK** (pas de `pg` direct) | SDK type-safe, gestion auth intégrée, RPCs disponibles |
| Cache API-Football | **Redis Upstash** (TTL 1h / 5min) | Respecter le quota API, compatible serverless |
| Rate limit | **Redis Upstash** (partagé multi-instance) | Efficace en serverless multi-instance, contrairement à in-memory |
| Idempotence `/api/trade` | **Verrou DB** (`SELECT FOR UPDATE` dans RPC) | Suffisant pour ce contexte — évite la complexité Idempotency-Key |
| Auth | **Cookie HttpOnly** + Supabase Auth | Sécurité, gestion automatique du refresh token |
| Cron | **Vercel Cron Jobs** (pas node-cron) | Natif Vercel, pas de serveur persistant nécessaire |
| Opérations critiques | **RPCs SECURITY DEFINER** | Atomicité garantie côté DB, impossible à contourner côté client |
| `DATABASE_URL` | **Supprimée** | Non nécessaire — tout passe par le SDK Supabase |
