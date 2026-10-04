import { Router } from 'express';
import { providers } from '@server/env';
import { AppError, aiLimiter, asyncRoute, providerUnavailable, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { assertCompliantBrief } from '@server/services/compliance/guard';
import { findOwnedGeneration, runBilledGeneration, settleGeneration } from '@server/services/generations';
import {
  type StorybookBrief,
  briefText,
  createStorybook,
  generationIdSchema,
  getStorybookGeneration,
  listStorybooks,
  recordStorybook,
  sendStorybookPdf,
  storyDraftSchema,
  storybookBriefSchema,
  submitStorybook,
  writeStory,
} from '@server/services/storybook';

/** Storybook africain : conte rédigé par Gemini, mis en page et illustré par Gamma (server/services/storybook). */

export const storybookRouter = Router();

/**
 * Corps de la demande d'illustration : le brief, plus le conte approuvé dans l'aperçu.
 *
 * `story` doit être DÉCLARÉ ici : `validateBody` remplace le corps par le résultat de zod,
 * qui écarte toute clé non déclarée. Sans cette ligne, le texte validé par l'auteur
 * disparaissait en silence et le serveur en réécrivait un autre — l'aperçu n'aurait servi
 * à rien, et l'écriture aurait été payée deux fois.
 */
const illustrationBodySchema = storybookBriefSchema.extend({ story: storyDraftSchema.optional() });

/**
 * Écrit le conte, et rien de plus.
 *
 * DEUX ÉTAPES, PARCE QUE LEURS PRIX N'ONT RIEN À VOIR. Écrire un conte coûte quelques
 * fractions de centime en jetons ; l'illustrer page par page chez Gamma est ce qui coûte
 * vraiment. Les lancer ensemble faisait payer quinze points À L'AVEUGLE : l'auteur découvrait
 * son histoire une fois le PDF produit, et une histoire qui ne lui convenait pas était déjà
 * entièrement illustrée.
 *
 * Trois points pour le texte, douze pour l'illustration — le total ne bouge pas. Ce qui change,
 * c'est qu'on peut relire, refuser, et recommencer l'écriture pour un cinquième du prix.
 *
 * Aucun appel à Gamma ici : un serveur sans clé Gamma peut donc écrire un conte, et son auteur
 * le lira. Il ne pourra simplement pas l'illustrer.
 */
storybookRouter.post(
  '/stories',
  requireAuth,
  requireFeature('storybook_generation'),
  aiLimiter,
  validateBody(storybookBriefSchema),
  asyncRoute(async (req, res) => {
    const brief = req.body as StorybookBrief;

    await assertCompliantBrief(
      briefText(brief),
      'Le brief contient des formulations non conformes : corrigez-les avant de lancer l’écriture.',
    );
    if (!providers.gemini) throw providerUnavailable('rédaction automatique');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'storybook_story',
      kind: 'storybook',
      provider: 'gemini',
      run: () => writeStory(brief),
      describe: () => ({ providerRef: null, state: 'completed', fileFormat: null }),
    });

    res.json({ story: result });
  }),
);

/**
 * Lance la création d'un conte.
 *
 * Ordre des contrôles : compte et palier, validation, conformité du brief, puis disponibilité de
 * Gemini et de Gamma. La conformité passe avant les fournisseurs pour que l'auteur puisse corriger
 * son brief même sur un serveur sans clé.
 *
 * Le corps peut porter un `story` : celui que l'auteur vient de lire et d'approuver dans
 * l'aperçu, éventuellement corrigé. Sans lui, le conte est écrit puis illustré d'un seul geste,
 * comme avant — mais alors les trois points de l'écriture ne sont pas facturés deux fois, car
 * cette route ne facture que l'illustration.
 */
storybookRouter.post(
  '/generations',
  requireAuth,
  requireFeature('storybook_generation'),
  aiLimiter,
  validateBody(illustrationBodySchema),
  asyncRoute(async (req, res) => {
    const brief = req.body as StorybookBrief;

    await assertCompliantBrief(
      briefText(brief),
      'Le brief contient des formulations non conformes : corrigez-les avant de lancer la génération.',
    );

    if (!providers.gemini) throw providerUnavailable('rédaction automatique');
    if (!providers.gamma) throw providerUnavailable('mise en page illustrée');

    /*
      Le conte approuvé dans l'aperçu est réutilisé tel quel : le réécrire produirait une autre
      histoire que celle que l'auteur vient de lire et de valider, ce qui viderait l'aperçu de
      son sens et referait payer l'écriture.
    */
    /*
      Le conte approuvé est relu depuis le corps validé, et non depuis la requête brute :
      `validateBody` remplace `req.body` par le résultat de zod, qui écarte les clés non
      déclarées. Le schéma de cette route déclare donc `story` — sans quoi le texte validé
      par l'auteur disparaissait en silence, et le serveur en réécrivait un autre.
    */
    const approuve = storyDraftSchema.safeParse((req.body as { story?: unknown }).story);

    /*
      Le prix suit le travail réellement demandé, et rien d'autre.

      Avec un texte approuvé, il ne reste que l'illustration : douze points, l'écriture ayant
      déjà été payée trois. Sans texte, les deux étapes se font ici : quinze, comme avant.

      Facturer douze dans les deux cas rendrait l'écriture gratuite pour qui appelle cette
      route directement — un trou que l'aperçu ne doit pas ouvrir.
    */
    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: approuve.success ? 'storybook_illustration' : 'storybook_generation',
      kind: 'storybook',
      provider: 'gamma',
      run: async () =>
        approuve.success
          ? { ...(await submitStorybook(brief, approuve.data)), story: approuve.data }
          : createStorybook(brief),
      describe: (created) => ({ providerRef: created.generationId, state: 'pending', fileFormat: 'pdf' }),
    });
    const storybookId = await recordStorybook(req.auth!, brief, result.generationId, result.story);

    res.status(202).json({ generationId: result.generationId, storybookId, title: result.story.title });
  }),
);

/** Contes du compte, du plus récent au plus ancien. */
storybookRouter.get(
  '/books',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ storybooks: await listStorybooks(req.auth!) });
  }),
);

/** PDF d'un conte terminé. Le lien d'export de Gamma, secret, ne quitte jamais le serveur. */
storybookRouter.get(
  '/books/:storybookId/pdf',
  requireAuth,
  routeLimiter(10, 60),
  asyncRoute(async (req, res) => {
    if (!providers.gamma) throw providerUnavailable('mise en page illustrée');
    await sendStorybookPdf(req.auth!, req.params.storybookId, res);
  }),
);

/** Suivi d'une génération de son auteur. Hors `aiLimiter` : le client sonde toutes les 5 secondes. */
storybookRouter.get(
  '/generations/:generationId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = generationIdSchema.safeParse(req.params.generationId);
    if (!parsed.success) {
      throw new AppError(400, 'Identifiant de génération invalide.', 'INVALID_GENERATION_ID');
    }
    if (!providers.gamma) throw providerUnavailable('mise en page illustrée');

    const generation = await findOwnedGeneration(req.auth!, 'gamma', parsed.data);
    const status = await getStorybookGeneration(parsed.data);
    await settleGeneration(generation, status.status);
    res.json(status);
  }),
);
