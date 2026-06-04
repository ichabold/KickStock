# KickStock — Rapport d'Analyse Métier Complet

> **Contexte global** : KickStock est un jeu de bourse virtuelle sur la Coupe du Monde 2026. Chaque joueur gère un portefeuille en **KC (KickCoins)**, la monnaie du jeu. Les prix des équipes nationales évoluent en fonction des résultats réels (ou simulés) des matchs. L'objectif est de maximiser la valeur totale de son portefeuille à la fin du tournoi.

---

## DOMAINE 1 — Les Équipes (Actifs Cotés)

### 1.1 Structure d'une équipe

Chaque équipe est un actif achetable/vendable. Ses propriétés déterminent son comportement sur le "marché" et dans les simulations.

**Type `Nation`** (legacy, `packages/types/src/index.ts:2`)

| Propriété | Type | Rôle | Exemple |
|-----------|------|------|---------|
| `id` | `string` | Identifiant ISO-3 unique de l'équipe, clé primaire de toute la logique | `"BRA"` |
| `name` | `string` | Nom affiché | `"Brazil"` |
| `flag` | `string` | Emoji drapeau affiché en UI | `"🇧🇷"` |
| `p` | `number` | **Prix initial en KC** — détermine la capitalisation de départ | `200` |
| `conf` | `string` | Confédération FIFA (CONMEBOL, UEFA, etc.) — informatif | `"CONMEBOL"` |
| `str` | `number` | **Force FIFA (0–100)** — moteur de simulation, déterminateur de favori | `88` |
| `group` | `string` | Groupe de phase de poules (A–L) — définit les matchs | `"C"` |

**Type `TeamMeta`** (API-driven, `packages/types/src/index.ts:14`) — remplace `Nation` pour les données venant de la DB. Identique fonctionnellement mais `str` devient `strength` et `p` devient `initialPrice`.

### 1.2 Catalogue des 48 nations

Source : `packages/constants/src/index.ts:28` — `NATIONS: Nation[]`

**Logique de prix initiaux** — hiérarchie éditoriale en 5 niveaux :

| Prix initial | Équipes | Logique implicite |
|---|---|---|
| **200 KC** | BRA, FRA, ARG, ESP, ENG | Favoris absolus (force ≥ 90) |
| **100 KC** | GER, POR | Grands favoris (force 84–86) |
| **75 KC** | NED | Force 82 |
| **50 KC** | USA, BEL | Force 76–80 |
| **35 KC** | URU, CRO | Force 74 |
| **25 KC** | MEX, SUI, SEN, NOR, ECU, JPN, KOR, COL, CAN | Compétitifs (force 62–72) |
| **20 KC** | ~15 équipes | Outsiders (force 55–66) |
| **10 KC** | ~10 équipes | Petites nations (force ≤ 52) |

**Forces FIFA** (propriété `str`) — utilisées exclusivement pour la simulation :
- Plus fort : ESP 92, FRA 93, ARG 91, ENG 90
- Plus faible : CUW 40, NZL 44, HAI 42, UZB 44, JOR 46, IRQ 46

---

## DOMAINE 2 — Le Portefeuille Joueur

### 2.1 Structure complète du GameState

Source : `packages/types/src/index.ts:154` — `interface GameState`

| Variable | Type | Rôle métier | Source initiale |
|----------|------|-------------|-----------------|
| `cash` | `number` | Solde liquide en KC — ce que le joueur peut dépenser immédiatement | `INIT_CASH = 10 000` |
| `portfolio` | `{ [teamId]: number }` | Quantité d'actions détenues par équipe | `{}` (vide) |
| `avgCost` | `{ [teamId]: number }` | Prix moyen d'achat par équipe — base du calcul P&L | `{}` (vide) |
| `prices` | `{ [teamId]: number }` | Prix courant de chaque équipe | `initialPrice` de chaque équipe |
| `priceHistory` | `{ [teamId]: number[] }` | Historique des prix jour par jour | `[initialPrice]` par équipe |
| `dayIndex` | `number` | Jour courant du tournoi (0 = avant le 1er match) | `0` |
| `eliminated` | `string[]` | Liste des équipes éliminées (leur prix = 1 KC) | `[]` |
| `champion` | `string \| null` | ID de l'équipe championne | `null` |
| `matchResults` | `{ [dayIndex]: StoredMatchResult[] }` | Archive de tous les résultats joués | `{}` |
| `r32Pool` | `string[]` | 32 équipes qualifiées pour les 8es | Calculé après poules |
| `r16Pool` | `string[]` | 16 équipes qualifiées pour les 16es | Calculé après R32 |
| `qfPool` | `string[]` | 8 équipes en quarts | Calculé après R16 |
| `sfPool` | `string[]` | 4 équipes en demis | Calculé après QF |
| `finalPool` | `string[]` | 2 finalistes | Calculé après SF |
| `thirdPool` | `string[]` | 2 équipes pour la 3ème place | Calculé après SF |
| `txLog` | `TxEntry[]` | Journal des 100 dernières transactions | `[]` |
| `bestScore` | `number \| null` | Plus haute valeur totale atteinte (high water mark) | `null` |

### 2.2 Constante fondamentale

```
INIT_CASH = 10 000 KC
```
Source : `packages/constants/src/index.ts:85`  
Chaque joueur commence avec 10 000 KC et aucune action. C'est la dotation de départ invariable.

### 2.3 Calcul de la valeur totale du portefeuille

**Formule :**
```
valeurTotale = cash + Σ( portfolio[teamId] × prices[teamId] )
```
Utilisé pour : affichage P&L global, classement (`bestScore`), vérification du plafond de concentration.

### 2.4 Calcul du prix moyen d'achat (`avgCost`)

**À l'achat :**
```
newAvg = (prevQty × prevAvg + quantity × price) / (prevQty + quantity)
```
**À la vente totale :** l'entrée `avgCost[teamId]` est supprimée.

Utilisé pour calculer la plus-value latente par ligne de portefeuille :
```
PnL_latent = (currentPrice - avgCost[teamId]) × portfolio[teamId]
```

### 2.5 Calcul du pourcentage de variation

Source : `packages/game-engine/src/initState.ts:46` — `pctOf()`

```
pctOf(price, initialPrice) = ((price - initialPrice) / initialPrice) × 100
```
Arrondi à 1 décimale. Affiché dans le marché pour chaque équipe.

### 2.6 Formatage d'affichage

Source : `packages/game-engine/src/initState.ts:51` — `fmt()`

```
fmt(v) = Math.round(v).toLocaleString('en-US')
```
Sert à afficher les montants KC avec séparateurs de milliers (`10,000`).

### 2.7 Journal de transactions

Source : `packages/types/src/index.ts:133` — `interface TxEntry`

| Champ | Type | Rôle |
|-------|------|------|
| `dir` | `'buy' \| 'sell'` | Direction de la transaction |
| `flag` | `string` | Emoji drapeau de l'équipe échangée |
| `name` | `string` | Nom de l'équipe |
| `qty` | `number` | Quantité échangée |
| `price` | `number` | Prix d'exécution au moment de l'ordre |
| `day` | `number` | Jour du tournoi (`dayIndex`) où la transaction a eu lieu |

**Règle de rétention** : les 100 dernières transactions sont conservées (insertion en tête, éviction FIFO).

### 2.8 Best Score (high water mark)

```
bestScore = max(bestScore, valeurTotale)
```
Calculé après chaque avancement de journée. Persist en DB. Sert au classement du leaderboard.

---

## DOMAINE 3 — Le Marché (Achat / Vente)

### 3.1 Règles d'accès au marché

Source : `packages/game-engine/src/isMarketLocked.ts`

En **mode simulation** (Phase 1) : le marché est toujours ouvert. `isMarketLocked()` retourne systématiquement `false`.

En **mode live** (matchs réels) : fenêtres de blocage prévues (architecture en place) :
- **-15 min** avant le coup d'envoi → marché bloqué
- **+30 min** après le coup de sifflet final → marché débloqué
- Le champ `trade_lock_until` en DB stocke l'horodatage de déverrouillage.

### 3.2 Règles de validation d'un ordre

Source : `apps/web/app/api/trade/route.ts` + RPC `execute_competition_trade` (DB)

**Conditions bloquantes (toutes vérifiées côté DB, atomiques) :**

| Condition | Code erreur renvoyé | Message |
|-----------|---------------------|---------|
| Équipe éliminée (prix ≤ 1 KC) | `NATION_ELIMINATED` | "éliminé" |
| Cash insuffisant pour l'achat | `INSUFFICIENT_FUNDS` | "insuffisant" |
| Quantité insuffisante en portefeuille pour la vente | `NOT_FOUND` | "introuvable" |
| Plafond de concentration dépassé (groupes/R32) | `CONCENTRATION_CAP` | "plafond" |
| Paramètre invalide | `INVALID_PARAMS / INVALID_MODE / INVALID_QUANTITY` | — |

### 3.3 Plafond de concentration

**Règle :** pendant la phase de poules ET le R32 (dayIndex ≤ 22) : une seule équipe ne peut pas représenter plus de **40%** de la valeur totale du portefeuille.

**Formule de vérification :**
```
concentration = (nouvelleQuantité × prix) / valeurTotalePortefeuille
si concentration > 0.40 → rejet "⛔ Plafond 40% atteint"
```

**Désactivation :** au-delà du R32 (dayIndex > 22), le plafond n'est plus appliqué.

**Logique économique :** empêche qu'un joueur mise tout sur un seul favori en phase de groupes où le risque de surprise est élevé.

### 3.4 Calcul de la taxe de transaction

Source : `packages/game-engine/src/calcTax.ts`

```
calcTax(amount, price, isKO):
  si price ≤ 1 → taxe = 0    (équipe éliminée, liquidation automatique, gratuite)
  sinon → taxe = max(amount × (isKO ? 0.05 : 0.10), 10)
```

| Phase | Taux | Minimum |
|-------|------|---------|
| Poules + R32 (isKO = false) | **10%** | 10 KC |
| R16, QF, SF, Finale (isKO = true) | **5%** | 10 KC |
| Équipe éliminée | **0%** | 0 KC |

**`amount`** = `quantity × price` = montant brut de la transaction.  
**Logique économique :** réduire la taxe en phase KO incite à conserver ses positions et à trader les qualifications, pas à spéculer à court terme.

### 3.5 Coût total d'un achat

```
coûtTotal = (quantity × price) + taxe
cash_après = cash_avant - coûtTotal
```
Si `cash_après < 0` → ordre rejeté (`INSUFFICIENT_FUNDS`).

### 3.6 Produit net d'une vente

```
produitNet = (quantity × price) - taxe
cash_après = cash_avant + produitNet
```

---

## DOMAINE 4 — La Simulation de Matchs

### 4.1 Moteur de simulation principal

Source : `packages/game-engine/src/simulate.ts`

Entrées : `strA` (force A, 0–100), `strB` (force B, 0–100), `isKO` (booléen)

**Étape 1 — Calcul des probabilités (90 minutes)**

```
gap    = |strA - strB|
upsetP = max(0.05, 0.26 - gap × 0.006)   // probabilité de surprise
drawP  = max(0.08, 0.25 - gap × 0.004)   // probabilité de match nul
fav    = (strA ≥ strB) ? 'A' : 'B'       // favori
```

**Table des probabilités selon l'écart de force :**

| gap | upsetP | drawP | P(favori gagne) |
|-----|--------|-------|-----------------|
| 0 | 26% | 25% | 49% |
| 10 | 20% | 21% | 59% |
| 20 | 14% | 17% | 69% |
| 40 | 5% (plancher) | 9% | 86% |
| 43+ | 5% (plancher) | 8% (plancher) | 87% |

**Étape 2 — Tirage du résultat à 90 minutes**

```
r = Math.random()
si r < upsetP              → res90 = équipe non-favorite (surprise)
si r < upsetP + drawP      → res90 = 'draw'
sinon                      → res90 = fav (favori gagne)
```

**Étape 3 — Prolongations et tirs au but (KO uniquement, si res90 = 'draw')**

```
si Math.random() < 0.60 → Prolongations (ET)
sinon                   → Tirs au but (Pen)
```

**Prolongations :**
```
etUpset = max(0.08, 0.35 - gap × 0.008)   // probabilité de surprise en ET
etR = Math.random()
si etR < etUpset → vainqueur ET = équipe non-favorite
sinon            → vainqueur ET = favori
```

**Tirs au but :**
```
// 5 tirs par équipe
conversionRate_A = 0.73 + (strA × 0.001)
conversionRate_B = 0.73 + (strB × 0.001)

// Mort subite si égalité après 5 tirs (max 10 rounds supplémentaires)
while (sA === sB && round < 10) { ... }
penWinner = sA > sB ? 'A' : 'B'
```

La force influence légèrement le taux de conversion :
- ESP (str=92) → 73% + 0.092 = **82.2%** par tir
- HAI (str=42) → 73% + 0.042 = **77.2%** par tir

**Étape 4 — Résultat final**

```
finalRes = penWinner ?? etRes ?? (res90 === 'draw' && isKO ? fav : res90)
```

**Définition d'une "upset" (surprise) :**
```
isUpset = (finalRes ≠ 'draw') AND (finalRes ≠ fav) AND (gap > 8)
```
Le seuil `gap > 8` exclut les matchs équilibrés : une surprise n'est comptabilisée que quand une équipe clairement plus faible l'emporte.  
En mode live (`process-real-result.ts:50`) : seuil ramené à `gap > 5`.

### 4.2 Génération du score

Source : `packages/game-engine/src/genScore.ts`

```
b() = Math.floor(Math.random() * 3)   // 0, 1 ou 2 buts
```

| Cas | Score A | Score B |
|-----|---------|---------|
| Nul en poules (pas de KO) | `g = b()` | `g` (même score) |
| Match KO décidé en ET | `g = b()` (buts 90min chacun) ; vainqueur ET marque +1 | ex. `[2, 1]` si ET='A' |
| Match KO décidé aux tirs | `g = b()` (buts 90min chacun) ; scores restent égaux | ex. `[1, 1]` |
| Match décidé en 90min | `loser = b()`, `winner = loser + 1 + floor(random×2)` | ex. `[3, 1]` si A gagne |

**Plage du score vainqueur en 90 min :** loser + 1 ou loser + 2.

### 4.3 Génération des événements de buts (goallog)

Source : `packages/game-engine/src/genGoals.ts`

**Algorithme :**
1. Calculer `total90` (buts avant la 90e minute) et `total` (buts totaux)
2. Générer `total90` minutes aléatoires **uniques** entre la **4e et la 87e minute** (`MAX_RANGE = 84`) — pas deux buts à la même minute
3. Distribuer ces minutes entre équipe A et B proportionnellement aux scores attendus :
```
needA      = score90A - cA      // buts restants à attribuer à A
remaining  = total90 - (cA + cB)
P(but = A) = needA / remaining
```
4. Sélectionner le buteur depuis `SCORER_POOL[teamId]` — tirage uniforme parmi les 5 joueurs
5. But en prolongations : minute aléatoire entre **91 et 120** (`91 + floor(random × 30)`)

### 4.4 Pool de buteurs

Source : `packages/constants/src/index.ts:126` — `SCORER_POOL: Record<string, string[]>`

22 équipes ont un pool nommé de 5 joueurs. Les 26 autres utilisent le nom de l'équipe en fallback (`SCORER_POOL[id] ?? [teamName]`).

| Équipe | Buteurs |
|--------|---------|
| BRA | Vinicius Jr., Rodrygo, Endrick, Paquetá, Raphinha |
| FRA | Mbappé, Griezmann, Dembélé, Camavinga, Tchouaméni |
| ARG | Messi, Álvarez, Di María, Mac Allister, De Paul |
| ESP | Yamal, Morata, Pedri, Williams, Olmo |
| ENG | Bellingham, Kane, Saka, Foden, Rice |
| GER | Wirtz, Havertz, Gnabry, Müller, Kimmich |
| POR | Ronaldo, Bruno F., Rúben N., Leão, Vitinha |
| NED | Van Dijk, Gakpo, Simons, Dumfries, Reijnders |
| BEL | De Bruyne, Lukaku, Trossard, Carrasco, Doku |
| MAR | En-Nesyri, Ziyech, Ounahi, Hakimi, Saïss |
| USA | Pulisic, Reyna, Adams, Weah, Musah |
| MEX | Álvarez, Lozano, Antuna, Herrera, Sánchez |
| URU | Núñez, Bentancur, Valverde, De Arrascaeta, Pellistri |
| COL | Luis Díaz, Falcao, Cuadrado, Arias, Borré |
| JPN | Kubo, Mitoma, Doan, Ueda, Kamada |
| KOR | Son, Lee Kang-in, Hwang, Kim Min-jae, Cho |
| SUI | Shaqiri, Seferovic, Akanji, Freuler, Rieder |
| CRO | Modrić, Kovačić, Kramarić, Pašalić, Gvardiol |
| SEN | Mané, Dia, Gueye, Sabaly, Diatta |
| NOR | Haaland, Ødegaard, Sörloth, Ajer, Berge |
| GHA | Kudus, Partey, Ayew, Sulemana, Salisu |
| CAN | Davies, David, Larin, Hoilett, Buchanan |

---

## DOMAINE 5 — Impact des Résultats sur les Prix

### 5.1 Formule d'application du résultat

Source : `packages/game-engine/src/applyResult.ts`

Entrées : `pA` (prix équipe A avant match), `pB` (prix équipe B avant match), `res` ('A'|'B'|'draw')

**Victoire de A :**
```
newPA = pA + pB × 0.5   // vainqueur gagne 50% de la valeur du perdant
newPB = pB × 0.5         // perdant perd 50% de sa propre valeur
```

**Victoire de B :**
```
newPB = pB + pA × 0.5
newPA = pA × 0.5
```

**Match nul :**
```
newPA = pA + pB × 0.25   // chaque équipe gagne 25% de la valeur de l'adversaire
newPB = pB + pA × 0.25
```

**Arrondi :** `Math.round(new × 10) / 10` → précision à 0.1 KC.  
**Plancher :** `newPrice = Math.max(1, rawPrice)` — aucune équipe ne peut valoir moins de 1 KC.

**Exemple concret (FRA 200 KC vs SEN 25 KC) :**
- FRA gagne : FRA = 200 + 25×0.5 = **212.5 KC**, SEN = 25×0.5 = **12.5 KC**
- Nul : FRA = 200 + 25×0.25 = **206.25 KC**, SEN = 25 + 200×0.25 = **75 KC** ← gain relatif massif pour le petit

**Propriété mathématique :** la somme des prix est conservée en cas de victoire (transfert pur), mais croît en cas de nul (+25% de valeur croisée injectée dans le système).

### 5.2 Flash d'affichage

Source : `apps/web/app/api/game/advance/route.ts:194`

```
flash[teamId] = (newPrice > oldPrice) ? 'fu' : 'fd'
```
`'fu'` = flash up (vert), `'fd'` = flash down (rouge). Indicateur visuel instantané après chaque journée.

### 5.3 Élimination et liquidation forcée

**Déclencheur :** en phase KO, le perdant est éliminé (sauf SF et 3rd place — les perdants restent actifs jusqu'au match pour la 3ème place).

```
elimId = (isKO AND phase ≠ 'SF' AND phase ≠ '3rd') ? loserId : null
```

**Effet immédiat :**
1. `eliminated.push(elimId)` — équipe marquée éliminée
2. `newPrices[elimId] = 1` — prix forcé à 1 KC
3. `flash[elimId] = 'fd'`
4. RPC `liquidate_competition_eliminated` : toutes les positions de tous les joueurs sur cette équipe sont converties en cash à **1 KC/action**

---

## DOMAINE 6 — Le Tournoi (Structure et Progression)

### 6.1 Calendrier officiel

Source : `packages/constants/src/index.ts:88` — `CALENDAR: CalendarDay[]`

**34 journées** numérotées `dayIndex = 0` à `dayIndex = 33`.

| Phase | dayIndex | Journées | Matchs total | isKO | divKey |
|-------|----------|----------|--------------|------|--------|
| **Groups** | 0–16 | 17 | 64 | false | null |
| **R32** (8es) | 17–22 | 6 | 16 | true | "r32" |
| **R16** (16es) | 23–26 | 4 | 16 | true | "r16" |
| **QF** (quarts) | 27–29 | 3 | 8 | true | "qf" |
| **SF** (demis) | 30–31 | 2 | 4 | true | "sf" |
| **3rd place** | 32 | 1 | 1 | true | null |
| **Final** | 33 | 1 | 1 | true | "final" |

**Champs clés d'un `CalendarDay` :**

| Champ | Rôle |
|-------|------|
| `date` | Date réelle du tournoi (ex. "Jun 11") |
| `label` | Label affiché en UI avec emoji 🔥 pour les journées décisives |
| `phase` | Phase courante — détermine les règles d'élimination et de dividendes |
| `isKO` | true = élimination directe (pas de nul en résultat final) |
| `divKey` | Clé pour `DIV_RATES` — null si pas de dividende ce jour |
| `dynamic` | Clé de découpage du pool KO (ex. "r32_28" → tranche [0,4] du r32Pool) |
| `matches` | Matchs fixes (groupes) ou `[]` (KO, calculé dynamiquement) |

### 6.2 Classement de groupe

Source : `packages/game-engine/src/buildKOMatches.ts:31` — `cmp()`

**Critères de tri (ordre de priorité) :**
```
1. Points       : 3 pts victoire, 1 pt nul, 0 pt défaite
2. Différence de buts (GD) : goals for - goals against
3. Buts marqués (GF)
4. Force FIFA (str)         : départage final si tout le reste est égal
```

### 6.3 Qualification pour la phase KO

Source : `apps/web/lib/ko-qualifiers.ts` — `buildKOQualifiers()`

**Algorithme (compétition-agnostique) :**

1. **Nombre de places disponibles** : `totalSpots = (nbMatchsPhaseKO en DB) × 2`
2. **Top 2 de chaque groupe** → qualifiés automatiques (= 24 équipes pour 12 groupes WC2026)
3. **Meilleurs 3es** : classés par le même `cmp()` ; les `totalSpots - 24` meilleurs (= 8) complètent le pool
4. **Non-qualifiés** → ajoutés à `newEliminated` → liquidation à 1 KC

**Tirage R32 — pairages officiels FIFA 2026** (`buildKOMatches.ts:191`) : 16 matchs fixes liant les groupes selon le bracket officiel.

### 6.4 Construction des matchs KO par journée

Source : `packages/game-engine/src/buildKOMatches.ts:244` — `buildMatchesForDay()`

| dynamic | Pool | Tranche (indices) | Nb matchs |
|---------|------|-------------------|-----------|
| r32_28 | r32Pool | [0, 4) | 2 |
| r32_29 | r32Pool | [4, 10) | 3 |
| r32_30 | r32Pool | [10, 16) | 3 |
| r32_1 | r32Pool | [16, 22) | 3 |
| r32_2 | r32Pool | [22, 26) | 2 |
| r32_3 | r32Pool | [26, 32) | 3 |
| r16_1 à r16_4 | r16Pool | par 4 | 4×2 matchs |
| qf_1 | qfPool | [0, 2) | 1 |
| qf_2 | qfPool | [2, 4) | 1 |
| qf_3 | qfPool | [4, 8) | 2 |
| sf_1 | sfPool | [0, 2) | 1 |
| sf_2 | sfPool | [2, 4) | 1 |
| 3rd | thirdPool | [0, 2) | 1 |
| final | finalPool | [0, 2) | 1 |

### 6.5 Alimentation des pools KO

Source : `apps/web/app/api/game/advance/route.ts:214`

```
phase R32   → vainqueur ajouté à r16Pool
phase R16   → vainqueur ajouté à qfPool
phase QF    → vainqueur ajouté à sfPool
phase SF    → vainqueur ajouté à finalPool ; perdant ajouté à thirdPool
phase Final → vainqueur = champion ; perdant éliminé
```

### 6.6 CAS Lock (anti-concurrence)

Source : `apps/web/app/api/game/advance/route.ts:73`

```sql
UPDATE competition_game_state
SET advancing = true
WHERE competition_id = X AND advancing = false AND current_day_index = clientDay
```

Si 0 lignes mises à jour → une avance est déjà en cours → réponse `409` (`{ advancing: true }`).  
Le drapeau est remis à `false` en fin d'exécution (ou en cas d'erreur via `try/finally`).

**Garde côté client :** `clientDay !== gs.current_day_index` → réponse `{ alreadyAdvanced: true }`.

---

## DOMAINE 7 — Les Dividendes

### 7.1 Taux de dividendes

Source : `packages/constants/src/index.ts:81` — `DIV_RATES: Record<string, number>`

```typescript
DIV_RATES = {
  r32:      0.10,   // 10% du prix par action (qualification 8es)
  r16:      0.15,   // 15% (qualification 16es)
  qf:       0.20,   // 20% (qualification quarts)
  sf:       0.30,   // 30% (qualification demis)
  final:    0.40,   // 40% (les deux finalistes)
  champion: 0.60,   // 60% (vainqueur uniquement, en plus du final)
}
```

### 7.2 Formule de calcul du dividende par action

Source : `packages/game-engine/src/calcDividends.ts`

```
dividende_par_action = round(currentPrice × rate × 10) / 10
```

**`currentPrice`** = prix de l'équipe **après** application du résultat (prix apprécié). Le dividende amplifie donc la récompense des bonnes prédictions.

**Exemple :** ESP (200 KC) gagne son quart de finale → nouveau prix ≈ 260 KC :
```
dividende = round(260 × 0.20 × 10) / 10 = 52 KC par action détenue
```

### 7.3 Distribution des dividendes

Source : `apps/web/app/api/game/advance/route.ts:304` — RPC `distribute_competition_dividends`

**Règle jour de Finale (dayIndex = 33) :**
- Les **deux finalistes** reçoivent le dividende `final` (40%)
- Le **champion** reçoit en plus le dividende `champion` (60%)
- Total pour les détenteurs du champion : **40% + 60% = 100%** du prix post-match en dividendes

**Paramètres passés au RPC :**

| Paramètre | Valeur |
|-----------|--------|
| `p_team_id` | Équipe concernée |
| `p_round` | Clé dans `DIV_RATES` |
| `p_rate` | Taux numérique |
| `p_price` | Prix post-résultat de l'équipe |
| `p_day_index` | Journée courante |

---

## DOMAINE 8 — Mode Live (Résultats Réels)

### 8.1 Traitement d'un résultat réel

Source : `apps/web/lib/process-real-result.ts`

**Déclencheur :** cron job `sync-results` qui interroge l'API Football externe, détecte les matchs terminés et appelle `processRealMatchResult()`.

**Idempotence :** `processed_at !== null` → skip immédiat. Un match ne peut être traité qu'une seule fois.

**Détermination du résultat réel :**
```javascript
determineResult(fixture):
  si status === 'PEN':
    penHome > penAway → 'A'
    penAway > penHome → 'B'
  sinon:
    goals.home > goals.away → 'A'
    goals.away > goals.home → 'B'
    sinon                   → 'draw'
```

**Statuts API reconnus :** `FT` (fin normale), `AET` (après prolongations), `PEN` (après tirs au but).  
**Statuts ignorés :** `PST` (reporté), `SUSP` (suspendu), `CANC` (annulé), `ABD` (abandonné).

**Détection d'upset en mode live :**
```javascript
detectUpset(result, strA, strB):
  si result === 'draw' → false
  si gap ≤ 5          → false   // seuil différent du mode sim (>8)
  favoured = (strA ≥ strB) ? 'A' : 'B'
  return result ≠ favoured
```

**Verrouillage post-match :**
```
trade_lock_until = now + 15 minutes
```

**Chaîne d'exécution complète :**
1. Charger le match depuis DB (via `fixture_id`)
2. Vérifier idempotence (`processed_at`)
3. Charger les forces des équipes
4. `determineResult()` → résultat + `isUpset`
5. Charger prix actuels depuis `competition_teams`
6. `applyResult()` → nouveaux prix
7. RPC `update_competition_prices`
8. Si KO (hors SF et 3rd) → RPC `liquidate_competition_eliminated`
9. Si `div_key` et vainqueur → RPC `distribute_competition_dividends`
10. Mettre à jour le match : scores, `winner_id`, `is_upset`, `processed_at`, `trade_lock_until`, `result_data`

---

## DOMAINE 9 — Contrat de Mécaniques (MechanicsContract)

Source : `packages/types/src/index.ts:199`

Ce contrat définit les **mécaniques obligatoires** que toute interface joueur (mobile ou browser) doit implémenter. Garantit la parité de jeu entre plateformes.

| Mécanique | Description |
|-----------|-------------|
| `canViewNationPrice` | Voir le prix courant de n'importe quelle équipe |
| `canBuy` | Passer un ordre d'achat |
| `canSell` | Passer un ordre de vente |
| `canViewPortfolio` | Voir ses positions |
| `canViewCash` | Voir son solde KC |
| `canViewPnL` | Voir sa plus/moins-value latente |
| `canSimulate` | Déclencher la simulation d'une journée |
| `canViewStandings` | Voir le classement de groupe |
| `canViewSchedule` | Voir le calendrier des matchs |

`REQUIRED_MECHANICS` = toutes les propriétés à `true`. Validé par `useValidateMechanics()` en développement.

---

## RÉCAPITULATIF DES FORMULES CLÉS

| # | Formule | Fichier source |
|---|---------|----------------|
| 1 | `newPA = pA + pB × 0.5 ; newPB = pB × 0.5` (victoire A) | `applyResult.ts` |
| 2 | `newPA = pA + pB × 0.25 ; newPB = pB + pA × 0.25` (nul) | `applyResult.ts` |
| 3 | `taxe = max(amount × (isKO ? 0.05 : 0.10), 10)` | `calcTax.ts` |
| 4 | `dividende/action = round(price × rate × 10) / 10` | `calcDividends.ts` |
| 5 | `upsetP = max(0.05, 0.26 - gap × 0.006)` | `simulate.ts` |
| 6 | `drawP = max(0.08, 0.25 - gap × 0.004)` | `simulate.ts` |
| 7 | `etUpset = max(0.08, 0.35 - gap × 0.008)` | `simulate.ts` |
| 8 | `convRate_X = 0.73 + strX × 0.001` (tirs au but) | `simulate.ts` |
| 9 | `isUpset = res ≠ fav AND res ≠ draw AND gap > 8` | `simulate.ts` |
| 10 | `avgCost = (prevQty × prevAvg + qty × price) / (prevQty + qty)` | `initState.ts` |
| 11 | `pctOf = ((price - initPrice) / initPrice) × 100` | `initState.ts` |
| 12 | `valeurTotale = cash + Σ(qty[t] × price[t])` | game-engine / DB |
| 13 | `concentration = (qty × price) / valeurTotale > 0.40 → rejet` | DB RPC |

---

## RÉCAPITULATIF DES CONSTANTES MÉTIER

| Constante | Valeur | Rôle |
|-----------|--------|------|
| `INIT_CASH` | 10 000 KC | Capital de départ de chaque joueur |
| Prix plancher | 1 KC | Valeur résiduelle des équipes éliminées |
| Plafond concentration | 40% | Max d'un seul actif en groupes/R32 |
| Taux taxe groupes | 10% (min 10 KC) | Friction sur les trades phase initiale |
| Taux taxe KO | 5% (min 10 KC) | Friction réduite phase éliminatoire |
| Taux dividende R32 | 10% | Qualification 8es |
| Taux dividende R16 | 15% | Qualification 16es |
| Taux dividende QF | 20% | Qualification quarts |
| Taux dividende SF | 30% | Qualification demis |
| Taux dividende Final | 40% | Les deux finalistes |
| Taux dividende Champion | 60% | Vainqueur uniquement (+ final) |
| `upsetP` plancher | 5% | Probabilité minimale de surprise |
| `drawP` plancher | 8% | Probabilité minimale de nul |
| Seuil upset simulation | gap > 8 | Définition surprise en simulation |
| Seuil upset live | gap > 5 | Définition surprise en résultat réel |
| P(ET vs Pen) | 60% / 40% | Probabilité prolongations vs tirs au but |
| Max rounds pen | 10 (mort subite) | Limite boucle tirs au but |
| `MOBILE_BREAKPOINT` | 600 px | Seuil responsive mobile/desktop UI |
| Dernières transactions | 100 entrées | Rétention du journal de trades |
