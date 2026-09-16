import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  AppError,
  aiLimiter,
  asyncRoute,
  providerUnavailable,
  validateBody,
} from '@server/middleware';
import { authenticate, requireAuth, requireFeature } from '@server/middleware/auth';
import { providers } from '@server/env';
import { accountRouter } from '@server/routes/account';
import { adminRouter } from '@server/routes/admin';
import { authRouter } from '@server/routes/auth';
import { coversRouter, guidesRouter, reviewsRouter } from '@server/routes/guides';
import { billingRouter } from '@server/routes/billing';
import { publicRouter } from '@server/routes/public';
import { reportsRouter } from '@server/routes/reports';
import { workspaceRouter } from '@server/routes/workspace';
import { writingRouter } from '@server/routes/writing';
import { type AnalysisRequest, analysisRequestSchema, analyzeNiche } from '@server/services/analysis';
import {
  ComplianceUnavailableError,
  checkText,
  getRulesMetadata,
} from '@server/services/compliance';
import { CreditConfigUnavailableError, getCostTable } from '@server/services/credits';
import { PricingUnavailableError, getPricing } from '@server/services/pricing';
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
import { effectiveLimits } from '@server/services/accounts';
import { stripeMode } from '@server/services/billing/stripe';
import { currencyForCountry, getRates, isSupportedCurrency } from '@server/services/currency';
import { FEATURES, PlansUnavailableError, getPlanConfig, planPrice } from '@server/services/plans';
import { AD_FRAMEWORKS, findAdFramework, isAdFrameworkAvailable } from '@server/shared/adFrameworks';
import { findCountry } from '@server/shared/countries';

export const api = Router();

// Attache le compte de la session à chaque requête ; les refus se font route par route.
api.use(authenticate);

api.use('/auth', authRouter);
api.use('/account', accountRouter);
api.use('/admin', adminRouter);
api.use('/guides', guidesRouter);
api.use('/covers', coversRouter);
api.use('/reviews', reviewsRouter);
api.use('/reports', reportsRouter);
api.use('/workspace', workspaceRouter);
api.use('/writing', writingRouter);
api.use('/billing', billingRouter);
api.use(publicRouter);

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
    providers: {
      text: providers.gemini,
      video: providers.higgsfield,
      storybook: providers.gamma,
      webSearch: providers.webSearch,
      email: providers.email,
      payments: providers.payments,
    },
    /** test : aucune carte réelle débitée. */
    paymentMode: stripeMode(),
  });
});

/* -------------------------------------------------------------------------- */
/*  Paliers d'abonnement                                                       */
/* -------------------------------------------------------------------------- */

const plansQuery = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().catch(undefined),
  country: z.string().trim().toUpperCase().optional().catch(undefined),
});

/**
 * Paliers, avec leur prix dans la devise demandée : devise explicite, sinon celle
 * du pays indiqué, sinon celle du compte connecté, sinon le dollar.
 */
api.get(
  '/plans',
  asyncRoute(async (req, res) => {
    try {
      const config = await getPlanConfig();
      const rates = await getRates();
      const query = plansQuery.parse(req.query);
      const currency =
        query.currency && isSupportedCurrency(query.currency, rates)
          ? query.currency
          : query.country && findCountry(query.country)
            ? currencyForCountry(query.country, rates)
            : currencyForCountry(req.auth?.account.user.country, rates);

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        version: config.version,
        updatedAt: config.updatedAt,
        currency,
        pricing: {
          status: config.pricing.status ?? null,
          yearlyMonthsCharged: config.pricing.yearlyMonthsCharged,
          ratesUpdatedAt: rates.updatedAt,
          ratesSource: rates.source,
        },
        features: FEATURES,
        adFrameworksTotal: AD_FRAMEWORKS.length,
        plans: config.plans.map((plan) => ({
          id: plan.id,
          label: plan.label,
          tagline: plan.tagline ?? null,
          monthlyCredits: plan.monthlyCredits,
          highlight: plan.highlight ?? false,
          limits: plan.limits,
          features: plan.features,
          price: planPrice(plan, config, currency, rates),
        })),
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

/** Une méthode publicitaire hors du palier est refusée par le serveur, pas seulement grisée à l'écran. */
function assertFrameworkAllowed(req: Request, brief: VisualBrief | VideoBrief): void {
  if (brief.purpose !== 'ad' || !brief.adFramework) return;
  const { account } = req.auth!;
  if (isAdFrameworkAvailable(brief.adFramework, effectiveLimits(account).adFrameworks)) return;
  const framework = findAdFramework(brief.adFramework);
  throw new AppError(
    403,
    `La méthode ${framework?.acronym ?? brief.adFramework} n’est pas incluse dans votre palier ${account.plan.label}. Choisissez une autre méthode, ou passez à un palier supérieur.`,
    'FRAMEWORK_LOCKED',
    { framework: brief.adFramework },
  );
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
    assertFrameworkAllowed(req, brief);
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
    assertFrameworkAllowed(req, brief);
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
/*  Module 2 — Analyse Stratégique IA                                          */
/* -------------------------------------------------------------------------- */

/**
 * Analyse d'une niche : faits de marché sourcés, propositions de l'IA dites comme
 * telles, rapport conservé sur le compte (server/services/analysis).
 */
api.post(
  '/analyze-niche',
  requireAuth,
  requireFeature('niche_analysis'),
  aiLimiter,
  validateBody(analysisRequestSchema),
  asyncRoute(async (req, res) => {
    res.status(201).json(await analyzeNiche(req.auth!, req.body as AnalysisRequest));
  }),
);
