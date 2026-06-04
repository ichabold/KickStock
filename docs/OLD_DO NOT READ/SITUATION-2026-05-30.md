# KickStock — Situation au 30 mai 2026

> Document de debriefing post-incident build.  
> Décrit ce qui existait au moment du plantage, ce qui a été corrigé, et ce qui reste à faire pour activer le mode Online.

---

## 1. Ce qui avait planté et pourquoi

### Symptôme initial
Le build `next build` tournait depuis **8h44** sans jamais se terminer ni afficher d'erreur.

### Causes profondes (par ordre de découverte)

#### Cause 1 — Store pnpm corrompu (racine du problème)
Les `node_modules` avaient des fichiers ESM de `next@14.2.3` manquants dans la couche `.pnpm/` locale (ex: `dist/esm/server/lib/trace/tracer.js`, `dist/esm/shared/lib/constants.js`, etc.). Les symlinks étaient présents mais pointaient vers des entrées incomplètes du store.

**Conséquence** : webpack tentait de compiler le bundle Edge/middleware (qui utilise les fichiers ESM de Next.js), tombait sur des fichiers manquants, et le worker thread OOMait silencieusement → le process parent recevait un `ETIMEDOUT` sur le canal IPC → le build attendait indéfiniment.

**Fix** : suppression complète de `node_modules/` + `pnpm install` pour relinker proprement depuis le store global (qui avait les fichiers corrects).

#### Cause 2 — `@sentry/nextjs` 10.x instrumente le middleware avec du code ESM incompatible
`withSentryConfig` active par défaut `autoInstrumentMiddleware: true`, qui injecte du code Sentry dans `middleware.ts` au moment du build. Ce code référence `@sentry/nextjs/build/esm/package.json` dont la résolution webpack échoue avec Next.js 14 (erreur : `directory description file: No file content`).

**Fix** : ajout de `webpack: { autoInstrumentMiddleware: false }` dans les options de `withSentryConfig`.

#### Cause 3 — Heap Node.js insuffisant pour le build
Le worker webpack pour le bundle middleware/Edge consomme plus de 3 Go de RAM. Sur le heap par défaut (≈3 Go), l'OOM aggravait le problème ci-dessus.

**Fix** : `NODE_OPTIONS='--max-old-space-size=4096'` dans le script `build` de `package.json`.

---

## 2. Ce qui avait été développé (V17, non buildable)

Au moment du plantage, les modifications suivantes étaient **non commitées** sur `main` :

### 2a. Migration `next-intl` (refacto i18n)

| Fichier | Changement |
|---|---|
| `apps/web/app/layout.tsx` | Remplacé `cookies()` + `resolveLocale()` par `getLocale()` / `getMessages()` de `next-intl/server` |
| `apps/web/next.config.js` | Ajout de `withNextIntl(nextConfig)` via `require('next-intl/plugin')` |
| `apps/web/i18n/request.ts` | Nouveau fichier — config `getRequestConfig` pour next-intl v4 |

**État actuel** : `layout.tsx` et `next.config.js` ont été **revertés** à la version HEAD (V17) pour débloquer le build. `apps/web/i18n/request.ts` est toujours présent en **untracked** (non commité, non utilisé).

**Pourquoi revert** : le plugin `next-intl/plugin` v4 démarrait un file-watcher `@parcel/watcher` au moment du build qui empêchait le process de se terminer. De plus, il créait une dépendance circulaire (`next-intl/server` → `next-intl/config` → `i18n/request.ts` → `next-intl/server`) potentiellement problématique avec la version actuelle de Next.js 14.

**À noter** : le plugin `withNextIntl` n'est **pas nécessaire** pour l'usage actuel. `NextIntlClientProvider` + lecture directe des cookies fonctionne parfaitement et est plus simple.

---

## 3. État actuel du code après corrections

### Ce qui est modifié par rapport à V17 (HEAD)

```
apps/web/next.config.js   → +2 lignes : webpack: { autoInstrumentMiddleware: false }
apps/web/package.json     → build script : + NODE_OPTIONS='--max-old-space-size=4096'
```

### Ce qui est untracked (à décider)
```
apps/web/i18n/request.ts  → fichier next-intl config, non utilisé actuellement
```

### Build
```
✓ 13/13 pages statiques générées
✓ Middleware compilé (81.7 kB)
✓ Aucune erreur TypeScript
Durée : ~30 secondes
```

---

## 4. Architecture Online — ce qui est prêt vs ce qui reste

### ✅ Prêt (commité en V17)

| Composant | Fichier | État |
|---|---|---|
| Migration DB | `db/migrations/010_api_integration.sql` | Écrit, à exécuter sur Supabase |
| Couche API-Football | `apps/web/lib/football-api.ts` | Complet |
| Normalizer fixtures | `apps/web/lib/normalizer.ts` | Complet |
| Cron sync-fixtures | `apps/web/app/api/cron/sync-fixtures/route.ts` | Complet |
| Cron sync-results | `apps/web/app/api/cron/sync-results/route.ts` | Complet |
| Processing résultats réels | `apps/web/lib/process-real-result.ts` | Complet |
| Avancement de phase | `apps/web/lib/check-advance-phase.ts` | Complet |
| Bootstrap client | `apps/web/lib/bootstrap.ts` + `/api/competition/bootstrap` | Complet |
| Team mapping FIFA WC | `apps/web/lib/team-mapping/` | Complet |
| Fenêtre de match | `apps/web/lib/match-window.ts` | Complet |
| `localGameStore` db-driven | `apps/web/stores/localGameStore.ts` | Complet (plus de NATIONS/CALENDAR hardcodés) |
| Mode switch UI | `apps/web/hooks/useGameMode.ts` + `AuthWidget.tsx` | Complet |
| LiveTab | `apps/web/components/mobile/LiveTab.tsx` | Complet |
| `onlineGameStore` | `apps/web/stores/onlineGameStore.ts` | Écrit (225 lignes) mais **non activé** |

### ❌ Bloquant pour activer le mode Online

#### S5 — Activer `onlineGameStore` comme défaut

`apps/web/stores/gameStore.ts` re-exporte encore `localGameStore`. Le TODO S5 est :

```ts
// Actuellement dans gameStore.ts :
export { useLocalGameStore as useGameStore, ... } from './localGameStore';

// À faire :
import { getGameModeSync } from '@/hooks/useGameMode';
const mode = getGameModeSync();
export const { useGameStore, ... } = mode === 'online'
  ? onlineGameStoreExports
  : localGameStoreExports;
```

> ⚠️ `onlineGameStore.ts` importe encore `NATIONS` et `CALENDAR` depuis `@kickstock/constants` — ces imports doivent être remplacés par les données du bootstrap (comme c'est déjà fait dans `localGameStore`).

#### DB — Migration à exécuter
La migration `010_api_integration.sql` n'a pas encore été exécutée sur Supabase (renomme les tables, crée `competitions`, `teams`, `competition_teams`, `competition_days`, ajoute colonnes sur `matches`).

#### Variables d'environnement manquantes
```
API_FOOTBALL_KEY=    # clé api-sports.io
CRON_SECRET=         # openssl rand -hex 32
UPSTASH_REDIS_REST_URL=    # optionnel mais recommandé
UPSTASH_REDIS_REST_TOKEN=  # optionnel mais recommandé
```

---

## 5. Prochaines étapes recommandées (dans l'ordre)

```
1. Committer les 2 fixes build (next.config.js + package.json)
   → supprimer apps/web/i18n/request.ts (non utilisé)

2. Exécuter 010_api_integration.sql sur Supabase

3. Remplir API_FOOTBALL_KEY + CRON_SECRET dans .env.local + Vercel

4. Tester sync-fixtures manuellement (curl local)

5. S5 — gameStore.ts : activer onlineGameStore basé sur getGameModeSync()
   → fixer les imports NATIONS/CALENDAR dans onlineGameStore.ts d'abord

6. Test E2E mode online en local avec données réelles
```

---

## 6. Points de vigilance pour la suite

- **`onlineGameStore.ts` a encore des imports hardcodés** (`NATIONS`, `CALENDAR`) — à remplacer par bootstrap avant d'activer
- **`pnpm approve-builds`** à exécuter pour autoriser les scripts de `@parcel/watcher` et `@swc/core` si le plugin `next-intl` est réintroduit plus tard
- **Node.js v24** : `next@14.2.3` fonctionne mais est testé officiellement sur v18/v20. Envisager de spécifier la version Node dans un `.nvmrc` pour cohérence entre devs/CI

---

*Rédigé le 30 mai 2026 — suite à l'incident build de 8h44*
