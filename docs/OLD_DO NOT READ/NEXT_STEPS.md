# KickStock — Next Steps

> Document auto-suffisant destiné à être injecté dans une nouvelle session Claude Code.
> Les corrections décrites dans `FIXES_REQUIRED.md` ont déjà été appliquées.
> Ce document couvre uniquement les travaux restants.

---

## Contexte du projet

KickStock est un monorepo Next.js 14 (App Router) + Supabase + Zustand.

```
apps/web/
  app/api/            ← API routes Next.js
  components/
    mechanics/        ← composants partagés entre shells (TradeActions, SimulateButton…)
    mobile/           ← MobileShell (< 600px)
    browser/          ← BrowserShell (≥ 600px)
    shared/           ← NationCard, TradeModal, Ticker, overlays…
  stores/
    gameStore.ts           ← façade : re-exporte le bon store selon le mode
    localGameStore.ts      ← mode Offline (Zustand persist localStorage)
    onlineGameStore.ts     ← mode Online (Supabase, Realtime)
  lib/
    bootstrap.ts           ← cache et helpers bootstrap (deriveDynamicKey exporté ici)
packages/
  game-engine/        ← formules pures
  constants/          ← NATIONS, CALENDAR, GROUPS hardcodés WC2026 (legacy — à éliminer progressivement)
  i18n/
    locales/fr.json   ← traductions françaises complètes
    locales/en.json   ← traductions anglaises complètes
    index.ts          ← resolveLocale, supportedLocales
db/migrations/        ← SQL Supabase
```

**Principe clé :** Toutes les données de compétition (équipes, calendrier, phases, prix initiaux) doivent venir du **bootstrap** (`/api/competition/bootstrap`) et non des constantes hardcodées `NATIONS`/`CALENDAR` du package `@kickstock/constants`. Toute nouvelle compétition (EURO, autre Coupe du Monde) doit fonctionner sans toucher au code.

**État des corrections appliquées :** Voir `FIXES_REQUIRED.md`. Les stores, `SimulateButton`, `usePortfolioTotals` et `lib/bootstrap.ts` ont été mis à jour. Des composants partagés utilisent encore les constantes legacy — c'est l'objet du STEP 1 ci-dessous.

---

## STEP 1 — Nettoyage des constantes legacy dans les composants UI

### Pourquoi c'est prioritaire

Plusieurs composants UI importent encore `NATIONS` et/ou `CALENDAR` depuis `@kickstock/constants`. Ces constantes sont hardcodées pour WC2026 (48 équipes, 35 jours). Pour toute autre compétition, ces composants afficheront des données incorrectes ou planteront silencieusement.

### Composants concernés

| Fichier | Imports legacy | Impact |
|---------|----------------|--------|
| `components/shared/TradeModal.tsx` | `CALENDAR` | `isKO` et cap de concentration faux pour compétitions non-WC2026 |
| `components/shared/NationDetailOverlay.tsx` | `NATIONS`, `CALENDAR` | Fiche équipe : données fausses hors WC2026 |
| `components/shared/Ticker.tsx` | `NATIONS` | Ticker affiche les 48 équipes WC2026 au lieu des équipes de la compétition active |
| `components/shared/MatchDetailOverlay.tsx` | `NATIONS` | Noms et drapeaux faux hors WC2026 |
| `components/mobile/PortfolioTab.tsx` | `NATIONS` | Nom/drapeau de l'équipe null pour compétitions non-WC2026 |
| `components/mobile/MatchAnimation.tsx` | `NATIONS`, `SCORER_POOL` | Animations avec données WC2026 uniquement |
| `components/mobile/PlayButton.tsx` | `CALENDAR`, `NATIONS` | **Composant legacy — à supprimer** (commenté "not rendered") |
| `app/api/market/route.ts` | `NATIONS` | **Route morte — à supprimer** (remplacée par bootstrap) |

---

### 1.1 — `components/shared/TradeModal.tsx`

**Problème :**
```typescript
import { CALENDAR } from '@kickstock/constants';
// ...
const isKO       = CALENDAR[dayIndex]?.isKO ?? false;
const isCapPhase = ['Groups', 'R32'].includes(CALENDAR[dayIndex]?.phase ?? '');
```

`CALENDAR` est hardcodé WC2026. Pour une autre compétition, `CALENDAR[dayIndex]` sera `undefined` → `isKO = false` (taxe toujours 10%) et `isCapPhase = false` (cap de concentration désactivé).

**Fix :**

Remplacer l'import `CALENDAR` par une lecture depuis le store :

```typescript
// Supprimer :
import { CALENDAR } from '@kickstock/constants';

// Ajouter :
import type { BootstrapData } from '@kickstock/types';
```

Dans le corps du composant, après les autres `useGameStore` :

```typescript
// Supprimer les deux lignes :
const isKO       = CALENDAR[dayIndex]?.isKO ?? false;
const isCapPhase = ['Groups', 'R32'].includes(CALENDAR[dayIndex]?.phase ?? '');

// Remplacer par :
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap  = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;
const currentDay = bootstrap?.days.find(d => d.day_index === dayIndex) ?? null;
const isKO       = currentDay?.is_ko ?? false;
const isCapPhase = ['Groups', 'R32'].includes(currentDay?.phase ?? '');
```

---

### 1.2 — `components/shared/NationDetailOverlay.tsx`

**Problème :**
```typescript
import { NATIONS, CALENDAR } from '@kickstock/constants';
// ...
const nation = NATIONS.find(n => n.id === nationId);
if (!nation) return null;  // ← null pour toute équipe non-WC2026 !
// ...
const day = CALENDAR[Number(diStr)];  // ← undefined hors WC2026
const opp = NATIONS.find(n => n.id === oppId);  // ← undefined hors WC2026
```

**Fix :**

```typescript
// Supprimer :
import { NATIONS, CALENDAR } from '@kickstock/constants';

// Ajouter :
import type { TeamMeta, BootstrapData } from '@kickstock/types';
```

Dans le corps du composant :

```typescript
// Ajouter ces deux sélecteurs de store :
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams     = useGameStore(s => (s as any)._teams)     as TeamMeta[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bootstrap = useGameStore(s => (s as any)._bootstrap) as BootstrapData | null;

// Remplacer :
const nation = NATIONS.find(n => n.id === nationId);
if (!nation) return null;
// Par :
const teamMeta = teams.find(t => t.id === nationId);
if (!teamMeta) return null;
// Créer un objet Nation compatible pour les sous-composants qui l'attendent encore :
const nation = { id: teamMeta.id, name: teamMeta.name, flag: teamMeta.flag, p: teamMeta.initialPrice, conf: teamMeta.confederation ?? '', str: teamMeta.strength, group: teamMeta.group };
```

Dans la construction de l'historique (`history` useMemo) :

```typescript
// Remplacer :
const day = CALENDAR[Number(diStr)];
// Par :
const day = bootstrap?.days.find(d => d.day_index === Number(diStr)) ?? null;

// Remplacer :
const opp = NATIONS.find(n => n.id === oppId);
// Par :
const opp = teams.find(t => t.id === oppId);
// (adapter les accès : opp.flag, opp.name, opp.p → opp.flag, opp.name, opp.initialPrice)
```

---

### 1.3 — `components/shared/Ticker.tsx`

**Problème :**
```typescript
import { NATIONS } from '@kickstock/constants';
// ...
return [...NATIONS].sort(...)  // ← toujours 48 équipes WC2026
```

Le Ticker affiche les 48 équipes WC2026 quelle que soit la compétition active.

**Fix :**

```typescript
// Supprimer :
import { NATIONS } from '@kickstock/constants';

// Ajouter :
import type { TeamMeta } from '@kickstock/types';
```

Dans le composant :

```typescript
// Ajouter :
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams = useGameStore(s => (s as any)._teams) as TeamMeta[];

// Remplacer :
const items = useMemo(() => {
  return [...NATIONS].sort((a, b) => {
    const heldA = (portfolio[a.id] ?? 0) > 0 ? 1 : 0;
    const heldB = (portfolio[b.id] ?? 0) > 0 ? 1 : 0;
    return heldB - heldA;
  });
}, [portfolio]);
// Par :
const items = useMemo(() => {
  return [...teams].sort((a, b) => {
    const heldA = (portfolio[a.id] ?? 0) > 0 ? 1 : 0;
    const heldB = (portfolio[b.id] ?? 0) > 0 ? 1 : 0;
    return heldB - heldA;
  });
}, [teams, portfolio]);
```

Dans le rendu, adapter les accès `n.p` (prix initial de NATIONS) → `t.initialPrice` (prix initial de TeamMeta) :

```typescript
// Remplacer :
const p   = prices[n.id] ?? n.p;
const pct = ((p - n.p) / n.p * 100).toFixed(1);
// Par :
const p   = prices[t.id] ?? t.initialPrice;
const pct = ((p - t.initialPrice) / t.initialPrice * 100).toFixed(1);
```

---

### 1.4 — `components/shared/MatchDetailOverlay.tsx`

**Problème :**
```typescript
import { NATIONS } from '@kickstock/constants';
const gN = (id: string) => NATIONS.find(n => n.id === id);
```

**Fix :**

```typescript
// Supprimer :
import { NATIONS } from '@kickstock/constants';

// Ajouter :
import type { TeamMeta } from '@kickstock/types';
```

Le composant reçoit probablement `result: StoredMatchResult` en prop. Ajouter `teams` en prop ou le lire depuis le store :

```typescript
// Ajouter dans le composant :
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams = useGameStore(s => (s as any)._teams) as TeamMeta[];
const gN = (id: string) => teams.find(t => t.id === id);
```

Adapter les accès : `n.flag` → `t.flag`, `n.name` → `t.name` (identiques sur `TeamMeta`).

---

### 1.5 — `components/mobile/PortfolioTab.tsx`

**Problème :**
```typescript
import { NATIONS } from '@kickstock/constants';
// ...
const nation = NATIONS.find(n => n.id === id);
// Utilisé pour : nation.flag, nation.name, avgCost fallback via nation?.p
```

**Fix :**

```typescript
// Supprimer :
import { NATIONS } from '@kickstock/constants';

// Ajouter :
import type { TeamMeta } from '@kickstock/types';
```

Dans le composant :

```typescript
// Ajouter :
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams = useGameStore(s => (s as any)._teams) as TeamMeta[];

// Remplacer :
const nation = NATIONS.find(n => n.id === id);
// Par :
const nation = teams.find(t => t.id === id);

// Remplacer les accès :
// nation?.p       → nation?.initialPrice
// nation?.flag    → nation?.flag       (identique)
// nation?.name    → nation?.name       (identique)
```

---

### 1.6 — `components/mobile/MatchAnimation.tsx`

**Problème :**
```typescript
import { NATIONS, SCORER_POOL } from '@kickstock/constants';
const gN = (id: string) => NATIONS.find(n => n.id === id);
```

`MatchAnimation` reçoit déjà `results: StoredMatchResult[]` en prop. Chaque `StoredMatchResult` contient `goals[]` avec le nom du joueur scoreur — il n'a pas besoin de `SCORER_POOL` à l'affichage (les noms sont générés au moment de la simulation, pas à l'affichage).

**Fix :**

```typescript
// Supprimer :
import { NATIONS, SCORER_POOL } from '@kickstock/constants';

// Ajouter :
import type { TeamMeta } from '@kickstock/types';
```

Le composant reçoit déjà `portfolio` et `prices` en props. Ajouter `teams` en prop :

```typescript
// Modifier l'interface Props pour ajouter :
interface Props {
  results:   StoredMatchResult[];
  portfolio: Record<string, number>;
  prices:    Record<string, number>;
  teams:     TeamMeta[];         // ← ajouter
  onDone:    () => void;
}

// Remplacer la fonction gN :
const gN = (id: string) => teams.find(t => t.id === id);
```

Dans `SimulateTab.tsx` (qui instancie `MatchAnimation`), passer `teams` en prop :

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const teams = useGameStore(s => (s as any)._teams) as TeamMeta[];
// ...
<MatchAnimation
  results={results}
  portfolio={portfolio}
  prices={prices}
  teams={teams}          // ← ajouter
  onDone={() => setView('done')}
/>
```

---

### 1.7 — Supprimer `components/mobile/PlayButton.tsx`

Ce fichier contient lui-même le commentaire `// Legacy component — replaced by SimulateTab.tsx // Kept for reference; not rendered in MobileShell.`

**Action :** Supprimer le fichier `apps/web/components/mobile/PlayButton.tsx`.

Vérifier qu'il n'est importé nulle part :
```bash
grep -r "PlayButton" apps/web --include="*.tsx" --include="*.ts" | grep -v "PlayButton.tsx"
```
Si aucun résultat, supprimer.

---

### 1.8 — Supprimer `app/api/market/route.ts`

Cette route est morte (Phase 1) — elle retourne les prix initiaux hardcodés depuis `NATIONS` et n'est plus appelée nulle part depuis que les prix viennent du bootstrap.

**Vérification préalable :**
```bash
grep -r "\/api\/market" apps/web --include="*.ts" --include="*.tsx" | grep -v route.ts
```
Si aucun résultat, supprimer le fichier `apps/web/app/api/market/route.ts`.

---

## STEP 2 — Interface Admin (US-16.1 → 16.8)

### Contexte

Toute la configuration des compétitions se fait aujourd'hui en SQL direct sur Supabase. Il n'existe pas d'interface admin. Ce step crée une section `/admin` protégée dans l'application.

### Structure du schéma existant (référence)

Tables concernées par l'admin :
- `competitions` — `id`, `name`, `league_id`, `season`, `start_date`, `end_date`, `is_active`
- `teams` — `id`, `name`, `flag_emoji`, `logo_url`, `confederation`
- `competition_teams` — `competition_id`, `team_id`, `group_code`, `strength`, `initial_price`, `current_price`
- `matches` — `competition_id`, `fixture_id` (API-Football), `nation_a`, `nation_b`, `scheduled_at`, `phase`, `day_index`, `venue`, `api_status`, `score_a`, `score_b`, `processed_at`
- `competition_days` — `competition_id`, `day_index`, `full_label`, `date_label`, `phase`, `is_ko`, `div_key`
- `competition_game_state` — `competition_id`, `current_day_index`, `current_phase`, `advancing`, `champion_id`, `eliminated`, pools…

### 2.1 — Protection de la section admin

Créer `apps/web/middleware.ts` — ajouter la protection de la route `/admin` (en plus du middleware existant) :

```typescript
// Dans la fonction middleware, avant le return final :
if (request.nextUrl.pathname.startsWith('/admin')) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  // Vérifier que l'utilisateur est admin (role dans les metadata Supabase)
  const isAdmin = user.user_metadata?.role === 'admin' || user.app_metadata?.role === 'admin';
  if (!isAdmin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
}
```

Pour marquer un utilisateur comme admin dans Supabase : depuis le dashboard Supabase → Authentication → Users → Edit user → `app_metadata: { "role": "admin" }`.

---

### 2.2 — Layout admin

Créer `apps/web/app/admin/layout.tsx` :

```typescript
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== 'admin') {
    redirect('/');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', color: '#fff', fontFamily: 'monospace' }}>
      <nav style={{ padding: '16px 24px', borderBottom: '1px solid #222', display: 'flex', gap: 24 }}>
        <strong style={{ color: '#FFDB00' }}>KickStock Admin</strong>
        <a href="/admin" style={{ color: '#fff' }}>Compétitions</a>
        <a href="/admin/competitions/new" style={{ color: '#fff' }}>+ Nouvelle</a>
        <a href="/" style={{ color: '#888' }}>← App</a>
      </nav>
      <main style={{ padding: 24 }}>
        {children}
      </main>
    </div>
  );
}
```

---

### 2.3 — Page d'accueil admin : liste des compétitions

Créer `apps/web/app/admin/page.tsx` :

```typescript
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export default async function AdminPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = supabase as any;

  const { data: competitions } = await adm
    .from('competitions')
    .select('id, name, season, start_date, end_date, is_active, league_id')
    .order('season', { ascending: false });

  // Pour chaque compétition active, récupérer l'état courant
  const { data: gameStates } = await adm
    .from('competition_game_state')
    .select('competition_id, current_day_index, current_phase, champion_id, advancing');

  const stateMap = Object.fromEntries(
    (gameStates ?? []).map((gs: { competition_id: number; current_day_index: number; current_phase: string; champion_id: string | null; advancing: boolean }) => [gs.competition_id, gs])
  );

  return (
    <div>
      <h1 style={{ color: '#FFDB00', marginBottom: 24 }}>Compétitions</h1>
      <Link href="/admin/competitions/new">
        <button style={{ marginBottom: 24, padding: '8px 16px', background: '#FFDB00', color: '#000', border: 'none', cursor: 'pointer' }}>
          + Nouvelle compétition
        </button>
      </Link>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px' }}>Nom</th>
            <th>Saison</th>
            <th>Statut</th>
            <th>Phase</th>
            <th>Day</th>
            <th>Champion</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {(competitions ?? []).map((c: { id: number; name: string; season: number; is_active: boolean; league_id: number }) => {
            const gs = stateMap[c.id];
            return (
              <tr key={c.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                <td style={{ padding: '10px 12px' }}>{c.name}</td>
                <td style={{ textAlign: 'center' }}>{c.season}</td>
                <td style={{ textAlign: 'center', color: c.is_active ? '#00FF87' : '#888' }}>
                  {c.is_active ? '● ACTIVE' : '○ INACTIVE'}
                </td>
                <td style={{ textAlign: 'center' }}>{gs?.current_phase ?? '—'}</td>
                <td style={{ textAlign: 'center' }}>{gs?.current_day_index ?? '—'}</td>
                <td style={{ textAlign: 'center' }}>{gs?.champion_id ?? '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  <Link href={`/admin/competitions/${c.id}`} style={{ color: '#FFDB00', marginRight: 12 }}>
                    Gérer
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

---

### 2.4 — Page de gestion d'une compétition

Créer `apps/web/app/admin/competitions/[id]/page.tsx`.

Cette page doit contenir **4 sections** :

**Section A — Métadonnées**
- Affiche : nom, saison, dates, league_id, is_active
- Bouton toggle "Activer / Désactiver" → `PATCH /api/admin/competitions/[id]`

**Section B — État de jeu**
- Affiche : `current_day_index`, `current_phase`, `advancing` (lock), `champion_id`, count des éliminations
- Bouton "Sync Fixtures" → `POST /api/cron/sync-fixtures` (déclenché manuellement avec `Authorization: Bearer {CRON_SECRET}`)
- Bouton "Simulate Day [n]" → `POST /api/admin/simulate-day` avec `{ competitionId, dayIndex }`

**Section C — Équipes**
- Table : `id`, `name`, `flag_emoji`, `group_code`, `strength`, `initial_price`, `current_price`
- Bouton "Importer depuis API-Football" → appelle `POST /api/admin/competitions/[id]/import-teams`

**Section D — Matchs du jour courant**
- Table des matchs avec `scheduled_at`, `phase`, `api_status`, `score_a`, `score_b`, `processed_at`

---

### 2.5 — API routes admin

**`POST /api/admin/competitions/[id]/toggle-active`**

```typescript
// apps/web/app/api/admin/competitions/[id]/toggle-active/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = admin as any;
  const { is_active } = await req.json() as { is_active: boolean };

  const { error } = await adm
    .from('competitions')
    .update({ is_active })
    .eq('id', parseInt(params.id, 10));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

**`POST /api/admin/competitions/[id]/import-teams`**

Appelle l'API API-Football pour récupérer les équipes d'une compétition et les insérer dans `teams` + `competition_teams` :

```typescript
// apps/web/app/api/admin/competitions/[id]/import-teams/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchTeamsForLeague } from '@/lib/football-api'; // à créer (voir ci-dessous)

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = admin as any;
  const competitionId = parseInt(params.id, 10);

  // Récupérer league_id + season de la compétition
  const { data: comp } = await adm
    .from('competitions')
    .select('league_id, season')
    .eq('id', competitionId)
    .single();

  if (!comp) return NextResponse.json({ error: 'Compétition introuvable' }, { status: 404 });

  const teams = await fetchTeamsForLeague(comp.league_id, comp.season);

  let imported = 0;
  for (const team of teams) {
    // Upsert dans la table teams
    await adm.from('teams').upsert({
      id:          team.iso2,   // code ISO à dériver du nom ou de l'API
      name:        team.name,
      flag_emoji:  team.flagEmoji ?? null,
      logo_url:    team.logoUrl  ?? null,
      confederation: team.confederation ?? null,
    }, { onConflict: 'id' });

    // Upsert dans competition_teams
    await adm.from('competition_teams').upsert({
      competition_id: competitionId,
      team_id:        team.iso2,
      group_code:     team.group ?? null,
      strength:       team.strength ?? 70,
      initial_price:  team.initialPrice ?? 50,
      current_price:  team.initialPrice ?? 50,
    }, { onConflict: 'competition_id,team_id' });
    imported++;
  }

  return NextResponse.json({ ok: true, imported });
}
```

**Fonction `fetchTeamsForLeague` dans `lib/football-api.ts`** (à ajouter) :

L'API API-Football endpoint : `GET /teams?league={league_id}&season={season}`
Réponse : tableau de `{ team: { id, name, logo }, venue: {...} }`

Note : l'API API-Football ne retourne pas de code ISO ni de groupe. Ces données doivent être saisies manuellement ou dérivées d'un mapping `team_id → iso2` existant dans `lib/team-mapping/team-iso2.ts`.

---

### 2.6 — Formulaire de création d'une compétition

Créer `apps/web/app/admin/competitions/new/page.tsx` — formulaire simple :

Champs :
- `name` (text) — ex. "FIFA World Cup 2026"
- `season` (number) — ex. 2026
- `league_id` (number) — ID API-Football, ex. 1 pour WC
- `start_date` (date)
- `end_date` (date)

À la soumission → `POST /api/admin/competitions` qui insère dans `competitions` et initialise `competition_game_state`.

**`POST /api/admin/competitions`** (nouvelle route) :

```typescript
// apps/web/app/api/admin/competitions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = admin as any;
  const body = await req.json() as { name: string; season: number; league_id: number; start_date: string; end_date: string };

  // Créer la compétition
  const { data: comp, error } = await adm
    .from('competitions')
    .insert({ ...body, is_active: false })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Initialiser l'état de jeu
  await adm.from('competition_game_state').insert({
    competition_id:    comp.id,
    current_day_index: 0,
    current_phase:     'Groups',
    advancing:         false,
    eliminated:        [],
    r32_pool: [], r16_pool: [], qf_pool: [],
    sf_pool: [], final_pool: [], third_pool: [],
  });

  return NextResponse.json({ ok: true, id: comp.id });
}
```

---

## STEP 3 — Vérification i18n (travail minimal restant)

### Contexte

L'internationalisation est **structurellement complète** :
- `middleware.ts` : détection automatique via `Accept-Language` ✅
- `packages/i18n/locales/fr.json` : traductions FR complètes ✅
- `packages/i18n/locales/en.json` : traductions EN complètes ✅
- `apps/web/i18n/request.ts` : résolution locale depuis cookie `NEXT_LOCALE` ✅
- `AuthWidget.tsx` : boutons FR/EN qui posent le cookie et appellent `router.refresh()` ✅

### 3.1 — Clé `market.hint` manquante

Dans `apps/web/components/mobile/MarketTab.tsx`, la clé `t('hint')` est utilisée mais n'existe pas dans les fichiers de traduction :

```typescript
// MarketTab.tsx
{isFirstRun && (
  <div className={styles.hint}>{t('hint')}</div>
)}
```

**Fix** — Ajouter dans `packages/i18n/locales/fr.json` sous la clé `"market"` :

```json
"hint": "Commence par acheter des actions sur les nations que tu penses les plus fortes !"
```

Et dans `packages/i18n/locales/en.json` sous la clé `"market"` :

```json
"hint": "Start by buying shares in the nations you think are strongest!"
```

### 3.2 — Vérifier que `router.refresh()` est suffisant

Le `setLocale` dans `AuthWidget.tsx` utilise `router.refresh()` (Next.js App Router). Cela suffit pour rafraîchir les Server Components qui liront le nouveau cookie `NEXT_LOCALE`. **Tester manuellement** :
1. Ouvrir l'app en FR → aller dans le menu avatar → cliquer "English"
2. Vérifier que toute l'interface bascule en anglais
3. Recharger la page → vérifier que l'anglais persiste

Si le refresh ne suffit pas (les Client Components gardent les anciennes traductions), remplacer `router.refresh()` par `window.location.reload()` dans `AuthWidget.tsx` :

```typescript
// Dans AuthWidget.tsx, fonction setLocale :
function setLocale(locale: string) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax`;
  setOpen(false);
  window.location.reload();   // ← si router.refresh() ne suffit pas
}
```

### 3.3 — Clé `market.hint` dans `MarketTab.tsx`

Vérifier si d'autres clés `t(...)` sont utilisées dans les composants mais absentes des fichiers de traduction. Lancer :

```bash
# Extraire toutes les clés utilisées dans le code
grep -r "t('" apps/web/components --include="*.tsx" | grep -oP "t\('\K[^']+'" | sort -u

# Comparer avec les clés disponibles dans fr.json
cat packages/i18n/locales/fr.json | python3 -c "import json,sys; d=json.load(sys.stdin); [print(k) for k in d]"
```

---

## STEP 4 — Tests d'intégration

### Contexte

Les 10 corrections appliquées (FIXES_REQUIRED.md) touchent aux deux modes de jeu et à leur isolation. Il n'existe pas de tests d'intégration pour ces flux. Ce step ajoute les tests minimaux pour éviter les régressions.

Le projet utilise **Vitest** (configuré dans `packages/game-engine/vitest.config.ts`). Les tests existants (`engine.test.ts`) couvrent uniquement les fonctions pures.

### 4.1 — Tests des fonctions extraites dans `lib/bootstrap.ts`

Créer `apps/web/lib/bootstrap.test.ts` :

```typescript
import { describe, it, expect } from 'vitest';
import { deriveDynamicKey } from './bootstrap';
import type { BootstrapData } from '@kickstock/types';

// Bootstrap minimal WC2026
function makeBootstrap(days: Array<{ day_index: number; phase: string; is_ko: boolean }>): BootstrapData {
  return {
    competition: { id: 1, name: 'Test', start_date: '2026-01-01', league_id: 1, season: 2026 },
    teams: [],
    days: days.map(d => ({ ...d, full_label: `Day ${d.day_index}`, date_label: 'Jan 1', div_key: null })),
    group_fixtures: [],
    generated_at: new Date().toISOString(),
  };
}

describe('deriveDynamicKey', () => {
  it('retourne les clés R32 dans l ordre', () => {
    const bootstrap = makeBootstrap([
      { day_index: 17, phase: 'R32', is_ko: true },
      { day_index: 18, phase: 'R32', is_ko: true },
      { day_index: 19, phase: 'R32', is_ko: true },
      { day_index: 20, phase: 'R32', is_ko: true },
      { day_index: 21, phase: 'R32', is_ko: true },
      { day_index: 22, phase: 'R32', is_ko: true },
    ]);
    expect(deriveDynamicKey('R32', 17, bootstrap)).toBe('r32_28');
    expect(deriveDynamicKey('R32', 18, bootstrap)).toBe('r32_29');
    expect(deriveDynamicKey('R32', 22, bootstrap)).toBe('r32_3');
  });

  it('retourne final pour la phase Final', () => {
    const bootstrap = makeBootstrap([{ day_index: 35, phase: 'Final', is_ko: true }]);
    expect(deriveDynamicKey('Final', 35, bootstrap)).toBe('final');
  });

  it('retourne les clés SF correctement', () => {
    const bootstrap = makeBootstrap([
      { day_index: 30, phase: 'SF', is_ko: true },
      { day_index: 31, phase: 'SF', is_ko: true },
    ]);
    expect(deriveDynamicKey('SF', 30, bootstrap)).toBe('sf_1');
    expect(deriveDynamicKey('SF', 31, bootstrap)).toBe('sf_2');
  });
});
```

### 4.2 — Test isolation clé persist offline

Créer `apps/web/stores/localGameStore.isolation.test.ts` :

```typescript
/**
 * Vérifie que deux compétitions différentes ont des clés persist distinctes.
 * Simule un switch de compétition en modifiant localStorage.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem:    (k: string) => store[k] ?? null,
  setItem:    (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};
Object.defineProperty(global, 'localStorage', { value: mockLocalStorage });

describe('Isolation clé persist par compétition', () => {
  beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); });

  it('compétition 1 et 2 ont des clés distinctes', () => {
    // Compétition 1
    store['kickstock:competition'] = '1';
    const key1 = `ks-game-state-1`;
    store[key1] = JSON.stringify({ cash: 5000 });

    // Switch vers compétition 2
    store['kickstock:competition'] = '2';
    const key2 = `ks-game-state-2`;

    expect(store[key1]).toBeDefined();
    expect(store[key2]).toBeUndefined(); // compétition 2 commence vide
    expect(key1).not.toBe(key2);
  });
});
```

### 4.3 — Test reset online via l'API

Ajouter un test dans `apps/web/app/api/game/reset/route.test.ts` :

```typescript
/**
 * Smoke test : POST /api/game/reset retourne 400 si competitionId manquant.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

describe('POST /api/game/reset', () => {
  it('retourne 400 si competitionId manquant', async () => {
    const req = new NextRequest('http://localhost/api/game/reset', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

---

## Récapitulatif et ordre recommandé

| Ordre | Step | Effort | Impact |
|-------|------|--------|--------|
| 1 | **STEP 1.7** — Supprimer `PlayButton.tsx` (legacy) | 5 min | 🟢 Nettoyage sans risque |
| 2 | **STEP 1.8** — Supprimer `GET /api/market` (route morte) | 5 min | 🟢 Nettoyage sans risque |
| 3 | **STEP 3.1** — Ajouter clé `market.hint` dans les deux fichiers JSON | 5 min | 🟢 Fix traduction |
| 4 | **STEP 3.2** — Tester le switch de langue manuellement | 15 min | 🟢 Test manuel |
| 5 | **STEP 1.1** — `TradeModal` : `isKO`/`isCapPhase` depuis bootstrap | 30 min | 🟠 Multi-compétition correct |
| 6 | **STEP 1.3** — `Ticker` depuis `_teams` | 20 min | 🟠 Multi-compétition correct |
| 7 | **STEP 1.5** — `PortfolioTab` depuis `_teams` | 20 min | 🟠 Multi-compétition correct |
| 8 | **STEP 1.4** — `MatchDetailOverlay` depuis `_teams` | 20 min | 🟠 Multi-compétition correct |
| 9 | **STEP 1.2** — `NationDetailOverlay` depuis `_teams`/bootstrap | 45 min | 🟠 Le plus complexe du legacy |
| 10 | **STEP 1.6** — `MatchAnimation` depuis `_teams` | 30 min | 🟠 Multi-compétition correct |
| 11 | **STEP 4** — Tests Vitest | 2h | 🟡 Prévention régression |
| 12 | **STEP 2** — Interface Admin | 1-2 jours | 🔴 Nouvelle fonctionnalité majeure |

---

## Points à ne pas modifier

- **`packages/i18n/locales/fr.json`** et **`en.json`** : ne pas renommer les clés existantes — les composants les référencent par leur nom exact.
- **`middleware.ts`** : ne pas toucher à la logique de session Supabase (lignes `supabase.auth.getUser()`) — la supprimer casserait l'auth.
- **`lib/bootstrap.ts`** : `deriveDynamicKey` et `buildMatchesForCurrentDayFromBootstrap` viennent d'être centralisées ici depuis les stores — ne pas les redupliquer.
- **`@kickstock/constants`** : ne pas supprimer `NATIONS` et `CALENDAR` du package (des composants les importent encore — voir STEP 1). Les supprimer cassera la compilation avant d'avoir fini les migrations.
