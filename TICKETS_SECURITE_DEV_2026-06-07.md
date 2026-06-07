# Tickets sécurité — à traiter par la dev
**Source :** `AUDIT_SECURITE_INDEPENDANT_2026-06-07.md` (points 1, 2, 3)
**Date :** 2026-06-07
**Effort total estimé :** ~3-4h pour les 3 tickets

---

## Ticket 1 — Rate limiter `/api/auth/check-email` (énumération d'emails)

**Sévérité :** 🟠 Moyenne-Haute · **Effort :** 15 min

### Problème
`GET /api/auth/check-email?q=<email>` est public, sans authentification, et **n'a aucun rate limiting** — contrairement à `/api/auth/guest` qui en a un. Il répond en clair `{ exists: boolean, confirmed: boolean }`. Testé en direct sur la prod :

```bash
curl -s "https://kick-stock-web.vercel.app/api/auth/check-email?q=test@test.com"
# → {"exists":false,"confirmed":false}   (HTTP 200, aucune limite après plusieurs appels)
```

Un script trivial peut donc vérifier en masse si une liste d'adresses email est inscrite (et si le compte est confirmé) — risque de vie privée + reconnaissance pour du phishing ciblé.

### Fichier à modifier
`apps/web/app/api/auth/check-email/route.ts`

### Correctif

Ajouter exactement le même mécanisme que `/api/auth/guest/route.ts` (qui utilise déjà `checkRateLimit('auth', ip)`). Soit réutiliser le profil `auth` existant, soit créer un profil dédié `check-email` dans `lib/rateLimitRedis.ts` (recommandé, pour ne pas mélanger avec la création de compte) :

```typescript
// Dans lib/rateLimitRedis.ts — ajouter au LIMITS existant :
const LIMITS = {
  // … existants …
  checkEmail: { requests: 10, window: '10 m' }, // anti-énumération
} as const;
```

Puis dans `app/api/auth/check-email/route.ts`, en tout début de `GET` (avant la validation du paramètre `q`) :

```typescript
import { checkRateLimit } from '@/lib/rateLimitRedis';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = await checkRateLimit('checkEmail', ip);
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const email = req.nextUrl.searchParams.get('q')?.trim().toLowerCase();
  // … reste inchangé
}
```

### Bonus (optionnel, si le temps le permet)
Le champ `confirmed` donne une info supplémentaire à un attaquant (cible les comptes "orphelins" pour tentative de re-création/prise de contrôle). Si le front n'en a pas un besoin strict avant la création de compte, envisager de ne renvoyer que `{ exists }`.

### Test de non-régression
- [ ] Le flow normal de création de compte (vérification d'email en cours de saisie) fonctionne toujours sous la limite (10 req/10 min/IP est largement suffisant pour un usage humain).
- [ ] Au-delà de 10 requêtes en 10 min depuis la même IP → `429 too_many_requests`.
- [ ] Aucun impact sur `/api/auth/guest` ni `/api/auth/check-pseudo` (profils de rate limit indépendants).

---

## Ticket 2 — Corriger la logique de binding de `/api/auth/device-init`

**Sévérité :** 🟡 Moyenne · **Effort :** 2-3h (impacte le mécanisme anti-usurpation tout juste déployé)

### Problème
Le correctif "anti-usurpation device_id" (cookie `HttpOnly` signé HMAC) repose sur `POST /api/auth/device-init`. Cette route **signe et lie n'importe quel `device_id` au format UUID v4 valide**, sans jamais vérifier que l'appelant en est le propriétaire légitime :

```typescript
// apps/web/app/api/auth/device-init/route.ts — état actuel
const existing = req.cookies.get(COOKIE_NAME)?.value;
if (existing) return NextResponse.json({ ok: true, reused: true });
//   ^ vérifie seulement si CE NAVIGATEUR a déjà un cookie —
//     pas si CE device_id est déjà lié à quelqu'un d'autre !

const signature = await signDeviceId(deviceId);  // signe n'importe quel UUID fourni
res.cookies.set(COOKIE_NAME, signature, { httpOnly: true, … });
```

**Scénario d'attaque :**
1. Un attaquant observe une seule fois le `device_id` d'une victime (capture d'écran de support, logs, outil d'analytics, onglet réseau partagé par erreur, etc. — pas besoin de le deviner, 122 bits d'entropie rendent le brute-force infaisable).
2. Depuis un navigateur "vierge" (pas de cookie `kickstock_device_sig`, ex. navigation privée), il envoie ce `device_id` à `/api/auth/device-init`.
3. Le serveur lui délivre **un cookie HttpOnly signé valide pour ce `device_id`** — sans avoir vérifié qu'il appartient à l'attaquant.
4. L'attaquant envoie ensuite `X-Device-ID: <device_id_de_la_victime>` + son cookie sur `/api/trade`, `/api/game/state`, `/api/game/advance`, `/api/game/reset` → `verifyDevice()` valide la requête (la signature est authentique, le serveur lui-même l'a émise).

➡️ Le correctif transforme "deviner un UUID v4 (infaisable)" en "observer une fois la valeur (bien plus large surface : logs, support, captures d'écran…)" — **ce qui défait l'objectif initial du correctif**.

### Fichiers concernés
- `apps/web/app/api/auth/device-init/route.ts`
- `apps/web/lib/deviceSigning.ts`
- `apps/web/lib/verifyDevice.ts`
- `apps/web/lib/device.ts` (génération côté client)

### Deux options de correctif

**Option A — recommandée : générer le `device_id` côté serveur**
Le client ne génère plus l'UUID lui-même ; il appelle `/api/auth/device-init` (sans body, ou avec un flag "premier lancement"), le serveur génère l'UUID, le signe, pose le cookie **et** renvoie l'UUID au client pour qu'il le stocke en `localStorage`. Plus aucune confiance dans un identifiant fourni par le client → plus de "réclamation" possible.

```typescript
// apps/web/app/api/auth/device-init/route.ts — esquisse Option A
export async function POST(req: NextRequest) {
  const existingSig = req.cookies.get(COOKIE_NAME)?.value;
  const existingId  = req.cookies.get('kickstock_device_id')?.value; // nouveau cookie non-HttpOnly, lisible côté client si besoin, ou via réponse JSON

  if (existingSig && existingId) {
    return NextResponse.json({ ok: true, deviceId: existingId, reused: true });
  }

  const deviceId  = crypto.randomUUID();          // ← généré serveur, jamais fourni par le client
  const signature = await signDeviceId(deviceId);

  const res = NextResponse.json({ ok: true, deviceId });
  res.cookies.set(COOKIE_NAME, signature, { httpOnly: true, secure: …, sameSite: 'strict', path: '/', maxAge: ONE_YEAR });
  return res;
}
```
Le client (`lib/device.ts`) doit alors être adapté pour récupérer le `deviceId` depuis la réponse de `/api/auth/device-init` (au lieu de `crypto.randomUUID()` local) avant de le stocker en `localStorage` et de l'envoyer en `X-Device-ID`.

⚠️ **Attention migration** : les utilisateurs existants ont déjà un `device_id` généré côté client et un portfolio associé en base. Il faudra soit (a) accepter leur ID existant **une seule fois** lors de la bascule (avec garde anti-réclamation, voir Option B, ci-dessous, comme filet de sécurité transitoire), soit (b) prévoir une migration de portfolio vers le nouvel ID serveur.

**Option B — moins invasive : verrouiller le binding en base**
Garder la génération côté client, mais stocker en base (table dédiée ou colonne sur `portfolios`) le **premier horodatage de signature** par `device_id`, et refuser toute resignature pour un `device_id` déjà signé avec une empreinte différente (ex. IP/UA radicalement différents dans un délai court — heuristique anti-vol) :

```typescript
// Pseudo-code — avant de signer un deviceId "neuf" pour ce navigateur :
const { data: existingBinding } = await admin
  .from('device_bindings')
  .select('first_seen_at, first_ip_hash')
  .eq('device_id', deviceId)
  .maybeSingle();

if (existingBinding) {
  // Ce device_id a déjà été lié ailleurs — refuser une nouvelle signature
  // (le vrai propriétaire a déjà son cookie ; ne pas en émettre un second)
  return NextResponse.json({ error: 'device_already_bound' }, { status: 409 });
}

await admin.from('device_bindings').insert({
  device_id: deviceId,
  first_seen_at: new Date().toISOString(),
  first_ip_hash: hashIp(ip), // ne jamais stocker l'IP en clair
});
// … puis signer et poser le cookie comme avant
```
Plus simple à déployer (pas de migration de portfolios), mais repose sur l'hypothèse que **le premier à se présenter est le propriétaire légitime** — ce qui reste vrai dans l'immense majorité des cas (un attaquant doit observer le `device_id` *avant* la première initialisation de la victime pour gagner la course).

### Recommandation de l'équipe sécurité
Démarrer par l'**Option B** (rapide, pas de migration, ferme la fenêtre de tir pour 95%+ des cas) puis planifier l'**Option A** comme refonte de fond à moyen terme (élimine le problème structurellement).

### Test de non-régression
- [ ] Nouveau joueur (pas de cookie, pas de portfolio) → binding créé normalement, jeu fonctionnel online (desktop + mobile Safari/Chrome).
- [ ] Joueur existant (cookie déjà présent) → `reused: true`, aucun changement de comportement.
- [ ] **Scénario d'attaque rejoué** : depuis un navigateur vierge, tenter de signer un `device_id` déjà lié ailleurs → doit être rejeté (`409` en Option B, ou simplement impossible en Option A puisque le client ne peut plus fournir d'ID).
- [ ] Mode offline : aucun impact (n'utilise pas ces endpoints).

---

## Ticket 3 — Ajouter les headers de sécurité HTTP manquants

**Sévérité :** 🟡 Moyenne · **Effort :** 30-45 min (+ calibrage CSP)

### Problème
Confirmé en direct sur la prod — les réponses ne contiennent **aucun** header de sécurité applicatif (seul `strict-transport-security` est présent, posé par Vercel) :

```
$ curl -sD - -o /dev/null https://kick-stock-web.vercel.app/login
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-powered-by: Next.js
# … pas de CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy, Referrer-Policy
```

Conséquences concrètes :
- **Clickjacking** : la page peut être chargée dans une `<iframe>` sur un site tiers → un attaquant peut superposer une UI invisible par-dessus les boutons "Acheter / Vendre / Réinitialiser le portfolio / Se connecter" et piéger des clics.
- Pas de filet de sécurité (CSP) en cas de XSS futur, même mineure.
- `x-powered-by: Next.js` facilite le fingerprinting de la stack (gratuit à supprimer).

### Fichier à modifier
`apps/web/next.config.js`

### Correctif

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // … config existante …
  poweredByHeader: false,   // supprime x-powered-by

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',         value: 'DENY' },
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://*.sentry.io",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "connect-src 'self' https://*.supabase.co https://*.sentry.io https://challenges.cloudflare.com",
              "frame-src https://challenges.cloudflare.com https://accounts.google.com",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};
```

⚠️ **La CSP ci-dessus est un point de départ, pas une valeur finale.** Elle doit être calibrée en observant la console du navigateur en mode `Content-Security-Policy-Report-Only` d'abord (pour lister tout ce qui est bloqué sans casser la prod), en tenant compte de :
- Sentry (replay, ingestion)
- Supabase (auth, RPC, realtime si utilisé)
- Cloudflare Turnstile (captcha)
- Google OAuth (login)
- Polices/styles éventuellement chargés depuis un CDN

**Approche recommandée :**
1. Déployer d'abord en `Content-Security-Policy-Report-Only` (même valeur, mais avec `-Report-Only` dans le nom du header) pendant quelques jours en staging puis prod, observer les violations dans la console / un endpoint `report-uri` si configuré.
2. Ajuster la liste blanche, puis basculer en `Content-Security-Policy` (bloquant) une fois stabilisée.
3. Si le calibrage de la CSP prend du temps, **déployer `X-Frame-Options: DENY` (et/ou `frame-ancestors 'none'` seul) immédiatement** — c'est la protection la plus simple et la plus impactante contre le clickjacking, et elle ne casse jamais rien.

### Test de non-régression
- [ ] Login (email/password, Google OAuth, guest) fonctionne toujours.
- [ ] Sentry capture toujours les erreurs et les replays (vérifier dans le dashboard Sentry après déploiement).
- [ ] Cloudflare Turnstile s'affiche et valide toujours sur `/api/auth/guest`.
- [ ] Aucune erreur "Refused to … because it violates CSP" dans la console sur les parcours principaux (online + offline + admin, desktop + mobile).
- [ ] `curl -sI` confirme la présence de `x-frame-options: DENY` et l'absence de `x-powered-by`.

---

## Ordre d'exécution suggéré

| Priorité | Ticket | Pourquoi en premier |
|---|---|---|
| 1 | Ticket 1 (rate limit check-email) | Le plus rapide (~15 min), aucun risque de régression, ferme une fuite active dès maintenant |
| 2 | Ticket 3 — au moins `X-Frame-Options: DENY` | Quasi nul risque de régression, protège immédiatement contre le clickjacking ; la CSP complète peut suivre en seconde passe |
| 3 | Ticket 2 (binding device-init) | Le plus complexe — touche au mécanisme anti-usurpation tout juste livré ; prévoir un passage en staging + tests croisés desktop/mobile/online/offline avant merge |

---
*Document de travail pour la team dev — dérivé de `AUDIT_SECURITE_INDEPENDANT_2026-06-07.md`, points 1 à 3.*
