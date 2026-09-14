# Design system — Smart Creator

> Objectif : un outil d'analyse qui inspire confiance au premier regard. La contrainte d'usage
> prime : créateurs d'Afrique francophone, connexions parfois lentes, forte proportion de mobile.
> Chaque choix visuel doit survivre à ces conditions.

## Marque

- **Nom** : Smart Creator — « Veille stratégique & production e-commerce ».
- **Logo** : le croissant (`BrandMark`) et le mot-symbole **SMART** (vert `#00C853`) **CREATOR**
  (orange `#F59E0B`), dessinés en SVG dans `src/shared/ui/BrandLogo.tsx`. L'ancien fichier
  `smart-life-logo.jpg` était vide : l'écran affichait en permanence un repli.
- **Couleurs du logo** : inchangées, et réservées au logo, au bouton principal et aux accents.
  Les logotypes sont exemptés du critère de contraste (WCAG 1.4.3) ; l'attribut
  `data-brand-wordmark` les écarte explicitement des audits.
- **Texte coloré** : jamais `#00C853` ni `#F59E0B` en texte courant (contraste insuffisant sur
  fond clair). Utiliser `text-brand-green-text` (`#0A7C3A` en clair, `#3DDC84` en sombre) et
  `text-brand-orange-text`.
- **Bouton principal** : fond vert de marque, texte `#04210F` (contraste 6,7:1).

## Bibliothèques

| Rôle | Bibliothèque | Où |
| --- | --- | --- |
| Composants de base | shadcn/ui (Radix + Tailwind 4 + React 19) | `src/shared/ui/*.tsx` |
| Animations d'entrée et de sortie | tw-animate-css | `src/styles/index.css` |
| Adresses par écran | React Router | `src/app/App.tsx`, `src/app/navigation.ts` |
| Palette ⌘K | cmdk (composant `Command`) | `src/app/layout/CommandPalette.tsx` |
| Notifications | Sonner | `src/shared/ui/sonner.tsx` |
| Tableaux triables | TanStack Table 8 | Analyse stratégique, mots-clés |
| Formulaires validés | React Hook Form + zod (composant `Field`) | connexion, analyse de niche |
| Graphiques | shadcn Charts (Recharts) | Radar, Analyse, Studio, Créatifs |
| Effets de l'accueil | Magic UI (`Marquee`, `BorderBeam`) | `src/shared/ui/magicui/` |

**Installation des composants shadcn.** Le CLI `npx shadcn add` échoue : une de ses dépendances
(`socks@^2.8.8`) n'existe pas sur npm. Les composants sont récupérés depuis le registre officiel
(`ui.shadcn.com/r/styles/new-york-v4/<nom>.json`) et leurs imports réécrits vers `@/shared/…`,
exactement comme le ferait le CLI. `components.json` décrit ces alias.

**`radix-ui` est épinglé en 1.4.3** : les versions 1.5 et suivantes dépendent de versions de
`@radix-ui/react-alert-dialog` introuvables sur le registre npm au 14 septembre 2026.

Les composants shadcn restent modifiables ; les adaptations sont commentées dans le fichier
(variantes d'état de `Badge` et `Alert`, jauge colorable de `Progress`, en-tête de `Card` qui passe
l'action sous le titre sur mobile, `Sonner` branché sur les préférences de thème).

## Tokens

Définis dans `src/styles/index.css`, une seule fois sous `:root`, redéfinis sous `.dark`. Aucun
écran ne code de couleur en dur — seule exception, la maquette de téléphone des Créatifs, qui imite
un appareil. Le thème sombre fonctionne donc par construction.

| Famille | Tokens | Usage |
| --- | --- | --- |
| Surfaces | `background`, `card`, `popover`, `muted`, `accent`, `sidebar` | fonds |
| Texte | `foreground`, `muted-foreground`, `*-foreground` | contenus |
| Traits | `border`, `input`, `ring` | bordures, champs, focus |
| Action | `primary` (vert de marque) | un seul bouton principal par zone |
| États | `success`, `warning`, `info`, `danger` (+ `-soft`, `-border`) | `Badge`, `Alert` |
| Taux | `rate-excellent`, `rate-good`, `rate-medium`, `rate-low` (+ `-text`) | **scoring uniquement** |
| Graphiques | `chart-1` à `chart-5` | séries |

Les quatre couleurs de taux ne décorent rien d'autre : l'utilisateur doit pouvoir lire un score à
sa couleur, partout. Un niveau est toujours porté aussi par une icône et un libellé.

La classe `.paper` rétablit les couleurs claires dans un aperçu de document imprimable (Dossier
PDF) : un document A4 reste blanc, même en thème sombre.

## Typographie

| Rôle | Police | Taille |
| --- | --- | --- |
| Titre de page (`PageHeader`) | Outfit 800 | 24 à 30 px |
| Titre de carte ou de section | Plus Jakarta Sans 600 | 16 à 18 px |
| Texte courant | Plus Jakarta Sans 400 | 14 à 16 px |
| Mention, légende | Plus Jakarta Sans | **12 px minimum** |
| Chiffres | Plus Jakarta Sans, `tabular-nums` | alignés en colonne |

Pas de police à chasse fixe pour décorer : elle ne sert qu'aux paramètres techniques (`utm_source`…).

## Mise en page

- **Squelette** (`src/app/layout`) : barre latérale groupée VOIR / CRÉER / VENDRE, en-tête avec fil
  d'Ariane, niche active, recherche ⌘K, « Analyser une niche » et menu d'actions, barre basse de
  quatre raccourcis sur mobile. La liste des écrans vit dans `src/app/navigation.ts` : barre
  latérale, palette, fil d'Ariane et barre mobile la lisent tous.
- **Adresses** : chaque écran a la sienne (`/app/cockpit`, `/app/analyse`…). Le bouton Retour, le
  rafraîchissement et le partage d'un lien fonctionnent.
- **Chargement** : les écrans sont téléchargés à la demande, avec un squelette de page pendant le
  téléchargement.
- **En-tête de page** : toujours `PageHeader` (étape du parcours, titre, description, actions).
- **Rayons** : `--radius` 12 px ; contrôles `rounded-md`, cartes `rounded-xl`.
- **Ombres** : légères sur les cartes, marquées seulement pour ce qui flotte (menus, fenêtres).
- **Formulaires longs** : découpés en onglets, étapes ou sections repliables (Affiliation, Kit de
  lancement, Analyse stratégique) plutôt qu'affichés d'un bloc.

## Composants Smart Creator

Au-dessus de shadcn/ui : `PageHeader`, `NoDataState` (état vide qui dit pourquoi la donnée manque),
`ChartProvenance`, `RateBadge`, `ScoreTracePanel`, `SalesSummaryCard`, `LegalNotice`,
`CreditSimulatorDialog`, `ComplianceBlockDialog`, `ProductExportGateDialog`, `PlaceholderModuleView`.

## Données et graphiques

La transparence est le premier différenciateur du produit, et elle se voit :

1. Un titre qui énonce ce qui est mesuré.
2. Une ligne de provenance sous chaque graphique : source, date de collecte, échantillon.
3. Un état vide explicite quand la donnée manque, jamais un graphique à zéro.
4. Un accès au détail du calcul pour tout score affiché.
5. Un badge « Démonstration » ou « Rapport d'exemple » sur toute donnée d'exemple.

Formes : barres horizontales pour des libellés longs, axes formatés en « 50 k », couleurs issues
des tokens `chart-*` pour rester lisibles dans les deux thèmes. Aucune donnée inventée : l'ancienne
« courbe de rétention estimée » des Créatifs, écrite en dur, a été supprimée.

## Mouvement

- Entrées de menus et de fenêtres : 150 à 300 ms (tw-animate-css).
- Aucune animation en boucle sur un élément qui porte une information : voyant, badge, taux.
  Les squelettes animés n'apparaissent que pendant un chargement réel.
- Accueil : deux effets décoratifs seulement (défilé des marchés, liseré animé autour de la
  capture), désactivés si le système demande de réduire les animations.
- `prefers-reduced-motion: reduce` coupe toutes les animations CSS.

## Accessibilité

- Contraste AA vérifié sur les tokens, dans les deux thèmes.
- Tout champ a une étiquette (`Field` / `FieldLabel`), tout bouton icône un nom accessible.
- Fenêtres, menus et palette via Radix : focus retenu, fermeture au clavier.
- `lang="fr"`, lien « Aller au contenu », barre latérale déclarée comme navigation.
- Contrôle automatisé : captures Edge à 1 440 et 390 px, en clair et en sombre, avec axe-core.
  Au 14 septembre 2026, sur 34 écrans : aucune violation critique ou sérieuse, aucun texte sous
  12 px, aucun débordement horizontal.

## Langue

L'interface est en français. Le bouton FR/EN a été retiré : il ne traduisait qu'une partie des écrans.
La fonction `t()` reste en place pour une traduction complète.
