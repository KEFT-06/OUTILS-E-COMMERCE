import { Router } from 'express';
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
import { providers } from '@server/env';
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
import { getActiveAdapter, listAdapters } from '@server/services/ingestion';

export const api = Router();

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
 * Le rapport d'analyse rédigé (agent ANALYSTE) vient plus tard et dépend d'un
 * fournisseur de texte ; cette route, elle, ne dépend que de la source d'ads.
 */
api.post(
  '/ingestion/scan',
  aiLimiter,
  validateBody(ingestionSchema),
  asyncRoute(async (req, res) => {
    const { niche, market, limit } = req.body as z.infer<typeof ingestionSchema>;
    const adapter = getActiveAdapter();

    const availability = adapter.isAvailable();
    if (!availability.available) {
      throw new AppError(503, availability.reason, 'INGESTION_UNAVAILABLE');
    }

    const ingestion = await adapter.fetchAds({
      niche,
      ...(market ? { market } : {}),
      ...(limit ? { limit } : {}),
    });

    const score = computeCompetitiveScore(ingestion.signals, new Date(ingestion.collectedAt));

    res.json({
      score,
      signals: ingestion.signals,
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
  aiLimiter,
  validateBody(radarSchema),
  asyncRoute(async (_req, _res) => {
    if (!providers.meta) throw providerUnavailable('Meta Ad Library');
    if (!providers.gemini) throw providerUnavailable('Gemini');

    // TODO(Lot 2) : agent SCOUT → ingestion → computeCompetitiveScore → agent ANALYSTE.
    throw new AppError(
      501,
      'Le scan de marché en direct arrive au Lot 2. Utilisez les rapports de démonstration en attendant.',
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
  aiLimiter,
  validateBody(analyzeSchema),
  asyncRoute(async (_req, _res) => {
    if (!providers.gemini) throw providerUnavailable('Gemini');

    // TODO(Lot 2) : rapport 6 blocs, chaque affirmation portant sa source.
    throw new AppError(
      501,
      'L’analyse en direct arrive au Lot 2. Utilisez les rapports de démonstration en attendant.',
      'NOT_IMPLEMENTED',
    );
  }),
);
