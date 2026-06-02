# KickStock — UX Audit: État d'implémentation

> Basé sur l'audit Claude Design du 27 mai 2026 · `ichabold/KickStock@main`

---

## Ce qui est déjà implémenté ✅

### Design Tokens (`apps/web/styles/tokens.css`)
Fichier complet, importé en tête de `globals.css`.

| Token | Valeur | Statut |
|---|---|---|
| `--muted` | `#A3A3A3` (6.9:1) | ✅ Promu depuis `#888` |
| `--dim` | `#6E6E6E` (3.6:1) | ✅ Reclassifié captions seulement |
| `--disabled` | `#444444` | ✅ Réservé aux états désactivés |
| Échelle typo 6 niveaux | `48/28/24/16/14/12px` | ✅ Rien sous 12px |
| Radii 4 valeurs | `4/8/12/16px` + pill | ✅ Tokens définis |
| Animation timing | `--anim-play` … `--anim-pen-decided` | ✅ |
| Z-index scale | shell/overlay/modal/anim/toast | ✅ |

### Bottom Navigation (`BottomNav.tsx` + `BottomNav.module.css`)
- ✅ Icônes SVG Lucide-style (plus d'emoji)
- ✅ FAB doré centré pour PLAY (séparé des tabs navigation)
- ✅ Labels à `var(--fs-eyebrow)` = 12px (au lieu de 8px)
- ✅ `min-height: 52px` sur chaque bouton (> 44px HIG)
- ✅ Importé et utilisé dans `MobileShell.tsx`

### NationCard (`components/shared/NationCard.tsx`)
- ✅ Composant unique avec prop `density: 'comfortable' | 'compact'`
- ✅ `StockTile` de `BrowserShell` supprimé (plus de dérive)
- ✅ Sparkline avec gradient fill et `36px` de hauteur
- ✅ Badge `×{held}` unifié, badge `OUT` pour éliminés

### TradeModal (`components/shared/TradeModal.tsx`)
- ✅ CTA "BUY X SHARES" / "SELL X SHARES" (quantité dans le bouton)
- ✅ Held count dans le sous-titre du header (pas dans la grille info)
- ✅ Coût positif gold — convention signe correcte pour les joueurs
- ✅ `SummaryRow` component — structure claire
- ✅ Haptic sur succès/erreur (`navigator.vibrate`)

### StandingsCard (`components/shared/StandingsCard.tsx`)
- ✅ Nouveau composant (remplace les styles inline dans `StandingsTab`)
- ✅ W·D·L collapsé en `3·0·0 9 pts` sur une ligne
- ✅ Noms de nations à `--fs-label` (14px)
- ✅ Point de couleur pour les équipes en portefeuille
- ✅ `StandingsTab.tsx` importe et utilise ce composant

### MatchAnimation (`components/mobile/MatchAnimation.tsx`)
- ✅ **PhaseStinger** entre `playing→ET` et `ET→pens` (1500ms)
- ✅ **State machine complète** : `playing | stingerET | et | stingerPens | pens | result`
- ✅ **Per-kick reveal** : chaque tir passe par `pending → scored | missed` avec timing
- ✅ **Decided-early fast-forward** : `isPenDecided()` + `ANIM.penDecided` (300ms)
- ✅ **Haptics sur l'équipe tenue** : `vibrate(8)` si goal, `vibrate(30)` si raté
- ✅ Constantes ANIM centralisées (tunable en un seul endroit)

---

## Ce qui reste à implémenter ❌

### Wave 1 — Lisibilité & Hygiène (P0)

#### 1. Supprimer le `max-width: 390px` du shell mobile
**Fichier** : [`MobileShell.module.css:1`](apps/web/components/mobile/MobileShell.module.css)
```css
/* AVANT */
.shell { max-width: 390px; }

/* APRÈS */
.shell { max-width: 430px; } /* ou supprimer entièrement */
```
Impact : letterboxing sur iPhone 15 Plus (430px), Pixel 7 (412px), foldables.

#### 2. Tailles de police sous 12px dans le header mobile
**Fichier** : [`MobileShell.module.css`](apps/web/components/mobile/MobileShell.module.css)

| Sélecteur | Valeur actuelle | Recommandé |
|---|---|---|
| `.statLbl` | `8px` | `var(--fs-eyebrow)` = 12px |
| `.statusDay` | `9px` | `var(--fs-eyebrow)` = 12px |
| `.pill` | `8px` | `var(--fs-eyebrow)` = 12px |

#### 3. Touch targets insuffisants dans MarketTab
**Fichier** : [`MarketTab.module.css`](apps/web/components/mobile/MarketTab.module.css)

| Élément | Hauteur actuelle | Minimum |
|---|---|---|
| `.gp` (group chips) | `30px` | `44px` |
| `.sortBtn` (sort pills) | `~22px` implicit | `44px` ou spacer |

Solution rapide : `min-height: 44px` + `padding: 10px 12px`.

#### 4. Copie FR/EN mélangée
Même écran affiche "MARKET", "Rechercher…", "PRIX ▼", "PORTEFEUILLE", "ACH/VTE". Aucune cohérence de locale.

**Scope** : Tous les labels hardcodés dans les composants. Choisir le français et uniformiser (ou wirer i18n si l'internationalisation est prévue).

---

### Wave 2 — Consistance (P1)

#### 5. Styles inline dans StandingsTab (`19 occurrences`)
**Fichier** : [`StandingsTab.tsx`](apps/web/components/mobile/StandingsTab.tsx)

La section KO Results utilise encore des `style={{…}}` avec des hex literals et des `borderRadius` divers. Migrer vers un `.module.css` comme les autres composants.

#### 6. Border-radius non standardisés
MarketTab.module.css utilise encore `8px`, `5px`, `3px` pour différents éléments. Les tokens `--radius-sm`/`--radius-md`/`--radius-lg` existent mais ne sont pas appliqués partout.

**Action** : grep `border-radius` dans tous les `.module.css` et remplacer par les tokens.

#### 7. CSS mort dans `MobileShell.module.css`
`.navBtn`, `.navIco` (font-size 8px/17px) — ces classes semblent être des résidus de l'ancien nav avant le refactor BottomNav. À supprimer pour éviter la confusion.

---

### Wave 3 — Polish & Émotionnel (P2)

#### 8. Anneau doré sur l'équipe tenue pendant les tirs au but (visuel)
**Fichier** : [`MatchAnimation.tsx`](apps/web/components/mobile/MatchAnimation.tsx)

Les haptics sont là (`vibrate(30)` sur raté), mais il manque l'indicateur **visuel** : quand c'est le tour de l'équipe tenue, son drapeau devrait avoir un `box-shadow: 0 0 0 2px var(--gold)` pulsant.

```tsx
// Dans le rendu des équipes pendant la phase pens :
<span
  className={`${styles.teamFlag} ${isActiveKick && isHeld ? styles.goldRing : ''}`}
>
  {flag}
</span>
```

#### 9. Label "YOUR TEAM" pendant les tirs au but
Pendant la phase `pens`, quand c'est au tour de l'équipe tenue, ajouter un label visible (12px, gold) sous le drapeau : "YOUR TEAM" ou "VOTRE ÉQUIPE". L'audit note que rien dans l'UI ne dit au joueur "c'est ton équipe".

#### 10. Ticker cliquable → ouvre `NationDetailOverlay`
**Fichier** : [`Ticker.tsx`](apps/web/components/shared/Ticker.tsx)

Actuellement aucun `onClick` sur les entrées du ticker. Chaque entrée devrait être cliquable et ouvrir la fiche nation.

#### 11. Barre de progression du tournoi
**Aucun fichier existant** — à créer.

Barre 1px sous le ticker, remplie proportionnellement au jour actuel (ex: jour 6/17). Double fonction : navigation + "story" du tournoi.

```tsx
// Dans MobileShell ou BrowserShell topbar :
<div className={styles.tournamentProgress}
  style={{ width: `${(dayIndex / totalDays) * 100}%` }}
/>
```

#### 12. Skeleton / état de chargement (poll 3s)
Pas d'état visuel entre les fetches. Prix qui "bougent" à la prochaine poll sans indication de fraîcheur.

Action minimale : une pulsation 1px sur le ticker pendant le refresh, ou un skeleton shimmer au premier rendu.

#### 13. États vides pour Market et Schedule
**Fichier** : [`MarketTab.tsx`](apps/web/components/mobile/MarketTab.tsx)

Seul `PortfolioTab` a un état vide. Un nouveau joueur qui arrive sur MARKET devrait voir un message d'onboarding : "Portfolio départ : 10,000 KC — voici les favoris du jour".

#### 14. Styles inline sur la page login / reset-password
**Fichier** : [`app/auth/reset-password/page.tsx`](apps/web/app/auth/reset-password/page.tsx)

Utilise `style={{…}}` avec des hex literals. Migrer vers `--token` CSS variables.

#### 15. Animation d'élimination (crash)
Quand une équipe tenue est éliminée, l'overlay `💀 CRASH` apparaît au prochain poll sans animation. L'audit recommande :
1. Flash rouge 200ms sur tout l'écran
2. Animation du prix qui tombe visuellement à 1 KC
3. Puis overlay résultat

---

## Résumé des priorités

| # | Item | Priorité | Effort | Fichier(s) |
|---|---|---|---|---|
| 1 | `max-width: 390px` → edge-to-edge | P0 | 5 min | `MobileShell.module.css` |
| 2 | Font sizes header mobile < 12px | P0 | 15 min | `MobileShell.module.css` |
| 3 | Touch targets chips/pills < 44px | P0 | 20 min | `MarketTab.module.css` |
| 4 | Copie FR/EN unifiée | P0 | 2h+ | Tous les composants |
| 5 | Inline styles StandingsTab | P1 | 1h | `StandingsTab.tsx` + nouveau CSS |
| 6 | Radii non tokenisés | P1 | 30 min | Tous les `.module.css` |
| 7 | CSS mort MobileShell | P1 | 10 min | `MobileShell.module.css` |
| 8 | Gold ring visuel pendant pens | P2 | 30 min | `MatchAnimation.tsx` + `.module.css` |
| 9 | Label "YOUR TEAM" pendant pens | P2 | 20 min | `MatchAnimation.tsx` |
| 10 | Ticker cliquable | P2 | 30 min | `Ticker.tsx` |
| 11 | Barre de progression tournoi | P2 | 1h | `MobileShell.tsx` + CSS |
| 12 | Skeleton / loading state | P2 | 1h | `MobileShell.tsx` ou `Ticker.tsx` |
| 13 | Empty states Market + Schedule | P2 | 45 min | `MarketTab.tsx`, `ScheduleTab.tsx` |
| 14 | Login inline styles | P2 | 20 min | `reset-password/page.tsx` |
| 15 | Animation élimination | P2 | 2h | `MatchAnimation.tsx` + CSS |

---

## Ce qui n'est PAS dans le scope code
(Mentionné dans l'audit mais hors implémentation front-end pure)

- **Son** : hum de stade, sifflet FT, "oooh" sur tir raté — toggle off par défaut
- **i18n framework** : si multi-locale est prévu, câbler un vrai système i18n
- **Storybook / Ladle** : recommandé au moment de Wave 2 pour verrouiller les composants

---

*Document généré le 27 mai 2026 — à partir du bundle Claude Design `KickStock UX Audit.html`*
