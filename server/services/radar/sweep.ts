import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { watchEvents, watchItems, watches, type WatchEventKind, type WatchItemRow, type WatchRow } from '@server/db/schema';
import { AppError } from '@server/middleware';
import { sourceFor } from '@server/services/radar/sources';
import type { RadarObservation } from '@server/services/radar/types';

/**
 * Moteur de comparaison : le cœur du radar.
 *
 * Un relevé seul n'apprend rien que la page ne montre déjà. Toute la valeur vient de la
 * comparaison entre deux passages, et c'est ce fichier qui la fait :
 *
 *   article inconnu            → il vient d'apparaître          (appeared)
 *   article connu, absent      → il vient de s'arrêter          (disappeared, avec sa durée)
 *   prix différent             → changement de prix             (price_changed)
 *   ventes en forte hausse     → quelque chose marche           (sales_jump)
 *
 * Aucune ligne par jour : chaque article a une seule ligne, dont `lastSeenAt` avance. La
 * durée de suivi est une soustraction, et la table ne grossit qu'avec le catalogue.
 */

/**
 * Ventes gagnées entre deux passages à partir desquelles on parle d'accélération.
 * Trois : sur les boutiques observées, les compteurs se comptent en unités et en
 * dizaines — à un seuil de 1, chaque vente ferait une alerte et l'écran serait illisible.
 */
const SALES_JUMP_MIN = 3;

export interface SweepOutcome {
  observed: number;
  appeared: number;
  disappeared: number;
  priceChanged: number;
  salesJumps: number;
}

/** Nombre de jours entiers entre deux instants, au minimum zéro. */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

const money = (value: number | null, currency: string | null) =>
  value === null ? 'prix non affiché' : `${value.toLocaleString('fr-FR')} ${currency ?? ''}`.trim();

/**
 * Compare un relevé à ce que la base connaît déjà, et écrit articles et événements.
 * Tout se joue dans une transaction : un balayage à moitié écrit laisserait de faux
 * « disparus » et une durée de vie fausse pour toujours.
 */
export async function applyObservations(
  watch: Pick<WatchRow, 'id'>,
  observations: RadarObservation[],
  now = new Date(),
): Promise<SweepOutcome> {
  const outcome: SweepOutcome = { observed: observations.length, appeared: 0, disappeared: 0, priceChanged: 0, salesJumps: 0 };

  await getDb().transaction(async (tx) => {
    const known = await tx.select().from(watchItems).where(eq(watchItems.watchId, watch.id));
    const byExternalId = new Map<string, WatchItemRow>(known.map((item) => [item.externalId, item]));

    type NewEvent = { kind: WatchEventKind; summary: string; payload: Record<string, unknown>; itemId: string | null };
    const events: NewEvent[] = [];

    for (const observation of observations) {
      const previous = byExternalId.get(observation.externalId);

      if (!previous) {
        const [inserted] = await tx
          .insert(watchItems)
          .values({
            watchId: watch.id,
            externalId: observation.externalId,
            name: observation.name,
            kind: observation.kind,
            priceValue: observation.priceValue,
            currency: observation.currency,
            salesCount: observation.salesCount,
            // Point de départ figé : tout ce qui s'ajoutera ensuite a été vendu sous nos yeux.
            salesAtFirstSeen: observation.salesCount,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .returning({ id: watchItems.id });
        outcome.appeared += 1;
        events.push({
          kind: 'appeared',
          itemId: inserted?.id ?? null,
          summary: `Nouveau produit : « ${observation.name} » à ${money(observation.priceValue, observation.currency)}.`,
          payload: { name: observation.name, price: observation.priceValue, currency: observation.currency },
        });
        continue;
      }

      // Article revenu après un arrêt : on relève sa réapparition plutôt que d'ouvrir
      // une seconde ligne, sinon son historique serait coupé en deux.
      const revenu = previous.endedAt !== null;

      /*
        Trois façons dont un prix change, et elles ne se disent pas de la même manière.

        Seule la première se remarquait. Les deux autres réécrivaient la ligne en silence :
        la surveillance affichait le nouveau prix sans que rien n'ait signalé le changement,
        et c'est précisément ce qu'un radar existe pour attraper. Un concurrent qui retire son
        prix de sa vitrine vient de changer de stratégie de vente, pas de décor.
      */
      if (previous.priceValue !== null && observation.priceValue !== null) {
        if (previous.currency !== observation.currency) {
          // Devise différente : les deux montants ne se comparent pas. Ne pas dire « augmenté »
          // pour 5 000 XOF devenus 5 000 XAF — ce serait inventer une hausse qui n'existe pas.
          outcome.priceChanged += 1;
          events.push({
            kind: 'price_changed',
            itemId: previous.id,
            summary: `Devise changée sur « ${previous.name} » : ${money(previous.priceValue, previous.currency)} → ${money(observation.priceValue, observation.currency)}. Les deux montants ne se comparent pas directement.`,
            payload: {
              from: previous.priceValue,
              to: observation.priceValue,
              fromCurrency: previous.currency,
              currency: observation.currency,
              currencyChanged: true,
            },
          });
        } else if (previous.priceValue !== observation.priceValue) {
          const sens = observation.priceValue > previous.priceValue ? 'augmenté' : 'baissé';
          outcome.priceChanged += 1;
          events.push({
            kind: 'price_changed',
            itemId: previous.id,
            summary: `Prix ${sens} sur « ${previous.name} » : ${money(previous.priceValue, previous.currency)} → ${money(observation.priceValue, observation.currency)}.`,
            payload: { from: previous.priceValue, to: observation.priceValue, currency: observation.currency },
          });
        }
      } else if (previous.priceValue !== null && observation.priceValue === null) {
        // Le prix a disparu de la vitrine : passage en « nous contacter », en offre groupée
        // ou en produit suspendu. C'est un signal fort, et il ne s'inscrivait nulle part.
        outcome.priceChanged += 1;
        events.push({
          kind: 'price_changed',
          itemId: previous.id,
          summary: `Prix retiré de la vitrine sur « ${previous.name} » : il affichait ${money(previous.priceValue, previous.currency)}.`,
          payload: { from: previous.priceValue, to: null, currency: previous.currency },
        });
      } else if (previous.priceValue === null && observation.priceValue !== null) {
        outcome.priceChanged += 1;
        events.push({
          kind: 'price_changed',
          itemId: previous.id,
          summary: `Prix affiché sur « ${previous.name} » : ${money(observation.priceValue, observation.currency)}.`,
          payload: { from: null, to: observation.priceValue, currency: observation.currency },
        });
      }

      if (previous.salesCount !== null && observation.salesCount !== null) {
        const gagnees = observation.salesCount - previous.salesCount;
        // Un compteur qui recule (produit remis à zéro, remboursements) n'est pas un signal.
        if (gagnees >= SALES_JUMP_MIN || (gagnees > 0 && previous.salesCount === 0)) {
          outcome.salesJumps += 1;
          events.push({
            kind: 'sales_jump',
            itemId: previous.id,
            summary:
              previous.salesCount === 0
                ? `Première vente sur « ${previous.name} » : le produit décolle.`
                : `${gagnees} ventes de plus sur « ${previous.name} » (total ${observation.salesCount}).`,
            payload: { gained: gagnees, total: observation.salesCount, since: previous.lastSeenAt.toISOString() },
          });
        }
      }

      await tx
        .update(watchItems)
        .set({
          name: observation.name,
          kind: observation.kind,
          priceValue: observation.priceValue,
          currency: observation.currency,
          salesCount: observation.salesCount,
          lastSeenAt: now,
          endedAt: null,
        })
        .where(eq(watchItems.id, previous.id));

      if (revenu) {
        events.push({
          kind: 'appeared',
          itemId: previous.id,
          summary: `« ${previous.name} » est de retour en vente.`,
          payload: { name: previous.name, returned: true },
        });
        outcome.appeared += 1;
      }
    }

    // Ce qui était en vente au passage précédent et ne l'est plus : sa date d'arrêt.
    const vus = new Set(observations.map((observation) => observation.externalId));
    const partis = known.filter((item) => item.endedAt === null && !vus.has(item.externalId));

    /*
      Une seule écriture pour tous les articles retirés, au lieu d'une par article.

      Le catalogue entier d'une boutique peut disparaître d'un coup — compte fermé, vitrine
      en maintenance, changement de domaine. C'est précisément le jour où la boucle aurait
      tenu la transaction ouverte pendant des centaines d'allers-retours, en bloquant la
      table pour les autres relevés.
    */
    if (partis.length > 0) {
      await tx
        .update(watchItems)
        .set({ endedAt: now })
        .where(
          inArray(
            watchItems.id,
            partis.map((item) => item.id),
          ),
        );
    }

    for (const item of partis) {
      outcome.disappeared += 1;
      const jours = daysBetween(item.firstSeenAt, now);
      events.push({
        kind: 'disappeared',
        itemId: item.id,
        // « suivi pendant » et non « a vécu » : le radar ne connaît l'article que depuis
        // son premier passage, pas depuis sa mise en ligne réelle.
        summary: `« ${item.name} » n'est plus en vente, après ${jours} jour${jours > 1 ? 's' : ''} de suivi.`,
        payload: { trackedDays: jours, firstSeenAt: item.firstSeenAt.toISOString(), sales: item.salesCount },
      });
    }

    if (events.length > 0) {
      await tx.insert(watchEvents).values(
        events.map((event) => ({
          watchId: watch.id,
          itemId: event.itemId,
          kind: event.kind,
          summary: event.summary,
          payload: event.payload,
          occurredAt: now,
        })),
      );
    }

    await tx
      .update(watches)
      .set({ lastSweptAt: now, lastError: null, failureCount: 0 })
      .where(eq(watches.id, watch.id));
  });

  return outcome;
}

/** Échecs consécutifs avant mise en pause : la source est cassée ou la boutique a fermé. */
const MAX_FAILURES = 5;

/**
 * Relève une surveillance et applique le résultat. Un échec est inscrit sur la
 * surveillance — un radar silencieux doit pouvoir dire pourquoi il ne voit rien.
 */
export async function sweepWatch(watch: WatchRow, now = new Date()): Promise<SweepOutcome> {
  try {
    const observations = await sourceFor(watch.source).observe(watch.externalId);
    return await applyObservations(watch, observations, now);
  } catch (error) {
    const raison = error instanceof AppError ? error.message : 'Erreur inattendue pendant le relevé.';
    const echecs = watch.failureCount + 1;
    await getDb()
      .update(watches)
      .set({
        lastSweptAt: now,
        lastError: raison.slice(0, 300),
        failureCount: echecs,
        // Au-delà du seuil, on arrête d'appeler le site d'un tiers tous les jours pour rien.
        active: echecs < MAX_FAILURES,
      })
      .where(eq(watches.id, watch.id));
    throw error;
  }
}

/** Articles encore en vente d'une surveillance, du plus vendu au moins vendu. */
export function liveItems(watchId: string) {
  return getDb()
    .select()
    .from(watchItems)
    .where(and(eq(watchItems.watchId, watchId), isNull(watchItems.endedAt)));
}
