# Rapport Critique — Admin-pannel-.md vs Admin Panel KickStock Réel

> **Méthodologie** : chaque point du document `Admin-pannel-.md` est confronté à ce qui existe réellement dans le code KickStock. Verdict en 3 niveaux : ✅ **Conforme** (présent et fonctionnel), ⚠️ **Partiel** (commencé mais incomplet), ❌ **Absent** (non implémenté).

---

## État général de l'admin panel existant

Avant l'analyse point par point, voici la cartographie exacte de ce qui existe.

### Pages existantes

```
/admin                              → Liste des compétitions + états de jeu
/admin/competitions/new             → Formulaire création compétition
/admin/competitions/[id]            → Détail compétition (4 sections : métadonnées,
                                      état de jeu, équipes, matchs du jour)
```

### API routes admin existantes

```
POST /api/admin/competitions                     → Créer une compétition
POST /api/admin/competitions/[id]/toggle-active  → Activer / désactiver
POST /api/admin/competitions/[id]/import-teams   → (non lu mais présent)
POST /api/admin/simulate-day                     → Simuler une journée
```

### Protection d'accès

```typescript
// admin/layout.tsx
if (!user || user.app_metadata?.role !== 'admin') {
  redirect('/');
}
```

Basé sur `app_metadata.role === 'admin'` (métadonnée Supabase Auth côté serveur), **pas** sur un champ `is_admin` dans une table `profiles`.

---

## Point 1 — Gestion des paramètres globaux du jeu

### Ce que le plan dit
Table `game_config` (clé-valeur). Formulaire admin catégorisé en 4 sections : économie/trading (6 paramètres), dividendes (6 taux), moteur de simulation (16 paramètres), trading lock (3 paramètres), UI/technique (4 paramètres). Total : **~35 paramètres configurables sans redéploiement**.

### Ce qui existe réellement

**❌ Totalement absent.**

Il n'existe **aucune table `game_config`** dans les migrations SQL. Aucun endpoint `/api/admin/config`. Aucune UI pour modifier ces paramètres.

**Où sont ces valeurs actuellement ?**

Tous ces paramètres sont des **constantes hardcodées** dans le code :

| Paramètre plan | Valeur actuelle | Emplacement dans le code |
|---|---|---|
| `init_cash` | 10 000 | `packages/constants/src/index.ts:85` — `INIT_CASH = 10_000` |
| `tax_rate_groups` | 0.10 | `packages/game-engine/src/calcTax.ts:9` — `0.10` hardcodé |
| `tax_rate_ko` | 0.05 | `packages/game-engine/src/calcTax.ts:9` — `0.05` hardcodé |
| `min_tax` | 10 | `packages/game-engine/src/calcTax.ts:9` — `10` hardcodé |
| `concentration_cap` | 0.40 | `apps/web/components/shared/TradeModal.tsx:33` — `0.40` hardcodé |
| `eliminated_price` | 1 | `apps/web/app/api/game/advance/route.ts:197` — `1` hardcodé |
| `dividend_r32` ... `dividend_champion` | 0.10 → 0.60 | `packages/constants/src/index.ts:81` — `DIV_RATES` hardcodé |
| `upset_prob_base` | 0.26 | `packages/game-engine/src/simulate.ts:10` — hardcodé |
| `draw_prob_base` | 0.25 | `packages/game-engine/src/simulate.ts:11` — hardcodé |
| `upset_decay` | 0.006 | `packages/game-engine/src/simulate.ts:10` — hardcodé |
| `draw_decay` | 0.004 | `packages/game-engine/src/simulate.ts:11` — hardcodé |
| `penalty_base_rate` | 0.73 | `packages/game-engine/src/simulate.ts:33` — hardcodé |
| `et_prob` | 0.60 | `packages/game-engine/src/simulate.ts:27` — hardcodé |
| `trade_lock_post_match` | 15 min | `apps/web/lib/process-real-result.ts:162` — hardcodé |
| `mobile_breakpoint` | 600 | `packages/constants/src/index.ts:25` — hardcodé |
| `max_transactions_history` | 100 | `stores/localGameStore.ts:254` — `.slice(0, 100)` hardcodé |

### Critique

**C'est le gap le plus important du plan.** L'objectif affiché — "modifier tous les paramètres du jeu sans modifier le code ni redéployer" — n'est **pas atteint du tout**. Tout changement (même ajuster la taxe de 10% à 8%) nécessite une modification du code + un redéploiement Vercel.

**Évaluation de la faisabilité du plan :**

La table `game_config` clé-valeur est la bonne architecture. Implémenter Point 1 complet représente :
1. Migration SQL : créer `game_config (key TEXT PRIMARY KEY, value JSONB, description TEXT)`
2. Seeder avec les 35 valeurs par défaut
3. Refactorer `calcTax`, `simulate`, `calcDividends` pour lire depuis la DB au lieu de constantes
4. Créer `GET /api/admin/config` + `PUT /api/admin/config`
5. Créer l'UI formulaire catégorisé

C'est **réalisable mais substantiel** — plusieurs jours de travail.

**Point de vigilance sur la section 1.3 "Moteur de simulation" :** exposer `upset_prob_base`, `draw_decay` etc. à un admin sans garde-fous est risqué. Un paramètre mal réglé peut rendre le jeu fondamentalement cassé (ex. `draw_min = 0.80` → 80% de matchs nuls). Des plages de validation (`0 – 1`) sont prévues dans le document — elles sont nécessaires et devront être enforced côté API.

---

## Point 2 — Gestion des équipes (nations)

### Ce que le plan dit
Tableau éditable des 48 équipes : `name`, `flag_emoji`, `strength`, `confederation`, `group_code`, `initial_price` modifiables. Désactiver une équipe (`is_active = false`). Ajout exceptionnel.

### Ce qui existe réellement

**⚠️ Partiel — lecture seule uniquement.**

La page `/admin/competitions/[id]` affiche la **Section C** avec un tableau des équipes :

| Colonne affichée | Modifiable ? |
|---|---|
| Flag emoji | ❌ lecture seule |
| ID (team_id) | ❌ lecture seule |
| Nom | ❌ lecture seule |
| Groupe | ❌ lecture seule |
| Force (strength) | ❌ lecture seule |
| Prix initial | ❌ lecture seule |
| Prix actuel | ❌ lecture seule |
| Δ% variation | ❌ lecture seule |

**Ce qui existe en plus :** une route `POST /api/admin/competitions/[id]/import-teams` (non lue en détail mais présente) qui permet d'importer les équipes depuis l'API Football lors du bootstrap d'une compétition.

### Critique

**Le tableau est un bon début pour la supervision**, mais l'édition est totalement absente. Pour KickStock, les modifications les plus fréquentes seraient :
- **`strength`** : ajuster la force d'une équipe suite à des résultats surprenants
- **`initial_price`** : corriger un prix de départ avant le début du tournoi
- **`group_code`** : corriger une mauvaise attribution de groupe lors du sync

Ces 3 champs sont ceux qui ont le plus de valeur à être éditables sans redéploiement.

**`is_active` sur les équipes** : le champ existe dans le plan mais pas dans le schéma DB actuel sur la table `teams`. Une équipe forfait (ex. blessure de masse, problème politique) forcerait aujourd'hui un patch SQL manuel.

---

## Point 3 — Gestion des compétitions

### Ce que le plan dit
Liste, ajout, édition (`name`, `start_date`, `is_active`). Ajout nouvelle compétition avec `league_id`, `season`, `start_date`.

### Ce qui existe réellement

**✅ Conforme — c'est la section la mieux implémentée.**

| Fonctionnalité | Réalité |
|---|---|
| Liste des compétitions | ✅ `/admin` — tableau avec nom, saison, league_id, statut, phase, jour, champion |
| Affichage `is_active` | ✅ avec badge vert/gris |
| Modifier `is_active` | ✅ bouton "ACTIVER / DÉSACTIVER" dans `CompetitionActions` → `toggle-active` |
| Ajouter une compétition | ✅ `/admin/competitions/new` — formulaire complet |
| Formulaire : name, season, league_id, start_date, end_date | ✅ |
| `competition_game_state` créé automatiquement | ✅ dans `POST /api/admin/competitions` |

**Ce qui manque par rapport au plan :**
- Modification de `name` et `start_date` sur une compétition existante (pas d'interface d'édition, seulement création)
- `league_id` et `season` en lecture seule : ✅ (correctement traité — liés à l'API)

### Critique

C'est le seul point du document entièrement couvert. L'implémentation est propre et fonctionnelle. Le formulaire de création initialise automatiquement le `competition_game_state` — c'est le comportement correct.

**Point manquant mineur :** il n'y a pas de formulaire d'édition pour une compétition existante. Si le nom doit être corrigé, il faut passer par Supabase directement.

---

## Point 4 — Gestion des matchs (override et sync)

### Ce que le plan dit
Liste de tous les matchs. Forcer `sync-fixtures` et `sync-results` manuellement. Modifier scores, statut, `played_at`, `processed_at`. Déclencher `processRealMatchResult` pour un match spécifique.

### Ce qui existe réellement

**⚠️ Partiel — affichage limité, actions partielles.**

**Ce qui existe :**
- Section D dans `/admin/competitions/[id]` : tableau des **matchs du jour courant uniquement** (pas tous les matchs)
- Colonnes : `fixture_id`, équipes, score, phase, statut API, heure prévue, `processed_at` (✓ ou —)
- **Bouton "↻ SYNC FIXTURES"** dans `CompetitionActions` → appelle `/api/cron/sync-fixtures`
- **Bouton "⚡ SIMULATE DAY"** → appelle `/api/admin/simulate-day` (simule le jour courant)

**Ce qui est absent :**
- ❌ Bouton "Sync Results Now" (déclencher `sync-results` manuellement)
- ❌ Modification manuelle des scores, statut, `played_at`, `processed_at`
- ❌ Déclencher `processRealMatchResult` sur un match spécifique
- ❌ Affichage de **tous** les matchs (pas seulement le jour courant)
- ❌ Filtre par jour, phase, statut
- ❌ Endpoint `PUT /api/admin/matches/:id`

### Critique

**La limitation à "matchs du jour courant" est le problème principal.** En pratique, un admin a besoin de :
1. Voir un match d'un jour passé dont le résultat est erroné
2. Forcer le retraitement si l'API Football était down
3. Corriger un score si l'API a renvoyé une donnée incorrecte

Ces trois cas sont **impossibles** avec l'UI actuelle. La route `POST /api/admin/simulate-day` est utile pour les tests mais ne couvre pas le retraitement d'un match réel spécifique.

**Le bouton "Sync Fixtures" a un bug de sécurité :** dans `CompetitionActions.tsx`, il utilise `process.env.NEXT_PUBLIC_CRON_SECRET` — exposer le secret cron côté client (`NEXT_PUBLIC_`) est une faille. Le secret devrait transiter par une route API intermédiaire côté serveur, pas être injecté dans le bundle JS public.

---

## Point 5 — Gestion des utilisateurs (comptes)

### Ce que le plan dit
Liste utilisateurs (email, inscription, dernière connexion, rôle). Bannir/débannir. Changer le pseudo. Réinitialiser le portfolio. Supprimer le compte. Export RGPD.

### Ce qui existe réellement

**❌ Totalement absent.**

Il n'existe aucune page `/admin/users`, aucun endpoint `/api/admin/users`, aucune action de ban/reset.

**Ce qui existe dans le schéma DB :**
- Table `profiles` : `id`, `username`, `is_auto` — mais **pas de champ `banned`**, pas de champ `is_admin`
- La vérification admin se fait via `user.app_metadata?.role !== 'admin'` (côté Supabase Auth), pas via la table `profiles`

### Critique

**C'est le deuxième gap majeur.** Pour un jeu multijoueur en production, l'absence de gestion utilisateur est un risque opérationnel réel :

- **Ban** : si un joueur exploite un bug ou triche, aucun moyen de l'exclure sans intervention manuelle dans Supabase
- **Reset portfolio** : si un admin veut corriger une erreur technique (bug de liquidation, double dividende), il faut faire un `UPDATE` SQL manuel
- **Export RGPD** : obligation légale en Europe si des données personnelles sont traitées (email Supabase = données personnelles)
- **Changement de pseudo** : un pseudo offensant ne peut pas être modifié sans accès direct à la DB

**Sur `banned` dans `profiles` :** le champ n'existe pas. L'ajouter est trivial (`ALTER TABLE profiles ADD COLUMN banned BOOLEAN DEFAULT FALSE`), mais les middlewares et RPCs doivent ensuite vérifier cette valeur — c'est un travail transversal.

**Priorité recommandée :** la fonction "Reset portfolio" est la plus urgente pour la stabilité du jeu en production. Les autres sont importantes mais moins critiques à court terme.

---

## Point 6 — Monitoring et logs

### Ce que le plan dit
Historique des exécutions de crons (statut, durée, erreurs). Alertes : `last_sync_at > 26h`, matchs non traités. Test d'intégrité.

### Ce qui existe réellement

**❌ Absent côté UI — partiellement présent côté backend.**

**Ce qui existe dans le code mais sans UI :**
- `competitions.last_sync_at` mis à jour après chaque `sync-fixtures` → la donnée existe mais n'est pas affichée dans l'admin
- Sentry capture toutes les exceptions backend — les erreurs sont visibles dans le dashboard Sentry, pas dans l'admin
- Pas de table de logs de crons

**Ce qui manque complètement :**
- ❌ Page de monitoring `/admin` (le seul onglet de navigation actuel pointe vers "Compétitions")
- ❌ Historique des executions de crons
- ❌ Alerte visuelle si `last_sync_at > 26h`
- ❌ Compteur de matchs non traités avec alerte
- ❌ Test d'intégrité (vérifier que tous les matchs d'un jour ont `processed_at`)

### Critique

**L'absence de monitoring est le risque opérationnel le plus immédiat.** En production (tournoi live), savoir si le `sync-results` a bien tourné est critique. Actuellement, il faut :
1. Aller sur Vercel → Logs pour voir les executions de crons
2. Aller sur Sentry pour voir les erreurs
3. Interroger directement Supabase pour compter les matchs non traités

Ce sont trois outils différents pour une information qui devrait être en un seul endroit.

**Solution minimale viable :** afficher `last_sync_at` et un compteur de matchs `processed_at IS NULL` directement sur la page d'une compétition (Section B existante). C'est 2 requêtes SQL de plus et quelques lignes d'affichage — effort très faible pour un gain de visibilité élevé.

---

## Point 7 — Sauvegarde et restauration (optionnel)

### Ce que le plan dit
Export configuration JSON. Import pour préparer un nouveau tournoi.

### Ce qui existe réellement

**❌ Absent.**

Aucune fonctionnalité d'export/import de configuration.

### Critique

Ce point est marqué "optionnel" dans le document et c'est justifié. Avec une table `game_config` correctement implémentée (Point 1), l'export serait trivial (`SELECT * FROM game_config` → JSON). L'import serait un `UPSERT` sur cette même table.

**Dépendance forte :** ce point ne peut pas être implémenté sans le Point 1 (`game_config`). Si Point 1 n'est pas fait, Point 7 n'a pas d'objet.

---

## Point 8 — Sécurité de l'admin panel

### Ce que le plan dit
`is_admin = true` dans `profiles`. Middleware Next.js vérifiant le rôle. Endpoints API vérifiant aussi le rôle. Journalisation des actions admin (optionnel).

### Ce qui existe réellement

**⚠️ Partiellement conforme — mécanisme différent mais efficace.**

#### Protection des pages (`/admin/*`)

**✅ Implémenté — mécanisme légèrement différent.**

```typescript
// admin/layout.tsx — Server Component
if (!user || user.app_metadata?.role !== 'admin') {
  redirect('/');
}
```

La vérification est faite dans le **layout serveur** de `/admin`. Tout accès non-admin est redirigé vers `/`. C'est correct et sécurisé.

**Divergence :** le plan prévoyait `is_admin` dans la table `profiles`. La réalité utilise `app_metadata.role` dans Supabase Auth. Les deux approches sont valides, mais `app_metadata` est **plus sécurisé** car il n'est modifiable que par le `service_role` (pas par un RLS client).

#### Protection des endpoints API admin

**✅ Partiellement implémenté.**

Les routes `/api/admin/competitions` et `/api/admin/competitions/[id]/toggle-active` vérifient :
```typescript
if (!user || user.app_metadata?.role !== 'admin') {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

La route `/api/admin/simulate-day` utilise un mécanisme différent : `Authorization: Bearer {CRON_SECRET}` — moins sécurisé pour un usage UI car `NEXT_PUBLIC_CRON_SECRET` est exposé côté client (voir Point 4, bug signalé).

#### Middleware Next.js

**⚠️ Le layout server est suffisant** mais le document mentionne `middleware.ts`. Dans le code réel, `middleware.ts` ne couvre pas spécifiquement `/admin` — la protection est dans le layout. Les deux approches protègent l'UI, mais le layout ne protège pas les routes API directement appelées depuis l'extérieur.

#### Journalisation des actions admin

**❌ Absent.**

Aucune table d'audit des actions admin. Aucun log "qui a modifié quoi, quand". En production, c'est une lacune si plusieurs admins ont accès.

### Critique

**Le mécanisme existant (`app_metadata.role`) est correct et plus robuste que `is_admin` dans `profiles`**. Le vrai problème de sécurité est l'exposition de `NEXT_PUBLIC_CRON_SECRET` dans `CompetitionActions.tsx` — c'est le seul bug de sécurité identifié dans l'admin actuel.

---

## Point 9 — Interface utilisateur (maquette fonctionnelle)

### Ce que le plan dit
7 onglets : Paramètres généraux, Équipes, Compétitions, Matchs, Utilisateurs, Logs & monitoring, Maintenance.

### Ce qui existe réellement

**⚠️ 1 onglet sur 7 implémenté, avec des fonctionnalités de maintenance intégrées.**

| Onglet prévu | Réalité |
|---|---|
| 1. Paramètres généraux | ❌ Absent |
| 2. Équipes | ⚠️ Affiché (lecture seule) dans la page compétition |
| 3. Compétitions | ✅ Page principale `/admin` + création + détail |
| 4. Matchs | ⚠️ Affiché (matchs du jour, lecture seule) dans la page compétition |
| 5. Utilisateurs | ❌ Absent |
| 6. Logs & monitoring | ❌ Absent |
| 7. Maintenance | ⚠️ Boutons Sync Fixtures + Simulate Day dans la page compétition |

**Navigation actuelle dans l'admin :**
- Barre de navigation : `Compétitions` | `+ Nouvelle` | `← App`
- Seulement 2 liens de navigation — très limité

**Structure de la page compétition :** elle regroupe en une seule page (A-métadonnées, B-état de jeu, C-équipes, D-matchs du jour + actions) ce que le plan répartit en 4 onglets distincts. C'est une décision d'UX acceptable pour un admin minimaliste, mais cela devient illisible avec 48 équipes + 50 matchs sur une même page.

### Critique

L'admin actuel est pensé comme un **outil de débogage technique** (voir le style monospace, fond noir, labels en majuscules) plutôt qu'un vrai panneau de gestion produit. C'est fonctionnel pour un développeur, mais insuffisant pour une équipe produit/gestionnaire non technique — ce qui est pourtant l'objectif affiché du document.

---

## Point 10 — Implémentation technique (rappel)

### Ce que le plan dit
Table `game_config` (clé-valeur). Endpoints : `GET/PUT /api/admin/config`, `POST /api/admin/sync-fixtures`, `POST /api/admin/sync-results`, `PUT /api/admin/matches/:id`, `GET /api/admin/users`, `PUT /api/admin/users/:id/ban`, `POST /api/admin/users/:id/reset-portfolio`. Auth via `is_admin`.

### Ce qui existe réellement

**Bilan des endpoints admin :**

| Endpoint plan | Réalité |
|---|---|
| `GET /api/admin/config` | ❌ Absent |
| `PUT /api/admin/config` | ❌ Absent |
| `POST /api/admin/sync-fixtures` | ⚠️ Appelé via `/api/cron/sync-fixtures` avec CRON_SECRET (pas une route admin dédiée) |
| `POST /api/admin/sync-results` | ❌ Absent (pas de bouton "Sync Results" dans l'UI) |
| `PUT /api/admin/matches/:id` | ❌ Absent |
| `GET /api/admin/users` | ❌ Absent |
| `PUT /api/admin/users/:id/ban` | ❌ Absent |
| `POST /api/admin/users/:id/reset-portfolio` | ❌ Absent |
| `POST /api/admin/competitions` | ✅ Présent (non prévu dans le plan) |
| `POST /api/admin/competitions/[id]/toggle-active` | ✅ Présent (non prévu dans le plan) |
| `POST /api/admin/simulate-day` | ✅ Présent (non prévu dans le plan) |

---

## Synthèse Globale

### Taux d'implémentation par point

| Point | Implémenté | Évaluation |
|-------|-----------|------------|
| 1. Paramètres globaux (game_config) | 0% | ❌ Entièrement absent |
| 2. Gestion des équipes | 20% | ⚠️ Affichage seul, pas d'édition |
| 3. Gestion des compétitions | 80% | ✅ Bien implémenté |
| 4. Gestion des matchs (override) | 25% | ⚠️ Affichage partiel, actions limitées |
| 5. Gestion des utilisateurs | 0% | ❌ Entièrement absent |
| 6. Monitoring et logs | 10% | ❌ Données en DB mais pas d'UI |
| 7. Sauvegarde / restauration | 0% | ❌ Optionnel, dépend du Point 1 |
| 8. Sécurité | 60% | ⚠️ Protection pages OK, 1 faille, pas d'audit log |
| 9. Interface (7 onglets) | 15% | ⚠️ 1 onglet sur 7 |
| 10. Endpoints API admin | 30% | ⚠️ 3/11 endpoints présents |

### Ce qui a été bien fait (bonus non prévu)

| Fonctionnalité | Valeur |
|---|---|
| Protection admin via `app_metadata.role` | Plus sécurisé que `is_admin` en table |
| Page compétition avec 4 sections (méta, état, équipes, matchs) | Bonne vue d'ensemble |
| Bouton "Simulate Day" intégré à l'admin | Indispensable pour les tests WC2022 |
| `POST /api/admin/simulate-day` complet | Simule, liquide, distribue dividendes, avance la phase |
| Navigation direct app ↔ admin | Lien "← App" pratique |

### Manques critiques pour une mise en production

| Priorité | Manque | Impact |
|---|---|---|
| 🔴 Haute | Pas de `game_config` — paramètres hardcodés | Tout changement de règle = redéploiement |
| 🔴 Haute | Bug sécurité : `NEXT_PUBLIC_CRON_SECRET` exposé | Secret visible dans le bundle client |
| 🔴 Haute | Pas de gestion utilisateurs (ban, reset) | Impossible de modérer sans SQL direct |
| 🟠 Moyenne | Pas de "Sync Results" manuel | Si API down, pas de retrait de résultats réels |
| 🟠 Moyenne | Pas d'édition des équipes (`strength`, prix) | Ajustements = redéploiement |
| 🟠 Moyenne | Monitoring absent | Visibilité opérationnelle nulle |
| 🟡 Faible | Pas d'édition match (score override) | Cas exceptionnel mais important |
| 🟡 Faible | Pas de journalisation des actions admin | Utile mais non bloquant |

---

## Recommandations par ordre de priorité

### 1. 🔴 Corriger le bug sécurité immédiatement
`NEXT_PUBLIC_CRON_SECRET` dans `CompetitionActions.tsx` doit être supprimé. Créer une route intermédiaire `POST /api/admin/trigger-cron` côté serveur qui vérifie le rôle admin et appelle le cron avec le secret depuis une variable serveur (pas `NEXT_PUBLIC_`).

### 2. 🔴 Implémenter `game_config` (impact le plus élevé)
C'est le point le plus stratégique du document. Créer la table, seeder les valeurs actuelles hardcodées, et refactorer les fonctions pour lire depuis la DB. Prioriser les paramètres les plus susceptibles de changer : taxe, dividendes, `init_cash`. Les paramètres de simulation peuvent attendre.

### 3. 🔴 Ajouter le "Sync Results" manuel dans l'admin
Un seul bouton manquant dans `CompetitionActions` — effort minimal, valeur opérationnelle élevée (cas API Football down).

### 4. 🟠 Édition des équipes (strength + initial_price)
Transformer le tableau Section C en tableau éditable inline pour les colonnes `strength` et `initial_price`. C'est les deux colonnes avec le plus de valeur à éditer sans redéploiement.

### 5. 🟠 Monitoring minimal (2 lignes d'affichage)
Ajouter dans la Section B : `last_sync_at` + compteur de matchs `processed_at IS NULL`. Coût : 2 requêtes SQL supplémentaires + affichage. Gain : visibilité opérationnelle immédiate.

### 6. 🟠 Gestion utilisateurs (ban + reset portfolio)
Ajouter le champ `banned BOOLEAN DEFAULT FALSE` dans `profiles`, créer les routes `/api/admin/users` et `/api/admin/users/:id/ban` et `/api/admin/users/:id/reset-portfolio`.
