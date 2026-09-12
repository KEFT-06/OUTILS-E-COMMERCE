# Archives — code hérité, exclu du build

Ce dossier contient du code qui n'était **atteint par aucun chemin d'exécution** depuis
`main.tsx` dans la version initiale du projet. Il est exclu de la compilation via
`tsconfig.json` (`"exclude": ["_legacy"]`) et n'est plus embarqué dans le bundle.

**Rien n'est supprimé.** Une partie de ce code est de bonne qualité et récupérable.

## `ecommerce/` — back-office e-commerce (~120 Ko)

`EcommerceProvider` n'était monté nulle part : tout le module était mort. Le cahier des
charges ne demande pas de back-office e-commerce, mais trois éléments valent d'être repris :

| Fichier | À récupérer pour |
|---------|------------------|
| `MarginCalculator.tsx` | **Module 5 / Cockpit** — simulateur marge nette, ROAS d'équilibre, CPA maximum. Les calculs (TVA, frais de passerelle, CPA, seuil de rentabilité) sont corrects et directement réutilisables. |
| `EcommerceContext.tsx` | **Module 6** — logique de commande, décrément de stock, mise à jour CRM, usage des codes promo. Bon modèle pour les connecteurs marketplace. |
| `InvoiceModal.tsx` | **Module 6** — gabarit de facture imprimable. |

⚠️ Avant toute reprise, corriger les défauts D4 et D5 de [`../docs/AUDIT.md`](../docs/AUDIT.md) :
les six `JSON.parse(localStorage…)` sans `try/catch` et la mutation de state en place.

## `site-builder/` — ancien constructeur de sites vitrines

Vestige d'une version antérieure du produit, sans rapport avec le cahier des charges :
`SiteCustomizer`, `Header`, `TechFeatures`, `InquiryModal`, les quatre démos de templates,
`htmlExporter.ts`, `presets.ts`.

`htmlExporter.ts` contient une **faille d'injection** (défaut D8 : interpolation non échappée
dans le HTML généré). Ne pas le réutiliser sans échappement systématique. Le générateur de
pages produits du module 9 doit être écrit proprement, pas dérivé de ce fichier.

## `scripts-migration/` — scripts jetables

Six scripts `fix-*.cjs` et un patch, écrits pour appliquer des modifications ponctuelles au
code source. Ils ne sont pas idempotents et `fix-cockpit.cjs` a échoué partiellement en
production (ses remplacements de chaînes JSX n'ont pas matché à cause de l'indentation).

Conservés à titre documentaire uniquement. **Ne plus jamais modifier le code source par
substitution de chaînes** — c'est ce qui a produit une internationalisation à moitié appliquée.

## Fichiers vides

`EcommerceHeader.tsx`, `OrderManager.tsx`, `ProductDetailModal.tsx`, `ProductManager.tsx`,
`StorefrontView.tsx`, `LiveCustomWebsite.tsx`, `TemplateViewer.tsx` faisaient 0 octet et
n'ont jamais existé sous forme de code. Ils sont conservés comme marqueurs de ce qui avait
été prévu, sans valeur à récupérer.
