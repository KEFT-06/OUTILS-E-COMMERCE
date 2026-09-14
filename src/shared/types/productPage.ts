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
 * Tout ce que le produit ne contient pas — le problème vécu, le lien de paiement,
 * les conditions, la FAQ — vient de l'auteur. Rien n'est généré à sa place, et
 * aucun témoignage n'est prévu : il n'y aurait rien d'autre à y mettre que des
 * témoignages inventés.
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
  faq: FaqItem[];
  images: Partial<Record<SectionRole, string>>;
}
