# Intégrations externes — état réel et démarches

> Ce document sépare ce qui est **utilisable aujourd'hui** de ce qui exige une démarche
> préalable. Conformément au principe posé par le cahier des charges : toute information
> non vérifiable est signalée comme telle, jamais présentée comme acquise.

## Tableau de disponibilité

| Intégration | Rôle | Statut vérifié | Ce qui manque |
|-------------|------|----------------|---------------|
| **Gemini** (`@google/genai`) | Texte — agents ANALYSTE, AUTEUR | Dépendance déjà déclarée | `GEMINI_API_KEY` dans `.env` |
| **Gamma** | Storybooks, documents illustrés | Connecteur disponible côté assistant | Clé API pour l'usage serveur |
| **Higgsfield AI** | Vidéo texte-à-vidéo + Genjutsu | ⚠️ **Non vérifié** | Clé API + conditions d'usage commercial à valider |
| **Meta Ad Library** | Ingestion module 1 | Accès public limité | App Review + Business Verification |
| **Meta Marketing API** | Lancement de campagnes (module 11) | Non commencé | Accès Avancé + recertification annuelle |
| **Chariow** | Connecteur marketplace | API publique documentée (`chariow.dev`) | Clé de compte |
| **Maketou / Taliopay** | Marketplaces prioritaires | ⚠️ **Aucune API publique** | Partenariat à négocier |

## Higgsfield — à trancher avant de coder le module 4

Le cahier des charges (§9.3) l'impose, et c'est une exposition juridique réelle :

1. **Droit de revente** — les utilisateurs de Smart Creator peuvent-ils exploiter
   commercialement les vidéos générées dans leurs publicités payantes ?
2. **Politique sur les avatars** — quelles limites sur les avatars ressemblant à des
   personnes réelles ?
3. **Quotas et tarification** — nécessaires pour calibrer la table de coûts du simulateur
   de crédits, qui doit afficher Higgsfield à un coût « clairement supérieur » au standard.
4. **Fournisseur de secours** — obligatoire (CdC §10). Une dépendance vidéo unique est un
   point de défaillance unique.

**Conséquence de planification :** tant que ces quatre points ne sont pas tranchés, le
module 4 se développe contre une interface `VideoProvider` abstraite, avec un adaptateur
factice en développement. Le code n'est pas bloqué ; l'engagement produit, si.

## Meta — démarche à engager dès maintenant

Autorisations requises : `ads_management`, `ads_read`, `business_management`,
`pages_read_engagement`. Gérer des comptes tiers — ce que fait Smart Creator — exige
l'**Accès Avancé** via App Review + Business Verification, avec recertification annuelle
dans une fenêtre de 60 jours.

> Le cahier des charges est formel (§6.11.5) : **le délai d'instruction par Meta peut
> dépasser le temps de développement technique du connecteur.** Cette démarche se lance
> en parallèle du Lot 1, pas quand le code est prêt.

## Marketplaces — stratégie d'attaque

Chariow d'abord. C'est le seul connecteur africain disposant d'une documentation technique
accessible (endpoints REST, pagination par curseur, 100 req/min, webhooks « Pulse »).
Il sert de **gabarit de référence de l'adapter pattern**. Maketou et Taliopay, pourtant
prioritaires commercialement, se branchent ensuite sur la même interface — sans quoi le
développement se retrouve bloqué sur une API qui n'existe pas publiquement.

## Règle de sécurité commune à toutes les intégrations

Aucune clé n'atteint le navigateur. Aucune variable d'intégration ne porte le préfixe
`VITE_` — Vite inline ces variables dans le bundle, où n'importe quel visiteur les lit.
Vérification automatisable :

```bash
grep -rn "VITE_" src/ && echo "ÉCHEC : secret exposé au client" || echo "OK"
```

Les jetons OAuth (Meta, marketplaces) sont chiffrés au repos, jamais journalisés, et
révocables depuis le tableau de bord comme l'exige le §6.6.4.
