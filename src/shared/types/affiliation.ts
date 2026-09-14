/** Affiliation via Chariow — Lot 6. Miroir client de `server/services/affiliation`. */

/**
 * Fiche d'un affilié, réduite à ce qui sert au suivi.
 *
 * Chariow renvoie aussi le nom, l'e-mail et le téléphone de l'affilié : le
 * serveur ne les transmet pas. Pseudonyme, pays et statistiques suffisent.
 */
export interface AffiliateSummary {
  code: string;
  status: string;
  pseudo?: string;
  country?: string;
  totalVisits: number;
  totalSales: number;
  /** Libellé formaté fourni par Chariow ; null si absent. */
  totalEarnings: { formatted: string; currency: string } | null;
  firstVisitAt?: string;
  lastVisitAt?: string;
}

export interface InvitationResult {
  sentCount: number;
  /** Adresses ignorées par Chariow : déjà affiliées ou déjà invitées. */
  skippedEmails: string[];
}
