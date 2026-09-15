import { providers } from '@server/env';
import type { RequestAuth } from '@server/middleware/auth';
import { creditSummary, effectiveLimits } from '@server/services/accounts';
import { hasSecondFactor, secondFactorMethods } from '@server/services/auth/factors';
import { currencyForCountry, getRates } from '@server/services/currency';
import { integrationsOverview } from '@server/services/integrations';

/**
 * Le compte tel que le navigateur le voit. Liste blanche explicite : aucun champ
 * de la ligne `users` ne part par défaut (empreinte du mot de passe, secret de
 * double authentification, empreinte du code de sécurité…).
 */
export async function accountView(auth: RequestAuth) {
  const { account } = auth;
  const { user, plan } = account;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerification: { verified: Boolean(user.emailVerifiedAt), available: providers.email },
    role: user.role,
    status: user.status,
    /** Null tant que l'utilisateur n'a pas choisi son pays. */
    country: user.country,
    /** Devise d'affichage des prix : celle du pays, ou le dollar à défaut. */
    currency: currencyForCountry(user.country, await getRates()),
    plan: { id: plan.id, label: plan.label },
    planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    credits: creditSummary(account),
    features: account.features,
    limits: effectiveLimits(account),
    permissions: account.permissions,
    isStaff: account.isStaff,
    twoFactor: {
      enabled: hasSecondFactor(user),
      methods: secondFactorMethods(user),
      required: account.isStaff,
      sessionVerified: auth.mfaVerified,
    },
    integrations: await integrationsOverview(user),
    savedNiches: user.savedNiches,
  };
}

export type AccountView = Awaited<ReturnType<typeof accountView>>;
