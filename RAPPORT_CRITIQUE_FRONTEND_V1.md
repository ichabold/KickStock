# Rapport Critique — Front_kick_V1.md vs Frontend KickStock Réel

> **Méthodologie** : chaque point du document `Front_kick_V1.md` est confronté à l'implémentation réelle de KickStock. Verdict en 3 niveaux : ✅ **Conforme** (présent et correct), ⚠️ **Divergent** (présent mais différemment), ❌ **Absent / Contredit**.

---

## Point 1 — Stack et organisation générale

### Ce que le plan dit
React 18 + TypeScript + **Vite**. Zustand. CSS personnalisé. `fetch` + `credentials: 'include'`. Cookie `HttpOnly` Supabase. Structure `src/` avec App.tsx, MobileShell, BrowserShell, 6 tabs, composants partagés, 3 stores, hooks, `lib/`.

### Analyse point par point

#### Stack

**⚠️ Divergent — Vite remplacé par Next.js.**

| Plan | Réalité |
|------|---------|
| React 18 + TypeScript + **Vite** | React 18 + TypeScript + **Next.js 14 App Router** |
| `src/App.tsx`, `src/main.tsx` | `app/page.tsx`, `app/layout.tsx` (App Router) |
| SPA pure | SSR hybride |
| `credentials: 'include'` pour les cookies | Header `X-Device-ID` (pas de cookie session sur le trade) |

**Verdict :** le plan prévoyait encore Vite, alors que l'architecture réelle est Next.js. Ce document est cohérent avec le plan backend initial mais pas avec le plan backend final adopté. Il faut aligner : si le backend est Next.js, le frontend **est** Next.js — ce ne sont pas deux projets séparés.

#### Fichiers principaux

| Plan | Réalité |
|------|---------|
| `src/App.tsx` | `app/page.tsx` — rôle identique |
| `src/main.tsx` | `app/layout.tsx` — équivalent |
| `src/components/MobileShell.tsx` | `components/mobile/MobileShell.tsx` ✅ |
| `src/components/BrowserShell.tsx` | `components/browser/BrowserShell.tsx` ✅ |
| MarketTab, PortfolioTab, LiveTab, SimulateTab, ScheduleTab, StandingsTab | ✅ tous présents dans `components/mobile/` |
| TradeModal, NationCard, NationDetailOverlay, MatchDetailOverlay, Ticker, AuthWidget | ✅ tous présents dans `components/shared/` |
| `onlineGameStore.ts`, `localGameStore.ts`, `gameStore.ts` | ✅ présents dans `stores/` |
| `useGameMode.ts`, `useSession.ts`, `useLayout.ts` | ✅ `useGameMode.ts` et `useLayout.ts` présents — `useSession.ts` : voir Point 2 |
| `lib/api.ts`, `lib/device.ts` | ✅ présents dans `lib/` |

**Bilan Point 1 :** la structure de fichiers est globalement correcte et alignée sur la réalité. Le seul écart structurant est Vite vs Next.js, qui change l'organisation des dossiers (`src/` → racine du projet) mais pas la logique.

---

## Point 2 — Gestion des sessions

### Ce que le plan dit
Au chargement : `POST /api/session` → cookie `HttpOnly` nommé `session`. Hook `useSession()` bloque l'affichage en attendant. En cas d'échec : message d'erreur + proposition de basculer en offline.

### Analyse

**❌ Contredit sur le mécanisme de session — ⚠️ partiellement juste sur l'intention.**

#### `POST /api/session` et cookie HttpOnly

Le plan décrit un mécanisme de session par cookie `HttpOnly`. Dans KickStock réel :
- **Il n'y a pas de `POST /api/session` au démarrage**
- Aucun cookie de session n'est utilisé pour identifier le joueur
- L'identification repose sur un **UUID v4 (`X-Device-ID`)** généré côté client, stocké dans `localStorage`, transmis comme header HTTP

Ce mécanisme est défini dans `lib/device.ts` — `getDeviceId()`.

**Ce qui est cohérent avec le plan backend final :** le plan backend final adopté maintient pourtant la route `POST /api/auth/session` et le cookie `HttpOnly`. Il y a donc une **incohérence interne** entre le plan frontend v1 (qui pointe vers `POST /api/session`) et ce qui existe réellement dans le code (pas de session au démarrage). Si le plan backend final est la référence, le frontend devra effectivement implémenter cet appel initial — ce n'est pas encore fait.

#### Hook `useSession()`

**❌ Absent en tant que tel.**

Il existe `hooks/useAuth.ts` qui gère le cycle de vie Supabase Auth (logged-in user, best score sync), mais pas de `useSession()` qui bloquerait l'affichage en attendant une session anonyme. L'app s'affiche immédiatement — le chargement est géré par `loading: true` dans `onlineGameStore` puis `fetchState()`.

#### Gestion de l'échec de session

**❌ Non implémentée comme décrit.**

Il n'y a pas de "message d'erreur + proposition de basculer en offline" en cas d'échec d'initialisation. Le store met `error: string | null` à jour, mais le comportement exact dépend de l'UI qui consomme cet état. Il n'y a pas de fallback automatique vers le mode offline.

**Critique :** l'absence de ce fallback est un risque UX réel. Si Supabase est momentanément indisponible, le joueur voit un spinner infini ou un message d'erreur sans issue claire. Le plan avait raison d'anticiper ce cas.

---

## Point 3 — Mode online / offline

### Ce que le plan dit
Mode stocké dans `localStorage` (`kickstock:mode`). Changement via `AuthWidget` (option "Jouer en simulation" / "Retour au mode Live"). Rechargement de page au changement. Badge permanent ⚡ LIVE / 🎲 SIMU dans header (mobile) ou sidebar (desktop). `gameStore.ts` lit le mode et exporte le bon store.

### Analyse

**✅ Conforme sur l'essentiel — quelques détails à préciser.**

| Plan | Réalité |
|------|---------|
| Clé `kickstock:mode` dans localStorage | ✅ identique (`MODE_KEY = 'kickstock:mode'`) |
| Valeurs `'online'` (défaut) / `'offline'` | ✅ identique |
| Changement via `AuthWidget` | ✅ présent dans l'AuthWidget |
| Rechargement page au changement | ✅ `window.location.reload()` dans `useGameMode.switchMode()` |
| Badge ⚡ LIVE / 🎲 SIMU | ✅ présent dans le header mobile et la sidebar desktop |
| `gameStore.ts` comme sélecteur de store | ✅ implémenté — `getGameModeSync()` au module init |

**Précision importante sur `gameStore.ts` :**

Le plan mentionne "utilise un contexte React (`GameModeContext`) pour éviter les appels conditionnels de hooks". Dans la réalité, **il n'y a pas de `GameModeContext`**. La solution retenue est plus simple et tout aussi correcte :

```typescript
// gameStore.ts — module init (pas de hook, pas de contexte)
const mode = getGameModeSync(); // lit localStorage de façon synchrone
export const useGameStore = mode === 'online' ? useOnlineGameStore : useLocalGameStore;
```

Le mode est lu **une seule fois au chargement du module**, puis le store est sélectionné définitivement. Le rechargement de page garantit que le bon store est monté dès le départ. C'est plus élégant qu'un contexte et évite entièrement le problème des hooks conditionnels.

**Bilan Point 3 :** ce point est le mieux aligné entre le plan et la réalité. L'intention est exactement celle implémentée.

---

## Point 4 — Stores Zustand

### Ce que le plan dit

#### `onlineGameStore`
État : `prices`, `cash`, `holdings`, `matches`, `dayIndex`, `eliminated`, `champion`, `loading`, `error`, `txLog`. Actions : `fetchState()`, `buy()`, `sell()`, `syncMatches()` (polling ou WebSocket).

#### `localGameStore`
État identique + persisted. Bootstrap via `GET /api/competition/bootstrap` (TTL 24h). Actions : `simulateDay()`, `buy()`, `sell()` avec validation locale.

#### `gameStore`
Lit le mode, exporte le bon store. Utilise `GameModeContext`.

### Analyse

#### `onlineGameStore`

**✅ Conforme sur l'état — ⚠️ nomenclature et actions divergentes.**

| Plan | Réalité | Note |
|------|---------|------|
| `prices` | ✅ | |
| `cash` | ✅ | |
| `holdings` | ✅ → `portfolio` | Renommé mais identique |
| `matches` | ✅ → `matchResults` | Plus riche (indexé par dayIndex) |
| `dayIndex` | ✅ | |
| `eliminated` | ✅ | |
| `champion` | ✅ | |
| `loading` | ✅ | |
| `error` | ✅ | |
| `txLog` | ✅ | |
| `fetchState()` | ✅ | |
| `buy(nationId, qty)` + `sell(nationId, qty)` | ✅ → `trade(mode, nationId, qty)` | Unifié en une action |
| `syncMatches()` polling ou WebSocket | ✅ → `startSync()` / `stopSync()` | **Supabase Realtime** + fallback poll 30s |

**Non prévu dans le plan mais présent :**
- `_bootstrap` + `_teams` — données de configuration injectées
- `_realtimeChannel` — canal Supabase Realtime
- `_competitionId` — support multi-compétition
- `advanceDay()` — simulation depuis le mode online
- `loadBootstrap()` — chargement bootstrap
- `resetGame()`

**Sur `syncMatches()` :** le plan laissait "polling ou WebSocket (à préciser)". La réalité a tranché : **Supabase Realtime** (`postgres_changes` sur `competition_game_state`) avec un fallback poll toutes les **30 secondes**. C'est la bonne décision — Realtime donne des mises à jour push instantanées sans polling agressif.

#### `localGameStore`

**✅ Conforme sur l'intention — enrichi.**

| Plan | Réalité | Note |
|------|---------|------|
| État persistant localStorage | ✅ via `zustand/middleware persist` | Clé : `ks-game-state-{competitionId}` |
| Bootstrap TTL 24h | ✅ | Côté `lib/bootstrap.ts` |
| `simulateDay()` | ✅ → `advanceDay()` | Renommé, même logique |
| `buy()` / `sell()` | ✅ → `trade()` | Unifié |
| Validation locale (cash, cap 40%) | ✅ | Implémenté dans `trade()` |

**Non prévu dans le plan mais présent — important :**
- `syncFromServer()` — réconciliation cross-device depuis `user_game_states` Supabase
- `writeStateToSupabase()` — sauvegarde auto après trade (debounce 5s) si connecté
- `syncBestScore()` — sync du meilleur score au leaderboard global toutes les 60s

**Remarque sur "aucun appel réseau" pour le localGameStore :** le plan stipulait "aucun appel réseau". C'est partiellement faux dans la réalité — le localGameStore fait des appels réseau pour la synchronisation cross-device (Supabase). Ce n'est pas un défaut, c'est une amélioration fonctionnelle nécessaire.

#### `gameStore`

**✅ Conforme — `GameModeContext` absent mais non nécessaire.**

Le plan mentionnait un `GameModeContext` React pour éviter les hooks conditionnels. La réalité n'en a pas besoin : la sélection du store se fait au niveau module (pas dans un composant), donc aucun problème de hook conditionnel. Solution plus simple et tout aussi correcte.

---

## Point 5 — Layout et responsive (deux shells)

### Ce que le plan dit
Seuil 600px. `useLayout()`. `MobileShell` : 100dvh, header (logo, stats, badge mode, bouton aide), Ticker, status bar, zone scrollable, bottom nav 5 onglets (SCHED, STNDGS, PLAY/LIVE, MARKET, PORTF). `BrowserShell` : sidebar 72px + zone principale (topbar, ticker, contenu). Transition par démontage/remontage.

### Analyse

**✅ Très bien aligné — quelques précisions de détail.**

#### Seuil et hook

| Plan | Réalité |
|------|---------|
| `MOBILE_BREAKPOINT = 600` pixels | ✅ défini dans `packages/constants/src/index.ts` |
| `useLayout()` → `'mobile'` ou `'browser'` | ✅ `hooks/useLayout.ts` |
| Surveillance `window.innerWidth` | ✅ avec `resize` listener |

#### `MobileShell`

| Plan | Réalité | Note |
|------|---------|------|
| Layout 100dvh | ✅ | |
| Header : logo, stats, badge mode, bouton aide | ✅ | Badge ⚡/🎲 présent |
| Ticker défilant | ✅ `Ticker` | |
| Status bar : jour, phase, éliminés | ✅ | |
| Zone centrale scrollable | ✅ | |
| Bottom nav 5 onglets | ✅ | **6 onglets** en réalité (+ StandingsTab) |
| PLAY (offline) / LIVE (online) | ✅ | Onglet contextuel selon mode |

**Divergence à noter :** le plan prévoit 5 onglets, la réalité en a **6** : `SCHED`, `STNDGS`, `PLAY/LIVE`, `MARKET`, `PORTF` + un 6ème selon le contexte. Ce n'est pas un problème mais le plan devrait refléter le bon nombre.

#### `BrowserShell`

| Plan | Réalité | Note |
|------|---------|------|
| Sidebar fixe 72px | ✅ | |
| Navigation verticale icône + label | ✅ | |
| Badge de mode dans la sidebar | ✅ | |
| Topbar : titre, stats, bouton PLAY / indicateur LIVE | ✅ | |
| Ticker dans la zone principale | ✅ | |
| Mise en page 2 colonnes possible | ✅ | Layout 3 colonnes en réalité (calendrier | marché | portefeuille) |

**Précision :** le plan parle de "mise en page à 2 colonnes". Dans la réalité, le BrowserShell utilise un **layout 3 colonnes** : calendrier à gauche, marché au centre, portefeuille à droite. C'est plus riche que ce que le plan anticipait.

#### Transition au redimensionnement

**✅ Conforme.**

Le plan prévoit un démontage/remontage au passage du seuil (état local perdu — acceptable). C'est exactement ce qui se passe : `useLayout()` re-render `page.tsx` qui switche entre `<MobileShell>` et `<BrowserShell>`. Flash d'hydration toléré : confirmé.

---

## Point 6 — Composants UI (rôles)

### Ce que le plan dit
Description fonctionnelle de 12 composants : MarketTab, PortfolioTab, LiveTab, SimulateTab, ScheduleTab, StandingsTab, TradeModal, AuthWidget, Ticker, NationDetailOverlay, MatchDetailOverlay, MatchAnimation.

### Analyse composant par composant

#### `MarketTab`
**✅ Conforme et enrichi.**

| Plan | Réalité |
|------|---------|
| Grille avec drapeau, nom, prix, variation % | ✅ via `NationCard` |
| Barre de force | ⚠️ Non visible comme "barre" — force présente dans les données mais affichage différent |
| Badge de lock | ✅ |
| Boutons Acheter / Vendre → `TradeModal` | ✅ |
| Filtres (recherche, groupe) | ✅ + **5 options de tri** (non prévues) |

**Non prévu mais présent :** `NationDetailOverlay` au clic sur la carte (en plus du trade modal). Coach mark pour les nouveaux joueurs.

#### `PortfolioTab`
**✅ Conforme et enrichi.**

| Plan | Réalité |
|------|---------|
| Cash, valeur totale, P&L global | ✅ + P&L en % |
| Holdings cliquables → `NationDetailOverlay` | ✅ |
| Bouton Vendre par ligne | ⚠️ La vente se fait via tap → NationDetailOverlay, pas un bouton direct sur chaque ligne |
| Quantité, prix moyen, valeur actuelle, P&L | ✅ |

**Non prévu mais présent :** Best Score affiché, stats row (cash / investi / P&L), **historique des 20 dernières transactions** (très utile), notice équipe éliminée.

#### `LiveTab`
**✅ Conforme et enrichi.**

| Plan | Réalité |
|------|---------|
| Liste matchs du jour | ✅ via `/api/game/live-matches` |
| Équipes, score, statut | ✅ + statuts étendus (1H, HT, 2H, ET, PEN) |
| Badge de lock | ✅ `trade_lock_until` |
| Mise à jour automatique polling | ✅ poll toutes les **60s** |
| Pas d'action utilisateur | ✅ |

**Non prévu mais présent :** prix courant de chaque équipe, countdown avant le coup d'envoi (`-Xmin`), highlight si le joueur détient des actions d'une des deux équipes.

#### `SimulateTab`
**✅ Conforme et largement enrichi.**

| Plan | Réalité |
|------|---------|
| Numéro du jour, phase | ✅ + label complet |
| Bouton "Simuler le jour" | ✅ via `SimulateButton` |
| Appelle `simulateDay()` | ✅ → `advanceDay()` |

**Non prévu mais présent — majeur :**
- Machine d'états `pre → animating → done` avec 3 vues distinctes
- `MatchAnimation` : animation séquentielle des matchs (composant dédié)
- Vue résultats : scores, AET/PEN, upsets 🔥, équipes éliminées
- Dividendes reçus affichés
- Exposition totale en KC (valeur des positions dans les matchs du jour)
- Écran "Tournoi terminé" avec reset

**Critique :** le plan sous-estimait considérablement la complexité de cet onglet. La machine d'états est nécessaire pour une bonne UX de simulation — le plan se contentait d'un bouton.

#### `ScheduleTab`
**✅ Conforme et enrichi.**

| Plan | Réalité |
|------|---------|
| Calendrier groupé par journée | ✅ toutes les journées |
| Équipes, score, statut | ✅ |
| Clic → `MatchDetailOverlay` | ✅ |

**Non prévu mais présent :** distinction passé/actuel/futur, variation de prix ▲/▼% après chaque match joué, noms d'équipes cliquables → `NationDetailOverlay`, AET/pénalités affichés, équipes éliminées grisées, fixtures KO "Dynamique" pour les jours futurs.

#### `StandingsTab`
**✅ Conforme.**

| Plan | Réalité |
|------|---------|
| Classements par groupe A–L | ✅ via `StandingsCard` |
| Nation, MP, points, GD | ✅ |
| Prix, variation | ✅ |
| Qualifiés surlignés | ✅ |
| Clic → `NationDetailOverlay` | ✅ |

C'est l'un des composants les plus fidèles au plan.

#### `TradeModal`
**✅ Conforme et largement enrichi.**

| Plan | Réalité |
|------|---------|
| Saisie quantité stepper + slider | ✅ stepper −/+ avec bouton MAX + `<input type="range">` |
| Prix, taxe, total achat ou vente net | ✅ |
| Bouton de confirmation | ✅ |
| Appelle l'action du store | ✅ `trade()` |

**Non prévu mais présent :**
- **Simulation du cash après** opération (en temps réel pendant la saisie)
- **Affichage du plafond de concentration** (`XX% / 40%`) en phase de poules/R32
- Bouton CTA désactivé si conditions non remplies (solde insuffisant, etc.)
- Vibration haptic sur succès/erreur (`navigator.vibrate`)
- Accessibilité : `role="dialog"`, `aria-modal`, `aria-selected`
- Tab buy/sell switchable sans fermer le modal

**Critique :** le plan décrivait un modal fonctionnel. La réalité est un composant financier soigné qui simule l'impact de la transaction avant confirmation — c'est une meilleure UX.

#### `AuthWidget`
**✅ Conforme.**

| Plan | Réalité |
|------|---------|
| Menu compte avec pseudo ou "Se connecter" | ✅ |
| Option changement de mode | ✅ "Jouer en simulation" / "Retour au mode Live" |

**Non prévu mais présent :** le système d'auth est bien plus complet que le plan l'indiquait — `WelcomeModal`, `GuestModal`, `EmailAuthModal` permettent la création de compte et la connexion par email.

#### `Ticker`
**✅ Conforme.**

| Plan | Réalité |
|------|---------|
| Bandeau défilant horizontal (CSS) | ✅ animation CSS |
| Prix et variations des nations pertinentes | ✅ matchs du jour, leaders |

#### `NationDetailOverlay`
**✅ Conforme.**

| Plan | Réalité |
|------|---------|
| Graphique historique des prix | ✅ |
| Statistiques | ✅ |
| Acheter / vendre depuis l'overlay | ✅ → `TradeModal` |

#### `MatchDetailOverlay`
**✅ Conforme.**

| Plan | Réalité |
|------|---------|
| Stade, score, buteurs | ✅ |
| Variations de prix | ✅ ▲/▼% pour chaque équipe |

**Non prévu mais présent :** minutes des buts, AET/pénalités détaillés, clic sur nom d'équipe → `NationDetailOverlay`.

#### `MatchAnimation`
**✅ Conforme — bien plus élaboré.**

Le plan la mentionnait comme "animation overlay utilisée lors de la simulation offline". Dans la réalité, c'est un composant avec séquencement temporel des matchs, gestion du rythme d'affichage, et intégration dans la machine d'états du `SimulateTab`.

---

## Point 7 — Gestion des erreurs et feedback

### Ce que le plan dit
Spinner pendant les appels. Toasts pour les erreurs. Désactivation des boutons pendant un trade.

### Analyse

**⚠️ Partiellement conforme — différences d'implémentation.**

| Plan | Réalité | Note |
|------|---------|------|
| Spinner pendant les appels API | ✅ état `loading` dans les stores | Implémenté mais pas sous forme de spinner global centralisé |
| Toasts pour les erreurs | ⚠️ Messages d'erreur inline dans `TradeModal` (`styles.error`), pas de système de toasts global | Absence d'un toast manager type `react-hot-toast` |
| Désactivation boutons pendant trade | ✅ `ctaDisabled` dans `TradeModal` | |

**Critique — Absence d'un système de toasts global :**

Le plan prévoyait des toasts pour des cas comme "KC insuffisants", "Trading locké", "Cap dépassé", "Erreur réseau". Dans la réalité :
- Les erreurs de trade sont affichées **dans le modal** (inline), ce qui est acceptable pour ce contexte
- Il n'y a **pas de toast global** pour les erreurs hors-modal (ex: erreur de `fetchState()`, perte de connexion)
- L'état `error` dans les stores peut contenir un message mais rien ne le pousse à l'écran de façon standardisée

**Manque identifié :** une erreur réseau pendant `fetchState()` (store en ligne) met `error` à jour mais rien ne garantit qu'elle sera visible pour l'utilisateur si le composant qui la consomme ne l'affiche pas.

**Sur la vibration haptic :** le plan ne la mentionnait pas, mais `navigator.vibrate(8)` sur succès et `vibrate(40)` sur erreur de trade sont présents dans `TradeModal` — c'est une amélioration bienvenue non documentée dans le plan.

---

## Point 8 — Points de cohérence avec le backend

### Ce que le plan dit
Liste des endpoints : `POST /api/session`, `GET /api/game/state`, `POST /api/trade`, `GET /api/competition/bootstrap`, `GET /api/matches?day_index=` (si implémenté). Cookie `session` via `credentials: 'include'`. Frontend n'affiche que les règles métier codées backend.

### Analyse point par point

#### `POST /api/session`
**⚠️ Divergent — endpoint existant dans le plan backend final mais non appelé par le frontend.**

La route `POST /api/auth/session` est documentée dans le plan backend final. Le frontend réel ne l'appelle pas au démarrage. Si la décision finale est de garder le cookie HttpOnly comme mécanisme d'auth (tel que défini dans le plan backend final), alors **le frontend doit implémenter cet appel** — c'est un gap réel.

#### `GET /api/game/state`
**✅ Implémenté.** Appelé dans `onlineGameStore.fetchState()` via `lib/api.ts`.

#### `POST /api/trade`
**✅ Implémenté.** Appelé dans `onlineGameStore.trade()` via `apiTrade()` dans `lib/api.ts`.

#### `GET /api/competition/bootstrap`
**✅ Implémenté.** Appelé dans `lib/bootstrap.ts`, résultat mis en cache localStorage TTL 24h.

#### `GET /api/matches?day_index=`
**⚠️ Le plan dit "si implémenté".** L'endpoint est dans le plan backend final. Le frontend ne l'utilise pas encore — `ScheduleTab` consomme les données de `matchResults` dans le store (déjà chargées via `/api/game/state`). Il n'y a pas d'appel direct à `/api/matches?day_index=` pour l'instant.

#### `credentials: 'include'` pour les cookies
**❌ Non implémenté — remplacé par `X-Device-ID`.**

Les appels dans `lib/api.ts` n'utilisent pas `credentials: 'include'`. L'identification du joueur passe par le header `X-Device-ID`, pas par un cookie. Ce point est en contradiction directe avec le plan, qui dit "le cookie `session` doit être transmis automatiquement". Si le plan backend final est la référence (cookie HttpOnly), alors le frontend devra migrer de `X-Device-ID` vers les cookies.

#### "Le frontend affiche seulement les règles métier"
**✅ Globalement respecté** — mais avec des nuances importantes :

- La **taxe** est calculée côté client dans `TradeModal` pour l'affichage (preview temps réel) — elle est aussi vérifiée côté DB
- Le **plafond de concentration 40%** est calculé côté client dans `TradeModal` pour le bouton MAX et l'indicateur — il est aussi enforced côté DB
- L'**élimination** est vérifiée côté client pour désactiver les boutons — aussi vérifiée côté DB

C'est une duplication **intentionnelle et correcte** : le frontend recalcule pour une UX réactive (bouton MAX précis, preview instantané), mais le backend reste la source de vérité pour l'exécution réelle.

---

## Synthèse Globale

### Ce que le plan a bien capturé ✅

| Point | Note |
|-------|------|
| Structure des fichiers (composants, stores, hooks, lib) | Quasi-identique à la réalité |
| Mode online/offline via localStorage | Parfaitement conforme |
| Deux shells MobileShell / BrowserShell + seuil 600px | Conforme |
| Les 6 onglets (Market, Portfolio, Live, Simulate, Schedule, Standings) | Tous présents |
| `TradeModal` avec stepper + slider + récap | Conforme (réalité plus riche) |
| `Ticker` bandeau CSS | Conforme |
| Supabase Realtime pour la synchro online | ✅ implicitement (le plan disait "WebSocket à préciser") |
| `gameStore.ts` comme sélecteur de store | Conforme |

### Ce que le plan a mal évalué ⚠️

| Point | Écart |
|-------|-------|
| Vite → Next.js | Stack différente (dossier `src/` inexistant) |
| `POST /api/session` au démarrage | Pas appelé — `X-Device-ID` à la place |
| `useSession()` bloquant | Absent — loading géré par le store |
| `credentials: 'include'` | Non implémenté — header `X-Device-ID` |
| `simulateDay()` simple | `advanceDay()` avec machine d'états 3 vues |
| 5 onglets bottom nav | 6 onglets en réalité |
| BrowserShell 2 colonnes | 3 colonnes en réalité |
| Vente via bouton direct dans PortfolioTab | Via tap → NationDetailOverlay |
| Toasts globaux pour les erreurs | Messages inline seulement, pas de toast manager |

### Ce que le plan a complètement manqué ❌

| Élément absent du plan |
|---|
| `MatchAnimation` avec machine d'états et séquencement temporel |
| `writeStateToSupabase()` — sync cross-device en mode offline |
| `syncFromServer()` — réconciliation depuis Supabase |
| `syncBestScore()` — leaderboard global |
| `WelcomeModal`, `GuestModal`, `EmailAuthModal` — système d'auth complet |
| `CoachMarkOverlay`, `TutorialOverlay` — onboarding |
| `usePortfolioTotals()` — hook de calcul des totaux P&L |
| `useValidateMechanics()` — contrat de parité mobile/desktop |
| `next-intl` — internationalisation (`useTranslations`) |
| `Sentry` — monitoring d'erreurs frontend |
| Vibration haptic sur trade |
| Simulation P&L en temps réel dans TradeModal (cash-after, concentration %) |
| `MatchDetailOverlay` avec buteurs et minutes |
| Exposition totale en KC dans SimulateTab |
| Countdown avant coup d'envoi dans LiveTab |

---

## Recommandations pour finaliser le plan frontend

### 1. 🔴 Aligner sur Next.js (critique)
Remplacer toutes les références à Vite (`src/`, `import.meta.env`, `vite.config.ts`) par les équivalents Next.js (`app/`, `process.env`, `next.config.js`). Ce n'est pas la même structure de projet.

### 2. 🔴 Clarifier le mécanisme d'authentification
Le plan dit `credentials: 'include'` + cookie `HttpOnly`. La réalité utilise `X-Device-ID` header. Ces deux approches sont **mutuellement exclusives**. Il faut trancher une fois pour toutes — et ce choix doit être cohérent avec le plan backend final adopté.

### 3. 🟠 Documenter `useSession()` ou abandonner l'idée
Soit créer un vrai `useSession()` qui appelle `POST /api/auth/session` au démarrage (conforme au plan backend final), soit supprimer cette référence du plan frontend et documenter que l'identification se fait par `X-Device-ID`.

### 4. 🟠 Ajouter un système de toasts global
L'absence d'un composant de notification global est un manque UX. Prévoir `react-hot-toast` ou un composant custom pour les erreurs réseau hors-modal.

### 5. 🟡 Mettre à jour le nombre d'onglets
Le plan dit 5 onglets bottom nav — corriger à 6 (avec `StandingsTab`).

### 6. 🟡 Documenter `MatchAnimation` comme composant à part entière
Le plan la décrit comme "animation overlay" — elle mérite sa propre section avec la machine d'états `pre → animating → done`.
