# Validation des correctifs déployés (V22.4) — Tickets 1, 2, 3
**Cible :** https://kick-stock-web.vercel.app/ (prod, post-déploiement)
**Commit vérifié :** `71f099d` (V22.4)
**Date :** 2026-06-07
**Méthode :** revue du diff de code + tests **en direct** sur la prod (requêtes réelles, non destructives)

---

## Résumé

| Ticket | Code (revue) | Comportement en prod (testé en direct) | Verdict |
|---|---|---|---|
| 1 — Rate limit `check-email` | ✅ Conforme aux specs | ✅ `429` déclenché à la 11ᵉ requête, comme prévu | 🟢 **VALIDÉ** |
| 3 — Headers de sécurité HTTP | ✅ Conforme, CSP bien calibrée | ✅ Tous les headers présents et corrects sur `/`, `/login`, `/api/*` | 🟢 **VALIDÉ** |
| 2 — Verrou anti-usurpation `device-init` | ✅ Code et tests unitaires propres | ❌ **Le verrou ne se déclenche JAMAIS en prod — la vulnérabilité d'origine reste pleinement exploitable** | 🔴 **NON VALIDÉ — RÉGRESSION DE SÉCURITÉ EN PROD** |

**⚠️ Point bloquant : le ticket 2 n'est PAS effectif en production.** Le code semble correct sur le papier (et les tests unitaires passent en mock), mais en conditions réelles, l'API `/api/auth/device-init` délivre un cookie signé valide pour **n'importe quel `device_id` réclamé**, peu importe à quel point l'empreinte diffère de la première signature. J'ai reproduit le scénario d'attaque décrit dans l'audit — **avec succès, à 100 % des tentatives**.

---

## Ticket 1 — Rate limit `/api/auth/check-email` ✅ VALIDÉ

**Revue de code :** le diff ajoute exactement ce qui était demandé — `checkRateLimit('checkEmail', ip)` avant tout traitement, profil dédié `checkEmail: { requests: 10, window: '10 m' }` dans `lib/rateLimitRedis.ts`, réponse `429` avec `Retry-After`. Tests unitaires (`route.test.ts`) couvrent le cas nominal, le cas limité et la non-régression de la validation `invalid_email`.

**Test en direct (12 requêtes consécutives, IP identique, emails différents) :**

```
req 1  -> HTTP 200 -> {"exists":false,"confirmed":false}
…
req 10 -> HTTP 200 -> {"exists":false,"confirmed":false}
req 11 -> HTTP 429 -> {"error":"too_many_requests"}
req 12 -> HTTP 429 -> {"error":"too_many_requests"}
```

➡️ Le quota de 10 requêtes / 10 min par IP se déclenche exactement comme prévu, avec le bon code d'erreur. **L'énumération de masse est désormais bloquée.** Rien à redire.

---

## Ticket 3 — Headers de sécurité HTTP ✅ VALIDÉ

**Revue de code :** bloc `headers()` ajouté dans `next.config.js`, `poweredByHeader: false`, CSP calibrée en tenant compte des intégrations réelles (Supabase, Sentry, Turnstile, Google OAuth, Google Fonts, API-Football). C'est du bon travail — la CSP n'est pas un copier-coller générique, elle reflète une vraie connaissance des dépendances du projet (`connect-src` inclut `wss://*.supabase.co` pour le realtime, `frame-src` inclut Google OAuth, etc.).

**Test en direct sur `/`, `/login` et une route API :**

```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'
  https://challenges.cloudflare.com https://*.sentry.io; style-src 'self' 'unsafe-inline'
  https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data:
  https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co
  https://*.sentry.io https://*.ingest.sentry.io https://challenges.cloudflare.com
  https://api-football-v1.p.rapidapi.com; frame-src https://challenges.cloudflare.com
  https://accounts.google.com https://*.supabase.co; frame-ancestors 'none'; base-uri 'self';
  form-action 'self'
permissions-policy: camera=(), microphone=(), geolocation=()
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
```

`x-powered-by: Next.js` a bien disparu de toutes les réponses testées.

➡️ **Clickjacking neutralisé** (double protection `X-Frame-Options: DENY` + `frame-ancestors 'none'`), MIME-sniffing bloqué, fuite de référent limitée, permissions matérielles fermées par défaut, fingerprinting de stack réduit. Tous les headers attendus sont présents et corrects, sur les pages **et** sur les routes API (le `source: '/(.*)'` couvre bien tout).

**Remarque mineure (non bloquante) :** `script-src` inclut `'unsafe-inline' 'unsafe-eval'`, ce qui affaiblit sensiblement la protection XSS qu'une CSP est censée apporter (ces deux directives permettent justement l'exécution du code injecté qu'une CSP stricte vise à empêcher). C'est un compromis pragmatique très courant avec Next.js (qui injecte des scripts inline pour l'hydratation) — la CSP reste néanmoins très utile pour le `frame-ancestors` et le `connect-src`/`img-src` (limite l'exfiltration de données vers des domaines tiers en cas de XSS). À noter pour une itération future : envisager un système de nonces (`script-src 'self' 'nonce-{random}'`) pour se passer de `'unsafe-inline'` sur les scripts — Next.js le supporte nativement via `next.config` + middleware. Pas urgent, mais à garder en tête.

---

## Ticket 2 — Verrou anti-usurpation `device-init` 🔴 NON VALIDÉ

### Ce que dit le code (en apparence correct)

Le diff ajoute une table `device_bindings` (migration `018`), enregistre une empreinte hashée (jamais l'IP en clair — bon réflexe) du réseau et du navigateur au premier `POST /api/auth/device-init`, et rejette toute tentative ultérieure pour le même `device_id` avec une empreinte radicalement différente (`409 device_already_bound`). Les tests unitaires (`route.security.test.ts`) sont propres et couvrent bien les cas attendus — **mais ils tournent sur un client Supabase entièrement mocké**, donc ils valident la logique en isolation, pas son fonctionnement réel contre l'infrastructure de prod.

### Ce qui se passe réellement en prod — reproduction de l'attaque décrite dans l'audit

J'ai rejoué **exactement** le scénario d'attaque documenté dans `AUDIT_SECURITE_INDEPENDANT_2026-06-07.md` (point 2) :

**Test A — scénario victime / attaquant complet :**
```
Étape 1 — "victime" (réseau A, navigateur "Victim-Browser-A", IP 203.0.113.77)
  → POST /api/auth/device-init {deviceId: "6c9add6b-…"}
  → HTTP 200 {"ok":true} + cookie kickstock_device_sig = e57009b4a3db…

Étape 2 — "attaquant" (réseau B, navigateur "Attacker-Browser-B", IP 198.51.100.250
           — réseau ET navigateur RADICALEMENT différents de la victime)
  → POST /api/auth/device-init {deviceId: "6c9add6b-…"}   (même device_id que la victime)
  → HTTP 200 {"ok":true} + cookie kickstock_device_sig = e57009b4a3db…
                                                          ^^^ IDENTIQUE à celui de la victime
```

L'attaquant obtient **le cookie HttpOnly signé valide pour le `device_id` de la victime**, sans jamais avoir possédé ce `device_id` au préalable, et sans déclencher le moindre `409`.

**Test B — 5 tentatives consécutives sur un nouveau `device_id`, empreintes maximalement variées (User-Agent et IP entièrement randomisés à chaque tentative) :**
```
tentative 1 -> {"ok":true} || HTTP_200
tentative 2 -> {"ok":true} || HTTP_200
tentative 3 -> {"ok":true} || HTTP_200
tentative 4 -> {"ok":true} || HTTP_200
tentative 5 -> {"ok":true} || HTTP_200
```

**Aucune des 7 tentatives effectuées (2 + 5) n'a déclenché un `409 device_already_bound`.** Toutes ont reçu un cookie signé valide, à chaque fois — y compris pour des `device_id` déjà "réclamés" juste avant avec une empreinte totalement différente.

### Conclusion : la vulnérabilité d'origine est toujours pleinement exploitable

Le scénario d'attaque exact décrit dans le ticket — *« un attaquant qui observe une fois le `device_id` d'une victime peut obtenir un cookie HttpOnly signé valide pour ce `device_id` depuis un navigateur vierge »* — **fonctionne toujours, à 100 % de réussite, en prod actuellement**. Le correctif n'apporte, en l'état du déploiement, **aucune protection effective**.

### Pistes de diagnostic pour la dev (je n'ai pas accès à Supabase/Sentry pour confirmer lequel)

1. **La migration `018_device_bindings.sql` n'a probablement pas été exécutée sur la base de production.** Le code contient volontairement une dégradation gracieuse :
   ```typescript
   } catch (err) {
     // Ne jamais bloquer la signature pour une erreur d'infrastructure du
     // verrou (table absente en local, panne ponctuelle…)
     captureApiException(err, { route: 'POST /api/auth/device-init', extra: { stage: 'binding-check' } });
   }
   ```
   Si la table `device_bindings` n'existe pas en prod, **chaque appel à `.from('device_bindings').select(...)` lève une exception**, qui est silencieusement absorbée ici — et la route poursuit comme si le verrou n'existait pas. C'est très exactement le même type de panne que celle déjà identifiée par l'audit interne sur `DEVICE_SIGNING_SECRET` (point "Vérification additionnelle recommandée pour la prod") : **un mécanisme de sécurité qui peut se désactiver silencieusement faute de configuration/migration, sans qu'aucune alerte ne remonte de façon visible.**
   → **Action immédiate : vérifier dans le dashboard Supabase prod que la table `device_bindings` existe** (`SELECT * FROM device_bindings LIMIT 1;`), et que la migration 018 a bien été appliquée à l'environnement de prod (pas seulement committée dans `db/migrations/`).

2. **Si la table existe bel et bien**, alors le problème est dans la logique elle-même — par exemple si `req.headers.get('x-forwarded-for')` retourne systématiquement la même valeur réelle (ex. Vercel surcharge le header côté edge avec l'IP de connexion réelle, ignorant la valeur fournie par le client), alors `sameNetwork` serait toujours vrai pour deux requêtes émises depuis la même origine réseau réelle — et la condition de rejet `!sameNetwork && !sameBrowser` ne se déclencherait jamais dans ce cas, peu importe le `User-Agent`. Cela révélerait une **faiblesse structurelle plus profonde** : le verrou OR-logique (il faut que les DEUX axes diffèrent pour bloquer) est intrinsèquement fragile contre :
   - un attaquant **partageant le même réseau** que sa victime (foyer, entreprise, université, CGNAT mobile, VPN/proxy partagé, Wi-Fi public) — cas très répandu ;
   - un attaquant utilisant un **`User-Agent` courant** (les 5-10 chaînes de `User-Agent` les plus fréquentes — Chrome/Windows, Safari/iOS, etc. — couvrent une écrasante majorité du trafic web réel) — cas trivial à reproduire sans rien savoir de la victime.

   → Si ce diagnostic se confirme, il faudra revoir la logique : soit exiger que les **deux** axes correspondent pour accepter (`sameNetwork && sameBrowser`, plus strict — au prix de plus de faux positifs pour les vrais utilisateurs ayant changé de réseau ou de navigateur), soit ajouter un troisième facteur d'authentification plus robuste (ex. confirmation par e-mail/notification pour les comptes liés à un profil, ou repasser sur l'Option A de la recommandation initiale : génération du `device_id` côté serveur, qui élimine structurellement le problème).

3. **Dans tous les cas**, la dégradation "silencieuse" est le vrai problème de fond : une protection de sécurité qui échoue doit **remonter une alerte visible et si possible bloquer par défaut (fail closed)**, pas se désactiver discrètement (fail open). À minima, ajouter un log/alerte Sentry de niveau `error` (pas juste une capture d'exception générique) déclenchant une notification à l'équipe dès que ce chemin de dégradation est emprunté en production — pour détecter ce genre de panne en quelques minutes plutôt que de la découvrir lors d'un audit.

### Recommandation

**Ne pas considérer le ticket 2 comme clos.** Avant de le refermer :
- [ ] Confirmer/infirmer la présence de la table `device_bindings` en prod et l'application de la migration 018.
- [ ] Si la table est présente : instrumenter temporairement la route (log explicite du résultat de chaque vérification — `binding trouvé / sameNetwork / sameBrowser / décision`) et rejouer le test A ci-dessus pour identifier où la logique diverge du comportement attendu.
- [ ] Rejouer ce test de validation (scénario A complet, empreintes radicalement différentes) **après correction**, et confirmer l'obtention d'un `409 device_already_bound`.
- [ ] Ajouter une alerte de monitoring sur le chemin de dégradation gracieuse (`stage: 'binding-check'` dans `captureApiException`) pour ne plus jamais découvrir ce genre de panne a posteriori.

---

*Validation menée par tests réels et non destructifs contre https://kick-stock-web.vercel.app/ (POST sur `/api/auth/device-init` avec des `device_id` UUID v4 générés pour le test, empreintes réseau/navigateur forgées). Aucun compte ni portefeuille de joueur réel n'a été ciblé ou modifié.*
