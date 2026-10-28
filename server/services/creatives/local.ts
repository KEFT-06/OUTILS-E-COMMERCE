import type { Response as ExpressResponse } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { creativeImages } from '@server/db/schema';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';

/**
 * Visuels publicitaires produits chez nous AVANT le 28/10/2026, enregistrés en base64 sur le compte
 * de leur auteur. Leur création est retirée du site ce jour-là avec toute génération d'images ; ils
 * restent listés et téléchargeables dans « Mes créations », sans limite de durée.
 */

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

/** Visuels affichés par page dans « Mes visuels ». */
export const VISUALS_PAGE_SIZE = 24;

/**
 * Les visuels de l'auteur, du plus récent au plus ancien, SANS leurs octets : l'écran les
 * affiche par l'adresse du fichier, une image à la fois.
 *
 * Ils sont gardés sans limite de durée, mais ne se téléchargeaient qu'au moment de leur
 * création : un visuel payé et perdu de vue restait en base, inaccessible à son auteur.
 */
export async function listLocalVisuals(auth: RequestAuth, page = 1) {
  const rows = await getDb()
    .select({ requestId: creativeImages.requestId, prompt: creativeImages.prompt, format: creativeImages.format, createdAt: creativeImages.createdAt })
    .from(creativeImages)
    .where(eq(creativeImages.userId, auth.account.user.id))
    .orderBy(desc(creativeImages.createdAt))
    .limit(VISUALS_PAGE_SIZE + 1)
    .offset((page - 1) * VISUALS_PAGE_SIZE);
  return {
    page,
    hasMore: rows.length > VISUALS_PAGE_SIZE,
    visuals: rows.slice(0, VISUALS_PAGE_SIZE).map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  };
}

const EXTENSIONS: Record<string, string> ={ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

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
