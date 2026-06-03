# KickStock — Analyse API-Football & État des Modes Online / Offline

> Généré le 3 juin 2026 — basé sur lecture complète du code source.
> Priorité des gaps : 🔴 Bug en prod · 🟠 Important / Incomplet · 🟡 Souhaitable

---

## 1. Comment les données arrivent : vue d'ensemble

```
API-Football v3 (api-sports.io)
         │
         ├─ /fixtures?league=&season=          → Cron sync-fixtures (1×/jour 6h UTC)
         │    → teams, competition_teams, competition_days, matches (DB Supabase)
         │
         ├─ /fixtures?...&status=FT-AET-PEN   → Cron sync-results (1×/30 min)
         │    → prices, dividends, liquidation, progression de phase (DB)
         │
         ├─ /fixtures?live=all                 → /api/game/live-matches (à la demande)
         │    ⚠️  N'appelle PAS l'API — lit uniquement la DB (voir gap #G7)
         │
         ├─ /teams/rankings/fifa               → Script seed-team-rankings (one-off)
         │    → teams.strength (manually run)
         │
         └─ /teams?league=&season=             → POST /api/admin/competitions/[id]/import-teams
              ⚠️  Utilisé uniquement en admin, avec un bug de mapping (voir gap #G8)
```

Les **clients** (browser) ne contactent jamais l'API-Football directement.
Tout passe par la couche serveur KickStock.

---

## 2. Endpoints API-Football appelés

| Endpoint | Méthode | Appelé par | Fréquence | Cache Redis |
|---|---|---|---|---|
| `/fixtures?league={id}&season={y}` | GET | `sync-fixtures` | 1×/jour | 3 600 s |
| `/fixtures?league={id}&season={y}&status=FT-AET-PEN` | GET | `sync-results` | ~1×/30 min | 1 800 s (bucket 30 min) |
| `/fixtures?league={id}&live=all` | GET | Déclaré dans `football-api.ts`, **jamais appelé en prod** | — | aucun |
| `/teams/rankings/fifa` | GET | Script `seed-team-rankings.ts` | 1 fois (one-off) | aucun |
| `/teams?league={id}&season={y}` | GET | `import-teams` admin | À la demande (admin) | aucun |

**Quota** : Sur le plan gratuit API-Football (~100 req/jour), le système consomme :
- ≈ 1 req/jour (sync-fixtures)
- ≈ 0–48 req/jour (sync-results, court-circuité par `isMatchWindowActive`)
- Total : très conservateur, bien en dessous des limites.

---

## 3. Pipeline sync-fixtures (quotidien, 6h UTC)

**Fichier** : `apps/web/app/api/cron/sync-fixtures/route.ts`

```
1. Charge les compétitions actives (is_active = true)
2. Pour chaque compétition :
   a. Appelle GET /fixtures?league={leagueId}&season={season}
   b. Pour chaque fixture → normalizeFixture() :
      - Mappe le nom d'équipe API → ID ISO2 ("Brazil" → "BRA") via team-mapping
      - Dérive la phase ("Group Stage - 1" → "Groups", "Round of 32" → "R32", ...)
      - Calcule le day_index = floor((fixture_date - start_date) / 1 jour) [timezone ET]
      - Extrait group_code ("Group A" → "A")
   c. UPSERT teams (id, api_team_id, name, logo_url, flag_emoji) — PAS strength
   d. UPSERT competition_teams (competition_id, team_id, group_code) — PAS initial_price
   e. UPSERT competition_days (day_index, phase, is_ko, div_key, labels)
   f. RPC upsert_fixture → UPSERT matches [GOLDEN RULE: ne touche jamais processed_at, score_a, score_b]
3. Met à jour competitions.last_sync_at
```

**Idempotent** : peut tourner N fois, les données de jeu ne sont jamais écrasées.

---

## 4. Pipeline sync-results (toutes les 30 min)

**Fichier** : `apps/web/app/api/cron/sync-results/route.ts` + `lib/process-real-result.ts` + `lib/check-advance-phase.ts`

```
1. Court-circuit : isMatchWindowActive() → vérifie si des matchs sont prévus dans [now-3h, now+3h]
   Si non → retour immédiat, 0 appel API

2. GET /fixtures?league={ids}&season={year}&status=FT-AET-PEN

3. Pour chaque fixture terminée → processRealMatchResult() :
   a. Charge le match depuis la DB (via fixture_id)
   b. Guard idempotence : si processed_at IS NOT NULL → skip
   c. Détermine le résultat :
      - PEN : vainqueur aux tirs → 'A' ou 'B'
      - Sinon : goals home/away → 'A', 'B', ou 'draw'
   d. Applique la formule de prix :
      - Gagnant : prix + prix_adversaire × 0.5
      - Perdant : prix × 0.5
      - Nul :     prix + prix_adversaire × 0.25
   e. RPC update_competition_prices (met à jour current_price + historique)
   f. KO sauf SF/3rd : RPC liquidate_competition_eliminated (loserId → 1 KC/action)
   g. Si div_key sur le jour : RPC distribute_competition_dividends (winnerId)
   h. UPDATE matches : score_a, score_b, winner_id, processed_at, trade_lock_until (+15 min)

4. Pour chaque compétition → checkAndAdvancePhase() :
   a. Compte les matchs du jour non traités
   b. Si count = 0 : avance le day_index + 1
   c. Si dernier jour de groupes : calcule les qualifiés KO via buildKOQualifiers()
   d. Liquidate les non-qualifiés
   e. UPDATE competition_game_state (day_index, phase, pools, eliminated)
```

---

## 5. Formats de compétition — comment c'est géré

Les compétitions ne sont **pas hardcodées**. Le format est entièrement dérivé de la DB :

| Format | Source | Dynamique |
|---|---|---|
| Nombre d'équipes (32 vs 48) | `competition_teams` (count) | ✅ oui |
| Groupes (A-H vs A-L) | `competition_teams.group_code` | ✅ oui |
| Phases (Groups → R32 → R16 → QF → SF → Final) | `competition_days.phase` | ✅ oui |
| Présence du R32 | Vérifiée via `competition_days` | ✅ oui |
| Nombre de qualifiés KO | Compté depuis les matchs DB du next_phase | ✅ oui |
| Pairings R32 WC2026 | `buildR32Pool()` dans game-engine | ⚠️ semi-hardcodé (voir gap #G4) |

**Flux groupe → KO** (`ko-qualifiers.ts`) :
```
1. Calcule le classement de chaque groupe depuis les matchResults
2. Top 2 de chaque groupe → qualifiés automatiques
3. Compte les spots restants = matchCount(nextPhase) × 2 - (groupes × 2)
4. Complète avec les meilleurs 3es par pts/gd/gf/force
5. Non-qualifiés → éliminés + liquidés
```

**Mapping des rounds API-Football** (`normalizer.ts`) :
```
"Group Stage - 1"  → "Groups"
"Round of 32"      → "R32"
"Round of 16"      → "R16"
"Quarter-finals"   → "QF"
"Semi-finals"      → "SF"
"3rd Place Final"  → "3rd"
"Final"            → "Final"
Autre              → console.warn + passthrough (à surveiller pour Champions League)
```

---

## 6. Mode Offline — ce qui est implémenté ✅

**Store** : `apps/web/stores/localGameStore.ts` (Zustand + localStorage)

| Fonctionnalité | État | Fichier |
|---|---|---|
| Bootstrap (équipes + calendrier + fixtures groupes) | ✅ Complet | `lib/bootstrap.ts` → `/api/competition/bootstrap` |
| Cache bootstrap 24h localStorage | ✅ Complet | `lib/bootstrap.ts` |
| Simulation matchs de groupe | ✅ Complet | `game-engine/simulate.ts` |
| Simulation KO (ET + tirs au but) | ✅ Complet | `game-engine/simulate.ts` |
| Calcul prix post-match | ✅ Complet | `game-engine/applyResult.ts` |
| Génération scores réalistes | ✅ Complet | `game-engine/genScore.ts` |
| Génération buts (joueurs, minutes) | ✅ Complet | `game-engine/genGoals.ts` |
| Dividendes par phase (KO) | ✅ Complet | `game-engine/calcDividends.ts` |
| Dividende champion 60% | ✅ Complet | `localGameStore.ts` ligne 431 |
| Dividende finaliste perdant 40% | ✅ Complet | `localGameStore.ts` ligne 424 |
| Construction pool R32 (WC2026) | ✅ Complet | `game-engine/buildKOMatches.ts` → `buildR32Pool` |
| Construction pools R16/QF/SF/Final | ✅ Complet | `localGameStore.ts` → `advanceDay` |
| Liquidation éliminés KO | ✅ Complet | `localGameStore.ts` → remboursement 1 KC/action |
| Isolation état par compétition | ✅ Corrigé | clé Zustand `ks-game-state-{competitionId}` |
| Trade (buy/sell + taxe) | ✅ Complet | `localGameStore.ts` → `trade()` |
| Best score + sync leaderboard | ✅ Complet | `syncBestScore()` |
| Sync état vers Supabase (si connecté) | ✅ Complet | `writeStateToSupabase()` |
| Reset game | ✅ Complet | `resetGame()` |
| Classements de groupe (UI) | ✅ Complet | `buildGroupStandingsUI()` |

**Ce qui vient de l'API dans le bootstrap** :
```json
{
  "competition": { ... },
  "teams": [ { id, name, flag_emoji, group_code, strength, initial_price } ],
  "days":  [ { day_index, phase, is_ko, div_key, full_label } ],
  "group_fixtures": [ { day_index, nation_a, nation_b, venue } ]
}
```

**Ce qui est généré localement** :
- Matchs KO (R32, R16, QF, SF, 3rd, Final) — via `buildMatchesForDay(div_key, state)`
- Résultats (scores, buts) — via `simulate()` + `genScore()` + `genGoals()`
- Évolution des prix — via `applyResult()`

---

## 7. Mode Online — ce qui est implémenté ✅

**Store** : `apps/web/stores/onlineGameStore.ts` (Zustand + Supabase Realtime)

| Fonctionnalité | État | Fichier |
|---|---|---|
| Bootstrap identique au mode offline | ✅ Complet | `lib/bootstrap.ts` |
| Chargement état depuis Supabase | ✅ Complet | `/api/game/state` |
| Sync Realtime (postgres_changes) | ✅ Complet | `onlineGameStore.ts` |
| Fallback poll 30s si WebSocket down | ✅ Complet | `onlineGameStore.ts` |
| Trade buy/sell via RPC | ✅ Complet | RPC `execute_competition_trade` |
| Cap de concentration 40% (Groups + R32) | ✅ Complet | RPC SQL |
| Avancement de jour (mode simulé) | ✅ Complet | `/api/game/advance` + CAS lock |
| Ingestion vrais résultats API | ✅ Complet | `sync-results` → `processRealMatchResult` |
| Prix mis à jour après vrai résultat | ✅ Complet | RPC `update_competition_prices` |
| Dividendes KO (gagnant) | ✅ Complet | RPC `distribute_competition_dividends` |
| Liquidation KO losers (vrais matchs) | ✅ Complet | RPC `liquidate_competition_eliminated` |
| Avancement de phase auto | ✅ Complet | `checkAndAdvancePhase()` |
| Historique prix (sparkline) | ✅ Complet | `competition_prices` table |
| Multi-compétition isolée | ✅ Complet | Toutes les tables scopées `competition_id` |
| Race condition protection advance | ✅ Complet | CAS lock sur `advancing` flag |
| Trade lock 15 min post-match | ✅ Complet | `trade_lock_until` en DB |
| Reset game | ✅ Complet | `/api/game/reset` |
| Leaderboard best score | ✅ Complet | `syncBestScore()` + `user_game_states` |

---

## 8. Gaps identifiés — ce qui reste à faire

---

### 🔴 G1 — Dividende champion manquant en mode Online (bug)

**Fichier** : `apps/web/lib/process-real-result.ts`

En mode **simulé** (`/api/game/advance`), après la finale, le champion reçoit 60% (`DIV_RATES['champion']`) en plus du 40% du round final. Dans `processRealMatchResult` (vrais résultats), seulement `DIV_RATES['final']` est distribué au gagnant, mais **jamais `DIV_RATES['champion']`**.

**Impact** : Les joueurs ayant le champion dans leur portefeuille en mode Online reçoivent 40% moins de dividendes qu'en mode Offline.

**Correction** : Après la finale en `processRealMatchResult`, si `winnerId` et `match.phase === 'Final'`, appeler un second RPC `distribute_competition_dividends` avec `p_round: 'champion'` et `p_rate: DIV_RATES['champion']`.

```typescript
// À ajouter dans process-real-result.ts, après la distribution du div final
if (match.phase === 'Final' && winnerId) {
  const { DIV_RATES } = await import('@kickstock/constants');
  await adm(admin).rpc('distribute_competition_dividends', {
    p_competition_id: match.competition_id,
    p_team_id:        winnerId,
    p_round:          'champion',
    p_rate:           DIV_RATES['champion'] ?? 0.60,
    p_price:          newPA,
    p_day_index:      match.day_index,
  });
}
```

---

### 🔴 G2 — Dividende du finaliste perdant manquant en mode Online (bug)

**Fichier** : `apps/web/lib/process-real-result.ts`

En mode **simulé**, le perdant de la finale reçoit également 40% (`DIV_RATES['final']`). Dans `processRealMatchResult`, le perdant de la finale est bien **liquidé** (1 KC/action), mais ne reçoit **aucun dividende**.

**Impact** : Les joueurs ayant le finaliste perdant en portefeuille en mode Online ne touchent rien vs 40% en mode Offline. Comportement asymétrique.

**Correction** :
```typescript
// À ajouter dans process-real-result.ts, après la distribution du div gagnant
if (match.phase === 'Final' && loserId && day?.div_key) {
  const { DIV_RATES } = await import('@kickstock/constants');
  const rate = DIV_RATES[day.div_key] ?? 0;
  if (rate > 0) {
    await adm(admin).rpc('distribute_competition_dividends', {
      p_competition_id: match.competition_id,
      p_team_id:        loserId,
      p_round:          day.div_key,
      p_rate:           rate,
      p_price:          newPB,
      p_day_index:      match.day_index,
    });
  }
}
```

---

### 🟠 G3 — `live-matches` ignore le `competitionId` sélectionné (bug UX)

**Fichier** : `apps/web/app/api/game/live-matches/route.ts` ligne 20–25

La route fait `.eq('is_active', true).limit(1).single()` — elle prend la **première compétition active** sans tenir compte de la compétition que le joueur est en train de regarder.

**Impact** : Si WC2026 et Champions League sont actives simultanément, un joueur sur la Champions League verra les matchs du WC2026.

**Correction** : Lire le header `X-Competition-ID` (comme le fait `onlineGameStore`) et filtrer sur `comp.id` passé en param.

---

### 🟠 G4 — Pairings R32 WC2026 semi-hardcodés dans `buildR32Pool`

**Fichier** : `packages/game-engine/src/buildKOMatches.ts` lignes 179–196

La fonction `buildR32Pool` contient les pairings officiels FIFA 2026 **hardcodés** (winner A vs 3rd C/E/F/H/I, etc.). De même, `buildMatchesForDay` a des slices hardcodées (`r32_28: [0, 4]`, `r32_29: [4, 10]`, etc.) qui correspondent au calendrier WC2026 spécifique.

**Impact** : Ajouter la Champions League ou WC2022 en mode offline requiert d'étendre ces fonctions. La Champions League n'a pas de phase R32 de ce type — le code tomberait sur le `return []` par défaut.

**Correction à terme** : Rendre `buildMatchesForDay` configurable via les `div_key` de la DB (ou ajouter un mapping par `league_id`).

---

### 🟠 G5 — `initial_price` et `strength` non configurés par le cron

**Fichier** : `apps/web/app/api/cron/sync-fixtures/route.ts` ligne 98–104

Le cron `sync-fixtures` upserte `competition_teams` avec seulement `group_code`. Les colonnes **`initial_price`** et **`strength`** (dans `teams`) ne sont **jamais mises à jour automatiquement**.

**Conséquence** :
- `initial_price` = `null` jusqu'à configuration manuelle → la formule de prix échoue (fallback 100 KC)
- `strength` = `null` ou 75 (défaut) → la simulation est approximative

**Ce qui existe mais est manuel** :
- Script `db/seeds/seed-team-rankings.ts` : fetche `/teams/rankings/fifa` et met à jour `strength`
- Route `import-teams` : met `initial_price = 50`, `strength = 70` (valeurs fixes, pas issues des rankings)

**Correction recommandée** :
1. Après `sync-fixtures`, si `strength IS NULL` pour une équipe, appeler `/teams/rankings/fifa` et mettre à jour
2. Configurer `initial_price` proportionnellement au `strength` (ex: `strength * 1.5`)

---

### 🟠 G6 — `res90` incorrect pour les matchs AET/PEN en mode Online

**Fichier** : `apps/web/lib/process-real-result.ts` ligne 190–195

Dans `result_data`, le champ `res90` est mis à `res` (le résultat final, incluant les PEN). Or pour un match allant aux tirs au but, `res90` devrait être `'draw'` (résultat à 90 min réel = nul).

**Impact** : L'UI qui utilise `res90` pour afficher "Résultat à 90'" affiche le mauvais résultat pour les matchs PEN.

**Correction** :
```typescript
res90: fixture.fixture.status.short === 'FT'
  ? res
  : 'draw', // AET et PEN commencent toujours par un nul à 90'
```

---

### 🟠 G7 — Scores live pendant les matchs non affichés

**Fichier** : `apps/web/app/api/game/live-matches/route.ts`

La route `live-matches` lit uniquement la DB (`score_a`, `score_b`). Ces colonnes ne sont remplies qu'**après** `processRealMatchResult` (post-match). Pendant un match en cours, `score_a = null`, `score_b = null`.

La fonction `fetchLiveFixtures()` existe dans `football-api.ts` (appelle `/fixtures?live=all`) mais n'est **jamais appelée** par `live-matches/route.ts`.

**Impact** : L'onglet "Live" ne montre que les statuts DB (NS/FT/PST), pas les scores en cours.

**Correction** : Dans `live-matches/route.ts`, si le match est `1H`/`HT`/`2H`/`ET`, appeler `fetchLiveFixtures()` et enrichir la réponse avec les scores temps réel.

---

### 🟠 G8 — `import-teams` utilise un ID numérique au lieu de l'ISO2

**Fichier** : `apps/web/app/api/admin/competitions/[id]/import-teams/route.ts` ligne 56

```typescript
const teamId = String(t.id);  // ex: "157" au lieu de "FRA"
```

Le reste du système (sync-fixtures, normalizer, game-engine) attend des IDs de type `"FRA"`, `"BRA"`. La route `import-teams` utilise l'ID numérique API-Football comme team_id — **incompatible** avec la team-mapping utilisée par les crons.

**Impact** : Les équipes importées via `import-teams` ne peuvent pas être matchées par `normalizeFixture()` → elles seraient "skipped" lors du prochain `sync-fixtures`.

**Correction** : Utiliser `apiNameToTeamId(t.name, leagueId)` depuis `lib/team-mapping` pour dériver l'ISO2.

---

### 🟠 G9 — `NEXT_PUBLIC_CRON_SECRET` exposé côté client

**Fichier** : `/admin/competitions/[id]` (bouton "↻ SYNC FIXTURES")

Le secret CRON est exposé dans une variable `NEXT_PUBLIC_*` pour être utilisable dans le composant client admin. Toute personne inspectant le bundle JS peut déclencher le cron manuellement.

**Correction** : Remplacer le bouton client par une Server Action qui lit `process.env.CRON_SECRET` (non-public) et appelle la route en interne.

---

### 🟡 G10 — Timezone `America/New_York` hardcodée dans le normalizer

**Fichier** : `apps/web/lib/normalizer.ts` ligne 122

`calcDayIndex` utilise `05:00 UTC` (midnight ET = UTC-5) comme borne de journée. Pour le WC2026 aux USA, c'est correct. Pour la Champions League (matchs à 21h CET), cela produirait des `day_index` corrects, mais les labels de date (`formatDateLabel`) seraient en timezone ET également.

**Impact mineur** : Pas bloquant pour le WC2026, mais à revoir pour les compétitions européennes.

---

### 🟡 G11 — Classements de groupe non vérifiés contre l'officiel API

L'API-Football fournit `/standings` avec les classements officiels (règles de tiebreak officielles FIFA/UEFA). KickStock les recalcule lui-même dans `ko-qualifiers.ts` et `buildKOMatches.ts` avec un tri pts/gd/gf/strength.

**Gap** : Le tiebreak officiel FIFA inclut des règles supplémentaires (confrontations directes, fair-play) qui ne sont pas implémentées.

**Impact** : En cas d'égalité parfaite pts/gd/gf, l'équipe qualifiée peut différer de l'officiel.

---

### 🟡 G12 — Vrais buteurs non récupérés depuis l'API

**Fichier** : `packages/game-engine/src/genGoals.ts`

Les buts affichés en mode Online sont **générés aléatoirement** par `genGoals()`, exactement comme en mode Offline. L'API-Football fournit pourtant `/fixtures/events` avec les vrais buteurs, minutes, et types de buts.

**Impact** : Cosmétique — les buts affichés ne correspondent pas à la réalité pour les matchs Online.

**Correction à terme** : Dans `processRealMatchResult`, appeler `/fixtures/events?fixture={id}` et stocker les vrais buts dans `result_data.goals`.

---

## 9. Récapitulatif des gaps

| # | Priorité | Description | Mode | État |
|---|---|---|---|---|
| G1 | 🔴 | Dividende champion manquant en Online | Online | ✅ Corrigé |
| G2 | 🔴 | Dividende finaliste perdant manquant en Online | Online | ✅ Corrigé |
| G3 | 🟠 | `live-matches` ignore le competitionId du joueur | Online | ✅ Corrigé |
| G4 | 🟠 | Pairings R32 et slices KO hardcodés pour WC2026 | Offline | 🟡 Reporté |
| G5 | 🟠 | `initial_price` et `strength` non seedés automatiquement | Admin | ✅ Corrigé (sync-fixtures + import-teams) |
| G6 | 🟠 | `res90` incorrect pour matchs AET/PEN en Online | Online | ✅ Corrigé |
| G7 | 🟠 | Scores live pendant les matchs non affichés | Online | ✅ Corrigé |
| G8 | 🟠 | `import-teams` utilise ID numérique API au lieu d'ISO2 | Admin | ✅ Corrigé |
| G9 | 🟠 | `NEXT_PUBLIC_CRON_SECRET` exposé côté client | Admin | ✅ Corrigé (route admin protégée) |
| G10 | 🟡 | Timezone ET hardcodée (problématique hors USA) | Both | 🟡 Reporté |
| G11 | 🟡 | Classements de groupe sans règles tiebreak officielles | Both | 🟡 Reporté |
| G12 | 🟡 | Vrais buteurs non récupérés depuis API-Football | Online | ✅ Corrigé (fetchFixtureEvents) |

## 10. Nouvelles fonctionnalités ajoutées

| Feature | Fichiers |
|---|---|
| Strength seedé depuis FIFA rankings (auto) | `sync-fixtures/route.ts`, `football-api.ts` |
| `initial_price` calculé depuis strength (1.5×) | `sync-fixtures/route.ts`, `import-teams/route.ts` |
| Squads joueurs depuis `/players/squads` | `sync-squads/route.ts` (nouveau cron) |
| Vrais buteurs dans les résultats Online | `process-real-result.ts`, `football-api.ts` |
| Noms de joueurs dans les buts (offline + online) | `genGoals.ts`, `localGameStore.ts`, `advance/route.ts` |
| Squads dans le bootstrap | `bootstrap/route.ts`, `BootstrapData` type |
| Cron `sync-squads` hebdo (lundi 5h UTC) | `vercel.json` |

---

## 10. Ce qui fonctionne sans aucun gap

- Architecture multi-compétition : isolation totale par `competition_id` ✅
- Mode offline complet (simulation, dividendes, KO, champion) ✅
- Mode online : ingestion vrais résultats, prix, dividendes KO (sauf finale – voir G1/G2) ✅
- Progression de phase automatique (groupes → R32 → R16 → QF → SF → Final) ✅
- Idempotence de toutes les crons (safe à rejouer) ✅
- Race condition protection sur l'avancement de jour (CAS lock) ✅
- Cache Redis (Upstash) pour économiser le quota API-Football ✅
- Bootstrap client 24h (offline fonctionnel sans connexion API) ✅
- WC2026 (48 équipes, 12 groupes, R32) supporté ✅
- WC2022 (32 équipes, 8 groupes, R16 direct) supporté ✅

---

*Document généré depuis lecture directe des fichiers sources. Voir `TODO_FUNCTIONAL.md` pour le suivi opérationnel (crons, variables d'environnement, tests manuels).*
