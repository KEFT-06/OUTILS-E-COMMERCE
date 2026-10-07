import { and, desc, eq, gt, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { generations, type GenerationKind } from '@server/db/schema';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { debitCredits, refundDebit } from '@server/services/accounts';
import { getActionCost } from '@server/services/credits';
import { archiveVeoVideo, videoArchiveConfigured } from '@server/services/creatives/archive';
import { runInBackground } from '@server/shared/backgroundWork';

/**
 * Générations facturées et contenus créés.
 *
 * Chaque génération est rattachée à son auteur : c'est ce qui empêche un tiers de
 * suivre une génération ou de télécharger un fichier dont il connaîtrait
 * l'identifiant, et ce qui alimente les statistiques de l'administration.
 *
 * Facturation : les points sont réservés au lancement puis rendus si la
 * génération échoue (refus du fournisseur, filtre de sécurité, erreur). Réserver
 * d'abord empêche de lancer dix vidéos avec le solde d'une seule.
 */

export type GenerationRow = typeof generations.$inferSelect;
export type GenerationState = 'pending' | 'completed' | 'failed';

export async function runBilledGeneration<T>(input: {
  auth: RequestAuth;
  actionId: string;
  kind: GenerationKind;
  provider: string;
  run: () => Promise<T>;
  /** `provider` : à renseigner quand le circuit réellement emprunté ne se connaît qu'après coup (secours). */
  describe: (result: T) => { providerRef: string | null; state: GenerationState; fileFormat?: string | null; provider?: string };
  /** Vidéo longue : étape précédente, durée totale et résolution, enregistrées avec la génération. */
  video?: { parentId?: string | null; durationSeconds?: number | null; resolution?: string | null };
  /** Demande d'origine, gardée pour pouvoir la relancer si le fournisseur la fait échouer. */
  request?: Record<string, unknown>;
}): Promise<{ result: T; generation: GenerationRow }> {
  const { account } = input.auth;
  const cost = await getActionCost(input.actionId);
  const debit = await debitCredits({
    userId: account.user.id,
    cost,
    actionId: input.actionId,
    unlimited: account.plan.monthlyCredits === null,
  });

  let result: T;
  try {
    result = await input.run();
  } catch (error) {
    await refundDebit({
      debitTransactionId: debit.transactionId,
      generationId: null,
      note: 'La demande n’a pas abouti : points rendus.',
    });
    throw error;
  }

  const described = input.describe(result);
  const [generation] = await getDb()
    .insert(generations)
    .values({
      userId: account.user.id,
      kind: input.kind,
      provider: described.provider ?? input.provider,
      providerRef: described.providerRef,
      status: described.state === 'failed' ? 'pending' : described.state,
      fileFormat: described.fileFormat ?? null,
      creditsCharged: debit.charged,
      debitTransactionId: debit.transactionId,
      completedAt: described.state === 'completed' ? new Date() : null,
      parentId: input.video?.parentId ?? null,
      durationSeconds: input.video?.durationSeconds ?? null,
      resolution: input.video?.resolution ?? null,
      request: input.request ?? null,
    })
    .returning();

  const stored = described.state === 'failed' ? await settleGeneration(generation!, 'failed') : generation!;
  return { result, generation: stored };
}

/** Génération du compte courant, ou 404 : l'existence d'une génération d'autrui n'est pas révélée. */
/** Ce qu'une génération garde de sa demande d'origine. */
export interface StoredRequest {
  brief?: unknown;
  /** Relances déjà faites après un échec chez le fournisseur. */
  attempts?: number;
  /** Identifiants de rendu portés avant une relance : l'écran qui les suit encore est remis sur le bon. */
  previousRefs?: string[];
}

/**
 * Réserve une relance, pour cette sonde seule. Deux écrans suivent parfois la même vidéo (celui
 * qui l'a lancée et « Mes vidéos ») : sans cette réservation, chacun la relancerait de son côté.
 */
export async function claimRelaunch(generation: GenerationRow): Promise<boolean> {
  const stored = (generation.request ?? {}) as StoredRequest;
  const attempts = stored.attempts ?? 0;
  const claimed = await getDb()
    .update(generations)
    .set({ request: { ...stored, attempts: attempts + 1 } })
    .where(
      and(
        eq(generations.id, generation.id),
        eq(generations.status, 'pending'),
        sql`coalesce((${generations.request} ->> 'attempts')::int, 0) = ${attempts}`,
      ),
    )
    .returning({ id: generations.id });
  return claimed.length > 0;
}

/** La génération continue sous un nouvel identifiant de rendu ; l'ancien est retenu. */
export async function continueUnderNewRef(generation: GenerationRow, providerRef: string): Promise<void> {
  const [current] = await getDb().select({ request: generations.request }).from(generations).where(eq(generations.id, generation.id)).limit(1);
  const stored = (current?.request ?? {}) as StoredRequest;
  const previousRefs = [...(stored.previousRefs ?? []), ...(generation.providerRef ? [generation.providerRef] : [])].slice(-6);
  await getDb()
    .update(generations)
    .set({ providerRef, request: { ...stored, previousRefs } })
    .where(eq(generations.id, generation.id));
}

/** Génération du compte qui a porté cet identifiant avant une relance, ou null. */
export async function findOwnedGenerationByFormerRef(auth: RequestAuth, provider: string, formerRef: string): Promise<GenerationRow | null> {
  const [row] = await getDb()
    .select()
    .from(generations)
    .where(
      and(
        eq(generations.userId, auth.account.user.id),
        eq(generations.provider, provider),
        sql`${generations.request} -> 'previousRefs' @> ${JSON.stringify([formerRef])}::jsonb`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Vidéos récentes d'un compte, de la plus neuve à la plus ancienne ; les rendus échoués n'y figurent pas. */
export async function listOwnVideoGenerations(userId: string, providers: string[], since: Date, limit: number): Promise<GenerationRow[]> {
  return getDb()
    .select()
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        eq(generations.kind, 'video'),
        inArray(generations.provider, providers),
        isNotNull(generations.providerRef),
        ne(generations.status, 'failed'),
        gt(generations.createdAt, since),
      ),
    )
    .orderBy(desc(generations.createdAt))
    .limit(limit);
}

export async function findOwnedGeneration(auth: RequestAuth, provider: string, providerRef: string): Promise<GenerationRow> {
  const [generation] = await getDb()
    .select()
    .from(generations)
    .where(
      and(
        eq(generations.provider, provider),
        eq(generations.providerRef, providerRef),
        eq(generations.userId, auth.account.user.id),
      ),
    )
    .limit(1);
  if (!generation) throw new AppError(404, 'Génération introuvable sur votre compte.', 'GENERATION_NOT_FOUND');
  return generation;
}

/**
 * Reporte l'état constaté chez le fournisseur. Un échec rend les points une seule
 * fois : la réclamation du remboursement est conditionnelle, et deux sondages
 * simultanés ne peuvent pas rembourser deux fois.
 */
export async function settleGeneration(
  generation: GenerationRow,
  state: GenerationState,
  fileFormat?: string | null,
): Promise<GenerationRow> {
  const db = getDb();

  if (state === 'pending' || generation.status !== 'pending') return generation;

  if (state === 'completed') {
    const [updated] = await db
      .update(generations)
      .set({ status: 'completed', completedAt: new Date(), ...(fileFormat ? { fileFormat } : {}) })
      .where(and(eq(generations.id, generation.id), eq(generations.status, 'pending')))
      .returning();
    // Une vidéo Veo ne reste que deux jours chez Google : la copie part dès la fin du rendu,
    // après la réponse — le suivi de l'écran n'attend pas le dépôt.
    if (updated && updated.provider === 'veo' && videoArchiveConfigured()) {
      runInBackground(async () => void (await archiveVeoVideo(updated)), 'archive vidéo');
    }
    return updated ?? generation;
  }

  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(generations)
      .set({ status: 'failed', refunded: true, completedAt: new Date() })
      .where(and(eq(generations.id, generation.id), eq(generations.refunded, false)))
      .returning();
    if (!claimed) return generation;

    if (claimed.creditsCharged > 0 && claimed.debitTransactionId) {
      await refundDebit(
        {
          debitTransactionId: claimed.debitTransactionId,
          generationId: claimed.id,
          note: 'Génération échouée chez le fournisseur : points rendus.',
        },
        tx,
      );
    }
    return claimed;
  });
}

/**
 * Export fait dans le navigateur (ebook PDF ou DOCX, page produit, dossier PDF…).
 * Déclaré par le client, donc marqué comme tel : l'administration distingue ces
 * chiffres de ceux que le serveur a mesurés lui-même.
 */
export async function recordClientExport(auth: RequestAuth, kind: GenerationKind, fileFormat: string): Promise<void> {
  const now = new Date();
  await getDb().insert(generations).values({
    userId: auth.account.user.id,
    kind,
    provider: 'navigateur',
    status: 'completed',
    source: 'client',
    fileFormat,
    createdAt: now,
    completedAt: now,
  });
}
