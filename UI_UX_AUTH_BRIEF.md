# KickStock — UI/UX Brief : Authentification & Onboarding

## Décisions architecturales confirmées

| Question | Décision |
|---|---|
| Pseudo unique ? | **Non-unique.** Discriminateur court (`#a3f2`) affiché dans le leaderboard en cas de doublon uniquement. Aucune friction à l'onboarding. |
| Leaderboard visible aux invités ? | **Oui, sans filtre.** Les invités voient leur rang — motivation principale à créer un compte. |
| Prompt username post-Google ? | **Oui.** Après le premier login Google, un écran one-step demande un pseudo de jeu. Évite les `jean.dupont.92` dans le classement. |

---

## Principes directeurs

**Règle d'or : un invité doit pouvoir jouer en moins de 10 secondes.**

Le flux d'auth est minimal et non-bloquant. Chaque friction supplémentaire = perte de joueur. Le jeu se charge en arrière-plan pendant que l'utilisateur choisit son mode — la "promesse" du produit est visible immédiatement.

Design tokens : `--bg: #0A0A0A`, surfaces `--s1: #111111` / `--s2: #181818`, `--gold: #FFDB00`, `--gain: #00FF87`, `--loss: #FF3B5C`, `--muted: #888888`. Fonts : Bebas Neue (titres/labels), JetBrains Mono (chiffres), Inter Tight (corps). Animations modales : overlay `rgba(0,0,0,0.88)`, `fadeIn .15s + slideUp .2s`, border-radius `20px`.

---

## Layout de référence

| Shell | Déclenchement | Nav | Zone utilisateur |
|---|---|---|---|
| **BrowserShell** | `viewport ≥ 600px` | Sidebar gauche 72px fixe | `AuthWidget` en bas de sidebar |
| **MobileShell** | `viewport < 600px` | Bottom tab bar 64px fixe | `AuthWidget` compact en haut à droite du header |

---

## 1. Écran d'onboarding — Premier lancement

**Déclenchement** : pas de session Supabase **ET** pas de `localStorage.kickstock_pseudo`.

Le jeu se charge en arrière-plan, flouté (`filter: blur(4px) brightness(0.4)`). L'overlay est par-dessus, plein écran (`position: fixed, inset: 0, z-index: 500`).

---

### 1a. BrowserShell — Vue Desktop

Overlay centré, max-width `480px`, deux blocs verticaux séparés par un divider.

```
┌──────────────────────────────────────────────────────────┐
│                  [ jeu flouté derrière ]                 │
│                                                          │
│          ┌──────────────────────────────────┐            │
│          │          ⚽ KICKSTOCK            │            │
│          │    World Cup Trading Simulator   │            │
│          │                                  │            │
│          │  ┌────────────────────────────┐  │            │
│          │  │  CONTINUER EN INVITÉ       │  │            │
│          │  │                            │  │            │
│          │  │  [__ Ton pseudo _________] │  │            │
│          │  │                            │  │            │
│          │  │  ⚠ Progression sauvegardée │  │            │
│          │  │    sur ce navigateur       │  │            │
│          │  │    uniquement.             │  │            │
│          │  │                            │  │            │
│          │  │  [ JOUER MAINTENANT      ] │  │            │
│          │  └────────────────────────────┘  │            │
│          │                                  │            │
│          │  ─────────── ou ───────────      │            │
│          │                                  │            │
│          │  ┌────────────────────────────┐  │            │
│          │  │  CRÉER UN COMPTE           │  │            │
│          │  │                            │  │            │
│          │  │  [ G  Continuer avec Google]│  │            │
│          │  │  [ ✉  Email (bientôt)     ]│  │            │
│          │  │  [    Apple (bientôt)     ]│  │            │
│          │  │                            │  │            │
│          │  │  Déjà un compte ?  Login   │  │            │
│          │  └────────────────────────────┘  │            │
│          └──────────────────────────────────┘            │
└──────────────────────────────────────────────────────────┘
```

---

### 1b. MobileShell — Vue Mobile

Même overlay plein écran mais layout vertical optimisé pour le pouce. Pas de deux blocs côte à côte — tout s'empile. Les boutons font `min-height: 48px` pour les touch targets.

```
┌─────────────────────────┐  ← viewport 390px max
│                         │
│     ⚽ KICKSTOCK        │  ← Bebas Neue 22px gold, centré
│  World Cup Trading      │  ← Inter Tight 11px muted, centré
│                         │
│  ╔═══════════════════╗  │
│  ║ CONTINUER EN      ║  │  ← Surface #111, border #1E1E1E
│  ║ INVITÉ            ║  │     border-radius 16px, padding 16px
│  ║                   ║  │
│  ║ [_ Ton pseudo ___]║  │  ← Input full-width, focus: border gold
│  ║                   ║  │
│  ║ ⚠ Progression sur ║  │  ← 11px muted, icon ⚠ loss color
│  ║   ce navigateur   ║  │
│  ║   uniquement.     ║  │
│  ║                   ║  │
│  ║ [JOUER MAINTENANT]║  │  ← Bouton gold full-width, Bebas Neue 16px
│  ╚═══════════════════╝  │
│                         │
│  ─────── ou ────────    │  ← Divider centré
│                         │
│  ╔═══════════════════╗  │
│  ║ CRÉER UN COMPTE   ║  │
│  ║                   ║  │
│  ║ [G Avec Google  ] ║  │  ← Outline, full-width, 48px
│  ║ [✉ Email bientôt] ║  │  ← Opacity .4, cursor not-allowed
│  ║ [  Apple bientôt] ║  │  ← Opacity .4, cursor not-allowed
│  ║                   ║  │
│  ║  Déjà un compte ? ║  │  ← Link gold centré, 12px
│  ╚═══════════════════╝  │
│                         │
└─────────────────────────┘
```

**Différences mobile vs browser :**
- Pas de max-width sur les cartes — pleine largeur avec `margin: 0 16px`
- Logo plus petit (22px vs 28px)
- Scroll vertical si l'écran est trop petit (rare, mais à prévoir)
- Boutons full-width vs centrés sur desktop

---

### Comportements communs (desktop + mobile)

**Champ pseudo :**
- Auto-focus à l'arrivée sur desktop ; sur mobile, pas d'auto-focus (évite d'ouvrir le clavier sans action utilisateur)
- Validation : 3–20 chars, `[a-zA-Z0-9_-]` uniquement
- Erreur inline sous le champ, couleur `--loss`, apparaît au `blur` ou au submit
- Bouton "JOUER MAINTENANT" `disabled` + `opacity: .5` tant que pseudo invalide
- Submit sur Entrée (desktop) ou tap bouton (mobile)

**Boutons compte :**
- Google : actif en Phase 1
- Email : `opacity: .4`, `cursor: not-allowed`, tooltip/hover "Bientôt disponible"
- Apple : idem
- Ne pas les cacher — l'utilisateur sait ce qui arrive

**Message device — texte exact :**
> ⚠ Ta progression sera sauvegardée sur ce navigateur uniquement. Tu pourras créer un compte plus tard pour jouer sur tous tes appareils sans perdre ta progression.

Ce message **ne peut pas être supprimé** — il est central pour éviter les frustrations post-lancement.

---

## 2. Retour d'un invité (même device)

Pseudo trouvé dans localStorage → pas de modal, jeu chargé directement. Expérience identique à un compte enregistré.

---

## 3. Zone utilisateur — AuthWidget

### 3a. BrowserShell — Sidebar (desktop)

**État Guest :**
```
┌─────────────────────┐
│  ●  Z               │  ← Avatar 30px, fond gold, initiale noire Bebas
│     Zidane          │  ← Inter Tight 11px white
│     GUEST           │  ← Badge Bebas Neue 9px, muted #888
│  ↑ Créer un compte  │  ← Lien gold 10px, clic → panel inline
└─────────────────────┘
```

**État Registered :**
```
┌─────────────────────┐
│  ●  Z               │  ← Avatar 30px, fond gold
│     Zidane          │  ← Inter Tight 11px white
│     🏆 12,450 KC    │  ← Best score JetBrains Mono 10px gold
│  ⎋ Déconnexion      │  ← Discret, muted 9px
└─────────────────────┘
```

**Click sur "Créer un compte" (guest) — panel inline dans la sidebar :**

```
┌──────────────────────────────┐
│  Tu joues en invité          │  ← 12px muted
│  Pseudo : Zidane             │
│                              │
│  Crée un compte pour :       │
│  ✓ Jouer sur tous tes devices│  ← gain color, 11px
│  ✓ Progression sauvegardée   │
│  ✓ Classement protégé        │
│                              │
│  [ G  Continuer avec Google ]│  ← outline, full width
│  [ ✉  Email (bientôt)      ]│  ← disabled
│  [    Apple (bientôt)       ]│  ← disabled
│                              │
│  Ta progression sera migrée  │  ← 10px muted
│  automatiquement.            │
└──────────────────────────────┘
```

Fermé en cliquant ailleurs (click outside) ou en re-cliquant l'avatar.

---

### 3b. MobileShell — Header compact (mobile)

**État Guest :**
```
┌─────────────────────────────────────────┐
│ KICKSTOCK  CASH 10,000  TOTAL 10,000  Z │  ← Header
│                                     ↑  │
│                              avatar 26px│
└─────────────────────────────────────────┘
```
- Avatar 26px, fond gold, initiale
- Pas de label "GUEST" visible dans le header (trop petit)
- Pas de lien "Créer un compte" dans le header — accès via **tap sur l'avatar**

**Tap sur l'avatar (guest) → Bottom Sheet :**

Sur mobile, le panel ne peut pas être "inline dans le header". Il s'ouvre comme une **bottom sheet** (même pattern que TradeModal) :

```
┌─────────────────────────┐
│                         │
│    [ contenu du jeu ]   │
│                         │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  ← overlay rgba(0,0,0,0.88)
│  ╔═══════════════════╗  │
│  ║  ── ────────── ── ║  │  ← drag handle 32px
│  ║                   ║  │
│  ║  Zidane  GUEST    ║  │  ← nom + badge
│  ║                   ║  │
│  ║ Crée un compte :  ║  │
│  ║ ✓ Tous tes devices║  │
│  ║ ✓ Progression     ║  │
│  ║ ✓ Classement      ║  │
│  ║                   ║  │
│  ║ [G Avec Google  ] ║  │
│  ║ [✉ Email bientôt] ║  │
│  ║ [  Apple bientôt] ║  │
│  ║                   ║  │
│  ║ Progression migrée║  │  ← 10px muted
│  ║ automatiquement.  ║  │
│  ╚═══════════════════╝  │
└─────────────────────────┘
```

Fermé en swipant vers le bas ou en tappant l'overlay.

**État Registered (mobile header) :**
```
│ KICKSTOCK  CASH 10,000  TOTAL 10,000  Z │
│                                     ↑  │
│                              tap → logout confirm
```

Tap sur avatar → bottom sheet minimaliste :
```
║  Zidane             ║
║  🏆 Best: 12,450 KC ║
║                     ║
║ [ SE DÉCONNECTER ]  ║  ← bouton outline --loss
```

---

## 4. Flux migration Guest → Compte (Google)

### Étape 1 : OAuth Google déclenché
Clic "Continuer avec Google" → `supabase.auth.signInWithOAuth({ provider: 'google', redirectTo: '/auth/callback' })` → redirection externe.

### Étape 2 : Retour callback + confirmation

Après authentification, **confirmation de migration** affichée sur `/auth/callback` avant redirect vers `/` :

**Desktop (centré, même card que onboarding) :**
```
┌───────────────────────────┐
│  ✓ Compte créé            │  ← gain color, Bebas Neue 18px
│                           │
│  Ta progression migrée :  │  ← Inter Tight 13px muted
│  ● 10,234 KC en cash      │  ← JetBrains Mono, white
│  ● 3 positions actives    │
│  ● Best score : 15,600 KC │
│                           │
│  [ CONTINUER À JOUER ]    │  ← Gold, Bebas Neue
└───────────────────────────┘
```

**Mobile (bottom sheet, même pattern) :**
```
╔═══════════════════╗
║  ✓ Compte créé    ║
║                   ║
║  10,234 KC · 3 pos║
║  Best: 15,600 KC  ║
║                   ║
║ [CONTINUER À JOUER]║
╚═══════════════════╝
```

Auto-dismiss après 3s ou au clic.

### Étape 3 : Prompt username post-Google

Affiché immédiatement après la confirmation (ou à la place si pas de migration) :

**Desktop :**
```
┌───────────────────────────┐
│  Choisis ton pseudo       │  ← Bebas Neue 18px
│                           │
│  Visible dans le          │  ← 12px muted
│  classement               │
│                           │
│  [__ Pseudo ____________] │  ← Pre-filled avec nom Google
│                           │
│  [ CONFIRMER ]            │  ← Gold
└───────────────────────────┘
```

**Mobile :**
```
╔═══════════════════╗
║  Choisis ton pseudo║
║                   ║
║ [__ Pseudo ______]║  ← Pre-fill nom Google, 48px input
║                   ║
║  [ CONFIRMER ]    ║
╚═══════════════════╝
```

Pré-rempli avec le nom Google (modifiable). Validation identique au pseudo invité.

### Cas d'erreur : conflit de progression

Si l'utilisateur Google a déjà un portfolio avec progression sur un autre device :

**Desktop + Mobile (même contenu, layout adapté) :**
```
┌─────────────────────────────────┐
│  ⚠ Deux progressions trouvées   │  ← --upset orange, Bebas 16px
│                                 │
│  Compte Google :                │  ← section #111, border #2E2E2E
│  12,000 KC · Best 18,000 KC     │  ← JetBrains Mono
│                                 │
│  Ce device (Invité) :           │  ← section #111
│  8,500 KC · Best 9,200 KC       │
│                                 │
│  [ GARDER LE COMPTE GOOGLE ]    │  ← Gold, recommandé
│  [ GARDER CE DEVICE ]           │  ← Outline --loss
│                                 │
│  L'autre progression sera       │  ← 11px --loss
│  définitivement perdue.         │
└─────────────────────────────────┘
```

---

## 5. Leaderboard — Affichage invités

### Desktop (tableau existant, ajout badge)

```
┌────┬─────────────────────┬────────────┐
│ #  │ Joueur              │ Score      │
├────┼─────────────────────┼────────────┤
│ 1  │ ● MbappeFan  GUEST  │ 24,500 KC  │
│    │              #a3f2  │            │  ← badge + disc. si doublon
├────┼─────────────────────┼────────────┤
│ 2  │ ● Zidane            │ 18,200 KC  │  ← registered, pas de badge
└────┴─────────────────────┴────────────┘
```

- Badge `GUEST` : Bebas Neue 8px, `--muted` #888, fond transparent
- Discriminateur `#a3f2` : affiché uniquement si collision de pseudo
- Avatar : identique pour registered et guest (initiale sur fond gold)

### Mobile (liste scrollable, même structure)

```
┌─────────────────────────────┐
│  # 1  ●  MbappeFan  GUEST   │  ← compact row, 44px height
│         24,500 KC    #a3f2  │
├─────────────────────────────┤
│  # 2  ●  Zidane             │
│         18,200 KC           │
└─────────────────────────────┘
```

Badge `GUEST` en inline après le pseudo, même style. Discriminateur sur la ligne de score si peu de place.

---

## 6. États & edge cases

| Situation | Comportement |
|---|---|
| Pseudo vide au submit | Validation inline, bouton disabled |
| Pseudo format invalide | Erreur sous champ `--loss`, message clair |
| Réseau indisponible | Toast erreur haut de page, retry possible sans fermer modal |
| Google OAuth échoue | Toast erreur "Connexion Google échouée", retour à l'onboarding |
| Migration réussie | Confirmation screen → prompt pseudo → jeu |
| Migration avec conflit | UI de choix (§4, cas d'erreur) |
| Invité, nouveau device | Modal d'onboarding à nouveau, portfolio vide (normal, documenté dans l'UI) |
| localStorage effacé | Idem nouveau device — justifie explicitement la création de compte |
| Registered user, pas encore username | Prompt pseudo post-login (§4, étape 3) |
| Registered user tap avatar (mobile) | Bottom sheet avec best score + déconnexion |

---

## 7. Critique de la feuille de route

### Ce qui tient ✓
- Supabase Google OAuth est natif, peu de configuration côté code
- La RPC `get_or_create_portfolio` existante gère déjà le lien device→user
- La séparation Guest Phase 1 / Gmail Phase 2 / Email Phase 3 / Apple Phase 4 est sage
- Apple Developer ($99/an, process lent) = bonne idée de repousser en Phase 4
- La migration de progression sans perte est le point UX le plus différenciant

### Points à ne pas sous-estimer ✗

**1. Bottom sheet mobile = nouveau composant**
Il n'y a pas de bottom sheet générique dans le projet actuellement. Le panel "upgrade guest" sur mobile nécessite ce composant. Il sera aussi réutilisable pour d'autres flows (confirmation déconnexion, etc.) — vaut la peine de le faire proprement dès Sprint 1.

**2. Google OAuth + domaine production**
Le callback URL doit être configuré dans Google Cloud Console avant tout deploy. En dev `http://localhost:3000` fonctionne, mais prévoir le domaine prod dès la config initiale pour ne pas être bloqué.

**3. Username post-Google = étape souvent négligée**
Les projets qui ne l'implémentent pas se retrouvent avec des usernames `jean.dupont.92` en prod. L'écran est simple mais il faut l'anticiper dans le Sprint 2 dès le début, pas comme un hotfix.

**4. Conflit de progression = rare mais coûteux si absent**
Ce cas arrive quand quelqu'un joue en guest sur un device, crée un compte Google depuis un autre device, puis revient sur le premier. L'UI de résolution du conflit est importante pour la confiance utilisateur.

**5. Risque de scope creep**
La tentation sera d'implémenter email/Apple "tant qu'on est dedans". Résister. Google + Guest = sprint complet. Email/Apple = sprints séparés.

---

## 8. Ordre d'implémentation

### Sprint 1 — Guest (maintenant)
1. Migration SQL 006 : `guest_username` sur `portfolios` + vue `leaderboard` + discriminateur
2. `POST /api/auth/guest` — valide + upsert pseudo
3. `GuestModal` component — onboarding (desktop + mobile responsive)
4. `BottomSheet` component générique — réutilisable (mobile uniquement)
5. Update `AuthWidget` — badge GUEST + lien/tap upgrade
6. Panel upgrade (desktop inline, mobile bottom sheet)
7. Update `useLeaderboard` — vue SQL + badge guest + discriminateur

### Sprint 2 — Google OAuth
1. Config Supabase + Google Cloud Console (préparation manuelle)
2. `/app/auth/callback/route.ts`
3. RPC `migrate_guest_to_user` + gestion conflit
4. `GoogleSignInButton` component
5. Écran confirmation migration
6. UI conflit de progression
7. Prompt username post-Google

### Sprint 3 — Email/Password
1. Config Resend (SMTP custom Supabase)
2. Update page `/register`
3. Email templates (vérification, reset password)
4. Écran "Check your inbox"
5. Reset password flow

### Sprint 4 — Apple Sign-In
1. Apple Developer account
2. Config Supabase Apple provider
3. Bouton Apple Sign-In (desktop + mobile)
