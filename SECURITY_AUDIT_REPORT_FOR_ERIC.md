# Audit de sécurité — Réponse aux remarques d'Eric
**Date :** 2026-06-07  
**Objet :** Vérification post-correctifs des 10 points soulevés

---

## Résumé exécutif

Eric, suite à tes remarques, j'ai fait corriger les points 1, 2, 3, 7 et 9 (les plus critiques) et j'ai refait un audit complet du code pour vérifier l'efficacité réelle des correctifs — pas seulement leur présence. Voici le résultat :

- **5 points résolus** (2, 4, 6, 9, 10)
- **3 points réduits mais avec une lacune identifiée** (1, 3, 5)
- **1 point résolu intégralement** (7)
- **1 point confirmé comme un choix de design acceptable** (8)

**Une lacune notable a été trouvée** : l'endpoint `/api/game/reset` a été oublié lors de l'application des correctifs sur le device_id et le rate limiting. Détail ci-dessous.

---

## Détail point par point

### 1. Usurpation d'identité via device_id — 🟡 RÉDUIT (lacune identifiée)

**Correctif appliqué :** Un cookie `HttpOnly; Secure; SameSite=Strict` signé en HMAC-SHA256 (`kickstock_device_sig`) est maintenant lié au device_id. Vérification en temps constant (anti timing-attack) dans `lib/deviceSigning.ts`. Le cookie ne peut pas être lu ni copié via JavaScript.

**Vérifié actif sur :**
- ✅ `POST /api/trade`
- ✅ `POST /api/game/advance`
- ✅ `GET /api/game/state`

**Lacune trouvée :**
- ❌ `POST /api/game/reset` (`apps/web/app/api/game/reset/route.ts`) **n'appelle ni `verifyDevice()` ni aucune vérification de signature**. La route accepte n'importe quel `X-Device-ID` valide en format et réinitialise le portfolio correspondant (cash, holdings, transactions, best_score). Concrètement : un attaquant qui connaît (ou devine) le device_id d'un autre joueur peut **toujours** réinitialiser son portfolio à zéro — exactement le scénario que le correctif visait à éliminer.

**Action recommandée :** Ajouter le même appel `verifyDevice(req, deviceId)` que dans les 3 autres routes, juste après la validation du body (ligne ~22 de `route.ts`).

---

### 2. Moteur de jeu exposé côté client (triche) — ✅ RÉSOLU

**Correctif appliqué :** Le moteur `simulate()` accepte maintenant un générateur de nombres aléatoires injecté (`rng`), avec `Math.random` comme valeur par défaut côté serveur. En mode offline, le store local génère un PRNG seedé déterministe (Mulberry32) à partir de `gameId + jour + équipes`, stocké dans le state persisté.

**Vérifié :**
- `packages/game-engine/src/simulate.ts` : les 6 appels `Math.random()` ont été remplacés par `rng()`, signature `simulate(strA, strB, isKO, rng = Math.random)`
- `apps/web/stores/localGameStore.ts` : génération du seed et instanciation du PRNG par match avant l'appel à `simulate()`
- `apps/web/app/api/game/advance/route.ts` (ligne 212) : le serveur continue d'utiliser `Math.random` par défaut — comportement online inchangé

**Conclusion :** Un joueur qui redéfinit `Math.random` dans la console n'a plus aucun effet sur les résultats, ni en offline (PRNG seedé indépendant) ni en online (calcul serveur). Le point est totalement traité.

---

### 3. Absence de rate limiting — 🟡 RÉDUIT (même lacune que le point 1)

**Correctif appliqué :** Un rate limiter persistant basé sur Upstash Redis (sliding window) remplace le limiteur en mémoire. Limites par endpoint :
- `trade` : 30 req/min
- `advance` : 10 req/min
- `state` : 120 req/min
- `auth` (guest) : 5 req/10 min

**Vérifié actif sur :**
- ✅ `POST /api/trade`
- ✅ `POST /api/game/advance`
- ✅ `GET /api/game/state`
- ✅ `POST /api/auth/guest`

**Lacune trouvée :**
- ❌ `POST /api/game/reset` n'a **aucun rate limiting**. Combiné à la lacune du point 1, cette route est doublement exposée : pas de vérification d'identité ET pas de limite de fréquence — un attaquant pourrait spammer des resets de portfolio en boucle.

**Action recommandée :** Ajouter `checkRateLimit('reset', identifiant)` (créer un profil `reset` dans `lib/rateLimitRedis.ts`, par exemple 5 req/min) en plus du correctif du point 1.

---

### 4. Authentification admin — ✅ CONFIRMÉ SOLIDE (pas de régression)

Aucune modification nécessaire ni effectuée — ce point avait déjà été validé comme correct lors du premier audit (vérification du rôle `app_metadata.role === 'admin'` côté middleware, layout et chaque route admin). Re-vérifié, toujours conforme.

---

### 5. Cache localStorage non signé — 🟡 RÉDUIT (signature crypto non implémentée)

**État actuel :** Le cache `bootstrap.ts` reste **non signé cryptographiquement**. La proposition initiale d'ajouter une signature HMAC sur le cache n'a pas été implémentée.

**Mitigations déjà en place (avant et après) :**
- Vérification de version serveur — le cache est invalidé si la version serveur change
- TTL de 24h
- Le cache n'est utilisé qu'en lecture pour l'affichage / la simulation offline ; toute opération impactant réellement le portfolio (trade, reset) passe par des RPC serveur qui ne font pas confiance aux données client

**Conclusion :** Le risque réel reste faible — une falsification du cache local n'affecte que l'expérience du joueur qui la falsifie lui-même (offline) et ne permet pas de compromettre d'autres comptes ni la base de données. Une signature HMAC reste une amélioration possible mais n'est pas urgente.

---

### 6. Injection SQL via RPC Supabase — ✅ CONFIRMÉ NON APPLICABLE (pas de régression)

Re-vérifié : tous les appels RPC (`execute_competition_trade`, `get_or_create_competition_portfolio`, `set_guest_username`, etc.) passent les paramètres sous forme d'objets nommés au SDK Supabase, qui génère des requêtes préparées. Aucune concaténation de chaîne SQL nulle part dans le code applicatif. Ce point reste sans objet.

---

### 7. Fuite d'informations via Sentry — ✅ RÉSOLU

**Correctifs appliqués et vérifiés dans le code :**
- `sentry.client.config.ts` : `maskAllText: true`, `blockAllMedia: true` (étaient à `false`), `replaysOnErrorSampleRate` réduit de `1.0` à `0.5`
- `beforeSend` ajouté côté client **et** serveur : suppression des cookies et des headers sensibles (`x-device-id`, `authorization`, `cookie`) avant envoi à Sentry
- Nouveau helper `lib/sentryCapture.ts` : fonction `captureApiException()` qui filtre récursivement (profondeur max 4) une liste de clés sensibles (`device_id`, `user_id`, `cash`, `balance`, `password`, `token`, `portfolio`, `holdings`, `tx_log`, etc.) et les remplace par `[REDACTED]`
- Toutes les routes API (`trade`, `game/advance`, `game/state`, `game/reset`, crons) utilisent désormais `captureApiException()` au lieu de `Sentry.captureException()` brut

**Conclusion :** Les replays de session ne révèlent plus le texte saisi ni les médias, et les exceptions envoyées à Sentry ne contiennent plus ni cookies, ni headers d'authentification, ni données de jeu sensibles. Ce point est traité de façon complète et cohérente.

---

### 8. Constantes économiques exposées en frontend — 🟢 CONFIRMÉ : CHOIX DE DESIGN

`DIV_RATES` et `INIT_CASH` restent dans le package public `@kickstock/constants`, visibles dans le bundle JS. Comme déjà discuté, ce n'est pas une vulnérabilité de sécurité : ce sont des règles de jeu publiques, le serveur reste la source d'autorité pour tous les calculs ayant un impact réel (mode online). Aucune action requise.

---

### 9. Simulation de matchs truquée par redéfinition de Math.random — ✅ RÉSOLU

Identique au point 2 (même correctif, même mécanisme). Le PRNG seedé Mulberry32 est obligatoire en mode offline et indépendant de `Math.random`. Le serveur (mode online) n'a jamais été exposé à ce vecteur puisque `simulate()` y est exécuté côté serveur — mais le correctif a quand même renforcé le moteur en le rendant testable/déterministe sans changer son comportement online.

**Conclusion :** Plus aucun moyen pour un joueur de manipuler les résultats de match via la console du navigateur, ni en offline ni en online.

---

### 10. Pseudo stocké en localStorage sans validation serveur — ✅ CONFIRMÉ SOLIDE (pas de régression)

Re-vérifié : le pseudo est toujours validé côté serveur dans `/api/auth/guest` (regex format, longueur 3-20, liste de mots réservés, vérification d'unicité insensible à la casse via `ilike` en base). Le localStorage ne sert que de cache UX ; le serveur reste la seule autorité. Pas de changement nécessaire, pas de régression.

---

## Tableau de synthèse

| # | Point | Correctif appliqué | État final | Sévérité résiduelle |
|---|-------|-------------------|-----------|---------------------|
| 1 | Usurpation device_id | ✅ Oui (3/4 routes) | 🟡 Réduit | Moyenne — `/api/game/reset` non protégé |
| 2 | Moteur côté client | ✅ Oui | 🟢 Résolu | — |
| 3 | Rate limiting | ✅ Oui (4/5 routes) | 🟡 Réduit | Moyenne — `/api/game/reset` non protégé |
| 4 | Auth admin | — (déjà bon) | 🟢 Solide | — |
| 5 | Cache localStorage | ⚠️ Partiel (pas de signature crypto) | 🟡 Réduit | Faible |
| 6 | Injection SQL RPC | — (sans objet) | 🟢 Sans objet | — |
| 7 | Fuite Sentry | ✅ Oui | 🟢 Résolu | — |
| 8 | Constantes frontend | — (design) | 🟢 Acceptable | — |
| 9 | Math.random | ✅ Oui | 🟢 Résolu | — |
| 10 | Pseudo localStorage | — (déjà bon) | 🟢 Solide | — |

---

## Action restante avant clôture

**Une seule chose bloque la clôture complète des points 1 et 3 : sécuriser `/api/game/reset/route.ts`.**

Concrètement, il faut y ajouter exactement les deux lignes déjà utilisées dans `trade`, `game/advance` et `game/state` :

```typescript
// Après validation du body (après la ligne `if (!competitionId || !deviceId) {...}`)
const deviceErr = await verifyDevice(req, deviceId);
if (deviceErr) return deviceErr;

const rateLimitId = deviceId ?? userId ?? (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
const rl = await checkRateLimit('reset', rateLimitId);
if (rl.limited) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
```

(+ ajouter un profil `reset` dans `lib/rateLimitRedis.ts`, par exemple 5 requêtes/minute, et les deux imports correspondants).

C'est un correctif de quelques minutes — la même mécanique a déjà été validée et testée sur 3 autres routes.

---

## Vérification additionnelle recommandée pour la prod

`lib/deviceSigning.ts` contient un comportement de repli : si la variable d'environnement `DEVICE_SIGNING_SECRET` n'est pas définie, la vérification de signature retourne systématiquement `true` (c'est voulu pour ne pas bloquer le développement local). **Il faut s'assurer que cette variable est bien configurée dans l'environnement de production Vercel** — sinon toute la protection du point 1 est silencieusement désactivée. Une simple vérification dans le pipeline de déploiement suffit.

---

*Document produit suite à une seconde passe d'audit complète du code (et non une simple relecture des correctifs proposés) — chaque point a été re-vérifié indépendamment de son statut initial.*
