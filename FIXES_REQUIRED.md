# KickStock — Corrections requises

> Document auto-suffisant destiné à être injecté dans une nouvelle session Claude Code.
> Chaque fix est décrit avec le fichier exact, le code actuel, le code corrigé et l'explication.
> **Ne pas modifier l'ordre des fixes — certains ont des dépendances.**

---

## Contexte du projet

KickStock est un monorepo Next.js 14 (App Router) + Supabase + Zustand.

```
apps/web/
  app/api/          ← API routes Next.js
  components/
    mechanics/      ← composants partagés entre shells
    mobile/         ← MobileShell
    browser/        ← BrowserShell
  hooks/
  lib/              ← logique métier serveur
  stores/
    gameStore.ts         ← façade : re-exporte le bon store selon le mode
    localGameStore.ts    ← mode Offline (Zustand persist localStorage)
    onlineGameStore.ts   ← mode Online (Supabase, Realtime)
packages/
  game-engine/      ← formules pures (applyResult, simulate, calcTax…)
  constants/        ← NATIONS, CALENDAR hardcodés WC2026 (legacy)
  types/            ← types TypeScript partagés
db/migrations/      ← SQL Supabase
```

**Mode de jeu :** `localStorage('kickstock:mode')` = `'online'` (défaut) ou `'offline'`.
**Compétition active :** `localStorage('kickstock:competition')` = `number` (défaut `1`).
**`gameStore.ts`** lit le mode au chargement du module et ré-exporte le bon store.

---

## FIX 1 — `SimulateButton` utilise `CALENDAR` hardcodé WC2026

### Fichier
`apps/web/components/mechanics/SimulateButton.tsx`

### Problème
`SimulateButton` importe `CALENDAR` depuis `@kickstock/constants` (48 jours hardcodés WC2026) pour :
1. Obtenir le label du bouton (ex. "Day 3 · Jun 13")
2. Détecter si le tournoi est terminé (`!day` → affiche "Nouvelle Partie")

Pour toute compétition non-WC2026, `CALENDAR[dayIndex]` sera `undefined` prématurément, ce qui affiche "Nouvelle Partie" alors que le tournoi continue.
Ce composant est utilisé par les **deux shells** (mobile et browser).

### Code actuel
```typescript
import { CALENDAR } from '@kickstock/constants';
// ...
const dayIndex   = useGameStore(s => s.dayIndex);
const advanceDay = useGameStore(s => s.advanceDay);
const resetGame  = useGameStore(s => s.resetGame);
const day        = CALENDAR[dayIndex];

const defaultLabel = day ? t('simulate', { label: day.label }) : t('newGame');

async function handleClick() {
  if (loading) return;
  if (!day) {
    resetGame();
    return;
  }
  // ...
}
```

### Code corrigé
Remplacer l'import `CALENDAR` par une lecture depuis le store (`_bootstrap`).

```typescript
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore } from '@/stores/gameStore';
import type { StoredMatchResult, BootstrapData } from '@kickstock/types';

interface Props {
  onResults: (results: StoredMatchResult[]) => void;
  onNoResults?: () => void;
  className?: string;
  label?: string;
}

export function SimulateButton({ onResults, onNoResults, className, label }: Props) {
  const t = useTranslations('simulateButton');
  const [loading, setLoading] = useState(false);

  const dayIndex   = useGameStore(s => s.dayIndex);
  const advanceDay = useGameStore(s => s.advanceDay);
  const resetGame  = useGameStore(s => s.resetGame);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bootstrap  = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;

  // Lookup current day from bootstrap instead of hardcoded CALENDAR
  const day = bootstrap?.days.find(d => d.day_index === dayIndex) ?? null;

  const defaultLabel = day ? t('simulate', { label: day.date_label }) : t('newGame');

  async function handleClick() {
    if (loading) return;
    if (!day) {
      resetGame();
      return;
    }
    setLoading(true);
    try {
      const res = await advanceDay();
      if (res && res.results.length > 0) {
        onResults(res.results);
      } else {
        onNoResults?.();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className={className}
      onClick={handleClick}
      disabled={loading}
      aria-label={loading ? t('ariaLoading') : t('ariaSimulate')}
    >
      {loading ? t('loading') : (label ?? defaultLabel)}
    </button>
  );
}
```

### Note sur `day.date_label`
`BootstrapDay` expose `date_label` (ex. "Jun 11") et `full_label` (ex. "Day 1 · Thu Jun 11").
L'ancien `CALENDAR[i].label` correspondait au `date_label`. Si l'affichage préféré est le label complet, utiliser `day.full_label`. À choisir selon le design souhaité.

---

## FIX 2 — `onlineGameStore.resetGame()` ne reset que le store local

### Fichier
`apps/web/stores/onlineGameStore.ts`

### Problème
En mode Online, l'état de jeu est **autoritaire sur le serveur** (table `competition_game_state` + `portfolios`). Appeler `resetGame()` ne fait que vider le store Zustand en mémoire. Au prochain `fetchState()` (déclenché par le poll 30s ou Realtime), l'état serveur réécrase tout. Le joueur voit le reset pendant quelques secondes puis retrouve son état précédent.

De plus, `baseState()` met `prices: {}` et `priceHistory: {}` sans les re-seeder depuis les équipes — pendant le rechargement, tous les prix s'affichent à 0.

### Décision de design
En mode Online, le tournoi est **partagé** entre tous les joueurs. "Recommencer" signifie remettre à zéro son portfolio personnel (cash = 10 000 KC, positions = 0), pas réinitialiser le tournoi entier. Il faut un endpoint API dédié.

**Étape A — Créer l'API route `POST /api/game/reset`**

Créer le fichier `apps/web/app/api/game/reset/route.ts` :

```typescript
/**
 * POST /api/game/reset
 * Réinitialise le portfolio du joueur pour une compétition donnée.
 * Body: { competitionId: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function POST(req: NextRequest) {
  try {
    const { competitionId } = await req.json() as { competitionId: number };
    const deviceId = req.headers.get('X-Device-ID') ?? null;

    if (!competitionId || !deviceId) {
      return NextResponse.json({ error: 'competitionId et X-Device-ID requis' }, { status: 400 });
    }

    const admin = createAdminClient();

    let userId: string | null = null;
    try {
      const sb = await createServerClient();
      const { data: { user } } = await sb.auth.getUser();
      userId = user?.id ?? null;
    } catch { /* anonymous */ }

    // Retrouver le portfolio existant
    const { data: portfolioId } = await adm(admin).rpc(
      'get_or_create_competition_portfolio',
      { p_competition_id: competitionId, p_device_id: deviceId, p_user_id: userId },
    );

    if (!portfolioId) {
      return NextResponse.json({ error: 'Portfolio introuvable' }, { status: 404 });
    }

    // Remettre à zéro cash, avgCost, txLog, bestScore
    await adm(admin)
      .from('portfolios')
      .update({ cash: 10000, avg_cost: {}, tx_log: [], best_score: null })
      .eq('id', portfolioId);

    // Supprimer toutes les holdings de cette compétition
    await adm(admin)
      .from('holdings')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('competition_id', competitionId);

    // Supprimer les transactions de cette compétition
    await adm(admin)
      .from('transactions')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('competition_id', competitionId);

    return NextResponse.json({ ok: true });

  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'POST /api/game/reset' } });
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
```

**Étape B — Ajouter `apiReset` dans `apps/web/lib/api.ts`**

Ajouter après la fonction `apiAdvanceDay` :

```typescript
export async function apiReset(
  deviceId:      string,
  competitionId: number,
): Promise<{ ok: boolean; error?: string }> {
  return apiFetch(
    '/api/game/reset',
    { method: 'POST', body: JSON.stringify({ competitionId }) },
    deviceId,
    competitionId,
  );
}
```

**Étape C — Mettre à jour `onlineGameStore.resetGame()`**

Dans `apps/web/stores/onlineGameStore.ts`, ajouter l'import :

```typescript
import { fetchGameState, apiTrade, apiAdvanceDay, apiReset } from '@/lib/api';
import { getDeviceId } from '@/lib/device';
```

Remplacer la méthode `resetGame` :

```typescript
// Code actuel
resetGame: () => { set({ ...baseState(), loading: false }); },

// Code corrigé
resetGame: async () => {
  const { _competitionId, _bootstrap, _teams } = get();
  set({ loading: true });
  try {
    await apiReset(getDeviceId(), _competitionId);
  } catch { /* best-effort */ }
  // Refetch l'état serveur pour avoir les prix courants corrects
  await get().fetchState();
},
```

**Note :** `resetGame` devient async. Les composants qui l'appellent (`SimulateTab`, `SimulateButton`) utilisent déjà `await` sur `advanceDay()` et gèrent le loading — adapter si nécessaire.

---

## FIX 3 — Clé de persistance offline n'inclut pas le `competitionId`

### Fichier
`apps/web/stores/localGameStore.ts`

### Problème
La clé Zustand persist est fixée à `'ks-game-state'`. Si l'utilisateur change de compétition en mode Offline, le store charge l'état de la compétition précédente (dayIndex, portfolio, prix) dans la nouvelle compétition.

### Code actuel (fin du fichier, section `persist`)
```typescript
persist(
  (set, get) => ({ /* ... store definition ... */ }),
  {
    name: 'ks-game-state',
    storage: createJSONStorage(() => { /* ... */ }),
    partialize: (state) => ({ /* ... */ }),
  },
),
```

### Modifications requises

**Étape A** — Importer `getCompetitionIdSync` depuis `onlineGameStore` (déjà exporté) ou le dupliquer dans `localGameStore`.

Ajouter en tête de `localGameStore.ts`, après les imports existants :

```typescript
const COMPETITION_KEY = 'kickstock:competition';

function getLocalCompetitionId(): number {
  if (typeof window === 'undefined') return 1;
  const stored = localStorage.getItem(COMPETITION_KEY);
  return stored ? parseInt(stored, 10) : 1;
}
```

**Étape B** — Utiliser une clé dynamique :

```typescript
// Code actuel
{
  name: 'ks-game-state',
  storage: createJSONStorage(() => { /* ... */ }),
  partialize: (state) => ({ /* ... */ }),
}

// Code corrigé
{
  name: `ks-game-state-${getLocalCompetitionId()}`,
  storage: createJSONStorage(() => {
    if (typeof window === 'undefined') {
      return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    }
    return localStorage;
  }),
  partialize: (state) => ({
    cash: state.cash, portfolio: state.portfolio, avgCost: state.avgCost,
    txLog: state.txLog, prices: state.prices, priceHistory: state.priceHistory,
    dayIndex: state.dayIndex, eliminated: state.eliminated, champion: state.champion,
    matchResults: state.matchResults, r32Pool: state.r32Pool, r16Pool: state.r16Pool,
    qfPool: state.qfPool, sfPool: state.sfPool, finalPool: state.finalPool,
    thirdPool: state.thirdPool, bestScore: state.bestScore,
  }),
}
```

**Étape C** — Mettre à jour `loadBootstrap` pour passer le `competitionId` :

```typescript
// Code actuel
loadBootstrap: async () => {
  const current = get();
  if (current._bootstrap || current.bootstrapLoading) return;
  set({ bootstrapLoading: true, bootstrapError: false });
  const data = await getBootstrap();  // ← pas de competitionId !
  // ...
},

// Code corrigé
loadBootstrap: async () => {
  const current = get();
  if (current._bootstrap || current.bootstrapLoading) return;
  set({ bootstrapLoading: true, bootstrapError: false });
  const competitionId = getLocalCompetitionId();
  const data = await getBootstrap(competitionId);  // ← avec competitionId
  // ...
},
```

---

## FIX 4 — Flags toujours vides dans le txLog en mode Online

### Fichier
`apps/web/stores/onlineGameStore.ts`

### Problème
Dans `fetchState()`, le code tente de ré-enrichir le txLog reçu du serveur en cherchant les équipes par leur **nom** (`t.name`) au lieu de leur **ID** :

```typescript
const enriched = data.txLog.map(t => {
  const team = teams.find(x => x.id === t.name) ?? null;  // BUG : t.name = "Brazil", x.id = "BRA"
  return { ...t, flag: team?.flag ?? '', name: team?.name ?? t.name };
});
```

Le serveur retourne déjà les champs `flag` et `name` corrects dans chaque entrée txLog (voir `GET /api/game/state`). La ré-enrichissement côté client est inutile et cassé.

### Code actuel
```typescript
const data = await fetchGameState(deviceId, competitionId);
const enriched = data.txLog.map(t => {
  const team = teams.find(x => x.id === t.name) ?? null;
  return { ...t, flag: team?.flag ?? '', name: team?.name ?? t.name };
});
set({
  // ...
  txLog: enriched,
  // ...
});
```

### Code corrigé
Supprimer la ré-enrichissement — utiliser `data.txLog` directement :

```typescript
const data = await fetchGameState(deviceId, competitionId);
// Le serveur retourne flag et name déjà correctement remplis — pas besoin de ré-enrichir
set({
  cash: data.cash, portfolio: data.portfolio, avgCost: data.avgCost,
  prices: data.prices, priceHistory: data.priceHistory,
  dayIndex: data.dayIndex, eliminated: data.eliminated, champion: data.champion,
  matchResults: data.matchResults, r32Pool: data.r32Pool, r16Pool: data.r16Pool,
  qfPool: data.qfPool, sfPool: data.sfPool, finalPool: data.finalPool,
  thirdPool: data.thirdPool,
  txLog: data.txLog,      // ← directement depuis le serveur
  bestScore: data.bestScore,
  loading: false, syncing: false, error: null,
});
```

---

## FIX 5 — `avgCost` calculé sur prix local périmé après trade Online

### Fichiers
- `apps/web/lib/api.ts`
- `apps/web/stores/onlineGameStore.ts`

### Problème
Dans `onlineGameStore.trade()`, le prix utilisé pour calculer `avgCost` est lu depuis le store local **avant** l'appel API. Le serveur exécute le trade au prix courant en base (qui peut différer si un match vient de se terminer). L'API retourne `new_cash` et `new_held` mais le type de retour de `apiTrade` n'expose pas le `price` utilisé côté serveur — pourtant la route `/api/trade` le retourne déjà (champ `price` dans le JSON).

### Étape A — Exposer `price` dans le type de retour de `apiTrade`

Dans `apps/web/lib/api.ts`, modifier la signature de `apiTrade` :

```typescript
// Code actuel
export async function apiTrade(
  deviceId:      string,
  competitionId: number,
  mode:          'buy' | 'sell',
  nationId:      string,
  quantity:      number,
): Promise<{ error: string | null; newCash?: number; newHeld?: number }> {

// Code corrigé
export async function apiTrade(
  deviceId:      string,
  competitionId: number,
  mode:          'buy' | 'sell',
  nationId:      string,
  quantity:      number,
): Promise<{ error: string | null; newCash?: number; newHeld?: number; price?: number }> {
```

Pas d'autre changement dans `api.ts` — `apiFetch` retourne le JSON brut, `price` sera déjà présent.

### Étape B — Utiliser le prix serveur dans `onlineGameStore.trade()`

Dans `apps/web/stores/onlineGameStore.ts`, modifier le bloc `if (mode === 'buy')` de la méthode `trade` :

```typescript
// Code actuel
if (mode === 'buy') {
  const prevAvg = s.avgCost[nationId] ?? team.initialPrice;
  const newAvg  = held === 0 ? price : (held * prevAvg + quantity * price) / (held + quantity);
  set({
    cash:      result.newCash ?? Math.round((s.cash - price * quantity) * 10) / 10,
    portfolio: { ...s.portfolio, [nationId]: held + quantity },
    avgCost:   { ...s.avgCost, [nationId]: Math.round(newAvg * 10) / 10 },
    txLog:     [{ dir: 'buy' as const, flag: team.flag, name: team.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
  });
}

// Code corrigé
if (mode === 'buy') {
  // Utiliser le prix confirmé par le serveur, sinon fallback sur le prix local
  const confirmedPrice = result.price ?? price;
  const prevAvg = s.avgCost[nationId] ?? team.initialPrice;
  const newAvg  = held === 0
    ? confirmedPrice
    : (held * prevAvg + quantity * confirmedPrice) / (held + quantity);
  set({
    cash:      result.newCash ?? Math.round((s.cash - confirmedPrice * quantity) * 10) / 10,
    portfolio: { ...s.portfolio, [nationId]: held + quantity },
    avgCost:   { ...s.avgCost, [nationId]: Math.round(newAvg * 10) / 10 },
    txLog:     [{ dir: 'buy' as const, flag: team.flag, name: team.name, qty: quantity, price: confirmedPrice, day: s.dayIndex }, ...s.txLog].slice(0, 100),
  });
}
```

Faire de même pour le bloc `else` (vente) — utiliser `result.price` dans le txLog :

```typescript
// Code actuel (dans le else)
set({
  cash:      result.newCash ?? Math.round((s.cash + net) * 10) / 10,
  portfolio: newPort, avgCost: newAvgs,
  txLog:     [{ dir: 'sell' as const, flag: team.flag, name: team.name, qty: quantity, price, day: s.dayIndex }, ...s.txLog].slice(0, 100),
});

// Code corrigé
const confirmedPrice = result.price ?? price;
const gross   = confirmedPrice * quantity;
const isElim  = s.eliminated.includes(nationId);
const fee     = isElim || confirmedPrice <= 1
  ? 0
  : Math.max(gross * (isKO ? 0.05 : 0.10), 10);
const net     = gross - fee;
// ... (recalculer net avec confirmedPrice)
set({
  cash:      result.newCash ?? Math.round((s.cash + net) * 10) / 10,
  portfolio: newPort, avgCost: newAvgs,
  txLog:     [{ dir: 'sell' as const, flag: team.flag, name: team.name, qty: quantity, price: confirmedPrice, day: s.dayIndex }, ...s.txLog].slice(0, 100),
});
```

---

## FIX 6 — `portfolio` et `avgCost` non mis à jour après `advanceDay` en Online

### Fichier
`apps/web/stores/onlineGameStore.ts`

### Problème
La méthode `advanceDay()` met à jour `prices`, `eliminated`, les pools et `cash` depuis la réponse API, mais **ne met pas à jour `portfolio` ni `avgCost`**. Quand une équipe est éliminée (et liquidée par le serveur), le store client conserve les positions sur cette équipe avec l'ancien `avgCost`, jusqu'au prochain `fetchState()`. Pendant ce laps de temps (jusqu'à 30s), la valeur portfolio affichée est incorrecte.

### Code actuel
```typescript
advanceDay: async () => {
  const s = get();
  const response = await apiAdvanceDay(getDeviceId(), s._competitionId, s.dayIndex);
  if (!response?.results) return null;
  set({
    prices: response.prices, eliminated: response.eliminated,
    r32Pool: response.r32Pool, r16Pool: response.r16Pool,
    qfPool: response.qfPool, sfPool: response.sfPool,
    finalPool: response.finalPool, thirdPool: response.thirdPool,
    champion: response.champion, dayIndex: response.newDayIndex,
    cash: response.newCash ?? s.cash,
    matchResults: { ...s.matchResults, [s.dayIndex]: response.results },
  });
  return { results: response.results, flash: response.flash };
},
```

### Code corrigé
Ajouter un `fetchState()` après l'application optimiste pour réconcilier portfolio et avgCost :

```typescript
advanceDay: async () => {
  const s = get();
  const response = await apiAdvanceDay(getDeviceId(), s._competitionId, s.dayIndex);
  if (!response?.results) return null;

  // Mise à jour optimiste immédiate (pour l'animation et l'affichage des prix)
  set({
    prices:      response.prices,
    eliminated:  response.eliminated,
    r32Pool:     response.r32Pool,
    r16Pool:     response.r16Pool,
    qfPool:      response.qfPool,
    sfPool:      response.sfPool,
    finalPool:   response.finalPool,
    thirdPool:   response.thirdPool,
    champion:    response.champion,
    dayIndex:    response.newDayIndex,
    cash:        response.newCash ?? s.cash,
    matchResults: { ...s.matchResults, [s.dayIndex]: response.results },
  });

  // Puis réconcilier portfolio et avgCost depuis le serveur
  // (les éliminations/liquidations sont dans la DB, pas dans la réponse advance)
  get().fetchState().catch(() => {});

  return { results: response.results, flash: response.flash };
},
```

**Note :** Le `fetchState()` est fire-and-forget (`.catch(() => {})`). Il n'est pas awaité pour ne pas bloquer l'affichage de l'animation. Les composants UI gèrent déjà le fait que le store peut être mis à jour asynchronement.

---

## FIX 7 — `usePortfolioTotals` : fallback `NATIONS` hardcodé

### Fichier
`apps/web/components/mechanics/usePortfolioTotals.ts`

### Problème
Le calcul du coût investi tombe en fallback sur la liste hardcodée `NATIONS` (48 équipes WC2026) quand `avgCost[id]` n'est pas défini :

```typescript
import { NATIONS } from '@kickstock/constants';
// ...
const cost = avgCost[id] ?? NATIONS.find(n => n.id === id)?.p ?? 0;
```

Pour toute compétition non-WC2026, `NATIONS.find(...)` retourne `undefined`, donc `cost = 0`, `invested = 0`, et le P&L affiché = 100% de la valeur portefeuille (faux).

Le fallback correct est `team.initialPrice` depuis les données bootstrap (`_teams`).

### Code actuel (complet)
```typescript
'use client';

import { NATIONS } from '@kickstock/constants';
import { pctOf } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';

export interface PortfolioTotals { /* ... */ }

export function usePortfolioTotals(): PortfolioTotals {
  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const avgCost   = useGameStore(s => s.avgCost);
  const bestScore = useGameStore(s => s.bestScore);

  const held = Object.entries(portfolio).filter(([, q]) => q > 0);

  const portVal = held.reduce(
    (a, [id, q]) => a + q * (prices[id] ?? 0),
    0,
  );

  const invested = held.reduce((a, [id, q]) => {
    const cost = avgCost[id] ?? NATIONS.find(n => n.id === id)?.p ?? 0;
    return a + q * cost;
  }, 0);

  const totalVal  = cash + portVal;
  const pl        = portVal - invested;
  const plPct     = invested > 0 ? pctOf(portVal, invested) : 0;
  const positions = held.length;

  return { cash, portVal, invested, totalVal, pl, plPct, positions, bestScore };
}
```

### Code corrigé
```typescript
'use client';

import { pctOf } from '@kickstock/game-engine';
import { useGameStore } from '@/stores/gameStore';
import type { TeamMeta } from '@kickstock/types';

export interface PortfolioTotals {
  cash:       number;
  portVal:    number;
  invested:   number;
  totalVal:   number;
  pl:         number;
  plPct:      number;
  positions:  number;
  bestScore:  number | null;
}

export function usePortfolioTotals(): PortfolioTotals {
  const cash      = useGameStore(s => s.cash);
  const prices    = useGameStore(s => s.prices);
  const portfolio = useGameStore(s => s.portfolio);
  const avgCost   = useGameStore(s => s.avgCost);
  const bestScore = useGameStore(s => s.bestScore);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teams     = useGameStore(s => (s as any)._teams) as TeamMeta[];

  const held = Object.entries(portfolio).filter(([, q]) => q > 0);

  const portVal = held.reduce(
    (a, [id, q]) => a + q * (prices[id] ?? 0),
    0,
  );

  const invested = held.reduce((a, [id, q]) => {
    // Priorité : avgCost enregistré → initialPrice du bootstrap → 0
    const initialPrice = teams.find(t => t.id === id)?.initialPrice ?? 0;
    const cost = avgCost[id] ?? initialPrice;
    return a + q * cost;
  }, 0);

  const totalVal  = cash + portVal;
  const pl        = portVal - invested;
  const plPct     = invested > 0 ? pctOf(portVal, invested) : 0;
  const positions = held.length;

  return { cash, portVal, invested, totalVal, pl, plPct, positions, bestScore };
}
```

**Changement :** suppression de l'import `NATIONS`, ajout de `_teams` depuis le store, fallback sur `team.initialPrice` (données bootstrap dynamiques).

---

## FIX 8 — `isKO` hardcodé `dayIndex >= 17` pour la taxe

### Fichiers
- `apps/web/stores/localGameStore.ts`
- `apps/web/stores/onlineGameStore.ts`

### Problème
Les deux stores calculent `isKO` (pour déterminer le taux de taxe) avec un seuil hardcodé :

```typescript
const isKO = s.dayIndex >= 17;  // WC2026 : groupes = days 0-16
```

Pour une compétition dont la phase de groupes se termine à un `dayIndex` différent, le taux appliqué serait incorrect.

La bonne approche est de lire `is_ko` depuis le `BootstrapDay` courant.

### Modification dans `localGameStore.ts` — méthode `trade`

```typescript
// Code actuel
const isKO  = s.dayIndex >= 17;

// Code corrigé
const currentDay = s._bootstrap?.days.find(d => d.day_index === s.dayIndex) ?? null;
const isKO = currentDay?.is_ko ?? (s.dayIndex >= 17);  // fallback conservatif si bootstrap absent
```

### Modification dans `onlineGameStore.ts` — méthode `trade`

Même remplacement :

```typescript
// Code actuel
const isKO  = s.dayIndex >= 17;

// Code corrigé
const currentDay = s._bootstrap?.days.find(d => d.day_index === s.dayIndex) ?? null;
const isKO = currentDay?.is_ko ?? (s.dayIndex >= 17);
```

---

## FIX 9 — `localGameStore.resetGame()` efface le `bestScore`

### Fichier
`apps/web/stores/localGameStore.ts`

### Problème
`baseState()` inclut `bestScore: null`. `resetGame()` appelle `set({ ...baseState(), ... })` ce qui écrase le `bestScore` local. L'affichage repart à zéro jusqu'au rechargement (où il serait re-fetchté depuis le serveur pour les utilisateurs connectés). Pour les invités, le best score est définitivement perdu.

### Code actuel
```typescript
resetGame: () => {
  const { _teams } = get();
  set({
    ...baseState(),
    prices:       emptyPrices(_teams),
    priceHistory: emptyHistory(_teams),
    loading: false, syncing: false, error: null, _pollId: null,
  });
},
```

### Code corrigé
```typescript
resetGame: () => {
  const { _teams, bestScore } = get();
  set({
    ...baseState(),
    bestScore,               // ← conserver le meilleur score
    prices:       emptyPrices(_teams),
    priceHistory: emptyHistory(_teams),
    loading: false, syncing: false, error: null, _pollId: null,
  });
},
```

---

## FIX 10 — Dédupliquer `buildMatchesForCurrentDay` et `deriveDynamicKey`

### Contexte
Ces deux fonctions sont copiées-collées à l'identique dans `localGameStore.ts` et `onlineGameStore.ts`. Un bug corrigé dans l'une risque de ne pas être répercuté dans l'autre.

### Solution : les extraire dans `lib/bootstrap.ts`

**Étape A** — Ajouter dans `apps/web/lib/bootstrap.ts` :

```typescript
import { buildMatchesForDay } from '@kickstock/game-engine';
import type { BootstrapData, GameState, Match } from '@kickstock/types';

export function deriveDynamicKey(phase: string, dayIndex: number, bootstrap: BootstrapData): string {
  const koDays     = bootstrap.days.filter(d => d.phase === phase).sort((a, b) => a.day_index - b.day_index);
  const posInPhase = koDays.findIndex(d => d.day_index === dayIndex);
  if (phase === 'R32')   return (['r32_28','r32_29','r32_30','r32_1','r32_2','r32_3'])[posInPhase] ?? 'r32_1';
  if (phase === 'R16')   return (['r16_1','r16_2','r16_3','r16_4'])[posInPhase] ?? 'r16_1';
  if (phase === 'QF')    return (['qf_1','qf_2','qf_3'])[posInPhase] ?? 'qf_1';
  if (phase === 'SF')    return posInPhase === 0 ? 'sf_1' : 'sf_2';
  if (phase === '3rd')   return '3rd';
  if (phase === 'Final') return 'final';
  return phase.toLowerCase();
}

export function buildMatchesForCurrentDayFromBootstrap(
  state:     GameState,
  bootstrap: BootstrapData | null,
): Match[] {
  if (!bootstrap) return [];
  const day = bootstrap.days.find(d => d.day_index === state.dayIndex) ?? null;
  if (!day) return [];

  if (!day.is_ko) {
    return bootstrap.group_fixtures
      .filter(f => f.day_index === state.dayIndex)
      .filter(f => !state.eliminated.includes(f.nation_a) && !state.eliminated.includes(f.nation_b))
      .map(f => ({ a: f.nation_a, b: f.nation_b, venue: f.venue ?? undefined }));
  }
  return buildMatchesForDay(deriveDynamicKey(day.phase, state.dayIndex, bootstrap), state);
}
```

**Étape B** — Dans `localGameStore.ts`, supprimer les définitions locales de `deriveDynamicKey` et `buildMatchesForCurrentDay`, et importer depuis `lib/bootstrap` :

```typescript
import { getBootstrap, bootstrapToTeams, deriveDynamicKey, buildMatchesForCurrentDayFromBootstrap } from '@/lib/bootstrap';
```

Remplacer l'export à la fin du fichier :

```typescript
// Supprimer les fonctions locales deriveDynamicKey et buildMatchesForCurrentDay
// Remplacer l'export par :
export function buildMatchesForCurrentDay(
  state: GameState & { _bootstrap?: BootstrapData | null; _teams?: TeamMeta[] }
): Match[] {
  return buildMatchesForCurrentDayFromBootstrap(state as GameState, state._bootstrap ?? null);
}
```

**Étape C** — Même chose dans `onlineGameStore.ts` :

```typescript
import { getBootstrap, bootstrapToTeams, deriveDynamicKey, buildMatchesForCurrentDayFromBootstrap } from '@/lib/bootstrap';
// ...
export function buildMatchesForCurrentDay(
  state: GameState & { _bootstrap?: BootstrapData | null }
): Match[] {
  return buildMatchesForCurrentDayFromBootstrap(state as GameState, state._bootstrap ?? null);
}
```

---

## Récapitulatif des fichiers à modifier

| Fix | Fichier(s) | Type de changement |
|-----|------------|-------------------|
| 1 | `components/mechanics/SimulateButton.tsx` | Remplacer import CALENDAR par lecture bootstrap |
| 2 | `app/api/game/reset/route.ts` (nouveau) | Créer endpoint reset portfolio |
| 2 | `lib/api.ts` | Ajouter `apiReset()` |
| 2 | `stores/onlineGameStore.ts` | `resetGame` → appel API async |
| 3 | `stores/localGameStore.ts` | Clé persist dynamique + competitionId dans getBootstrap |
| 4 | `stores/onlineGameStore.ts` | Supprimer ré-enrichissement txLog dans `fetchState` |
| 5 | `lib/api.ts` | Ajouter `price?` au type retour de `apiTrade` |
| 5 | `stores/onlineGameStore.ts` | Utiliser `result.price` pour avgCost dans `trade` |
| 6 | `stores/onlineGameStore.ts` | Appeler `fetchState()` après `advanceDay` |
| 7 | `components/mechanics/usePortfolioTotals.ts` | Remplacer fallback NATIONS par `_teams` |
| 8 | `stores/localGameStore.ts` + `onlineGameStore.ts` | `isKO` depuis bootstrap au lieu de `>= 17` |
| 9 | `stores/localGameStore.ts` | Conserver `bestScore` dans `resetGame` |
| 10 | `lib/bootstrap.ts` | Extraire `deriveDynamicKey` + `buildMatchesForCurrentDayFromBootstrap` |
| 10 | `stores/localGameStore.ts` + `onlineGameStore.ts` | Importer depuis lib/bootstrap, supprimer doublons |

## Ordre d'implémentation recommandé

1. **FIX 10 en premier** (extraction dans `lib/bootstrap.ts`) — les FIX 1, 3, 8 en dépendent indirectement
2. **FIX 7** (`usePortfolioTotals`) — indépendant, risque 0
3. **FIX 9** (`bestScore` au reset offline) — 2 lignes, sans risque
4. **FIX 4** (txLog flags) — 5 lignes, sans risque
5. **FIX 8** (`isKO` depuis bootstrap) — dans les deux stores
6. **FIX 3** (clé persist offline) — tester avec changement de compétition
7. **FIX 5** (prix serveur pour avgCost) — modifier `api.ts` puis `onlineGameStore`
8. **FIX 6** (`fetchState` après `advanceDay`) — valider que l'animation n'est pas interrompue
9. **FIX 1** (`SimulateButton` depuis bootstrap) — tester avec WC2026 et une autre compétition
10. **FIX 2** (reset online) — le plus complexe, à faire en dernier

---

## Points à ne pas modifier

- **Longueur pseudo :** conserver la validation `[3, 20]` caractères telle quelle dans `lib/pseudo.ts`. Le document USER_STORIES mentionnait "3–16" mais c'était une erreur de rédaction — le code à 3–20 est la référence.
- **Seuil d'upset en mode Online :** ne pas modifier `process-real-result.ts`. En mode live, les résultats viennent de l'API Football et l'upset est détecté avec `gap > 5` — c'est intentionnel et distinct du mode simulation.
- **`simulate.ts` seuil `gap > 8` :** ne pas modifier. C'est la logique de simulation offline, elle peut rester différente.
