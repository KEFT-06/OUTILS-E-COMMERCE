import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { workspaceDocuments } from '@server/db/schema';
import { AppError } from '@server/middleware';

/**
 * Brouillons de l'espace de travail, conservés sur le compte : retouches des
 * produits, produits créés hors analyse, swipe file, kits de lancement et pages produits.
 *
 * Le navigateur valide le détail de chaque brouillon à la lecture ; le serveur
 * garde la forme générale (objet ou liste) et une taille maximale, pour qu'un
 * document ne puisse ni casser l'écran ni remplir la base.
 */

/**
 * Forme et taille maximale (octets de JSON) de chaque document. Les produits, dont
 * les modules peuvent être rédigés en entier, ont plus de place que les autres.
 */
export const WORKSPACE_KINDS = {
  product_drafts: { shape: 'object', maxBytes: 4_000_000 },
  custom_products: { shape: 'array', maxBytes: 4_000_000 },
  swipe_file: { shape: 'array', maxBytes: 512_000 },
  launch_kits: { shape: 'object', maxBytes: 512_000 },
  product_pages: { shape: 'object', maxBytes: 512_000 },
} as const;

export type WorkspaceKind = keyof typeof WORKSPACE_KINDS;

function sizeLabel(bytes: number): string {
  return bytes >= 1_000_000 ? `${bytes / 1_000_000} Mo` : `${Math.round(bytes / 1000)} Ko`;
}

export function parseWorkspaceKind(value: string | undefined): WorkspaceKind {
  if (value && Object.prototype.hasOwnProperty.call(WORKSPACE_KINDS, value)) return value as WorkspaceKind;
  throw new AppError(404, 'Type de brouillon inconnu.', 'WORKSPACE_KIND_UNKNOWN');
}

export function assertWorkspaceData(kind: WorkspaceKind, data: unknown): void {
  const { shape, maxBytes } = WORKSPACE_KINDS[kind];
  const shapeOk = shape === 'array' ? Array.isArray(data) : typeof data === 'object' && data !== null && !Array.isArray(data);
  if (!shapeOk) {
    throw new AppError(400, 'Brouillon invalide.', 'WORKSPACE_INVALID');
  }
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > maxBytes) {
    throw new AppError(
      413,
      `Ce brouillon est trop volumineux pour être enregistré (${sizeLabel(maxBytes)} au plus) : retirez des éléments ou exportez-le.`,
      'WORKSPACE_TOO_LARGE',
    );
  }
}

export async function readWorkspaceDocument(userId: string, kind: WorkspaceKind) {
  const [row] = await getDb()
    .select({ data: workspaceDocuments.data, updatedAt: workspaceDocuments.updatedAt })
    .from(workspaceDocuments)
    .where(and(eq(workspaceDocuments.userId, userId), eq(workspaceDocuments.kind, kind)))
    .limit(1);
  return row ? { data: row.data, updatedAt: row.updatedAt.toISOString() } : { data: null, updatedAt: null };
}

export async function saveWorkspaceDocument(userId: string, kind: WorkspaceKind, data: unknown) {
  assertWorkspaceData(kind, data);
  const now = new Date();
  await getDb()
    .insert(workspaceDocuments)
    .values({ userId, kind, data, updatedAt: now })
    .onConflictDoUpdate({
      target: [workspaceDocuments.userId, workspaceDocuments.kind],
      set: { data: sql`excluded.data`, updatedAt: now },
    });
  return { updatedAt: now.toISOString() };
}

export async function listWorkspaceDocuments(userId: string) {
  return getDb()
    .select({ kind: workspaceDocuments.kind, data: workspaceDocuments.data, updatedAt: workspaceDocuments.updatedAt })
    .from(workspaceDocuments)
    .where(eq(workspaceDocuments.userId, userId));
}
