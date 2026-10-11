import assert from 'node:assert/strict';
import { type IncomingMessage, type Server, type ServerResponse, createServer as createHttpServer } from 'node:http';
import { type AddressInfo, type Socket, createServer } from 'node:net';
import { after, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Une connexion à la base morte pendant le sommeil d'une instance ne doit plus faire attendre
 * personne.
 *
 * Constat du 11/10/2026 en production : un `select 1` resté 300 secondes sans réponse. Ces tests
 * verrouillent les deux parades (server/db/vigil.ts) — et la dernière série les prouve avec le
 * vrai pilote PostgreSQL, contre un serveur qui accepte la connexion et ne répond jamais.
 */

describe('veille au réveil', () => {
  /** Une veille pilotée à la main : l'horloge, la réponse de la base, et le compte des gestes. */
  async function veille(repond: () => Promise<boolean>) {
    const { createVigil } = await import('@server/db/vigil');
    const gestes = { sondes: 0, remplacements: 0 };
    let heure = 0;
    const vigil = createVigil({
      restMs: 15_000,
      probeMs: 50,
      now: () => heure,
      answers: () => {
        gestes.sondes += 1;
        return repond();
      },
      renew: () => {
        gestes.remplacements += 1;
      },
    });
    return { vigil, gestes, avancer: (ms: number) => (heure += ms) };
  }

  it('une instance qui vient de servir ne sonde pas ; après un repos, une seule sonde pour toutes les requêtes', async () => {
    const { vigil, gestes, avancer } = await veille(async () => true);
    assert.equal(await vigil.awake(), 'none', 'instance toute neuve : rien à vérifier');
    assert.equal(gestes.sondes, 0);

    avancer(20_000);
    assert.deepEqual(await Promise.all([vigil.awake(), vigil.awake(), vigil.awake()]), ['alive', 'alive', 'alive']);
    assert.deepEqual(gestes, { sondes: 1, remplacements: 0 }, 'la base répond : on garde la connexion');

    avancer(5_000);
    assert.equal(await vigil.awake(), 'none', 'vérifiée il y a cinq secondes : pas de nouvelle sonde');
    assert.equal(gestes.sondes, 1);
  });

  it('une base muette au réveil : les connexions sont remplacées, une fois', async () => {
    const { vigil, gestes, avancer } = await veille(async () => false);
    avancer(60_000);
    assert.deepEqual(await Promise.all([vigil.awake(), vigil.awake()]), ['renewed', 'renewed']);
    assert.deepEqual(gestes, { sondes: 1, remplacements: 1 });
  });

  it('tant qu’une requête est en cours, on ne sonde pas : l’unique connexion peut être prise par un travail légitime', async () => {
    const { vigil, gestes, avancer } = await veille(async () => false);
    const fin = vigil.enter();
    avancer(120_000);
    assert.equal(await vigil.awake(), 'none');
    assert.deepEqual(gestes, { sondes: 0, remplacements: 0 });

    fin();
    fin(); // « finish » puis « close » : la fin d'une requête ne se compte qu'une fois.
    avancer(1_000);
    await vigil.awake();
    assert.equal(gestes.sondes, 0, 'elle vient de finir : la connexion vient de servir');
    avancer(20_000);
    await vigil.awake();
    assert.deepEqual(gestes, { sondes: 1, remplacements: 1 });
  });

  it('une sonde qui échoue ne fait jamais échouer la requête', async () => {
    const { vigil, avancer } = await veille(() => Promise.reject(new Error('panne')));
    avancer(60_000);
    assert.equal(await vigil.awake(), 'none');
  });
});

describe('garde-fou des lectures courtes', () => {
  const serveurs: Server[] = [];
  after(async () => {
    for (const serveur of serveurs) await new Promise((resolve) => serveur.close(resolve));
  });

  /** Un site dont chaque requête est confiée à `traiter`, sous le garde-fou réglé très court. */
  async function site(traiter: (request: IncomingMessage, response: ServerResponse, remplacer: () => void) => void) {
    const { guardQuickRead } = await import('@server/db/vigil');
    const gestes = { remplacements: 0 };
    let auRemplacement: () => void = () => undefined;
    const serveur = createHttpServer((request, response) => {
      const garde = guardQuickRead(request, response, {
        waitMs: 80,
        graceMs: 60,
        renew: () => {
          gestes.remplacements += 1;
          auRemplacement();
        },
      });
      garde.stage('application');
      traiter(request, response, () => undefined);
    });
    serveurs.push(serveur);
    await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    return { base, gestes, quandRemplace: (geste: () => void) => (auRemplacement = geste) };
  }

  it('une lecture de la session restée pendue : connexions remplacées, puis une réponse nette au lieu de cinq minutes d’attente', async () => {
    const { base, gestes } = await site(() => undefined); // l'application ne répond jamais
    const depart = Date.now();
    const reponse = await fetch(`${base}/api/auth/me`);
    assert.equal(reponse.status, 503);
    assert.equal(((await reponse.json()) as { error: { code: string } }).error.code, 'DATABASE_UNAVAILABLE', 'le code que le navigateur redemande de lui-même');
    assert.match(reponse.headers.get('server-timing') ?? '', /sans reponse : application/, 'l’étape où elle est restée se lit de l’extérieur');
    assert.equal(reponse.headers.get('cache-control'), 'no-store');
    assert.equal(gestes.remplacements, 1);
    assert.ok(Date.now() - depart < 2_000);
  });

  it('les requêtes pendues échouent au remplacement : l’application répond elle-même, et personne ne répond deux fois', async () => {
    let enAttente: ServerResponse | null = null;
    const { base, gestes, quandRemplace } = await site((_request, response) => {
      enAttente = response;
    });
    // Ce que fait le serveur quand sa requête en base échoue : une erreur interne.
    quandRemplace(() => {
      enAttente!.statusCode = 500;
      enAttente!.setHeader('Content-Type', 'application/json');
      enAttente!.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }));
    });
    const reponse = await fetch(`${base}/api/workspace/custom_products`);
    assert.equal(reponse.status, 500);
    assert.equal(gestes.remplacements, 1);
    await new Promise((resolve) => setTimeout(resolve, 150)); // le délai de grâce passe sans seconde réponse
  });

  it('une lecture qui répond à temps, une action, une génération : le garde-fou ne touche à rien', async () => {
    const { base, gestes } = await site((request, response) => {
      const lente = request.url !== '/api/auth/me';
      setTimeout(() => response.end('{}'), lente ? 260 : 10);
    });
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 200);
    // Une action n'est jamais interrompue, même sur une adresse de lecture courte.
    assert.equal((await fetch(`${base}/api/workspace/custom_products`, { method: 'PUT', body: '{}' })).status, 200);
    // Une génération, un export, une recherche durent légitimement : hors du garde-fou.
    for (const chemin of ['/api/ebooks/generate', '/api/espionnage/searches/abc', '/api/healthcheck', '/api/auth/mes-sessions']) {
      assert.equal((await fetch(`${base}${chemin}`)).status, 200, chemin);
    }
    assert.equal(gestes.remplacements, 0);
  });
});

describe('le vrai pilote, contre une base qui ne répond plus', () => {
  const prises: Socket[] = [];
  /** Accepte la connexion et se tait : ce que voit une instance dont la connexion est morte en silence. */
  const muet = createServer((socket) => {
    prises.push(socket);
    socket.on('error', () => undefined);
  });

  after(async () => {
    for (const socket of prises) socket.destroy();
    await new Promise((resolve) => muet.close(resolve));
    await closeTestApp();
  });

  it('la requête pendue échoue dès le remplacement, et l’accès déjà obtenu sert encore', async () => {
    await createTestApp();
    const { closeDatabase, databaseAnswers, getDb, initDatabase, queryRows, renewDatabase } = await import('@server/db/client');
    await closeDatabase();
    await new Promise<void>((resolve) => muet.listen(0, '127.0.0.1', resolve));
    const port = (muet.address() as AddressInfo).port;
    await initDatabase(`postgresql://veille:veille@127.0.0.1:${port}/veille`, { migrate: false, maxConnections: 1 });
    // L'accès qu'une génération longue garde sous la main pendant qu'elle attend son fournisseur.
    const garde = getDb();

    // La requête d'un visiteur, partie dans le vide.
    const depart = Date.now();
    const pendue = queryRows(sql`select 1`).then(
      () => 'répondue',
      () => 'échouée',
    );
    assert.equal(await databaseAnswers(300), false, 'la sonde rend la main à son délai');
    assert.ok(Date.now() - depart < 2_000, 'sans attendre la base');

    renewDatabase();
    const sort = await Promise.race([pendue, new Promise((resolve) => setTimeout(() => resolve('toujours pendue'), 5_000))]);
    assert.equal(sort, 'échouée', 'la requête pendue est libérée');
    assert.ok(prises.length >= 1, 'le pilote s’était bien connecté au serveur muet');

    // L'accès gardé avant le remplacement passe par la connexion neuve : le serveur en voit arriver une de plus.
    assert.equal(getDb(), garde, 'getDb() rend toujours le même accès');
    const avant = prises.length;
    const apres = queryRows(sql`select 1`, garde).then(
      () => 'répondue',
      (error: unknown) => `échouée : ${error instanceof Error ? error.message : error}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.ok(prises.length > avant, 'une connexion neuve a été ouverte pour l’accès gardé');
    renewDatabase();
    assert.match(String(await apres), /^échouée/, 'et non refusée d’emblée : elle était bien partie vers la base');
    renewDatabase();
    await closeDatabase();
  });
});

describe('le point d’entrée sans serveur', () => {
  let serveur: Server | null = null;
  after(async () => {
    if (serveur) await new Promise((resolve) => serveur!.close(resolve));
    await closeTestApp();
  });

  it('sert une lecture courte de bout en bout, veille et garde-fou en place', async () => {
    await createTestApp();
    const { default: handler } = await import('@server/vercel');
    serveur = createHttpServer((request, response) => void handler(request, response));
    await new Promise<void>((resolve) => serveur!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;

    const sante = await fetch(`${base}/api/health`);
    assert.equal(sante.status, 200);
    assert.equal(((await sante.json()) as { database: boolean }).database, true);
    const session = await fetch(`${base}/api/auth/me`);
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { account: null });
  });
});
