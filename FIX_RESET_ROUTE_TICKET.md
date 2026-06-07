# Ticket dev — Sécuriser /api/game/reset (points 1 & 3)

**Priorité :** Haute — bloque la clôture des points 1 et 3 de l'audit sécurité  
**Effort estimé :** 15-30 min  
**Fichiers à modifier :** 2

---

## Contexte

Lors du déploiement des correctifs sur le device_id (point 1) et le rate limiting (point 3), la route `POST /api/game/reset` a été oubliée. Elle reste donc exposée exactement aux problèmes que ces correctifs visaient à éliminer :

- **Pas de vérification de signature device_id** → n'importe qui connaissant (ou devinant) le `device_id` UUID v4 d'un autre joueur peut envoyer une requête à cette route et **réinitialiser son portfolio à zéro** (cash, holdings, transactions, best_score effacés).
- **Pas de rate limiting** → cette attaque peut être répétée en boucle sans aucune limite.

La même mécanique de protection est déjà en place, testée et validée sur 3 autres routes (`/api/trade`, `/api/game/advance`, `/api/game/state`). Il s'agit simplement de l'appliquer ici aussi, à l'identique.

---

## Fichier à modifier 1/2 — `apps/web/lib/rateLimitRedis.ts`

Ajouter un profil de limite dédié à la route `reset` dans l'objet `LIMITS` :

```typescript
const LIMITS = {
  trade:   { requests: 30,  window: '1 m'  },
  advance: { requests: 10,  window: '1 m'  },
  state:   { requests: 120, window: '1 m'  },
  auth:    { requests: 5,   window: '10 m' },
  reset:   { requests: 5,   window: '1 m'  }, // ← nouveau — réinitialiser un portfolio est une action rare
} as const;
```

> **Pourquoi 5/min :** un reset est une action volontaire et peu fréquente pour un joueur légitime (au pire une ou deux fois par session). 5/min laisse une marge confortable pour l'usage normal tout en bloquant un script de spam.

Aucune autre modification n'est nécessaire dans ce fichier — `checkRateLimit('reset', identifiant)` fonctionnera automatiquement avec ce nouveau profil grâce au typage `Endpoint = keyof typeof LIMITS`.

---

## Fichier à modifier 2/2 — `apps/web/app/api/game/reset/route.ts`

### a) Ajouter les imports

En haut du fichier, à côté des imports existants (après la ligne `import { captureApiException } from '@/lib/sentryCapture';`) :

```typescript
import { verifyDevice }   from '@/lib/verifyDevice';
import { checkRateLimit } from '@/lib/rateLimitRedis';
```

### b) Ajouter les vérifications dans le handler POST

Le fichier actuel (lignes 16-23) :

```typescript
export async function POST(req: NextRequest) {
  try {
    const { competitionId } = await req.json() as { competitionId: number };
    const deviceId = req.headers.get('X-Device-ID') ?? null;

    if (!competitionId || !deviceId) {
      return NextResponse.json({ error: 'competitionId et X-Device-ID requis' }, { status: 400 });
    }

    const admin = createAdminClient();
```

Devient :

```typescript
export async function POST(req: NextRequest) {
  try {
    const { competitionId } = await req.json() as { competitionId: number };
    const deviceId = req.headers.get('X-Device-ID') ?? null;

    if (!competitionId || !deviceId) {
      return NextResponse.json({ error: 'competitionId et X-Device-ID requis' }, { status: 400 });
    }

    // ── Vérification de signature device_id (anti-usurpation) ─────────────────
    const deviceErr = await verifyDevice(req, deviceId);
    if (deviceErr) return deviceErr;

    // ── Rate limiting (anti-spam reset) ───────────────────────────────────────
    const rateLimitId = deviceId
      ?? (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
    const rl = await checkRateLimit('reset', rateLimitId);
    if (rl.limited) {
      return NextResponse.json(
        { error: 'rate_limited', code: 'RESET_RATE_LIMITED' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rl.reset * 1000 - Date.now()) / 1000)),
          },
        },
      );
    }

    const admin = createAdminClient();
```

> **Remarque sur l'ordre des vérifications :** on vérifie le device AVANT le rate limit. Cela évite de "consommer" un crédit de rate limit pour une requête qui sera de toute façon rejetée pour usurpation — comportement cohérent avec les 3 autres routes déjà corrigées (`trade`, `game/advance`, `game/state`).

> **Remarque sur `rateLimitId` :** contrairement à `trade` et `advance` qui utilisent `deviceId ?? userId ?? ip`, ici on utilise `deviceId ?? ip` car `userId` n'est résolu que plus bas dans la fonction (ligne 27 du fichier actuel). Si on veut être rigoureusement cohérent avec les autres routes, on peut déplacer la résolution de `userId` (lignes 27-32 actuelles) avant le bloc de rate limiting — au choix de l'équipe, l'impact est négligeable car `deviceId` est de toute façon obligatoire pour atteindre cette route (vérifié ligne 21-23).

---

## Fichier final attendu (pour référence — ne pas copier-coller tel quel, fusionner avec le code existant)

```typescript
/**
 * POST /api/game/reset
 * Réinitialise le portfolio du joueur pour une compétition donnée.
 * Body: { competitionId: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { captureApiException } from '@/lib/sentryCapture';
import { verifyDevice }   from '@/lib/verifyDevice';
import { checkRateLimit } from '@/lib/rateLimitRedis';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

export async function POST(req: NextRequest) {
  try {
    const { competitionId } = await req.json() as { competitionId: number };
    const deviceId = req.headers.get('X-Device-ID') ?? null;

    if (!competitionId || !deviceId) {
      return NextResponse.json({ error: 'competitionId et X-Device-ID requis' }, { status: 400 });
    }

    // ── Vérification de signature device_id (anti-usurpation) ─────────────────
    const deviceErr = await verifyDevice(req, deviceId);
    if (deviceErr) return deviceErr;

    // ── Rate limiting (anti-spam reset) ───────────────────────────────────────
    const rateLimitId = deviceId
      ?? (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
    const rl = await checkRateLimit('reset', rateLimitId);
    if (rl.limited) {
      return NextResponse.json(
        { error: 'rate_limited', code: 'RESET_RATE_LIMITED' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rl.reset * 1000 - Date.now()) / 1000)),
          },
        },
      );
    }

    const admin = createAdminClient();

    let userId: string | null = null;
    try {
      const sb = await createServerClient();
      const { data: { user } } = await sb.auth.getUser();
      userId = user?.id ?? null;
    } catch { /* anonymous */ }

    const { data: portfolioId } = await adm(admin).rpc(
      'get_or_create_competition_portfolio',
      { p_competition_id: competitionId, p_device_id: deviceId, p_user_id: userId },
    );

    if (!portfolioId) {
      return NextResponse.json({ error: 'Portfolio introuvable' }, { status: 404 });
    }

    await adm(admin)
      .from('portfolios')
      .update({ cash: 10000, avg_cost: {}, tx_log: [], best_score: null })
      .eq('id', portfolioId);

    await adm(admin)
      .from('holdings')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('competition_id', competitionId);

    await adm(admin)
      .from('transactions')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('competition_id', competitionId);

    return NextResponse.json({ ok: true });

  } catch (err) {
    captureApiException(err, { route: 'POST /api/game/reset' });
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
```

---

## Plan de test (à exécuter en staging avant merge)

### Cas nominal (ne doit PAS régresser)

- [ ] **Offline** : reset du portfolio depuis l'UI → fonctionne normalement, portfolio remis à `cash: 10000`, holdings et transactions vidés
- [ ] **Online (browser & mobile)** : idem, avec un compte connecté ET en mode invité (guest)
- [ ] Reset suivi d'un rechargement de page → état cohérent, pas d'erreur

### Cas d'attaque (doivent être bloqués)

- [ ] Envoyer une requête `POST /api/game/reset` avec un `X-Device-ID` valide en format mais qui n'est PAS celui du navigateur courant (ex. UUID v4 généré manuellement, ou copié depuis un autre appareil) → doit retourner **401 `device_not_initialized`** ou **403 `device_signature_mismatch`**, et le portfolio ciblé ne doit PAS être modifié
- [ ] Envoyer 6 requêtes de reset légitimes en moins d'une minute (avec le bon device_id + cookie) → la 6e doit retourner **429 `rate_limited`** avec un header `Retry-After`
- [ ] Vérifier en base que dans les deux cas ci-dessus, **aucune ligne `portfolios`/`holdings`/`transactions` n'a été modifiée**

### Vérification croisée

- [ ] Comparer le comportement avec celui de `/api/trade` sur les mêmes scénarios d'attaque (doit être identique : mêmes codes d'erreur, mêmes statuts HTTP)

---

## Définition of Done

- [ ] Code mergé avec les deux modifications ci-dessus
- [ ] Les 3 cas d'attaque du plan de test sont bloqués comme attendu
- [ ] Les 3 cas nominaux (offline, online browser, online mobile) fonctionnent sans régression
- [ ] `DEVICE_SIGNING_SECRET` confirmé présent dans les variables d'environnement de l'environnement de test (sinon `verifyDevice` ne fait rien — voir note ci-dessous)

> ⚠️ **Rappel important :** `verifyDevice()` ne fait strictement rien si la variable d'environnement `DEVICE_SIGNING_SECRET` n'est pas définie (comportement de repli pour le dev local). Pour que les tests d'attaque ci-dessus soient valides, **vérifier que cette variable est bien configurée dans l'environnement de test/staging** avant de lancer le plan de test.

---

*Ticket préparé suite à l'audit de sécurité du 2026-06-07 — réfère-toi à `SECURITY_AUDIT_REPORT_FOR_ERIC.md` pour le contexte complet de l'audit.*
