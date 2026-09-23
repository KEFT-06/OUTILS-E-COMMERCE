import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { generations, users } from '@server/db/schema';
import { AppError } from '@server/middleware';

/**
 * Bibliothèque des créatifs pour l'administration : vidéos et visuels générés par les comptes,
 * avec accès au fichier.
 *
 * Deux régimes, selon l'endroit où vit le fichier. Une vidéo reste chez fal.ai, qui ne la garde
 * qu'environ sept jours : passé ce délai, la ligne demeure (date, créateur, points) mais le
 * fichier est annoncé expiré. Un visuel produit par Cloudflare est enregistré chez nous : il ne
 * périme pas, et la bibliothèque ne doit pas le déclarer perdu au bout d'une semaine.
 *
 * Les visuels d'avant la bascule restent chez Higgsfield, et gardent donc l'ancien régime.
 */

/** Durée de conservation des fichiers chez Higgsfield (docs.higgsfield.ai, « Billing and retention »). */
export const PROVIDER_FILE_RETENTION_DAYS = 7;

const CREATIVE_KINDS = ['video', 'image'] as const;

export const creativeListQuerySchema = z.object({
  kind: z.enum(CREATIVE_KINDS).catch('video'),
  status: z.enum(['pending', 'completed', 'failed']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(20),
});

export type CreativeListQuery = z.infer<typeof creativeListQuerySchema>;

/** Fichiers gardés chez nous : rien ne les efface, la conservation du fournisseur ne les concerne pas. */
const STORED_LOCALLY = 'interne';

const isAvailable = (row: { status: string; provider: string; providerRef: string | null; createdAt: Date }, now: number) => {
  if (row.status !== 'completed' || !row.providerRef) return false;
  if (row.provider === STORED_LOCALLY) return true;
  return now - row.createdAt.getTime() < PROVIDER_FILE_RETENTION_DAYS * 86_400_000;
};

/** Fournisseurs de créatifs : vidéo chez fal.ai, visuels chez Cloudflare, et l'historique Higgsfield. */
const CREATIVE_PROVIDERS = ['fal', 'higgsfield', STORED_LOCALLY] as const;

export async function listCreatives(query: CreativeListQuery) {
  const db = getDb();
  const ofKind = and(inArray(generations.provider, CREATIVE_PROVIDERS), eq(generations.kind, query.kind));
  const where: SQL | undefined = query.status ? and(ofKind, eq(generations.status, query.status)) : ofKind;

  const [rows, [total], counts] = await Promise.all([
    db
      .select({
        id: generations.id,
        status: generations.status,
        providerRef: generations.providerRef,
        provider: generations.provider,
        creditsCharged: generations.creditsCharged,
        refunded: generations.refunded,
        createdAt: generations.createdAt,
        completedAt: generations.completedAt,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
      })
      .from(generations)
      .innerJoin(users, eq(users.id, generations.userId))
      .where(where)
      .orderBy(desc(generations.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ value: count() }).from(generations).where(where),
    db.select({ status: generations.status, value: count() }).from(generations).where(ofKind).groupBy(generations.status),
  ]);

  const now = Date.now();
  return {
    kind: query.kind,
    page: query.page,
    pageSize: query.pageSize,
    total: total?.value ?? 0,
    counts: {
      pending: counts.find((entry) => entry.status === 'pending')?.value ?? 0,
      completed: counts.find((entry) => entry.status === 'completed')?.value ?? 0,
      failed: counts.find((entry) => entry.status === 'failed')?.value ?? 0,
    },
    retentionDays: PROVIDER_FILE_RETENTION_DAYS,
    entries: rows.map((row) => ({
      id: row.id,
      status: row.status,
      creditsCharged: row.creditsCharged,
      refunded: row.refunded,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      user: { id: row.userId, name: row.userName, email: row.userEmail },
      /** Fichier encore récupérable ; l'identifiant chez le fournisseur ne sort pas du serveur. */
      available: isAvailable(row, now),
    })),
  };
}

/** Créatif terminé dont le fichier peut être relayé, avec son auteur pour le journal. */
export async function findCreativeFile(generationId: string | undefined) {
  const id = z.string().uuid().safeParse(generationId);
  const notFound = new AppError(404, 'Contenu introuvable.', 'CREATIVE_NOT_FOUND');
  if (!id.success) throw notFound;

  const [row] = await getDb()
    .select({
      id: generations.id,
      kind: generations.kind,
      status: generations.status,
      providerRef: generations.providerRef,
      provider: generations.provider,
      createdAt: generations.createdAt,
      userId: users.id,
      userEmail: users.email,
    })
    .from(generations)
    .innerJoin(users, eq(users.id, generations.userId))
    .where(and(eq(generations.id, id.data), inArray(generations.provider, CREATIVE_PROVIDERS)))
    .limit(1);
  if (!row || !(CREATIVE_KINDS as readonly string[]).includes(row.kind)) throw notFound;
  if (row.status !== 'completed' || !row.providerRef) {
    throw new AppError(409, 'Aucun fichier : cette génération n’est pas terminée.', 'CREATIVE_NOT_READY');
  }
  return { ...row, providerRef: row.providerRef };
}
