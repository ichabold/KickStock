# KickStock — Todo : Jeu fonctionnel Online & Offline

> État au 3 juin 2026.
> Ce document liste tout ce qui reste à faire pour avoir un jeu complet et jouable,
> en mode Online (vrais résultats API-Football) et Offline (simulation locale).
> Classé par priorité : 🔴 Bloquant · 🟠 Important · 🟡 Souhaitable

---

## ✅ RÉSOLU

### ~~1. Switch de langue FR/EN ne fonctionne pas~~ ✅

**Corrigé le 3 juin 2026.** Deux niveaux de problèmes résolus :

1. **Plomberie next-intl v4** — le middleware Supabase custom n'injectait pas le header `X-NEXT-INTL-LOCALE` attendu par `next-intl` v4. Corrigé dans `middleware.ts` + `i18n/request.ts` + `app/layout.tsx`.
2. **Strings françaises hardcodées** — 26+ textes dans `BrowserShell.tsx` étaient hors système i18n. Tous remplacés par `useTranslations`. 24 nouvelles clés ajoutées dans `en.json` / `fr.json`.
3. **Accessibilité** — `LanguageSwitcher` ajouté pour les guests et visiteurs (était réservé aux connectés).

**Analyse complète :** `docs/analyse-language-switch.md`

---

## 🟠 IMPORTANT — Mode Online

### 3. Cron `sync-results` — vérifier qu'il tourne en prod

Le cron est déclaré dans `vercel.json` mais il est aussi appelé via GitHub Actions (`sync-results.yml` toutes les 30 min). Vérifier qu'il y a bien une source active :

**Vérifier dans Vercel Dashboard :**
- Settings → Crons → `sync-fixtures` (planifié à 6h UTC quotidien)

**Vérifier dans GitHub :**
- Actions → `sync-results` → dernière exécution réussie ?

Les résultats des vrais matchs ne seront distribués qu'si ce cron s'exécute.

**Fichier :** `apps/web/app/api/cron/sync-results/route.ts`
**Secret requis :** `CRON_SECRET` en variable d'environnement Vercel ET en GitHub Secret.

---

### 4. Trade lock avant les matchs — vérifier le comportement

En mode Online, les trades doivent être bloqués avant chaque match (`trade_lock_until` en DB).

**À vérifier manuellement :**
- Le `TradeModal` lit `bootstrap.days.is_ko` pour `isKO` ✅ (corrigé)
- Mais le lock du marché (`trade_lock_until` par fixture) n'est visible que dans `LiveTab`
- Le RPC `execute_competition_trade` vérifie-t-il `trade_lock_until` côté serveur ?

**Fichier SQL à vérifier :** `db/migrations/012_multi_competition.sql` — RPC `execute_competition_trade`, chercher `trade_lock_until`.

---

### 5. `LiveTab` — statut des matchs en temps réel

Le `LiveTab` poll toutes les 60 secondes `/api/game/live-matches`. Vérifier :
- Que la route retourne bien les matchs du jour avec `api_status` correct
- Que `trade_lock_until` est bien renseigné en DB pour les matchs WC2026
- Que le cron `sync-fixtures` a bien peuplé `matches.fixture_id` (nécessaire pour `sync-results`)

**Fichier :** `apps/web/app/api/game/live-matches/route.ts`
**Note :** la route prend la première compétition active sans tenir compte du `competitionId` sélectionné par le joueur → à corriger si plusieurs compétitions actives simultanément.

---

### 6. Reset game en Online — vérifier en prod

`POST /api/game/reset` efface cash, holdings, transactions du portfolio.
Vérifier que :
- Le bouton "Recommencer" dans le menu avatar appelle bien la route
- La route s'exécute sans erreur (vérifier les logs Vercel)
- Après reset, `fetchState()` recharge bien l'état initial (10 000 KC, portfolio vide)

**Fichier :** `apps/web/app/api/game/reset/route.ts`

---

## 🟠 IMPORTANT — Mode Offline

### 7. Isolation des états par compétition — vérifier en prod

La clé persist Zustand est `ks-game-state-{competitionId}` (corrigé Vague 1 FIX 3).

**À tester :**
1. Jouer quelques trades sur compétition 1
2. Changer de compétition → compétition 2
3. Vérifier que le portfolio est vide (pas contaminé par compétition 1)
4. Revenir sur compétition 1 → vérifier que les trades sont toujours là

---

### 8. `advanceDay` offline — vérifier que la simulation fonctionne de bout en bout

Le pipeline complet `advanceDay()` : simulate → applyResult → genGoals → dividendes → KO pools → best score.
Les 4 tests unitaires passent. Vérifier sur l'interface :
- Qu'une journée de groupes simule correctement
- Que les pools R32 se construisent après le dernier jour de groupes
- Que les phases KO s'enchaînent correctement
- Que le champion est déclaré en fin de tournoi

---

## 🟡 SOUHAITABLE

### 9. Leaderboard — affichage du rang courant

`RankingView` dans `BrowserShell` affiche le leaderboard global. Vérifier :
- Que le score du joueur courant apparaît bien dans la table
- Que `syncBestScore()` est appelé correctement après chaque `advanceDay` offline

---

### 10. Admin — tester l'import d'équipes via API-Football

`POST /api/admin/competitions/[id]/import-teams` appelle l'API API-Football.
Nécessite `API_FOOTBALL_KEY` en variable d'environnement Vercel.

**À faire :**
- Vérifier que la variable `API_FOOTBALL_KEY` est configurée dans Vercel → Settings → Environment Variables
- Tester l'import sur une compétition de test

---

### 11. `sync-fixtures` — tester le déclenchement manuel depuis l'admin

Dans `/admin/competitions/[id]`, le bouton "↻ SYNC FIXTURES" appelle `POST /api/cron/sync-fixtures` avec `Authorization: Bearer {NEXT_PUBLIC_CRON_SECRET}`.

**Note :** `NEXT_PUBLIC_CRON_SECRET` expose le secret côté client — à remplacer par un appel serveur ou supprimer côté admin et utiliser `CRON_SECRET` (variable non-publique) depuis une Server Action.

---

### 12. `NationDetailOverlay` — historique de prix en mode Online

En mode Online, `priceHistory` vient de la table `competition_prices` via `/api/game/state`. La sparkline doit afficher l'historique réel des prix.

**À vérifier :** que la sparkline s'affiche correctement en mode Online (pas seulement Offline où l'historique est construit localement).

---

### 13. `fmt()` — format des nombres selon la locale

`fmt(v)` utilise `toLocaleString('en-US')` (séparateur de milliers américain : `10,000`).
En FR, la convention est `10 000` (espace). Pas bloquant mais à noter pour la cohérence.

---

### 14. Supprimer `NATIONS` et `SCORER_POOL` restants dans le code legacy

Ces constantes ont été supprimées de `@kickstock/constants`. Mais :
- `packages/game-engine/src/genGoals.ts` : `SCORER_POOL` supprimé ✅
- `packages/game-engine/src/initState.ts` : `NATIONS` fallback supprimé ✅
- Vérifier qu'aucun test ou script externe ne les référence encore :

```bash
grep -rn "NATIONS\|SCORER_POOL" . --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".d.ts"
```

---

## Récapitulatif

| # | Priorité | Item | Mode | Effort |
|---|----------|------|------|--------|
| ~~1~~ | ~~🔴~~ | ~~Switch langue FR/EN~~ | ~~Both~~ | ✅ |
| ~~2~~ | ~~🔴~~ | ~~Strings FR hardcodées dans BrowserShell~~ | ~~Both~~ | ✅ |
| 3 | 🟠 | Vérifier cron `sync-results` actif en prod | Online | 15 min |
| 4 | 🟠 | Vérifier trade lock dans RPC SQL | Online | 30 min |
| 5 | 🟠 | `LiveTab` — vérifier fixture_id + statuts | Online | 30 min |
| 6 | 🟠 | Reset game online — vérifier end-to-end | Online | 30 min |
| 7 | 🟠 | Isolation états offline par compétition | Offline | 15 min |
| 8 | 🟠 | `advanceDay` offline — vérifier pipeline complet | Offline | 30 min |
| 9 | 🟡 | Leaderboard — rang courant | Both | 15 min |
| 10 | 🟡 | Admin import équipes API-Football | Admin | 30 min |
| 11 | 🟡 | Admin sync-fixtures — sécuriser CRON_SECRET | Admin | 30 min |
| 12 | 🟡 | NationDetailOverlay sparkline en Online | Online | 30 min |
| 13 | 🟡 | `fmt()` — format locale FR | Both | 1h |
| 14 | 🟡 | Vérifier dead code NATIONS/SCORER_POOL | Both | 10 min |
