import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { users, watchEvents, watches } from '@server/db/schema';
import { env, providers } from '@server/env';
import { sendEmail } from '@server/services/email';
import { radarDigestEmail } from '@server/services/email/templates';

/**
 * Résumé du radar envoyé par e-mail.
 *
 * C'est la pièce sans laquelle tout le reste ne sert à rien : le radar relève chaque nuit,
 * mais un utilisateur qui n'ouvre pas le site n'apprend rien. L'envoi est donc la seule
 * action que ce produit déclenche vers l'extérieur sans qu'on ait cliqué.
 *
 * Quatre garde-fous, parce qu'un e-mail automatique mal réglé se transforme vite en
 * courrier indésirable :
 *
 *  1. Un seul résumé par compte et par période (MIN_INTERVAL_HOURS).
 *  2. Rien à dire, rien d'envoyé. Un e-mail « aucun changement » ferait fuir.
 *  3. Adresse confirmée uniquement : écrire à une adresse non vérifiée abîme la
 *     réputation du domaine expéditeur pour tous les autres messages du site.
 *  4. Désactivable en un clic (`users.radarAlertsEnabled`), et le pied de page le dit.
 */

/** Adresse de l'écran Radar. Le serveur ne lit pas la carte des modules du navigateur. */
const ECRAN_RADAR = '/app/radar';

/** Heures au moins entre deux résumés pour un même compte. */
const MIN_INTERVAL_HOURS = 20;
/** Événements détaillés dans le corps du message ; le reste est compté. */
const MAX_LINES = 8;
/** Comptes traités par tour, pour ne pas bloquer le balayage sur un gros envoi. */
const BATCH_SIZE = 50;

const dateFr = (date: Date) =>
  date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: env.REPORTING_TIMEZONE });

export interface DigestOutcome {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Envoie les résumés dus. Appelée par le balayeur, après les relevés : les événements du
 * jour sont donc déjà écrits quand on compose le message.
 */
export async function sendDueRadarDigests(now = new Date()): Promise<DigestOutcome> {
  const outcome: DigestOutcome = { considered: 0, sent: 0, skipped: 0, failed: 0 };
  if (!providers.email) return outcome;

  const seuil = new Date(now.getTime() - MIN_INTERVAL_HOURS * 3_600_000);

  // Comptes qui surveillent au moins une boutique, veulent les résumés, ont confirmé leur
  // adresse, et n'en ont pas reçu récemment.
  const candidats = await getDb()
    .selectDistinct({
      id: users.id,
      email: users.email,
      name: users.name,
      radarAlertedAt: users.radarAlertedAt,
    })
    .from(users)
    .innerJoin(watches, eq(watches.userId, users.id))
    .where(
      and(
        eq(users.radarAlertsEnabled, true),
        eq(users.status, 'active'),
        isNotNull(users.emailVerifiedAt),
        eq(watches.active, true),
      ),
    )
    .orderBy(asc(users.id))
    .limit(BATCH_SIZE);

  for (const candidat of candidats) {
    if (candidat.radarAlertedAt !== null && candidat.radarAlertedAt > seuil) {
      outcome.skipped += 1;
      continue;
    }
    outcome.considered += 1;

    // Depuis le dernier résumé ; au premier envoi, les sept derniers jours — au-delà, on
    // raconterait une histoire que l'utilisateur a déjà lue à l'écran.
    const depuis = candidat.radarAlertedAt ?? new Date(now.getTime() - 7 * 86_400_000);

    const siennes = getDb().select({ id: watches.id }).from(watches).where(eq(watches.userId, candidat.id));
    const evenements = await getDb()
      .select({ summary: watchEvents.summary })
      .from(watchEvents)
      .where(and(inArray(watchEvents.watchId, siennes), gt(watchEvents.occurredAt, depuis)))
      .orderBy(asc(watchEvents.occurredAt));

    if (evenements.length === 0) {
      outcome.skipped += 1;
      continue;
    }

    try {
      await sendEmail(
        radarDigestEmail(
          { email: candidat.email, name: candidat.name },
          {
            lines: evenements.slice(0, MAX_LINES).map((row) => row.summary),
            total: evenements.length,
            since: dateFr(depuis),
            url: `${env.APP_URL.replace(/\/+$/, '')}${ECRAN_RADAR}`,
          },
        ),
      );
      outcome.sent += 1;
    } catch (error) {
      // Un envoi raté ne doit pas faire perdre la période : on n'avance pas la date, le
      // prochain tour réessaiera avec les mêmes événements.
      outcome.failed += 1;
      console.warn('[radar] résumé non envoyé :', error instanceof Error ? error.message : error);
      continue;
    }

    await getDb().update(users).set({ radarAlertedAt: now }).where(eq(users.id, candidat.id));
  }

  return outcome;
}
