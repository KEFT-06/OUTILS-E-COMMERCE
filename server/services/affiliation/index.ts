import { z } from 'zod';
import { AppError } from '@server/middleware';
import { chariowRequest } from '@server/services/marketplaces/chariow';

/**
 * Affiliation via Chariow — Lot 6.
 *
 * ⚠️ Écrit d'après la documentation publique (chariow.dev), consultée le
 * 14 septembre 2026, et NON vérifié contre l'API réelle faute de clé.
 *
 * Ce que l'API permet : consulter un affilié par son code, et inviter jusqu'à 25
 * adresses par envoi. Elle ne permet ni de lister les affiliés, ni de gérer les
 * commissions : Smart Creator ne prétend donc pas les calculer.
 *
 * Données personnelles : la fiche Chariow d'un affilié contient son nom, son
 * e-mail et son téléphone. Rien de cela ne sort du serveur ; pseudonyme, pays et
 * statistiques suffisent au suivi.
 *
 * Montants : l'exemple documenté montre `1250` pour « $1,250.00 ». Plutôt que de
 * réinterpréter `value`, on transmet le libellé formaté fourni par Chariow.
 */

export const affiliateCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Code d'affilié invalide.");

export const invitationSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().email()).min(1).max(25),
  /** Consentement déclaré par le vendeur : l'envoi part vers de vraies boîtes. */
  consent: z.literal(true),
});

export interface AffiliateSummary {
  code: string;
  status: string;
  pseudo?: string;
  country?: string;
  totalVisits: number;
  totalSales: number;
  totalEarnings: { formatted: string; currency: string } | null;
  firstVisitAt?: string;
  lastVisitAt?: string;
}

export interface InvitationResult {
  sentCount: number;
  skippedEmails: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Enveloppe documentée `{ message, data, errors }` ; on accepte aussi l'objet nu. */
function unwrap(payload: unknown): unknown {
  return isRecord(payload) && 'data' in payload ? payload.data : payload;
}

const affiliateSchema = z.object({
  status: z.string(),
  total_visits: z.number().optional(),
  total_sales: z.number().optional(),
  total_earnings: z
    .object({ formatted: z.string().optional(), currency: z.string().optional() })
    .nullable()
    .optional(),
  first_visit_at: z.string().nullable().optional(),
  last_visit_at: z.string().nullable().optional(),
  account: z
    .object({ pseudo: z.string().nullable().optional(), country: z.unknown().optional() })
    .nullable()
    .optional(),
});

function countryLabel(country: unknown): string | undefined {
  if (typeof country === 'string') return country;
  if (isRecord(country)) {
    const label = country.name ?? country.label ?? country.code;
    return typeof label === 'string' ? label : undefined;
  }
  return undefined;
}

export async function getChariowAffiliate(apiKey: string, code: string): Promise<AffiliateSummary> {
  const payload = await chariowRequest(apiKey, `/affiliates/${encodeURIComponent(code)}`).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) {
      throw new AppError(404, 'Aucun affilié ne correspond à ce code chez Chariow.', 'AFFILIATE_NOT_FOUND');
    }
    throw error;
  });

  const parsed = affiliateSchema.safeParse(unwrap(payload));
  if (!parsed.success) {
    throw new AppError(502, 'Réponse inattendue de Chariow.', 'CHARIOW_UNEXPECTED_RESPONSE');
  }

  const affiliate = parsed.data;
  const pseudo = affiliate.account?.pseudo;
  const country = countryLabel(affiliate.account?.country);
  const earnings = affiliate.total_earnings;

  return {
    code,
    status: affiliate.status,
    ...(pseudo ? { pseudo } : {}),
    ...(country ? { country } : {}),
    totalVisits: affiliate.total_visits ?? 0,
    totalSales: affiliate.total_sales ?? 0,
    totalEarnings: earnings?.formatted
      ? { formatted: earnings.formatted, currency: earnings.currency ?? '' }
      : null,
    ...(affiliate.first_visit_at ? { firstVisitAt: affiliate.first_visit_at } : {}),
    ...(affiliate.last_visit_at ? { lastVisitAt: affiliate.last_visit_at } : {}),
  };
}

/** Rassemble les adresses e-mail présentes dans une structure de forme non garantie. */
function collectEmails(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.includes('@')) found.add(value.toLowerCase());
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectEmails(item, found));
  } else if (isRecord(value)) {
    Object.values(value).forEach((item) => collectEmails(item, found));
  }
  return found;
}

/**
 * Envoie les invitations. Chariow expédie les e-mails immédiatement.
 *
 * La réponse documentée liste les invitations créées et un objet « skipped »
 * (adresses déjà affiliées ou déjà invitées). On compte ce qui est
 * reconnaissable sans supposer davantage sur sa forme exacte.
 */
export async function sendChariowInvitations(apiKey: string, emails: string[]): Promise<InvitationResult> {
  const unique = [...new Set(emails)];
  const body = unwrap(
    await chariowRequest(apiKey, '/affiliates/invitations', { method: 'POST', body: { emails: unique } }),
  );

  const invitations = isRecord(body) && Array.isArray(body.invitations) ? body.invitations : Array.isArray(body) ? body : [];
  const skipped = isRecord(body) ? body.skipped : undefined;

  return {
    sentCount: invitations.length,
    skippedEmails: [...collectEmails(skipped)],
  };
}
