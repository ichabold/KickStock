# KickStock — Auth Q&A : Réponses aux 26 questions

Chaque réponse suit le format : **Décision → Justification → Référence technique si nécessaire.**

---

## Questions 1 à 15

---

**Q1 — Le guest doit-il obligatoirement choisir un pseudo avant de jouer ?**

**Oui, c'est obligatoire.** Le bouton "JOUER MAINTENANT" reste disabled tant que le pseudo est invalide.

Justification : sans pseudo, le leaderboard est inutilisable (lignes anonymes), et l'engagement est nul — un joueur sans identité ne revient pas. Taper 4 caractères prend 3 secondes, la règle des 10 secondes tient.

---

**Q1b — Ce pseudo pourra-t-il être modifié plus tard ?**

**Non en Phase 1 (MVP).** Fonctionnalité à prévoir en Phase 2 avec vérification d'unicité et mise à jour de `portfolios.guest_username`.

Justification : modifier un pseudo impacte l'historique leaderboard et demande une logique de validation qu'on ne veut pas gérer maintenant.

---

**Q2 — Où stocke-t-on le pseudo du guest ?**

**Colonne `guest_username` séparée sur `portfolios`** (pas de `username` commun avec les comptes).

Justification : les comptes enregistrés ont leur username dans `profiles.username` (lié à `auth.users`). Mélanger les deux dans une colonne unique créerait de l'ambiguïté dans les RLS et les requêtes. Deux colonnes distinctes = deux cas clairs.

```sql
-- Migration 006
ALTER TABLE portfolios ADD COLUMN guest_username TEXT;
-- Les comptes registered → profiles.username
-- Les guests → portfolios.guest_username
```

---

**Q3 — Le pseudo guest doit-il être unique ?**

**Voir Q26 — décision finale : unique.** Le brief initial disait non-unique + discriminateur, mais voir l'analyse en fin de document.

---

**Q3b — Si unique, que faire si le pseudo est déjà pris ?**

**Message d'erreur inline + suggestion automatique.** L'API retourne `{ taken: true, suggestion: "Zidane92" }` (suffixe numérique 2 chiffres aléatoires).

Justification : bloquer sans alternative = frustration. Proposer une variante = résolution en 1 clic.

```typescript
// POST /api/auth/guest
// Si pseudo pris → retourne suggestion
const suggestion = `${pseudo}${Math.floor(10 + Math.random() * 90)}`
```

---

**Q4 — Comment gérer la validation d'unicité à la saisie ?**

**Appel API au `blur` du champ** (quand l'utilisateur quitte le champ), pas au keystroke.

Justification : debounce sur keystroke = plusieurs appels inutiles. Au `blur` = 1 seul appel, au moment où l'utilisateur a fini de taper. Latence imperceptible (< 200ms sur Supabase).

```typescript
onBlur={() => {
  if (isValidFormat(pseudo)) checkAvailability(pseudo)
}}
```

---

**Q5 — Le guest joue-t-il avec les mêmes conditions que les comptes enregistrés ?**

**Oui, exactement les mêmes.** 10 000 KC de départ, même moteur de jeu, mêmes dividendes, même leaderboard.

Justification : deux niveaux de jeu (guest "dégradé" vs compte "complet") créent de la confusion et du ressentiment. Le guest doit avoir envie de créer un compte pour la portabilité, pas parce que le jeu est moins bon en invité.

---

**Q6 — Sécurité du `device_id` : risque d'usurpation ?**

**UUID v4 aléatoire = obscurité suffisante.** Pas de JWT côté guest pour le MVP.

Justification : un `device_id` est un UUID 128 bits (2^122 combinaisons). La probabilité de collision accidentelle ou de brute force est négligeable. La monnaie du jeu n'a aucune valeur réelle — le coût d'une usurpation est nul. Les RPCs `SECURITY DEFINER` ajoutent une couche serveur. JWT = overhead injustifié pour ce contexte.

---

**Q7 — La migration guest → compte Google migre-t-elle tout ?**

**Oui, migration complète** : portfolio, holdings, transactions, dividends, best_score.

La RPC `migrate_guest_to_user(device_id, user_id)` doit faire :

```sql
UPDATE portfolios
SET user_id = p_user_id
WHERE device_id = p_device_id
  AND user_id IS NULL;
-- Holdings, transactions, dividends sont liés par portfolio_id (FK cascade) → rien à migrer
-- Le portfolio_id ne change pas, seul user_id est ajouté
```

Holdings, transactions et dividends sont liés par `portfolio_id` via clé étrangère — ils suivent automatiquement sans update supplémentaire.

---

**Q8 — Guest sur un autre device : que se passe-t-il ?**

**Nouveau portfolio vide, sans message d'erreur — mais l'onboarding l'annonce clairement.**

Le `device_id` de l'autre device est inconnu → `get_or_create_portfolio` crée un nouveau portfolio à 10 000 KC. Pas de récupération possible.

C'est par design : cette situation est le principal argument de vente pour créer un compte. Le message dans l'onboarding doit être irréfutable :

> ⚠ Ta progression sera sauvegardée sur ce navigateur uniquement. Si tu changes de device ou effaces ton cache, ta progression sera perdue définitivement.

---

**Q9 — Que faire si le guest efface son localStorage ?**

**Perte définitive, pas de récupération.** Le `device_id` est l'unique clé d'accès au portfolio guest — sans lui, le portfolio est orphelin en base.

Justification : implémenter une récupération (email, cookie cross-domain, fingerprint) est complexe, peu fiable, et soulève des problèmes RGPD. La solution correcte est de créer un compte. L'avertissement dans l'onboarding est la seule mitigation nécessaire.

---

**Q10 — Pas de ligne dans `auth.users` pour le guest : comment les RLS fonctionnent-elles ?**

**Les RPCs sont `SECURITY DEFINER` → elles bypassent entièrement le RLS.** Les guests n'ont pas besoin de passer par RLS.

Les routes API Next.js utilisent le `SUPABASE_SERVICE_ROLE_KEY` (admin client) pour appeler les RPCs. Le RLS s'applique uniquement aux requêtes directes depuis le client browser. Le guest ne fait jamais de requête directe à Supabase — tout passe par les routes API Next.js qui utilisent le service role.

```
Guest browser → POST /api/trade { deviceId } → Next.js API (service role) → RPC execute_trade → RLS bypassed
```

---

**Q11 — Discriminateur dans le leaderboard : nécessaire pour le MVP ?**

**Non, pas pour le MVP.** Implémenter le badge `GUEST` oui, le discriminateur `#a3f2` non.

Justification : avec peu d'utilisateurs au lancement, les collisions de pseudo seront rares. Ajouter la logique de discriminateur (génération, stockage conditionnel, affichage) pour un problème qui n'existe pas encore est du sur-engineering. À implémenter en v1.1 si les collisions deviennent réelles.

**MVP : badge GUEST uniquement.** Si deux "Zidane" apparaissent dans le leaderboard, ce n'est pas bloquant. (Contradictoire avec la décision Q3 de rendre les pseudos uniques — voir Q26 pour trancher définitivement.)

---

**Q12 — Un guest peut-il changer son pseudo après création ?**

**Non en Phase 1.** L'option sera ajoutée en Phase 2 dans les paramètres du compte.

---

**Q13 — Perte du localStorage : faut-il proposer une récupération ?**

**Non.** L'avertissement dans l'onboarding est la seule mitigation. Pas d'email de récupération pour les guests.

Justification : un guest sans email connu = pas de canal de récupération. Implémenter un système de récupération alternatif (fingerprint, cookie tiers) crée des obligations RGPD disproportionnées. La perte est le coût assumé du mode invité.

---

**Q14 — Un guest a-t-il accès à toutes les fonctionnalités ?**

**Oui, toutes les fonctionnalités de jeu** : trading, dividendes, leaderboard, historique de transactions. Pas de fonctionnalités sociales (commentaires, partages) car elles ne sont pas dans le scope actuel pour personne.

Modération des pseudos : validation regex côté client + côté serveur (`[a-zA-Z0-9_-]`, 3–20 chars). Pas de filtre de profanité pour le MVP — overkill pour un jeu en accès limité. À ajouter si ouverture publique large.

---

**Q15 — Combien de temps conserve-t-on les données guest ?**

**Politique : 6 mois d'inactivité = suppression.** Mise en œuvre hors MVP.

```sql
-- Cron Supabase (pg_cron, post-MVP)
DELETE FROM portfolios
WHERE user_id IS NULL
  AND updated_at < NOW() - INTERVAL '6 months';
```

Pour le MVP : pas de purge. Les données s'accumulent. À implémenter avant l'ouverture publique large.

---

## Nouvelles questions (Q16–Q25)

---

**Q16 — Conflit de progression (deux portfolios actifs) : UI de choix ou règle automatique ?**

**Règle automatique pour le MVP : on garde le portfolio avec le meilleur `best_score`.** Pas d'UI de choix.

Justification : ce cas requiert que l'utilisateur ait joué en guest sur device A, créé un compte Google depuis device B, PUIS revienne sur device A avec le même compte Google. Probabilité très faible au lancement. Une UI de choix complète (affichage des deux portfolios, confirmation, suppression de l'autre) est 3 jours de dev pour un cas marginal. La règle "on garde le meilleur score" est juste et explicable.

```sql
-- Dans migrate_guest_to_user : si user_id a déjà un portfolio
-- Comparer best_score, garder le plus élevé, supprimer l'autre
-- + Toast informatif côté client
```

L'UI de choix est documentée dans le brief pour la Phase 2.

---

**Q17 — Règles précises de validation du pseudo ?**

| Règle | Valeur |
|---|---|
| Longueur min | 3 caractères |
| Longueur max | 20 caractères |
| Caractères autorisés | `[a-zA-Z0-9_-]` |
| Espaces | Interdits |
| Emojis | Interdits |
| Ponctuation | Interdite (sauf `_` et `-`) |
| Début/fin | Ne peut pas commencer ou finir par `_` ou `-` |
| Sensible à la casse | Stocké tel quel, comparaison case-insensitive pour l'unicité |
| Mots réservés | `admin`, `kickstock`, `moderator`, `system` (liste courte) |

Regex côté client et serveur :
```typescript
const PSEUDO_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,18}[a-zA-Z0-9]$/
// Minimum 3 chars, pas de _ ou - en début/fin
```

---

**Q18 — Deux guests peuvent-ils avoir le même `device_id` ?**

**Non, et la contrainte DB l'enforce déjà.** UUID v4 → 2^122 combinaisons, collision accidentelle impossible en pratique. La contrainte `UNIQUE(device_id)` sur `portfolios` (déjà dans le schéma actuel) garantit l'intégrité côté base.

---

**Q19 — Un guest peut-il avoir plusieurs portfolios sur le même device ?**

**Non.** La contrainte `UNIQUE(device_id)` sur `portfolios` l'empêche au niveau DB. La RPC `get_or_create_portfolio` fait un `INSERT ... ON CONFLICT DO NOTHING` + `SELECT` — idempotente par design.

---

**Q20 — Leaderboard mélangé (guests + comptes) ou classements séparés ?**

**Mélangé, sans filtre.** Un seul leaderboard avec badge `GUEST` pour distinguer.

Justification : séparer les classements divise l'audience et réduit la motivation de chacun. Un guest qui voit qu'il bat des comptes enregistrés est le meilleur argument pour s'inscrire. Filtre "comptes uniquement" à prévoir en Phase 2 si demandé.

---

**Q21 — Comment sécuriser les routes API appelées par le guest ?**

**UUID obscurité = suffisant pour un jeu.** Pas de JWT guest.

Le `device_id` est transmis via header `X-Device-ID`. C'est une donnée de 128 bits non-devinable. Toute requête malveillante nécessiterait de connaître l'UUID exact d'une victime cible — impraticable. Les RPCs `SECURITY DEFINER` côté Supabase ajoutent une validation serveur. Si un joueur devine le device_id d'un autre, il peut au pire trader à sa place avec de la fausse monnaie — risque nul.

---

**Q22 — Un guest sans compte Google (MVP Phase 1) : que faire ?**

**Reste guest.** Les boutons Email et Apple sont visibles avec label "Bientôt disponible" mais non fonctionnels. Pas de message d'erreur — juste un état visuellement désactivé.

Justification : forcer les non-Google à attendre Phase 2/3 est acceptable si c'est clairement communiqué dans l'onboarding. Cacher les options serait frustrant ("est-ce que ça existe ?"). Les montrer désactivées informe sans bloquer.

---

**Q23 — Comment tester la migration guest → Google en local ?**

**Variable d'environnement `NEXT_PUBLIC_SITE_URL` + callback dans Google Cloud Console.**

Checklist locale :
```bash
# .env.local
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Dans Google Cloud Console → Authorized redirect URIs :
```
http://localhost:3000/auth/callback
https://[votre-domaine-prod].com/auth/callback
```

Dans Supabase Dashboard → Auth → URL Configuration :
```
Site URL: http://localhost:3000
Redirect URLs: http://localhost:3000/auth/callback
```

---

**Q24 — Réseau coupé pendant la migration guest → compte ?**

**Le portfolio reste en état guest. Message "Réessaie plus tard."**

La RPC `migrate_guest_to_user` est atomique (une seule transaction SQL). Soit elle réussit complètement, soit elle échoue sans effet. Pas d'état partiel possible. En cas d'échec réseau :
1. Le portfolio reste lié à `device_id` uniquement
2. Toast côté client : "Migration échouée. Ton profil invité est intact."
3. L'utilisateur peut réessayer en re-cliquant "Créer un compte"

Pas de verrouillage du portfolio pendant la migration.

---

**Q25 — Mode invité anonyme sans pseudo (nom aléatoire type "Joueur#1234") ?**

**Non.** Le pseudo est obligatoire (voir Q1).

Justification : un nom auto-généré type "Joueur#1234" n'engage pas l'utilisateur — il ne s'identifie pas à son avatar. Le pseudo est le premier acte d'appropriation du jeu. 3 secondes de friction valent un joueur qui revient voir son score. Les pseudos auto-générés feraient aussi exploser les collisions dans le leaderboard, rendant inutile le discriminateur.

---

## Q26 — Question piège : non-unique + discriminateur vs unique + validation

**Décision finale : Option B — Pseudo unique, validation au blur.**

### Analyse honnête

| Critère | Option A (non-unique + `#a3f2`) | Option B (unique + validation) |
|---|---|---|
| Dev nécessaire | Génération discriminateur, stockage conditionnel, logique d'affichage au leaderboard, tests | 1 appel API au blur, contrainte UNIQUE, message d'erreur + suggestion |
| Jours de dev estimés | ~2 jours | ~2h |
| Friction utilisateur | Nulle à la saisie, mais confusion dans le leaderboard ("Zidane" vs "Zidane#a3f2") | Très faible (1 retry si pseudo pris, suggestion auto) |
| Clarté leaderboard | Faible (deux "Zidane" + discriminateurs) | Haute (chaque pseudo est unique) |
| Risque pour deadline 9 juin | Élevé (complexité cachée) | Faible |

### Pourquoi le brief disait non-unique — et pourquoi c'était faux

L'argument "zéro friction" tient si les pseudos sont toujours disponibles. Mais avec un leaderboard mélangé guests + comptes + pseudos libres, les collisions arriveront vite. Le discriminateur résout la confusion leaderboard mais la crée à la saisie ("pourquoi je vois #a3f2 après mon nom ?"). Ce n'est pas une meilleure UX.

### Décision

**Option B. Pseudo unique, case-insensitive.** Au blur, 1 appel `GET /api/auth/check-pseudo?q=Zidane` → `{ available: boolean, suggestion?: string }`. Si pris, erreur inline + suggestion "Zidane92". La suggestion permet un retry en 1 clic. Le leaderboard est propre. Le dev est trivial.

Le pseudo guest et le username des comptes enregistrés partagent le même espace de noms (UNIQUE cross-table ou contrainte applicative). À préciser dans la migration SQL.
