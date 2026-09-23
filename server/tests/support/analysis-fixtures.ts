import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Faux Gemini et faux Perplexity (étude de l'Agent API et API Search) pour les tests d'analyse
 * de niche. Les réponses contiennent volontairement des pièges : une source inexistante, un
 * lien inventé, une page citée sous deux numéros, un lien javascript:, un doublon de mot-clé,
 * une phase de script inconnue. Le serveur doit les écarter.
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

export interface AgentCall {
  method: string;
  path: string;
  token: string | undefined;
  body: { preset?: string; background?: boolean; input?: string; tools?: { type: string; user_location?: { country?: string } }[] } | null;
}

export interface FakeProviders {
  base: string;
  geminiCalls: FakeCall[];
  searchQueries: { token: string | undefined; query: string | null; country: string | null }[];
  agentCalls: AgentCall[];
  /**
   * Force le faux Gemini à répondre 503 « saturé » pour les N prochains appels dont la requête
   * contient « saturé ». Le client réessaie quatre fois avant de renoncer : il faut donc 4 pour
   * qu'un tour de rédaction échoue entièrement.
   */
  setOverload: (calls: number) => void;
  close: () => Promise<void>;
}

/** Étude de marché factice : marqueurs [web:N], page citée deux fois, lien piégé, numéro inconnu. */
export function fakeStudyResponse(id: string) {
  return {
    id,
    status: 'completed',
    model: 'openai/gpt-5.6-luna',
    output: [
      {
        type: 'search_results',
        queries: ['élevage poulets Cameroun prix', 'formation poulets avis'],
        results: [
          { id: 1, url: 'https://agri.example/poulets', title: 'Élever des poulets en <strong>ville</strong>', snippet: 'Le marché urbain grandit {ts:12}', date: '2026-08-01' },
          { id: 2, url: 'https://pouletpro.example/formation', title: 'PouletPro Académie', snippet: 'Formation à 15 000 FCFA' },
          { id: 3, url: 'https://agri.example/poulets#avis', title: 'Même page, autre ancre', snippet: 'doublon' },
        ],
      },
      {
        type: 'search_results',
        queries: ['forum éleveurs poulets'],
        results: [
          { id: 4, url: 'javascript:alert(1)', title: 'Lien piégé', snippet: 'refusé' },
          { id: 5, url: 'https://forum.example/eleveurs', title: 'Forum des éleveurs', snippet: 'Les éleveurs demandent un suivi', last_updated: '2026-09-01' },
          { id: 6, url: 'https://jamais-citee.example/page', title: 'Page lue mais jamais citée', snippet: 'rien' },
        ],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text:
              '## Signes de demande\nLe marché urbain grandit [web:1][web:3]. Des éleveurs demandent un suivi pratique [web:5].\n' +
              '## Concurrence\nPouletPro Académie vend une formation à 15 000 FCFA [web:2]. Un lien douteux circule [web:4]. Une affirmation sans page [web:99].\n' +
              '## Conclusion\n' +
              'La demande est réelle et la concurrence encore modérée, surtout pour un accompagnement local en français. '.repeat(3),
          },
        ],
      },
    ],
    usage: { cost: { total_cost: 0.03 } },
  };
}

export async function startFakeProviders(): Promise<FakeProviders> {
  const geminiCalls: FakeCall[] = [];
  const agentCalls: AgentCall[] = [];
  const studies = new Map<string, string>();
  const searchQueries: { token: string | undefined; query: string | null; country: string | null }[] = [];
  let overloadRemaining = 0;

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
        if (prompt.includes('« saturé') && overloadRemaining > 0) {
          overloadRemaining -= 1;
          return send(503, { error: { message: 'The model is overloaded. Please try again later.' } });
        }
        if (prompt.includes('« panne')) return send(500, { error: { message: 'erreur interne' } });
        if (prompt.includes('« illisible')) return send(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] });
        return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(fakeAnalysis(prompt)) }] } }] });
      }

      if (url.pathname.startsWith('/perplexity/v1/agent')) {
        const token = req.headers.authorization;
        const text = Buffer.concat(chunks).toString('utf8');
        const body = text ? (JSON.parse(text) as AgentCall['body']) : null;
        agentCalls.push({ method: req.method ?? '', path: url.pathname, token, body });
        if (token !== 'Bearer cle-perplexity-de-test') return send(401, { error: { message: 'invalid api key' } });

        if (req.method === 'POST') {
          const input = body?.input ?? '';
          if (input.includes('« crédit épuisé')) return send(402, { error: { message: 'insufficient credits' } });
          const id = `resp_${agentCalls.length}`;
          studies.set(id, input.includes('« étude en échec') ? 'failed' : input.includes('« étude mince') ? 'thin' : 'ok');
          return send(200, { id, status: 'in_progress', output: [] });
        }

        const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
        const kind = studies.get(id) ?? (id === 'resp_reprise' ? 'ok' : undefined);
        if (!kind) return send(404, { error: { message: 'not found' } });
        if (kind === 'failed') return send(200, { id, status: 'failed', error: { message: 'panne de l’étude' }, output: [] });
        if (kind === 'thin') {
          return send(200, { id, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Rien trouvé [web:1].' }] }] });
        }
        return send(200, fakeStudyResponse(id));
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
            { title: 'Forum des éleveurs', url: 'https://forum.example/eleveurs', snippet: 'Suivi demandé' },
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
    setOverload: (calls: number) => {
      overloadRemaining = calls;
    },
    searchQueries,
    agentCalls,
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


/** Confirme l'adresse d'un compte : le radar n'écrit qu'aux adresses confirmées. */
export async function verifyEmailOf(email: string): Promise<void> {
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('@server/db/client');
  const { users } = await import('@server/db/schema');
  await getDb().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, email.toLowerCase()));
}
