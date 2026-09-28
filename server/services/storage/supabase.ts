import { env, providers } from '@server/env';

/**
 * Stockage de fichiers de Supabase, par son API REST.
 *
 * Supabase héberge déjà la base : son stockage évite un fournisseur de plus. Trois usages s'y
 * partagent ce module — copies des vidéos Veo, dépôts temporaires des vidéos à transformer en
 * produit, aperçus des publicités de l'espionnage — chacun dans son propre espace.
 *
 * Tout est facultatif : sans SUPABASE_API_SECRET_KEY, `supabaseStorage()` renvoie null et
 * chaque usage se replie sur son comportement sans stockage.
 *
 * Offre gratuite : 1 Go en tout, fichiers de 50 Mo au plus. Chaque usage fixe donc une durée
 * de vie à ce qu'il dépose : rien n'y reste sans date de fin.
 */

const TIMEOUT_MS = 60_000;

export interface StorageTarget {
  /** Racine de l'API : https://<réf>.supabase.co/storage/v1 */
  base: string;
  headers: Record<string, string>;
}

export interface BucketOptions {
  id: string;
  public: boolean;
  /** Octets au plus par fichier. */
  fileSizeLimit: number;
  allowedMimeTypes?: string[];
}

/** Adresse du projet : donnée, ou déduite de l'utilisateur de DATABASE_URL (« postgres.<réf> »). */
export function supabaseProjectUrl(): string | null {
  if (env.SUPABASE_URL) return env.SUPABASE_URL.replace(/\/+$/, '');
  if (!env.DATABASE_URL) return null;
  try {
    const reference = /^postgres\.([a-z0-9]{10,40})$/.exec(decodeURIComponent(new URL(env.DATABASE_URL).username))?.[1];
    return reference ? `https://${reference}.supabase.co` : null;
  } catch {
    return null;
  }
}

export function supabaseStorage(): StorageTarget | null {
  const url = supabaseProjectUrl();
  if (!providers.videoArchive || !url) return null;
  const key = env.SUPABASE_API_SECRET_KEY!;
  return { base: `${url}/storage/v1`, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

/** Chemin d'objet encodé segment par segment : les « / » restent des séparateurs. */
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

async function createBucket(target: StorageTarget, bucket: BucketOptions): Promise<void> {
  const response = await fetch(`${target.base}/bucket`, {
    method: 'POST',
    headers: { ...target.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: bucket.id,
      name: bucket.id,
      public: bucket.public,
      file_size_limit: bucket.fileSizeLimit,
      ...(bucket.allowedMimeTypes ? { allowed_mime_types: bucket.allowedMimeTypes } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 409 : un autre dépôt l'a créé entre-temps.
  if (!response.ok && response.status !== 409) throw new Error(`création de l'espace de stockage refusée (${response.status})`);
}

/** Exécute une opération, et crée l'espace puis réessaie s'il n'existe pas encore (premier usage). */
async function withBucket(target: StorageTarget, bucket: BucketOptions, run: () => Promise<Response>): Promise<Response> {
  let response = await run();
  if (response.status === 404 || response.status === 400) {
    await createBucket(target, bucket);
    response = await run();
  }
  return response;
}

/** Dépose (ou remplace) un objet. */
export async function putObject(
  target: StorageTarget,
  bucket: BucketOptions,
  path: string,
  body: ArrayBuffer | Buffer,
  contentType: string,
): Promise<void> {
  const response = await withBucket(target, bucket, () =>
    fetch(`${target.base}/object/${bucket.id}/${encodePath(path)}`, {
      method: 'POST',
      headers: { ...target.headers, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: body instanceof ArrayBuffer ? body : new Uint8Array(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  if (!response.ok) throw new Error(`dépôt refusé (${response.status})`);
}

/** Lecture d'un objet privé ; null s'il n'existe pas ou si le stockage ne répond pas. */
export async function getObject(target: StorageTarget, bucketId: string, path: string): Promise<Response | null> {
  try {
    const response = await fetch(`${target.base}/object/authenticated/${bucketId}/${encodePath(path)}`, {
      headers: target.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok && response.body ? response : null;
  } catch {
    return null;
  }
}

/** Efface des objets, par lots. Un objet déjà absent n'est pas une erreur. */
export async function removeObjects(target: StorageTarget, bucketId: string, paths: string[]): Promise<void> {
  for (let start = 0; start < paths.length; start += 100) {
    const response = await fetch(`${target.base}/object/${bucketId}`, {
      method: 'DELETE',
      headers: { ...target.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths.slice(start, start + 100) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) throw new Error(`effacement refusé (${response.status})`);
  }
}

/** Objets directement sous un dossier, les plus anciens d'abord. */
export async function listObjects(
  target: StorageTarget,
  bucketId: string,
  prefix: string,
  limit = 1000,
): Promise<{ name: string; createdAt: Date | null }[]> {
  const response = await fetch(`${target.base}/object/list/${bucketId}`, {
    method: 'POST',
    headers: { ...target.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit, offset: 0, sortBy: { column: 'created_at', order: 'asc' } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Espace pas encore créé : rien à lister.
  if (response.status === 404 || response.status === 400) return [];
  if (!response.ok) throw new Error(`liste refusée (${response.status})`);
  const rows = (await response.json().catch(() => [])) as { name?: unknown; created_at?: unknown }[];
  return (Array.isArray(rows) ? rows : []).flatMap((row) =>
    typeof row.name === 'string'
      ? [{ name: row.name, createdAt: typeof row.created_at === 'string' ? new Date(row.created_at) : null }]
      : [],
  );
}

/**
 * Lien de dépôt signé : le navigateur y envoie le fichier directement, sans passer par le
 * serveur ni par aucune clé. Supabase le garde valable deux heures.
 */
export async function createSignedUpload(target: StorageTarget, bucket: BucketOptions, path: string): Promise<string> {
  const response = await withBucket(target, bucket, () =>
    fetch(`${target.base}/object/upload/sign/${bucket.id}/${encodePath(path)}`, {
      method: 'POST',
      headers: { ...target.headers, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  if (!response.ok) throw new Error(`lien de dépôt refusé (${response.status})`);
  const payload = (await response.json().catch(() => null)) as { url?: unknown } | null;
  if (typeof payload?.url !== 'string' || !payload.url.includes('token=')) throw new Error('lien de dépôt illisible');
  return `${target.base}${payload.url.startsWith('/') ? '' : '/'}${payload.url}`;
}
