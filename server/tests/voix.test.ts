import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Lecture à voix haute, contre un faux service de synthèse vocale : aucun vrai son n'est produit.
 *
 * Ce que ces tests verrouillent : ce qui part au service est ce qu'un lecteur dirait (ni dièses,
 * ni adresses) ; un chapitre se coupe sans perdre un mot ; les passages reviennent dans l'ordre,
 * et le son rendu est lu bloc par bloc, pas à une position supposée.
 */

/** Un vingtième de seconde de « son » par caractère : chaque passage se reconnaît à sa longueur. */
const echantillons = (texte: string) => Buffer.alloc(texte.length * 2_400, 1);

/** Un WAV comme le rend le service — avec, au besoin, un bloc d'informations avant le son. */
function wav(pcm: Buffer, options: { avecInfos?: boolean; frequence?: number } = {}): Buffer {
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'latin1');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(options.frequence ?? 24_000, 12);
  fmt.writeUInt32LE((options.frequence ?? 24_000) * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const infos = options.avecInfos ? Buffer.concat([Buffer.from('LIST', 'latin1'), Buffer.from([5, 0, 0, 0]), Buffer.from('INFOx', 'latin1'), Buffer.from([0])]) : Buffer.alloc(0);
  const data = Buffer.alloc(8);
  data.write('data', 0, 'latin1');
  data.writeUInt32LE(pcm.length, 4);
  const corps = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, infos, data, pcm]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(corps.length, 4);
  return Buffer.concat([riff, corps]);
}

/** Réponse du faux service, par modèle : un code HTTP, ou « ok ». */
let reponses: Record<string, number | 'ok'> = {};
const demandes: { model: string; text: string; style: string | undefined; voice: string | undefined; key: string | undefined }[] = [];

const fauxService = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const model = /\/models\/([\w.-]+):generateContent$/.exec(req.url ?? '')?.[1] ?? '';
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      contents: { parts: { text: string; speech_metadata?: { style?: string } }[] }[];
      generationConfig: { responseModalities: string[]; speechConfig: { voiceConfig: { voice: string } } };
    };
    const part = body.contents[0]!.parts[0]!;
    demandes.push({ model, text: part.text, style: part.speech_metadata?.style, voice: body.generationConfig.speechConfig.voiceConfig.voice, key: req.headers['x-goog-api-key'] as string | undefined });
    const reponse = reponses[model] ?? 'ok';
    res.writeHead(reponse === 'ok' ? 200 : reponse, { 'content-type': 'application/json' });
    if (reponse !== 'ok') return res.end(JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'refus du faux service' } }));
    // Le passage le plus long répond le dernier : l'ordre d'arrivée n'est pas l'ordre du texte.
    setTimeout(
      () => res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav(echantillons(part.text), { avecInfos: true }).toString('base64') } }] } }] })),
      part.text.length > 20 ? 40 : 0,
    );
  });
});

before(async () => {
  await new Promise<void>((resolve) => fauxService.listen(0, '127.0.0.1', resolve));
  await createTestApp({ GEMINI_API_URL: `http://127.0.0.1:${(fauxService.address() as AddressInfo).port}` });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((resolve) => fauxService.close(() => resolve()));
});

beforeEach(() => {
  reponses = {};
  demandes.length = 0;
});

describe('Du texte écrit au texte lu', () => {
  it('rend ce qu’un lecteur dirait : ni dièses, ni gras, ni adresses, et une pause après chaque titre', async () => {
    const { spokenText } = await import('@server/shared/speech');
    const lu = spokenText(
      [
        '## Choisir son emplacement',
        '',
        'Le **meilleur** emplacement n’est pas le plus passant : c’est celui où l’on *s’arrête*. Voyez [ce guide](https://exemple.com/guide) ou https://exemple.com/plan.',
        '',
        '- Un arrêt de taxi',
        '- L’entrée d’un marché.',
        '1. Compter les passants',
        '',
        '| Jour | Ventes |',
        '| --- | --- |',
        '| Lundi | 40 |',
        '',
        '---',
        '> Notez tout dans un `cahier`. Écrivez à moi@exemple.com pour la suite.',
      ].join('\n'),
    );
    assert.deepEqual(lu.split('\n'), [
      'Choisir son emplacement.',
      '',
      'Le meilleur emplacement n’est pas le plus passant : c’est celui où l’on s’arrête. Voyez ce guide ou',
      '',
      'Un arrêt de taxi.',
      'L’entrée d’un marché.',
      'Compter les passants.',
      '',
      'Jour, Ventes.',
      'Lundi, 40.',
      '',
      'Notez tout dans un cahier. Écrivez à pour la suite.',
    ]);
  });

  it('coupe un chapitre entre deux paragraphes, puis entre deux phrases, sans perdre ni répéter un mot', async () => {
    const { splitForSpeech, speechSeconds } = await import('@server/shared/speech');
    const phrase = (rang: number) => `Voici la phrase numéro ${rang}, assez longue pour compter dans le passage.`;
    const paragraphes = [Array.from({ length: 4 }, (_, i) => phrase(i)).join(' '), Array.from({ length: 30 }, (_, i) => phrase(100 + i)).join(' '), phrase(999)];
    const texte = paragraphes.join('\n\n');

    const passages = splitForSpeech(texte, 600);
    assert.ok(passages.length >= 4);
    assert.ok(passages.every((passage) => passage.length <= 600), 'aucun passage ne dépasse la taille demandée');
    assert.ok(passages.slice(0, -1).every((passage) => /[.!?]$/.test(passage)), 'chaque passage finit sur une phrase entière');
    assert.equal(passages.join(' ').replace(/\s+/g, ' '), texte.replace(/\s+/g, ' '), 'tout le texte, une seule fois');
    assert.deepEqual(splitForSpeech('Un seul paragraphe court.'), ['Un seul paragraphe court.']);
    assert.deepEqual(splitForSpeech('  \n\n '), []);
    // 1 600 caractères lus : cent secondes au débit mesuré.
    assert.equal(speechSeconds('a'.repeat(1_600)), 100);
  });
});

describe('Synthèse vocale', () => {
  it('lit le son bloc par bloc, et refait un fichier complet autour des échantillons', async () => {
    const { pcmOf, secondsOf, wavOf } = await import('@server/services/ai/geminiSpeech');
    const pcm = Buffer.from(Array.from({ length: 48_000 }, (_, i) => i % 251));

    assert.ok(pcmOf(wav(pcm)).equals(pcm));
    assert.ok(pcmOf(wav(pcm, { avecInfos: true })).equals(pcm), 'un bloc d’informations avant le son n’est pas pris pour du son');
    assert.ok(pcmOf(pcm).equals(pcm), 'une réponse sans en-tête est du son brut');
    assert.throws(() => pcmOf(wav(pcm, { frequence: 16_000 })), /n’a pas pu être produite/, 'un autre format que celui attendu n’est pas assemblé de travers');

    const fichier = wavOf(pcm);
    assert.equal(fichier.length, 44 + pcm.length);
    assert.deepEqual([fichier.toString('latin1', 0, 4), fichier.readUInt32LE(24), fichier.readUInt16LE(34), fichier.readUInt32LE(40)], ['RIFF', 24_000, 16, pcm.length]);
    assert.ok(pcmOf(fichier).equals(pcm), 'aller et retour sans perte');
    assert.equal(secondsOf(pcm), 1);
  });

  it('demande la lecture mot pour mot, avec la voix et la façon de dire, et rend ses échantillons', async () => {
    const { synthesizeSpeech } = await import('@server/services/ai/geminiSpeech');
    const audio = await synthesizeSpeech({ text: 'Bonjour à toutes et à tous, bienvenue.', voice: 'Kore', style: 'voix posée de formateur' });

    assert.equal(demandes.length, 1);
    assert.deepEqual(demandes[0], { model: 'gemini-3.8-flash-tts', text: 'Bonjour à toutes et à tous, bienvenue.', style: 'voix posée de formateur', voice: 'Kore', key: 'cle-gemini-de-test' });
    assert.equal(audio.pcm.length, 'Bonjour à toutes et à tous, bienvenue.'.length * 2_400);
    assert.equal(audio.model, 'gemini-3.8-flash-tts');
  });

  it('passe au second modèle quand le premier sature, et ne rejoue pas un refus d’accès', async () => {
    const { synthesizeSpeech } = await import('@server/services/ai/geminiSpeech');
    reponses = { 'gemini-3.8-flash-tts': 503 };
    const audio = await synthesizeSpeech({ text: 'Un passage lu malgré la saturation du premier modèle.', voice: 'Kore' });
    assert.equal(audio.model, 'gemini-3.8-flash-lite-tts');
    assert.deepEqual(demandes.map((demande) => demande.model), ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']);

    demandes.length = 0;
    reponses = { 'gemini-3.8-flash-tts': 403 };
    await assert.rejects(synthesizeSpeech({ text: 'Accès refusé.', voice: 'Kore' }), (error: { code?: string }) => error.code === 'GEMINI_SPEECH_ACCESS_DENIED');
    assert.equal(demandes.length, 1, 'le second modèle partage la même clé : il refuserait de même');

    reponses = { 'gemini-3.8-flash-tts': 429, 'gemini-3.8-flash-lite-tts': 429 };
    await assert.rejects(synthesizeSpeech({ text: 'Trop de demandes.', voice: 'Kore' }), (error: { code?: string; message?: string }) => error.code === 'GEMINI_SPEECH_RATE_LIMITED' && /points ont été rendus/.test(error.message ?? ''));
  });

  it('met les passages bout à bout dans l’ordre du texte, quel que soit l’ordre où ils reviennent', async () => {
    const { speakPassages } = await import('@server/services/ai/geminiSpeech');
    const passages = ['Premier passage, le plus long des trois, qui reviendra donc le dernier.', 'Deuxième.', 'Troisième, court.'];
    const audio = await speakPassages(passages, { voice: 'Kore', concurrency: 3 });

    const silence = Math.round(48_000 * 0.35);
    assert.equal(audio.pcm.length, passages.reduce((total, passage) => total + passage.length * 2_400, 0) + 2 * silence);
    // Le premier passage ouvre bien le fichier : ses échantillons (des 1), puis un silence (des 0).
    const fin = passages[0]!.length * 2_400;
    assert.deepEqual([audio.pcm[0], audio.pcm[fin - 1], audio.pcm[fin], audio.pcm[fin + silence - 1], audio.pcm[fin + silence]], [1, 1, 0, 0, 1]);
    assert.equal(demandes.length, 3);
  });
});
