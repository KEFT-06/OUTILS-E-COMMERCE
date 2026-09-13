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
| 0.4 | **Installer Node.js ≥ 20.11** | `node -v` répond | ✅ v24.21.0 |
| 0.5 | `npm install` | `node_modules/` présent | ✅ |
| 0.6 | Reconstruire `LandingPage`, `AccountView`, `BottomLeftModuleMenu` | `npm run build` passe | ✅ |
| 0.7 | Implémenter `server/index.ts` + routes `/api/*` | `npm run dev` sert le front ET l'API | ✅ API vérifiée sur `:3001` |
| 0.8 | `npm run typecheck` sans erreur | 0 erreur TypeScript | ✅ |
| 0.9 | Corriger les bugs D1–D8 de `docs/AUDIT.md` | Chacun vérifié manuellement | ✍️ D1,D2,D3,D6,D7 corrigés · D4,D5,D8 dans _legacy |

## Lot 1 — Socle de confiance (le cœur du produit)

Ce qui distingue Smart Creator de son concurrent direct n'est pas la génération IA —
c'est la **traçabilité**. Ce lot livre les différenciateurs 1, 2 et 3 du cahier des charges.

- **1.1 — Moteur de scoring transparent** (CdC §6.1). Les 4 critères pondérés
  (annonceurs uniques 30 %, publicités actives 25 %, durée de vie 25 %, publicités
  établies 20 %). Le score est **persisté avec sa version de méthodologie**.
  *Acceptation :* cliquer sur n'importe quel taux ouvre un panneau montrant chaque critère,
  sa valeur brute, son poids, sa contribution au total, et l'horodatage de la mesure.
  **✅ Livré.** Moteur dans `server/services/scoring`, panneau dans
  `src/shared/ui/ScoreTracePanel.tsx`, badge rendu cliquable dans `src/shared/ui/RateBadge.tsx`.
  La trace est lue telle que persistée (jamais recalculée à l'affichage) et le panneau
  alerte si la version de méthodologie du serveur a changé depuis la mesure.
  > ⚠️ **Portée réelle :** sur les 5 taux affichés, seul le **taux de saturation
  > concurrentielle** correspond à ce que mesure le moteur (les 4 critères du CdC §6.1).
  > Les 4 autres — demande, rentabilité, opportunité, viralité — sont éditoriaux : leur
  > panneau affiche « méthodologie non publiée » au lieu d'une ventilation reconstituée.
  > Leur donner une méthode de calcul est un travail à part entière, à cadrer.
- **1.2 — Vérificateur de conformité** (CdC §6.4.1). Service isolé, 4 catégories de risque,
  règles en table de configuration éditable sans redéploiement.
  *Acceptation :* saisir « Gagnez 500 000 FCFA/mois » → export **bloqué** + reformulation proposée.
  **✅ Livré et vérifié en bout de chaîne.** La phrase déclenche deux règles bloquantes
  et l'export est refusé, avec la reformulation proposée à l'écran.
  Porte unique dans `src/shared/lib/complianceGate.ts` : `exportReportPDF()` est le seul
  chemin d'export exposé, la vérification n'est donc pas une ligne qu'un bouton peut
  oublier d'appeler. L'impression (`window.print()`) passe par le même contrôle — elle
  produit un document diffusable au même titre qu'un téléchargement.
  Le refus s'affiche via `src/shared/ui/ComplianceBlockDialog.tsx`, **sans bouton
  « exporter quand même »** : un veto contournable n'est pas un veto.
  > 🐛 **Bug corrigé au passage — le service était inopérant en production.**
  > `compliance/index.ts` résolvait sa table via `import.meta.url`. Après bundling
  > esbuild en `dist/server.js`, le chemin pointait hors du projet
  > (`<projet>/../config/compliance-rules.json`) : chaque appel échouait en 500.
  > Le chemin se résout désormais depuis le répertoire de travail, surchargeable par
  > `COMPLIANCE_RULES_PATH`. Vérifié sur le build, pas seulement en dev.
  > 🐛 **Trou dans la table de règles — corrigé.** La règle bloquante sur les gains
  > chiffrés utilisait `\w`, qui en JavaScript ne couvre pas les lettres accentuées.
  > « J'ai **gagné** 250 000 FCFA » n'était donc qu'un simple avertissement. Table
  > passée en v2026.09.2 ; la phrase bloque désormais.
  > ⚠️ **Échec fermé, à connaître :** si la table est illisible ou l'API injoignable,
  > l'export est **bloqué**, pas autorisé. Un export qui passe parce que le
  > vérificateur est en panne est exactement le trou que le veto doit fermer.
- **1.3 — Simulateur de crédits IA** (CdC §8). Composant transversal affiché avant **chaque**
  action consommant des points.
  *Acceptation :* coût, équivalent monétaire, solde avant, solde après — visibles avant validation.
  **✅ Livré.** Les quatre informations sont affichées avant validation par
  `src/shared/ui/CreditSimulatorDialog.tsx`.
  Rendu transversal via `CreditGateProvider` et `runWithCredits(actionId, action)` : si chaque
  écran devait instancier sa propre confirmation, la règle serait respectée le jour de son
  écriture et violée au troisième écran ajouté. Câblé sur l'analyse de niche et le scan Radar.
  Grille tarifaire dans `server/config/credit-costs.json`, éditable sans redéploiement,
  servie par `GET /api/credits/costs`.
  - Les points ne sont **débités qu'après succès** : facturer une action qui n'a rien
    produit serait indéfendable. Les chemins d'échec lèvent pour garantir ce comportement.
  - Fermer la fenêtre vaut refus ; aucune action n'est déclenchée sans clic sur « Confirmer ».
  - Échec fermé : sans grille tarifaire, aucune action n'est lancée — débiter à l'aveugle
    serait pire que ne rien faire.
  > ⚠️ **`pointValueFcfa: 250` est une valeur provisoire que j'ai choisie**, pas une donnée
  > commerciale. Elle remplace un « ≈ 12 500 FCFA » qui était écrit en dur dans le Cockpit
  > sans source. **À valider avant toute mise en production facturée.** Le statut provisoire
  > est affiché à l'utilisateur dans le simulateur tant qu'il n'est pas levé.
- **1.4 — Mention légale obligatoire** sur chaque rapport (CdC §9.4).
  **✅ Livré.** `src/shared/ui/LegalNotice.tsx` sur la vue d'analyse et l'aperçu du rapport,
  texte tiré de la table de conformité (source unique) avec repli si l'API est absente.
  Dans le PDF, la mention est répétée **sur chaque page** : un rapport se diffuse souvent en
  extrait ou en capture, et une mention qui ne survit pas au découpage ne protège personne.
  `generateAnalysisPDF()` exige désormais un tampon de conformité — un PDF ne peut plus être
  produit sans être passé par le vérificateur.
  > 🐛 **Fausse allégation supprimée.** Le PDF imprimait, pour chaque campagne,
  > « ✓ Conformité Meta Ads : 100% validé — Pas d'allégations trompeuses ». Cette ligne était
  > écrite en dur : elle s'affichait à l'identique quel que soit le contenu, y compris sur une
  > campagne que le vérificateur n'avait jamais examinée. Remplacée par le résultat réel du
  > contrôle (horodatage, version de la table, nombre de points de vigilance).
- **1.5 — Purge des fausses données** : le Cockpit ne doit plus afficher de chiffres inventés
  sous le libellé « Performance Réelle ». Soit données réelles, soit état vide explicite.
  **✅ Livré.** Quatre foyers supprimés :
  1. `CockpitDashboard` — le bloc « Performance Réelle des Ventes » (485k FCFA, 124 ventes,
     ROI 3,2x, +24,5 %, graphique 7 jours) attribué à une agrégation Maketou & Taliopay,
     remplacé par `NoDataState` ; aucun de ces deux services ne publie d'API (CdC §6.6).
  2. `CockpitDashboard` — le solde de crédits écrit en dur (`38 / 100`, « ≈ 12 500 FCFA »),
     désormais lu depuis le profil, source unique partagée avec la page Compte.
     *Au passage :* les deux écrans se contredisaient — 38 points « restants » au cockpit
     contre 62 sur le compte, le `38` étant en réalité le nombre de points **consommés**.
  3. `CockpitDashboard` — deux « marchés suivis » fictifs et leurs variations inventées,
     remplacés par la niche réellement analysée (tension issue de sa trace) et les niches
     enregistrées par l'utilisateur, sans score fabriqué.
  4. `App.tsx` — le repli de ~180 lignes qui fabriquait un rapport complet (concurrents,
     volumes de recherche, conformité « validée ») quand `/api/analyze-niche` échouait.
     Le message d'erreur du serveur est maintenant remonté tel quel.
  > Reste à traiter hors périmètre 1.5 : la timeline du plan d'action affichait un
  > avancement fictif — elle rend désormais le `strategicActionPlan` du rapport, mais
  > aucun suivi d'avancement réel n'existe encore.

## Lot 2 — Données réelles (module 1)

- **2.1** Pipeline d'ingestion Meta Ad Library — conçu comme module interchangeable.
- **2.2** Galerie publicitaire filtrable (format, durée, CTA, budget estimé, marché).
- **2.3** Swipe file personnel + export CSV/PDF.
- **2.4** Fiche annonceur avec historique.
- **2.5** Fourchettes de prix **dynamiques en base**, jamais figées dans le code (CdC §2).
  **✅ Livré.** Les bornes vivaient dans les attributs `min`/`max` de deux curseurs React
  (`9–199 €` pour le prix, `4–40 €` pour le CPA) : corriger un prix de marché exigeait un
  redéploiement. Elles sont désormais dans `server/config/pricing.json`, servies par
  `GET /api/pricing/ranges`, avec validation de cohérence au chargement (`min < max`,
  valeur par défaut dans l'intervalle) — une fourchette incohérente est refusée plutôt
  que de produire un curseur inutilisable.
  `usePricing()` n'a **aucune valeur de repli** : un repli codé en dur reproduirait
  exactement ce que le CdC interdit. Sans table, le simulateur reste inactif et le dit.
  > ⚠️ Les bornes ont été reprises **telles quelles** depuis l'ancien code figé. Elles
  > n'ont aucune source marché et restent à réviser sur données réelles. Leur statut
  > provisoire est affiché sous le simulateur.
  > ⚠️ La devise reste l'euro, comme dans le code d'origine, alors que le produit vise
  > l'Afrique francophone. La table porte désormais `currency`/`currencySymbol`, donc le
  > passage au FCFA est une modification de configuration — mais c'est une décision
  > commerciale, pas technique.
- **2.6** Dataviz de traçabilité : chaque graphique affiche sa source, sa date de collecte et
  son volume d'échantillon. Un graphique sans provenance affichée est un graphique refusé.
  **✅ Livré.** `src/shared/ui/ChartProvenance.tsx` sous les six graphiques de l'application
  (radar décisionnel, momentum des requêtes, rétention et durées de scènes, nuage et
  classement du Radar).
  Le composant **ne s'efface pas** quand la provenance manque : il affiche « provenance non
  renseignée ». C'est l'intérêt de le rendre obligatoire — un graphique dont on a oublié la
  source se signale à l'écran au lieu de passer inaperçu.
  Les jeux de démonstration portent un badge « Démonstration » explicite : sans lui, une
  démo se lit comme une mesure de marché. La provenance du Radar est dérivée du résultat de
  scan lui-même (plateformes réellement interrogées, horodatage, volume), pour ne pas avoir
  à la redéclarer et donc à la laisser diverger.

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
