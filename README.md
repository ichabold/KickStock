# KickStock 🏆

> Bourse fictive de la Coupe du Monde FIFA 2026 — Monorepo Next.js

## Structure

```
kickstock/
├── apps/
│   └── web/                    ← Next.js 14 (App Router)
│       ├── app/                ← Pages (layout, page)
│       ├── components/
│       │   ├── mobile/         ← Shell mobile (< 600px)
│       │   ├── browser/        ← Shell desktop (≥ 600px)
│       │   └── shared/         ← NationCard, TradeModal, Ticker
│       ├── hooks/              ← useLayout
│       ├── stores/             ← Zustand (gameStore)
│       └── styles/             ← globals.css + CSS Modules
└── packages/
    ├── types/                  ← Types TypeScript partagés
    ├── constants/              ← 48 nations, calendrier, tokens
    └── game-engine/            ← applyResult, simulate, calcTax…
```

---

## Installation (Mac)

### Prérequis

```bash
# Node.js 18+
node --version   # doit afficher v18 ou v20+

# pnpm
npm install -g pnpm
pnpm --version   # doit afficher 8.x ou 9.x
```

### Lancer le projet

```bash
# 1. Aller dans le dossier (déjà copié dans Documents)
cd ~/Documents/kickstock

# 2. Installer toutes les dépendances
pnpm install

# 3. Démarrer le serveur de dev
pnpm dev

# 4. Ouvrir dans le navigateur
# → http://localhost:3000
```

---

## Fonctionnement (Phase 1)

- **Mobile (< 600px)** : layout identique au v16 JSX original — 4 onglets bas de page
- **Desktop (≥ 600px)** : layout 3 colonnes — calendrier | marché | portefeuille
- **Persistance** : `localStorage` clé `ks_p2` (same device, same browser)
- **Moteur de jeu** : extrait dans `packages/game-engine`, identique au v16

## Phase 2 (à venir)

1. Créer un projet Supabase → copier les clés dans `.env.local`
2. Appliquer les migrations SQL : `db/migrations/001_schema.sql` → `002_rls.sql` → `003_triggers.sql`
3. Seeder les 48 nations : `db/seed.sql`
4. Déployer sur Vercel : connecter le repo GitHub, configurer les variables d'environnement

---

## Design Tokens

| Token | Valeur | Usage |
|---|---|---|
| `--gold` | `#FFDB00` | Logo, prix, accent principal |
| `--gain` | `#00FF87` | Hausse, BUY, portefeuille positif |
| `--loss` | `#FF3B5C` | Baisse, SELL, élimination |
| `--bg`   | `#0A0A0A` | Fond principal |
| `--border` | `#1E1E1E` | Séparateurs |

Fonts : **Bebas Neue** (display) · **JetBrains Mono** (chiffres) · **Inter Tight** (corps)

---

## Règles du jeu

- Départ : **10 000 KC** (KickCoins)
- Achat/Vente : taxe **10%** en phase de groupes, **5%** en KO (minimum 10 KC)
- Dividendes : versés automatiquement à la qualification
  - R32 : +10% · R16 : +15% · QF : +20% · SF : +30% · Finale : +40% · Champion : +60%
- Prix bloqués 15 min avant et 30 min après chaque match (Phase 2)
- Équipes éliminées → prix tombe à **1 KC**

---

## Raccourcis dev

```bash
pnpm dev          # lance Next.js sur :3000
pnpm build        # build de production
pnpm type-check   # vérifie les types TypeScript
```
