# Comptes, sécurité et administration

Les comptes, les soldes de points, les paiements et le journal d'administration vivent dans une base
PostgreSQL. Le navigateur ne garde aucune copie du compte : la session est un cookie `httpOnly` que le
code de la page ne peut pas lire.

## Démarrer

1. **Créer le compte administrateur** (serveur API arrêté si la base est embarquée) :

   ```bash
   npm run admin:create -- --email vous@exemple.com --name "Votre nom"
   ```

   La commande affiche un lien à usage unique, valable 24 h. Aucun mot de passe ne passe par la ligne
   de commande : il se choisit sur la page du lien. `--reset` produit un nouveau lien.
2. **Se connecter**, puis **activer la double authentification** dans *Mon compte → Sécurité*
   (Google Authenticator, Microsoft Authenticator ou 2FAS). L'administration reste fermée tant
   qu'elle n'est pas activée.
3. Ouvrir **Administration** dans la barre latérale.

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
   sauvegarder hors de Git** : la perdre rend illisibles les secrets de double authentification et
   les clés Chariow des utilisateurs.
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
| Double authentification | TOTP (RFC 6238), protection contre le rejeu d'un code, 10 codes de secours hachés. Obligatoire pour tout compte qui détient un privilège. |
| Actions sensibles | Changer un rôle, attribuer des privilèges ou réinitialiser la double authentification d'un compte exige un code frais. |
| Liens de mot de passe | Usage unique, 24 h (création) ou 2 h (réinitialisation). Le jeton voyage après `#` : jamais envoyé au serveur ni aux sites tiers. |
| Journal | `auth_events` (connexions) et `audit_logs` (actions de l'équipe), sans route de suppression. |

## Paliers, points et fonctions

Les paliers sont décrits dans `server/config/plans.json`, modifiable sans redéployer :

- `monthlyCredits` : quota mensuel (`null` = illimité) ;
- `priceMonthlyFcfa` : prix affiché (`null` = « Prix à venir ») ;
- `features` : une fonction à `false` est fermée pour le palier (vidéos, storybook…).

Le solde a deux compartiments : les **points du palier**, rechargés à chaque cycle mensuel, et les
**points bonus** (recharges de l'équipe, remboursements), qui n'expirent pas. Une génération réserve
ses points au lancement ; si elle échoue, elle les rend. Un balayage serveur, toutes les 5 minutes,
reprend le suivi des générations dont l'écran a été fermé et abandonne (avec remboursement) celles
restées sans nouvelles depuis 48 h.

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

Aucun paiement en ligne n'est branché. Un abonnement réglé par Mobile Money, virement ou espèces
s'enregistre dans *Administration → Revenus* : le montant entre dans les revenus et le palier
s'active pour la durée payée (ajoutée à la période en cours pour un renouvellement). Les périodes
« aujourd'hui, ce mois, cette année » suivent `REPORTING_TIMEZONE`.

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

38 tests : vecteurs de la RFC 6238, politique de mot de passe, verrou anti-force brute, absence
d'énumération, double authentification, liens à usage unique, privilèges délégués, paiements et
revenus, facturation et remboursement des générations, isolation des clés Chariow. Les fournisseurs
sont simulés : aucun test n'appelle Higgsfield, Gamma ou Chariow.
