# Orchestrateur d'agents IA — Smart Creator

> Traduction concrète du §10 du cahier des charges : « abstraction par type de tâche pour
> permettre le changement de fournisseur sans refactoring ».

## Principe

Un **agent** ici n'est pas un chatbot. C'est une unité serveur qui a : un rôle unique, un
contrat d'entrée/sortie typé (zod), un budget en research points, un fournisseur
interchangeable, et une trace d'exécution persistée. Le tout est piloté par un chef
d'orchestre qui séquence, parallélise et facture.

```
                  ┌──────────────────────────┐
                  │   CHEF D'ORCHESTRE       │
                  │  server/services/ai/     │
                  │  · séquence & parallélise│
                  │  · facture les crédits   │
                  │  · journalise les traces │
                  │  · reprend sur échec     │
                  └───────────┬──────────────┘
                              │
   ┌──────────┬───────────┬───┴────┬───────────┬───────────┐
   ▼          ▼           ▼        ▼           ▼           ▼
 SCOUT     ANALYSTE     AUTEUR   DIRART     GARDIEN    DIFFUSEUR
 (m01)     (m02)        (m03/08) (m04/09)   (transv.)  (m06/11)
```

## Les six agents

| Agent | Rôle | Entrées | Sorties | Fournisseur |
|-------|------|---------|---------|-------------|
| **SCOUT** | Collecter et normaliser les signaux publicitaires | niche, marché, plateforme | annonces normalisées + métadonnées de provenance | Meta Ad Library, recherche web |
| **ANALYSTE** | Transformer la donnée brute en rapport 6 blocs | sortie SCOUT + score | rapport sourcé, chaque affirmation tracée | LLM texte |
| **AUTEUR** | Produire ebooks, guides, storybooks | niche, persona, mode, langue | chapitres, sommaire, bibliographie | LLM texte + **Gamma** (storybook) |
| **DIRART** | Produire visuels et vidéos publicitaires | script, format, niveau de conscience | images multi-formats, vidéo 9:16 / 1:1 / 16:9 | Images IA + **Higgsfield** (vidéo + Genjutsu) |
| **GARDIEN** | Vérifier la conformité avant tout export | texte + visuel | verdict, catégorie de risque, reformulation | Règles déterministes + LLM en second passage |
| **DIFFUSEUR** | Publier et lancer les campagnes | produit fini, marketplace, budget | page publiée, campagne créée | Adaptateurs marketplace, Meta Marketing API |

## Règles d'orchestration — non négociables

1. **GARDIEN a un droit de veto.** Aucune sortie de AUTEUR ou DIRART n'atteint l'utilisateur
   sans son verdict. Il n'est pas une étape optionnelle du pipeline : il en est la sortie.
2. **Aucun agent n'invente un chiffre.** Toute donnée numérique affichée provient de SCOUT ou
   du moteur de scoring, avec sa source et son horodatage. Un agent qui ne sait pas répond
   « donnée indisponible » — jamais une estimation présentée comme un fait.
3. **Budget avant exécution.** Le chef d'orchestre calcule le coût et le présente à
   l'utilisateur (simulateur de crédits) **avant** de lancer quoi que ce soit.
4. **Idempotence.** Chaque exécution porte une clé ; rejouer la même requête ne refacture pas.
5. **Traces persistées.** Chaque appel enregistre : agent, fournisseur, version de prompt,
   entrées, coût, durée, verdict de conformité. C'est ce qui rend le produit auditable.
6. **Dégradation contrôlée.** Si Higgsfield est indisponible, DIRART bascule sur le
   fournisseur de secours et **le dit à l'utilisateur**. Jamais d'échec muet.

## Contrat d'un agent

```ts
// server/services/ai/types.ts  (à implémenter — Lot 1)
export interface Agent<I, O> {
  readonly name: string;
  readonly version: string;          // versionné → traçabilité des sorties
  readonly inputSchema: ZodType<I>;
  readonly outputSchema: ZodType<O>;
  estimateCost(input: I): Promise<CreditEstimate>;
  run(input: I, ctx: RunContext): Promise<AgentResult<O>>;
}

export interface AgentResult<O> {
  output: O;
  provenance: Provenance[];   // source + date de collecte + volume d'échantillon
  cost: CreditCost;
  trace: TraceId;
}
```

Le champ `provenance` n'est pas décoratif : c'est lui qui alimente les mentions de source
affichées sous chaque graphique. Un agent qui retourne un `provenance` vide produit une
sortie non affichable.

## Ce que « automatiser » signifie ici, concrètement

Le cahier des charges (§6.6.4) décrit un parcours **Créer → Publier → Connecter → Diffuser**
sans ressaisie. Concrètement : la sortie de chaque agent est l'entrée typée du suivant,
sans repasser par un formulaire.

```
SCOUT ─▶ ANALYSTE ─▶ [persona, prix, méthode copywriting] ─▶ AUTEUR ─▶ produit
                                                                 │
                                                                 ▼
                                              DIRART ─▶ GARDIEN ─▶ DIFFUSEUR
```

L'utilisateur valide à chaque jonction, mais ne ressaisit rien. **Une validation explicite
reste obligatoire avant tout lancement de campagne payante** (CdC §6.11.4) : l'automatisation
s'arrête là où l'argent de l'utilisateur commence.
