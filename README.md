# Smart Creator

**Intelligence concurrentielle et création de produits digitaux pour l'Afrique francophone
et anglophone.** De la lecture du marché à la vente en ligne : veille, production par IA,
vérification de conformité publicitaire et diffusion — en un seul parcours.

> **VOIR · CRÉER · VENDRE**

## État du projet

⚠️ **Le projet ne démarre pas en l'état.** Node.js n'est pas installé sur la machine de
développement et trois composants importés par `App.tsx` sont vides. Voir
[`docs/AUDIT.md`](docs/AUDIT.md) pour le détail et [`docs/ROADMAP.md`](docs/ROADMAP.md#lot-0)
pour la marche à suivre.

## Démarrage

**Prérequis :** Node.js ≥ 20.11 — [nodejs.org](https://nodejs.org)

```bash
npm install
cp .env.example .env      # puis renseigner les clés
npm run dev               # API sur :3001 + front sur :5173
```

| Commande | Effet |
|----------|-------|
| `npm run dev` | Lance l'API et le front en parallèle |
| `npm run build` | Construit le client puis le serveur |
| `npm run typecheck` | Vérifie les types sans émettre |
| `npm run lint` | ESLint, zéro avertissement toléré |

## Structure

```
docs/        Spécifications vivantes — commencer ici
server/      Backend Express. Détient toutes les clés d'API.
src/
  app/       Shell, providers, routage
  modules/   Les 11 modules du cahier des charges
  features/  auth, account, landing
  shared/    Design system, dataviz, types, utilitaires
_legacy/     Code archivé, exclu du build. Voir _legacy/README.md
```

Les imports utilisent l'alias `@/` (→ `src/`). Aucun chemin relatif dans le code applicatif.

## Documentation

| Document | Contenu |
|----------|---------|
| [`docs/AUDIT.md`](docs/AUDIT.md) | Audit du code existant : bloquants, bugs, écart au cahier des charges |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arborescence, flux de données, décisions structurantes, sécurité |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Lots de livraison avec critères d'acceptation |
| [`docs/AGENTS.md`](docs/AGENTS.md) | Orchestrateur IA : six agents, règles non négociables |
| [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) | Higgsfield, Gamma, Meta, marketplaces — statut réel et démarches |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | Liquid glass, tokens, dataviz, accessibilité |

## Principes non négociables

1. **Aucune clé d'API côté client.** Aucune variable `VITE_*` contenant un secret.
2. **Aucun chiffre inventé.** Toute donnée affichée porte sa source et sa date. Les données
   de démonstration sont étiquetées comme telles.
3. **Le vérificateur de conformité a un droit de veto** sur tout export.
4. **Tout score est consultable dans son détail de calcul**, et persisté avec sa version de
   méthodologie.

Ces quatre règles sont la promesse produit. Un module qui les enfreint n'est pas livrable.

## Sécurité

Les vulnérabilités classiques du code généré sans revue sont traitées explicitement dans
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#sécurité--checklist-appliquée) : secrets
exposés, absence de validation d'entrée, injection HTML dans les générateurs de documents,
CORS permissif, absence de limitation de débit.
