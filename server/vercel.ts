import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '@server/app';
import { initDatabase } from '@server/db/client';
import { env } from '@server/env';
import { bootstrapFirstAdmin } from '@server/services/admin/bootstrap';

/**
 * Point d'entrée pour un hébergement sans serveur (Vercel).
 *
 * Ce qui change par rapport au serveur classique (server/index.ts) :
 *
 *  - Aucune écoute de port : l'hébergeur appelle l'application requête par requête.
 *  - Les migrations ne sont pas jouées ici. Plusieurs instances peuvent démarrer en même
 *    temps et lanceraient la même migration ensemble ; elles passent une seule fois
 *    pendant la construction (`npm run db:migrate`).
 *  - Une seule connexion à PostgreSQL par instance : le pooler les compte toutes.
 *  - Aucun balayage périodique : rien ne tourne entre deux requêtes. Les travaux
 *    interrompus repartent au suivi suivant (services/analysis/jobs.ts).
 *  - Les fichiers du site sont distribués par le réseau de l'hébergeur ; seul le HTML
 *    est rendu ici, pour garder ses balises de référencement propres à chaque adresse.
 */

/**
 * Le modèle HTML est rangé hors du dossier distribué par l'hébergeur, pour que l'adresse
 * « / » passe bien par le serveur et reçoive ses balises de référencement
 * (server/scripts/prepare-vercel.mjs).
 */
const CLIENT_DIR = env.CLIENT_DIR ?? join(process.cwd(), 'dist', 'app-shell');

const app = createApp({ clientDir: CLIENT_DIR, serveStaticFiles: false });

/**
 * Préparation partagée par toutes les requêtes d'une même instance. En cas d'échec, la
 * promesse est oubliée : la requête suivante réessaie au lieu d'hériter d'une panne figée.
 */
let ready: Promise<void> | null = null;

function prepare(): Promise<void> {
  ready ??= (async () => {
    await initDatabase(env.DATABASE_URL, { migrate: false, maxConnections: 1 });
    if (env.ADMIN_BOOTSTRAP_EMAIL) {
      await bootstrapFirstAdmin(env.ADMIN_BOOTSTRAP_EMAIL).catch((error: unknown) => {
        console.error('[démarrage] premier administrateur impossible à créer :', error instanceof Error ? error.message : error);
      });
    }
  })().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    await prepare();
  } catch (error) {
    console.error('[démarrage] base de données inaccessible :', error instanceof Error ? error.message : error);
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Le service est momentanément indisponible. Réessayez dans un instant.' } }));
    return;
  }
  app(request as never, response as never);
}
