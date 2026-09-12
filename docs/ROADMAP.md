# Feuille de route d'exécution — Smart Creator

> Traduction du cahier des charges (septembre 2026) en lots livrables et vérifiables.
> Chaque lot a un critère d'acceptation binaire : soit il est démontrable à l'écran, soit non.

## Lot 0 — Remettre le projet debout ⚠️ BLOQUANT

Rien d'autre ne peut être testé tant que ce lot n'est pas terminé.

| # | Tâche | Critère d'acceptation | État |
|---|-------|----------------------|------|
| 0.1 | `git init` + snapshot de sécurité | `git log` affiche le commit initial | ✅ |
| 0.2 | Restructuration en modules + alias `@/` | 0 import relatif dans `src/`, 26/26 alias résolvent | ✅ |
| 0.3 | `tsconfig.json` + `vite.config.ts` | Fichiers présents, `strict: true` | ✅ |
| 0.4 | **Installer Node.js ≥ 20.11** | `node -v` répond | ⛔ **Action utilisateur** |
| 0.5 | `npm install` | `node_modules/` présent | ⛔ Dépend de 0.4 |
| 0.6 | Reconstruire `LandingPage`, `AccountView`, `BottomLeftModuleMenu` | `npm run build` passe | ✍️ Écrit, non compilé |
| 0.7 | Implémenter `server/index.ts` + routes `/api/*` | `npm run dev` sert le front ET l'API | ✍️ Écrit, non compilé |
| 0.8 | `npm run typecheck` sans erreur | 0 erreur TypeScript | ⛔ |
| 0.9 | Corriger les bugs D1–D8 de `docs/AUDIT.md` | Chacun vérifié manuellement | ✍️ D1,D2,D3,D6,D7 corrigés · D4,D5,D8 dans _legacy |

## Lot 1 — Socle de confiance (le cœur du produit)

Ce qui distingue Smart Creator de son concurrent direct n'est pas la génération IA —
c'est la **traçabilité**. Ce lot livre les différenciateurs 1, 2 et 3 du cahier des charges.

- **1.1 — Moteur de scoring transparent** (CdC §6.1). Les 4 critères pondérés
  (annonceurs uniques 30 %, publicités actives 25 %, durée de vie 25 %, publicités
  établies 20 %). Le score est **persisté avec sa version de méthodologie**.
  *Acceptation :* cliquer sur n'importe quel taux ouvre un panneau montrant chaque critère,
  sa valeur brute, son poids, sa contribution au total, et l'horodatage de la mesure.
- **1.2 — Vérificateur de conformité** (CdC §6.4.1). Service isolé, 4 catégories de risque,
  règles en table de configuration éditable sans redéploiement.
  *Acceptation :* saisir « Gagnez 500 000 FCFA/mois » → export **bloqué** + reformulation proposée.
- **1.3 — Simulateur de crédits IA** (CdC §8). Composant transversal affiché avant **chaque**
  action consommant des points.
  *Acceptation :* coût, équivalent monétaire, solde avant, solde après — visibles avant validation.
- **1.4 — Mention légale obligatoire** sur chaque rapport (CdC §9.4).
- **1.5 — Purge des fausses données** : le Cockpit ne doit plus afficher de chiffres inventés
  sous le libellé « Performance Réelle ». Soit données réelles, soit état vide explicite.

## Lot 2 — Données réelles (module 1)

- **2.1** Pipeline d'ingestion Meta Ad Library — conçu comme module interchangeable.
- **2.2** Galerie publicitaire filtrable (format, durée, CTA, budget estimé, marché).
- **2.3** Swipe file personnel + export CSV/PDF.
- **2.4** Fiche annonceur avec historique.
- **2.5** Fourchettes de prix **dynamiques en base**, jamais figées dans le code (CdC §2).
- **2.6** Dataviz de traçabilité : chaque graphique affiche sa source, sa date de collecte et
  son volume d'échantillon. Un graphique sans provenance affichée est un graphique refusé.

> ⚠️ **Dépendance externe critique.** L'accès à la Meta Ad Library au-delà du volume public
> exige App Review + Business Verification. Le cahier des charges (§6.11.5) impose d'engager
> cette démarche **dès la phase 2** car son délai d'instruction dépasse souvent le temps de
> développement. À lancer maintenant, pas quand le connecteur sera prêt.

## Lot 3 — Production de contenu (modules 3, 8)

- **3.1** Studio de Création, 3 modes : Génératif, Expert, Vidéo → Produit.
- **3.2** Vérificateur anti-plagiat, avertissement bloquant sous 70 % d'originalité.
- **3.3** Export PDF (sommaire cliquable + bibliographie) et DOCX.
- **3.4** **Storybook Africain via Gamma** — contes illustrés, ancrage culturel par pays.
- **3.5** Cohérence de personnage : seed réutilisé à chaque page. Contrainte technique n°1
  du module, à valider auprès du fournisseur d'images **avant** de s'engager sur le module.

## Lot 4 — Créatifs & vidéo (module 4)

- **4.1** Génération de visuels, 3 formats, niveau de conscience prospect **obligatoire**.
- **4.2** **Higgsfield AI** texte-à-vidéo : avatars localisés, 9:16 / 1:1 / 16:9.
- **4.3** **Higgsfield Genjutsu** : Motion Transfer & Object Swap.
- **4.4** Passage conformité obligatoire avant téléchargement — sans exception.

## Lot 5 — Vendre (modules 5, 6, 9, 11)

- **5.1** Kit de Lancement : copie pub, scripts 15/30/60 s, CTA par marché.
- **5.2** Connecteurs marketplace en **adapter pattern**. Chariow en premier : c'est le seul
  à disposer d'une API publique documentée (`chariow.dev`). Il sert de gabarit de référence.
- **5.3** Générateur de pages produits : 7 sections, une image par rôle de conversion, A/B.
- **5.4** Blueprints de campagnes Meta & TikTok, valeurs en table de configuration.

> ⚠️ Ni Maketou ni Taliopay ne publient de documentation d'API. Le cahier des charges le dit
> lui-même (§6.6). Construire Chariow d'abord, puis brancher les autres sur la même interface
> une fois le partenariat négocié. Ne pas bloquer le lot sur une API qui n'existe pas.

## Lot 6 — Échelle (modules 7, 10, boucle de performance)

- Affiliation, multilingue Tier A/B/C, réseau de relecteurs, boucle de performance opt-in
  avec agrégation minimale de 5 vendeurs.

## Ordre de bataille recommandé

```
Lot 0 ──▶ Lot 1 ──▶ Lot 2 ──▶ Lot 3 ──▶ Lot 4 ──▶ Lot 5 ──▶ Lot 6
BLOQUANT  Confiance  Données   Contenu   Vidéo    Vente    Échelle
                     réelles
          └── En parallèle dès le Lot 1 : démarches Meta Business Verification
```

**Pourquoi le Lot 1 avant le Lot 2 :** un scoring transparent sur données de démonstration
clairement étiquetées « démonstration » est honnête et démontrable. Un scoring opaque sur
données réelles ne vaut rien et reproduit exactement la faille reprochée au concurrent
(cahier des charges, chapitre 3).
