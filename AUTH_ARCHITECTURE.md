# KickStock — Auth Architecture

## État actuel (baseline)

Le projet dispose déjà de :
- **Supabase Auth** (email/pwd) + middleware de session
- **`device_id`** UUID généré dans localStorage (`lib/device.ts`)
- **Table `portfolios`** avec colonnes `user_id` (nullable) ET `device_id` (nullable), contrainte : au moins l'un des deux non-null
- **RPC `get_or_create_portfolio(deviceId, userId)`** qui lie déjà un portfolio device à un user_id au signup
- **Table `profiles`** liée à `auth.users`

Le guest mode "silencieux" est déjà fonctionnel. Il manque : le pseudo invité, Google OAuth, et l'upgrade flow.

---

## Types d'utilisateurs

### 1. Utilisateur Invité (Guest)
- Identifié uniquement par `device_id` (localStorage)
- **Pseudo obligatoire** saisi au premier lancement → stocké en DB + localStorage
- Progression stockée dans `portfolios` via `device_id`
- Visible dans le leaderboard (badge « Guest »)
- Peut upgrade vers compte complet sans perdre sa progression

### 2. Utilisateur Enregistré — Google (Phase 1)
- Authentifié via Supabase Google OAuth
- Portfolio lié via `user_id` (auth.users)
- Cross-device : même compte, même progression
- Leaderboard : username sans badge

### 3. Utilisateur Enregistré — Email/Password (Phase 2, plus tard)
- Signup avec Resend pour vérification email
- Même modèle que Google après vérification

### 4. Utilisateur Enregistré — Apple (Phase 3, plus tard)
- Apple Sign-In via Supabase OAuth

---

## Architecture technique

### A. Base de données — Changements requis

#### Migration 006 : guest_username + leaderboard

```sql
-- Ajouter le pseudo invité sur portfolios
ALTER TABLE portfolios ADD COLUMN guest_username TEXT;

-- Vue leaderboard unifiée (registered + guest)
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  p.id,
  COALESCE(pr.username, p.guest_username) AS display_name,
  CASE WHEN p.user_id IS NOT NULL THEN 'registered' ELSE 'guest' END AS user_type,
  p.best_score,
  p.device_id,
  p.user_id
FROM portfolios p
LEFT JOIN profiles pr ON pr.id = p.user_id
WHERE p.best_score IS NOT NULL
ORDER BY p.best_score DESC;
```

#### Mise à jour RPC `get_or_create_portfolio`
Ajouter paramètre `guest_username TEXT DEFAULT NULL` → utilisé uniquement à la création d'un portfolio invité.

#### Nouvelle RPC `migrate_guest_to_user(device_id, user_id)`
Appelée après un signup/login Google quand un device_id portfolio existe déjà :
```sql
-- Attache le portfolio device_id existant au user_id
-- Crée un profiles row si inexistant
-- Nullifie device_id (ou garde les deux pour backward compat)
```

---

### B. Flux utilisateur

#### Flux 1 : Première visite (Guest)
```
Arrivée sur /  →  Pas de session Supabase, pas de pseudo en localStorage
  ↓
Modal "Choisis ton pseudo" (bloque le jeu)
  ↓
Saisie pseudo  →  POST /api/auth/guest  { pseudo, deviceId }
  ↓
Upsert portfolios SET guest_username = pseudo WHERE device_id = ?
  ↓
Stocke pseudo dans localStorage  →  Ferme modal  →  Lance le jeu
```

#### Flux 2 : Retour d'un invité (même device)
```
Arrivée sur /  →  pseudo trouvé dans localStorage
  ↓
Pas de modal  →  Lance le jeu directement
```

#### Flux 3 : Upgrade Guest → Google
```
Banner/bouton "Créer un compte" visible pour les guests
  ↓
Click  →  supabase.auth.signInWithOAuth({ provider: 'google' })
  ↓
Callback /auth/callback  →  Supabase crée auth.users row
  ↓
Trigger on_auth_user_created crée profiles row
  ↓
Appel RPC migrate_guest_to_user(deviceId, userId)
  →  Portfolio device_id lié au user_id
  →  Progression préservée (cash, holdings, best_score, etc.)
  ↓
Redirect vers /  →  Jeu continue avec compte complet
```

#### Flux 4 : Login Google (compte existant)
```
Click "Se connecter avec Google"
  ↓
supabase.auth.signInWithOAuth({ provider: 'google' })
  ↓
Callback /auth/callback
  ↓
Si device_id a un portfolio orphelin → migrate_guest_to_user()
Sinon → get_or_create_portfolio(null, userId)
  ↓
Redirect vers /
```

---

### C. Frontend — Composants à créer

#### `/app/(auth)/callback/route.ts` (OAuth callback)
Route GET qui échange le code Supabase et redirige vers `/`.
Appelée par Google après l'auth. Doit aussi déclencher la migration si device_id présent.

#### `components/auth/GuestModal.tsx`
- S'affiche uniquement si : pas de session Supabase ET pas de `localStorage.kickstock_pseudo`
- Bloque l'accès au jeu (overlay plein écran)
- Validation : pseudo 3–20 chars, alphanumérique + tirets
- Appelle `POST /api/auth/guest`

#### `components/auth/UpgradeBanner.tsx`
- Affiché dans la navbar pour les users invités connectés
- "Joue sur tous tes appareils — Crée un compte"
- Bouton Google Sign-In
- Dismissable (localStorage flag) mais revient après X jours

#### `components/auth/GoogleSignInButton.tsx`
- Wrapper autour de `supabase.auth.signInWithOAuth`
- Gère loading state + erreurs

---

### D. API Routes

#### `POST /api/auth/guest`
```typescript
// Body: { pseudo: string, deviceId: string }
// Valide le pseudo (format, unicité suggérée mais non bloquante)
// Upsert portfolios.guest_username
// Return: { ok: true }
```

#### `GET /api/auth/callback` → `/app/auth/callback/route.ts`
```typescript
// Exchange code Supabase
// Récupère deviceId depuis cookie temporaire ou query param
// Appelle migrate_guest_to_user si portfolio device existe
// Redirect vers /
```

---

### E. Leaderboard — Mise à jour

Le hook `useLeaderboard.ts` existant doit :
1. Utiliser la vue `leaderboard` (remplace la query actuelle)
2. Afficher `user_type` pour badge visuel
3. Mettre en évidence le joueur courant (par `device_id` ou `user_id`)

---

## Étapes de préparation (ce que tu dois faire)

### Supabase Dashboard
1. **Activer Google OAuth** :
   - Dashboard → Authentication → Providers → Google → Enable
   - Renseigner Client ID + Client Secret (depuis Google Cloud Console)
   - Ajouter URL de callback : `https://[ton-projet].supabase.co/auth/v1/callback`

2. **Google Cloud Console** :
   - Créer un projet OAuth 2.0
   - Authorized redirect URIs : URL Supabase ci-dessus
   - Télécharger Client ID + Secret → coller dans Supabase

3. **Variables d'environnement** : aucune nouvelle var requise (Supabase gère Google OAuth côté serveur)

### Local / Next.js
4. Ajouter dans `.env.local` :
   ```
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```
   (utilisé pour le redirect OAuth)

### Base de données
5. Rédiger et exécuter la **migration 006** (guest_username + vue leaderboard + RPC migrate)

### Code
6. Créer le callback OAuth route
7. Créer le GuestModal
8. Créer le GoogleSignInButton + UpgradeBanner
9. Mettre à jour useLeaderboard
10. Adapter le middleware (autoriser `/auth/callback` sans redirect)

---

## Ce qu'on NE touche PAS (déjà fonctionnel)

- `lib/device.ts` — génération device_id OK
- `get_or_create_portfolio` RPC — juste extension avec paramètre guest_username
- Headers `X-Device-ID` sur les API calls — OK
- Table `portfolios` — juste ajout de colonne, pas de rupture
- Trigger `on_auth_user_created` — OK pour Google OAuth (Supabase le déclenche aussi)

---

## Phase 2 (plus tard) : Email/Password avec Resend

- Modifier la page `/register` pour envoyer un email de vérification via Resend
- Configurer Supabase SMTP custom (Settings → Auth → SMTP)
- Resend : créer un compte, obtenir une API key, configurer domaine
- Template email custom (HTML) dans Supabase ou via webhook

## Phase 3 (plus tard) : Apple Sign-In

- Requiert un compte Apple Developer (99$/an)
- Configurer dans Supabase → Providers → Apple
- Plus complexe (clé privée `.p8`, Team ID, Service ID)
