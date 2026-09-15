import { and, eq } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { generations, type GenerationKind } from '@server/db/schema';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { debitCredits, refundDebit } from '@server/services/accounts';
import { getActionCost } from '@server/services/credits';

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
  describe: (result: T) => { providerRef: string | null; state: GenerationState; fileFormat?: string | null };
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
      provider: input.provider,
      providerRef: described.providerRef,
      status: described.state === 'failed' ? 'pending' : described.state,
      fileFormat: described.fileFormat ?? null,
      creditsCharged: debit.charged,
      debitTransactionId: debit.transactionId,
      completedAt: described.state === 'completed' ? new Date() : null,
    })
    .returning();

  const stored = described.state === 'failed' ? await settleGeneration(generation!, 'failed') : generation!;
  return { result, generation: stored };
}

/** Génération du compte courant, ou 404 : l'existence d'une génération d'autrui n'est pas révélée. */
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
