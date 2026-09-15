# Comptes, sécurité et administration

Les comptes, les soldes de points, les niches enregistrées, les paiements et le journal d'administration
vivent dans une base PostgreSQL. Le navigateur ne garde aucune copie du compte : la session est un
cookie `httpOnly` que le code de la page ne peut pas lire.

## Démarrer

1. **Créer le compte administrateur** (serveur API arrêté si la base est embarquée) :

   ```bash
   npm run admin:create -- --email vous@exemple.com --name "Votre nom" --country CM
   ```

   La commande affiche un lien à usage unique, valable 24 h. Aucun mot de passe ne passe par la ligne
   de commande : il se choisit sur la page du lien.
2. **Se connecter**, puis définir un **code de sécurité** dans *Mon compte → Sécurité* (ou, au choix,
   une application d'authentification). L'administration reste fermée tant qu'aucun second facteur
   n'est actif.
3. Ouvrir **Administration** dans la barre latérale.

**Mot de passe ou code oublié (compte administrateur)** — API arrêtée :

| Commande | Effet |
| --- | --- |
| `npm run admin:create -- --email … --reset` | Nouveau lien de mot de passe (24 h), verrou de connexion levé |
| `npm run admin:create -- --email … --reset-2fa` | Retire le code de sécurité et l'application : à redéfinir à la connexion |
| `npm run admin:create -- --email … --country SN` | Change le pays, donc la devise des prix |

Un utilisateur qui a oublié son mot de passe ou son code s'adresse à l'administration : *fiche du
compte → Lien de mot de passe*, ou *Réinitialiser le second facteur*.

## Base de données

| Situation | `DATABASE_URL` | Où sont les données |
| --- | --- | --- |
| Développement | vide | PostgreSQL embarqué dans `.data/pglite`, exclu de Git, sur le poste |
| Production | `postgresql://…` (obligatoire) | Supabase, région Paris (`eu-west-3`) conseillée |
| Tests | `memory://` | En mémoire, effacée à la fin |

Les migrations du dossier `drizzle/` s'appliquent au démarrage. Après une modification de
`server/db/schema.ts` : `npm run db:generate`.

**Passer sur Supabase**

1. Créer le projet Supabase, région Europe (Paris).
2. *Project Settings → Database → Connection string*, mode **Transaction pooler** : la coller dans
   `DATABASE_URL` (fichier `.env` en local, secrets de l'hébergeur en production).
3. Renseigner `DATA_ENCRYPTION_KEY` (64 caractères hexadécimaux : `openssl rand -hex 32`). **La
   sauvegarder hors de Git** : la perdre rend illisibles les secrets d'application d'authentification
   et les clés Chariow des utilisateurs.
4. Redémarrer le serveur (les tables se créent), puis relancer `npm run admin:create` : la nouvelle
   base est vide.

Row Level Security est activée sur les 14 tables, sans aucune politique : l'API REST automatique de
Supabase ne peut rien lire, même avec la clé publique « anon ». Le site n'utilise ni cette clé ni la
clé `service_role` ; seul le serveur se connecte, avec la chaîne de connexion.

## Sécurité des comptes

| Mesure | Détail |
| --- | --- |
| Mots de passe | Argon2id (19 Mio, 2 passes). 12 caractères minimum, mots de passe courants refusés, pas de règle « majuscule + symbole ». |
| Force brute | Par adresse e-mail : 5 échecs → 15 min, puis 1 h, puis 24 h. Par IP : 50 échecs → 15 min, 1 h, 6 h (seuil haut à cause du CGNAT des opérateurs mobiles). Le verrou est vérifié **avant** le mot de passe. |
| Énumération | Même réponse, même durée, pour une adresse inscrite ou non. |
| Sessions | En base, révocables. Membre : 30 jours, 7 jours d'inactivité. Compte à privilèges : 12 h, 2 h d'inactivité. |
| Second facteur | Au choix : **code de sécurité** (8 caractères minimum, différent du mot de passe, haché en Argon2id) ou **application** TOTP (RFC 6238, anti-rejeu, 10 codes de secours). Obligatoire pour tout compte qui détient un privilège ; 5 codes faux ferment la vérification. |
| Actions sensibles | Changer un rôle, attribuer des privilèges ou réinitialiser le second facteur d'un compte exige un code frais (code de sécurité ou application). 5 codes faux → verrou de 15 min, puis 1 h, puis 24 h, même contre le bon code. |
| Liens de mot de passe | Usage unique, 24 h (création, ligne de commande) ou 2 h (réinitialisation par l'équipe). Le jeton voyage après `#` : jamais envoyé au serveur ni aux sites tiers. |
| Journal | `auth_events` (connexions, codes) et `audit_logs` (actions de l'équipe), sans route de suppression. |

## Pays et devises

L'outil est international : **249 pays** (`server/shared/countries.ts`), avec leur drapeau
(`public/flags`, en images : Windows n'affiche pas les drapeaux émoji) et leur devise.

- L'utilisateur choisit son pays à l'inscription (prérempli d'après le fuseau horaire de l'appareil,
  sans géolocalisation) et peut le changer dans *Mon compte*. Tous les prix s'affichent dans sa
  devise : un Camerounais voit des francs CFA (XAF), un Américain des dollars.
- Taux : ExchangeRate-API (données ouvertes, sans clé, aucune donnée personnelle envoyée), rafraîchis
  toutes les 12 h ; taux de repli dans `server/config/exchange-rates.json`. Les parités fixes (XAF,
  XOF, KMF, CVE, BAM) sont imposées par le code. `EXCHANGE_RATES_URL=off` coupe les appels.
- Partout où un pays se choisit (inscription, Mon compte, créatifs, storybook, galerie, kit de
  lancement, création de compte par l'équipe), on tape le nom et le drapeau apparaît ; « RDC »,
  « USA » ou « Angleterre » sont compris.

## Paliers, points et limites

Les paliers sont décrits dans `server/config/plans.json`, modifiable sans redéployer :

- `monthlyCredits` : quota mensuel (`null` = illimité) ;
- `prices` : prix mensuel par devise. Une devise absente est convertie depuis `pricing.baseCurrency`
  (EUR) puis arrondie (8,99 $ ; 13 500 ₦). `null` : « Prix à venir ». Un an payé d'avance vaut
  `yearlyMonthsCharged` mois (10 : deux mois offerts) ;
- `limits.savedNiches` : niches qu'un compte peut enregistrer (`null` = illimité) ;
- `limits.adFrameworks` : méthodes publicitaires ouvertes, dans l'ordre de
  `server/shared/adFrameworks.ts` (`null` = toutes) ;
- `features` : une fonction à `false` est fermée pour le palier.

| Palier | Prix provisoire | Points / mois | Niches | Méthodes pub | Vidéos |
| --- | --- | --- | --- | --- | --- |
| Gratuit | 0 | 3 | 3 | 2 | non |
| Plus | 4 900 FCFA · 7,99 € | 20 | 15 | 4 | oui |
| Pro | 9 900 FCFA · 14,99 € | 60 | 50 | 7 | oui |
| Max | 19 900 FCFA · 29,99 € | 150 | 150 | 10 | oui |
| Elite Enterprise | 49 900 FCFA · 74,99 € | illimités | illimitées | 12 | oui |

> ⚠️ Prix **provisoires**, proposés en attendant la grille définitive du propriétaire.

Le solde a deux compartiments : les **points du palier**, rechargés à chaque cycle mensuel, et les
**points bonus** (recharges de l'équipe, remboursements), qui n'expirent pas. Une génération réserve
ses points au lancement ; si elle échoue, elle les rend. Un balayage serveur, toutes les 5 minutes,
reprend le suivi des générations dont l'écran a été fermé et abandonne (avec remboursement) celles
restées sans nouvelles depuis 48 h.

## Niches

La rubrique *Niches* présente un catalogue de **594 niches dans 41 secteurs** (santé, nutrition,
tech, IA, mines et pétrole, agriculture, finance…), dans `src/data/nicheCatalog.ts`. Chaque niche
s'enregistre ou s'analyse en un clic ; une niche absente du catalogue peut être ajoutée. Le serveur
refuse d'enregistrer au-delà de la limite du palier. Aucun rapport d'exemple n'est affiché : les
écrans construits sur une analyse restent vides tant qu'aucune niche n'a été analysée.

## Méthodes publicitaires

Pour une vidéo ou un visuel **publicitaire**, l'auteur choisit une méthode : AIDA, PAS, BAB, FAB, 4C,
AIDCA, ODC, 4P, PPPP, ACCA, PASTOR, QUEST. Chaque étape reçoit son message ; la consigne envoyée au
modèle découpe la vidéo en temps (ex. AIDA sur 10 s : Attention 0–2,5 s…). Les méthodes hors du
palier sont affichées verrouillées, avec le palier qui les ouvre, et refusées par le serveur.
Les consignes restent compatibles avec la conformité : pas de fausse urgence, pas de témoignage
inventé, pas de résultat garanti.

## Privilèges délégués

Un **administrateur** a tous les accès. Un utilisateur peut recevoir des privilèges un par un :

| Privilège | Ouvre |
| --- | --- |
| Voir le tableau de bord | Vue d'ensemble, en ligne, contenus créés |
| Consulter les utilisateurs | Liste et fiches des comptes |
| Gérer les utilisateurs | Palier, suspension, fonctions accordées ou retirées, déconnexion, lien de mot de passe |
| Recharger des crédits | Ajouter ou retirer des points bonus |
| Voir les revenus | Revenus par jour, mois, année et paiements |
| Enregistrer des paiements | Saisir ou rembourser un paiement |
| Voir la sécurité et le journal | Connexions, verrous, journal d'audit |

Changer un rôle et attribuer des privilèges ne se délèguent pas. Un membre de l'équipe n'agit ni sur
un administrateur ni sur son propre compte.

## Paiements et revenus

Aucun paiement en ligne n'est branché. Un abonnement réglé par Mobile Money, carte, virement ou
espèces s'enregistre dans *Administration → Revenus*, **dans la devise payée** (le montant du palier
est proposé dans cette devise). Il est converti en francs CFA au taux du jour pour les statistiques,
et le palier s'active pour la durée payée. Les périodes « aujourd'hui, ce mois, cette année » suivent
`REPORTING_TIMEZONE`.

## Contenus créés

*Administration → Contenus* compte vidéos, visuels, storybooks et collectes **mesurés** par le
serveur, et les exports faits dans le navigateur (ebooks PDF/DOCX, pages produits, dossiers PDF,
swipe files, kits de lancement), **déclarés** par l'appareil. Les fichiers sont comptés par format
(MP4, PNG, PDF…) ; aucune génération audio (MP3) n'existe encore.

## Chariow

- `CHARIOW_API_KEY` dans `.env` : la boutique du propriétaire, utilisée **uniquement** par les
  comptes administrateurs.
- Chaque autre utilisateur enregistre sa propre clé dans *Mon compte → Connexions* : vérifiée auprès
  de Chariow, chiffrée en base, jamais renvoyée au navigateur (seuls les 4 derniers caractères sont
  montrés à son propriétaire).

## Tests

```bash
npm test
```

47 tests : vecteurs de la RFC 6238, politique de mot de passe, verrou anti-force brute, absence
d'énumération, double authentification et code de sécurité (connexion, confirmation, verrou),
liens à usage unique, privilèges délégués, niches limitées par palier, prix par pays, paiements en
devise étrangère et revenus, méthodes publicitaires verrouillées, facturation et remboursement des
générations, isolation des clés Chariow. Les fournisseurs sont simulés : aucun test n'appelle
Higgsfield, Gamma, Chariow ni le service de taux.
