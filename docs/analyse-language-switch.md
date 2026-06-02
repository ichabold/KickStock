# Analyse & Corrections — Changement de langue (i18n)

> Date : 2026-06-03  
> Statut : **✅ CORRIGÉ**  
> Versions : `next 14.2.3` · `next-intl 4.12.0`

---

## 1. Résumé

Deux niveaux de dysfonctionnement ont été identifiés et corrigés :

| Niveau | Problème | Statut |
|---|---|---|
| Plomberie | `next-intl` v4 non intégré correctement avec le middleware Supabase custom | ✅ Corrigé |
| Visible | ~26 strings françaises hardcodées dans `BrowserShell.tsx` hors système i18n | ✅ Corrigé |
| Accessibilité | `LanguageSwitcher` inaccessible aux guests et visiteurs | ✅ Corrigé |
| Architecture | Double lecture du cookie (layout + `getRequestConfig`) | ✅ Corrigé |
| Edge case | Conflit `Set-Cookie` double à la première visite | ✅ Corrigé |
| Code mort | `app/actions/locale.ts` (Server Action inutilisé) | ✅ Supprimé |

---

## 2. Bug #1 — Architecture `next-intl` v4 : header `X-NEXT-INTL-LOCALE`

### Diagnostic

`next-intl` v4 attend que le header `X-NEXT-INTL-LOCALE` soit injecté dans chaque requête par le middleware (cf. source `next-intl/dist/.../middleware/middleware.js:39`). Ce header est lu par `getRequestLocale()` → `getLocaleFromHeader()` → `headers().get('X-NEXT-INTL-LOCALE')`.

L'app utilise un middleware Supabase custom qui n'injectait pas ce header. Le `getRequestConfig` contournait le problème en relisant le cookie directement (style v3, non recommandé en v4).

### Correction appliquée — `middleware.ts`

```ts
// Inject X-NEXT-INTL-LOCALE header so next-intl v4 getRequestLocale() works
const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
const locale = SUPPORTED_LOCALES.includes(cookieLocale as ...) ? cookieLocale! : detectLocale(request);

const requestHeaders = new Headers(request.headers);
requestHeaders.set(LOCALE_HEADER, locale);   // LOCALE_HEADER = 'X-NEXT-INTL-LOCALE'

let supabaseResponse = NextResponse.next({
  request: { headers: requestHeaders },      // forwarded to route handlers & pages
});
```

`resolveAndApplyLocale` remplace `applyLocaleCookie` avec une logique enrichie :
- Exclut `/api/set-locale` de la pose de cookie (résout aussi le bug #5)
- Retourne le couple `{ response, locale }` pour usage dans les redirections admin/login

### Correction appliquée — `i18n/request.ts`

```ts
// Avant (style v3 — contournement fragile)
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get('NEXT_LOCALE')?.value);
  return { locale, messages };
});

// Après (API v4 — source unique via header injecté par middleware)
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = resolveLocale(await requestLocale);
  return { locale, messages };
});
```

---

## 3. Bug #2 — Double lecture du cookie

### Diagnostic

La locale était lue **deux fois indépendamment** : une fois dans `getRequestConfig`, une fois dans `app/layout.tsx`. Si les deux sources divergeaient, server et client components auraient affiché deux langues différentes.

### Correction appliquée — `app/layout.tsx`

```ts
// Avant — lecture directe du cookie, duplique la logique de getRequestConfig
import { cookies } from 'next/headers';
import { resolveLocale } from '@kickstock/i18n';
const cookieStore = await cookies();
const locale = resolveLocale(cookieStore.get('NEXT_LOCALE')?.value);
const messages = await getLocaleMessages(locale);

// Après — lit depuis getRequestConfig, source unique
import { getLocale, getMessages } from 'next-intl/server';
const locale   = await getLocale();
const messages = await getMessages();
```

---

## 4. Bug #3 — Strings françaises hardcodées dans `BrowserShell.tsx`

### Diagnostic

`BrowserShell.tsx` (1 192 lignes) contenait 26+ strings françaises écrites directement dans le JSX, hors système `next-intl`. Même quand le cookie changeait, ces strings ne bougeaient pas.

### Correction appliquée

**Nouvelles clés ajoutées** dans `en.json` et `fr.json` :

| Namespace | Nouvelles clés |
|---|---|
| `shell` | `portfolioValue`, `cashAvailable`, `positions`, `matchdayLabel`, `previousMatchday`, `currentMatchday`, `todayMatchesHeader`, `bestScoresTab`, `liveCompetitionTab`, `eliminatedBadge`, `refresh`, `rankingAutoRefresh` |
| `schedule` | `allGroupMatches`, `koPhase`, `koDynamic`, `tbd`, `upcomingBadge` |
| `standings` | `groupHeader`, `colTeam`, `colW/N/L/Pts/Price` + titres |
| `simulate` | `viewMarket` |

**Composants mis à jour dans `BrowserShell.tsx`** :

| Composant | Changement |
|---|---|
| `BrowserShell` (topbar) | `Portefeuille`, `Cash dispo`, `Positions`, `Journée` → `ts(...)` |
| `BrowserShell` (overlay résultats) | `VOIR LE MARCHÉ →` → `tsi('viewMarket')` |
| `StockTile` | `💀 ÉLIMINÉ · 1 KC` → `ts('eliminatedBadge')` |
| `HomeView` | Labels journée précédente/courante, header matchs du jour, tournoi terminé |
| `ScheduleView` | Tous les labels de phase, badges `À venir`/`Prochain`, `À déterminer` |
| `PortfolioView` | TOTAL, INVESTI, CASH, P&L, HISTORIQUE, ACH/VTE, `J{day}`, emptyHint |
| `StandingsView` | Labels KO, header groupes, entêtes colonnes tableau |
| `BracketView` | Labels phases KO, `À déterminer` |
| `RankingView` | `MEILLEURS SCORES`, `COMPÉTITION LIVE`, `↻ ACTUALISER`, auto-refresh |

**Nouveaux hooks `useTranslations` ajoutés** dans les composants qui n'en avaient pas :
- `StockTile` : `useTranslations('shell')`
- `HomeView` : + `useTranslations('schedule')`
- `ScheduleView` : `useTranslations('schedule')` + `useTranslations('standings')`
- `StandingsView` : `useTranslations('standings')`
- `BracketView` : `useTranslations('standings')` + `useTranslations('schedule')`
- `BrowserShell` : + `useTranslations('shell')`

---

## 5. Bug #4 — `LanguageSwitcher` inaccessible aux guests

### Diagnostic

`LanguageSwitcher` était uniquement rendu dans `AccountMenu` (users connectés). Guests et visiteurs ne pouvaient pas changer de langue.

### Correction appliquée — `AuthWidget.tsx`

`LanguageSwitcher` ajouté dans :
- **`UpgradePanel`** (guests avec pseudo) — en bas du panel, après la note de migration
- **État visiteur non connecté, mode desktop** (`!compact`) — sous le bouton login

---

## 6. Bug #5 — Conflit Set-Cookie première visite

### Diagnostic

Sur une première visite sans cookie, si l'utilisateur allait directement sur `/api/set-locale`, le middleware posait un cookie via `applyLocaleCookie` ET le route handler posait un cookie différent, créant deux `Set-Cookie` en conflit.

### Correction appliquée — `middleware.ts`

La nouvelle fonction `resolveAndApplyLocale` court-circuite la pose de cookie pour `/api/set-locale` :

```ts
function resolveAndApplyLocale(response, request) {
  if (request.nextUrl.pathname === '/api/set-locale') return { response, locale: existing };
  // ... logique normale
}
```

---

## 7. Bug #6 — Code mort supprimé

`apps/web/app/actions/locale.ts` (Server Action `setLocaleCookie`) — supprimé. N'était importé nulle part.

---

## 8. État après correction

### Flux complet fonctionnel

```
Utilisateur clique "EN"
       │
       ▼
LanguageSwitcher (accessible à TOUS les états auth)
  window.location.href = /api/set-locale?locale=en&redirect=/
       │
       ▼
GET /api/set-locale
  → Set-Cookie: NEXT_LOCALE=en (1 an, SameSite=Lax)
  → 302 redirect vers /
       │
       ▼
middleware.ts
  → lit NEXT_LOCALE=en depuis le cookie du redirect
  → injecte X-NEXT-INTL-LOCALE: en dans les request headers
  → ne pose pas de cookie (déjà présent)
       │
       ▼
i18n/request.ts (getRequestConfig)
  → await requestLocale → lit X-NEXT-INTL-LOCALE → 'en'
  → return { locale: 'en', messages: en.json }
       │
       ▼
app/layout.tsx
  → getLocale() → 'en'  (via getRequestConfig, source unique)
  → getMessages() → en.json
  → <NextIntlClientProvider locale="en" messages={en.json}>
       │
       ▼
Page rendue en anglais ✓
BrowserShell : tous les textes passent par useTranslations ✓
```

### Vérifications post-correction

- ✅ `tsc --noEmit` — aucune erreur TypeScript
- ✅ `en.json` et `fr.json` — JSON valide, 272 → 296 clés, aucune clé manquante
- ✅ Aucune string française hardcodée restante dans `BrowserShell.tsx`
- ✅ `app/actions/locale.ts` supprimé

### Ce qui reste inchangé (fonctionne déjà)

- `/api/set-locale` route handler — aucun changement nécessaire
- `AuthWidget` — déjà 100 % traduit (authWidget namespace)
- `TradeModal`, `NationDetailOverlay`, `MatchDetailOverlay` — déjà corrects
- Cookie TTL 1 an, SameSite=Lax — inchangé
