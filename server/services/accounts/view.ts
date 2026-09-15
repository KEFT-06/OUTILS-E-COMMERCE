import type { RequestAuth } from '@server/middleware/auth';
import { creditSummary } from '@server/services/accounts';
import { integrationsOverview } from '@server/services/integrations';

/**
 * Le compte tel que le navigateur le voit. Liste blanche explicite : aucun champ
 * de la ligne `users` ne part par défaut (empreinte du mot de passe, secret de
 * double authentification…).
 */
export async function accountView(auth: RequestAuth) {
  const { account } = auth;
  const { user, plan } = account;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    plan: { id: plan.id, label: plan.label },
    planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    credits: creditSummary(account),
    features: account.features,
    permissions: account.permissions,
    isStaff: account.isStaff,
    twoFactor: {
      enabled: Boolean(user.twoFactorEnabledAt),
      required: account.isStaff,
      sessionVerified: auth.mfaVerified,
    },
    integrations: await integrationsOverview(user),
    savedNiches: user.savedNiches,
  };
}

export type AccountView = Awaited<ReturnType<typeof accountView>>;
