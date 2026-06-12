# Audit de sécurité — KickStock (passe « hacker éthique »)
**Cible :** https://kick-stock-web.vercel.app/
**Date :** 2026-06-07
**Commit de référence :** `9a4e7c3` (V22.5)
**Méthode :** revue de code (repo local, branche `main`) + tests actifs **non destructifs** en direct sur la prod (énumération de routes, fuzzing léger des entrées, sondes de rate-limiting, vérifications d'en-têtes HTTP, tentatives de contournement d'auth/middleware).

> ℹ️ Ce document part des audits déjà existants dans le dépôt (`AUDIT_SECURITE_INDEPENDANT_2026-06-07.md`, `VALIDATION_CORRECTIFS_2026-06-07.md`, `SECURITY_AUDIT_REPORT_FOR_ERIC.md`) et **ne répète pas** ce qui y est déjà documenté et corrigé (énumération d'emails, binding `device_id`, headers de sécurité). Il confirme l'état actuel de ces points et ajoute des constats **nouveaux ou non encore corrigés**.

---

## Résumé exécutif

| # | Constat | Sévérité | Statut |
|---|---|---|---|
| 1 | `/api/auth/check-pseudo` — énumération de pseudos sans rate limiting (jumeau non corrigé de `check-email`) | 🟠 Moyenne | **Nouveau — Ouvert** |
| 2 | `/api/auth/device-init` — toujours aucun rate limiting (point résiduel déjà signalé dans `VALIDATION_CORRECTIFS`, confirmé encore actif en prod) | 🟡 Moyenne | Confirmé — Ouvert |
| 3 | Comparaison non constante-temps du secret cron/admin (`Authorization === Bearer …`) sur 6 routes | 🟢 Faible | Confirmé — Ouvert |
| 4 | Next.js `14.2.3` — version obsolète, plusieurs CVE corrigées dans des versions ultérieures (dont CVE-2025-29927, bypass d'autorisation via middleware) | 🟡 Moyenne | **Nouveau — À mettre à jour** |

**Bonne nouvelle :** tous les points testés en direct qui avaient été corrigés lors des passes précédentes (headers de sécurité, rate limit `check-email`, verrou anti-usurpation `device-init`) restent **bien en place et fonctionnels**. Aucune injection SQL, aucun secret exposé, aucun fichier sensible accessible, CORS correctement fermé, routes admin/cron correctement protégées (401 systématique sans le bon secret/rôle), et le contournement de middleware CVE-2025-29927 a été testé en direct sans succès.

---

## Détail des constats

### 1. 🟠 Énumération de pseudos via `GET /api/auth/check-pseudo` — sans rate limiting

**Fichier :** [apps/web/app/api/auth/check-pseudo/route.ts](apps/web/app/api/auth/check-pseudo/route.ts)

**Constat :** Cette route est l'exact pendant de `check-email` (même schéma : recherche `ilike` sur `portfolios.guest_username` ET `profiles.username`, réponse publique immédiate), mais **n'a reçu aucun correctif de rate limiting** lors du ticket 1 (qui n'a couvert que `check-email`). Test en direct :

```
$ for i in 1..15: curl .../api/auth/check-pseudo?q=testuser$i
200 200 200 200 200 200 200 200 200 200 200 200 200 200 200   ← 15/15, aucune limite
```

**Impact :**
- Permet de scripter une énumération massive de pseudos pris/disponibles, sans aucun frein (contrairement à `check-email` qui se déclenche désormais dès la 11ᵉ requête).
- Chaque appel déclenche **2 requêtes Supabase** (`portfolios` + `profiles`, recherche `ilike` non indexée par défaut sur ce pattern) — coût d'infrastructure non négligeable en cas de spam, et surface de déni de service à coût quasi nul pour l'attaquant (le même profil de risque que celui documenté pour `device-init`, voir point 2).
- Risque produit secondaire : un script peut « réserver » mentalement/à la volée la liste des pseudos disponibles avant un lancement (squat de pseudos populaires dès l'ouverture des inscriptions).

**Recommandation (~10 min, copier-coller du correctif déjà fait sur `check-email`) :**
```typescript
import { checkRateLimit } from '@/lib/rateLimitRedis';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = await checkRateLimit('checkEmail', ip); // ou un profil dédié `checkPseudo`
  if (rl.limited) {
    return NextResponse.json({ available: false, error: 'too_many_requests' }, { status: 429 });
  }
  // … reste inchangé
}
```

---

### 2. 🟡 `/api/auth/device-init` — toujours sans rate limiting (confirmé en prod)

**Fichier :** [apps/web/app/api/auth/device-init/route.ts](apps/web/app/api/auth/device-init/route.ts)

**Constat :** `VALIDATION_CORRECTIFS_2026-06-07.md` avait déjà signalé ce point résiduel après la correction du ticket 2 (verrou anti-usurpation). Je confirme qu'il est **toujours actif en prod** :

```
$ for i in 1..8: curl -X POST .../api/auth/device-init -d '{"deviceId":"<uuid frais aléatoire>"}'
200 200 200 200 200 200 200 200   ← 8/8, aucune limite, 8 nouvelles lignes device_bindings créées
```

**Impact (rappel, inchangé depuis la première analyse) :** un attaquant peut spammer cette route avec des UUID v4 générés à la volée — chaque appel coûte 1 lecture + 1 écriture Supabase + 2 hachages SHA-256 côté serveur, **gratuitement côté attaquant**. Conséquences : gonflement de la table `device_bindings`, facture Supabase à la hausse, DoS à coût quasi nul. Ce n'est pas une régression du correctif anti-usurpation (qui, lui, fonctionne très bien — testé en direct, voir ci-dessous), mais une lacune de hardening sur la nouvelle surface introduite par cette table.

**Validation croisée du verrou anti-usurpation (ticket 2) :** toujours opérationnel — j'ai rejoué le test avec un nouvel UUID : 1ʳᵉ requête → `200 {"ok":true}`, requêtes suivantes pour le même `device_id` sans cookie → `409 device_already_bound`. ✅ Bon travail, rien à signaler de ce côté.

**Recommandation (15 min, déjà documentée dans `VALIDATION_CORRECTIFS`) :** ajouter `checkRateLimit('deviceInit', ip)` en tête de la route — un utilisateur légitime n'appelle cette route qu'une fois par appareil ; 10-20 req/10 min/IP est largement suffisant et sans impact UX.

---

### 3. 🟢 Comparaison non constante-temps du secret cron/admin

**Fichiers concernés (6 occurrences identiques) :**
- [apps/web/app/api/admin/simulate-day/route.ts:38](apps/web/app/api/admin/simulate-day/route.ts:38)
- [apps/web/app/api/cron/sync-squads/route.ts:29](apps/web/app/api/cron/sync-squads/route.ts:29)
- [apps/web/app/api/cron/sync-fixtures/route.ts:37](apps/web/app/api/cron/sync-fixtures/route.ts:37)
- [apps/web/app/api/cron/sync-results/route.ts:34](apps/web/app/api/cron/sync-results/route.ts:34)
- [apps/web/app/api/cron/sync-schedule/route.ts:71](apps/web/app/api/cron/sync-schedule/route.ts:71)
- [apps/web/app/api/admin/competitions/[id]/sync/route.ts](apps/web/app/api/admin/competitions/%5Bid%5D/sync/route.ts) (vérification indirecte du même secret)

**Constat :** toutes ces routes comparent le header `Authorization` au secret attendu via l'opérateur `===` JS standard :
```typescript
if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) { … }
```
Cette comparaison s'arrête au premier octet différent — en théorie, elle fuit une information de timing proportionnelle au nombre de caractères corrects en préfixe (« attaque par canal auxiliaire temporel »).

**Pourquoi c'est classé en sévérité faible et non critique :**
- Le secret est un token serveur à haute entropie (jamais exposé côté client depuis le correctif G9 documenté dans `sync/route.ts`), pas un mot de passe devinable.
- Sur une infrastructure HTTPS/Vercel (latence réseau variable de plusieurs ms à dizaines de ms, edge functions, multiplexage), le bruit de mesure rend une attaque par timing à distance **extrêmement difficile, voire impraticable**, surtout sur un secret de 32+ caractères.
- Aucune preuve que cela soit exploitable en pratique ici — c'est une recommandation de **défense en profondeur**, pas un constat de vulnérabilité active.

**Recommandation (correctif trivial, mutualisable) :** créer un petit utilitaire partagé basé sur `crypto.timingSafeEqual` (Node) :
```typescript
import { timingSafeEqual } from 'crypto';

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false; // la longueur reste publique, c'est acceptable pour un secret fixe
  return timingSafeEqual(bufA, bufB);
}
```
puis remplacer les 6 comparaisons par `safeCompare(authHeader ?? '', \`Bearer ${process.env.CRON_SECRET}\`)`.

---

### 4. 🟡 Next.js `14.2.3` — version obsolète avec CVE corrigées en aval

**Constat :** [apps/web/package.json](apps/web/package.json) épingle `"next": "14.2.3"`, sortie en mai 2024. Plusieurs failles ont été corrigées dans des versions ultérieures de la branche 14.2.x, notamment :

- **CVE-2025-29927** (mars 2025, score CVSS ~9.1) — un attaquant pouvait faire passer un header `x-middleware-subrequest` forgé pour **faire sauter intégralement l'exécution du middleware**, contournant ainsi toute logique d'autorisation qui y est implémentée. C'est *exactement* le mécanisme utilisé ici dans [middleware.ts](apps/web/middleware.ts) pour protéger `/admin` (vérification `role === 'admin'`). Corrigé en `14.2.25` / `15.2.3`.
- D'autres correctifs de sécurité (cache poisoning, SSRF via Server Actions, DoS sur l'optimiseur d'images…) sont également intervenus entre `14.2.3` et les dernières versions `14.2.x`.

**Test en direct du scénario CVE-2025-29927 (non destructif) :**
```
$ curl https://kick-stock-web.vercel.app/admin -H "x-middleware-subrequest: src/middleware:middleware:middleware:middleware:middleware"
→ 307 redirect vers /login   (comportement normal — PAS de bypass observé)
```
➡️ **Le contournement ne fonctionne pas en l'état** — très probablement parce que la plateforme Vercel **filtre/normalise ce header au niveau de son edge runtime** avant qu'il n'atteigne le code applicatif (Vercel a publiquement communiqué avoir déployé une mitigation côté plateforme dès la divulgation de la CVE, indépendamment de la version de Next.js déployée par ses clients).

**Pourquoi je le signale quand même :**
- La mitigation observée dépend de la **plateforme d'hébergement** (Vercel), pas du code de l'application. Si KickStock devait un jour migrer vers un hébergement self-hosted, un conteneur Docker, ou même une autre offre serverless, cette protection de plateforme disparaîtrait et la version actuelle de Next.js redeviendrait directement exploitable.
- D'autres correctifs de sécurité (hors CVE-2025-29927) de la branche `14.2.x` ne bénéficient pas forcément de mitigation au niveau plateforme.
- La mise à jour vers `14.2.25`+ (ou la dernière `14.2.x` stable) est un changement à faible risque de régression (pas de saut de version majeure) et ferme la porte définitivement, indépendamment de l'hébergeur.

**Recommandation :** planifier une mise à jour de `next` vers `^14.2.25` minimum (idéalement la dernière version stable de la branche 14, ou évaluer un passage à 15.x à plus long terme), suivi des tests de non-régression habituels (`pnpm build`, `pnpm test`, smoke test sur `/admin`, `/login`, flux de jeu).

---

## Points vérifiés et confirmés sains (pas d'action requise)

Pour mémoire, voici ce que j'ai testé en direct et qui s'est avéré robuste :

- **En-têtes de sécurité HTTP** : CSP calibrée, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS avec `preload` — tous présents et corrects sur `/`, `/login`, `/api/*`. `x-powered-by` bien supprimé (`poweredByHeader: false`).
- **Rate limiting `check-email`** : se déclenche bien (`429`) après le quota — confirmé en conditions réelles (et même déjà actif au moment de mes tests, suite aux essais de l'audit précédent — preuve que le compteur Redis persiste correctement entre sessions).
- **Verrou anti-usurpation `device-init` (ticket 2)** : toujours opérationnel, `409 device_already_bound` systématique pour toute resignature sans cookie valide.
- **Routes admin/cron** : toutes renvoient `401 Unauthorized` sans le bon secret (`CRON_SECRET`) ou rôle admin — aucune fuite d'information dans les réponses d'erreur (`{"error":"Unauthorized"}` générique).
- **Validation des entrées** : `competitionId` (regex `^\d+$`), `device_id` (regex UUID v4 stricte), `quantity` (entier positif), `mode` (enum `buy|sell`) — tentatives d'injection (quotes SQL, valeurs négatives, JSON malformé) toutes rejetées proprement avec des codes `4xx` et messages génériques (pas de stack trace ni de détail de requête SQL exposé).
- **CORS** : aucun en-tête `Access-Control-Allow-*` renvoyé pour une origine tierce sur `/api/trade` — pas de API ouverte aux requêtes cross-origin.
- **Cookies** : cookie de signature `device_id` en `HttpOnly; Secure; SameSite=Strict`, cookies de session/locale en `SameSite=Lax` — combinaison standard qui protège contre le CSRF sur les routes sensibles (`/api/trade`, `/api/game/*`, `/api/auth/set-username`) sans gêner la navigation normale.
- **Pas de fuite de fichiers/secrets** : `/.env`, `/.env.local`, `/.git/config`, chemins de chunks `_next` arbitraires, `robots.txt`, `sitemap.xml` → tous `404`. Aucun secret commité dans le dépôt (`.env.local` ignoré par git).
- **Méthodes HTTP** : `TRACE`/`PUT` sur `/api/trade` → `405 Method Not Allowed` (pas de surface XST).
- **CVE-2025-29927 (bypass middleware Next.js)** : testé en direct sur `/admin` et sur une route API protégée — **pas de contournement possible** (mitigation côté plateforme Vercel observée).

---

## Synthèse et priorisation suggérée

| Priorité | Action | Effort estimé |
|---|---|---|
| 1 | Ajouter `checkRateLimit` sur `check-pseudo` (copier le correctif de `check-email`) | ~10 min |
| 2 | Ajouter `checkRateLimit` sur `device-init` (déjà documenté dans `VALIDATION_CORRECTIFS`, toujours pas fait) | ~15 min |
| 3 | Mettre à jour `next` vers `^14.2.25`+ et lancer la suite de tests/non-régression | ~1-2 h (tests inclus) |
| 4 | Remplacer les 6 comparaisons `===` du secret cron par une comparaison à temps constant (`crypto.timingSafeEqual`) | ~20 min |

Aucun de ces points n'est critique ou activement exploité — l'application est dans un état de sécurité globalement **solide** (l'historique des audits/corrections en témoigne). Les points 1 et 2 sont les plus rentables (10-15 min chacun, ferment des trous d'énumération/abus déjà connus côté `device-init` et symétriques sur `check-pseudo`) ; le point 3 est plus une hygiène de maintenance à long terme qu'une urgence vu l'absence d'exploitation observée.
