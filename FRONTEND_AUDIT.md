# Audit Frontend Multijoueur — KickStock

**Date :** 2026-05-26  
**Périmètre :** stores/gameStore.ts · lib/api.ts · lib/device.ts · composants Shell

---

## ✅ 1. Suppression du localStorage

**Statut : CONFORME**

- Aucun `loadState` / `saveState` / `persist` dans le store Zustand.
- Le seul `localStorage` restant est dans `lib/device.ts` (autorisé par les specs) :
  ```ts
  // lib/device.ts
  localStorage.getItem('kickstock_device_id')
  localStorage.setItem('kickstock_device_id', id)
  ```
- Le commentaire dans `gameStore.ts` confirme explicitement :
  > *"No persist middleware — localStorage only stores device_id"*

---

## ✅ 2. Appels API

**Statut : CONFORME**

Tous les appels passent par `lib/api.ts` via un wrapper `apiFetch` :

| Action | Endpoint | Méthode |
|--------|----------|---------|
| Chargement état | `/api/game/state` | GET |
| Achat / Vente | `/api/trade` | POST |
| Avancer un jour | `/api/game/advance` | POST |

Le store appelle ces helpers directement :
```ts
// gameStore.ts
const data = await fetchGameState(deviceId);     // chargement
const result = await apiTrade(deviceId, ...);     // trade
const response = await apiAdvanceDay(deviceId, ...); // avancement
```

---

## ✅ 3. device_id & header X-Device-ID

**Statut : CONFORME**

- `lib/device.ts` génère un UUID `crypto.randomUUID()` au premier appel et le persiste.
- **Chaque requête** inclut automatiquement le header via `apiFetch` :
  ```ts
  headers: {
    'Content-Type': 'application/json',
    'X-Device-ID': deviceId,   // ← présent sur 100% des appels
  }
  ```
- La route `/api/trade` renvoie une erreur 400 si le header est absent (sécurité côté serveur).

---

## ✅ 4. Synchronisation temps réel

**Statut : CONFORME (polling — Supabase Realtime non utilisé)**

Un polling toutes les **3 secondes** est en place :

```ts
// gameStore.ts
startSync: () => {
  get().fetchState();                     // fetch immédiat au montage
  const id = setInterval(() => {
    if (get().syncing) return;            // skip si poll précédent en cours
    set({ syncing: true });
    get().fetchState();
  }, 3_000);
  set({ _pollId: id });
},
stopSync: () => { clearInterval(get()._pollId); }
```

Déclenché dans les deux shells :
```ts
// MobileShell.tsx & BrowserShell.tsx
useEffect(() => {
  useGameStore.getState().startSync();
  return () => useGameStore.getState().stopSync(); // cleanup au unmount
}, []);
```

### Note : Supabase Realtime non câblé
Le polling 3 s est fonctionnel. Supabase Realtime (WebSocket push) **n'est pas encore implémenté** — ce serait une amélioration pour réduire la latence et les requêtes inutiles, mais ce n'était pas dans le scope actuel.

---

## Résumé

| Point | Statut | Détail |
|-------|--------|--------|
| localStorage supprimé | ✅ OK | Seul `device_id` persiste |
| Appels API (`/api/*`) | ✅ OK | fetch via `lib/api.ts` |
| Header `X-Device-ID` | ✅ OK | Sur 100% des requêtes |
| Sync temps réel | ✅ OK | Polling 3 s actif sur les deux shells |
| Supabase Realtime | ℹ️ Non implémenté | Optionnel — polling suffit |

**Aucune correction nécessaire.** Le frontend est conforme à l'architecture multijoueur définie.

---

## Prochaine étape optionnelle : Supabase Realtime

Si tu veux remplacer le polling par du push WebSocket :

```ts
// À ajouter dans lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// Dans startSync() du gameStore :
const channel = supabase
  .channel('game_state')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_state' },
    () => get().fetchState()
  )
  .subscribe();
```

Puis activer Realtime sur la table `game_state` dans le dashboard Supabase :  
**Table Editor → game_state → Enable Realtime**
