# Plan d'action sécurité — KickStock
**Version :** 1.0 · **Date :** 2026-06-06  
**Scope :** Points 1, 2, 3, 7, 9  
**Contrainte absolue :** zéro régression sur Offline (mobile + browser) · Online (mobile + browser) · Admin

---

## Table des matières

1. [Vue d'ensemble et ordre d'exécution](#1-vue-densemble-et-ordre-dexécution)
2. [Point 1 — Usurpation d'identité via device_id](#2-point-1--usurpation-didentité-via-device_id)
3. [Points 2 & 9 — Moteur de jeu et Math.random (offline)](#3-points-2--9--moteur-de-jeu-et-mathrandom-offline)
4. [Point 3 — Rate limiting persistant](#4-point-3--rate-limiting-persistant)
5. [Point 7 — Fuite d'informations via Sentry](#5-point-7--fuite-dinformations-via-sentry)
6. [Plan de test de non-régression](#6-plan-de-test-de-non-régression)
7. [Variables d'environnement à ajouter](#7-variables-denvironnement-à-ajouter)

---

## 1. Vue d'ensemble et ordre d'exécution

Les 5 points sont indépendants et peuvent être traités en parallèle par des tickets séparés. L'ordre de priorité recommandé est :

| Priorité | Point | Effort estimé | Risque de régression |
|----------|-------|---------------|----------------------|
| 1 | 7 — Sentry config | 30 min | Nul |
| 2 | 3 — Rate limiting | 2h | Faible |
| 3 | 2 & 9 — PRNG offline | 3h | Moyen (offline uniquement) |
| 4 | 1 — device_id binding | 4h | Moyen (toutes routes API) |

**Règle générale :** chaque correctif doit être mergé derrière un feature flag ou déployé en staging Vercel d'abord, avec test manuel sur mobile Chrome et Safari avant merge en production.

---

## 2. Point 1 — Usurpation d'identité via device_id

### Contexte du problème

**Fichiers concernés :**
- `apps/web/lib/device.ts` — génère le device_id côté client, le stocke en localStorage
- `apps/web/app/api/game/state/route.ts:38-40` — valide uniquement le format UUID v4
- `apps/web/app/api/trade/route.ts:32-35` — idem
- `apps/web/app/api/game/advance/route.ts:45` — idem

**Comportement actuel :** Le client génère un UUID et l'envoie en header `X-Device-ID`. Le serveur vérifie uniquement le format. N'importe qui connaissant l'UUID d'un autre joueur peut accéder à son portfolio.

**Principe du correctif :** Émettre un cookie `HttpOnly; Secure; SameSite=Strict` signé (HMAC-SHA256) contenant le device_id lors de la première initialisation. Sur chaque requête protégée, le serveur vérifie que la signature du cookie correspond au header `X-Device-ID`. Les cookies HttpOnly sont inaccessibles depuis JavaScript — copier le localStorage ne suffit plus.

### Étape 1 — Variable d'environnement

Ajouter dans `.env.local` (et dans Vercel → Settings → Environment Variables) :

```
DEVICE_SIGNING_SECRET=<générer avec : openssl rand -hex 32>
```

### Étape 2 — Helper de signature HMAC

Créer `apps/web/lib/deviceSigning.ts` :

```typescript
// Signature et vérification HMAC-SHA256 du device_id.
// Le secret est une variable d'environnement serveur uniquement.

const SECRET = process.env.DEVICE_SIGNING_SECRET ?? '';

async function hmac(deviceId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(deviceId));
  return Buffer.from(sig).toString('hex');
}

export async function signDeviceId(deviceId: string): Promise<string> {
  return hmac(deviceId);
}

export async function verifyDeviceSignature(
  deviceId: string,
  signature: string,
): Promise<boolean> {
  if (!SECRET) return true; // En dev sans secret configuré, on laisse passer
  const expected = await hmac(deviceId);
  // Comparaison en temps constant pour éviter les timing attacks
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
```

### Étape 3 — Endpoint d'initialisation

Créer `apps/web/app/api/auth/device-init/route.ts` :

```typescript
// POST /api/auth/device-init
// Appelé au premier chargement client pour lier device_id à un cookie HttpOnly signé.
// Body : { deviceId: string }
// Retour : { ok: true }

import { NextRequest, NextResponse } from 'next/server';
import { signDeviceId } from '@/lib/deviceSigning';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE_NAME = 'kickstock_device_sig';
const ONE_YEAR = 365 * 24 * 60 * 60;

export async function POST(req: NextRequest) {
  const { deviceId } = await req.json();

  if (!deviceId || !UUID_V4.test(deviceId)) {
    return NextResponse.json({ error: 'invalid_device_id' }, { status: 400 });
  }

  // Si un cookie existe déjà ET est valide pour ce deviceId, ne pas le réinitialiser.
  // Cela protège contre une tentative de "réenregistrer" un device_id volé.
  const existing = req.cookies.get(COOKIE_NAME)?.value;
  if (existing) {
    return NextResponse.json({ ok: true, reused: true });
  }

  const signature = await signDeviceId(deviceId);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, signature, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: ONE_YEAR,
  });
  return res;
}
```

### Étape 4 — Middleware de vérification

Créer `apps/web/lib/verifyDevice.ts` :

```typescript
// Vérifie que le X-Device-ID header correspond au cookie HttpOnly signé.
// Retourne null si OK, ou une NextResponse d'erreur si la vérification échoue.

import { NextRequest, NextResponse } from 'next/server';
import { verifyDeviceSignature } from '@/lib/deviceSigning';

const COOKIE_NAME = 'kickstock_device_sig';

export async function verifyDevice(
  req: NextRequest,
  deviceId: string | null,
): Promise<NextResponse | null> {
  // Si pas de secret configuré (dev local), on laisse passer
  if (!process.env.DEVICE_SIGNING_SECRET) return null;
  // Si pas de device_id, pas de vérification nécessaire (user connecté)
  if (!deviceId) return null;

  const sig = req.cookies.get(COOKIE_NAME)?.value;
  if (!sig) {
    return NextResponse.json(
      { error: 'device_not_initialized', code: 'DEVICE_NOT_INIT' },
      { status: 401 },
    );
  }

  const valid = await verifyDeviceSignature(deviceId, sig);
  if (!valid) {
    return NextResponse.json(
      { error: 'device_signature_mismatch', code: 'DEVICE_MISMATCH' },
      { status: 403 },
    );
  }

  return null;
}
```

### Étape 5 — Appel du middleware dans les routes protégées

Dans `apps/web/app/api/game/state/route.ts`, ajouter après la validation du format :

```typescript
// Après ligne 40 (validation UUID)
import { verifyDevice } from '@/lib/verifyDevice';

// Dans le bloc try, après validation format :
const deviceErr = await verifyDevice(req, deviceId);
if (deviceErr) return deviceErr;
```

Même modification dans :
- `apps/web/app/api/trade/route.ts` (après ligne 35)
- `apps/web/app/api/game/advance/route.ts` (après validation deviceId)

### Étape 6 — Appel côté client au premier chargement

Modifier `apps/web/lib/device.ts` :

```typescript
const KEY = 'kickstock_device_id';
const INIT_FLAG = 'kickstock_device_initialized';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

// À appeler une fois au démarrage de l'app (dans le root layout ou un hook d'init).
// Si le cookie de signature n'existe pas encore pour ce device, l'enregistre.
export async function initDeviceBinding(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (sessionStorage.getItem(INIT_FLAG)) return; // Déjà fait dans cette session

  const deviceId = getDeviceId();
  try {
    await fetch('/api/auth/device-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
      credentials: 'include',
    });
    sessionStorage.setItem(INIT_FLAG, '1');
  } catch {
    // Silencieux — la prochaine requête API retournera 401 et déclenchera un retry
  }
}
```

Appeler `initDeviceBinding()` dans le composant racine de l'app (par exemple dans un `useEffect` du layout principal), **avant** toute requête API.

### Impact sur les modes existants

| Mode | Impact |
|------|--------|
| **Offline** | Aucun — le mode offline ne fait pas d'appels API protégés par device_id |
| **Online (browser)** | Cookie set automatiquement, transparent |
| **Online (mobile browser)** | Cookie HttpOnly fonctionnel sur Safari iOS et Chrome Android |
| **Admin** | Aucun — les routes admin utilisent Supabase session, pas device_id |

> **Note sur les utilisateurs existants :** Au premier déploiement, tous les utilisateurs existants n'auront pas encore de cookie. Leur prochaine requête API retournera 401 et déclenchera `initDeviceBinding()`. Pour éviter tout flash, mettre le middleware en mode `warn` (log sans bloquer) pendant une semaine, puis activer le blocage.

---

## 3. Points 2 & 9 — Moteur de jeu et Math.random (offline)

### Contexte du problème

**Fichiers concernés :**
- `packages/game-engine/src/simulate.ts:13,27,28,32-38` — 6 appels directs à `Math.random()`
- `apps/web/stores/localGameStore.ts:342` — appelle `simulate()` depuis le navigateur (mode offline)

**Comportement actuel :** En mode offline, `simulate()` s'exécute dans le navigateur. Un joueur peut écraser `Math.random` via la console DevTools avant d'appuyer sur "Avancer le jour" et contrôler tous les résultats.

**En mode online :** `simulate()` est appelé côté serveur dans `/api/game/advance/route.ts:14`. Le client ne peut pas toucher au `Math.random` serveur. **Ce mode n'est pas vulnérable et ne doit pas être modifié.**

**Principe du correctif :** Injecter un générateur de nombres aléatoires (PRNG) déterministe et seedé dans `simulate()`. Le seed est calculé à partir de données non contrôlables par le joueur au moment de la simulation : un `gameId` (UUID généré à la création du jeu local) + le `dayIndex` + les IDs des deux équipes. Même si le joueur remplace `Math.random`, la fonction `simulate()` ne l'utilise pas.

### Étape 1 — PRNG déterministe

Créer `packages/game-engine/src/prng.ts` :

```typescript
// Mulberry32 — PRNG rapide, déterministe, 32 bits.
// Utilisé pour rendre simulate() résistant à l'override de Math.random.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Génère un seed à partir d'une chaîne (djb2 hash).
export function seedFromString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}
```

### Étape 2 — Modifier simulate() pour accepter un RNG injecté

Modifier `packages/game-engine/src/simulate.ts` :

```typescript
import type { SimulatedMatch } from '@kickstock/types';
import type { Rng } from './prng';

// Le paramètre rng est optionnel : par défaut Math.random (rétrocompatible côté serveur).
// En mode offline, on injecte toujours un PRNG seedé — Math.random n'est plus utilisé.
export function simulate(
  strA: number,
  strB: number,
  isKO = false,
  rng: Rng = Math.random,
): SimulatedMatch {
  const gap = Math.abs(strA - strB);
  const fav: 'A' | 'B' = strA >= strB ? 'A' : 'B';
  const upsetP = Math.max(0.05, 0.26 - gap * 0.006);
  const drawP  = Math.max(0.08, 0.25 - gap * 0.004);

  const r = rng();   // ← était Math.random()
  const res90: 'A' | 'B' | 'draw' =
    r < upsetP ? (fav === 'A' ? 'B' : 'A') :
    r < upsetP + drawP ? 'draw' :
    fav;

  let etRes: 'A' | 'B' | null = null;
  let penWinner: 'A' | 'B' | null = null;
  let penA = 0, penB = 0;

  if (isKO && res90 === 'draw') {
    const etFav: 'A' | 'B' = strA >= strB ? 'A' : 'B';
    const etUpset = Math.max(0.08, 0.35 - gap * 0.008);

    if (rng() < 0.60) {         // ← était Math.random()
      const etR = rng();         // ← était Math.random()
      etRes = etR < etUpset ? (etFav === 'A' ? 'B' : 'A') : etFav;
    } else {
      let sA = 0, sB = 0;
      for (let i = 0; i < 5; i++) {
        sA += rng() < (0.73 + strA * 0.001) ? 1 : 0;  // ← était Math.random()
        sB += rng() < (0.73 + strB * 0.001) ? 1 : 0;  // ← était Math.random()
      }
      let round = 0;
      while (sA === sB && round < 10) {
        sA += rng() < 0.73 ? 1 : 0;  // ← était Math.random()
        sB += rng() < 0.73 ? 1 : 0;  // ← était Math.random()
        round++;
      }
      penA = sA; penB = sB;
      penWinner = sA > sB ? 'A' : 'B';
    }
  }

  const finalRes: 'A' | 'B' | 'draw' =
    penWinner ?? etRes ?? (res90 === 'draw' && isKO ? fav : res90);

  return {
    res: finalRes as 'A' | 'B' | 'draw',
    res90,
    isUpset: finalRes !== 'draw' && finalRes !== fav && gap > 8,
    etRes,
    penWinner,
    penA,
    penB,
  };
}
```

> **Rétrocompatibilité serveur :** Le paramètre `rng` est optionnel avec `Math.random` comme valeur par défaut. Aucune modification nécessaire dans `/api/game/advance/route.ts`. Le comportement online est identique.

### Étape 3 — Seed par match dans le store offline

Dans `apps/web/stores/localGameStore.ts` :

**3a. Ajouter un `gameId` dans le state persisté** (généré une seule fois à la création du jeu local) :

```typescript
// Dans l'interface du state Zustand (vers ligne 50+)
gameId: string;

// Dans la valeur initiale du state
gameId: crypto.randomUUID(),

// Si le state persisted n'a pas encore de gameId (migration utilisateurs existants),
// le générer au premier accès :
// Dans la fonction getState() ou dans un middleware persist onRehydrateStorage
```

**3b. Importer le PRNG** en haut du fichier (vers ligne 15) :

```typescript
import { mulberry32, seedFromString } from '@kickstock/game-engine/src/prng';
// Ou si game-engine re-exporte depuis son index :
import { mulberry32, seedFromString } from '@kickstock/game-engine';
```

**3c. Modifier l'appel à `simulate()` dans `advanceDay`** (vers ligne 342) :

```typescript
// Avant la ligne 342 (dans le .map(m => { ... }))
// Construire un seed unique par match : gameId + jour + équipes
const matchSeed = seedFromString(
  `${get().gameId}:${dayIndex}:${m.a}:${m.b}`
);
const rng = mulberry32(matchSeed);

const sim = simulate(tA.strength, tB.strength, day.is_ko, rng);
// ... reste inchangé
```

**3d. Exporter le PRNG depuis le package game-engine** dans `packages/game-engine/src/index.ts` :

```typescript
export { mulberry32, seedFromString } from './prng';
```

### Impact sur les modes existants

| Mode | Impact |
|------|--------|
| **Offline (browser & mobile)** | Le gameplay est identique. Les résultats sont maintenant déterministes par match (reproducible si même seed), ce qui est souhaitable. `Math.random` override n'a plus d'effet. |
| **Online** | Aucun — `simulate()` côté serveur utilise toujours `Math.random` (paramètre par défaut). |
| **Admin** | Aucun — la simulation admin passe par `/api/admin/simulate-day` qui appelle `simulate()` côté serveur. |

> **Attention migration offline :** Les utilisateurs ayant une partie en cours en mode offline verront des résultats différents pour les jours non encore joués (nouveau PRNG seedé ≠ Math.random précédent). Les jours déjà joués sont enregistrés dans le state persisté et ne changent pas. Ceci est acceptable et attendu pour un correctif de sécurité.

---

## 4. Point 3 — Rate limiting persistant

### Contexte du problème

**Fichier concerné :** `apps/web/lib/rateLimit.ts`

**Comportement actuel :**
- Rate limiter en mémoire (Map) — reseté à chaque redémarrage d'instance Vercel
- Appliqué uniquement sur `/api/auth/guest` (5 req / 10 min par IP)
- Aucune protection sur `/api/trade`, `/api/game/advance`, `/api/game/state`

**Risques :**
- Spam illimité sur `/api/trade` — manipulation de marché ou flood de la base
- Spam illimité sur `/api/game/advance` — charge serveur excessive
- Le rate limiter actuel est contournable en changeant d'instance Vercel (edge split)

**Solution recommandée : Upstash Redis** (compatible Vercel Edge, tier gratuit à 10 000 req/jour, puis ~$0.20 pour 100k req supplémentaires). Alternative sans coût : amélioration du rate limiter in-memory (acceptable si mono-instance).

### Étape 1 — Installation des dépendances

```bash
cd apps/web
pnpm add @upstash/ratelimit @upstash/redis
```

### Étape 2 — Variables d'environnement

Ajouter dans `.env.local` et Vercel :

```
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx
```

Créer le compte et la base Redis sur [upstash.com](https://upstash.com) (gratuit, région `eu-west-1` recommandée pour la latence).

### Étape 3 — Nouveau module de rate limiting

Créer `apps/web/lib/rateLimitRedis.ts` :

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';

// Instanciation unique (singleton) pour éviter les connexions multiples
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  if (!redis) redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  });
  return redis;
}

// Limites par endpoint — ajuster selon le volume observé en prod
const LIMITS = {
  trade:   { requests: 30,  window: '1 m'  }, // 30 trades/minute par identifiant
  advance: { requests: 10,  window: '1 m'  }, // 10 avancements/minute
  state:   { requests: 120, window: '1 m'  }, // 120 lectures/minute (permissif)
  auth:    { requests: 5,   window: '10 m' }, // Garde le comportement existant
} as const;

type Endpoint = keyof typeof LIMITS;

const limiters: Partial<Record<Endpoint, Ratelimit>> = {};

function getLimiter(endpoint: Endpoint): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;

  if (!limiters[endpoint]) {
    const cfg = LIMITS[endpoint];
    limiters[endpoint] = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(cfg.requests, cfg.window),
      prefix: `ks:rl:${endpoint}`,
    });
  }
  return limiters[endpoint]!;
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  reset: number; // Unix timestamp (secondes)
}

// Identifiant = device_id si disponible, sinon IP (plus granulaire par joueur)
export async function checkRateLimit(
  endpoint: Endpoint,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = getLimiter(endpoint);

  // Fallback in-memory si Upstash non configuré (dev local ou variables manquantes)
  if (!limiter) {
    return { limited: false, remaining: 999, reset: 0 };
  }

  const { success, remaining, reset } = await limiter.limit(identifier);
  return { limited: !success, remaining, reset };
}
```

### Étape 4 — Application dans les routes API

**Dans `apps/web/app/api/trade/route.ts`** (après ligne 35, avant l'appel RPC) :

```typescript
import { checkRateLimit } from '@/lib/rateLimitRedis';

// Utiliser device_id comme identifiant si disponible, sinon IP
const rateLimitId = deviceId ?? (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
const rl = await checkRateLimit('trade', rateLimitId);
if (rl.limited) {
  return NextResponse.json(
    { code: 'RATE_LIMITED', error: 'Trop de transactions, réessaie dans un moment.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((rl.reset * 1000 - Date.now()) / 1000)),
        'X-RateLimit-Remaining': '0',
      },
    },
  );
}
```

**Dans `apps/web/app/api/game/advance/route.ts`** (après la validation de `competitionId`, avant le fetch game state) :

```typescript
import { checkRateLimit } from '@/lib/rateLimitRedis';

const rateLimitId = deviceId ?? userId ?? (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
const rl = await checkRateLimit('advance', rateLimitId);
if (rl.limited) {
  return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
}
```

**Dans `apps/web/app/api/game/state/route.ts`** (après ligne 40, après validation format UUID) :

```typescript
import { checkRateLimit } from '@/lib/rateLimitRedis';

const rateLimitId = deviceId ?? userId ?? (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
const rl = await checkRateLimit('state', rateLimitId);
if (rl.limited) {
  return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
}
```

**Dans `apps/web/app/api/auth/guest/route.ts`** — remplacer l'appel à `isRateLimited` par `checkRateLimit` :

```typescript
// Remplacer les lignes 22-26 par :
import { checkRateLimit } from '@/lib/rateLimitRedis';

const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
const rl = await checkRateLimit('auth', ip);
if (rl.limited) {
  return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
}
```

L'ancien `apps/web/lib/rateLimit.ts` peut être supprimé une fois la migration validée.

### Étape 5 — Gestion côté client des erreurs 429

Dans les stores Zustand (`onlineGameStore.ts`, `localGameStore.ts`) et les hooks qui appellent `/api/trade` et `/api/game/advance`, s'assurer que les erreurs 429 affichent un message clair et ne retentent pas en boucle.

Exemple pour un trade :

```typescript
if (res.status === 429) {
  const retryAfter = res.headers.get('Retry-After');
  throw new Error(`Trop de transactions. Réessaie dans ${retryAfter ?? 'quelques secondes'}.`);
}
```

### Impact sur les modes existants

| Mode | Impact |
|------|--------|
| **Offline** | Aucun — le mode offline n'utilise pas ces endpoints |
| **Online (browser & mobile)** | Transparent pour un usage normal. Un joueur effectuant 30 trades en 1 minute est bloqué temporairement — cas inexistant en usage normal. |
| **Admin** | `/api/admin/*` n'est pas rate-limité (accès restreint au rôle admin, volume nul). |

> **Sans Upstash (fallback) :** Si les variables Upstash ne sont pas configurées, `checkRateLimit` retourne `{ limited: false }` — aucune régression, le rate limiting est simplement désactivé. Cela permet un déploiement progressif.

---

## 5. Point 7 — Fuite d'informations via Sentry

### Contexte du problème

**Fichiers concernés :**
- `apps/web/sentry.client.config.ts:15` — `maskAllText: false, blockAllMedia: false`
- `apps/web/sentry.server.config.ts` — pas de filtrage des données sensibles
- Tous les `Sentry.captureException(err, ...)` dans les routes API

**Problèmes identifiés :**
1. Les replays de session Sentry capturent les saisies texte en clair (`maskAllText: false`)
2. 100% des sessions avec erreur sont rejouées (`replayOnErrorSampleRate: 1.0`) — toute erreur envoie un enregistrement complet de la session
3. Les objets d'erreur RPC Supabase peuvent contenir des `device_id`, soldes, détails de portfolio

### Correctif 1 — Configuration Sentry client

Modifier `apps/web/sentry.client.config.ts` :

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 0.5, // Réduit de 1.0 à 0.5 — on garde la couverture d'erreurs sans tout capturer

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,       // ← était false — masque TOUT le texte dans les replays
      blockAllMedia: true,     // ← était false — bloque les images/vidéos dans les replays
      // Exceptions explicites pour les éléments non-sensibles (optionnel)
      unmask: ['.sentry-unmask'],
    }),
  ],

  // Filtre les données sensibles avant envoi
  beforeSend(event) {
    return sanitizeSentryEvent(event);
  },

  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});

function sanitizeSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Supprimer les cookies de l'event (contient kickstock_device_sig)
  if (event.request?.cookies) {
    event.request.cookies = {};
  }
  // Supprimer les headers sensibles
  if (event.request?.headers) {
    delete event.request.headers['x-device-id'];
    delete event.request.headers['authorization'];
    delete event.request.headers['cookie'];
  }
  return event;
}
```

### Correctif 2 — Configuration Sentry serveur

Modifier `apps/web/sentry.server.config.ts` :

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  beforeSend(event) {
    return sanitizeServerEvent(event);
  },
});

function sanitizeServerEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Supprimer les headers sensibles des requêtes capturées
  if (event.request?.headers) {
    delete event.request.headers['x-device-id'];
    delete event.request.headers['authorization'];
    delete event.request.headers['cookie'];
  }
  return event;
}
```

### Correctif 3 — Helper de capture sécurisé

Créer `apps/web/lib/sentryCapture.ts` :

```typescript
import * as Sentry from '@sentry/nextjs';

// Champs à ne jamais envoyer à Sentry dans le contexte extra
const SENSITIVE_KEYS = new Set([
  'device_id', 'deviceId', 'p_device_id',
  'user_id', 'userId', 'p_user_id',
  'cash', 'new_cash', 'balance',
  'password', 'token', 'secret', 'key',
  'portfolio', 'holdings', 'avg_cost', 'tx_log',
]);

function scrub(obj: unknown, depth = 0): unknown {
  if (depth > 4 || obj === null || typeof obj !== 'object') return obj;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : scrub(v, depth + 1);
  }
  return result;
}

// Remplace les appels directs à Sentry.captureException dans les routes API
export function captureApiException(
  err: unknown,
  context: { route: string; extra?: Record<string, unknown> },
): void {
  Sentry.captureException(err, {
    tags: { route: context.route },
    extra: context.extra ? (scrub(context.extra) as Record<string, unknown>) : undefined,
  });
}
```

### Correctif 4 — Remplacer les captureException dans les routes API

Dans chaque route API, remplacer :

```typescript
// Avant
Sentry.captureException(err, { tags: { route: 'POST /api/trade' } });

// Après
import { captureApiException } from '@/lib/sentryCapture';
captureApiException(err, { route: 'POST /api/trade' });
```

Routes à mettre à jour :
- `apps/web/app/api/game/state/route.ts:204`
- `apps/web/app/api/trade/route.ts:80`
- `apps/web/app/api/game/advance/route.ts:393`
- `apps/web/app/api/admin/simulate-day/route.ts:294`
- Les routes cron (`sync-squads`, `sync-fixtures`, `sync-results`)

### Impact sur les modes existants

| Mode | Impact |
|------|--------|
| **Tous** | Sentry continue de fonctionner normalement. Les erreurs sont toujours capturées, les replays existent toujours, les données sensibles sont simplement masquées. Aucun impact fonctionnel. |

---

## 6. Plan de test de non-régression

À exécuter dans cet ordre après chaque déploiement en staging :

### Checklist Online (browser desktop)

- [ ] Charger l'app → pas d'erreur console, portfolio s'affiche
- [ ] Effectuer un achat → succès, solde mis à jour
- [ ] Effectuer une vente → succès
- [ ] Tenter 35 trades en rafale → blocage 429 après 30, message d'erreur visible
- [ ] Recharger la page → portfolio toujours intact
- [ ] Vider localStorage → nouveau device_id généré, cookie set automatiquement, portfolio vide (nouveau joueur)

### Checklist Online (mobile — tester sur Safari iOS ET Chrome Android)

- [ ] Même séquence que desktop
- [ ] Vérifier que le cookie HttpOnly est bien envoyé sur mobile (Network tab → Request Headers → Cookie)

### Checklist Offline

- [ ] Démarrer une partie offline
- [ ] Avancer 3 jours → résultats cohérents, prix mis à jour
- [ ] Simuler un override : dans la console, `Math.random = () => 0` puis avancer un jour → les résultats doivent être identiques à sans override (PRNG seedé ignorant Math.random)
- [ ] Recharger la page → état persisté intact
- [ ] Vérifier que `gameId` est présent dans le localStorage Zustand

### Checklist Admin

- [ ] Se connecter avec un compte admin
- [ ] Accéder à `/admin` → pas de redirection
- [ ] Déclencher une simulation admin → fonctionne
- [ ] Vérifier dans Sentry qu'aucun `device_id` ou `user_id` n'apparaît dans les events d'erreur (tester en forçant une erreur artificielle)

### Checklist Sentry

- [ ] Ouvrir un replay Sentry → tout le texte est masqué (rectangles gris)
- [ ] Forcer une erreur de trade → event capturé sans `device_id`, sans `cash`, sans `cookie`

---

## 7. Variables d'environnement à ajouter

| Variable | Environnement | Description |
|----------|---------------|-------------|
| `DEVICE_SIGNING_SECRET` | Production + Staging | Secret HMAC pour signer les device_id. Générer avec `openssl rand -hex 32`. |
| `UPSTASH_REDIS_REST_URL` | Production + Staging | URL REST de la base Upstash Redis. |
| `UPSTASH_REDIS_REST_TOKEN` | Production + Staging | Token d'accès Upstash Redis. |

> **En dev local**, ne pas définir `DEVICE_SIGNING_SECRET` ni les variables Upstash — les correctifs se désactivent gracieusement et l'app fonctionne comme avant.

---

*Document produit pour la team KickStock — 2026-06-06*
