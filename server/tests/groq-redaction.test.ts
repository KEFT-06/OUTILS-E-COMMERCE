import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Rédaction par Groq quand Gemini refuse — le cas réel depuis le 18/10/2026 : crédits Google
 * prépayés épuisés, ebooks, contes et études à l'arrêt.
 *
 * Ce qui doit tenir, d'après la documentation de Groq (relue le 25/10/2026) :
 *   · une réponse en JSON imposé va à un modèle qui accepte un schéma (gpt-oss), jamais à
 *     llama-3.3-70b, qui le refuse par un 400 ;
 *   · le plafond de réponse tient dans les jetons par minute de l'offre gratuite, consigne comprise ;
 *   · trop long pour le modèle à schéma : second essai sur le modèle texte, schéma dans la consigne ;
 *   · une demande refusée pour son CONTENU par Gemini n'est pas retentée chez Groq.
 */

let geminiStatus = 402;
let groqReponses: ((corps: Record<string, unknown>) => { status: number; body: unknown })[] = [];
const recues: Record<string, unknown>[] = [];

const fauxGemini = createServer((_req, res) => {
  res.writeHead(geminiStatus, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code: geminiStatus, message: geminiStatus === 402 ? 'Your prepayment credits are depleted.' : 'Invalid argument', status: geminiStatus === 402 ? 'FAILED_PRECONDITION' : 'INVALID_ARGUMENT' } }));
});

const fauxGroq = createServer((req, res) => {
  let corps = '';
  req.on('data', (morceau) => (corps += morceau));
  req.on('end', () => {
    const demande = JSON.parse(corps) as Record<string, unknown>;
    recues.push(demande);
    const reponse = (groqReponses.shift() ?? (() => ({ status: 500, body: {} })))(demande);
    res.writeHead(reponse.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reponse.body));
  });
});

const ok = (contenu: unknown) => () => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify(contenu) }, finish_reason: 'stop' }] } });

const SERVICE = { name: 'service de rédaction', code: 'WRITING', log: 'rédaction' };
const SCHEMA = { type: 'OBJECT', properties: { titre: { type: 'STRING' }, modules: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['titre', 'modules'] };
const parse = (value: unknown) => {
  const v = value as { titre?: unknown; modules?: unknown };
  if (typeof v.titre !== 'string' || !Array.isArray(v.modules)) throw new Error('forme inattendue');
  return v as { titre: string; modules: string[] };
};

before(async () => {
  await new Promise<void>((r) => fauxGemini.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => fauxGroq.listen(0, '127.0.0.1', r));
  await createTestApp({
    GEMINI_API_URL: `http://127.0.0.1:${(fauxGemini.address() as AddressInfo).port}`,
    GROQ_API_KEY: 'gsk_cle_de_test',
    GROQ_API_URL: `http://127.0.0.1:${(fauxGroq.address() as AddressInfo).port}`,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => fauxGemini.close(() => r()));
  await new Promise<void>((r) => fauxGroq.close(() => r()));
});

beforeEach(() => {
  geminiStatus = 402;
  groqReponses = [];
  recues.length = 0;
});

describe('Rédaction — Groq en secours de Gemini', () => {
  it('Gemini à court de crédits : Groq rédige, avec un modèle qui accepte le schéma, dans le quota gratuit', async () => {
    const { generateJson } = await import('@server/services/ai/text');
    let modele = '';
    groqReponses = [ok({ titre: 'Élever des poulets en ville', modules: ['Le poulailler', 'Les soins'] })];

    const plan = await generateJson({ service: SERVICE, prefer: 'gemini', prompt: 'Plan d’un ebook sur l’élevage de poulets en ville.', responseSchema: SCHEMA, parse, timeoutMs: 20_000, onModel: (m) => (modele = m) });

    assert.equal(plan.titre, 'Élever des poulets en ville');
    assert.equal(modele, 'groq');
    const demande = recues[0]!;
    assert.equal(demande.model, 'openai/gpt-oss-120b', 'le modèle à schéma, pas llama-3.3-70b qui refuse les schémas');
    assert.deepEqual((demande.response_format as { type: string }).type, 'json_schema');
    assert.equal((demande.response_format as { json_schema: { strict: boolean } }).json_schema.strict, false, 'schéma « au mieux » : nos schémas ne remplissent pas les exigences du mode strict');
    assert.equal(demande.reasoning_effort, 'low');
    assert.ok((demande.max_tokens as number) <= 8_000 - 200, 'consigne + réponse tiennent dans 8 000 jetons par minute');
  });

  it('refusée comme trop grosse par Groq (413) : pas d’insistance sur le même modèle, l’erreur de Gemini reste', async () => {
    const { generateJson } = await import('@server/services/ai/text');
    groqReponses = [() => ({ status: 413, body: { error: { message: 'Request too large' } } })];
    await assert.rejects(generateJson({ service: SERVICE, prefer: 'gemini', prompt: 'Plan d’un guide.', responseSchema: SCHEMA, parse, timeoutMs: 20_000 }), { code: 'WRITING_INSUFFICIENT_CREDITS' });
    assert.equal(recues.length, 1, 'une seule demande : la même échouerait de même');
  });

  it('un modèle sans schéma natif reçoit la forme attendue dans sa consigne, en mode JSON', async () => {
    const { askGroq } = await import('@server/services/ai/groq');
    groqReponses = [ok({ titre: 'Guide', modules: [] })];
    await askGroq({ system: 'Plan.', prompt: 'Plan d’un guide.', maxTokens: 1_000, timeoutMs: 10_000, model: 'allam-2-7b', jsonSchema: { type: 'object', properties: { titre: { type: 'string' } } } });
    assert.deepEqual(recues[0]!.response_format, { type: 'json_object' });
    const systeme = (recues[0]!.messages as { role: string; content: string }[])[0]!.content;
    assert.match(systeme, /JSON/);
    assert.match(systeme, /"titre"/, 'la forme attendue est dans la consigne');
  });

  it('une demande trop longue pour l’offre gratuite ne part pas chez Groq : l’erreur de Gemini reste', async () => {
    const { generateJson } = await import('@server/services/ai/text');
    await assert.rejects(
      generateJson({ service: SERVICE, prefer: 'gemini', prompt: 'x'.repeat(60_000), responseSchema: SCHEMA, parse, timeoutMs: 20_000 }),
      { code: 'WRITING_INSUFFICIENT_CREDITS' },
    );
    assert.equal(recues.length, 0, 'aucune demande vouée au refus');
  });

  it('une demande refusée par Gemini pour son contenu n’est pas retentée chez Groq', async () => {
    geminiStatus = 400;
    const { generateJson } = await import('@server/services/ai/text');
    await assert.rejects(generateJson({ service: SERVICE, prefer: 'gemini', prompt: 'Plan.', responseSchema: SCHEMA, parse, timeoutMs: 20_000 }), { code: 'WRITING_FAILED' });
    assert.equal(recues.length, 0);
  });

  it('relecture d’une image avec un schéma : le modèle vision (qwen3.8) l’accepte nativement', async () => {
    const { askGroq } = await import('@server/services/ai/groq');
    groqReponses = [ok({ verdict: 'ok' })];
    await askGroq({ system: 'Relis la couverture.', prompt: 'Verdict ?', maxTokens: 500, timeoutMs: 10_000, images: [{ mimeType: 'image/png', bytes: Buffer.from('89504e47', 'hex') }], jsonSchema: { type: 'object', properties: { verdict: { type: 'string' } } } });
    assert.equal(recues[0]!.model, 'qwen/qwen3.8-27b', 'llama-4-scout a été retiré par Groq');
    assert.equal((recues[0]!.response_format as { type: string }).type, 'json_schema');
  });
});
