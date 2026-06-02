# Rapport Critique — Plan Frontend vs Frontend KickStock Réel

> **Méthodologie** : chaque point du document `plan_frontend_react_vite_zustand.md` est comparé à l'implémentation réelle de KickStock. Verdict en 3 niveaux : ✅ **Implémenté** (présent et correct), ⚠️ **Divergent** (présent mais différemment), ❌ **Absent** (non implémenté ou remplacé).

---

## Point 11 — Frontend React + Vite + Zustand

### Ce que le plan dit
`npm create vite@latest` + React + TypeScript. Installer `zustand` + `axios`. Deux stores séparés `onlineGameStore.ts` et `localGameStore.ts`. Sélection du mode via `VITE_MODE=online|offline`. Appel `POST /api/session` au démarrage.

### Ce qui existe réellement

#### 11.1 Vite vs Next.js

**⚠️ Divergent — architecture fondamentalement différente.**

| Plan | Réalité |
|---|---|
| `npm create vite@latest` | **Next.js 14 App Router** |
| SPA React (fichiers `src/`) | SSR/hybrid, dossiers `app/`, `components/`, `stores/` |
| `axios` installé | **Pas d'axios** — `fetch` natif uniquement |
| `vite.config.ts` | `next.config.js` |
| `npm run dev` | `next dev` (script `pnpm dev`) |

**Bilan :** le choix Next.js est bien supérieur à Vite pour ce projet. Il donne SSR natif, déploiement Vercel sans config, App Router avec Server Components, et surtout la cohabitation backend + frontend dans un seul repo. Vite aurait nécessité un frontend séparé avec un CORS configuré manuellement.

**Axios non utilisé :** la décision de rester sur `fetch` natif est la bonne — zéro dépendance inutile, aucun surchage de bundle, et `fetch` est parfaitement suffisant pour ce volume d'appels.

---

#### 11.2 Les deux stores Zustand

**✅ Implémenté — conforme au plan et largement dépassé.**

Les deux stores existent exactement là où attendus, avec un troisième en bonus :

| Plan | Réalité | Fichier |
|---|---|---|
| `onlineGameStore.ts` | ✅ | `stores/onlineGameStore.ts` |
| `localGameStore.ts` | ✅ | `stores/localGameStore.ts` |
| *(non prévu)* | **`gameStore.ts`** — point d'entrée unique | `stores/gameStore.ts` |

**`gameStore.ts` — innovation majeure non prévue par le plan :**
```typescript
const mode = getGameModeSync();    // lit localStorage
export const useGameStore =
  mode === 'online' ? useOnlineGameStore : useLocalGameStore;
```
Les composants importent **uniquement** `useGameStore`. Le switch de mode est totalement transparent. Pas de `if/switch` dans les composants. C'est une excellente décision d'architecture.

**Actions prévues dans `onlineGameStore` :**

| Plan | Réalité |
|---|---|
| `prices` | ✅ |
| `cash` | ✅ |
| `holdings` → `portfolio` | ✅ (renommé) |
| `matches` → `matchResults` | ✅ (enrichi) |
| `dayIndex` | ✅ |
| `fetchState` | ✅ |
| `buy` + `sell` → `trade(mode, id, qty)` | ✅ (unifié en une action) |
| *(non prévu)* | `advanceDay()` | ✅ |
| *(non prévu)* | `startSync()` / `stopSync()` | ✅ |
| *(non prévu)* | `loadBootstrap()` | ✅ |
| *(non prévu)* | `resetGame()` | ✅ |
| *(non prévu)* | `_bootstrap`, `_teams` | ✅ (données de config injectées) |
| *(non prévu)* | `_realtimeChannel` | ✅ (Supabase Realtime) |

**`localGameStore` — fonctionnalités prévues :**

| Plan | Réalité |
|---|---|
| État initial chargé depuis bootstrap | ✅ via `loadBootstrap()` → `/api/competition/bootstrap` |
| `simulateDay` → `advanceDay()` | ✅ (renommé, logique identique) |
| `buy`/`sell` locaux | ✅ via `trade()` |
| Aucun appel réseau (simulation) | ✅ pour le jeu — mais sync best score + writeStateToSupabase si logged in |
| Persistance via `localStorage` | ✅ via `zustand/middleware persist` avec clé `ks-game-state-{competitionId}` |

**Fonctionnalités supplémentaires non prévues dans `localGameStore` :**
- `syncFromServer()` : réconciliation cross-device depuis Supabase si logged in
- `writeStateToSupabase()` : sauvegarde automatique (debounce 5s) après chaque trade/simulation
- `syncBestScore()` : sync du meilleur score vers le leaderboard global

---

#### 11.3 Sélection du mode

**⚠️ Divergent — localStorage au lieu d'une variable d'environnement.**

| Plan | Réalité |
|---|---|
| `VITE_MODE=online\|offline` (env var build-time) | `localStorage('kickstock:mode')` (runtime) |
| Sélection dans `App.tsx` via `import.meta.env` | Sélection dans `gameStore.ts` via `getGameModeSync()` |
| Rechargement de page non mentionné | `window.location.reload()` au changement de mode |

**Pourquoi localStorage est mieux ici :**
- L'utilisateur peut switcher de mode **sans redeployer**
- Le joueur choisit son mode dans l'UI (bouton de bascule)
- Un env var build-time aurait nécessité deux builds distincts (un online, un offline)

**Mode par défaut :** `'online'` si rien dans localStorage.

**Remarque :** le rechargement page entière (`window.location.reload()`) au changement de mode est la bonne solution pour éviter les problèmes de hooks conditionnels React — le plan ne l'avait pas anticipé mais c'est nécessaire.

---

#### 11.4 Gestion de session au démarrage

**⚠️ Divergent — pas de `POST /api/session`, `X-Device-ID` à la place.**

| Plan | Réalité |
|---|---|
| `POST /api/session` au montage | **Aucun appel de session** au démarrage |
| Cookie HttpOnly créé côté serveur | UUID v4 généré côté client, stocké en `localStorage` |
| Token géré automatiquement par le navigateur | `X-Device-ID` header ajouté manuellement à chaque requête via `getDeviceId()` |

Voir la critique complète sur ce point dans le rapport backend (Point 3). En résumé : l'approche `X-Device-ID` est plus simple et pragmatique.

---

## Point 12 — Composants UI minimaux

### Ce que le plan dit
5 composants : `MarketTab`, `PortfolioTab`, `LiveTab`, `SimulateTab`, `ScheduleTab`.

### Ce qui existe réellement
**✅ Les 5 composants existent — et sont tous bien plus riches que le plan.**

---

#### 12.1 MarketTab

**✅ Implémenté et très enrichi.**

| Plan | Réalité |
|---|---|
| Grille nations : nom, drapeau, prix, variation | ✅ via `NationCard` |
| Badge 🔒 si trading lock actif | ✅ (géré dans NationCard) |
| Boutons Acheter / Vendre | ✅ → ouvrent `TradeModal` |
| Modal/prompt pour la quantité | ✅ `TradeModal` — bien plus qu'un simple prompt |
| Boutons désactivés si lockée | ✅ |

**Fonctionnalités supplémentaires non prévues :**
- **Barre de recherche** par nom/ID d'équipe
- **Filtre par groupe** (A–L + ALL) — boutons dynamiques dérivés du bootstrap
- **5 options de tri** : défaut, prix ↑, prix ↓, performance, portefeuille
- **`NationDetailOverlay`** : panneau détail cliquable sur chaque carte (historique prix, stats)
- `CoachMarkOverlay` pour les nouveaux joueurs (onboarding)
- Message d'aide au premier run (aucune action détenue, aucun trade effectué)

**`TradeModal` — sophistication non anticipée par le plan :**
- Stepper +/− + bouton MAX
- Slider de quantité (`<input type="range">`)
- Récapitulatif : prix/action, quantité, taxe (5% ou 10% selon phase), total, cash après
- Affichage du **pourcentage de concentration** (`XX% / 40%`) en phase cap
- Vibration haptic sur succès/erreur (`navigator.vibrate`)
- Accessibilité : `role="dialog"`, `aria-modal`, `aria-selected` sur les onglets buy/sell

---

#### 12.2 PortfolioTab

**✅ Implémenté et très enrichi.**

| Plan | Réalité |
|---|---|
| Cash actuel | ✅ |
| Valeur totale du portfolio | ✅ |
| Liste des holdings | ✅ |
| Par holding : nation, quantité, prix moyen, valeur actuelle, P&L | ✅ + % de variation |
| Bouton Vendre à côté de chaque ligne | ⚠️ Vente via tap sur la ligne → `NationDetailOverlay` (pas de bouton direct) |

**Fonctionnalités supplémentaires :**
- **Hero P&L** : valeur totale + flèche ▲/▼ + montant absolu + %
- **Stats row** : cash / investi / P&L — 3 KPI en une ligne
- **Best Score** affiché si atteint
- **Notice équipe éliminée** si holdings sur une équipe éliminée
- **Historique des 20 dernières transactions** (direction, flag, nom, quantité, prix, jour)
- Tri des holdings par valeur décroissante
- `usePortfolioTotals` : hook dédié qui calcule cash, portVal, invested, totalVal, pl, plPct, bestScore

**Données provenant directement du store :** ✅ confirmé.

---

#### 12.3 LiveTab

**✅ Implémenté — online uniquement, conforme au plan, plus riche.**

| Plan | Réalité |
|---|---|
| Liste matchs du jour depuis `state.matches` | ✅ mais depuis `/api/game/live-matches` (polling 60s) |
| Équipes + score si joué + statut | ✅ + statuts étendus |
| Statut NS, en cours, FT | ✅ + HT, 1H, 2H, ET, BT, P, AET, PEN |
| Indicateur de lock | ✅ `trade_lock_until` en DB |
| Pas de bouton d'action | ✅ lecture seule |

**Comportements supplémentaires :**
- `statusBadge` dynamique : `X–Y` (score) / `EN JEU` (live) / `-Xmin` (compte à rebours) / `BIENTÔT`
- Couleur de statut : vert (live), or (bientôt), gris (terminé)
- Prix courant de chaque équipe affiché (KickCoins)
- Highlight si le joueur détient des actions de l'équipe (`exposed`)
- Venue (stade) affiché
- Horloge locale rafraîchie toutes les 30 secondes pour les countdowns
- Note bas de page : "Résultats automatiques · mise à jour toutes les 5 min"

**Remarque :** le plan disait "les prix sont mis à jour automatiquement par le cron backend" — c'est correct, mais c'est en réalité le Supabase Realtime (`onlineGameStore.startSync()`) qui pousse les updates, complété par un poll de 30s en fallback.

---

#### 12.4 SimulateTab

**✅ Implémenté — offline uniquement, très au-delà du plan.**

| Plan | Réalité |
|---|---|
| Gros bouton "Simuler le jour" | ✅ via `SimulateButton` |
| Appelle `localGameStore.simulateDay()` → `advanceDay()` | ✅ |
| Affiche numéro du jour | ✅ + label complet (`"Day 3 · Sat Jun 13"`) |
| Affiche phase actuelle | ✅ |

**Fonctionnalités supplémentaires majeures non prévues :**
- **3 vues avec machine d'états** : `'pre'` → `'animating'` → `'done'`
- **Vue `pre`** : liste des matchs du jour, exposition totale en KC
- **Vue `animating`** : `MatchAnimation` — animation séquentielle des matchs (composant dédié)
- **Vue `done`** : résultats détaillés (scores, AET/PEN, équipes éliminées, upsets 🔥), dividendes reçus
- Écran **tournoi terminé** 🏆 avec bouton "Nouvelle partie"
- Mise en évidence des matchs où le joueur a des positions (`exposed`)

---

#### 12.5 ScheduleTab

**✅ Implémenté — les deux modes, bien plus riche que le plan.**

| Plan | Réalité |
|---|---|
| Calendrier groupé par journée | ✅ toutes les journées affichées |
| Données venant du store (online) ou simulation (offline) | ✅ |
| Équipes, score, statut, journée | ✅ + variation de prix post-match |

**Fonctionnalités supplémentaires majeures :**
- Distinction visuelle **passé / actuel / futur** (opacity, indicateur ▶)
- Phase affichée avec badge coloré (Groups vs KO)
- Score cliquable → `MatchDetailOverlay` (buts, buteurs, minute, penalty scores)
- Variation de prix ▲/▼ % affiché après chaque match joué
- AET et pénalités affichés sur le score (`P 4–3`, `AET`)
- Noms d'équipes cliquables → `NationDetailOverlay`
- Équipes éliminées visuellement barrées/grisées
- Pour les jours KO futurs : "Équipes déterminées après la phase de groupes"

---

#### 12.6 Composants entiers non prévus par le plan

Le plan prévoyait 5 composants. KickStock en a **32** (dont 16 purement métier) :

| Composant | Rôle métier |
|-----------|-------------|
| `MobileShell` | Shell mobile (< 600px) — BottomNav + 6 onglets |
| `BrowserShell` | Shell desktop (≥ 600px) — layout 3 colonnes |
| `StandingsTab` | **Classements de groupe** — totalement absent du plan |
| `NationCard` | Carte équipe avec prix, variation, flash, boutons trade |
| `NationDetailOverlay` | Détail équipe : historique prix, stats, trade depuis overlay |
| `MatchDetailOverlay` | Détail match : buts, buteurs, minutes, pénalités |
| `TradeModal` | Modal de trade sophistiqué (voir 12.1) |
| `MatchAnimation` | Animation séquentielle des résultats (vue simuler) |
| `Ticker` | Bandeau défilant des prix en temps réel |
| `StandingsCard` | Tableau de groupe compact (standings) |
| `BottomSheet` | Composant UI de bottom sheet générique |
| `WelcomeModal` | Onboarding nouveau joueur |
| `GuestModal` | Création compte invité |
| `EmailAuthModal` | Auth email complète |
| `AuthWidget` | Widget auth en header |
| `CoachMarkOverlay` | Aide contextuelle premier run |
| `TutorialOverlay` | Tutoriel interactif complet |

**`StandingsTab` — oubli important du plan :** voir les classements de groupe est une fonctionnalité centrale d'un jeu de foot. Elle existe dans KickStock mais n'était pas mentionnée dans le plan.

---

## Point 13 — Gestion des sessions frontend

### Ce que le plan dit
`POST /api/session` dans `useEffect` au montage → cookie HttpOnly → navigateur gère automatiquement. En cas d'échec, afficher erreur / désactiver features / basculer offline. Pas de bouton login/logout.

### Ce qui existe réellement
**⚠️ Divergent sur la session, ❌ contredit sur login/logout.**

#### 13.1 Initialisation de session

**⚠️ Divergent.**

| Plan | Réalité |
|---|---|
| `POST /api/session` dans `useEffect` au montage | **Aucun appel de session** |
| Cookie HttpOnly créé côté serveur | UUID v4 généré côté client (`lib/device.ts` — `getDeviceId()`) |
| Token stocké par le navigateur automatiquement | UUID stocké dans `localStorage('kickstock:device-id')` |
| Cookie envoyé automatiquement | Header `X-Device-ID` ajouté manuellement via `fetchGameState()` / `apiTrade()` |

**Comportement en cas d'échec :** si `fetchState()` échoue dans `onlineGameStore`, l'état `error` est mis à jour mais il n'y a **pas de bascule automatique vers le mode offline** — c'est un choix délibéré, le mode se sélectionne manuellement.

#### 13.2 Pas de login/logout — CONTREDIT par la réalité

**❌ Le plan était catégoriquement erroné sur ce point.**

Le plan disait : *"L'authentification est entièrement anonyme et automatique. Il n'y a pas d'interface utilisateur dédiée pour login/logout."*

La réalité : KickStock a un **système d'authentification complet** :
- `WelcomeModal` : première visite, choix entre invité et compte email
- `GuestModal` : création de compte invité avec pseudo
- `EmailAuthModal` : inscription / connexion par email + mot de passe
- `AuthWidget` : widget d'en-tête avec état de connexion
- `/app/(auth)/login/page.tsx` : page de login dédiée
- `/app/(auth)/register/page.tsx` : page d'inscription
- `/app/auth/reset-password/page.tsx` : réinitialisation de mot de passe
- `hooks/useAuth.ts` : hook qui gère le cycle de vie de l'authentification

**Pourquoi c'est nécessaire et que le plan avait tort :**
- Un joueur veut retrouver son portefeuille **sur un autre appareil** → nécessite un compte
- Le leaderboard nécessite des pseudos uniques (`check-pseudo`, `set-username`)
- `syncBestScore()` associe un score à un `user_id` Supabase réel
- La synchronisation cross-device via `writeStateToSupabase()` n'est possible qu'avec un compte

---

## Point 14 — Tests et documentation

### Ce que le plan dit
Tests unitaires pour `applyResult`, `calcTax`, `processRealMatchResult`. Utiliser Jest ou Vitest. Base de test dédiée. README avec prérequis, installation, variables d'env, commandes, schéma DB.

### Ce qui existe réellement

#### 14.1 Tests unitaires

**⚠️ Partiellement implémenté — excellent sur les fonctions pures, absent sur les intégrations.**

| Plan | Réalité |
|---|---|
| Framework : Jest ou Vitest | **Vitest** ✅ (`packages/game-engine/vitest.config.ts`) |
| Tests `applyResult` | ✅ — 4 cas : victoire A, nul, prix asymétriques, plancher ≥ 1 |
| Tests `calcTax` | ✅ — 3 cas : groupes, KO, éliminée |
| Tests `processRealMatchResult` | ❌ **Absent** |
| Base de données de test | ❌ **Absente** |
| *(non prévu)* | Tests `calcDividend` ✅ — 3 cas : r32, champion, clé inconnue |
| *(non prévu)* | Tests `simulate` ✅ — 3 cas : pas de nul en KO, nul possible en groupes, favori gagne >70% |

**Couverture des tests existants :**

```
applyResult.ts  → 4 tests ✅ (très bien couvert)
calcTax.ts      → 3 tests ✅ (bien couvert)
calcDividends.ts → 3 tests ✅ (bien couvert)
simulate.ts     → 3 tests probabilistes ✅ (bonne approche statistique)
genScore.ts     → ❌ non testé
genGoals.ts     → ❌ non testé
buildKOMatches.ts → ❌ non testé
localGameStore.ts → ❌ non testé (trade, advanceDay)
onlineGameStore.ts → ❌ non testé
```

**`processRealMatchResult` non testé :** c'est le point le plus risqué. Cette fonction touche les prix, les dividendes, les liquidations en DB — une régression ici serait catastrophique. L'absence de tests d'intégration sur cette fonction est le **gap de test le plus important**.

**Absence de base de test dédiée :** les tests existants ne font aucun appel réseau (fonctions pures uniquement), donc une DB de test n'est pas nécessaire pour ce périmètre. Mais elle sera indispensable dès qu'on testera les RPCs.

---

#### 14.2 Documentation (README)

**⚠️ Présent mais partiellement stale et incomplet.**

Fichier : `/README.md` — existe ✅

| Plan | Réalité |
|---|---|
| Prérequis (Node.js, PostgreSQL, Redis, Supabase, API-Football) | ⚠️ Seulement Node.js 18+ et pnpm documentés |
| Étapes d'installation (clone, install, .env, migrations, crons, backend, frontend) | ⚠️ Seulement `pnpm install` + `pnpm dev` |
| Variables d'environnement listées | ❌ **Absentes** du README |
| Commandes utiles (dev, build, crons manuels) | ⚠️ `pnpm dev` / `pnpm build` / `pnpm type-check` seulement |
| Schéma DB | ❌ **Absent** (lien vers migrations SQL mentionné en Phase 2 mais incomplet) |

**Contenu présent et utile dans le README actuel :**
- Structure du monorepo (bonne vue d'ensemble)
- Commandes de base
- Design tokens (couleurs, fonts)
- Règles du jeu (dividendes, taxe, etc.)

**Problème majeur : le README est stale.**
```
## Phase 2 (à venir)
1. Créer un projet Supabase...
2. Appliquer les migrations SQL...
```
La Phase 2 est **entièrement implémentée et en production**. Cette section est trompeuse pour un nouveau contributeur.

**Variables d'environnement non documentées :**
```env
# Variables présentes dans le code mais absentes du README :
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
API_FOOTBALL_KEY=
API_FOOTBALL_HOST=
CRON_SECRET=
SENTRY_DSN=
```

**Commandes manquantes :**
```bash
# Déclencher les crons manuellement (non documenté) :
curl -H "Authorization: Bearer CRON_SECRET" https://.../api/cron/sync-fixtures
curl -H "Authorization: Bearer CRON_SECRET" https://.../api/cron/sync-results

# Tests (non documenté) :
pnpm --filter @kickstock/game-engine test
pnpm --filter @kickstock/game-engine test:watch
```

---

## Synthèse Globale

### Ce que le plan a bien anticipé ✅

| Point | Note |
|-------|------|
| Deux stores Zustand séparés (online/offline) | Exactement ce qui existe |
| `localGameStore` avec persistence localStorage | Implémenté via `zustand/middleware persist` |
| Bootstrap comme source de données offline | Parfaitement implémenté |
| 5 composants majeurs (Market, Portfolio, Live, Simulate, Schedule) | Tous présents |
| `fetch` natif (optionnel dans le plan) | Retenu, axios rejeté |
| Vitest pour les tests | ✅ utilisé |
| Tests `applyResult` et `calcTax` | ✅ couverts |

### Ce que le plan a mal évalué ⚠️

| Point | Écart |
|-------|-------|
| Vite → Next.js | Architecture bien différente, bien meilleure |
| `VITE_MODE` env var → localStorage runtime | Plus flexible, pas besoin de rebuild |
| `POST /api/session` → `X-Device-ID` | Plus simple, sans cookie |
| Authentification "100% anonyme, pas de login" | Un système d'auth complet existe (et était nécessaire) |
| README minimal comme dans le plan | README présent mais stale et incomplet |
| Tests `processRealMatchResult` | Non implémenté, c'est le gap le plus risqué |

### Ce que le plan a complètement manqué ❌ (présent dans KickStock)

| Manquant dans le plan |
|---|
| `gameStore.ts` comme couche d'abstraction du mode (transparent pour les composants) |
| Architecture dual-layout `MobileShell` / `BrowserShell` |
| `StandingsTab` (classements de groupe) |
| `NationDetailOverlay` et `MatchDetailOverlay` (sous-pages riches) |
| `MatchAnimation` (animation des résultats de simulation) |
| `TradeModal` sophistiqué (stepper, slider, simulation P&L, concentration %) |
| `Ticker` (bandeau défilant des prix) |
| `TutorialOverlay` / `CoachMarkOverlay` (onboarding) |
| Internationalisation avec `next-intl` (`useTranslations`) |
| Sentry (`@sentry/nextjs`) pour le monitoring d'erreurs frontend |
| Supabase Realtime pour les mises à jour push |
| `writeStateToSupabase()` pour sync cross-device en mode offline |
| `usePortfolioTotals()` — hook de calcul des totaux P&L |
| `useValidateMechanics()` — contrat de mécaniques (parité mobile/desktop) |
| Vibration haptic sur trade (`navigator.vibrate`) |

---

## Recommandations Prioritaires

### 1. 🔴 Mettre à jour le README (urgent)
Le README actuel est stale ("Phase 2 à venir") et manque de toutes les variables d'environnement nécessaires. Un contributeur qui clone le projet aujourd'hui ne peut pas le faire tourner sans documentation.

**Minimum à ajouter :**
- Section `.env.local` avec toutes les clés requises
- Instructions pour appliquer les migrations Supabase
- Commandes pour déclencher les crons manuellement
- Retirer la section "Phase 2 à venir" (c'est fait)

### 2. 🟠 Tests d'intégration `processRealMatchResult` (moyen terme)
C'est la fonction la plus critique et la seule sans tests. Créer une Supabase de test (Supabase local via Docker) et écrire au minimum :
- Test victoire A → prix A monte, prix B descend, winner correct
- Test KO → loser liquidé, dividende distribué
- Test idempotence → second appel ne change rien

### 3. 🟡 Tests `genScore` et `buildKOMatches` (faible priorité)
Les fonctions de génération de score et de construction des pools KO ne sont pas testées. Elles sont moins critiques (pas d'effet sur la DB) mais des bugs ici créent des incohérences dans l'affichage.

### 4. 🟡 Documenter `getDeviceId()` (faible priorité)
La mécanique de `X-Device-ID` est centrale mais nulle part documentée dans le README ni dans un ADR (Architecture Decision Record). Si quelqu'un reprend le projet, il ne comprendra pas pourquoi il n'y a pas de session.
