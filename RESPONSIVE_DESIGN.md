# Architecture Responsive — KickStock
**Vue Mobile vs Vue Browser**

> Document technique décrivant comment l'application détecte l'environnement d'affichage et bascule entre deux interfaces entièrement distinctes.

---

## 1. Vue d'ensemble — Architecture à deux shells

KickStock ne fait **pas** de responsive CSS classique (media queries qui redimensionnent les mêmes composants). À la place, il utilise une **architecture à deux shells séparés** : le même point d'entrée (`app/page.tsx`) monte soit `<MobileShell>` soit `<BrowserShell>` — deux arbres React indépendants avec leurs propres layouts, navigations et styles.

```
app/page.tsx
├── useLayout() → 'mobile'   →  <MobileShell />   (390px max, tab bar bottom)
└── useLayout() → 'browser'  →  <BrowserShell />  (fullscreen, sidebar 72px + main)
```

---

## 2. Le point de rupture — `MOBILE_BREAKPOINT`

La valeur pivot est définie dans le package partagé `@kickstock/constants` :

```typescript
// packages/constants/src/index.ts
export const MOBILE_BREAKPOINT = 600; // px
```

En dessous de **600 px** de largeur de viewport → interface mobile.  
À partir de **600 px** → interface browser.

Le fait que la constante vive dans le package partagé garantit qu'elle est la même source de vérité pour toute l'application (pas de magic number dupliqué dans les CSS).

---

## 3. Le hook `useLayout()` — détection côté client

```typescript
// apps/web/hooks/useLayout.ts
'use client';

import { useState, useEffect } from 'react';
import { MOBILE_BREAKPOINT } from '@kickstock/constants';
import type { LayoutType } from '@kickstock/types';

export function useLayout(): LayoutType {
  const [layout, setLayout] = useState<LayoutType>('browser');  // ← valeur SSR

  useEffect(() => {
    const check = () => {
      setLayout(window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'browser');
    };
    check();                                    // détection immédiate au montage
    window.addEventListener('resize', check);   // réactivité au redimensionnement
    return () => window.removeEventListener('resize', check);
  }, []);

  return layout;
}
```

### Points techniques clés

| Aspect | Comportement |
|--------|-------------|
| **Valeur initiale** | `'browser'` — évite tout crash SSR (pas de `window` côté serveur) |
| **Hydration** | Après montage, `useEffect` s'exécute et corrige immédiatement si mobile |
| **Réactivité** | `resize` listener — le shell change en temps réel si la fenêtre est redimensionnée |
| **Cleanup** | Le listener est supprimé au démontage (`return () => removeEventListener`) |
| **Type** | `LayoutType = 'mobile' | 'browser'` défini dans `@kickstock/types` |

### Comportement SSR / First Paint

```
SSR (Node.js)          →  layout = 'browser'  (useState initial)
                                ↓
Client hydration        →  useEffect fires
                                ↓
window.innerWidth < 600 ?  setLayout('mobile')  : reste 'browser'
                                ↓
React re-render         →  shell correct affiché
```

Il peut y avoir un flash d'1 frame sur mobile (browser → mobile). En pratique il est imperceptible car le premier paint est déjà en cours de peinture quand l'effet s'exécute. `export const dynamic = 'force-dynamic'` sur `page.tsx` empêche Next.js de cacher une version statique incorrecte.

---

## 4. Le sélecteur de shell — `app/page.tsx`

```typescript
// apps/web/app/page.tsx
'use client';
export const dynamic = 'force-dynamic';

import { useLayout } from '@/hooks/useLayout';
import MobileShell from '@/components/mobile/MobileShell';
import BrowserShell from '@/components/browser/BrowserShell';

export default function HomePage() {
  const layout = useLayout();
  return layout === 'mobile' ? <MobileShell /> : <BrowserShell />;
}
```

C'est tout. Une ligne de JSX conditionnel. Aucun CSS, aucun media query ici — la logique de détection est entièrement encapsulée dans `useLayout`.

---

## 5. `MobileShell` — interface smartphone (< 600 px)

### Structure visuelle

```
┌─────────────────────────────────┐  ← max-width: 390px, centré
│  HEADER  [CASH] [TOTAL] [AUTH]  │  ← 50px, flex row, flex-shrink: 0
├─────────────────────────────────┤
│  TICKER (défilement horizontal) │  ← 28px, animation CSS
├─────────────────────────────────┤
│  STATUS BAR  [Jour X] [Phase]   │  ← 28px
├─────────────────────────────────┤
│                                 │
│  CONTENU DE L'ONGLET ACTIF      │  ← flex: 1, overflow-y: auto
│  (scroll vertical)              │
│                                 │
├─────────────────────────────────┤
│  [📅] [🏆] [⚡] [📊] [💼]      │  ← TAB BAR 64px, flex-shrink: 0
└─────────────────────────────────┘
```

### CSS Module — structure colonne

```css
/* MobileShell.module.css */
.shell {
  width: 100%;
  max-width: 390px;     /* largeur iPhone standard */
  margin: 0 auto;       /* centré sur tablette/desktop si < 600px */
  height: 100dvh;       /* dvh = dynamic viewport height (gère la barre d'adresse mobile) */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.scroll {
  flex: 1;              /* occupe tout l'espace entre header et nav */
  overflow-y: auto;
  scrollbar-width: none; /* cache la scrollbar sur Firefox */
}

.nav {
  height: 64px;
  display: flex;
  flex-shrink: 0;       /* ne rétrécit jamais */
  border-top: 1px solid var(--border);
}
```

### Navigation — 5 onglets

```typescript
const TABS = [
  { id: 'schedule',  ico: '📅', label: 'SCHED.'  },
  { id: 'standings', ico: '🏆', label: 'STNDGS'  },
  { id: 'simulate',  ico: '⚡', label: 'PLAY', play: true },  // ← bouton central accentué
  { id: 'market',    ico: '📊', label: 'MARKET'  },
  { id: 'portfolio', ico: '💼', label: 'PORTF.'  },
];
```

Chaque onglet est un composant dédié monté/démonté selon le state `tab` local au shell :

```tsx
{tab === 'market'    && <MarketTab />}
{tab === 'schedule'  && <ScheduleTab />}
{tab === 'portfolio' && <PortfolioTab />}
{tab === 'simulate'  && <SimulateTab />}
{tab === 'standings' && <StandingsTab />}
```

### Composants mobiles

| Fichier | Rôle |
|---------|------|
| `MobileShell.tsx` | Shell container — header, ticker, statusBar, nav |
| `MarketTab.tsx` | Grille de NationCards avec buy/sell |
| `ScheduleTab.tsx` | Liste des matchs par journée |
| `PortfolioTab.tsx` | Holdings, P&L, historique des trades |
| `SimulateTab.tsx` | Bouton "Jouer ce jour" + animation résultats |
| `StandingsTab.tsx` | Classements de groupe |
| `MatchAnimation.tsx` | Animation overlay post-simulation |
| `PlayButton.tsx` | Composant legacy (non rendu, conservé pour référence) |

---

## 6. `BrowserShell` — interface desktop (≥ 600 px)

### Structure visuelle

```
┌──────┬──────────────────────────────────────────────────────────┐
│  SB  │  TOPBAR  [titre] [stats] [PLAY] [AUTH]                   │
│ 72px ├──────────────────────────────────────────────────────────┤
│  ⚽   │  TICKER (défilement horizontal)                          │
│ KS   ├──────────────────────────────────────────────────────────┤
│      │                                                          │
│  🏠  │  CONTENU DE LA VUE ACTIVE                               │
│  📅  │  (layout interne propre à chaque vue)                    │
│  📊  │                                                          │
│  💼  │                                                          │
│  🏆  │                                                          │
│  ──  │                                                          │
│  🏅  │                                                          │
│  ❓  │                                                          │
└──────┴──────────────────────────────────────────────────────────┘
```

### CSS global — layout sidebar + main

Contrairement au mobile qui utilise des CSS Modules, le browser shell utilise des **classes CSS globales** dans `styles/browser.css` (importé depuis `globals.css`) :

```css
/* styles/browser.css */
.ks-browser {
  display: flex;          /* sidebar + main côte à côte */
  height: 100dvh;
  overflow: hidden;
}

.sb {
  width: 72px;            /* sidebar fixe */
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.ks-main {
  flex: 1;                /* prend tout l'espace restant */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;           /* important : empêche le dépassement flex */
}

.ks-content {
  flex: 1;
  overflow: hidden;
  display: flex;          /* les vues internes utilisent flex aussi */
}
```

### Navigation — sidebar verticale

```typescript
const NAV_ITEMS = [
  { id: 'home',      icon: '🏠', label: 'HOME'     },
  { id: 'schedule',  icon: '📅', label: 'SCHED.'   },
  { id: 'market',    icon: '📊', label: 'MARKET'   },
  { id: 'portfolio', icon: '💼', label: 'PORTF.'   },
  { id: 'standings', icon: '🏆', label: 'STNDGS'   },
];
// + bouton ranking + bouton tutoriel en bas
```

### Layouts internes des vues browser

Contrairement au mobile (un onglet = plein écran), les vues browser utilisent souvent un split 2 colonnes :

```css
/* Vue HOME — planning à gauche, market à droite */
.view-home   { display: flex; flex: 1; overflow: hidden; }
.home-l      { width: 48%; border-right: 1px solid var(--border); }
.home-r      { flex: 1; overflow-y: auto; padding: 12px; }

/* Grille de StockTiles — 2 colonnes */
.tiles-grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }

/* Vue SCHEDULE */
.view-sched  { display: flex; flex: 1; overflow: hidden; }
.sched-l     { width: 48%; border-right: 1px solid var(--border); }
.sched-r     { flex: 1; overflow-y: auto; }

/* Vue STANDINGS — grille multi-groupes */
.std-grid    { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }

/* Vue MARKET — filtre + grille de tiles */
.mkt-grid    { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
```

---

## 7. Design System partagé — CSS Custom Properties

Les deux shells partagent le même design system défini dans `:root` de `globals.css` :

```css
:root {
  /* Couleurs */
  --bg:       #0A0A0A;   /* fond principal */
  --s1:       #111111;   /* surface 1 */
  --s2:       #181818;   /* surface 2 */
  --border:   #1E1E1E;   /* bordures */
  --gold:     #FFDB00;   /* couleur principale / accent */
  --gain:     #00FF87;   /* hausse de prix */
  --loss:     #FF3B5C;   /* baisse de prix */

  /* Typographies */
  --font-display: 'Bebas Neue', sans-serif;   /* titres */
  --font-mono:    'JetBrains Mono', monospace; /* prix, chiffres */
  --font-body:    'Inter Tight', sans-serif;  /* texte courant */
}
```

Ces variables sont utilisées identiquement dans les CSS Modules mobile et les classes globales browser — le look & feel est donc cohérent entre les deux interfaces.

---

## 8. Composants partagés — `components/shared/`

Certains composants sont utilisés **dans les deux shells** sans adaptation :

| Composant | Utilisé dans | Rôle |
|-----------|-------------|------|
| `TradeModal` | Mobile + Browser | Sheet/modal d'achat et vente |
| `NationDetailOverlay` | Mobile + Browser | Fiche détaillée d'une nation |
| `MatchDetailOverlay` | Mobile + Browser | Détail d'un match passé |
| `Ticker` | Mobile + Browser | Bandeau défilant des prix |
| `AuthWidget` | Mobile + Browser | Bouton login/avatar compact |

Ces composants ont leurs propres CSS Modules indépendants — ils s'adaptent visuellement à leur contexte via `props` (ex: `<AuthWidget compact />` sur mobile).

---

## 9. État partagé — Zustand sans duplication

Les deux shells consomment le même store Zustand `useGameStore`. L'état du jeu (prix, portfolio, dayIndex…) n'est pas dupliqué selon le layout :

```typescript
// Les deux shells font exactement la même chose au montage
useEffect(() => {
  useGameStore.getState().startSync();
  return () => useGameStore.getState().stopSync();
}, []);
```

Le polling 3 secondes est ainsi actif quel que soit le shell affiché.

---

## 10. Récapitulatif — Comparaison des deux shells

| Dimension | MobileShell | BrowserShell |
|-----------|-------------|--------------|
| **Déclencheur** | `window.innerWidth < 600` | `window.innerWidth >= 600` |
| **Largeur** | 100%, max 390px | 100% du viewport |
| **Navigation** | Tab bar horizontale en bas (5 boutons) | Sidebar verticale à gauche (72px) |
| **Mise en page** | Colonne flex, un onglet = plein écran | Sidebar + main, vues en 2 colonnes |
| **Scroll** | Zone centrale scrollable, header/nav fixes | Contenu interne de chaque vue scrollable |
| **Styles** | CSS Modules (`.module.css` par composant) | Classes globales (`browser.css`) |
| **Ticker** | Composant `<Ticker />` partagé | Inline dans la topbar via classes globales |
| **Simulation** | Onglet dédié `SimulateTab` + `MatchAnimation` | Bouton inline dans la topbar |
| **Hauteur viewport** | `100dvh` (dynamic — gère la barre Chrome mobile) | `100dvh` |

---

## 11. Analyse du choix technique — Avantages et risques

### Pourquoi ce pattern plutôt que du responsive CSS classique ?

L'approche standard (un seul arbre React + media queries CSS) est suffisante quand les interfaces mobile et desktop ne diffèrent que par leur layout. KickStock a fait le choix inverse : deux arbres indépendants. Ce choix a des raisons solides, mais aussi des coûts réels.

---

### ✅ Avantages

#### 1. Expériences véritablement distinctes, sans compromis
Un responsive CSS classique force à concevoir des composants qui doivent fonctionner dans tous les contextes. Ici, `MarketTab.tsx` est conçu exclusivement pour un écran de 390px, et la vue Market du `BrowserShell` est conçue pour un split 2 colonnes sur 1400px. Chaque interface peut être optimisée sans contrainte de l'autre.

```
Mobile : NationCard compacte, scroll vertical, tap targets 44px minimum
Browser : StockTile dense, grille auto-fill, hover states, raccourcis clavier possibles
```

#### 2. Zéro CSS défensif
Avec du responsive classique, chaque composant accumule des media queries, des overrides, des `display: none` conditionnel. Ici, un composant mobile ne contient aucun code browser et vice-versa. Les CSS Modules restent petits et lisibles.

#### 3. Performance JavaScript réduite
Next.js bundle-split automatiquement par route, mais ici le split va plus loin : `MobileShell` et tous ses onglets ne sont jamais chargés sur desktop, et inversement. Le bundle effectif est plus léger selon l'appareil.

#### 4. Tests et debug isolés
Un bug sur mobile ne peut pas venir d'une interaction avec du code browser. Les composants sont testables indépendamment. Un resize à 599px change de shell instantanément — ce comportement est reproductible et déterministe.

#### 5. Liberté de navigation différente
La navigation mobile (tab bar, 5 onglets, montage/démontage) et la navigation browser (sidebar, vues persistantes) suivent des patterns UX radicalement différents. Les implémenter dans un seul composant `<Nav>` paramétrable aurait produit du code complexe et fragile. Ici, chaque shell gère sa navigation de façon autonome.

---

### 🔴 Risques et inconvénients

#### 1. Duplication de logique métier — le risque principal
C'est le danger structurel le plus sérieux. Une fonctionnalité comme "afficher le détail d'un match" doit être implémentée (ou au minimum câblée) dans les deux shells. Si une règle métier change — par exemple l'ordre des phases du tournoi — il faut mettre à jour deux endroits. Sans discipline, les deux interfaces divergent silencieusement.

```
Exemple concret : si on ajoute un nouveau filtre sur le marché,
il faut l'ajouter dans MarketTab.tsx ET dans la vue Market du BrowserShell.
Oublier l'un des deux = régression silencieuse.
```

**Mitigation :** centraliser toute la logique dans le store Zustand et les packages partagés (`@kickstock/game-engine`). Les shells ne font que présenter — ils ne calculent rien.

#### 2. Surface de code doublée = maintenance plus lourde
~15 fichiers mobiles + BrowserShell monolithique + composants partagés. Chaque nouvelle fonctionnalité nécessite d'évaluer si elle concerne un shell, l'autre, ou les deux. Sur un projet solo ou petite équipe, ce coût est tangible.

#### 3. Flash d'hydration sur mobile (1 frame)
La valeur SSR par défaut est `'browser'`. Sur un smartphone, le premier rendu est le BrowserShell, puis React corrige vers MobileShell après `useEffect`. Le flash est imperceptible en pratique (< 16ms), mais il existe. Une app Next.js 100% SSR-aware pourrait éviter ça via un cookie de session ou un User-Agent hint.

```
SSR → BrowserShell rendu (invisible, paint en cours)
useEffect → setLayout('mobile') → re-render → MobileShell
Durée : < 1 frame (< 16ms sur écrans 60hz)
```

#### 4. Comportement au resize non naturel
Si un utilisateur redimensionne la fenêtre de 700px à 500px, le shell entier est démonté et remonté. L'état local des composants (position de scroll, onglet actif, champ de recherche ouvert) est réinitialisé. Ce comportement est acceptable car aucun utilisateur réel ne fait ça sur mobile, mais il peut surprendre en dev.

#### 5. Risque de désynchronisation des données entre shells
Si une feature utilise un état local au shell (ex: `useState` dans BrowserShell) plutôt que le store Zustand, cet état est perdu au changement de shell. Toute donnée qui doit survivre à un resize doit vivre dans le store global — ce qui n't est pas toujours évident à identifier au moment du développement.

#### 6. SEO et accessibilité non testés sur les deux chemins
Google indexe généralement la version desktop. Si du contenu critique pour le SEO n'existe que dans MobileShell, il ne sera pas indexé. Pour KickStock (jeu, pas blog), l'impact est faible — mais c'est un angle mort à connaître.

---

### Bilan — Quand ce pattern est pertinent

| Critère | Favorable à ce pattern | Défavorable |
|---------|----------------------|-------------|
| **Différence UX mobile/desktop** | Radicale (navigation, layout, densité) | Superficielle (juste marges et colonnes) |
| **Taille de l'équipe** | 1-3 devs avec ownership clair | Grande équipe sans conventions strictes |
| **Parité fonctionnelle** | Partielle (features prioritaires par plateforme) | Totale (chaque feature doit exister partout) |
| **Performance bundle** | Importante (mobile sur 3G) | Moins critique |
| **Logique métier** | Centralisée dans un store/engine externe | Dispersée dans les composants |

**Verdict pour KickStock :** le choix est justifié. Les deux interfaces sont visuellement et fonctionnellement différentes, la logique est centralisée dans `useGameStore` et `@kickstock/game-engine`, et l'équipe est petite. Le principal risque (duplication silencieuse) est contenu tant que les shells restent des _vues pures_ qui ne font que consommer le store.

---

## 12. Arbre des fichiers concernés

```
apps/web/
├── app/
│   └── page.tsx                  # Sélecteur de shell — 1 ligne de JSX
├── hooks/
│   └── useLayout.ts              # Détection breakpoint + resize listener
├── styles/
│   ├── globals.css               # Design system (:root variables, reset, animations)
│   └── browser.css               # Layout browser (sidebar, topbar, vues split)
├── components/
│   ├── mobile/
│   │   ├── MobileShell.tsx       # Shell container mobile
│   │   ├── MobileShell.module.css
│   │   ├── MarketTab.tsx / .module.css
│   │   ├── ScheduleTab.tsx / .module.css
│   │   ├── PortfolioTab.tsx / .module.css
│   │   ├── SimulateTab.tsx
│   │   ├── StandingsTab.tsx
│   │   └── MatchAnimation.tsx / .module.css
│   ├── browser/
│   │   └── BrowserShell.tsx      # Shell monolithique browser (CSS globales uniquement)
│   └── shared/
│       ├── TradeModal.tsx / .module.css
│       ├── NationDetailOverlay.tsx / .module.css
│       ├── MatchDetailOverlay.tsx / .module.css
│       ├── Ticker.tsx / .module.css
│       └── AuthWidget.tsx
└── packages/
    ├── constants/src/index.ts    # MOBILE_BREAKPOINT = 600
    └── types/src/index.ts        # LayoutType = 'mobile' | 'browser'
```
