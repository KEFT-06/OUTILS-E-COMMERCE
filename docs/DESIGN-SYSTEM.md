# Design system — Smart Creator

> Objectif : un produit qui se lit comme un outil d'analyse professionnel, pas comme une
> démo générée. La contrainte d'usage prime : audiences africaines, connexions parfois
> lentes, forte proportion de mobile. Chaque effet visuel doit survivre à ces conditions.

## Direction : « liquid glass », mais avec discipline

Le verre liquide est un effet de **hiérarchie**, pas de décoration. Il sert à faire flotter
une surface au-dessus d'un contenu dense — en-tête collant, panneau de détail de calcul,
menu de modules, cartes de KPI. Il ne s'applique jamais à une zone de texte longue.

### Trois niveaux, pas plus

| Niveau | Usage | Flou | Opacité fond | Bordure |
|--------|-------|------|--------------|---------|
| `glass-1` | Surfaces flottantes principales (header, menu modules) | 16 px | 72 % | 1px, blanc 12 % |
| `glass-2` | Panneaux secondaires (détail de calcul, tooltips riches) | 10 px | 85 % | 1px, blanc 8 % |
| `glass-flat` | Repli sans flou — mobile bas de gamme, `prefers-reduced-transparency` | 0 | 100 % | 1px, token bordure |

**Règle de lisibilité :** tout texte posé sur du verre doit atteindre un contraste ≥ 4,5:1
contre la **pire** couleur de fond possible derrière lui, pas contre une moyenne. En pratique :
une couche de couleur opaque sous le flou, jamais du texte directement sur un `backdrop-filter`.

### Coût de performance — à respecter

`backdrop-filter` est coûteux. Limites dures :

- Au maximum **3 surfaces en verre visibles simultanément** à l'écran.
- Jamais de verre à l'intérieur d'une liste défilante virtuelle.
- Repli `glass-flat` automatique sous 768 px **et** si `prefers-reduced-transparency: reduce`.

## Tokens de couleur

Définis une seule fois sur `:root`, redéfinis sous `@media (prefers-color-scheme: dark)`
et sous `[data-theme="dark"]`. **Aucune couleur ne doit avoir sa seule définition dans un
bloc de thème** — c'est ce qui a cassé le thème sombre dans la version initiale.

Palette de statut, alignée sur les quatre niveaux de taux du cahier des charges :

| Niveau de taux | Token | Usage |
|----------------|-------|-------|
| Très élevé | `--rate-excellent` | Émeraude |
| Élevé | `--rate-good` | Bleu |
| Moyen | `--rate-medium` | Ambre |
| Faible | `--rate-low` | Rose |

Ces quatre couleurs sont **réservées au scoring**. Elles ne servent jamais à décorer autre
chose, sinon l'utilisateur perd le code de lecture.

### Dette à corriger

`slate-850` et `slate-750` n'existent pas dans Tailwind — 6 occurrences dans le code initial
étaient silencieusement ignorées (cf. audit D6). Toute couleur hors échelle Tailwind doit
passer par un token déclaré, jamais par une classe inventée.

## Dataviz — la traçabilité est une exigence de design

Le différenciateur n°1 du produit est la transparence. Cela a une traduction visuelle
directe : **aucun graphique ne s'affiche sans sa provenance.**

Chaque graphique porte obligatoirement :

1. Un titre qui énonce ce qui est mesuré, pas la technique de visualisation.
2. Une ligne de provenance : source · date de collecte · taille d'échantillon.
3. Un état vide explicite quand la donnée manque — jamais un graphique à zéro qui laisse
   croire à une mesure réelle.
4. Un accès au détail de calcul pour tout score affiché.

Un chiffre de démonstration porte un badge « données de démonstration » visible. C'est
exactement ce que la version initiale ne faisait pas : le Cockpit affichait « Performance
Réelle des Ventes » sur des valeurs inventées.

### Règles de forme

- Comparaison entre catégories → barres. Évolution dans le temps → ligne ou aire.
  Corrélation → nuage de points. Un radar uniquement pour comparer 5 axes normalisés.
- Palette catégorielle distinguable en vision déficiente ; ne jamais coder une information
  par la couleur seule (ajouter forme, libellé ou motif).
- Ordre des `<Cell>` **toujours** aligné sur l'ordre du tableau de données rendu
  (cf. audit D1 : le classement des niches affichait des couleurs décalées).

## Mouvement

L'animation sert à expliquer une transition d'état, pas à impressionner.

- Entrées de contenu : 200–300 ms, `ease-out`.
- Transitions de page : 150 ms maximum.
- Aucune animation en boucle sur un élément non interactif.
- `prefers-reduced-motion: reduce` désactive tout ce qui n'est pas un changement d'opacité.
- Les états de chargement longs (génération IA, scan de marché) affichent une **progression
  réelle et étapée**, pas un spinner indéfini. La version initiale simulait des étapes de
  scan avec un `setInterval` — à remplacer par la progression serveur réelle.

## Accessibilité — plancher non négociable

- Contraste AA sur tout texte, y compris sur verre.
- Toute action atteignable au clavier, focus visible sur fond clair comme sombre.
- Toute icône porteuse de sens accompagnée d'un libellé ou d'un `aria-label`.
- Le français et l'anglais doivent tenir dans les mêmes gabarits : prévoir 30 % de marge de
  longueur de chaîne. L'i18n actuelle couvre ~5 % des chaînes — voir Lot 1 de la feuille de route.
