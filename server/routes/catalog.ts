import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { queryRows } from '@server/db/client';
import { providers } from '@server/env';
import { AppError, asyncRoute } from '@server/middleware';
import { stripeMode } from '@server/services/billing/stripe';
import { BlueprintsUnavailableError, getCampaignBlueprints } from '@server/services/blueprints';
import { getRulesMetadata } from '@server/services/compliance';
import { asComplianceRouteError } from '@server/services/compliance/guard';
import { CreditConfigUnavailableError, getCostTable } from '@server/services/credits';
import { currencyForCountry, getRates, isSupportedCurrency } from '@server/services/currency';
import { LaunchKitUnavailableError, getLaunchKitConfig } from '@server/services/launchKit';
import { FEATURES, PlansUnavailableError, getPlanConfig, planPrice } from '@server/services/plans';
import { PricingUnavailableError, getPricing } from '@server/services/pricing';
import { AD_FRAMEWORKS } from '@server/shared/adFrameworks';
import { findCountry } from '@server/shared/countries';

/**
 * Santé du serveur et configuration publique : paliers, coûts, fourchettes de prix,
 * règles de conformité, structures de campagnes et kit de lancement. Lisible sans
 * compte ; aucune clé ni donnée personnelle n'en sort.
 */

export const catalogRouter = Router();

/** Tables de configuration illisibles : 503 explicite plutôt qu'une erreur interne. */
function configRoute<T>(read: () => Promise<T>, unavailable: { error: new (...args: never[]) => Error & { configPath: string }; log: string; code: string }) {
  return asyncRoute(async (_req, res) => {
    try {
      res.json(await read());
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
        video: providers.higgsfield,
        storybook: providers.gamma,
        webSearch: providers.webSearch,
        email: providers.email,
        payments: providers.payments,
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
      const currency =
        query.currency && isSupportedCurrency(query.currency, rates)
          ? query.currency
          : query.country && findCountry(query.country)
            ? currencyForCountry(query.country, rates)
            : currencyForCountry(req.auth?.account.user.country, rates);

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
  asyncRoute(async (_req, res) => {
    res.json(await getRulesMetadata().catch(asComplianceRouteError));
  }),
);

/** Crédits — différenciateur n°3 : le coût est annoncé avant l'action. */
catalogRouter.get('/credits/costs', configRoute(getCostTable, { error: CreditConfigUnavailableError, log: 'crédits', code: 'CREDIT_CONFIG_UNAVAILABLE' }));

/** Fourchettes de prix — CdC §2 : jamais figées dans le code. */
catalogRouter.get('/pricing/ranges', configRoute(getPricing, { error: PricingUnavailableError, log: 'prix', code: 'PRICING_UNAVAILABLE' }));

/** Structures de campagnes Meta et TikTok (feuille de route 5.4). */
catalogRouter.get(
  '/campaigns/blueprints',
  configRoute(getCampaignBlueprints, { error: BlueprintsUnavailableError, log: 'campagnes', code: 'BLUEPRINTS_UNAVAILABLE' }),
);

/** Kit de lancement (feuille de route 5.1). */
catalogRouter.get(
  '/launch-kit/config',
  configRoute(getLaunchKitConfig, { error: LaunchKitUnavailableError, log: 'kit de lancement', code: 'LAUNCH_KIT_UNAVAILABLE' }),
);
