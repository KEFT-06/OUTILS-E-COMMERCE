import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Faux Gemini et fausse recherche Perplexity pour les tests d'analyse de niche. La réponse
 * du faux modèle contient volontairement des pièges : une source inexistante, un
 * lien inventé, un doublon de mot-clé, une phase de script inconnue. Le serveur
 * doit les écarter.
 */

export interface FakeCall {
  key: string | undefined;
  prompt: string;
}

export function fakeAnalysis(prompt: string) {
  const withSources = prompt.includes('SOURCES (résultats de recherche web');
  const ids = withSources ? [1, 2] : [];
  return {
    nicheName: 'Élevage de poulets en ville',
    executiveSummary: withSources ? 'Des guides payants existent déjà [1] [2].' : 'Les faits de marché n’ont pas été étudiés.',
    summarySourceIds: ids,
    verdict: 'Opportunité Forte',
    verdictRationale: 'Deux sources montrent une demande.',
    demand: { level: 'Élevé', rationale: 'Plusieurs guides se vendent.', sourceIds: ids },
    saturation: { level: 'Moyen', rationale: 'Une formation concurrente est visible.', sourceIds: withSources ? [2] : [] },
    profitability: { level: 'Moyen', rationale: 'Prix bas constatés.', sourceIds: withSources ? [2] : [] },
    opportunity: { level: 'Élevé', rationale: 'Peu de contenus locaux.', sourceIds: [99] },
    virality: { level: 'Non évaluable', rationale: '', sourceIds: [] },
    keywords: [
      { keyword: 'élevage poulet ville', intent: 'informational' },
      { keyword: 'Élevage poulet ville', intent: 'commercial' },
      { keyword: 'guide poulailler prix', intent: 'transactional' },
    ],
    competitors: [
      {
        name: 'PouletPro Académie',
        urlOrHandle: 'https://lien-invente.example/cours',
        priceRange: '15 000 FCFA',
        positioning: 'Formation vidéo',
        strengths: ['Vidéos claires'],
        weaknesses: ['Pas de suivi'],
        exploitableGap: 'Un suivi local',
        sourceIds: [2],
      },
      {
        name: 'Concurrent inventé',
        urlOrHandle: 'https://faux.example',
        priceRange: '',
        positioning: 'Inconnu',
        strengths: [],
        weaknesses: [],
        exploitableGap: '',
        sourceIds: [42],
      },
    ],
    products: [
      {
        title: 'Guide du poulailler urbain',
        subtitle: 'De 10 à 50 poules',
        type: 'ebook',
        targetAudience: 'Citadins',
        transformationPromise: 'Installer un poulailler propre',
        pricingNote: 'Guides vendus 15 000 FCFA [2]',
        modules: [
          { title: 'Budget', details: 'Poste par poste.' },
          { title: 'Alimentation', details: 'Deux repas par jour.' },
        ],
        leadMagnet: { title: 'Checklist du poulailler', format: 'PDF', hook: 'Ne rien oublier' },
      },
    ],
    adScripts: [
      {
        framework: 'PAS',
        hookHeadline: 'Vos poules tombent malades ?',
        primaryText: 'Un guide simple pour élever en ville.',
        headline: 'Le guide du poulailler',
        callToAction: 'En savoir plus',
        aspectRatio: '9:16',
        durationSeconds: 28,
        scenes: [
          { phase: 'Problème', seconds: 5, visualDescription: 'Poules', onScreenText: 'Malades ?', voiceover: 'Vos poules…', soundAndVibe: 'Calme' },
          { phase: 'Mauvaise', seconds: 10, visualDescription: 'Poulailler sale', onScreenText: 'Pertes', voiceover: 'Chaque semaine…', soundAndVibe: 'Tendu' },
          { phase: 'Solution', seconds: 10, visualDescription: 'Guide', onScreenText: 'Le guide', voiceover: 'Découvrez…', soundAndVibe: 'Positif' },
        ],
        interests: ['Agriculture'],
        demographics: '25-45 ans',
        placements: ['Reels'],
      },
    ],
    actionPlan: [{ phase: 'Semaine 1', title: 'Valider la demande', steps: ['Publier un sondage'] }],
    limitations: ['Aucune donnée de ventes.'],
  };
}

export interface FakeProviders {
  base: string;
  geminiCalls: FakeCall[];
  searchQueries: { token: string | undefined; query: string | null; country: string | null }[];
  close: () => Promise<void>;
}

export async function startFakeProviders(): Promise<FakeProviders> {
  const geminiCalls: FakeCall[] = [];
  const searchQueries: { token: string | undefined; query: string | null; country: string | null }[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fournisseurs.test');
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (url.pathname.startsWith('/gemini/v1beta/models/') && req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { contents: { parts: { text: string }[] }[] };
        const prompt = body.contents[0]!.parts[0]!.text;
        const key = req.headers['x-goog-api-key'] as string | undefined;
        geminiCalls.push({ key, prompt });
        if (key !== 'cle-gemini-de-test') return send(403, { error: { message: 'clé refusée' } });
        if (prompt.includes('« panne')) return send(500, { error: { message: 'erreur interne' } });
        if (prompt.includes('« illisible')) return send(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] });
        return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(fakeAnalysis(prompt)) }] } }] });
      }

      if (url.pathname === '/perplexity/search' && req.method === 'POST') {
        const token = req.headers.authorization;
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query?: string; country?: string };
        searchQueries.push({ token, query: body.query ?? null, country: body.country ?? null });
        if (token !== 'Bearer cle-perplexity-de-test') return send(401, { error: 'clé refusée' });
        return send(200, {
          id: 'recherche-de-test',
          results: [
            { title: 'Élever des poulets en <strong>ville</strong>', url: 'https://agri.example/poulets', snippet: 'Le marché urbain grandit', date: '2026-08-01' },
            { title: 'PouletPro Académie', url: 'https://pouletpro.example/formation', snippet: 'Formation à 15 000 FCFA', date: null },
            { title: 'Doublon', url: 'https://agri.example/poulets#avis', snippet: 'même page' },
            { title: 'Lien piégé', url: 'javascript:alert(1)', snippet: 'refusé' },
          ],
        });
      }

      send(404, {});
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    geminiCalls,
    searchQueries,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function signInWithPlan(app: import('express').Express, email: string, plan: 'free' | 'pro') {
  const { default: request } = await import('supertest');
  const { STRONG_PASSWORD } = await import('./helpers');
  const { createUserRecord } = await import('@server/services/accounts');
  const { hashPassword } = await import('@server/services/auth/password');
  const user = await createUserRecord({ name: 'Créatrice Test', email, passwordHash: await hashPassword(STRONG_PASSWORD), role: 'user', plan });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD }).expect(200);
  return { agent, userId: user.id };
}
