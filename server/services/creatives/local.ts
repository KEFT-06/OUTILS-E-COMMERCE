import { randomUUID } from 'node:crypto';
import type { Response as ExpressResponse } from 'express';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { creativeImages } from '@server/db/schema';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { generateImage } from '@server/services/ai/image';

/**
 * Visuels publicitaires produits chez nous, à partir d'un modèle qui rend des octets.
 *
 * Higgsfield déposait l'image sur son stockage et nous rendait un lien : le serveur n'avait
 * qu'à le relayer, et l'abonnement mensuel payait le tout. Cloudflare Workers AI répond
 * l'image elle-même, à l'unité — quelques centimes le visuel, sans abonnement, sans crédits
 * qui périment à la fin du mois.
 *
 * Conséquence : c'est à nous de garder le fichier. Il est enregistré comme une couverture,
 * en base64 sur le compte de son auteur.
 *
 * L'écran, lui, ne change pas. Il demande un visuel, reçoit un identifiant de demande, puis
 * va chercher le fichier — la forme des fournisseurs asynchrones. Le visuel est prêt
 * immédiatement, mais casser ce contrat pour l'annoncer n'apporterait rien.
 */

/** Identifiant de demande : un UUID, que `requestIdSchema` accepte déjà côté route. */
function mintRequestId(): string {
  return randomUUID();
}

export interface LocalVisualInput {
  prompt: string;
  /** Un des formats de créatif : 1:1, 9:16 ou 16:9. */
  format: '1:1' | '9:16' | '16:9';
}

/**
 * Produit le visuel et l'enregistre. Rendu synchrone : l'appelant a déjà été facturé par
 * `runBilledGeneration`, qui rend les points si cette fonction échoue.
 */
export async function createLocalVisual(
  auth: RequestAuth,
  input: LocalVisualInput,
): Promise<{ requestId: string; mimeType: string }> {
  const image = await generateImage({ prompt: input.prompt, aspectRatio: input.format });
  const requestId = mintRequestId();

  await getDb().insert(creativeImages).values({
    userId: auth.account.user.id,
    requestId,
    prompt: input.prompt,
    format: input.format,
    mimeType: image.mimeType,
    data: image.bytes.toString('base64'),
  });

  return { requestId, mimeType: image.mimeType };
}

/**
 * Le visuel, restreint à son auteur quand un compte est donné.
 *
 * L'administration passe `null` : elle consulte les créatifs de tous les comptes, et chaque
 * ouverture est déjà inscrite au journal d'audit par la route qui l'appelle.
 */
async function findVisual(userId: string | null, requestId: string) {
  const owner = userId ? and(eq(creativeImages.requestId, requestId), eq(creativeImages.userId, userId)) : eq(creativeImages.requestId, requestId);
  const [row] = await getDb().select().from(creativeImages).where(owner).limit(1);
  if (!row) throw new AppError(404, 'Visuel introuvable.', 'CREATIVE_FILE_MISSING');
  return row;
}

/** Existe-t-il ? Un visuel enregistré est par construction terminé : il n'y a rien à sonder. */
export async function localVisualExists(auth: RequestAuth, requestId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: creativeImages.id })
    .from(creativeImages)
    .where(and(eq(creativeImages.requestId, requestId), eq(creativeImages.userId, auth.account.user.id)))
    .limit(1);
  return Boolean(row);
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Sert le visuel depuis notre propre origine.
 *
 * Le type servi est celui enregistré, et seulement s'il fait partie des types image attendus :
 * une valeur inattendue serait interprétée par le navigateur avec la session du visiteur.
 */
export async function sendLocalVisual(
  auth: RequestAuth | null,
  requestId: string,
  disposition: 'inline' | 'attachment',
  res: ExpressResponse,
): Promise<void> {
  const row = await findVisual(auth?.account.user.id ?? null, requestId);
  const mimeType = Object.hasOwn(EXTENSIONS, row.mimeType) ? row.mimeType : 'image/png';
  const bytes = Buffer.from(row.data, 'base64');

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `${disposition}; filename="visuel-${requestId.slice(0, 8)}.${EXTENSIONS[mimeType]}"`);
  res.end(bytes);
}
