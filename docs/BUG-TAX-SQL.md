# BUG-TAX-SQL — Taux de taxe inversés + minimum 10 KC absent dans `execute_competition_trade`

**Sévérité :** 🔴 BLOQUANT  
**Découvert le :** 2026-06-20 (audit test plan v3.1)  
**Impact prod :** Oui — tout trade de vente en mode online est affecté  
**Fichiers concernés :** 3 fichiers SQL (voir ci-dessous)

---

## Résumé

La fonction RPC `execute_competition_trade` applique des taux de frais de vente **inversés** par rapport à la logique métier définie dans le test plan et dans `onlineGameStore.ts`. De plus, le **minimum de 10 KC par transaction** est absent du calcul SQL.

---

## Comportement actuel (bugué)

| Phase | Jour | Taux appliqué (SQL actuel) | Taux attendu |
|-------|------|---------------------------|--------------|
| Groupes + R32 (`v_is_cap = true`, jour ≤ 22) | 1–22 | **5%** ❌ | 10% |
| KO / QF / SF / Finale (`v_is_cap = false`, jour > 22) | 23+ | **10%** ❌ | 5% |

Minimum de frais par transaction : **absent** ❌ (doit être 10 KC)

### Exemples d'impact concret

| Scénario | Attendu | Actuel (bug) | Écart |
|----------|---------|--------------|-------|
| Vente 10 × BRA à 200 KC (jour 5, groupes) | fee = 200 KC, net = 1 800 KC | fee = 100 KC, net = 1 900 KC | −100 KC de frais |
| Vente 10 × GER à 200 KC (jour 25, QF) | fee = 100 KC, net = 1 900 KC | fee = 200 KC, net = 1 800 KC | +100 KC de frais |
| Vente 1 × ESP à 50 KC (jour 5, groupes) | fee = max(5, 10) = 10 KC, net = 40 KC | fee = 2.5 KC, net = 47.5 KC | −7.5 KC de frais + min absent |
| Vente 1 × ARG à 80 KC (jour 25, QF) | fee = max(4, 10) = 10 KC, net = 70 KC | fee = 8 KC, net = 72 KC | min absent (8 < 10) |

---

## Cause racine

### 1. Taux inversés

**Fichiers impactés :**
- [`db/migrations/023_trade_lock_during_match.sql:147`](db/migrations/023_trade_lock_during_match.sql)
- [`db/migrations/024_trade_lock_scheduled_at.sql:156`](db/migrations/024_trade_lock_scheduled_at.sql)
- [`db/FULL_SETUP.sql:594`](db/FULL_SETUP.sql)

**Code actuel (incorrect) dans les 3 fichiers :**
```sql
v_fee := ROUND(v_price * p_quantity * CASE WHEN v_is_cap THEN 0.05 ELSE 0.10 END, 1);
```

`v_is_cap` vaut `(current_day_index <= 22)` — c'est-à-dire `TRUE` pendant la phase groupes+R32. La condition `THEN 0.05` applique donc 5% sur la phase groupes, alors que le taux correct est 10%.

**Référence — `onlineGameStore.ts:333` (correct) :**
```typescript
const isKO = currentDay?.is_ko ?? (s.dayIndex >= 17);
const fee  = isElim || price <= 1
  ? 0
  : Math.max(gross * (isKO ? 0.05 : 0.10), 10);
```

Traduction : groupes (`isKO = false`) → 10%, phase KO (`isKO = true`) → 5%.

### 2. Minimum 10 KC absent

Le SQL utilise `ROUND(...)` sans `GREATEST(fee, 10)`. Le store applique `Math.max(..., 10)`.

---

## Correction à apporter

### Migration à créer : `db/migrations/025_fix_sell_tax_rates.sql`

```sql
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 025: Fix sell tax rates in execute_competition_trade.
--
-- Bug introduced in migrations 023 and 024:
--   CASE WHEN v_is_cap THEN 0.05 ELSE 0.10 END
-- applies 5% during the group+R32 cap phase, which is the opposite of the
-- intended logic (groups = 10%, KO = 5%, aligned with onlineGameStore.ts).
--
-- Also adds the missing minimum fee of 10 KC per transaction.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION execute_competition_trade(
  -- [copier intégralement la signature de la migration 024]
  -- Seule modification : bloc SELL ci-dessous
)
-- [copier le corps de la migration 024]
-- Remplacer uniquement la ligne du calcul de v_fee dans ELSIF p_mode = 'sell' :

-- AVANT (bugué) :
--   v_fee := ROUND(v_price * p_quantity * CASE WHEN v_is_cap THEN 0.05 ELSE 0.10 END, 1);

-- APRÈS (correct) :
--   v_fee := GREATEST(
--     ROUND(v_price * p_quantity * CASE WHEN v_is_cap THEN 0.10 ELSE 0.05 END, 1),
--     10
--   );
```

> **Important :** La migration 025 doit remplacer intégralement la fonction `execute_competition_trade` (pas un ALTER partiel). Copier le corps complet de la migration 024, modifier uniquement la ligne `v_fee`.

### Mise à jour de `db/FULL_SETUP.sql`

Appliquer la même correction à la ligne 594 du `FULL_SETUP.sql` (l'ancien `execute_trade` pour la compatibilité monorepo).

---

## Tests de non-régression

### Tests automatisés à ajouter dans `packages/game-engine/src/engine.test.ts`

Bien que `calcTax` soit une fonction TS (offline), ces cas documentent le contrat métier attendu et servent de référence pour les tests SQL.

```typescript
describe('calcTax — contrat métier (référence pour RPC SQL)', () => {
  // Groupes (is_ko = false)
  it('groupes 10% standard', () => expect(calcTax(200, 10, false)).toBe(200)); // 2000 * 10% = 200
  it('groupes minimum 10 KC', () => expect(calcTax(50, 1, false)).toBe(10));    // 50 * 10% = 5, min = 10
  it('groupes au-dessus du min', () => expect(calcTax(200, 1, false)).toBe(20)); // 200 * 10% = 20

  // KO (is_ko = true)
  it('KO 5% standard', () => expect(calcTax(200, 10, true)).toBe(100));         // 2000 * 5% = 100
  it('KO minimum 10 KC', () => expect(calcTax(100, 1, true)).toBe(10));          // 100 * 5% = 5, min = 10
  it('KO au-dessus du min', () => expect(calcTax(300, 1, true)).toBe(15));       // 300 * 5% = 15

  // Nation éliminée (price = 1)
  it('éliminée : fee = 0', () => expect(calcTax(100, 1, false, true)).toBe(0));
});
```

### Tests SQL à exécuter sur la DB de staging après la migration

Exécuter ces requêtes depuis le Supabase SQL Editor sur l'environnement de staging (remplacer `<competition_id>`, `<device_id>`, et les équipes par des valeurs existantes).

#### Prérequis de staging
```sql
-- Vérifier que la fonction est bien celle de la migration 025
SELECT pg_get_functiondef('execute_competition_trade'::regproc);
-- La ligne fee doit contenir GREATEST(..., 10) et CASE WHEN v_is_cap THEN 0.10 ELSE 0.05
```

#### TEST-NR-SQL-01 — Vente en phase groupes (jour ≤ 22) : taux 10%, min 10 KC

```sql
-- Mise en place : jour 5, équipe BRA à 200 KC, portefeuille = 10 actions
-- Simuler une vente de 10 × BRA à 200 KC
SELECT execute_competition_trade(
  <competition_id>, '<device_id>', 'BRA', 'sell', 10
);
-- Résultat attendu :
-- { "ok": true, "fee": 200, "total": 1800, "new_cash": <cash + 1800> }
-- fee = 10 * 200 * 0.10 = 200 KC ✓
-- new_cash = cash_initial + 1800 KC ✓
```

#### TEST-NR-SQL-02 — Vente en phase groupes : minimum 10 KC

```sql
-- Mise en place : jour 3, équipe ESP à 50 KC, portefeuille = 1 action
SELECT execute_competition_trade(
  <competition_id>, '<device_id>', 'ESP', 'sell', 1
);
-- Résultat attendu :
-- { "ok": true, "fee": 10, "total": 40, "new_cash": <cash + 40> }
-- 1 * 50 * 0.10 = 5 KC → min = 10 KC ✓
-- new_cash = cash_initial + 40 KC ✓
```

#### TEST-NR-SQL-03 — Vente en phase KO (jour > 22) : taux 5%, min 10 KC

```sql
-- Mise en place : forcer current_day_index > 22
UPDATE competition_game_state SET current_day_index = 25 WHERE competition_id = <competition_id>;

SELECT execute_competition_trade(
  <competition_id>, '<device_id>', 'GER', 'sell', 10
);
-- Résultat attendu (GER à 200 KC) :
-- { "ok": true, "fee": 100, "total": 1900, "new_cash": <cash + 1900> }
-- fee = 10 * 200 * 0.05 = 100 KC ✓

-- Restaurer
UPDATE competition_game_state SET current_day_index = <valeur_initiale> WHERE competition_id = <competition_id>;
```

#### TEST-NR-SQL-04 — Vente en phase KO : minimum 10 KC

```sql
-- Mise en place : jour 25, équipe ARG à 80 KC, portefeuille = 1 action
SELECT execute_competition_trade(
  <competition_id>, '<device_id>', 'ARG', 'sell', 1
);
-- Résultat attendu :
-- { "ok": true, "fee": 10, "total": 70, "new_cash": <cash + 70> }
-- 1 * 80 * 0.05 = 4 KC → min = 10 KC ✓
```

#### TEST-NR-SQL-05 — Vente d'une équipe éliminée : fee = 0

```sql
-- Mise en place : HAI dans eliminated[]
UPDATE competition_game_state
  SET eliminated = array_append(eliminated, 'HAI')
  WHERE competition_id = <competition_id>;

SELECT execute_competition_trade(
  <competition_id>, '<device_id>', 'HAI', 'sell', 5
);
-- Résultat attendu (HAI à 1 KC) :
-- { "ok": true, "fee": 0, "total": 5, "new_cash": <cash + 5> }
-- Nation éliminée → fee = 0, pas de minimum ✓

-- Restaurer
UPDATE competition_game_state
  SET eliminated = array_remove(eliminated, 'HAI')
  WHERE competition_id = <competition_id>;
```

#### TEST-NR-SQL-06 — Achat non affecté par le correctif

```sql
-- Vérifier que le BUY n'est pas impacté (fee achat = toujours 0)
SELECT execute_competition_trade(
  <competition_id>, '<device_id>', 'BRA', 'buy', 5
);
-- Résultat attendu :
-- { "ok": true, "fee": 0, "total": <5 * prix>, "new_cash": <cash - total> }
-- fee = 0 ✓ (le correctif ne touche que le SELL)
```

#### TEST-NR-SQL-07 — Cohérence store ↔ RPC après trade

```sql
-- Après une vente de 10 × BRA à 200 KC en groupes :
-- 1. Vérifier que transactions.fee = 200
SELECT fee, total FROM transactions
  WHERE portfolio_id = (
    SELECT id FROM portfolios WHERE device_id = '<device_id>' LIMIT 1
  )
  ORDER BY created_at DESC LIMIT 1;
-- fee attendu : 200 ✓, total attendu : 1800 ✓

-- 2. Vérifier que portfolios.cash = cash_avant + 1800
SELECT cash FROM portfolios WHERE device_id = '<device_id>';
```

### Test de non-régression frontend (manuel)

**Scénario :** Mode online, jour 5 (groupes), vendre 10 actions BRA à 200 KC.

1. Ouvrir le `TradeModal` en mode Vente, quantité = 10.
2. **Vérifier l'affichage des frais estimés** : 200 KC (10%), net = 1 800 KC.
3. Confirmer le trade.
4. **Vérifier `store.cash`** immédiatement après : `cash_avant + 1 800 KC`.
5. Si `result.newCash` est retourné par le RPC → `store.cash = result.newCash` prime sur le calcul optimiste.
6. Ouvrir la DB (Supabase Dashboard → Table Editor → `transactions`) : `fee = 200`, `total = 1800`.

**Après correctif SQL :** store (10%) et RPC (10%) sont alignés. Avant : store affichait 200 KC de frais mais le RPC ne prélevait que 100 KC → `result.newCash` écrasait le calcul optimiste avec une valeur incorrecte.

---

## Checklist de déploiement

- [ ] Créer `db/migrations/025_fix_sell_tax_rates.sql` (fonction complète)
- [ ] Mettre à jour `db/FULL_SETUP.sql` ligne 594 (même correctif)
- [ ] Exécuter la migration 025 sur **staging** d'abord
- [ ] Exécuter TEST-NR-SQL-01 à TEST-NR-SQL-07 sur staging
- [ ] Vérifier TEST-NR-SQL-06 (achat inchangé)
- [ ] Exécuter la migration 025 sur **prod** en période creuse (aucun match en cours)
- [ ] Vérifier en prod avec un trade de vente réel après déploiement
- [ ] Ajouter les cas `calcTax` manquants dans `engine.test.ts`

---

## Contexte de découverte

Bug détecté lors de l'exécution statique du test plan v3.1 (2026-06-20). Le bug était masqué car :

1. `BUG-TAX-ONLINE` avait été corrigé dans `onlineGameStore.ts` (optimistic update) — la correction utilisait `isKO ? 0.05 : 0.10` (correct).
2. La migration 023 avait introduit le calcul SQL avec `v_is_cap THEN 0.05` (incorrect) sans alignement sur le store corrigé.
3. La migration 024 a copié le même bug en reréécrivant la fonction.

La divergence n'était détectable qu'en comparant le SQL et le store côte à côte — `result.newCash` retourné par le RPC écrase l'optimistic update du store, donc c'est le RPC bugué qui prime en prod.
