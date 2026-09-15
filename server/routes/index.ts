import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  AppError,
  aiLimiter,
  asyncRoute,
  marketSchema,
  nicheQuerySchema,
  providerUnavailable,
  validateBody,
} from '@server/middleware';
import { authenticate, requireAuth, requireFeature } from '@server/middleware/auth';
import { providers } from '@server/env';
import { accountRouter } from '@server/routes/account';
import { adminRouter } from '@server/routes/admin';
import { authRouter } from '@server/routes/auth';
import {
  METHODOLOGY_VERSION,
  computeCompetitiveScore,
  describeMethodology,
} from '@server/services/scoring';
import {
  ComplianceUnavailableError,
  checkText,
  getRulesMetadata,
} from '@server/services/compliance';
import { CreditConfigUnavailableError, getCostTable } from '@server/services/credits';
import { PricingUnavailableError, getPricing } from '@server/services/pricing';
import { annotateAd, getActiveAdapter, listAdapters } from '@server/services/ingestion';
import {
  OriginalityConfigUnavailableError,
  checkOriginality,
} from '@server/services/originality';
import {
  StorybookBrief,
  briefText,
  createStorybookGeneration,
  generationIdSchema,
  getStorybookGeneration,
  storybookBriefSchema,
} from '@server/services/storybook';
import {
  VideoBrief,
  VisualBrief,
  creativeText,
  fileFormatOf,
  generationStateOf,
  getCreativeStatus,
  streamCreativeFile,
  submitVideo,
  submitVisual,
  videoBriefSchema,
  visualBriefSchema,
} from '@server/services/creatives';
import { requestIdSchema } from '@server/services/higgsfield';
import {
  MarketplaceContext,
  availableMarketplaces,
  getMarketplace,
  listMarketplaces,
} from '@server/services/marketplaces';
import { BlueprintsUnavailableError, getCampaignBlueprints } from '@server/services/blueprints';
import { LaunchKitUnavailableError, getLaunchKitConfig } from '@server/services/launchKit';
import {
  affiliateCodeSchema,
  getChariowAffiliate,
  invitationSchema,
  sendChariowInvitations,
} from '@server/services/affiliation';
import {
  findOwnedGeneration,
  runBilledGeneration,
  settleGeneration,
} from '@server/services/generations';
import { resolveChariowCredentials } from '@server/services/integrations';
import { FEATURES, PlansUnavailableError, getPlanConfig } from '@server/services/plans';

export const api = Router();

// Attache le compte de la session à chaque requête ; les refus se font route par route.
api.use(authenticate);

api.use('/auth', authRouter);
api.use('/account', accountRouter);
api.use('/admin', adminRouter);

/* -------------------------------------------------------------------------- */
/*  Santé et capacités                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Expose quels fournisseurs sont configurés — sans jamais révéler les clés.
 * Le client s'en sert pour désactiver proprement les fonctions indisponibles
 * plutôt que de laisser l'utilisateur déclencher un échec.
 */
api.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    methodologyVersion: METHODOLOGY_VERSION,
    providers: {
      text: providers.gemini,
      video: providers.higgsfield,
      storybook: providers.gamma,
      adIngestion: providers.meta,
    },
  });
});

/* -------------------------------------------------------------------------- */
/*  Paliers d'abonnement                                                       */
/* -------------------------------------------------------------------------- */

api.get(
  '/plans',
  asyncRoute(async (_req, res) => {
    try {
      const config = await getPlanConfig();
      res.json({
        version: config.version,
        updatedAt: config.updatedAt,
        currency: config.currency,
        features: FEATURES,
        plans: config.plans,
      });
    } catch (error) {
      if (error instanceof PlansUnavailableError) {
        console.error('[paliers] table illisible :', error.configPath, error.cause);
        throw new AppError(503, error.message, 'PLANS_UNAVAILABLE');
      }
      throw error;
    }
  }),
);

/* -------------------------------------------------------------------------- */
/*  Scoring — différenciateur n°1 : la méthode est publique                    */
/* -------------------------------------------------------------------------- */

api.get('/scoring/methodology', (_req, res) => {
  res.json(describeMethodology());
});

const signalsSchema = z.object({
  uniqueAdvertisers: z.number().int().min(0).max(1_000_000),
  activeAds: z.number().int().min(0).max(10_000_000),
  averageLifetimeDays: z.number().min(0).max(3650),
  establishedAds: z.number().int().min(0).max(10_000_000),
});

/**
 * Calcule un score à partir de signaux bruts fournis.
 * Utile pour le panneau de détail de calcul et pour les tests de non-régression
 * de la méthodologie.
 */
api.post(
  '/scoring/compute',
  validateBody(signalsSchema),
  asyncRoute((req, res) => {
    const signals = req.body as z.infer<typeof signalsSchema>;

    if (signals.establishedAds > signals.activeAds) {
      throw new AppError(
        400,
        'Le nombre de publicités établies ne peut pas dépasser le nombre de publicités actives.',
        'INCONSISTENT_SIGNALS',
      );
    }

    res.json(computeCompetitiveScore(signals));
  }),
);

/* -------------------------------------------------------------------------- */
/*  Conformité — différenciateur n°2 : droit de veto avant tout export         */
/* -------------------------------------------------------------------------- */

/**
 * Traduit l'indisponibilité de la table en 503 explicite.
 *
 * Le client doit pouvoir distinguer « rien à signaler » d'« impossible de
 * vérifier » : dans le second cas il bloque l'export au lieu de l'autoriser.
 * Un 500 générique laisserait cette distinction à l'interprétation.
 */
function asComplianceRouteError(error: unknown): never {
  if (error instanceof ComplianceUnavailableError) {
    console.error('[conformité] table illisible :', error.configPath, error.cause);
    throw new AppError(503, error.message, 'COMPLIANCE_UNAVAILABLE');
  }
  throw error;
}

api.get(
  '/compliance/rules',
  asyncRoute(async (_req, res) => {
    res.json(await getRulesMetadata().catch(asComplianceRouteError));
  }),
);

const complianceSchema = z.object({
  text: z.string().min(1).max(20_000),
  context: z.enum(['ad_copy', 'product_page', 'ebook', 'storybook', 'video_script']).optional(),
});

api.post(
  '/compliance/check',
  validateBody(complianceSchema),
  asyncRoute(async (req, res) => {
    const { text } = req.body as z.infer<typeof complianceSchema>;
    res.json(await checkText(text).catch(asComplianceRouteError));
  }),
);

/* -------------------------------------------------------------------------- */
/*  Crédits — différenciateur n°3 : le coût est annoncé avant l'action         */
/* -------------------------------------------------------------------------- */

api.get(
  '/credits/costs',
  asyncRoute(async (_req, res) => {
    try {
      res.json(await getCostTable());
    } catch (error) {
      if (error instanceof CreditConfigUnavailableError) {
        console.error('[crédits] grille illisible :', error.configPath, error.cause);
        throw new AppError(503, error.message, 'CREDIT_CONFIG_UNAVAILABLE');
      }
      throw error;
    }
  }),
);

/* -------------------------------------------------------------------------- */
/*  Fourchettes de prix — CdC §2 : jamais figées dans le code                  */
/* -------------------------------------------------------------------------- */

api.get(
  '/pricing/ranges',
  asyncRoute(async (_req, res) => {
    try {
      res.json(await getPricing());
    } catch (error) {
      if (error instanceof PricingUnavailableError) {
        console.error('[prix] table illisible :', error.configPath, error.cause);
        throw new AppError(503, error.message, 'PRICING_UNAVAILABLE');
      }
      throw error;
    }
  }),
);

/* -------------------------------------------------------------------------- */
/*  Ingestion publicitaire — source interchangeable (feuille de route 2.1)     */
/* -------------------------------------------------------------------------- */

/** Diagnostic : quelles sources existent, laquelle est active, et pourquoi. */
api.get('/ingestion/adapters', (_req, res) => {
  const active = getActiveAdapter();
  res.json({ active: active.id, adapters: listAdapters() });
});

/**
 * Plafond de publicités renvoyées à la galerie. Le score, lui, reste calculé
 * sur l'échantillon complet : tronquer les signaux fausserait la mesure, alors
 * que tronquer l'affichage ne coûte qu'un « et N autres ».
 */
const GALLERY_AD_LIMIT = 200;

const ingestionSchema = z.object({
  niche: nicheQuerySchema,
  market: marketSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

/**
 * Collecte les publicités puis calcule le score d'intensité concurrentielle.
 *
 * C'est la chaîne complète du différenciateur n°1 sur données réelles :
 * ingestion → signaux bruts → `computeCompetitiveScore` → trace vérifiable.
 * Les points sont prélevés par le serveur et rendus si la collecte échoue.
 */
api.post(
  '/ingestion/scan',
  requireAuth,
  requireFeature('ad_gallery_scan'),
  aiLimiter,
  validateBody(ingestionSchema),
  asyncRoute(async (req, res) => {
    const { niche, market, limit } = req.body as z.infer<typeof ingestionSchema>;
    const adapter = getActiveAdapter();

    const availability = adapter.isAvailable();
    if (!availability.available) {
      throw new AppError(503, availability.reason, 'INGESTION_UNAVAILABLE');
    }

    const { result: ingestion } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'ad_gallery_scan',
      kind: 'ad_scan',
      provider: adapter.id,
      run: () =>
        adapter.fetchAds({
          niche,
          ...(market ? { market } : {}),
          ...(limit ? { limit } : {}),
        }),
      describe: () => ({ providerRef: null, state: 'completed' }),
    });

    const score = computeCompetitiveScore(ingestion.signals, new Date(ingestion.collectedAt));

    // Les publicités accompagnent le score dans la même réponse : la galerie et
    // l'indicateur décrivent alors rigoureusement la même collecte. Deux appels
    // séparés auraient produit deux instants de mesure, donc un écart possible
    // entre ce que le score affirme et ce que la galerie montre.
    res.json({
      score,
      signals: ingestion.signals,
      // Annotées avec les fonctions qui produisent les signaux : la galerie
      // affiche les mêmes durées et statuts que ceux comptés par le score.
      ads: ingestion.ads
        .slice(0, GALLERY_AD_LIMIT)
        .map((ad) => annotateAd(ad, new Date(ingestion.collectedAt))),
      adsTruncated: ingestion.ads.length > GALLERY_AD_LIMIT,
      // La provenance voyage avec les chiffres et non à côté : c'est ce qui
      // permet à l'interface de l'afficher sous chaque graphique sans la
      // reconstituer, donc sans risquer de la faire diverger.
      provenance: {
        source: ingestion.sourceLabel,
        collectedAt: ingestion.collectedAt,
        sampleSize: ingestion.ads.length,
        sampleUnit: 'publicités',
        isDemonstration: ingestion.isDemonstration,
        ...(ingestion.sourceUrl ? { sourceUrl: ingestion.sourceUrl } : {}),
      },
      advertiserCount: new Set(ingestion.ads.map((ad) => ad.advertiserId)).size,
    });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Originalité — avertissement bloquant sous le seuil (feuille de route 3.2)  */
/* -------------------------------------------------------------------------- */

const originalitySchema = z.object({
  text: z.string().min(1).max(50_000),
  // Plafonds choisis pour rester sous la limite de 1 Mo du corps de requête.
  references: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        text: z.string().min(1).max(10_000),
      }),
    )
    .max(80)
    .optional(),
});

api.post(
  '/originality/check',
  validateBody(originalitySchema),
  asyncRoute(async (req, res) => {
    const { text, references } = req.body as z.infer<typeof originalitySchema>;

    try {
      res.json(await checkOriginality(text, references ?? []));
    } catch (error) {
      if (error instanceof OriginalityConfigUnavailableError) {
        console.error('[originalité] paramètres illisibles :', error.configPath, error.cause);
        throw new AppError(503, error.message, 'ORIGINALITY_UNAVAILABLE');
      }
      throw error;
    }
  }),
);

/* -------------------------------------------------------------------------- */
/*  Storybook Africain via Gamma (feuille de route 3.4)                        */
/* -------------------------------------------------------------------------- */

/**
 * Lance la génération d'un conte.
 *
 * Ordre des contrôles : compte et palier, validation, conformité du brief, puis
 * disponibilité de Gamma. La conformité passe avant le fournisseur pour que
 * l'auteur puisse corriger son brief même sur un serveur sans clé Gamma.
 */
api.post(
  '/storybook/generations',
  requireAuth,
  requireFeature('storybook_generation'),
  aiLimiter,
  validateBody(storybookBriefSchema),
  asyncRoute(async (req, res) => {
    const brief = req.body as StorybookBrief;

    await assertCompliantBrief(
      briefText(brief),
      'Le brief contient des formulations non conformes : corrigez-les avant de lancer la génération.',
    );

    if (!providers.gamma) throw providerUnavailable('Gamma');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'storybook_generation',
      kind: 'storybook',
      provider: 'gamma',
      run: () => createStorybookGeneration(brief),
      describe: (created) => ({ providerRef: created.generationId, state: 'pending', fileFormat: 'lien' }),
    });

    res.status(202).json(result);
  }),
);

/** Suivi d'une génération de son auteur. Hors `aiLimiter` : le client sonde toutes les 5 secondes. */
api.get(
  '/storybook/generations/:generationId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = generationIdSchema.safeParse(req.params.generationId);
    if (!parsed.success) {
      throw new AppError(400, 'Identifiant de génération invalide.', 'INVALID_GENERATION_ID');
    }
    if (!providers.gamma) throw providerUnavailable('Gamma');

    const generation = await findOwnedGeneration(req.auth!, 'gamma', parsed.data);
    const status = await getStorybookGeneration(parsed.data);
    await settleGeneration(generation, status.status);
    res.json(status);
  }),
);

/* -------------------------------------------------------------------------- */
/*  Créatifs publicitaires : visuels et vidéos (feuille de route 4.1, 4.2, 4.4) */
/* -------------------------------------------------------------------------- */

/** Refuse une génération dont le brief déclenche une règle bloquante (422 avec constats). */
async function assertCompliantBrief(text: string, message: string): Promise<void> {
  const verdict = await checkText(text).catch(asComplianceRouteError);
  if (!verdict.exportAllowed) {
    throw new AppError(
      422,
      message,
      'BRIEF_NON_COMPLIANT',
      verdict.findings.filter((finding) => finding.severity === 'block'),
    );
  }
}

function parseCreativeRequestId(value: string | undefined): string {
  const parsed = requestIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, 'Identifiant de génération invalide.', 'INVALID_GENERATION_ID');
  }
  return parsed.data;
}

api.post(
  '/creatives/visuals',
  requireAuth,
  requireFeature('image_generation'),
  aiLimiter,
  validateBody(visualBriefSchema),
  asyncRoute(async (req, res) => {
    const brief = req.body as VisualBrief;
    await assertCompliantBrief(
      creativeText(brief),
      'Le brief du visuel contient des formulations non conformes : corrigez-les avant de lancer la génération.',
    );
    if (!providers.higgsfield) throw providerUnavailable('Higgsfield');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'image_generation',
      kind: 'image',
      provider: 'higgsfield',
      run: () => submitVisual(brief),
      describe: (status) => ({
        providerRef: status.requestId,
        state: generationStateOf(status.status),
        fileFormat: fileFormatOf(status),
      }),
    });

    res.status(202).json(result);
  }),
);

api.post(
  '/creatives/videos',
  requireAuth,
  requireFeature('video_generation'),
  aiLimiter,
  validateBody(videoBriefSchema),
  asyncRoute(async (req, res) => {
    const brief = req.body as VideoBrief;
    await assertCompliantBrief(
      creativeText(brief),
      'Le brief de la vidéo contient des formulations non conformes : corrigez-les avant de lancer la génération.',
    );
    if (!providers.higgsfield) throw providerUnavailable('Higgsfield');

    const { result } = await runBilledGeneration({
      auth: req.auth!,
      actionId: 'video_generation',
      kind: 'video',
      provider: 'higgsfield',
      run: () => submitVideo(brief),
      describe: (status) => ({
        providerRef: status.requestId,
        state: generationStateOf(status.status),
        fileFormat: fileFormatOf(status),
      }),
    });

    res.status(202).json(result);
  }),
);

/** Suivi d'une génération de son auteur. Hors `aiLimiter` : le client sonde toutes les 5 secondes. */
api.get(
  '/creatives/requests/:requestId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const requestId = parseCreativeRequestId(req.params.requestId);
    if (!providers.higgsfield) throw providerUnavailable('Higgsfield');

    const generation = await findOwnedGeneration(req.auth!, 'higgsfield', requestId);
    const status = await getCreativeStatus(requestId);
    await settleGeneration(generation, generationStateOf(status.status), fileFormatOf(status));
    res.json(status);
  }),
);

/** Fichier généré, relayé depuis le fournisseur, à son seul auteur (aperçu ou téléchargement). */
api.get(
  '/creatives/requests/:requestId/file',
  requireAuth,
  asyncRoute(async (req, res) => {
    const requestId = parseCreativeRequestId(req.params.requestId);
    if (!providers.higgsfield) throw providerUnavailable('Higgsfield');

    await findOwnedGeneration(req.auth!, 'higgsfield', requestId);
    const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
    await streamCreativeFile(requestId, disposition, res);
  }),
);

/* -------------------------------------------------------------------------- */
/*  Distribution : connecteurs marketplace (feuille de route 5.2)              */
/* -------------------------------------------------------------------------- */

/** Boutiques du compte qui fait la demande : sa propre clé Chariow, jamais celle d'un autre. */
async function marketplaceContext(req: Request): Promise<MarketplaceContext> {
  const credentials = await resolveChariowCredentials(req.auth);
  return { chariowApiKey: credentials?.apiKey ?? null };
}

/** Connecteurs, disponibilité et capacités déclarées — y compris ceux qui ne peuvent pas exister. */
api.get(
  '/marketplaces',
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json({ marketplaces: listMarketplaces(await marketplaceContext(req)) });
  }),
);

const salesPeriodSchema = z.coerce.number().int().min(1).max(365).catch(30);

/**
 * Ventes encaissées sur les N derniers jours, pour chaque marketplace disponible.
 * Agrégats seulement : aucune donnée client ne quitte le serveur.
 */
api.get(
  '/marketplaces/sales-summary',
  requireAuth,
  asyncRoute(async (req, res) => {
    const days = salesPeriodSchema.parse(req.query.days);
    const context = await marketplaceContext(req);
    const sources = availableMarketplaces(context).filter((adapter) => adapter.capabilities.readSales);

    if (sources.length === 0) {
      throw new AppError(
        503,
        'Aucune boutique connectée à votre compte : ajoutez votre clé API Chariow dans Mon compte → Connexions.',
        'NO_SALES_SOURCE',
      );
    }

    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86_400_000);
    const range = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };

    const summaries = await Promise.all(sources.map((adapter) => adapter.salesSummary(context, range)));
    res.json({ days, range, summaries });
  }),
);

api.get(
  '/marketplaces/:marketplaceId/products',
  requireAuth,
  asyncRoute(async (req, res) => {
    const adapter = getMarketplace(req.params.marketplaceId);
    const context = await marketplaceContext(req);

    const availability = adapter.isAvailable(context);
    if (!availability.available) {
      throw new AppError(503, availability.reason, 'MARKETPLACE_NOT_AVAILABLE');
    }
    if (!adapter.capabilities.readProducts) {
      throw new AppError(501, `${adapter.label} ne permet pas d'importer son catalogue.`, 'MARKETPLACE_CAPABILITY_MISSING');
    }

    res.json({ marketplace: adapter.id, ...(await adapter.listProducts(context)) });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Structures de campagnes Meta et TikTok (feuille de route 5.4)              */
/* -------------------------------------------------------------------------- */

api.get(
  '/campaigns/blueprints',
  asyncRoute(async (_req, res) => {
    try {
      res.json(await getCampaignBlueprints());
    } catch (error) {
      if (error instanceof BlueprintsUnavailableError) {
        console.error('[campagnes] table illisible :', error.configPath, error.cause);
        throw new AppError(503, error.message, 'BLUEPRINTS_UNAVAILABLE');
      }
      throw error;
    }
  }),
);

/* -------------------------------------------------------------------------- */
/*  Kit de lancement (feuille de route 5.1)                                    */
/* -------------------------------------------------------------------------- */

api.get(
  '/launch-kit/config',
  asyncRoute(async (_req, res) => {
    try {
      res.json(await getLaunchKitConfig());
    } catch (error) {
      if (error instanceof LaunchKitUnavailableError) {
        console.error('[kit de lancement] table illisible :', error.configPath, error.cause);
        throw new AppError(503, error.message, 'LAUNCH_KIT_UNAVAILABLE');
      }
      throw error;
    }
  }),
);

/* -------------------------------------------------------------------------- */
/*  Affiliation via Chariow (Lot 6)                                            */
/* -------------------------------------------------------------------------- */

async function chariowKeyOf(req: Request): Promise<string> {
  const credentials = await resolveChariowCredentials(req.auth);
  if (!credentials) {
    throw new AppError(
      503,
      'Ajoutez votre clé API Chariow dans Mon compte → Connexions pour utiliser l’affiliation.',
      'CHARIOW_NOT_CONNECTED',
    );
  }
  return credentials.apiKey;
}

api.get(
  '/affiliation/chariow/affiliates/:code',
  requireAuth,
  asyncRoute(async (req, res) => {
    const parsed = affiliateCodeSchema.safeParse(req.params.code);
    if (!parsed.success) {
      throw new AppError(400, "Code d'affilié invalide.", 'INVALID_AFFILIATE_CODE');
    }

    res.json(await getChariowAffiliate(await chariowKeyOf(req), parsed.data));
  }),
);

/**
 * Invitations d'affiliés : Chariow envoie de vrais e-mails, immédiatement.
 * Consentement explicite exigé et limiteur strict : cette route ne doit pouvoir
 * être appelée ni par erreur, ni en boucle.
 */
api.post(
  '/affiliation/chariow/invitations',
  requireAuth,
  requireFeature('affiliate_invitations'),
  aiLimiter,
  validateBody(invitationSchema),
  asyncRoute(async (req, res) => {
    const apiKey = await chariowKeyOf(req);
    const { emails } = req.body as z.infer<typeof invitationSchema>;
    res.status(201).json(await sendChariowInvitations(apiKey, emails));
  }),
);

/* -------------------------------------------------------------------------- */
/*  Module 1 — Radar Marché                                                    */
/* -------------------------------------------------------------------------- */

const radarSchema = z.object({
  category: z.string().trim().max(60).optional(),
  customQuery: nicheQuerySchema.optional().or(z.literal('')),
  market: marketSchema.optional(),
});

/**
 * Contrat conservé tel que consommé par le client existant.
 *
 * Tant que l'ingestion Meta Ad Library n'est pas branchée (Lot 2), cette route
 * répond 503 avec un message explicite plutôt qu'un jeu de données inventé.
 * Afficher des chiffres fabriqués comme s'ils venaient du marché contredirait
 * le §9.4 du cahier des charges — c'est précisément ce qui est reproché au
 * concurrent direct.
 */
api.post(
  '/radar-trends',
  requireAuth,
  requireFeature('radar_scan'),
  aiLimiter,
  validateBody(radarSchema),
  asyncRoute(async (_req, _res) => {
    if (!providers.meta) throw providerUnavailable('Meta Ad Library');
    if (!providers.gemini) throw providerUnavailable('Gemini');

    // TODO(Lot 2) : agent SCOUT → ingestion → computeCompetitiveScore → agent ANALYSTE.
    throw new AppError(
      501,
      'Le scan de marché en direct n’est pas encore disponible. Consultez le rapport d’exemple en attendant.',
      'NOT_IMPLEMENTED',
    );
  }),
);

/* -------------------------------------------------------------------------- */
/*  Module 2 — Analyse Stratégique IA                                          */
/* -------------------------------------------------------------------------- */

const analyzeSchema = z.object({
  query: nicheQuerySchema,
  market: marketSchema.optional(),
});

api.post(
  '/analyze-niche',
  requireAuth,
  requireFeature('niche_analysis'),
  aiLimiter,
  validateBody(analyzeSchema),
  asyncRoute(async (_req, _res) => {
    if (!providers.gemini) throw providerUnavailable('Gemini');

    // TODO(Lot 2) : rapport 6 blocs, chaque affirmation portant sa source.
    throw new AppError(
      501,
      'L’analyse en direct n’est pas encore disponible. Consultez le rapport d’exemple en attendant.',
      'NOT_IMPLEMENTED',
    );
  }),
);
