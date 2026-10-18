/** Générateur de pages produits — feuille de route 5.3. */

/** Les 7 sections de la page, chacune avec un rôle de conversion. */
export type SectionRole = 'hero' | 'problem' | 'solution' | 'content' | 'audience' | 'offer' | 'faq_cta';

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Saisies de l'auteur qui complètent le produit du Studio.
 *
 * Ce que le produit ne contient pas est proposé d'après l'analyse — problème vécu,
 * conditions, questions-réponses tirées des objections, images, prix du simulateur —
 * et l'auteur le corrige. Seul le lien de paiement vient de lui : c'est le sien. Aucun
 * témoignage n'est prévu : il n'y aurait rien d'autre à y mettre que des témoignages inventés.
 */
export interface ProductPageDraft {
  productId: string;
  headlineA: string;
  /** Vide ⇒ pas de variante B pour l'accroche. */
  headlineB: string;
  ctaLabelA: string;
  ctaLabelB: string;
  checkoutUrl: string;
  problem: string;
  notFor: string;
  offerConditions: string;
  /** Prix affiché, saisi par l'auteur ; vide : celui du produit, s'il en a un. */
  price?: string;
  faq: FaqItem[];
  images: Partial<Record<SectionRole, string>>;
  /** Les champs restés vides ont déjà été complétés une fois d'après l'analyse : ce que l'auteur efface ensuite reste effacé. */
  completed?: boolean;
  /** Version des propositions déjà reçues ; absente sur une page retouchée avant le 18/10/2026 (version 1). */
  completedVersion?: number;
}
