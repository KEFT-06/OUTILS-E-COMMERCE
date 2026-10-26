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
| Voir | Alertes | `/app/alertes` | Ce que le radar et l'espionnage ont relevé de nouveau : produit apparu ou retiré, prix changé, publicité qui dure |
| Voir | Analyse stratégique | `/app/analyse` | Les 5 taux, la concurrence, les produits proposés, le plan d'action |
| Voir | Dossier PDF | `/app/dossier-pdf` | Le rapport A4 à télécharger, après contrôle de conformité |
| Créer | Studio de création | `/app/studio` | Produits issus d'une analyse, créés à la main, depuis un texte collé ou depuis une vidéo ; rédaction, couverture, parcours audio (lecture par module, MP3) ; export PDF/DOCX |
| Créer | Créatifs publicitaires | `/app/creatifs` | Visuels (Cloudflare Workers AI) et vidéos (fal.ai, Veo en secours), 12 méthodes publicitaires |
| Créer | Storybook illustré | `/app/storybook` | Contes illustrés ancrés dans un pays |
| Créer | Pages produits | `/app/pages-produits` | Pages de vente en 7 sections, export HTML |
| Créer | Guides multilingues | `/app/multilingue` | Traduction, relecture, export (section 11) |
| Créer | Mes créations | `/app/creations` | Tout ce que le compte a produit : ouvrages, visuels, vidéos (avec leur échéance), contes |
| Vendre | Kit de lancement | `/app/kit-lancement` | Textes, scripts vidéo et boutons par marché, rédigés par l'IA |
| Vendre | Structures de campagnes | `/app/campagnes` | Modèles de campagnes Meta Ads et TikTok |
| Vendre | Distribution | `/app/distribution` | Catalogue et ventes de la boutique Chariow |
| Vendre | Affiliation | `/app/affiliation` | Parrainage Smart Creator (20 % des paiements des filleuls), liens UTM, suivi et invitations d'affiliés Chariow |
| — | Mon compte | `/app/compte` | Profil, sécurité, paiement, connexions, données personnelles |

**Après une analyse, tout ce qui se remplit l'est d'avance** (`src/shared/lib/analysisDefaults.ts`) :
mot-clé de l'espionnage, boutique à suivre au radar, brief des créatifs et du conte, chiffres des
campagnes, page produit, kit de lancement, nouveau produit du Studio, liens UTM, prochaine niche à
analyser. Rien n'y est inventé : ce que l'analyse n'a pas établi reste vide (un lien de paiement,
par exemple).

### Administration (`/app/admin`, privilèges requis)

Vue d'ensemble, utilisateurs (fiche détaillée), connexions, messages de contact, audience du site,
revenus, prix des paliers, contenus créés, **services** (état réel de chaque fournisseur et des
réglages du serveur), sécurité et journal d'audit. Voir section 6.

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
   ├─► Perplexity (Agent API, recherche approfondie en arrière-plan) : étude sourcée « [web:n] »
   │      repli : API Search de Perplexity, pages brutes
   ├─► Perplexity : rapport JSON structuré, rédigé à partir de ces seules pages
   ├─► Serveur : écarte tout fait dont la source n'existe pas, recale les scripts
   └─► Rapport enregistré sur le compte (50 derniers), points rendus en cas d'échec
```

L'analyse tourne en arrière-plan (`server/services/analysis/jobs.ts`) : l'écran peut être fermé,
l'étude reprend son suivi au lieu d'être repayée si le serveur redémarre.

### Qui écrit, qui dessine, qui parle

| Travail | Fournisseur d'abord | Secours |
| --- | --- | --- |
| Tout texte rédigé (produits, kit, rapport rédigé, conte, traductions, relectures) | Groq, `openai/gpt-oss-120b` (`server/services/ai/text.ts`) | Gemini, en dernier recours |
| Lecture d'une image (vision) | Groq, `qwen/qwen3.8-27b` | — |
| Transcription d'une vidéo (Vidéo → Produit, fichier envoyé) | Groq, Whisper `whisper-large-v3-turbo` | — ; un lien YouTube passe par Gemini |
| Visuels, couvertures | Cloudflare Workers AI, FLUX.2 klein 4B (direction artistique par Groq) | Gemini |
| Lecture à voix haute (parcours audio) | Cloudflare Workers AI, MeloTTS (une voix française) | Gemini (quatre voix) |
| Vidéos publicitaires | fal.ai, Gemini Omni Flash 1.1 | Veo (clé Gemini) |
| Conte illustré | Illustration maison : images Gemini avec images de référence, pour garder le même personnage d'une page à l'autre (`server/services/storybook/illustrate.ts`) — **bloquée tant que le projet Google l'est** | Gamma |

Depuis le 25/10/2026, le projet Google de la clé Gemini est refusé par Google (« Your project has
been denied access ») : le site fonctionne sans lui, et ce qui en dépend encore (lien YouTube,
secours) le dit à l'écran. Les écrans ne nomment jamais un fournisseur : ils parlent du service
rendu (« la rédaction », « la lecture à voix haute »).

---

## 4. Services externes et clés

Toutes les clés se renseignent dans `.env` (jamais dans Git) en local, et dans les secrets de
l'hébergeur en production. `.env.example` décrit chaque variable. Sans une clé, la fonction concernée
l'annonce à l'écran et répond 503 : rien ne casse.

Les noms de variables se recopient **lettre pour lettre** : le 26/10/2026, un jeton nommé
`CLOUDFLARE_IA_TOKEN` (« IA » à la française) chez l'hébergeur a laissé Cloudflare éteint en
production pendant des heures, sans aucune erreur. Une variable au mauvais **format** est signalée
dans *Administration → Services → Réglages du serveur* ; une variable au mauvais **nom** ne l'est
pas. Témoin rapide : `GET /api/health` (`providers`, sans aucune clé).

| Service | Rôle | Variables | Sans clé |
| --- | --- | --- | --- |
| **Groq** | Toute la rédaction (gpt-oss-120b), la vision (Qwen 3.8), la transcription Whisper, la direction artistique des couvertures | `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_JSON_MODEL`, `GROQ_VISION_MODEL`, `GROQ_TRANSCRIPTION_MODEL` | Rédaction sur Gemini seul ; Vidéo → Produit par fichier fermé |
| **Gemini** | Dernier recours de la rédaction ; lien YouTube de Vidéo → Produit ; illustrations des contes ; secours des images, de la voix et de la vidéo (Veo) | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `VEO_VIDEO_MODEL` | Ces secours disparaissent. **Projet refusé par Google depuis le 25/10/2026** |
| **Perplexity** | Étude de marché et rédaction du rapport d'analyse | `PERPLEXITY_API_KEY`, `PERPLEXITY_RESEARCH_PRESET` | L'analyse n'avance aucun fait de marché et le dit |
| **Cloudflare Workers AI** | Visuels et couvertures (FLUX.2 klein 4B, environ 95 images gratuites par jour), voix française du parcours audio (MeloTTS) | `CLOUDFLARE_ACCOUNT_ID` (32 caractères hexadécimaux), `CLOUDFLARE_AI_TOKEN` (droits Workers AI en lecture **et** écriture), `CLOUDFLARE_IMAGE_MODEL`, `CLOUDFLARE_IMAGE_MODEL_FAST` | Images et voix sur Gemini |
| **fal.ai** | Vidéos publicitaires (Gemini Omni Flash 1.1, 720p, son compris, 4/6/8 s) | `FAL_KEY` (portée « API », pas « ADMIN »), `FAL_VIDEO_MODEL` | Vidéos sur Veo. Compte prépayé : à sec, la vidéo se ferme à l'écran 20 minutes après chaque refus |
| **Firecrawl** | Lecture des vitrines Chariow pour le radar (la plateforme refuse le serveur en direct) | `FIRECRAWL_API_KEY`, `RADAR_FIRECRAWL_DAILY_PAGES` (défaut 30 pages par jour) | Vitrines lues par le collecteur (`collecteur/vitrines.mjs`) seulement |
| **Apify** | Découverte de boutiques et mur d'espionnage (section 16) | `APIFY_TOKEN` | Le collecteur maison prend le relais |
| **Supabase Storage** | Copie des vidéos et des illustrations au-delà de ce que garde le fournisseur | `SUPABASE_URL`, `SUPABASE_API_SECRET_KEY`, `CREATIVES_BUCKET` | Une vidéo n'est téléchargeable que 2 jours |
| **Gamma** | Secours des contes illustrés | `GAMMA_API_KEY` | Contes sur l'illustration maison seule |
| **Stripe** | Paiement des paliers par carte | `STRIPE_API_KEY` (clé secrète `sk_…`), `STRIPE_WEBHOOK_SECRET` | Paiement par carte masqué |
| **SebPay** | Paiement par Mobile Money | `SEBPAY_PUBLIC_KEY`, `SEBPAY_SECRET_KEY` | Mobile Money masqué. **Ne jamais créer de collecte « live » depuis un poste** |
| **Google** (OAuth) | « Continuer avec Google » | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Bouton masqué |
| **Brevo** ou **Resend** | E-mails de sécurité et résumés du radar | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | Mot de passe oublié via l'équipe, pas de confirmation d'adresse |
| **Chariow** | Catalogue, ventes, affiliés | `CHARIOW_API_KEY` : boutique du propriétaire, réservée aux administrateurs | Chaque utilisateur enregistre sa propre clé dans *Mon compte → Connexions* (vérifiée, chiffrée) |
| **GitHub** | Lancer le collecteur à la demande (atelier `veille.yml`) | `COLLECTOR_DISPATCH_TOKEN` | Le collecteur ne passe qu'à ses horaires |
| **ExchangeRate-API** | Taux de change du jour (sans clé, aucune donnée personnelle) | `EXCHANGE_RATES_URL` (`off` pour couper) | Taux de repli de `server/config/exchange-rates.json` |

**Pourquoi Perplexity pour l'analyse.** La recherche Google intégrée à Gemini interdit de conserver
ou d'exporter ses résultats, alors qu'un rapport est enregistré et exporté en PDF.

**Pourquoi Groq d'abord.** Offre gratuite (environ 1 000 demandes par jour, 8 000 jetons par
minute), JSON structuré sur gpt-oss, réponses en une à trois secondes. Une demande trop longue (413)
ou trop rapprochée (429) rend les points et un message clair ; Gemini n'est plus qu'un dernier
recours.

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

**Pourquoi FLUX.2 klein 4B.** Environ 104 neurones par image d'un mégapixel contre 1 364 pour le
9B : une centaine d'images par jour dans la franchise gratuite de Cloudflare (10 000 neurones)
au lieu de sept, sous licence Apache 2.0 (le 9B interdit l'usage commercial). Plus lent (16 à 40 s
contre 3 à 6 s). `CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-2-klein-9b` remet le 9B.

**Vérifié contre les vrais services.**

| Service | Date | Ce qui a été constaté |
| --- | --- | --- |
| Cloudflare | 24/09 et 25/10/2026 | Les quatre formats d'image ; MeloTTS : 16,7 s d'audio français rendues en MP3 |
| Groq | 25/10/2026 | JSON, texte et vision en 1 à 3 s ; Whisper : 35 s de français transcrites en 2 s ; Vidéo → Produit en 3 s |
| Firecrawl | 18/10/2026 | Vitrines Chariow lues, 0 refus sur 28 boutiques |
| Chariow | — | Catalogue et ventes lus avec la clé administrateur |
| fal.ai | 26/10/2026 | Clé acceptée, suivi sur la racine de l'application (le chemin complet rend 405) ; **aucun rendu : solde épuisé** |
| Gemini | 25/10/2026 | 403 « Your project has been denied access » sur tous les modèles |

Non vérifié à l'oreille : la voix MeloTTS (Whisper l'a relue avec quelques mots déformés).

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
  (*Connect → Transaction pooler*, port 6543) dans `DATABASE_URL`, renseigner `DATA_ENCRYPTION_KEY`
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
| Prix | Prix des paliers par devise, modifiables sans redéployer |
| Contenus | Nombre de vidéos, visuels, storybooks mesurés par le serveur et d'exports déclarés par le navigateur ; **bibliothèque des créatifs** : chaque vidéo et visuel avec son créateur, sa date et ses points, lecture et téléchargement (privilège « Voir les vidéos et visuels créés », chaque ouverture inscrite au journal ; un visuel produit chez nous ne périme pas ; une vidéo est gardée la durée du palier — copie dans Supabase Storage au-delà des 2 jours du fournisseur — puis annoncée expirée) |
| Services | État réel de chaque fournisseur, éprouvé par une lecture gratuite : clé acceptée ou refusée, modèle, réserve du jour, solde épuisé (fal.ai), copies de vidéos en attente, **réglages du serveur ignorés pour mauvais format** (noms seuls) |
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

| Palier | Prix mensuel provisoire | Points / mois | Niches | Méthodes pub | Boutiques suivies | Vidéos gardées |
| --- | --- | --- | --- | --- | --- | --- |
| Gratuit | 0 | 3 | 3 | 2 | 1 | 24 h |
| Plus | 4 900 FCFA · 7,99 € | 20 | 15 | 4 | 3 | 24 h |
| Pro | 9 900 FCFA · 14,99 € | 60 | 50 | 7 | 5 | 30 jours |
| Max | 19 900 FCFA · 29,99 € | 150 | 150 | 10 | 20 | 90 jours |
| Elite Enterprise | 49 900 FCFA · 74,99 € | illimités | illimitées | toutes | illimitées | 90 jours |

Fermé au palier Gratuit : vidéos, contes illustrés, relecture native et comparaison de marché ; au
palier Plus : relecture native. Les paliers Pro et au-delà ouvrent tout.

Un an payé d'avance vaut 10 mois. Les autres devises sont converties depuis l'euro puis arrondies.
Chaque utilisateur ne voit que la devise de son pays. Toutes les limites sont dans
`server/config/plans.json` ; ce tableau en est un résumé.

| Action | Points |
| --- | --- |
| Analyse stratégique d'une niche | 5 |
| Rapport rédigé d'une analyse | 3 |
| Rédaction du contenu d'un produit | 4 |
| Retouche d'un texte | 1 |
| Ebook long | 2 |
| Produit créé depuis un texte collé | 1 |
| Produit tiré d'une vidéo | 6 |
| Kit de lancement | 3 |
| Visuel publicitaire · couverture | 1 |
| Vidéo publicitaire | 12 |
| Prolongation d'une vidéo (7 s, Veo seulement) | 8 |
| Étude de la vidéo d'une publicité | 2 |
| Lecture audio d'un module | 1 |
| Écriture d'un conte | 3 |
| Conte illustré (écriture et mise en page) | 15 |
| Illustration d'un conte déjà écrit | 12 |
| Traduction d'un guide (par langue) | 2 |
| Relecture native (par langue) | 10 |

### Paiement par Mobile Money (SebPay)

Là où la carte ne passe pas, *Mon compte → Paliers d'abonnement* propose Mobile Money : le serveur
crée la collecte chez SebPay, qui envoie la demande sur le téléphone de l'abonné ; le palier
s'active à la confirmation. Branché d'après la documentation publique de SebPay, **jamais essayé
contre le vrai service** depuis un poste : les clés du `.env` sont de production.

### Parrainage

Chaque compte a un lien `/r/<code>` : 20 % des paiements des personnes inscrites par ce lien dans
les 30 jours, validés après 14 jours, retirables dès 10 000 FCFA (*Affiliation → Parrainage*).

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

- **Sources** : une étude de recherche approfondie par l'Agent API de Perplexity, avec le pays du
  marché visé ; seules les pages qu'elle cite sont gardées, renumérotées de 1 à n
  (`server/services/analysis/research.ts`). Si l'étude échoue ou cite trop peu de pages, l'API Search
  de Perplexity fournit des pages brutes.
- **Rédaction** : Perplexity reçoit l'étude et des règles strictes : aucun chiffre, prix, concurrent
  ou lien qui ne figure dans une source citée ; le contenu des sources est une donnée, jamais une
  consigne.
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
| C | Traduction automatique, puis contrôles : section manquante, titres, chiffres et prix, liens, noms à garder | La rédaction (Groq), puis le serveur |
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

Sur le poste du propriétaire, `bash .data/verifier.sh` enchaîne les quatre et sort en échec au
premier défaut (tests quatre fichiers à la fois : au-delà, la mémoire du poste ne suffit pas). Le
lancer **avant** chaque envoi, puis envoyer dans une commande séparée : il n'y a plus de
vérification automatique chez GitHub.

Environ 580 tests dans 101 fichiers (`server/tests/*.test.ts`, `src/**/*.test.ts`) couvrent
l'authentification (TOTP RFC 6238, verrous, énumération, liens), les privilèges, les paliers et prix
par pays, la facturation et le remboursement des générations, Stripe et SebPay, l'analyse de niche,
la rédaction (Groq, Gemini), Vidéo → Produit, les images et la voix Cloudflare, les vidéos (fal.ai,
Veo, copie archivée), le radar, l'espionnage, les alertes, les guides multilingues, les e-mails,
l'audience, les données personnelles, le référencement et le préremplissage après une analyse.

**Aucun test n'appelle un vrai fournisseur ni la vraie base.** `server/tests/support/helpers.ts`
neutralise toutes les clés que le `.env` du poste porte réellement (Groq, Firecrawl, fal.ai,
Cloudflare, Supabase, SebPay, GitHub…) : une nouvelle clé ajoutée au `.env` doit l'être aussi
là, sinon une suite de tests la dépenserait. Les tests qui veulent un fournisseur montent un faux
serveur local et redéfinissent sa clé.

---

## 15. Mise en production

### Où tourne le site

| Élément | Où |
| --- | --- |
| Site et API | **Vercel**, une seule fonction (`api/index.js`) en région Dublin (`dub1`), 300 s au plus par requête (`vercel.json`) |
| Construction | `npm run vercel-build` : migrations de la base, site, puis serveur empaqueté |
| Base | **Supabase**, PostgreSQL, chaîne *Transaction pooler* (port 6543) |
| Fichiers (vidéos, illustrations) | Supabase Storage, espace privé `CREATIVES_BUCKET` |
| Domaine | `smartcreatorcm.com`, enregistré chez LWS (DNS LWS) ; `www` pointe vers Vercel |
| Tâches planifiées Vercel | `/api/cron/radar` à 3 h et `/api/cron/marche` à 4 h (UTC), protégées par `CRON_SECRET` |
| Ateliers GitHub | `collecte.yml` (publicités, toutes les 4 h), `veille.yml` (toutes les 30 min), `firecrawl.yml` (à la demande) |

Chaque envoi sur la branche suivie par Vercel déclenche un déploiement. **Un envoi n'est pas un
déploiement** : lire son état (`https://api.github.com/repos/<dépôt>/commits/<sha>/statuses`),
puis `/api/health`.

**Vercel *Hobby*.** Le compte est sur l'offre gratuite, que les conditions de Vercel réservent à un
usage non commercial (« any method of requesting or processing payment »). Un site qui encaisse des
paliers relève de l'offre *Pro* : à régler par le propriétaire avant d'encaisser pour de vrai.

**Variables chez Vercel.** *Settings → Environment Variables*, cochées pour **Production**, puis
redéployer : une variable ajoutée n'existe pour le site qu'au déploiement suivant. Recopier les noms
lettre pour lettre (section 4). Obligatoires en production : `DATABASE_URL`,
`DATA_ENCRYPTION_KEY` (`openssl rand -hex 32`, à garder hors de Git : la perdre rend illisibles les
seconds facteurs et les clés Chariow), `APP_URL` en `https://`, `CRON_SECRET`.

**Premier administrateur** : `ADMIN_BOOTSTRAP_EMAIL`, puis le lien à usage unique (24 h) affiché dans
les journaux du déploiement ; ou `npm run admin:create` contre la base. Activer ensuite le second
facteur dans *Mon compte → Sécurité*.

**Stripe** : webhook `https://<adresse du site>/api/billing/webhook` (section 9), puis
`STRIPE_WEBHOOK_SECRET` chez Vercel.

**Le dépôt GitHub est public.** `.env` et `.data/` n'y partent jamais ; les journaux des ateliers
GitHub sont publics aussi : n'y écrire ni clé, ni nom de boutique, ni nom de compte.

`render.yaml` décrit l'ancien hébergement sur Render (Francfort), abandonné pour Vercel ; il reste
utilisable pour un serveur Node classique (`npm run build` puis `npm start`, avec
`NODE_ENV=production`, `TRUST_PROXY=1` derrière un proxy).

### Quand l'écran dit « Le serveur est injoignable »

Ce message (`src/shared/lib/api.ts`) ne paraît que si le navigateur n'a reçu **aucune** réponse :
une erreur du serveur (500, 504) donne un autre texte. Les causes, dans l'ordre où les chercher :

1. **La connexion du visiteur** : réseau coupé, changement entre Wi-Fi et câble, résolveur DNS lent.
   Mesuré le 26/10/2026 sur le poste du propriétaire : 2,6 s pour résoudre l'adresse avec le DNS de
   la box, 0,26 s avec 1.1.1.1 ou 8.8.8.8.
2. **Le domaine** : état au registre (RDAP, `rdap.verisign.com/com/v1/domain/smartcreatorcm.com`) ;
   il a déjà été suspendu par le bureau d'enregistrement.
3. **Un bloqueur de publicité** : écarté le 26/10/2026 — aucune des 173 adresses de l'API ne
   tombe sous EasyList, EasyPrivacy ou Liste FR.

Une lecture qui échoue vite est redemandée une fois sans rien montrer ; une action (paiement,
génération) ne l'est jamais. Un visuel ou une vidéo dont la réponse s'est perdue est retrouvé sur
le compte (`src/modules/creatifs/launchCreative.ts`).

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
- **Chariow refuse le serveur en lecture directe depuis le 11/10/2026.** Les vitrines se lisent
  donc par Firecrawl (`server/services/radar/sources/firecrawl.ts`, lecture ordinaire, jamais de
  contournement), dans la limite de `RADAR_FIRECRAWL_DAILY_PAGES` pages par jour (30 par défaut,
  dont au plus deux tiers pour l'index du marché). Ouvrir une boutique dans le radar la relit à la
  demande si son dernier relevé a plus de 6 heures. Sans clé Firecrawl chez l'hébergeur, seul le
  collecteur du poste lit les vitrines (`collecteur/vitrines.mjs`) et les verse par
  `POST /api/cron/vitrines`.
- Une boutique ajoutée « en attente » (adresse seule) est résolue au premier relevé ; le premier
  passage sur une boutique sert de référence et n'annonce aucune « nouveauté ».

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
- **Le collecteur maison** (`collecteur/collecte.mjs`, Crawlee + Playwright) lit la bibliothèque
  publicitaire publique comme un visiteur et verse les annonces au site. Il tourne dans les ateliers
  GitHub (`collecte.yml` toutes les 4 heures, `veille.yml` toutes les 30 minutes pour les recherches
  des clients) ; le site le déclenche à la demande avec `COLLECTOR_DISPATCH_TOKEN`. L'horaire de
  GitHub n'est pas tenu à la minute (passages espacés de 2 à 4 heures constatés).
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
| Recharger le compte fal.ai (solde épuisé le 26/10/2026 : aucune vidéo ne part) | fal.ai/dashboard/billing |
| Projet Google refusé (« denied access ») : Veo, lien YouTube, illustrations des contes, secours | Console Google Cloud, ou faire sans |
| Offre Vercel *Pro* avant d'encaisser pour de vrai (l'offre *Hobby* exclut l'usage commercial) | Vercel |
| Service d'e-mails et domaine vérifié | Variables chez Vercel |
| `STRIPE_WEBHOOK_SECRET` et activation du compte Stripe pour les paiements réels (profil d'entreprise, puis clé `sk_live_…`) ; paiements Stripe encore en clé de test | Tableau de bord Stripe |
| Prix définitifs des paliers | *Administration → Prix* |
| Garanties des transferts hors Union européenne (Google, Groq, Perplexity, Cloudflare, fal.ai, Firecrawl, Apify, Stripe, SebPay, Gamma) | Politique de confidentialité |

**Clés à régénérer** : toute clé qui a été copiée hors du fichier `.env` (messages, captures) doit
être régénérée chez son fournisseur, puis remplacée dans `.env`.

**Point connu** : `npm audit` signale 4 alertes moyennes dans l'ancien `esbuild` embarqué par
`drizzle-kit`, outil de développement qui génère les migrations et ne sert rien sur le réseau. Elles
disparaîtront avec une version de `drizzle-kit` qui ne dépend plus de `@esbuild-kit`.
