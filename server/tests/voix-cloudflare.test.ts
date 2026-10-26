import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Voix gratuite du parcours audio (MeloTTS chez Cloudflare), depuis que le projet Gemini est bloqué
 * (25/10/2026). Ce qui doit tenir : le WAV rendu (44,1 kHz, mesuré sur l'API) est lu et ramené aux
 * 24 kHz du parcours audio, les passages sont mis bout à bout dans l'ordre, en français.
 */

/** Un WAV PCM 16 bits mono de `secondes` à `frequence` Hz, signal constant `valeur`. */
function wav(secondes: number, frequence: number, valeur: number): Buffer {
  const echantillons = Math.round(secondes * frequence);
  const data = Buffer.alloc(echantillons * 2);
  for (let i = 0; i < echantillons; i += 1) data.writeInt16LE(valeur, i * 2);
  const entete = Buffer.alloc(44);
  entete.write('RIFF', 0, 'ascii');
  entete.writeUInt32LE(36 + data.length, 4);
  entete.write('WAVE', 8, 'ascii');
  entete.write('fmt ', 12, 'ascii');
  entete.writeUInt32LE(16, 16);
  entete.writeUInt16LE(1, 20);
  entete.writeUInt16LE(1, 22);
  entete.writeUInt32LE(frequence, 24);
  entete.writeUInt32LE(frequence * 2, 28);
  entete.writeUInt16LE(2, 32);
  entete.writeUInt16LE(16, 34);
  entete.write('data', 36, 'ascii');
  entete.writeUInt32LE(data.length, 40);
  return Buffer.concat([entete, data]);
}

const demandes: { prompt: string; lang: string }[] = [];
const fauxCloudflare = createServer((req, res) => {
  let corps = '';
  req.on('data', (morceau) => (corps += morceau));
  req.on('end', () => {
    const demande = JSON.parse(corps) as { prompt: string; lang: string };
    demandes.push(demande);
    // Un passage = une seconde ; le premier passage parle « fort », le second « doucement » : l'ordre se vérifie.
    const valeur = demande.prompt.startsWith('Premier') ? 1000 : 200;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, result: { audio: wav(1, 44_100, valeur).toString('base64') } }));
  });
});

before(async () => {
  await new Promise<void>((r) => fauxCloudflare.listen(0, '127.0.0.1', r));
  await createTestApp({
    CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    CLOUDFLARE_AI_TOKEN: 'jeton-de-test',
    CLOUDFLARE_AI_URL: `http://127.0.0.1:${(fauxCloudflare.address() as AddressInfo).port}`,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fauxCloudflare.close(() => r()));
});

describe('Parcours audio — voix gratuite', () => {
  it('lit le WAV, le ramène à 24 kHz, et met les passages bout à bout dans l’ordre, en français', async () => {
    const { speakPassagesCloudflare } = await import('@server/services/ai/cloudflareSpeech');
    const audio = await speakPassagesCloudflare(['Premier passage.', 'Second passage.']);

    assert.deepEqual(
      demandes.map((d) => d.lang),
      ['fr', 'fr'],
    );
    assert.ok(Math.abs(audio.seconds - 2.6) < 0.05, `deux secondes de voix et un silence de 0,6 s (${audio.seconds} s)`);
    const debut = audio.pcm.readInt16LE(100);
    const fin = audio.pcm.readInt16LE(audio.pcm.length - 100);
    assert.equal(debut, 1000, 'le premier passage d’abord');
    assert.equal(fin, 200, 'le second ensuite');
  });

  it('refuse un fichier qui n’est pas un WAV au lieu de produire du bruit', async () => {
    const { pcmOfWav } = await import('@server/services/ai/cloudflareSpeech');
    assert.throws(() => pcmOfWav(Buffer.from('ID3 pas un wav du tout, mais quarante-quatre octets au moins')));
  });

  it('annonce une seule voix à l’écran quand la voix gratuite est branchée', async () => {
    const { default: request } = await import('supertest');
    const { createApp } = await import('@server/app');
    const { body } = await request(createApp()).get('/api/health').expect(200);
    assert.equal(body.providers.speech, true);
    assert.equal(body.providers.voiceChoice, false);
  });
});
