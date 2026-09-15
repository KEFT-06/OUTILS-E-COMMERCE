# Architecture — Smart Creator

## Principe directeur

**API-first, modulaire, secrets côté serveur uniquement.** Le frontend n'appelle jamais un
fournisseur IA en direct : toute clé vit dans le backend. C'est la règle non négociable qui
sépare un site « vibe-codé » d'un produit livrable.

## Arborescence

```
Outil/
├── docs/                      Spécifications vivantes (ce dossier)
├── server/                    Backend Express — détient toutes les clés
│   ├── index.ts               Point d'entrée, middlewares de sécurité
│   ├── routes/                Un fichier par module (m01…m11)
│   ├── middleware/            auth, rate-limit, validation zod, erreurs
│   ├── services/
│   │   ├── ai/                Orchestrateur multi-modèles (§10 du CdC)
│   │   ├── ingestion/         Meta Ad Library, Trends — pipeline module 1
│   │   ├── scoring/           Moteur de score transparent + versionné
│   │   ├── compliance/        Vérificateur publicitaire (service isolé)
│   │   └── export/            PDF, DOCX, audio, images multi-formats
│   └── config/                Tables de configuration VERSIONNÉES (JSON)
│                              → conformité, structures campagnes, tiers langues
├── src/                       Frontend React 19 + Vite 6 + Tailwind 4
│   ├── main.tsx               Point d'entrée
│   ├── app/                   Shell, providers, routage
│   ├── modules/               Les 11 modules du cahier des charges
│   │   ├── cockpit/           Tableau de bord consolidé (CdC §14)
│   │   ├── m01-radar/         Radar Marché
│   │   ├── m02-analyse/       Analyse Stratégique IA
│   │   ├── m03-studio/        Studio de Création (ebooks)
│   │   ├── m04-creatifs/      Créatifs publicitaires + vidéo
│   │   ├── m05-kit-lancement/
│   │   ├── m06-distribution/
│   │   ├── m07-affiliation/
│   │   ├── m08-storybook/
│   │   ├── m09-pages-produits/
│   │   ├── m10-multilingue/
│   │   └── m11-campagnes/
│   ├── features/              auth, account, landing (transverse aux modules)
│   ├── shared/
│   │   ├── ui/                Design system
│   │   ├── charts/            Dataviz — un seul système graphique
│   │   ├── layout/            Header, navigation, pied de page
│   │   ├── hooks/  lib/  types/
│   ├── services/              Clients HTTP typés vers /api
│   ├── data/                  Jeux de démonstration
│   └── styles/
├── _legacy/                   Code mort archivé — exclu du build, pas supprimé
└── public/
```

**Règle de dépendance :** `modules/` → `shared/` → `lib/`. Un module n'importe **jamais**
un autre module. Tout échange inter-modules passe par `app/` ou par un service.
C'est ce qui rend chaque module « développable, testable et déployable indépendamment »
comme l'exige le chapitre 6 du cahier des charges.

## Alias de chemins

`@/*` → `./src/*` et `@server/*` → `./server/*`, déclarés à la fois dans `tsconfig.json`
et `vite.config.ts`. Plus aucun `../../..` dans le code applicatif.

## Flux d'une analyse de niche (modules 1 → 2 → 3 → 4)

```
Utilisateur saisit une niche + un marché
        │
        ▼
POST /api/m01/radar          ─ ingestion Meta Ad Library
        │                      + normalisation des annonces
        ▼
services/scoring             ─ 4 critères pondérés (30/25/25/20 %)
        │                      → score + version_methodologie + détail de calcul
        ▼                      → PERSISTÉ, jamais recalculé à l'affichage
POST /api/m02/analyse        ─ orchestrateur IA : rapport 6 blocs
        │                      chaque affirmation porte sa source
        ▼
POST /api/m03/studio         ─ génération ebook (3 modes)
        │
        ▼
POST /api/m04/creatifs       ─ visuels + vidéo (Higgsfield)
        │
        ▼
services/compliance          ─ PASSAGE OBLIGATOIRE avant tout export
        │                      blocage si promesse de gain chiffrée détectée
        ▼
Export PDF / DOCX / MP4 / publication marketplace
```

## Décisions structurantes

| Sujet | Décision | Justification |
|-------|----------|---------------|
| Secrets | Backend uniquement, jamais de préfixe `VITE_` | Une variable `VITE_*` est inlinée dans le bundle et lisible par tout visiteur |
| Scoring | Score **persisté** avec sa version de méthodologie | CdC §6.1 : traçabilité et confiance utilisateur |
| Conformité | Service REST **isolé**, règles en table de configuration | CdC §6.4.1 : « non négociable », les politiques Meta changent plusieurs fois par an |
| Tables de config | JSON versionnés dans `server/config/`, puis BDD | CdC §6.1.3 : évoluer sans redéploiement |
| Fournisseurs IA | Abstraction **par type de tâche**, pas par fournisseur | CdC §10 : changer de fournisseur sans refactoring |
| Routage | `react-router-dom` v7 | L'état `activeTab` actuel interdit le lien profond, le retour arrière et le partage d'URL |
| Validation | `zod` sur **chaque** entrée d'API | Toute entrée non validée est une faille |
| Dataviz | Recharts, un seul thème de couleurs centralisé | Cohérence visuelle et lisibilité en thème clair comme sombre |

## Sécurité — checklist appliquée

- [ ] `helmet` + CSP stricte (pas de `unsafe-inline`)
- [ ] `express-rate-limit` sur toutes les routes, quota resserré sur les routes IA
- [ ] Validation `zod` de tout corps de requête, tout paramètre, toute query
- [x] CORS sur liste blanche explicite (`CORS_ORIGINS`)
- [x] Écriture refusée (403 `ORIGIN_REFUSED`) quand l'en-tête `Origin` n'est ni autorisé ni celui du
      serveur : un formulaire posté par un site tiers ne peut pas lancer de génération payée
- [x] API limitée à `127.0.0.1` en développement (`HOST`) : les autres appareils du réseau ne la
      joignent pas ; `0.0.0.0` en production
- [ ] Aucune clé côté client — vérifiable par `grep -r "VITE_" src/`
- [ ] Échappement HTML systématique dans tout générateur de document (cf. audit D8)
- [x] Sessions en base, cookie `httpOnly` + `secure` (production, préfixe `__Host-`) + `sameSite=strict`,
      révocables à l'instant ; 12 h au plus pour un compte qui détient des privilèges
- [x] Mots de passe Argon2id (paramètres OWASP), vérification factice sans compte : pas d'énumération
- [x] Verrou anti-force brute en base, par adresse e-mail et par IP, vérifié avant le mot de passe
- [x] Double authentification TOTP avec codes de secours, obligatoire pour l'administration ; code frais
      exigé pour changer un rôle ou des privilèges
- [x] Secrets en base chiffrés AES-256-GCM (`DATA_ENCRYPTION_KEY`) ; Row Level Security activée sur toutes
      les tables, sans politique : l'API REST de Supabase ne lit rien
- [x] Journal d'audit des actions d'administration, écrit dans la même transaction que l'action
- [ ] Jetons OAuth (Meta, marketplaces) chiffrés au repos, jamais journalisés
- [ ] Pas de `dangerouslySetInnerHTML` sans assainissement
- [ ] En-têtes de sécurité vérifiés en CI
