# Audit de sécurité indépendant — KickStock
**Cible :** https://kick-stock-web.vercel.app/
**Date :** 2026-06-07
**Méthode :** revue de code (repo local, branche `main`, commit `45296dc` / V22.3) + tests passifs/actifs non destructifs sur la prod

> Contexte : un audit interne précédent (`SECURITY_AUDIT_REPORT_FOR_ERIC.md`) couvrait déjà 10 points et notait une lacune sur `/api/game/reset`. **Cette lacune est désormais corrigée** dans le code actuel (le `verifyDevice()` + `checkRateLimit('reset', …)` sont bien présents, voir `apps/web/app/api/game/reset/route.ts:29-49`). Ce document se concentre sur des points **non couverts** par cet audit, trouvés en repartant de zéro.

---

## Résumé exécutif

| # | Constat | Sévérité | Statut |
|---|---|---|---|
| 1 | Énumération d'emails via `/api/auth/check-email` (pas de rate limiting, confirmé en live) | 🟠 **Moyenne-Haute** | Ouvert |
| 2 | `/api/auth/device-init` signe n'importe quel `device_id` au format valide — la liaison "anti-usurpation" peut être détournée | 🟡 Moyenne | Ouvert |
| 3 | Headers de sécurité HTTP absents (CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy) | 🟡 Moyenne | Ouvert |
| 4 | Comparaison non constante-temps du secret cron/admin (`Authorization === Bearer ...`) | 🟢 Faible | Ouvert |
| 5 | Logs serveur (`console.error`) incluant potentiellement des objets d'erreur RPC riches | 🟢 Faible | Ouvert |

Aucune injection SQL, aucune faille XSS exploitable (`dangerouslySetInnerHTML` absent du code applicatif), aucun secret commité dans le dépôt (`.env.local` correctement ignoré par git), et l'authentification admin est solide (vérifiée à plusieurs niveaux : middleware + chaque route API). Ces points avaient déjà été validés par l'audit interne et la nouvelle relecture les confirme.

---

## Détail des constats

### 1. 🟠 Énumération d'emails via `GET /api/auth/check-email`

**Fichier :** `apps/web/app/api/auth/check-email/route.ts`

**Constat :** L'endpoint est public, ne nécessite aucune authentification, **n'a aucun rate limiting** (contrairement à `/api/auth/guest` qui en a un), et répond en clair si un email existe et s'il est confirmé :

```bash
$ curl -s "https://kick-stock-web.vercel.app/api/auth/check-email?q=test@test.com"
{"exists":false,"confirmed":false}
```
*(Testé en direct sur la prod le 2026-06-07 — réponse HTTP 200, aucune limite déclenchée après plusieurs requêtes successives.)*

**Impact :**
- Un attaquant peut vérifier en masse si une liste d'adresses email est inscrite sur KickStock (script trivial : une requête GET par email, aucune limite de débit).
- L'info `confirmed` indique en plus si le compte a terminé son onboarding — utile pour cibler des comptes "orphelins" (re-création, prise de contrôle par re-inscription, etc.).
- Couplé à des fuites de données tierces (combolists), cela permet de confirmer la présence d'un individu sur la plateforme — risque de vie privée et vecteur de phishing ciblé ("on sait que tu joues à KickStock avec cette adresse…").

**Recommandation :**
- Appliquer le même `checkRateLimit` que sur `/api/auth/guest` (par IP, ex. 10 req / 10 min).
- Envisager de réponse uniforme (`{ exists: true }` toujours, ou délai artificiel) si le produit n'a pas réellement besoin de distinguer "n'existe pas" de "existe mais email non confirmé" côté client avant la création de compte.
- Ajouter un Turnstile/captcha si l'endpoint est appelé fréquemment côté UX (comme déjà fait pour `/api/auth/guest`).

---

### 2. 🟡 `/api/auth/device-init` peut lier n'importe quel `device_id` à un attaquant

**Fichiers :** `apps/web/app/api/auth/device-init/route.ts`, `apps/web/lib/verifyDevice.ts`, `apps/web/lib/deviceSigning.ts`

**Contexte :** Le correctif "anti-usurpation device_id" (point 1 de l'audit interne) repose sur un cookie `HttpOnly`/`Secure`/`SameSite=Strict` signé en HMAC, posé par `POST /api/auth/device-init` lors du premier appel client.

**Constat — la route ne vérifie PAS que l'appelant est le générateur légitime du `device_id` :**

```typescript
export async function POST(req: NextRequest) {
  const { deviceId } = await req.json();
  if (!deviceId || !UUID_V4.test(deviceId)) { … }

  // Si un cookie existe déjà POUR CE NAVIGATEUR (pas pour ce device_id !),
  // ne pas le réinitialiser.
  const existing = req.cookies.get(COOKIE_NAME)?.value;
  if (existing) return NextResponse.json({ ok: true, reused: true });

  const signature = await signDeviceId(deviceId);     // ← signe n'importe quel UUID v4 fourni
  // … pose le cookie signé pour CE deviceId
}
```

La seule garde est « est-ce que **mon propre navigateur** a déjà un cookie `kickstock_device_sig` ? » — pas « est-ce que **ce `device_id`** est déjà lié à quelqu'un d'autre ? ». Concrètement :

1. Un attaquant qui **connaît ou observe** le `device_id` (UUID v4) d'une victime — par exemple via une capture d'écran de support, un outil d'analytics tiers, l'onglet réseau du navigateur de la victime elle-même partagé par erreur, un ancien event Sentry non filtré (avant le correctif du point 7), un cache CDN, etc. — peut, depuis un navigateur "vierge" (sans cookie `kickstock_device_sig`, ex. navigation privée), envoyer ce `device_id` à `/api/auth/device-init`.
2. Le serveur lui délivre **un cookie HttpOnly signé valide pour ce `device_id`**, sans jamais avoir vérifié que l'attaquant en est le propriétaire légitime.
3. L'attaquant peut alors envoyer `X-Device-ID: <device_id_de_la_victime>` + son cookie fraîchement signé sur `/api/trade`, `/api/game/state`, `/api/game/advance`, `/api/game/reset` — et `verifyDevice()` validera la requête sans broncher (la signature correspond bien, puisque le serveur lui-même l'a émise).

Autrement dit, le mécanisme transforme le problème "deviner un UUID v4 (122 bits d'entropie, infaisable par force brute)" en "observer une seule fois la valeur du `device_id`, n'importe où, n'importe quand" — ce qui est un **bien plus large** vecteur (logs, support, captures d'écran, extensions de navigateur, proxys d'entreprise, etc.).

**Recommandation :**
- Avant de signer un `device_id` "neuf" (sans cookie existant côté serveur pour cet ID précis), vérifier en base qu'aucun portfolio/empreinte n'est déjà associé à ce `device_id` avec un cookie déjà émis — ou, plus simple et robuste : générer le `device_id` **côté serveur** lors du premier appel et le renvoyer au client (au lieu de faire confiance à un identifiant généré côté client et "réclamé" après coup).
- Alternative pragmatique : stocker en base, à la première signature, une empreinte (hash de `device_id` + horodatage) et refuser toute nouvelle signature pour un `device_id` déjà signé ailleurs (= 1 seul binding possible par device_id, immuable).

---

### 3. 🟡 Headers de sécurité HTTP absents

**Constat :** Aucune configuration `headers()` dans `next.config.js`, aucun header de sécurité applicatif dans le `middleware.ts`, et confirmation en direct sur la prod — les réponses ne contiennent que :

```
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-powered-by: Next.js
```

Sont **absents** :
- `Content-Security-Policy` — aucune politique limitant les sources de scripts/styles/connexions ; en cas de XSS futur (même mineure), l'attaquant a les mains libres.
- `X-Frame-Options` / `frame-ancestors` — la page peut être chargée dans une `<iframe>` sur un site tiers → **clickjacking** possible sur les actions sensibles (achat/vente, reset de portfolio, connexion).
- `X-Content-Type-Options: nosniff` — pas de protection contre le MIME-sniffing.
- `Referrer-Policy` / `Permissions-Policy` — aucune restriction.

`x-powered-by: Next.js` est également laissé par défaut, ce qui facilite le fingerprinting de la stack pour un attaquant (information mineure mais gratuite à supprimer).

**Recommandation :** ajouter un bloc `headers()` dans `next.config.js` (ou les injecter dans `middleware.ts`, qui s'exécute déjà sur toutes les routes) :

```js
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; default-src 'self'; …" },
    ],
  }];
},
poweredByHeader: false,
```
La CSP demandera un peu de calibrage (Sentry, Supabase, Turnstile, Google OAuth, polices, etc. doivent être whitelistés) mais même une politique partielle (`frame-ancestors 'none'` seul, via header dédié) couvre déjà le clickjacking.

---

### 4. 🟢 Comparaison de secret non constante-temps (cron / admin)

**Fichiers :** `apps/web/app/api/cron/sync-fixtures/route.ts:38`, `apps/web/app/api/admin/simulate-day/route.ts:39`, et probablement les autres routes cron

```typescript
const auth = req.headers.get('Authorization');
if (auth !== `Bearer ${process.env.CRON_SECRET}`) { … }
```

Une comparaison `!==` sur une chaîne secrète est théoriquement sujette à une attaque par mesure de timing (le moteur JS s'arrête à la première différence de caractère). En pratique, le bruit réseau sur une cible Vercel/Edge rend cette attaque extrêmement difficile à exploiter à distance, mais c'est un écart par rapport aux bonnes pratiques — d'autant que `lib/deviceSigning.ts` utilise déjà, lui, une comparaison en temps constant pour un cas similaire.

**Recommandation :** factoriser une fonction `timingSafeEqual` (ex. `crypto.timingSafeEqual` côté Node, ou la même boucle XOR déjà écrite dans `verifyDeviceSignature`) et l'utiliser pour toutes les comparaisons de secrets/bearer tokens (`CRON_SECRET`, etc.).

---

### 5. 🟢 Logs serveur potentiellement verbeux

**Fichiers :** `apps/web/app/api/trade/route.ts:81`, `apps/web/app/api/game/advance/route.ts:405`, etc.

```typescript
console.error('[POST /api/trade] RPC error:', error);
```

Ces lignes journalisent l'objet d'erreur brut renvoyé par Supabase, qui peut inclure les paramètres de la requête RPC ayant échoué (`p_device_id`, `p_team_id`, montants, etc.). Cela part dans les logs Vercel — accessibles seulement à l'équipe, donc le risque est interne/faible — mais ça contraste avec l'effort déjà fait pour filtrer ces mêmes données avant envoi à Sentry (`captureApiException` / `lib/sentryCapture.ts`). Autant garder la cohérence : passer ces objets dans le même filtre `scrub()` avant `console.error`, ou les omettre du log.

---

## Points vérifiés et jugés solides (pas d'action requise)

- **Injection SQL** : tous les appels RPC Supabase passent par des paramètres nommés (requêtes préparées) ; aucune concaténation de chaînes SQL trouvée dans le code applicatif (confirmé indépendamment du point 6 de l'audit interne).
- **XSS** : aucun usage de `dangerouslySetInnerHTML` dans `app/` ou `components/`.
- **Secrets dans le dépôt** : `.env.local` est correctement listé dans `.gitignore` et n'a jamais été committé (`git ls-files` ne le retourne pas).
- **Auth admin** : vérification du rôle `app_metadata.role === 'admin'` présente à la fois dans `middleware.ts` (protection de `/admin/*`) **et** individuellement dans chaque route `app/api/admin/**` — défense en profondeur correcte, pas de simple confiance dans le middleware.
- **`/api/trade`, `/api/game/advance`, `/api/game/state`, `/api/game/reset`** : vérification de signature `device_id` + rate limiting Redis bien présents et actifs (confirmé en lisant le code de chaque route — la lacune notée par l'audit interne sur `reset` a depuis été comblée, commit `45296dc`).
- **Endpoints admin testés en live** : `/api/admin/simulate-day` répond `401 Unauthorized` sans jeton — pas de bypass trouvé.
- **Robots/indexation** : `noindex` posé sur les pages, ce qui limite l'exposition passive du site aux moteurs de recherche.

---

## Synthèse des actions recommandées (par ordre de priorité)

1. **Rate-limiter `/api/auth/check-email`** (et envisager une réponse moins bavarde) — quelques lignes, même mécanique que `/api/auth/guest`.
2. **Revoir la logique de binding de `/api/auth/device-init`** pour empêcher la "réclamation" d'un `device_id` observé ailleurs — idéalement générer le `device_id` côté serveur.
3. **Ajouter les headers de sécurité HTTP** (`X-Frame-Options`, CSP, `X-Content-Type-Options`, `Referrer-Policy`) via `next.config.js` ou `middleware.ts`.
4. Remplacer les comparaisons `===` de secrets par une comparaison en temps constant (réutiliser le pattern déjà existant dans `lib/deviceSigning.ts`).
5. Passer les objets d'erreur RPC dans `scrub()` avant `console.error`, par cohérence avec le filtrage déjà appliqué à Sentry.

---

*Audit mené par revue de code complète du dépôt + tests passifs et actifs non destructifs contre https://kick-stock-web.vercel.app/ (requêtes GET/POST en lecture, aucune modification de données). Aucune action destructive, aucun compte tiers ciblé.*
