# Rapport Critique — Plan Backend vs Backend KickStock Réel

> **Méthodologie** : chaque point du document `plan_backend_football_game.md` est comparé à l'implémentation réelle de KickStock. Verdict en 3 niveaux : ✅ **Implémenté** (présent et correct), ⚠️ **Divergent** (présent mais différemment), ❌ **Absent** (non implémenté ou remplacé par une autre approche).

---

## Point 1 — Backend nu (Node.js + Express + TypeScript)

### Ce que le plan dit
Initialiser un projet Node.js avec Express, TypeScript, `ts-node-dev`, script de dev, route `/health`, `.env` avec `dotenv`.

### Ce qui existe réellement
**⚠️ Divergent — architecture fondamentalement différente.**

KickStock n'utilise **pas Express**. Le backend est un **Next.js 14 App Router** (serverless) déployé sur **Vercel**. Chaque route API est un fichier `route.ts` dans `apps/web/app/api/`.

| Plan | Réalité |
|------|---------|
| Node.js + Express | Next.js App Router (serverless) |
| `ts-node-dev` | `next dev` |
| Route `/health` | **Absente** — pas de health check |
| `dotenv` manuel | Variables Vercel/Next.js natives |
| Serveur persistant | Functions serverless (cold start possible) |

### Critique
Le choix Next.js est **meilleur pour ce projet** : déploiement Vercel natif, pas de serveur à gérer, SSR disponible, Edge runtime possible. Express aurait nécessité un serveur dédié (Railway, Render, Fly.io) avec plus de complexité d'infra.

**Point manquant critique :** il n'existe **aucune route `/health`**. C'est un oubli réel — une route de santé est utile pour le monitoring et les checks de déploiement.

**Variable `DATABASE_URL` prévue dans `.env.example`** : non utilisée directement. KickStock utilise les SDK Supabase (`@supabase/supabase-js`) avec `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, pas une connexion `pg` directe.

---

## Point 2 — Base de données PostgreSQL

### Ce que le plan dit
Tables : `competitions`, `teams`, `competition_teams`, `competition_days`, `matches`, `portfolios`, `holdings`, `transactions`, `dividends`, `game_state`. Index sur FK, `scheduled_at`, `day_index`, `portfolio_id`.

### Ce qui existe réellement
**✅ Implémenté — et largement dépassé.**

Toutes les tables prévues existent. En plus, l'architecture DB est bien plus sophistiquée :

| Table prévue | Réalité |
|---|---|
| `competitions` | ✅ + champs `is_active`, `last_sync_at`, `league_id`, `season` |
| `teams` | ✅ + `api_team_id`, `logo_url`, `flag_emoji`, `confederation` |
| `competition_teams` | ✅ + `initial_price`, `current_price`, `group_code` |
| `competition_days` | ✅ + `is_ko`, `div_key`, `date_label`, `full_label` |
| `matches` | ✅ + `fixture_id`, `api_status`, `processed_at`, `trade_lock_until`, `result_data` (JSONB), `is_upset` |
| `portfolios` | ✅ + `avg_cost` (JSONB), `tx_log` (JSONB), `best_score` |
| `holdings` | ✅ scoped par `competition_id` |
| `transactions` | ✅ scoped par `competition_id` |
| `dividends` | ⚠️ dividendes distribués via RPC direct sur `portfolios.cash`, pas de table `dividends` séparée |
| `game_state` | ✅ → `competition_game_state` avec pools KO (r32, r16, qf, sf, final, third), `advancing` (CAS lock), `eliminated[]`, `champion_id` |

**Architecture supplémentaire non prévue :**
- `competition_prices` : historique des prix jour par jour (table dédiée)
- RPCs `SECURITY DEFINER` : `execute_competition_trade`, `liquidate_competition_eliminated`, `distribute_competition_dividends`, `update_competition_prices`, `upsert_fixture`, `get_or_create_competition_portfolio`
- Tout est **scoped par `competition_id`** → multi-compétition natif

### Critique
**L'absence de table `dividends`** est un choix discutable. La distribution est directement créditée sur `portfolios.cash` via RPC sans audit trail dédié. Si on veut un jour afficher l'historique des dividendes perçus par joueur, il faudra ajouter cette table. Le plan avait raison de la prévoir.

Les **RPCs SECURITY DEFINER** sont une excellente décision qui n'était pas dans le plan : toute la logique critique (trade, liquidation, dividendes) est atomique au niveau DB, impossible à contourner depuis le client.

---

## Point 3 — Authentification anonyme avec Supabase

### Ce que le plan dit
`POST /api/session` → `supabase.auth.signInAnonymously()` → cookie `HttpOnly` avec refresh token. Middleware qui lit le cookie, attache `req.user`.

### Ce qui existe réellement
**⚠️ Divergent — approche hybride device-ID + session optionnelle.**

Il n'existe **pas de `POST /api/session`** dans KickStock. L'authentification fonctionne sur un modèle différent :

| Plan | Réalité |
|---|---|
| Cookie HttpOnly avec refresh token | Header `X-Device-ID` (UUID v4) |
| `POST /api/session` obligatoire | Pas de session requise |
| `req.user` injecté par middleware | `userId` résolu optionnellement dans chaque route |
| Auth Supabase anonyme obligatoire | Auth Supabase = optionnel (upgrade vers compte permanent) |

**Fonctionnement réel :**
- Chaque device génère un UUID v4 côté client, stocké en localStorage
- Ce `X-Device-ID` identifie le joueur anonyme partout (trade, state, advance)
- Si l'utilisateur se connecte avec un compte Supabase, `userId` est aussi récupéré via `createServerClient()` + `getUser()`
- Le RPC `get_or_create_competition_portfolio` crée automatiquement le portefeuille si inexistant

**Routes auth existantes :**
- `POST /api/auth/guest` — création compte invité
- `POST /api/auth/set-username`
- `GET /api/auth/check-email`
- `GET /api/auth/check-pseudo`

### Critique
L'approche `X-Device-ID` est **plus pragmatique** que les cookies pour une app de jeu : pas de CSRF, fonctionne en cross-origin, simple à implémenter côté client. 

**Risque non adressé** : le `X-Device-ID` est validé par regex UUID v4 (`/^[0-9a-f]{8}-...$/`) mais n'est pas signé — un joueur peut usurper l'ID d'un autre s'il le connaît. Les RPCs en `SECURITY DEFINER` atténuent le risque car c'est la DB qui contrôle les mutations.

**Absence de middleware centralisé** : contrairement au plan, il n'y a pas de middleware Express/Next.js unique d'auth. Chaque route résout l'identité de manière indépendante (copier-coller de ~10 lignes dans chaque fichier). C'est une légère dette technique.

---

## Point 4 — Service API-Football (`footballApi.ts`)

### Ce que le plan dit
Module `footballApi.ts` avec `fetchFixtures()` et `fetchFinishedFixtures()`. Mise en cache Redis (TTL 1h fixtures, 5min résultats). Headers RapidAPI.

### Ce qui existe réellement
**⚠️ Divergent — module présent, Redis complètement absent.**

Le fichier `apps/web/lib/football-api.ts` existe avec les fonctions `fetchAllFixtures()` et `fetchFinishedFixtures()`. Mais :

| Plan | Réalité |
|---|---|
| `fetchFixtures(leagueId, season)` | `fetchAllFixtures(leagueId, season)` ✅ |
| `fetchFinishedFixtures(leagueIds, season)` | `fetchFinishedFixtures(leagueIds, season)` ✅ |
| Cache Redis TTL 1h pour fixtures | **❌ Pas de Redis du tout** |
| Cache Redis TTL 5min pour résultats | **❌ Pas de Redis du tout** |
| Headers RapidAPI | ✅ `x-rapidapi-key` + `x-rapidapi-host` |

**Stratégie de cache alternative réelle :**
- `sync-fixtures` tourne **1 fois par jour** → 1 seul appel API/jour → pas besoin de cache
- `sync-results` tourne toutes les **30 minutes** (pas 5min comme le plan) + `isMatchWindowActive()` court-circuite → très peu d'appels réels
- Le plan `s-maxage=3600` sur `/api/competition/bootstrap` remplace le cache Redis pour les données statiques

### Critique
**L'absence de Redis est un choix assumé et justifié** pour ce contexte :
- Budget API gratuit très limité → le vrai garde-fou est la fréquence du cron (30min) et `isMatchWindowActive()`
- Supabase remplace Redis pour la persistance des résultats
- Vercel Edge Cache (CDN) remplace Redis pour les endpoints publics

**Risque identifié** : si l'API Football répond lentement ou renvoie une erreur transitoire, il n'y a aucun fallback cache. Un appel qui échoue = données non mises à jour jusqu'au prochain cron. Acceptable sur Vercel Hobby, risqué en prod haute disponibilité.

**Le plan avait raison sur Redis** pour une architecture Node.js classique. Mais sur Vercel serverless, Redis Upstash aurait un coût non nul et une complexité additionnelle pour un gain limité.

---

## Point 5 — Cron `sync-fixtures` (daily)

### Ce que le plan dit
`node-cron` à `0 6 * * *`, fonction `syncFixtures()`, upserts individuels avec protection des colonnes critiques, résumé de logs.

### Ce qui existe réellement
**✅ Implémenté — avec des différences d'implémentation importantes.**

| Plan | Réalité |
|---|---|
| `node-cron` | **Vercel Cron** (dans `vercel.json`) |
| `0 6 * * *` UTC | ✅ identique |
| Déclenchement manuel | ✅ via header `Authorization: Bearer CRON_SECRET` |
| Upsert `teams` sans écraser `strength`/`initial_price` | ✅ colonnes exclues de l'upsert |
| Upsert `competition_teams` avec `group_code` | ✅ |
| Upsert `competition_days` | ✅ |
| Upsert `matches` sans toucher `processed_at`/scores | ✅ via RPC `upsert_fixture` (SQL SECURITY DEFINER) |
| Try/catch + résumé des erreurs | ✅ + Sentry |
| Nombre d'upserts / erreurs loggés | ✅ `{ upserted, skipped, error }` |

**Différences notables :**
- Le plan utilisait `.upsert()` JS classique. KickStock utilise un **RPC `upsert_fixture`** en SQL pur avec des colonnes explicitement protégées — c'est **plus sûr** car le client Supabase JS écrase toutes les colonnes par défaut
- `start_date` de la compétition est **dérivé dynamiquement** depuis les fixtures (première date) plutôt que depuis la DB — protection contre les incohérences de cache DB
- `last_sync_at` est mis à jour après chaque sync réussie

### Critique
**Implémentation meilleure que le plan** sur le point critique de la protection des colonnes : le RPC `upsert_fixture` est la bonne solution pour garantir que `processed_at`, `score_a`, `score_b` ne sont jamais écrasés.

**Point manquant** : le plan prévoyait de normaliser `strength` et `initial_price` à l'étape teams. Dans la réalité, ces valeurs sont configurées manuellement en DB par l'admin — elles ne viennent pas de l'API Football (qui ne les fournit pas). C'est correct métier, mais non documenté dans le code.

---

## Point 6 — Cron `sync-results` (toutes les 5 minutes)

### Ce que le plan dit
`node-cron` `*/5 * * * *`, `isMatchWindowActive()` sur fenêtre ±2.5h, récupère FT/AET/PEN, appelle `processRealMatchResult()` + `checkAndAdvancePhase()`.

### Ce qui existe réellement
**✅ Implémenté — fréquence délibérément réduite.**

| Plan | Réalité |
|---|---|
| Cron toutes les 5 minutes | **Cron toutes les 30 minutes** ⚠️ |
| `isMatchWindowActive()` ±2.5h | ✅ mais **±3h** dans la réalité |
| Statuts FT/AET/PEN | ✅ identique |
| `processRealMatchResult()` | ✅ dans `lib/process-real-result.ts` |
| `checkAndAdvancePhase()` | ✅ dans `lib/check-advance-phase.ts` |
| `processed_at = NOW()` après traitement | ✅ |
| `trade_lock_until = NOW() + 15min` | ✅ identique |

**Justification de la réduction à 30 minutes :**
Le commentaire dans le code l'explique explicitement :
```
Free plan budget: ~1 API call per run × 48 runs/day = ~48 calls/day max.
```
Le plan API Football gratuit a un quota limité. 5min = 288 appels/jour, ce qui dépasse le quota.

**`checkAndAdvancePhase()` — implémentation complète et correcte :**
1. Vérifie que tous les matchs du jour ont `processed_at IS NOT NULL`
2. Reconstitue les pools KO depuis les `result_data`
3. Sur dernier jour des groupes : `buildKOQualifiers()` + liquidation des non-qualifiés
4. Avance `current_day_index` + `current_phase` en DB

### Critique
**La réduction à 30 minutes est un compromis acceptable** mais crée une fenêtre où les prix ne sont pas mis à jour pendant jusqu'à 30 minutes après la fin d'un match. En jeu live, un joueur qui regarde la télé peut vouloir vendre juste après un résultat — il devra attendre.

**Risque non adressé** : si deux matchs se terminent dans la même fenêtre de 30 minutes et que l'un d'eux échoue à être traité (erreur réseau API), `checkAndAdvancePhase()` ne s'exécutera pas (pending > 0). Le jour ne s'avancera pas. Il manque un mécanisme de **retry** ou de **timeout** pour les matchs bloqués.

---

## Point 7 — Moteur de jeu backend

### Ce que le plan dit
`applyResult()` pure, `processRealMatchResult()` avec idempotence + liquidation + dividendes, `checkAndAdvancePhase()`.

### Ce qui existe réellement
**✅ Parfaitement implémenté — conforme au plan et bien au-delà.**

| Plan | Réalité |
|---|---|
| `applyResult(pA, pB, res)` pure | ✅ `packages/game-engine/src/applyResult.ts` — 100% pure |
| Idempotence sur `processed_at IS NULL` | ✅ guard en première ligne |
| Récupération prix depuis DB | ✅ `competition_teams.current_price` |
| Calcul résultat A/B/draw | ✅ + gestion `AET` / `PEN` avec `score.penalty` |
| Mise à jour prix + historique | ✅ via RPC `update_competition_prices` |
| `liquidateEliminated()` en KO | ✅ via RPC `liquidate_competition_eliminated` |
| Distribution dividendes par détenteur | ✅ via RPC `distribute_competition_dividends` |
| `checkAndAdvancePhase()` | ✅ complet et production-ready |

**Ce que le plan n'avait pas prévu mais qui existe :**
- Détection `isUpset` sur résultats réels (seuil `gap > 5`)
- `trade_lock_until = NOW() + 15min` pour bloquer le marché post-match
- `result_data` JSONB complet sauvegardé sur chaque match (rejouable)
- Gestion spéciale Finale : les **deux finalistes** reçoivent `final` + champion reçoit `champion` en plus

### Critique
**Implémentation exemplaire.** Le moteur de jeu est correctement séparé en package (`@kickstock/game-engine`), les fonctions sont pures, les effets de bord sont confinés aux RPCs. C'est précisément ce que le plan recommandait.

**Divergence sur les dividendes** : le plan parlait d'"ajouter des actions bonus selon le taux". Dans la réalité, les dividendes sont crédités en **cash KC**, pas en actions supplémentaires. C'est une décision métier importante — le plan était imprécis sur ce point.

---

## Point 8 — Rate Limiting sur `/api/trade`

### Ce que le plan dit
Redis (`ioredis` ou Upstash), clé `rate:ip:{ip}`, TTL 60 secondes, limite 10 req/minute, middleware Express, réponse 429.

### Ce qui existe réellement
**⚠️ Divergent — in-memory, sans Redis, paramètres différents.**

Fichier : `apps/web/lib/rateLimit.ts`

```typescript
const LIMIT     = 5;           // 5 requêtes (plan: 10)
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes (plan: 1 minute)
```

| Plan | Réalité |
|---|---|
| Redis (`ioredis` / Upstash) | **Map en mémoire** (in-process) |
| Clé `rate:ip:{ip}` | Clé = IP string dans Map locale |
| 10 req / 1 minute | **5 req / 10 minutes** |
| Middleware Express centralisé | Fonction `isRateLimited(ip)` appelée dans les routes |
| 429 avec message explicite | ✅ (géré dans les routes qui l'appellent) |

**Limitation majeure de l'approche in-memory :** Vercel déploie les functions en plusieurs instances parallèles. Chaque instance a sa propre Map. Un joueur peut envoyer 5 requêtes sur l'instance A et 5 sur l'instance B sans jamais être bloqué. Le rate limit **ne fonctionne pas en environnement multi-instance**.

### Critique
**C'est le point le plus faible du backend actuel.** Le plan avait raison sur Redis.

Pour Vercel serverless, la bonne solution est **Upstash Redis** (serverless Redis pay-per-request). Le coût est minimal (quelques centimes/mois pour ce volume) et cela résout le problème multi-instance.

**La limite de 5 req / 10 minutes est très restrictive** par rapport au plan (10/min). Un joueur légitimement actif pourrait acheter/vendre plusieurs équipes en moins de 10 minutes et se retrouver bloqué.

**Usage réel du rate limit dans le code :** la fonction `isRateLimited()` est disponible mais il faut vérifier si elle est réellement appelée dans `/api/trade/route.ts` — en l'état du fichier trade, je ne vois pas d'appel explicite à `isRateLimited()`. **Le rate limit pourrait ne pas être activé sur la route trade.**

---

## Point 9 — Idempotence sur `/api/trade`

### Ce que le plan dit
UUID côté client dans header `Idempotency-Key`, stockage Redis TTL 1h, si clé connue → retourner la réponse cachée sans retoucher la DB.

### Ce qui existe réellement
**❌ Absent — approche radicalement différente.**

Il n'y a **aucun mécanisme `Idempotency-Key`** dans KickStock. L'idempotence est gérée différemment, au niveau DB :

- Le trade est exécuté via le RPC `execute_competition_trade` avec un verrou `FOR UPDATE` sur la ligne de portefeuille
- La transaction DB est atomique : deux appels concurrents ne peuvent pas doubler un achat
- Il n'y a pas de déduplication basée sur un ID de requête

**Ce qui protège réellement des doubles trades :**
1. Verrou DB `FOR UPDATE` dans le RPC → sérialisation au niveau PostgreSQL
2. Vérification du solde/quantité dans le RPC → rejet si insuffisant après le premier trade

**Ce qui manque :**
- Protection contre les **clics doubles** côté client (réseau lent → le joueur reclique)
- Si deux requêtes identiques arrivent en même temps, la première passe, la deuxième peut aussi passer si le solde le permet

### Critique
**Le plan avait raison d'identifier ce besoin.** Un joueur qui clique deux fois sur "Acheter 10 ESP" en 200ms peut se retrouver avec 20 actions achetées.

Pour KickStock, la solution Redis du plan est correcte mais complexe. **Une solution plus simple** serait un debounce côté client (désactiver le bouton pendant 2 secondes après un trade) + vérification de solde insuffisant côté DB qui bloque le second appel si trop serré.

La vraie `Idempotency-Key` serait nécessaire pour une app financière réelle. Dans le contexte du jeu, l'impact est limité.

---

## Point 10 — Endpoints API

### Ce que le plan dit
`GET /api/game/state`, `GET /api/matches?day_index=`, `GET /api/competition/bootstrap`.

### Ce qui existe réellement
**✅ Deux sur trois implémentés, un absent, deux bonus non prévus.**

### `GET /api/game/state`
**✅ Implémenté et bien supérieur au plan.**

Le plan prévoyait un objet basique. La réalité :
- **7 requêtes parallèles** (`Promise.all`) pour minimiser la latence
- Retourne : état global + prix + historique des prix + résultats des matchs + portfolio + holdings + log de transactions
- Header `ETag` pour le cache conditionnel (`304 Not Modified` si rien n'a changé)
- Header `Cache-Control: private, no-cache`
- Identification par `X-Device-ID` ET `X-Competition-ID`
- Création automatique du portfolio si inexistant (`get_or_create_competition_portfolio`)

### `GET /api/matches?day_index=`
**❌ Absent sous cette forme.**

Il existe `GET /api/game/live-matches` (non analysé ici) mais pas de `GET /api/matches?day_index=`. Les matchs sont inclus dans `/api/game/state` (champ `matchResults`). La route dédiée n'a pas été jugée nécessaire.

### `GET /api/competition/bootstrap`
**✅ Implémenté et très bien conçu.**

Le plan prévoyait un endpoint basique. La réalité :
- Retourne : compétition + équipes (avec `strength`, `initial_price`, `flag_emoji`, `logo_url`, `confederation`) + journées + fixtures de groupes
- `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` → CDN Vercel Edge cache 1h
- Paramètre optionnel `?competition_id=` pour cibler une compétition spécifique
- Fallback sur compétition active (`is_active = true`) si pas de paramètre
- KO fixtures délibérément exclus (inconnus avant fin des groupes)

**Endpoints bonus non prévus dans le plan :**
- `POST /api/game/advance` — simulation manuelle d'une journée (mode offline)
- `POST /api/admin/simulate-day` — simulation admin
- `POST /api/market` — données marché enrichies
- `GET /api/competition/list` — liste des compétitions disponibles

---

## Synthèse Globale

### Ce que le plan a bien anticipé ✅
| Point | Note |
|-------|------|
| Architecture DB multi-tables | Structure correcte, réalité plus riche |
| Protection colonnes critiques dans sync-fixtures | Bien vu, implémenté via RPC |
| isMatchWindowActive() | Implémenté, fenêtre légèrement différente |
| processRealMatchResult() idempotent | Parfaitement implémenté |
| checkAndAdvancePhase() | Complet et production-ready |
| applyResult() fonction pure | Respecté |
| Bootstrap endpoint | Implémenté avec CDN cache en plus |
| /api/game/state complet | Au-delà des attentes (7 fetches parallèles + ETag) |

### Ce que le plan a mal évalué ⚠️
| Point | Écart |
|-------|-------|
| Node.js + Express | KickStock est Next.js serverless — meilleur choix |
| Cron 5 minutes pour sync-results | 30 minutes en réalité (budget API) |
| Redis pour cache API Football | Non nécessaire avec cron peu fréquent |
| Cookie HttpOnly pour auth | X-Device-ID + Supabase optionnel — plus simple |
| Dividendes = actions bonus | Dividendes = cash KC — décision métier différente |
| Rate limit 10 req/60s | 5 req/10min en mémoire — non adapté multi-instance |

### Ce que le plan a manqué ❌ (présent dans KickStock mais non prévu)
| Point |
|-------|
| Architecture multi-compétition (competition-scoped) |
| RPCs SECURITY DEFINER pour opérations atomiques |
| CAS Lock sur game_state (anti-concurrence) |
| ETag sur /api/game/state (304 Not Modified) |
| Sentry pour le monitoring d'erreurs |
| table `competition_prices` (historique jour par jour) |
| `result_data` JSONB complet sauvegardé sur chaque match |
| Mode simulation admin distinct du mode live |
| Filtrage `api_status` (PST/SUSP/CANC/ABD) |
| `trade_lock_until` sur chaque match |

### Ce que le plan avait prévu et qui manque vraiment dans KickStock ❌
| Point manquant | Impact |
|----------------|--------|
| Route `/health` | Faible — utile pour monitoring |
| Rate limit Redis partagé | **Élevé** — le rate limit actuel in-memory ne fonctionne pas en multi-instance Vercel |
| Idempotency-Key sur /api/trade | Moyen — risque double-trade sur mauvaise connexion réseau |
| Table `dividends` dédiée | Faible — pas d'historique dividendes par joueur possible actuellement |
| `GET /api/matches?day_index=` | Faible — données disponibles via /api/game/state |

---

## Recommandations Prioritaires

### 1. 🔴 Rate limit Redis (urgent)
Remplacer le `Map` in-memory par **Upstash Redis**. Le rate limit actuel est inefficace sur Vercel. Coût : ~0$/mois sur le plan gratuit Upstash.

### 2. 🟠 Debounce / protection double-trade (moyen terme)
Ajouter côté client un UUID par tentative de trade + vérification Redis simple. Ou a minima, désactiver le bouton côté UI pendant 2 secondes après un trade.

### 3. 🟡 Route `/health` (faible priorité)
Ajouter `GET /api/health` → `{ status: "ok", ts: ... }`. 5 lignes de code.

### 4. 🟡 Table `dividends` (faible priorité)
Ajouter une table d'audit des dividendes perçus si une feature "historique des gains" est prévue.

### 5. 🟡 Middleware auth centralisé (faible priorité)
Extraire les 10 lignes de résolution userId/deviceId répétées dans chaque route en un helper `resolvePlayer(req)`.
