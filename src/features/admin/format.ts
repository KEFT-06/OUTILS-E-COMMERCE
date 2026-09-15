import { formatMoney } from '@server/shared/currency';
import type { Granularity } from '@/features/admin/adminApi';
import { formatDateFr } from '@/shared/lib/formatDate';
import { formatFcfa } from '@/shared/lib/plans';

/** « 15 sept. », « sept. 26 » ou « 2026 » selon la granularité. Les périodes arrivent déjà dans le fuseau de reporting. */
export function formatPeriod(period: string, granularity: Granularity): string {
  const [year, month, day] = period.split('-').map(Number);
  if (granularity === 'year' || !year) return period;
  if (granularity === 'month') {
    return new Date(Date.UTC(year, (month ?? 1) - 1, 1)).toLocaleDateString('fr-FR', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  }
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Évolution en pourcentage, ou null quand la base de comparaison est nulle. */
export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const ROLE_LABELS: Record<string, string> = { user: 'Utilisateur', admin: 'Administrateur' };

/** Résumé lisible des détails d'une ligne du journal d'audit. */
export function describeAuditDetails(
  action: string,
  details: Record<string, unknown> | null,
  labels: { plans?: Record<string, string>; permissions?: Record<string, string> } = {},
): string {
  if (!details) return '';
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  const plan = (value: unknown) => labels.plans?.[text(value)] ?? text(value);
  const permission = (value: unknown) => labels.permissions?.[text(value)] ?? text(value);

  switch (action) {
    case 'credits.granted':
    case 'credits.removed': {
      const applied = Number(details.applied);
      return `${applied > 0 ? '+' : ''}${applied} pts · solde ${text(details.balance)}${details.note ? ` · ${text(details.note)}` : ''}`;
    }
    case 'credits.plan_refilled':
      return text(details.note);
    case 'user.plan_changed':
      return `${plan(details.from)} → ${plan(details.to)}${details.expiresAt ? ` jusqu’au ${formatDateFr(text(details.expiresAt))}` : ''}${details.note ? ` · ${text(details.note)}` : ''}`;
    case 'user.created':
      return `palier ${plan(details.plan)}`;
    case 'user.suspended':
      return text(details.reason);
    case 'payment.recorded':
      return `${details.currency && details.currency !== 'XAF' ? `${formatMoney(Number(details.amount), text(details.currency))} (≈ ${formatFcfa(Number(details.amountFcfa))})` : formatFcfa(Number(details.amountFcfa))} · ${plan(details.plan)} · ${text(details.periodMonths)} mois`;
    case 'payment.refunded':
      return `${formatFcfa(Number(details.amountFcfa))}${details.note ? ` · ${text(details.note)}` : ''}`;
    case 'permissions.updated': {
      const added = Array.isArray(details.added) ? details.added.map((item) => `+ ${permission(item)}`) : [];
      const removed = Array.isArray(details.removed) ? details.removed.map((item) => `− ${permission(item)}`) : [];
      return [...added, ...removed].join(' · ');
    }
    case 'role.changed':
      return `${ROLE_LABELS[text(details.from)] ?? text(details.from)} → ${ROLE_LABELS[text(details.to)] ?? text(details.to)}`;
    case 'feature.granted':
    case 'feature.revoked':
    case 'feature.reset':
      return text(details.label ?? details.feature);
    case 'sessions.revoked':
      return `${text(details.sessions)} session(s)`;
    case 'password.link_created':
      return details.purpose === 'setup' ? 'création du mot de passe' : 'réinitialisation';
    case 'security.unlocked':
      return text(details.key);
    default:
      return '';
  }
}

/** Montant d'un paiement : dans sa devise, avec son équivalent en francs CFA quand elle diffère. */
export function formatPaymentAmount(payment: { amount: number; currency: string; amountFcfa: number }): string {
  return payment.currency === 'XAF'
    ? formatFcfa(payment.amountFcfa)
    : `${formatMoney(payment.amount, payment.currency)} (≈ ${formatFcfa(payment.amountFcfa)})`;
}
