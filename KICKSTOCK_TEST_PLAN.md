# KICKSTOCK — CAHIER DE TESTS COMPLET
**Version :** 1.0.0  
**Date de rédaction :** 2026-05-26  
**Périmètre :** Monorepo Phase 2 — `apps/web` · `packages/*` · Base de données Supabase  
**Méthode :** Tests unitaires · Tests d'intégration · Tests de bout en bout · Audit sécurité · QA UI/UX  
**Outil de référence :** Ce document est la feuille de route unique pour valider chaque couche de l'application avant mise en production.

---

## TABLE DES MATIÈRES

1. [Infrastructure & Repo (Qualité & Build)](#1-infrastructure--repo)
2. [Sécurité & Isolation (Focus Supabase)](#2-sécurité--isolation)
3. [Tests Fonctionnels Métier](#3-tests-fonctionnels-métier)
4. [Compatibilité UI/UX (Browser vs Mobile)](#4-compatibilité-uiux)

---

## Conventions du document

| Statut | Signification |
|--------|---------------|
| `[ ]` | Test non exécuté |
| `[x]` | Test passé |
| `[!]` | Test échoué — anomalie ouverte |
| `[~]` | Test partiellement validé — contre-mesure en attente |

**Sévérité des anomalies :**
- 🔴 **BLOQUANT** — empêche une fonctionnalité critique, mise en production interdite
- 🟠 **MAJEUR** — dégradation significative, doit être corrigé avant release
- 🟡 **MINEUR** — inconfort utilisateur, peut passer en suivi post-release
- 🔵 **COSMÉTIQUE** — problème visuel sans impact fonctionnel

---

## 1. INFRASTRUCTURE & REPO

### 1.1 Validation de la structure Monorepo

#### 1.1.1 Vérification de l'arbre de packages déclarés

**Objectif :** S'assurer que `pnpm-workspace.yaml` reconnaît tous les packages et qu'aucun n'est orphelin.

```bash
# Commande de référence
pnpm ls -r --depth 0
```

**Résultat attendu :**
```
kickstock (root)
├── web @ apps/web
├── @kickstock/constants @ packages/constants
├── @kickstock/game-engine @ packages/game-engine
└── @kickstock/types @ packages/types
```

**Cas de défaillance :** Un package absent de la liste signifie que `pnpm-workspace.yaml` ne le couvre pas ou que son `package.json` a un `name` incorrect.

---

#### 1.1.2 Isolation des packages — Imports croisés illicites

**Objectif :** Vérifier qu'aucun package interne n'importe directement depuis le dossier `apps/` ou depuis un autre package en passant par un chemin relatif hors-workspace.

**Procédure :**

```bash
# Détecter les imports relatifs suspects dans les packages
grep -r "from '\.\.\/\.\.\/apps" packages/
grep -r "require('\.\.\/\.\.\/apps" packages/
```

**Résultat attendu :** Aucune ligne retournée. Chaque package ne doit référencer que ses propres sources ou d'autres `@kickstock/*` via leur nom de package.

**Cas de défaillance :** Un import tel que `from '../../apps/web/lib/...'` introduit un couplage ascendant qui casse le modèle de dépendances du monorepo.

---

#### 1.1.3 Vérification du graphe de dépendances (`@kickstock/types` comme source de vérité)

**Objectif :** Garantir que le flux de dépendances est acyclique et respecte la hiérarchie suivante :

```
@kickstock/types  (aucune dépendance interne)
       ↓
@kickstock/constants  (importe @kickstock/types)
       ↓
@kickstock/game-engine  (importe @kickstock/types + @kickstock/constants)
       ↓
apps/web  (importe les trois packages)
```

**Procédure :**

```bash
# Vérifier que @kickstock/types n'importe aucun autre package interne
grep -r "@kickstock/" packages/types/src/

# Vérifier que @kickstock/constants n'importe pas game-engine
grep -r "@kickstock/game-engine" packages/constants/src/

# Vérifier que @kickstock/game-engine n'importe pas apps/web
grep -r "from 'apps/" packages/game-engine/src/
```

**Résultat attendu :** Les trois commandes ne retournent aucune ligne.

---

#### 1.1.4 Résolution des types TypeScript partagés

**Objectif :** Valider que `LayoutType`, `Match`, `GameState`, `StoredMatchResult`, `Nation`, `CalendarDay` définis dans `@kickstock/types` sont correctement résolus dans tous les packages consommateurs.

**Procédure :**

```bash
pnpm -r type-check
```

**Résultat attendu :** Sortie `0 errors` pour chaque workspace. Toute erreur `TS2305: Module '@kickstock/types' has no exported member '...'` indique un export manquant ou un `tsconfig` mal configuré.

---

#### 1.1.5 Vérification de `tsconfig.base.json` — paths et composite

**Objectif :** Valider que le fichier `tsconfig.base.json` à la racine est référencé par les `tsconfig.json` de chaque package et que les `paths` sont cohérents.

**Procédure :**

```bash
# Vérifier que chaque package hérite du tsconfig de base
cat packages/game-engine/tsconfig.json | grep -E "extends|paths"
cat packages/constants/tsconfig.json   | grep -E "extends|paths"
cat apps/web/tsconfig.json             | grep -E "extends|paths"
```

**Résultat attendu :** Chaque fichier contient `"extends": "../../tsconfig.base.json"` (ou chemin équivalent). Les `paths` dans `apps/web` doivent mapper `@kickstock/*` vers les répertoires locaux des packages pour que le dev server résolve correctement sans build préalable.

---

### 1.2 Pipeline d'Intégration Continue

#### 1.2.1 Linting de l'ensemble du monorepo

**Objectif :** Zéro erreur de lint sur les quatre workspaces en un seul appel depuis la racine.

**Commande :**

```bash
pnpm lint
# Équivalent à : pnpm -r lint
```

**Résultat attendu :** Tous les workspaces retournent `0 errors, 0 warnings` (ou `0 errors` si les warnings sont tolérés). La commande se termine avec exit code `0`.

**Points de vigilance :**
- Les règles `no-explicit-any` sont intentionnellement contournées avec `// eslint-disable-next-line` dans les routes API pour les appels RPC Supabase. Ces désactivations ponctuelles sont acceptables mais ne doivent pas proliférer.
- Aucun import `@ts-ignore` sans commentaire explicatif ne doit subsister.

---

#### 1.2.2 Build de l'application Next.js sans erreur

**Objectif :** Produire un build de production valide de `apps/web`.

**Commande :**

```bash
pnpm build
# Équivalent à : pnpm --filter web build
```

**Résultat attendu :**
- Sortie `✓ Compiled successfully`
- Aucune erreur TypeScript dans la phase de compilation
- Toutes les routes API (`/api/trade`, `/api/game/state`, `/api/game/advance`, `/api/market`) apparaissent dans le récapitulatif des routes avec le flag `(Dynamic)`
- La taille du bundle client est cohérente avec la session précédente (absence de régression de poids)

**Vérifications post-build :**

```bash
# Taille des chunks principaux (référence à établir à la première validation)
du -sh .next/static/chunks/
```

---

#### 1.2.3 Build incrémental des packages — isolation de compilabilité

**Objectif :** Chaque package doit pouvoir se compiler indépendamment, sans dépendre d'un build préalable de `apps/web`.

**Procédure :**

```bash
# Compiler uniquement game-engine (sans lancer le build web)
pnpm --filter @kickstock/game-engine build

# Compiler uniquement constants
pnpm --filter @kickstock/constants build

# Compiler uniquement types
pnpm --filter @kickstock/types build
```

**Résultat attendu :** Exit code `0` pour chaque commande, indépendamment. Un échec sur `@kickstock/game-engine` sans que `apps/web` soit lancé révèle une dépendance implicite non déclarée.

---

#### 1.2.4 Suite de tests unitaires — `@kickstock/game-engine`

**Objectif :** Valider la couverture des fonctions pures du moteur de jeu.

**Commande :**

```bash
pnpm --filter @kickstock/game-engine test
```

**Cas de test à couvrir dans les tests unitaires du package :**

| Fonction | Scénario | Input | Output attendu |
|----------|----------|-------|---------------|
| `applyResult` | Victoire de A | `pA=100, pB=50, res='A'` | `[125, 25]` |
| `applyResult` | Victoire de B | `pA=100, pB=50, res='B'` | `[50, 125]` |
| `applyResult` | Match nul | `pA=100, pB=50, res='draw'` | `[112.5, 75]` |
| `applyResult` | Prix plancher | `pA=10, pB=10, res='B'` | `[5, 15]` — ne doit jamais retourner ≤ 0 |
| `applyResult` | Arrondi à 1 décimale | `pA=33, pB=17, res='A'` | Vérifie `Math.round(x * 10) / 10` |
| `deriveGroupStandings` | Tri par points | 4 équipes, scores variés | L'équipe avec 9 pts en tête |
| `deriveGroupStandings` | Égalité sur points | 2 équipes à 4 pts | Départage goal difference |
| `deriveGroupStandings` | Filtre éliminés | Équipe dans `eliminated[]` | Absente du classement retourné |
| `buildR32Pool` | Sélection 32 équipes | Groupes A–L complétés | 32 entrées sans doublon |
| `buildGroupStandingsUI` | Phase de groupes uniquement | `dayIndex >= 17` | Résultats KO ignorés |

---

#### 1.2.5 Vérification du `DIV_RATES` et de `INIT_CASH` — cohérence constantes/DB

**Objectif :** S'assurer que les taux de dividendes définis dans `@kickstock/constants` correspondent exactement aux valeurs utilisées par le RPC `distribute_dividends`.

**Référence constantes :**
```typescript
DIV_RATES = { r32: 0.10, r16: 0.15, qf: 0.20, sf: 0.30, final: 0.40, champion: 0.60 }
INIT_CASH = 10_000
```

**Procédure :** Lire le SQL de `distribute_dividends` dans `db/FULL_SETUP.sql` et comparer les valeurs `p_rate` passées depuis `apps/web/app/api/game/advance/route.ts` avec `DIV_RATES[round]`. Toute divergence est un bug de distribution financière.

---

## 2. SÉCURITÉ & ISOLATION

### 2.1 Stratégie de validation des règles RLS Supabase

> **Principe :** Chaque test RLS est exécuté avec deux clients Supabase distincts : un client authentifié via la clé anon (simulant l'utilisateur Y) et un client authentifié sous l'identité de l'utilisateur X. On vérifie que Y ne peut pas voir ni modifier les données de X.

#### 2.1.1 Environnement de test RLS

**Prérequis :** Deux comptes de test créés dans l'environnement Supabase de staging :

```
Utilisateur A : test-user-a@kickstock.test  (UUID connu, noté UID_A)
Utilisateur B : test-user-b@kickstock.test  (UUID connu, noté UID_B)
```

Chaque utilisateur dispose d'un portfolio initialisé à 10 000 KC et d'au moins une position ouverte (ex : 10 actions BRA pour A, 5 actions FRA pour B).

**Client de test :**

```javascript
import { createClient } from '@supabase/supabase-js';

// Client authentifié sous l'identité B (la "curiosité" ou l'attaque)
const sbB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
await sbB.auth.signInWithPassword({ email: 'test-user-b@kickstock.test', password: '...' });

// Client authentifié sous l'identité A (la "victime")
const sbA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
await sbA.auth.signInWithPassword({ email: 'test-user-a@kickstock.test', password: '...' });
```

---

#### 2.1.2 RLS-01 — Isolation lecture des portfolios

| Champ | Valeur |
|-------|--------|
| **ID** | RLS-01 |
| **Table** | `portfolios` |
| **Politique** | `portfolios_select_own` (`auth.uid() = user_id`) |
| **Objectif** | L'utilisateur B ne peut pas lire le portfolio de A |

**Procédure :**

```javascript
// Exécuté avec le client de B
const { data, error } = await sbB
  .from('portfolios')
  .select('*')
  .eq('user_id', UID_A);
```

**Résultat attendu :** `data` est un tableau vide `[]`. La politique RLS filtre silencieusement la ligne — aucune erreur n'est levée, mais aucune donnée n'est retournée.

**Résultat de défaillance :** Si `data` contient le portfolio de A avec son `cash`, `avg_cost` ou `tx_log`, la politique est défaillante.

> ⚠️ **Vulnérabilité connue CRITIQUE-2 :** La politique `portfolios_select_device` (`device_id IS NOT NULL`) expose tous les portfolios anonymes. Ce test DOIT échouer tant que cette politique existe. La correction est `DROP POLICY IF EXISTS "portfolios_select_device" ON portfolios;`. Valider ce test **après** correction.

---

#### 2.1.3 RLS-02 — Isolation lecture des positions

| Champ | Valeur |
|-------|--------|
| **ID** | RLS-02 |
| **Table** | `positions` |
| **Politique** | `positions_select_own` (`auth.uid() = user_id`) |
| **Objectif** | B ne peut pas lire les positions d'A |

**Procédure :**

```javascript
const { data } = await sbB
  .from('positions')
  .select('*')
  .eq('user_id', UID_A);
```

**Résultat attendu :** `data = []`.

---

#### 2.1.4 RLS-03 — Isolation lecture des transactions

| Champ | Valeur |
|-------|--------|
| **ID** | RLS-03 |
| **Table** | `transactions` |
| **Politique** | `transactions_select_own` (via portfolio_id) |
| **Objectif** | B ne peut pas lire l'historique de trades d'A |

**Procédure :**

```javascript
// Récupérer d'abord le portfolio_id de A (que B ne devrait pas connaître)
// Ce test simule un attaquant qui aurait obtenu l'UUID via une autre faille
const PORTFOLIO_ID_A = '...(uuid connu du testeur)...';

const { data } = await sbB
  .from('transactions')
  .select('*')
  .eq('portfolio_id', PORTFOLIO_ID_A);
```

**Résultat attendu :** `data = []`. La politique `transactions_select_own` vérifie que `portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())` — seule la session de A peut valider cette sous-requête.

---

#### 2.1.5 RLS-04 — Tentative de modification du portfolio d'autrui (UPDATE)

| Champ | Valeur |
|-------|--------|
| **ID** | RLS-04 |
| **Table** | `portfolios` |
| **Politique** | `portfolios_update_own` (`auth.uid() = user_id`) |
| **Objectif** | B ne peut pas injecter du cash dans le portfolio de A |

**Procédure :**

```javascript
const { data, error } = await sbB
  .from('portfolios')
  .update({ cash: 9999999 })
  .eq('user_id', UID_A);
```

**Résultat attendu :** `data = []` (0 lignes modifiées). Aucune erreur levée, mais le UPDATE ne modifie aucune ligne car la politique filtre la cible.

**Vérification complémentaire :** Relire le cash du portfolio A avec le client de A et confirmer qu'il est inchangé.

---

#### 2.1.6 RLS-05 — Tentative d'INSERT de trade au nom d'autrui

| Champ | Valeur |
|-------|--------|
| **ID** | RLS-05 |
| **Table** | `trades` |
| **Politique** | `trades_insert_own` (`auth.uid() = user_id`) |
| **Objectif** | B ne peut pas insérer un trade avec `user_id = UID_A` |

**Procédure :**

```javascript
const { data, error } = await sbB
  .from('trades')
  .insert({
    user_id:    UID_A,
    nation_id:  'BRA',
    mode:       'sell',
    quantity:   100,
    price:      200,
    tax:        0,
    net_amount: 20000,
    day_index:  5,
  });
```

**Résultat attendu :** `error` non null avec code `42501` (insufficient privilege) ou le INSERT échoue silencieusement avec `data = []`.

---

#### 2.1.7 RLS-06 — Isolation des dividendes

| Champ | Valeur |
|-------|--------|
| **ID** | RLS-06 |
| **Table** | `dividends` |
| **Politique** | `dividends_select_own` (via portfolio_id) |
| **Objectif** | B ne peut pas voir les dividendes perçus par A |

**Procédure :**

```javascript
const { data } = await sbB
  .from('dividends')
  .select('*')
  .eq('portfolio_id', PORTFOLIO_ID_A);
```

**Résultat attendu :** `data = []`.

---

#### 2.1.8 RLS-07 — Isolation des holdings

| Champ | Valeur |
|-------|--------|
| **ID** | RLS-07 |
| **Table** | `holdings` |
| **Politique** | `holdings_select_own` (via portfolio_id) |
| **Objectif** | B ne peut pas lire les positions en portefeuille d'A |

**Procédure :**

```javascript
const { data } = await sbB
  .from('holdings')
  .select('*')
  .eq('portfolio_id', PORTFOLIO_ID_A);
```

**Résultat attendu :** `data = []`.

---

#### 2.1.9 RLS-08 — Lectures publiques autorisées

**Objectif :** Confirmer que les tables à lecture publique sont bien accessibles sans authentification, et que seules ces tables le sont.

**Tables publiques :**

```javascript
// Avec un client non authentifié
const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const tables = ['nations', 'price_history', 'game_state', 'nation_prices',
                'group_standings', 'knockout_pools', 'matches', 'groups'];

for (const table of tables) {
  const { data, error } = await sbAnon.from(table).select('*').limit(1);
  // Résultat attendu : data non null, error null
}
```

**Tables privées — doit retourner `[]` sans authentification :**

```javascript
const privateTables = ['portfolios', 'positions', 'trades', 'holdings',
                       'transactions', 'dividends', 'profiles'];

for (const table of privateTables) {
  const { data } = await sbAnon.from(table).select('*').limit(5);
  // Résultat attendu : data = [] (pas d'erreur mais aucune donnée)
}
```

---

#### 2.1.10 RLS-09 — Validation de la vue `leaderboard`

**Objectif :** Confirmer que la vue `leaderboard` n'expose pas de données privées via la clé anon.

**Procédure :**

```javascript
const { data } = await sbAnon.from('leaderboard').select('*');
```

**Résultat attendu :** Les colonnes retournées sont uniquement `username`, `country`, `best_score`, `updated_at`. L'UUID de portfolio (`p.id`) ne doit pas apparaître dans le résultat.

> ⚠️ **Vulnérabilité connue HAUTE-2 :** Si la vue originale n'a pas été corrigée, `p.id` apparaîtra dans les résultats. Ce test valide que la correction `CREATE OR REPLACE VIEW leaderboard ...` sans `p.id` a été appliquée.

---

#### 2.1.11 RLS-10 — Isolation des competitions (accès authentifiés uniquement)

| Champ | Valeur |
|-------|--------|
| **ID** | RLS-10 |
| **Table** | `competitions` |
| **Politique** | `comp_select_authenticated` (`auth.role() = 'authenticated'`) |

**Procédure :**

```javascript
// Client non authentifié
const { data, error } = await sbAnon.from('competitions').select('*');
```

**Résultat attendu :** `data = []`. Un utilisateur non connecté ne peut pas lire la liste des compétitions.

---

### 2.2 Validation de l'Authentification

#### 2.2.1 AUTH-01 — Comportement sur token JWT expiré

**Objectif :** Vérifier que les routes API rejettent correctement une session expirée.

**Procédure :**

1. Obtenir un JWT valide pour un utilisateur de test via `sbA.auth.getSession()`.
2. Manipuler manuellement le `exp` du payload pour qu'il soit dans le passé (ou attendre l'expiration réelle si `JWT_EXPIRY` est configuré court sur le projet Supabase de test).
3. Envoyer une requête `POST /api/trade` avec ce token expiré dans le cookie de session.

**Résultat attendu :** Le middleware Supabase SSR (`@supabase/ssr`) détecte l'expiration et tente un refresh silencieux via le `refresh_token`. Si le refresh échoue (refresh_token révoqué), `getUser()` retourne `null` et la route tombe en mode anonyme (`userId = null`). La route ne doit pas planter avec un 500 — elle doit continuer avec `p_user_id = null` en passant par le `device_id`.

**Vérification complémentaire :** Confirmer qu'aucun détail du JWT expiré n'est loggé côté serveur avec des informations sensibles (email, UUID en clair dans les logs).

---

#### 2.2.2 AUTH-02 — Déconnexion forcée et invalidation de session côté client

**Objectif :** Après `supabase.auth.signOut()`, aucune requête vers les tables privées ne doit réussir.

**Procédure :**

```javascript
await sbA.auth.signOut();

// Tentative immédiate post-logout
const { data } = await sbA.from('portfolios').select('*');
```

**Résultat attendu :** `data = []`. Le cookie de session HttpOnly est supprimé par Supabase SSR lors du signOut — les requêtes suivantes sont des requêtes anon.

---

#### 2.2.3 AUTH-03 — Attribut des cookies de session

**Objectif :** Valider que les cookies de session Supabase sont `HttpOnly`, `Secure` et `SameSite=Lax`.

**Procédure :**

1. Ouvrir l'application en production (HTTPS).
2. Ouvrir les DevTools → Application → Cookies.
3. Identifier les cookies `sb-*` (Access Token et Refresh Token).

**Résultat attendu :** Chaque cookie `sb-*` affiche :
- `HttpOnly` : coché (non accessible via `document.cookie`)
- `Secure` : coché (HTTPS uniquement)
- `SameSite` : `Lax`

**Test XSS complémentaire :**

```javascript
// Exécuté dans la console du navigateur — doit retourner undefined ou ne pas inclure les tokens
document.cookie
// Les cookies HttpOnly ne peuvent pas être lus via JavaScript
```

---

#### 2.2.4 AUTH-04 — Trigger `handle_new_user` — création automatique profil + portfolio

**Objectif :** À la création d'un compte Supabase Auth, un profil et un portfolio sont automatiquement créés par le trigger `on_auth_user_created`.

**Procédure :**

1. Créer un nouveau compte via `sbNew.auth.signUp({ email: 'newuser@test.com', password: '...', options: { data: { username: 'TestUser' } } })`.
2. Lire immédiatement le profil et le portfolio avec le client admin.

```sql
-- Vérification SQL (Supabase SQL Editor)
SELECT p.id, p.username, pf.cash, pf.created_at
FROM profiles p
JOIN portfolios pf ON pf.user_id = p.id
WHERE p.id = '<new_user_id>';
```

**Résultat attendu :**
- 1 ligne dans `profiles` avec `username = 'TestUser'`
- 1 ligne dans `portfolios` avec `cash = 10000.00`
- Les deux lignes existent dans la même transaction (le trigger est `SECURITY DEFINER`)

---

### 2.3 Sécurisation de l'API de Trade

#### 2.3.1 SEC-TRADE-01 — Protection de `/api/game/advance` par secret

**Objectif :** Valider que la route `/api/game/advance` rejette toute requête sans le header `X-Advance-Secret` valide.

> ⚠️ **Vulnérabilité connue CRITIQUE-1 :** Sans cette protection, n'importe quel client anonyme peut avancer le jeu pour tous les joueurs. Ce test valide que le correctif a été appliqué.

**Procédure :**

```bash
# Test sans secret (doit être refusé)
curl -s -X POST https://kickstock.app/api/game/advance \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: fake-device-id" \
  -d '{"dayIndex": 0}'
```

**Résultat attendu :** `HTTP 401` avec body `{ "error": "Unauthorized" }`.

```bash
# Test avec un faux secret (doit être refusé)
curl -s -X POST https://kickstock.app/api/game/advance \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: fake-device-id" \
  -H "X-Advance-Secret: mauvais-secret" \
  -d '{"dayIndex": 0}'
```

**Résultat attendu :** `HTTP 401`.

---

#### 2.3.2 SEC-TRADE-02 — Validation du format UUID du `X-Device-ID`

**Objectif :** L'API `/api/trade` doit rejeter tout `X-Device-ID` qui n'est pas un UUID v4 valide.

> ⚠️ **Vulnérabilité connue HAUTE-1 :** Sans validation du format, un attaquant peut usurper l'identité d'un joueur en fournissant son `device_id`.

**Procédure :**

```bash
# Injection SQL dans le device_id
curl -s -X POST https://kickstock.app/api/trade \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: '; DROP TABLE portfolios;--" \
  -d '{"nationId":"BRA","mode":"buy","quantity":1}'

# UUID invalide
curl -s -X POST https://kickstock.app/api/trade \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: not-a-uuid" \
  -d '{"nationId":"BRA","mode":"buy","quantity":1}'

# UUID v1 (non v4)
curl -s -X POST https://kickstock.app/api/trade \
  -H "Content-Type: application/json" \
  -H "X-Device-ID: 6ba7b810-9dad-11d1-80b4-00c04fd430c8" \
  -d '{"nationId":"BRA","mode":"buy","quantity":1}'
```

**Résultat attendu :** `HTTP 400` avec `{ "error": "Invalid device ID" }` pour les deux premiers cas. Le troisième cas (UUID v1) doit être évalué selon la regex implémentée : si la regex exige `4[0-9a-f]{3}` au 3e segment, l'UUID v1 sera également rejeté.

---

#### 2.3.3 SEC-TRADE-03 — Anti double-dépense (atomicité du RPC `execute_trade`)

**Objectif :** Deux requêtes de trade simultanées sur le même portfolio ne doivent pas débiter le cash deux fois.

**Contexte technique :** Le RPC `execute_trade` utilise `FOR UPDATE` sur la ligne `portfolios` et la ligne `holdings`. PostgreSQL pose un verrou exclusif sur ces lignes pour la durée de la transaction, sérialisant les accès concurrents.

**Procédure :**

```bash
# Lancer deux achats simultanés avec le même device_id
# Portfolio initial : cash = 500 KC, BRA = 200 KC/action
# Chaque achat : 2 actions × 200 KC = 400 KC

DEVICE="xxxxxxxx-xxxx-xxxx-4xxx-xxxxxxxxxxxx"

curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" \
  -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"buy","quantity":2}' &

curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" \
  -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"buy","quantity":2}' &

wait
```

**Résultat attendu :** L'une des deux requêtes réussit (`ok: true`, `new_cash: 100`). La seconde retourne `{ "error": "Fonds insuffisants" }` avec HTTP 422. Le cash final du portfolio est `100 KC` (500 − 400), pas `−300 KC`.

**Vérification SQL :**

```sql
SELECT cash FROM portfolios WHERE device_id = 'xxxxxxxx-xxxx-xxxx-4xxx-xxxxxxxxxxxx';
-- Doit retourner 100.00, jamais une valeur négative
```

---

#### 2.3.4 SEC-TRADE-04 — Validation côté serveur : paramètres manquants ou invalides

**Objectif :** La route `/api/trade` valide les paramètres avant d'appeler le RPC.

**Cas à tester :**

```bash
BASE_URL="https://kickstock.app/api/trade"
DEVICE="xxxxxxxx-xxxx-xxxx-4xxx-xxxxxxxxxxxx"
HEADERS='-H "Content-Type: application/json" -H "X-Device-ID: '"$DEVICE"'"'

# Cas 1 : nationId manquant
curl -s -X POST $BASE_URL $HEADERS -d '{"mode":"buy","quantity":1}'
# Attendu : HTTP 400, { "error": "Paramètres invalides" }

# Cas 2 : quantity = 0
curl -s -X POST $BASE_URL $HEADERS -d '{"nationId":"BRA","mode":"buy","quantity":0}'
# Attendu : HTTP 400, { "error": "Paramètres invalides" }

# Cas 3 : quantity négative
curl -s -X POST $BASE_URL $HEADERS -d '{"nationId":"BRA","mode":"buy","quantity":-5}'
# Attendu : HTTP 400, { "error": "Paramètres invalides" }

# Cas 4 : mode invalide
curl -s -X POST $BASE_URL $HEADERS -d '{"nationId":"BRA","mode":"short","quantity":1}'
# Attendu : HTTP 400, { "error": "Mode invalide: buy ou sell" }

# Cas 5 : nationId inexistant dans la base
curl -s -X POST $BASE_URL $HEADERS -d '{"nationId":"XXX","mode":"buy","quantity":1}'
# Attendu : HTTP 422, { "error": "Nation introuvable" }

# Cas 6 : quantity décimale (doit être tronquée à l'entier)
curl -s -X POST $BASE_URL $HEADERS -d '{"nationId":"BRA","mode":"buy","quantity":2.9}'
# Attendu : traité comme quantity=2 (Math.floor dans la route)
```

---

#### 2.3.5 SEC-TRADE-05 — Validation côté serveur : règle métier "plafond 40%"

**Objectif :** Pendant la phase de groupes (jours 0 à 22, `v_is_cap = TRUE`), un joueur ne peut pas détenir plus de 40% de la valeur totale de son portfolio dans une seule nation.

**Procédure :**

```
Portfolio de test :
- cash = 10 000 KC
- 0 position ouverte
- BRA = 200 KC/action
- Valeur totale = 10 000 KC (100% cash)

Achat limite : 40% de 10 000 = 4 000 KC → 20 actions BRA max
```

```bash
# Achat de 20 actions BRA (40% exact — doit passer)
curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"buy","quantity":20}'
# Attendu : ok: true, new_cash: 6000

# Achat d'1 action supplémentaire (dépasse 40% — doit échouer)
curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"buy","quantity":1}'
# Attendu : HTTP 422, { "error": "⛔ Plafond 40% atteint" }
```

**Vérification complémentaire :** Passer au jour 23 (phase KO) et vérifier que le même achat est accepté (la règle de plafonnement ne s'applique plus, `v_is_cap = FALSE`).

---

#### 2.3.6 SEC-TRADE-06 — Validation côté serveur : achat d'une nation éliminée

**Objectif :** Tenter d'acheter une nation présente dans `game_state.eliminated` doit être refusé.

**Procédure :**

```sql
-- En base de données (test env) : marquer HAI comme éliminée
UPDATE game_state SET eliminated = array_append(eliminated, 'HAI') WHERE id = 1;
```

```bash
curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"HAI","mode":"buy","quantity":5}'
# Attendu : HTTP 422, { "error": "Nation éliminée 💀" }
```

**Vérification complémentaire — vente d'une nation éliminée (autorisée sans frais) :**

```bash
# Supposons que le joueur détient 10 actions HAI avant l'élimination
curl -s -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $DEVICE" -H "Content-Type: application/json" \
  -d '{"nationId":"HAI","mode":"sell","quantity":10}'
# Attendu : ok: true, fee: 0 (pas de frais sur vente de nation éliminée)
```

---

#### 2.3.7 SEC-TRADE-07 — Frais de transaction selon la phase

**Objectif :** Les frais de vente sont de 5% pendant la phase de groupes (jours 0–22) et 10% en phase KO (jours 23+).

**Procédure :**

```
Scénario : vente de 10 actions BRA à 200 KC/action = 2 000 KC brut

Phase groupes (jour ≤ 22) :
- Frais = 2 000 × 0.05 = 100 KC
- Net reçu = 1 900 KC

Phase KO (jour ≥ 23) :
- Frais = 2 000 × 0.10 = 200 KC
- Net reçu = 1 800 KC
```

**Vérification SQL post-trade :**

```sql
SELECT fee, total FROM transactions
WHERE portfolio_id = '<PORTFOLIO_ID>'
ORDER BY created_at DESC LIMIT 1;
```

---

#### 2.3.8 SEC-TRADE-08 — Généricité des messages d'erreur 500

**Objectif :** Aucun message d'erreur interne (nom de table, contrainte PostgreSQL, stack trace) ne doit être retourné au client en HTTP 500.

**Procédure :** Provoquer délibérément une erreur interne en passant un `dayIndex` négatif à `/api/game/advance` ou en corrompant le payload JSON.

```bash
curl -s -X POST https://kickstock.app/api/game/advance \
  -H "Content-Type: application/json" \
  -H "X-Advance-Secret: $ADVANCE_SECRET" \
  -d 'payload_json_invalide{'
# Attendu : HTTP 500, { "error": "Internal server error" }
# NON attendu : { "error": "SyntaxError: Unexpected token p in JSON at position 0" }
```

---

## 3. TESTS FONCTIONNELS MÉTIER

> **Format des cas de test :** Chaque cas est présenté avec ses champs ID · Titre · Pré-requis · Étapes · Résultat attendu.

---

### 3.1 Flux d'inscription, connexion et attribution du capital initial

---

**ID :** FT-AUTH-01  
**Titre :** Inscription d'un nouvel utilisateur avec username — attribution du capital initial  
**Pré-requis :** Environnement Supabase fonctionnel, trigger `on_auth_user_created` actif  
**Étapes :**
1. Naviguer vers l'application et cliquer sur "Connexion" / `AuthWidget`.
2. Choisir l'inscription avec email/mot de passe.
3. Renseigner `email = newplayer@test.com`, `password = Test1234!`, `username = NoviceTrader`.
4. Valider le formulaire.
5. Observer le comportement de l'interface immédiatement après.

**Résultat attendu :**
- L'`AuthWidget` affiche l'avatar ou le username `NoviceTrader`.
- Le header mobile affiche `10 000 KC` dans la zone cash.
- En base : `profiles` contient 1 ligne avec `username = 'NoviceTrader'`, `tut_seen = false`.
- En base : `portfolios` contient 1 ligne avec `user_id = UID_nouveau`, `cash = 10000.00`, `tx_log = []`.
- Aucun doublon créé (contrainte `ON CONFLICT DO NOTHING` dans le trigger).

---

**ID :** FT-AUTH-02  
**Titre :** Connexion d'un utilisateur existant — récupération du portfolio persisté  
**Pré-requis :** Utilisateur `returningplayer@test.com` existant avec cash = 7 543.50 KC et 5 positions ouvertes  
**Étapes :**
1. Se connecter avec `returningplayer@test.com`.
2. Observer le header et le tab Portfolio (mobile) ou la sidebar Portfolio (browser).

**Résultat attendu :**
- Cash affiché = `7 543.50 KC` (valeur persistée, pas réinitialisée).
- Les 5 positions apparaissent dans le portfolio avec leurs quantités correctes.
- Le `tx_log` du portfolio est intact — l'historique des transactions est visible.

---

**ID :** FT-AUTH-03  
**Titre :** Fusion portfolio anonyme → portfolio authentifié  
**Pré-requis :** Un joueur a utilisé l'application en mode anonyme (device_id stocké en localStorage) avec cash = 8 000 KC et 3 positions ouvertes. Il n'a jamais créé de compte.  
**Étapes :**
1. Depuis la session anonyme existante, cliquer sur "Connexion".
2. Créer un nouveau compte.
3. Observer le portfolio post-connexion.

**Résultat attendu :**
- Le RPC `get_or_create_portfolio` trouve d'abord le portfolio via `device_id`, puis met à jour `user_id` si `user_id IS NULL`.
- Le cash (8 000 KC) et les positions sont préservés — le portfolio anonyme devient le portfolio authentifié.
- Le `device_id` reste associé au portfolio pour les sessions future sans connexion.

---

**ID :** FT-AUTH-04  
**Titre :** Username dupliqué — erreur explicite à l'inscription  
**Pré-requis :** L'utilisateur `TestUser` existe déjà dans `profiles`  
**Étapes :**
1. Tenter de s'inscrire avec le même `username = 'TestUser'`.

**Résultat attendu :**
- L'inscription échoue avec un message d'erreur compréhensible pour l'utilisateur (ex : "Ce pseudonyme est déjà pris").
- La contrainte `UNIQUE` sur `profiles.username` empêche l'insertion. L'interface ne doit pas afficher `duplicate key value violates unique constraint "profiles_username_key"`.

---

### 3.2 Flux de placement d'un Trade (Achat / Vente)

---

**ID :** FT-TRADE-01  
**Titre :** Achat d'actions d'une nation active — flux nominal complet  
**Pré-requis :** Joueur connecté, cash = 10 000 KC, aucune position, journée en cours = Jour 3 (phase groupes), BRA = 200 KC/action  
**Étapes :**
1. Naviguer vers l'onglet Market (mobile) ou la vue Market (browser).
2. Cliquer sur la NationCard de Brazil (🇧🇷 BRA).
3. Dans le `TradeModal`, saisir la quantité `10`.
4. Cliquer sur "Acheter".
5. Attendre la confirmation.

**Résultat attendu :**
- HTTP 200 de `/api/trade` avec `ok: true`, `new_cash: 8000`, `new_held: 10`, `price: 200`, `fee: 0`.
- Le header met à jour le cash à `8 000 KC` sans reload de page.
- L'onglet Portfolio affiche une nouvelle ligne "BRA · 10 actions · Prix moyen : 200 KC".
- En base : `holdings` contient `portfolio_id=X, nation_id='BRA', quantity=10`.
- En base : `transactions` contient 1 ligne avec `type='buy', quantity=10, price=200, fee=0, total=2000`.
- En base : `portfolios.tx_log[0]` contient `{ dir:'buy', flag:'🇧🇷', name:'Brazil', qty:10, price:200 }`.

---

**ID :** FT-TRADE-02  
**Titre :** Vente partielle d'une position — calcul des frais  
**Pré-requis :** Joueur avec 20 actions BRA à prix moyen 180 KC, cash = 5 000 KC, journée en cours = Jour 5 (phase groupes, `v_is_cap = TRUE`), BRA prix courant = 200 KC  
**Étapes :**
1. Ouvrir le `TradeModal` de BRA.
2. Saisir la quantité `10` en mode vente.
3. Confirmer.

**Résultat attendu :**
- Frais = 10 × 200 × 5% = 100 KC
- Net reçu = (10 × 200) − 100 = 1 900 KC
- `new_cash = 5 000 + 1 900 = 6 900 KC`
- `new_held = 20 − 10 = 10 actions`
- P&L affiché : (200 − 180) × 10 = +200 KC sur la position clôturée

---

**ID :** FT-TRADE-03  
**Titre :** Vente totale d'une position — nettoyage du holding  
**Pré-requis :** Joueur avec exactement 5 actions GER, GER = 100 KC  
**Étapes :**
1. Vendre les 5 actions GER au prix courant.

**Résultat attendu :**
- `new_held = 0`
- En base : la ligne `holdings` avec `nation_id='GER'` est supprimée (`DELETE FROM holdings WHERE id = v_hid`).
- En base : `avg_cost` JSONB sur le portfolio ne contient plus la clé `"GER"` (`v_avg_cost := v_avg_cost - p_nation_id`).
- L'onglet Portfolio ne liste plus GER.

---

**ID :** FT-TRADE-04  
**Titre :** Affichage du prix courant dans le `TradeModal` — cohérence avec l'état global  
**Pré-requis :** La simulation vient d'être jouée, les prix ont changé  
**Étapes :**
1. Ouvrir le `TradeModal` de ESP.
2. Observer le prix affiché.
3. Comparer avec `nations.current_price` en base.

**Résultat attendu :**
- Le prix dans le modal est identique à `nations.current_price` pour ESP.
- Si le prix a changé depuis l'ouverture du modal (polling de 3s), le modal reflète le nouveau prix (ou un indicateur de "prix mis à jour" est visible).

---

### 3.3 Flux de clôture d'une journée (Simulation)

---

**ID :** FT-SIM-01  
**Titre :** Simulation d'une journée de groupes — mise à jour des prix  
**Pré-requis :** Journée courante = Jour 1 (MEX vs RSA, KOR vs CZE), `game_state.current_day_index = 0`, `advancing = false`  
**Étapes :**
1. Cliquer sur le bouton "⚡ PLAY" (mobile : onglet Simulate, browser : bouton dans la topbar).
2. Attendre la fin de l'animation de résultats.

**Résultat attendu :**
- L'API `/api/game/advance` reçoit `{ dayIndex: 0 }`.
- Le verrou CAS est acquis (`advancing = true`) puis relâché (`advancing = false`).
- Pour chaque match de la journée, un résultat est simulé et persisté dans `matches` (`score_a`, `score_b`, `winner_id`, `is_upset`).
- Les prix sont recalculés avec `applyResult` et insérés dans `nation_prices` pour `day_index = 1`.
- Le trigger `trg_sync_nation_price` met à jour `nations.current_price` pour MEX, RSA, KOR, CZE.
- `game_state.current_day_index` passe à `1`.
- L'interface affiche les nouveaux prix (hausse en `--gain` vert, baisse en `--loss` rouge).

---

**ID :** FT-SIM-02  
**Titre :** Distribution des dividendes lors du passage en R32 (Jour 18)  
**Pré-requis :** Journée courante = Jour 17 (dernier jour de groupes), joueur A détient 10 actions BRA (prix courant = 250 KC après les groupes), BRA qualifiée pour R32  
**Étapes :**
1. Jouer la journée 17 via le bouton PLAY.

**Résultat attendu :**
- Le RPC `distribute_dividends` est appelé avec `p_nation_id='BRA'`, `p_round='r32'`, `p_rate=0.10`, `p_price=250`, `p_day_index=18`.
- Dividende = 10 actions × 250 KC × 10% = 250 KC.
- `portfolios.cash` du joueur A est augmenté de 250 KC.
- En base : `dividends` contient 1 ligne `(portfolio_id=A, nation_id='BRA', round='r32', amount=250, shares=10)`.
- L'interface affiche la notification de dividende reçu (si feature UI implémentée).

---

**ID :** FT-SIM-03  
**Titre :** Recalcul du classement après résultats de groupe  
**Pré-requis :** Groupe C : BRA (9 pts), MAR (6 pts), SCO (3 pts), HAI (0 pts) après 3 journées  
**Étapes :**
1. Observer l'onglet Standings (mobile) ou la vue Standings (browser).

**Résultat attendu :**
- `buildGroupStandingsUI` retourne le groupe C trié : BRA → MAR → SCO → HAI.
- Les colonnes MP/W/D/L/GF/GA/Pts affichent les valeurs cohérentes avec les résultats simulés.
- HAI n'est pas marquée comme éliminée tant que la phase de groupes n'est pas terminée.

---

**ID :** FT-SIM-04  
**Titre :** Appel à `/api/game/advance` avec `dayIndex` déjà passé — idempotence  
**Pré-requis :** `game_state.current_day_index = 5` (le jeu est déjà au jour 5)  
**Étapes :**
1. Envoyer manuellement `POST /api/game/advance` avec `{ dayIndex: 4 }` (un jour déjà joué).

**Résultat attendu :**
- La route retourne `{ alreadyAdvanced: true, newDayIndex: 5 }` avec HTTP 200.
- Aucune modification de la base de données ne se produit.
- Le cash et les positions de tous les joueurs restent inchangés.

---

**ID :** FT-SIM-05  
**Titre :** Concurrence sur `/api/game/advance` — verrou CAS  
**Pré-requis :** `game_state.advancing = false`, `current_day_index = 10`  
**Étapes :**
1. Envoyer deux requêtes `POST /api/game/advance` avec `{ dayIndex: 10 }` en parallèle simultané.

**Résultat attendu :**
- L'une des requêtes acquiert le verrou (`advancing = true`) et complète la simulation.
- L'autre requête reçoit HTTP 409 `{ advancing: true, message: "Day already advancing" }`.
- La journée est simulée exactement une fois — les prix ne sont mis à jour qu'une seule fois.

---

### 3.4 Cas limites critiques

---

**ID :** FT-EDGE-01  
**Titre :** Tentative de trade avec un solde de crédits insuffisant  
**Pré-requis :** Joueur avec cash = 150 KC, BRA = 200 KC/action  
**Étapes :**
1. Tenter d'acheter 1 action BRA (coût = 200 KC > cash disponible).

**Résultat attendu :**
- HTTP 422 avec `{ "error": "Fonds insuffisants" }`.
- Le cash du joueur reste à 150 KC — aucune modification en base.
- L'interface affiche le message d'erreur dans le `TradeModal` sans fermer celui-ci.

---

**ID :** FT-EDGE-02  
**Titre :** Tentative de vente d'actions non détenues (vente à découvert)  
**Pré-requis :** Joueur sans aucune position sur MEX  
**Étapes :**
1. Tenter de vendre 5 actions MEX.

**Résultat attendu :**
- HTTP 422 avec `{ "error": "Actions insuffisantes" }`.
- La route vérifie `v_held < p_quantity` dans le RPC. `v_held = 0 < 5` → rejet.

---

**ID :** FT-EDGE-03  
**Titre :** Coupure réseau pendant une transaction — état de la base  
**Pré-requis :** Joueur avec cash = 5 000 KC, 0 actions BRA  
**Étapes :**
1. Initier un achat de 10 actions BRA (2 000 KC).
2. Simuler une coupure réseau côté client pendant que le serveur traite la requête (via les DevTools → Network → Offline, ou en coupant la connexion 50ms après l'envoi).
3. Rétablir la connexion.
4. Observer l'état du portfolio.

**Résultat attendu :**
- Le RPC `execute_trade` est atomique (ACID). Soit la transaction est complète (cash débité, holding créé), soit elle est annulée.
- Il ne doit **jamais** exister un état où le cash est débité sans que le holding soit créé, ou vice-versa.
- La requête côté client retourne soit un `ok: true` soit un timeout sans réponse. Si timeout, l'interface doit permettre de vérifier l'état actuel du portfolio sans relancer le trade automatiquement.

---

**ID :** FT-EDGE-04  
**Titre :** Parier à la "dernière seconde" — comportement lors du basculement de journée  
**Pré-requis :** Un joueur tente un trade exactement au moment où `/api/game/advance` s'exécute  
**Étapes :**
1. Simuler la concurrence : envoyer simultanément un `POST /api/trade` et un `POST /api/game/advance`.

**Résultat attendu :**
- Le trade utilise le prix de `nations.current_price` au moment de son exécution (`SELECT current_price FROM nations WHERE id = p_nation_id`).
- Si le trade arrive *avant* la mise à jour des prix, il est traité au prix de la journée précédente.
- Si le trade arrive *après*, il est traité au nouveau prix.
- Il ne peut pas exister de trade exécuté avec un prix incohérent (mi-vieux, mi-nouveau) car `execute_trade` lit le prix au début de sa transaction PostgreSQL.

---

**ID :** FT-EDGE-05  
**Titre :** Overflow du `tx_log` — troncature à 100 entrées  
**Pré-requis :** Joueur avec exactement 100 transactions dans son `tx_log`  
**Étapes :**
1. Exécuter un 101ème trade.

**Résultat attendu :**
- `tx_log` reste à 100 entrées (`jsonb_array_length(v_tx_log) <= 100`).
- L'entrée la plus ancienne (index 100) est supprimée, la plus récente est en position 0.
- Aucune donnée de transaction n'est perdue dans la table `transactions` (qui elle est illimitée).

---

**ID :** FT-EDGE-06  
**Titre :** Fin de tournoi — nation championne et dividende final  
**Pré-requis :** Simulation au jour 33 (Finale), joueur détient 5 actions FRA, FRA remporte la finale  
**Étapes :**
1. Jouer la journée 33 (la Finale).

**Résultat attendu :**
- `game_state.champion_id = 'FRA'`.
- `distribute_dividends` est appelé avec `p_round='champion'`, `p_rate=0.60`.
- Dividende champion = 5 × prix_FRA × 60%.
- Le portfolio du joueur reçoit ce dividende en cash.
- L'interface affiche un overlay ou une animation de célébration.

---

**ID :** FT-EDGE-07  
**Titre :** Plafond 40% — calcul dynamique avec positions existantes  
**Pré-requis :**
```
Portfolio : cash = 2 000 KC
Holdings : BRA × 20 = 4 000 KC (à 200), GER × 10 = 1 000 KC (à 100)
Valeur totale = 2 000 + 4 000 + 1 000 = 7 000 KC
BRA = 57.1% du portfolio → déjà au-dessus du plafond
```
**Étapes :**
1. Tenter d'acheter 1 action GER supplémentaire (100 KC, cash suffisant).
2. Tenter d'acheter 1 action BRA supplémentaire (200 KC, cash suffisant).

**Résultat attendu :**
- Achat GER : autorisé (GER passerait à 15.7% < 40%).
- Achat BRA : refusé `⛔ Plafond 40% atteint` car BRA est déjà à 57.1% et tout achat supplémentaire aggrave la situation.

---

## 4. COMPATIBILITÉ UI/UX

### 4.1 Grille de vérification Cross-Platform

La grille ci-dessous doit être complétée pour chaque device/navigateur cible avant release.

#### 4.1.1 Matrice de couverture des environnements

| # | Environnement | Résolution | Shell attendu | Statut |
|---|--------------|------------|---------------|--------|
| E1 | Chrome 124+ macOS (dev) | 1440 × 900 | BrowserShell | `[ ]` |
| E2 | Chrome 124+ Windows | 1920 × 1080 | BrowserShell | `[ ]` |
| E3 | Firefox 125+ macOS | 1440 × 900 | BrowserShell | `[ ]` |
| E4 | Safari 17+ macOS | 1440 × 900 | BrowserShell | `[ ]` |
| E5 | Edge 124+ Windows | 1920 × 1080 | BrowserShell | `[ ]` |
| E6 | Chrome DevTools Mobile (iPhone 14 Pro, 393 × 852) | 393 px | MobileShell | `[ ]` |
| E7 | Chrome DevTools Mobile (Pixel 7, 412 × 915) | 412 px | MobileShell | `[ ]` |
| E8 | Safari iOS 17 — iPhone réel | < 600 px | MobileShell | `[ ]` |
| E9 | Chrome Android — Samsung Galaxy S24 | < 600 px | MobileShell | `[ ]` |
| E10 | iPad Pro 12.9" portrait (1024 × 1366) | 1024 px | BrowserShell | `[ ]` |
| E11 | iPad mini portrait (768 × 1024) | 768 px | BrowserShell | `[ ]` |
| E12 | Redimensionnement live : 1200 px → 500 px | Transition | Switch shell | `[ ]` |

---

#### 4.1.2 Checklist de base commune (tous environnements)

Pour chaque environnement de la matrice, valider les points suivants :

- `[ ]` Le bon shell est monté (`MobileShell` si `window.innerWidth < 600`, `BrowserShell` sinon)
- `[ ]` Le ticker défile sans saccade
- `[ ]` Le cash et la valeur totale s'affichent dans le header
- `[ ]` Au moins un onglet/vue est accessible et affiche du contenu
- `[ ]` Un trade de test (achat 1 action) s'exécute correctement
- `[ ]` Aucune erreur dans la console JavaScript (`console.error`, erreurs réseau non gérées)
- `[ ]` Les variables CSS `--gold`, `--gain`, `--loss` sont appliquées correctement (fond sombre, textes contrastés)

---

### 4.2 Tests spécifiques Browser (Desktop)

#### 4.2.1 UI-BROWSER-01 — Layout sidebar + main : intégrité à différentes largeurs

**Objectif :** La sidebar de 72px ne doit jamais rétrécir ni empiéter sur le contenu principal, même à la résolution minimale browser (600px).

**Procédure :**

1. Ouvrir le BrowserShell à exactement 600px de largeur (DevTools).
2. Vérifier visuellement et par inspection CSS.

**Résultat attendu :**
- Sidebar : `width: 72px`, `flex-shrink: 0` — ne rétrécit pas.
- Zone `ks-main` : `flex: 1`, `min-width: 0` — prend le reste sans overflow horizontal.
- Aucune scrollbar horizontale n'apparaît sur le body.

---

#### 4.2.2 UI-BROWSER-02 — Vue HOME : layout 2 colonnes (48% / 52%)

**Procédure :**

1. Naviguer vers la vue Home du BrowserShell.
2. Inspecter la division gauche (planning) et droite (market).

**Résultat attendu :**
- Colonne gauche : `width: 48%`, `border-right: 1px solid var(--border)`.
- Colonne droite : `flex: 1`, scrollable indépendamment de la colonne gauche.
- Le contenu d'une colonne ne déborde pas dans l'autre.
- À 800px de largeur totale (après sidebar 72px → 728px pour le main), les deux colonnes restent lisibles.

---

#### 4.2.3 UI-BROWSER-03 — Grille de StockTiles — `auto-fill` et responsive grid

**Procédure :**

1. Naviguer vers la vue Market.
2. Redimensionner la fenêtre de 1400px à 700px tout en observant la grille.

**Résultat attendu :**
- La grille `.mkt-grid` utilise `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`.
- À 1400px : 5–6 colonnes.
- À 900px : 3–4 colonnes.
- À 700px (après sidebar) : 2 colonnes.
- Aucune tile n'est coupée ou n'a de dimension nulle.

---

#### 4.2.4 UI-BROWSER-04 — Hover states sur les NationCards / StockTiles

**Procédure :**

1. Survoler une StockTile dans la vue Market.
2. Observer les transitions CSS.

**Résultat attendu :**
- Un état hover distinct est visible (changement de background, bordure accentuée, ou élévation de la carte).
- La transition est fluide (CSS `transition`, pas de saut brutal).
- Le curseur devient `pointer` au survol des éléments cliquables.

---

#### 4.2.5 UI-BROWSER-05 — Tableau des standings de groupe — lisibilité multi-groupes

**Procédure :**

1. Naviguer vers la vue Standings en phase de groupes (12 groupes actifs).
2. Observer la grille `.std-grid`.

**Résultat attendu :**
- La grille utilise `repeat(auto-fill, minmax(280px, 1fr))` — les groupes se répartissent automatiquement.
- Chaque groupe affiche les 4 équipes avec MP/W/D/L/GF/GA/Pts correctement alignés.
- À 1440px : 4–5 groupes par ligne.
- Le scroll vertical fonctionne si les groupes débordent la hauteur visible.

---

#### 4.2.6 UI-BROWSER-06 — Bouton "PLAY" dans la topbar — état loading et disabled

**Procédure :**

1. Cliquer sur le bouton "⚡ PLAY" dans la topbar du BrowserShell.
2. Observer immédiatement l'état du bouton pendant l'appel API.

**Résultat attendu :**
- Le bouton passe immédiatement en état disabled/loading (indicateur visuel — spinner ou opacité réduite).
- Il ne peut pas être cliqué deux fois (prévention de double-appel à `/api/game/advance`).
- Après réception de la réponse, le bouton redevient actif et les résultats s'affichent.

---

#### 4.2.7 UI-BROWSER-07 — Historique de prix (sparkline/graphique) — cohérence des données

**Pré-requis :** S'applique si la feature de graphique de prix est implémentée dans le BrowserShell  
**Procédure :**

1. Naviguer vers la fiche détaillée d'une nation (`NationDetailOverlay`).
2. Observer le graphique de prix.

**Résultat attendu :**
- Les valeurs sur l'axe Y correspondent aux entrées dans `nation_prices` pour cette nation, triées par `day_index` croissant.
- Le dernier point du graphique correspond à `nations.current_price`.
- Le graphique ne crash pas lorsqu'une nation n'a qu'un seul point de données (jour 0).

---

### 4.3 Tests spécifiques Mobile

#### 4.3.1 UI-MOBILE-01 — Zones tactiles : minimum 44 × 44 px

**Objectif :** Chaque élément interactif de l'interface mobile doit avoir une zone de tap d'au moins 44 × 44 px (standard Apple Human Interface Guidelines et WCAG 2.5.5).

**Procédure :**

Pour chaque élément listé, inspecter dans les DevTools (mode device mobile) la `boundingClientRect` ou les dimensions CSS effectives :

| Élément | Dimension minimale requise | Comment mesurer |
|---------|--------------------------|-----------------|
| Boutons de la Tab Bar (5 onglets) | 44 × 44 px | Tab bar height 64px, largeur = viewport/5 |
| Bouton central "⚡ PLAY" | 44 × 44 px (accentué, généralement plus grand) | Inspecter `.play` |
| Boutons "Acheter" / "Vendre" du `TradeModal` | 44 px de hauteur minimum | CSS height |
| Bouton de confirmation de trade | 44 px de hauteur | CSS height |
| Input de quantité dans le `TradeModal` | 44 px de hauteur | CSS height |
| Lien/bouton de chaque NationCard | Zone cliquable = toute la card | padding + height |
| Bouton "×" de fermeture des overlays | 44 × 44 px | Padding autour de l'icône |
| Éléments de la liste des matchs (`ScheduleTab`) | 44 px de hauteur par item | CSS line-height + padding |

**Résultat attendu :** Aucun élément interactif sous les 44 × 44 px. Les éléments trop petits visuellement peuvent avoir leur zone tactile étendue via `padding` ou `min-height` CSS sans agrandir le visuel.

---

#### 4.3.2 UI-MOBILE-02 — Tab Bar Bottom Navigation — comportement et état actif

**Procédure :**

1. Taper successivement sur chacun des 5 onglets : SCHED. · STNDGS · PLAY · MARKET · PORTF.
2. Observer le changement de contenu et l'indicateur d'onglet actif.

**Résultat attendu :**
- Le contenu change immédiatement (montage/démontage du composant d'onglet).
- L'onglet actif est visuellement distingué (couleur `--gold`, fond, ou indicateur).
- Les 4 autres onglets sont à l'état inactif.
- La Tab Bar reste fixe en bas de l'écran même si le contenu de l'onglet est long et scrollable.
- `flex-shrink: 0` sur `.nav` — la Tab Bar ne rétrécit pas sous la pression du contenu.

---

#### 4.3.3 UI-MOBILE-03 — Gestion de `100dvh` — barre d'adresse et barre système

**Objectif :** L'application ne doit pas être coupée par la barre d'adresse du navigateur mobile ni par les barres de navigation système.

**Procédure :**

1. Ouvrir l'application sur Chrome Android ou Safari iOS (device réel).
2. Observer si la Tab Bar est entièrement visible sans être coupée par la barre système.
3. Faire défiler le contenu de l'onglet MARKET — la Tab Bar doit rester visible.
4. Tapper sur un input dans le `TradeModal` pour faire apparaître le clavier virtuel.

**Résultat attendu :**
- `.shell { height: 100dvh }` : `dvh` (dynamic viewport height) ajuste automatiquement la hauteur au viewport réel après que le navigateur a replié sa barre d'adresse.
- La Tab Bar est toujours entièrement visible, même lorsque le clavier virtuel est affiché (voir UI-MOBILE-05 pour le test clavier).
- Aucun contenu essentiel n'est masqué derrière une barre système (notch, home indicator).

---

#### 4.3.4 UI-MOBILE-04 — Performance du scroll sur les listes longues

**Objectif :** Le scroll vertical dans les onglets MARKET, SCHEDULE, et STANDINGS doit être fluide (60 fps) même avec 48 nations ou 17+ journées listées.

**Procédure :**

1. Naviguer vers l'onglet MARKET (48 NationCards affichées).
2. Activer le profil de performance dans les DevTools Chrome (Performance tab).
3. Faire défiler rapidement du haut en bas et de bas en haut plusieurs fois.
4. Observer les métriques de frame rate.

**Résultat attendu :**
- Frame rate stable à 60 fps, sans chutes sous 30 fps pendant le scroll.
- Aucun "jank" (saut visuel, freeze) visible.
- `.scroll { overflow-y: auto; scrollbar-width: none }` : la scrollbar est masquée sur Firefox et invisible sur WebKit.
- Les NationCards ne "rebondissent" pas (overflow bien contenu dans `.shell`).

**Note technique :** Si des listes très longues causent des problèmes de performance, envisager la virtualisation (`react-virtual` ou `@tanstack/react-virtual`).

---

#### 4.3.5 UI-MOBILE-05 — Gestion du clavier virtuel sur l'input de mise

**Objectif :** Lorsque le clavier virtuel s'affiche sur iOS/Android après le tap sur l'input de quantité du `TradeModal`, l'interface doit rester utilisable.

**Procédure :**

1. Ouvrir le `TradeModal` depuis l'onglet MARKET.
2. Tapper sur le champ input de quantité.
3. Observer le comportement de l'interface lorsque le clavier occupe ~40% de l'écran.

**Résultat attendu :**
- Le `TradeModal` remonte avec le clavier — les boutons "Acheter" et "Vendre" restent visibles.
- L'input de quantité est visible et focusé (pas masqué derrière le clavier).
- La Tab Bar descend hors de l'écran si nécessaire (comportement acceptable), mais le modal reste fonctionnel.
- Sur iOS avec Safari, le scroll du `TradeModal` fonctionne sans le "rubber band" qui bloque l'interaction.

**Comportement à éviter :**
- Le bouton de confirmation complètement masqué derrière le clavier sans possibilité de scroll.
- Le clavier qui repousse l'input lui-même hors du viewport.

---

#### 4.3.6 UI-MOBILE-06 — `MatchAnimation` overlay — rendu et durée

**Pré-requis :** Après la simulation d'une journée dans l'onglet `SimulateTab`  
**Procédure :**

1. Tapper sur "⚡ PLAY" dans l'onglet Simulate.
2. Observer l'animation `MatchAnimation`.

**Résultat attendu :**
- L'overlay de `MatchAnimation` apparaît sur toute la largeur (max 390px, centré).
- Les résultats des matchs sont affichés lisiblement (score, drapeaux, variation de prix).
- L'animation se termine en ≤ 5 secondes ou propose un bouton "Passer".
- Après la fermeture de l'overlay, l'onglet actif est cohérent (les prix sont mis à jour dans MARKET, le classement est mis à jour dans STANDINGS).

---

#### 4.3.7 UI-MOBILE-07 — Ticker défilant — performance et lisibilité

**Procédure :**

1. Observer le composant `<Ticker />` dans le header mobile.
2. Mesurer visuellement la fluidité de l'animation CSS.

**Résultat attendu :**
- Le ticker défile horizontalement sans saccade.
- L'animation CSS (`@keyframes` ou `animation`) est accélérée GPU — pas de repaint par frame.
- Les prix affichés dans le ticker correspondent aux valeurs de `nations.current_price`.
- Les prix en hausse apparaissent en `--gain` (#00FF87), les prix en baisse en `--loss` (#FF3B5C).
- Le ticker ne cause pas de re-render React à chaque frame (la logique d'animation est 100% CSS).

---

#### 4.3.8 UI-MOBILE-08 — Flash d'hydration SSR → MobileShell

**Objectif :** Détecter et mesurer le flash de BrowserShell → MobileShell lors du premier chargement sur un device mobile.

**Procédure :**

1. Sur un device réel (ou DevTools throttling CPU ×4, réseau 3G), effectuer un Hard Reload de l'application.
2. Observer les premiers 500ms d'affichage en activant la capture de performance.

**Résultat attendu :**
- Le flash (BrowserShell affiché pendant 1 frame avant le basculement en MobileShell) doit être imperceptible à l'œil nu (< 16ms sur 60Hz).
- Si le flash est visible (> 1 frame), envisager d'ajouter `export const dynamic = 'force-dynamic'` sur `page.tsx` (déjà présent) et vérifier que Next.js ne met pas en cache statique la page.
- Confirmer que `export const dynamic = 'force-dynamic'` est bien présent dans `apps/web/app/page.tsx`.

---

#### 4.3.9 UI-MOBILE-09 — Comportement au redimensionnement de fenêtre (desktop → mobile)

**Objectif :** En développement, redimensionner la fenêtre de 800px à 400px doit switcher le shell de façon propre.

**Procédure :**

1. Ouvrir l'application dans Chrome Desktop à 800px.
2. Naviguer vers la vue Market du BrowserShell et ouvrir un `TradeModal`.
3. Redimensionner la fenêtre à 400px (passage sous `MOBILE_BREAKPOINT = 600`).

**Résultat attendu :**
- `useLayout()` détecte `window.innerWidth < 600` et appelle `setLayout('mobile')`.
- React démonte `BrowserShell` et monte `MobileShell`.
- Le `TradeModal` en cours d'affichage est fermé (état local réinitialisé — comportement attendu documenté dans RESPONSIVE_DESIGN.md §11.4).
- L'interface MobileShell est complète et fonctionnelle — pas de composant "fantôme" issu du BrowserShell.
- Aucune erreur React dans la console (`Warning: Can't perform a React state update on an unmounted component`).

---

### 4.4 Tests de composants partagés

#### 4.4.1 UI-SHARED-01 — `TradeModal` — cohérence mobile/browser

**Objectif :** Le `TradeModal` doit fonctionner identiquement dans les deux shells.

**Procédure :**

1. Ouvrir le TradeModal depuis le MobileShell (MarketTab).
2. Effectuer un trade de test.
3. Répéter exactement les mêmes étapes depuis le BrowserShell.

**Résultat attendu :**
- Les deux trades sont traités par la même route `/api/trade` avec les mêmes règles de validation.
- Le montant du fee affiché est identique dans les deux versions pour le même scénario.
- La confirmation de trade met à jour le store Zustand `useGameStore` — le cash dans le header est mis à jour dans les deux shells.

---

#### 4.4.2 UI-SHARED-02 — `AuthWidget` — comportement compact (mobile) vs normal (browser)

**Procédure :**

1. Observer `<AuthWidget compact />` dans le header mobile.
2. Observer `<AuthWidget />` dans la topbar browser.

**Résultat attendu :**
- En mode compact (mobile) : seul l'avatar ou une initiale est affiché, sans libellé texte.
- En mode normal (browser) : le username ou "Connexion" est visible.
- Dans les deux cas, cliquer sur le widget ouvre le même flux d'authentification Supabase.

---

#### 4.4.3 UI-SHARED-03 — Synchronisation Zustand `useGameStore` entre onglets browser

**Objectif :** L'état du store Zustand est partagé — si un trade est effectué dans un onglet, le portfolio est mis à jour dans tous les composants sans reload.

**Procédure :**

1. Ouvrir le BrowserShell et naviguer vers Portfolio.
2. Depuis la vue Market, effectuer un achat.
3. Revenir à Portfolio sans reload.

**Résultat attendu :**
- La vue Portfolio reflète le nouveau cash et la nouvelle position immédiatement (pas de stale data).
- Le polling `startSync()` (toutes les 3 secondes) n'est nécessaire que pour refléter les changements d'*autres* joueurs — les propres actions du joueur sont reflétées via le callback de trade (optimistic update ou re-fetch immédiat).

---

## ANNEXE A — Commandes de référence pour l'exécution

```bash
# Depuis la racine du monorepo

# Linter (tous les workspaces)
pnpm lint

# Type-check (tous les workspaces)
pnpm -r type-check

# Tests unitaires (tous les workspaces)
pnpm -r test

# Build production
pnpm build

# Serveur de développement
pnpm dev

# Lancer uniquement les tests du game-engine
pnpm --filter @kickstock/game-engine test
```

---

## ANNEXE B — Requêtes SQL de vérification Supabase

```sql
-- Vérifier les politiques RLS actives
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Vérifier l'état courant du jeu
SELECT current_day_index, current_phase, advancing, champion_id,
       array_length(eliminated, 1) AS nb_eliminated
FROM game_state WHERE id = 1;

-- Vérifier les dividendes distribués lors du dernier avancement
SELECT n.flag, n.name, d.round, d.amount, d.shares, d.day_index
FROM dividends d JOIN nations n ON n.id = d.nation_id
ORDER BY d.created_at DESC LIMIT 20;

-- Vérifier l'atomicité d'un trade (cash + holding cohérents)
SELECT p.cash,
       h.nation_id,
       h.quantity,
       h.quantity * n.current_price AS position_value
FROM portfolios p
JOIN holdings h ON h.portfolio_id = p.id
JOIN nations n ON n.id = h.nation_id
WHERE p.device_id = '<device_id_de_test>'
ORDER BY h.nation_id;

-- Vérifier l'historique des prix d'une nation
SELECT day_index, price, effective_at
FROM nation_prices
WHERE nation_id = 'BRA'
ORDER BY day_index ASC;

-- Vérifier le leaderboard (ne doit pas exposer portfolio.id)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'leaderboard'
ORDER BY ordinal_position;
```

---

## ANNEXE C — Matrice de sévérité des vulnérabilités identifiées

| ID | Titre | Sévérité | Statut | Correction |
|----|-------|----------|--------|-----------|
| CRITIQUE-1 | `/api/game/advance` sans auth | 🔴 BLOQUANT | `[ ]` | Ajouter `X-Advance-Secret` header + `ADVANCE_SECRET` env var |
| CRITIQUE-2 | RLS `portfolios_select_device` expose tous les portfolios | 🔴 BLOQUANT | `[ ]` | `DROP POLICY "portfolios_select_device"` |
| HAUTE-1 | Hijacking via `X-Device-ID` non validé | 🟠 MAJEUR | `[ ]` | Regex UUID v4 dans `/api/trade` et `/api/game/state` |
| HAUTE-2 | Vue `leaderboard` expose `portfolios.id` | 🟠 MAJEUR | `[ ]` | Recréer la vue sans `p.id` |
| MOYENNE | Messages d'erreur PostgreSQL retournés au client | 🟡 MINEUR | `[ ]` | Génériciser les catch en `{ error: 'Internal server error' }` |

> **Règle de release :** Les vulnérabilités BLOQUANTES (🔴) doivent être corrigées et les tests RLS-01, RLS-09, SEC-TRADE-01 et SEC-TRADE-02 doivent passer au statut `[x]` avant toute mise en production.

---

*Document généré le 2026-05-26 — À maintenir à jour à chaque évolution du schéma de base de données, des routes API, ou de l'architecture des composants.*
