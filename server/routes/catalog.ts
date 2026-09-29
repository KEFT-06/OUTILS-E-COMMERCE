import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { queryRows } from '@server/db/client';
import { providers } from '@server/env';
import { AppError, asyncRoute } from '@server/middleware';
import { stripeMode } from '@server/services/billing/stripe';
import { BlueprintsUnavailableError, getCampaignBlueprints } from '@server/services/blueprints';
import { getRulesMetadata } from '@server/services/compliance';
import { asComplianceRouteError } from '@server/services/compliance/guard';
import { imagesConfigured } from '@server/services/creatives';
import { CreditConfigUnavailableError, getCostTable } from '@server/services/credits';
import { veoConfigured } from '@server/services/veo';
import { convertAmount, currencyForCountry, getRates, isSupportedCurrency } from '@server/services/currency';
import { LaunchKitUnavailableError, getLaunchKitConfig } from '@server/services/launchKit';
import { FEATURES, PlansUnavailableError, getPlanConfig, planPrice } from '@server/services/plans';
import { PricingUnavailableError, getPricing, pricingIn } from '@server/services/pricing';
import { AD_FRAMEWORKS } from '@server/shared/adFrameworks';
import { findCountry } from '@server/shared/countries';

/**
 * Réponse identique pour tous les visiteurs, gardée par le réseau de l'hébergeur au plus près
 * d'eux. La fonction tourne à Washington et les visiteurs arrivent par Cape Town : chaque appel
 * évité fait gagner une demi-seconde. Réservé aux tables de configuration, jamais à ce qui
 * dépend du compte.
 */
const publicCacheControl = (seconds: number) => `public, max-age=${Math.min(seconds, 60)}, s-maxage=${seconds}, stale-while-revalidate=86400`;
const cachePublic =
  (seconds: number): RequestHandler =>
  (_req, res, next) => {
    res.setHeader('Cache-Control', publicCacheControl(seconds));
    next();
  };

/**
 * Santé du serveur et configuration publique : paliers, coûts, fourchettes de prix,
 * règles de conformité, structures de campagnes et kit de lancement. Lisible sans
 * compte ; aucune clé ni donnée personnelle n'en sort.
 */

export const catalogRouter = Router();

/** Tables de configuration illisibles : 503 explicite plutôt qu'une erreur interne. */
function configRoute<T>(read: (req: Parameters<RequestHandler>[0]) => Promise<T>, unavailable: { error: new (...args: never[]) => Error & { configPath: string }; log: string; code: string }) {
  return asyncRoute(async (req, res) => {
    try {
      res.json(await read(req));
    } catch (error) {
      if (error instanceof unavailable.error) {
        console.error(`[${unavailable.log}] table illisible :`, error.configPath, error.cause);
        throw new AppError(503, error.message, unavailable.code);
      }
      throw error;
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  Santé et capacités                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Santé réelle du serveur, et fournisseurs configurés — sans jamais révéler les clés.
 * Le client s'en sert pour désactiver proprement les fonctions indisponibles plutôt que
 * de laisser l'utilisateur déclencher un échec.
 *
 * La base est interrogée pour de bon, et non déduite de la présence d'une adresse de
 * connexion : un mot de passe changé d'un côté sans l'autre laissait le serveur se
 * déclarer en bonne santé alors que plus personne ne pouvait se connecter. Une panne de
 * base répond 503, ce que n'importe quelle surveillance sait lire.
 */
catalogRouter.get(
  '/health',
  // Trente secondes au réseau de l'hébergeur : chaque écran le lit, et il ne change pas à la seconde.
  cachePublic(30),
  asyncRoute(async (_req, res) => {
    let database = false;
    try {
      await queryRows(sql`select 1`);
      database = true;
    } catch (error) {
      console.error('[santé] base de données injoignable :', error instanceof Error ? error.message : error);
    }

    res.status(database ? 200 : 503).json({
      status: database ? 'ok' : 'degraded',
      database,
      providers: {
        text: providers.gemini,
        /*
          Ces deux indicateurs lisaient encore `providers.higgsfield`, fournisseur abandonné :
          en production, l'écran annonçait vidéos et couvertures indisponibles alors que Veo
          (clé Gemini) et le moteur d'images (Cloudflare ou Gemini) répondaient.
        */
        image: imagesConfigured(),
        video: veoConfigured(),
        storybook: providers.gamma,
        webSearch: providers.webSearch,
        email: providers.email,
        payments: providers.payments,
        googleAuth: providers.googleAuth,
        // Collecte et recherche publicitaires (Apify) : sans elle, l'espionnage ne se remplit pas.
        adLibrary: providers.apify,
      },
      /** test : aucune carte réelle débitée. */
      paymentMode: stripeMode(),
    });
  }),
);

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
catalogRouter.get(
  '/plans',
  asyncRoute(async (req, res) => {
    try {
      const config = await getPlanConfig();
      const rates = await getRates();
      const query = plansQuery.parse(req.query);
      const fromQuery =
        query.currency && isSupportedCurrency(query.currency, rates)
          ? query.currency
          : query.country && findCountry(query.country)
            ? currencyForCountry(query.country, rates)
            : null;
      const currency = fromQuery ?? currencyForCountry(req.auth?.account.user.country, rates);
      // Devise fixée par l'adresse : la réponse est la même pour tous, le réseau de l'hébergeur
      // peut la garder (1,9 s mesurée depuis l'Afrique centrale sur la page d'accueil). Sans
      // devise ni pays, elle dépend du compte connecté et reste hors cache.
      if (fromQuery) res.setHeader('Cache-Control', publicCacheControl(300));

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
/*  Tables de configuration                                                    */
/* -------------------------------------------------------------------------- */

/** Conformité — différenciateur n°2 : les règles appliquées avant tout export. */
catalogRouter.get(
  '/compliance/rules',
  cachePublic(300),
  asyncRoute(async (_req, res) => {
    res.json(await getRulesMetadata().catch(asComplianceRouteError));
  }),
);

/** Crédits — différenciateur n°3 : le coût est annoncé avant l'action. */
catalogRouter.get('/credits/costs', cachePublic(300), configRoute(getCostTable, { error: CreditConfigUnavailableError, log: 'crédits', code: 'CREDIT_CONFIG_UNAVAILABLE' }));

const currencyQuery = z.object({ currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().catch(undefined) });

/**
 * Fourchettes de prix — CdC §2 : jamais figées dans le code. « ?currency=XAF » les rend dans la
 * devise de l'utilisateur : chacun ne voit que celle de son pays.
 */
catalogRouter.get(
  '/pricing/ranges',
  cachePublic(300),
  configRoute(
    async (req) => {
      const config = await getPricing();
      const currency = currencyQuery.parse(req.query).currency;
      if (!currency) return config;
      const rates = await getRates();
      if (!isSupportedCurrency(currency, rates)) return config;
      return pricingIn(config, currency, (amount) => convertAmount(amount, config.currency, currency, rates));
    },
    { error: PricingUnavailableError, log: 'prix', code: 'PRICING_UNAVAILABLE' },
  ),
);

/** Taux de change, identiques pour tous : le navigateur convertit chaque montant dans la devise de l'utilisateur. */
catalogRouter.get(
  '/currency/rates',
  cachePublic(3600),
  asyncRoute(async (_req, res) => {
    const rates = await getRates();
    res.json({ base: rates.base, rates: rates.rates, updatedAt: rates.updatedAt });
  }),
);

/** Structures de campagnes Meta et TikTok (feuille de route 5.4). */
catalogRouter.get(
  '/campaigns/blueprints',
  cachePublic(300),
  configRoute(getCampaignBlueprints, { error: BlueprintsUnavailableError, log: 'campagnes', code: 'BLUEPRINTS_UNAVAILABLE' }),
);

/** Kit de lancement (feuille de route 5.1). */
catalogRouter.get(
  '/launch-kit/config',
  cachePublic(300),
  configRoute(getLaunchKitConfig, { error: LaunchKitUnavailableError, log: 'kit de lancement', code: 'LAUNCH_KIT_UNAVAILABLE' }),
);
