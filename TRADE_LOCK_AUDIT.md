# Audit — Blocage des trades pendant les matchs

**Date :** 2026-06-20  
**Contexte :** Des joueurs semblent capables de trader sur des équipes dont le match est déjà commencé. Ce document cartographie toutes les failles identifiées et les correctifs à apporter.

---

## Architecture actuelle du blocage

```
Joueur clique "ACHETER"
        │
        ▼
[1] TradeModal.ctaDisabled  ← vérifie lockedTeams (store Zustand)
        │ si non bloqué
        ▼
[2] store.trade()           ← re-vérifie lockedTeams (store Zustand)
        │ si non bloqué
        ▼
[3] POST /api/trade         ← appelle execute_competition_trade (SQL)
        │
        ▼
[4] DB: check api_status    ← source de vérité, seule vérification fiable
```

**Les couches [1] et [2] sont purement UI/advisory** — elles se basent sur le store Zustand dont les données peuvent être périmées.  
**La couche [4] est la seule barrière réelle**, mais elle a elle-même une faille.

---

## Failles identifiées

---

### FAILLE 1 — Backend : fenêtre de 0 à 2 min après le coup d'envoi (CRITIQUE)

**Fichier :** `db/migrations/023_trade_lock_during_match.sql` lignes 57–68

**Code actuel :**
```sql
IF EXISTS (
  SELECT 1 FROM matches
  WHERE competition_id = p_competition_id
    AND (nation_a = p_team_id OR nation_b = p_team_id)
    AND (
      api_status IN ('1H', 'HT', '2H', 'ET', 'BT', 'P')
      OR (trade_lock_until IS NOT NULL AND trade_lock_until > NOW())
    )
) THEN ...
```

**Problème :** Le blocage dépend uniquement de `api_status`. Ce champ n'est mis à jour que par le cron `live-poll` qui tourne **toutes les 2 minutes**. Entre le coup d'envoi réel et le prochain tick du cron, `api_status` vaut encore `NS` (Not Started) → le trade passe en DB.

**Scénario d'exploitation :**
1. Match prévu à 22h00
2. L'API-Football signale `1H` à 22h01
3. Le cron `live-poll` passe à 22h02 → met à jour `api_status = '1H'`
4. Entre 22h00 et 22h02 : **tous les trades passent, backend compris**

**Bonus : si le cron échoue (deploy, erreur transiente, timeout)**, `api_status` reste `NS` pendant toute la durée du match → **0 blocage pendant 90+ minutes**.

**Correctif :**
```sql
IF EXISTS (
  SELECT 1 FROM matches
  WHERE competition_id = p_competition_id          -- scoped, évite les rows WC2022
    AND (nation_a = p_team_id OR nation_b = p_team_id)
    AND processed_at IS NULL                        -- exclut les matchs déjà traités
    AND (
      scheduled_at <= NOW()                         -- ← NOUVEAU : match censé avoir démarré
      OR api_status IN ('1H', 'HT', '2H', 'ET', 'BT', 'P')
      OR (trade_lock_until IS NOT NULL AND trade_lock_until > NOW())
    )
) THEN ...
```

La condition `processed_at IS NULL` empêche de bloquer les matchs terminés qui auraient un `scheduled_at` dans le passé. Scopée sur `competition_id`, elle évite aussi les anciennes fixtures WC2022 (cf. commentaire migration 023 ligne 13–18).

---

### FAILLE 2 — Frontend : onglet en arrière-plan → état périmé pendant des heures (CRITIQUE)

**Fichier :** `apps/web/stores/onlineGameStore.ts` ligne 220

**Code actuel :**
```ts
const lockId = setInterval(() => { get().refreshLockedTeams(); }, 30_000);
```

**Problème :** Les navigateurs **throttlent les `setInterval` à 1 minute minimum** (Chrome, Firefox, Safari) pour les onglets en arrière-plan, voire les suspendent complètement. Si un joueur laisse l'app ouverte mais change d'onglet, le store ne se rafraîchit pas. Quand il revient :

- `lockedTeams` contient les données de la dernière fois qu'il était actif
- Si l'onglet était inactif depuis avant le coup d'envoi, `lockedTeams` sera vide pour cette équipe
- Le bouton "ACHETER" est actif et cliquable
- **Les vérifications [1] et [2] passent** — seule la DB bloque (faille 1 aidant, rien ne bloque si `api_status` est encore `NS`)

**Ce qui manque :** aucun listener sur `visibilitychange` ou `focus` dans tout le codebase front.

**Correctif — dans `startSync()` :**
```ts
startSync: () => {
  // ... code existant ...

  // Refresh immédiat quand le joueur revient sur l'onglet
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      get().refreshLockedTeams();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  // Stocker le handler pour pouvoir le retirer dans stopSync()
  set({ _visibilityHandler: onVisible });
}

stopSync: () => {
  const { _visibilityHandler, ... } = get();
  if (_visibilityHandler) document.removeEventListener('visibilitychange', _visibilityHandler);
  // ... reste du code ...
}
```

---

### FAILLE 3 — Frontend : aucun refresh au moment d'ouvrir la TradeModal (MOYEN)

**Fichier :** `apps/web/components/shared/NationDetailOverlay.tsx` ligne 232  
**Fichier :** `apps/web/components/mobile/MarketTab.tsx` (tout bouton ouvrant la modal)

**Problème :** Quand le joueur clique sur "ACHETER", la `TradeModal` s'ouvre instantanément avec les données du store — qui peuvent avoir jusqu'à 30 secondes de retard (interval nominal) ou bien plus (onglet backgroundé, faille 2). Le statut `isLocked` affiché dans la modal est donc potentiellement faux.

Scénario concret :
1. 21h55 — joueur ouvre `NationDetailOverlay`, le store dit "pas de lock"
2. 22h00 — coup d'envoi, le store ne se rafraîchit pas (onglet actif mais interval pas encore passé)
3. 22h00+Xs — joueur clique "ACHETER", la modal s'ouvre avec `isLocked = false`
4. La modal montre le bouton CTA actif

**Correctif :** Appeler `refreshLockedTeams()` au moment d'ouvrir la modal, et désactiver le CTA le temps du refresh :

```ts
// Dans NationDetailOverlay ou le handler onBuy/onSell
const handleOpenTrade = async (m: TradeMode) => {
  await useGameStore.getState().refreshLockedTeams();
  setTradeMode(m); // ouvrir seulement après refresh
};
```

---

### FAILLE 4 — Frontend : aucun refresh au moment de confirmer le trade (MOYEN)

**Fichier :** `apps/web/components/shared/TradeModal.tsx` ligne 70

**Code actuel :**
```ts
async function confirm() {
  const err = await trade(mode, nation.id, safeQty);
  // ...
}
```

**Fichier :** `apps/web/stores/onlineGameStore.ts` ligne 272

```ts
trade: async (mode, nationId, quantity) => {
  const s = get();
  // ...
  if (s.lockedTeams.has(nationId)) return '🔒 Trading verrouillé pendant le match';
  // ...
  result = await apiTrade(...); // appel API
}
```

**Problème :** `s.lockedTeams` est lu depuis l'état Zustand actuel au moment du clic, sans déclencher un refresh préalable. Si la faille 2 est présente (store périmé), le check ligne 272 passe, et l'appel API est émis. La DB (faille 1 corrigée) le bloquera, mais l'UX est mauvaise : le joueur voit son trade "partir" et reçoit une erreur 422 serveur au lieu d'un message clair côté client.

**Correctif :**
```ts
trade: async (mode, nationId, quantity) => {
  // Forcer un refresh synchrone avant de valider
  await get().refreshLockedTeams();
  const s = get();
  if (s.lockedTeams.has(nationId)) return '🔒 Trading verrouillé pendant le match';
  // ...
}
```

---

### FAILLE 5 — Frontend : NationDetailOverlay vérifie `isLocked` à l'ouverture mais pas à la confirmation (FAIBLE)

**Fichier :** `apps/web/components/shared/NationDetailOverlay.tsx` ligne 221–243

La modal parent affiche les boutons BUY/SELL selon `isLocked` snapshot à l'ouverture de l'overlay. Si le match démarre pendant que l'overlay est ouvert, les boutons restent actifs jusqu'au prochain poll du store (30s nominal). Ce cas est couvert par la faille 3 ci-dessus mais mérite d'être listé séparément car l'overlay peut rester ouvert longtemps.

---

## Récapitulatif des scénarios d'exploitation

| # | Scénario | Fenêtre exploitable | Backend bloque ? | Front bloque ? |
|---|----------|-------------------|-----------------|----------------|
| A | Trade dans les 2 premières minutes après le coup d'envoi | 0–2 min | **NON** | **NON** |
| B | Tab laissé en arrière-plan, retour pendant le match | Illimitée | OUI (après fix faille 1) | **NON** |
| C | Tab actif, interval de 30s pas encore passé | 0–30s | OUI (après fix faille 1) | **NON** |
| D | Cron live-poll en erreur pendant tout le match | Toute la durée | **NON** | **NON** |
| E | Tab actif, modal ouverte avant le coup d'envoi | Durée = temps dans la modal | OUI (après fix faille 1) | **NON** |

Le scénario **B** est celui qui permet de trader à T+25min avec l'app "ouverte" : le cron a bien mis à jour la DB, mais le store front n'a pas été rafraîchi depuis que le joueur a laissé l'onglet inactif.

---

## Plan de correction (ordre de priorité)

### P0 — Backend : migration SQL (bloque toutes les failles immédiatement)

Créer `db/migrations/024_trade_lock_scheduled_at.sql` :

```sql
CREATE OR REPLACE FUNCTION execute_competition_trade(
  p_competition_id INTEGER,
  p_device_id      TEXT,
  p_team_id        TEXT,
  p_mode           TEXT,
  p_quantity       INTEGER,
  p_user_id        UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
-- ... (reprendre le corps existant, modifier uniquement le bloc lock) ...
BEGIN
  -- ── Trading lock ────────────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM matches
    WHERE competition_id = p_competition_id
      AND (nation_a = p_team_id OR nation_b = p_team_id)
      AND processed_at IS NULL
      AND (
        scheduled_at <= NOW()
        OR api_status IN ('1H', 'HT', '2H', 'ET', 'BT', 'P')
        OR (trade_lock_until IS NOT NULL AND trade_lock_until > NOW())
      )
  ) THEN
    RETURN jsonb_build_object(
      'error', '🔒 Trading verrouillé pendant le match',
      'code',  'TRADE_LOCKED'
    );
  END IF;
  -- ... reste inchangé ...
```

**Effet :** Couvre les scénarios A, B, C, D, E. Même si tout le front est périmé, la DB refuse.

---

### P1 — Frontend : refresh au retour sur l'onglet (faille 2)

Dans `apps/web/stores/onlineGameStore.ts`, ajouter un listener `visibilitychange` dans `startSync()` et le nettoyer dans `stopSync()`.

Il faut aussi ajouter `_visibilityHandler` au type de state :
```ts
_visibilityHandler: (() => void) | null;
```

---

### P2 — Frontend : refresh synchrone avant envoi du trade (faille 4)

Dans `apps/web/stores/onlineGameStore.ts`, fonction `trade()` :
```ts
await get().refreshLockedTeams();
const s = get();
if (s.lockedTeams.has(nationId)) return '🔒 Trading verrouillé pendant le match';
```

---

### P3 — Frontend : refresh à l'ouverture de la TradeModal (faille 3)

Côté `NationDetailOverlay` et partout où `TradeModal` est ouverte, awaiter `refreshLockedTeams()` avant de setter `tradeMode`.

---

### P4 — Frontend : même logique `scheduled_at` côté store (cohérence UX)

Dans `refreshLockedTeams()` (ligne 199 du store), ajouter la même logique que le backend :

```ts
const scheduledAt = m.scheduled_at ? new Date(m.scheduled_at).getTime() : null;
const isLocked =
  LIVE_STATUSES.has(m.api_status)
  || (lockUntil !== null && lockUntil > now)
  || (scheduledAt !== null && scheduledAt <= now && !m.processed_at); // ← aligne sur le SQL
```

Cela rend la UI cohérente avec le backend : le badge 🔒 apparaît dès l'heure du coup d'envoi programmé, même si le cron n'a pas encore tourné.

---

## Fichiers à modifier (résumé)

| Fichier | Changement | Priorité |
|---------|-----------|---------|
| `db/migrations/024_trade_lock_scheduled_at.sql` | Nouvelle migration — ajouter `scheduled_at <= NOW() AND processed_at IS NULL` | P0 |
| `apps/web/stores/onlineGameStore.ts` | Listener `visibilitychange` dans `startSync`/`stopSync` | P1 |
| `apps/web/stores/onlineGameStore.ts` | `await refreshLockedTeams()` au début de `trade()` | P2 |
| `apps/web/components/shared/NationDetailOverlay.tsx` | Await refresh avant d'ouvrir la modal | P3 |
| `apps/web/stores/onlineGameStore.ts` | Ajouter check `scheduled_at` dans `refreshLockedTeams()` | P4 |

---

## Note sur le Realtime Supabase

Le store écoute déjà les changements sur `competition_game_state` via Supabase Realtime (ligne 234 du store). Il n'écoute pas les changements sur la table `matches`. Ajouter un listener Realtime sur `matches` (filtre `competition_id`) permettrait de déclencher `refreshLockedTeams()` **instantanément** quand le cron met à jour `api_status`, sans dépendre du poll de 30s. C'est une amélioration optionnelle post-correctifs P0–P4.
