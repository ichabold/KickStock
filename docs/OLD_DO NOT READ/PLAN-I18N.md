# Plan — Internationalisation (i18n) KickStock

## Contexte

L'app est actuellement 100 % hardcodée en français avec quelques fragments anglais non intentionnels (TradeModal, BottomNav). Objectif : supporter **Français (fr)** et **Anglais (en)**, en détectant automatiquement la langue du navigateur, fallback anglais. Architecture pensée dès le départ pour la migration iOS/Android.

---

## 1. Où vivent les traductions ?

### Décision : fichiers JSON dans un package partagé du monorepo

```
packages/
└── i18n/
    ├── package.json         ← "@kickstock/i18n"
    ├── index.ts             ← re-exports des locales + types
    └── locales/
        ├── en.json          ← source de vérité EN
        └── fr.json          ← source de vérité FR
```

**Pourquoi pas une table en base de données ?**

| Critère | DB (Supabase) | Fichiers JSON (package) |
|---|---|---|
| Latence au chargement | requête réseau à chaque boot | bundlé, instantané |
| Offline / app native | ❌ nécessite connexion | ✅ embarqué dans le bundle |
| Portabilité iOS/Android | API call complexe | `import fr from '@kickstock/i18n/locales/fr.json'` |
| Typage TypeScript | manuel | auto-généré depuis les fichiers |
| Déploiement | changement DB = migration | changement de code = PR classique |
| Complexité | haute (auth, cache, fallback) | nulle |

La DB pour les traductions n'est utile que si on a des traducteurs externes sans accès au code (ex: équipe de 50 langues sur Crowdin). Pour 2 langues gérées par les devs, c'est une fausse bonne idée.

**Portabilité mobile :**
- `packages/i18n` est importé par `apps/web` aujourd'hui avec `next-intl`
- Demain, `apps/mobile` (React Native / Expo) importera les **mêmes fichiers JSON** avec `react-i18next`
- Un seul endroit à modifier pour une correction ou l'ajout d'une langue

---

## 2. Choix des librairies

### Web : `next-intl`
Lit les fichiers depuis `@kickstock/i18n` via `getRequestConfig`. Conçu pour Next.js App Router avec support Server Components natif.

### Mobile (futur) : `react-i18next` + `i18next`
Consomme les mêmes JSON. Zéro duplication de traductions.

| Critère | `next-intl` (web) | `react-i18next` (mobile) |
|---|---|---|
| Source des traductions | `@kickstock/i18n` ← | `@kickstock/i18n` ← (même fichiers) |
| Server Components Next.js | ✅ | N/A |
| React Native | ❌ | ✅ |
| API similaire (`t('key')`) | ✅ | ✅ |

---

## 3. Stratégie de détection de langue

```
Request → Middleware (web)
  ├─ Cookie `NEXT_LOCALE` présent ? → utiliser cette valeur
  ├─ Header `Accept-Language` → parser et matcher (fr, en)
  └─ Fallback → "en"

App Native (futur)
  ├─ expo-localization → getLocales()[0].languageTag
  ├─ Matcher sur (fr, en)
  └─ Fallback → "en"
```

- **Langues supportées :** `en`, `fr`
- **Fallback :** `en`
- **Persistance web :** cookie `NEXT_LOCALE` (1 an)
- **Pas de préfixe URL** (`/fr/...`) — la langue est transparente, transmise par cookie

---

## 4. Structure complète du monorepo

```
packages/
└── i18n/                          ← NOUVEAU PACKAGE
    ├── package.json               ("@kickstock/i18n")
    ├── index.ts                   (exports: locales, supportedLocales, defaultLocale)
    └── locales/
        ├── en.json
        └── fr.json

apps/web/
├── lib/
│   └── i18n.ts                    ← config next-intl (getRequestConfig)
├── middleware.ts                  ← détection langue + cookie (modifié)
├── app/
│   └── layout.tsx                 ← NextIntlClientProvider wrapper
└── components/
    └── shared/
        └── AuthWidget.tsx         ← LanguageSwitcher intégré dans le menu
```

---

## 5. Architecture des clés de traduction

Organisation par domaine fonctionnel. Clés en camelCase, namespaces en camelCase.

```json
{
  "common": {
    "loading": "Loading…",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "back": "← Back",
    "next": "Next →",
    "ok": "OK",
    "or": "or",
    "comingSoon": "SOON",
    "redirecting": "Redirecting…",
    "networkError": "Network error, please retry."
  },
  "auth": {
    "login": {
      "title": "LOGIN",
      "emailLabel": "EMAIL",
      "passwordLabel": "PASSWORD",
      "submitButton": "LOG IN →",
      "loadingButton": "LOGGING IN…",
      "noAccount": "No account yet?",
      "createAccount": "CREATE AN ACCOUNT",
      "continueGuest": "Continue without account →",
      "emailPlaceholder": "player@email.com"
    },
    "register": {
      "title": "CREATE AN ACCOUNT",
      "pseudoLabel": "USERNAME *",
      "emailLabel": "EMAIL *",
      "passwordLabel": "PASSWORD *",
      "countryLabel": "COUNTRY (optional)",
      "pseudoHint": "3–20 characters, no spaces",
      "passwordHint": "Min. 8 characters",
      "countryHint": "For country leaderboard",
      "submitButton": "JOIN THE GAME →",
      "loadingButton": "CREATING…",
      "alreadyAccount": "Already have an account?",
      "signIn": "LOG IN",
      "pseudoTooShort": "Username must be at least 3 characters"
    },
    "guest": {
      "title": "CHOOSE YOUR USERNAME",
      "placeholder": "Your username (3–20 characters)",
      "submitButton": "PLAY NOW",
      "loadingButton": "LOADING…",
      "validationError": "3 to 20 characters, letters, numbers, _ and - only.",
      "alreadyTaken": "Username already taken.",
      "useSuggestion": "Use \"{suggestion}\"",
      "turnstileError": "Verification in progress, retry in a moment.",
      "alreadyAccount": "Already have an account?",
      "signIn": "LOG IN",
      "continueGoogle": "Continue with Google",
      "createEmailAccount": "Create an account with email",
      "turnstileNotice": "This site is protected by Cloudflare Turnstile.",
      "privacyPolicy": "Privacy Policy"
    },
    "emailModal": {
      "loginTab": "LOGIN",
      "registerTab": "REGISTER",
      "wrongCredentials": "Incorrect email or password.",
      "loginError": "Login error. Please retry.",
      "forgotPassword": "Forgot password?",
      "forgotPasswordTitle": "FORGOT PASSWORD",
      "forgotPasswordSubtitle": "Enter your email and we'll send you a reset link.",
      "sendLinkButton": "SEND LINK →",
      "sendingButton": "SENDING…",
      "backToLogin": "← Back to login",
      "invalidPseudo": "Invalid username (3-20 characters, letters/numbers/_-).",
      "passwordTooShort": "Password must be at least 8 characters.",
      "emailAlreadyUsed": "This email is already in use. Log in or use \"Forgot password\".",
      "confirmationAlreadySent": "A confirmation email was already sent. Check your inbox.",
      "registerError": "Registration error. Please retry.",
      "pseudoTaken": "Username already taken.",
      "checkEmailTitle": "CHECK YOUR EMAIL",
      "checkEmailSubtitle": "We sent you a confirmation link. Click it to activate your account.",
      "emailSentTitle": "EMAIL SENT",
      "emailSentSubtitle": "Check your inbox and click the link to reset your password.",
      "loginButton": "LOG IN →",
      "registerButton": "CREATE MY ACCOUNT →",
      "googleError": "Google login failed. Please retry.",
      "pseudoPlaceholder": "Your username (3-20 chars.)",
      "passwordPlaceholder": "8 characters minimum"
    },
    "welcome": {
      "accountCreatedTitle": "ACCOUNT CREATED",
      "accountCreatedSubtitle": "Your progress and username have been migrated",
      "totalValue": "Total value",
      "positions": "Positions",
      "bestScore": "Best score",
      "continueButton": "CONTINUE →",
      "choosePseudoTitle": "CHOOSE YOUR USERNAME",
      "choosePseudoSubtitle": "Visible in the leaderboard",
      "pseudoPlaceholder": "Your username",
      "pseudoInfo": "This username will appear in the public leaderboard.",
      "confirmButton": "CONFIRM →",
      "savingButton": "SAVING…",
      "pseudoTaken": "This username is already taken."
    },
    "resetPassword": {
      "title": "NEW PASSWORD",
      "subtitle": "Choose a new password for your account.",
      "newPasswordLabel": "New password",
      "confirmLabel": "Confirm",
      "newPasswordPlaceholder": "8 characters minimum",
      "confirmPlaceholder": "Same password",
      "tooShort": "Password must be at least 8 characters.",
      "mismatch": "Passwords do not match.",
      "updateError": "Error updating password. Please retry.",
      "confirmButton": "CONFIRM →",
      "savingButton": "SAVING…",
      "successTitle": "PASSWORD CHANGED",
      "successSubtitle": "You will be redirected…"
    }
  },
  "nav": {
    "market": "Market",
    "fixtures": "Fixtures",
    "portfolio": "Portfolio",
    "table": "Table"
  },
  "shell": {
    "cash": "CASH",
    "total": "TOTAL",
    "tournamentEndedChampion": "🏆 END · {champion}",
    "tournamentEnded": "🏆 TOURNAMENT ENDED"
  },
  "market": {
    "onboardingTitle": "Welcome to KickStock ⚽",
    "onboardingText": "You start with 10,000 KC. Buy shares in the nations you think are strongest — their price rises when they win.",
    "searchPlaceholder": "Search…",
    "sortDefault": "DEFAULT",
    "sortPriceDesc": "PRICE ▼",
    "sortPriceAsc": "PRICE ▲",
    "sortPerf": "PERF %",
    "sortPortfolio": "PORTFOLIO"
  },
  "portfolio": {
    "totalValue": "TOTAL VALUE",
    "cash": "CASH",
    "invested": "INVESTED",
    "pnl": "P&L",
    "bestScore": "🏆 BEST SCORE: {score} KC",
    "eliminatedNotice": "💀 Eliminated nations — automatic liquidation",
    "emptyIcon": "📊",
    "emptyTitle": "Empty portfolio",
    "emptyHint": "Buy shares in the MARKET tab"
  },
  "simulate": {
    "tournamentEndedTitle": "TOURNAMENT ENDED",
    "newGameButton": "NEW GAME",
    "dividendsReceived": "🎁 DIVIDENDS RECEIVED",
    "viewSchedule": "VIEW SCHEDULE →",
    "exposure": "⚡ EXPOSURE",
    "vs": "VS",
    "venue": "📍 {venue}",
    "koUpcoming": "KO phase — upcoming matches",
    "simulateButton": "⚡ SIMULATE THIS DAY",
    "eliminated": "💀 {nation} ELIMINATED",
    "upset": "🚀 UPSET!"
  },
  "schedule": {
    "played": "✓ PLAYED",
    "next": "NEXT"
  },
  "standings": {
    "groupStandings": "GROUP STANDINGS",
    "r32": "ROUND OF 32",
    "r16": "ROUND OF 16",
    "quarterFinals": "QUARTER-FINALS",
    "semiFinals": "SEMI-FINALS",
    "final": "🏆 FINAL",
    "thirdPlace": "🥉 THIRD PLACE",
    "champion": "{nation} — CHAMPION 🏆"
  },
  "trade": {
    "subtitle": "Group {group} · {held} shares held",
    "eliminated": "Eliminated — buys disabled",
    "buy": "BUY",
    "sell": "SELL",
    "pricePerShare": "Price per share",
    "quantity": "Quantity",
    "taxFive": "Tax (5%)",
    "taxTen": "Tax (10%)",
    "concentration": "Concentration after trade",
    "youllPay": "You'll pay",
    "youllReceive": "You'll receive",
    "max": "MAX {max}",
    "close": "Close"
  },
  "simulateButton": {
    "simulate": "⚡ SIMULATE — {label}",
    "newGame": "🔄 NEW GAME",
    "loading": "⏳ IN PROGRESS…"
  },
  "tutorial": {
    "step1Title": "Welcome to KickStock!",
    "step1Text": "Invest in national teams like stocks. The better a team performs, the higher its price goes.",
    "step2Title": "Price movements",
    "step2Text": "A win raises the price. A loss drops it. The winner absorbs 40% of the loser's value.",
    "step3Title": "Dividends & Taxes",
    "step3Text": "When your team qualifies (R32, R16, QF, SF, Final, Champion), you receive KC dividends. Tax (10% groups, 5% KO) applies only on sales.",
    "step4Title": "Market lock",
    "step4Text": "The market is frozen 15 min before and 30 min after each match. Plan your trades in advance!",
    "back": "← BACK",
    "next": "NEXT →",
    "start": "START ✓"
  },
  "coachMark": {
    "browser": {
      "rule1Label": "RULE 1 · 4",
      "rule1Text": "Each card = a national team. It wins → price goes up. It loses → the winner absorbs 40% of its value.",
      "rule2Label": "RULE 2 · 4",
      "rule2Text": "When one of your teams qualifies (R32, R16, QF, SF, Final), a dividend automatically lands in your cash.",
      "rule3Label": "RULE 3 · 4",
      "rule3Text": "The market freezes 15 min before each match. This button simulates the day — make your trades before it disappears.",
      "rule4Label": "RULE 4 · 4 — LAST",
      "rule4Text": "Buying is free. Selling costs 10% (groups) or 5% (KO). That's it — pick a team and make your first trade!"
    },
    "mobile": {
      "rule1Label": "RULE 1 · 4",
      "rule1Text": "Each card = a national team. It wins → price ▲. It loses → the winner absorbs 40% of its value.",
      "rule2Label": "RULE 2 · 4",
      "rule2Text": "When a team you hold qualifies (R32, R16, QF…), a dividend automatically lands in your cash.",
      "rule3Label": "RULE 3 · 4",
      "rule3Text": "The market freezes before each match. This button launches the day — trade first to catch the price movements.",
      "rule4Label": "RULE 4 · 4 — LAST",
      "rule4Text": "Buying is free. Selling costs 10% (groups) or 5% (KO). Now → pick a team and get started!"
    }
  },
  "matchDetail": {
    "scorers": "⚽ SCORERS",
    "aet": "AET",
    "penalties": "PENS {penA}–{penB}",
    "draw": "DRAW",
    "upset": "🚀 UPSET!"
  },
  "nationDetail": {
    "initialPrice": "Start"
  },
  "ticker": {
    "ariaLabel": "Live prices"
  },
  "authWidget": {
    "guest": "GUEST",
    "loginCompact": "⚽ LOGIN",
    "changePseudo": "✏️ Change username",
    "restartGame": "🔄 Restart game",
    "logout": "Log out",
    "changePseudoTitle": "CHANGE USERNAME",
    "currentPseudo": "Current: {pseudo}",
    "newPseudoPlaceholder": "New username",
    "pseudoTaken": "This username is already taken.",
    "pseudoUpdated": "✓ Username updated!",
    "restartTitle": "RESTART?",
    "restartText": "You will lose all your current progress: cash, positions, history. This action is irreversible.",
    "restartConfirm": "YES, RESTART",
    "cancelButton": "Cancel",
    "playOnAllDevices": "Play on all your devices",
    "progressSaved": "Progress saved",
    "leaderboardProtected": "Leaderboard protected",
    "emailPassword": "Email / Password",
    "continueGoogle": "Continue with Google",
    "migrationNote": "Your progress will be migrated automatically.",
    "language": "Language",
    "languageFr": "🇫🇷 Français",
    "languageEn": "🇬🇧 English"
  }
}
```

---

## 6. Sélecteur de langue

Intégré dans le **menu de l'AuthWidget** (derrière l'avatar/pseudo), pas dans le header.

```
Menu avatar
├── ✏️ Change username
├── 🌐 Language
│   ├── 🇫🇷 Français  ← radio / checkmark actif
│   └── 🇬🇧 English
├── 🔄 Restart game
└── Log out
```

- Change le cookie `NEXT_LOCALE` et appelle `router.refresh()`
- Sous-menu ou inline radio dans le dropdown existant
- Aucun élément ajouté dans le header

---

## 7. Fichiers à créer / modifier

### Phase A — Package i18n + infrastructure web

| Fichier | Action |
|---|---|
| `packages/i18n/package.json` | Créer le package `@kickstock/i18n` |
| `packages/i18n/locales/en.json` | Créer toutes les clés EN |
| `packages/i18n/locales/fr.json` | Créer toutes les clés FR |
| `packages/i18n/index.ts` | Exporter locales + `supportedLocales` + `defaultLocale` |
| `packages/tsconfig/base.json` | Vérifier que le package est inclus |
| `apps/web/package.json` | `pnpm add next-intl` + dépendance `@kickstock/i18n` |
| `apps/web/lib/i18n.ts` | `getRequestConfig` qui importe depuis `@kickstock/i18n` |
| `apps/web/middleware.ts` | Ajouter détection langue `Accept-Language` + cookie |
| `apps/web/app/layout.tsx` | Wrapper `NextIntlClientProvider` |

### Phase B — Composants partagés

| Fichier | Changement |
|---|---|
| `components/shared/TradeModal.tsx` | `useTranslations('trade')` |
| `components/shared/AuthWidget.tsx` | `useTranslations('authWidget')` + sous-menu langue |
| `components/shared/TutorialOverlay.tsx` | `useTranslations('tutorial')` |
| `components/shared/CoachMarkOverlay.tsx` | `useTranslations('coachMark')` |
| `components/shared/NationDetailOverlay.tsx` | `useTranslations('nationDetail')` |
| `components/shared/MatchDetailOverlay.tsx` | `useTranslations('matchDetail')` |

### Phase C — Auth

| Fichier | Changement |
|---|---|
| `app/(auth)/login/page.tsx` | `useTranslations('auth.login')` |
| `app/(auth)/register/page.tsx` | `useTranslations('auth.register')` |
| `app/auth/reset-password/page.tsx` | `useTranslations('auth.resetPassword')` |
| `components/auth/GuestModal.tsx` | `useTranslations('auth.guest')` |
| `components/auth/EmailAuthModal.tsx` | `useTranslations('auth.emailModal')` |
| `components/auth/WelcomeModal.tsx` | `useTranslations('auth.welcome')` |

### Phase D — Tabs mobiles + shell

| Fichier | Changement |
|---|---|
| `components/mobile/MobileShell.tsx` | `useTranslations('shell')` |
| `components/mobile/BottomNav.tsx` | `useTranslations('nav')` |
| `components/mobile/MarketTab.tsx` | `useTranslations('market')` |
| `components/mobile/PortfolioTab.tsx` | `useTranslations('portfolio')` |
| `components/mobile/SimulateTab.tsx` | `useTranslations('simulate')` |
| `components/mobile/StandingsTab.tsx` | `useTranslations('standings')` |
| `components/mobile/ScheduleTab.tsx` | `useTranslations('schedule')` |

### Phase E — Mécanique

| Fichier | Changement |
|---|---|
| `components/mechanics/SimulateButton.tsx` | `useTranslations('simulateButton')` |

---

## 8. Corrections du mélange actuel fr/en

| Composant | Avant (mélangé) | EN correct | FR correct |
|---|---|---|---|
| `TradeModal` | `"BUY"` / `"SELL"` | `"BUY"` / `"SELL"` | `"ACHETER"` / `"VENDRE"` |
| `TradeModal` | `"Price per share"` | `"Price per share"` | `"Prix par action"` |
| `TradeModal` | `"You'll pay"` | `"You'll pay"` | `"Tu vas payer"` |
| `BottomNav` | `"Market"` / `"Fixtures"` / `"Table"` | kept | `"Marché"` / `"Calendrier"` / `"Classement"` |
| `MatchDetailOverlay` | `"DRAW"` | `"DRAW"` | `"NUL"` |
| `StandingsTab` | `"GROUP STANDINGS"` | `"GROUP STANDINGS"` | `"CLASSEMENT DES GROUPES"` |
| `AuthWidget` | `"⚽ LOGIN"` (bouton compact) | `"⚽ LOGIN"` | `"⚽ CONNEXION"` |

---

## 9. Consommation future sur mobile (React Native / Expo)

```ts
// apps/mobile/lib/i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import * as Localization from 'expo-localization'
import en from '@kickstock/i18n/locales/en.json'  // ← mêmes fichiers
import fr from '@kickstock/i18n/locales/fr.json'

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: Localization.getLocales()[0].languageTag.startsWith('fr') ? 'fr' : 'en',
  fallbackLng: 'en',
})
```

Un seul endroit pour modifier une traduction, deux plateformes servies.

---

## 10. Plan d'exécution

```
[x] Explorer la codebase → inventaire complet des strings
[x] Plan validé
[ ] Phase A : Créer packages/i18n avec en.json + fr.json
[ ] Phase A : Installer next-intl, configurer middleware + layout
[ ] Phase B : Migrer composants partagés (TradeModal, AuthWidget + langue switcher, overlays)
[ ] Phase C : Migrer pages auth
[ ] Phase D : Migrer tabs mobiles + shell
[ ] Phase E : Migrer mécanique (SimulateButton)
[ ] Vérifier : détection auto navigateur, switch manuel, fallback EN
```

---

## 11. Non-objectifs (hors scope)

- Localisation des dates/nombres
- Support RTL
- Plus de 2 langues pour l'instant
- Traduction des noms de nations (noms propres internationaux)
- Internationalisation des emails Supabase (scope backend séparé)
- Service de traduction externe (Crowdin, Lokalise) — overkill pour 2 langues
