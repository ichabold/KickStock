# KICKSTOCK — CAHIER DE TESTS COMPLET
**Version :** 3.1.0  
**Date :** 2026-06-20  
**Périmètre :** Monorepo Phase 2 — `apps/web` · `packages/*` · Base de données Supabase · Crons API-Football  
**Méthode :** Tests unitaires · Tests d'intégration · Tests de bout en bout · Audit sécurité · QA UI/UX

> **Changelog v3.1 vs v3.0** *(2026-06-20)*
> - **Cron `live-poll`** (`*/2 * * * *`, 24/7) ajouté dans `vercel.json` — met à jour les scores en DB, remplace les appels API-Football à chaque requête dans `/api/game/live-matches`. `sync-results` retiré de `vercel.json`, relégué en filet de sécurité GitHub Actions.
> - **Scores en direct sur Schedule tab (mobile & desktop)** — `liveMatches` du store affiché dans `ScheduleTab` et BrowserShell Home, avec badge 🔒 trade lock.
> - **Classement Online** — nouvelle route `/api/leaderboard/online`, `RankingPanel` avec deux onglets (Online / Offline), hook `useOnlineRanking`.
> - **`FirstTradeUpsellModal`** — s'affiche une seule fois après le premier achat d'un invité.
> - **Migration 024 `trade_lock_until` basé sur `scheduled_at`** — le blocage côté DB est anticipé avant `api_status = '1H'` (améliore la faille FAILLE-TRADE-LOCK-1, partiellement).
> - **Faille ouverte — FAILLE-TRADE-LOCK-1 :** fenêtre de 0–2 min entre le coup d'envoi réel et le prochain tick du cron live-poll (voir TRADE_LOCK_AUDIT.md).
>
> **Changelog v3.0 vs v2.0** *(2026-05-31)*
> - Le mode par défaut est désormais **`online`** (`localStorage('kickstock:mode')` absent → `'online'`). La v2.0 supposait à tort le mode offline par défaut.
> - `onlineGameStore` entièrement implémenté : Supabase Realtime WebSocket + fallback poll 30 s, `loadBootstrap()`, `trade()` via `/api/trade`, `advanceDay()` via `/api/game/advance`.
> - Pipeline de résultats réels : `sync-fixtures` (cron quotidien), `sync-results` (cron 30 min), `processRealMatchResult()`, `checkAndAdvancePhase()`, `isMatchWindowActive()`.
> - Nouveau composant `LiveTab` (remplace `SimulateTab` en mode online) + route `/api/game/live-matches`.
> - Bootstrap : `/api/competition/bootstrap` remplace les constantes `NATIONS`/`CALENDAR` en mode online ; cache localStorage 24 h.
> - **Bug documenté 🔴 :** `onlineGameStore.trade()` ligne 213 — taux de taxe inversés (`isKO ? 0.10 : 0.05` au lieu de `isKO ? 0.05 : 0.10`), minimum 10 KC absent.

---

## TABLE DES MATIÈRES

1. [Infrastructure & Repo](#1-infrastructure--repo)
2. [Sécurité & Isolation](#2-sécurité--isolation)
3. [Tests Fonctionnels Métier](#3-tests-fonctionnels-métier)
4. [Compatibilité UI/UX](#4-compatibilité-uiux)

> **Routes API couvertes (v3.1) :**  
> `/api/trade` · `/api/game/state` · `/api/game/advance` · `/api/game/live-matches`  
> `/api/competition/bootstrap` · `/api/competition/list`  
> `/api/auth/guest` · `/api/auth/check-pseudo` · `/api/auth/check-email` · `/api/auth/set-username` · `/api/auth/guest-status`  
> `/api/cron/sync-fixtures` · `/api/cron/sync-results` · `/api/cron/live-poll` · `/api/cron/sync-schedule` · `/api/cron/sync-squads`  
> `/api/leaderboard/online`  
> `/api/admin/competitions/*`

---

## Conventions

| Statut | Signification |
|--------|---------------|
| `[ ]` | Non exécuté |
| `[x]` | Passé |
| `[!]` | Échoué — anomalie ouverte |
| `[~]` | Partiellement validé |

**Sévérités :**
- 🔴 **BLOQUANT** — mise en production interdite
- 🟠 **MAJEUR** — à corriger avant release
- 🟡 **MINEUR** — suivi post-release acceptable
- 🔵 **COSMÉTIQUE** — aucun impact fonctionnel

---

## 1. INFRASTRUCTURE & REPO

### 1.1 Structure du monorepo

#### 1.1.1 Arbre des packages

```bash
pnpm ls -r --depth 0
```

**Résultat attendu :**
```
kickstock (root)
├── web                    @ apps/web
├── @kickstock/constants   @ packages/constants
├── @kickstock/game-engine @ packages/game-engine
└── @kickstock/types       @ packages/types
```

---

#### 1.1.2 Acyclicité du graphe de dépendances

**Hiérarchie obligatoire :**
```
@kickstock/types  →  @kickstock/constants  →  @kickstock/game-engine  →  apps/web
```

```bash
grep -r "@kickstock/" packages/types/src/
grep -r "@kickstock/game-engine" packages/constants/src/
grep -r "from 'apps/" packages/game-engine/src/
```

**Résultat attendu :** Aucune ligne retournée.

---

#### 1.1.3 Type-check global

```bash
pnpm -r type-check
```
**Résultat attendu :** `0 errors` pour chaque workspace.

---

#### 1.1.4 Compilabilité par package

```bash
pnpm --filter @kickstock/types build
pnpm --filter @kickstock/constants build
pnpm --filter @kickstock/game-engine build
```
**Résultat attendu :** Exit code `0` pour chaque commande indépendamment.

---

#### 1.1.5 Cohérence `DIV_RATES` / `INIT_CASH` entre TS et SQL

**Référence `packages/constants/src/index.ts` :**
```typescript
DIV_RATES = { r32:0.10, r16:0.15, qf:0.20, sf:0.30, final:0.40, champion:0.60 }
INIT_CASH = 10_000
```

Vérifier dans `db/FULL_SETUP.sql` que `distribute_dividends` reçoit `p_rate = DIV_RATES[round]` et que `get_or_create_portfolio` initialise `cash = 10000`.

---

#### 1.1.6 Sélection du store selon `localStorage('kickstock:mode')`

| `kickstock:mode` | Store monté | Comportement |
|-----------------|-------------|--------------|
| `'online'` (ou absent) | `onlineGameStore` | Appels API `/api/trade`, `/api/game/advance`, Realtime Supabase |
| `'offline'` | `localGameStore` | Tout en localStorage, simulation client-side |

**Procédure :** Ouvrir l'application sur un navigateur vierge (aucune clé `kickstock:mode` en localStorage). Vérifier que `getGameModeSync()` retourne `'online'` et que `onlineGameStore` est actif.

---

### 1.2 Pipeline CI

#### 1.2.1 Linting global

```bash
pnpm lint
```
**Résultat attendu :** Zéro erreur, exit code `0`.

---

#### 1.2.2 Build de production

```bash
pnpm build
```

**Résultat attendu :**
- `✓ Compiled successfully`
- Toutes les routes API apparaissent avec le flag `(Dynamic)` :
  `/api/trade`, `/api/game/state`, `/api/game/advance`, `/api/game/live-matches`,
  `/api/competition/bootstrap`, `/api/competition/list`,
  `/api/auth/guest`, `/api/auth/check-pseudo`, `/api/auth/check-email`, `/api/auth/set-username`, `/api/auth/guest-status`,
  `/api/cron/sync-fixtures`, `/api/cron/sync-results`, `/api/cron/live-poll`, `/api/cron/sync-schedule`, `/api/cron/sync-squads`,
  `/api/leaderboard/online`
- `export const maxDuration = 60` visible sur `/api/game/advance`, `/api/cron/sync-fixtures`, `/api/cron/sync-results`
- `export const maxDuration = 30` visible sur `/api/cron/live-poll`

---

### 1.3 Tests unitaires `@kickstock/game-engine`

#### 1.3.1 Suite existante (`engine.test.ts`)

```bash
pnpm --filter @kickstock/game-engine test
```

| Suite | Cas | Input | Attendu |
|-------|-----|-------|---------|
| `applyResult` | Victoire A symétrique | `(100, 100, 'A')` | `[150, 50]` |
| `applyResult` | Match nul | `(100, 100, 'draw')` | `[125, 125]` |
| `applyResult` | Victoire A asymétrique | `(200, 50, 'A')` | `[225, 25]` |
| `applyResult` | Prix plancher | `(1000, 10, 'A')` | `nB >= 1` |
| `calcTax` | Groupes 10% min 10 KC | `(200, 100, false)` | `20` |
| `calcTax` | Groupes minimum | `(50, 50, false)` | `10` |
| `calcTax` | KO 5% min 10 KC | `(200, 100, true)` | `10` |
| `calcTax` | KO au-dessus du min | `(300, 100, true)` | `15` |
| `calcTax` | Nation éliminée (price=1) | `(100, 1, false)` | `0` |
| `calcDividend` | R32 10% | `(200, 'r32')` | `20` |
| `calcDividend` | Champion 60% | `(500, 'champion')` | `300` |
| `calcDividend` | Clé inconnue | `(100, 'unknown')` | `0` |
| `simulate` | KO : jamais de draw | 50 itérations `isKO=true` | `'A'` ou `'B'` |
| `simulate` | Groupes : draw possible | 200 itérations forces égales | Set contient `'draw'` |
| `simulate` | Favori gagne > 70% | 1000 itérations `str=95 vs 40` | `favWins > 700` |

---

#### 1.3.2 Cas manquants à ajouter

| Fonction | Cas | Justification |
|----------|-----|---------------|
| `applyResult` | Arrondi 1 décimale | `applyResult(33, 17, 'A')` → vérifie `Math.round(x*10)/10` |
| `calcTax` | `price = 0` | Doit retourner `0` comme `price <= 1` |
| `calcDividend` | Arrondi | `calcDividend(33, 'r32')` → `3.3` exactement |
| `deriveGroupStandings` | Tri multi-critères | Égalité points → goal difference → buts marqués |
| `buildR32Pool` | 32 équipes uniques | Retourne exactement 32 entrées sans doublon |

---

## 2. SÉCURITÉ & ISOLATION

### 2.1 Inventaire des vulnérabilités

| ID | Titre | Sévérité | Statut |
|----|-------|----------|--------|
| CRITIQUE-1 | `/api/game/advance` sans auth | 🔴 BLOQUANT | **Non corrigé** |
| CRITIQUE-2 | RLS `portfolios_select_device` expose tous les portfolios anonymes | 🔴 BLOQUANT | **À vérifier en base** |
| HAUTE-1 | UUID v4 non validé dans `/api/trade` | 🟠 MAJEUR | **Partiellement corrigé** — validé dans `/api/game/state` et `/api/auth/guest` seulement |
| HAUTE-2 | Vue `leaderboard` expose `portfolios.id` | 🟠 MAJEUR | **À vérifier en base** |
| MOYENNE | Messages d'erreur internes côté client | 🟡 MINEUR | **Corrigé** ✅ |
| BUG-TAX-ONLINE | `onlineGameStore` taux de taxe inversés | 🔴 BLOQUANT | **Corrigé** ✅ — `stores/onlineGameStore.ts` |

> **Règle de release :** CRITIQUE-1 et CRITIQUE-2 doivent être corrigés avant toute mise en production.

---

### 2.2 Tests RLS Supabase

> **Prérequis :** `UID_A`, `UID_B` en staging avec portfolios initialisés et au moins une position.

#### RLS-01 — Isolation lecture `portfolios`

```javascript
const { data } = await sbB.from('portfolios').select('*').eq('user_id', UID_A);
// Attendu : data = []
```
> ⚠️ **CRITIQUE-2 :** Si `portfolios_select_device` est toujours active, ce test échoue — tous les portfolios anonymes sont lisibles.

---

#### RLS-02 — Isolation `positions`

```javascript
const { data } = await sbB.from('positions').select('*').eq('user_id', UID_A);
// Attendu : data = []
```

---

#### RLS-03 — Isolation `transactions`

```javascript
const { data } = await sbB.from('transactions').select('*').eq('portfolio_id', PORTFOLIO_ID_A);
// Attendu : data = []
```

---

#### RLS-04 — Tentative de modification du portfolio d'autrui

```javascript
const { data } = await sbB.from('portfolios').update({ cash: 9999999 }).eq('user_id', UID_A);
// Attendu : data = [] — 0 ligne modifiée
```

---

#### RLS-05 — INSERT de trade au nom d'autrui

```javascript
const { error } = await sbB.from('trades').insert({
  user_id: UID_A, nation_id: 'BRA', mode: 'sell',
  quantity: 100, price: 200, tax: 0, net_amount: 20000, day_index: 5,
});
// Attendu : error non null (42501) ou 0 ligne insérée
```

---

#### RLS-06 — Isolation `dividends`

```javascript
const { data } = await sbB.from('dividends').select('*').eq('portfolio_id', PORTFOLIO_ID_A);
// Attendu : data = []
```

---

#### RLS-07 — Isolation `holdings`

```javascript
const { data } = await sbB.from('holdings').select('*').eq('portfolio_id', PORTFOLIO_ID_A);
// Attendu : data = []
```

---

#### RLS-08 — Lectures publiques

```javascript
const publicTables = ['nations','price_history','game_state','nation_prices',
                      'group_standings','knockout_pools','matches','groups'];
for (const t of publicTables) {
  const { data, error } = await sbAnon.from(t).select('*').limit(1);
  // data non null, error null
}
const privateTables = ['portfolios','positions','trades','holdings',
                       'transactions','dividends','profiles'];
for (const t of privateTables) {
  const { data } = await sbAnon.from(t).select('*').limit(5);
  // data = []
}
```

---

#### RLS-09 — Vue `leaderboard` — absence de `portfolios.id`

```javascript
const { data } = await sbAnon.from('leaderboard').select('*');
// Colonnes attendues : username, country, best_score, updated_at
// p.id (UUID portfolio) absent
```

```sql
-- Vérification SQL
SELECT column_name FROM information_schema.columns
WHERE table_name = 'leaderboard' ORDER BY ordinal_position;
```

---

#### RLS-10 — `competitions` réservé aux authentifiés

```javascript
const { data } = await sbAnon.from('competitions').select('*');
// Attendu : data = []
```

---

### 2.3 Crons — sécurité et authentification

#### SEC-CRON-01 — `sync-fixtures` : rejet sans `CRON_SECRET`

```bash
# Sans Authorization
curl -s https://kickstock.app/api/cron/sync-fixtures
# Attendu : HTTP 401, { "error": "Unauthorized" }

# Faux secret
curl -s https://kickstock.app/api/cron/sync-fixtures \
  -H "Authorization: Bearer mauvais-secret"
# Attendu : HTTP 401
```

---

#### SEC-CRON-02 — `sync-results` : rejet sans `CRON_SECRET`

```bash
curl -s https://kickstock.app/api/cron/sync-results
# Attendu : HTTP 401, { "error": "Unauthorized" }
```

---

#### SEC-CRON-03 — `live-poll` : rejet sans `CRON_SECRET`

```bash
# Sans Authorization
curl -s https://kick-stock-web.vercel.app/api/cron/live-poll
# Attendu : HTTP 401, { "error": "Unauthorized" }

# Faux secret
curl -s https://kick-stock-web.vercel.app/api/cron/live-poll \
  -H "Authorization: Bearer mauvais-secret"
# Attendu : HTTP 401
```

---

#### SEC-CRON-04 — `live-poll` : court-circuit hors fenêtre de match

```bash
# Appel hors créneau (aucun match dans ±3h)
curl -s https://kick-stock-web.vercel.app/api/cron/live-poll \
  -H "Authorization: Bearer $CRON_SECRET"
# Attendu (hors créneau) : { "skipped": true, "reason": "no active match window" }
```

**Vérifier :** 0 appel à API-Football consommé.

---

#### SEC-CRON-05 — `live-poll ?force=1` : bypass de la smart-window

```bash
curl -s "https://kick-stock-web.vercel.app/api/cron/live-poll?force=1" \
  -H "Authorization: Bearer $CRON_SECRET"
# Attendu : { "ok": true, "liveUpdated": N, "processed": M }
```

**Usage :** Tests admin uniquement — ne pas activer en prod hors créneau (appels API inutiles).

---

#### SEC-ADVANCE-01 — `/api/game/advance` sans authentification (CRITIQUE-1)

```bash
curl -s -X POST https://kickstock.app/api/game/advance \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: $(uuidgen | tr 'A-F' 'a-f')" \
  -d '{"dayIndex": 0}'
# Résultat actuel : HTTP 200, le jeu avance (VULNÉRABLE)
# Résultat attendu après correctif : HTTP 401
```

---

### 2.4 Sécurité API Trade

#### SEC-TRADE-01 — Validation UUID v4 dans `/api/trade` (HAUTE-1)

```bash
# UUID invalide — DOIT être rejeté (non implémenté actuellement)
curl -s -X POST https://kickstock.app/api/trade \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: not-a-uuid" \
  -d '{"nationId":"BRA","mode":"buy","quantity":1}'
# Résultat actuel : passe jusqu'au RPC (non rejeté)
# Attendu après correctif : HTTP 400, { code: "INVALID_DEVICE_ID" }
```

---

#### SEC-TRADE-02 — Codes d'erreur structurés dans `/api/trade`

| Scénario | HTTP | `code` | `error` |
|----------|------|--------|---------|
| `nationId` manquant | 400 | `INVALID_PARAMS` | `'nationId manquant'` |
| `mode = 'short'` | 400 | `INVALID_MODE` | `'mode doit être buy ou sell'` |
| `quantity = 0` | 400 | `INVALID_QUANTITY` | `'quantité invalide'` |
| `quantity = -5` | 400 | `INVALID_QUANTITY` | `'quantité invalide'` |
| `quantity = 2.9` (décimal) | 400 | `INVALID_QUANTITY` | `'quantité invalide'` |
| `X-Device-ID` absent | 400 | `MISSING_DEVICE_ID` | `'X-Device-ID requis'` |
| Fonds insuffisants | 422 | `INSUFFICIENT_FUNDS` | Message RPC |
| Nation éliminée | 422 | `NATION_ELIMINATED` | `'Nation éliminée 💀'` |
| Nation inexistante | 422 | `NOT_FOUND` | Message RPC |
| Erreur interne | 500 | `INTERNAL_ERROR` | `'Erreur interne'` |

> `quantity = 2.9` est rejeté en amont (`!Number.isInteger(quantity)` → HTTP 400). Le `Math.floor` dans le corps de la route est un garde-fou résiduel.

---

#### SEC-TRADE-03 — Anti double-dépense (atomicité `execute_trade`)

```bash
DEVICE="<valid-uuid-v4>"
# Portfolio : cash = 500 KC, BRA = 200 KC — chaque achat = 400 KC
curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"buy","quantity":2}' &
curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"buy","quantity":2}' &
wait
```

**Résultat attendu :** Une requête réussit (`new_cash: 100`). L'autre → HTTP 422 `INSUFFICIENT_FUNDS`. Cash final = `100 KC`, jamais négatif.

---

#### SEC-TRADE-04 — Frais de vente côté RPC (référence `calcTax`)

| Phase | Qté | Prix | Brut | Taux | Fee | Net |
|-------|-----|------|------|------|-----|-----|
| Groupes (jour ≤ 16) | 10 | 200 | 2 000 | 10% | 200 | 1 800 |
| Groupes — min 10 KC | 1 | 50 | 50 | min | 10 | 40 |
| KO (jour ≥ 17) | 10 | 200 | 2 000 | 5% | 100 | 1 900 |
| KO — min 10 KC | 1 | 100 | 100 | min | 10 | 90 |
| Éliminée (price=1) | 5 | 1 | 5 | 0% | 0 | 5 |

---

#### SEC-TRADE-05 — Frais de vente dans `onlineGameStore` — test de non-régression (BUG-TAX-ONLINE corrigé)

**Localisation :** `apps/web/stores/onlineGameStore.ts`

**Correctif appliqué :**
```typescript
// Avant (incorrect) :
const fee = isKO ? gross * 0.10 : gross * 0.05;
const net = gross - (s.eliminated.includes(nationId) ? 0 : fee);

// Après (correct, aligné avec calcTax) :
const isElim = s.eliminated.includes(nationId);
const fee    = isElim || price <= 1
  ? 0
  : Math.max(gross * (isKO ? 0.05 : 0.10), 10);
const net    = gross - fee;
```

**Test de non-régression :**

| Scénario | Phase | Qté | Prix | Brut | Fee attendu | Net attendu | Cash delta |
|----------|-------|-----|------|------|-------------|-------------|------------|
| Vente normale | Groupes (jour ≤ 16) | 10 | 200 | 2 000 | max(200, 10) = **200 KC** | **1 800 KC** | +1 800 KC |
| Vente minimum | Groupes | 1 | 50 | 50 | max(5, 10) = **10 KC** | **40 KC** | +40 KC |
| Vente KO | KO (jour ≥ 17) | 10 | 200 | 2 000 | max(100, 10) = **100 KC** | **1 900 KC** | +1 900 KC |
| Nation éliminée | Peu importe | 5 | 1 | 5 | **0 KC** | **5 KC** | +5 KC |

**Procédure :**
1. Mode online, jour 5 (groupes), vendre 10 actions BRA à 200 KC.
2. Observer `store.cash` immédiatement après le trade (avant le prochain `fetchState`).
3. **Attendu :** `cash += 1 800 KC`. Si `result.newCash` est retourné par le RPC, cette valeur prime sur le calcul local.

---

#### SEC-TRADE-06 — Plafond 40% (phase groupes, RPC uniquement)

```
Portfolio : cash = 10 000 KC, 0 position, BRA = 200 KC/action
40% de 10 000 KC = max 20 actions BRA

Achat 20 BRA → OK
Achat 1 BRA supplémentaire → HTTP 422, error: "⛔ Plafond 40% atteint"
```

> **Note :** Le plafond 40% est implémenté dans le RPC `execute_trade` (mode online). Il est **absent** de `localGameStore` (mode offline) — voir ANNEXE D, point BUG-CAP-OFFLINE.

---

#### SEC-TRADE-07 — Achat d'une nation éliminée

```bash
UPDATE game_state SET eliminated = array_append(eliminated, 'HAI') WHERE id = 1;

curl -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"HAI","mode":"buy","quantity":5}'
# Attendu : HTTP 422, { code: "NATION_ELIMINATED" }

# Vente sans frais
curl -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"HAI","mode":"sell","quantity":5}'
# Attendu : HTTP 200, fee: 0
```

---

#### SEC-TRADE-08 — ETag / 304 sur `/api/game/state`

```bash
# Première requête
curl -v https://kickstock.app/api/game/state -H "X-Device-ID: $DEVICE"
# Attendu : HTTP 200, ETag: "d5-p<uuid>"

# Requête conditionnelle
curl -v https://kickstock.app/api/game/state \
  -H "X-Device-ID: $DEVICE" \
  -H 'If-None-Match: "d5-p<uuid>"'
# Attendu : HTTP 304 (pas de body)
```

`lib/api.ts` lève `new Error('NOT_MODIFIED')` sur les 304 — le store doit conserver son état sans écraser.

---

### 2.5 Authentification

#### AUTH-01 — Cookies de session HttpOnly/Secure/SameSite

DevTools → Application → Cookies, après connexion HTTPS. Chaque cookie `sb-*` doit avoir `HttpOnly` ✓, `Secure` ✓, `SameSite: Lax`.

#### AUTH-02 — Middleware : refresh de session

Le middleware appelle `supabase.auth.getUser()` à chaque requête. Sur un token proche de l'expiration, la réponse contient `Set-Cookie` avec un nouveau `sb-access-token`.

#### AUTH-03 — Redirection depuis les pages auth si connecté

Naviguer vers `/login` ou `/register` avec une session active → redirection 307 vers `/`.
`/auth/callback` et `/auth/confirm` sont exclus du matcher.

#### AUTH-04 — Déconnexion forcée

```javascript
await sbA.auth.signOut();
const { data } = await sbA.from('portfolios').select('*');
// Attendu : data = []
```

#### AUTH-05 — Trigger `handle_new_user` — création profil + portfolio

```sql
SELECT p.id, p.username, pf.cash FROM profiles p
JOIN portfolios pf ON pf.user_id = p.id WHERE p.id = '<new_user_id>';
-- Attendu : username non vide, cash = 10000.00
```

---

### 2.6 Flux invité

#### AUTH-GUEST-01 — `GET /api/auth/check-pseudo`

```bash
GET /api/auth/check-pseudo?q=Zidane99       # { available: true }
GET /api/auth/check-pseudo?q=zidane99       # { available: false, suggestion: "zidane99XX" }
GET /api/auth/check-pseudo?q=ab             # { available: false, error: "invalid_format" }
GET /api/auth/check-pseudo?q=_admin         # { available: false, error: "invalid_format" }
GET /api/auth/check-pseudo?q=admin          # { available: false, suggestion: "adminXX" }
```

**Règle :** 3–20 chars, `^[a-zA-Z0-9_-]+$`, ne commence/finit pas par `_` ou `-`.

#### AUTH-GUEST-02 — Rate limiting `/api/auth/guest` (5 req / 10 min / IP)

6ème requête de la même IP → HTTP 429 `{ error: "too_many_requests" }`.

#### AUTH-GUEST-03 — UUID v4 obligatoire

```bash
POST /api/auth/guest -d '{"pseudo":"Test","deviceId":"not-a-uuid"}'
# Attendu : HTTP 400, { "error": "invalid_device_id" }
```

#### AUTH-GUEST-04 — Cloudflare Turnstile

Si `TURNSTILE_SECRET_KEY` est défini : `cfToken` manquant → HTTP 400 `missing_captcha` ; token invalide → HTTP 403 `captcha_failed`.

#### AUTH-GUEST-05 — Namespace pseudo partagé invité/authentifié

Invité `TigerWoods` en base → `POST /api/auth/set-username` avec `{ username: 'TigerWoods' }` → HTTP 409 `taken`. La vérification est case-insensitive sur `portfolios.guest_username` ET `profiles.username`.

#### AUTH-GUEST-06 — `GET /api/auth/check-email`

```bash
GET /api/auth/check-email?q=known@user.com       # { exists: true, confirmed: true }
GET /api/auth/check-email?q=ghost@user.com        # { exists: false, confirmed: false }
GET /api/auth/check-email?q=notanemail            # HTTP 400, { error: "invalid_email" }
```

#### AUTH-OAUTH-01 — Flux OAuth Google + migration invité

1. Cookie `ks_pending_device` posé avant la redirection.
2. `/auth/callback` appelle `migrate_guest_to_user(p_device_id, p_user_id)`.
3. Redirect vers `/?ks_migrated=1&ks_new_user=1&ks_pseudo=MonPseudo`.
4. Cookie `ks_pending_device` supprimé (`maxAge: 0`).

---

## 3. TESTS FONCTIONNELS MÉTIER

> **Modes de jeu :** Les tests marqués `[ONLINE]` s'appliquent à `onlineGameStore` (appels API réels). Les tests marqués `[OFFLINE]` s'appliquent à `localGameStore` (entièrement local). Les tests non marqués s'appliquent aux deux modes.

---

### 3.1 Bootstrap et initialisation (mode online)

---

**ID :** FT-BOOT-01 `[ONLINE]`  
**Titre :** Premier chargement — `loadBootstrap()` + cache miss  
**Pré-requis :** `localStorage['kickstock:bootstrap:v1']` absent ou expiré (> 24 h)  
**Étapes :** Ouvrir l'application en mode online.

**Résultat attendu :**
- `GET /api/competition/bootstrap` appelé avec `cache: 'no-store'`.
- Réponse contient `{ competition, teams, days, group_fixtures }`.
- `teams` non vide, `days` non vide.
- Bootstrap sauvegardé dans `localStorage['kickstock:bootstrap:v1']` avec `fetchedAt = Date.now()`.
- `store._bootstrap` et `store._teams` renseignés.
- `store.bootstrapLoading = false`, `store.bootstrapError = false`.

---

**ID :** FT-BOOT-02 `[ONLINE]`  
**Titre :** Cache hit (< 24 h) — aucun appel réseau

**Pré-requis :** `localStorage['kickstock:bootstrap:v1']` valide (< 24 h)  
**Résultat attendu :** `getBootstrap()` retourne immédiatement les données en cache sans appeler `/api/competition/bootstrap`. Vérifiable en observant l'onglet Network des DevTools (0 requête vers bootstrap).

---

**ID :** FT-BOOT-03 `[ONLINE]`  
**Titre :** Fallback stale — fetch échoue mais cache périmé disponible

**Pré-requis :** `localStorage['kickstock:bootstrap:v1']` présent mais expiré (> 24 h). Simuler une erreur réseau sur `/api/competition/bootstrap`.  
**Résultat attendu :** `getBootstrap()` retourne les données stale avec un `console.warn('[bootstrap] using stale cache')`. Le jeu continue sans erreur.

---

**ID :** FT-BOOT-04 `[ONLINE]`  
**Titre :** Bootstrap absent — erreur affichée

**Pré-requis :** Aucun cache, `/api/competition/bootstrap` retourne HTTP 404 (`No active competition found`).  
**Résultat attendu :** `store.bootstrapError = true`. L'interface affiche un message d'erreur ou un état de retry visible pour l'utilisateur.

---

**ID :** FT-BOOT-05 `[ONLINE]`  
**Titre :** `/api/competition/bootstrap` — réponse attendue

```bash
curl -s https://kickstock.app/api/competition/bootstrap | jq '{
  has_competition: (.competition != null),
  teams_count: (.teams | length),
  days_count: (.days | length),
  fixtures_count: (.group_fixtures | length)
}'
```

**Résultat attendu :**
- `has_competition: true`
- `teams_count >= 32` (au moins 32 équipes)
- `days_count >= 34` (34 journées de tournoi)
- `group_fixtures_count` = nombre de matchs de phase de groupes
- Header `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` présent

---

### 3.2 Synchronisation et Realtime (mode online)

---

**ID :** FT-SYNC-01 `[ONLINE]`  
**Titre :** `startSync()` — souscription Supabase Realtime + fallback poll 30 s

**Résultat attendu :**
- `supabase.channel('ks_game_state')` souscrit aux `UPDATE` sur la table `game_state`.
- Un `setInterval` de 30 000 ms est enregistré en tant que fallback.
- `store._realtimeChannel` non null, `store._pollId` non null.
- `fetchState()` est appelé immédiatement au montage.

---

**ID :** FT-SYNC-02 `[ONLINE]`  
**Titre :** Notification Realtime — `fetchState()` déclenché

**Procédure :**
1. Ouvrir deux onglets avec le même `device_id` ou deux devices.
2. Depuis un device tiers (admin), avancer le jeu d'un jour via le bouton PLAY.

**Résultat attendu :**
- La notification Supabase Realtime (`postgres_changes` sur `game_state`) déclenche `set({ syncing: true })` puis `fetchState()` sur tous les clients connectés.
- Les prix mis à jour sont visibles < 5 s sans action de l'utilisateur.

---

**ID :** FT-SYNC-03 `[ONLINE]`  
**Titre :** ETag / 304 — store inchangé si rien n'a changé

**Procédure :** Attendre que le poll de 30 s s'exécute sans qu'aucun advance ait eu lieu entre deux polls.

**Résultat attendu :** `fetchState()` envoie `If-None-Match: "d{n}-p{pid}"`. Le serveur retourne HTTP 304. Le bloc `if (String(err).includes('NOT_MODIFIED'))` est atteint. `store.loading` et `store.syncing` repassent à `false`. Aucune écriture de state.

---

**ID :** FT-SYNC-04 `[ONLINE]`  
**Titre :** `stopSync()` — nettoyage des ressources

**Résultat attendu :**
- `clearInterval` appelé sur `_pollId`.
- `supabase.removeChannel(_realtimeChannel)` appelé.
- `store._pollId = null`, `store._realtimeChannel = null`.

---

### 3.3 Authentification et initialisation du compte

---

**ID :** FT-AUTH-01  
**Titre :** Première ouverture — `GuestModal`  
**Pré-requis :** Aucun `localStorage.kickstock_pseudo`, aucune session Supabase  
**Résultat attendu :** `GuestModal` s'affiche. Focus auto sur le champ pseudo uniquement si `pointer: fine` (non tactile). Widget Turnstile invisible chargé si `NEXT_PUBLIC_TURNSTILE_SITE_KEY` défini.

---

**ID :** FT-AUTH-02  
**Titre :** Création de pseudo invité — flux nominal  
**Pré-requis :** `NoviceTrader` non pris  
**Résultat attendu :**
- `GET /api/auth/check-pseudo?q=NoviceTrader` → `{ available: true }` (indicateur vert affiché).
- `POST /api/auth/guest` → `{ ok: true }`.
- `localStorage.kickstock_pseudo = 'NoviceTrader'`.
- `kickstock:pseudo-saved` dispatché.
- `store.resetGame()` appelé → cash = 10 000 KC, portfolio vide, dayIndex = 0.
- Si première fois : `kickstock:show-tutorial` dispatché.
- En base : `portfolios.guest_username = 'NoviceTrader'` pour ce `device_id`.

---

**ID :** FT-AUTH-03  
**Titre :** Pseudo déjà pris — suggestion  
**Résultat attendu :** Indicateur rouge + bouton "Utiliser « ZidaneXX »". Clic → champ mis à jour + vérification relancée.

---

**ID :** FT-AUTH-04  
**Titre :** OAuth Google + migration de portfolio invité  
**Pré-requis :** Joueur invité `device_id = UUID_G`, cash = 7 500 KC, 3 positions, `guest_username = 'TigerFan'`  
**Résultat attendu :**
- Cookie `ks_pending_device = UUID_G` posé avant la redirection.
- `migrate_guest_to_user` retourne `{ status: 'migrated', guest_username: 'TigerFan' }`.
- Redirect → `/?ks_migrated=1&ks_new_user=1&ks_pseudo=TigerFan`.
- Portfolio migré : cash et positions préservés.

---

**ID :** FT-AUTH-05 `[OFFLINE]`  
**Titre :** `syncFromServer()` — sync cross-device à la connexion  
**Pré-requis :** Compte connecté, `user_game_states` = Jour 5 ; localStorage local = Jour 3  
**Résultat attendu :** `serverDay (5) >= localDay (3)` → état serveur chargé. Inverse (local Jour 7, serveur Jour 5) → état local poussé vers le serveur.

---

**ID :** FT-AUTH-06  
**Titre :** `syncBestScore` — mise à jour atomique  
**Pré-requis :** `portfolios.best_score = 12 000 KC`, joueur atteint 15 000 KC  
**Résultat attendu :** `UPDATE portfolios SET best_score = 15000 WHERE ... AND best_score < 15000` → une seule ligne modifiée. Vue `leaderboard` mise à jour.

---

### 3.4 Trade

---

**ID :** FT-TRADE-01 `[ONLINE]`  
**Titre :** Achat nominal — optimistic update + confirmation RPC  
**Pré-requis :** Jour 3 (groupes), cash = 10 000 KC, BRA = 200 KC  
**Étapes :** `store.trade('buy', 'BRA', 10)`

**Résultat attendu :**
- Validations client passent : `!eliminated.includes('BRA')`, `200 × 10 = 2000 <= 10000`.
- `POST /api/trade` avec `{ nationId:'BRA', mode:'buy', quantity:10 }`.
- Si `result.newCash` présent → `store.cash = result.newCash`. Sinon fallback optimiste.
- `store.portfolio['BRA'] = 10`, `store.avgCost['BRA'] = 200`.
- `store.txLog[0] = { dir:'buy', flag:'🇧🇷', name:'Brazil', qty:10, price:200, day:3 }`.

---

**ID :** FT-TRADE-02 `[OFFLINE]`  
**Titre :** Achat nominal — entièrement local  
**Pré-requis :** Identique à FT-TRADE-01  
**Résultat attendu :** Même résultat final, **aucun appel réseau**. `localStorage['ks-game-state']` mis à jour immédiatement. Timer debounce 5 s lance la sauvegarde Supabase si l'utilisateur est connecté.

---

**ID :** FT-TRADE-03  
**Titre :** Vente partielle — calcul taxe groupes (10%, min 10 KC)  
**Pré-requis :** Jour 5, 20 actions BRA à 200 KC, cash = 5 000 KC

| | ONLINE (RPC) | OFFLINE (calcTax) |
|--|-------------|-------------------|
| Brut | 10 × 200 = 2 000 KC | 2 000 KC |
| Fee | max(2000×0.10, 10) = **200 KC** | max(2000×0.10, 10) = **200 KC** |
| Net | **1 800 KC** | **1 800 KC** |
| Cash final | 5 000 + 1 800 = **6 800 KC** | 6 800 KC |

---

**ID :** FT-TRADE-04  
**Titre :** Vente — taxe phase KO (5%, min 10 KC)  
**Pré-requis :** Jour 20, 10 actions GER à 100 KC

| | ONLINE (RPC + optimistic) | OFFLINE (calcTax) |
|--|--------------------------|-------------------|
| Fee | max(1000×0.05, 10) = **50 KC** | **50 KC** |
| Net | **950 KC** | **950 KC** |

Les deux modes sont désormais alignés — BUG-TAX-ONLINE corrigé ✅.

---

**ID :** FT-TRADE-05  
**Titre :** Vente totale — nettoyage portfolio et `avgCost`  
**Résultat attendu :** `store.portfolio` ne contient plus la clé de la nation. `store.avgCost` idem.

---

**ID :** FT-TRADE-06  
**Titre :** Prix moyen pondéré à l'achat (VWAP)  
**Pré-requis :** 10 actions BRA avgCost = 180 KC, nouveau prix = 220 KC  
**Achat de 10 actions supplémentaires :**
- `newAvg = (10×180 + 10×220) / 20 = 200 KC`

---

### 3.5 Cas limites de Trade

| ID | Scénario | Entrée | Résultat attendu |
|----|----------|--------|-----------------|
| FT-EDGE-01 | Fonds insuffisants | cash=150, BRA=200 | `'Fonds insuffisants'` |
| FT-EDGE-02 | Vente à découvert | 0 actions MEX | `'Actions insuffisantes'` |
| FT-EDGE-03 | Achat nation éliminée | HAI dans `eliminated` | `'Nation éliminée 💀'` |
| FT-EDGE-04 | Vente nation éliminée, sans frais | HAI price=1, 10 actions | fee=0, cash += 10 KC |
| FT-EDGE-05 | Nation inexistante | nationId='ZZZ' | `'Nation introuvable'` |
| FT-EDGE-06 | Overflow txLog (101ème trade) | txLog déjà à 100 | `txLog.length === 100`, entrée la plus ancienne supprimée |

---

### 3.6 Simulation — mode offline

---

**ID :** FT-SIM-01 `[OFFLINE]`  
**Titre :** Simulation d'une journée de groupes  
**Pré-requis :** `dayIndex = 0`  
**Résultat attendu :**
- `advanceDay()` retourne `{ results: [...], flash: {...} }`.
- `results` contient les matchs du Jour 0 avec `scoreA`, `scoreB`, `res`, `pA`, `pB`, `newPA`, `newPB`.
- Prix plancher : `Math.max(1, rawPA)`.
- `store.dayIndex = 1`, `store.priceHistory['MEX']` = 2 entrées.
- `bestScore` mis à jour si `(cash + portfolio_value) > bestScore`. `syncBestScore` appelé si changement.
- State sauvegardé immédiatement sur Supabase si connecté (pas de debounce — le day advance est un checkpoint majeur).

---

**ID :** FT-SIM-02 `[OFFLINE]`  
**Titre :** Dividende R32 (Jour 17, `divKey = 'r32'`)  
**Pré-requis :** 10 actions BRA qualifiées, prix BRA = 250 KC  
**Résultat attendu :**
- `calcDividend(250, 'r32')` = `250 × 0.10 = 25 KC/action`
- `cash += 10 × 25 = 250 KC`
- `results[i].divCash = 250`

---

**ID :** FT-SIM-03 `[OFFLINE]`  
**Titre :** Finale — dividende runner-up + champion  
**Pré-requis :** 5 actions FRA (champion), 3 actions ARG (finaliste)  
**Résultat attendu :**
- FRA reçoit : dividende `final` (`×0.40`) + dividende `champion` (`×0.60`)
- ARG reçoit : dividende `final` (`×0.40`)
- ARG ajouté à `eliminated`, prix = 1 KC
- `store.champion = 'FRA'`

---

**ID :** FT-SIM-04 `[OFFLINE]`  
**Titre :** Liquidation en KO — positions soldées à 1 KC  
**Pré-requis :** 10 actions RSA, RSA perd son R32  
**Résultat attendu :**
- `store.eliminated` contient `'RSA'`, `store.prices['RSA'] = 1`
- `store.cash += 10 × 1 = 10 KC`, `store.portfolio` ne contient plus `'RSA'`

---

**ID :** FT-SIM-05 `[OFFLINE]`  
**Titre :** Demi-finale — perdant non éliminé (`phase === 'SF'`)  
**Résultat attendu :** `elimId = null` pour les matchs SF. Le perdant rejoint `thirdPool`.

---

**ID :** FT-SIM-06 `[OFFLINE]`  
**Titre :** Journée KO vide — auto-skip  
**Résultat attendu :** `todayMatches.length === 0 && day.isKO` → `dayIndex++`, retourne `{ results:[], flash:{} }`.

---

### 3.7 Pipeline de résultats réels (mode online)

---

**ID :** FT-CRON-00 `[ONLINE]`  
**Titre :** Architecture de la mise à jour des scores — vue d'ensemble

**[V3.1 — CHANGEMENT D'ARCHITECTURE]** Depuis V25, `/api/game/live-matches` **ne fait plus d'appel à API-Football**. Les scores en cours (`1H/HT/2H/ET/BT/P`) sont maintenus dans la table `matches` par le cron `live-poll` (toutes les 2 min). La route lit uniquement la DB — données fraîches à ≤ 2 min près.

| Composant | Fréquence | Rôle |
|-----------|-----------|------|
| `live-poll` | 2 min (24/7) | Met à jour `matches.score_a/score_b/api_status` + traite les FT |
| `sync-results` | 30 min (GitHub Actions) | Filet de sécurité : retraite les matchs finis si live-poll a manqué un tick |
| `sync-fixtures` | Quotidien (06h UTC) | Importe le calendrier depuis API-Football |
| `/api/game/live-matches` | À la demande | Lit la DB, retourne les matchs du jour |

---

**ID :** FT-LIVE-POLL-01 `[ONLINE]`  
**Titre :** `live-poll` — mise à jour des scores en cours

**Pré-requis :** Match en cours (api_status = `1H`), `CRON_SECRET` valide.

**Étapes :**
1. Lire `matches.score_a / score_b` avant le cron.
2. Appeler `GET /api/cron/live-poll` avec le bon header.
3. Relire `matches.score_a / score_b` après le cron.

**Résultat attendu :**
- `liveUpdated >= 1` dans la réponse.
- `matches.score_a` et `matches.score_b` mis à jour avec les valeurs de l'API-Football.
- `processed_at` reste `null` (match non encore fini).

---

**ID :** FT-LIVE-POLL-02 `[ONLINE]`  
**Titre :** `live-poll` — traitement d'un match terminé (FT)

**Pré-requis :** Match fini (`FT`) avec `processed_at = null`.

**Résultat attendu :**
- `processed = 1` dans la réponse.
- `processRealMatchResult()` appelé : prix mis à jour, dividendes distribués, `processed_at` défini.
- `checkAndAdvancePhase()` appelé.
- Prochain tick du cron : match hors fenêtre `isMatchWindowActive()` → pas retraité.

---

**ID :** FT-LIVE-POLL-03 `[ONLINE]`  
**Titre :** `live-poll` — idempotence sur match déjà traité

**Pré-requis :** Match avec `processed_at != null`.

**Résultat attendu :** `processed = 0`. Aucun prix ni dividende modifié.

---

**ID :** FT-LIVE-POLL-04 `[ONLINE]`  
**Titre :** `live-poll` — couverture 24/7 (matchs nocturnes UTC)

**Contexte :** Avant V26, le cron était limité à 06h00–23h59 UTC. Les matchs kickoffant après minuit UTC (ex. 22h00 heure du Pacifique = 05h00 UTC) n'étaient pas couverts par le cron Vercel.

**Procédure :** Simuler un appel à `live-poll` à 02h00 UTC (hors ancienne fenêtre).

**Résultat attendu :** Le cron s'exécute normalement. `isMatchWindowActive()` détermine seul si les appels API sont nécessaires — pas de restriction horaire codée.

---

**ID :** FT-CRON-01 `[ONLINE]`  
**Titre :** `sync-fixtures` — idempotence sur re-run

**Procédure :** Appeler `GET /api/cron/sync-fixtures` avec le bon `CRON_SECRET` deux fois de suite.

**Résultat attendu :**
- Deuxième appel : mêmes fixtures upsertées, mais aucune donnée de match (`score_a`, `score_b`, `processed_at`) modifiée grâce à la RPC `upsert_fixture`.
- Réponse `{ ok: true, results: [{ upserted: N, skipped: 0 }] }`.

---

**ID :** FT-CRON-02 `[ONLINE]`  
**Titre :** `sync-results` — court-circuit hors fenêtre de match

**Pré-requis :** Aucun match non-traité dans les ±3 h autour de maintenant.

**Résultat attendu :**
- `isMatchWindowActive()` retourne `false`.
- `sync-results` retourne immédiatement `{ skipped: true, reason: 'no active match window' }`.
- **0 appel API-Football consommé.**

---

**ID :** FT-CRON-03 `[ONLINE]`  
**Titre :** `processRealMatchResult` — idempotence (guard `processed_at`)

**Pré-requis :** Match avec `processed_at` déjà défini.

**Procédure :** Appeler `processRealMatchResult(fixtureId, fixture)` sur ce match.

**Résultat attendu :** Retourne `false` immédiatement sans modifier aucune donnée en base.

---

**ID :** FT-CRON-04 `[ONLINE]`  
**Titre :** `processRealMatchResult` — flux nominal (FT)

**Pré-requis :** Match FRA vs ARG, `processed_at = null`, FRA gagne 2-1.

**Résultat attendu :**
- `determineResult()` retourne `'A'` (FRA gagne).
- `applyResult(pA, pB, 'A')` appliqué → nouveaux prix.
- `update_prices_after_match` RPC appelé.
- `distribute_dividends` appelé pour FRA si `div_key` défini.
- Match mis à jour : `score_a=2, score_b=1, winner_id='FRA', processed_at=<now>, trade_lock_until=<now+15min>`.

---

**ID :** FT-CRON-05 `[ONLINE]`  
**Titre :** `processRealMatchResult` — match PEN (tirs au but)

**Pré-requis :** Match KO, résultat API `status.short = 'PEN'`, penalty home=4, away=3.

**Résultat attendu :**
- `determineResult()` utilise les pénaltys → `'A'` (home gagne).
- `result_data.penWinner = 'A'`, `result_data.penA = 4`, `result_data.penB = 3`.
- `elimId = loserId` (sauf SF/3rd).

---

**ID :** FT-CRON-06 `[ONLINE]`  
**Titre :** `checkAndAdvancePhase` — avancement du jour uniquement si tous les matchs traités

**Pré-requis :** Jour X a 3 matchs, 2 traités, 1 encore `processed_at = null`.

**Résultat attendu :**
- `count: pending > 0` → fonction retourne sans modifier `game_state`.
- Après traitement du 3ème match, `checkAndAdvancePhase()` fait passer `current_day_index` à X+1.

---

**ID :** FT-CRON-07 `[ONLINE]`  
**Titre :** `checkAndAdvancePhase` — construction du R32 pool après dernier jour de groupes

**Pré-requis :** Dernière journée de groupes entièrement traitée (`remainingGroupMatches = 0`).

**Résultat attendu :**
- `buildR32Pool(allMatchResults, eliminated)` appelé.
- `game_state.r32_pool` contient 32 nations qualifiées.
- Les équipes non qualifiées : `liquidate_eliminated` appelé + ajoutées à `eliminated`.

---

**ID :** FT-CRON-08 `[ONLINE]`  
**Titre :** `trade_lock_until` — blocage des trades pendant 15 min post-match

**Pré-requis :** Match vient d'être traité, `trade_lock_until = now + 15min`.

**Résultat attendu :**
- `LiveTab` affiche un compte à rebours de déverrouillage pour ce match.
- Les tentatives de trade sur les nations de ce match pendant la fenêtre de lock sont bloquées (vérifier la logique dans le RPC ou la route `/api/trade`).

---

### 3.8 LiveTab et scores en direct (mode online)

---

**ID :** FT-LIVE-01 `[ONLINE]`  
**Titre :** Affichage des statuts de match en temps réel dans LiveTab  
**Pré-requis :** Mode online actif. `GET /api/game/live-matches` retourne des matchs du jour.

**Résultat attendu :**
- `LiveTab` affiche pour chaque match selon son `api_status` :

| `api_status` | Affichage attendu |
|-------------|------------------|
| `NS` | "Débute dans X min" + compte à rebours |
| `1H` / `2H` / `ET` | "EN JEU" avec `elapsed` minutes |
| `HT` | "MI-TEMPS" |
| `FT` / `AET` / `PEN` | Score final + indicateur prix (hausse/baisse) |
| `PST` / `CANC` | Non affiché (filtré par `NOT IN ("PST","SUSP","CANC","ABD")`) |

**[V3.1] :** `/api/game/live-matches` lit uniquement la DB (scores maintenus par `live-poll`). Aucun appel API-Football à chaque requête.

---

**ID :** FT-LIVE-02 `[ONLINE]`  
**Titre :** Poll toutes les 60 s sur `/api/game/live-matches`  
**Résultat attendu :** Le `setInterval` dans `LiveTab` appelle `/api/game/live-matches` toutes les 60 000 ms. La réponse a `Cache-Control: no-store`. Le composant se démonte proprement → `clearInterval` appelé.

---

**ID :** FT-LIVE-03 `[ONLINE]`  
**Titre :** `LiveTab` absent en mode offline  
**Résultat attendu :** En mode offline, c'est `SimulateTab` (avec le bouton PLAY) qui est monté dans la navigation mobile — pas `LiveTab`. La logique de sélection du composant doit vérifier le mode.

---

**ID :** FT-LIVE-04 `[ONLINE]`  
**Titre :** Scores en direct dans `ScheduleTab` (mobile)  
**Pré-requis :** Mode online, `store.liveMatches` contient un match avec `api_status = '1H'` et `score_a = 1 / score_b = 0`.

**Résultat attendu :**
- Le match apparaît dans la journée courante avec le score `1–0` affiché.
- Badge "EN JEU 🔒" visible (couleur `--gain`).
- Le score ne provient pas de `matchResults` (pas encore traité) mais de `liveMatches`.
- Après traitement (`matchResults` mis à jour), le score final remplace l'affichage live.

---

**ID :** FT-LIVE-05 `[ONLINE]`  
**Titre :** Scores en direct dans BrowserShell Home (desktop)  
**Pré-requis :** Identique à FT-LIVE-04, sur viewport > 600 px.

**Résultat attendu :** La colonne de la journée courante dans BrowserShell affiche le score live du match en cours avec le même badge 🔒 et la même logique de priorité (`liveMatches` > `matchResults`).

---

**ID :** FT-LIVE-06 `[ONLINE]`  
**Titre :** Badge 🔒 — disparaît après expiration du `trade_lock_until`  
**Pré-requis :** Match avec `api_status = 'FT'`, `trade_lock_until = now + 1 min`.

**Résultat attendu :**
- Badge "FT 🔒" visible immédiatement.
- Après 1 min (expiration du lock), le badge 🔒 disparaît, seul "FT" reste.
- L'horloge interne du composant (mise à jour toutes les 30 s dans `LiveTab`) déclenche le re-render.

---

**ID :** FT-LIVE-07 `[ONLINE]`  
**Titre :** `live-matches` — couverture des matchs ayant passé minuit UTC  
**Contexte :** Un match kickoff à 22h00 UTC-4 = 02h00 UTC du lendemain. Sans la clause OR sur `processed_at IS NULL`, le match disparaîtrait du "jour courant" UTC après minuit.

**Pré-requis :** Match avec `scheduled_at` la veille UTC, `api_status = '1H'` (non traité), `now > midnight UTC`.

**Résultat attendu :** Le match est retourné par `/api/game/live-matches` grâce à la clause :  
`OR (processed_at IS NULL AND scheduled_at <= now)` — il reste visible jusqu'à traitement.

---

### 3.9 Classement Online

---

**ID :** FT-RANK-01 `[ONLINE]`  
**Titre :** `/api/leaderboard/online` — réponse nominale

```bash
curl -s "https://kick-stock-web.vercel.app/api/leaderboard/online?limit=50&deviceId=$DEVICE_ID&competitionId=1"
```

**Résultat attendu :**
```json
{
  "entries": [
    { "rank": 1, "username": "...", "user_type": "registered", "total_value": 12500, ... }
  ],
  "me": { "rank": 42, "total_value": 10350, ... },
  "total": 147
}
```

- `total_value` = `portfolios.cash` + somme(holdings.quantity × current_price).
- Entrées triées par `total_value` décroissant.
- `me` non null si `deviceId` ou session correspond à un portfolio de la compétition.
- Si `me` est dans le top 50, il apparaît dans `entries` ET dans `me`.

---

**ID :** FT-RANK-02 `[ONLINE]`  
**Titre :** RankingPanel — onglet Online vs Offline

**Pré-requis :** Mode online actif.

**Résultat attendu :**
- `RankingPanel` ouvre par défaut l'onglet **Online**.
- En mode offline, l'onglet **Offline** est sélectionné par défaut.
- Clic sur l'onglet non-actif → rafraîchissement immédiat.
- Changement de mode de jeu (localStorage) → l'onglet actif suit automatiquement.

---

**ID :** FT-RANK-03 `[ONLINE]`  
**Titre :** Rafraîchissement de l'identité au changement de compte

**Pré-requis :** Joueur connecté avec un compte. Changer de compte (sign out + sign in avec un autre).

**Résultat attendu :**
- `online.refresh()` et `offline.refresh()` appelés sur l'événement `kickstock:pseudo-saved`.
- La ligne "Me" dans le classement affiche le bon pseudo et la bonne valeur.
- Pas de ligne "Me" fantôme de l'ancien compte.

---

**ID :** FT-RANK-04 `[ONLINE]`  
**Titre :** `total_value` cohérente avec le store

**Procédure :** Acheter 10 actions BRA à 200 KC. Puis vérifier `/api/leaderboard/online`.

**Résultat attendu :** `me.total_value` = `store.cash + store.portfolio['BRA'] × store.prices['BRA']`. L'écart doit être < 1 KC (arrondi numérique).

---

### 3.10 FirstTradeUpsellModal

---

**ID :** FT-UPSELL-01  
**Titre :** Modale affichée une seule fois après le premier achat invité

**Pré-requis :** Joueur invité, aucun achat préalable, clé `kickstock:first-trade-upsell-shown` absente de localStorage.

**Étapes :** Effectuer un premier achat (BUY).

**Résultat attendu :**
- `FirstTradeUpsellModal` s'affiche après le trade.
- Propose "Continuer avec Google" et "Continuer en invité".
- La clé `kickstock:first-trade-upsell-shown` est posée en localStorage.

---

**ID :** FT-UPSELL-02  
**Titre :** Modale non ré-affichée lors des trades suivants

**Pré-requis :** `kickstock:first-trade-upsell-shown` présent en localStorage.

**Résultat attendu :** Aucune modale après le second achat.

---

**ID :** FT-UPSELL-03  
**Titre :** Modale non affichée pour un compte authentifié

**Pré-requis :** Joueur connecté (Supabase session active).

**Résultat attendu :** Aucune modale après le premier achat.

---

### 3.11 Persistance et réseau

---

**ID :** FT-NET-01 `[ONLINE]`  
**Titre :** Coupure réseau pendant un trade — gestion de l'erreur

**Procédure :** Couper le réseau après avoir déclenché un `store.trade()` en mode online, avant que la réponse soit reçue.

**Résultat attendu :** L'appel à `apiTrade()` rejette la Promise. `result.error` est non null. `store.cash` et `store.portfolio` **ne sont pas modifiés** (aucun optimistic update avant le retour du RPC). L'interface affiche l'erreur dans le `TradeModal`.

---

**ID :** FT-NET-02 `[OFFLINE]`  
**Titre :** Coupure réseau — aucun impact sur le trade  
**Résultat attendu :** Trade entièrement local → coupure réseau sans effet. `store.cash` mis à jour immédiatement. La sauvegarde debounced échoue silencieusement.

---

**ID :** FT-NET-03 `[OFFLINE]`  
**Titre :** Rechargement de page — rehydration localStorage  
**Résultat attendu :** Zustand `persist` rehydrate depuis `'ks-game-state'`. Cash, portfolio, dayIndex identiques avant rechargement. `loading = false` immédiatement.

---

**ID :** FT-NET-04 `[OFFLINE]`  
**Titre :** `resetGame()` — remise à zéro complète  
**Résultat attendu :** `cash = 10 000`, `portfolio = {}`, `txLog = []`, `dayIndex = 0`, `eliminated = []`. `localStorage['ks-game-state']` contient l'état vide.

---

### 3.12 Trade Lock — Tests de sécurité (migration 023/024)

---

**ID :** FT-LOCK-01 `[ONLINE]`  
**Titre :** Blocage côté DB pour un match en cours (`api_status = '1H'`)

**Pré-requis :** Match avec `api_status = '1H'` pour BRA et FRA (mis à jour par live-poll).

```bash
curl -X POST https://kick-stock-web.vercel.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"buy","quantity":1}'
# Attendu : HTTP 422, { code: "TRADE_LOCKED" }
```

---

**ID :** FT-LOCK-02 `[ONLINE]`  
**Titre :** Fenêtre de 0–2 min après coup d'envoi (FAILLE-TRADE-LOCK-1 — ouverte)

**Contexte :** Entre le coup d'envoi réel et le prochain tick du cron live-poll (≤ 2 min), `api_status = 'NS'` en DB → le trade passe côté backend.

**Résultat attendu actuel (comportement connu) :**
- Trade réussi si `api_status = 'NS'` et `trade_lock_until` de la migration 023 non encore défini.
- Aucun blocage pendant cette fenêtre.

**Résultat attendu après correctif :**
- La migration 024 (`trade_lock_until` basé sur `scheduled_at`) doit bloquer le trade dès `now >= scheduled_at`.
- Vérifier que le RPC check : `trade_lock_until IS NOT NULL AND trade_lock_until > NOW()`.

> 🔴 Cette faille est documentée dans `TRADE_LOCK_AUDIT.md`. Corriger et repasser ce test après le fix.

---

**ID :** FT-LOCK-03 `[ONLINE]`  
**Titre :** Déverrouillage 15 min après fin du match

**Pré-requis :** Match venant de passer FT, `trade_lock_until = now + 15min`.

**Résultat attendu :**
- Trade bloqué pendant 15 min (HTTP 422 `TRADE_LOCKED` ou équivalent).
- Après expiration : trade réussi (HTTP 200).

---

## 4. COMPATIBILITÉ UI/UX

### 4.1 Matrice d'environnements

| # | Environnement | Viewport | Shell attendu | Statut |
|---|--------------|----------|---------------|--------|
| E1 | Chrome 124+ macOS | 1440 × 900 | BrowserShell | `[ ]` |
| E2 | Chrome 124+ Windows | 1920 × 1080 | BrowserShell | `[ ]` |
| E3 | Firefox 125+ macOS | 1440 × 900 | BrowserShell | `[ ]` |
| E4 | Safari 17+ macOS | 1440 × 900 | BrowserShell | `[ ]` |
| E5 | Edge 124+ Windows | 1920 × 1080 | BrowserShell | `[ ]` |
| E6 | Chrome DevTools iPhone 14 Pro (393 px) | 393 px | MobileShell | `[ ]` |
| E7 | Chrome DevTools Pixel 7 (412 px) | 412 px | MobileShell | `[ ]` |
| E8 | Safari iOS 17 — iPhone réel | < 600 px | MobileShell | `[ ]` |
| E9 | Chrome Android — Galaxy S24 | < 600 px | MobileShell | `[ ]` |
| E10 | iPad Pro 12.9" portrait | 1024 px | BrowserShell | `[ ]` |
| E11 | iPad mini portrait | 768 px | BrowserShell | `[ ]` |
| E12 | Resize live 1200 px → 500 px | Transition | Switch shell | `[ ]` |

**Breakpoint :** `MOBILE_BREAKPOINT = 600` dans `@kickstock/constants`.

---

### 4.2 Checklist commune

Pour chaque environnement :
- `[ ]` Bon shell monté (`MobileShell` si < 600 px, `BrowserShell` sinon)
- `[ ]` Aucune erreur console (`console.error`, erreurs réseau non gérées)
- `[ ]` `GuestModal` si pas de pseudo ni de session
- `[ ]` Cash 10 000 KC affiché dans le header
- `[ ]` Ticker défile sans saccade
- `[ ]` Trade de test s'exécute et met à jour le cash
- `[ ]` Variables CSS `--gold`, `--gain`, `--loss` appliquées
- `[ ]` Aucun overflow horizontal

---

### 4.3 `useValidateMechanics` — Contrat des shells

En `NODE_ENV = development`, aucun warning `[KickStock] ⚠️ Shell "..." is missing required mechanics` dans la console.

**9 mécaniques obligatoires :**

| Champ | Signification |
|-------|--------------|
| `canViewNationPrice` | Prix courant visible |
| `canBuy` | Achat possible |
| `canSell` | Vente possible |
| `canViewPortfolio` | Holdings visibles |
| `canViewCash` | Solde visible |
| `canViewPnL` | P&L visible |
| `canSimulate` | Simulation déclenchable (offline) ou LiveTab présent (online) |
| `canViewStandings` | Classements groupes visibles |
| `canViewSchedule` | Calendrier visible |

---

### 4.4 Tests Browser (Desktop)

#### UI-BROWSER-01 — Sidebar 72px intacte à 600 px

`width: 72px`, `flex-shrink: 0`. `ks-main` : `flex: 1`, `min-width: 0`. Aucune scrollbar horizontale.

#### UI-BROWSER-02 — Layout HOME 2 colonnes (48% / 52%)

Colonne gauche `width: 48%`. Scroll indépendant de chaque colonne. À 800 px total (728 px main) les deux colonnes restent lisibles.

#### UI-BROWSER-03 — Grille Market `auto-fill`

`grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`

| Largeur | Colonnes |
|---------|---------|
| 1400 px | 5–6 |
| 900 px | 3–4 |
| 700 px | 2–3 |

#### UI-BROWSER-04 — Hover states

Transition CSS visible. Curseur `pointer`. Pas de saut brutal.

#### UI-BROWSER-05 — Standings 12 groupes

Grille `repeat(auto-fill, minmax(280px, 1fr))`. MP/W/D/L/GF/GA/Pts alignés. À 1440 px : 4–5 groupes par ligne.

#### UI-BROWSER-06 — Bouton PLAY / LiveTab — état pendant avancement

- **Mode offline :** Clic → bouton disabled immédiatement. Réactivé après réponse.
- **Mode online :** Pas de bouton PLAY — `LiveTab` affiche les matchs automatiquement. Pas d'action manuelle possible.

---

### 4.5 Tests Mobile

#### UI-MOBILE-01 — Zones tactiles 44 × 44 px

| Élément | Minimum |
|---------|---------|
| 5 boutons Tab Bar | 44 × 44 px (Tab Bar = 64 px, largeur = viewport/5) |
| Bouton central ⚡ PLAY / onglet Live | 44 × 44 px |
| Boutons Acheter/Vendre (`TradeModal`) | 44 px hauteur |
| Bouton de confirmation | 44 px hauteur |
| Input de quantité | 44 px hauteur |
| Zone cliquable NationCard | Card entière |
| Bouton × fermeture overlays | 44 × 44 px |
| Items liste `ScheduleTab` | 44 px hauteur |

#### UI-MOBILE-02 — Tab Bar Bottom Navigation

5 onglets : SCHED. · STNDGS · ⚡PLAY (offline) ou LIVE (online) · MARKET · PORTF.  
Tab Bar fixe en bas (`flex-shrink: 0`). Onglet actif identifié (couleur `--gold`).

#### UI-MOBILE-03 — `100dvh` et barre système

Sur Chrome Android / Safari iOS réel : Tab Bar non coupée. Mise en page correcte après repli de la barre d'adresse.

#### UI-MOBILE-04 — Scroll 48 NationCards (CPU ×4)

Frame rate ≥ 55 fps. Aucun jank. Scrollbar invisible (`scrollbar-width: none`).

#### UI-MOBILE-05 — Clavier virtuel (`TradeModal`)

Input de quantité visible. Bouton de confirmation accessible. Pas de rubber band sur iOS.

#### UI-MOBILE-06 — `GuestModal` — focus conditionnel

Sur device tactile (`pointer: coarse`) : pas de focus auto (ne déclenche pas le clavier). Sur desktop : focus après 100 ms.

#### UI-MOBILE-07 — Flash d'hydration SSR → MobileShell

Flash < 16 ms. `export const dynamic = 'force-dynamic'` présent dans `app/page.tsx`.

#### UI-MOBILE-08 — Switch shell au redimensionnement

BrowserShell → MobileShell : store Zustand intact, `TradeModal` éventuel fermé, aucune erreur React `Can't perform a React state update on an unmounted component`.

---

### 4.6 LiveTab — Mobile (mode online)

#### UI-LIVE-01 — Onglet LIVE remplace ⚡ PLAY en mode online

**Résultat attendu :** En mode online, la Tab Bar mobile présente un onglet LIVE (ou similaire) à la place du bouton PLAY. `SimulateTab` n'est pas monté.

#### UI-LIVE-02 — Horloge de rafraîchissement 30 s

`setInterval` de 30 000 ms dans `LiveTab` pour `setNow(new Date())` (mise à jour des countdowns).

#### UI-LIVE-03 — Compte à rebours `trade_lock_until`

Post-match, l'onglet LIVE affiche "Déverrouillage dans X min" calculé à partir de `trade_lock_until`. Disparaît quand `now > trade_lock_until`.

---

### 4.7 Composants partagés

#### UI-SHARED-01 — `TradeModal` — même résultat financier online/offline

Même scénario en mode online et offline : fee identique selon `calcTax`. Cash débité identique.
L'optimistic update de `onlineGameStore` est désormais aligné avec `calcTax` (BUG-TAX-ONLINE corrigé ✅).

#### UI-SHARED-02 — `AuthWidget` compact vs normal

Mobile (`compact`) : avatar ou initiale. Browser : username ou "Connexion". Même flux Supabase dans les deux cas.

#### UI-SHARED-03 — Ticker — animation CSS uniquement

Prix = `store.prices`. Hausse → `--gain`. Baisse → `--loss`. Aucun re-render React par frame.

---

## ANNEXE A — Commandes de référence

```bash
pnpm lint
pnpm -r type-check
pnpm -r test
pnpm build
pnpm --filter @kickstock/game-engine test
pnpm --filter web dev
```

---

## ANNEXE B — Requêtes SQL de vérification

```sql
-- Politiques RLS actives (chercher portfolios_select_device)
SELECT tablename, policyname, cmd, qual
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Colonnes de la vue leaderboard
SELECT column_name FROM information_schema.columns
WHERE table_name = 'leaderboard' ORDER BY ordinal_position;

-- État courant du jeu
SELECT current_day_index, current_phase, advancing, champion_id,
       array_length(eliminated, 1) AS nb_eliminated
FROM game_state WHERE id = 1;

-- Vérifier l'idempotence (matchs traités vs non traités)
SELECT fixture_id, nation_a, nation_b, api_status, processed_at, trade_lock_until
FROM matches WHERE competition_id = <id>
ORDER BY day_index, scheduled_at LIMIT 20;

-- Dividendes du dernier avancement
SELECT n.flag, n.name, d.round, d.amount, d.shares, d.day_index
FROM dividends d JOIN nations n ON n.id = d.nation_id
ORDER BY d.created_at DESC LIMIT 20;

-- Atomicité d'un trade
SELECT p.cash, h.nation_id, h.quantity, h.quantity * n.current_price AS position_value
FROM portfolios p
JOIN holdings h ON h.portfolio_id = p.id
JOIN nations n ON n.id = h.nation_id
WHERE p.device_id = '<device_id>'
ORDER BY h.nation_id;

-- Bootstrap : compétition active
SELECT id, name, is_active, last_sync_at FROM competitions WHERE is_active = true;

-- Equipes et prix initiaux
SELECT team_id, group_code, initial_price FROM competition_teams
WHERE competition_id = <id> ORDER BY group_code;
```

---

## ANNEXE C — Variables d'environnement requises

| Variable | Usage | Où |
|----------|-------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase | Client + Server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publique Supabase | Client + Server |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé admin Supabase | Server uniquement |
| `CRON_SECRET` | Auth des crons `sync-fixtures` et `sync-results` | Server uniquement |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN Sentry (optionnel, désactive si absent) | Client + Server |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile (optionnel) | Server uniquement |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Clé publique Turnstile (optionnel) | Client |

> **Absent de la liste :** `ADVANCE_SECRET` — **non implémenté** (CRITIQUE-1 ouvert). À ajouter quand la protection de `/api/game/advance` sera codée.

---

## ANNEXE D — Inventaire complet des anomalies

| ID | Titre | Sévérité | Fichier | Statut |
|----|-------|----------|---------|--------|
| CRITIQUE-1 | `/api/game/advance` sans authentification | 🔴 BLOQUANT | `app/api/game/advance/route.ts` | **Non corrigé** |
| CRITIQUE-2 | RLS `portfolios_select_device` expose tous les portfolios anonymes | 🔴 BLOQUANT | `db/FULL_SETUP.sql` | À vérifier en base |
| FAILLE-TRADE-LOCK-1 | Fenêtre 0–2 min après coup d'envoi (api_status encore NS) | 🔴 BLOQUANT | `db/migrations/023_trade_lock_during_match.sql` | **Ouvert** — voir `TRADE_LOCK_AUDIT.md` |
| BUG-TAX-ONLINE | Taux de taxe inversés dans l'optimistic update | 🔴 BLOQUANT | `stores/onlineGameStore.ts` | **Corrigé** ✅ |
| HAUTE-1 | UUID v4 non validé dans `/api/trade` | 🟠 MAJEUR | `app/api/trade/route.ts` | Partiellement corrigé |
| HAUTE-2 | Vue `leaderboard` expose `portfolios.id` | 🟠 MAJEUR | Vue SQL Supabase | À vérifier en base |
| MOYENNE | Messages d'erreur internes côté client | 🟡 MINEUR | Les 3 routes API | **Corrigé** ✅ |
| BUG-CAP-OFFLINE | Plafond 40% absent du `localGameStore` | 🟡 MINEUR | `stores/localGameStore.ts` | Non corrigé |
| TODO-TRADE-LOCK | Vérification `trade_lock_until` dans `/api/trade` (côté route) | 🟡 MINEUR | `app/api/trade/route.ts` | Partiellement implémenté (migration 023/024 — faille ouverte) |

**BUG-TAX-ONLINE — Corrigé ✅** (`stores/onlineGameStore.ts`)
```typescript
// Avant (incorrect) :
const fee = isKO ? gross * 0.10 : gross * 0.05;
const net = gross - (s.eliminated.includes(nationId) ? 0 : fee);

// Après (appliqué) :
const isElim = s.eliminated.includes(nationId);
const fee    = isElim || price <= 1
  ? 0
  : Math.max(gross * (isKO ? 0.05 : 0.10), 10);
const net    = gross - fee;
```

**Correctif HAUTE-1 :**
```typescript
// apps/web/app/api/trade/route.ts, après la vérification de deviceId
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!UUID_V4.test(deviceId)) {
  return NextResponse.json({ code: 'INVALID_DEVICE_ID', error: 'device ID invalide' }, { status: 400 });
}
```

---

## ANNEXE E — Variables d'environnement v3.1

> Identique à l'Annexe C, avec ajout de `ADVANCE_SECRET` (toujours non implémenté, CRITIQUE-1 ouvert).

| Variable | Usage | Où |
|----------|-------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase | Client + Server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publique Supabase | Client + Server |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé admin Supabase | Server uniquement |
| `CRON_SECRET` | Auth crons `sync-fixtures`, `sync-results`, `live-poll` | Server uniquement |
| `FOOTBALL_API_KEY` | Clé API-Football (utilisée par `live-poll`, `sync-fixtures`, `sync-results`) | Server uniquement |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN Sentry (optionnel) | Client + Server |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile (optionnel) | Server uniquement |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Clé publique Turnstile (optionnel) | Client |
| `ADVANCE_SECRET` | Auth `/api/game/advance` (**non implémenté** — CRITIQUE-1) | À créer |

---

*Document mis à jour le 2026-06-20 — Version 3.1. Changements : live-poll 24/7, scores en direct Schedule tab, classement online, FirstTradeUpsellModal, trade lock audit.*
