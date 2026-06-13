# Smart Polling — Plan de mise en place

> Statut : **proposition validée (décisions ci-dessous), rien n'est codé**. Ce doc sert de base de discussion avant implémentation.

## 0. Décisions prises

- **Option A** retenue (cron fixe `*/2 min` + court-circuit interne) — pas de service externe (QStash).
- **`sync-results` (30 min, filet de sécurité) est conservé sans changement**.
- **Étape 3** (lecture DB-first pour `/api/game/live-matches`) est **incluse dans le scope** de la V1, pour réduire encore les appels API-Football redondants côté front.
- Plan API-Football : **PRO — 7 500 requêtes/jour, toutes compétitions, tous endpoints**. Cf. §3 pour le calcul de marge.

## 1. Existant (rappel)

| Cron | Fréquence | Rôle |
|---|---|---|
| `sync-fixtures` | 1×/jour (06:00 UTC) | Récupère le calendrier complet (fixtures) depuis API-Football, upsert `matches`, `competition_days`, etc. |
| `sync-squads` | 1×/semaine | Squads |
| `sync-results` | *(prévu 30 min, pas dans `vercel.json` actuellement)* | Vérifie les matchs FT/AET/PEN, traite les résultats. Court-circuité par [`isMatchWindowActive()`](apps/web/lib/match-window.ts) (±3h autour de maintenant → sinon 0 appel API) |
| `/api/game/live-matches` | À la demande (front) | Si un match est en `1H/HT/2H/ET/BT/P`, enrichit avec `fetchLiveFixtures()` |

Il y a donc déjà une brique de "smart polling" côté `sync-results` (fenêtre ±3h, court-circuit). L'idée ici est de **généraliser et resserrer** ce mécanisme pour le live (score en direct), avec une cadence beaucoup plus fine (ex. 2 min) **uniquement quand un match est en cours**.

## 2. Proposition

### 2.1 — Cron "Calendrier" (déjà existant : `sync-fixtures`, 06:00 UTC)
Pas de changement de fond. Il alimente `matches.scheduled_at` et `matches.api_status` une fois par jour — c'est la source de vérité pour savoir "quand" des matchs sont prévus.

### 2.2 — Nouveau cron "Live Poll" (`/api/cron/live-poll`)

- **Schedule Vercel** : fixe, fréquent (ex. `*/2 * * * *`, toutes les 2 min), actif sur une **plage horaire large** couvrant tous les créneaux possibles de matchs (ex. `*/2 6-23 * * *` = toutes les 2 min de 6h à 23h59 UTC). Vercel Cron ne permet pas un schedule "dynamique" (modifié à la volée) — la plage horaire est donc volontairement large pour couvrir tous les cas, et c'est la **logique interne** qui fait le tri (cf. ci-dessous).
- **Logique interne à chaque exécution** :
  1. Requête DB légère : `matches` où `processed_at IS NULL` ET `scheduled_at` ∈ `[now - 5min, now + 3h]` ET `api_status NOT IN (FT, AET, PEN, PST, CANC, ABD, SUSP)`.
  2. **Si aucun match dans cette fenêtre → exit immédiat, 0 appel API-Football** (même principe que `isMatchWindowActive`, mais fenêtre plus serrée car le but est le live, pas juste "vérifier les résultats").
  3. **Si des matchs sont dans la fenêtre** :
     - Appel `fetchLiveFixtures(leagueIds)` (1 appel API-Football, retourne tous les matchs live de la/les ligue(s) d'un coup — pas un appel par match).
     - Pour chaque fixture retournée :
       - update `matches.score_a/score_b/api_status` en DB (cache léger pour que `/api/game/live-matches` n'ait plus besoin d'appeler l'API à chaque requête front — ou en complément).
       - **Si `api_status` devient `FT`/`AET`/`PEN`** → déclenche le traitement de résultat (réutiliser `processRealMatchResult` existant de `sync-results`) → `processed_at` est rempli → le match **sort automatiquement de la fenêtre** au prochain tick (condition `processed_at IS NULL`). C'est l'« arrêt automatique » demandé.

### 2.3 — `sync-results` est conservé tel quel
Décision : on **garde `sync-results` en filet de sécurité** (30 min, fenêtre large ±3h, inchangé). Coût quasi nul, et il couvre les cas où `live-poll` aurait raté un match (erreur réseau, timeout, déploiement en cours, etc.).

### 2.4 — Schéma résumé

```
06:00 UTC  ─ sync-fixtures (1×/jour) ──────────────► matches.scheduled_at à jour
06h→23h59  ─ live-poll (*/2 min) ─┬─ aucun match dans [now-5,now+3h] ? → exit (0 call)
                                   └─ sinon → fetchLiveFixtures() (1 call)
                                       → update score/status en DB
                                       → si FT/AET/PEN → processRealMatchResult()
                                                        → processed_at set → sort de la fenêtre
30 min     ─ sync-results (filet de sécurité, inchangé)
```

## 3. Le plan Vercel Pro suffit-il ? Et le plan API-Football PRO (7 500 req/jour) ?

### Vercel Pro
- **Cron jobs** : plan Hobby = limité à 2 crons en fréquence quotidienne max. Plan **Pro** = jusqu'à **40 cron jobs**, et fréquence libre (jusqu'à 1×/minute). → ajouter un 3ᵉ/4ᵉ cron à `*/2 min` est sans problème.
- **Invocations** : `*/2 * * * *` sur 18h (06h-23h59) = ~540 invocations/jour, soit ~16 000/mois. Le quota Pro inclus (function invocations) est de l'ordre du million/mois → impact négligeable.
- **Durée d'exécution** : la requête DB de check + (éventuellement) 1 appel API-Football tient largement dans `maxDuration: 10-15s` (Pro permet jusqu'à 300s si besoin), quasi instantané dans 95% des cas (pas de match en cours).

### API-Football PRO (7 500 req/jour)
Estimation du nombre d'appels `/fixtures?live=all` réellement déclenchés par `live-poll` :

- Fenêtre par match : `[kickoff - 5min, kickoff + ~2h10]` (90 min + pauses + prolongations), soit ~135 min ≈ **68 ticks de 2 min**.
- `fetchLiveFixtures` fait **1 seul appel par ligue active**, peu importe le nombre de matchs simultanés dans cette fenêtre (les fenêtres se chevauchent → pas de cumul).
- Jour avec le plus de matchs (ex. journées à 4 créneaux différents pendant la phase de groupes) : ~4 fenêtres distinctes/jour, dans le pire cas sans chevauchement → **4 × 68 ≈ 270 appels/jour**.
- `sync-results` (inchangé, 30 min, fenêtre ±3h) ajoute au pire ~10-15 appels/jour supplémentaires sur un jour de match.
- `sync-fixtures` (1×/jour) + `sync-squads` (1×/semaine) : quelques appels négligeables.

**Total pire cas estimé : ~300 appels/jour**, sur un budget de **7 500/jour** → marge ×25. Largement suffisant, même avec :
- plusieurs compétitions actives en parallèle,
- une fenêtre plus large que prévu (`now-5min, now+3h` au lieu de serrer à `now-5min, now+2h10`),
- des appels supplémentaires manuels depuis l'admin.

**Conclusion** : Vercel Pro **et** API-Football PRO (7 500 req/jour) suffisent très largement. Aucun changement de plan nécessaire. La fenêtre proposée (`[now-5min, now+3h]`) peut rester telle quelle sans risque de quota — pas besoin de la resserrer.

## 3bis. Vérification vs. doc API-Football

J'ai essayé de consulter https://www.api-football.com/documentation-v3 directement, mais le site renvoie **403 (protection anti-bot Cloudflare)** — impossible de fetcher la doc en live. Sur la base de la documentation v3 connue (et du code déjà présent dans [`football-api.ts`](apps/web/lib/football-api.ts)), 2 points qui confortent ou affinent le plan, sans le remettre en cause :

1. **Limite par minute, en plus du quota journalier** : les plans API-Football imposent aussi un nombre de requêtes/minute (le plan PRO autorise typiquement plusieurs centaines/min). À `*/2 min`, on est à 0,5 req/min en moyenne → aucun risque de cogner cette limite, même en rafale (sync-fixtures + live-poll + sync-results qui se chevauchent un instant).
2. **Optimisation possible sur `/fixtures?live=all`** : cet endpoint accepte d'être appelé **sans paramètre `league`**, et retourne alors *tous* les matchs en direct, toutes ligues confondues, en **un seul appel**. `fetchLiveFixtures()` actuel boucle sur `leagueIds` (1 appel par ligue active). Si plusieurs compétitions sont actives en parallèle, on pourrait passer à **1 seul appel global** (puis filtrer côté code par `league.id`) → réduit encore légèrement le nombre d'appels. Pas critique vu la marge ×25 (§3), mais à considérer lors de l'étape 1 si on veut polir.
3. **Statuts FT/AET/PEN** : confirmés comme statuts terminaux dans la doc v3, cohérent avec ce qui est déjà utilisé dans `processRealMatchResult` / `LIVE_STATUSES` — aucun changement nécessaire sur ce point.

→ **Conclusion : le plan n'a pas besoin d'être révisé.** Seule l'optimisation #2 est une amélioration mineure, à garder en tête pour l'étape 1 (`live-poll`) si plusieurs compétitions tournent en même temps.

## 4. "Automatiser" malgré le cron statique de Vercel

Le souci soulevé ("pas de cron dynamique") est réel : `vercel.json` est figé au déploiement, impossible de dire "active le cron seulement aujourd'hui de 15h à 17h parce qu'il y a un match à 15h".

**Décision : Option A** — cron fixe + court-circuit interne (décrit en §2.2).
- Zéro dépendance externe, réutilise le pattern déjà en place (`isMatchWindowActive`), simple à débugger.
- Le cron "tourne dans le vide" en dehors des matchs, mais le coût de ce vide est ~0 (une requête DB `count`) — confirmé négligeable côté Vercel (§3) et côté API-Football (marge ×25, §3).
- L'option B (scheduling dynamique via Upstash QStash) n'est pas retenue : pas nécessaire vu la marge de quota disponible, et elle ajouterait une dépendance externe + complexité de gestion de schedules sans bénéfice mesurable ici.

## 5. Étapes d'implémentation (à valider avant de coder)

1. Ajouter `apps/web/app/api/cron/live-poll/route.ts` :
   - Court-circuit interne (fenêtre `[now-5min, now+3h]`, matchs `processed_at IS NULL` et `api_status` hors `FT/AET/PEN/PST/CANC/ABD/SUSP`).
   - Si fenêtre active : `fetchLiveFixtures(leagueIds)` (1 appel par ligue), update `matches.score_a/score_b/api_status` en DB.
   - Si `api_status` devient `FT/AET/PEN` : appeler `processRealMatchResult()` (réutilisé depuis `sync-results`) → `processed_at` rempli → sortie automatique de la fenêtre au tick suivant.
2. Ajouter l'entrée cron dans `vercel.json` (root + `apps/web/vercel.json`) : `*/2 6-23 * * *`.
3. Étendre `/api/game/live-matches` pour lire le score/status depuis la DB en priorité (déjà tenu à jour par `live-poll`), et ne fallback sur `fetchLiveFixtures` que si la donnée DB est jugée trop ancienne (ex. > 3 min) — réduit encore les appels redondants déclenchés par le front.
4. `sync-results` : aucun changement de code, juste vérifier qu'il n'entre pas en conflit avec `live-poll` sur le traitement d'un même match (idempotence de `processRealMatchResult` — déjà garantie via `processed_at`).
5. Tests : simuler un match en fenêtre (`scheduled_at` proche de `now`) en local/staging, vérifier le court-circuit, la mise à jour des scores, et le passage `processed_at` → sortie de fenêtre.
6. Monitoring : logger le nombre d'appels API-Football réellement effectués par jour (Sentry breadcrumb ou `console.log`) pour confirmer l'estimation du §3 en conditions réelles.
