import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Rédaction en tâche de fond chez le fournisseur : la fiche enrichie demande une à deux minutes,
 * et une requête gardée ouverte aussi longtemps se faisait couper (essai réel du 29/09/2026).
 * La tâche est lancée, puis suivie ; une coupure pendant le suivi ne la fait pas échouer.
 */

let suivis = 0;
const lancements: { background?: boolean }[] = [];
const TEXTE = 'Un rapport complet et utile. '.repeat(20);

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && req.url === '/v1/agent') {
      lancements.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as { background?: boolean });
      return send(200, { id: 'tache-1', status: 'queued', output: [] });
    }
    if (req.method === 'GET' && req.url === '/v1/agent/tache-1') {
      suivis += 1;
      // Deuxième suivi : la connexion tombe, comme sur un réseau capricieux.
      if (suivis === 2) return req.socket.destroy();
      if (suivis < 4) return send(200, { id: 'tache-1', status: 'in_progress', output: [] });
      return send(200, { id: 'tache-1', status: 'completed', model: 'openai/gpt-6-luna', output: [{ type: 'message', content: [{ type: 'output_text', text: TEXTE }] }] });
    }
    send(404, {});
  });
});

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  await createTestApp({ PERPLEXITY_API_KEY: 'cle-perplexity-de-test', PERPLEXITY_API_URL: `http://127.0.0.1:${(faux.address() as AddressInfo).port}` });
});
after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

describe('Rédaction en tâche de fond', () => {
  it('lance la tâche, la suit malgré une coupure, et rend le texte', async () => {
    const { generateTextWithPerplexity } = await import('@server/services/ai/perplexity');
    const { text, model } = await generateTextWithPerplexity({
      service: { name: 'service de test', code: 'TEST', log: 'test' },
      prompt: 'Rédige.',
      minChars: 100,
      timeoutMs: 60_000,
    });
    assert.equal(lancements.length, 1, 'une seule tâche lancée');
    assert.equal(lancements[0]!.background, true, 'en tâche de fond');
    assert.ok(suivis >= 4, 'suivie jusqu’au bout');
    assert.equal(text, TEXTE.trim());
    assert.equal(model, 'openai/gpt-6-luna');
  });
});
