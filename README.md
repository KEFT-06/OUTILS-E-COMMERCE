# Smart Creator

**Lire le marché, produire le bon produit digital, le vendre.** Smart Creator est un site pour les
créateurs de produits digitaux (ebooks, templates, formations), d'abord en Afrique francophone :
analyse de niche sourcée, studio de production assisté par IA, créatifs publicitaires, kit de
lancement, pages de vente, guides multilingues et suivi des ventes.

> **VOIR · CRÉER · VENDRE** — chaque chiffre affiché porte sa source.

Ce fichier est la seule documentation du projet.

## Sommaire

1. [Démarrer](#1-démarrer)
2. [Ce que fait le site](#2-ce-que-fait-le-site)
3. [Architecture](#3-architecture)
4. [Services externes et clés](#4-services-externes-et-clés)
5. [Base de données](#5-base-de-données)
6. [Comptes, rôles et administration](#6-comptes-rôles-et-administration)
7. [Sécurité](#7-sécurité)
8. [Données personnelles](#8-données-personnelles)
9. [Paliers, points et paiement](#9-paliers-points-et-paiement)
10. [Analyse de niche](#10-analyse-de-niche)
11. [Guides multilingues](#11-guides-multilingues)
12. [E-mails, contact, audience et référencement](#12-e-mails-contact-audience-et-référencement)
13. [Charte graphique](#13-charte-graphique)
14. [Tests et vérifications](#14-tests-et-vérifications)
15. [Mise en production](#15-mise-en-production)
16. [Radar et Espionnage](#16-radar-et-espionnage)
17. [Reste à fournir](#17-reste-à-fournir)

---

## 1. Démarrer

**Prérequis :** Node.js 20.11 ou plus récent.

```bash
npm install
cp .env.example .env        # puis renseigner les clés (voir section 4)
npm run dev                 # API sur http://127.0.0.1:3001, site sur http://localhost:5173
```

Si `npm run dev` échoue avec `spawn cmd.exe ENOENT` (terminal sans `cmd.exe` dans le PATH), lancer
les deux serveurs séparément : `npm run dev:api` et `npm run dev:web`.

**Premier compte administrateur** (API arrêtée si la base est embarquée) :

```bash
npm run admin:create -- --email vous@exemple.com --name "Votre nom" --country CM
```

La commande affiche un lien à usage unique (24 h) pour choisir le mot de passe : aucun mot de passe
ne passe par la ligne de commande. Se connecter, puis activer un second facteur dans
*Mon compte → Sécurité* : l'administration reste fermée sans lui.

| Commande | Effet |
| --- | --- |
| `npm run dev` | API et site en parallèle, rechargés à chaque modification |
| `npm run build` | Construit le site (`dist/client`) puis le serveur (`dist/server.js`) |
| `npm start` | Démarre la version construite |
| `npm run typecheck` | Vérifie les types (TypeScript strict) |
| `npm run lint` | Relecture automatique du code, zéro avertissement toléré |
| `npm test` | Tous les tests, sans aucun appel à un vrai fournisseur |
| `npm run db:generate` | Génère une migration après une modification de `server/db/schema.ts` |
| `npm run admin:create -- --email … --reset` | Nouveau lien de mot de passe, verrou levé |
| `npm run admin:create -- --email … --reset-2fa` | Retire le second facteur d'un compte |

---

## 2. Ce que fait le site

### Pages publiques

| Adresse | Page |
| --- | --- |
| `/` | Accueil : promesse, paliers dans la devise du visiteur, questions fréquentes |
| `/connexion` | Connexion et création de compte gratuit |
| `/mot-de-passe-oublie` | Lien de nouveau mot de passe par e-mail |
| `/contact` | Formulaire de contact (messages lus dans l'administration) |
| `/mentions-legales`, `/confidentialite`, `/conditions` | Pages légales, conformes au fonctionnement réel |

### Espace de travail (`/app`, compte requis)

| Groupe | Module | Adresse | Rôle |
| --- | --- | --- | --- |
| Voir | Cockpit | `/app/cockpit` | Solde de points, ventes, concurrence de la dernière niche, parcours conseillé |
| Voir | Niches | `/app/niches` | 594 niches dans 41 secteurs, enregistrement et analyse en un clic |
| Voir | Radar | `/app/radar` | Boutiques Chariow surveillées jour après jour : prix, ventes, produits apparus ou retirés (section 16) |
| Voir | Espionnage | `/app/espionnage` | Publicités Meta qui mènent à une boutique de la plateforme, classées par ancienneté (section 16) |
| Voir | Analyse stratégique | `/app/analyse` | Les 5 taux, la concurrence, les produits proposés, le plan d'action |
| Voir | Dossier PDF | `/app/dossier-pdf` | Le rapport A4 à télécharger, après contrôle de conformité |
| Créer | Studio de création | `/app/studio` | Produits issus d'une analyse, créés à la main ou à partir d'une vidéo ; rédaction par IA ; export PDF/DOCX |
| Créer | Créatifs publicitaires | `/app/creatifs` | Visuels (Cloudflare Workers AI) et vidéos (fal.ai), 12 méthodes publicitaires |
| Créer | Storybook illustré | `/app/storybook` | Contes illustrés ancrés dans un pays (Gamma) |
| Créer | Pages produits | `/app/pages-produits` | Pages de vente en 7 sections, export HTML |
| Créer | Guides multilingues | `/app/multilingue` | Traduction, relecture, export (section 11) |
| Vendre | Kit de lancement | `/app/kit-lancement` | Textes, scripts vidéo et boutons par marché, rédigés par l'IA |
| Vendre | Structures de campagnes | `/app/campagnes` | Modèles de campagnes Meta Ads et TikTok |
| Vendre | Distribution | `/app/distribution` | Catalogue et ventes de la boutique Chariow |
| Vendre | Affiliation | `/app/affiliation` | Liens UTM, suivi et invitations d'affiliés Chariow |
| — | Mon compte | `/app/compte` | Profil, sécurité, paiement, connexions, données personnelles |

### Administration (`/app/admin`, privilèges requis)

Vue d'ensemble, utilisateurs (fiche détaillée), connexions, messages de contact, audience du site,
revenus, contenus créés, sécurité et journal d'audit. Voir section 6.

---

## 3. Architecture

### Principes non négociables

1. **Aucune clé côté navigateur.** Toutes les clés vivent sur le serveur ; aucune variable `VITE_*`
   ne porte de secret (vérifié à chaque envoi de code).
2. **Aucun chiffre inventé.** Un fait de marché sans source n'est pas affiché ; une donnée de
   démonstration est étiquetée comme telle.
3. **La conformité a un droit de veto** sur tout export (PDF, DOCX, HTML, textes de lancement).
4. **Le coût est annoncé avant l'action**, et les points sont rendus si une génération échoue.

### Pile technique

| Côté | Outils |
| --- | --- |
| Site | React 19, Vite 6, Tailwind 4, shadcn/ui (Radix), React Router 7, React Hook Form + zod, Recharts, TanStack Table, Sonner, cmdk |
| Serveur | Express 4, TypeScript strict, zod, Drizzle ORM, helmet, express-rate-limit, Argon2id |
| Base | PostgreSQL (Supabase en production, PGlite embarqué en développement) |
| Tests | `node:test` + supertest, fournisseurs simulés par de faux serveurs |

### Arborescence

```
Outil/
├── index.html                 Page unique ; le serveur réécrit son bloc <!--seo--> par adresse
├── public/                    Favicon, image de partage, drapeaux, captures de l'accueil
├── server/                    API Express : seule à détenir les clés
│   ├── index.ts               Démarrage : base, écoute, balayages périodiques
│   ├── app.ts                 Sécurité (helmet, CORS, corps), API, client construit
│   ├── env.ts                 Variables d'environnement validées, fournisseurs configurés
│   ├── config/                Tables éditables sans redéployer : paliers, coûts, conformité,
│   │                          originalité, prix, campagnes, kit de lancement, taux de repli
│   ├── db/                    schema.ts, client.ts, migrations/ (SQL générées par drizzle-kit)
│   ├── lib/                   Chiffrement, cookies, description des appareils
│   ├── middleware/            Erreurs, validation, limites de débit, CORS, authentification
│   ├── routes/                Un fichier par domaine : auth, account, admin, billing, analysis,
│   │                          reports, workspace, writing, guides, storybook, creatives,
│   │                          marketplaces, checks, catalog, public
│   ├── services/              Logique métier, un dossier par domaine (analysis, auth, billing,
│   │                          compliance, creatives, email, guides, seo, writing…)
│   ├── shared/                Types et données partagés avec le site (pays, devises, langues…)
│   ├── scripts/               create-admin.ts
│   └── tests/                 *.test.ts ; support/ : utilitaires et faux fournisseurs
└── src/                       Site React
    ├── main.tsx
    ├── app/                   App.tsx (routes), navigation.ts, layout/, providers/, routes/
    ├── features/              Pages hors espace de travail : landing, auth, account, admin,
    │                          contact, legal
    ├── modules/               Un dossier par module, nommé comme son adresse : cockpit, niches,
    │                          analyse, studio (+ export/), creatifs, storybook, pages-produits,
    │                          multilingue, kit-lancement, campagnes, distribution, affiliation
    ├── shared/
    │   ├── ui/                Briques d'interface shadcn/ui et Magic UI, sans logique métier
    │   ├── components/        Composants métier partagés (BrandLogo, RateBadge, PlanCards…)
    │   ├── hooks/             useProviders, useTrackVisit, usePublicPageMeta, use-mobile
    │   ├── stores/            Brouillons conservés sur le compte (persistentStore, produits)
    │   ├── lib/               Utilitaires : appels API, conformité, formats, téléchargements…
    │   └── types/             Types du site (dont réexports des types du serveur)
    └── styles/index.css       Tokens de couleur, thèmes clair et sombre
```

**Règles de rangement.** Un fichier utilisé par un seul module vit dans ce module ; ce qui sert à
plusieurs va dans `shared/`. `shared/ui` ne contient que des briques d'interface. Les imports passent
par les alias `@/` (→ `src/`) et `@server/` (→ `server/`), jamais par des chemins relatifs. Le site
n'importe du serveur que des types et des données pures (`server/shared`).

### Flux d'une analyse de niche

```
Niche + marché ─► POST /api/analyze-niche (compte, palier, 5 points réservés)
   ├─► Perplexity Search : 3 recherches, jusqu'à 15 pages numérotées
   ├─► Gemini : rapport JSON structuré, rédigé à partir de ces seules pages
   ├─► Serveur : écarte tout fait dont la source n'existe pas, recale les scripts
   └─► Rapport enregistré sur le compte (50 derniers), points rendus en cas d'échec
```

---

## 4. Services externes et clés

Toutes les clés se renseignent dans `.env` (jamais dans Git) en local, et dans les secrets de
l'hébergeur en production. `.env.example` décrit chaque variable. Sans une clé, la fonction concernée
l'annonce à l'écran et répond 503 : rien ne casse.

| Service | Rôle | Variables | Sans clé |
| --- | --- | --- | --- |
| **Gemini** | Rédaction du rapport d'analyse, rédaction des produits et du kit, traduction des guides, Vidéo → Produit ; secours des images | `GEMINI_API_KEY`, `GEMINI_MODEL` (défaut `gemini-3.6-flash`), `GEMINI_FALLBACK_MODEL` (défaut `gemini-3.5-flash`) | Analyse, rédaction et traduction fermées |
| **Perplexity** (API Search) | Sources web des analyses de niche | `PERPLEXITY_API_KEY` | L'analyse fonctionne mais n'avance aucun fait de marché et le dit |
| **Cloudflare Workers AI** | **Toutes les images** : visuels publicitaires, couvertures de guides et d'ebooks | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` (droits Workers AI en lecture **et** écriture), `CLOUDFLARE_IMAGE_MODEL`, `CLOUDFLARE_IMAGE_MODEL_FAST` | Repli sur Gemini, une vingtaine de fois plus cher ; sans les deux, images fermées |
| **fal.ai** | Vidéos publicitaires (Kling 2.5 Turbo Pro, 5 ou 10 s) | `FAL_KEY` (portée « API », pas « ADMIN »), `FAL_VIDEO_MODEL` | Vidéos fermées |
| **Apify** | Découverte de boutiques et mur d'espionnage (section 16) | `APIFY_TOKEN` | Le radar et le mur fonctionnent sur ce qui est déjà collecté ; aucune nouvelle collecte |
| **Higgsfield** | *Historique seulement.* Visuels d'avant la bascule vers Cloudflare, encore consultables | `HIGGSFIELD_API_KEY_ID`, `HIGGSFIELD_API_KEY_SECRET` | Les anciens visuels ne s'ouvrent plus ; rien de neuf n'y est envoyé |
| **Gamma** | Storybooks illustrés | `GAMMA_API_KEY` | Storybook fermé |
| **Stripe** | Paiement des paliers par carte | `STRIPE_API_KEY` (clé secrète `sk_…`), `STRIPE_WEBHOOK_SECRET` | Paiement en ligne masqué ; paiements saisis par l'équipe |
| **Brevo** ou **Resend** | E-mails de sécurité | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | Mot de passe oublié via l'équipe, pas de confirmation d'adresse |
| **Chariow** | Catalogue, ventes, affiliés | `CHARIOW_API_KEY` : boutique du propriétaire, réservée aux administrateurs | Chaque utilisateur enregistre sa propre clé dans *Mon compte → Connexions* (vérifiée, chiffrée) |
| **ExchangeRate-API** | Taux de change du jour (sans clé, aucune donnée personnelle) | `EXCHANGE_RATES_URL` (`off` pour couper) | Taux de repli de `server/config/exchange-rates.json` |

**Pourquoi ce partage.** La recherche Google intégrée à Gemini interdit de conserver ou d'exporter
ses résultats, alors qu'un rapport est enregistré et exporté en PDF : la recherche passe donc par
Perplexity, et Gemini rédige à partir des pages trouvées.

**Saturation de Gemini.** Google répond parfois 503 (« high demand »). Le serveur réessaie le modèle
principal, puis passe au modèle de secours ; si tout reste saturé, l'utilisateur lit « surchargé chez
Google, réessayez dans quelques minutes » et ses points sont rendus. Le rapport d'analyse indique le
modèle qui l'a réellement rédigé.

**Pourquoi les images sont parties chez Cloudflare.** Higgsfield se payait par abonnement mensuel,
dont les crédits périmaient sans report : on payait les mois sans visuel, et on perdait ce qu'on
n'avait pas consommé. Cloudflare facture à l'image, de l'ordre de 0,015 $. Conséquence technique :
Higgsfield déposait le fichier sur son stockage et rendait un lien à relayer, qui expirait au bout
de sept jours ; un modèle d'image rend des OCTETS, que le serveur garde lui-même (`creative_images`).
Un visuel ne périme donc plus.

**Deux formes de requête chez Cloudflare, sur la même route.** Mesuré sur l'API, absent de toute
documentation : la famille FLUX.2 REFUSE un corps JSON (400, « required properties at '/' are
'multipart' ») et n'accepte qu'un formulaire multipart ; Phoenix répond les octets du JPEG sans
enveloppe JSON. `server/services/ai/cloudflareImage.ts` déduit l'encodage du nom du modèle et la
lecture du type de contenu de la réponse — à relire avant de changer `CLOUDFLARE_IMAGE_MODEL`.

**Vérifié contre les vrais services.** Gemini (16/09/2026) : analyse, rédaction des modules, kit de
lancement, Vidéo → Produit (lien YouTube) et traduction répondent ; la génération d'images y est
refusée tant que la facturation du projet Google n'est pas ouverte (429 `RESOURCE_EXHAUSTED`).
Cloudflare (24/09/2026) : les quatre formats produisent une image par le code de l'application —
9:16, 1:1 et 16:9 en FLUX.2 klein 9B, le carré rapide en FLUX.1 schnell à 172,8 neurones.
Chariow : catalogue et ventes lus avec la clé administrateur. Perplexity : format conforme à la
documentation, à essayer dès que la clé est fournie.

**Retirés du site.** La bibliothèque publicitaire Meta (radar marché, galerie de publicités, swipe
file, score d'intensité concurrentielle) et Brave Search ne sont plus utilisés. Les campagnes
« Meta Ads » (scripts, structures) restent : il s'agit de publicité sur Meta, pas de la bibliothèque.

**Le Radar remplace ce radar marché, sur une autre source**, et le mur d'espionnage reprend la
partie publicitaire par un autre chemin. Les deux modules, ce qu'ils mesurent, ce qu'ils ne peuvent
pas mesurer et la seule route qui dépense : **section 16**.

---

## 5. Base de données

| Situation | `DATABASE_URL` | Où sont les données |
| --- | --- | --- |
| Développement | vide | PostgreSQL embarqué dans `.data/pglite`, exclu de Git |
| Production | `postgresql://…` (obligatoire) | Supabase, région Paris (`eu-west-3`) conseillée |
| Tests | `memory://` | En mémoire, effacée à la fin |

- Les migrations de `server/db/migrations/` s'appliquent au démarrage du serveur.
- Après une modification de `server/db/schema.ts` : `npm run db:generate -- --name <nom>`.
- **Passer sur Supabase** : créer le projet (région Paris), copier la chaîne de connexion
  (*Connect → Session pooler*) dans `DATABASE_URL`, renseigner `DATA_ENCRYPTION_KEY`
  (`openssl rand -hex 32`, à sauvegarder hors de Git : la perdre rend illisibles les secrets
  d'application d'authentification et les clés Chariow), redémarrer, puis relancer
  `npm run admin:create` sur la base vide.
- Row Level Security est activée sur toutes les tables, sans politique : l'API REST automatique de
  Supabase ne lit rien. Le site n'utilise ni la clé publique ni la clé secrète Supabase ; seul le
  serveur se connecte, avec la chaîne de connexion.

---

## 6. Comptes, rôles et administration

### Rôles et privilèges

Un **administrateur** a tous les accès. Un utilisateur peut recevoir des privilèges un par un :
voir le tableau de bord, consulter les utilisateurs, gérer les utilisateurs, recharger des points,
voir les revenus, enregistrer des paiements, voir les vidéos et visuels créés, voir la sécurité et le
journal, relire des guides.
Changer un rôle et attribuer des privilèges ne se délèguent pas. Un membre de l'équipe n'agit ni sur
un administrateur ni sur son propre compte. Tout privilège exige un second facteur actif et une
session ouverte avec lui.

### Administration

| Page | Contenu |
| --- | --- |
| Vue d'ensemble | Comptes et activité, revenus encaissés (jour, mois, année), sécurité des connexions (réussites, échecs, verrous) |
| Utilisateurs | Liste, fiche : palier, points restants et utilisés, fonctions accordées ou retirées, blocage, lien de mot de passe, réinitialisation du second facteur, 50 dernières connexions |
| Connexions | Chaque session : ouverture, fin et raison, durée, appareil, adresse IP tronquée |
| Messages | Messages du formulaire de contact : nouveau, lu, archivé |
| Audience | Visites et visiteurs uniques des pages publiques, sans cookie, sur 30 jours |
| Revenus | Revenus par jour, mois et année, paiements Stripe et saisis à la main, remboursements |
| Contenus | Nombre de vidéos, visuels, storybooks mesurés par le serveur et d'exports déclarés par le navigateur ; **bibliothèque des créatifs** : chaque vidéo et visuel avec son créateur, sa date et ses points, lecture et téléchargement (privilège « Voir les vidéos et visuels créés », chaque ouverture inscrite au journal ; un visuel produit chez nous ne périme pas ; une vidéo reste chez fal.ai, qui ne la garde qu'environ 7 jours — au-delà, la ligne demeure mais le fichier est annoncé expiré) |
| Sécurité | Journal des connexions et des codes, verrous actifs, journal d'audit des actions de l'équipe |

Un accès accordé ou retiré (fonction, palier, points) vaut dès la requête suivante. Bloquer un compte
le déconnecte de tous ses appareils ; rien n'est supprimé. Un utilisateur qui a perdu son mot de
passe ou son second facteur s'adresse à l'équipe, ou utilise *Mot de passe oublié* si les e-mails
sont configurés.

### Pays et devises

249 pays avec leur drapeau (`public/flags`) et leur devise. Le pays se choisit à l'inscription
(prérempli d'après le fuseau horaire, sans géolocalisation) et tous les prix s'affichent dans la
devise du compte. Les parités fixes (XAF, XOF, KMF, CVE, BAM) sont imposées par le code.

---

## 7. Sécurité

| Domaine | Mesure |
| --- | --- |
| Mots de passe | Argon2id (19 Mio, 2 passes), 12 caractères minimum, mots de passe courants refusés |
| Force brute | Verrou en base par e-mail (5 échecs : 15 min, puis 1 h, puis 24 h) et par IP (50 échecs), vérifié avant le mot de passe ; même réponse pour une adresse inscrite ou non |
| Sessions | En base, cookie `httpOnly`, `SameSite=strict`, `secure` et préfixe `__Host-` en production. Membre : 30 jours, 7 jours d'inactivité. Compte à privilèges : 12 h, 2 h d'inactivité. Changer le mot de passe ferme les autres sessions |
| Second facteur | Code de sécurité (haché) ou application d'authentification TOTP avec anti-rejeu et 10 codes de secours ; code frais exigé pour les actions sensibles |
| Liens à usage unique | Jeton après `#` (jamais envoyé au serveur ni aux sites tiers) ; création 24 h, réinitialisation par l'équipe 2 h, mot de passe oublié 1 h, confirmation d'adresse 48 h |
| Secrets | Clés des fournisseurs sur le serveur seulement ; secrets d'authentification et clés Chariow chiffrés en AES-256-GCM (`DATA_ENCRYPTION_KEY`) ; aucune clé dans les journaux |
| HTTPS | En production, toute requête en HTTP est redirigée (308) vers la même page en HTTPS, sur l'adresse `APP_URL` et jamais sur l'hôte annoncé par le visiteur ; HSTS (1 an, préchargement) ; la sonde `/api/health` n'est pas redirigée |
| En-têtes | helmet : CSP sans `unsafe-inline` pour les scripts, polices et styles servis par le site seul, `frame-ancestors 'none'`, `nosniff` ; aucune réponse de l'API en cache |
| Requêtes | Validation zod de chaque corps ; CORS en liste blanche ; écriture refusée depuis une origine étrangère ; corps encodés en formulaire ignorés ; tailles plafonnées (1 Mo, 5 Mo pour les brouillons, 14 Mo pour une vidéo) |
| Limites de débit | 240 requêtes par minute par session (par IP sans session), pour ne pas bloquer entre eux les abonnés mobiles qui partagent une même adresse IP ; plafond de 1 200 par minute par IP ; 10 par minute sur les générations payantes ; limites propres aux routes sensibles (inscription, connexion, contact, vérificateurs, suppression de compte). Un refus passager au chargement ne déconnecte pas : le site réessaie avant d'afficher la page de connexion |
| Robots et abus | Champ piège invisible sur l'inscription et le contact ; dès que le service d'e-mails est branché, les points du palier Gratuit ne se dépensent qu'avec une adresse confirmée, pour qu'un robot ne crée pas des comptes en série afin de consommer les fournisseurs payants |
| Adresse IP | `TRUST_PROXY` : nombre de proxys de confiance (1 derrière un hébergeur, 0 en accès direct) ; hors production, seule la boucle locale est crue |
| Fichiers relayés | Visuels et vidéos servis uniquement sous un type image ou vidéo attendu, avec une politique de sécurité en bac à sable |
| Paiements | Montants fixés par le serveur ; webhook Stripe vérifié par signature HMAC (tolérance 5 min) sur le corps brut ; activation idempotente |
| Journal | `auth_events` (connexions, codes) et `audit_logs` (actions de l'équipe), sans route de suppression |
| Dépendances | `npm audit` : aucune vulnérabilité dans les dépendances de production (`qs` et `form-data` forcés sur leurs versions corrigées dans `overrides`) |

---

## 8. Données personnelles

- **Mon compte → Vos données** : téléchargement d'une copie complète (JSON, sans aucun secret) et
  suppression du compte (mot de passe, second facteur et saisie de `SUPPRIMER`). Le dernier
  administrateur ne peut pas supprimer son compte.
- La suppression efface le compte, les contenus, les sessions et le journal de sécurité de la
  personne ; restent une trace anonyme de la suppression (empreinte de l'adresse) et les paiements
  pour la comptabilité.

| Donnée | Durée de conservation |
| --- | --- |
| Compte, contenus, clé Chariow | Tant que le compte existe |
| Analyses de niche | Les 50 plus récentes par compte |
| Historique des connexions | 12 mois après la déconnexion (appareil et IP tronquée seulement) |
| Journal de sécurité | 12 mois (balayage toutes les 5 minutes) |
| Messages de contact | 12 mois |
| Liens à usage unique expirés | Supprimés un jour après leur expiration |
| Empreintes de la mesure d'audience | Jusqu'au lendemain |
| Paiements | Durée légale de conservation comptable (à préciser dans les pages légales) |

Les pages légales (`src/features/legal/LegalPage.tsx`) décrivent ce fonctionnement ; les passages
que seul l'éditeur peut fournir sont surlignés « À compléter ».

---

## 9. Paliers, points et paiement

Les paliers vivent dans `server/config/plans.json` et les coûts dans
`server/config/credit-costs.json`, modifiables sans redéployer.

| Palier | Prix mensuel provisoire | Points / mois | Niches | Méthodes pub | Langues par guide | Fermé |
| --- | --- | --- | --- | --- | --- | --- |
| Gratuit | 0 | 3 | 3 | 2 | 1 | vidéos, storybook, relecture native |
| Plus | 4 900 FCFA · 7,99 € | 20 | 15 | 4 | 3 | relecture native |
| Pro | 9 900 FCFA · 14,99 € | 60 | 50 | 7 | 5 | — |
| Max | 19 900 FCFA · 29,99 € | 150 | 150 | 10 | 10 | — |
| Elite Enterprise | 49 900 FCFA · 74,99 € | illimités | illimitées | toutes | illimitées | — |

Un an payé d'avance vaut 10 mois. Les autres devises sont converties depuis l'euro puis arrondies.

| Action | Points |
| --- | --- |
| Analyse de niche | 5 |
| Rédaction d'un produit | 4 |
| Vidéo → Produit | 6 |
| Kit de lancement rédigé par l'IA | 3 |
| Visuel publicitaire · couverture | 1 |
| Vidéo publicitaire | 12 |
| Storybook | 15 |
| Traduction d'un guide (par langue) | 2 |
| Relecture native | 10 |

Le solde a deux compartiments : les points du palier, rechargés chaque mois, et les points bonus, qui
n'expirent pas. Une génération réserve ses points au lancement et les rend si elle échoue ; un
balayage reprend le suivi des générations dont l'écran a été fermé.

### Paiement par carte (Stripe Checkout)

1. *Mon compte → Paliers d'abonnement* : « Payer 1 mois » ou « Payer 1 an ». Le serveur fixe le montant
   (EUR, USD, GBP, CAD, CHF, XAF ou XOF selon le compte, sinon EUR) et ouvre la page de paiement Stripe.
   On y arrive par « Choisir … » sur l'accueil (après l'inscription pour un visiteur), par
   « Paliers et paiement » dans le menu du compte ou par « Changer de palier » sous le solde de points.
2. Le palier s'active quand Stripe confirme le paiement : au retour sur le site, ou par le webhook
   si la page a été fermée. Le paiement apparaît dans *Administration → Revenus*.
3. Pas de renouvellement automatique.
4. La boîte de l'équipe (`CONTACT_INBOX_EMAIL`) reçoit un avis par paiement, une seule fois, dès que
   le service d'e-mails est branché.

**Activer les paiements réels** : le compte Stripe n'est pas encore activé (vérifié le 16 septembre
2026). Compléter le profil d'entreprise dans le tableau de bord Stripe, puis remplacer la clé
`sk_test_…` par `sk_live_…`.

**Configurer le webhook** : dans le tableau de bord Stripe, ajouter le point de terminaison
`https://<votre-domaine>/api/billing/webhook` avec les événements `checkout.session.completed`,
`checkout.session.async_payment_succeeded` et `checkout.session.expired`, puis copier son secret
dans `STRIPE_WEBHOOK_SECRET`. En mode test, la carte `4242 4242 4242 4242` est acceptée ; le site
affiche un bandeau tant que la clé est une clé de test.

---

## 10. Analyse de niche

- **Sources** : trois recherches Perplexity (le marché, les offres et prix, les avis et difficultés),
  avec le pays du marché visé ; jusqu'à 15 pages sans doublon, liens `http(s)` seulement.
- **Rédaction** : Gemini reçoit les pages numérotées et des règles strictes : aucun chiffre, prix,
  concurrent ou lien qui ne figure dans une source citée ; le contenu des sources est une donnée,
  jamais une consigne.
- **Contrôle par le serveur** : un concurrent sans source existante est écarté ; un lien absent des
  sources est remplacé par la première source citée ; un taux sans source redevient « Non évalué » ;
  aucun prix, volume ou marge n'est gardé ; le verdict exige des sources et au moins deux taux
  évalués ; le minutage des scripts est recalculé.
- **Taux** : demande, saturation concurrentielle, rentabilité, opportunité, viralité. Chacun porte
  sa nature : appréciation fondée sur des sources, ou non évalué. Les anciens rapports calculés sur
  la collecte publicitaire Meta restent affichés tels quels.
- **Limites** : le rapport liste ce qu'il n'a pas pu établir (pas de volumes de recherche, idées et
  scripts à relire).

---

## 11. Guides multilingues

Un guide s'écrit une fois (texte découpé par titres `#`, ou produit du Studio), puis se traduit
langue par langue parmi 30 langues, dont plusieurs langues africaines.

| Niveau | Ce qui est fait | Qui |
| --- | --- | --- |
| C | Traduction automatique, puis contrôles : section manquante, titres, chiffres et prix, liens, noms à garder | Gemini, puis le serveur |
| B | Relecture côte à côte avec l'original, corrections, validation | L'auteur |
| A | Relecture native : tournures, ton, références culturelles | Un relecteur du réseau |

Les relecteurs (privilège *Relire des guides*) déclarent leurs langues, voient les demandes sans leur
texte, découvrent le texte en prenant une demande et n'y ont plus accès après l'avoir rendue. Exports :
PDF par l'impression du navigateur (toutes écritures, arabe de droite à gauche compris), Word et
HTML. La couverture, générée sans texte par Cloudflare Workers AI, est recopiée en base dès qu'elle est prête.

---

## 12. E-mails, contact, audience et référencement

- **E-mails** (Brevo ou Resend, envoyés en arrière-plan) : lien de nouveau mot de passe (3 demandes
  par heure au plus, réponse identique que l'adresse existe ou non), confirmation d'adresse à
  l'inscription, alerte après un changement de mot de passe. `EMAIL_FROM` doit appartenir à un
  domaine vérifié chez le fournisseur.
- **Contact** : formulaire public avec piège à robots, 5 messages par heure par IP, et les règles du
  serveur affichées sous chaque champ fautif ; les messages arrivent dans *Administration → Messages*, et une copie part vers la boîte de l'équipe
  (`CONTACT_INBOX_EMAIL`, qui reçoit aussi les avis de paiement). Le lien des pages légales préremplit
  le sujet « Mes données personnelles ».
- **Audience sans cookie** : une visite comptée par affichage d'une page publique ; visiteurs uniques
  comptés par une empreinte à clé quotidienne, effacée le lendemain ; Do Not Track et Global Privacy
  Control respectés ; robots ignorés. Aucun outil tiers (Google Analytics…) : il déposerait des cookies
  et imposerait un bandeau de consentement.
- **Cookies** : uniquement ceux nécessaires au fonctionnement (session, second facteur, barre
  latérale), décrits dans la politique de confidentialité. Exemptés de consentement, ils n'appellent
  aucun bandeau, qui gênerait sans rien protéger. Ajouter un cookie non nécessaire (mesure d'audience
  tierce, publicité) imposerait un bandeau avec un refus aussi simple que l'acceptation.
- **Référencement** : `robots.txt` et `sitemap.xml` ne proposent que les pages publiques. En
  production, le serveur écrit pour chaque adresse le titre, la description, l'adresse canonique et
  l'image de partage (`public/og-image.png`, 1200 × 630, avec son texte alternatif) ; l'espace de
  travail reçoit `noindex` ; une adresse inconnue répond 404 avec la page « Page introuvable ». Titres
  et descriptions : `server/shared/publicPages.ts`.
- **Icônes** : `favicon.svg`, `favicon.ico` (anciens navigateurs, résultats de recherche),
  `apple-touch-icon.png` (écran d'accueil d'un iPhone), `icon-192.png` et `icon-512.png` déclarées
  dans `site.webmanifest` (Android).

---

## 13. Charte graphique

- **Marque** : croissant et mot-symbole **SMART** (vert `#00C853`) **CREATOR** (orange `#F59E0B`),
  en SVG dans `src/shared/components/BrandLogo.tsx`. Ces deux couleurs sont réservées au logo, au
  bouton principal et aux accents ; en texte courant, utiliser `text-brand-green-text` et
  `text-brand-orange-text` (contraste suffisant).
- **Tokens** : définis une fois dans `src/styles/index.css` sous `:root`, redéfinis sous `.dark`.
  Surfaces, texte, traits, action (`primary`), états (`success`, `warning`, `info`, `danger`),
  taux (`rate-*`, réservés aux niveaux de marché), graphiques (`chart-1` à `chart-5`). Aucune couleur
  en dur dans les écrans.
- **Typographie** : Outfit pour les titres, Plus Jakarta Sans pour le texte (polices variables des
  paquets `@fontsource-variable`, servies par le site : aucune adresse IP transmise à Google), 12 px
  minimum, chiffres en `tabular-nums`.
- **Poids des pages** : la première visite de l'accueil télécharge environ 200 Ko compressés
  (JavaScript et CSS). Seul le noyau React est regroupé à la main (`vite.config.ts`) ; les autres
  pages, le cadre de l'espace de travail, les graphiques et le PDF arrivent à l'ouverture de leur page
  (`src/app/routes/lazyPage.ts`). Les captures de l'accueil sont en WebP, en deux tailles, et seule
  celle du thème affiché est téléchargée.
- **Mise en page** : barre latérale VOIR / CRÉER / VENDRE, en-tête avec fil d'Ariane et recherche ⌘K,
  barre de raccourcis sur mobile ; la liste des écrans vit dans `src/app/navigation.ts`. Chaque écran
  a son adresse et se charge à la demande.
- **Données** : titre qui dit ce qui est mesuré, provenance sous chaque graphique, état vide explicite
  plutôt qu'un graphique à zéro, badge sur toute donnée de démonstration.
- **Accessibilité** : contraste AA dans les deux thèmes (contrôlé avec axe-core sur chaque page, en
  clair, en sombre et à 390 px de large ; le mot-symbole du logo, marqué `data-brand-wordmark`, est
  exempté comme tout logotype), texte alternatif sur chaque image, étiquette sur chaque champ, nom
  accessible sur chaque bouton icône, focus retenu dans les fenêtres, `prefers-reduced-motion` respecté.
- **Composants shadcn** : `npx shadcn add` échoue (dépendance `socks@^2.8.8` absente de npm). Les
  composants se récupèrent depuis `ui.shadcn.com/r/styles/new-york-v4/<nom>.json`, imports réécrits
  vers `@/shared/…` (alias décrits dans `components.json`). `radix-ui` est épinglé en 1.4.3,
  `typescript-eslint` en 8.46.2 et `eslint-plugin-react-hooks` en 5.2.0 : les versions suivantes
  dépendent de paquets introuvables sur le registre npm.

---

## 14. Tests et vérifications

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Les tests (`server/tests/*.test.ts`, `src/**/*.test.ts`) couvrent l'authentification (TOTP RFC 6238,
verrous, énumération, liens), les privilèges, les paliers et prix par pays, la facturation et le
remboursement des générations, les paiements Stripe (signature, montants, idempotence), l'analyse de
niche (sources inexistantes écartées, absence de recherche web), la rédaction et Vidéo → Produit, les
brouillons, les guides multilingues, les e-mails, le contact, l'audience, les données personnelles,
le référencement et les correctifs de sécurité. Tous les fournisseurs sont simulés : aucun test
n'appelle Gemini, Perplexity, Cloudflare, fal.ai, Apify, Gamma, Stripe, Brevo, Resend ni Chariow, et aucun ne touche
la vraie base.

L'intégration continue (`.github/workflows/verifications.yml`) lance à chaque envoi : installation,
types, relecture, tests, construction, et la recherche de toute variable `VITE_` dans `src/`.

---

## 15. Mise en production

### Choix de l'hébergement (vérifié le 16 septembre 2026)

| Offre gratuite | Verdict pour ce site |
| --- | --- |
| **Render** (retenu) | Fait tourner le serveur tel quel, paiements autorisés, HTTPS inclus. Mise en veille après 15 minutes sans visite : la visite suivante attend environ une minute. 750 heures par mois. Passer à *Starter* (environ 7 $/mois) pour un site toujours éveillé |
| Vercel *Hobby* | Exclu : usage non commercial seulement (« any method of requesting or processing payment »), fichiers limités à 4,5 Mo, tâches planifiées une fois par jour |
| Netlify | Exclu : 60 secondes par requête (Vidéo → Produit et certaines analyses dépassent), envois limités à 6 Mo, serveur à réécrire en fonctions |
| **Supabase** (base, retenu) | 500 Mo, région Paris ; un projet gratuit est mis en pause après une semaine sans activité (à relancer depuis son tableau de bord) |

### Mise en ligne sur Render avec Supabase

`render.yaml` décrit le service : Node 22, région Francfort (la plus proche de Supabase Paris),
construction `npm ci --include=dev && npm run build`, démarrage `npm start`, sonde `/api/health`,
déploiement automatique à chaque envoi sur la branche `main`.

1. **Code** : un dépôt GitHub **privé** contenant ce projet (`.env` et `.data/` n'y partent jamais).
2. **Base** : sur supabase.com, créer un projet en région *West EU (Paris)*, puis copier la chaîne
   *Connect → Session pooler*, mot de passe de la base inclus. Les tables se créent au premier démarrage.
3. **Clé de chiffrement de production** : dans un terminal,
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. La garder dans un
   gestionnaire de mots de passe : la perdre rend illisibles les seconds facteurs et les clés Chariow.
4. **Render** : se connecter avec GitHub, *New → Blueprint*, choisir le dépôt. Render demande les
   valeurs secrètes :
   - `DATABASE_URL` (étape 2), `DATA_ENCRYPTION_KEY` (étape 3) ;
   - `ADMIN_BOOTSTRAP_EMAIL` : l'adresse du premier administrateur ;
   - `CONTACT_INBOX_EMAIL` : la boîte de l'équipe ;
   - les clés des fournisseurs, recopiées depuis `.env` (section 4) ;
   - `APP_URL` et `CORS_ORIGINS` : vides tant qu'il n'y a pas de nom de domaine, l'adresse
     `https://….onrender.com` attribuée par Render est alors utilisée.
5. **Premier administrateur** : une fois le déploiement terminé, *Logs* du service → lien
   « Lien à usage unique pour choisir le mot de passe » (24 h). Choisir le mot de passe, puis
   *Mon compte → Sécurité* pour le second facteur. `ADMIN_BOOTSTRAP_EMAIL` n'a plus d'effet ensuite.
6. **Stripe** : webhook `https://<adresse du site>/api/billing/webhook` (section 9), puis
   `STRIPE_WEBHOOK_SECRET` dans Render.
7. **Plus tard** : nom de domaine (*Settings → Custom Domains* de Render, puis `APP_URL` et
   `CORS_ORIGINS`), service d'e-mails avec un domaine vérifié, paiements réels (`sk_live_…`).

Autre hébergeur : un serveur Node.js lancé depuis la racine du projet (`npm run build` puis
`npm start`), avec `NODE_ENV=production`, `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `APP_URL` en
`https://`, `TRUST_PROXY=1` derrière un proxy, et `npm run admin:create` ou
`ADMIN_BOOTSTRAP_EMAIL` pour le premier administrateur.

---

## 16. Radar et Espionnage

Deux écrans, **une seule collecte**. Le point à ne pas perdre de vue en y touchant : la donnée
payante est mutualisée entre tous les comptes, et un seul endroit la paie.

### Radar (`/app/radar`) — ce que fait un concurrent, jour après jour

L'API officielle de Meta ne rend les publicités commerciales que pour l'Union européenne et le
Royaume-Uni : elle ne pouvait pas servir l'Afrique. Le radar observe à la place la vitrine publique
des boutiques Chariow, qui publie le prix pratiqué **et le nombre de ventes** de chaque produit —
une mesure, là où une publicité n'est qu'un indice.

Ce qu'un relevé unique ne peut pas donner, et que seul le passage quotidien établit : la date
d'apparition d'un produit, sa date d'arrêt, et l'accélération de ses ventes. Une vitrine ne publie
que son présent ; seul celui qui la relevait la veille sait ce qui en a disparu.

- Aucune clé, aucun point facturé. Le quota porte sur le nombre de boutiques suivies
  (`limits.watchedStores` ; `0` ferme le module).
- Balayage automatique une fois par jour et par boutique (`server/services/radar/sweeper.ts`), puis
  résumé par e-mail aux comptes qui surveillent quelque chose.
- **`CRON_SECRET` est obligatoire en production.** Sans lui, `GET /api/cron/radar` refuse de
  s'exécuter et **le radar ne balaie jamais** : les écrans restent figés sur le dernier relevé,
  sans rien signaler. Le planificateur est déclaré dans `vercel.json` (`0 3 * * *`) ; le secret se
  pose dans les variables d'environnement de l'hébergeur.

### Espionnage (`/app/espionnage`) — qui paie de la publicité, et depuis quand

Le mur montre les publicités Meta en cours qui redirigent vers une boutique de la plateforme.
L'ancienneté y est une donnée publiée, pas une estimation : elle sépare deux situations qu'on
confond toujours — une annonce de 12 jours est un test en cours, une annonce de 213 jours est un
produit qui paie sa publicité depuis sept mois. La seconde a fait ses preuves.

Ce que le mur ne montrera jamais, faute de donnée et non par choix : budget, impressions et portée.
Meta ne les publie que pour l'Union européenne — mesuré à 0 sur 43 annonces.

Trois pièges de la source, vérifiés par `server/tests/espionnage.test.ts` :

1. `inputUrl` contient le mot-clé cherché dans **chaque** enregistrement. Chercher la preuve de
   redirection dans l'enregistrement entier ferait passer toutes les annonces pour les nôtres :
   seuls `snapshot.linkUrl` et `snapshot.caption` font foi.
2. `startDate` est en **secondes**. Lu en millisecondes, tout daterait de 1970 et l'ancienneté —
   l'intérêt même du mur — n'aurait aucun sens.
3. `.shop` et `.com` désignent la même boutique : sans normalisation, elle apparaîtrait deux fois.

### La collecte : le seul endroit qui dépense

Lire une vitrine suppose d'en connaître l'adresse. Pour trouver des concurrents inconnus, la
découverte cherche « mychariow » dans les publicités en cours via Apify. Un même passage remplit
les deux écrans — boutiques repérées **et** mur d'espionnage — sinon la même donnée serait payée
deux fois.

- Route unique : `POST /api/radar/discover/refresh`, réservée au privilège `admin.market.collect`.
  **Aucun utilisateur ne peut déclencher une dépense.**
- Sans `APIFY_TOKEN`, le panneau n'apparaît pas et tout le reste fonctionne.
- Le résultat étant mutualisé, la dépense dépend du rythme configuré, jamais du nombre de comptes.
  Le calcul du coût est dans `.env.example`.
- Ne jamais activer les options `includeCreatorLeads` / `enrichCreatorEmails` de l'acteur Apify :
  elles collectent des données personnelles de tiers, et la prospection non sollicitée qui en
  découlerait abîmerait la réputation du domaine d'envoi.

**Ce que le palier borne sur le mur.** `limits.spiedAdsVisible` fixe le nombre d'annonces visibles
(6 / 30 / 100 / 200, illimité en Élite). Quand il coupe, l'écran l'annonce : un mur tronqué en
silence passe pour un mur pauvre, et l'utilisateur en conclut que l'outil ne trouve rien. À
l'inverse, ce que le palier n'a pas caché ne doit jamais lui être imputé — l'écran ne fixe donc
aucune limite de son côté, et `hiddenByPlan` se compte contre la limite du palier, jamais contre
le nombre de lignes servies.

---

## 17. Reste à fournir

| Élément | Où |
| --- | --- |
| Identité de l'éditeur, hébergeurs, durée de conservation comptable, rétractation et remboursement, droit applicable | Pages légales (`À compléter`) |
| `DATABASE_URL` Supabase (région Paris) | `.env` / secrets de l'hébergeur |
| `CRON_SECRET` sur l'hébergeur — sans lui le radar ne balaie jamais | Variables d'environnement |
| Service d'e-mails et domaine vérifié | `.env` |
| `STRIPE_WEBHOOK_SECRET` et activation du compte Stripe pour les paiements réels (profil d'entreprise, puis clé `sk_live_…`) | Tableau de bord Stripe |
| Prix définitifs des paliers | `server/config/plans.json` |
| Garanties des transferts hors Union européenne (Google, Perplexity, Cloudflare, fal.ai, Apify, Stripe, Higgsfield, Gamma) | Politique de confidentialité |

**Clés à régénérer** : toute clé qui a été copiée hors du fichier `.env` (messages, captures) doit
être régénérée chez son fournisseur, puis remplacée dans `.env`.

**Point connu** : `npm audit` signale 4 alertes moyennes dans l'ancien `esbuild` embarqué par
`drizzle-kit`, outil de développement qui génère les migrations et ne sert rien sur le réseau. Elles
disparaîtront avec une version de `drizzle-kit` qui ne dépend plus de `@esbuild-kit`.
