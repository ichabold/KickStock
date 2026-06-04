# KickStock — Next Steps Vague 5

> Document auto-suffisant destiné à être injecté dans une nouvelle session Claude Code.
> Les vagues 1 à 4 ont été entièrement appliquées (voir `docs/BUSINESS_LOGIC_ANALYSIS.md`).
> Ce document couvre deux steps indépendants — ils peuvent être exécutés dans n'importe quel ordre.

---

## Contexte du projet

KickStock est un monorepo Next.js 14 (App Router) + Supabase + Zustand.

```
packages/
  constants/src/index.ts     ← à nettoyer : contient encore NATIONS + SCORER_POOL
  types/src/index.ts         ← interfaces partagées (GameState, TeamMeta, BootstrapData…)
  game-engine/src/index.ts   ← fonctions pures (applyResult, simulate, genGoals…)

apps/web/
  stores/
    gameStore.ts             ← façade : re-exporte le bon store selon le mode
    localGameStore.ts        ← mode Offline — interface LocalGameStore
    onlineGameStore.ts       ← mode Online  — interface OnlineGameStore
  components/
    browser/BrowserShell.tsx ← 8 occurrences de (s as any)._bootstrap/_teams
    mobile/…                 ← 6 occurrences
    shared/…                 ← 5 occurrences
    mechanics/…              ← 2 occurrences
```

**État actuel de `@kickstock/constants` :**

| Export | Statut |
|--------|--------|
| `TOKENS` | ✅ Actif — design system |
| `MOBILE_BREAKPOINT` | ✅ Actif — layout |
| `DIV_RATES` | ✅ Actif — logique dividendes |
| `INIT_CASH` | ✅ Actif — logique cash de départ |
| `NATIONS` | 🗑️ **Dead code** — aucun import actif |
| `SCORER_POOL` | 🗑️ **Dead code** — aucun import actif |

---

## STEP 1 — Supprimer `NATIONS` et `SCORER_POOL` de `@kickstock/constants`

### Fichier à modifier

`packages/constants/src/index.ts`

### Vérification préalable

Avant de modifier, confirmer qu'il n'existe aucun import actif de ces deux constantes :

```bash
grep -rn "NATIONS\|SCORER_POOL" \
  apps/ packages/ \
  --include="*.ts" --include="*.tsx" \
  | grep -v node_modules | grep -v ".next" | grep -v ".d.ts" \
  | grep -v "^.*//.*NATIONS\|^.*//.*SCORER_POOL"
```

Résultat attendu : uniquement des correspondances dans `packages/constants/src/index.ts` lui-même (les lignes `export const NATIONS` et `export const SCORER_POOL`). Aucune autre occurrence.

### Modification A — Supprimer l'import `Nation`

Ligne 1 du fichier :

```typescript
// SUPPRIMER entièrement :
import type { Nation } from '@kickstock/types';
```

Ce type n'est utilisé que pour typer `NATIONS`. Une fois `NATIONS` supprimé, cet import devient inutile. Si TypeScript signale une erreur résiduelle sur `Nation`, elle sera résolue par la suppression du bloc NATIONS ci-dessous.

### Modification B — Supprimer le bloc `NATIONS`

Le bloc entier, de la ligne `// ─── 48 NATIONS ───` jusqu'à la ligne `];` incluse (48 entrées + commentaire + crochet fermant).

```typescript
// SUPPRIMER entièrement ce bloc (~50 lignes) :
// ─── 48 NATIONS ───────────────────────────────────────────────────────────────
export const NATIONS: Nation[] = [
  {id:"MEX",name:"Mexico",       flag:"🇲🇽",p:25,  conf:"CONCACAF",str:72,group:"A"},
  // ... 47 autres lignes ...
  {id:"PAN",name:"Panama",       flag:"🇵🇦",p:20,  conf:"CONCACAF",str:53,group:"L"},
];
```

### Modification C — Supprimer le bloc `SCORER_POOL`

Le bloc entier, du commentaire `// ─── SCORER POOL ───` jusqu'à `};` inclus (22 équipes).

```typescript
// SUPPRIMER entièrement ce bloc (~30 lignes) :
// ─── SCORER POOL ──────────────────────────────────────────────────────────────
export const SCORER_POOL: Record<string, string[]> = {
  BRA:["Vinicius Jr.","Rodrygo","Endrick","Paquetá","Raphinha"],
  // ... 21 autres équipes ...
  CAN:["Davies","David","Larin","Hoilett","Buchanan"],
};
```

### État final du fichier après modifications

Le fichier `packages/constants/src/index.ts` doit ne contenir plus que :

```typescript
// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
export const TOKENS = { ... } as const;

export const MOBILE_BREAKPOINT = 600; // px

export const DIV_RATES: Record<string, number> = {
  r32: 0.10, r16: 0.15, qf: 0.20, sf: 0.30, final: 0.40, champion: 0.60,
};

export const INIT_CASH = 10_000;
```

Aucun import en tête de fichier (l'import `Nation` est supprimé avec le bloc NATIONS).

### Vérification après modification

```bash
# Compilation du package
cd packages/constants && pnpm tsc --noEmit

# Compilation du monorepo complet
cd /chemin/vers/kickstock && pnpm build
# ou : pnpm tsc --noEmit (depuis la racine)
```

Les deux doivent passer sans erreur.

---

## STEP 2 — Typage propre du store facade (supprimer les `(s as any)` casts)

### Le problème

`apps/web/stores/gameStore.ts` exporte `useGameStore` comme façade :

```typescript
export const useGameStore = (
  mode === 'online' ? useOnlineGameStore : useLocalGameStore
) as typeof useLocalGameStore;
```

`typeof useLocalGameStore` donne accès à l'interface `LocalGameStore`, qui **inclut déjà** `_bootstrap: BootstrapData | null` et `_teams: TeamMeta[]`. Pourtant, dans toute la codebase, les composants accèdent à ces champs via un cast `(s as any)` redondant :

```typescript
// Pattern actuel dans 30 endroits — le cast (s as any) est inutile
const bootstrap = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;
const teams     = useGameStore(s => (s as any)._teams) as TeamMeta[];
```

Ces casts datent de l'époque où `_bootstrap` et `_teams` n'étaient pas encore dans l'interface du store. Ils sont aujourd'hui purement du code legacy.

### La solution

Exposer explicitement `_bootstrap` et `_teams` dans le type exporté par `gameStore.ts`, puis supprimer tous les casts `(s as any)` dans les composants.

### Modification de `apps/web/stores/gameStore.ts`

**Fichier complet après modification :**

```typescript
'use client';

/**
 * gameStore — public entry point for all components.
 *
 * Reads the mode from localStorage (via getGameModeSync) at module init
 * and re-exports the correct store. Components always import from here —
 * the mode switch is invisible to them.
 *
 * Online (default): onlineGameStore — server-backed, real API results.
 * Offline:          localGameStore  — localStorage, client-side simulation.
 *
 * Mode stored in localStorage('kickstock:mode').
 * Switching reloads the page (avoids conditional hook issues).
 */

import { getGameModeSync } from '@/hooks/useGameMode';
import {
  useOnlineGameStore,
  buildMatchesForCurrentDay as onlineBuildMatches,
  fmt, pctOf,
} from './onlineGameStore';
import {
  useLocalGameStore,
  buildMatchesForCurrentDay as localBuildMatches,
} from './localGameStore';
import type { BootstrapData, TeamMeta } from '@kickstock/types';

export { fmt, pctOf };

const mode = getGameModeSync();

/**
 * Fields present on both LocalGameStore and OnlineGameStore that components
 * access via the shared useGameStore facade.
 *
 * Declaring them here makes useGameStore properly typed, eliminating the need
 * for (s as any)._bootstrap and (s as any)._teams casts throughout the app.
 */
export interface BootstrapSlice {
  _bootstrap:        BootstrapData | null;
  _teams:            TeamMeta[];
  bootstrapLoading:  boolean;
  bootstrapError:    boolean;
}

// Cast to localGameStore's full type (superset of GameState — both stores implement it)
// The BootstrapSlice fields are part of LocalGameStore and are safe to access
// without (s as any) casts.
export const useGameStore = (
  mode === 'online' ? useOnlineGameStore : useLocalGameStore
) as typeof useLocalGameStore;

export const buildMatchesForCurrentDay = (
  mode === 'online' ? onlineBuildMatches : localBuildMatches
) as typeof localBuildMatches;
```

> **Note :** `BootstrapSlice` est exporté pour que des hooks utilitaires puissent l'utiliser dans le futur, mais ici la vraie correction est dans les composants ci-dessous — le type `typeof useLocalGameStore` inclut déjà tous ces champs, les `(s as any)` sont juste à retirer.

### Modifications dans les composants

**Règle générale** — dans chaque fichier listé ci-dessous, remplacer :

```typescript
// AVANT
useGameStore(s => (s as any)._bootstrap) as BootstrapData | null
useGameStore(s => (s as any)._teams) as TeamMeta[]

// APRÈS
useGameStore(s => s._bootstrap)
useGameStore(s => s._teams)
```

Les `as BootstrapData | null` et `as TeamMeta[]` deviennent inutiles car le type est maintenant correctement inféré.

---

#### `apps/web/components/mechanics/SimulateButton.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap  = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;

// APRÈS
const bootstrap = useGameStore(s => s._bootstrap);
```

Supprimer aussi le commentaire `eslint-disable-next-line`.

---

#### `apps/web/components/mechanics/usePortfolioTotals.ts`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams = useGameStore(s => (s as any)._teams) as TeamMeta[];

// APRÈS
const teams = useGameStore(s => s._teams);
```

---

#### `apps/web/components/shared/TradeModal.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap  = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;

// APRÈS
const bootstrap = useGameStore(s => s._bootstrap);
```

---

#### `apps/web/components/shared/NationDetailOverlay.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams     = useGameStore(s => (s as any)._teams)     as TeamMeta[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;

// APRÈS
const teams     = useGameStore(s => s._teams);
const bootstrap = useGameStore(s => s._bootstrap);
```

---

#### `apps/web/components/shared/MatchDetailOverlay.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams = useGameStore(s => (s as any)._teams) as TeamMeta[];

// APRÈS
const teams = useGameStore(s => s._teams);
```

---

#### `apps/web/components/shared/Ticker.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams = useGameStore(s => (s as any)._teams) as TeamMeta[];

// APRÈS
const teams = useGameStore(s => s._teams);
```

---

#### `apps/web/components/mobile/SimulateTab.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams     = useGameStore(s => (s as any)._teams)     as TeamMeta[];

// APRÈS
const bootstrap = useGameStore(s => s._bootstrap);
const teams     = useGameStore(s => s._teams);
```

---

#### `apps/web/components/mobile/MobileShell.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap = useGameStore(s => (s as any)._bootstrap);

// APRÈS
const bootstrap = useGameStore(s => s._bootstrap);
```

---

#### `apps/web/components/mobile/StandingsTab.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams     = useGameStore(s => (s as any)._teams)     as TeamMeta[];

// APRÈS
const bootstrap = useGameStore(s => s._bootstrap);
const teams     = useGameStore(s => s._teams);
```

---

#### `apps/web/components/mobile/PortfolioTab.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams = useGameStore(s => (s as any)._teams) as TeamMeta[];

// APRÈS
const teams = useGameStore(s => s._teams);
```

---

#### `apps/web/components/mobile/MarketTab.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams     = useGameStore(s => (s as any)._teams)     as TeamMeta[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;

// APRÈS
const teams     = useGameStore(s => s._teams);
const bootstrap = useGameStore(s => s._bootstrap);
```

---

#### `apps/web/components/mobile/ScheduleTab.tsx`

```typescript
// AVANT
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams     = useGameStore(s => (s as any)._teams)     as TeamMeta[];

// APRÈS
const bootstrap = useGameStore(s => s._bootstrap);
const teams     = useGameStore(s => s._teams);
```

---

#### `apps/web/components/browser/BrowserShell.tsx`

Ce fichier a **9 occurrences** réparties sur plusieurs composants internes. Appliquer le même remplacement pour chacune :

```typescript
// Toutes les occurrences du pattern suivant :
useGameStore(s => (s as any)._bootstrap)  →  useGameStore(s => s._bootstrap)
useGameStore(s => (s as any)._teams)      →  useGameStore(s => s._teams)
```

Lignes approximatives concernées : 114, 140, 142, 229, 268, 410, 527, 529, 705, 1018, 1020.

Pour appliquer en une seule opération dans ce fichier, utiliser un remplacement global :
- Remplacer toutes les occurrences de `(s as any)._bootstrap) as BootstrapData | null` par `s._bootstrap)`
- Remplacer toutes les occurrences de `(s as any)._teams) as TeamMeta[]` par `s._teams)`
- Remplacer toutes les occurrences de `(s as any)._bootstrap)` (sans le cast de type, ex. ligne 1018) par `s._bootstrap)`
- Supprimer les commentaires `// eslint-disable-next-line @typescript-eslint/no-explicit-any` qui précédaient ces lignes

---

### Vérification après les modifications du STEP 2

```bash
# Vérifier qu'il ne reste plus de (s as any) lié à _bootstrap ou _teams
grep -rn "(s as any)\._bootstrap\|(s as any)\._teams" \
  apps/web/components apps/web/stores \
  --include="*.ts" --include="*.tsx" \
  | grep -v node_modules
# → doit retourner 0 résultat

# Compilation TypeScript
cd apps/web && pnpm tsc --noEmit
# → 0 erreur
```

---

## Récapitulatif

| Step | Fichiers modifiés | Changement |
|------|-------------------|------------|
| STEP 1 | `packages/constants/src/index.ts` | Suppression de `NATIONS` (48 lignes), `SCORER_POOL` (30 lignes), import `Nation` |
| STEP 2 | `apps/web/stores/gameStore.ts` | Ajout export `BootstrapSlice`, commentaire doc |
| STEP 2 | `apps/web/components/browser/BrowserShell.tsx` | Suppression de 9 casts `(s as any)` |
| STEP 2 | `apps/web/components/mobile/SimulateTab.tsx` | Suppression de 2 casts |
| STEP 2 | `apps/web/components/mobile/MobileShell.tsx` | Suppression de 1 cast |
| STEP 2 | `apps/web/components/mobile/StandingsTab.tsx` | Suppression de 2 casts |
| STEP 2 | `apps/web/components/mobile/MarketTab.tsx` | Suppression de 2 casts |
| STEP 2 | `apps/web/components/mobile/ScheduleTab.tsx` | Suppression de 2 casts |
| STEP 2 | `apps/web/components/mobile/PortfolioTab.tsx` | Suppression de 1 cast |
| STEP 2 | `apps/web/components/shared/TradeModal.tsx` | Suppression de 1 cast |
| STEP 2 | `apps/web/components/shared/NationDetailOverlay.tsx` | Suppression de 2 casts |
| STEP 2 | `apps/web/components/shared/MatchDetailOverlay.tsx` | Suppression de 1 cast |
| STEP 2 | `apps/web/components/shared/Ticker.tsx` | Suppression de 1 cast |
| STEP 2 | `apps/web/components/mechanics/SimulateButton.tsx` | Suppression de 1 cast |
| STEP 2 | `apps/web/components/mechanics/usePortfolioTotals.ts` | Suppression de 1 cast |

**Total : 30 suppressions de `(s as any)` dans 14 fichiers.**

---

## Points à ne pas modifier

- **`packages/types/src/index.ts`** : ne pas supprimer le type `Nation` ni `BootstrapData` ni `TeamMeta` — ils sont utilisés activement.
- **`DIV_RATES` et `INIT_CASH`** dans `constants` : conserver — logique métier active.
- **`apps/web/stores/localGameStore.ts`** et **`onlineGameStore.ts`** : ne pas modifier leur interface — `BootstrapSlice` est déclaré dans `gameStore.ts` uniquement comme documentation ; les vraies interfaces restent dans leurs fichiers respectifs.
