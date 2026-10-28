import { Router } from 'express';
import { providers } from '@server/env';
import { AppError, aiLimiter, asyncRoute, providerUnavailable, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { assertCompliantBrief } from '@server/services/compliance/guard';
import { findOwnedGeneration, runBilledGeneration, settleGeneration } from '@server/services/generations';
import { textConfigured } from '@server/services/ai/text';
import {
  type StoryDraft,
  type StorybookBrief,
  briefText,
  generationIdSchema,
  getStorybookGeneration,
  listStorybooks,
  recordWrittenStorybook,
  sendStorybookPdf,
  sendStorybookPicture,
  storyDraftSchema,
  storybookBriefSchema,
  writeStory,
} from '@server/services/storybook';
import { OWN_PROVIDER, getOwnStorybookStatus, isOwnGeneration } from '@server/services/storybook/illustrate';

/**
 * Storybook africain : le conte est rédigé, relu et corrigé par son auteur, puis enregistré et
 * téléchargé en PDF (server/services/storybook). L'illustration des pages est retirée depuis le
 * 28/10/2026 avec la génération d'images ; les contes illustrés d'avant restent téléchargeables.
 */

export const storybookRouter = Router();

/**
 * Corps de l'enregistrement : le brief, plus le conte tel que l'auteur l'a relu et corrigé.
 *
 * `story` doit être DÉCLARÉ ici : `validateBody` remplace le corps par le résultat de zod,
 * qui écarte toute clé non déclarée.
 */
const writtenStoryBodySchema = storybookBriefSchema.extend({ story: storyDraftSchema });

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
    if (!textConfigured()) throw providerUnavailable('rédaction automatique');

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
 * Enregistre le conte relu et corrigé par son auteur : il rejoint « Mes contes » et se télécharge
 * en PDF. Aucun point de plus — l'écriture a déjà été payée. Le texte corrigé passe la conformité :
 * c'est lui, désormais, qui part dans le PDF.
 */
storybookRouter.post(
  '/books',
  requireAuth,
  requireFeature('storybook_generation'),
  routeLimiter(30, 60),
  validateBody(writtenStoryBodySchema),
  asyncRoute(async (req, res) => {
    const { story, ...brief } = req.body as StorybookBrief & { story: StoryDraft };
    await assertCompliantBrief(
      [story.title, ...story.pages.flatMap((page) => [page.heading, page.text])].join('\n'),
      'Le conte contient des formulations non conformes : corrigez-les avant de l’enregistrer.',
    );
    const storybookId = await recordWrittenStorybook(req.auth!, brief, story);
    res.status(201).json({ storybookId, title: story.title });
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
    await sendStorybookPdf(req.auth!, req.params.storybookId, res);
  }),
);

/** Illustration d'une page (0 : la couverture), pour l'aperçu du conte à l'écran. */
storybookRouter.get(
  '/books/:storybookId/pages/:position',
  requireAuth,
  routeLimiter(240, 60),
  asyncRoute(async (req, res) => {
    await sendStorybookPicture(req.auth!, req.params.storybookId, req.params.position, res);
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
    if (isOwnGeneration(parsed.data)) {
      await findOwnedGeneration(req.auth!, OWN_PROVIDER, parsed.data);
      // Le circuit maison règle lui-même la génération (points gardés ou rendus) en fin de tranche.
      res.json(await getOwnStorybookStatus(parsed.data));
      return;
    }
    if (!providers.gamma) throw providerUnavailable('mise en page illustrée');

    const generation = await findOwnedGeneration(req.auth!, 'gamma', parsed.data);
    const status = await getStorybookGeneration(parsed.data);
    await settleGeneration(generation, status.status);
    res.json(status);
  }),
);
