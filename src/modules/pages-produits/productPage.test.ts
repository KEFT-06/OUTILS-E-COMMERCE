import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completePageDraft, emptyPageDraft, type PageProposal } from '@/modules/pages-produits/productPage';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import type { ProductPageDraft } from '@/shared/types/productPage';

/**
 * La page de vente d'un ouvrage s'ouvre remplie de ce que l'analyse propose (propriétaire,
 * 18/10/2026 : « l'utilisateur modifie juste »), et ce que l'auteur a écrit n'est jamais remplacé.
 */

const product = { id: 'p1', title: 'Élever des poules en ville', recommendedPrice: null, currency: 'XAF' } as unknown as DigitalProductIdea;

const proposal: PageProposal = {
  problem: 'Le prix des œufs monte.',
  notFor: 'Pas pour qui cherche un résultat sans effort.',
  offerConditions: 'Accès immédiat après paiement.',
  faq: [{ question: '« C’est trop cher »', answer: 'Moins qu’un mois d’œufs.' }],
  images: { hero: 'https://cdn.exemple.test/couverture.jpg', problem: 'https://cdn.exemple.test/poulailler.jpg' },
  price: '25 900 FCFA',
};

describe('Page produit : remplie d’après l’analyse', () => {
  it('une page jamais ouverte s’ouvre remplie ; seul le lien de paiement reste à l’auteur', () => {
    const draft = emptyPageDraft(product, proposal);
    assert.equal(draft.problem, 'Le prix des œufs monte.');
    assert.equal(draft.notFor, 'Pas pour qui cherche un résultat sans effort.');
    assert.equal(draft.offerConditions, 'Accès immédiat après paiement.');
    assert.deepEqual(draft.faq, proposal.faq);
    assert.deepEqual(draft.images, proposal.images);
    assert.equal(draft.price, '25 900 FCFA', 'le produit n’a pas de prix : celui du simulateur');
    assert.equal(draft.checkoutUrl, '');
  });

  it('le prix de l’ouvrage passe avant celui du simulateur', () => {
    const priced = { ...product, recommendedPrice: 15000 } as DigitalProductIdea;
    assert.notEqual(emptyPageDraft(priced, proposal).price, '25 900 FCFA');
    assert.match(emptyPageDraft(priced, proposal).price ?? '', /15/);
  });

  it('une page commencée : les cases vides sont complétées, ce qui est écrit reste tel quel', () => {
    const started: ProductPageDraft = {
      ...emptyPageDraft(product),
      notFor: 'Mon texte à moi',
      faq: [{ question: 'Ma question', answer: 'Ma réponse' }],
      images: { hero: 'https://cdn.exemple.test/mon-image.jpg', content: '  ' },
    };
    const completed = completePageDraft(started, product, proposal);
    assert.equal(completed.notFor, 'Mon texte à moi');
    assert.equal(completed.offerConditions, 'Accès immédiat après paiement.');
    assert.deepEqual(completed.faq, [{ question: 'Ma question', answer: 'Ma réponse' }], 'ses questions ne sont pas remplacées');
    assert.deepEqual(completed.images, { hero: 'https://cdn.exemple.test/mon-image.jpg', problem: 'https://cdn.exemple.test/poulailler.jpg' }, 'son image reste, les sections vides reçoivent la proposition');
    assert.equal(completed.price, '25 900 FCFA');

    const touched = { ...started, completed: true, completedVersion: 2 };
    assert.equal(completePageDraft(touched, product, proposal), touched, 'déjà complétée une fois : ce que l’auteur a effacé reste effacé');
  });

  it('une page retouchée avant le 18/10/2026 reçoit une fois les nouvelles propositions, sans retrouver ce qu’elle avait effacé', () => {
    const ancienne: ProductPageDraft = { ...emptyPageDraft(product), problem: '', completed: true };
    const completed = completePageDraft(ancienne, product, proposal);
    assert.equal(completed.problem, '', 'le problème proposé dès la première version, effacé par l’auteur : il reste effacé');
    assert.equal(completed.offerConditions, 'Accès immédiat après paiement.');
    assert.equal(completed.notFor, 'Pas pour qui cherche un résultat sans effort.');
    assert.deepEqual(completed.faq, proposal.faq);
    assert.equal(completed.price, '25 900 FCFA');
  });
});
