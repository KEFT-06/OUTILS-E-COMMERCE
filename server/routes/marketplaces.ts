import { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError, aiLimiter, asyncRoute, validateBody } from '@server/middleware';
import { requireAuth, requireFeature } from '@server/middleware/auth';
import { affiliateCodeSchema, getChariowAffiliate, invitationSchema, sendChariowInvitations } from '@server/services/affiliation';
import { resolveChariowCredentials } from '@server/services/integrations';
import { type MarketplaceContext, availableMarketplaces, getMarketplace, listMarketplaces } from '@server/services/marketplaces';

/**
 * Boutiques et affiliation : connecteurs marketplace (feuille de route 5.2) et
 * affiliés Chariow (Lot 6). Chaque compte utilise sa propre clé Chariow, jamais
 * celle d'un autre.
 */

export const marketplacesRouter = Router();
export const affiliationRouter = Router();

async function marketplaceContext(req: Request): Promise<MarketplaceContext> {
  const credentials = await resolveChariowCredentials(req.auth);
  return { chariowApiKey: credentials?.apiKey ?? null };
}

/* -------------------------------------------------------------------------- */
/*  Marketplaces                                                               */
/* -------------------------------------------------------------------------- */

/** Connecteurs, disponibilité et capacités déclarées — y compris ceux qui ne peuvent pas exister. */
marketplacesRouter.get(
  '/',
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
marketplacesRouter.get(
  '/sales-summary',
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

marketplacesRouter.get(
  '/:marketplaceId/products',
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
/*  Affiliation via Chariow                                                    */
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

affiliationRouter.get(
  '/affiliates/:code',
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
affiliationRouter.post(
  '/invitations',
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
