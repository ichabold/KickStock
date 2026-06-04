# Rapport de Sécurité — KickStock
**Date :** 2026-05-26  
**Périmètre :** API Routes · Base de données Supabase · Auth · Variables d'environnement  
**Méthode :** Revue statique du code + analyse des politiques RLS + audit des flux de données

---

## ✅ Points Conformes

| Point | Statut | Détail |
|-------|--------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` côté serveur uniquement | ✅ Propre | Jamais importé dans un composant client ou fichier `'use client'` |
| Sessions Supabase Auth | ✅ Propre | `@supabase/ssr` utilise des cookies `HttpOnly`, `Secure`, `SameSite=Lax` — protégé contre XSS |
| PII dans les logs serveur | ✅ Propre | Aucune donnée personnelle loggée — uniquement les objets d'erreur |
| Atomicité des trades | ✅ Propre | `execute_trade` est un RPC `SECURITY DEFINER` PostgreSQL — garantie ACID (tout ou rien) |
| `NEXT_PUBLIC_` prefix | ✅ Propre | Seules `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` sont exposées au client |
| Stockage localStorage | ✅ Propre | Uniquement le `device_id` UUID anonyme — aucun token d'auth |

---

## 🔴 CRITIQUE-1 : `/api/game/advance` accessible sans authentification

**Fichier :** `apps/web/app/api/game/advance/route.ts`  
**Catégorie :** Absence d'autorisation — Manipulation d'état global  
**Exploitabilité :** Triviale, sans prérequis

### Description
N'importe quel client HTTP anonyme peut avancer le jeu pour **tous les joueurs simultanément**, en boucle, sans aucune restriction. La seule protection en place est un verrou CAS (`advancing=true`) qui se libère automatiquement après chaque avancement — un attaquant attend simplement la libération et rappelle immédiatement.

### Scénario d'attaque
```bash
# Détruire tous les portefeuilles de tous les joueurs en < 30 secondes
while true; do
  DAY=$(curl -s https://kickstock.app/api/game/state \
    -H "X-Device-ID: fake-id" | jq .dayIndex)
  curl -s -X POST https://kickstock.app/api/game/advance \
    -H "Content-Type: application/json" \
    -H "X-Device-ID: fake-id" \
    -d "{\"dayIndex\": $DAY}"
done
```
**Résultat :** toutes les équipes éliminées en quelques secondes, tous les portefeuilles liquidés à 1 KC/action, tournoi terminé avant que les joueurs puissent réagir.

### Correction recommandée

**Étape 1 — Ajouter la variable d'environnement `ADVANCE_SECRET` sur Vercel :**
```
ADVANCE_SECRET=<générer avec: openssl rand -hex 32>
```

**Étape 2 — Protéger la route :**
```typescript
// apps/web/app/api/game/advance/route.ts — au début du handler POST
const secret = req.headers.get('X-Advance-Secret');
if (secret !== process.env.ADVANCE_SECRET) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Étape 3 — Envoyer le secret depuis le client :**
```typescript
// apps/web/lib/api.ts — dans apiAdvanceDay()
headers: {
  'Content-Type': 'application/json',
  'X-Device-ID': deviceId,
  'X-Advance-Secret': process.env.NEXT_PUBLIC_ADVANCE_SECRET ?? '',
}
```
> Note : `NEXT_PUBLIC_ADVANCE_SECRET` est côté client — pour une protection maximale, réserver le bouton "Simuler" aux utilisateurs authentifiés avec un rôle `admin`.

---

## 🔴 CRITIQUE-2 : RLS `portfolios_select_device` expose tous les portefeuilles anonymes

**Fichier :** `db/FULL_SETUP.sql` — politique `portfolios_select_device`  
**Catégorie :** Broken Access Control — Fuite de données de masse  
**Exploitabilité :** Triviale avec la clé anon publique (visible dans le navigateur)

### Description
```sql
-- ⚠️ VULNÉRABLE : la condition s'évalue à TRUE pour toutes les lignes anonymes
CREATE POLICY "portfolios_select_device"
  ON portfolios FOR SELECT
  USING (user_id = auth.uid() OR device_id IS NOT NULL);
```
`device_id IS NOT NULL` n'est pas scopé à la session — c'est un prédicat de ligne. Comme chaque portefeuille anonyme a un `device_id` défini, **tous les portefeuilles anonymes sont lisibles par n'importe quel client**.

### Scénario d'attaque
```javascript
// Depuis la console du navigateur — clé anon visible dans le code source
import { createClient } from '@supabase/supabase-js';
const sb = createClient(PUBLIC_URL, PUBLIC_ANON_KEY); // clé publique
const { data } = await sb.from('portfolios').select('*');
// Retourne TOUS les portefeuilles : cash, avg_cost, tx_log, device_id
console.log(data); // Jackpot — accès total à tous les comptes anonymes
```

### Correction recommandée

**Dans le SQL Editor Supabase :**
```sql
-- Supprimer la politique vulnérable
DROP POLICY IF EXISTS "portfolios_select_device" ON portfolios;

-- Les lectures de portfolio passent uniquement par le client admin (routes API serveur).
-- Aucune politique SELECT via la clé anon n'est nécessaire — ne pas en recréer une.
```
Tous les accès portfolio passent déjà par le service role dans les routes API — cette politique est superflue et dangereuse.

---

## 🟠 HAUTE-1 : Hijacking de portefeuille via `X-Device-ID`

**Fichiers :** `apps/web/app/api/trade/route.ts:26` · `apps/web/app/api/game/state/route.ts:21`  
**Catégorie :** Usurpation d'identité — Account Takeover  
**Exploitabilité :** Élevée si combinée avec CRITIQUE-2

### Description
`X-Device-ID` est un header HTTP arbitraire, **non signé et non authentifié**. Le serveur le fait confiance sans validation ni liaison à une session cryptographique. Quiconque connaît le `device_id` d'un joueur peut :
1. Lire son portfolio complet via `/api/game/state`
2. Exécuter des trades en son nom via `/api/trade`

CRITIQUE-2 fournit le vecteur d'accès : en dumpant tous les portfolios, un attaquant récupère tous les `device_id` en clair.

### Scénario d'attaque
```bash
# Étape 1 : récupérer les device_id via CRITIQUE-2
curl https://SUPABASE_URL/rest/v1/portfolios?select=device_id \
  -H "apikey: ANON_KEY" -H "Authorization: Bearer ANON_KEY"

# Étape 2 : vider le portefeuille de la victime
VICTIM_DEVICE="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
curl -X POST https://kickstock.app/api/trade \
  -H "X-Device-ID: $VICTIM_DEVICE" \
  -H "Content-Type: application/json" \
  -d '{"nationId":"BRA","mode":"sell","quantity":9999}'
```

### Correction recommandée
```typescript
// apps/web/app/api/trade/route.ts — validation du format UUID
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(deviceId ?? '')) {
  return NextResponse.json({ error: 'Invalid device ID' }, { status: 400 });
}

// Pour les utilisateurs connectés : ignorer device_id, utiliser uniquement userId
// (le RPC execute_trade priorise déjà user_id si fourni)
```
> Solution long terme : lier le `device_id` à un cookie HttpOnly signé côté serveur plutôt qu'à `localStorage`.

---

## 🟠 HAUTE-2 : Vue `leaderboard` expose les UUID internes de portfolios

**Fichier :** `db/FULL_SETUP.sql` — vue `leaderboard`  
**Catégorie :** Fuite de données — pivot d'attaque  
**Exploitabilité :** Triviale via la clé anon publique

### Description
```sql
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  p.id,   -- ⚠️ portfolios.id (UUID interne) exposé publiquement
  COALESCE(pr.username, 'Anonyme') AS username,
  ...
```
`p.id` est la clé primaire du portfolio. Ce UUID n'est pas nécessaire côté client mais constitue un pivot pour cibler des portfolios spécifiques dans d'autres attaques.

### Correction recommandée

**Dans le SQL Editor Supabase :**
```sql
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  -- p.id retiré — inutile côté client, réduit la surface d'attaque
  COALESCE(pr.username, 'Anonyme') AS username,
  pr.country,
  p.best_score,
  p.updated_at
FROM portfolios p
LEFT JOIN profiles pr ON pr.id = p.user_id
WHERE p.best_score IS NOT NULL
ORDER BY p.best_score DESC;
```

---

## 🟡 MOYENNE : Messages d'erreur internes retournés au client

**Fichiers :** `api/trade/route.ts:67` · `api/game/advance/route.ts:272` · `api/game/state/route.ts:120`  
**Catégorie :** Information Disclosure  
**Exploitabilité :** Passive — révèle la structure interne en cas d'erreur

### Description
```typescript
// Pattern répété dans les 3 routes — peut exposer des détails PostgreSQL
return NextResponse.json(
  { error: err instanceof Error ? err.message : 'Internal error' },
  { status: 500 }
);
```
En cas d'erreur de contrainte PostgreSQL, le message peut contenir des noms de tables, colonnes ou contraintes (ex: `duplicate key value violates unique constraint "portfolio_identity_check"`).

### Correction recommandée
```typescript
// Pattern sécurisé pour tous les catch d'API route
} catch (err) {
  console.error('[POST /api/trade]', err); // détail complet côté serveur
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

---

## Plan d'action priorisé

| Priorité | Vulnérabilité | Effort estimé | Où agir |
|----------|--------------|---------------|---------|
| 🔴 **1** | Protéger `/api/game/advance` avec un secret | 15 min | Code + Vercel env vars |
| 🔴 **2** | Corriger la politique RLS `portfolios_select_device` | 5 min | SQL Editor Supabase |
| 🟠 **3** | Valider le format UUID du `X-Device-ID` | 10 min | `api/trade/route.ts` |
| 🟠 **4** | Retirer `p.id` de la vue `leaderboard` | 5 min | SQL Editor Supabase |
| 🟡 **5** | Génériciser les messages d'erreur 500 | 20 min | Les 3 routes API |

---

## Commandes SQL à exécuter immédiatement (Supabase SQL Editor)

```sql
-- ① Corriger la fuite RLS (CRITIQUE-2)
DROP POLICY IF EXISTS "portfolios_select_device" ON portfolios;

-- ② Retirer l'UUID du leaderboard (HAUTE-2)
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  COALESCE(pr.username, 'Anonyme') AS username,
  pr.country,
  p.best_score,
  p.updated_at
FROM portfolios p
LEFT JOIN profiles pr ON pr.id = p.user_id
WHERE p.best_score IS NOT NULL
ORDER BY p.best_score DESC;

-- ③ Vérification finale
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'portfolios'
ORDER BY policyname;
```
