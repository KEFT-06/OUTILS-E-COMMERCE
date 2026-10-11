import { apiRequest } from '@/shared/lib/api';
import type { PlanId } from '@/shared/types/auth';

/** Miroir client de `server/services/billing/mobile.ts` et de la route `/api/billing/methods`. */

export interface MobileOperator {
  slug: string;
  name: string;
  /** L'opérateur exige un code, obtenu en composant `ussdCode` sur le téléphone. */
  otpRequired: boolean;
  ussdCode: string | null;
}

export interface PaymentMethods {
  card: { available: boolean; mode: 'test' | 'live' | null };
  mobile: {
    available: boolean;
    mode: 'test' | 'live' | null;
    country: string | null;
    countryName: string | null;
    currency: string | null;
    /** Indicatif du pays, en chiffres. */
    prefix: string | null;
    operators: MobileOperator[];
    amount: number | null;
    amountLabel: string | null;
  };
}

export type PaymentPeriod = 'month' | 'year';

export type MobilePaymentStatus = 'paid' | 'pending' | 'expired' | 'failed';

export interface MobileCheckoutStart {
  reference: string;
  status: MobilePaymentStatus;
  expiresAt: string | null;
  providerLink: string | null;
  operator: string;
  amountLabel: string;
  phoneHint: string;
}

export const billingApi = {
  /** Ce que ce compte peut utiliser pour payer ; avec un palier et une durée, le montant en Mobile Money. */
  methods: (quote?: { plan: PlanId; period: PaymentPeriod }) =>
    apiRequest<PaymentMethods>(`/api/billing/methods${quote ? `?plan=${encodeURIComponent(quote.plan)}&period=${quote.period}` : ''}`),
  card: (plan: PlanId, period: PaymentPeriod) => apiRequest<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { plan, period } }),
  mobile: (body: { plan: PlanId; period: PaymentPeriod; operator: string; phone: string; otpCode?: string }) =>
    apiRequest<MobileCheckoutStart>('/api/billing/mobile/checkout', { method: 'POST', body }),
  mobileStatus: (reference: string) =>
    apiRequest<{ status: MobilePaymentStatus; expiresAt: string | null }>(`/api/billing/mobile/${encodeURIComponent(reference)}`),
  /** Reprend les paiements Mobile Money validés après que l'écran a été quitté. */
  resume: () => apiRequest<{ activated: number }>('/api/billing/mobile/resume', { method: 'POST' }),
};

/**
 * Couleurs d'un opérateur, pour le reconnaître d'un coup d'œil dans la liste. Ce sont des
 * pastilles de texte, pas des logos : rien n'est copié de l'identité d'une marque.
 */
const OPERATOR_TONES: [RegExp, string][] = [
  [/mtn/, 'bg-[#FFCB05] text-neutral-900'],
  [/orange/, 'bg-[#FF7900] text-white'],
  [/moov/, 'bg-[#0B5AA6] text-white'],
  [/wav/, 'bg-[#1DC8FF] text-neutral-900'],
  [/airtel/, 'bg-[#E40000] text-white'],
  [/free|tigo|yas/, 'bg-[#CD1E25] text-white'],
  [/celtiis|sbin/, 'bg-[#00843D] text-white'],
];

export function operatorTone(slug: string): string {
  return OPERATOR_TONES.find(([pattern]) => pattern.test(slug.toLowerCase()))?.[1] ?? 'bg-muted text-foreground';
}

/** Le numéro tel qu'on le relit avant de payer : indicatif, puis le reste par groupes de deux ou trois chiffres. */
export function readablePhone(input: string, prefix: string | null): string {
  const digits = input.replace(/\D/g, '');
  if (!digits) return '';
  const local = prefix && digits.startsWith(prefix) && digits.length > prefix.length + 6 ? digits.slice(prefix.length) : digits;
  const groups = local.length % 2 === 1 ? [local.slice(0, 3), ...(local.slice(3).match(/.{1,2}/g) ?? [])] : (local.match(/.{1,2}/g) ?? []);
  return `${prefix ? `+${prefix} ` : ''}${groups.join(' ')}`;
}
