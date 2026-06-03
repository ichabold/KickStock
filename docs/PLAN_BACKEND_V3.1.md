# Plan Backend — Football Game
> Version 3 · Next.js 14 App Router · Supabase · Vercel · Redis Upstash

---

## Sommaire

1. [Stack & Architecture](#1-stack--architecture)
2. [Variables d'environnement](#2-variables-denvironnement)
3. [Base de données PostgreSQL](#3-base-de-données-postgresql)
4. [Table `game_config` — Paramètres métier configurables](#4-table-game_config--paramètres-métier-configurables)
5. [Authentification anonyme](#5-authentification-anonyme)
6. [Structure des routes API](#6-structure-des-routes-api)
7. [Service API-Football + Cache Redis](#7-service-api-football--cache-redis)
8. [Cron `sync-fixtures` — quotidien](#8-cron-sync-fixtures--quotidien)
9. [Cron `sync-results` — toutes les 5 minutes](#9-cron-sync-results--toutes-les-5-minutes)
10. [Moteur de jeu backend](#10-moteur-de-jeu-backend)
11. [Rate Limiting sur `/api/trade`](#11-rate-limiting-sur-apitrade)
12. [Endpoints API — détail complet](#12-endpoints-api--détail-complet)
13. [Middleware Next.js](#13-middleware-nextjs)
14. [Tests](#14-tests)
15. [Documentation](#15-documentation)

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
| Crons | **Vercel Cron Jobs** — voir contrainte de plan au [Point 9](#9-cron-sync-results--toutes-les-5-minutes) |

### Structure des dossiers

```
project-root/
├── schema.sql                 ← fichier SQL unique : tables, RPCs, index, seed game_config
│                                (à exécuter une seule fois dans l'éditeur SQL Supabase)
└── apps/
    └── web/
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
        │   ├── game-config.ts         ← lecture de game_config en DB
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
- Les paramètres métier (taux de taxe, dividendes, probabilités, etc.) sont lus depuis la table **`game_config`** et non hardcodés dans le code.
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

### Création — base de données from scratch

La base de données est créée **de zéro**, sans historique de migrations. Il n'existe pas de dossier de migrations ni de scripts numérotés.

Tout le schéma est défini dans un **fichier SQL unique** : `schema.sql` à la racine du projet.

Ce fichier contient dans l'ordre :
1. La création des tables
2. La création des index
3. La création des RPCs (`SECURITY DEFINER`)
4. La configuration RLS (Row Level Security)
5. L'insertion des valeurs par défaut de `game_config` (seed)

**Procédure d'initialisation :** ouvrir le projet Supabase → éditeur SQL → coller le contenu de `schema.sql` → exécuter. C'est la seule opération nécessaire pour initialiser la base.

### Tables principales

| Table | Rôle |
|-------|------|
| `game_config` | **Paramètres métier configurables** — clé/valeur JSON (voir [Point 4](#4-table-game_config--paramètres-métier-configurables)) |
| `competitions` | Compétitions (`is_active`, `league_id`, `season`, `last_sync_at`) |
| `teams` | Équipes nationales (`id`, `name`, `flag_emoji`, `logo_url`, `strength`, `confederation`) |
| `competition_teams` | Liaison équipe ↔ compétition (`group_code`, `initial_price`, `current_price`) |
| `competition_days` | Journées du calendrier (`day_index`, `phase`, `is_ko`, `div_key`) |
| `matches` | Matchs (`fixture_id`, `nation_a`, `nation_b`, `scheduled_at`, `api_status`, `processed_at`, `trade_lock_until`, `result_data` JSONB) |
| `competition_game_state` | État global par compétition (pools KO, `eliminated[]`, `champion_id`, `advancing` — verrou CAS) |
| `competition_prices` | Historique des prix indexé par `day_index` |
| `portfolios` | Portefeuille joueur (`cash`, `avg_cost` JSONB, `tx_log` JSONB, `best_score`, `guest_username`) |
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

### Colonne `guest_username` dans `portfolios`

| Colonne | Type | Contrainte | Description |
|---------|------|-----------|-------------|
| `guest_username` | `TEXT` | `UNIQUE`, nullable | Pseudo public choisi par un joueur guest. `NULL` si aucun pseudo n'a été renseigné. |

**Unicité globale des pseudos — règle métier fondamentale :**

Un pseudo doit être unique sur l'ensemble de la plateforme, qu'il soit détenu par un guest ou par un compte enregistré. Cette unicité est garantie à deux niveaux :

1. **Contrainte DB** : `UNIQUE` sur `portfolios.guest_username` d'une part, `UNIQUE` sur `profiles.username` d'autre part.
2. **Vérification applicative** : avant tout enregistrement d'un pseudo (guest ou compte), l'API vérifie simultanément les deux tables via `GET /api/auth/check-pseudo` (voir [5.8](#58-endpoints-auxiliaires)). Cette vérification est faite dans une transaction pour éviter les race conditions.

> **Pas de contrainte cross-table en DB :** PostgreSQL ne supporte pas nativement une contrainte UNIQUE qui s'étend sur deux tables distinctes. La cohérence est assurée côté applicatif dans `check-pseudo` + verrou optimiste à l'écriture. En cas de collision race condition (deux requêtes simultanées), la deuxième écriture retourne `USERNAME_TAKEN`.

---

### RPCs `SECURITY DEFINER`

| RPC | Rôle |
|-----|------|
| `execute_competition_trade` | Achat / vente atomique avec vérifications métier |
| `liquidate_competition_eliminated` | Liquide toutes les positions d'une équipe éliminée à 1 KC |
| `distribute_competition_dividends` | Crédite les dividendes sur les portefeuilles des détenteurs |
| `update_competition_prices` | Met à jour les prix courants + insère dans l'historique |
| `upsert_fixture` | Upsert de match sans jamais toucher `processed_at` / scores |
| `get_or_create_competition_portfolio` | Crée le portefeuille si inexistant, retourne son ID |

### Clients Supabase

```
lib/supabase/client.ts   → Client navigateur (clé anon, RLS activé)
lib/supabase/server.ts   → Client serveur (lit les cookies de session)
lib/supabase/admin.ts    → Client service_role (crons, RPCs — bypasse RLS)
```

---

## 4. Table `game_config` — Paramètres métier configurables

### Objectif

Tous les paramètres qui influencent la logique métier du jeu sont stockés dans la table `game_config`. Aucun d'entre eux n'est hardcodé dans le code applicatif. Cela permet à l'équipe produit de modifier les règles du jeu (taux de taxe, dividendes, probabilités de simulation, etc.) **sans modifier le code ni redéployer l'application**.

### Structure de la table

```sql
CREATE TABLE game_config (
  key         TEXT PRIMARY KEY,
  value       JSONB        NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);
```

- `key` : identifiant unique du paramètre (ex. `tax_rate_groups`)
- `value` : valeur stockée en JSONB (supporte nombres, chaînes, tableaux, objets)
- `description` : documentation humaine du paramètre
- `updated_at` : horodatage de la dernière modification (utile pour l'audit)

### Lecture côté application (`lib/game-config.ts`)

Un module dédié expose une fonction `getGameConfig()` qui :
1. Interroge la table `game_config` via le client admin Supabase
2. Retourne un objet typé avec toutes les valeurs
3. **Doit être appelée une seule fois par requête** (pas de cache en mémoire entre instances serverless — chaque invocation relit la DB)

> **Note sur le cache :** contrairement au cache Redis utilisé pour l'API-Football, les paramètres `game_config` ne sont **pas mis en cache** côté application. Leur lecture est peu fréquente (une fois par traitement de résultat, une fois par trade) et les valeurs doivent être toujours fraîches pour refléter immédiatement tout changement admin.

### Paramètres à stocker — valeurs par défaut et plages

#### Économie et trading

| Clé | Valeur par défaut | Plage | Description |
|-----|-------------------|-------|-------------|
| `init_cash` | `10000` | ≥ 0 | Capital initial de chaque joueur (KC) |
| `tax_rate_groups` | `0.10` | 0 – 1 | Taux de taxe phases groupes & R32 |
| `tax_rate_ko` | `0.05` | 0 – 1 | Taux de taxe phases KO (R16 → finale) |
| `min_tax` | `10` | ≥ 0 | Taxe minimale par transaction (KC) |
| `concentration_cap` | `0.40` | 0 – 1 | % max d'un actif dans le portefeuille (groupes/R32) |
| `eliminated_price` | `1` | ≥ 0 | Prix d'une équipe éliminée (KC) |

#### Dividendes par tour

| Clé | Valeur par défaut | Plage | Description |
|-----|-------------------|-------|-------------|
| `dividend_r32` | `0.10` | 0 – 1 | Taux dividende qualification 8es |
| `dividend_r16` | `0.15` | 0 – 1 | Taux dividende qualification 16es |
| `dividend_qf` | `0.20` | 0 – 1 | Taux dividende qualification quarts |
| `dividend_sf` | `0.30` | 0 – 1 | Taux dividende qualification demis |
| `dividend_final` | `0.40` | 0 – 1 | Taux dividende finalistes (les deux) |
| `dividend_champion` | `0.60` | 0 – 1 | Taux dividende vainqueur (en plus du taux final) |

#### Moteur de simulation — probabilités et seuils

| Clé | Valeur par défaut | Plage | Description |
|-----|-------------------|-------|-------------|
| `upset_prob_base` | `0.26` | 0 – 1 | Probabilité de surprise à écart de force nul |
| `upset_prob_decay` | `0.006` | 0 – 0.1 | Décroissance de la probabilité de surprise par point d'écart |
| `upset_prob_min` | `0.05` | 0 – 1 | Plancher de la probabilité de surprise |
| `draw_prob_base` | `0.25` | 0 – 1 | Probabilité de match nul à écart de force nul |
| `draw_prob_decay` | `0.004` | 0 – 0.1 | Décroissance de la probabilité de nul par point d'écart |
| `draw_prob_min` | `0.08` | 0 – 1 | Plancher de la probabilité de nul |
| `et_upset_base` | `0.35` | 0 – 1 | Probabilité de surprise en prolongation à écart nul |
| `et_upset_decay` | `0.008` | 0 – 0.1 | Décroissance de la surprise en prolongation par point d'écart |
| `et_upset_min` | `0.08` | 0 – 1 | Plancher de la surprise en prolongation |
| `et_prob` | `0.60` | 0 – 1 | Probabilité que le KO nul aille en prolongations (vs tirs au but) |
| `penalty_base_rate` | `0.73` | 0 – 1 | Taux de conversion de base par tir au but |
| `penalty_rate_per_str` | `0.001` | 0 – 0.01 | Bonus de conversion par point de force d'équipe |
| `penalty_max_rounds` | `10` | 1 – 20 | Maximum de rounds de mort subite |
| `upset_gap_sim` | `8` | ≥ 0 | Écart de force minimal pour qualifier une surprise en simulation |
| `upset_gap_live` | `5` | ≥ 0 | Écart de force minimal pour qualifier une surprise sur résultat réel |

#### Trading lock et fenêtres de match

| Clé | Valeur par défaut | Plage | Description |
|-----|-------------------|-------|-------------|
| `trade_lock_pre_match_min` | `15` | ≥ 0 | Minutes avant coup d'envoi où le trading est bloqué |
| `trade_lock_post_match_min` | `15` | ≥ 0 | Minutes après fin détectée où le trading reste bloqué |
| `match_window_offset_hours` | `3` | ≥ 0 | Fenêtre ±X heures pour déclencher le polling de résultats (voir [Point 9](#9-cron-sync-results--toutes-les-5-minutes)) |

#### UI et technique

| Clé | Valeur par défaut | Plage | Description |
|-----|-------------------|-------|-------------|
| `mobile_breakpoint_px` | `600` | ≥ 0 | Largeur seuil (px) mobile / desktop |
| `bootstrap_cache_ttl_hours` | `24` | ≥ 1 | Durée de validité du cache bootstrap offline (heures) |
| `max_transactions_history` | `100` | ≥ 10 | Nombre max de transactions conservées dans le log |
| `online_poll_interval_ms` | `30000` | ≥ 1000 | Fréquence de rafraîchissement fallback en mode online (ms) |

### Utilisation dans le code

Partout où un paramètre métier était précédemment hardcodé, il est remplacé par une lecture depuis `game_config` :

- `calcTax()` lit `tax_rate_groups`, `tax_rate_ko`, `min_tax`
- `simulate()` lit `upset_prob_base`, `draw_prob_base`, `et_prob`, `penalty_base_rate`, etc.
- `calcDividend()` lit `dividend_r32` … `dividend_champion` (remplace l'objet `DIV_RATES` statique)
- `processRealMatchResult()` lit `trade_lock_post_match_min`, `upset_gap_live`
- `execute_competition_trade` (RPC) lit `concentration_cap`, `eliminated_price`

### Seed initial

Les valeurs par défaut de `game_config` sont insérées directement dans `schema.sql`, à la suite de la définition de la table. Elles sont exécutées en même temps que le reste du schéma, en une seule passe. Il n'y a pas de script de seed séparé.

### Validation à l'écriture

Toute modification de `game_config` via l'admin panel doit être validée côté API (vérification des plages définies dans ce document) avant persistance.

---

## 5. Authentification & Gestion des identités

### Vue d'ensemble — trois modes d'identité coexistants

| Mode | Identifiant | Cookie session | Compte permanent |
|------|-------------|----------------|-----------------|
| **Guest** | `X-Device-ID` (UUID v4, localStorage) | Non | Non |
| **Email / Mot de passe** | `auth.users` Supabase | Oui (`HttpOnly`) | Oui |
| **Google OAuth** | `auth.users` Supabase | Oui (`HttpOnly`) | Oui |

Les trois modes coexistent sans friction. Un joueur commence toujours en mode guest et peut à tout moment se créer un compte permanent pour conserver son portfolio sur n'importe quel device.

---

### 5.1 Table `profiles` — extension de `auth.users`

La table `profiles` est créée dans `schema.sql`. Elle est liée à `auth.users` par une clé étrangère sur `id`.

**Colonnes :**

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | `UUID` (PK, FK → `auth.users.id`) | Même identifiant que l'utilisateur Supabase Auth |
| `username` | `TEXT UNIQUE` | Pseudo public choisi par le joueur |
| `country` | `TEXT` | Pays (optionnel, renseigné par le joueur) |
| `is_admin` | `BOOLEAN DEFAULT FALSE` | Rôle administrateur |
| `banned` | `BOOLEAN DEFAULT FALSE` | Joueur banni — bloqué sur tous les endpoints sensibles |
| `is_auto` | `BOOLEAN DEFAULT TRUE` | `TRUE` si le pseudo a été généré automatiquement (non choisi) |
| `created_at` | `TIMESTAMPTZ DEFAULT NOW()` | Date de création du profil |

**Trigger de création automatique :**

À chaque insertion dans `auth.users` (inscription email ou OAuth), un trigger PostgreSQL crée automatiquement la ligne correspondante dans `profiles` avec un pseudo généré (`player_XXXXX`). Le joueur peut ensuite personnaliser son pseudo via `POST /api/auth/set-username`.

```
Trigger : on INSERT on auth.users
→ INSERT INTO profiles (id, username, is_auto)
  VALUES (NEW.id, 'player_' || substr(NEW.id::text, 1, 5), TRUE)
```

Ce trigger est défini dans `schema.sql` et ne nécessite aucun code applicatif.

---

### 5.2 Endpoint `POST /api/auth/session` — création session guest

**Auth :** Aucune.

**Fonctionnement :**
1. Appeler `supabase.auth.signInAnonymously()`
2. Récupérer `access_token` et `refresh_token`
3. Poser un cookie `HttpOnly` nommé `session` contenant le refresh token
4. Répondre `{ "authenticated": true, "mode": "guest" }`

**Comportement si aucun cookie et aucun `X-Device-ID` :** le portfolio est créé par le RPC `get_or_create_competition_portfolio` en utilisant uniquement le `device_id` passé dans le header. Aucune session Supabase n'est obligatoire pour jouer.

**En cas d'échec :**
```json
{ "error": "Supabase unavailable" }
```
Statut HTTP `503`.

---

### 5.2b Endpoint `POST /api/auth/guest` — création / mise à jour du pseudo guest

**Auth :** Aucune (`X-Device-ID` requis dans le header).

**Rôle :** Permet à un joueur guest de se choisir un pseudo public, afin d'apparaître au leaderboard sous un nom lisible plutôt qu'un UUID. Peut aussi être appelé en mise à jour si le guest souhaite changer son pseudo (tant qu'il n'a pas de compte permanent).

**Body :**
```json
{
  "username": "MonPseudo"
}
```
`username` est **optionnel** — si absent ou vide, la requête crée simplement un portfolio sans pseudo (comportement identique à l'ancien `POST /api/auth/session`).

**Fonctionnement :**
1. Extraire `device_id` depuis le header `X-Device-ID` — `400` si absent
2. Valider `username` : 3–20 caractères, alphanumérique + tirets/underscores, pas de caractères spéciaux
3. Si `username` fourni → vérifier la disponibilité **dans les deux tables** :
   - `SELECT 1 FROM portfolios WHERE guest_username = $username`
   - `SELECT 1 FROM profiles WHERE username = $username`
   - Si l'un ou l'autre retourne une ligne → `422 USERNAME_TAKEN`
4. Chercher ou créer le portfolio lié à ce `device_id` via `get_or_create_competition_portfolio`
5. Si `username` fourni → `UPDATE portfolios SET guest_username = $username WHERE device_id = $device_id`
6. Répondre :

```json
{
  "ok": true,
  "device_id": "uuid-v4",
  "guest_username": "MonPseudo"
}
```

Si aucun `username` fourni :
```json
{
  "ok": true,
  "device_id": "uuid-v4",
  "guest_username": null
}
```

**Codes d'erreur :**

| Code | HTTP | Signification |
|------|------|---------------|
| `MISSING_DEVICE_ID` | 400 | Header `X-Device-ID` absent |
| `USERNAME_TAKEN` | 422 | Pseudo déjà pris (guest ou compte) |
| `INVALID_USERNAME` | 422 | Format invalide (longueur, caractères) |

---

### 5.3 Endpoint `POST /api/auth/register` — inscription email / mot de passe

**Auth :** Aucune.

**Body :**
```json
{
  "email": "joueur@example.com",
  "password": "motdepasse",
  "username": "MonPseudo",
  "device_id": "uuid-v4-du-device"
}
```

**Fonctionnement :**
1. Valider `email`, `password` (min 8 caractères), `username` (unique, 3–20 caractères, alphanumérique)
2. Vérifier la disponibilité du `username` via `GET /api/auth/check-pseudo`
3. Appeler `supabase.auth.signUp({ email, password })`
4. Le trigger crée automatiquement la ligne dans `profiles` avec un pseudo auto
5. Mettre à jour `profiles.username = username` et `profiles.is_auto = FALSE`
6. Si `device_id` fourni → proposer la migration guest (voir [5.6](#56-fusion-guest--compte-migration-du-portfolio))
7. Poser le cookie `HttpOnly` de session
8. Répondre `{ "ok": true, "userId": "...", "username": "..." }`

**Codes d'erreur (`422`) :**

| Code | Signification |
|------|---------------|
| `EMAIL_TAKEN` | Email déjà utilisé |
| `USERNAME_TAKEN` | Pseudo déjà pris |
| `INVALID_EMAIL` | Format email invalide |
| `WEAK_PASSWORD` | Mot de passe trop court ou trop simple |
| `INVALID_USERNAME` | Pseudo trop court, trop long ou caractères interdits |

---

### 5.4 Endpoint `POST /api/auth/login` — connexion email / mot de passe

**Auth :** Aucune.

**Body :**
```json
{
  "email": "joueur@example.com",
  "password": "motdepasse",
  "device_id": "uuid-v4-du-device"
}
```

**Fonctionnement :**
1. Appeler `supabase.auth.signInWithPassword({ email, password })`
2. Si erreur Supabase → retourner `401` avec message générique (ne pas préciser si c'est l'email ou le mot de passe qui est incorrect)
3. Vérifier que `profiles.banned !== true` — si banni → répondre `403 BANNED`
4. Si `device_id` fourni → proposer la migration guest (voir [5.6](#56-fusion-guest--compte-migration-du-portfolio))
5. Poser le cookie `HttpOnly` de session
6. Répondre `{ "ok": true, "userId": "...", "username": "..." }`

**Codes d'erreur :**

| Code | HTTP | Signification |
|------|------|---------------|
| `INVALID_CREDENTIALS` | 401 | Email ou mot de passe incorrect |
| `BANNED` | 403 | Compte banni |
| `INTERNAL_ERROR` | 500 | Erreur serveur |

---

### 5.5 OAuth Google — `GET /api/auth/google` + `GET /api/auth/callback/google`

#### `GET /api/auth/google` — initiation du flux OAuth

**Auth :** Aucune.

**Query params :** `?device_id=uuid-v4` (optionnel — pour la migration guest après connexion)

**Fonctionnement :**
1. Appeler `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '/api/auth/callback/google' } })`
2. Stocker le `device_id` dans un cookie temporaire `pending_device_id` (HttpOnly, TTL 5 minutes) pour le récupérer au callback
3. Retourner une redirection `302` vers l'URL OAuth Google fournie par Supabase

#### `GET /api/auth/callback/google` — traitement du retour OAuth

**Auth :** Aucune (appelé par Google après consentement utilisateur).

**Query params :** `code` et `state` fournis par Google via Supabase.

**Fonctionnement :**
1. Appeler `supabase.auth.exchangeCodeForSession(code)`
2. Récupérer le profil Google (email, nom, photo) depuis les métadonnées Supabase Auth
3. Si c'est la première connexion Google (profil `is_auto = TRUE`) → mettre à jour `profiles.username` depuis le nom Google (si disponible et unique)
4. Vérifier que `profiles.banned !== true` — si banni → rediriger vers `/banned`
5. Lire le cookie `pending_device_id` → si présent → déclencher la migration guest (voir [5.6](#56-fusion-guest--compte-migration-du-portfolio)), supprimer le cookie temporaire
6. Poser le cookie `HttpOnly` de session
7. Rediriger vers `/` (page d'accueil du jeu)

**En cas d'erreur OAuth :** rediriger vers `/?auth_error=true`.

---

### 5.6 Fusion guest → compte (migration du portfolio)

Quand un joueur guest se connecte ou s'inscrit pour la première fois avec un `device_id` actif, son portfolio guest peut être migré vers son compte permanent.

**Déclencheur :** présence d'un `device_id` dans le body (login/register) ou dans le cookie `pending_device_id` (OAuth callback).

**Logique de migration :**

```
1. Chercher les portfolios liés au device_id :
   SELECT id, guest_username FROM portfolios
   WHERE device_id = $device_id AND user_id IS NULL

2. Si portfolios trouvés :
   a. Récupérer le guest_username éventuel (premier portfolio non NULL)
   b. Mettre à jour : SET user_id = $userId, device_id = NULL, guest_username = NULL

3. Si le user possédait déjà des portfolios (reconnexion) :
   → Ne pas écraser — conserver le portfolio existant
   → Signaler au frontend qu'une fusion était disponible mais skippée

4. Répondre avec un champ "portfoliosMigrated: number" dans la réponse d'auth
```

**Migration du pseudo guest vers `profiles.username` :**

Lors de la migration des portfolios, si le guest avait un `guest_username` renseigné, ce pseudo doit être proposé ou automatiquement migré vers `profiles.username` selon les règles suivantes :

| Situation | Action |
|-----------|--------|
| `profiles.is_auto = TRUE` (pseudo auto, non choisi) ET `guest_username` disponible dans `profiles` | Écraser automatiquement : `UPDATE profiles SET username = $guest_username, is_auto = FALSE` |
| `profiles.is_auto = TRUE` ET `guest_username` déjà pris dans `profiles` (collision) | Conserver le pseudo auto, retourner `guestUsernameConflict: true` — le frontend propose au joueur de choisir un nouveau pseudo |
| `profiles.is_auto = FALSE` (l'utilisateur avait choisi un pseudo à l'inscription) | Ne pas écraser — retourner `guestUsername` dans la réponse pour info |

**Règle de conflit sur les portfolios :** si l'utilisateur a un portfolio existant (user_id déjà renseigné) ET un portfolio guest actif sur le même `competition_id`, la migration est skippée pour cette compétition et le frontend est informé. Pas de fusion automatique de portefeuilles — cela évite tout risque de corruption financière.

**Réponse enrichie après migration :**
```json
{
  "ok": true,
  "userId": "...",
  "username": "MonPseudo",
  "portfoliosMigrated": 2,
  "portfoliosSkipped": 0,
  "guestUsername": "MonPseudo",
  "guestUsernameConflict": false
}
```

---

### 5.7 Endpoint `POST /api/auth/logout` — déconnexion

**Auth :** Oui (cookie session obligatoire).

**Fonctionnement :**
1. Appeler `supabase.auth.signOut()`
2. Supprimer le cookie `session` (le poser avec `maxAge: 0`)
3. Répondre `{ "ok": true }`

Le `device_id` côté client n'est **pas effacé** par le logout — il reste en localStorage. Si le joueur rejoue en mode guest après déconnexion, son portfolio guest (s'il existe encore) sera accessible via son `device_id`.

---

### 5.8 Endpoints auxiliaires

#### `GET /api/auth/check-email`

Vérifie si un email est déjà enregistré (utilisé pendant la saisie du formulaire d'inscription).

**Query :** `?email=joueur@example.com`
**Réponse :** `{ "available": true }` ou `{ "available": false }`

#### `GET /api/auth/check-pseudo`

Vérifie si un pseudo est disponible **sur l'ensemble de la plateforme** — guests et comptes enregistrés confondus.

**Query :** `?username=MonPseudo`

**Logique :** interroge simultanément `portfolios.guest_username` ET `profiles.username` :
```
taken = EXISTS(SELECT 1 FROM portfolios WHERE guest_username = $username)
     OR EXISTS(SELECT 1 FROM profiles  WHERE username        = $username)
```

**Réponse :** `{ "available": true }` ou `{ "available": false }`

#### `POST /api/auth/set-username`

Permet à un joueur connecté de choisir ou modifier son pseudo (uniquement si `profiles.is_auto = TRUE` ou changement volontaire).

**Auth :** Oui (cookie session).
**Body :** `{ "username": "NouveauPseudo" }`
**Réponse :** `{ "ok": true, "username": "NouveauPseudo" }`

---

### 5.9 Protection des routes — règles de routage (voir Point 13 pour l'implémentation)

**Routes protégées — session cookie OU `X-Device-ID` acceptés :**
- `POST /api/trade`
- `GET /api/game/state`
- `POST /api/game/advance`

**Routes protégées — session cookie uniquement (compte permanent requis) :**
- `POST /api/auth/logout`
- `POST /api/auth/set-username`

**Routes publiques (aucune auth requise) :**
- `GET /api/health`
- `GET /api/competition/bootstrap`
- `GET /api/competition/list`
- `GET /api/matches`
- `GET /api/market`
- `GET /api/game/live-matches`
- `POST /api/auth/session`
- `POST /api/auth/guest`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/google`
- `GET /api/auth/callback/google`
- `GET /api/auth/check-email`
- `GET /api/auth/check-pseudo`

**Routes cron (protégées par `CRON_SECRET` uniquement) :**
- `GET /api/cron/sync-fixtures`
- `GET /api/cron/sync-results`

---

## 6. Structure des routes API

### Vue d'ensemble

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| `GET` | `/api/health` | Non | Sanity check du serveur |
| `POST` | `/api/auth/session` | Non | Création session guest anonyme Supabase |
| `POST` | `/api/auth/guest` | X-Device-ID | Choix / mise à jour du pseudo guest |
| `POST` | `/api/auth/register` | Non | Inscription email / mot de passe |
| `POST` | `/api/auth/login` | Non | Connexion email / mot de passe |
| `GET` | `/api/auth/google` | Non | Initiation flux OAuth Google |
| `GET` | `/api/auth/callback/google` | Non | Callback OAuth Google + pose du cookie session |
| `POST` | `/api/auth/logout` | Cookie session | Déconnexion + suppression du cookie |
| `GET` | `/api/auth/check-email` | Non | Vérifie disponibilité d'un email |
| `GET` | `/api/auth/check-pseudo` | Non | Vérifie disponibilité d'un pseudo |
| `POST` | `/api/auth/set-username` | Cookie session | Choix / modification du pseudo |
| `GET` | `/api/competition/bootstrap` | Non | Données offline (équipes, calendrier, fixtures) |
| `GET` | `/api/competition/list` | Non | Liste des compétitions disponibles |
| `GET` | `/api/game/state` | Cookie ou X-Device-ID | État complet du jeu + portefeuille joueur |
| `POST` | `/api/game/advance` | Cookie ou X-Device-ID | Simule la journée suivante |
| `GET` | `/api/game/live-matches` | Non | Matchs du jour avec statuts live |
| `GET` | `/api/matches` | Non | Matchs d'un `day_index` spécifique |
| `GET` | `/api/market` | Non | Données marché enrichies |
| `POST` | `/api/trade` | Cookie ou X-Device-ID | Exécute un achat ou une vente |
| `GET` | `/api/cron/sync-fixtures` | CRON_SECRET | Synchronise le calendrier depuis API-Football |
| `GET` | `/api/cron/sync-results` | CRON_SECRET | Traite les résultats réels terminés |

---

## 7. Service API-Football + Cache Redis

### Client Redis (`lib/redis.ts`)

```typescript
import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
```

### Module `lib/football-api.ts`

#### `fetchAllFixtures(leagueId, season)`

Appelle : `GET /fixtures?league={leagueId}&season={season}`

**Logique de cache :**
1. Clé Redis : `fixtures:{leagueId}:{season}`
2. Si présent → retourner immédiatement
3. Sinon → appeler l'API, stocker avec **TTL : 1 heure**

#### `fetchFinishedFixtures(leagueIds, season)`

Appelle : `GET /fixtures?league={leagueId}&season={season}&status=FT,AET,PEN`

**Logique de cache :**
1. Clé Redis : `finished:{leagueId}:{season}:{YYYYMMDD}`
2. Si présent → retourner immédiatement
3. Sinon → appeler l'API, stocker avec **TTL : 5 minutes**

#### Headers obligatoires sur chaque appel

```
x-rapidapi-key:  {API_FOOTBALL_KEY}
x-rapidapi-host: {API_FOOTBALL_HOST}
```

---

## 8. Cron `sync-fixtures` — quotidien

### Planification

```json
{
  "crons": [
    { "path": "/api/cron/sync-fixtures", "schedule": "0 6 * * *" }
  ]
}
```

**Fréquence :** une fois par jour à **06:00 UTC**.

**Sécurité :** vérification `Authorization: Bearer {CRON_SECRET}` en première ligne. Réponse `401` si absent ou invalide.

**Déclenchement manuel :**
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://your-app.vercel.app/api/cron/sync-fixtures
```

### Fonctionnement

Pour chaque compétition active (`is_active = true`) :

1. **Récupérer les fixtures** via `fetchAllFixtures(league_id, season)` — 1 appel API par compétition (depuis Redis si en cache)

2. **Dériver la `start_date`** depuis les fixtures (première date dans le set) — évite les incohérences de cache DB

3. **Normaliser chaque fixture** via `normalizeFixture(fixture, competition)`

4. **Upsert `teams`** — colonnes mises à jour : `name`, `logo_url`, `flag_emoji`, `api_team_id`
   **Jamais écraser** : `strength`, `initial_price` (configurés manuellement)

5. **Upsert `competition_teams`** — colonnes mises à jour : `group_code`
   **Jamais écraser** : `initial_price`, `current_price`

6. **Upsert `competition_days`** — `day_index`, `date_label`, `full_label`, `phase`, `is_ko`, `div_key`

7. **Upsert `matches`** via le RPC `upsert_fixture`
   - Colonnes mises à jour si report : `scheduled_at`, `api_status`, `league_round`, `venue`
   - **Jamais écraser** : `processed_at`, `score_a`, `score_b`, `trade_lock_until`, `result_data`

8. **Mettre à jour** `competitions.last_sync_at = NOW()`

### Gestion des erreurs

- Chaque upsert dans un `try/catch` individuel
- Erreur → logger + Sentry + continuer vers le fixture suivant
- Résumé retourné :

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

## 9. Cron `sync-results` — toutes les 5 minutes

### ⚠️ Contrainte Vercel Hobby

**Un cron toutes les 5 minutes (`*/5 * * * *`) n'est pas disponible sur le plan Vercel Hobby.**

Le plan Hobby limite les crons à une fréquence minimale de **1 fois par jour** (une seule tâche planifiée). Pour un cron toutes les 5 minutes, deux options sont possibles :

| Option | Description | Coût |
|--------|-------------|------|
| **Vercel Pro** | Crons Vercel natifs jusqu'à la minute | ~20 $/mois |
| **Service externe** | Cron as a service (EasyCron, cron-job.org, Render Cron Job) qui appelle l'endpoint `/api/cron/sync-results` avec le CRON_SECRET en header | Gratuit à ~1 $/mois |

> **Décision à prendre avant le déploiement.** Les deux options sont fonctionnellement équivalentes : l'endpoint reste identique, seul le déclencheur change. Le service externe est une solution valide et économique si Vercel Pro n'est pas souhaité.

### Planification (Vercel Pro ou service externe pointant vers le même endpoint)

```json
{
  "crons": [
    { "path": "/api/cron/sync-results", "schedule": "*/5 * * * *" }
  ]
}
```

**Sécurité :** même vérification `CRON_SECRET` qu'au Point 8.

### Budget API maîtrisé — deux mécanismes combinés

Malgré une fréquence de 5 minutes, le quota API-Football est préservé grâce à :
1. **`isMatchWindowActive()`** → court-circuit DB si aucun match n'est attendu (0 appel Redis, 0 appel API)
2. **Cache Redis TTL 5 minutes** → l'API n'est appelée qu'une fois même si le cron se déclenche plusieurs fois dans la fenêtre

### Fonction `isMatchWindowActive(competitionIds)`

Interroge la base de données :

```sql
SELECT COUNT(*) FROM matches
WHERE competition_id IN (...)
  AND processed_at IS NULL
  AND api_status NOT IN ('PST', 'SUSP', 'CANC', 'ABD')
  AND scheduled_at BETWEEN NOW() - INTERVAL '3 hours'
                       AND NOW() + INTERVAL '3 hours'
```

**Justification de la fenêtre ±3 heures :**

| Durée | Justification |
|-------|---------------|
| Avant le match : **3h** | Marge large pour couvrir les décalages d'horloge et la latence de `scheduled_at` en DB. Un match prévu à 20h doit être détecté dès 17h pour que la première passe du cron avant le coup d'envoi soit active. |
| Après le match : **3h** | Un match de 90 minutes + 30 minutes de prolongations + 30 minutes de tirs au but + temps d'arrêt = ~2h10 maximum. Le buffer de 3h garantit que le cron reste actif jusqu'au traitement final, même si l'API-Football est légèrement en retard à reporter le statut `FT`/`AET`/`PEN`. |

Cette fenêtre est lue depuis `game_config` via la clé `match_window_offset_hours` (valeur par défaut : `3`). Elle peut donc être ajustée sans redéploiement si nécessaire.

Si `isMatchWindowActive()` retourne `false` → répondre immédiatement :
```json
{ "skipped": true, "reason": "no active match window" }
```

### Fonctionnement complet

**Étape 1 :** `isMatchWindowActive(competitionIds)` — court-circuit si inactif

**Étape 2 :** `fetchFinishedFixtures(leagueIds, season)` — depuis Redis si disponible

**Étape 3 :** Pour chaque fixture avec `processed_at IS NULL` → `processRealMatchResult(fixtureId, fixture)`

**Étape 4 :** Pour chaque compétition → `checkAndAdvancePhase(competitionId)`

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

## 10. Moteur de jeu backend

### `applyResult(pA, pB, res)` — fonction pure

Aucun effet de bord. Retourne `[newPA, newPB]`.

```
Victoire A : newPA = pA + pB × 0.5     |  newPB = pB × 0.5
Victoire B : newPB = pB + pA × 0.5     |  newPA = pA × 0.5
Match nul  : newPA = pA + pB × 0.25    |  newPB = pB + pA × 0.25
```

Arrondi : `Math.round(x * 10) / 10`
Plancher : `Math.max(eliminated_price, rawPrice)` — `eliminated_price` lu depuis `game_config`

---

### `simulate(strA, strB, isKO, config)` — paramètres depuis `game_config`

Tous les paramètres probabilistes sont passés via l'objet `config` lu depuis `game_config` :

**Calcul des probabilités à 90 minutes :**

```
gap    = |strA - strB|
upsetP = max(config.upset_prob_min, config.upset_prob_base - gap × config.upset_prob_decay)
drawP  = max(config.draw_prob_min,  config.draw_prob_base  - gap × config.draw_prob_decay)
fav    = (strA ≥ strB) ? 'A' : 'B'
```

**Tirage du résultat 90 minutes :**

```
r = Math.random()
r < upsetP              → surprise (équipe non-favorite gagne)
r < upsetP + drawP      → match nul
sinon                   → favori gagne
```

**Si KO et nul à 90 minutes :**

```
Math.random() < config.et_prob → Prolongations
sinon                          → Tirs au but
```

**Prolongations :**

```
etUpsetP = max(config.et_upset_min, config.et_upset_base - gap × config.et_upset_decay)
```

**Tirs au but :**

```
convRate_A = config.penalty_base_rate + (strA × config.penalty_rate_per_str)
convRate_B = config.penalty_base_rate + (strB × config.penalty_rate_per_str)
Max config.penalty_max_rounds rounds de mort subite
```

**Définition d'une surprise (simulation) :**

```
isUpset = résultat ≠ 'draw'
       ET résultat ≠ favori
       ET gap > config.upset_gap_sim
```

---

### `calcTax(amount, price, isKO, config)` — paramètres depuis `game_config`

```
Si price ≤ config.eliminated_price → taxe = 0
Sinon → taxe = max(amount × (isKO ? config.tax_rate_ko : config.tax_rate_groups),
                   config.min_tax)
```

---

### `calcDividend(currentPrice, divKey, config)` — remplace `DIV_RATES` statique

```
Les taux de dividendes sont lus depuis game_config :
  divKey 'r32'      → config.dividend_r32
  divKey 'r16'      → config.dividend_r16
  divKey 'qf'       → config.dividend_qf
  divKey 'sf'       → config.dividend_sf
  divKey 'final'    → config.dividend_final
  divKey 'champion' → config.dividend_champion
  clé inconnue      → 0

dividende = round(currentPrice × rate × 10) / 10
```

---

### `processRealMatchResult(fixtureId, fixture)`

#### Idempotence

```sql
SELECT processed_at FROM matches WHERE fixture_id = $fixtureId
```
Si `processed_at IS NOT NULL` → sortir immédiatement (`return false`).

#### Détermination du résultat réel

```
Si statut === 'PEN' :
  penHome > penAway → 'A' | penAway > penHome → 'B'
Sinon :
  goals.home > goals.away → 'A'
  goals.away > goals.home → 'B'
  égalité                 → 'draw'
```

Statuts reconnus : `FT`, `AET`, `PEN`
Statuts ignorés : `PST`, `SUSP`, `CANC`, `ABD`

#### Détection d'upset (résultat réel)

```
isUpset = résultat ≠ 'draw'
       ET résultat ≠ favori
       ET gap > config.upset_gap_live   ← lu depuis game_config
```

#### Chaîne d'exécution complète

1. Charger le match via `fixture_id`
2. Vérifier idempotence → sortir si déjà traité
3. Charger les forces (`teams.strength`)
4. Lire `game_config` pour les paramètres nécessaires
5. `determineResult(fixture)` → `'A' | 'B' | 'draw'`
6. Charger les prix courants depuis `competition_teams`
7. `applyResult(pA, pB, res)` → `[newPA, newPB]`
8. RPC `update_competition_prices`
9. Si phase KO (hors `SF` et `3rd place`) → RPC `liquidate_competition_eliminated`
10. Si `day.div_key` et `winnerId` → RPC `distribute_competition_dividends` (taux lu depuis `game_config`)
11. Si phase `Final` et `loserId` → RPC `distribute_competition_dividends` (taux `final` depuis `game_config`)
12. Mettre à jour `matches` :
    - `score_a`, `score_b`, `winner_id`, `is_upset`, `played_at`, `processed_at = NOW()`
    - `trade_lock_until = NOW() + config.trade_lock_post_match_min minutes`
    - `result_data` (JSONB complet)

---

### `checkAndAdvancePhase(competitionId)`

Idempotente — sûre à appeler plusieurs fois.

1. Charger `competition_game_state`
2. Vérifier que tous les matchs du `current_day_index` ont `processed_at IS NOT NULL`
3. Si matchs en attente → sortir sans rien faire
4. Reconstituer les pools KO depuis les résultats du jour
5. Si dernier jour des groupes → `buildKOQualifiers()` + liquidation des non-qualifiés
6. Incrémenter `current_day_index`, mettre à jour `current_phase`, pools, `eliminated[]`, `champion_id`

#### `buildKOQualifiers(competitionId, allGroupResults, eliminated, nextPhase)`

Algorithme compétition-agnostique :

1. `totalSpots = (nb matchs de la phase suivante en DB) × 2`
2. Tri de chaque groupe : Points → Différence de buts → Buts marqués → Force FIFA
3. Top 2 de chaque groupe → qualifiés automatiques
4. Meilleurs 3es → complètent jusqu'à `totalSpots`
5. Tous les autres → `newEliminated`

---

## 11. Rate Limiting sur `/api/trade`

```
Clé :    rate:ip:{ip_address}   (Redis Upstash)
Limite : 10 requêtes
Fenêtre : 60 secondes
```

**Logique :**
```
ip    = x-forwarded-for ?? req.ip
count = redis.INCR("rate:ip:{ip}")
si count === 1 → redis.EXPIRE("rate:ip:{ip}", 60)
si count > 10  → retourner 429
```

**Réponse si limite dépassée :**
```json
{ "code": "RATE_LIMIT", "error": "Rate limit exceeded. Try again later." }
```

**Pourquoi Redis et non in-memory :** Vercel déploie les serverless functions sur plusieurs instances parallèles. Un `Map` in-process n'est pas partagé. Redis est la seule solution correcte en environnement multi-instance.

**Placement :** la vérification est la **première instruction** du handler `POST /api/trade`.

---

## 12. Endpoints API — détail complet

---

### `GET /api/health`

**Auth :** Aucune.

```json
{ "status": "ok", "ts": "2026-06-02T10:00:00.000Z" }
```

---

### `POST /api/auth/session`

**Auth :** Aucune.

**Réponse succès :** `{ "authenticated": true, "mode": "guest" }` + cookie `session` HttpOnly.
**Réponse échec :** `{ "error": "Supabase unavailable" }` — statut `503`.

---

### `POST /api/auth/guest`

**Auth :** `X-Device-ID` header requis.

**Body :** `{ "username": "MonPseudo" }` (optionnel)

**Réponse succès (avec pseudo) :**
```json
{ "ok": true, "device_id": "uuid-v4", "guest_username": "MonPseudo" }
```

**Réponse succès (sans pseudo) :**
```json
{ "ok": true, "device_id": "uuid-v4", "guest_username": null }
```

**Codes d'erreur :** `MISSING_DEVICE_ID` (400), `USERNAME_TAKEN` (422), `INVALID_USERNAME` (422).

---

### `POST /api/auth/register`

**Auth :** Aucune.

**Body :** `{ "email": "...", "password": "...", "username": "...", "device_id": "uuid" }`

**Réponse succès :**
```json
{ "ok": true, "userId": "...", "username": "...", "portfoliosMigrated": 1, "portfoliosSkipped": 0 }
```
Cookie `session` HttpOnly posé sur la réponse.

**Codes d'erreur (`422`) :** `EMAIL_TAKEN`, `USERNAME_TAKEN`, `INVALID_EMAIL`, `WEAK_PASSWORD`, `INVALID_USERNAME`.

---

### `POST /api/auth/login`

**Auth :** Aucune.

**Body :** `{ "email": "...", "password": "...", "device_id": "uuid" }`

**Réponse succès :**
```json
{ "ok": true, "userId": "...", "username": "...", "portfoliosMigrated": 0, "portfoliosSkipped": 0 }
```
Cookie `session` HttpOnly posé sur la réponse.

**Codes d'erreur :** `INVALID_CREDENTIALS` (401), `BANNED` (403).

---

### `GET /api/auth/google`

**Auth :** Aucune.

**Query :** `?device_id=uuid` (optionnel).

**Comportement :** stocke `device_id` dans un cookie temporaire `pending_device_id` (HttpOnly, TTL 5 min), retourne une redirection `302` vers l'URL OAuth Google générée par Supabase.

---

### `GET /api/auth/callback/google`

**Auth :** Aucune (appelé par Google).

**Comportement :** échange le `code` contre une session, crée le profil si première connexion, exécute la migration guest si `pending_device_id` présent, pose le cookie `session`, redirige vers `/`.

**Erreur :** redirection vers `/?auth_error=true`.

---

### `POST /api/auth/logout`

**Auth :** Cookie session obligatoire.

**Comportement :** `supabase.auth.signOut()` + suppression du cookie `session` (`maxAge: 0`). Le `device_id` localStorage côté client n'est pas affecté.

**Réponse :** `{ "ok": true }`

---

### `GET /api/auth/check-email`

**Auth :** Aucune.
**Query :** `?email=joueur@example.com`
**Réponse :** `{ "available": true }` ou `{ "available": false }`

---

### `GET /api/auth/check-pseudo`

**Auth :** Aucune.
**Query :** `?username=MonPseudo`
**Réponse :** `{ "available": true }` ou `{ "available": false }`

---

### `POST /api/auth/set-username`

**Auth :** Cookie session.
**Body :** `{ "username": "NouveauPseudo" }`
**Réponse succès :** `{ "ok": true, "username": "NouveauPseudo" }`
**Codes d'erreur :** `USERNAME_TAKEN`, `INVALID_USERNAME`.

---

### `GET /api/competition/bootstrap`

**Auth :** Aucune.
**Cache :** `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`
**Query :** `?competition_id=1` (optionnel — défaut : compétition active)

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

> Les fixtures KO ne sont **pas incluses** — inconnues avant la fin des groupes.

---

### `GET /api/competition/list`

**Auth :** Aucune.

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
**Headers :** `X-Competition-ID` (optionnel — défaut : compétition active).
**Cache conditionnel :** ETag `"c{competitionId}-d{dayIndex}-p{portfolioId}"` → `304` si identique.

```json
{
  "competitionId": 1,
  "dayIndex": 5,
  "phase": "Groups",
  "champion": null,
  "eliminated": [],
  "r32_pool": [], "r16_pool": [], "qf_pool": [], "sf_pool": [], "final_pool": [], "third_pool": [],
  "prices":       { "BRA": 212.5, "FRA": 200 },
  "priceHistory": { "BRA": [200, 212.5], "FRA": [200, 200] },
  "matchResults": { "0": [...] },
  "cash": 9800,
  "portfolio":    { "BRA": 2 },
  "avgCost":      { "BRA": 200 },
  "txLog":        [{ "dir": "buy", "flag": "🇧🇷", "name": "Brazil", "qty": 2, "price": 200, "day": 0 }],
  "bestScore":    10050,
  "guestUsername": "MonPseudo"
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
**CAS lock** sur `competition_game_state.advancing`.

**Body :** `{ "competitionId": 1, "dayIndex": 5 }`

**Réponse succès :**
```json
{
  "results": [...], "flash": { "BRA": "fu", "MAR": "fd" },
  "newDayIndex": 6, "newPhase": "Groups",
  "prices": { "BRA": 212.5 }, "eliminated": [],
  "r32_pool": [], "champion": null, "newCash": 9850
}
```

**Codes d'erreur :**
- `409` : `{ "advancing": true }` — avance déjà en cours
- `200` avec `{ "alreadyAdvanced": true }` — client en retard

---

### `GET /api/game/live-matches`

**Auth :** Aucune.

```json
{
  "matches": [
    {
      "fixture_id": 12345, "nation_a": "BRA", "nation_b": "MAR",
      "scheduled_at": "2026-06-13T19:00:00Z", "api_status": "1H",
      "score_a": 1, "score_b": 0,
      "trade_lock_until": "2026-06-13T21:15:00Z",
      "processed_at": null, "phase": "Groups", "venue": "MetLife, New York"
    }
  ],
  "teams": { "BRA": { "id": "BRA", "name": "Brazil", "flag_emoji": "🇧🇷" } }
}
```

---

### `GET /api/matches`

**Auth :** Aucune.
**Query :** `?day_index=5` (optionnel — défaut : `current_day_index`) + `?competition_id=1`

```json
{
  "day_index": 5, "phase": "Groups", "is_ko": false,
  "matches": [
    {
      "id": "m_...", "nation_a": "FRA", "nation_b": "SEN",
      "venue": "MetLife, New York", "scheduled_at": "2026-06-16T18:00:00Z",
      "api_status": "NS", "score_a": null, "score_b": null,
      "winner_id": null, "is_upset": false,
      "processed_at": null, "trade_lock_until": null, "result_data": null
    }
  ]
}
```

**Erreur si `day_index` invalide :** `400 Bad Request`.

---

### `GET /api/market`

**Auth :** Aucune.
**Query :** `?competition_id=1`

```json
{
  "teams": [
    { "id": "BRA", "name": "Brazil", "flag_emoji": "🇧🇷", "current_price": 212.5, "initial_price": 200, "pct_change": 6.3, "eliminated": false }
  ]
}
```

---

### `POST /api/trade`

**Auth :** Oui (cookie session).

**Body :** `{ "competitionId": 1, "nationId": "BRA", "mode": "buy", "quantity": 2 }`

**Vérifications dans l'ordre :**
1. Rate limit Redis
2. Paramètres valides
3. Session valide
4. RPC `execute_competition_trade` (SECURITY DEFINER, `FOR UPDATE`) — lit les paramètres depuis `game_config`

**Réponse succès :** `{ "ok": true, "newCash": 9600, "newHeld": 2, "price": 200, "fee": 0 }`

**Codes d'erreur (`422`) :**

| Code | Signification |
|------|---------------|
| `INSUFFICIENT_FUNDS` | Cash insuffisant |
| `NATION_ELIMINATED` | Équipe éliminée |
| `NOT_FOUND` | Quantité insuffisante |
| `CONCENTRATION_CAP` | Plafond dépassé |
| `RATE_LIMIT` | Trop de requêtes (429) |
| `INVALID_PARAMS` | Paramètres invalides |
| `INTERNAL_ERROR` | Erreur serveur |

---

## 13. Middleware Next.js

Fichier : `middleware.ts` à la racine.

### Deux niveaux de protection

Le middleware couvre deux catégories de routes avec des règles différentes.

#### Catégorie A — Cookie session OU `X-Device-ID` acceptés

Ce sont les routes de jeu : un joueur guest (device_id uniquement) et un joueur connecté (cookie session) doivent tous deux y accéder sans friction.

```
Matcher : ['/api/trade', '/api/game/state', '/api/game/advance']
```

**Logique :**
1. Lire le header `X-Device-ID`
2. Tenter `supabase.auth.getSession()` depuis les cookies
3. Si **au moins un** des deux est présent et valide → `NextResponse.next()`
4. Si les deux sont absents ou invalides → `401 Unauthorized`

**Résolution de l'identité dans les handlers :**
- Si cookie session valide → `userId` = `user.id` de la session Supabase
- Si uniquement `X-Device-ID` → `userId = null`, `deviceId` = valeur du header
- Le RPC `get_or_create_competition_portfolio` accepte les deux paramètres (`p_user_id` et `p_device_id`) — il résout le bon portfolio de façon transparente

#### Catégorie B — Cookie session uniquement (compte permanent requis)

Ce sont les routes qui nécessitent une identité persistante sur le serveur.

```
Matcher : ['/api/auth/logout', '/api/auth/set-username']
```

**Logique :**
1. `supabase.auth.getSession()` depuis les cookies
2. Pas de session valide → `401 Unauthorized`
3. Session valide → vérifier `profiles.banned !== true` → si banni → `403 FORBIDDEN`
4. `NextResponse.next()`

### Vérification du bannissement

Pour les routes de catégorie B, après validation de la session, le middleware interroge `profiles` :

```sql
SELECT banned FROM profiles WHERE id = $userId
```

Si `banned = TRUE` → `403 FORBIDDEN` avec `{ "code": "BANNED", "error": "Compte suspendu" }`.

> **Note :** la vérification du bannissement n'est pas faite sur les routes de catégorie A (jeu) pour éviter une requête DB supplémentaire sur chaque trade ou fetchState. Le bannissement sur ces routes est enforced dans les RPCs Supabase (`execute_competition_trade` vérifie le statut banni avant d'exécuter le trade).

### Routes non couvertes par le middleware (gestion dans les handlers)

Les routes cron vérifient elles-mêmes `CRON_SECRET` en première ligne de leur handler — le middleware ne les couvre pas.

---

## 14. Tests

### Framework : Vitest

### Fonctions pures (sans dépendance DB)

| Fonction | Cas à couvrir |
|----------|---------------|
| `applyResult` | Victoire A, victoire B, nul, prix asymétriques, plancher (eliminated_price) |
| `calcTax` | Groupes, KO, minimum, équipe éliminée (0%) |
| `calcDividend` | Tous les divKey (r32 → champion), clé inconnue → 0 |
| `simulate` | Pas de nul en KO, nul possible en groupes, favori gagne >70% sur grand écart |
| `genScore` | Nul groupe, victoire 90min, victoire ET, pénalties |

> Ces tests reçoivent les paramètres `config` directement en argument — aucun appel DB nécessaire.

### Tests d'intégration (Supabase local requis)

| Fonction | Cas à couvrir |
|----------|---------------|
| `processRealMatchResult` | Prix mis à jour, liquidation KO, dividende distribué, idempotence |
| `checkAndAdvancePhase` | Avancement si tous traités, blocage si matchs en attente |

### Commandes

```bash
pnpm --filter @kickstock/game-engine test
pnpm --filter @kickstock/game-engine test:watch
pnpm --filter @kickstock/game-engine test --coverage
```

---

## 15. Documentation

### Prérequis

- Node.js 18+
- pnpm 8+
- Compte Supabase
- Compte Upstash Redis
- Clé API-Football (RapidAPI)
- Vercel Pro **ou** service externe de cron (pour sync-results toutes les 5 min)

### Étapes d'installation

```bash
# 1. Installer les dépendances
pnpm install

# 2. Configurer les variables d'environnement
cp apps/web/.env.example apps/web/.env.local
# → remplir toutes les valeurs

# 3. Initialiser la base de données (from scratch, une seule fois)
#    → Ouvrir le projet Supabase dans le navigateur
#    → Aller dans SQL Editor
#    → Coller le contenu de schema.sql
#    → Cliquer Run
#    (crée les tables, RPCs, index et insère les valeurs par défaut de game_config)

# 4. Démarrer le serveur de développement
pnpm dev
```

### Commandes utiles

```bash
pnpm dev
pnpm build
pnpm --filter @kickstock/game-engine test

curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/sync-fixtures

curl -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/sync-results
```

---

## Récapitulatif des décisions architecturales

| Décision | Choix retenu | Raison |
|----------|-------------|--------|
| Framework | **Next.js 14 App Router** | Cohabitation frontend/backend, déploiement Vercel natif |
| Client DB | **Supabase JS SDK** exclusivement | Pas de `DATABASE_URL`, pas de `pg` direct |
| Paramètres métier | **Table `game_config`** (DB) | Aucun hardcoding — modifiable sans redéploiement |
| DIV_RATES | **Lus depuis `game_config`** | Remplace l'objet statique |
| Probabilités simulation | **Lus depuis `game_config`** | Configurables sans redéploiement |
| Cache API-Football | **Upstash Redis** — TTL 1h / 5min | Respecter le quota API |
| Fréquence sync-results | **5 minutes** | Réactivité maximale — nécessite Vercel Pro ou cron externe |
| Fenêtre `isMatchWindowActive` | **±3 heures** | Couvre 90min + 30min ET + 30min tirs + marge API |
| Rate limit | **Upstash Redis** partagé | Efficace en serverless multi-instance |
| Idempotence `/api/trade` | **Verrou DB** (`FOR UPDATE`) | Suffisant — pas d'Idempotency-Key |
| Auth | **Cookie HttpOnly** + Supabase Auth | Sécurité, refresh automatique |
| Crons | **Vercel Cron Jobs** (Pro) ou service externe | Natif ou fallback économique |
| Opérations critiques | **RPCs SECURITY DEFINER** | Atomicité garantie côté DB |
| Endpoint matchs | **`GET /api/matches?day_index=`** | Accès ciblé par journée |
| Route santé | **`GET /api/health`** | Monitoring et vérification de déploiement |
