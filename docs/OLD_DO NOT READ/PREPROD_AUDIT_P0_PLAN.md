# KickStock — Plan d'implémentation des P0 (Audit Pré-Prod v2)

> Source : `KickStock Pre-Prod UX Audit.html` (bundle Claude Design, juin 2026) + `UI_UX_AUTH_BRIEF.md` (v2 — Google OAuth primaire, guest secondaire, email/Apple masqués, Schedule = écran de départ).
>
> Ce document confronte les **9 P0** de l'audit à l'état réel du code au 2026-06-12. Beaucoup de choses ont déjà bougé depuis le snapshot de l'audit (V23.x) — chaque section indique le **statut réel** et ce qu'il reste concrètement à faire.

---

## 1. Vue d'ensemble

| # | P0 | Statut | Reste à faire | Effort restant |
|---|----|--------|----------------|-----------------|
| 1 | Tutorial contextuel ancré au Schedule | ⚠️ Partiel | Re-cibler le coach mark mobile+desktop sur l'écran Schedule (clic sur un pays → achat) au lieu du Market | ~1 j |
| 2 | GuestModal : Google en option 1, Guest en option 2 | ❌ À faire | Inverser l'ordre + restyle (Google = bloc primaire doré, Guest = bloc secondaire outline) | ~½ j |
| 3 | Email/Password masqué au launch | ✅ Fait | Rien — aucun bouton email visible dans GuestModal/AuthWidget | — |
| 4 | Bouton Apple retiré de l'UI | ⚠️ Partiel | `display:none` sur le bouton Apple de `UpgradePanel` (AuthWidget) | 5 min |
| 5 | "SE CONNECTER" remonté et visible | ❌ À faire | Ajouter le lien "Déjà un compte ? SE CONNECTER" dans GuestModal → `/login` | 15 min |
| 6 | Touch targets 30px → 44px | ✅ Fait | Rien — `--tap-min: 44px` déjà appliqué sur `.buy/.sell` | — |
| 7 | Auto-focus mobile ouvre le clavier | ✅ Fait | Rien — `pointer: coarse` déjà testé dans GuestModal | — |
| 8 | Tutorial absent sur MobileShell | ⚠️ Partiel | Coach marks déjà portés sur mobile ; ajouter un bouton HELP pour ré-ouvrir le tutorial | ~2 h |
| 9 | Portfolio vide sans empty state / CTA | ⚠️ Partiel | Empty state texte présent ; ajouter le bouton CTA "VOIR LES MATCHS" (mobile + desktop) | ~2 h |

**Effort total restant estimé : ~1.5 jours** (vs. ~4.5 j dans l'audit — la majorité du P0 #1/6/7/3 a déjà été livrée dans V23.x).

---

## 2. Détail par item

### P0-1 · Tutorial contextuel ancré au Schedule ⚠️

**Constat actuel**

- `CoachMarkOverlay.tsx` existe déjà et est porté sur les deux shells (`BrowserShell.tsx:1198`, `MobileShell.tsx:142`).
- Le déclenchement automatique existe : à la création d'un compte invité, `GuestModal.tsx:170-173` dispatch `kickstock:show-tutorial` si `localStorage.kickstock_seen_tutorial` est absent.
- **Mais** les deux shells réagissent à cet événement en basculant sur l'onglet **Market** (`MobileShell.tsx:38-42` → `setTab('market')`, `BrowserShell.tsx:982-986` → `setView('market')`), puis affichent 4 *coach marks* sur la grille `NationCard` (règles prix/dividendes/lock/taxes — `coachMark.mobile.rule1..4` dans `packages/i18n/locales/fr.json`).
- La décision v2 du brief est différente : l'écran de départ doit rester **Schedule**, et le tutorial doit ancrer son premier beat sur un **match du jour** avec le message "Clique sur un pays pour acheter ta première action" — exactement le flux que permet déjà `ScheduleTab.tsx:90-101` (`onClick={() => setNationId(m.a)}` ouvre `NationDetailOverlay` avec achat).

**Modifications à faire**

1. **`apps/web/components/mobile/MobileShell.tsx` (L.37-42)** et **`apps/web/components/browser/BrowserShell.tsx` (L.981-987)**
   - Remplacer `setTab('market')` / `setView('market')` par `setTab('schedule')` / `setView('schedule')` (déjà la valeur par défaut, donc en pratique : ne plus changer d'onglet du tout).

2. **`apps/web/components/mobile/ScheduleTab.tsx`** et l'équivalent desktop (vue Schedule de `BrowserShell.tsx`)
   - Ajouter un attribut `data-coach="schedule-match"` sur la première ligne de match du jour courant (`displayMatches[0]`, dans le bloc `isCurrent`).
   - Fallback (decrit dans l'audit) : si aucun match aujourd'hui (`isCurrent` absent), cibler le premier match visible du prochain jour.

3. **`apps/web/components/shared/CoachMarkOverlay.tsx`**
   - Redéfinir `MOBILE_BEATS` et `BROWSER_BEATS` pour suivre les 3 beats du §02 de l'audit :
     - **Beat 1** — sélecteur `[data-coach="schedule-match"]`, tip `bottom`, texte : *"Tape sur un pays pour acheter des actions et parier sur sa victoire."*
     - **Beat 2** — une fois `NationDetailOverlay` ouvert (cf. point 4 ci-dessous), cibler le prix + la barre de force : *"KC = KickCoins, ta monnaie. La barre = force de l'équipe en tournoi."*
     - **Beat 3** — dividendes/taxes : *"Ton équipe passe un tour → dividende automatique. Vendre coûte 10% (5% en phase KO)."*
   - Le composant gère déjà très bien le portail, le highlight (`boxShadow: 0 0 0 9999px`) et le positionnement du tip — la logique de mesure (`measure()`) n'a pas besoin de changer, seulement la liste `Beat[]` et les clés i18n associées.

4. **Coordination Schedule → NationDetailOverlay**
   - Le coach mark Beat 1 doit pouvoir avancer même quand l'utilisateur clique réellement sur le pays (pas seulement sur "OK →"). Écouter l'ouverture de `NationDetailOverlay` (ex: un évènement `kickstock:nation-opened` ou un callback) pour avancer automatiquement au Beat 2 quand `nationId` devient non-null dans `ScheduleTab`.

5. **`packages/i18n/locales/{fr,en}.json` → `coachMark`**
   - Ajouter les nouvelles clés `schedule.rule1Label/Text`, `schedule.rule2Label/Text` (KC+STR), `schedule.rule3Label/Text` (dividendes/taxes) pour remplacer/compléter `mobile.*` et `browser.*`.
   - Conserver les anciennes clés `rule1-4` existantes comme beats de secours si l'utilisateur explore le Market avant le tutorial (optionnel, P2).

**Effort** : ~1 jour (infrastructure coach mark déjà là, le travail est la redéfinition des beats + ajout des `data-coach` + nouvelles copies i18n).

---

### P0-2 · GuestModal : Google en option 1, Guest en option 2 ❌

**Constat actuel** — `apps/web/components/auth/GuestModal.tsx`

L'ordre actuel (L.213-294) est **l'inverse** de la décision v2 :

1. Bloc "Guest" en premier et en **primaire** (`s.block`, fond `var(--s1)`, titre `CHOISIS TON PSEUDO`, input pseudo, bouton `JOUER MAINTENANT` doré pleine largeur).
2. Divider "ou".
3. `AuthButtons` (Google) en **secondaire**, simple bouton outline `s.oauthBtn`.

La v2 du brief demande l'inverse : **Google = bloc primaire doré avec bénéfices**, puis divider "ou continuer sans compte", puis **Guest = bloc secondaire outline**.

**Modifications à faire** (toutes dans `GuestModal.tsx`)

1. **Réordonner le JSX** (L.213-292) :
   - Rendre `<AuthButtons />` (ou un nouveau composant `GooglePrimary`) **en premier**, juste après `s.subtitle`.
   - Puis le divider.
   - Puis le bloc guest (`s.block`), désormais en **secondaire**.

2. **Restyler le bouton Google en primaire** :
   - Nouveau style équivalent à `.gm-google-pri` du HTML de l'audit : `background: var(--gold)`, `color: #000`, `border-radius: 10px`, `padding: 13px 16px`, `font-family: var(--font-display)`, `font-size: 16px`, `letter-spacing: 3px`, pleine largeur.
   - Ajouter sous le bouton une liste de 3 bénéfices (`✓ Progression sauvegardée`, `✓ Joue sur tous tes devices`, `✓ Classement protégé`) en `color: var(--gain)`, `font-size: 10-11px`.
   - Nouvelle clé i18n `auth.guest.googleBenefit1/2/3` (fr/en).

3. **Restyler le bloc Guest en secondaire** :
   - `border: 1px solid var(--border-hi)` (au lieu du fond `var(--s1)` actuel plus marqué), `border-radius: 12px`, padding réduit.
   - Titre du bloc → "INVITÉ" au lieu de "CHOISIS TON PSEUDO" (nouvelle clé i18n `auth.guest.guestTitle`, ou réutiliser `title` en l'adaptant).
   - Bouton "JOUER MAINTENANT" → devient outline (`background: transparent`, `border: 1px solid var(--border-hi)`, `color: var(--text)`) au lieu du gold actuel (`s.btn`).

4. **Divider** : texte "ou" → "ou continuer sans compte" (nouvelle clé i18n `common.orWithoutAccount` ou `auth.guest.orGuest`).

5. **Conserver tel quel** : la logique de validation pseudo, Turnstile, `handleSubmit`, `checkAvailability` — rien ne change côté comportement, uniquement la présentation et l'ordre des blocs.

**Effort** : ~½ jour (CSS/JSX uniquement, aucune logique métier à toucher).

---

### P0-3 · Email/Password masqué au launch ✅

**Constat actuel**

- `GuestModal.tsx` → `AuthButtons` n'expose que le bouton Google (`s.oauthBtn` avec `t('continueGoogle')`). Aucun bouton email.
- `AuthWidget.tsx` → `UpgradePanel` (panel "Créer un compte" pour un guest) n'expose également que Google + Apple (pas d'email).
- Les clés i18n `auth.guest.createEmailAccount` existent dans `fr.json`/`en.json` mais ne sont référencées dans **aucun** composant (`grep` négatif sur `createEmailAccount` dans tous les `.tsx`).
- `EmailAuthModal.tsx` et `app/(auth)/register/page.tsx` existent mais ne sont importés/liés depuis aucun flux principal (pages orphelines).

**Aucune action requise pour le P0.** Optionnel (non bloquant) : retirer la clé i18n `createEmailAccount` inutilisée, ou documenter que `/register` et `EmailAuthModal.tsx` sont du code Sprint 3 à ne pas exposer dans la nav — à traiter en cleanup, pas en P0.

---

### P0-4 · Bouton Apple retiré de l'UI ⚠️

**Constat actuel**

- `GuestModal.tsx` : aucun bouton Apple — ✅ conforme.
- `AuthWidget.tsx` (`UpgradePanel`, ~L.593-597) :
  ```tsx
  <button disabled style={{ ...s.oauthBtn, opacity: 0.3, cursor: 'not-allowed' }}>
    <span style={s.oauthIcon}></span>Apple
    <span style={s.comingSoon}>{t('appleComingSoon')}</span>
  </button>
  ```
  Ce bouton est `disabled` + `opacity: 0.3`, **pas** `display:none` — c'est exactement le cas que l'audit veut corriger (ne pas afficher "bientôt", retirer complètement jusqu'au Sprint 4).

**Modification à faire**

- Dans `apps/web/components/shared/AuthWidget.tsx`, supprimer (ou commenter avec garde `// Sprint 4`) le bloc `<button disabled>...Apple...</button>` (~L.593-597) du composant `UpgradePanel`.
- Conserver la clé i18n `appleComingSoon` pour réutilisation au Sprint 4, mais ne plus la référencer pour l'instant.

**Effort** : 5 minutes.

---

### P0-5 · "SE CONNECTER" remonté et visible ❌

**Constat actuel**

- Les clés i18n `auth.guest.alreadyAccount` ("Déjà un compte ?") et `auth.guest.signIn` ("SE CONNECTER" / "LOG IN") existent dans `fr.json` et `en.json` mais ne sont utilisées dans **aucun** composant.
- La route `/login` existe et fonctionne (`app/(auth)/login/page.tsx`, Google OAuth).
- `GuestModal.tsx` n'affiche aucun lien vers `/login` — un visiteur qui a déjà un compte (et qui choisirait par erreur "Invité") n'a aucun moyen de revenir à une connexion existante depuis la modale.

**Modification à faire**

Dans `apps/web/components/auth/GuestModal.tsx`, ajouter sous le bloc Guest secondaire (après le restyle du P0-2) :

```tsx
import Link from 'next/link';
// ...
<div style={s.loginRow}>
  {t('alreadyAccount')}{' '}
  <Link href="/login" style={s.loginLink}>{t('signIn')}</Link>
</div>
```

Les styles `s.loginRow` et `s.loginLink` existent **déjà** dans l'objet `s` (L.495-511) — probablement un reliquat d'une version antérieure jamais branchée. Il suffit de réutiliser ces styles existants et de monter le JSX.

**Effort** : 15 minutes.

---

### P0-6 · Touch targets 30px → 44px ✅

**Constat actuel**

- `apps/web/styles/tokens.css:71` → `--tap-min: 44px;`
- `apps/web/components/shared/NationCard.module.css:73-87` → `.buy, .sell { height: var(--tap-min); ... }` → **déjà 44px**.
- La variante `.compact .buy, .compact .sell { height: 36px; ... }` (L.105) existe toujours mais le prop `density="compact"` n'est **utilisé nulle part** dans le code actuel (`grep density="compact"` → 0 résultat) : c'est du code mort, pas un risque en prod.

**Aucune action requise pour le P0.** Cleanup optionnel : supprimer la règle `.compact .buy/.sell` à 36px ou la passer à 44px pour éviter une régression future si la densité compacte est réactivée — non bloquant.

---

### P0-7 · Auto-focus mobile ouvre le clavier ✅

**Constat actuel** — `apps/web/components/auth/GuestModal.tsx:44-49`

```tsx
// Focus input only on non-touch devices (not mobile) — P1 fix
useEffect(() => {
  if (!visible) return;
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (!isTouch) setTimeout(() => inputRef.current?.focus(), 100);
}, [visible]);
```

C'est exactement le fix demandé par l'audit (desktop uniquement via media query `pointer`). Le commentaire indique même que ce correctif a déjà été appliqué.

**Aucune action requise.**

---

### P0-8 · Tutorial absent sur MobileShell ⚠️

**Constat actuel**

- `CoachMarkOverlay` est bien monté dans `MobileShell.tsx:142` (`{showTut && <CoachMarkOverlay shell="mobile" onDone={...} />}`) avec des beats dédiés mobile (`MOBILE_BEATS`).
- Déclenchement automatique au premier guest : ✅ (`kickstock:show-tutorial`, voir P0-1).
- **Manque** : aucun moyen de **rouvrir** le tutorial une fois `localStorage.kickstock_seen_tutorial = '1'` écrit. L'audit recommandait un bouton ❓ HELP dans le header mobile (à côté de l'avatar).
- `grep` sur `BottomNav.tsx` et le header mobile ne montre aucune icône HELP.

**Modification à faire**

1. **`apps/web/components/mobile/MobileShell.tsx`** (header, à côté de `<AuthWidget compact />` L.95)
   - Ajouter un petit bouton `❓` (`aria-label` traduit) :
     ```tsx
     <button onClick={() => setShowTut(true)} style={helpBtnStyle} aria-label={t('help')}>❓</button>
     ```
   - Pas besoin de re-checker `localStorage` ici : `setShowTut(true)` suffit, et la fermeture (`onDone`) ré-écrit déjà la clé.

2. **Idem côté desktop** (`BrowserShell.tsx`, sidebar) pour cohérence — un bouton HELP discret sous `AuthWidget` qui appelle `setShowTut(true)`.

3. **i18n** : ajouter `shell.help` (fr: "AIDE" / en: "HELP") dans `packages/i18n/locales/{fr,en}.json`.

**Effort** : ~2 heures (bouton + style + branchement `setShowTut`, sur les deux shells).

> Remarque : la redéfinition des beats (P0-1) s'applique aussi à ce bouton HELP — une fois rouverts, les coach marks doivent recommencer sur Schedule, pas Market.

---

### P0-9 · Portfolio vide sans empty state / CTA ⚠️

**Constat actuel**

- **Mobile** — `apps/web/components/mobile/PortfolioTab.tsx:90-97` :
  ```tsx
  {holdings.length === 0 ? (
    <div className={styles.empty}>
      <div style={{ fontSize: 40 }}>{t('emptyIcon')}</div>
      <div>{t('emptyTitle')}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        {t('emptyHint')}
      </div>
    </div>
  ) : ( ... )}
  ```
  Icône + titre + hint texte sont présents (`📊 Portefeuille vide / Achetez des actions dans l'onglet MARCHÉ`), mais **pas de bouton CTA cliquable** — le joueur doit comprendre tout seul qu'il faut changer d'onglet.

- **Desktop** — `apps/web/components/browser/BrowserShell.tsx`, `PortfolioView` (~L.450) :
  ```tsx
  {holdings.length === 0
    ? <div style={{textAlign:'center',padding:40,color:'var(--di)',fontSize:12}}>{tp('emptyTitle')}</div>
    : holdings.map(...)}
  ```
  Encore plus minimal : juste le titre, sans icône ni hint ni CTA.

**Modifications à faire**

1. **`apps/web/components/mobile/MobileShell.tsx`**
   - L.137 : passer un callback à `PortfolioTab` : `<PortfolioTab onGoToMarket={() => setTab('schedule')} />` (cohérent avec P0-1 : le point d'entrée du premier achat est Schedule, pas Market).

2. **`apps/web/components/mobile/PortfolioTab.tsx`**
   - Étendre les props : `export default function PortfolioTab({ onGoToMarket }: { onGoToMarket: () => void })`.
   - Ajouter un bouton CTA sous `emptyHint` :
     ```tsx
     <button className={styles.emptyCta} onClick={onGoToMarket}>
       {t('emptyCta')}
     </button>
     ```
   - Ajouter le style `.emptyCta` dans `PortfolioTab.module.css` (cf. `.empty-cta` de l'audit : `background: var(--gold); color:#000; border-radius:7px; padding:10px 20px; font-family: var(--font-display); letter-spacing:2px;`).

3. **`apps/web/components/browser/BrowserShell.tsx` (`PortfolioView`)**
   - Remplacer le `<div>{tp('emptyTitle')}</div>` minimal par un bloc équivalent (icône + titre + hint + bouton), avec un callback `onGoToSchedule={() => setView('schedule')}` passé en prop depuis le parent qui instancie `<PortfolioView onTrade=... onNationClick=... onGoToSchedule={() => setView('schedule')} />`.

4. **i18n** — `packages/i18n/locales/{fr,en}.json → portfolio`
   - Ajouter `emptyCta`:
     - fr : `"VOIR LES MATCHS"`
     - en : `"VIEW MATCHES"`
   - Adapter `emptyHint` pour rester cohérent avec la cible Schedule (actuellement : *"Achetez des actions dans l'onglet MARCHÉ"* → suggestion : *"Va sur le planning, choisis un match et tape sur un pays."*).

**Effort** : ~2 heures (mobile + desktop + i18n).

---

## 3. Ordre d'implémentation recommandé

1. **P0-4** (5 min) et **P0-5** (15 min) — quick wins isolés, aucun risque de régression.
2. **P0-2** GuestModal redesign (~½j) — change la première impression, à valider visuellement (mobile + desktop) avant le reste.
3. **P0-9** Portfolio empty state + CTA (~2h) — indépendant, peut être fait en parallèle de #2.
4. **P0-1 + P0-8** Tutorial Schedule + bouton HELP (~1j + 2h) — dépendent l'un de l'autre (même `CoachMarkOverlay`/`MOBILE_BEATS`/`BROWSER_BEATS`), à traiter ensemble en dernier car c'est le changement le plus structurant.
5. **P0-3, P0-6, P0-7** — déjà faits, à garder en tête pour la non-régression (tests manuels rapides avant deploy).

**Total estimé : ~1.5 jour** pour fermer les 9 P0 de l'audit v2.

---

## 4. Hors scope de ce document (P1/P2, pour mémoire)

- **P1** — KC/STR dans le tutorial step 0 : couvert par la redéfinition des beats du P0-1 (Beat 2).
- **P1** — Bandeau "marché gelé" avant le clic BUY (`LockBanner` + `gameStore`) : `LiveTab.tsx:114-115` a déjà `trade_lock_until`/`locked` côté live, mais rien sur Schedule/Market en amont du clic. À traiter séparément.
- **P2** — Nudge upgrade post-premier-trade, ErrorBoundary global, vérification `RankingView`/`useLeaderboard` : non traités ici, post-launch (V1.1).
