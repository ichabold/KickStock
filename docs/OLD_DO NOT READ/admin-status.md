# KickStock — Mode Admin : État des lieux & Next Steps

> Mis à jour : 2026-06-03

---

## 1. Architecture globale du mode admin

### Accès & auth
| Mécanisme | Détail |
|-----------|--------|
| Route protégée | `/admin/*` — middleware vérifie `user.app_metadata?.role === 'admin'` |
| Redirection | Non-connecté → `/login` · Connecté non-admin → 403 |
| API routes | Chaque route vérifie `user.app_metadata?.role !== 'admin'` côté serveur |
| Client admin | `createAdminClient()` avec `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS) |

### Pages existantes
| Page | URL | Rôle |
|------|-----|------|
| Dashboard | `/admin` | Tableau de toutes les compétitions (nom, saison, league_id, statut, phase, jour, champion) |
| Création | `/admin/competitions/new` | Formulaire : nom, saison, league_id, start/end date |
| Détail/gestion | `/admin/competitions/[id]` | 5 sections A-E (voir ci-dessous) |

### Sections de la page de détail
| Section | Contenu |
|---------|---------|
| **A — Métadonnées** | ID, nom, saison, league_id, dates + boutons d'actions |
| **B — État de jeu** | current_day_index, current_phase, advancing, champion, éliminés |
| **C — Équipes** | Tableau force / prix init / prix actuel / Δ% + édition inline |
| **D — Matchs** | Matchs du jour courant : score, statut API, processed_at |
| **E — Journées** | Calendrier competition_days : ajout / suppression |

---

## 2. Routes API admin existantes

### `/api/admin/competitions/*`
| Route | Méthode | Description |
|-------|---------|-------------|
| `/competitions` | POST | Créer une compétition + initialiser `competition_game_state` |
| `/competitions/[id]/import-teams` | POST | Importer les équipes depuis API-Football (league + saison) + seeder force FIFA + prix initial |
| `/competitions/[id]/teams/[team_id]` | PATCH | Modifier force / prix d'une équipe |
| `/competitions/[id]/sync` | POST | Proxy admin → cron : déclenche `sync-fixtures`, `sync-results` ou `sync-squads` |
| `/competitions/[id]/toggle-active` | POST | Basculer `is_active` |
| `/competitions/[id]/days` | POST | Ajouter une journée |
| `/competitions/[id]/days/[day_index]` | DELETE | Supprimer une journée |
| `/simulate-day` | POST | Simuler les résultats d'une journée (test uniquement) |

### `/api/cron/*` (protégées par `CRON_SECRET`)
| Route | Description |
|-------|-------------|
| `sync-fixtures` | Récupère les fixtures API-Football et peuple `matches` + `competition_days` |
| `sync-results` | Récupère les matchs terminés, met à jour scores, calcule dividendes, avance la phase |
| `sync-squads` | Récupère les compositions d'équipes |

---

## 3. Calls API-Football disponibles

| Fonction | Endpoint API-Football | Déclenché par |
|----------|-----------------------|---------------|
| `fetchAllFixtures` | `/fixtures?league={id}&season={s}` | cron sync-fixtures |
| `fetchFinishedFixtures` | `/fixtures?...&status=FT-AET-PEN` | cron sync-results |
| `fetchLiveFixtures` | `/fixtures?live=all` | — (non exposé admin) |
| `fetchTeamStrengths` | `/teams/rankings/fifa` | import-teams |
| `fetchSquad` | `/players/squads?team={id}` | cron sync-squads |
| `fetchFixtureEvents` | `/fixtures/events?fixture={id}` | après sync-results |

---

## 4. État de `CompetitionActions` (boutons actuels)

| Bouton | Route appelée | Statut |
|--------|---------------|--------|
| ACTIVER / DÉSACTIVER | `POST /api/admin/competitions/[id]/toggle-active` | ✅ OK |
| ↻ SYNC FIXTURES | ~~`POST /api/cron/sync-fixtures`~~ avec `NEXT_PUBLIC_CRON_SECRET` | ⚠️ SÉCURITÉ — secret exposé côté client |
| ⚡ SIMULATE DAY | `POST /api/admin/simulate-day` | ✅ OK |

**Boutons manquants :**
- ❌ Import Teams (appel API-Football teams)
- ❌ Sync Results
- ❌ Sync Squads
- ❌ Sync Fixtures passe par le mauvais endpoint (cron direct au lieu du proxy admin)

---

## 5. Bug de sécurité identifié

`CompetitionActions.tsx` (ligne 49) appelle directement `/api/cron/sync-fixtures` avec
`Authorization: Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET}`.

Problème : `NEXT_PUBLIC_*` est inclus dans le bundle client → `CRON_SECRET` visible dans le navigateur.

Le proxy `/api/admin/competitions/[id]/sync` a justement été créé pour éviter ça (le secret reste côté serveur) — il faut juste faire pointer le bouton vers lui.

---

## 6. Tables DB concernées

| Table | Alimentée par |
|-------|---------------|
| `competitions` | create competition |
| `competition_game_state` | create competition, simulate-day, sync-results |
| `teams` | import-teams |
| `competition_teams` | import-teams, team PATCH |
| `competition_days` | sync-fixtures, add/delete day |
| `matches` | sync-fixtures, sync-results |
| `competition_prices` | sync-results |
| `holdings`, `dividends` | sync-results |
| `portfolios` | sync-results |

---

## 7. Next Steps

### Priorité 1 — Boutons API (en cours)
- [x] Corriger le bouton Sync Fixtures pour passer par `/api/admin/competitions/[id]/sync` (proxy sécurisé)
- [x] Ajouter bouton **Import Teams** → `POST /api/admin/competitions/[id]/import-teams`
- [x] Ajouter bouton **Sync Results** → `/api/admin/competitions/[id]/sync` `{ type: 'results' }`
- [x] Ajouter bouton **Sync Squads** → `/api/admin/competitions/[id]/sync` `{ type: 'squads' }`

### Priorité 2 — Données manquantes dans l'UI
- [ ] Afficher le résultat détaillé de chaque sync (imported/skipped/unmapped teams, fixtures count, etc.)
- [ ] Section F : log des dernières actions (with timestamp)
- [ ] Afficher `last_sync_at` sur la competition (mettre à jour après chaque sync)

### Priorité 3 — Gestion des groups / phases
- [ ] Formulaire pour assigner `group_code` aux équipes (actuellement editable seulement via TeamEditor)
- [ ] Interface pour avancer manuellement la phase (forcer `current_phase`)
- [ ] Bouton "Reset competition" (remettre à zéro les prix et l'état)

### Priorité 4 — Monitoring
- [ ] Exposer un bouton **Live Fixtures** → `fetchLiveFixtures` (voir les matchs en cours en temps réel)
- [ ] Dashboard cron : horodatage des derniers syncs réussis / échoués

### Priorité 5 — Qualité
- [ ] Typer `createAdminClient()` correctement (supprimer les `as any`)
- [ ] Supprimer `NEXT_PUBLIC_CRON_SECRET` de `.env` (plus utilisé après la correction)
