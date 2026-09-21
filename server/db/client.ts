import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { env, isProd } from '@server/env';
import * as schema from '@server/db/schema';

/**
 * Connexion à la base.
 *
 *  - `DATABASE_URL=postgresql://…` : PostgreSQL distant (Supabase). Obligatoire en
 *    production. `prepare: false` : compatible avec le pooler de Supabase.
 *  - variable absente, en développement : PostgreSQL embarqué (PGlite) dans
 *    `.data/pglite`, exclu de Git. Solution d'attente, sur le poste du développeur.
 *  - `memory://` : base éphémère, pour les tests.
 *
 * Les migrations du dossier server/db/migrations/ sont appliquées à chaque démarrage : une base
 * en retard sur le code refuserait des requêtes au premier utilisateur venu.
 */

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Base ou transaction en cours : les opérations composables acceptent l'une ou l'autre. */
export type Executor = Database | Transaction;

/** Exécute `work` dans la transaction fournie, ou dans une nouvelle. */
export function inTransaction<T>(executor: Transaction | undefined, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return executor ? work(executor) : getDb().transaction(work);
}

/**
 * Lignes d'une requête SQL brute. postgres-js renvoie un tableau, PGlite un objet
 * `{ rows }` : cette fonction rend les deux pilotes interchangeables.
 */
export async function queryRows<T>(query: SQL, executor: Executor = getDb()): Promise<T[]> {
  const result = (await executor.execute(query)) as unknown;
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

/** Violation d'unicité PostgreSQL (23505), que l'erreur vienne du pilote ou de drizzle. */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

const MIGRATIONS_FOLDER = join(process.cwd(), 'server', 'db', 'migrations');

let database: Database | null = null;
let closeConnection: (() => Promise<void>) | null = null;
let kind: 'postgres' | 'embedded' | null = null;

export function getDb(): Database {
  if (!database) throw new Error('Base de données non initialisée : initDatabase() doit être appelée au démarrage.');
  return database;
}

export function databaseKind(): 'postgres' | 'embedded' | null {
  return kind;
}

export interface InitDatabaseOptions {
  /**
   * Applique les migrations en attente. Vrai par défaut : un serveur classique démarre
   * une fois et garde la main. Faux en hébergement sans serveur, où chaque instance
   * démarrerait la même migration en même temps : elles sont alors passées une seule
   * fois pendant la construction (`npm run db:migrate`).
   */
  migrate?: boolean;
  /**
   * Connexions ouvertes vers PostgreSQL. Une seule en hébergement sans serveur : chaque
   * instance a son propre pool, et le pooler de Supabase les compte toutes.
   */
  maxConnections?: number;
}

export async function initDatabase(
  url: string | undefined = env.DATABASE_URL,
  options: InitDatabaseOptions = {},
): Promise<Database> {
  if (database) return database;
  const { migrate: runMigrations = true, maxConnections = 10 } = options;

  if (url && !url.startsWith('memory://') && !url.startsWith('pglite://')) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');

    const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    const client = postgres(url, {
      max: maxConnections,
      prepare: false,
      ssl: isLocal ? false : 'require',
      onnotice: () => undefined,
      /*
        Une base injoignable doit échouer vite, pas faire attendre.

        Sans délai, une adresse qui ne répond pas — un hôte joignable seulement en IPv6
        depuis un hébergeur qui n'a que de l'IPv4, par exemple — laissait la requête
        pendue une demi-minute : le visiteur voyait une page qui tourne indéfiniment, et
        la surveillance elle-même n'obtenait pas de réponse à interpréter. Dix secondes
        suffisent largement à une connexion saine, et au-delà mieux vaut un 503 net.
      */
      connect_timeout: isLocal ? 0 : 10,
    });
    const db = drizzle(client, { schema });
    if (runMigrations) await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    database = db as unknown as Database;
    closeConnection = () => client.end();
    kind = 'postgres';
    return database;
  }

  if (isProd) {
    throw new Error('DATABASE_URL est obligatoire en production : la base embarquée ne sert qu’au développement.');
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');

  const dataDir = url?.startsWith('memory://')
    ? undefined
    : resolve(process.cwd(), url?.slice('pglite://'.length) || '.data/pglite');
  if (dataDir) mkdirSync(dataDir, { recursive: true });

  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  database = db as unknown as Database;
  closeConnection = () => client.close();
  kind = 'embedded';
  return database;
}

export async function closeDatabase(): Promise<void> {
  await closeConnection?.();
  database = null;
  closeConnection = null;
  kind = null;
}
