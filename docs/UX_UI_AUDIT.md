# AUDIT UX/UI — KICKSTOCK
**Date :** 27 mai 2026  
**Auditeur :** Product Design + Frontend Engineering  
**Périmètre :** apps/web (shells mobile + browser), design system global, flow de trade, gamification  
**Posture :** critique, sans concession, orientée action

---

## TL;DR — Verdict global

KickStock dispose d'une **fondation architecturale exceptionnellement saine** (dual-shell, mécaniques atomiques partagées, tokens disciplinés). L'app *vibe* déjà : palette nocturne, Bebas/Mono, flashs verts/rouges. Mais **trois familles de frictions** empêchent encore de basculer du "joli prototype" au "produit immersif niveau Robinhood × FUT Champions" :

1. **Le TradeModal est dense mais visuellement plat** — la hiérarchie ne sépare pas assez l'action (BUY/SELL) du calcul (frais, cap, cash après). Le slider+stepper+MAX font triple emploi.
2. **Le système de couleur est rigoureux mais les états transitoires (flash, élimination, KO) manquent de "punch cinématique"** — on a le vocabulaire visuel, pas encore la grammaire d'animation.
3. **Le cross-platform à 600px est trop binaire** — entre 600 et 1024px (tablette, fenêtre réduite), l'expérience browser est servie avec une densité pensée pour 1440px+. Pas de zone tampon.

Le reste — incohérences de contraste sur `--dim`/`--muted`, dialogues sans `role="dialog"`, absence de `:focus-visible` brandé, ticker sans affordance — relève du **Quick Win**.

---

## 1. ANALYSE HEURISTIQUE & ERGONOMIE DU FLUX (UX)

### 1.1 Le flux de Trade (TradeModal) — analyse au scalpel

**Force structurelle :** un seul écran modale, pas de wizard multi-étapes. Réactivité temps réel (slider → recalcul instantané). Garde-fous mécaniques propres (cap 40 %, élimination, cash insuffisant).

**Frictions identifiées :**

#### F1 — Triple redondance de saisie de quantité
Le modal expose **trois mécanismes pour la même action** : `−/+` stepper, slider continu, bouton `MAX`. C'est généreux, mais cognitivement coûteux : l'utilisateur doit décider *lequel utiliser*. Sur mobile (touch), le stepper est gagnant pour les petites quantités, le MAX pour les achats convictionnels. Le slider, lui, est rarement utile — il sert surtout d'indicateur visuel de progression vers le MAX.

> **Recommandation :** garder les 3, mais réduire la **charge visuelle du slider** (le transformer en *progress bar non-interactive sous le stepper*, plus discrète). Ou inversement, retirer le stepper sur browser desktop (où la souris glisse facilement). Faire un choix éditorial.

#### F2 — Le récapitulatif des frais est ambigu
Le code applique `5% (KO) / 10% (normal)` (voir [TradeModal.tsx:151](apps/web/components/shared/TradeModal.tsx#L151)). Or la consigne d'audit mentionne **2 %**. Soit la doc produit a divergé, soit le code n'a pas suivi. **Cette dissonance entre intention produit et implémentation est en soi une faille UX** : un joueur qui a appris "2 % de taxe" sur une page d'aide et qui voit "Taxe (10 %)" perd confiance en une seconde.

Au-delà du chiffre, la **présentation** de la taxe pose problème :
- Elle apparaît uniquement en mode SELL, dim/grise — donc l'œil la zappe.
- Aucun lien vers une *info-bulle* expliquant *pourquoi* la taxe varie (KO vs poules).
- Le label `Taxe (5%)` ne dit pas *5 % de quoi* (du brut ? du gain ?).

> **Recommandation :** afficher la taxe en couleur *upset* (#FF8800) plutôt que dim, ajouter un `?` cliquable ouvrant une mini-explication ("Phase KO → taxe réduite à X %, on encourage la liquidation des éliminés"). Et **réconcilier doc + code immédiatement** (décider 2 %, 5 % ou 10 %).

#### F3 — Le cap 40 % est trop discret
La ligne `Concentration: 30% / 40%` apparaît en or, en milieu de summary. Or **c'est une règle structurante du jeu** (anti-monopole). Aujourd'hui, elle ressemble à un détail comptable.

> **Recommandation :** transformer cette ligne en **barre de progression horizontale** (vide → orange → rouge à l'approche de 40 %). Ajouter un tooltip "Une nation ne peut pas dépasser 40 % de votre portefeuille pendant les phases de poules". Quand on s'approche de 38 %+, faire pulser la barre. C'est *gamification 101* : transformer une contrainte en feedback satisfaisant.

#### F4 — Pas de double-confirmation pour les gros tickets
`CONFIRMER ACHAT` exécute immédiatement le trade, quelle que soit la taille. Pour un MAX qui vide 90 % du cash, c'est risqué. À l'inverse, demander une confirmation systématique ralentirait l'expérience "rapid trading nocturne".

> **Recommandation :** seuil intelligent — pas de confirmation sous 25 % du cash, confirmation discrète (le bouton se transforme en "MAINTENIR pour confirmer", 600 ms hold) au-delà de 50 %. Pattern Robinhood / Revolut.

#### F5 — Aucun feedback haptique/sonore prévu
L'app est gamifiée. Un trade exécuté mérite **un signal sensoriel** au-delà du flash green/red sur la carte (qui se produit *après* la fermeture du modal, donc invisible si l'utilisateur a déjà bougé). Sur mobile : `navigator.vibrate(15)` ; sur web : son court (toggle utilisateur).

### 1.2 Densité de l'information

**Mobile :** la densité est bien dosée. Les cartes Nation respirent, le ticker est bordable. Bon.

**Browser :** la densité est **excessive entre 1024 et 1280px**. Sur MarketView, le grid `auto-fill, minmax(200px, 1fr)` produit 5-6 tuiles par rangée à 1440px — confortable. Mais à 1100px (fenêtre fréquente sur laptop 13"), on tombe à 4 tuiles serrées, et l'œil n'a plus de point d'ancrage. Le Portfolio en tableau souffre du même mal : à <1280px, les colonnes Avg/Invested/P&L/P&L% se télescopent.

> **Recommandation :** introduire un breakpoint intermédiaire "compact desktop" (~1024-1279px) où :
> - Market : `minmax(220px, 1fr)` (force 3-4 tuiles, plus respirable)
> - Portfolio : masquer Avg ou Invested derrière un toggle "détaillé"
> - HomeView : passer en 1 colonne au lieu de 2 sous 1024px

### 1.3 Ruptures de charge cognitive

#### Rupture #1 — L'élimination d'une nation
Aujourd'hui : badge `OUT`, overlay skull, opacité 0.6, message "Achat impossible" dans le modal. C'est *informatif* mais **pas dramatique**. Or l'élimination dans un Mondial, c'est *narrativement* énorme.

> **Recommandation :** au moment de l'élimination (transition de l'état), déclencher un **overlay plein écran de 1.5s** : "🇲🇦 MAROC ÉLIMINÉ — Vos parts ont été liquidées à X KC. P&L: -2,400 KC". Glissement plutôt qu'apparition. C'est ce moment qui crée du *récit*, pas le badge gris post-mortem.

#### Rupture #2 — La transition de phase (Groups → R16 → QF…)
Rien n'est prévu visuellement pour marquer ce changement. Or c'est crucial : les règles changent (cap 40 % saute, taxes baissent), les enjeux montent. L'utilisateur découvre par hasard que le cap n'est plus là.

> **Recommandation :** **interstitiel de phase** entre deux simulations clés. "📯 QUARTS DE FINALE — Plus de cap, taxe ramenée à 5 %. Que la guerre commence."

#### Rupture #3 — Le temps réel mou
Polling 3s (cf. FRONTEND_AUDIT.md). Acceptable pour des prix qui bougent à chaque "jour" de simulation, mais l'utilisateur n'a aucun indicateur que **le système respire**. Pas de "last updated 1s ago", pas de pulsation discrète sur le logo.

> **Recommandation :** dot vert pulsant à côté du logo ("LIVE"), ou bien micro-progress-bar de 3s qui se vide à chaque poll (signal d'activité). Pattern Bloomberg.

#### Rupture #4 — Le blocage de compte (élimination totale du portefeuille)
Non observé dans le code exploré, mais probablement implicite : si toutes les nations détenues sont éliminées et que cash=0, que fait-on ? Game over silencieux ? Notification ?

> **Recommandation :** prévoir un état "FAILLITE" explicite avec écran dédié (récap performance, partage social du score final, CTA "rejouer").

---

## 2. SYSTÈME DE DESIGN & HIÉRARCHIE VISUELLE (UI)

### 2.1 Tokens de couleur

**Palette déclarée :**
| Token | Hex | Usage actuel | Verdict |
|---|---|---|---|
| `--bg` | #0A0A0A | Fond principal | ✅ Parfait |
| `--s1` | #111111 | Cartes, modales | ✅ |
| `--s2` | #181818 | Sous-blocs | ✅ |
| `--text` | #FFFFFF | Texte primaire | ✅ |
| `--muted` | #888888 | Labels secondaires | ⚠️ contraste limite |
| `--dim` | #444444 | Texte tertiaire | 🔴 sous WCAG AA |
| `--gold` | #FFDB00 | CTA, accents | ✅ excellent |
| `--gain` | #00FF87 | Hausse | ✅ |
| `--loss` | #FF3B5C | Baisse | ✅ |
| `--upset` | #FF8800 | Warnings | ⚠️ sous-exploité |

**Diagnostic :**

- **`--dim` (#444) est utilisé pour du texte sémantique** (labels "KC", subtitle de NationCard). Sur fond `#111`, ratio ~3.8:1 — **fail WCAG AA**. Ce token devrait être réservé à des séparateurs ou icônes décoratives. Pour les labels, utiliser `--muted` ou un nouveau `--text-2` à #B0B0B0.
- **`--upset` (#FF8800) est défini mais quasi-jamais utilisé**. C'est un token "warning" en réserve. À mobiliser pour : taxes, approche du cap 40 %, dette latente. Aujourd'hui on bricole avec `--gold` (qui est censé être un accent positif/CTA).
- **Conflit sémantique gold/loss latent** : le gold sert simultanément à *CTA positif* (boutons d'action), à *highlight neutre* (cap 40 %), à *brand* (logo, titres). Quand tout est gold, plus rien n'est gold. Sur le TradeModal, le bouton confirmer en gold se confond avec les labels "Concentration" en gold.

> **Recommandation système :**
> - Introduire `--text-2: #B5B5B5` (label lisible) et reléguer `--muted` au tertiaire.
> - Renommer `--dim` → `--divider` et l'utiliser uniquement pour bordures/lignes.
> - Utiliser `--upset` systématiquement pour les états "attention" (cap, taxe, dette).
> - Réserver `--gold` aux **moments brand uniquement** (logo, badge best-score, CTA principal *du moment*) — pas en label permanent.

### 2.2 Typographie et rythme

**Triade définie :** Bebas Neue (display) / JetBrains Mono (chiffres) / Inter Tight (UI).

**Force :** combinaison archétypale du *trading nocturne*. Bebas = panneau d'affichage de stade. Mono = ticker. Inter = UI moderne. Cohérent avec la promesse "vibe trading/gaming".

**Frictions :**

- **Bebas Neue est utilisé jusqu'à 8-9px** (labels d'info dans TradeModal). À cette taille, Bebas devient illisible (les contreformes se ferment). C'est un caractère condensé conçu pour **15px minimum**, idéalement 18px+.
- **Pas de hiérarchie typo formalisée** — chaque composant déclare ses propres tailles (11px, 13px, 17px, 22px, 28px, 48px). Pas d'échelle modulaire. Résultat : la *rythmique* visuelle est inconsistante entre les vues.
- **Letter-spacing variable** — Bebas est tantôt à `letter-spacing: 2px`, tantôt `4px`, tantôt `1.5px`. À unifier en 2-3 paliers : tight (1px) / normal (2px) / wide (4px).

> **Recommandation :**
> - Échelle typographique stricte (8 niveaux max) déclarée dans `globals.css` : `--fs-xs` (10) / `--fs-sm` (12) / `--fs-base` (14) / `--fs-lg` (16) / `--fs-xl` (20) / `--fs-2xl` (28) / `--fs-3xl` (40) / `--fs-display` (56).
> - Bebas interdit sous 14px (utiliser Inter Tight upper + spaced à la place).
> - 3 paliers de letter-spacing seulement.

### 2.3 Micro-interactions & affichage d'état

**Existant :** flash 0.4s vert/rouge sur les cartes après trade, ticker scroll infini 40s, slide-up modale 0.2s, hover lift -1px sur les cartes.

**Diagnostic :** correct, mais **manque la "dramaturgie"** d'un vrai produit gamifié.

- Les variations de prix dans le **ticker** sont visibles uniquement via le `▲/▼` et le code couleur statique. Aucune **animation lors du changement** (flash inline du nombre, scale momentané).
- Les **flashs** se produisent sur la carte du Market, mais si l'utilisateur reste dans le Portfolio, il rate l'événement.
- Aucune **transition d'état** entre "neutral" et "winning" — par exemple, quand P&L bascule de négatif à positif, c'est juste une couleur qui change instantanément. Frustrant pour un moment qui mérite célébration.
- Le **MatchAnimation** existe mais n'est pas auditable depuis le code exploré — vérifier que les buts sont *individuellement* mis en scène (compteur qui s'incrémente, son discret, vibration au but) et pas simplement affichés tous d'un coup.

> **Recommandations spécifiques :**
> 1. **Price-flash inline ticker** : chaque nombre qui change dans le ticker doit faire un `background: rgba(gain/loss, 0.3)` qui s'éteint en 600ms.
> 2. **Counter animation** sur les chiffres de P&L (interpolation 400ms, easing out) au lieu de saut brut.
> 3. **Confetti / particule discrète** sur élimination *réussie* (quand une nation détenue est éliminée mais qu'on avait shorté ? Si shorter existe). Sur achat de MAX (engagement fort).
> 4. **Heartbeat** sur le bouton SIMULER quand un nouveau jour est dispo (pulsation gold douce).
> 5. **Sons optionnels** (toggle dans settings) : tick discret toutes les 3s de poll, chime à l'exécution de trade, boom au but.

---

## 3. COHÉRENCE CROSS-PLATFORM & ADAPTABILITÉ

### 3.1 La transition 2-colonnes → onglets

Le saut à 600px est **brutal et propre** (deux shells indépendants, `app/page.tsx` choisit l'un ou l'autre). C'est architecturalement défendable (cf. RESPONSIVE_DESIGN.md déjà rédigé), mais **UX-discutable** sur trois plans :

#### 3.1.1 La zone morte 600-1024px
Aucune adaptation : à 700px de large (tablette portrait, fenêtre laptop réduite), on affiche le BrowserShell *conçu pour 1440px*. Sidebar 72px + topbar avec 4 stat boxes + ticker + grid 5 colonnes. C'est cramé. L'utilisateur voit un produit "désaccordé".

> **Recommandation critique :** soit étendre le breakpoint mobile à 900px (et accepter que la tablette ait l'expérience mobile), soit créer un vrai mode "compact desktop" (1024-1279px) avec sidebar collapsée en icônes seules, stat boxes en accordéon, grid réduite. **Ne pas laisser la zone morte telle quelle — c'est le plus gros risque de perte d'utilisateurs laptop.**

#### 3.1.2 Pertes informationnelles à la bascule
Le passage browser → mobile sacrifie : sparklines (pas dans NationCard mobile au même format), tableau portfolio dense, vue "matchs du jour + tuiles" combinée du HomeView. **Sur mobile, l'utilisateur perd la vue d'ensemble.** Il doit naviguer pour reconstruire mentalement l'état du jeu.

> **Recommandation :** ajouter un **5e tab mobile "HOME / RÉSUMÉ"** (au lieu du SimulateTab dédié ou en plus) qui condense en un écran scrollable : best score, P&L du jour, 3 mouvements majeurs du ticker, matchs en cours, bouton simuler en sticky bottom. C'est ce qu'attend un utilisateur qui revient après 1h d'absence.

#### 3.1.3 Reset d'état à la bascule
Si l'utilisateur redimensionne la fenêtre au-dessus/sous 600px, **tout le shell se démonte/remonte** (cf. `useLayout`). Scroll position, modales ouvertes, tab actif → perdus. Rare mais frustrant en démo / DevTools.

> **Recommandation :** persister `currentTab`, `scrollPosition`, `openModalId` dans le store (zustand) pour survivre au swap de shell. C'est 10 lignes de code.

### 3.2 Patterns d'interaction touch vs click

**Touch (mobile) :**
- Boutons à 44px minimum ✅
- Bottom sheet pour modales secondaires ✅
- Pas de hover (correct)

**Click (browser) :**
- Hover lift -1px sur cartes ✅
- Pas de **right-click menu** sur les nations (quick buy/sell sans modal ?)
- Pas de **raccourcis clavier** documentés (B = buy, S = sell, / = search, Esc = close)
- Pas de **drag-to-trade** (slider de quantité directement sur la carte ?)

> **Recommandation :** browser desktop = ajouter un *layer de power-user*. Raccourcis clavier visibles via `?`, right-click pour quick trade, hover prolongé qui affiche un mini-graph tooltip. Mobile reste tactile et simple. C'est en exploitant les **forces propres** de chaque support qu'on évite le "mobile-first sur desktop" générique.

### 3.3 Le pattern "Sidebar 72px" sur browser

72px c'est étroit. Les emojis nav sont OK, mais les labels en 7.5px uppercase letter-spacing 1.5px sont **à la limite de la lisibilité**. Pour comparaison : Linear, Notion, Slack ont des sidebars 56-64px (icons only) ou 200-240px (icon + label confortable). 72px est un *no man's land*.

> **Recommandation :** soit 56px icons-only avec tooltip au hover, soit 200px avec label lisible. Le mid-ground actuel pénalise les deux modes.

---

## 4. ACCESSIBILITÉ (WCAG AA) & PERFORMANCE PERÇUE

### 4.1 Lisibilité des textes secondaires

**Audit contraste (calculé sur fond `#0A0A0A` et `#111`) :**

| Couleur | Ratio /#0A0A0A | Ratio /#111 | WCAG AA (4.5:1) | WCAG AA Large (3:1) |
|---|---|---|---|---|
| #FFFFFF | 19.6:1 | 18.9:1 | ✅ | ✅ |
| #888888 (muted) | 4.9:1 | 4.7:1 | ✅ limite | ✅ |
| #555555 | 2.5:1 | 2.4:1 | 🔴 | 🔴 |
| #444444 (dim) | 1.9:1 | 1.8:1 | 🔴 | 🔴 |
| #FFDB00 (gold) | 14.1:1 | 13.6:1 | ✅ | ✅ |
| #00FF87 (gain) | 16.3:1 | 15.7:1 | ✅ | ✅ |
| #FF3B5C (loss) | 5.4:1 | 5.2:1 | ✅ | ✅ |

**Verdict :** `--dim` (#444) est **inutilisable pour du texte** sémantique. Le code l'utilise pourtant dans `KC` units du TradeModal, `.sub` de NationCard, `Cash après` label. À refactorer.

`--muted` (#888) passe AA de justesse — mais pour du texte **8-10px** (très présent dans l'UI), le seuil AAA monte à 7:1 → **fail**. Or les labels de stats (`PRIX`, `VAR.`, `DÉTENU`) sont en 8px Bebas avec ce gris. Lisible à la rigueur sur écran neuf bien calibré, illisible sur laptop bas de gamme ou en plein jour.

> **Action :** remonter `--muted` à #A0A0A0 (ratio ~7:1 → AAA pour gros, AA confortable pour petit). Coût : 0 minute. Bénéfice : énorme.

### 4.2 Zones interactives

- **Boutons mobile** : 44px ✅ globalement respecté.
- **Stepper TradeModal** : 44×44 ✅
- **Tab bar mobile** : 64px de hauteur ✅
- **Cards nation tappables** : ✅ (largement >44)
- **Boutons close `✕` (modales)** : 36×36 — **sous le seuil 44px tactile**. À élargir.
- **Boutons sort dans MarketTab** : à vérifier visuellement, semblent compacts.
- **Cells de tableau Portfolio (browser)** : tappables pour ouvrir NationDetailOverlay — pas de target size minimum imposé, mais souris donc moins critique.

### 4.3 Sémantique HTML & ARIA

**Manques critiques :**
- TradeModal : pas de `role="dialog"`, pas de `aria-modal="true"`, pas de `aria-labelledby` lié au titre.
- NationCard cliquables : `<div onClick>` au lieu de `<button>` → invisible au clavier et aux lecteurs d'écran.
- Recherche MarketTab : `<input>` sans `<label>` associé (placeholder ≠ label).
- Pas de *focus trap* dans les modales (Tab peut sortir de la modale dans le contenu derrière).
- Pas de *return focus* sur l'élément déclencheur après fermeture de modale.
- Pas de `:focus-visible` brandé — outline navigateur par défaut, peu cohérent avec la palette gold.

### 4.4 Performance perçue

- Polling 3s : OK. Mais aucun indicateur visuel de "fetch en cours" → l'app paraît figée entre deux polls.
- Pas de *skeleton states* documentés — quand le store est vide au premier load, on voit potentiellement des `0 KC` ou des cartes vides.
- Pas de *optimistic UI* sur le trade : l'utilisateur attend la réponse API avant de voir la carte se mettre à jour. Pour une app "rapid trading", **chaque ms perçue compte**.

> **Recommandations :**
> - Optimistic UI sur le trade (update local immédiat, rollback si l'API rejette).
> - Skeletons sur le premier load (cartes en `--s2`, shimmer 1.2s).
> - Indicateur "syncing" subtil (dot pulsant à côté du logo).

---

## 5. FEUILLE DE ROUTE & RECOMMANDATIONS

### 🟢 QUICK WINS (impact immédiat, effort < 1 jour)

| # | Action | Fichier(s) cible(s) | Impact |
|---|---|---|---|
| Q1 | Remonter `--muted` de #888 à #A0A0A0 | `globals.css` | Accessibilité majeure |
| Q2 | Retirer `--dim` de tout texte sémantique, le remplacer par `--muted` | TradeModal, NationCard, summary rows | Accessibilité + lisibilité |
| Q3 | Élargir boutons `✕` close modal de 36 à 44px | TradeModal, BottomSheet | Tactile mobile |
| Q4 | Ajouter `role="dialog"` + `aria-modal="true"` + `aria-labelledby` sur TradeModal/BottomSheet/NationDetailOverlay | Composants modales | A11y |
| Q5 | Ajouter `:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px }` global | `globals.css` | A11y + brand |
| Q6 | Réconcilier le pourcentage de taxe affiché avec la doc produit (2 % vs 5/10 %) | game-engine + TradeModal | Confiance utilisateur |
| Q7 | Ajouter `<label htmlFor>` aux inputs de recherche | MarketTab, MarketView | A11y |
| Q8 | Persister `currentTab` + `scrollPosition` dans le store pour survivre au swap de shell | `gameStore.ts`, shells | UX edge case |
| Q9 | Animer le price-flash inline dans le ticker (background fade 600ms à chaque update) | `Ticker.tsx` + module CSS | Vibe trading |
| Q10 | Pulsation gold sur le bouton SIMULER quand prêt (animation `pulse 2s infinite`) | `SimulateButton.tsx` | Engagement |
| Q11 | Passer la taxe de `--dim` à `--upset` (#FF8800) dans le summary | TradeModal | Hiérarchie info |
| Q12 | Ajouter tooltip `?` sur Concentration / Taxe expliquant la règle | TradeModal | Onboarding inline |

### 🟡 CHANTIERS UX/UI MAJEURS (impact fort, effort 2-7 jours)

| # | Chantier | Effort | Impact |
|---|---|---|---|
| M1 | **Zone tampon 600-1024px** : créer un mode "compact desktop" avec sidebar 56px icons-only, grid réduite, tableaux simplifiés | 3-4j | Critique laptop users |
| M2 | **Refonte hiérarchie TradeModal** : promouvoir BUY/SELL en gros toggle, dégrader le slider en barre de progression (non-interactive), remplacer la ligne Concentration par une barre de progression colorée 0→40% | 2j | Clarté + engagement |
| M3 | **Dramaturgie d'élimination** : overlay plein écran 1.5s quand une nation détenue est éliminée, avec récap P&L et particule visuelle | 1.5j | Récit + rétention |
| M4 | **Interstitiel de phase** : transition visuelle entre Groups/R16/QF/SF/F annonçant les changements de règles | 1.5j | Onboarding continu |
| M5 | **Système typographique formalisé** : 8 paliers `--fs-*`, 3 paliers letter-spacing, interdiction de Bebas <14px, refactor de tous les composants | 3j | Cohérence visuelle globale |
| M6 | **Échelle de couleurs étendue** : ajout `--text-2` (#B5B5B5), réassignation sémantique de `--dim`→divider, généralisation de `--upset` | 1j | Design system maturité |
| M7 | **Tab "HOME / RÉSUMÉ" mobile** : écran condensé reprenant best score, P&L du jour, mouvements ticker, matchs en cours, bouton simuler sticky | 2-3j | Rétention mobile |
| M8 | **Optimistic UI sur trade** : update local instantané, rollback si l'API rejette, skeleton states au premier load | 2j | Performance perçue |
| M9 | **Layer power-user desktop** : raccourcis clavier (B/S/?/Esc/), right-click menu sur nations, tooltip enrichi au hover prolongé | 2j | Pro-trading vibe |
| M10 | **Counter animations** sur tous les chiffres P&L, cash, total (interpolation 400ms easing out) | 1j | Polish + immersion |
| M11 | **Refonte sidebar browser** : trancher 56px icons-only OU 200px label-confortable. Ne pas rester à 72px | 1.5j | Lisibilité nav desktop |
| M12 | **Système son + haptique** : 3-4 sons courts (tick, chime trade, boom but), vibration mobile, toggle global dans settings | 2-3j | Différenciation produit |

### 🔴 CHANTIERS STRATÉGIQUES (impact transformationnel, effort > 1 semaine)

| # | Chantier | Effort | Note |
|---|---|---|---|
| S1 | **MatchAnimation immersive** : refonte de l'écran de simulation en expérience cinématique (compteur but à but, sons, vibrations, ralentis sur penaltys) avec possibilité skip | 1-2 semaines | C'est *le* moment "magic" du produit. Sous-investi aujourd'hui. |
| S2 | **Mode "Live"** : remplacer le polling par Supabase Realtime, ajouter un mini-chat / réactions emoji en temps réel pendant la simulation collective | 2 semaines | Différenciation sociale forte |
| S3 | **Système d'achievements & saisons** : badges visuels, niveaux, classements saisonniers, récompenses cosmétiques (thèmes alternatifs au noir/or) | 2-3 semaines | Rétention long terme |

---

## 6. ANGLES MORTS À INVESTIGUER

Cet audit s'est appuyé sur le code et la documentation. **Trois zones n'ont pas pu être validées :**

1. **Vercel live preview** — non explorée (pas d'URL fournie). Recommander un audit visuel direct avec un screen recorder sur 3 résolutions (375px, 1024px, 1440px) pour confirmer les frictions identifiées.
2. **MatchAnimation runtime** — composant cité mais non lu en détail. Mérite une review dédiée (c'est probablement le moment UX le plus critique du produit).
3. **Onboarding première session** — flow GuestModal cité mais pas analysé end-to-end. Tester avec un utilisateur novice (pas-de-foot, pas-de-trading) en 5 min de session.

---

## 7. CONCLUSION D'AUDITEUR

KickStock est à **environ 70 % du chemin** vers un produit qui *mérite* sa promesse de "vibe trading/gaming nocturne". L'architecture, les tokens, la séparation mécaniques/présentation sont d'une qualité rare pour un produit à ce stade. Le delta restant n'est pas technique — il est **éditorial et dramaturgique** :

- Trancher la zone morte 600-1024px (M1).
- Hiérarchiser le TradeModal (M2).
- Mettre en scène les moments forts (M3, M4, S1).
- Réparer la lisibilité de base (Q1, Q2, Q4, Q5).

Avec 2 sprints (Quick Wins + 4-5 chantiers majeurs prioritaires), l'app peut passer du statut de "prototype solide" à celui de **produit que les utilisateurs ouvrent la nuit, par excitation et non par devoir**. C'est l'objectif.

---

*Fin de l'audit. Aucune ligne de code modifiée — uniquement de l'analyse. Prêt à prioriser ensemble la roadmap pour passer à l'implémentation.*
