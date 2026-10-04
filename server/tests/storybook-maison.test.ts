import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import jpeg from 'jpeg-js';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Conte illustré par le serveur : une planche de référence des personnages, donnée en modèle à
 * chaque page, pour garder le même visage d'un bout à l'autre du livre.
 *
 * Contre un faux moteur d'images, un faux stockage et un faux circuit de secours : aucune image
 * réelle, aucun fichier déposé chez le propriétaire, aucun crédit consommé.
 */

const CLE_STOCKAGE = 'cle-de-stockage-de-test';
const IMAGE = Buffer.from(jpeg.encode({ data: Buffer.alloc(40 * 30 * 4, 180), width: 40, height: 30 }, 90).data);

interface DemandeImage {
  model: string;
  prompt: string;
  /** Vrai quand la planche de référence accompagne la consigne. */
  avecPlanche: boolean;
  format: string;
}

const demandes: DemandeImage[] = [];
const fichiers = new Map<string, { type: string; octets: Buffer }>();
const envoisSecours: string[] = [];
/** Comportement du faux moteur d'images, réglé par chaque test. */
const moteur = { plancheRefusee: false, pagesFermees: false, sceneRefusee: '' };

const lireCorps = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const morceaux: Buffer[] = [];
    req.on('data', (morceau: Buffer) => morceaux.push(morceau));
    req.on('end', () => resolve(Buffer.concat(morceaux)));
  });

const fauxFournisseurs = createServer((req, res) => {
  void lireCorps(req).then((corps) => {
    const url = new URL(req.url ?? '/', 'http://fournisseurs.test');
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const lu = () => (corps.length ? (JSON.parse(corps.toString('utf8')) as Record<string, unknown>) : {});

    /* ---- Moteur d'images ---- */
    const modele = /^\/gemini\/v1beta\/models\/([^:]+):generateContent$/.exec(url.pathname);
    if (modele && req.method === 'POST') {
      const body = lu() as {
        contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
        generationConfig?: { responseModalities?: string[]; imageConfig?: { aspectRatio?: string } };
      };
      const parts = body.contents[0]!.parts;
      const prompt = parts.find((part) => part.text)?.text ?? '';
      const avecPlanche = parts.some((part) => part.inlineData);
      demandes.push({ model: modele[1]!, prompt, avecPlanche, format: body.generationConfig?.imageConfig?.aspectRatio ?? '' });

      if (!avecPlanche && moteur.plancheRefusee) return json(403, { error: { status: 'PERMISSION_DENIED', message: 'fermé' } });
      if (avecPlanche && moteur.pagesFermees) return json(403, { error: { status: 'PERMISSION_DENIED', message: 'fermé' } });
      // Le filtre refuse la scène écrite, mais laisse passer sa version adoucie.
      if (moteur.sceneRefusee && prompt.includes(moteur.sceneRefusee) && !prompt.includes('Calm, gentle')) {
        return json(200, { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] });
      }
      return json(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: IMAGE.toString('base64') } }] } }] });
    }

    /* ---- Stockage de fichiers ---- */
    if (url.pathname.startsWith('/storage/v1/')) {
      if (req.headers.authorization !== `Bearer ${CLE_STOCKAGE}`) return json(401, {});
      if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') return json(200, { name: 'contes' });
      if (req.method === 'POST' && url.pathname === '/storage/v1/object/list/contes') {
        const prefixe = `${String(lu().prefix)}/`;
        return json(
          200,
          [...fichiers.keys()].filter((chemin) => chemin.startsWith(prefixe)).map((chemin) => ({ name: chemin.slice(prefixe.length), created_at: new Date().toISOString() })),
        );
      }
      if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/contes') {
        for (const chemin of lu().prefixes as string[]) fichiers.delete(chemin);
        return json(200, []);
      }
      const lecture = /^\/storage\/v1\/object\/authenticated\/contes\/(.+)$/.exec(url.pathname);
      if (lecture && req.method === 'GET') {
        const fichier = fichiers.get(decodeURIComponent(lecture[1]!));
        if (!fichier) return json(404, {});
        res.writeHead(200, { 'content-type': fichier.type });
        return res.end(fichier.octets);
      }
      const depot = /^\/storage\/v1\/object\/contes\/(.+)$/.exec(url.pathname);
      if (depot && req.method === 'POST') {
        fichiers.set(decodeURIComponent(depot[1]!), { type: String(req.headers['content-type']), octets: corps });
        return json(200, { Key: depot[1] });
      }
    }

    /* ---- Circuit de secours ---- */
    if (url.pathname === '/secours/v1.0/generations' && req.method === 'POST') {
      envoisSecours.push(String(lu().inputText));
      return json(200, { generationId: `gen_secours_${envoisSecours.length}` });
    }
    json(404, {});
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fauxFournisseurs.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fauxFournisseurs.address() as AddressInfo).port}`;
  app = await createTestApp({
    GEMINI_API_URL: `${base}/gemini`,
    SUPABASE_API_SECRET_KEY: CLE_STOCKAGE,
    SUPABASE_URL: base,
    GAMMA_API_KEY: 'cle-de-secours-de-test',
    GAMMA_API_URL: `${base}/secours`,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fauxFournisseurs.close(() => resolve()));
});

const BRIEF = {
  country: 'CM',
  language: 'fr',
  ageRange: '6-8',
  pages: 4,
  heroName: 'Awa',
  theme: 'Awa apprend à planter un manguier avec son grand-père',
  visualStyle: 'aquarelle aux couleurs chaudes',
};

const conte = (titre = 'Awa et le manguier') => ({
  title: titre,
  characterSheet: 'Seven-year-old Cameroonian girl, two puff braids with yellow ribbons, green wrap dress',
  cast: [{ name: 'Grandfather Tata', sheet: 'Elderly man, white beard, round glasses, sky-blue boubou' }],
  coverIllustration: 'Awa smiling under a young mango tree at sunrise.',
  pages: Array.from({ length: 4 }, (_, rang) => ({
    heading: `Scène ${rang + 1}`,
    text: `Awa découvre la scène ${rang + 1} avec son grand-père — « regarde ! » dit-il.`,
    illustration: `Awa and Grandfather Tata in the garden, moment ${rang + 1}. Warm morning light.`,
  })),
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Suit le conte comme l'écran, jusqu'à ce qu'il ne soit plus en cours. */
async function suivre(agent: Awaited<ReturnType<typeof signInWithPlan>>['agent'], generationId: string) {
  for (let essai = 0; essai < 200; essai += 1) {
    const suivi = await agent.get(`/api/storybook/generations/${generationId}`).expect(200);
    if (suivi.body.status !== 'pending') return suivi.body as { status: string; storybookId: string; progress: { done: number; total: number }; errorMessage?: string };
    await pause(25);
  }
  throw new Error('le conte est resté en cours');
}

const points = async (agent: Awaited<ReturnType<typeof signInWithPlan>>['agent']) =>
  (await agent.get('/api/account/credits').expect(200)).body.credits.total as number;

describe('Conte illustré par le serveur', () => {
  it('dessine une planche des personnages, la donne en modèle à chaque page, et assemble le PDF', async () => {
    const { agent } = await signInWithPlan(app, 'conteuse-maison@exemple.com', 'pro');
    const depart = await points(agent);
    const avant = demandes.length;

    const cree = await agent.post('/api/storybook/generations').send({ ...BRIEF, story: conte() }).expect(202);
    const { generationId, storybookId } = cree.body as { generationId: string; storybookId: string };
    assert.match(generationId, /^conte_[0-9a-f-]{36}$/, 'conte illustré ici, pas par le circuit de secours');
    assert.equal(envoisSecours.length, 0);

    const fini = await suivre(agent, generationId);
    assert.equal(fini.status, 'completed');
    assert.equal(fini.storybookId, storybookId);
    assert.deepEqual(fini.progress, { done: 5, total: 5 }, 'couverture + 4 pages');

    // La planche : les deux personnages côte à côte, sans image en entrée, dans le style demandé.
    const miennes = demandes.slice(avant);
    const [planche, ...pages] = miennes;
    assert.equal(planche!.avecPlanche, false);
    assert.equal(planche!.format, '4:3', 'plusieurs personnages : planche en largeur');
    assert.match(planche!.prompt, /1\. Awa: Seven-year-old Cameroonian girl/);
    assert.match(planche!.prompt, /2\. Grandfather Tata: Elderly man, white beard/);
    assert.match(planche!.prompt, /aquarelle aux couleurs chaudes/);
    assert.equal(planche!.model, 'gemini-3.1-flash-image', 'modèle des contes, pas le modèle Pro des publicités');

    // Chaque page : la planche en modèle, les personnages nommés dans l'ordre, la scène, le pays.
    assert.equal(pages.length, 5);
    assert.ok(pages.every((page) => page.avecPlanche), 'aucune page n’est dessinée sans la planche');
    assert.ok(pages.every((page) => /From left to right: Awa, Grandfather Tata\./.test(page.prompt)));
    assert.ok(pages.every((page) => /must look EXACTLY like its reference/.test(page.prompt)));
    assert.ok(pages.every((page) => /Setting: Cameroon\./.test(page.prompt)));
    const couverture = pages.find((page) => /COVER of the book/.test(page.prompt))!;
    assert.equal(couverture.format, '3:4');
    assert.match(couverture.prompt, /Scene: Awa smiling under a young mango tree/);
    for (let rang = 1; rang <= 4; rang += 1) {
      const page = pages.find((entry) => entry.prompt.includes(`moment ${rang}.`));
      assert.ok(page, `page ${rang} dessinée`);
      assert.equal(page.format, '4:3');
    }

    // Les fichiers : la planche et les cinq images, dans le dossier du conte.
    const dossier = [...fichiers.keys()].filter((chemin) => chemin.startsWith(`${generationId}/`)).sort();
    assert.deepEqual(dossier, ['page-0', 'page-1', 'page-2', 'page-3', 'page-4', 'planche'].map((nom) => `${generationId}/${nom}`));

    // « Mes contes » : prêt, avec les rangs illustrés ; l'illustration d'une page se lit.
    const liste = await agent.get('/api/storybook/books').expect(200);
    const [entree] = liste.body.storybooks as { id: string; status: string; pictures: number[]; story: { cast: unknown[] } }[];
    assert.equal(entree!.status, 'completed');
    assert.deepEqual(entree!.pictures, [0, 1, 2, 3, 4]);
    assert.equal(entree!.story.cast.length, 1, 'les personnages secondaires sont gardés avec le conte');
    const image = await agent.get(`/api/storybook/books/${storybookId}/pages/2`).buffer(true).expect(200);
    assert.equal(image.headers['content-type'], 'image/jpeg');
    assert.ok((image.body as Buffer).length > 100);
    await agent.get(`/api/storybook/books/${storybookId}/pages/9`).expect(404);

    // Le PDF : assemblé par le serveur, une couverture et une page par scène, puis gardé.
    const pdf = await agent.get(`/api/storybook/books/${storybookId}/pdf`).buffer(true).expect(200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.match(pdf.headers['content-disposition'] ?? '', /attachment; filename="Awa-et-le-manguier\.pdf"/);
    const contenu = (pdf.body as Buffer).toString('latin1');
    assert.ok(contenu.startsWith('%PDF'));
    assert.equal((contenu.match(/\/Type \/Page\b/g) ?? []).length, 5, 'couverture + 4 pages');
    assert.ok(fichiers.has(`${generationId}/conte.pdf`), 'le PDF assemblé est gardé pour les téléchargements suivants');
    const encore = await agent.get(`/api/storybook/books/${storybookId}/pdf`).buffer(true).expect(200);
    assert.ok((encore.body as Buffer).equals(pdf.body as Buffer));

    assert.equal(await points(agent), depart - 12, 'l’illustration seule : douze points, gardés puisque le conte est prêt');

    const { agent: voisin } = await signInWithPlan(app, 'voisin-maison@exemple.com', 'pro');
    await voisin.get(`/api/storybook/generations/${generationId}`).expect(404);
    await voisin.get(`/api/storybook/books/${storybookId}/pdf`).expect(404);
    await voisin.get(`/api/storybook/books/${storybookId}/pages/0`).expect(404);
  });

  it('adoucit une scène refusée par le filtre au lieu d’abandonner le conte', async () => {
    const { agent } = await signInWithPlan(app, 'conteuse-filtre@exemple.com', 'pro');
    const histoire = conte('Awa sous l’orage');
    histoire.pages[1]!.illustration = 'Awa alone in a violent thunderstorm at night. She is terrified.';
    moteur.sceneRefusee = 'She is terrified';
    const avant = demandes.length;
    try {
      const cree = await agent.post('/api/storybook/generations').send({ ...BRIEF, story: histoire }).expect(202);
      const fini = await suivre(agent, cree.body.generationId as string);
      assert.equal(fini.status, 'completed', 'le conte aboutit malgré le refus');
      assert.deepEqual(fini.progress, { done: 5, total: 5 });
    } finally {
      moteur.sceneRefusee = '';
    }
    const adoucie = demandes.slice(avant).find((demande) => demande.prompt.includes('Calm, gentle'));
    assert.ok(adoucie, 'la scène est redemandée adoucie');
    assert.match(adoucie.prompt, /Scene: Awa alone in a violent thunderstorm at night\. Calm, gentle, reassuring mood\./, 'seule sa première phrase est gardée');
    assert.ok(adoucie.avecPlanche, 'toujours d’après la planche');
  });

  it('passe par le circuit de secours quand le moteur d’images refuse la planche', async () => {
    const { agent } = await signInWithPlan(app, 'conteuse-secours@exemple.com', 'pro');
    const depart = await points(agent);
    moteur.plancheRefusee = true;
    try {
      const cree = await agent.post('/api/storybook/generations').send({ ...BRIEF, story: conte('Awa au marché') }).expect(202);
      assert.match(cree.body.generationId as string, /^gen_secours_/, 'le conte part quand même');
    } finally {
      moteur.plancheRefusee = false;
    }
    assert.match(envoisSecours.at(-1)!, /^# Awa au marché/);
    assert.equal(await points(agent), depart - 12);
    const [entree] = (await agent.get('/api/storybook/books').expect(200)).body.storybooks as { pictures: number[]; status: string }[];
    assert.equal(entree!.status, 'pending');
    assert.deepEqual(entree!.pictures, [], 'aucune illustration à afficher pour un conte du circuit de secours');
  });

  it('rend les points et efface les fichiers quand le moteur se ferme en cours de route', async () => {
    const { agent } = await signInWithPlan(app, 'conteuse-fermee@exemple.com', 'pro');
    const depart = await points(agent);
    moteur.pagesFermees = true;
    let generationId = '';
    try {
      const cree = await agent.post('/api/storybook/generations').send({ ...BRIEF, story: conte('Awa attend') }).expect(202);
      generationId = cree.body.generationId as string;
      assert.match(generationId, /^conte_/);
      const fini = await suivre(agent, generationId);
      assert.equal(fini.status, 'failed');
      assert.match(fini.errorMessage ?? '', /points ont été rendus/);
    } finally {
      moteur.pagesFermees = false;
    }
    assert.equal(await points(agent), depart, 'points rendus');
    assert.deepEqual([...fichiers.keys()].filter((chemin) => chemin.startsWith(`${generationId}/`)), [], 'planche effacée');
    const [entree] = (await agent.get('/api/storybook/books').expect(200)).body.storybooks as { status: string }[];
    assert.equal(entree!.status, 'failed');
  });

  it('demande à l’auteur des fiches de personnages secondaires, et les borne', async () => {
    const { buildStoryPrompt, parseStory } = await import('@server/services/storybook');
    const prompt = buildStoryPrompt({ ...BRIEF, language: 'fr', ageRange: '6-8' } as never);
    assert.match(prompt, /cast : au plus deux personnages secondaires RÉCURRENTS/);

    const lu = parseStory(
      {
        ...conte(),
        cast: [
          { name: 'Grandfather Tata', sheet: 'Elderly man' },
          { name: '', sheet: 'sans nom : écarté' },
          { name: 'Mama Ngo', sheet: 'Tall woman, red headwrap' },
          { name: 'Petit Paul', sheet: 'Boy, blue shorts' },
        ],
      },
      4,
    );
    assert.deepEqual(
      lu.cast?.map((membre) => membre.name),
      ['Grandfather Tata', 'Mama Ngo'],
      'deux au plus : une planche à quatre personnages ne se lit plus',
    );
    assert.deepEqual(parseStory({ ...conte(), cast: undefined }, 4).cast, [], 'un conte sans personnage secondaire reste valable');
  });

  it('assemble un PDF lisible : accents gardés, texte long poursuivi sur une autre page', async () => {
    const { buildStorybookPdf, typeset } = await import('@server/services/storybook/pdf');
    // En français, un guillemet ou un signe double ne reste jamais seul en bout de ligne.
    const insecable = String.fromCharCode(160);
    assert.equal(typeset('Il dit : « Viens ! »', 'fr'), `Il dit${insecable}: «${insecable}Viens${insecable}!${insecable}»`);
    assert.equal(typeset('He said: "Come!"', 'en'), 'He said: "Come!"', 'l’anglais garde ses espaces');
    assert.equal(typeset('Awa 🎬 sourit', 'fr'), 'Awa  sourit', 'un signe que la police ne sait pas imprimer est retiré, pas la ligne');

    const long ='Awa écoute son grand-père raconter l’histoire du manguier, cœur battant. '.repeat(40);
    const pdf = buildStorybookPdf(
      { title: 'Le manguier d’Awa — œuvre d’été', language: 'fr', pages: [{ heading: 'Le début', text: 'Court.' }, { heading: 'La suite', text: long }] },
      new Map([
        [0, { mimeType: 'image/jpeg', bytes: IMAGE }],
        [1, { mimeType: 'image/jpeg', bytes: IMAGE }],
      ]),
    );
    const contenu = pdf.toString('latin1');
    assert.ok(contenu.startsWith('%PDF'));
    const pages = (contenu.match(/\/Type \/Page\b/g) ?? []).length;
    assert.ok(pages >= 4, `couverture, page 1, page 2 et sa suite : ${pages} pages`);
  });
});
