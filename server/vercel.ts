import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { waitUntil } from '@vercel/functions';
import { createApp } from '@server/app';
import { initDatabase } from '@server/db/client';
import { createVigil, guardQuickRead } from '@server/db/vigil';
import { env } from '@server/env';
import { bootstrapFirstAdmin } from '@server/services/admin/bootstrap';
import { backgroundWorkRunning } from '@server/shared/backgroundWork';

/**
 * Point d'entrée pour un hébergement sans serveur (Vercel).
 *
 * Ce qui change par rapport au serveur classique (server/index.ts) :
 *
 *  - Aucune écoute de port : l'hébergeur appelle l'application requête par requête.
 *  - Les migrations ne sont pas jouées ici. Plusieurs instances peuvent démarrer en même
 *    temps et lanceraient la même migration ensemble ; elles passent une seule fois
 *    pendant la construction (`npm run db:migrate`).
 *  - Une seule connexion à PostgreSQL par instance : le pooler les compte toutes. Elle peut
 *    mourir pendant le sommeil de l'instance, et y occuper une place de la base pour rien :
 *    l'instance la rend dès qu'elle n'a plus rien à servir (db/vigil.ts).
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
const vigil = createVigil({ otherWork: backgroundWorkRunning });
/** Repos au bout duquel une instance rend sa connexion à la base. */
const IDLE_RELEASE_MS = 1_500;

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

/**
 * Une fois la réponse partie, l'instance reste éveillée un instant ; si rien d'autre n'est arrivé,
 * elle rend sa connexion avant de s'endormir. L'hébergeur est prévenu tout de suite, dans le fil
 * de la requête, qu'il reste ce geste à finir.
 */
function releaseWhenIdle(response: ServerResponse): void {
  const settled = new Promise<void>((resolve) => {
    let scheduled = false;
    const afterResponse = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        vigil.releaseIfIdle();
        resolve();
      }, IDLE_RELEASE_MS);
    };
    response.once('finish', afterResponse);
    response.once('close', afterResponse);
  });
  try {
    waitUntil(settled);
  } catch {
    // Hors hébergement sans serveur : le processus reste vivant.
  }
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  /*
    Les pages du site n'ont pas besoin de la base : leur HTML part tout de suite. On attendait
    la connexion à PostgreSQL avant d'envoyer quoi que ce soit, et au premier appel d'une
    instance l'écran restait noir plusieurs secondes. La connexion se prépare quand même en
    parallèle, pour les appels qui suivent.
  */
  if (!(request.url ?? '/').startsWith('/api')) {
    prepare().catch((error: unknown) => {
      console.error('[démarrage] base de données inaccessible :', error instanceof Error ? error.message : error);
    });
    app(request as never, response as never);
    return;
  }
  // Une lecture courte ne reste jamais pendue : au bout de huit secondes, les connexions sont remplacées.
  const guard = guardQuickRead(request, response);
  try {
    await prepare();
    // Une instance qui a dormi vérifie sa connexion avant de servir (server/db/vigil.ts).
    guard.stage('veille');
    const outcome = await vigil.awake();
    // Ce que la veille a fait se lit de l'extérieur, réponse par réponse : c'est ce qui dit si elle sert.
    if (outcome !== 'none' && !response.headersSent) response.setHeader('Server-Timing', `base;desc="${outcome === 'alive' ? 'sonde' : outcome === 'fresh' ? 'neuve' : 'remplacee'}"`);
  } catch (error) {
    if (response.headersSent) return;
    console.error('[démarrage] base de données inaccessible :', error instanceof Error ? error.message : error);
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Le service est momentanément indisponible.' } }));
    return;
  }
  // Le garde-fou a déjà répondu pendant la préparation : il n'y a plus rien à servir.
  if (response.headersSent) return;
  guard.stage('application');
  const leave = vigil.enter();
  response.once('finish', leave);
  response.once('close', leave);
  releaseWhenIdle(response);
  app(request as never, response as never);
}
