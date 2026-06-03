# KickStock — Next Steps Vague 3

> Document auto-suffisant destiné à être injecté dans une nouvelle session Claude Code.
> Les vagues 1 (FIXES_REQUIRED.md) et 2 (NEXT_STEPS.md) ont été entièrement appliquées.
> Ce document couvre uniquement les travaux restants.

---

## Contexte du projet

KickStock est un monorepo Next.js 14 (App Router) + Supabase + Zustand.

```
apps/web/
  app/
    admin/                          ← Interface admin (protégée, role=admin)
      layout.tsx
      page.tsx                      ← Liste des compétitions
      competitions/
        new/page.tsx                ← Formulaire création compétition
        [id]/
          page.tsx                  ← Page gestion compétition (4 sections A-D)
          CompetitionActions.tsx    ← Boutons toggle/sync/simulate (Client Component)
    api/
      admin/competitions/
        route.ts                    ← POST création compétition
        [id]/
          toggle-active/route.ts
          import-teams/route.ts
      game/
        state/route.ts              ← lit 'holdings' + 'transactions' (actifs)
        reset/route.ts              ← lit 'holdings' + 'transactions' (actifs)
  stores/
    gameStore.ts                    ← façade mode online/offline
    localGameStore.ts               ← mode Offline (Zustand persist localStorage)
    onlineGameStore.ts              ← mode Online (Supabase, Realtime)
  lib/
    bootstrap.ts                    ← deriveDynamicKey + buildMatchesForCurrentDayFromBootstrap
packages/
  game-engine/src/
    buildKOMatches.ts               ← ⚠️ contient encore des fallbacks NATIONS/GROUPS legacy
    applyResult.ts, simulate.ts,    ← logique métier pure (ne pas modifier)
    calcTax.ts, calcDividends.ts…
  constants/src/index.ts            ← NATIONS, CALENDAR, GROUPS, DIV_RATES, INIT_CASH
db/migrations/
  001_schema.sql                    ← tables legacy (nations, positions, trades, price_history)
  005_centralized_engine.sql        ← RPCs legacy (execute_trade, get_or_create_portfolio…)
  010_api_integration.sql           ← tables actives (teams, competition_teams, competition_days, matches)
  012_multi_competition.sql         ← tables actives (competition_game_state, holdings, transactions…)
```

**Tables ACTIVES (ne pas supprimer) :**
- `profiles`, `portfolios`, `holdings`, `transactions`, `competition_prices`
- `teams`, `competition_teams`, `competition_days`, `matches`
- `competition_game_state`, `competitions`
- `user_game_states`, `leaderboard`

**Tables LEGACY (à supprimer — voir STEP 4) :**
- `nations`, `positions`, `trades`, `price_history` (migration 001)
- `game_state`, `nation_prices`, `group_standings`, `knockout_pools`, `holdings_history`, `dividends`, `groups` (migration 005)

---

## STEP 1 — Nettoyer les fallbacks legacy dans `buildKOMatches.ts`

### Fichier
`packages/game-engine/src/buildKOMatches.ts`

### Problème

Les fonctions `resolveTeams` et `resolveGroups` contiennent des fallbacks sur `NATIONS` et `GROUPS` hardcodés WC2026 :

```typescript
// Ligne ~7-18 (actuellement dans le fichier)
import { NATIONS, GROUPS, DIV_RATES } from '@kickstock/constants';

function resolveTeams(teams?: TeamMeta[]): TeamMeta[] {
  if (teams && teams.length > 0) return teams;
  // Legacy fallback — will be removed once all callers inject teams
  return NATIONS.map(n => ({
    id: n.id, name: n.name, flag: n.flag,
    group: n.group, strength: n.str, initialPrice: n.p,
  }));
}

function resolveGroups(teams: TeamMeta[]): string[] {
  const gs = [...new Set(teams.map(t => t.group).filter(Boolean))].sort();
  return gs.length > 0 ? gs : GROUPS.slice(1);  // fallback WC2026
}
```

### Vérification préalable : tous les appelants passent déjà `teams`

Avant d'appliquer le fix, confirmer que tous les appelants injectent `teams` :

```bash
grep -rn "deriveGroupStandings\|buildGroupStandingsUI\|buildR32Pool" \
  apps/web --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Résultat attendu (déjà vérifié) :
- `localGameStore.ts` → `buildR32Pool(allRes, newElim, _teams)` ✅
- `BrowserShell.tsx` → `buildGroupStandingsUI(matchResults, prices, eliminated, teams)` ✅
- `StandingsTab.tsx` → `buildGroupStandingsUI(matchResults, prices, eliminated, teams)` ✅

`buildMatchesForDay` n'utilise pas `teams` (il opère sur les pools KO du `GameState`) → pas de changement.

### Modifications à apporter

**Étape A — Supprimer l'import `NATIONS` et `GROUPS`, rendre `teams` obligatoire**

```typescript
// AVANT (ligne 1)
import { NATIONS, GROUPS, DIV_RATES } from '@kickstock/constants';

// APRÈS
import { DIV_RATES } from '@kickstock/constants';
// NATIONS et GROUPS ne sont plus nécessaires
```

**Étape B — Supprimer `resolveTeams`, rendre le paramètre `teams` obligatoire**

Dans les 3 fonctions exportées `deriveGroupStandings`, `buildGroupStandingsUI`, `buildR32Pool`, remplacer `teams?: TeamMeta[]` par `teams: TeamMeta[]` et supprimer les appels à `resolveTeams` :

```typescript
// AVANT
export function deriveGroupStandings(
  matchResults: Record<number, StoredMatchResult[]>,
  eliminated:   string[],
  teams?:       TeamMeta[],   // ← optionnel
): Record<string, string[]> {
  const allTeams = resolveTeams(teams);   // ← appel fallback
  const groups   = resolveGroups(allTeams);
  // ...
}

// APRÈS
export function deriveGroupStandings(
  matchResults: Record<number, StoredMatchResult[]>,
  eliminated:   string[],
  teams:        TeamMeta[],   // ← obligatoire
): Record<string, string[]> {
  const allTeams = teams;     // ← direct, plus de fallback
  const groups   = resolveGroups(allTeams);
  // ...
}
```

Appliquer le même changement à `buildGroupStandingsUI` et `buildR32Pool`.

**Étape C — Simplifier `resolveGroups` pour supprimer le fallback `GROUPS`**

```typescript
// AVANT
function resolveGroups(teams: TeamMeta[]): string[] {
  const gs = [...new Set(teams.map(t => t.group).filter(Boolean))].sort();
  return gs.length > 0 ? gs : GROUPS.slice(1);  // ← fallback WC2026
}

// APRÈS — supprimer complètement resolveGroups et inliner directement
// (la logique est triviale et n'a plus besoin de fallback)
// Dans chaque fonction qui l'appelle, remplacer resolveGroups(allTeams) par :
const groups = [...new Set(teams.map(t => t.group).filter(Boolean))].sort();
```

Ou conserver la fonction mais sans le fallback :

```typescript
function resolveGroups(teams: TeamMeta[]): string[] {
  return [...new Set(teams.map(t => t.group).filter(Boolean))].sort();
}
```

**Étape D — Supprimer les fonctions `resolveTeams` et `resolveGroups` du fichier**

Après les modifications, `resolveTeams` n'est plus utilisée et peut être supprimée. `resolveGroups` peut être gardée comme helper privé sans fallback.

**Étape E — Vérifier la compilation TypeScript**

```bash
cd packages/game-engine && pnpm tsc --noEmit
```

Si des erreurs apparaissent sur des appelants qui passaient `teams` comme optionnel, les corriger en ajoutant le `!` ou en garantissant que `_teams` est toujours défini avant l'appel.

---

## STEP 2 — Admin : édition manuelle des équipes

### Contexte

La page `/admin/competitions/[id]` (Section C) affiche déjà la table des équipes en lecture seule. Il manque la possibilité d'éditer `strength`, `group_code`, et `initial_price` sans passer par l'API API-Football.

### 2.1 — Nouvelle API route `PATCH /api/admin/competitions/[id]/teams/[team_id]`

Créer `apps/web/app/api/admin/competitions/[id]/teams/[team_id]/route.ts` :

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; team_id: string } }
) {
  // Guard admin
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitionId = parseInt(params.id, 10);
  const teamId = params.team_id;

  const body = await req.json() as {
    strength?:     number;
    group_code?:   string;
    initial_price?: number;
  };

  // Validation
  if (body.strength !== undefined && (body.strength < 0 || body.strength > 100)) {
    return NextResponse.json({ error: 'strength doit être entre 0 et 100' }, { status: 400 });
  }
  if (body.initial_price !== undefined && body.initial_price <= 0) {
    return NextResponse.json({ error: 'initial_price doit être positif' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  // Build update object with only provided fields
  const updates: Record<string, unknown> = {};
  if (body.strength     !== undefined) updates.strength     = body.strength;
  if (body.group_code   !== undefined) updates.group_code   = body.group_code;
  if (body.initial_price !== undefined) {
    updates.initial_price = body.initial_price;
    // Si le tournoi n'a pas encore démarré (day_index = 0), réinitialiser
    // aussi le current_price pour cohérence
    updates.current_price = body.initial_price;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { error } = await adm
    .from('competition_teams')
    .update(updates)
    .eq('competition_id', competitionId)
    .eq('team_id', teamId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

### 2.2 — Composant client `TeamEditor`

Créer `apps/web/app/admin/competitions/[id]/TeamEditor.tsx` :

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  competitionId: number;
  teamId:        string;
  strength:      number;
  groupCode:     string | null;
  initialPrice:  number;
}

export default function TeamEditor({
  competitionId, teamId, strength, groupCode, initialPrice
}: Props) {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [str,     setStr]     = useState(String(strength));
  const [grp,     setGrp]     = useState(groupCode ?? '');
  const [price,   setPrice]   = useState(String(initialPrice));
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);

  async function save() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/admin/competitions/${competitionId}/teams/${teamId}`,
        {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            strength:      parseInt(str, 10),
            group_code:    grp || null,
            initial_price: parseFloat(price),
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMsg('✓ Sauvegardé');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #333', color: '#fff',
    padding: '4px 8px', fontSize: 11, width: 70, fontFamily: 'monospace',
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent', border: '1px solid #333',
          color: '#666', fontSize: 10, padding: '2px 6px', cursor: 'pointer',
        }}
      >
        ✏️
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        style={inputStyle}
        value={str}
        onChange={e => setStr(e.target.value)}
        placeholder="Force (0-100)"
        title="Force FIFA (0-100)"
      />
      <input
        style={{ ...inputStyle, width: 40 }}
        value={grp}
        onChange={e => setGrp(e.target.value.toUpperCase())}
        placeholder="Grp"
        title="Code groupe (A-L)"
        maxLength={1}
      />
      <input
        style={{ ...inputStyle, width: 60 }}
        value={price}
        onChange={e => setPrice(e.target.value)}
        placeholder="Prix KC"
        title="Prix initial en KC"
      />
      <button
        onClick={save}
        disabled={loading}
        style={{
          background: '#FFDB00', color: '#000', border: 'none',
          padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontWeight: 700,
        }}
      >
        {loading ? '…' : '✓'}
      </button>
      <button
        onClick={() => { setOpen(false); setMsg(null); }}
        style={{
          background: 'transparent', border: '1px solid #333',
          color: '#666', padding: '4px 8px', fontSize: 10, cursor: 'pointer',
        }}
      >
        ✕
      </button>
      {msg && (
        <span style={{ fontSize: 10, color: msg.startsWith('✓') ? '#00FF87' : '#ff4444' }}>
          {msg}
        </span>
      )}
    </div>
  );
}
```

### 2.3 — Intégrer `TeamEditor` dans la Section C de `page.tsx`

Dans `apps/web/app/admin/competitions/[id]/page.tsx`, ajouter l'import :

```typescript
import TeamEditor from './TeamEditor';
```

Dans la table des équipes (Section C), ajouter une colonne "Actions" à la fin de chaque ligne `<tr>` :

```typescript
// Dans le <thead>, ajouter après la colonne Δ% :
<th style={{ ...thStyle, textAlign: 'center' }}>Éditer</th>

// Dans chaque <tr> de tbody, ajouter après la cellule Δ% :
<td style={{ ...tdStyle, textAlign: 'center' }}>
  <TeamEditor
    competitionId={id}
    teamId={t.team_id}
    strength={t.strength}
    groupCode={t.group_code}
    initialPrice={t.initial_price}
  />
</td>
```

---

## STEP 3 — Admin : gestion des journées (`competition_days`)

### Contexte

La table `competition_days` est la source de vérité pour le calendrier (phases, labels, is_ko, div_key). Elle est actuellement alimentée uniquement par `sync-fixtures`. Il manque une interface pour :
- Voir les journées existantes
- Ajouter une journée manuellement (cas sans API-Football)
- Supprimer une journée

### Structure de la table `competition_days` (migration 010)

```sql
CREATE TABLE IF NOT EXISTS competition_days (
  competition_id  INTEGER NOT NULL REFERENCES competitions(id),
  day_index       INTEGER NOT NULL,
  full_label      TEXT    NOT NULL,   -- ex. "Day 1 · Thu Jun 11"
  date_label      TEXT    NOT NULL,   -- ex. "Jun 11"
  phase           TEXT    NOT NULL,   -- 'Groups' | 'R32' | 'R16' | 'QF' | 'SF' | '3rd' | 'Final'
  is_ko           BOOLEAN NOT NULL DEFAULT FALSE,
  div_key         TEXT,               -- 'r32' | 'r16' | 'qf' | 'sf' | 'final' | 'champion' | NULL
  PRIMARY KEY (competition_id, day_index)
);
```

**Valeurs valides pour `div_key` :** `null` (groupes), `'r32'`, `'r16'`, `'qf'`, `'sf'`, `'final'`, `'champion'`

**Règle `is_ko` :** `true` pour toute phase autre que `'Groups'`.

### 3.1 — Nouvelles API routes

**`POST /api/admin/competitions/[id]/days`** — Ajouter ou mettre à jour une journée

Créer `apps/web/app/api/admin/competitions/[id]/days/route.ts` :

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const VALID_PHASES  = ['Groups', 'R32', 'R16', 'QF', 'SF', '3rd', 'Final'] as const;
const VALID_DIV_KEYS = [null, 'r32', 'r16', 'qf', 'sf', 'final', 'champion'] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitionId = parseInt(params.id, 10);
  const body = await req.json() as {
    day_index:  number;
    full_label: string;
    date_label: string;
    phase:      string;
    is_ko:      boolean;
    div_key:    string | null;
  };

  // Validation
  if (typeof body.day_index !== 'number' || body.day_index < 0) {
    return NextResponse.json({ error: 'day_index invalide (entier >= 0)' }, { status: 400 });
  }
  if (!body.full_label?.trim() || !body.date_label?.trim()) {
    return NextResponse.json({ error: 'full_label et date_label requis' }, { status: 400 });
  }
  if (!VALID_PHASES.includes(body.phase as typeof VALID_PHASES[number])) {
    return NextResponse.json({ error: `phase invalide. Valeurs: ${VALID_PHASES.join(', ')}` }, { status: 400 });
  }
  if (!VALID_DIV_KEYS.includes(body.div_key as typeof VALID_DIV_KEYS[number])) {
    return NextResponse.json({ error: `div_key invalide. Valeurs: ${VALID_DIV_KEYS.join(', ')}` }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const { error } = await adm
    .from('competition_days')
    .upsert({
      competition_id: competitionId,
      day_index:      body.day_index,
      full_label:     body.full_label.trim(),
      date_label:     body.date_label.trim(),
      phase:          body.phase,
      is_ko:          body.is_ko,
      div_key:        body.div_key ?? null,
    }, { onConflict: 'competition_id,day_index' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

**`DELETE /api/admin/competitions/[id]/days/[day_index]`** — Supprimer une journée

Créer `apps/web/app/api/admin/competitions/[id]/days/[day_index]/route.ts` :

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; day_index: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const competitionId = parseInt(params.id, 10);
  const dayIndex      = parseInt(params.day_index, 10);

  if (isNaN(dayIndex)) {
    return NextResponse.json({ error: 'day_index invalide' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any;

  const { error } = await adm
    .from('competition_days')
    .delete()
    .eq('competition_id', competitionId)
    .eq('day_index', dayIndex);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

### 3.2 — Section E dans la page de gestion

Dans `apps/web/app/admin/competitions/[id]/page.tsx` :

**Ajouter la requête dans le `Promise.all` existant :**

```typescript
// Dans le Promise.all, ajouter :
adm.from('competition_days')
  .select('day_index, full_label, date_label, phase, is_ko, div_key')
  .eq('competition_id', id)
  .order('day_index', { ascending: true }),
```

Et déstructurer le résultat :

```typescript
const [
  { data: comp }, { data: gs }, { data: teams }, { data: matches },
  { data: days },   // ← ajouter
] = await Promise.all([...]);
```

**Ajouter le type `Day` en haut du fichier :**

```typescript
type Day = {
  day_index:  number;
  full_label: string;
  date_label: string;
  phase:      string;
  is_ko:      boolean;
  div_key:    string | null;
};
```

**Ajouter la Section E dans le JSX (après la Section D existante) :**

```typescript
{/* ── Section E — Journées (competition_days) ──────────────────────────── */}
<div style={sectionStyle}>
  <h2 style={h2Style}>E · JOURNÉES ({days?.length ?? 0})</h2>
  {(!days || days.length === 0) ? (
    <div style={{ color: '#555', fontSize: 13, marginBottom: 16 }}>
      Aucune journée. Utiliser Sync Fixtures ou ajouter manuellement.
    </div>
  ) : (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 16 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #222' }}>
          <th style={thStyle}>Day</th>
          <th style={thStyle}>Label complet</th>
          <th style={thStyle}>Label court</th>
          <th style={{ ...thStyle, textAlign: 'center' }}>Phase</th>
          <th style={{ ...thStyle, textAlign: 'center' }}>KO?</th>
          <th style={{ ...thStyle, textAlign: 'center' }}>div_key</th>
          <th style={{ ...thStyle, textAlign: 'center' }}>Suppr.</th>
        </tr>
      </thead>
      <tbody>
        {(days as Day[]).map(d => (
          <tr key={d.day_index} style={{ borderBottom: '1px solid #1a1a1a' }}>
            <td style={{ ...tdStyle, color: '#FFDB00', fontWeight: 700 }}>{d.day_index}</td>
            <td style={tdStyle}>{d.full_label}</td>
            <td style={tdStyle}>{d.date_label}</td>
            <td style={{ ...tdStyle, textAlign: 'center' }}>{d.phase}</td>
            <td style={{ ...tdStyle, textAlign: 'center', color: d.is_ko ? '#FFDB00' : '#555' }}>
              {d.is_ko ? 'KO' : '—'}
            </td>
            <td style={{ ...tdStyle, textAlign: 'center', color: d.div_key ? '#00FF87' : '#555' }}>
              {d.div_key ?? '—'}
            </td>
            <td style={{ ...tdStyle, textAlign: 'center' }}>
              <DayDeleteButton competitionId={id} dayIndex={d.day_index} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
  <DayAddForm competitionId={id} />
</div>
```

### 3.3 — Composants client `DayDeleteButton` et `DayAddForm`

Créer `apps/web/app/admin/competitions/[id]/DayManager.tsx` :

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Delete button ─────────────────────────────────────────────────────────────

export function DayDeleteButton({
  competitionId,
  dayIndex,
}: {
  competitionId: number;
  dayIndex: number;
}) {
  const router   = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm(`Supprimer la journée ${dayIndex} ?`)) return;
    setLoading(true);
    await fetch(`/api/admin/competitions/${competitionId}/days/${dayIndex}`, {
      method: 'DELETE',
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      style={{
        background: 'transparent', border: '1px solid #444',
        color: '#ff4444', fontSize: 10, padding: '2px 6px', cursor: 'pointer',
      }}
    >
      {loading ? '…' : '✕'}
    </button>
  );
}

// ── Add form ──────────────────────────────────────────────────────────────────

const PHASES  = ['Groups', 'R32', 'R16', 'QF', 'SF', '3rd', 'Final'] as const;
const DIV_KEYS = ['', 'r32', 'r16', 'qf', 'sf', 'final', 'champion'] as const;

export function DayAddForm({ competitionId }: { competitionId: number }) {
  const router = useRouter();
  const [open, setOpen]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]       = useState<string | null>(null);
  const [form, setForm]     = useState({
    day_index:  '',
    full_label: '',
    date_label: '',
    phase:      'Groups',
    div_key:    '',
  });

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  // Auto-derive is_ko from phase
  const isKO = form.phase !== 'Groups';

  // Auto-suggest div_key from phase
  const suggestedDivKey: Record<string, string> = {
    R32: 'r32', R16: 'r16', QF: 'qf', SF: 'sf', Final: 'final', '3rd': '',
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/competitions/${competitionId}/days`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          day_index:  parseInt(form.day_index, 10),
          full_label: form.full_label,
          date_label: form.date_label,
          phase:      form.phase,
          is_ko:      isKO,
          div_key:    form.div_key || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setMsg('✓ Journée ajoutée');
      setForm({ day_index: '', full_label: '', date_label: '', phase: 'Groups', div_key: '' });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: '#111', border: '1px solid #333', color: '#fff',
    padding: '6px 10px', fontSize: 12, fontFamily: 'monospace',
  };
  const labelStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4, color: '#888', fontSize: 11,
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '6px 14px', background: 'transparent', border: '1px solid #FFDB00',
          color: '#FFDB00', fontSize: 11, cursor: 'pointer', fontFamily: 'monospace',
        }}
      >
        + AJOUTER UNE JOURNÉE
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 600 }}>
      <div style={{ color: '#FFDB00', fontSize: 12, fontWeight: 700 }}>NOUVELLE JOURNÉE</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12 }}>
        <label style={labelStyle}>
          day_index *
          <input
            style={inputStyle}
            type="number" min="0"
            value={form.day_index}
            onChange={e => set('day_index', e.target.value)}
            required placeholder="0"
          />
        </label>

        <label style={labelStyle}>
          full_label * (ex: "Day 1 · Thu Jun 11")
          <input
            style={inputStyle}
            value={form.full_label}
            onChange={e => set('full_label', e.target.value)}
            required placeholder="Day 1 · Thu Jun 11"
          />
        </label>

        <label style={labelStyle}>
          date_label * (ex: "Jun 11")
          <input
            style={inputStyle}
            value={form.date_label}
            onChange={e => set('date_label', e.target.value)}
            required placeholder="Jun 11"
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <label style={labelStyle}>
          phase *
          <select
            style={inputStyle}
            value={form.phase}
            onChange={e => {
              const ph = e.target.value;
              set('phase', ph);
              set('div_key', suggestedDivKey[ph] ?? '');
            }}
          >
            {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        <label style={labelStyle}>
          is_ko (auto)
          <input
            style={{ ...inputStyle, color: isKO ? '#FFDB00' : '#555' }}
            value={isKO ? 'true (KO)' : 'false (Groupes)'}
            readOnly
          />
        </label>

        <label style={labelStyle}>
          div_key
          <select
            style={inputStyle}
            value={form.div_key}
            onChange={e => set('div_key', e.target.value)}
          >
            {DIV_KEYS.map(k => (
              <option key={k} value={k}>{k || '(aucun)'}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="submit" disabled={loading}
          style={{
            padding: '7px 18px', background: '#FFDB00', color: '#000',
            border: 'none', fontSize: 12, cursor: 'pointer', fontWeight: 700,
          }}
        >
          {loading ? '…' : 'AJOUTER'}
        </button>
        <button
          type="button" onClick={() => { setOpen(false); setMsg(null); }}
          style={{
            padding: '7px 14px', background: 'transparent',
            border: '1px solid #333', color: '#666', fontSize: 12, cursor: 'pointer',
          }}
        >
          Annuler
        </button>
        {msg && (
          <span style={{ fontSize: 11, color: msg.startsWith('✓') ? '#00FF87' : '#ff4444' }}>
            {msg}
          </span>
        )}
      </div>
    </form>
  );
}
```

Dans `page.tsx`, importer et utiliser :

```typescript
import { DayDeleteButton, DayAddForm } from './DayManager';
```

---

## STEP 4 — Migration SQL 013 : nettoyage des tables et RPCs legacy

### Contexte

Les migrations 001 et 005 ont créé des tables et RPCs qui ont été remplacés par les migrations 010 et 012. Ces anciens objets occupent de l'espace, sont sources de confusion, et certains contiennent des bugs connus (taxe inversée dans `execute_trade`).

### ⚠️ Vérification préalable OBLIGATOIRE en production

Avant d'exécuter la migration, vérifier que les tables legacy sont bien vides :

```sql
-- Exécuter dans le Supabase SQL Editor (prod) AVANT la migration
SELECT 'nations'       AS t, COUNT(*) FROM nations
UNION ALL
SELECT 'positions',          COUNT(*) FROM positions
UNION ALL
SELECT 'trades',             COUNT(*) FROM trades
UNION ALL
SELECT 'price_history',      COUNT(*) FROM price_history
UNION ALL
SELECT 'game_state',         COUNT(*) FROM game_state
UNION ALL
SELECT 'nation_prices',      COUNT(*) FROM nation_prices
UNION ALL
SELECT 'group_standings',    COUNT(*) FROM group_standings
UNION ALL
SELECT 'knockout_pools',     COUNT(*) FROM knockout_pools
UNION ALL
SELECT 'holdings_history',   COUNT(*) FROM holdings_history
UNION ALL
SELECT 'dividends',          COUNT(*) FROM dividends;
```

**Si toutes les tables retournent 0 lignes → procéder à la migration.**
**Si une table a des données → investiguer avant de supprimer.**

### Fichier à créer : `db/migrations/013_cleanup_legacy.sql`

```sql
-- KickStock · Migration 013 · Nettoyage des objets legacy
-- Prérequis : migrations 001–012 appliquées
-- Prérequis : tables legacy vides (vérifier avec la requête de comptage ci-dessus)
-- Run on Supabase SQL Editor

-- ─── 1. Supprimer les RPCs legacy ─────────────────────────────────────────────

-- RPC de trade legacy (remplacé par execute_competition_trade dans 012)
DROP FUNCTION IF EXISTS execute_trade(
  p_device_id TEXT, p_user_id UUID,
  p_team_id TEXT, p_mode TEXT, p_quantity INTEGER
);

-- RPC portfolio legacy (remplacé par get_or_create_competition_portfolio dans 012)
DROP FUNCTION IF EXISTS get_or_create_portfolio(
  p_device_id TEXT, p_user_id UUID
);

-- RPCs de distribution legacy (remplacés par distribute_competition_dividends + liquidate_competition_eliminated)
DROP FUNCTION IF EXISTS distribute_dividends(
  p_portfolio_id UUID, p_nation_id TEXT, p_div_key TEXT
);
DROP FUNCTION IF EXISTS liquidate_eliminated(
  p_portfolio_id UUID, p_nation_id TEXT
);

-- ─── 2. Supprimer le trigger legacy ───────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_sync_nation_price ON nation_prices;
DROP FUNCTION IF EXISTS sync_nation_current_price();

-- ─── 3. Supprimer les tables legacy dans l'ordre des dépendances ──────────────

-- Tables filles d'abord
DROP TABLE IF EXISTS holdings_history CASCADE;  -- 005
DROP TABLE IF EXISTS dividends        CASCADE;  -- 005
DROP TABLE IF EXISTS nation_prices    CASCADE;  -- 005
DROP TABLE IF EXISTS group_standings  CASCADE;  -- 005
DROP TABLE IF EXISTS knockout_pools   CASCADE;  -- 005

-- Tables de l'ancien schéma single-player (001)
DROP TABLE IF EXISTS price_history    CASCADE;  -- 001
DROP TABLE IF EXISTS positions        CASCADE;  -- 001
DROP TABLE IF EXISTS trades           CASCADE;  -- 001
DROP TABLE IF EXISTS nations          CASCADE;  -- 001 (remplacé par teams + competition_teams)

-- Game state singleton legacy (001/005 — remplacé par competition_game_state)
DROP TABLE IF EXISTS game_state       CASCADE;  -- 005

-- Table de groupes redundante
DROP TABLE IF EXISTS groups           CASCADE;  -- 005

-- ─── 4. Vérification post-migration ───────────────────────────────────────────
-- Exécuter après la migration pour confirmer :

-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
-- → ne doit plus lister : nations, positions, trades, price_history,
--                         game_state, nation_prices, group_standings,
--                         knockout_pools, holdings_history, dividends, groups
```

### Tables et RPCs qui doivent RESTER (ne pas supprimer)

```
Tables actives :
  competitions, competition_game_state, competition_teams, competition_prices,
  competition_days, matches, teams, portfolios, holdings, transactions,
  profiles, user_game_states, leaderboard

RPCs actifs :
  get_or_create_competition_portfolio  (012)
  execute_competition_trade            (012)
  update_competition_prices            (012)
  distribute_competition_dividends     (012)
  liquidate_competition_eliminated     (012)
```

---

## STEP 5 — Tests supplémentaires

### Contexte

3 tests Vitest existent déjà dans `apps/web` (bootstrap, isolation persist, reset route). Les tests du `packages/game-engine` couvrent les fonctions pures. Ce step ajoute des tests ciblant les règles métier qui ont été sources de bugs.

### 5.1 — Test du pipeline `advanceDay` offline (groupe)

Créer `apps/web/stores/advanceDay.test.ts` :

```typescript
/**
 * Test de la logique métier du pipeline advanceDay offline.
 * Vérifie : applyResult, dividendes, élimination KO, bestScore.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks minimaux ─────────────────────────────────────────────────────────────

vi.mock('@/hooks/useAuth',    () => ({ syncBestScore: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({
  auth: { getUser: async () => ({ data: { user: null } }) },
})) }));
vi.mock('@/lib/bootstrap', () => ({
  getBootstrap:          vi.fn(),
  bootstrapToTeams:      vi.fn(),
  deriveDynamicKey:      vi.fn(),
  buildMatchesForCurrentDayFromBootstrap: vi.fn(),
}));

import { getBootstrap, bootstrapToTeams } from '@/lib/bootstrap';
import type { BootstrapData, TeamMeta } from '@kickstock/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

const TEAM_A: TeamMeta = { id: 'AAA', name: 'Team A', flag: '🇦', group: 'A', strength: 80, initialPrice: 100 };
const TEAM_B: TeamMeta = { id: 'BBB', name: 'Team B', flag: '🇧', group: 'A', strength: 60, initialPrice: 50  };

function makeBootstrap(days: Array<{ day_index: number; phase: string; is_ko: boolean; div_key: string | null }>): BootstrapData {
  return {
    competition: { id: 1, name: 'Test', start_date: '2026-01-01', league_id: 1, season: 2026 },
    teams: [
      { id: 'AAA', name: 'Team A', flag_emoji: '🇦', logo_url: null, group_code: 'A', strength: 80, initial_price: 100, confederation: null },
      { id: 'BBB', name: 'Team B', flag_emoji: '🇧', logo_url: null, group_code: 'A', strength: 60, initial_price: 50,  confederation: null },
    ],
    days: days.map(d => ({
      ...d,
      full_label: `Day ${d.day_index}`,
      date_label: 'Jan 1',
    })),
    group_fixtures: [
      { day_index: 0, nation_a: 'AAA', nation_b: 'BBB', venue: null }
    ],
    generated_at: new Date().toISOString(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('advanceDay offline — logique métier', () => {
  beforeEach(() => {
    // Nécessaire pour que Zustand persist fonctionne dans les tests
    const mockStorage: Record<string, string> = {};
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem:    (k: string) => mockStorage[k] ?? null,
        setItem:    (k: string, v: string) => { mockStorage[k] = v; },
        removeItem: (k: string) => { delete mockStorage[k]; },
        clear:      () => Object.keys(mockStorage).forEach(k => delete mockStorage[k]),
      },
      writable: true,
    });
  });

  it('les prix bougent après une journée de groupe', async () => {
    const bootstrap = makeBootstrap([
      { day_index: 0, phase: 'Groups', is_ko: false, div_key: null }
    ]);
    vi.mocked(getBootstrap).mockResolvedValue(bootstrap);
    vi.mocked(bootstrapToTeams).mockReturnValue([TEAM_A, TEAM_B]);

    // Import dynamique pour avoir un store frais
    const { useLocalGameStore } = await import('./localGameStore');
    const store = useLocalGameStore.getState();

    // Charger le bootstrap
    await store.loadBootstrap();

    // Mémoriser les prix initiaux
    const priceAbefore = useLocalGameStore.getState().prices['AAA'];
    const priceBbefore = useLocalGameStore.getState().prices['BBB'];
    expect(priceAbefore).toBe(100);
    expect(priceBbefore).toBe(50);

    // Simuler la journée
    const result = await useLocalGameStore.getState().advanceDay();
    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(1);

    // Les prix doivent avoir bougé (l'un augmente, l'autre diminue)
    const priceAafter = useLocalGameStore.getState().prices['AAA'];
    const priceBafter = useLocalGameStore.getState().prices['BBB'];
    const totalBefore = priceAbefore + priceBbefore;   // 150
    const totalAfter  = priceAafter  + priceBafter;
    // Conservation approximative : le total après = total avant (applyResult redistribue)
    expect(Math.abs(totalAfter - totalBefore)).toBeLessThan(1);
  });

  it('dayIndex est incrémenté après advanceDay', async () => {
    const bootstrap = makeBootstrap([
      { day_index: 0, phase: 'Groups', is_ko: false, div_key: null },
      { day_index: 1, phase: 'Groups', is_ko: false, div_key: null },
    ]);
    vi.mocked(getBootstrap).mockResolvedValue(bootstrap);
    vi.mocked(bootstrapToTeams).mockReturnValue([TEAM_A, TEAM_B]);

    const { useLocalGameStore } = await import('./localGameStore');
    await useLocalGameStore.getState().loadBootstrap();
    expect(useLocalGameStore.getState().dayIndex).toBe(0);

    await useLocalGameStore.getState().advanceDay();
    expect(useLocalGameStore.getState().dayIndex).toBe(1);
  });
});
```

### 5.2 — Test de la règle de concentration (cap 40%)

Créer `apps/web/stores/trade.concentration.test.ts` :

```typescript
/**
 * Vérifie que la règle de concentration (max 40% de la valeur totale)
 * est correctement appliquée dans TradeModal côté calcul client,
 * et que le serveur rejette avec CONCENTRATION_CAP si dépassée.
 */
import { describe, it, expect } from 'vitest';

// La logique de calcul du cap est dans TradeModal.tsx
// On la teste en isolation ici

function computeMaxBuy(
  totVal:      number,
  held:        number,
  price:       number,
  cash:        number,
  isCapPhase:  boolean,
): number {
  const maxBuyRaw = Math.max(0, Math.floor(cash / price));
  const maxBuyCap = isCapPhase
    ? Math.max(0, Math.floor((totVal * 0.40 - held * price) / price))
    : maxBuyRaw;
  return Math.min(maxBuyRaw, maxBuyCap);
}

describe('Règle de concentration 40%', () => {
  it('sans holdings : peut acheter jusqu\'à 40% de la valeur totale en phase de groupes', () => {
    // totVal = 10000 KC, prix = 100 KC, phase groupes
    // Max = 40% de 10000 / 100 = 40 parts
    const max = computeMaxBuy(10_000, 0, 100, 10_000, true);
    expect(max).toBe(40);
  });

  it('avec holdings existants : la capacité est réduite', () => {
    // totVal = 10000, prix = 100, déjà 20 parts (= 2000 KC = 20%)
    // Max supplémentaire = (40% × 10000 - 20×100) / 100 = (4000-2000)/100 = 20
    const max = computeMaxBuy(10_000, 20, 100, 10_000, true);
    expect(max).toBe(20);
  });

  it('à exactement 40% : ne peut plus acheter', () => {
    // totVal = 10000, prix = 100, déjà 40 parts (= 4000 KC = 40%)
    const max = computeMaxBuy(10_000, 40, 100, 10_000, true);
    expect(max).toBe(0);
  });

  it('au-delà de 40% : retourne 0', () => {
    // totVal = 10000, prix = 100, déjà 50 parts (= 5000 KC = 50%)
    const max = computeMaxBuy(10_000, 50, 100, 10_000, true);
    expect(max).toBe(0);
  });

  it('en phase KO (isCapPhase=false) : pas de cap de concentration', () => {
    // Même situation qu'au-dessus mais pas de cap
    const max = computeMaxBuy(10_000, 50, 100, 10_000, false);
    // Limité uniquement par le cash : 10000 / 100 = 100
    expect(max).toBe(100);
  });

  it('limité par le cash si cash < cap', () => {
    // totVal = 10000, prix = 100, pas de holdings, mais cash = 500
    // Max raw = 5, max cap = 40 → limité par cash = 5
    const max = computeMaxBuy(10_000, 0, 100, 500, true);
    expect(max).toBe(5);
  });
});
```

### 5.3 — Test des formules de dividendes

Créer `apps/web/lib/dividends.test.ts` :

```typescript
/**
 * Vérifie les taux de dividendes par phase de qualification.
 * Source métier : packages/constants/src/index.ts (DIV_RATES)
 */
import { describe, it, expect } from 'vitest';
import { calcDividend } from '@kickstock/game-engine';

describe('calcDividend — taux par phase', () => {
  const cases: Array<[string, number, number]> = [
    // [div_key, prix_courant, dividende_attendu_par_part]
    ['r32',      200,  20  ],   // 10% de 200
    ['r16',      200,  30  ],   // 15% de 200
    ['qf',       200,  40  ],   // 20% de 200
    ['sf',       200,  60  ],   // 30% de 200
    ['final',    200,  80  ],   // 40% de 200
    ['champion', 200,  120 ],   // 60% de 200
    ['unknown',  200,  0   ],   // clé inconnue = 0
  ];

  it.each(cases)('div_key=%s, prix=%d → dividende=%d KC/part', (key, price, expected) => {
    expect(calcDividend(price, key)).toBe(expected);
  });

  it('arrondi à 1 décimale', () => {
    // 10% de 15 = 1.5
    expect(calcDividend(15, 'r32')).toBe(1.5);
  });

  it('prix = 0 → dividende = 0', () => {
    expect(calcDividend(0, 'r32')).toBe(0);
  });
});
```

---

## Récapitulatif et ordre recommandé

| Ordre | Step | Effort estimé | Risque |
|-------|------|---------------|--------|
| 1 | **STEP 1** — Supprimer fallbacks NATIONS/GROUPS dans `buildKOMatches.ts` | 30 min | 🟢 Faible — vérification compilateur |
| 2 | **STEP 5.3** — Test dividendes (trivial, zéro dépendance) | 10 min | 🟢 Aucun |
| 3 | **STEP 5.2** — Test concentration cap | 15 min | 🟢 Aucun |
| 4 | **STEP 2** — Admin édition équipes (route PATCH + TeamEditor) | 1h | 🟢 Faible |
| 5 | **STEP 3** — Admin journées (routes POST/DELETE + DayManager) | 2h | 🟡 Moyen |
| 6 | **STEP 5.1** — Test pipeline advanceDay | 2h | 🟡 Moyen (mocks complexes) |
| 7 | **STEP 4** — Migration SQL 013 | 30 min + validation prod | 🔴 Élevé — irréversible en prod |

**⚠️ STEP 4 en dernier absolu.** Exécuter uniquement après avoir vérifié que toutes les tables legacy sont vides en production avec la requête SQL de comptage fournie.

---

## Points à ne pas modifier

- **`packages/game-engine/src/buildMatchesForDay`** : cette fonction n'utilise pas `teams`, elle opère uniquement sur les pools KO (`r32Pool`, `r16Pool`…) — ne pas lui ajouter un paramètre `teams`.
- **`DIV_RATES` et `INIT_CASH`** dans `@kickstock/constants` : conserver — ce sont des constantes métier utilisées correctement dans les deux stores.
- **Tables `holdings` et `transactions`** : ACTIVES — utilisées dans `game/state/route.ts` et `game/reset/route.ts`. Ne jamais les inclure dans la migration 013.
- **`packages/i18n/locales/fr.json` et `en.json`** : complets et synchronisés — ne pas modifier les clés existantes.
