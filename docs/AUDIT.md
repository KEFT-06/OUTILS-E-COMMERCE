# Audit du code existant — Smart Creator

> Audit réalisé sur les 62 fichiers du dépôt tel que généré par Google AI Studio,
> avant restructuration. Chaque point est vérifié dans le code, pas supposé.
> Commit de référence : `9c01371` (snapshot avant travaux).

## 1. Bloquants — l'application ne démarre pas

| # | Constat | Impact | Statut |
|---|---------|--------|--------|
| B1 | `vite.config.ts` vide | Ni plugin React ni Tailwind v4 : JSX non transpilé, CSS non traité | ✅ Corrigé |
| B2 | `tsconfig.json` vide | `tsc --noEmit` impossible, aucun typage vérifié | ✅ Corrigé |
| B3 | `server.ts` vide, mais `dev` = `tsx server.ts` | `npm run dev` ne lançait **ni** Vite **ni** l'API | 🔶 Squelette posé, à implémenter |
| B4 | `LandingPage.tsx` vide, importé par `App.tsx` | Erreur de build « no export named » | ⛔ À reconstruire |
| B5 | `AccountView.tsx` vide, importé par `App.tsx` | Idem | ⛔ À reconstruire |
| B6 | `BottomLeftModuleMenu.tsx` vide, importé par `App.tsx` | Idem | ⛔ À reconstruire |
| B7 | Node.js absent de la machine, `node_modules/` absent | Rien ne peut être construit ni testé localement | ⛔ Action utilisateur |
| B8 | Projet non versionné (dépôt git = `C:\Users\FOKO`, 0 fichier suivi) | 19 fichiers perdus sans filet | ✅ Corrigé (`git init`) |

**19 fichiers étaient à 0 octet.** Aucun n'était récupérable : il n'existait aucun historique.

## 2. Code mort — ~40 % du dépôt jamais monté

Le graphe d'imports depuis `main.tsx` révélait **deux îlots disjoints**. Tout ce qui suit
n'était atteint par aucun chemin d'exécution :

- **Module e-commerce complet (~120 Ko)** — `EcommerceContext` (520 lignes, fonctionnel),
  `CartDrawer`, `CheckoutModal`, `DashboardView`, `MarginCalculator`, `CouponManager`,
  `CustomerManager`, `InvoiceModal`, `types/ecommerce.ts`, `initialEcommerceData.ts`.
  `EcommerceProvider` n'était monté nulle part.
- **Ancien constructeur de sites** — `Header`, `SiteCustomizer`, `TechFeatures`,
  `InquiryModal`, les 4 démos `templates/`, `htmlExporter.ts`, `presets.ts`, `types.ts`.

→ Archivé dans `_legacy/`, exclu du build via `tsconfig.exclude`. **Rien n'est supprimé** :
`MarginCalculator` (simulateur marge/ROAS) et la logique panier/commande de `EcommerceContext`
sont récupérables pour les modules 6.5 et 6.6. Voir `_legacy/README.md`.

## 3. Bugs de correction identifiés

| # | Fichier | Défaut | Gravité |
|---|---------|--------|---------|
| D1 | `m01-radar/RadarTrendsView.tsx` | Bar chart trié + `slice(0,5)` mais `<Cell>` mappées sur le tableau **non trié** → couleurs désalignées avec les barres | Moyenne |
| D2 | `m04-creatifs/MetaVideoStudioView.tsx` | `s.timing.split(' - ').map(t => parseInt(t.split(':')[1]))` ignore les minutes : durée fausse ou négative au-delà de 59 s | Moyenne |
| D3 | `m04-creatifs/MetaVideoStudioView.tsx` | `timerRef` typé `NodeJS.Timeout` en code navigateur ; `clearInterval()` appelé sur un `setTimeout()` | Faible |
| D4 | `_legacy/ecommerce/EcommerceContext.tsx` | 6 × `JSON.parse(localStorage…)` sans `try/catch` → un octet corrompu plante l'app au montage | Haute |
| D5 | `_legacy/ecommerce/EcommerceContext.tsx` | `newCart[i].quantity = …` mute un objet du state en place | Moyenne |
| D6 | `features/auth/LoginPage.tsx`, `m01-radar/` | `slate-850` / `slate-750` n'existent pas dans Tailwind → 6 classes ignorées, carte de login sans fond | Moyenne |
| D7 | `m01-radar/RadarTrendsView.tsx` | Échec de `/api/radar-trends` → `console.error` seul : écran vide, aucun message utilisateur | Haute |
| D8 | `_legacy/site-builder/htmlExporter.ts` | Interpolation non échappée dans le HTML généré → injection possible via le nom du site | Haute |

## 4. Cohérence produit

- **i18n à ~5 %** — `t()` n'est appelé que 27 fois pour plusieurs milliers de chaînes.
  Le script `_legacy/scripts-migration/fix-cockpit.cjs` a **échoué partiellement** : il a injecté
  `usePreferences` mais ses remplacements `>Cockpit Créateur<` n'ont pas matché (indentation JSX).
  `CockpitDashboard.tsx:53` est resté en dur.
- **Thème sombre cassé** — `dark:` n'existe que dans `NexusHeader` (15×), `RateBadge`,
  `RadarTrendsView` et `App`. Les 6 grandes vues sont en `bg-white` codé en dur.
- **Authentification factice** — `AuthContext` connecte `DEFAULT_USER` par défaut, `login()`
  accepte n'importe quoi, e-mail personnel en dur dans deux fichiers, mot de passe pré-rempli.
- **Données fictives présentées comme réelles** — le Cockpit affiche « Performance Réelle des
  Ventes · Agrégation Maketou & Taliopay » sur des chiffres codés en dur (485k FCFA, 124 ventes,
  ROI 3.2×). **Contraire à la section 9.4 du cahier des charges** (transparence des promesses).
- Aucun test, aucune configuration ESLint, aucun `ErrorBoundary`.

## 5. Écart avec le cahier des charges

Le cahier spécifie **11 modules**. État réel du code livré :

| Module | Spécifié | Codé | Écart |
|--------|----------|------|-------|
| 1 — Radar Marché | Scoring 4 critères pondérés, galerie filtrable, swipe file, fiche annonceur | UI de scan + 2 graphiques, **données simulées** | Aucune ingestion réelle, aucun scoring |
| 2 — Analyse Stratégique IA | Rapport 6 blocs, détail de calcul consultable | Vue 5 taux + radar, 2 rapports figés | Pas de blocs 3/4/5/6, pas de détail de calcul |
| 3 — Studio de Création | 3 modes, anti-plagiat, PDF/DOCX | Simulateur de rentabilité uniquement | Aucune génération de contenu |
| 4 — Créatifs publicitaires | Génération + **vérificateur de conformité bloquant** | Storyboard statique, conformité **affichée en dur à « 100 % validé »** | Différenciateur n°2 absent |
| 5 — Kit de Lancement | Copie pub, scripts 15/30/60 s, CTA par marché | ❌ Placeholder | Tout |
| 6 — Distribution | Connecteurs adapter pattern | ❌ Placeholder | Tout |
| 7 — Affiliation | Liens UTM, commissions | ❌ Placeholder | Tout |
| 8 — Storybook Africain | Cohérence de personnage, export PDF illustré | ❌ Placeholder | Tout |
| 9 — Pages Produits | 7 sections, image par rôle de conversion, A/B | ❌ Placeholder | Tout |
| 10 — Multilingue | Tier A/B/C, réseau de relecteurs | ❌ Placeholder | Tout |
| 11 — Campagnes Meta/TikTok | Blueprints + connecteur OAuth | ❌ Placeholder | Tout |

**Aucun des 14 différenciateurs** de la section 4 du cahier n'est implémenté à ce jour.

## 6. Ce qui est solide et doit être conservé

- `shared/types/analysis.ts` — typage complet, propre, fidèle au domaine métier.
- `shared/lib/pdfGenerator.ts` — jsPDF natif, 6 sections, pagination, pied de page. Bonne base.
- `shared/ui/*` — primitives correctes sur Radix.
- `data/presetAnalyses.ts` — 2 rapports de démonstration riches et cohérents.
- `m04-creatifs/MetaVideoStudioView.tsx` — simulateur vidéo avec Web Speech API et zones de
  sécurité 9:16. Réellement bien pensé.
- **Aucune clé d'API en dur nulle part** — le seul bon point de sécurité du code initial.
