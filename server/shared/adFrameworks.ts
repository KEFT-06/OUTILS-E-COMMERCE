/**
 * Méthodes de rédaction publicitaire proposées pour les vidéos pub.
 *
 * Fichier sans dépendance, partagé par le serveur (validation, consigne envoyée
 * au modèle vidéo) et le navigateur (choix de la méthode).
 *
 * L'ordre compte : un palier ouvre les N premières méthodes (limite
 * `adFrameworks` de server/config/plans.json). On commence par les plus simples
 * à réussir, on finit par les structures longues.
 *
 * Les consignes restent compatibles avec la conformité publicitaire : pas de
 * fausse urgence, pas de témoignage inventé, pas de résultat garanti.
 */

export interface AdFrameworkStep {
  /** Étape telle que nommée par la méthode (souvent en anglais). */
  name: string;
  /** Libellé français affiché. */
  label: string;
  /** Ce que l'auteur doit écrire pour cette étape. */
  hint: string;
  /** Consigne envoyée au modèle vidéo quand l'auteur laisse l'étape vide. */
  direction: string;
}

export interface AdFramework {
  id: string;
  acronym: string;
  /** Développé de l'acronyme. */
  expansion: string;
  summary: string;
  bestFor: string;
  steps: readonly AdFrameworkStep[];
}

export const AD_FRAMEWORKS: readonly AdFramework[] = [
  {
    id: 'aida',
    acronym: 'AIDA',
    expansion: 'Attention, Intérêt, Désir, Action',
    summary: 'Décompose le parcours d’achat en quatre étapes chronologiques.',
    bestFor: 'Polyvalente : la méthode idéale pour commencer.',
    steps: [
      {
        name: 'Attention',
        label: 'Attention',
        hint: 'Capter le regard : un visuel fort, une question ou un titre percutant.',
        direction: 'Open with a striking, scroll-stopping visual moment or question that grabs attention.',
      },
      {
        name: 'Interest',
        label: 'Intérêt',
        hint: 'Maintenir l’attention avec une information utile qui concerne le spectateur.',
        direction: 'Keep attention with a useful, relatable detail that concerns the viewer.',
      },
      {
        name: 'Desire',
        label: 'Désir',
        hint: 'Montrer les bénéfices concrets et les avantages du produit.',
        direction: 'Show the concrete benefits of the product in use, making it desirable.',
      },
      {
        name: 'Action',
        label: 'Action',
        hint: 'Un appel à l’action clair et direct.',
        direction: 'End on a clear, direct call to action moment.',
      },
    ],
  },
  {
    id: 'pas',
    acronym: 'PAS',
    expansion: 'Problème, Agitation, Solution',
    summary: 'Met en avant une douleur, l’amplifie, puis présente la solution.',
    bestFor: 'Produits qui résolvent un problème précis.',
    steps: [
      {
        name: 'Problem',
        label: 'Problème',
        hint: 'La douleur ou la frustration que vit votre public.',
        direction: 'Show a relatable everyday problem or frustration the audience lives with.',
      },
      {
        name: 'Agitation',
        label: 'Agitation',
        hint: 'Ce que ce problème coûte au quotidien, sans exagération.',
        direction: 'Emphasise what this problem costs day to day, honestly and without exaggeration.',
      },
      {
        name: 'Solution',
        label: 'Solution',
        hint: 'Votre produit comme réponse au problème.',
        direction: 'Introduce the product as the natural solution, shown clearly.',
      },
    ],
  },
  {
    id: 'bab',
    acronym: 'BAB',
    expansion: 'Before, After, Bridge (avant, après, pont)',
    summary: 'Montre la situation actuelle, la situation idéale, puis le produit comme pont entre les deux.',
    bestFor: 'Formations et produits de transformation.',
    steps: [
      {
        name: 'Before',
        label: 'Avant',
        hint: 'La situation actuelle de votre client.',
        direction: 'Show the current everyday situation of the customer as a lifestyle moment.',
      },
      {
        name: 'After',
        label: 'Après',
        hint: 'La situation idéale qu’il souhaite, sans résultat garanti.',
        direction: 'Show the improved situation they aspire to, realistic, with no guaranteed or exaggerated result.',
      },
      {
        name: 'Bridge',
        label: 'Pont',
        hint: 'Comment votre produit fait passer de l’un à l’autre.',
        direction: 'Show the product as the bridge between the two moments. No side-by-side before/after comparison.',
      },
    ],
  },
  {
    id: 'fab',
    acronym: 'FAB',
    expansion: 'Features, Advantages, Benefits',
    summary: 'Caractéristiques, avantages, puis bénéfices concrets pour le client.',
    bestFor: 'Produits techniques ou riches en fonctionnalités.',
    steps: [
      {
        name: 'Features',
        label: 'Caractéristiques',
        hint: 'Ce que contient ou fait le produit.',
        direction: 'Show what the product is and its key features.',
      },
      {
        name: 'Advantages',
        label: 'Avantages',
        hint: 'Ce que ces caractéristiques permettent de mieux faire.',
        direction: 'Show what those features make easier or better.',
      },
      {
        name: 'Benefits',
        label: 'Bénéfices',
        hint: 'Ce que le client y gagne concrètement dans sa vie.',
        direction: 'Show the concrete benefit in the customer’s life.',
      },
    ],
  },
  {
    id: '4c',
    acronym: '4C',
    expansion: 'Clear, Concise, Compelling, Credible',
    summary: 'Un message clair, court, convaincant et crédible.',
    bestFor: 'Vidéos très courtes et formats Stories.',
    steps: [
      {
        name: 'Clear',
        label: 'Clair',
        hint: 'Le message en une phrase simple.',
        direction: 'Convey one single, clear message that is instantly understood.',
      },
      {
        name: 'Concise',
        label: 'Concis',
        hint: 'Ce qu’on garde quand on enlève tout le superflu.',
        direction: 'Keep it minimal: no clutter, one idea per moment.',
      },
      {
        name: 'Compelling',
        label: 'Convaincant',
        hint: 'La raison qui donne envie d’agir maintenant.',
        direction: 'Make the reason to act feel compelling and emotionally engaging.',
      },
      {
        name: 'Credible',
        label: 'Crédible',
        hint: 'Un élément vérifiable qui inspire confiance.',
        direction: 'Include a credible, verifiable element that builds trust, without invented figures.',
      },
    ],
  },
  {
    id: 'aidca',
    acronym: 'AIDCA',
    expansion: 'Attention, Intérêt, Désir, Conviction, Action',
    summary: 'Variante d’AIDA qui ajoute des preuves avant l’appel à l’action.',
    bestFor: 'Offres plus chères, qui demandent d’être rassuré.',
    steps: [
      {
        name: 'Attention',
        label: 'Attention',
        hint: 'Capter le regard dès la première seconde.',
        direction: 'Open with a striking, scroll-stopping moment.',
      },
      {
        name: 'Interest',
        label: 'Intérêt',
        hint: 'Une information utile qui concerne le spectateur.',
        direction: 'Keep attention with a relatable, useful detail.',
      },
      {
        name: 'Desire',
        label: 'Désir',
        hint: 'Les bénéfices concrets du produit.',
        direction: 'Show the concrete benefits of the product in use.',
      },
      {
        name: 'Conviction',
        label: 'Conviction',
        hint: 'Une preuve réelle : démonstration, garantie, avis vérifiable.',
        direction: 'Show a genuine proof moment such as a product demonstration. No invented testimonials or figures.',
      },
      {
        name: 'Action',
        label: 'Action',
        hint: 'Un appel à l’action clair.',
        direction: 'End on a clear call to action moment.',
      },
    ],
  },
  {
    id: 'odc',
    acronym: 'ODC',
    expansion: 'Offer, Deadline, Call to Action',
    summary: 'Offre, urgence ou date limite, action. Très efficace pour les promotions.',
    bestFor: 'Promotions et offres limitées dans le temps.',
    steps: [
      {
        name: 'Offer',
        label: 'Offre',
        hint: 'Ce que le client obtient, et à quelles conditions.',
        direction: 'Present the offer clearly: what the customer gets.',
      },
      {
        name: 'Deadline',
        label: 'Date limite',
        hint: 'Une date limite réelle uniquement : jamais de fausse urgence.',
        direction: 'Convey the time limit calmly and honestly, without countdown pressure or fake scarcity.',
      },
      {
        name: 'Call to Action',
        label: 'Appel à l’action',
        hint: 'Le geste précis à faire maintenant.',
        direction: 'End on the precise action to take.',
      },
    ],
  },
  {
    id: '4p',
    acronym: '4P',
    expansion: 'Promise, Picture, Proof, Push',
    summary: 'Promesse forte, projection du résultat, preuves, appel à l’action.',
    bestFor: 'Lancements de produit et offres phares.',
    steps: [
      {
        name: 'Promise',
        label: 'Promesse',
        hint: 'Une promesse forte mais honnête, sans chiffre garanti.',
        direction: 'Open with a strong but honest promise, no guaranteed numbers.',
      },
      {
        name: 'Picture',
        label: 'Projection',
        hint: 'Faire imaginer la vie avec le résultat.',
        direction: 'Help the viewer picture life with the result, as an aspirational lifestyle moment.',
      },
      {
        name: 'Proof',
        label: 'Preuve',
        hint: 'Démonstration, garantie ou avis vérifiable.',
        direction: 'Show a genuine proof moment such as a demonstration. No invented testimonials.',
      },
      {
        name: 'Push',
        label: 'Passage à l’action',
        hint: 'Inviter à agir, sans pression abusive.',
        direction: 'End by inviting the viewer to act, without aggressive pressure.',
      },
    ],
  },
  {
    id: 'pppp',
    acronym: 'PPPP',
    expansion: 'Picture, Promise, Prove, Push',
    summary: 'Crée une image mentale, promet un résultat, le prouve, puis invite à agir.',
    bestFor: 'Récits visuels et émotionnels.',
    steps: [
      {
        name: 'Picture',
        label: 'Image mentale',
        hint: 'Une scène que le spectateur se représente immédiatement.',
        direction: 'Open with a vivid scene the viewer instantly relates to.',
      },
      {
        name: 'Promise',
        label: 'Promesse',
        hint: 'Le résultat que le produit aide à obtenir.',
        direction: 'Suggest the result the product helps achieve, honestly.',
      },
      {
        name: 'Prove',
        label: 'Preuve',
        hint: 'Ce qui rend la promesse crédible.',
        direction: 'Show what makes the promise credible, such as the product in real use.',
      },
      {
        name: 'Push',
        label: 'Invitation à agir',
        hint: 'L’action à faire maintenant.',
        direction: 'End by inviting the viewer to act.',
      },
    ],
  },
  {
    id: 'acca',
    acronym: 'ACCA',
    expansion: 'Awareness, Comprehension, Conviction, Action',
    summary: 'Fait prendre conscience du besoin, explique, convainc, puis incite à agir.',
    bestFor: 'Marchés qui ignorent encore qu’ils ont un besoin.',
    steps: [
      {
        name: 'Awareness',
        label: 'Prise de conscience',
        hint: 'Faire réaliser un besoin que le public ignore.',
        direction: 'Make the viewer realise a need they had not noticed, through an everyday moment.',
      },
      {
        name: 'Comprehension',
        label: 'Compréhension',
        hint: 'Expliquer simplement le besoin et la solution.',
        direction: 'Explain the need and the solution simply and visually.',
      },
      {
        name: 'Conviction',
        label: 'Conviction',
        hint: 'Convaincre avec une preuve réelle.',
        direction: 'Convince with a genuine proof moment. No invented testimonials.',
      },
      {
        name: 'Action',
        label: 'Action',
        hint: 'Inciter à passer à l’action.',
        direction: 'End on a clear call to action moment.',
      },
    ],
  },
  {
    id: 'pastor',
    acronym: 'PASTOR',
    expansion: 'Problem, Amplify, Story/Solution, Transformation, Offer, Response',
    summary: 'Version plus complète de PAS, utile pour les pages de vente.',
    bestFor: 'Vidéos de vente longues et pages de vente.',
    steps: [
      {
        name: 'Problem',
        label: 'Problème',
        hint: 'Le problème de votre public.',
        direction: 'Show the audience’s problem in a relatable way.',
      },
      {
        name: 'Amplify',
        label: 'Amplification',
        hint: 'Les conséquences si rien ne change, sans dramatiser.',
        direction: 'Show the consequences of leaving it unsolved, without dramatising.',
      },
      {
        name: 'Story/Solution',
        label: 'Histoire et solution',
        hint: 'L’histoire qui amène votre solution.',
        direction: 'Tell a short story that leads to the product as the solution.',
      },
      {
        name: 'Transformation',
        label: 'Transformation',
        hint: 'Le changement vécu, sans témoignage inventé.',
        direction: 'Show the realistic change the solution brings. No invented testimonials or guaranteed results.',
      },
      {
        name: 'Offer',
        label: 'Offre',
        hint: 'Ce qui est proposé exactement.',
        direction: 'Present the offer clearly.',
      },
      {
        name: 'Response',
        label: 'Réponse attendue',
        hint: 'Le geste que le spectateur doit faire.',
        direction: 'End on the action the viewer should take.',
      },
    ],
  },
  {
    id: 'quest',
    acronym: 'QUEST',
    expansion: 'Qualify, Understand, Educate, Stimulate, Transition',
    summary: 'Cible le bon public, comprend son besoin, l’éduque et le guide vers l’offre.',
    bestFor: 'Produits de niche et contenus éducatifs qui vendent.',
    steps: [
      {
        name: 'Qualify',
        label: 'Qualifier',
        hint: 'À qui s’adresse précisément la vidéo.',
        direction: 'Make it immediately clear who this is for.',
      },
      {
        name: 'Understand',
        label: 'Comprendre',
        hint: 'Montrer que vous comprenez son besoin.',
        direction: 'Show empathy with the audience’s need.',
      },
      {
        name: 'Educate',
        label: 'Éduquer',
        hint: 'Apporter une information utile.',
        direction: 'Share a useful, educational insight visually.',
      },
      {
        name: 'Stimulate',
        label: 'Stimuler',
        hint: 'Donner envie de la solution.',
        direction: 'Spark desire for the solution.',
      },
      {
        name: 'Transition',
        label: 'Transition',
        hint: 'Amener naturellement vers l’offre.',
        direction: 'Transition naturally to the offer and the next step.',
      },
    ],
  },
];

export const AD_FRAMEWORK_IDS = AD_FRAMEWORKS.map((framework) => framework.id) as [string, ...string[]];

export function findAdFramework(id: string | null | undefined): AdFramework | undefined {
  return AD_FRAMEWORKS.find((framework) => framework.id === id);
}

/** Méthodes ouvertes par une limite de palier (null : toutes). */
export function availableAdFrameworks(limit: number | null): readonly AdFramework[] {
  return limit === null ? AD_FRAMEWORKS : AD_FRAMEWORKS.slice(0, Math.max(0, limit));
}

export function isAdFrameworkAvailable(id: string, limit: number | null): boolean {
  return availableAdFrameworks(limit).some((framework) => framework.id === id);
}
