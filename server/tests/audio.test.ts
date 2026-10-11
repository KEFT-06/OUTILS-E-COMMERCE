import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Parcours audio, contre un faux service de voix : aucun vrai son n'est produit, mais le fichier
 * rendu est un vrai MP3, encodé pour de bon.
 *
 * Demande du propriétaire : « quand ça met parcours audio, ça devait rédiger l'ebook plus l'audio
 * téléchargeable ». Ce que ces tests verrouillent : un module rédigé devient une piste MP3 à
 * écouter et à télécharger ; elle est à son auteur seul ; elle se paie à la durée annoncée, et
 * rien n'est dû quand la lecture échoue.
 */

/** Un WAV comme le rend le service : un centième de seconde de son par caractère lu. */
function wav(texte: string): Buffer {
  const pcm = Buffer.alloc(texte.length * 480, 3);
  const entete = Buffer.alloc(44);
  entete.write('RIFF', 0, 'latin1');
  entete.writeUInt32LE(36 + pcm.length, 4);
  entete.write('WAVEfmt ', 8, 'latin1');
  entete.writeUInt32LE(16, 16);
  entete.writeUInt16LE(1, 20);
  entete.writeUInt16LE(1, 22);
  entete.writeUInt32LE(24_000, 24);
  entete.writeUInt32LE(48_000, 28);
  entete.writeUInt16LE(2, 32);
  entete.writeUInt16LE(16, 34);
  entete.write('data', 36, 'latin1');
  entete.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([entete, pcm]);
}

let refus: number | null = null;
const lectures: { text: string; voice: string; style: string | undefined }[] = [];

const fauxService = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      contents: { parts: { text: string; speech_metadata?: { style?: string } }[] }[];
      generationConfig: { speechConfig: { voiceConfig: { voice: string } } };
    };
    const part = body.contents[0]!.parts[0]!;
    lectures.push({ text: part.text, voice: body.generationConfig.speechConfig.voiceConfig.voice, style: part.speech_metadata?.style });
    res.writeHead(refus ?? 200, { 'content-type': 'application/json' });
    if (refus) return res.end(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'refus du faux service' } }));
    res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav(part.text).toString('base64') } }] } }] }));
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((resolve) => fauxService.listen(0, '127.0.0.1', resolve));
  app = await createTestApp({ GEMINI_API_URL: `http://127.0.0.1:${(fauxService.address() as AddressInfo).port}` });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fauxService.close(() => resolve()));
});

beforeEach(() => {
  refus = null;
  lectures.length = 0;
});

type Agent = Awaited<ReturnType<typeof signInWithPlan>>['agent'];
const solde = async (agent: Agent) => (await agent.get('/api/auth/me').expect(200)).body.account.credits.total as number;
const paragraphe = (sujet: string, phrases: number) => Array.from({ length: phrases }, (_, rang) => `Voici ce qu’il faut savoir sur ${sujet}, point numéro ${rang + 1}, expliqué simplement.`).join(' ');

const MODULE = {
  subjectId: 'texte-beignets-0001',
  position: 1,
  title: 'Choisir son emplacement',
  text: `Le **meilleur** emplacement n’est pas le plus passant.\n\n- ${paragraphe('l’emplacement', 6)}\n\nVoir https://exemple.com/plan pour la suite.`,
  voice: 'chaleureuse',
};

describe('Parcours audio — un module, une piste', () => {
  it('lit un module rédigé avec la voix choisie, et le remet en MP3 à écouter et à télécharger', async () => {
    const { agent } = await signInWithPlan(app, 'autrice-audio@exemple.test', 'pro');
    const avant = await solde(agent);

    const { body } = await agent.post('/api/audio/tracks').send(MODULE).expect(201);
    const piste = body.track as { id: string; position: number; title: string; voice: string; seconds: number; bytes: number };
    assert.deepEqual({ position: piste.position, title: piste.title, voice: piste.voice }, { position: 1, title: 'Choisir son emplacement', voice: 'chaleureuse' });
    assert.ok(piste.seconds >= 5 && piste.bytes > 10_000, `${piste.seconds} s, ${piste.bytes} octets`);

    // Ce qui est parti au service de voix : le titre d'abord, puis le texte tel qu'on le dit.
    assert.equal(lectures.length, 1);
    assert.equal(lectures[0]!.voice, 'Sulafat');
    assert.match(lectures[0]!.style ?? '', /chaleureuse/);
    assert.ok(lectures[0]!.text.startsWith('Choisir son emplacement.\n\nLe meilleur emplacement n’est pas le plus passant.'), lectures[0]!.text.slice(0, 90));
    assert.doesNotMatch(lectures[0]!.text, /\*\*|https?:|^- /m, 'ni gras, ni adresse, ni puce');

    // Le fichier : un vrai MP3 (trame MPEG-2 couche III), au poids annoncé.
    const fichier = await agent.get(`/api/audio/tracks/${piste.id}/file`).buffer(true).parse((res, done) => {
      const morceaux: Buffer[] = [];
      res.on('data', (morceau: Buffer) => morceaux.push(morceau));
      res.on('end', () => done(null, Buffer.concat(morceaux)));
    }).expect(200);
    assert.equal(fichier.headers['content-type'], 'audio/mpeg');
    const octets = fichier.body as Buffer;
    assert.equal(octets.length, piste.bytes);
    assert.deepEqual([octets[0], octets[1]! & 0xfe], [0xff, 0xf2], 'synchronisation d’une trame MPEG-2, couche III');
    assert.equal(fichier.headers['content-disposition'], undefined, 'à écouter dans la page');
    const telechargement = await agent.get(`/api/audio/tracks/${piste.id}/file?download=1`).expect(200);
    assert.equal(telechargement.headers['content-disposition'], 'attachment; filename="01-choisir-son-emplacement.mp3"');

    assert.equal(await solde(agent), avant - 1, 'moins de dix minutes : une tranche');
    const pistes = (await agent.get(`/api/audio/tracks?subjectId=${MODULE.subjectId}`).expect(200)).body.tracks as { id: string }[];
    assert.deepEqual(pistes.map((track) => track.id), [piste.id]);

    // La piste est à son auteur seul.
    const { agent: voisine } = await signInWithPlan(app, 'voisine-audio@exemple.test', 'pro');
    await voisine.get(`/api/audio/tracks/${piste.id}/file`).expect(404);
    await voisine.delete(`/api/audio/tracks/${piste.id}`).expect(404);
    assert.deepEqual((await voisine.get(`/api/audio/tracks?subjectId=${MODULE.subjectId}`).expect(200)).body.tracks, []);
  });

  it('remplace la piste d’un module relu, et range les pistes dans l’ordre des modules', async () => {
    const { agent } = await signInWithPlan(app, 'autrice-relit@exemple.test', 'pro');
    const troisieme = (await agent.post('/api/audio/tracks').send({ ...MODULE, position: 3, title: 'Tenir sa caisse' }).expect(201)).body.track as { id: string };
    const premiere = (await agent.post('/api/audio/tracks').send(MODULE).expect(201)).body.track as { id: string };
    const relue = (await agent.post('/api/audio/tracks').send({ ...MODULE, voice: 'posee' }).expect(201)).body.track as { id: string; voice: string };

    assert.notEqual(relue.id, premiere.id);
    assert.equal(lectures.at(-1)!.voice, 'Kore');
    const pistes = (await agent.get(`/api/audio/tracks?subjectId=${MODULE.subjectId}`).expect(200)).body.tracks as { id: string; position: number }[];
    assert.deepEqual(pistes.map((track) => [track.position, track.id]), [[1, relue.id], [3, troisieme.id]], 'une piste par module, la dernière lue');
    await agent.get(`/api/audio/tracks/${premiere.id}/file`).expect(404);
    // « Mes créations » sait quels ouvrages ont un parcours audio, et de quelle durée.
    const resume = (await agent.get('/api/audio/summary').expect(200)).body.subjects as { subjectId: string; tracks: number; seconds: number }[];
    assert.deepEqual(resume.map((subject) => [subject.subjectId, subject.tracks]), [[MODULE.subjectId, 2]]);
    assert.ok(resume[0]!.seconds > 10);

    await agent.delete(`/api/audio/tracks/${troisieme.id}`).expect(204);
    assert.equal((await agent.get(`/api/audio/tracks?subjectId=${MODULE.subjectId}`).expect(200)).body.tracks.length, 1);
  });

  it('compte par tranche de dix minutes entamée, sur la durée annoncée avant de lancer', async () => {
    const { audioMinutes } = await import('@server/shared/audio');
    const long = paragraphe('la tenue de la caisse', 150);
    const minutes = audioMinutes('Tenir sa caisse', long);
    assert.ok(minutes > 10 && minutes <= 20, `${minutes} minutes annoncées`);

    const { agent } = await signInWithPlan(app, 'autrice-longue@exemple.test', 'pro');
    const avant = await solde(agent);
    const { body } = await agent.post('/api/audio/tracks').send({ ...MODULE, position: 2, title: 'Tenir sa caisse', text: long }).expect(201);
    assert.ok(lectures.length >= 5, `${lectures.length} passages lus de front, puis assemblés`);
    assert.ok(body.track.seconds > 100);
    assert.equal(await solde(agent), avant - 2, 'entre dix et vingt minutes : deux tranches');
  });

  it('refuse une ligne de plan sans rien débiter, et rend les points quand la lecture échoue', async () => {
    const { agent } = await signInWithPlan(app, 'autrice-refus@exemple.test', 'pro');
    const avant = await solde(agent);

    await agent.post('/api/audio/tracks').send({ ...MODULE, text: 'Module à rédiger.' }).expect(400);
    await agent.post('/api/audio/tracks').send({ ...MODULE, voice: 'robot' }).expect(400);
    assert.equal(lectures.length, 0, 'refusés avant toute lecture');

    refus = 403;
    const echec = await agent.post('/api/audio/tracks').send(MODULE).expect(503);
    assert.doesNotMatch(JSON.stringify(echec.body), /Gemini|Google/, 'aucun nom de fournisseur');
    assert.equal(await solde(agent), avant, 'points rendus');
    assert.deepEqual((await agent.get(`/api/audio/tracks?subjectId=${MODULE.subjectId}`).expect(200)).body.tracks, []);

    const { agent: gratuit } = await signInWithPlan(app, 'visiteur-audio@exemple.test', 'free');
    refus = null;
    const horsPalier = await gratuit.post('/api/audio/tracks').send(MODULE);
    assert.ok([201, 403].includes(horsPalier.status), 'selon que le palier gratuit inclut ou non la rédaction');
  });

  it('efface les pistes dont la conservation est échue', async () => {
    const { getDb } = await import('@server/db/client');
    const { audioTracks } = await import('@server/db/schema');
    const { purgeExpiredAudio } = await import('@server/services/audio');
    const { eq } = await import('drizzle-orm');

    const { agent } = await signInWithPlan(app, 'autrice-echeance@exemple.test', 'pro');
    const piste = (await agent.post('/api/audio/tracks').send(MODULE).expect(201)).body.track as { id: string };
    assert.deepEqual(await purgeExpiredAudio(), { purged: 0 }, 'rien n’est échu');

    await getDb().update(audioTracks).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(audioTracks.id, piste.id));
    assert.deepEqual(await purgeExpiredAudio(), { purged: 1 });
    await agent.get(`/api/audio/tracks/${piste.id}/file`).expect(404);
  });
});
