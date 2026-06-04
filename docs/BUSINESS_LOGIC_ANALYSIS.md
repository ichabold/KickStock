# KickStock — Analyse de la Logique Métier

> Généré le 2 juin 2026 · Basé sur le code source complet du projet.
>
> Ce document mappe l'intégralité de la logique métier implémentée sur les User Stories du fichier `USER_STORIES.md`. Il couvre les formules, constantes, variables d'état, procédures et RPCs Supabase. Le routing Next.js, l'auth Supabase et l'infrastructure Sentry sont mentionnés uniquement lorsqu'ils portent une règle métier.

---

## Table des matières

1. [US-1 · Onboarding & Authentification](#us-1--onboarding--authentification)
2. [US-3 · Sélection de compétition & Mode de jeu](#us-3--sélection-de-compétition--mode-de-jeu)
3. [US-4 → US-5 · Marché — Consultation & Trading](#us-4--us-5--marché--consultation--trading)
4. [US-5 (Portfolio) · Portfolio](#us-5-portfolio--portfolio)
5. [US-6 · Calendrier des matchs](#us-6--calendrier-des-matchs)
6. [US-7 · Classements](#us-7--classements)
7. [US-8 · Mode Simulation (offline)](#us-8--mode-simulation-offline)
8. [US-9 · Mode Live (online)](#us-9--mode-live-online)
9. [US-10 → US-11 · Dividendes & Mécanique de prix](#us-10--us-11--dividendes--mécanique-de-prix)
10. [US-12 · Fiche Équipe (Nation Detail)](#us-12--fiche-équipe-nation-detail)
11. [US-13 · Leaderboard](#us-13--leaderboard)
12. [US-14 · Onboarding UX — Tutorial & Coach Marks](#us-14--onboarding-ux--tutorial--coach-marks)
13. [US-15 · UI Shell — Mobile & Desktop](#us-15--ui-shell--mobile--desktop)
14. [US-16 · Administration — Gestion des compétitions](#us-16--administration--gestion-des-compétitions)
15. [US-17 · Infrastructure & Monitoring](#us-17--infrastructure--monitoring)
16. [Code non lié à une User Story](#code-non-lié-à-une-user-story)

---

## US-1 · Onboarding & Authentification

### US-1.1 · Jouer en invité

**Logique métier couverte :** Validation du format pseudo, persistence locale de l'identité anonyme, génération d'identifiant de device.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But | Usage |
|-----|-------------|--------|-----|-------|
| `KEY` | `'kickstock_pseudo'` | `lib/pseudo.ts:1` | Clé localStorage du pseudo | Persistance entre sessions |
| `PENDING_KEY` | `'kickstock_oauth_pending'` | `lib/pseudo.ts:3` | Clé localStorage pseudo pré-OAuth | Survie au redirect OAuth |
| `X-Device-ID` | UUID v4 (header HTTP) | `app/api/game/state/route.ts:19` | Identifiant anonyme du joueur | Routing de l'état de jeu |

#### Formules & Calculs

**Validation du pseudo (isValidPseudoFormat) :**
```
longueur ∈ [3, 20]
  ET caractères ∈ [a-zA-Z0-9_-]
  ET ne commence pas par _ ou -
  ET ne termine pas par _ ou -
```
- Source : `lib/pseudo.ts:36–40`
- Note : le document USER_STORIES précise 3–16 caractères pour l'invité, mais la validation code est 3–20. Écart non documenté côté US.
- Cas limite : `isValidPseudoFormat("")` → `false` (length < 3)

**Validation UUID device-id (côté API) :**
```
UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
```
- Source : `app/api/game/state/route.ts:19`
- Si le device-id ne correspond pas au pattern → réponse 400 `invalid_device_id`

#### Procédures & Processus

**Séquence pseudo invité :**
1. `setPseudo(p)` : écrit dans `localStorage['kickstock_pseudo']`
2. Avant redirect OAuth : `saveOAuthPending()` copie le pseudo vers `localStorage['kickstock_oauth_pending']`
3. Après retour OAuth : `getOAuthPending()` permet de récupérer le pseudo, `clearOAuthPending()` nettoie

**Portfolio anonyme (RPC SQL `get_or_create_competition_portfolio`) :**
1. Recherche par `user_id` si fourni
2. Puis recherche par `device_id` + `competition_id`
3. Si aucun trouvé → `INSERT portfolios(cash=10000, avg_cost='{}', tx_log='[]')`
4. Si trouvé et `user_id` fourni mais portfolio sans `user_id` → lie le compte au portfolio existant
- Source : `db/migrations/012_multi_competition.sql:96–134`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `isValidPseudoFormat` | `lib/pseudo.ts:36` | Valide le format du pseudo |
| `getPseudo` / `setPseudo` / `clearPseudo` | `lib/pseudo.ts:5–17` | CRUD pseudo localStorage |
| `saveOAuthPending` / `getOAuthPending` / `clearOAuthPending` | `lib/pseudo.ts:19–33` | Persistance pseudo pendant redirect OAuth |
| `get_or_create_competition_portfolio` | `db/migrations/012:96` | RPC SQL : crée ou retrouve portfolio scopé par compétition |

---

### US-1.4 · Migration invité → compte permanent

**Logique métier couverte :** La migration est atomique. La logique d'identité est dans `get_or_create_competition_portfolio` : le portfolio device est retrouvé et son `user_id` mis à jour en une seule transaction SQL.

#### Procédures & Processus

**Liaison device → user (dans `get_or_create_competition_portfolio`) :**
```sql
IF p_user_id IS NOT NULL THEN
  UPDATE portfolios SET user_id = p_user_id
  WHERE id = v_id AND user_id IS NULL;
END IF;
```
- Le cash, les holdings et le tx_log ne sont pas copiés — ils restent sur le même portfolio UUID, qui est désormais lié à l'utilisateur authentifié.
- La contrainte `UNIQUE (user_id, competition_id)` n'existe pas explicitement, mais `get_or_create_competition_portfolio` fait une recherche par `user_id` en priorité.

---

### US-1.6 · Choisir ou modifier son pseudo

**Logique métier couverte :** Format et debounce. La vérification côté client utilise `isValidPseudoFormat` (voir US-1.1). Le check de disponibilité se fait via `/api/auth/check-pseudo` (non analysé ici car hors scope métier).

---

## US-3 · Sélection de compétition & Mode de jeu

### US-3.2 · Changer de compétition

**Logique métier couverte :** Isolement des états de jeu par `competition_id`. La clé de sélection est persistée en localStorage ; un changement déclenche un rechargement de page pour éviter les hooks conditionnels React.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But | Usage |
|-----|-------------|--------|-----|-------|
| `COMPETITION_KEY` | `'kickstock:competition'` | `stores/onlineGameStore.ts:27` | Clé localStorage de la compétition choisie | Mode online uniquement |
| `_competitionId` | `number` (Zustand state) | `stores/onlineGameStore.ts:99` | ID de compétition actif | Toutes les requêtes API |

#### Formules & Calculs

**Lecture synchrone au démarrage (getCompetitionIdSync) :**
```
stored = localStorage.getItem('kickstock:competition')
competitionId = stored ? parseInt(stored, 10) : 1
```
- Source : `stores/onlineGameStore.ts:29–33`
- Valeur par défaut : `1` (WC2026)

#### Procédures & Processus

**Changement de compétition :**
1. `setCompetitionId(id)` : écrit dans localStorage, appelle `window.location.reload()`
2. Au rechargement : `getCompetitionIdSync()` lit la valeur, initialise `_competitionId` dans le store
3. `loadBootstrap()` charge les données de la nouvelle compétition depuis `/api/competition/bootstrap?competition_id=N`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `getCompetitionIdSync` | `stores/onlineGameStore.ts:29` | Lit l'ID de compétition depuis localStorage (synchrone) |
| `setCompetitionId` | `stores/onlineGameStore.ts:35` | Persiste et recharge |

---

### US-3.3 · Choisir entre mode Online et mode Offline

**Logique métier couverte :** Le mode pilote quel store Zustand est instancié. La bascule est gérée par `gameStore.ts`.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But | Usage |
|-----|-------------|--------|-----|-------|
| `kickstock:mode` | `'online'` \| `'offline'` | `hooks/useGameMode` (référencé) | Mode de jeu courant | Sélection du store |

#### Procédures & Processus

**Sélection du store (`gameStore.ts`) :**
```typescript
const mode = getGameModeSync();
export const useGameStore = (
  mode === 'online' ? useOnlineGameStore : useLocalGameStore
) as typeof useLocalGameStore;
```
- Source : `stores/gameStore.ts:28–35`
- Implication : le mode est lu **une seule fois au chargement du module**. Un changement de mode nécessite un rechargement de page.
- `buildMatchesForCurrentDay` est également dispatché vers la bonne implémentation selon le mode.

---

### US-3.4 · Chargement des données de la compétition (Bootstrap)

**Logique métier couverte :** Mécanisme de cache client 24h, construction des `TeamMeta` depuis les données DB, composition du payload bootstrap.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But | Usage |
|-----|-------------|--------|-----|-------|
| `CACHE_TTL` | `24 * 60 * 60 * 1000` ms (= 86 400 000 ms = 24h) | `lib/bootstrap.ts:10` | TTL du cache localStorage bootstrap | Évite les appels API répétés |
| Clé cache | `kickstock:bootstrap:v2:{competitionId}` | `lib/bootstrap.ts:12` | Clé localStorage par compétition | Isolation par tournoi |

#### Procédures & Processus

**`getBootstrap(competitionId = 1)` :**
1. Lit le cache : `localStorage.getItem('kickstock:bootstrap:v2:{id}')`
2. Parse `CacheEntry = { data: BootstrapData, fetchedAt: number }`
3. Si `Date.now() - fetchedAt < 86_400_000` → retourne `data` (cache valide)
4. Sinon → `fetch('/api/competition/bootstrap?competition_id=N')`
5. Si la réponse est vide (`teams.length === 0` ou `days.length === 0`) → erreur
6. En cas d'erreur fetch → fallback sur le cache périmé ("stale cache")
7. Écriture en cache : `{ data, fetchedAt: Date.now() }`

**`bootstrapToTeams(data)` :**
Transforme les `BootstrapTeam` (snake_case DB) en `TeamMeta` (camelCase moteur) :
```typescript
{
  id:           t.id,
  name:         t.name,
  flag:         t.flag_emoji ?? '',
  group:        t.group_code ?? '',
  strength:     t.strength,
  initialPrice: t.initial_price,
  confederation: t.confederation ?? undefined,
  logoUrl:      t.logo_url ?? undefined,
}
```
- Source : `lib/bootstrap.ts:73–84`

**API `/api/competition/bootstrap` :**
Retourne (dans l'ordre) :
1. Métadonnées de la compétition (`id, name, start_date, league_id, season`)
2. Teams avec prix initial (`competition_teams JOIN teams`)
3. Jours (`competition_days` triés par `day_index`)
4. Fixtures de groupes uniquement (les fixtures KO ne sont pas incluses — elles sont calculées dynamiquement)
- Cache serveur : `public, s-maxage=3600, stale-while-revalidate=86400`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `getBootstrap` | `lib/bootstrap.ts:45` | Charge et cache le bootstrap |
| `refreshBootstrap` | `lib/bootstrap.ts:68` | Vide le cache et recharge |
| `bootstrapToTeams` | `lib/bootstrap.ts:73` | Convertit BootstrapTeam → TeamMeta |
| `GET /api/competition/bootstrap` | `app/api/competition/bootstrap/route.ts:31` | Endpoint API bootstrap |

---

## US-4 → US-5 · Marché — Consultation & Trading

### US-4.4 · Taxe de transaction

**Logique métier couverte :** La taxe est calculée par `calcTax` et appliquée uniquement à la **vente**. L'achat ne supporte pas de taxe.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But | Usage |
|-----|-------------|--------|-----|-------|
| Taux groupes | `0.10` (10%) | `game-engine/src/calcTax.ts:9` | Taux de taxe en phase de groupes | Vente |
| Taux KO | `0.05` (5%) | `game-engine/src/calcTax.ts:9` | Taux de taxe en phase KO | Vente |
| Minimum taxe | `10` KC | `game-engine/src/calcTax.ts:9` | Plancher de taxe | Vente |
| Seuil élimination | `price ≤ 1` KC | `game-engine/src/calcTax.ts:8` | Aucune taxe sur équipes éliminées | Vente |

#### Formules & Calculs

**`calcTax(amount, price, isKO = false)` :**
```
si price ≤ 1 KC → taxe = 0

sinon :
  taux = isKO ? 0.05 : 0.10
  taxe = max(amount × taux, 10)
```
- Source : `game-engine/src/calcTax.ts:7–10`

**Exemples (tirés des tests) :**
- `calcTax(200, 100, false)` → `20` (10% de 200)
- `calcTax(50, 50, false)` → `10` (min 10 KC)
- `calcTax(200, 100, true)` → `10` (5% de 200 = 10)
- `calcTax(300, 100, true)` → `15` (5% de 300)
- `calcTax(100, 1, false)` → `0` (prix plancher)

**Détermination de la phase KO dans le store offline :**
```typescript
const isKO = s.dayIndex >= 17;
```
- Source : `stores/localGameStore.ts:226`
- Note : `dayIndex 17` = premier jour R32 dans le calendrier WC2026 (17 jours de groupes, indices 0–16)

**Détermination de la phase KO dans le RPC SQL (`execute_competition_trade`) :**
```sql
(current_day_index <= 22)  -- Groups + R32 = cap phase
```
- Source : `db/migrations/012:196`
- Incohérence : la logique SQL considère que `dayIndex ≤ 22` = "phase cap" (taux 5%), alors que le store TS utilise `dayIndex >= 17` = "KO" (taux 5%). Les deux seuils sont différents. **Le RPC SQL est la référence authoritative pour le mode online.**

**Net de vente (store offline) :**
```
subtotal = price × quantity
tax      = eliminated ? 0 : calcTax(subtotal, price, isKO)
net      = subtotal - tax
```
- Source : `stores/localGameStore.ts:249–252`

**Net de vente (store online, calcul optimiste local) :**
```
gross = price × quantity
fee   = (isElim || price ≤ 1) ? 0 : max(gross × (isKO ? 0.05 : 0.10), 10)
net   = gross - fee
```
- Source : `stores/onlineGameStore.ts:234–236`

---

### US-4.5 · Blocage du marché en zone de match

**Logique métier couverte :** Le marché est verrouillé autour des matchs en mode live. En mode simulation (Phase 1), il ne l'est jamais.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But | Usage |
|-----|-------------|--------|-----|-------|
| `trade_lock_until` | `TIMESTAMPTZ` | `db/migrations/010:126` | Heure de fin de lock d'un match | Blocage des trades |
| Buffer post-match | `+15 * 60_000 ms` (= 15 min après `processed_at`) | `lib/process-real-result.ts:162` | Période de lock post-traitement | Calculé à la fin du traitement |
| Seuil pré-match | `scheduled_at ≤ NOW() + INTERVAL '5 minutes'` | `db/migrations/010:256` | Verrouillage avant coup d'envoi | RPC `is_trade_locked` |

#### Formules & Calculs

**`isMarketLocked` (mode simulation) :**
```
return false; // Phase 1 : toujours ouvert
```
- Source : `game-engine/src/isMarketLocked.ts:14`
- Note : la logique de lock en mode live est entièrement côté DB/API, pas dans ce fichier.

**Calcul de `trade_lock_until` (après traitement résultat réel) :**
```
trade_lock_until = processed_at + 15 minutes
```
- Source : `lib/process-real-result.ts:161–162`

**RPC `is_trade_locked(p_nation_id)` :**
```sql
SELECT EXISTS (
  SELECT 1 FROM matches
  WHERE (nation_a = p_nation_id OR nation_b = p_nation_id)
    AND api_status NOT IN ('PST', 'SUSP', 'CANC', 'ABD')
    AND scheduled_at <= NOW() + INTERVAL '5 minutes'
    AND (processed_at IS NULL OR trade_lock_until > NOW())
);
```
- Source : `db/migrations/010:248–258`
- Lock actif quand : match non traité prévu dans les 5 prochaines minutes **OU** match traité mais `trade_lock_until` futur

---

### US-4.6 · Plafond de concentration (anti-monopole)

**Logique métier couverte :** Un joueur ne peut pas détenir plus de 40% de sa valeur totale dans une même équipe, pendant la phase de groupes et le R32.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But | Usage |
|-----|-------------|--------|-----|-------|
| Seuil de concentration | `0.40` (40%) | `db/migrations/012:229` et `db/migrations/005:391` | Plafond de concentration | Blocage d'achat |
| Phase cap | `current_day_index ≤ 22` (SQL) | `db/migrations/012:196` | Période où le cap s'applique | Mode online |

#### Formules & Calculs

**Calcul de concentration (RPC `execute_competition_trade`) :**
```
v_tot_val = cash + Σ(quantity × current_price pour tous holdings dans cette compétition)

si v_tot_val > 0 ET ((held + quantity) × price) / v_tot_val > 0.40
  → RETURN 'Plafond 40% atteint'
```
- Source : `db/migrations/012:218–232`
- La condition est vérifiée **uniquement pendant `v_is_cap = true`**, c'est-à-dire quand `current_day_index ≤ 22`

**Codes d'erreur renvoyés :**
- SQL : `'⛔ Plafond 40% atteint'`
- API route (`errorToCode`) : mappe `'plafond'` → `'CONCENTRATION_CAP'`
- Source : `app/api/trade/route.ts:87`

---

### US-4.7 · Interdiction de trader une équipe éliminée

**Logique métier couverte :** L'achat d'une équipe éliminée est bloqué côté store (optimisme) et côté RPC (authorité).

#### Procédures & Processus

**Store offline (localGameStore) :**
```typescript
if (s.eliminated.includes(nationId)) return 'Nation éliminée 💀';
```
- Source : `stores/localGameStore.ts:229`

**RPC `execute_competition_trade` :**
```sql
IF p_team_id = ANY(v_eliminated) THEN
  RETURN jsonb_build_object('error', 'Équipe éliminée 💀');
END IF;
```
- Source : `db/migrations/012:208–210`
- `v_eliminated` est lu depuis `competition_game_state.eliminated[]`

**Codes d'erreur :**
- API : `NATION_ELIMINATED` si le message contient `'éliminé'` ou `'eliminated'`
- Source : `app/api/trade/route.ts:85`

---

### US-4.1 / US-4.2 · Achat et vente de parts

**Logique métier couverte :** Calcul du coût moyen pondéré (avgCost), mise à jour du cash et du portfolio.

#### Formules & Calculs

**Coût moyen pondéré (Weighted Average Cost) :**
```
si prevQty = 0 → newAvg = price
sinon → newAvg = (prevQty × prevAvg + quantity × price) / (prevQty + quantity)
newAvg = round(newAvg × 10) / 10  (arrondi à 1 décimale)
```
- Source : `stores/localGameStore.ts:236–239` et `stores/onlineGameStore.ts:224–225`

**Cash après achat :**
```
newCash = round((cash - price × quantity) × 10) / 10
```
- Source : `stores/localGameStore.ts:241`

**Cash après vente :**
```
newCash = round((cash + net) × 10) / 10
où net = price × quantity - tax
```
- Source : `stores/localGameStore.ts:259`

**Quantité maximale en tx_log :** `100` entrées (FIFO, les plus anciennes sont supprimées)
- Source : `stores/localGameStore.ts:244`, `db/migrations/005:464–467`

**Suppression de la position :**
Si `newQty = 0` : `delete portfolio[nationId]` ET `delete avgCost[nationId]`
- Source : `stores/localGameStore.ts:254–255`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `calcTax` | `game-engine/src/calcTax.ts:7` | Calcule la taxe de transaction |
| `trade` (localGameStore) | `stores/localGameStore.ts:221` | Trade offline complet |
| `trade` (onlineGameStore) | `stores/onlineGameStore.ts:203` | Validation optimiste + appel RPC |
| `execute_competition_trade` | `db/migrations/012:141` | RPC SQL trade atomique (authorité) |
| `POST /api/trade` | `app/api/trade/route.ts:14` | Endpoint HTTP trade |

---

## US-5 (Portfolio) · Portfolio

### US-5.1 · Valeur totale du portfolio

**Logique métier couverte :** Calcul de la valeur totale, P&L, et variation.

#### Formules & Calculs

**`usePortfolioTotals()` :**

```
portVal  = Σ (qty[id] × prices[id])  pour tout id dans portfolio où qty > 0

invested = Σ (qty[id] × (avgCost[id] ?? NATIONS.find(n => n.id === id)?.p ?? 0))
           // Fallback sur le prix IPO si avgCost manquant

totalVal = cash + portVal

pl       = portVal - invested

plPct    = invested > 0 ? pctOf(portVal, invested) : 0
           où pctOf(price, initial) = ((price - initial) / initial × 100).toFixed(1)

positions = nombre d'entrées dans portfolio avec qty > 0
```
- Source : `components/mechanics/usePortfolioTotals.ts:49–64`

**`pctOf(price, initial)` :**
```
pctOf = parseFloat(((price - initial) / initial × 100).toFixed(1))
```
- Source : `game-engine/src/initState.ts:46–48`
- Arrondi à 1 décimale, retourné en `number`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `usePortfolioTotals` | `components/mechanics/usePortfolioTotals.ts:40` | Hook de calcul des totaux du portfolio |
| `pctOf` | `game-engine/src/initState.ts:46` | Variation % depuis un prix de référence |

---

### US-5.4 · Meilleur score

**Logique métier couverte :** Le best score est mis à jour après chaque journée simulée.

#### Formules & Calculs

**Mise à jour du best score (mode offline) :**
```
portVal      = Σ (qty × price) pour positions courantes
newTotal     = newCash + portVal
newBestScore = (bestScore === null || newTotal > bestScore) ? newTotal : bestScore
```
- Source : `stores/localGameStore.ts:431–433`
- Déclenché après `advanceDay()`, avant le `set()` Zustand

---

## US-6 · Calendrier des matchs

### US-6.1 / US-6.2 · Journées et matchs

**Logique métier couverte :** Construction des matchs du jour courant selon la phase (groupes vs KO). Dérivation de la clé "dynamic" pour router vers le bon slice du pool KO.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But | Usage |
|-----|-------------|--------|-----|-------|
| `CALENDAR` | 35 `CalendarDay[]` hardcodés | `packages/constants/src/index.ts:88` | Calendrier WC2026 de référence | Mode offline legacy |
| Phases valides | `'Groups'\|'R32'\|'R16'\|'QF'\|'SF'\|'3rd'\|'Final'` | `packages/types/src/index.ts:121` | Type Phase | Validation |

#### Procédures & Processus

**`buildMatchesForCurrentDay(state)` :**
1. Lit `state.dayIndex` et `state._bootstrap`
2. Appelle `getDay(bootstrap, dayIndex)` → trouve le `BootstrapDay`
3. Si `day.is_ko = false` : retourne les fixtures de groupes filtrées (éliminés exclus)
4. Si `day.is_ko = true` : appelle `deriveDynamicKey(phase, dayIndex, bootstrap)` puis `buildMatchesForDay(dynamicKey, state)`
- Source : `stores/localGameStore.ts:518–530` et `stores/onlineGameStore.ts:274–290`

**`deriveDynamicKey(phase, dayIndex, bootstrap)` :**
```
koDays = jours de la phase donnée triés par day_index
posInPhase = index du dayIndex courant parmi koDays

R32 → ['r32_28','r32_29','r32_30','r32_1','r32_2','r32_3'][posInPhase]
R16 → ['r16_1','r16_2','r16_3','r16_4'][posInPhase]
QF  → ['qf_1','qf_2','qf_3'][posInPhase]
SF  → posInPhase === 0 ? 'sf_1' : 'sf_2'
3rd → '3rd'
Final → 'final'
```
- Source : `stores/localGameStore.ts:495–515`

**`buildMatchesForDay(dynamic, state)` :**
Découpe les pools en tranches selon la clé dynamic :
```
r32_28 → r32Pool[0:4]
r32_29 → r32Pool[4:10]
r32_30 → r32Pool[10:16]
r32_1  → r32Pool[16:22]
r32_2  → r32Pool[22:26]
r32_3  → r32Pool[26:32]

r16_1  → r16Pool[0:4]
r16_2  → r16Pool[4:8]
r16_3  → r16Pool[8:12]
r16_4  → r16Pool[12:16]

qf_1   → qfPool[0:2]
qf_2   → qfPool[2:4]
qf_3   → qfPool[4:8]

sf_1   → sfPool[0:2]
sf_2   → sfPool[2:4]

3rd    → [{ a: thirdPool[0], b: thirdPool[1] }]
final  → [{ a: finalPool[0], b: finalPool[1] }]
```
- Source : `game-engine/src/buildKOMatches.ts:245–283`
- Filtre : toujours `!eliminated.includes(id)` avant d'inclure une équipe

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `buildMatchesForDay` | `game-engine/src/buildKOMatches.ts:227` | Construit les matchs d'une journée KO |
| `buildMatchesForCurrentDay` | `stores/localGameStore.ts:518` | Wrapper pour la journée courante (offline) |
| `buildMatchesForCurrentDay` | `stores/onlineGameStore.ts:274` | Wrapper pour la journée courante (online) |
| `deriveDynamicKey` | `stores/localGameStore.ts:495` | Calcule la clé "dynamic" depuis la phase |
| `getDay` | `stores/localGameStore.ts:106` | Trouve le BootstrapDay pour un dayIndex |
| `getGroupFixtures` | `stores/localGameStore.ts:112` | Filtre les fixtures de groupes par dayIndex |

---

## US-7 · Classements

### US-7.1 · Classement de groupe

**Logique métier couverte :** Calcul dynamique des standings depuis les résultats stockés.

#### Formules & Calculs

**Points par résultat :**
```
Victoire → 3 pts pour le vainqueur
Nul      → 1 pt pour chaque équipe
Défaite  → 0 pt
```

**Critères de classement (`cmp`) :**
```
1. Points décroissants (b.pts - a.pts)
2. Différence de buts décroissante ((b.gf - b.ga) - (a.gf - a.ga))
3. Buts pour décroissants (b.gf - a.gf)
4. Force FIFA décroissante (b.str - a.str) — tiebreaker final
```
- Source : `game-engine/src/buildKOMatches.ts:31–33`

**`buildGroupStandingsUI(matchResults, prices, eliminated, teams)` :**
- Accumule MP, W, D, L, GF, GA, pts pour chaque équipe
- Skip les résultats KO (`r.phase && r.phase !== 'Groups'`)
- Enrichit chaque ligne avec `price` (courant) et `initP` (initial)
- Source : `game-engine/src/buildKOMatches.ts:93–135`

**`deriveGroupStandings(matchResults, eliminated, teams)` :**
- Version simplifiée pour calculer les qualifications R32 (sans affichage)
- Source : `game-engine/src/buildKOMatches.ts:35–73`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `buildGroupStandingsUI` | `game-engine/src/buildKOMatches.ts:93` | Standings complets pour affichage (avec stats) |
| `deriveGroupStandings` | `game-engine/src/buildKOMatches.ts:35` | Standings pour calcul des qualifiés R32 |

---

## US-8 · Mode Simulation (offline)

### US-8.1 · Simuler la journée courante

**Logique métier couverte :** Simulation probabiliste d'un match basée sur la force FIFA, application des résultats sur les prix, gestion des éliminations, calcul des pools KO, distribution des dividendes, mise à jour du best score.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But | Usage |
|-----|-------------|--------|-----|-------|
| `INIT_CASH` | `10_000` KC | `packages/constants/src/index.ts:85` | Capital de départ | `initState()` |
| Prix plancher | `1` KC | `stores/localGameStore.ts:335` | Prix minimum d'une équipe éliminée | Après chaque résultat |

#### Formules & Calculs

**`simulate(strA, strB, isKO)` — probabilités de résultat :**
```
gap    = |strA - strB|
fav    = strA >= strB ? 'A' : 'B'

upsetP = max(0.05, 0.26 - gap × 0.006)   // probabilité de l'upset
drawP  = max(0.08, 0.25 - gap × 0.004)   // probabilité du nul (ignorée en KO)

r = random()

si r < upsetP                           → résultat = équipe adverse au favori
si r < upsetP + drawP                   → résultat = 'draw'
sinon                                   → résultat = fav
```
- Source : `game-engine/src/simulate.ts:7–17`

**Exemples de probabilités :**
- Équipes égales (gap=0) : upsetP=0.26, drawP=0.25 → fav=49%, draw=25%, upset=26%
- Gap de 20 : upsetP=max(0.05, 0.26-0.12)=0.14, drawP=max(0.08, 0.25-0.08)=0.17 → fav=69%, draw=17%, upset=14%
- Gap de 55 : upsetP=max(0.05, 0.26-0.33)=0.05, drawP=max(0.08, 0.25-0.22)=0.08 → fav=87%, draw=8%, upset=5%

**Prolongations en KO (si nul à 90min) :**
```
Probabilité de résolution en ET : 60%
Si ET :
  etFav  = strA >= strB ? 'A' : 'B'
  etUpset = max(0.08, 0.35 - gap × 0.008)
  etR = random()
  etRes = etR < etUpset ? adversaire(etFav) : etFav

Probabilité de tirs au but : 40%
Si PEN :
  pour i in 0..4 :
    pA += random() < (0.73 + strA × 0.001) ? 1 : 0
    pB += random() < (0.73 + strB × 0.001) ? 1 : 0
  // Mort subite si égalité après 5 tirs
  while pA === pB AND round < 10 :
    pA += random() < 0.73 ? 1 : 0
    pB += random() < 0.73 ? 1 : 0
    round++
  penWinner = pA > pB ? 'A' : 'B'
```
- Source : `game-engine/src/simulate.ts:23–45`

**Résultat final (priorité) :**
```
finalRes = penWinner ?? etRes ?? (res90 === 'draw' && isKO ? fav : res90)
```
- Source : `game-engine/src/simulate.ts:47–50`

**Détection d'upset :**
```
isUpset = finalRes !== 'draw' AND finalRes !== fav AND gap > 8
```
- Source : `game-engine/src/simulate.ts:55`
- Note : le seuil dans `simulate.ts` est `gap > 8`, mais dans `process-real-result.ts` (vrais résultats) le seuil est `gap > 5`. **Incohérence entre les deux modes.**

**`applyResult(pA, pB, res)` — variation de prix :**
```
Victoire A :
  nA = pA + pB × 0.5
  nB = pB × 0.5

Victoire B :
  nB = pB + pA × 0.5
  nA = pA × 0.5

Nul :
  nA = pA + pB × 0.25
  nB = pB + pA × 0.25

Arrondi : round(n × 10) / 10  (1 décimale)
```
- Source : `game-engine/src/applyResult.ts:6–25`
- Prix plancher appliqué après : `Math.max(1, rawP)`

**Exemples (tirés des tests) :**
- `applyResult(100, 100, 'A')` → `[150, 50]`
- `applyResult(100, 100, 'draw')` → `[125, 125]`
- `applyResult(200, 50, 'A')` → `[225, 25]` (200 + 50×0.5 = 225 ; 50×0.5 = 25)
- `applyResult(1000, 10, 'A')` → `[1005, 5]` (plancher = 1 n'est pas atteint ici)

**Génération du score (`genScore`) :**
```
Nul en groupes :
  g = random() dans {0, 1, 2}
  → [g, g]

Match KO allant aux prolongations (res90 = 'draw', etRes défini) :
  g = random() dans {0, 1, 2}   // buts à 90min
  si etRes = 'A' → [g+1, g]
  si etRes = 'B' → [g, g+1]

Match KO aux tirs au but (res90 = 'draw', penWinner défini) :
  g = random() dans {0, 1, 2}   // buts à 90min
  → [g, g]    // le score reste égal, les pens décident

Résultat décisif à 90min :
  loser  = random() dans {0, 1, 2}
  winner = loser + 1 + random() dans {0, 1}
  si res = 'A' → [winner, loser], sinon [loser, winner]
```
- Source : `game-engine/src/genScore.ts:6–34`

#### Procédures & Processus

**Séquence complète `advanceDay()` (localGameStore) :**

1. Charge bootstrap si absent
2. Trouve `BootstrapDay` pour `dayIndex` courant → si null, tournoi terminé
3. Construit les matchs du jour (`buildMatchesForDay` ou fixtures groupes filtrées)
4. Si `is_ko` et `todayMatches.length === 0` → incrémente `dayIndex` sans résultats
5. Pour chaque match :
   a. Lit prix courant `pA`, `pB`
   b. `simulate(strA, strB, isKO)` → `sim`
   c. `applyResult(pA, pB, sim.res)` → `[rawPA, rawPB]`
   d. `newPA = max(1, rawPA)`, `newPB = max(1, rawPB)`
   e. `genScore(...)` → `[scoreA, scoreB]`
   f. `genGoals(...)` → `goals[]`
   g. Détermine `winnerId`, `loserId`, `elimId`
   h. Si `elimId` : `newPrices[elimId] = 1` + liquidation holdings
   i. Si phase `'3rd'` et `loserId` : also éliminé
   j. Flash `'fu'` si prix monte, `'fd'` si baisse
6. Si dernier jour de groupes et `r32Pool` vide → `buildR32Pool(allResults, newElim, teams)`
   - Équipes non qualifiées → éliminées + prix = 1
7. Pour chaque résultat KO :
   - Ajoute `winnerId` au pool de la prochaine phase
   - Si SF : `loserId` → `thirdPool`
   - Si Final : `champion = winnerId`
   - Si `day.div_key` défini → calcule et crédite les dividendes
8. Champion : dividende `'champion'` à 60%
9. Incrémente `dayIndex`
10. Met à jour `priceHistory` (append prix courant)
11. Calcule `newBestScore = max(bestScore, cash + portVal)`
12. Persiste en Zustand + localStorage (partialize)
13. Si utilisateur connecté → écrit dans `user_game_states` avec délai 5s (debounce)

- Source : `stores/localGameStore.ts:282–456`

**Élimination des non-qualifiés après groupes :**
```typescript
const qualified = new Set(newR32Pool.filter(Boolean));
for (const t of _teams) {
  if (!qualified.has(t.id) && !newElim.includes(t.id)) {
    newElim.push(t.id);
    newPrices[t.id] = 1;
    flash[t.id] = 'fd';
  }
}
```
- Source : `stores/localGameStore.ts:383–387`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `simulate` | `game-engine/src/simulate.ts:7` | Génère le résultat probabiliste |
| `applyResult` | `game-engine/src/applyResult.ts:6` | Calcule les nouveaux prix |
| `genScore` | `game-engine/src/genScore.ts:5` | Génère un score réaliste |
| `genGoals` | `game-engine/src/genGoals.ts:8` | Génère les événements de buts avec minutes |
| `buildR32Pool` | `game-engine/src/buildKOMatches.ts:139` | Construit le pool des 32 qualifiés |
| `calcDividend` | `game-engine/src/calcDividends.ts:7` | Calcule les dividendes par part |
| `advanceDay` | `stores/localGameStore.ts:282` | Orchestration complète (offline) |

---

### US-8.2 · Animation des résultats

**Logique métier couverte :** Les durées d'animation sont des constantes métier qui définissent le rythme de l'expérience.

#### Constantes & Variables

| Nom | Valeur | Source | But |
|-----|--------|--------|-----|
| `anim.play` | `9000` ms | `packages/constants/src/tokens.ts:46` | Durée d'animation d'un match |
| `anim.et` | `5000` ms | `packages/constants/src/tokens.ts:47` | Durée animation prolongations |
| `anim.stinger` | `1500` ms | `packages/constants/src/tokens.ts:48` | Durée du stinger UPSET |
| `anim.penKick` | `900` ms | `packages/constants/src/tokens.ts:49` | Durée animation par tir au but |
| `anim.penDecided` | `300` ms | `packages/constants/src/tokens.ts:50` | Délai après décision penalty |
| `anim.resultIn` | `400` ms | `packages/constants/src/tokens.ts:51` | Délai d'affichage résultat |

---

### US-8.4 · Recommencer une partie

**Logique métier couverte :** Reset complet du state en préservant le best score.

#### Procédures & Processus

**`resetGame()` (localGameStore) :**
```typescript
set({
  ...baseState(),     // cash=10000, portfolio={}, avgCost={}, dayIndex=0, ...
  prices:       emptyPrices(_teams),    // prix initiaux depuis bootstrap
  priceHistory: emptyHistory(_teams),  // un seul point par équipe = prix initial
  loading: false, syncing: false, error: null, _pollId: null,
});
```
- Source : `stores/localGameStore.ts:459–466`
- **Le `bestScore` est réinitialisé à `null`** dans `baseState()` — il n'est PAS conservé.
- Contrairement à ce qu'indique la US-8.4 ("le meilleur score précédent est conservé"), le code réinitialise `bestScore: null` dans `baseState()`. L'historique de best score survit via la colonne `best_score` de la table `portfolios` côté serveur, mais localement il est perdu.

---

### US-8.5 · Avancement automatique en phase KO

**Logique métier couverte :** Construction du pool R32 depuis les standings de groupe.

**`buildR32Pool(matchResults, eliminated, teams)` — algorithme WC2026 :**

1. Calcule `deriveGroupStandings` pour tous les groupes A–L
2. Identifie les 3èmes de chaque groupe
3. Trie les 12 troisièmes par points/GD/GF/force → garde les 8 meilleurs
4. Applique les pairings officiels FIFA 2026 (16 matchs, 32 équipes) :
   ```
   Match 1 : winner(A) vs 3ème parmi {C,E,F,H,I}
   Match 2 : winner(B) vs 3ème parmi {E,F,G,I,J}
   Match 3 : runner(A) vs runner(B)
   Match 4 : winner(C) vs runner(F)
   Match 5 : winner(D) vs 3ème parmi {B,E,F,I,J}
   Match 6 : winner(E) vs 3ème parmi {A,B,C,D,F}
   Match 7 : runner(C) vs winner(F)
   Match 8 : runner(D) vs runner(G)
   Match 9 : runner(E) vs runner(I)
   Match 10: winner(G) vs 3ème parmi {A,E,H,I,J}
   Match 11: winner(H) vs runner(J)
   Match 12: runner(K) vs runner(L)
   Match 13: winner(I) vs 3ème parmi {C,D,F,G,H}
   Match 14: winner(J) vs runner(H)
   Match 15: winner(K) vs 3ème parmi {D,E,I,J,L}
   Match 16: winner(L) vs 3ème parmi {E,H,I,J,K}
   ```
5. Les slots null (si pas assez de 3èmes qualifiés) sont remplis avec les meilleures équipes non-éliminées par force FIFA
- Source : `game-engine/src/buildKOMatches.ts:139–222`

**Note :** Cette logique WC2026-spécifique est dans `buildKOMatches.ts` (mode offline). Le mode online (live) utilise `buildKOQualifiers` qui est competition-agnostique.

---

## US-9 · Mode Live (online)

### US-9.3 · Mises à jour de prix en temps réel

**Logique métier couverte :** Le store online écoute Supabase Realtime et se resynchronise sur changement.

#### Constantes & Variables

| Nom | Valeur/Type | Source | But |
|-----|-------------|--------|-----|
| Canal Realtime | `ks_game_state_{competitionId}` | `stores/onlineGameStore.ts:170` | Channel Supabase |
| Table écoutée | `competition_game_state` | `stores/onlineGameStore.ts:175` | Source de vérité |
| Polling fallback | `30_000` ms | `stores/onlineGameStore.ts:186` | Intervalle de resync si WS down |

#### Procédures & Processus

**`startSync()` (onlineGameStore) :**
1. Appelle `fetchState()` immédiatement
2. S'abonne à `postgres_changes` sur `competition_game_state` filtré par `competition_id`
3. Sur événement `UPDATE` : si non déjà en train de syncer → `fetchState()`
4. Lance un `setInterval` de 30s en fallback

**`fetchState()` (onlineGameStore) :**
1. `loadBootstrap()` si pas encore fait
2. `fetchGameState(deviceId, competitionId)` → appelle `GET /api/game/state`
3. Enrichit le `txLog` avec les noms/flags depuis les teams bootstrapées
4. Merge le state complet dans Zustand
5. Si réponse `304 Not Modified` → `set({ loading: false })` sans changement de data
- Source : `stores/onlineGameStore.ts:131–159`

**ETag pour éviter les re-renders inutiles :**
```
etag = `"c${competitionId}-d${current_day_index}-p${portfolioId}"`
```
- Si `If-None-Match === etag` → 304 Not Modified
- Source : `app/api/game/state/route.ts:191–194`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `startSync` | `stores/onlineGameStore.ts:162` | Démarre Realtime + polling |
| `fetchState` | `stores/onlineGameStore.ts:131` | Resynchronise depuis le serveur |
| `GET /api/game/state` | `app/api/game/state/route.ts:22` | Endpoint complet état du jeu + portfolio |

---

### US-9.5 · Avancement automatique de phase

**Logique métier couverte :** Le serveur avance la compétition au prochain jour après traitement de tous les matchs.

**`checkAndAdvancePhase(competitionId)` :**

1. Lit `competition_game_state` pour la compétition
2. Compte les matchs non traités du jour (`processed_at IS NULL` et status non annulé)
3. Si `pending > 0` → retour immédiat (toutes les journées ne sont pas finies)
4. Charge les résultats d'aujourd'hui
5. Met à jour les pools KO depuis les résultats :
   - R32 winner → r16Pool
   - R16 winner → qfPool
   - QF winner → sfPool
   - SF winner → finalPool, SF loser → thirdPool
   - Final winner → champion_id, Final loser → eliminated
   - Loser KO (sauf SF, 3rd) → eliminated
6. Si phase "Groups" et **tous les matchs de groupes** sont terminés :
   - Charge tous les résultats de groupes
   - Appelle `buildKOQualifiers(competitionId, allGroupResults, eliminated, nextPhase)`
   - Remplit r32Pool ou r16Pool selon la phase suivante
   - Liquide les non-qualifiés via `liquidate_competition_eliminated`
7. Incrémente `current_day_index`, met à jour `current_phase`
8. Persiste dans `competition_game_state`

- Source : `lib/check-advance-phase.ts:17–179`

**`buildKOQualifiers(competitionId, allGroupResults, eliminated, nextPhase)` (competition-agnostique) :**

1. Compte les slots disponibles : `totalSpots = matchCount × 2` (où `matchCount` = nombre de matchs KO de la phase suivante en DB)
2. Charge teams + groupes depuis `competition_teams`
3. Calcule standings de groupes (pts / GD / GF / force)
4. Top-2 de chaque groupe → qualifiers
5. Candidates 3èmes → triées par `cmp` → sliced sur `remaining = totalSpots - qualifiers.length`
6. Équipes non-qualifiées → newEliminated

- Source : `lib/ko-qualifiers.ts:27–117`
- Clé différence avec le mode offline : **le nombre de spots est dérivé de la DB**, pas hardcodé (fonctionne pour WC2022 à 16 équipes et WC2026 à 32 équipes).

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `checkAndAdvancePhase` | `lib/check-advance-phase.ts:17` | Avancement competition après chaque résultat |
| `buildKOQualifiers` | `lib/ko-qualifiers.ts:27` | Calcul qualifiés KO (competition-agnostique) |

---

## US-10 → US-11 · Dividendes & Mécanique de prix

### US-10.1 · Impact d'un résultat sur les prix

Voir formule `applyResult` dans la section US-8.1.

**Rappel des règles de prix :**
- Victoire A : `nA = pA + pB × 0.5` ; `nB = pB × 0.5`
- Victoire B : `nB = pB + pA × 0.5` ; `nA = pA × 0.5`
- Nul : `nA = pA + pB × 0.25` ; `nB = pB + pA × 0.25`
- Plancher : `max(1, rawP)` après chaque calcul
- Arrondi : `round(n × 10) / 10`

**Cas limite particulier :** Si une équipe a prix 1 KC (plancher = éliminée) et joue encore (cas 3rd place), le calcul est :
- `applyResult(1, pB, 'B')` → `nA = 1 × 0.5 = 0.5` → `max(1, 0.5) = 1`
- Le plancher à 1 KC empêche de descendre sous 1 KC même lors d'une défaite

---

### US-10.2 · Dividendes à chaque qualification KO

**Logique métier couverte :** Taux de dividendes par round, formule de calcul, versement atomique.

#### Constantes & Variables

| `div_key` | Taux (`DIV_RATES`) | Source | Round |
|-----------|-------------------|--------|-------|
| `r32` | `0.10` (10%) | `packages/constants/src/index.ts:82` | R32 (huitièmes) |
| `r16` | `0.15` (15%) | idem | R16 (seizièmes) |
| `qf` | `0.20` (20%) | idem | Quarts |
| `sf` | `0.30` (30%) | idem | Demis |
| `final` | `0.40` (40%) | idem | Finaliste (perdant de finale inclus) |
| `champion` | `0.60` (60%) | idem | Champion |

#### Formules & Calculs

**`calcDividend(currentPrice, divKey)` :**
```
rate = DIV_RATES[divKey] ?? 0
dividend_per_share = round(currentPrice × rate × 10) / 10
```
- Source : `game-engine/src/calcDividends.ts:7–13`
- Calculé sur le **prix post-match** (après `applyResult`)

**Dividende total pour un joueur :**
```
divCash = round(divPerShare × qty × 10) / 10
```
- Source : `stores/localGameStore.ts:407`

**Dividendes au mode live (`distribute_competition_dividends`) :**
```sql
v_amount = ROUND(quantity × p_price × p_rate, 1)
UPDATE portfolios SET cash = cash + v_amount
```
- Source : `db/migrations/012:366`
- Idempotent via contrainte UNIQUE `(portfolio_id, competition_id, nation_id, round)`

**Cas spéciaux :**
1. **Finaliste perdant** : reçoit le taux `'final'` (40%) — même chose que le gagnant de la finale
   - Source : `stores/localGameStore.ts:412–415` et `app/api/game/advance/route.ts:316–326`
2. **Champion** : reçoit en PLUS le taux `'champion'` (60%) après le dividende final (40%)
   - Source : `stores/localGameStore.ts:419–422` et `app/api/game/advance/route.ts:328–336`
   - Total potentiel pour le champion : 40% (final) + 60% (champion) = 100% du prix post-match

**`div_key` = null pour la phase 3rd :** Le match pour la 3ème place ne distribue pas de dividendes.
- Source : `lib/normalizer.ts:86` (`PHASE_TO_DIV['3rd'] = null`)

**Paiement au mode offline (advanceDay) :**
Dividendes calculés et crédités en mémoire dans la même passe que `applyResult`, avant le `set()` final.

**Paiement au mode live (processRealMatchResult + distribute_competition_dividends) :**
```
rate = DIV_RATES[day.div_key] ?? 0
si rate > 0 et winnerId défini → RPC distribute_competition_dividends(...)
```
- Source : `lib/process-real-result.ts:145–157`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `calcDividend` | `game-engine/src/calcDividends.ts:7` | Calcule dividende par part |
| `distribute_competition_dividends` | `db/migrations/012:342` | RPC SQL : verse dividendes à tous les holders |
| `distribute_dividends` | `db/migrations/005:481` | RPC SQL legacy (mode pré-multi-compétition) |

---

### US-10.3 · Identification des upsets

**Logique métier couverte :** Deux définitions d'upset coexistent selon le mode :

**Mode simulation (`simulate.ts`) :**
```
isUpset = finalRes !== 'draw' AND finalRes !== fav AND gap > 8
```
- Seuil : écart de force FIFA **strictement supérieur à 8**
- Source : `game-engine/src/simulate.ts:55`

**Mode live (`process-real-result.ts`) :**
```
isUpset = result !== 'draw' AND result !== favoured AND gap > 5
```
- Seuil : écart de force FIFA **strictement supérieur à 5**
- Source : `lib/process-real-result.ts:51–56`

**Note :** La définition dans les User Stories (US-10.3) spécifie "écart de force FIFA > 5 points". Le mode simulation utilise > 8. Cette incohérence signifie que les upsets sont moins fréquents en simulation qu'en mode live.

---

## US-12 · Fiche Équipe (Nation Detail)

### US-11.2 · Historique de prix sous forme de graphique

**Logique métier couverte :** La `priceHistory` est construite progressivement.

**Initialisation :**
```typescript
priceHistory[id] = [t.initialPrice]  // un seul point : le prix initial
```
- Source : `game-engine/src/initState.ts:19–22`

**Append après chaque journée :**
```typescript
for (const [id, price] of Object.entries(newPrices)) {
  newPriceHistory[id] = [...(newPriceHistory[id] ?? []), price];
}
```
- Source : `stores/localGameStore.ts:427–429`
- Structure : tableau indexé par ordre d'ajout (pas par `dayIndex` explicitement)

**Mode online :** La price history est reconstruite depuis `competition_prices` (table versionnée) :
```typescript
priceHistory[row.team_id][row.day_index] = row.price;
```
- Source : `app/api/game/state/route.ts:142–145`
- Structure : tableau indexé par `day_index` (peut avoir des trous si un jour n'a pas de prix)

---

### US-11.4 · Position sur l'équipe (P&L par position)

**Logique métier couverte :** Calcul du P&L individuel par équipe.

**Formule P&L par équipe :**
```
valeur_actuelle = qty × currentPrice
cout_moyen      = avgCost[id] ?? initialPrice
investissement  = qty × cout_moyen
pl_position     = valeur_actuelle - investissement
pl_pct_position = ((valeur_actuelle / investissement) - 1) × 100
```
- Non encapsulé dans un hook dédié, calculé inline dans les composants de portfolio.

---

## US-13 · Leaderboard

### US-12.1 · Classement global

**Logique métier couverte :** Le leaderboard est une vue SQL qui agrège les meilleures performances.

#### Constantes & Variables

| Nom | Valeur | Source | But |
|-----|--------|--------|-----|
| Limite | `20` | `hooks/useLeaderboard.ts:14` | Nombre d'entrées affichées |
| Intervalle refresh | `30_000` ms | `hooks/useLeaderboard.ts:32` | Polling toutes les 30s |

#### Vue SQL `leaderboard` (migration 005) :
```sql
SELECT
  p.id,
  COALESCE(pr.username, 'Anonyme') AS username,
  pr.country,
  p.best_score,
  p.updated_at
FROM portfolios p
LEFT JOIN profiles pr ON pr.id = p.user_id
WHERE p.best_score IS NOT NULL
ORDER BY p.best_score DESC
```
- Source : `db/migrations/005_centralized_engine.sql:563–573`
- Le classement est basé sur `portfolios.best_score` (non scopé par compétition dans la vue legacy)

#### Procédures & Processus

**Synchronisation du best score côté offline :**
```typescript
// À chaque advanceDay :
if (newBestScore !== s.bestScore) syncBestScore(newBestScore).catch(() => {});

// Au startSync (toutes les 60s) :
const id = setInterval(() => {
  const { bestScore: bs } = get();
  if (bs) syncBestScore(bs).catch(() => {});
}, 60_000);
```
- Source : `stores/localGameStore.ts:445`, `stores/localGameStore.ts:207–211`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `useLeaderboard` | `hooks/useLeaderboard.ts:14` | Hook : charge et rafraîchit le leaderboard |

---

## US-14 · Onboarding UX — Tutorial & Coach Marks

**Logique métier couverte :** La logique métier des coach marks se limite à savoir si le tutorial a été vu (clé localStorage) et à identifier quels éléments d'interface sont requis (via `REQUIRED_MECHANICS`).

#### Constantes & Variables

| Nom | Valeur/Type | Source | But |
|-----|-------------|--------|-----|
| `REQUIRED_MECHANICS` | `MechanicsContract` (toutes keys = true) | `packages/types/src/index.ts:227–237` | Contrat d'interface requis |

**Contrat de mécanique (`REQUIRED_MECHANICS`) :**
```typescript
{
  canViewNationPrice: true,
  canBuy:             true,
  canSell:            true,
  canViewPortfolio:   true,
  canViewCash:        true,
  canViewPnL:         true,
  canSimulate:        true,
  canViewStandings:   true,
  canViewSchedule:    true,
}
```
- Source : `packages/types/src/index.ts:227–237`
- 9 mécaniques core, toutes obligatoires sur mobile et desktop

**`useValidateMechanics(provided, shellName)` :**
- En développement uniquement (`process.env.NODE_ENV !== 'development'`)
- Logue un warning pour toute mécanique `false` ou absente
- Source : `hooks/useValidateMechanics.ts:26–45`

---

## US-15 · UI Shell — Mobile & Desktop

### US-14.1 · Navigation mobile

#### Constantes & Variables

| Nom | Valeur | Source | But |
|-----|--------|--------|-----|
| `MOBILE_BREAKPOINT` | `600` px | `packages/constants/src/index.ts:25` | Seuil de bascule mobile/desktop |

---

## US-16 · Administration — Gestion des compétitions

### US-16.3 · Calendrier des matchs (sync fixtures)

**Logique métier couverte :** Normalisation des données API-Football vers le modèle KickStock.

#### Constantes & Variables

| Nom | Valeur | Source | But |
|-----|--------|--------|-----|
| `PHASE_TO_DIV` | `{ Groups: null, R32: 'r32', R16: 'r16', QF: 'qf', SF: 'sf', '3rd': null, Final: 'final' }` | `lib/normalizer.ts:79–87` | Règle métier : div_key par phase | Dérivation à l'import |
| Fuseau horaire de référence | `'America/New_York'` (ET, UTC-5) | `lib/normalizer.ts:122` | Calcul du day_index | Journée américaine |
| Heure de début de journée | `T05:00:00Z` (minuit ET = 05h UTC) | `lib/normalizer.ts:123` | Frontière de journée | Calcul day_index |

#### Formules & Calculs

**`calcDayIndex(fixtureDate, startDate)` :**
```
start = new Date(`${startDate}T05:00:00Z`)  // minuit ET
match = new Date(fixtureDate)
dayIndex = max(0, floor((match - start) / 86_400_000))
```
- Source : `lib/normalizer.ts:121–126`
- Exemple : fixture du 12 juin à 02h UTC = 11 juin à 21h ET → `dayIndex = 0` (même jour)

**`leagueRoundToPhase(round)` :**
```
"Group Stage - N"  → 'Groups'
"Round of 32"      → 'R32'
"Round of 16"      → 'R16'
"Quarter-finals"   → 'QF'
"Semi-finals"      → 'SF'
"3rd Place Final"  → '3rd'
"Final"            → 'Final'
autres             → round (avec warning)
```
- Source : `lib/normalizer.ts:99–110`

**`buildDayLabel(dayIndex, fixtureDate, phase)` :**
```
Groups : "Day {dayIndex+1} · {dow} {mdy}"   ex: "Day 1 · Thu Jun 11"
KO     : "{phase} · {dow} {mdy}"            ex: "R32 · Sun Jun 28"
```
- Source : `lib/normalizer.ts:145–153`

**`isoToFlagEmoji(iso2)` :**
```
Convertit ISO-2 en emoji drapeau via Unicode Regional Indicator Symbols
"BR" → 0x1F1E6 + ('B'-'A') = 🇧 + 0x1F1E6 + ('R'-'A') = 🇷 = 🇧🇷
```
- Source : `lib/normalizer.ts:161–165`

**Golden rule `upsert_fixture` :** Le cron `sync-fixtures` ne peut jamais écraser `processed_at`, `score_a`, `score_b`, `trade_lock_until`, `result_data`. Ces colonnes sont protégées par la clause `DO UPDATE SET` explicite.
- Source : `db/migrations/010:191–217`

#### Procédures & Processus

**Séquence sync-fixtures (pour chaque fixture API) :**
1. `normalizeFixture(fixture, competition)` → construit 6 objets DB
2. Upsert `teams` (sans toucher `strength` — configuré par admin)
3. Upsert `competition_teams` (`group_code` uniquement — pas `initial_price`)
4. Upsert `competition_days`
5. RPC `upsert_fixture` (protège les scores/résultats)
6. Update `competitions.last_sync_at`
- Source : `app/api/cron/sync-fixtures/route.ts:80–146`

#### Fonctions impliquées

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `normalizeFixture` | `lib/normalizer.ts:197` | Transforme fixture API → payloads DB |
| `leagueRoundToPhase` | `lib/normalizer.ts:99` | Mappe label API → phase KickStock |
| `calcDayIndex` | `lib/normalizer.ts:121` | Calcule day_index depuis les dates |
| `buildDayLabel` | `lib/normalizer.ts:145` | Construit le label humain du jour |
| `isoToFlagEmoji` | `lib/normalizer.ts:161` | Génère l'emoji drapeau |
| `upsert_fixture` | `db/migrations/010:178` | RPC SQL : upsert sécurisé (protège scores) |
| `GET /api/cron/sync-fixtures` | `app/api/cron/sync-fixtures/route.ts:33` | Cron d'import des fixtures |

---

### US-16.1 · Création de compétition — auto-chain

**Logique métier couverte :** La création enchaîne automatiquement 3 appels séquentiels côté client avec retour visuel par étape. Si l'import des équipes échoue, le sync des fixtures part quand même (non-bloquant).

#### Procédures & Processus

**Séquence dans `/admin/competitions/new/page.tsx` (client) :**
```
1. POST /api/admin/competitions → { id }
   Champs requis : name, season, league_id (start_date/end_date retirés)
   Initialise competition + competition_game_state

2. POST /api/admin/competitions/{id}/import-teams
   Fetch API-Football /teams?league={league_id}&season={season}
   + fetch /teams/rankings/fifa (force FIFA)
   Upsert teams + competition_teams (initial_price = strength × 1.5)
   Non-bloquant : erreur n'arrête pas l'étape suivante

3. POST /api/admin/competitions/{id}/sync { type: 'fixtures' }
   Proxy admin → GET /api/cron/sync-fixtures (CRON_SECRET côté serveur)
   Peuple matches + competition_days
```

**Note start_date :** le champ `start_date` a été retiré du formulaire. `sync-fixtures` dérive `start_date` depuis le premier fixture retourné par l'API (voir `derivedStartDate` dans le cron). Le fallback DB est utilisé uniquement s'il n'y a aucun fixture disponible.

---

### US-16.6 · Import des équipes

**Logique métier couverte :** `import-teams` upsert les teams avec force FIFA et prix dérivé.

#### Formules & Calculs

**Prix initial (`initial_price`) :**
```
initial_price = round(strength × 1.5)
// Ex : strength=100 → 150 KC · strength=75 → 112 KC · strength=50 → 75 KC
```
- Source : `app/api/admin/competitions/[id]/import-teams/route.ts:87`

**Fallback force :**
```
strength = strengthMap.get(apiTeamId) ?? 75
```
Si le ranking FIFA ne retourne pas l'équipe (ex: équipe non FIFA), force par défaut = 75.

**Idempotence :** `upsert` sur `(competition_id, team_id)` — safe à relancer.

---

### US-16.9 · Boutons API admin

**Logique métier couverte :** Tous les calls API-Football sont déclenchables manuellement depuis l'UI admin via des boutons dans `CompetitionActions.tsx`. Le CRON_SECRET ne transite jamais côté client.

#### Routes & Sécurité

| Bouton | Route côté client | Route côté serveur | Auth |
|--------|------------------|--------------------|------|
| IMPORT TEAMS | `POST /api/admin/.../import-teams` | API-Football direct | user.role=admin |
| SYNC FIXTURES | `POST /api/admin/.../sync {type:'fixtures'}` | `GET /api/cron/sync-fixtures` | user.role=admin → CRON_SECRET serveur |
| SYNC RESULTS | `POST /api/admin/.../sync {type:'results'}` | `GET /api/cron/sync-results` | idem |
| SYNC SQUADS | `POST /api/admin/.../sync {type:'squads'}` | `GET /api/cron/sync-squads` | idem |

**Correction sécurité (2026-06-03) :** L'ancienne implémentation de `syncFixtures()` appelait `/api/cron/sync-fixtures` directement avec `Authorization: Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET}`, exposant le secret dans le bundle client. Corrigé : tous les syncs passent désormais par `/api/admin/.../sync` qui garde le `CRON_SECRET` côté serveur.

---

### US-16.10 · Édition d'un match

**Logique métier couverte :** Modification manuelle des attributs d'un match pour corriger les données API.

#### Route

```
PATCH /api/admin/competitions/[id]/matches/[fixture_id]
Body: { scheduled_at?, score_a?, score_b?, api_status? }
```
- Auth : `user.app_metadata?.role === 'admin'`
- Scope : le match doit appartenir à la compétition (`competition_id` vérifié)
- `scheduled_at` : converti en ISO 8601 UTC côté client (`new Date(localDatetime).toISOString()`)
- `api_status` valeurs acceptées : `NS`, `1H`, `HT`, `2H`, `ET`, `PEN`, `FT`, `AET`, `PST`, `CANC`

**Cas d'usage principal :** corriger une date erronée ou décalée retournée par l'API-Football, ou forcer manuellement un score pour les tests.

**Limite actuelle :** aucune confirmation demandée si le match a déjà un `processed_at` (déjà traité en DB).

---

### US-16.7 · Simuler une journée depuis l'admin

**Logique métier couverte :** `simulate-day` reproduit intégralement le pipeline du mode live (résultat simulé → prix → liquidation → dividendes → avancement).

#### Procédures & Processus

**`POST /api/admin/simulate-day` :**
1. Auth : `Authorization: Bearer {CRON_SECRET}`
2. Lit `competition_game_state` pour `current_day_index`
3. Charge matchs non traités du jour
4. Pour chaque match :
   a. `simulate(strA, strB, isKO)` → probabiliste
   b. `applyResult(pA, pB, sim.res)` → nouveaux prix
   c. `genScore` + `genGoals` → résultats visuels
   d. RPC `update_competition_prices`
   e. Si `elimId` : RPC `liquidate_competition_eliminated`
   f. Si `is_ko` et `div_key` : RPC `distribute_competition_dividends`
   g. `UPDATE matches SET processed_at=now, trade_lock_until=now+15min, api_status='FT'`
5. `checkAndAdvancePhase(competitionId)` → avancement + pools KO
- Source : `app/api/admin/simulate-day/route.ts:34–218`

**`trade_lock_until` en simulate-day :**
```
trade_lock_until = now + 15 minutes
```
- Source : `app/api/admin/simulate-day/route.ts:183`
- Identique à `processRealMatchResult`

---

## US-17 · Infrastructure & Monitoring

### US-17.1 · Synchronisation des résultats réels

**Logique métier couverte :** Pipeline complet de traitement d'un vrai résultat API-Football.

#### Constantes & Variables

| Nom | Valeur | Source | But |
|-----|--------|--------|-----|
| Statuts terminés | `'FT'`, `'AET'`, `'PEN'` | Implicite via `fetchFinishedFixtures` | Résultats à traiter |
| Statuts ignorés | `'PST'`, `'SUSP'`, `'CANC'`, `'ABD'` | `lib/match-window.ts:39`, `lib/check-advance-phase.ts:45` | Matchs non jouables |
| Fenêtre active | `±3h` autour de now | `lib/match-window.ts:29–30` | Guard du cron |
| Force par défaut | `75` | `lib/process-real-result.ts:89–90` | Strength si non trouvée en DB |

#### Formules & Calculs

**`isMatchWindowActive(competitionIds)` :**
```
start = now - 3h
end   = now + 3h

COUNT matches WHERE :
  competition_id IN competitionIds
  AND processed_at IS NULL
  AND api_status NOT IN ('PST','SUSP','CANC','ABD')
  AND scheduled_at BETWEEN start AND end

→ active = count > 0
```
- Source : `lib/match-window.ts:24–49`
- Justification du ±3h : 90min match + 30min ET + 30min buffer + 60min marge = ~3h10

**`determineResult(fixture)` :**
```
si api_status = 'PEN' :
  penHome > penAway → 'A'
  penAway > penHome → 'B'

sinon (FT/AET) :
  goals.home > goals.away → 'A'
  goals.away > goals.home → 'B'
  égalité → 'draw'
```
- Source : `lib/process-real-result.ts:35–48`
- Note : pour `AET` (prolongations sans penalties), le résultat est déterminé par les buts totaux (90+ET).

#### Procédures & Processus

**`processRealMatchResult(fixtureId, fixture)` :**
1. Charge le match depuis DB (`fixture_id = fixtureId`)
2. Idempotence : si `processed_at != null` → retour `false`
3. Charge la force des 2 équipes (`teams.strength`)
4. `determineResult(fixture)` → résultat
5. `detectUpset(result, strA, strB)` → upset si `gap > 5` et perdant favori
6. Charge prix courants depuis `competition_teams`
7. `applyResult(pA, pB, res)` → nouveaux prix (plancher 1)
8. RPC `update_competition_prices` (prices + historique)
9. Si KO (et pas SF ni 3rd) et `loserId` : RPC `liquidate_competition_eliminated`
10. Charge `div_key` depuis `competition_days`
11. Si `div_key` et `winnerId` : RPC `distribute_competition_dividends(rate = DIV_RATES[div_key])`
12. Marque le match :
    - `score_a = fixture.goals.home`
    - `score_b = fixture.goals.away`
    - `winner_id, is_upset, played_at, processed_at = now`
    - `trade_lock_until = now + 15min`
    - `api_status = fixture.fixture.status.short`
    - `result_data = { a, b, scoreA, scoreB, res, res90, isUpset, pA, pB, newPA, newPB, elimId, winnerId, loserId, etRes, penWinner, penA, penB, divCash, phase }`
- Source : `lib/process-real-result.ts:58–209`

**Séquence cron `sync-results` :**
```
GET /api/cron/sync-results
  ↓ Auth CRON_SECRET
  ↓ Charger compétitions actives
  ↓ isMatchWindowActive(compIds)
    → false : exit (0 appel API)
    → true :
      ↓ fetchFinishedFixtures(leagueIds, season)
      ↓ pour chaque fixture :
          processRealMatchResult(fixtureId, fixture)
      ↓ pour chaque competition :
          checkAndAdvancePhase(compId)
```
- Source : `app/api/cron/sync-results/route.ts:32–111`

---

### US-17.2 · Isolation multi-compétition

**Logique métier couverte :** Toutes les tables de données de jeu sont scopées par `competition_id`.

**Tables scopées par `competition_id` :**
- `competition_game_state` (PK = `competition_id`)
- `competition_teams` (PK composite `competition_id, team_id`)
- `competition_days` (UNIQUE `competition_id, day_index`)
- `competition_prices` (UNIQUE `competition_id, team_id, day_index`)
- `portfolios` (colonne `competition_id`)
- `holdings` (colonne `competition_id`)
- `transactions` (colonne `competition_id`)
- `dividends` (colonne `competition_id`)
- `matches` (colonne `competition_id`)

**RPC authoritative :** `execute_competition_trade` lit les prix depuis `competition_teams` (scopé) et l'état depuis `competition_game_state` (scopé).

---

## SQL — RPCs et triggers non liés à une US spécifique

### Trigger `sync_nation_current_price` (migration 005)

```sql
CREATE TRIGGER trg_sync_nation_price
  AFTER INSERT OR UPDATE ON nation_prices
  FOR EACH ROW EXECUTE FUNCTION sync_nation_current_price();
```
Maintient `nations.current_price` synchronisé avec la dernière entrée `nation_prices`.
- Source : `db/migrations/005:70–81`
- **Pertinence :** Table `nations` est le schéma legacy (migration 001). La table active est `competition_teams.current_price`. Ce trigger est probablement obsolète mais inoffensif.

### RPC `get_or_create_portfolio` (migration 005)

Version legacy (non scoped par compétition) de `get_or_create_competition_portfolio`. Encore présente en DB mais remplacée par la version 012.
- Source : `db/migrations/005:268–304`

### RPC `execute_trade` (migration 005)

Version legacy du trade (sans `competition_id`). Utilise `game_state WHERE id = 1`. Encore présente en DB mais remplacée par `execute_competition_trade` (012).
- Source : `db/migrations/005:310–475`
- **Incohérence de taxe dans le legacy :** Le commentaire dit "5% group phase, 10% KO" mais le code calcule l'inverse : `CASE WHEN v_is_cap THEN 0.05 ELSE 0.10 END` où `v_is_cap = (current_day_index <= 22)`. Donc : cap = groupes + R32 = 5%, hors cap = KO avancé = 10%. Ce qui est logiquement inversé par rapport aux US (groupes = 10%, KO = 5%).

### `updateCompetitionPrices` (migration 012)

Met à jour `competition_teams.current_price` et insère dans `competition_prices` (historique).
- Source : `db/migrations/012:314–337`

---

## Code non lié à une User Story

### `GET /api/market` (`app/api/market/route.ts`)

Retourne les prix initiaux hardcodés depuis `NATIONS`. Commenté comme "Phase 1". Cette route n'est plus utilisée par l'application (les prix viennent du bootstrap). Probablement à supprimer.

```typescript
const prices = Object.fromEntries(NATIONS.map(n => [n.id, n.p]));
return NextResponse.json({ prices, updatedAt: new Date().toISOString() });
```

### `SCORER_POOL` (`packages/constants/src/index.ts:126–149`)

Pool de noms de joueurs par équipe pour la génération de buts. Couvert uniquement pour 22 équipes sur 48. Les équipes absentes du pool utilisent `[nation.name]` comme fallback (le nom de l'équipe comme "joueur").

### `CALENDAR` (`packages/constants/src/index.ts:88–123`)

35 `CalendarDay[]` hardcodés WC2026. ~~Encore importé par `SimulateButton.tsx`~~ → **✅ CORRIGÉ (FIX 1, 2026-06-02)** : `SimulateButton` utilise désormais `bootstrap.days.find(d => d.day_index === dayIndex)` depuis le store. `CALENDAR` n'est plus importé par aucun composant actif. Peut être marqué comme dead code.

### `NATIONS` (`packages/constants/src/index.ts:28–77`)

48 équipes hardcodées avec leurs prix initiaux et forces FIFA. ~~Encore importé par `usePortfolioTotals.ts` comme fallback de coût moyen~~ → **✅ CORRIGÉ (FIX 7, 2026-06-02)** : `usePortfolioTotals` utilise désormais `_teams.find(t => t.id === id)?.initialPrice` depuis le bootstrap dynamique. L'import `NATIONS` a été supprimé de ce composant.

`NATIONS` reste importé par :
- `game-engine/src/buildKOMatches.ts` (fallback `resolveTeams` — legacy migration, voir section dédiée)
- `game-engine/src/initState.ts` (fallback si `teams` non fourni — legacy)

### `GROUPS` (`packages/constants/src/index.ts:79`)

```typescript
export const GROUPS = ["ALL","A","B","C","D","E","F","G","H","I","J","K","L"] as const;
```
Hardcodé WC2026 (12 groupes). Utilisé comme fallback dans `resolveGroups` si les teams n't ont pas de groupe.

### `initState(teams?)` (`game-engine/src/initState.ts:11`)

Initialise un `GameState` vide. Utilisé lors du reset offline. Le fallback `NATIONS` (si `teams` non fourni) est maintenu pour compatibilité mais commenté comme "legacy".

### `isMarketLocked` (`game-engine/src/isMarketLocked.ts`)

Stub Phase 1, toujours `false`. La logique réelle de lock est dans le RPC SQL `is_trade_locked` et la colonne `trade_lock_until`. Ce fichier est exporté mais n'a aucun impact fonctionnel.

### `fmt(v)` (`game-engine/src/initState.ts:50–52`)

```typescript
export function fmt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
```
Formate un nombre en KC avec séparateur de milliers américain (ex: `10,000`). Utilisé pour l'affichage.

### `resolveTeams` / `resolveGroups` (`game-engine/src/buildKOMatches.ts:7–19`)

Helpers internes qui permettent aux fonctions de `buildKOMatches.ts` de fonctionner avec ou sans injection de `TeamMeta[]`, en fallbackant sur `NATIONS`. Ces fonctions existent uniquement pour la période de migration.

### `writeStateToSupabase` / `getLoggedInUserId` (`stores/localGameStore.ts:31–50`)

Mécanisme de sync cross-device pour les joueurs connectés en mode offline. Persist le `GameState` Zustand dans `user_game_states` (table Supabase). Déclenché après chaque trade (debounce 5s) et après chaque `advanceDay`. Non couvert par une US spécifique.

### Trigger CAS (Compare-And-Swap) `advancing` (`app/api/game/advance/route.ts:74–83`)

```typescript
const { data: locked } = await A(admin)
  .from('competition_game_state')
  .update({ advancing: true })
  .eq('competition_id', competitionId)
  .eq('advancing', false)
  .eq('current_day_index', clientDay)
  .select('competition_id');

if (!locked || locked.length === 0) {
  return NextResponse.json({ advancing: true }, { status: 409 });
}
```
Mécanisme de verrouillage optimiste pour éviter les double-avances en mode online. Si `advancing = true` est déjà en DB, la requête de lock échoue → 409. Déclenché par `POST /api/game/advance`. Infrastructure de concurrence.

### `GET /api/game/live-matches` (`app/api/game/live-matches/route.ts`)

Fenêtre de recherche : matchs du jour calendaire local du serveur (00:00 → 23:59:59). Non scopé par compétition (prend la première compétition active). Utilisé par `LiveTab` pour afficher les statuts en direct. Retourne `trade_lock_until` pour le compte à rebours.

### `user_game_states` (migration 008)

Table JSONB pour sync cross-device en mode offline. Un blob complet par utilisateur. RLS strict (seul l'utilisateur peut lire/écrire sa ligne). Non associé à une US précise, mais supporte US-3.3 (cohérence cross-device en mode offline pour utilisateurs connectés).

---

## Récapitulatif des incohérences — État après corrections (2026-06-02, mis à jour 2026-06-02 v2)

| # | Description | Statut | Fix appliqué |
|---|-------------|--------|--------------|
| 1 | Longueur pseudo : USER_STORIES.md disait 3–16, code valide 3–20 | ✅ Résolu | USER_STORIES.md corrigé — 3–20 est la référence |
| 2 | Seuil upset : simulation `gap > 8`, live `gap > 5` | ✅ Intentionnel | Les deux modes sont délibérément différents — live suit les vrais résultats API |
| 3 | Taxe legacy RPC (migration 005) inversée groupes/KO | ⚠️ Connu, non bloquant | RPC legacy non utilisé en prod ; à nettoyer lors d'une prochaine migration SQL |
| 4 | Best score perdu au reset offline | ✅ Corrigé | FIX 9 — `resetGame()` offline préserve `bestScore` existant |
| 5 | `CALENDAR` encore utilisé dans `SimulateButton` | ✅ Corrigé | FIX 1 — `SimulateButton` lit depuis `bootstrap.days` |
| 6 | `NATIONS` fallback dans `usePortfolioTotals` | ✅ Corrigé | FIX 7 — fallback sur `_teams.find().initialPrice` |
| 7 | `isKO` : TS `dayIndex >= 17`, SQL `dayIndex <= 22` | ✅ Corrigé côté TS | FIX 8 — TS lit `bootstrap.days.is_ko` ; SQL legacy non modifié |

### Nouvelles corrections appliquées (non dans l'analyse initiale)

| # | Description | Fix | Fichiers modifiés |
|---|-------------|-----|-------------------|
| 8 | Clé persist offline commune à toutes les compétitions | FIX 3 | `localGameStore.ts` → `ks-game-state-{id}` |
| 9 | txLog flags toujours vides en mode Online | FIX 4 | `onlineGameStore.fetchState()` — suppression ré-enrichissement cassé |
| 10 | `avgCost` calculé sur prix local périmé après trade Online | FIX 5 | `api.ts` + `onlineGameStore.trade()` → `result.price` |
| 11 | `portfolio`/`avgCost` non mis à jour après `advanceDay` Online | FIX 6 | `onlineGameStore.advanceDay()` → `fetchState()` fire-and-forget |
| 12 | `resetGame` Online ne réinitialisait que le store local | FIX 2 | Nouvel endpoint `POST /api/game/reset` + `apiReset()` |
| 13 | `buildMatchesForCurrentDay`/`deriveDynamicKey` dupliqués dans les deux stores | FIX 10 | Extraits dans `lib/bootstrap.ts`, stores importent depuis là |

### Résidus techniques (non critiques, à traiter ultérieurement)

| Item | Localisation | Action recommandée |
|------|-------------|-------------------|
| `CALENDAR` export | `packages/constants/src/index.ts:88` | Supprimer ou marquer `@deprecated` — plus aucun composant actif ne l'importe |
| ~~`GET /api/market` route~~ | `app/api/market/route.ts` | **✅ SUPPRIMÉ** (NEXT_STEPS STEP 1.8) |
| `execute_trade` RPC legacy | `db/migrations/005:310` | Supprimer lors de la prochaine migration SQL de nettoyage |
| `get_or_create_portfolio` RPC legacy | `db/migrations/005:268` | Idem |
| `isMarketLocked` stub | `game-engine/src/isMarketLocked.ts` | Supprimer ou implémenter réellement depuis `trade_lock_until` |
| `resolveTeams`/`resolveGroups` | `game-engine/src/buildKOMatches.ts:7` | Fallback `NATIONS` encore présent — à supprimer quand buildKOMatches reçoit toujours `teams` |
| `SCORER_POOL` incomplet | `packages/constants/src/index.ts:126` | Compléter ou alimenter dynamiquement depuis la DB |
| ~~`PlayButton.tsx`~~ | `components/mobile/PlayButton.tsx` | **✅ SUPPRIMÉ** (NEXT_STEPS STEP 1.7) |

---

## État du projet — Version 3 (2 juin 2026)

### Toutes les corrections appliquées — récapitulatif complet

**Vague 1 — FIXES_REQUIRED.md (logique métier critique)**

| Fix | Fichiers modifiés | Statut |
|-----|-------------------|--------|
| FIX 1 — `SimulateButton` lit depuis bootstrap | `SimulateButton.tsx` | ✅ |
| FIX 2 — `resetGame` online + `POST /api/game/reset` | `onlineGameStore.ts`, `app/api/game/reset/route.ts`, `lib/api.ts` | ✅ |
| FIX 3 — Clé persist offline par `competitionId` | `localGameStore.ts` | ✅ |
| FIX 4 — txLog flags depuis serveur (sans ré-enrichissement) | `onlineGameStore.ts` | ✅ |
| FIX 5 — `avgCost` sur prix confirmé serveur | `lib/api.ts`, `onlineGameStore.ts` | ✅ |
| FIX 6 — `fetchState()` après `advanceDay` online | `onlineGameStore.ts` | ✅ |
| FIX 7 — `usePortfolioTotals` depuis `_teams` | `usePortfolioTotals.ts` | ✅ |
| FIX 8 — `isKO` depuis `bootstrap.days.is_ko` | `localGameStore.ts`, `onlineGameStore.ts` | ✅ |
| FIX 9 — `bestScore` préservé au reset offline | `localGameStore.ts` | ✅ |
| FIX 10 — `deriveDynamicKey` + `buildMatchesForCurrentDay` centralisés | `lib/bootstrap.ts`, deux stores | ✅ |

**Vague 2 — NEXT_STEPS.md (legacy UI + admin + i18n + tests)**

| Step | Description | Statut |
|------|-------------|--------|
| STEP 1.1 | `TradeModal` : `isKO`/`isCapPhase` depuis bootstrap | ✅ |
| STEP 1.2 | `NationDetailOverlay` : `NATIONS`+`CALENDAR` → `_teams`+bootstrap | ✅ |
| STEP 1.3 | `Ticker` : `NATIONS` → `_teams` | ✅ |
| STEP 1.4 | `MatchDetailOverlay` : `NATIONS` → `_teams` | ✅ |
| STEP 1.5 | `PortfolioTab` : `NATIONS` → `_teams` | ✅ |
| STEP 1.6 | `MatchAnimation` : `NATIONS`+`SCORER_POOL` → prop `teams` | ✅ |
| STEP 1.7 | `PlayButton.tsx` supprimé (legacy) | ✅ |
| STEP 1.8 | `app/api/market/route.ts` supprimé (route morte) | ✅ |
| STEP 2.1 | Protection `/admin` dans `middleware.ts` | ✅ |
| STEP 2.2 | Layout admin | ✅ |
| STEP 2.3 | Page liste des compétitions `/admin` | ✅ |
| STEP 2.4 | Page gestion `/admin/competitions/[id]` + `CompetitionActions` | ✅ |
| STEP 2.5 | API routes admin (toggle-active, import-teams, POST competitions) | ✅ |
| STEP 2.6 | Formulaire création `/admin/competitions/new` | ✅ |
| STEP 3.1 | Clé `market.hint` dans `fr.json` + `en.json` | ✅ |
| STEP 4 | 3 fichiers de tests Vitest (bootstrap, isolation, reset route) | ✅ |

**Vague 3 — NEXT_STEPS_V3.md (game-engine + admin complet + tests + migration SQL)**

| Step | Description | Statut |
|------|-------------|--------|
| STEP 1 | `buildKOMatches.ts` : `resolveTeams` supprimée, `NATIONS`/`GROUPS` supprimés, `teams` obligatoire | ✅ |
| STEP 2 | Admin : `PATCH /api/admin/competitions/[id]/teams/[team_id]` + `TeamEditor.tsx` | ✅ |
| STEP 3 | Admin : `POST/DELETE /api/admin/competitions/[id]/days/…` + `DayManager.tsx` + Section E | ✅ |
| STEP 4 | `db/migrations/013_cleanup_legacy.sql` créé (⚠️ pas encore exécuté en prod) | ✅ fichier prêt |
| STEP 5.2 | `trade.concentration.test.ts` — 6 tests cap 40% | ✅ |
| STEP 5.3 | `dividends.test.ts` — 9 tests taux par phase | ✅ |
| STEP 5.1 | `advanceDay.test.ts` — pipeline simulation offline | ❌ non implémenté (reporté vague 4) |

**Vague 4 — NEXT_STEPS_V4.md (nettoyage final game-engine + tests)**

| Step | Qui | Description | Statut |
|------|-----|-------------|--------|
| STEP 1 | JY | Exécuter migration 013 en prod (Supabase SQL Editor) | ⏳ Action manuelle en attente |
| STEP 2 | Code | `advanceDay.test.ts` — 4 tests, vitest.config.ts jsdom, jsdom installé | ✅ 4/4 tests passent |
| STEP 3 | Code | `CALENDAR` + `GROUPS` supprimés de `@kickstock/constants` + import `CalendarDay` retiré | ✅ |
| STEP 4 | Code | `genGoals.ts` : `Nation`+`SCORER_POOL` → `TeamRef { id, name }`. 3 appelants simplifiés | ✅ |
| STEP 5 | Code | `initState.ts` : `teams` obligatoire, fallback `NATIONS` + import supprimés | ✅ |

### État actuel de `@kickstock/constants` — post-vague 4

| Export | Statut | Importé par |
|--------|--------|-------------|
| `TOKENS` | ✅ Actif | Design system (`tokens.ts`) |
| `MOBILE_BREAKPOINT` | ✅ Actif | Composants de layout |
| `NATIONS` | 🗑️ **Dead code** | **Aucun import actif** — à supprimer |
| `DIV_RATES` | ✅ Actif | `localGameStore.ts`, `buildKOMatches.ts` (re-export) |
| `INIT_CASH` | ✅ Actif | `localGameStore.ts` (`baseState()`) |
| `CALENDAR` | ✅ **Supprimé** | — (vague 4 STEP 3) |
| `GROUPS` | ✅ **Supprimé** | — (vague 4 STEP 3) |
| `SCORER_POOL` | 🗑️ **Dead code** | **Aucun import actif** — à supprimer |

**`NATIONS` et `SCORER_POOL` sont les deux derniers exports dead code du package.** Leur suppression est la seule tâche code restante sur `@kickstock/constants`.

### Suite des tests Vitest — État post-vague 4

| Fichier | Tests | Statut | Couverture |
|---------|-------|--------|------------|
| `lib/bootstrap.test.ts` | 3 | ✅ | `deriveDynamicKey` — clés R32/SF/Final |
| `stores/localGameStore.isolation.test.ts` | 1 | ✅ | Isolation clé persist par compétition |
| `app/api/game/reset/route.test.ts` | 1 | ✅ | Smoke test 400 si compétitionId manquant |
| `stores/trade.concentration.test.ts` | 6 | ✅ | Cap 40% — 6 scénarios |
| `lib/dividends.test.ts` | 9 | ✅ | Taux dividende par phase + edge cases |
| `stores/advanceDay.test.ts` | 4 | ✅ | Pipeline simulation offline |
| **Total** | **24 / 24** | ✅ | |

### Couverture fonctionnelle par User Story — Bilan post-vague 4

| Domaine US | Couvert | Lacunes restantes |
|------------|---------|-------------------|
| Auth & onboarding (US-1) | ✅ | — |
| i18n FR/EN (US-2) | ✅ | Tester switch de langue en prod |
| Multi-compétition (US-3) | ✅ | — |
| Marché consultation (US-4) | ✅ | — |
| Trading (US-5) | ✅ | — |
| Portfolio (US-6) | ✅ | — |
| Calendrier (US-7) | ✅ | — |
| Standings (US-8) | ✅ | — |
| Mode Simulation (US-9) | ✅ | — |
| Mode Live (US-10) | ✅ | — |
| Dividendes & Prix (US-11) | ✅ | — |
| Fiche équipe (US-12) | ✅ | — |
| Leaderboard (US-13) | ✅ | — |
| Tutorial & Coach Marks (US-14) | ✅ | — |
| UI Shell (US-15) | ✅ | — |
| Admin gestion compétitions (US-16) | ✅ | — |
| Infrastructure (US-17) | ✅ | — |

**État global : toutes les User Stories sont couvertes dans le code. Toutes les actions de migration sont terminées.**

### Note sur la visibilité des équipes en production

Les équipes sont toujours visibles sur les écrans Home et Market après la migration 013 — **c'est le comportement attendu et correct**. La migration 013 a supprimé uniquement les tables legacy vides (`nations`, `positions`, `trades`…). Les tables actives `teams` et `competition_teams` contiennent les données de compétition et ne sont pas touchées. Les équipes affichées viennent désormais exclusivement de la base de données via `/api/competition/bootstrap`, et non plus du code TypeScript hardcodé `NATIONS`.

---

## Next Steps recommandés — Vague 5

### Priorité 1 — Supprimer `NATIONS` et `SCORER_POOL` de `@kickstock/constants`

Ce sont les deux derniers exports dead code du package. Après la vague 4, plus aucun fichier TypeScript actif ne les importe.

**Actions :** dans `packages/constants/src/index.ts` :
1. Supprimer le bloc `export const NATIONS: Nation[] = [...]` (48 lignes)
2. Supprimer le bloc `export const SCORER_POOL: Record<string, string[]> = {...}` (~30 lignes)
3. Supprimer l'`import type { Nation } from '@kickstock/types'` en tête de fichier (plus utilisé)
4. Vérifier la compilation : `pnpm tsc --noEmit` dans le monorepo

Après cette action, `@kickstock/constants` n'exportera plus que : `TOKENS`, `MOBILE_BREAKPOINT`, `DIV_RATES`, `INIT_CASH` — quatre exports tous actifs et utiles.

### Priorité 2 (JY) — Vérification manuelle i18n en production

Tester le switch de langue FR → EN sur `kick-stock-web.vercel.app` :
- Menu avatar → cliquer "🇬🇧 English" → vérifier que toute l'interface bascule en anglais
- Recharger la page → vérifier que la langue persiste (cookie `NEXT_LOCALE`)
- Ouvrir avec un navigateur configuré en anglais → vérifier la détection automatique via `Accept-Language`

### Priorité 3 — Qualité du code : typage propre du store facade

~~Les stores et composants utilisent `(s as any)._bootstrap` et `(s as any)._teams`~~ → **✅ CORRIGÉ (Vague 5 STEP 2)** : interface `BootstrapSlice` exportée depuis `gameStore.ts`, tous les 30 casts `(s as any)` supprimés dans 14 fichiers.

---

## État du projet — Version 6 (2 juin 2026, soir)

### Toutes les corrections appliquées — récapitulatif final

**Vague 5 — NEXT_STEPS_V5.md (nettoyage final constants + typage store)**

| Step | Qui | Description | Statut |
|------|-----|-------------|--------|
| STEP 1 | Code | `NATIONS` + `SCORER_POOL` + `import Nation` supprimés de `@kickstock/constants` | ✅ |
| STEP 2 | Code | 30 casts `(s as any)` supprimés — `BootstrapSlice` interface exportée | ✅ |
| STEP 3 (JY) | JY | Test switch de langue FR/EN en production | 🔴 BUG ACTIF |

### État final de `@kickstock/constants`

Le package ne contient plus que 4 exports actifs :

```typescript
TOKENS           // design system (couleurs, typographie, espacements, animations)
MOBILE_BREAKPOINT // 600px — seuil responsive
DIV_RATES        // { r32:0.10, r16:0.15, qf:0.20, sf:0.30, final:0.40, champion:0.60 }
INIT_CASH        // 10_000 KC — capital de départ
```

Toutes les données WC2026 hardcodées (`NATIONS` 48 équipes, `CALENDAR` 35 jours, `GROUPS`, `SCORER_POOL`) ont été supprimées. L'app est entièrement agnostique à la compétition.

### État final des tests Vitest

| Fichier | Tests | Couverture |
|---------|-------|------------|
| `lib/bootstrap.test.ts` | 3 | `deriveDynamicKey` R32/SF/Final |
| `stores/localGameStore.isolation.test.ts` | 1 | Isolation persist par compétition |
| `app/api/game/reset/route.test.ts` | 1 | Smoke test reset API |
| `stores/trade.concentration.test.ts` | 6 | Cap 40% — 6 scénarios |
| `lib/dividends.test.ts` | 9 | Taux dividende par phase |
| `stores/advanceDay.test.ts` | 4 | Pipeline simulation offline |
| **Total** | **24 / 24** | ✅ tous verts |

### Bug actif — Switch de langue i18n

**Symptôme :** cliquer FR→EN dans le menu avatar ne change pas la langue en production.

**Tentatives effectuées :**
1. `router.refresh()` → Next.js Router Cache sert le layout mis en cache ❌
2. `document.cookie` + `window.location.reload()` → même problème ❌
3. Server Action (`cookies().set` + `redirect()`) → intercepté par Router Cache ❌
4. API route `/api/set-locale` avec HTTP 302 + `Set-Cookie` → `window.location.href` → à débugger

**Hypothèse root cause :** le middleware Supabase crée un nouveau `NextResponse.next({ request })` lors de la session refresh, ce qui pourrait interférer avec les cookies de réponse. À investiguer avec les DevTools (onglet Network → vérifier les `Set-Cookie` headers).

**Strings hardcodées restantes dans `BrowserShell.tsx`** (non encore i18n'd) :
- "JOURNÉE PRÉCÉDENTE", "JOURNÉE COURANTE", "ACTIONS · MATCHS DU JOUR"
- "TOUS LES MATCHS — PHASE DE GROUPES", "PHASE KO"
- "HISTORIQUE DES TRANSACTIONS", "CLASSEMENTS DE GROUPE", "Équipe"
- "Phase KO — matchs déterminés dynamiquement", "Mise à jour auto toutes les 30s"
- "Pens X–Y" (scores tirs au but dans BrowserShell + StandingsTab mobile)
- "HISTORIQUE DES PRIX" dans `NationDetailOverlay`

### Migration SQL 013 — ✅ Exécutée en production

Tables legacy supprimées : `nations`, `positions`, `trades`, `price_history`, `game_state`, `nation_prices`, `group_standings`, `knockout_pools`, `holdings_history`, `dividends`, `groups`.
RPCs supprimés : `execute_trade`, `get_or_create_portfolio`, `distribute_dividends`, `liquidate_eliminated`.

---

*Document mis à jour le 2 juin 2026 — Version 6 (fin de journée)*

---

## État du projet — Version 7 (3 juin 2026)

### Corrections et améliorations appliquées — session 2026-06-03

**Interface admin — refonte complète**

| Item | Description | Fichiers modifiés |
|------|-------------|-------------------|
| 🔒 Bug sécurité | `CompetitionActions.syncFixtures()` exposait `NEXT_PUBLIC_CRON_SECRET` dans le bundle client → corrigé pour passer par le proxy admin `/api/admin/.../sync` | `CompetitionActions.tsx` |
| ➕ Nouveau bouton | **⬇ IMPORT TEAMS** → `POST /api/admin/.../import-teams` | `CompetitionActions.tsx` |
| ➕ Nouveau bouton | **↻ SYNC RESULTS** → proxy admin `{type:'results'}` | `CompetitionActions.tsx` |
| ➕ Nouveau bouton | **↻ SYNC SQUADS** → proxy admin `{type:'squads'}` | `CompetitionActions.tsx` |
| 💬 Feedback enrichi | Résultat de chaque call API affiché inline (imported/skipped/unmapped…) | `CompetitionActions.tsx` |
| 🗑️ Champs supprimés | `start_date` et `end_date` retirés du formulaire de création (dérivés automatiquement par sync-fixtures) | `competitions/new/page.tsx`, `api/admin/competitions/route.ts` |
| ⚡ Auto-chain création | La création enchaîne : create → import-teams → sync-fixtures, avec progress UI par étape | `competitions/new/page.tsx` |
| 🗂️ Refonte page détail | 4 onglets : INFO / FORMAT / ÉQUIPES / MATCHES | `competitions/[id]/page.tsx` |
| ➕ Nouveau composant | `TabBar.tsx` — navigation par onglets (URL params `?tab=`) | `TabBar.tsx` |
| ➕ Nouveau composant | `MatchEditor.tsx` — édition inline datetime/score/statut par match | `MatchEditor.tsx` |
| ➕ Nouvelle route | `PATCH /api/admin/competitions/[id]/matches/[fixture_id]` — correction manuelle d'un match | `matches/[fixture_id]/route.ts` |
| 📖 Nouvelle doc | `docs/admin-status.md` — état des lieux admin complet | `docs/admin-status.md` |

### Nouveaux fichiers créés

```
apps/web/app/admin/competitions/[id]/
  TabBar.tsx                              ← navigation onglets (client)
  MatchEditor.tsx                         ← édition inline match (client)

apps/web/app/api/admin/competitions/[id]/matches/[fixture_id]/
  route.ts                                ← PATCH match

docs/
  admin-status.md                         ← audit admin mode complet
```

### US-16 — Couverture mise à jour

| US | Description | Statut |
|----|-------------|--------|
| US-16.1 | Création compétition (3 champs, auto-chain) | ✅ |
| US-16.2 | Configurer équipes | ✅ |
| US-16.3 | Configurer calendrier (sync-fixtures) | ✅ |
| US-16.4 | Configurer journées (DayManager) | ✅ |
| US-16.5 | Activer/désactiver compétition | ✅ |
| US-16.6 | Import teams API-Football | ✅ |
| US-16.7 | Simuler une journée | ✅ |
| US-16.8 | UI tabulée (Info/Format/Équipes/Matches) | ✅ **nouveau** |
| US-16.9 | Boutons API manuels (import/sync/results/squads) | ✅ **nouveau** |
| US-16.10 | Édition manuelle d'un match | ✅ **nouveau** |

### Next Steps recommandés — Vague 6

| Priorité | Item |
|----------|------|
| 🟡 | Afficher `last_sync_at` sur la compétition + log horodaté des actions admin |
| 🟡 | Ajouter confirmation avant modification d'un match déjà `processed_at` |
| 🟡 | Bouton Live Fixtures (voir les matchs en cours en temps réel depuis l'admin) |
| 🟢 | Supprimer `NEXT_PUBLIC_CRON_SECRET` du `.env` (plus utilisé après la correction sécurité) |
| 🟢 | Vérification détection automatique `Accept-Language` en production |

---

### Priorité 5 — Tests supplémentaires

Les 3 tests Vitest existants couvrent uniquement le chemin happy path basique. Ajouter :
- Tests unitaires pour `applyResult`, `calcTax`, `calcDividend` dans les composants (ils existent dans `game-engine` mais pas dans `apps/web`)
- Test du pipeline `advanceDay` offline complet (simulation d'une journée de groupe avec vérification des pools)
- Test de la logique de concentration (achat au-delà de 40% bloqué)

---

*Document mis à jour le 2 juin 2026 — Version 2 (post NEXT_STEPS.md)*

---

## État du projet — Version 8 (4 juin 2026)

### Session 2026-06-03/04 — Infrastructure API-Football + Admin enrichi + Pricing

---

### Nouvelles logiques métier

#### `strengthToPrice(strength)` — Formule de prix quadratique

**Remplace** l'ancienne formule linéaire `strength × 1.5`.

```typescript
// lib/normalizer.ts
export function strengthToPrice(strength: number): number {
  const clamped = Math.max(50, Math.min(100, strength));
  const t = (clamped - 50) / 50;   // normalise 0→1
  return Math.round(5 + 195 * t * t);
}
```

**Valeurs clés :**

| Strength | Prix KC | Exemple équipe |
|----------|---------|----------------|
| 50 (plancher) | 5 KC | Équipes hors-ranking |
| 60 | 13 KC | — |
| 70 | 36 KC | Qatar |
| 75 (défaut) | 54 KC | Équipes sans ranking FIFA |
| 80 | 75 KC | Mexico |
| 90 | 130 KC | Argentina |
| 95 | 163 KC | Brazil |
| 100 (max) | 200 KC | — |

**Justification :** courbe convexe — les équipes faibles démarrent très bas, l'écart s'accentue vers les top équipes, créant une vraie tension de marché.

**Utilisée par :**
- `import-teams/route.ts` → `import { strengthToPrice } from '@/lib/normalizer'`
- `sync-fixtures/route.ts` step 5 (seed initial_price)
- `teams/[team_id]/route.ts` PATCH (recalcul auto depuis strength)

---

#### `normalizeFixture` — Support des fixtures placeholder KO

**Nouvelle logique :** les fixtures KO publiées avant la fin des groupes ont des équipes placeholder ("Winner Group A", "Runner-up Group B"). L'ancienne version retournait `null` → fixture skippée → aucun `competition_day` créé.

**Nouveau comportement :**
```typescript
// lib/normalizer.ts
function derivePlaceholderId(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
  return `KO_${clean}`;
}

// Dans normalizeFixture() :
if (!idA || !idB) {
  if (!isKO) return null;  // Group Stage non mappé → skip
  // KO placeholder → dériver IDs stables
  idA = idA ?? derivePlaceholderId(fixture.teams.home.name);
  idB = idB ?? derivePlaceholderId(fixture.teams.away.name);
  isPlaceholder = true;  // signal au cron : skip teams/competition_teams
}
```

**`isPlaceholder = true`** → le cron `sync-fixtures` skip les steps 1 et 2 (upsert teams + competition_teams) mais exécute toujours steps 3 et 4 (competition_days + match). Résultat : les journées KO apparaissent dans le calendrier dès publication des fixtures placeholder.

**Mise à jour `upsert_fixture` (migration 016) :**
```sql
ON CONFLICT (fixture_id) DO UPDATE SET
  nation_a     = EXCLUDED.nation_a,   -- ← nouveau : placeholder → vraie équipe
  nation_b     = EXCLUDED.nation_b,   -- ← nouveau
  scheduled_at = EXCLUDED.scheduled_at,
  ...
```
`nation_a`/`nation_b` désormais dans le `DO UPDATE SET` → quand l'API remplace "Winner Group A" par "France", le prochain sync met à jour automatiquement.

**Champ `isPlaceholder` ajouté à `NormalizedFixture` :**
```typescript
export interface NormalizedFixture {
  ...
  isPlaceholder: boolean;
}
```

---

#### `sync-fixtures` — Enrichissements

**Step 4b — Sync group_code depuis `/standings`** (non-bloquant) :
```typescript
const standings = await fetchGroupStandings(comp.league_id, comp.season);
for (const entry of standings) {
  const groupCode = entry.group.replace(/^Group\s+/i, '').trim();
  const teamId    = apiNameToTeamId(entry.team.name, comp.league_id);
  if (!teamId) continue;
  await adm(admin).from('competition_teams')
    .update({ group_code: groupCode })
    .eq('competition_id', comp.id)
    .eq('team_id', teamId);
}
```
**Raison :** `fixture.league.group` est `null` dans les fixtures WC2026. L'endpoint `/standings?league=1&season=2026` retourne les groupes A-L correctement.

**Protection contre l'écrasement null (step 2) :**
```typescript
// N'inclure group_code dans l'upsert que si non-null
const row: Record<string, unknown> = { competition_id, team_id };
if (ct.group_code !== null) row.group_code = ct.group_code;
```

**Paramètre `competition_id` (bypass `is_active`) :**
```
GET /api/cron/sync-fixtures?competition_id=2
```
Quand appelé depuis le panel admin avec `competition_id`, cible cette compétition spécifique même si `is_active=false`. Sans paramètre : comportement normal (toutes les actives).

**Champ `fetched` dans le résultat :**
```json
{ "competition": "FIFA World Cup 2026", "fetched": 72, "upserted": 72, "skipped": 0 }
```
Distingue "API a retourné 0 fixtures" de "fixtures reçues mais toutes skippées".

---

#### `fetchGroupStandings(leagueId, season)` — Nouvelle fonction

```typescript
// lib/football-api.ts
export interface ApiStandingEntry {
  rank:     number;
  team:     { id: number; name: string };
  points:   number;
  goalsDiff: number;
  group:    string;  // "Group A"…"Group L"
  all:      { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
}

export async function fetchGroupStandings(leagueId, season): Promise<ApiStandingEntry[]>
```

- Cache Redis : 6h (`api:standings:${leagueId}:${season}`)
- Filtre : uniquement les entrées `group.startsWith('Group ')` (exclut "Ranking of third-placed teams")
- Erreurs API remontées (pas silencieuses)

---

#### `sync-schedule` — Nouveau cron

```
GET /api/cron/sync-schedule?competition_id=N
```

Crée les `competition_days` pour toutes les phases KO selon le calendrier officiel WC2026 :

| Phase | Jours | Dates |
|-------|-------|-------|
| R32 | 6 jours (day_index 17-22) | 28 juin – 3 juillet |
| R16 | 4 jours (day_index 24-27) | 5-8 juillet |
| QF  | 2 jours (day_index 31-32) | 12-13 juillet |
| SF  | 2 jours (day_index 35-36) | 16-17 juillet |
| 3rd | 1 jour (day_index 39) | 20 juillet |
| Final | 1 jour (day_index 40) | 21 juillet |

- Idempotent (upsert sur `competition_id,day_index`)
- Uniquement `league_id=1` (autres leagues : `skipped`)
- Déclenché depuis le bouton **↻ SYNC SCHEDULE** dans `CompetitionActions`

---

#### Bootstrap — Cache-bust automatique

**Problème résolu :** les joueurs voyaient des prix périmés (cache localStorage 24h) après une mise à jour admin.

**Solution :** appel lightweight `?version_only=1` avant de lire le cache :
```typescript
// lib/bootstrap.ts
const vRes = await fetch(`/api/competition/bootstrap?competition_id=${id}&version_only=1`);
const { version } = await vRes.json();  // = competitions.last_sync_at
const cached = readCache(competitionId, serverVersion);
// Si version différente du cache → cache invalidé → refetch complet
```

**API côté serveur :**
```typescript
if (versionOnly) {
  return NextResponse.json({ version: comp.last_sync_at ?? comp.id });
}
```

**Impact :** dès qu'un admin lance "Import Teams" ou "Sync Fixtures" (ce qui met à jour `last_sync_at`), les joueurs reçoivent les nouveaux prix à leur prochaine ouverture de l'app — sans action manuelle.

---

### Admin — Nouvelles fonctionnalités

#### `PATCH /api/admin/competitions/[id]`

Édition des métadonnées d'une compétition :
```
Body: { name?, season?, league_id?, start_date?, is_active? }
```
- Champs scopés explicitement (pas de wildcard)
- `start_date` : critique pour le recalcul des `day_index` au prochain sync

#### `CompetitionEditor.tsx`

Formulaire inline (client) dans l'onglet INFO :
- Champs : Nom, Saison, League ID, Date de début
- Avertissement si `start_date` modifiée (impacte tous les `day_index`)

#### Correction query admin liste `/admin`

**Bug :** la query sélectionnait `end_date` (colonne inexistante) → PostgREST error → `data=null` → "Aucune compétition".

**Fix :** suppression de `end_date` + ajout de colonnes utiles (compteurs teams/matches/jours, `last_sync_at`).

#### Bouton ↻ SYNC SCHEDULE

Nouveau bouton violet dans `CompetitionActions` → `POST /api/admin/competitions/${id}/sync {type:'schedule'}` → déclenche `/api/cron/sync-schedule?competition_id=${id}`.

#### `TeamEditor` — Auto-calcul du prix

```typescript
// Modifier strength → recalcule le prix automatiquement (si pas d'override manuel)
function handleStrChange(val: string) {
  setStr(val);
  if (!priceManual) {
    const s = parseInt(val, 10);
    if (!isNaN(s)) setPrice(String(strengthToPrice(s)));
  }
}
```

- Champ prix avec **bordure jaune** si override manuel, grise si calculé
- Envoi du body : `initial_price` inclus uniquement si `priceManual === true`

#### `PATCH /api/admin/competitions/[id]/teams/[team_id]` — Split tables

**Avant :** tout envoyé vers `competition_teams` → erreur sur `strength` (colonne sur `teams`).

**Après :**
```typescript
// strength → UPDATE teams SET strength = ?
// group_code, initial_price, current_price → UPDATE competition_teams SET ...
// Si strength modifiée sans initial_price explicite :
const recalcPrice = strengthToPrice(body.strength);
compTeamUpdates.initial_price = recalcPrice;
compTeamUpdates.current_price = recalcPrice;
```

#### `import-teams` — Fallback strength DB

**Problème :** endpoint `/teams/rankings/fifa` non disponible avec le plan API actuel → `strengthMap` vide → tous les prix à 54 KC.

**Fix :** si l'API FIFA échoue, utiliser la force déjà en DB :
```typescript
const strength = strengthMap.get(t.id)
              ?? dbStrengthByApiId.get(t.id)
              ?? dbStrengthById.get(teamId)
              ?? 75;
// N'update teams.strength que si freshValue depuis API FIFA
if (strengthMap.get(t.id) !== undefined) {
  teamPatch.strength = strength;
}
```

---

### Team mapping — Ajouts WC2026

| Nom API-Football | ID KickStock | Raison |
|-----------------|--------------|--------|
| `'Türkiye'` | `'TUR'` | Orthographe officielle depuis 2022 |
| `'Bosnia & Herzegovina'` | `'BIH'` | API utilise `&` pas `and` |
| `'Cape Verde Islands'` | `'CPV'` | API utilise "Islands" |
| `'Congo DR'` | `'COD'` | API inverse "DR" et "Congo" |

**Résultat WC2026 :** 72/72 fixtures syncées, 0 skippées.

---

### `parseFixtures` — Remontée d'erreurs API

**Avant :** retournait `[]` silencieusement sur toute erreur API.

**Après :**
```typescript
// Erreur api-sports.io : { "errors": { "token": "Error/Missing application key." } }
if (data.errors && Object.keys(data.errors).length > 0) {
  throw new Error(`API-Football error: ${JSON.stringify(data.errors)}`);
}
// Erreur RapidAPI : { "message": "You are not subscribed to this API." }
if (data.message && !data.response) {
  throw new Error(`API-Football gateway: ${data.message}`);
}
// Réponse inattendue
if (!data.response) {
  throw new Error(`API-Football: réponse inattendue — ${JSON.stringify(body).slice(0, 200)}`);
}
```

**Impact :** le cron `sync-fixtures` remonte maintenant l'erreur réelle dans `results[].error` au lieu de retourner `{ upserted: 0, skipped: 0 }` sans explication.

---

### Infrastructure — `vercel.json`

**Crons automatiques (plan Hobby — 1 exécution/jour max) :**
```json
{
  "crons": [
    { "path": "/api/cron/sync-fixtures", "schedule": "0 6 * * *" },
    { "path": "/api/cron/sync-squads",   "schedule": "0 5 * * 1" }
  ]
}
```

**Note :** `sync-results` retiré des crons automatiques (plan Hobby = 1 run/jour, insuffisant pour les résultats en temps réel). À déclencher manuellement depuis l'admin pendant les matchs, ou passer au plan Pro pour `*/30 * * * *`.

---

### Création de compétition — Upsert au lieu d'Insert

**Avant :** `INSERT` → crash si `(league_id, season)` déjà existant.

**Après :** `upsert(onConflict: 'league_id,season', ignoreDuplicates: false)` → retourne l'ID existant et met à jour le nom. Permet de "reprendre" une compétition sans créer de doublon.

**`competition_game_state` :** idem → `upsert(ignoreDuplicates: true)` → ne réinitialise pas un état existant.

---

### Récapitulatif des incohérences et résidus — Version 8

| # | Description | Statut |
|---|-------------|--------|
| Endpoint FIFA rankings | `/teams/rankings/fifa` non disponible sur le plan actuel | ⚠️ Contournement : fallback sur DB strength. Fonctionnel. |
| sync-results non automatique | Plan Hobby Vercel = 1 cron/jour max | ⚠️ Manuel pendant les matchs. Pro plan requis pour auto. |
| `strength` global vs par compétition | `teams.strength` partagé entre WC2022 et WC2026 | 🟡 WC2022 = test data. Pour WC2026, strength = classements actuels (correct). À migrer si besoin historique. |
| `competition_days` KO = hardcodées WC2026 | `sync-schedule` utilise les dates officielles FIFA 2026 | 🟡 Correct pour WC2026. Adapter pour d'autres compétitions si besoin. |

---

*Document mis à jour le 4 juin 2026 — Version 8*
