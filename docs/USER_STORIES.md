# KickStock — User Stories

> Document de couverture fonctionnelle · Généré le 2 juin 2026
>
> **KickStock** est une bourse fictive de tournoi de football : les joueurs achètent et vendent des parts de sélections nationales, dont les prix évoluent en fonction des résultats réels ou simulés des matchs.
>
> **Principes fondateurs :** interface multilingue (FR/EN), play online ou offline au choix, support multi-tournoi dès le lancement, structure des compétitions entièrement pilotée via interface admin.

---

## Table des matières

1. [Onboarding & Authentification](#1-onboarding--authentification)
2. [Internationalisation (i18n)](#2-internationalisation-i18n)
3. [Sélection de compétition & Mode de jeu](#3-sélection-de-compétition--mode-de-jeu)
4. [Marché — Consultation des cours](#4-marché--consultation-des-cours)
5. [Marché — Trading](#5-marché--trading)
6. [Portfolio](#6-portfolio)
7. [Calendrier des matchs](#7-calendrier-des-matchs)
8. [Classements](#8-classements)
9. [Mode Simulation (offline)](#9-mode-simulation-offline)
10. [Mode Live (online)](#10-mode-live-online)
11. [Dividendes & Mécanique de prix](#11-dividendes--mécanique-de-prix)
12. [Fiche Équipe (Nation Detail)](#12-fiche-équipe-nation-detail)
13. [Leaderboard](#13-leaderboard)
14. [Onboarding UX — Tutorial & Coach Marks](#14-onboarding-ux--tutorial--coach-marks)
15. [UI Shell — Mobile & Desktop](#15-ui-shell--mobile--desktop)
16. [Administration — Gestion des compétitions](#16-administration--gestion-des-compétitions)
17. [Infrastructure & Monitoring](#17-infrastructure--monitoring)

---

## 1. Onboarding & Authentification

### Contexte
Un joueur peut jouer sans créer de compte (mode invité), puis migrer vers un compte permanent sans perdre sa progression. Deux voies d'authentification permanente coexistent : email/mot de passe et Google OAuth. L'interface s'adapte à la langue du navigateur dès le premier accès.

---

**US-1.1 · Jouer en invité**
> En tant que nouveau visiteur, je veux pouvoir commencer à jouer immédiatement sans créer de compte, afin de découvrir le jeu sans friction.

- Au premier lancement, une modale m'invite à choisir un pseudo (3–16 caractères alphanumériques/tirets).
- Mon pseudo est vérifié en temps réel (disponibilité + format).
- En cas de pseudo pris, une suggestion est proposée automatiquement.
- Un identifiant de device (`X-Device-ID`) est généré et persisté pour tracer mon état de jeu.
- Une protection Cloudflare Turnstile (invisible) est appliquée à la soumission.
- Mon pseudo est sauvegardé en `localStorage` pour les sessions suivantes.

---

**US-1.2 · Créer un compte email**
> En tant qu'invité, je veux créer un compte email/mot de passe pour sécuriser ma progression et figurer au leaderboard.

- Je clique sur "Créer un compte" depuis le menu avatar.
- Je saisis email + mot de passe via la modale `EmailAuthModal`.
- Supabase Auth envoie un email de confirmation.
- Après confirmation, mon pseudo invité est transféré sur le compte.

---

**US-1.3 · Se connecter avec Google**
> En tant qu'utilisateur, je veux me connecter avec mon compte Google pour éviter de gérer un mot de passe.

- Depuis la modale d'auth, je clique sur "Continuer avec Google".
- Après le redirect OAuth, si j'étais déjà invité, ma progression est migrée (`ks_migrated=1`).
- Si c'est un nouveau compte, je suis invité à confirmer mon pseudo (`ks_new_user=1`).
- Si j'avais déjà un pseudo local, il est appliqué silencieusement via `AuthWidget`.

---

**US-1.4 · Migration invité → compte permanent**
> En tant qu'invité qui crée un compte, je veux conserver mon cash, mon portfolio et mon historique de trades.

- La migration est atomique côté serveur (RPC Supabase `SECURITY DEFINER`).
- Après migration, la modale `WelcomeModal` confirme le succès et me permet de valider mon pseudo.
- L'URL est nettoyée des paramètres `ks_migrated`, `ks_new_user`, `ks_pseudo`.

---

**US-1.5 · Réinitialiser son mot de passe**
> En tant qu'utilisateur enregistré, je veux pouvoir réinitialiser mon mot de passe si je l'ai oublié.

- Un lien "Mot de passe oublié ?" est accessible depuis la page de connexion `/login`.
- Un email de reset est envoyé via Supabase Auth.
- La page `/auth/reset-password` permet de définir le nouveau mot de passe.

---

**US-1.6 · Choisir ou modifier son pseudo**
> En tant que nouvel utilisateur authentifié, je veux choisir un pseudo unique visible sur le leaderboard.

- La disponibilité est vérifiée en temps réel (debounce 400 ms) via `/api/auth/check-pseudo`.
- Le format valide est : 3–16 caractères, lettres/chiffres/tirets.
- La mise à jour est persistée via `/api/auth/set-username`.

---

## 2. Internationalisation (i18n)

### Contexte
KickStock cible une audience internationale dès le lancement. La langue est détectée automatiquement via le navigateur ; le joueur peut la modifier à tout moment depuis le menu. Le support initial couvre le français et l'anglais, conçu pour être extensible.

---

**US-2.1 · Interface dans la langue du navigateur**
> En tant que nouveau visiteur, je veux que l'interface s'affiche automatiquement dans ma langue sans configuration manuelle.

- La langue est détectée via l'en-tête `Accept-Language` du navigateur au premier accès.
- Si la langue détectée est le français → locale `fr`. Sinon → locale `en` par défaut.
- Toutes les chaînes de l'interface (labels, messages d'erreur, tutoriels, coach marks) sont localisées via `next-intl`.

---

**US-2.2 · Changer de langue depuis le menu**
> En tant que joueur, je veux pouvoir changer de langue manuellement depuis l'interface, indépendamment de mon navigateur.

- Un sélecteur de langue (FR / EN) est accessible depuis le menu avatar.
- Le choix est persisté en `localStorage` et appliqué immédiatement sans rechargement complet.
- L'interface bascule intégralement : labels, nombres formatés, dates, messages.

---

**US-2.3 · Contenu localisé partout**
> En tant que joueur, je veux que chaque écran de l'application soit entièrement traduit, sans mélange de langues.

Périmètre couvert :
- Onglets de navigation (Marché / Market, Calendrier / Schedule, etc.)
- Modale de trade, messages d'erreur et codes retour API
- Tutorial (4 étapes) et coach marks (4 beats mobile, 4 beats desktop)
- Fiche équipe, standings, leaderboard
- Onboarding (modale guest, création de compte, migration)

---

**US-2.4 · Ajouter une nouvelle langue (extensibilité)**
> En tant qu'admin, je veux pouvoir ajouter une troisième langue sans modifier le code applicatif.

- Les traductions sont centralisées dans des fichiers JSON par locale.
- L'ajout d'une locale nécessite uniquement un nouveau fichier de traduction et une entrée dans la liste des locales supportées.

---

## 3. Sélection de compétition & Mode de jeu

### Contexte
KickStock supporte dès le lancement plusieurs tournois actifs simultanément (ex. WC 2026, EURO 2028…) et deux modes de jeu : **online** (vrais résultats, état partagé) et **offline** (simulation locale, résultats générés). Ces deux axes sont indépendants : un joueur peut jouer en offline sur n'importe quel tournoi disponible.

---

**US-3.1 · Voir les compétitions disponibles**
> En tant que joueur, je veux voir la liste des tournois actifs pour choisir auquel participer.

- Le sélecteur est accessible depuis le menu avatar.
- Chaque compétition affiche son nom, sa saison, ses dates et son état (à venir / en cours / terminé).
- Plusieurs compétitions peuvent être actives simultanément.

---

**US-3.2 · Changer de compétition**
> En tant que joueur, je veux basculer entre des tournois actifs sans perdre ma progression sur chacun.

- La compétition sélectionnée est persistée en `localStorage` (`kickstock:competition`).
- L'état de jeu de chaque compétition est strictement isolé : cash, portfolio, prix, résultats.
- Un changement de compétition recharge le store avec les données du tournoi choisi.

---

**US-3.3 · Choisir entre mode Online et mode Offline**
> En tant que joueur, je veux choisir de jouer avec les vrais résultats (live) ou en simulant moi-même les matchs, selon mes préférences.

- Le switch Online/Offline est accessible depuis le menu avatar.
- **Mode Online** : l'état de jeu est partagé entre tous les joueurs ; les prix bougent quand de vrais matchs se terminent.
- **Mode Offline** : l'état de jeu est local et privé ; le joueur simule les journées manuellement à son rythme.
- La préférence est mémorisée en `localStorage` (`kickstock:mode`).
- Passer d'online à offline (ou inversement) sur le même tournoi est possible ; les deux états sont maintenus indépendamment.

---

**US-3.4 · Chargement des données de la compétition**
> En tant que joueur, je veux que les équipes, le calendrier, les stades et les horaires se chargent automatiquement, sans donnée hardcodée dans l'application.

- `/api/competition/bootstrap` retourne : équipes (avec prix initial, force, groupe, logo), journées (label, phase, is_ko, div_key), fixtures de groupe (équipes A/B, stade, date/heure).
- Toute la structure du tournoi est issue de la base de données alimentée par l'admin (voir section 16).
- Le chargement affiche un état intermédiaire (skeleton). En cas d'échec, un message d'erreur est affiché.

---

## 4. Marché — Consultation des cours

### Contexte
L'onglet Marché liste toutes les équipes participantes avec leur prix courant et leur variation depuis le début de la compétition.

---

**US-3.1 · Consulter les prix courants**
> En tant que joueur, je veux voir le prix actuel de chaque équipe en KC (KickCoins) et sa variation depuis le prix initial.

- Chaque équipe est affichée avec : drapeau, code ISO, nom, prix courant en KC.
- La variation est affichée en % par rapport au prix initial (couleur verte / rouge).
- Les équipes éliminées sont visuellement marquées (opacité réduite, badge "ELIM").

---

**US-3.2 · Filtrer par groupe**
> En tant que joueur, je veux filtrer les équipes par groupe (A → L) pour analyser facilement un groupe spécifique.

- Des boutons de filtre "ALL / A / B / … / L" sont affichés au-dessus de la liste.
- Le filtre "ALL" est actif par défaut.
- Les groupes disponibles sont dérivés dynamiquement depuis les données de bootstrap.

---

**US-3.3 · Rechercher une équipe**
> En tant que joueur, je veux pouvoir rechercher une équipe par son nom ou son code pour la trouver rapidement.

- Un champ de recherche texte filtre la liste en temps réel.
- La recherche est insensible à la casse et fonctionne sur le nom ou l'ID de l'équipe.

---

**US-3.4 · Trier le marché**
> En tant que joueur, je veux trier les équipes selon différents critères pour identifier les meilleures opportunités.

Critères disponibles :
- **Défaut** : ordre alphabétique/groupe
- **Prix décroissant** : équipes les plus chères en premier
- **Prix croissant** : équipes les moins chères en premier
- **Performance** : variation % décroissante
- **Portefeuille** : équipes détenues en premier

---

**US-3.5 · Consulter le ticker en temps réel**
> En tant que joueur sur desktop, je veux voir un bandeau défilant (ticker) avec tous les prix pour suivre le marché d'un coup d'œil.

- Le ticker est affiché en haut du shell browser.
- Les équipes détenues dans le portfolio apparaissent en premier.
- Un clic sur une entrée du ticker ouvre la fiche détail de l'équipe.
- Les prix s'actualisent en sync avec le store Zustand.

---

## 5. Marché — Trading

### Contexte
Les joueurs achètent et vendent des parts d'équipes. Chaque transaction est soumise à une taxe. Un joueur démarre avec 10 000 KC. Les transactions des utilisateurs authentifiés sont atomiques côté serveur (RPC `execute_competition_trade`).

---

**US-4.1 · Acheter des parts d'une équipe**
> En tant que joueur, je veux acheter des parts d'une équipe pour parier sur sa progression dans le tournoi.

- Je clique sur "Acheter" sur une NationCard ou dans la fiche détail.
- La modale de trade s'ouvre avec le mode "buy" pré-sélectionné.
- Je saisis la quantité souhaitée.
- Le coût total (prix × quantité + taxe) est affiché avant confirmation.
- Si mon cash est insuffisant, l'achat est bloqué avec un message d'erreur (`INSUFFICIENT_FUNDS`).

---

**US-4.2 · Vendre des parts d'une équipe**
> En tant que joueur, je veux vendre tout ou partie de mes parts pour encaisser une plus-value ou limiter mes pertes.

- Je peux vendre depuis l'onglet Portfolio ou depuis la fiche détail.
- La quantité maximale vendable est affichée.
- Si je tente de vendre plus que détenu, la vente est bloquée.

---

**US-4.3 · Consulter le coût d'une transaction avant de valider**
> En tant que joueur, je veux voir le détail complet du coût avant de confirmer un trade.

- La modale affiche : prix unitaire courant, quantité, montant brut, taxe, montant net.
- Le cash restant après transaction est prévisualisé.

---

**US-4.4 · Taxe de transaction**
> En tant que joueur, je veux comprendre la structure de frais pour optimiser mes trades.

- **Phase de groupes** : 10% du montant, minimum 10 KC.
- **Phases KO** : 5% du montant, minimum 10 KC.
- **Équipes éliminées** (prix ≤ 1 KC) : 0% de taxe.
- La taxe s'applique aussi bien à l'achat qu'à la vente.

---

**US-4.5 · Blocage du marché en zone de match**
> En tant que joueur, je veux savoir quand le marché est verrouillé autour d'un match pour planifier mes trades.

- En mode live, chaque match a un `trade_lock_until` qui verrouille les trades peu avant le coup d'envoi.
- L'interface affiche un compte à rebours "Marché ouvert dans X min" (LiveTab).
- Les boutons Buy/Sell sont désactivés pendant le lock.

---

**US-4.6 · Plafonnd de concentration (anti-monopole)**
> En tant que joueur, je ne dois pas pouvoir détenir plus d'un certain pourcentage d'une équipe.

- Le RPC serveur bloque l'achat avec le code `CONCENTRATION_CAP` si le seuil est dépassé.
- L'erreur est affichée dans la modale de trade.

---

**US-4.7 · Interdiction de trader une équipe éliminée**
> En tant que joueur, je ne dois pas pouvoir acheter une équipe éliminée du tournoi.

- Les équipes éliminées n'ont plus de bouton "Acheter" actif.
- Un badge "ÉLIMINÉ" est affiché sur leur carte.
- Une tentative d'achat via l'API retourne `NATION_ELIMINATED`.

---

## 6. Portfolio

### Contexte
L'onglet Portfolio centralise l'état financier du joueur : cash disponible, parts détenues, P&L global et historique des transactions.

---

**US-5.1 · Voir la valeur totale de son portfolio**
> En tant que joueur, je veux voir en un coup d'œil la valeur totale de mon portefeuille (cash + positions ouvertes).

- Le "hero" affiche : valeur totale en KC, variation absolue et en % par rapport au capital investi.
- La couleur indique si le joueur est en gain (vert) ou en perte (rouge).

---

**US-5.2 · Voir le détail de ses positions**
> En tant que joueur, je veux voir chaque équipe détenue avec la quantité, le prix moyen d'achat, la valeur actuelle et le P&L.

- Chaque ligne affiche : drapeau, nom, quantité, prix actuel, prix moyen, valeur, P&L.
- Les positions sont triées par valeur décroissante.
- Les équipes éliminées sont signalées ; un encart d'avertissement est affiché si des positions sur éliminées existent.

---

**US-5.3 · Voir son cash disponible**
> En tant que joueur, je veux voir mon cash disponible pour savoir combien je peux encore investir.

- La ligne "Cash" est affichée dans la barre de stats sous le hero.

---

**US-5.4 · Voir son meilleur score**
> En tant que joueur, je veux voir mon meilleur score historique (en KC) pour suivre ma progression.

- Le "best score" est affiché dans l'onglet Portfolio si au moins un tournoi a été joué.
- Il est mis à jour automatiquement à la fin du tournoi si le score courant est supérieur.

---

**US-5.5 · Historique des transactions**
> En tant que joueur, je veux consulter mon historique de trades (direction, équipe, quantité, prix, jour).

- Le `txLog` est accessible dans l'onglet Portfolio (liste déroulante sous les positions).
- Chaque entrée affiche : BUY/SELL, drapeau, nom, quantité, prix, numéro de journée.

---

**US-5.6 · Vendre directement depuis le portfolio**
> En tant que joueur, je veux pouvoir vendre une position directement depuis l'onglet Portfolio sans changer d'onglet.

- Un bouton "Vendre" est présent sur chaque ligne de position détenue.
- Il ouvre la modale de trade en mode "sell" pré-rempli.

---

## 7. Calendrier des matchs

### Contexte
L'onglet Calendrier (Schedule) affiche l'intégralité des journées du tournoi, passées, en cours et à venir.

---

**US-6.1 · Voir toutes les journées du tournoi**
> En tant que joueur, je veux voir l'ensemble du calendrier pour planifier mes stratégies.

- Chaque journée est affichée sous forme de bloc : label complet (ex. "Day 1 · Thu Jun 11"), phase (Groups/R16/QF…).
- La journée courante est mise en avant (badge "NEXT", bordure dorée).
- Les journées passées ont un badge "PLAYED".

---

**US-6.2 · Voir les matchs d'une journée**
> En tant que joueur, je veux voir quels matchs ont lieu chaque jour avec les équipes impliquées.

- Pour les journées de groupes : les fixtures sont chargées depuis le bootstrap (pas hardcodées).
- Pour les phases KO futures : les adversaires sont déterminés dynamiquement selon les qualifications.
- Pour les journées passées : les résultats réels sont affichés (score + indicateur d'upset si surprise).

---

**US-6.3 · Consulter le détail d'un match joué**
> En tant que joueur, je veux voir le détail d'un match passé (score, buts, mouvement de prix) en cliquant dessus.

- La `MatchDetailOverlay` s'ouvre avec : score final, prolongations/tirs au but si applicable, variation de prix des deux équipes.

---

**US-6.4 · Identifier l'impact sur mes positions**
> En tant que joueur, je veux savoir si des matchs à venir impliquent des équipes que je détiens.

- Les équipes que je détiens sont mises en avant visuellement dans les blocs de match (police gold, badge).

---

## 8. Classements

### Contexte
L'onglet Standings affiche les classements de poules en phase de groupes, puis les résultats des phases KO.

---

**US-7.1 · Voir le classement de chaque groupe**
> En tant que joueur, je veux voir les classements de chaque groupe (points, différence de buts) pour anticiper les qualifications.

- Les 12 groupes (A → L) sont affichés sous forme de tableaux : rang, drapeau, nom, points, victoires, nuls, défaites, GD.
- Les 2 premiers qualifiés de chaque groupe sont mis en avant.
- Les classements sont calculés dynamiquement depuis les résultats simulés ou réels.

---

**US-7.2 · Voir les résultats des phases KO**
> En tant que joueur, je veux voir l'arbre des phases éliminatoires avec les scores.

- En phase KO, les sections R32, R16, QF, SF, Final, 3ème place s'affichent au fur et à mesure.
- Chaque match KO est cliquable pour voir son détail.

---

**US-7.3 · Voir le champion**
> En tant que joueur, je veux voir l'équipe championne mise en avant à la fin du tournoi.

- Un bloc "Champion" avec le drapeau et le nom de l'équipe est affiché en tête des Standings à la fin du tournoi.

---

**US-7.4 · Naviguer vers la fiche d'une équipe**
> En tant que joueur, je veux cliquer sur n'importe quelle équipe dans les Standings pour voir sa fiche.

- Un clic sur le nom ou le drapeau d'une équipe ouvre la `NationDetailOverlay`.

---

## 9. Mode Simulation (offline)

### Contexte
En mode offline, le jeu est entièrement local (store Zustand persisté en `localStorage`). Le joueur contrôle manuellement l'avancement du tournoi en simulant chaque journée.

---

**US-8.1 · Simuler la journée courante**
> En tant que joueur en mode simulation, je veux déclencher manuellement la journée de matchs pour voir les résultats.

- L'onglet Simulate affiche : label de la journée, matchs prévus, exposition portfolio.
- Un bouton "PLAY" déclenche la simulation via `/api/game/advance`.
- Le moteur génère des résultats probabilistes basés sur les forces FIFA des équipes (favoris gagnent plus souvent, surprises possibles).

---

**US-8.2 · Voir l'animation des résultats**
> En tant que joueur, je veux voir une animation des matchs joués pour rendre l'expérience immersive.

- La `MatchAnimation` joue chaque match séquentiellement (9 s par match, 5 s pour les prolongations).
- Les buts générés s'affichent avec le joueur fictif et la minute.
- Les tirs au but sont animés un à un.
- Un stinger "UPSET" s'affiche si une grosse surprise se produit.

---

**US-8.3 · Consulter les résultats après simulation**
> En tant que joueur, après une journée simulée, je veux voir tous les résultats et les impacts sur mes positions.

- La vue "done" affiche la liste des matchs avec scores, variation de prix (flèche ▲/▼), et dividendes touchés.
- Les matchs KO affichent la mention ET/PEN si applicable.

---

**US-8.4 · Recommencer une partie**
> En tant que joueur, je veux recommencer une nouvelle partie depuis zéro une fois le tournoi terminé.

- À la fin du tournoi (plus de journée à jouer), un bouton "Nouvelle Partie" est affiché.
- La remise à zéro restaure : cash 10 000 KC, portfolio vide, prix initiaux, jour 0.
- Le meilleur score précédent est conservé.

---

**US-8.5 · Avancement automatique en phase KO**
> En tant que joueur, je veux que les qualifiés KO soient automatiquement calculés après chaque journée.

- L'engine calcule les qualifiés depuis les standings de groupe (R32) ou les vainqueurs KO.
- Les équipes éliminées sont marquées et leur prix tombe à 1 KC.
- Les positions des éliminés sont liquidables mais plus achetables.

---

## 10. Mode Live (online)

### Contexte
En mode online, l'état de jeu est partagé sur le serveur (Supabase). Les résultats proviennent de vrais matchs via l'API API-Football. Le joueur n'a pas de bouton "Simulate" — les résultats arrivent automatiquement.

---

**US-9.1 · Voir le statut en direct des matchs du jour**
> En tant que joueur en mode live, je veux voir les matchs du jour avec leur statut (pas encore commencé, en cours, terminé).

- L'onglet Live (⚡) affiche les matchs de la journée courante.
- Les statuts sont : "Kicks off in X min" (NS), "EN JEU Xmin" (1H/HT/2H/ET), score final (FT/AET/PEN).
- L'écran se rafraîchit toutes les 60 secondes.

---

**US-9.2 · Voir le compte à rebours avant verrouillage du marché**
> En tant que joueur, je veux savoir combien de temps il me reste pour trader avant le lock d'un match.

- Le LiveTab affiche un compte à rebours "Marché ouvert encore Xmin" pour les matchs dont le `trade_lock_until` est dans le futur.
- L'horloge interne se met à jour toutes les 30 secondes.

---

**US-9.3 · Recevoir les mises à jour de prix en temps réel**
> En tant que joueur, je veux que mes prix et mon portfolio se mettent à jour automatiquement quand un match se termine.

- Le store `onlineGameStore` s'abonne via Supabase Realtime au canal `competition_game_state:{id}`.
- Quand l'état change, le store refetch automatiquement depuis `/api/game/state`.
- Un fallback poll de 30 secondes assure la cohérence si le websocket tombe.

---

**US-9.4 · Recevoir les dividendes automatiquement**
> En tant que joueur en mode live, je veux recevoir mes dividendes de qualification sans action manuelle.

- Le cron `sync-results` appelle `processRealMatchResult` après chaque match terminé.
- Les dividendes sont calculés et crédités atomiquement en base.
- L'état du joueur est mis à jour via Realtime.

---

**US-9.5 · Avancement automatique de phase**
> En tant que joueur, je veux que le tournoi avance automatiquement vers la phase suivante une fois tous les matchs d'une journée terminés.

- `checkAndAdvancePhase` est appelé après chaque résultat traité.
- Si tous les matchs de la journée courante sont joués, le `current_day_index` est incrémenté en base.
- Les qualifiés KO sont calculés et les pools mis à jour.

---

## 11. Dividendes & Mécanique de prix

### Contexte
Les prix évoluent selon les résultats des matchs. En plus des variations de prix, des dividendes en cash sont versés aux détenteurs à chaque round de qualification KO.

---

**US-10.1 · Comprendre l'impact d'un résultat sur les prix**
> En tant que joueur, je veux comprendre comment les prix bougent après chaque match.

- **Victoire** : le vainqueur gagne 50% du prix actuel du perdant. Le perdant perd 50% de son prix.
- **Nul (phase de groupes)** : chaque équipe gagne 25% du prix de l'adversaire.
- **Élimination KO** : le perdant tombe à 1 KC (plancher).
- La force FIFA des équipes influence la probabilité de résultat (pas le prix directement).

---

**US-10.2 · Recevoir des dividendes à chaque qualification KO**
> En tant que joueur, je veux recevoir des dividendes en cash pour chaque équipe que je détiens qui se qualifie pour un round KO.

| Round | Taux |
|-------|------|
| R32 (Huitièmes) | 10% du prix courant par part |
| R16 (Seizièmes) | 15% |
| QF (Quarts) | 20% |
| SF (Demis) | 30% |
| Finale | 40% |
| Champion | 60% |

- Les dividendes sont calculés sur le prix **au moment de la qualification**.
- Le versement est automatique (simulation et live).

---

**US-10.3 · Identifier les surprises (upsets)**
> En tant que joueur, je veux être alerté quand une grosse surprise se produit.

- Un upset est défini comme la victoire de l'équipe la plus faible (écart de force FIFA > 5 points).
- Il est mis en évidence : badge "UPSET" orange dans les résultats et l'animation.

---

## 12. Fiche Équipe (Nation Detail)

### Contexte
Un panneau superposé (`NationDetailOverlay`) est accessible depuis le marché, le portfolio, le calendrier et les standings. Il centralise toutes les informations d'une équipe.

---

**US-11.1 · Voir le profil complet d'une équipe**
> En tant que joueur, je veux voir en un endroit toutes les infos clés d'une équipe : prix, variation, force, groupe.

- Affiche : drapeau, nom, prix courant, variation % depuis le début, force FIFA, groupe, statut (en jeu / éliminé).

---

**US-11.2 · Voir l'historique de prix sous forme de graphique**
> En tant que joueur, je veux voir l'évolution du prix de l'équipe depuis le début du tournoi.

- Une sparkline SVG affiche la courbe de prix (prix initial → prix après chaque match joué).
- La couleur est verte si le prix est au-dessus du prix initial, rouge sinon.

---

**US-11.3 · Voir l'historique des matchs de l'équipe**
> En tant que joueur, je veux voir tous les matchs joués par l'équipe avec les scores et l'impact sur le prix.

- Chaque entrée de l'historique affiche : journée, adversaire, score, delta de prix.
- Les prolongations et tirs au but sont indiqués.

---

**US-11.4 · Consulter sa propre position sur l'équipe**
> En tant que joueur, je veux voir combien de parts je détiens, mon prix moyen d'achat et mon P&L sur cette équipe.

- Affiche : parts détenues, prix moyen, valeur actuelle, P&L (montant + %).
- Disponible uniquement si je détiens des parts.

---

**US-11.5 · Trader directement depuis la fiche**
> En tant que joueur, je veux pouvoir acheter ou vendre directement depuis la fiche équipe.

- Deux boutons Buy/Sell sont présents dans la fiche (désactivés si équipe éliminée ou marché lockée).
- Ils ouvrent la modale de trade avec l'équipe pré-sélectionnée.

---

## 13. Leaderboard

### Contexte
Le leaderboard classe les joueurs par meilleur score (valeur totale maximale atteinte lors d'un tournoi).

---

**US-12.1 · Consulter le classement global**
> En tant que joueur, je veux voir comment je me compare aux autres joueurs.

- Le leaderboard affiche les 20 meilleurs scores avec : pseudo, pays (optionnel), type (registered/guest), meilleur score en KC.
- Il se rafraîchit automatiquement toutes les 30 secondes via Supabase.

---

**US-12.2 · Distinguer joueurs enregistrés et invités**
> En tant que joueur, je veux savoir si les scores du classement proviennent de comptes permanents ou d'invités.

- Un badge "INVITÉ" est affiché sur les entrées des joueurs en mode guest.

---

## 14. Onboarding UX — Tutorial & Coach Marks

### Contexte
Pour aider les nouveaux joueurs à comprendre les mécaniques, KickStock propose un tutorial en plusieurs étapes et des coach marks contextuels.

---

**US-13.1 · Suivre le tutorial au premier lancement**
> En tant que nouveau joueur, je veux être guidé sur les règles du jeu avant de commencer.

- La `TutorialOverlay` s'affiche automatiquement au premier lancement (clé `localStorage`).
- Elle comporte 4 étapes avec titre, texte explicatif et icône :
  1. ⚽ Le concept (bourse fictive de football)
  2. 📈 Comment les prix évoluent
  3. 💰 Les dividendes de qualification
  4. 🔒 La taxe de transaction
- Navigation : Précédent / Suivant / Commencer.
- Peut être ignorée en cliquant en dehors.

---

**US-13.2 · Être guidé par des coach marks**
> En tant que nouveau joueur, je veux être guidé vers les éléments clés de l'interface lors de ma première utilisation.

- Les coach marks (`CoachMarkOverlay`) s'affichent en superposition après le tutorial.
- **Sur mobile** : 4 beats — NationCard, solde cash, bouton Play, bouton Buy.
- **Sur desktop** : 4 beats — prix actif, premier bouton achetable, bouton Simulate, colonne Buy.
- Chaque beat met en évidence l'élément ciblé avec un spotlight et une bulle d'explication.
- La progression se fait par clic.

---

## 15. UI Shell — Mobile & Desktop

### Contexte
KickStock s'adapte automatiquement à la taille d'écran. En dessous de 600 px, le `MobileShell` est rendu ; au-dessus, le `BrowserShell`.

---

**US-14.1 · Naviguer via la bottom navigation sur mobile**
> En tant que joueur mobile, je veux une navigation bas de page claire pour basculer entre les sections.

- Le `BottomNav` comporte 5 onglets : Calendrier / Classements / Simuler (ou Live en mode online) / Marché / Portfolio.
- L'onglet actif est mis en avant (icône + label coloré).
- La hauteur de la zone safe-area iOS est respectée.

---

**US-14.2 · Utiliser une interface adaptée sur desktop**
> En tant que joueur sur navigateur desktop, je veux une interface tirant parti de l'espace disponible.

- Le `BrowserShell` affiche le ticker en haut, les infos de jeu en sidebar gauche et les onglets en colonne.
- Les graphiques et historiques étendus sont disponibles uniquement sur desktop (enrichissements non-core).

---

**US-14.3 · Basculer entre mode Online et Offline**
> En tant que joueur, je veux pouvoir choisir de jouer en mode connecté (vrais résultats) ou en mode simulation (résultats générés).

- Le switch est accessible depuis le menu avatar.
- Un changement de mode provoque un rechargement de page.
- La préférence est mémorisée en `localStorage` (`kickstock:mode`).

---

**US-14.4 · Voir les messages d'erreur trade en temps réel**
> En tant que joueur, je veux recevoir un feedback immédiat si mon trade est refusé.

- Les codes d'erreur sont transformés en messages localisés dans la modale de trade :
  - `INSUFFICIENT_FUNDS` → "Fonds insuffisants"
  - `NATION_ELIMINATED` → "Équipe éliminée"
  - `CONCENTRATION_CAP` → "Plafond de concentration atteint"
  - `NOT_FOUND` → "Équipe introuvable"

---

**US-15.5 · Interface multilingue accessible**
> En tant que joueur, je veux que l'interface soit disponible dans ma langue dès l'ouverture, sans étape supplémentaire.

- Toute l'interface est gérée via `next-intl` (FR + EN).
- La langue est détectée automatiquement ; le joueur peut la changer depuis le menu.
- Voir section 2 — Internationalisation pour le détail complet.

---

## 16. Administration — Gestion des compétitions

### Contexte
Toute la structure d'une compétition (nom, dates, équipes, groupes, stades, horaires de matchs) est saisie via une interface admin dédiée et non hardcodée dans le code. Cela permet d'ajouter un nouveau tournoi sans aucun déploiement.

---

**US-16.1 · Créer une nouvelle compétition**
> En tant qu'admin, je veux créer un nouveau tournoi en renseignant ses métadonnées pour l'ouvrir aux joueurs.

- Formulaire : **nom du tournoi**, **saison/année**, **`league_id` API-Football** (3 champs uniquement).
- Les dates de début/fin ne sont **pas saisies** : `start_date` est dérivée automatiquement depuis les fixtures lors du premier sync ; `end_date` est cosmétique et non nécessaire à la création.
- La compétition est créée en état inactif (invisible aux joueurs) jusqu'à activation manuelle.
- Chaque compétition est identifiée par un `id` unique et dispose d'un état de jeu partagé isolé.
- La création **enchaîne automatiquement** 3 étapes avec retour visuel par étape :
  1. Création de la ligne en DB + initialisation de `competition_game_state`
  2. Import des équipes depuis API-Football (teams + force FIFA + prix initial)
  3. Sync du calendrier complet (fixtures → matches + competition_days)

---

**US-16.2 · Configurer les équipes participantes**
> En tant qu'admin, je veux définir la liste des équipes (sélections nationales) avec leurs attributs pour initialiser la compétition.

Champs par équipe :
- Identifiant ISO (ex. `BRA`, `FRA`)
- Nom complet (localisé FR + EN)
- Emoji drapeau et/ou URL de logo
- Groupe d'appartenance (ex. `A`…`L`)
- Force FIFA (0–100), utilisée par le moteur de simulation
- Prix initial en KC
- Confédération (UEFA, CONMEBOL, CAF…)

- Import possible depuis l'API API-Football ou saisie manuelle ligne par ligne.

---

**US-16.3 · Configurer le calendrier des matchs**
> En tant qu'admin, je veux saisir ou importer le calendrier complet des matchs avec leurs métadonnées précises.

Champs par match :
- Journée / `day_index`
- Phase (`Groups`, `R32`, `R16`, `QF`, `SF`, `3rd`, `Final`)
- Équipes A et B
- Stade / venue
- Date et heure locale (avec fuseau horaire)
- `fixture_id` API-Football (pour la synchronisation automatique des résultats live)

- Import en masse depuis l'API API-Football via `sync-fixtures` déclenché manuellement.
- Modification individuelle d'un match possible (report, changement de stade, heure).

---

**US-16.4 · Configurer les journées (days)**
> En tant qu'admin, je veux définir les journées du tournoi avec leur label, leur phase et leurs paramètres de dividendes.

Champs par journée :
- Label complet (ex. "Day 1 · Thu Jun 11") et label court (ex. "Jun 11")
- Phase (`Groups`, `R32`, …)
- `is_ko` (boolean)
- `div_key` : clé de dividende applicable (`r32`, `r16`, `qf`, `sf`, `final`, `champion`)

---

**US-16.5 · Activer / désactiver une compétition**
> En tant qu'admin, je veux contrôler la visibilité d'une compétition pour les joueurs.

- Un toggle `is_active` rend la compétition visible dans le sélecteur joueur.
- Désactiver une compétition ne supprime pas les données ni la progression des joueurs.
- Plusieurs compétitions peuvent être actives simultanément.

---

**US-16.6 · Importer les fixtures depuis l'API Football**
> En tant qu'admin, je veux déclencher manuellement la synchronisation des fixtures pour initialiser ou compléter le calendrier.

- Un bouton "Sync fixtures" dans l'interface admin déclenche le cron `sync-fixtures`.
- Les fixtures importées sont associées à leur `fixture_id` pour permettre la récupération automatique des résultats live.
- Les fixtures déjà présentes ne sont pas dupliquées (idempotent).

---

**US-16.7 · Simuler une journée depuis l'admin**
> En tant qu'admin, je veux pouvoir déclencher manuellement la simulation d'une journée (tests, événements spéciaux, rattrapage).

- Interface admin avec sélection de la compétition + `dayIndex` à simuler.
- Appelle `POST /api/admin/simulate-day`.

---

**US-16.8 · Voir et gérer l'état d'une compétition via une interface tabulée**
> En tant qu'admin, je veux naviguer entre des onglets dédiés pour consulter et modifier chaque dimension d'une compétition.

La page `/admin/competitions/[id]` est organisée en **4 onglets** :

| Onglet | Contenu |
|--------|---------|
| **INFO** | Métadonnées (id, league_id, saison, dates, compteurs équipes/matches/journées), état de jeu (jour courant, phase, champion, éliminés), tous les boutons d'action API |
| **FORMAT** | Visualisation des poules (groupes A-L avec équipes + force), tableau des journées (competition_days : phase, KO/Groupes, div_key) avec ajout/suppression |
| **ÉQUIPES** | Tableau complet des équipes avec groupe, force, prix initial, prix actuel, Δ%, édition inline (force / groupe / prix) |
| **MATCHES** | Tous les matches groupés par journée, avec score, date Paris, statut API, processed_at, édition inline de chaque match |

---

**US-16.9 · Déclencher les calls API-Football manuellement**
> En tant qu'admin, je veux un bouton par type de call API pour contrôler précisément ce qui est synchronisé.

Boutons disponibles dans l'onglet INFO :
- **ACTIVER / DÉSACTIVER** — toggle `is_active`
- **SIMULATE DAY** — simule la journée courante (test uniquement)
- **⬇ IMPORT TEAMS** — récupère les équipes depuis API-Football (`/teams?league=…&season=…`) + force FIFA + prix initial
- **↻ SYNC FIXTURES** — synchronise le calendrier complet (matches + journées)
- **↻ SYNC RESULTS** — récupère les résultats des matchs terminés
- **↻ SYNC SQUADS** — récupère les compositions d'équipes

Chaque bouton affiche le détail du résultat après exécution (ex : "32 importées · 0 ignorées").

---

**US-16.10 · Modifier un match manuellement**
> En tant qu'admin, je veux corriger la date, le score ou le statut d'un match directement depuis l'interface.

- Depuis l'onglet MATCHES, chaque ligne dispose d'un bouton ✏️.
- Champs éditables : `scheduled_at` (datetime picker), `score_a`, `score_b`, `api_status` (dropdown NS/FT/AET/PEN…).
- La modification est persistée via `PATCH /api/admin/competitions/[id]/matches/[fixture_id]`.

---

## 17. Infrastructure & Monitoring

### Contexte
Ces fonctionnalités sont réservées aux opérateurs et ne sont pas visibles des joueurs finaux.

---

**US-17.1 · Synchroniser les résultats réels automatiquement**
> En tant qu'opérateur, je veux que les résultats des matchs réels soient traités automatiquement toutes les 30 minutes pendant les créneaux de jeu.

- Le cron `GET /api/cron/sync-results` s'exécute toutes les 30 minutes.
- Une smart-window (`isMatchWindowActive`) évite les appels API inutiles hors créneaux.
- Pour chaque match terminé non encore traité : apply result → dividendes → check advance phase.
- Idempotent : un match déjà traité (`processed_at != null`) est ignoré.
- Sécurisé par `Authorization: Bearer {CRON_SECRET}`.

---

**US-17.2 · Garantir l'isolation multi-compétition**
> En tant qu'opérateur, je veux que l'état d'une compétition n'interfère jamais avec une autre.

- Chaque trade, prix, position et état de jeu est scopé par `competition_id`.
- Le RPC `execute_competition_trade` et tous les calculs de prix opèrent strictement dans le scope de la compétition sélectionnée.

---

**US-17.3 · Monitoring des erreurs en production**
> En tant qu'opérateur, je veux que les erreurs critiques soient capturées et remontées.

- Sentry est intégré côté client, serveur et edge (Next.js).
- Les erreurs d'API sont capturées avec le contexte de la route.
- Le rate limiting protège les endpoints sensibles.

---

## Récapitulatif de couverture

| Domaine | Stories | Statut estimé |
|---------|---------|---------------|
| Onboarding & Auth | US-1.1 → 1.6 | ✅ Implémenté |
| Internationalisation (FR/EN) | US-2.1 → 2.4 | ⚠️ Partiel (FR only en prod) |
| Compétitions & Mode de jeu | US-3.1 → 3.4 | ✅ Implémenté |
| Marché — Vue | US-4.1 → 4.5 | ✅ Implémenté |
| Marché — Trading | US-5.1 → 5.7 | ✅ Implémenté |
| Portfolio | US-6.1 → 6.6 | ✅ Implémenté |
| Calendrier | US-7.1 → 7.4 | ✅ Implémenté |
| Standings | US-8.1 → 8.4 | ✅ Implémenté |
| Mode Simulation | US-9.1 → 9.5 | ✅ Implémenté |
| Mode Live | US-10.1 → 10.5 | ✅ Implémenté |
| Dividendes & Prix | US-11.1 → 11.3 | ✅ Implémenté |
| Fiche Équipe | US-12.1 → 12.5 | ✅ Implémenté |
| Leaderboard | US-13.1 → 13.2 | ✅ Implémenté |
| Tutorial & Coach Marks | US-14.1 → 14.2 | ✅ Implémenté |
| UI Shell Mobile & Desktop | US-15.1 → 15.5 | ✅ Implémenté |
| Admin — Gestion compétitions | US-16.1 → 16.10 | ✅ Implémenté (UI tabulée complète) |
| Infrastructure & Monitoring | US-17.1 → 17.3 | ✅ Implémenté |

**Total : 63 user stories identifiées**

### Zones à compléter

| Priorité | Gap identifié |
|----------|---------------|
| 🟡 Moyenne | **US-2.1–2.4** — Switch de langue FR→EN fonctionnel en prod (corrigé session 2026-06-02) ; vérifier détection automatique `Accept-Language` |
| 🟡 Moyenne | **US-16.8** — Pas de log horodaté des actions admin (dernière sync, erreurs cron) |
| 🟢 Basse | **US-16.10** — Pas de confirmation avant modification d'un match déjà traité (`processed_at != null`) |
