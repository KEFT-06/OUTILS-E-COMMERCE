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
  **🟡 Pipeline livré, source réelle bloquée.**
  Tout ce que l'application connaît de l'ingestion tient dans l'interface
  `AdIngestionAdapter` (`server/services/ingestion/types.ts`). Ajouter TikTok Creative
  Center ou un fournisseur tiers revient à déposer une implémentation dans le registre :
  ni les routes, ni l'interface, ni le moteur de scoring n'ont à le savoir.
  - `deriveSignals()` est centralisé, pas dupliqué par adaptateur : deux sources doivent
    calculer leurs signaux de la même façon, sinon les scores ne sont plus comparables.
  - `POST /api/ingestion/scan` exécute la chaîne complète — collecte → signaux →
    `computeCompetitiveScore` → trace vérifiable — et renvoie la provenance **avec** les
    chiffres, pour que l'interface n'ait pas à la reconstituer.
  - `GET /api/ingestion/adapters` dit quelles sources existent, laquelle est active, et
    pourquoi une source indisponible l'est.
  - Adaptateur `fixture` pour exercer le pipeline sans accès Meta. Il ne s'active que sur
    `AD_INGESTION_ADAPTER=fixture`, jamais par défaut : s'il se déclenchait par simple
    absence de configuration, une installation mal paramétrée servirait des chiffres
    fictifs en croyant servir le marché. Sortie déterministe, annonceurs ouvertement
    fictifs, étiquette « démonstration » portée jusqu'à l'écran.
  > ⛔ **Bloqué sur toi :** l'adaptateur Meta est **écrit mais non vérifié contre l'API
  > réelle**. Son mapping suit la documentation publique de `ads_archive` et doit être
  > confronté à une vraie réponse. Il lui faut un jeton délivré après App Review +
  > Business Verification — démarche à engager maintenant, son instruction dépasse
  > souvent le temps de développement (CdC §6.11.5).
- **2.2** Galerie publicitaire filtrable (format, durée, CTA, budget estimé, marché).
  **🟡 Livré partiellement — filtres limités à ce que la source fournit.**
  Onglet « Galerie Publicitaire » (`src/modules/m01-radar/AdGalleryView.tsx`), alimenté par
  `POST /api/ingestion/scan`. Score et publicités arrivent **dans la même réponse** : la galerie
  montre exactement la collecte dont le score est issu. Statut, durée de vie et caractère
  « établi » sont calculés par le serveur avec les fonctions qui produisent les signaux
  (`annotateAd`), jamais recalculés dans le navigateur — vérifié : sur 150 publicités,
  119 actives et 84 établies côté galerie comme côté score.
  - Filtres livrés : marché (à la collecte), statut actif/arrêté, durée de diffusion minimale,
    recherche par annonceur ou texte.
  - **Non livrés : format, CTA, budget estimé.** Aucune source branchée ne les fournit, et leur
    disponibilité dans la Meta Ad Library pour des publicités commerciales reste à vérifier
    contre l'API réelle (le budget n'y est documenté que pour les publicités politiques ou
    sociales). L'écran le dit ; ils ne seront pas estimés.
  - Liens externes filtrés par `safeHttpUrl` : une URL « javascript: » fournie par une source
    s'exécuterait au clic.
  - Collecte soumise au simulateur de crédits (nouvelle action `ad_gallery_scan`, grille v2026.09.2).
- **2.3** Swipe file personnel + export CSV/PDF.
  **✅ Livré, stockage navigateur.** Sauvegarde depuis la galerie, notes personnelles, export CSV
  et PDF (`src/shared/lib/useSwipeFile.ts`, `src/shared/lib/swipeExport.ts`).
  - Lecture du stockage validée entrée par entrée (leçon de l'audit D4) : un octet corrompu coûte
    une entrée, pas l'écran. Échec d'écriture signalé à l'écran plutôt que perdu en silence.
    Synchronisation entre onglets.
  - CSV : séparateur « ; » et BOM pour Excel en français ; **neutralisation des formules** — une
    cellule commençant par `=`, `+`, `-` ou `@` venue d'une publicité tierce s'exécuterait à
    l'ouverture du fichier.
  - PDF : mention légale sur chaque page ; emojis retirés, les polices de jsPDF ne les rendent pas.
  - **Choix assumé :** l'export du swipe file ne passe **pas** par le veto de conformité. Il
    rassemble des publicités de tiers pour la veille, pas un contenu publié ; le bloquer rendrait
    l'outil inutile sur les annonces qui méritent d'être étudiées. Chaque export se déclare en tête
    comme document de veille non destiné à la diffusion, et signale les publicités de démonstration.
  > Stockage local uniquement : la synchronisation avec le compte attend la base de données.
- **2.4** Fiche annonceur avec historique.
  **🟡 Livré sur une collecte.** `src/modules/m01-radar/AdvertiserSheet.tsx` : publicités, actives,
  établies, diffusion moyenne, frise de diffusion. La fiche indique explicitement que l'historique
  se limite à la collecte en cours : un suivi dans le temps suppose de conserver les collectes
  successives, donc la base de données.
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
  **🟡 Mode Expert livré ; les deux autres affichés désactivés, avec leur raison.**
  `ProductStudioPanel` et `ProductExpertEditor` (`src/modules/m03-studio/`) : titre, sous-titre,
  public, promesse, modules (ajout, suppression, numérotation), lead magnet. Les retouches sont
  un brouillon **à côté** de la version du rapport, jamais à sa place : on peut y revenir, et
  l'export porte la mention « version retouchée ». Le Studio affiche la version qui sera exportée.
  - Génératif et Vidéo → Produit restent désactivés : la génération par IA n'est pas implémentée
    et dépend d'un fournisseur de texte (et de transcription pour la vidéo). Les masquer
    laisserait croire qu'ils n'ont jamais été prévus ; les activer produirait un bouton qui échoue.
  - Brouillons et swipe file partagent désormais `createPersistentStore` : lecture validée,
    échec d'écriture signalé, synchronisation entre onglets.
- **3.2** Vérificateur anti-plagiat, avertissement bloquant sous 70 % d'originalité.
  **✅ Livré — originalité mesurée contre un corpus connu, pas contre le web.**
  `server/services/originality`, `POST /api/originality/check`, paramètres dans
  `server/config/originality.json` (seuil 70 %, n-grammes de 5 mots, 30 mots minimum).
  Chaque mot couvert par une suite de 5 mots identique dans une référence compte comme repris ;
  comparaison insensible à la casse et aux accents. Chaque verdict montre les passages en cause.
  Vérifié sur 5 cas : texte trop court → non mesurable ; sans référence → non mesurable ;
  moitié recopiée → 51,6 % bloquant ; texte original → 100 % ; copie en majuscules sans accents
  → 0 % bloquant.
  - Blocage intégré à la porte d'export du produit, avec échec fermé si le service ne répond pas.
    Une mesure **impossible** (texte court, aucune référence) ne bloque pas : elle est imprimée
    comme telle dans le document.
  - Corpus actuel : les publicités du swipe file. Les textes « concurrents » du rapport sont
    exclus à dessein — ils sont rédigés par l'analyse de Smart Creator, et les comparer ferait
    passer pour du plagiat la reprise de notre propre analyse. Le corpus serveur part vide :
    le remplir de textes inventés produirait des mesures sans valeur.
  > ⚠️ **Limite à ne jamais masquer :** ce n'est pas une recherche sur le web. La portée de la
  > mesure est affichée avec chaque verdict et imprimée dans chaque export.
- **3.3** Export PDF (sommaire cliquable + bibliographie) et DOCX.
  **✅ Livré, vérifié sur les fichiers générés.** PDF et DOCX sont rendus depuis **un même modèle
  neutre** (`src/shared/lib/productDocument.ts`) : deux moteurs lisant chacun la donnée brute
  finissent par produire deux documents différents pour le même produit.
  - PDF : lien interne sur chaque ligne du sommaire **et** signet par chapitre (les lecteurs
    n'exploitent pas tous le même mécanisme). Sur le produit de démonstration : 3 pages,
    17 destinations internes (8 lignes de sommaire + 9 signets).
  - DOCX : sommaire en liens internes vers des signets posés sur chaque titre — 8 signets,
    8 liens, 0 lien cassé. Pas de table des matières automatique Word, qui reste vide tant que
    l'utilisateur n'a pas mis à jour les champs.
  - Bibliographie : sources web du rapport, provenance des données (source, date, échantillon),
    concurrents analysés. Rapport de démonstration signalé comme tel : ses entrées ne sont pas
    des sources vérifiées. Liens externes filtrés par `safeHttpUrl`.
  - Mention légale sur chaque page, section « Contrôles avant export » (conformité, originalité,
    date). Le paramètre de contrôle est obligatoire : aucun rendu sans vérification.
  - `docx` chargé à la demande : fichier séparé de 346 ko, absent du bundle principal.
- **3.4** **Storybook Africain via Gamma** — contes illustrés, ancrage culturel par pays.
  **🟡 Livré, non vérifié contre l'API réelle (aucune clé Gamma disponible).**
  `server/services/storybook`, `POST /api/storybook/generations`, `GET /api/storybook/generations/:id`,
  écran `src/modules/m08-storybook/StorybookView.tsx`. Écrit d'après la documentation de l'API
  publique Gamma v1.0 consultée le 14 septembre 2026.
  - Brief : pays (17 marchés), langue FR/EN, âge, nombre de pages, personnage, thème, éléments
    culturels, style visuel.
  - **Ancrage culturel sans invention.** Smart Creator ne fournit aucune « base culturelle » par
    pays : elle aurait été rédigée sans source. Gamma reçoit la consigne de n'utiliser comme
    références culturelles précises que les éléments fournis par l'auteur, sans caricature ni
    stéréotype.
  - Conformité du brief contrôlée **avant** tout appel (422 avec constats), puis disponibilité
    de Gamma (503 explicite) : l'auteur peut corriger son brief même sur un serveur sans clé.
  - Le lien d'export PDF de Gamma est un secret (téléchargeable sans clé) : il ne quitte jamais le
    serveur. Le client reçoit le lien de consultation, partagé en lecture avec quiconque le détient
    — l'écran le dit. Les crédits restants du compte Gamma ne sont pas exposés.
  - Points débités seulement une fois le conte terminé ; échec, écran quitté ou dépassement de
    10 minutes : aucun débit. **Coût fixé à 15 points : valeur provisoire, à arbitrer.**
  - L'écran affiche que la cohérence du personnage n'est pas garantie (3.5) et que le conte généré
    n'est pas relu par le vérificateur de conformité.
  - L'ancien placeholder promettait une « garantie de cohérence des personnages » : promesse retirée.
  Vérifié : requêtes FR/EN construites, deux fautes corrigées avant envoi (« le contexte de le
  Sénégal », « enfants de 6-8 ans ») ; routes : brief conforme sans clé → 503, brief avec promesse
  de gains → 422 et 2 constats, brief invalide → 400, identifiant de suivi piégé → 400.
  > ⛔ **Bloqué sur toi :** une clé API Gamma (offre Pro minimum) pour vérifier contre l'API réelle,
  > et la décision 3.5 sur la cohérence du personnage.
- **3.5** Cohérence de personnage : seed réutilisé à chaque page. Contrainte technique n°1
  du module, à valider auprès du fournisseur d'images **avant** de s'engager sur le module.
  **⛔ Validation faite : pas de seed chez Gamma. Décision requise avant de construire le module.**
  Vérifié dans la documentation de l'API publique Gamma v1.0 le 14 septembre 2026 :
  - La génération de documents (`POST /v1.0/generations`) n'expose que `imageOptions.model`,
    `source` et `style` : **aucun seed, aucune référence de personnage**.
  - L'endpoint d'images autonome (`POST /v1.0/images`) accepte jusqu'à 4 `referenceImages` de
    rôle `subject`, **sans seed**.
  L'approche du cahier des charges (seed réutilisé à chaque page) est donc impossible avec Gamma.
  Deux options : (a) générer chaque illustration via `/v1.0/images` avec la même image de
  référence du personnage, puis assembler le conte — cohérence à éprouver sur un vrai conte avant
  tout engagement ; (b) retenir un autre fournisseur d'images qui expose un seed.
  **Piste identifiée pour (b)** : d'après la spécification OpenAPI publique de Higgsfield (consultée
  le 14 septembre 2026), l'endpoint `/higgsfield-ai/soul/character` accepte un
  `custom_reference_id` (personnage de référence), une `custom_reference_strength` et un `seed`.
  C'est le seul mécanisme trouvé qui corresponde à l'exigence du cahier des charges ; il reste à
  éprouver sur un vrai conte (même personnage, 8 à 12 illustrations) avant de s'engager. Tant que ce
  choix n'est pas fait, le Storybook ne doit pas promettre un personnage cohérent d'une page à
  l'autre.

## Lot 4 — Créatifs & vidéo (module 4)

> Tout le Lot 4 est écrit d'après la **spécification OpenAPI publique de Higgsfield** et sa
> documentation (docs.higgsfield.ai), consultées le 14 septembre 2026, et **non vérifié contre
> l'API réelle** : aucun identifiant n'est disponible. Service : `server/services/higgsfield`
> (client) et `server/services/creatives` (briefs et prompts) ; écran :
> `src/modules/m04-creatifs/CreativeGeneratorPanel.tsx`, dans l'onglet Créatifs Publicitaires.

- **4.1** Génération de visuels, 3 formats, niveau de conscience prospect **obligatoire**.
  **🟡 Livré, non vérifié contre l'API réelle.** Modèle `/higgsfield-ai/soul/standard`, formats
  1:1, 9:16 et 16:9.
  - Niveau de conscience (Eugene Schwartz : inconscient → pleinement conscient) obligatoire dans le
    schéma serveur **et** sans valeur présélectionnée à l'écran : un choix par défaut serait retenu
    par inadvertance et orienterait tout le créatif. Chaque niveau porte sa direction créative.
  - Ancrage pays sans caricature ; consigne « aucun texte » quand l'auteur n'en demande pas ; aucun
    logo réel, aucune célébrité, aucun chiffre ou témoignage inventé.
  Vérifié : prompts construits, brief sans niveau de conscience ou au format 4:3 → 400.
- **4.2** **Higgsfield AI** texte-à-vidéo : avatars localisés, 9:16 / 1:1 / 16:9.
  **🟡 Texte-à-vidéo livré ; avatars localisés bloqués côté fournisseur.**
  Modèle `/kling-video/v2.1/master/text-to-video` : c'est le modèle de l'API publique qui accepte
  **les trois** formats du cahier des charges (Veo 3.1 n'offre pas le 1:1). Durée 5 ou 10 s,
  prompt plafonné aux 2 500 caractères du modèle.
  > ⛔ **Avatars localisés : aucun endpoint d'avatar, de lip-sync ou de « speak » dans la
  > spécification publique.** Le SDK Node n'en cite un que dans son client v1, déprécié. Rien à
  > brancher tant que Higgsfield ne l'expose pas dans son API publique.
- **4.3** **Higgsfield Genjutsu** : Motion Transfer & Object Swap.
  **⛔ Bloqué côté fournisseur : absent de l'API publique.** Aucun endpoint de Motion Transfer ni
  d'Object Swap dans la spécification OpenAPI consultée. Ces fonctions existent dans l'application
  grand public de Higgsfield, pas dans l'API développeur. Ne rien promettre aux utilisateurs à ce
  sujet tant qu'elles n'y figurent pas.
- **4.4** Passage conformité obligatoire avant téléchargement — sans exception.
  **✅ Livré, en deux temps — et avec une limite dite clairement.**
  1. **Blocage réel, côté serveur** : tout le texte du brief (produit, public, scène, texte à
     l'écran, style) passe le vérificateur de conformité **avant** l'envoi au fournisseur. Vérifié :
     « Résultats garantis en 7 jours » dans le texte à l'écran → 422 avec le constat.
  2. **Attestation, côté écran** : le contenu généré ne peut pas être relu automatiquement de façon
     fiable. Il est prévisualisé, et le bouton de téléchargement n'apparaît qu'une fois cochés quatre
     contrôles (promesse de gain, avant/après ou témoignage inventé, texte exact, logo ou personne
     identifiable).
  > ⚠️ **Limite assumée :** l'attestation est une étape volontaire, pas un verrou. Une première
  > conception retenait le lien jusqu'à l'attestation ; elle a été abandonnée, car pour attester
  > qu'un visuel est conforme il faut l'avoir vu, et le voir suppose son adresse. « Sans exception »
  > vaut pleinement pour le texte ; pour l'image, c'est un contrôle humain obligatoire à l'écran.
  - Fichiers relayés par le serveur (`/api/creatives/requests/:id/file`) : la politique de sécurité
    du navigateur n'a pas à s'ouvrir à un CDN tiers inconnu, et le téléchargement porte un nom propre.
    Le fournisseur ne les conserve qu'environ **sept jours** — l'écran le dit.
  - Soumissions jamais rejouées automatiquement : l'API n'accepte pas de clé d'idempotence, une
    génération relancée après un délai ambigu serait facturée deux fois.
  - Points réservés par le serveur au lancement, rendus si la génération échoue, est refusée par le
    filtre de sécurité (`nsfw`) ou reste sans nouvelles 48 h (non facturées par Higgsfield non plus).
  - Identifiant de suivi validé comme UUID ; configuration corrigée : Higgsfield authentifie par une
    **paire** identifiant + secret, alors que le serveur n'attendait qu'une clé unique, qui n'aurait
    fonctionné avec aucun appel réel.
  > ✅ Identifiants Higgsfield configurés et acceptés par l'API (appel de statut gratuit, 14/09/2026) ;
  > une vraie génération, payante, reste à lancer. Coûts en points (1 par visuel, 12 par vidéo)
  > toujours provisoires.
  > ✅ Chaque génération appartient à son auteur : suivi et fichier refusés (404) à tout autre compte.

## Lot 5 — Vendre (modules 5, 6, 9, 11)

- **5.1** Kit de Lancement : copie pub, scripts 15/30/60 s, CTA par marché.
  **🟡 Livré en outil guidé ; la rédaction automatique reste bloquée (aucun fournisseur de texte).**
  `server/config/launch-kit.json`, `GET /api/launch-kit/config`, `src/shared/lib/launchKit.ts`,
  écran `src/modules/m05-kit-lancement/LaunchKitView.tsx`.
  - **Pas de génération promise.** L'ancien placeholder annonçait une rédaction « basée sur 12 méthodes
    de copywriting » : rien ne l'implémentait. Le kit structure, contrôle et exporte ; le
    pré-remplissage ne reprend que les données réelles du produit (promesse, titre, sous-titre).
  - **Textes publicitaires** : jusqu'à trois variantes (texte principal, titre, description).
  - **Scripts 15, 30 et 60 s** découpés en temps forts (accroche, problème, solution, contenu, appel à
    l'action), avec un repère de débit de voix off par temps fort. Table **contrôlée au chargement** :
    découpage continu de 0 à la durée, sans trou ni chevauchement — vérifié, une table avec un trou à
    10 s et un script arrêté à 28 s au lieu de 30 est refusée avec les deux motifs exacts.
  - **Boutons par marché** : les 26 noms officiels du gestionnaire de publicités Meta, relevés le
    14 septembre 2026 avec leur source, et une recommandation par objectif (ventes, prospects, trafic).
  - **Export texte** après contrôle de conformité de tous les textes et scripts ; variantes, scripts et
    marchés non renseignés omis ; mention légale en fin de fichier. Vérifié sur un brouillon réel.
  > ⚠️ Découpages des scripts, repère de 2,5 mots par seconde et recommandations de boutons : valeurs
  > par défaut provisoires, affichées comme telles. « CTA par marché » : le kit enregistre le bouton
  > choisi pour chaque marché ; il n'affirme rien sur les préférences culturelles de chaque pays, faute
  > de source.
  > ⛔ La rédaction assistée par IA attend le branchement d'un fournisseur de texte (clé Gemini).
- **5.2** Connecteurs marketplace en **adapter pattern**. Chariow en premier : c'est le seul
  à disposer d'une API publique documentée (`chariow.dev`). Il sert de gabarit de référence.
  **🟡 Livré en lecture ; vérifié contre un faux serveur, pas contre l'API réelle (aucune clé).**
  Interface `MarketplaceAdapter` (`server/services/marketplaces`) avec **capacités déclarées** :
  l'écran n'affiche jamais un bouton que le connecteur ne peut pas honorer.
  > ⛔ **L'API Chariow ne permet ni de créer ni de publier un produit** (documentation consultée le
  > 14 septembre 2026 : produits, ventes, clients, remises et licences en lecture, activation de
  > licence, initiation de paiement). « Publier sur Chariow depuis Smart Creator » est impossible :
  > le produit se crée sur Chariow, Smart Creator en importe le catalogue et en suit les ventes.
  - **Ventes réelles dans le Cockpit** : `SalesSummaryCard` remplace l'état vide posé en 1.5.
    Ventes payées (`completed`, `settled`) sur 30 jours, une ligne par devise — des devises
    différentes ne s'additionnent pas. Pas de ROI : aucune source ne fournit les dépenses publicitaires.
  - **Données personnelles** : les ventes Chariow portent e-mail et nom du client. Elles ne sont lues
    que pour être agrégées ; aucune ne quitte le serveur (vérifié : aucune trace dans la réponse).
  - 🐛 **Erreur évitée sur les montants.** Un premier résumé de la documentation annonçait des
    unités mineures pour les ventes ; l'exemple chiffré de `GET /sales/{id}` (`79.20` ↔ « $79.20 »)
    montre des unités principales. Le connecteur, déjà écrit, aurait affiché un chiffre d'affaires
    divisé par 100. Corrigé ; conversion en entiers pour sommer sans erreur d'arrondi.
  - Maketou et Taliopay inscrits au registre comme **non disponibles, avec leur raison** (pas d'API
    publique, CdC §6.6), plutôt qu'omis ou présentés avec un bouton factice.
  - Vérifié contre un faux serveur reproduisant les deux formes d'enveloppe documentées : 7 ventes
    sur 2 pages, 4 payées, 178,20 $US et 20 000 F CFA ; catalogue lu ; Maketou → 503 motivé ;
    marketplace inconnue → 404 ; sans clé → état vide explicite.
  > ⛔ **Bloqué sur toi :** une clé API Chariow pour confirmer l'enveloppe et l'unité des montants sur
  > une vraie réponse. La documentation ne précise pas si la période filtre sur la date de création
  > ou de paiement des ventes.
- **5.3** Générateur de pages produits : 7 sections, une image par rôle de conversion, A/B.
  **✅ Livré, sans fournisseur externe.** `src/shared/lib/productPage.ts` (modèle et rendu, fonctions
  pures), `productPageExport.ts` (porte d'export), écran `src/modules/m09-pages/ProductPageBuilderView.tsx`.
  - **7 sections à rôle de conversion** : accroche, problème, transformation, contenu, pour qui, offre,
    questions et appel à l'action. **Aucune section « témoignages »** : elle ne pourrait être remplie
    que de témoignages inventés.
  - Contenu, public, prix et bonus viennent du produit du Studio (version retouchée en mode Expert
    si elle existe). Ce que le produit ne contient pas est saisi par l'auteur ; **sans problème décrit
    ni lien de paiement https, l'export est refusé** plutôt que complété à sa place.
  - **Une image par rôle** : brief de l'image et niveau de conscience visé (Lot 4) pour chaque section,
    lien https de l'image fourni par l'auteur. Le générateur ne produit pas lui-même les images.
  - **A/B** : deux fichiers qui ne diffèrent que par l'accroche et le bouton. La répartition du trafic
    et la mesure se font sur l'outil qui héberge la page — l'écran le dit.
  - **Export sûr** (leçon du défaut D8 de l'audit) : HTML autonome, chaque texte échappé, images et
    lien de paiement acceptés en https uniquement, politique de sécurité intégrée interdisant tout
    script — garde-fou si un échappement venait à manquer. Mention légale en pied de page.
  - Conformité contrôlée **sur les deux variantes à la fois** avant chaque téléchargement : exporter
    la variante A ne doit pas laisser passer une variante B non conforme.
  Vérifié sur saisies piégées : aucune balise `<script>` ni `<img>` injectée, aucun lien `javascript:`,
  image http écartée, image https conservée, 7 sections, lien de paiement échappé, variantes A et B
  correctes, mention légale présente.
  > ⚠️ Saisies conservées dans le navigateur uniquement, comme le swipe file et les brouillons.
- **5.4** Blueprints de campagnes Meta & TikTok, valeurs en table de configuration.
  **✅ Livré.** `server/config/campaign-blueprints.json`, `GET /api/campaigns/blueprints`, écran
  `src/modules/m11-campagnes/CampaignBlueprintsView.tsx`.
  - Objectifs repris de la **nomenclature officielle** vérifiée le 14 septembre 2026, avec leur source :
    Meta — Awareness, Traffic, Engagement, Leads, App promotion, Sales ; TikTok — Reach, Traffic,
    Video views, Lead generation, Sales (qui regroupe les anciens Website conversions et Product sales).
  - Deux structures « Lancement d'un produit digital » : phases, objectif et objectif de repli sans
    suivi des conversions, structure campagne / ensembles / publicités, règles de pilotage.
  - **Table contrôlée au chargement** : budget à 100 % par structure, objectifs présents dans la
    nomenclature de la plateforme. Vérifié : une table à 95 % et un objectif « website_conversions »
    pour TikTok est refusée (503) avec les deux motifs exacts.
  - Les montants ne sont jamais inventés : ils se calculent à partir du budget et du coût
    d'acquisition cible **saisis par l'utilisateur**.
  - L'ancien placeholder annonçait un « déploiement automatisé des campagnes avec retour de
    performance » : rien ne l'implémente, promesse retirée.
  > ⚠️ Répartitions de budget, durées et règles de pilotage : **valeurs par défaut provisoires**, non
  > issues de données de performance. Le statut est affiché à l'écran.

> ⚠️ Ni Maketou ni Taliopay ne publient de documentation d'API. Le cahier des charges le dit
> lui-même (§6.6). Construire Chariow d'abord, puis brancher les autres sur la même interface
> une fois le partenariat négocié. Ne pas bloquer le lot sur une API qui n'existe pas.

## Lot 6 — Échelle (modules 7, 10, boucle de performance)

- Affiliation, multilingue Tier A/B/C, réseau de relecteurs, boucle de performance opt-in
  avec agrégation minimale de 5 vendeurs.

- **Module 7 — Affiliation ✅ livré, dans les limites de l'API Chariow**
  - **Liens de campagne UTM** conformes à la documentation Google Analytics : `utm_source`,
    `utm_medium`, `utm_campaign` obligatoires, `utm_id` et `utm_source_platform` recommandés.
    Valeurs normalisées (GA distingue « Facebook » de « facebook »), paramètres existants conservés,
    https uniquement, un lien par code d'affilié.
  - **Suivi d'un affilié Chariow** par son code : statut, pseudonyme, pays, visites, ventes, total
    publié par Chariow. La fiche Chariow contient nom, e-mail et téléphone : **aucune de ces
    données ne sort du serveur**.
  - **Invitations d'affiliés** : Chariow envoie de vrais e-mails, immédiatement. Consentement
    explicite exigé côté serveur, 25 adresses au plus, dédoublonnage, limiteur strict, jamais de
    renvoi automatique après un délai dépassé (l'envoi a peut-être eu lieu).
  - Vérifié contre un faux serveur Chariow : affilié existant sans donnée personnelle dans la
    réponse ; code inconnu → 404 ; code piégé `../sales` → 400 et jamais transmis ; invitations sans
    consentement, au-delà de 25 ou avec une adresse invalide → 400 ; envoi valide → 1 envoyée,
    1 ignorée, doublon fusionné avant l'appel ; ventes du Cockpit inchangées ; sans clé → 503.
  > ⚠️ **Limites de l'API, pas du produit** : l'API Chariow ne permet ni de lister les affiliés ni
  > de gérer les commissions, et le format des liens de parrainage n'est pas documenté
  > publiquement. Smart Creator ne calcule donc aucune commission et ne fabrique aucun lien de
  > parrainage. L'ancien placeholder promettait un « calcul automatique des commissions » :
  > promesse retirée. **Non vérifié contre l'API réelle** : aucune clé.

- **Boucle de performance 🟡 règle d'agrégation codée, collecte bloquée**
  - `server/services/performanceLoop` : seuls les vendeurs consentants sont lus, et une seule ligne
    sans consentement écarte tout le vendeur ; chaque vendeur compte pour un (moyenne par vendeur,
    puis médiane entre vendeurs) ; un groupe niche × marché de moins de 5 vendeurs n'est pas publié,
    ni une mesure fournie par moins de 5 vendeurs. Les groupes écartés ne révèlent ni valeurs ni
    effectif : « 4 vendeurs » dans une niche rare désigne déjà des concurrents.
  - Vérifié : 4 consentants + 1 refus → masqué ; 5 vendeurs dont un retrait de consentement →
    masqué ; gros vendeur à 3 lignes (10, 20, 30) compté une fois, médiane de [20, 1, 2, 3, 4] = 3 ;
    mesure fournie par 4 vendeurs sur 5 → non publiée.
  > ⛔ **Bloqué** : les comptes vérifiés existent désormais, mais pas encore la collecte des ventes
  > par vendeur ni le consentement en base. La règle n'est branchée à aucune route tant que la
  > collecte n'existe pas.

- **Module 10 — Guides multilingues et réseau de relecteurs ✅ (septembre 2026)**
  - Langues : les 10 langues les plus parlées au monde en tête, dans l'ordre d'Ethnologue 2025
    (anglais, chinois mandarin, hindi, espagnol, arabe, français, bengali, portugais, russe,
    indonésien), puis 20 autres, dont swahili, haoussa, yoruba, igbo, amharique, lingala, wolof et peul.
  - Niveaux définis : **C** traduit par l'IA (Gemini) puis contrôlé automatiquement (sections, titre,
    chiffres y compris en chiffres arabes-indiens, liens, noms gardés tels quels) ; **B** relu et
    validé par l'auteur, original et traduction côte à côte ; **A** relu par un locuteur natif.
  - Réseau de relecteurs : privilège « Relire des guides », langues maternelles déclarées, file sans
    texte avant prise en charge, accès retiré une fois la relecture rendue, second facteur obligatoire.
  - Limites : 1/3/5/10/illimité langues par guide ; relecture native dès Pro ; 2 points par langue,
    10 points par relecture, rendus si la demande est annulée avant d'être prise en charge.
  - Exports : PDF par la fenêtre d'impression (toutes les écritures, arabe de droite à gauche), Word
    et HTML, avec la couverture générée et le niveau de relecture.
  > ⛔ **Bloqué sur toi :** clé Gemini (sans elle, la traduction reste fermée) ; rémunération et
  > recrutement des premiers relecteurs natifs.

## Refonte UI/UX — septembre 2026 ✅

Suite de l'audit d'interface (26 écrans, 24 problèmes classés). Détail des règles dans
`docs/DESIGN-SYSTEM.md`.

- **Marque unifiée** : Smart Creator — « Veille stratégique & production e-commerce », couleurs du
  logo conservées, logo et favicon en SVG (le fichier JPEG du logo était vide).
- **Bibliothèques** : shadcn/ui, tw-animate-css, React Router, cmdk, Sonner, TanStack Table,
  React Hook Form + zod, shadcn Charts, Magic UI sur l'accueil. `framer-motion` et les paquets
  `@radix-ui/react-*` individuels retirés.
- **Squelette** : une adresse par écran, barre latérale VOIR / CRÉER / VENDRE, palette ⌘K, barre
  basse sur mobile, écrans chargés à la demande (fichier principal : 803 → 505 ko).
- **Défauts bloquants corrigés** :
  - la fenêtre « Analyser une niche » s'ouvrait coupée : elle passe par le Dialog Radix ;
  - le thème sombre ne changeait que le fond : couleurs nommées redéfinies une seule fois ;
  - l'adresse e-mail du fondateur était pré-remplie et tout visiteur arrivait connecté à son nom :
    compte de démonstration fictif, champs vides, avatar à initiales ;
  - promesses corrigées sur l'accueil, le Radar, les Créatifs et la connexion (« temps réel »,
    « 100 % conformes », « garantie », « SSL 256-bit », « cohérence de personnage garantie ») ;
  - courbe de rétention inventée supprimée ; jargon interne (« Lot », « CdC ») retiré des écrans
    et des messages du serveur.
- **Ajouts** : pages légales, FAQ et paliers sur l'accueil, capture réelle de l'outil, état des
  services connectés et parcours « Par où commencer » au Cockpit, choix des marchés avant les
  boutons dans le Kit de lancement, onglets dans l'Analyse stratégique et l'Affiliation.
- **Vérifié** : `tsc` et build de production OK. Audit Edge + axe-core sur 34 écrans (1 440 et
  390 px, clair et sombre) : aucune violation critique ou sérieuse (26 écrans sur 26 en défaut
  avant), aucun texte sous 12 px (207 avant), aucun débordement horizontal, bouton Retour du
  navigateur fonctionnel.
  > ⚠️ **Limites et décisions** : interface en français seulement (le bouton EN ne traduisait que
  > 8 fichiers) ; connexion locale sans mot de passe, annoncée comme telle ; pages légales à
  > compléter par l'éditeur (identité, hébergeur, contact) ; prix des paliers non définis ;
  > `radix-ui` épinglé en 1.4.3 et composants shadcn récupérés par script, le CLI et les versions
  > récentes dépendant de paquets absents du registre npm.

## Comptes, sécurité et administration — septembre 2026 ✅

Détail dans `docs/COMPTES-ET-ADMINISTRATION.md`.

- **Base de données** : PostgreSQL avec Drizzle, 14 tables, Row Level Security activée. Base
  embarquée en développement, Supabase attendu en production.
- **Comptes réels** : inscription et connexion par mot de passe (Argon2id), sessions `httpOnly`
  révocables, verrou anti-force brute par adresse et par IP, double authentification TOTP avec codes
  de secours, liens de mot de passe à usage unique. Le compte de démonstration local est retiré.
- **Points côté serveur** : quota mensuel du palier et points bonus, réservés au lancement d'une
  génération et rendus en cas d'échec ; registre de chaque mouvement.
- **Administration** : vue d'ensemble (revenus, en ligne, contenus), utilisateurs et fiches (palier,
  points, fonctions accordées ou retirées, privilèges délégués, suspension, sessions, liens), revenus
  par jour, mois et année, contenus créés par type et par format, sécurité et journal d'audit.
- **Chariow** : clé du serveur réservée aux administrateurs ; clé personnelle chiffrée par utilisateur.
- **Vérifié** : 38 tests serveur (fournisseurs simulés), `tsc` et build de production OK.
  > ⛔ **Bloqué sur toi :** projet Supabase (région Paris) et sa chaîne de connexion ; prix des
  > paliers ; moyen de paiement en ligne (les abonnements s'enregistrent à la main en attendant).
  > ⚠️ Brouillons, swipe file et rapports restent dans le navigateur : leur migration en base est
  > la prochaine étape.

## International, niches et méthodes publicitaires — septembre 2026 ✅

Détail dans `docs/COMPTES-ET-ADMINISTRATION.md`.

- **Second facteur au choix** : code de sécurité personnel (par défaut) ou application
  d'authentification, pour la connexion et la confirmation des actions d'administration.
- **Outil international** : 249 pays avec drapeau, pays choisi à l'inscription, prix dans la devise
  du pays (taux du jour, parités fixes du franc CFA), paiements saisis en toute devise et convertis
  en FCFA pour les revenus. Les 17 marchés fixes sont remplacés par tous les pays.
- **Paliers** : une carte par forfait (prix, points, niches, méthodes, fonctions) ; prix provisoires
  générés ; limites de niches enregistrées et de méthodes publicitaires appliquées par le serveur.
- **Niches** : nouvelle rubrique, 594 niches dans 41 secteurs, enregistrement limité par palier.
- **Méthodes publicitaires** : 12 méthodes (AIDA, PAS, AIDCA, ACCA, 4P, 4C, BAB, FAB, PASTOR, QUEST,
  ODC, PPPP) pour les vidéos et visuels pub, ouvertes selon le palier.
- **Contenus générés retirés** : plus aucun rapport d'exemple (« solopreneurs », « nutrition
  anti-inflammatoire ») ; les écrans attendent une vraie analyse.
- **Vérifié** : 47 tests serveur, `tsc`, build, audit de 32 écrans (0 violation axe, 0 débordement).
  > ⛔ **Bloqué sur toi :** prix définitifs ; Supabase ; paiement en ligne ; e-mails transactionnels.

## Connexions, guides multilingues et couvertures — septembre 2026 ✅

- **Historique des connexions** : heure de connexion, de déconnexion et durée de chaque visite, avec
  la raison de la fin (déconnexion, blocage, inactivité, mot de passe changé…). Page
  *Administration → Connexions* et onglet de la fiche utilisateur ; conservé 12 mois, sans jeton ni
  adresse IP complète. Un onglet fermé sans déconnexion est clos à sa dernière activité.
- **Activité et points** : utilisateurs actifs du jour, sur 7 et 30 jours, durée moyenne ; points
  utilisés par compte (mois en cours, 30 jours, depuis l'inscription) ; « Bloquer / Débloquer ».
- **Guides multilingues** : module 10 livré (voir plus haut).
- **Couvertures générées** pour le PDF des guides et des ebooks du Studio : image sans texte
  (Higgsfield), titre posé par la mise en page, image conservée en base car le fournisseur l'efface.
- **Vérifié** : 55 tests serveur (connexions, traduction, relecture native, couverture), `tsc`, build.

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
