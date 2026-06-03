# KickStock — Next Steps Vague 4

> Document auto-suffisant destiné à être injecté dans une nouvelle session Claude Code.
> Les vagues 1, 2 et 3 ont été entièrement appliquées (voir `docs/BUSINESS_LOGIC_ANALYSIS.md`).
> Ce document couvre uniquement les travaux restants de cette vague.

---

## Contexte du projet

KickStock est un monorepo Next.js 14 (App Router) + Supabase + Zustand.

```
packages/
  constants/src/index.ts   ← exports : TOKENS, MOBILE_BREAKPOINT, NATIONS, GROUPS,
                              DIV_RATES, INIT_CASH, CALENDAR, SCORER_POOL
  game-engine/src/
    initState.ts            ← ⚠️ encore un fallback NATIONS legacy
    genGoals.ts             ← ⚠️ dépend de SCORER_POOL + type Nation legacy
    buildKOMatches.ts       ← ✅ nettoyé (vague 3) — plus de NATIONS/GROUPS
    index.ts                ← exports publics du package
  types/src/index.ts        ← interfaces : Nation, TeamMeta, Goal, GameState, etc.
apps/web/
  stores/
    localGameStore.ts       ← mode Offline, appelle genGoals avec objet compat
  app/api/
    game/advance/route.ts   ← mode Online, appelle genGoals avec objet compat
    admin/simulate-day/route.ts ← appelle genGoals avec objet compat
db/migrations/
  013_cleanup_legacy.sql    ← ✅ fichier prêt, PAS encore exécuté en production
```

**Tables actives à ne jamais supprimer :** `competitions`, `competition_game_state`, `competition_teams`, `competition_prices`, `competition_days`, `matches`, `teams`, `portfolios`, `holdings`, `transactions`, `profiles`, `user_game_states`, `leaderboard`.

---

## STEP 1 — ⚠️ Action JY : Exécuter la migration SQL 013 en production

> **Cette étape doit être réalisée manuellement par JY dans le Supabase Dashboard.
> Claude Code ne peut pas exécuter de requêtes directement sur la base de production.**

### Contexte

Le fichier `db/migrations/013_cleanup_legacy.sql` supprime les tables et RPCs legacy des migrations 001 et 005 (schéma single-player pré-multi-compétition). Il est prêt depuis la vague 3 mais n'a pas encore été exécuté.

### Procédure complète

**Étape A — Vérification préalable (Supabase SQL Editor → base PROD)**

Exécuter d'abord cette requête de comptage. Procéder uniquement si **toutes les lignes retournent `0`** :

```sql
SELECT 'nations'          AS table_name, COUNT(*) AS rows FROM nations
UNION ALL SELECT 'positions',             COUNT(*) FROM positions
UNION ALL SELECT 'trades',                COUNT(*) FROM trades
UNION ALL SELECT 'price_history',         COUNT(*) FROM price_history
UNION ALL SELECT 'game_state',            COUNT(*) FROM game_state
UNION ALL SELECT 'nation_prices',         COUNT(*) FROM nation_prices
UNION ALL SELECT 'group_standings',       COUNT(*) FROM group_standings
UNION ALL SELECT 'knockout_pools',        COUNT(*) FROM knockout_pools
UNION ALL SELECT 'holdings_history',      COUNT(*) FROM holdings_history
UNION ALL SELECT 'dividends',             COUNT(*) FROM dividends;
```

**Si une table retourne un nombre > 0 → ne pas continuer, investiguer d'abord.**

**Étape B — Exécution de la migration**

Une fois la vérification OK, exécuter le contenu complet de `db/migrations/013_cleanup_legacy.sql` dans le SQL Editor de Supabase (prod) :

```sql
-- ─── 1. RPCs legacy ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS execute_trade(p_device_id TEXT, p_user_id UUID, p_team_id TEXT, p_mode TEXT, p_quantity INTEGER);
DROP FUNCTION IF EXISTS get_or_create_portfolio(p_device_id TEXT, p_user_id UUID);
DROP FUNCTION IF EXISTS distribute_dividends(p_portfolio_id UUID, p_nation_id TEXT, p_div_key TEXT);
DROP FUNCTION IF EXISTS liquidate_eliminated(p_portfolio_id UUID, p_nation_id TEXT);

-- ─── 2. Trigger legacy ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_nation_price ON nation_prices;
DROP FUNCTION IF EXISTS sync_nation_current_price();

-- ─── 3. Tables legacy ─────────────────────────────────────────────────────────
DROP TABLE IF EXISTS holdings_history CASCADE;
DROP TABLE IF EXISTS dividends        CASCADE;
DROP TABLE IF EXISTS nation_prices    CASCADE;
DROP TABLE IF EXISTS group_standings  CASCADE;
DROP TABLE IF EXISTS knockout_pools   CASCADE;
DROP TABLE IF EXISTS price_history    CASCADE;
DROP TABLE IF EXISTS positions        CASCADE;
DROP TABLE IF EXISTS trades           CASCADE;
DROP TABLE IF EXISTS nations          CASCADE;
DROP TABLE IF EXISTS game_state       CASCADE;
DROP TABLE IF EXISTS groups           CASCADE;
```

**Étape C — Vérification post-migration**

Vérifier que ces tables n'apparaissent plus :

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Les tables suivantes **ne doivent plus apparaître** : `nations`, `positions`, `trades`, `price_history`, `game_state`, `nation_prices`, `group_standings`, `knockout_pools`, `holdings_history`, `dividends`, `groups`.

---

## STEP 2 — Test pipeline `advanceDay` offline

### Contexte

Le test `advanceDay.test.ts` a été spécifié dans la vague 3 (`NEXT_STEPS_V3.md`) mais n'a pas été implémenté. C'est le seul test manquant du plan de couverture.

Il vérifie la logique métier principale du mode Offline :
- Les prix bougent après une journée de groupe (conservation de valeur via `applyResult`)
- Le `dayIndex` est incrémenté
- Un résultat est retourné avec la bonne structure

### Fichier à créer

`apps/web/stores/advanceDay.test.ts`

### Pourquoi c'est complexe à tester

`localGameStore` est un store Zustand avec `persist` (il écrit dans `localStorage`). Il appelle aussi :
- `getBootstrap()` depuis `lib/bootstrap.ts` (fetch réseau)
- `bootstrapToTeams()` depuis `lib/bootstrap.ts`
- `syncBestScore()` depuis `hooks/useAuth.ts` (Supabase)
- `createClient()` depuis `lib/supabase/client.ts` (Supabase)

Tous ces appels externes doivent être mockés.

### Configuration Vitest requise

Vérifier que `apps/web/vitest.config.ts` existe et est configuré pour les tests `apps/web`. Si ce fichier n'existe pas encore, le créer :

```typescript
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals:     true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@kickstock/game-engine': path.resolve(__dirname, '../../packages/game-engine/src/index.ts'),
      '@kickstock/constants':   path.resolve(__dirname, '../../packages/constants/src/index.ts'),
      '@kickstock/types':       path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
});
```

### Code du test

```typescript
/**
 * apps/web/stores/advanceDay.test.ts
 *
 * Teste la logique métier du pipeline advanceDay offline :
 * - Les prix bougent après un match de groupe (applyResult redistribue la valeur)
 * - dayIndex est incrémenté
 * - La structure du résultat est correcte
 *
 * Note : localGameStore utilise Zustand persist (localStorage) et plusieurs
 * dépendances réseau — toutes mockées ici.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BootstrapData, TeamMeta } from '@kickstock/types';

// ── Mocks — doivent être déclarés AVANT tout import du store ─────────────────

vi.mock('@/hooks/useAuth', () => ({
  syncBestScore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn(() => ({
      select:  vi.fn().mockReturnThis(),
      eq:      vi.fn().mockReturnThis(),
      single:  vi.fn().mockResolvedValue({ data: null }),
      upsert:  vi.fn().mockResolvedValue({ error: null }),
    })),
  })),
}));

vi.mock('@/lib/bootstrap', () => ({
  getBootstrap:          vi.fn(),
  bootstrapToTeams:      vi.fn(),
  deriveDynamicKey:      vi.fn().mockReturnValue('groups'),
  buildMatchesForCurrentDayFromBootstrap: vi.fn().mockReturnValue([]),
}));

// ── localStorage mock ─────────────────────────────────────────────────────────

const mockStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem:    (k: string) => mockStore[k] ?? null,
  setItem:    (k: string, v: string) => { mockStore[k] = v; },
  removeItem: (k: string) => { delete mockStore[k]; },
  clear:      () => { Object.keys(mockStore).forEach(k => delete mockStore[k]); },
  length: 0,
  key: (_: number) => null,
};
Object.defineProperty(global, 'localStorage', { value: mockLocalStorage, writable: true });

// ── Données de test ───────────────────────────────────────────────────────────

const TEAM_A: TeamMeta = {
  id: 'AAA', name: 'Team A', flag: '🇦',
  group: 'A', strength: 80, initialPrice: 100,
};
const TEAM_B: TeamMeta = {
  id: 'BBB', name: 'Team B', flag: '🇧',
  group: 'A', strength: 60, initialPrice: 50,
};

function makeBootstrap(): BootstrapData {
  return {
    competition: { id: 1, name: 'Test', start_date: '2026-01-01', league_id: 1, season: 2026 },
    teams: [
      { id: 'AAA', name: 'Team A', flag_emoji: '🇦', logo_url: null,
        group_code: 'A', strength: 80, initial_price: 100, confederation: null },
      { id: 'BBB', name: 'Team B', flag_emoji: '🇧', logo_url: null,
        group_code: 'A', strength: 60, initial_price: 50,  confederation: null },
    ],
    days: [
      { day_index: 0, full_label: 'Day 0', date_label: 'Jun 1', phase: 'Groups', is_ko: false, div_key: null },
      { day_index: 1, full_label: 'Day 1', date_label: 'Jun 2', phase: 'Groups', is_ko: false, div_key: null },
    ],
    group_fixtures: [
      { day_index: 0, nation_a: 'AAA', nation_b: 'BBB', venue: null },
    ],
    generated_at: new Date().toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('advanceDay offline — logique métier', () => {
  beforeEach(async () => {
    // Vider le localStorage entre chaque test pour un store frais
    mockLocalStorage.clear();

    // Configurer les mocks bootstrap
    const { getBootstrap, bootstrapToTeams } = await import('@/lib/bootstrap');
    vi.mocked(getBootstrap).mockResolvedValue(makeBootstrap());
    vi.mocked(bootstrapToTeams).mockReturnValue([TEAM_A, TEAM_B]);

    // Réinitialiser le module du store pour avoir un état frais
    vi.resetModules();
  });

  it('les prix changent après une journée de groupe', async () => {
    const { useLocalGameStore } = await import('./localGameStore');

    // Charger le bootstrap (seed les prix initiaux)
    await useLocalGameStore.getState().loadBootstrap();

    const priceABefore = useLocalGameStore.getState().prices['AAA'];
    const priceBBefore = useLocalGameStore.getState().prices['BBB'];
    expect(priceABefore).toBe(100);
    expect(priceBBefore).toBe(50);

    // Simuler la journée
    const result = await useLocalGameStore.getState().advanceDay();

    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(1);

    const priceAAfter = useLocalGameStore.getState().prices['AAA'];
    const priceBAfter = useLocalGameStore.getState().prices['BBB'];

    // applyResult conserve la valeur totale (victoire : winner +50% loser, loser -50%)
    // → total avant = 150, total après ≈ 150 (à 1 KC près d'arrondi)
    const totalBefore = priceABefore + priceBBefore;
    const totalAfter  = priceAAfter  + priceBAfter;
    expect(Math.abs(totalAfter - totalBefore)).toBeLessThanOrEqual(1);

    // Au moins un prix a changé
    const pricesMoved = priceAAfter !== priceABefore || priceBAfter !== priceBBefore;
    expect(pricesMoved).toBe(true);
  });

  it('dayIndex est incrémenté après advanceDay', async () => {
    const { useLocalGameStore } = await import('./localGameStore');

    await useLocalGameStore.getState().loadBootstrap();
    expect(useLocalGameStore.getState().dayIndex).toBe(0);

    await useLocalGameStore.getState().advanceDay();
    expect(useLocalGameStore.getState().dayIndex).toBe(1);
  });

  it('le résultat contient les champs attendus', async () => {
    const { useLocalGameStore } = await import('./localGameStore');

    await useLocalGameStore.getState().loadBootstrap();
    const result = await useLocalGameStore.getState().advanceDay();

    expect(result).not.toBeNull();
    const r = result!.results[0];

    // Champs de base
    expect(r.a).toBe('AAA');
    expect(r.b).toBe('BBB');
    expect(typeof r.scoreA).toBe('number');
    expect(typeof r.scoreB).toBe('number');
    expect(['A', 'B', 'draw']).toContain(r.res);

    // Nouveaux prix présents et positifs
    expect(r.newPA).toBeGreaterThanOrEqual(1);
    expect(r.newPB).toBeGreaterThanOrEqual(1);

    // Phase correcte
    expect(r.phase).toBe('Groups');
  });

  it('tournoi terminé → advanceDay retourne null', async () => {
    const { getBootstrap } = await import('@/lib/bootstrap');
    // Bootstrap avec 0 journées = tournoi terminé
    vi.mocked(getBootstrap).mockResolvedValue({
      ...makeBootstrap(),
      days: [],
    });

    const { useLocalGameStore } = await import('./localGameStore');
    await useLocalGameStore.getState().loadBootstrap();

    const result = await useLocalGameStore.getState().advanceDay();
    expect(result).toBeNull();
  });
});
```

---

## STEP 3 — Supprimer `CALENDAR` et `GROUPS` de `@kickstock/constants`

### Contexte

Ces deux exports sont **dead code** confirmé : aucun fichier TypeScript actif ne les importe (vérifié par grep sur toute la codebase). Ils ne servent qu'à alourdir le bundle et à induire les développeurs en erreur.

### Vérification préalable

Avant de modifier, confirmer qu'il n'y a aucun import actif :

```bash
grep -rn "'\@kickstock/constants'" apps/ packages/ --include="*.ts" --include="*.tsx" \
  | grep -v node_modules | grep "CALENDAR\|GROUPS"
```

Résultat attendu : **aucune ligne** (les seules occurrences restantes sont dans des commentaires).

### Fichier à modifier

`packages/constants/src/index.ts`

### Modifications

**1 — Supprimer l'import de `CalendarDay`** (utilisé uniquement pour typer `CALENDAR`)

```typescript
// AVANT (ligne 1)
import type { Nation, CalendarDay } from '@kickstock/types';

// APRÈS
import type { Nation } from '@kickstock/types';
// CalendarDay n'est plus nécessaire ici
```

**2 — Supprimer la constante `GROUPS`** (ligne ~79)

```typescript
// SUPPRIMER entièrement :
export const GROUPS = ["ALL","A","B","C","D","E","F","G","H","I","J","K","L"] as const;
```

**3 — Supprimer la constante `CALENDAR`** (lignes ~88 à ~125, soit ~37 lignes)

Supprimer le bloc entier commençant par :
```typescript
export const CALENDAR: CalendarDay[] = [
  // ... (35 journées hardcodées WC2026)
];
```

### Vérification après modification

```bash
cd packages/constants && pnpm tsc --noEmit
# → doit compiler sans erreur

# Puis dans le monorepo :
pnpm build
# → doit compiler sans erreur
```

---

## STEP 4 — `genGoals.ts` : supprimer la dépendance à `Nation` et `SCORER_POOL`

### Contexte

`packages/game-engine/src/genGoals.ts` a deux dépendances legacy :

1. **Type `Nation`** (interface legacy avec `p`, `conf`, `str`, `group`) — la fonction n'utilise que `id` et `name`
2. **`SCORER_POOL`** (48 équipes WC2026 hardcodées) — lookup des noms de buteurs fictifs

Chaque appelant construit déjà un objet compat minimal pour satisfaire le type `Nation` :

```typescript
// Dans localGameStore.ts :
const nACompat = { id: tA.id, name: tA.name, flag: tA.flag, p: tA.initialPrice, conf: '', str: tA.strength, group: tA.group };

// Dans game/advance/route.ts :
{ id: m.a, name: teamA?.teams?.name ?? m.a, flag: teamA?.teams?.flag_emoji ?? '', p: pA, str: strA, conf: '', group: '' }
```

Ces constructions de compat objects sont des anti-patterns — ils existent uniquement pour satisfaire un type qui n'est plus adapté.

### Décision : Option A — Supprimer `SCORER_POOL`, simplifier la signature

La fonction `genGoals` n'utilise `nA.id` que pour `SCORER_POOL[nA.id]`, et `nA.name` comme fallback quand l'équipe n'est pas dans le pool. Le comportement attendu est :
- Si l'équipe est dans `SCORER_POOL` → nom du pool
- Sinon → nom de l'équipe

Pour une simulation, **utiliser le nom de l'équipe comme fallback est entièrement acceptable**. L'expérience joueur est identique.

### Modifications

#### A — Modifier `packages/game-engine/src/genGoals.ts`

```typescript
// AVANT
import { SCORER_POOL } from '@kickstock/constants';
import type { Nation, Goal } from '@kickstock/types';

export function genGoals(
  scoreA: number,
  scoreB: number,
  nA: Nation,
  nB: Nation,
  res90: string,
  etRes: string | null,
): Goal[] {
  const nameA = () => {
    const pool = SCORER_POOL[nA.id] ?? [nA.name];
    return pool[Math.floor(Math.random() * pool.length)];
  };
  const nameB = () => {
    const pool = SCORER_POOL[nB.id] ?? [nB.name];
    return pool[Math.floor(Math.random() * pool.length)];
  };
  // ... (reste inchangé)
}
```

```typescript
// APRÈS
import type { Goal } from '@kickstock/types';

/** Minimal team descriptor needed by genGoals — only id and name are used. */
interface TeamRef {
  id:   string;
  name: string;
}

export function genGoals(
  scoreA: number,
  scoreB: number,
  nA: TeamRef,
  nB: TeamRef,
  res90: string,
  etRes: string | null,
): Goal[] {
  // Scorer name = team name (acceptable for simulation)
  const nameA = () => nA.name;
  const nameB = () => nB.name;

  // ... (le reste du corps de la fonction est IDENTIQUE — ne rien modifier)
}
```

#### B — Mettre à jour les 3 appelants

**1. `apps/web/stores/localGameStore.ts`**

```typescript
// AVANT
const nACompat = { id: tA.id, name: tA.name, flag: tA.flag, p: tA.initialPrice, conf: '', str: tA.strength, group: tA.group };
const nBCompat = { id: tB.id, name: tB.name, flag: tB.flag, p: tB.initialPrice, conf: '', str: tB.strength, group: tB.group };
const goals    = genGoals(scoreA, scoreB, nACompat, nBCompat, sim.res90, sim.etRes);

// APRÈS — plus besoin de l'objet compat complet, juste id et name
const goals = genGoals(scoreA, scoreB,
  { id: tA.id, name: tA.name },
  { id: tB.id, name: tB.name },
  sim.res90, sim.etRes,
);
```

**2. `apps/web/app/api/game/advance/route.ts`**

```typescript
// AVANT
const goals = genGoals(
  scoreA, scoreB,
  { id: m.a, name: teamA?.teams?.name ?? m.a, flag: teamA?.teams?.flag_emoji ?? '', p: pA, str: strA, conf: '', group: '' },
  { id: m.b, name: teamB?.teams?.name ?? m.b, flag: teamB?.teams?.flag_emoji ?? '', p: pB, str: strB, conf: '', group: '' },
  sim.res90, sim.etRes,
);

// APRÈS
const goals = genGoals(
  scoreA, scoreB,
  { id: m.a, name: teamA?.teams?.name ?? m.a },
  { id: m.b, name: teamB?.teams?.name ?? m.b },
  sim.res90, sim.etRes,
);
```

**3. `apps/web/app/api/admin/simulate-day/route.ts`**

Appliquer la même simplification que pour `advance/route.ts` — chercher les appels à `genGoals` dans ce fichier et remplacer les objets compat par `{ id, name }`.

#### C — Vérifier la compilation

```bash
cd packages/game-engine && pnpm tsc --noEmit
cd apps/web && pnpm tsc --noEmit
```

---

## STEP 5 — `initState.ts` : supprimer le fallback `NATIONS`

### Contexte

`packages/game-engine/src/initState.ts` contient un fallback sur `NATIONS` hardcodés si `teams` n'est pas fourni :

```typescript
export function initState(teams?: TeamMeta[]): GameState {
  const src = teams ?? NATIONS.map(n => ({   // ← fallback WC2026
    id: n.id, name: n.name, flag: n.flag,
    group: n.group, strength: n.str, initialPrice: n.p,
  }));
  // ...
}
```

### Vérification préalable

Confirmer que `initState` n'est appelé nulle part dans `apps/web` :

```bash
grep -rn "initState\b" apps/web --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".next"
```

Résultat attendu : **aucune ligne** (le store offline a sa propre fonction `baseState()` + `emptyPrices()`).

### Modification

**Fichier :** `packages/game-engine/src/initState.ts`

```typescript
// AVANT
import { NATIONS, INIT_CASH } from '@kickstock/constants';
import type { GameState, TeamMeta } from '@kickstock/types';

/**
 * Initialises a fresh GameState.
 *
 * Preferred (API-driven): pass `teams` from the bootstrap endpoint.
 * Legacy fallback: if called with no args, uses the hardcoded NATIONS constant.
 * The fallback exists only to keep the server advance route working during migration.
 */
export function initState(teams?: TeamMeta[]): GameState {
  const src = teams ?? NATIONS.map(n => ({
    id: n.id, name: n.name, flag: n.flag,
    group: n.group, strength: n.str, initialPrice: n.p,
  }));
  // ...
}
```

```typescript
// APRÈS
import { INIT_CASH } from '@kickstock/constants';
import type { GameState, TeamMeta } from '@kickstock/types';

/**
 * Initialises a fresh GameState from a list of teams.
 * Teams must come from the bootstrap endpoint (/api/competition/bootstrap).
 */
export function initState(teams: TeamMeta[]): GameState {
  const src = teams;   // ← direct, plus de fallback
  // ... (reste du corps identique)
}
```

**Supprimer `NATIONS` de l'import** — `INIT_CASH` reste nécessaire.

### Vérification

```bash
cd packages/game-engine && pnpm tsc --noEmit
```

Si des erreurs TypeScript apparaissent sur des tests ou du code externe qui appelle `initState()` sans argument, corriger ces appelants en passant un tableau vide `[]` ou la liste des équipes bootstrap.

---

## Récapitulatif et ordre recommandé

| Ordre | Step | Qui | Effort | Risque |
|-------|------|-----|--------|--------|
| 1 | **STEP 1** — Exécuter migration 013 en prod | **JY** (action manuelle Supabase) | 30 min | 🔴 Irréversible — vérifier comptage avant |
| 2 | **STEP 3** — Supprimer `CALENDAR` + `GROUPS` de constants | Claude Code | 10 min | 🟢 Faible |
| 3 | **STEP 5** — `initState` : supprimer fallback `NATIONS` | Claude Code | 15 min | 🟢 Faible |
| 4 | **STEP 4** — `genGoals` : supprimer `Nation` + `SCORER_POOL` | Claude Code | 30 min | 🟢 Faible |
| 5 | **STEP 2** — Test `advanceDay.test.ts` | Claude Code | 1-2h | 🟡 Moyen (mocks Zustand) |

**Après STEP 3 + 4 + 5 :** vérifier que `NATIONS` n'est plus importé nulle part dans `packages/game-engine` :

```bash
grep -rn "NATIONS" packages/game-engine/src/ --include="*.ts"
# → doit retourner 0 résultat
```

Si c'est le cas, `NATIONS` peut aussi être supprimé de `packages/constants/src/index.ts` (même procédure que `CALENDAR`/`GROUPS` dans STEP 3).

---

## Points à ne pas modifier

- **`DIV_RATES`** dans `@kickstock/constants` — utilisé dans `localGameStore.ts` et `buildKOMatches.ts` (re-export). Conserver.
- **`INIT_CASH`** dans `@kickstock/constants` — utilisé dans `localGameStore.ts` (`baseState()`). Conserver.
- **`TOKENS`** et `MOBILE_BREAKPOINT` dans `@kickstock/constants` — design system. Conserver.
- **`SCORER_POOL`** dans `@kickstock/constants` — après le STEP 4, il ne sera plus importé par `genGoals`. Vérifier qu'il n'est importé nulle part ailleurs avant de le supprimer (il peut rester comme dead code inoffensif si on ne souhaite pas le supprimer immédiatement).
- **Tables actives en base** : `holdings`, `transactions`, `portfolios`, `competition_game_state` — ne jamais les inclure dans une migration de suppression.
- **`CalendarDay`** dans `packages/types/src/index.ts` — ce type peut rester dans le package types même si `CALENDAR` est supprimé de constants, car il pourrait être utilisé par du code externe ou des tests futurs.
