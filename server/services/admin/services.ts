import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { databaseKind, getDb } from '@server/db/client';
import { adSearches, alerts, auditLogs, generations, spiedAds, watches } from '@server/db/schema';
import { alertWatch } from '@server/services/alerts';
import { MARKET_RUN_AUDIT_ACTION } from '@server/services/market';
import { env, ignoredSettings, isProd, isServerless, providers } from '@server/env';
import { lastGroqOutcome } from '@server/services/ai/groq';
import { sebpayMode } from '@server/services/billing/sebpay';
import { classifyGoogleRefusal, lastGoogleRefusal, recordGoogleRefusal } from '@server/services/ai/googleRefusal';
import { cloudflareSpeechConfigured } from '@server/services/ai/cloudflareSpeech';
import { videoArchiveConfigured } from '@server/services/creatives/archive';
import { firecrawlPagesToday } from '@server/services/radar/sources/firecrawl';

/**
 * État des services du site, vérifié en direct pour l'administration.
 *
 * Chaque contrôle est gratuit : il interroge une adresse en lecture (liste, compte, identifiant
 * inexistant) qui répond 401 si la clé est refusée et 200 ou 404 si elle est acceptée. Aucune
 * génération n'est lancée, aucune clé n'est renvoyée, seuls des états et des conseils le sont.
 * Le résultat est gardé une minute pour ne pas marteler les fournisseurs.
 */

export type ServiceState = 'ok' | 'warning' | 'error' | 'off';

export interface ServiceCheck {
  id: string;
  name: string;
  role: string;
  state: ServiceState;
  detail: string;
  /** Ce que l'administrateur doit faire, quand il y a quelque chose à faire. */
  action: string | null;
}

export interface ServicesReport {
  checkedAt: string;
  /** Adresse IP publique du serveur, à autoriser chez les fournisseurs qui filtrent par IP (SebPay). */
  serverIp: string | null;
  services: ServiceCheck[];
}

const TIMEOUT_MS = 10_000;
const CACHE_MS = 60_000;

type Probe = { status: number; body: unknown } | null;

async function probe(url: string, headers: Record<string, string>): Promise<Probe> {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

const trimmed = (url: string) => url.replace(/\/+$/, '');

let googleBlocked: { at: number; blocked: boolean } | null = null;
const GOOGLE_BLOCKED_TTL_MS = 10 * 60_000;

/**
 * Vrai si Google refuse toute génération faute de crédit : le tableau de bord le met « À traiter ».
 * Le 18/10/2026, les clients lisaient « l'administrateur en a été informé » alors que rien ne le lui
 * disait hors de la page État des services. Lu au plus toutes les dix minutes, en trois secondes au
 * plus : le tableau de bord n'attend jamais Google.
 */
export async function googleCreditsBlocked(): Promise<boolean> {
  if (!providers.gemini) return false;
  if (googleBlocked && Date.now() - googleBlocked.at < GOOGLE_BLOCKED_TTL_MS) return googleBlocked.blocked;
  const generation = await Promise.race([probeGeneration(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000))]);
  const blocked = generation ? classifyGoogleRefusal(generation.status, generation.body) === 'billing' : false;
  // Sans réponse, on ne conclut rien : la prochaine lecture redemandera.
  if (generation) googleBlocked = { at: Date.now(), blocked };
  return blocked;
}

/** Une génération d'un mot chez Google (voir checkGemini) : le seul contrôle qui voit un projet sans crédit. */
async function probeGeneration(): Promise<Probe> {
  try {
    const response = await fetch(`${trimmed(env.GEMINI_API_URL)}/v1beta/models/${env.GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY ?? '' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'OK' }] }], generationConfig: { maxOutputTokens: 1 } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

function unreachable(base: Omit<ServiceCheck, 'state' | 'detail' | 'action'>): ServiceCheck {
  return {
    ...base,
    state: 'warning',
    detail: 'Service injoignable depuis le serveur pour l’instant.',
    action: 'Revérifier dans quelques minutes ; si cela dure, consulter la page d’état du fournisseur.',
  };
}

function refused(base: Omit<ServiceCheck, 'state' | 'detail' | 'action'>, variable: string): ServiceCheck {
  return {
    ...base,
    state: 'error',
    detail: 'Clé refusée par le fournisseur.',
    action: `Recopier une clé valide dans ${variable} (fichier .env, ou secrets de l’hébergeur), puis redémarrer le serveur.`,
  };
}

/**
 * Mode de connexion à Supabase, lu dans l'adresse : le port 6543 de son répartiteur ne prête une
 * connexion à la base que le temps d'une requête (« transaction ») ; le port 5432 en réserve une à
 * chaque client tant qu'il reste branché (« session »).
 */
export function poolerModeOf(url: string | undefined): 'transaction' | 'session' | 'direct' | null {
  try {
    const address = new URL(url ?? '');
    if (!/^postgres(ql)?:$/.test(address.protocol)) return null;
    if (!address.hostname.endsWith('.pooler.supabase.com')) return 'direct';
    return address.port === '6543' ? 'transaction' : 'session';
  } catch {
    return null;
  }
}

async function checkDatabase(): Promise<ServiceCheck> {
  const base = { id: 'database', name: 'Base de données', role: 'Comptes, rapports, contes, paiements' };
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    return {
      ...base,
      state: 'error',
      detail: 'La base ne répond pas.',
      action: 'Vérifier DATABASE_URL et que le projet Supabase n’est pas en pause.',
    };
  }
  if (databaseKind() === 'postgres') {
    /*
      En hébergement sans serveur, chaque instance du site garde sa connexion, même endormie. En
      mode « session », chacune y occupe une place de la base, et leur nombre est plafonné : les
      suivantes sont refusées ou attendent. Constat du 11/10/2026 : lectures sans réponse et
      erreurs internes par intermittence, après quelques minutes de repos.
    */
    if (isServerless && poolerModeOf(env.DATABASE_URL) === 'session') {
      return {
        ...base,
        state: 'warning',
        detail: 'PostgreSQL distant (Supabase), connecté en mode « session » : chaque instance du site y garde une place réservée, même endormie, et leur nombre est plafonné.',
        action:
          'Dans la variable DATABASE_URL de l’hébergeur, remplacer le port 5432 par 6543 (chaîne « Transaction pooler » de Supabase : Connect → Transaction pooler), puis redéployer.',
      };
    }
    return { ...base, state: 'ok', detail: 'PostgreSQL distant (Supabase) : données hébergées en ligne.', action: null };
  }
  return {
    ...base,
    state: isProd ? 'error' : 'warning',
    detail: 'Base embarquée sur ce poste (développement) : les données ne sont pas en ligne.',
    action: 'Renseigner DATABASE_URL avec la chaîne « Transaction pooler » de Supabase (port 6543) et le mot de passe de la base.',
  };
}

/**
 * Direction artistique des couvertures (Groq). Aucun appel de contrôle : chaque demande est
 * payante, et son absence n'empêche rien — la couverture se fait alors avec la consigne composée
 * par le serveur.
 */
function checkGroq(): ServiceCheck {
  const base = { id: 'groq', name: 'Groq (rédaction)', role: 'Rédige produits, kits, contes et rapports ; lit les images et transcrit les vidéos' };
  if (!providers.groq)
    return {
      ...base,
      state: providers.gemini ? 'warning' : 'error',
      detail: providers.gemini ? 'Aucune clé : la rédaction passe par Gemini seul.' : 'Aucune clé : la rédaction est fermée.',
      action: 'Créer une clé sur console.groq.com et la mettre dans GROQ_API_KEY.',
    };
  const last = lastGroqOutcome();
  if (!last) return { ...base, state: 'ok', detail: `Clé présente · modèle ${env.GROQ_MODEL}. Aucune rédaction demandée depuis le démarrage.`, action: null };
  const quand = new Date(last.at).toLocaleString('fr-FR', { timeZone: env.REPORTING_TIMEZONE });
  if (last.ok) return { ...base, state: 'ok', detail: `Modèle ${env.GROQ_MODEL} · dernière réponse le ${quand}.`, action: null };
  return {
    ...base,
    state: 'warning',
    detail: `Dernière demande sans réponse utilisable (${last.code}) le ${quand}${providers.gemini ? ' : Gemini a pris le relais.' : '.'}`,
    action:
      last.code === 'AUTH'
        ? 'Clé refusée : vérifier GROQ_API_KEY et le crédit du compte sur console.groq.com.'
        : last.code === 'BAD_REQUEST'
          ? 'Demande refusée : vérifier le nom du modèle dans GROQ_MODEL.'
          : null,
  };
}

async function checkGemini(): Promise<ServiceCheck> {
  const base = { id: 'gemini', name: 'Gemini (texte)', role: 'Rédaction des rapports, produits, kits, contes et traductions' };
  if (!providers.gemini)
    return {
      ...base,
      state: 'off',
      detail: 'Aucune clé.',
      action: 'Créer une clé sur aistudio.google.com et la mettre dans GEMINI_API_KEY.',
    };
  const result = await probe(`${trimmed(env.GEMINI_API_URL)}/v1beta/models/${env.GEMINI_MODEL}`, {
    'x-goog-api-key': env.GEMINI_API_KEY ?? '',
  });
  if (!result) return unreachable(base);
  if (result.status === 200) {
    /*
      « Clé acceptée » ne dit pas que Google génère : lire la fiche d'un modèle est gratuit, et
      une clé dont le projet n'a plus de crédit passe ce contrôle — la page affichait « Clé
      acceptée » le 18/10/2026 pendant que Google refusait tout par un 402. Une génération d'un
      seul mot dit la vérité ; refusée, elle ne coûte rien.
    */
    const generation = await probeGeneration();
    const blocked = generation ? classifyGoogleRefusal(generation.status, generation.body) : null;
    if (generation) googleBlocked = { at: Date.now(), blocked: blocked === 'billing' };
    if (blocked) recordGoogleRefusal(blocked, env.GEMINI_MODEL, String((generation?.body as { error?: { message?: string } } | null)?.error?.message ?? '').slice(0, 200));
    if (blocked === 'billing') {
      return {
        ...base,
        state: 'error',
        detail:
          'Clé acceptée, mais Google refuse toute génération : crédits prépayés épuisés (ou facturation absente) sur le projet de la clé. Ce qui en dépend est à l’arrêt : dernier recours de la rédaction, lien YouTube de Vidéo → Produit.',
        action: 'Recharger les crédits prépayés du projet de la clé : ai.studio/projects → Billing. Rien à redéployer : le site reprend dès que Google accepte.',
      };
    }
    const refus = lastGoogleRefusal();
    const recent = refus && Date.now() - new Date(refus.at).getTime() < 6 * 3_600_000;
    const quand = refus ? new Date(refus.at).toLocaleString('fr-FR', { timeZone: env.REPORTING_TIMEZONE }) : '';
    if (recent && (refus.kind === 'billing' || refus.kind === 'no_free_tier')) {
      return {
        ...base,
        state: 'error',
        detail: `Clé acceptée, mais Google refuse les générations : crédits prépayés épuisés ou facturation absente sur le projet de la clé (dernier refus le ${quand}, modèle ${refus.model}). Textes, images et vidéos Google sont touchés.`,
        action: 'Recharger les crédits ou activer la facturation du projet de la clé : aistudio.google.com → Billing.',
      };
    }
    if (recent && refus.kind === 'per_day') {
      return {
        ...base,
        state: 'warning',
        detail: `Quota du jour atteint sur ${refus.model} (le ${quand}) : les modèles de secours prennent le relais.`,
        action: 'Relever le quota du projet dans Google Cloud si cela se répète chaque jour.',
      };
    }
    return {
      ...base,
      state: 'ok',
      detail: `Clé acceptée · modèle ${env.GEMINI_MODEL}${env.GEMINI_FALLBACK_MODEL ? `, secours ${env.GEMINI_FALLBACK_MODEL}` : ''}${env.GEMINI_LAST_RESORT_MODEL ? `, dernier recours ${env.GEMINI_LAST_RESORT_MODEL}` : ''}.`,
      action: null,
    };
  }
  if (result.status === 404)
    return {
      ...base,
      state: 'error',
      detail: `Le modèle ${env.GEMINI_MODEL} n’existe pas ou plus.`,
      action: 'Choisir un modèle disponible dans GEMINI_MODEL.',
    };
  if (result.status === 400 || result.status === 401 || result.status === 403) return refused(base, 'GEMINI_API_KEY');
  return unreachable(base);
}

/**
 * Voix française du parcours audio : MeloTTS chez Cloudflare Workers AI, seul usage restant de
 * Cloudflare depuis le retrait de la génération d'images (28/10/2026). Le jeton est éprouvé par une
 * lecture gratuite du catalogue des modèles : 401 ou 403, il est refusé.
 */
async function checkVoice(): Promise<ServiceCheck> {
  const base = { id: 'voice', name: 'Voix française', role: 'Lecture à voix haute du parcours audio' };
  if (!cloudflareSpeechConfigured())
    return {
      ...base,
      state: 'warning',
      detail: providers.gemini ? 'Aucun compte Cloudflare : la lecture passe par Gemini.' : 'Aucun compte Cloudflare : la lecture à voix haute est fermée.',
      action: 'Renseigner CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_AI_TOKEN (droits Workers AI en lecture et écriture), puis redéployer.',
    };
  const result = await probe(`${trimmed(env.CLOUDFLARE_AI_URL)}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?per_page=1`, {
    Authorization: `Bearer ${env.CLOUDFLARE_AI_TOKEN}`,
  });
  if (!result) return unreachable(base);
  if (result.status === 401 || result.status === 403) return refused(base, 'CLOUDFLARE_AI_TOKEN');
  if (result.status !== 200) return unreachable(base);
  return { ...base, state: 'ok', detail: 'Jeton accepté · MeloTTS, une voix française, dans la franchise quotidienne de Cloudflare.', action: null };
}

async function checkPerplexity(): Promise<ServiceCheck> {
  const base = { id: 'perplexity', name: 'Perplexity', role: 'Étude de marché des analyses (recherche web et sources)' };
  if (!providers.webSearch)
    return {
      ...base,
      state: 'error',
      detail: 'Aucune clé : l’analyse de niche est refusée.',
      action: 'Créer une clé sur perplexity.ai/account/api, ajouter du crédit, et la mettre dans PERPLEXITY_API_KEY.',
    };
  const result = await probe(`${trimmed(env.PERPLEXITY_API_URL)}/v1/agent/resp_verification_smart_creator`, {
    Authorization: `Bearer ${env.PERPLEXITY_API_KEY ?? ''}`,
  });
  if (!result) return unreachable(base);
  if (result.status === 404 || result.status === 200) {
    const depth =
      env.PERPLEXITY_RESEARCH_PRESET === 'off'
        ? 'pages brutes seulement (étude désactivée)'
        : `étude « ${env.PERPLEXITY_RESEARCH_PRESET} »`;
    return {
      ...base,
      state: 'ok',
      detail: `Clé acceptée · ${depth}. Le crédit restant se consulte sur perplexity.ai/account/api.`,
      action: null,
    };
  }
  if (result.status === 402)
    return { ...base, state: 'error', detail: 'Crédit API épuisé.', action: 'Recharger le crédit sur perplexity.ai/account/api.' };
  if (result.status === 401 || result.status === 403) return refused(base, 'PERPLEXITY_API_KEY');
  return unreachable(base);
}

/**
 * Copie des vidéos (Veo, fal.ai) dans le stockage de Supabase : le fournisseur n'en garde une que
 * deux jours. Plus aucune vidéo ne se crée depuis le 28/10/2026, mais celles d'avant restent gardées
 * la durée de leur palier, puis effacées.
 */
async function checkVideoArchive(): Promise<ServiceCheck> {
  const base = { id: 'video-archive', name: 'Copie des vidéos', role: 'Garde les vidéos au-delà des 2 jours du fournisseur' };
  if (!videoArchiveConfigured())
    return {
      ...base,
      state: 'warning',
      detail: 'Non configurée : une vidéo non téléchargée dans les 2 jours est perdue.',
      action: 'Renseigner SUPABASE_API_SECRET_KEY (Supabase → Project Settings → API Keys → Secret keys), puis redéployer.',
    };
  const since = new Date(Date.now() - 2 * 86_400_000);
  const [counts] = await getDb()
    .select({
      archived: sql<number>`count(*) filter (where ${generations.archivedAt} is not null)`.mapWith(Number),
      waiting: sql<number>`count(*) filter (where ${generations.archivedAt} is null and ${generations.createdAt} > ${since.toISOString()}::timestamptz)`.mapWith(Number),
      last: sql<string | null>`max(${generations.archivedAt})`,
    })
    .from(generations)
    .where(and(inArray(generations.provider, ['veo', 'fal']), eq(generations.status, 'completed')));
  const archived = counts?.archived ?? 0;
  const waiting = counts?.waiting ?? 0;
  const last = counts?.last ? new Date(counts.last).toLocaleString('fr-FR', { timeZone: env.REPORTING_TIMEZONE }) : null;
  return {
    ...base,
    state: waiting > 0 ? 'warning' : 'ok',
    detail:
      `Active · espace privé « ${env.CREATIVES_BUCKET} » · ${archived} vidéo${archived > 1 ? 's' : ''} copiée${archived > 1 ? 's' : ''}` +
      (last ? ` · dernière copie : ${last}` : ' · aucune vidéo copiée pour l’instant') +
      (waiting > 0 ? ` · ${waiting} en attente de copie` : '') +
      '.',
    action: waiting > 0 ? 'Les copies manquées sont refaites par le relevé de nuit tant que le fournisseur garde l’original (2 jours).' : null,
  };
}

async function checkChariow(): Promise<ServiceCheck> {
  const base = { id: 'chariow', name: 'Chariow', role: 'Catalogue, ventes et affiliés de la boutique du propriétaire' };
  if (!providers.chariow)
    return { ...base, state: 'off', detail: 'Aucune clé propriétaire (chaque membre peut enregistrer la sienne).', action: null };
  const result = await probe(`${trimmed(env.CHARIOW_API_URL)}/products?per_page=1`, {
    Authorization: `Bearer ${env.CHARIOW_API_KEY ?? ''}`,
  });
  if (!result) return unreachable(base);
  if (result.status === 200) return { ...base, state: 'ok', detail: 'Clé acceptée · boutique lisible.', action: null };
  if (result.status === 401 || result.status === 403) return refused(base, 'CHARIOW_API_KEY');
  return unreachable(base);
}

async function checkStripe(): Promise<ServiceCheck> {
  const base = { id: 'stripe', name: 'Stripe', role: 'Paiement des paliers par carte' };
  if (!providers.payments) return { ...base, state: 'off', detail: 'Aucune clé : paiement par carte masqué.', action: null };
  const result = await probe(`${trimmed(env.STRIPE_API_URL)}/v1/account`, { Authorization: `Bearer ${env.STRIPE_API_KEY ?? ''}` });
  if (!result) return unreachable(base);
  if (result.status === 401 || result.status === 403) return refused(base, 'STRIPE_API_KEY');
  if (result.status !== 200) return unreachable(base);
  const account = result.body as { charges_enabled?: boolean } | null;
  const live = env.STRIPE_API_KEY?.trim().startsWith('sk_live') ?? false;
  if (!live)
    return {
      ...base,
      state: 'warning',
      detail: 'Mode test : seules les cartes de test passent, aucun vrai paiement.',
      action: 'Activer le compte Stripe (profil d’entreprise) puis utiliser la clé sk_live_….',
    };
  if (!account?.charges_enabled)
    return {
      ...base,
      state: 'error',
      detail: 'Clé réelle, mais le compte n’est pas encore autorisé à encaisser.',
      action: 'Terminer l’activation du compte dans le tableau de bord Stripe.',
    };
  if (!env.STRIPE_WEBHOOK_SECRET)
    return {
      ...base,
      state: 'warning',
      detail: 'Paiements réels actifs, sans webhook.',
      action: 'Créer le webhook /api/billing/webhook et renseigner STRIPE_WEBHOOK_SECRET.',
    };
  return { ...base, state: 'ok', detail: 'Paiements réels actifs.', action: null };
}

async function checkSebpay(serverIp: string | null): Promise<ServiceCheck> {
  const base = { id: 'sebpay', name: 'SebPay', role: 'Mobile Money (paiement des paliers)' };
  if (!env.SEBPAY_PUBLIC_KEY || !env.SEBPAY_SECRET_KEY) return { ...base, state: 'off', detail: 'Aucune clé.', action: null };
  const result = await probe(`${trimmed(env.SEBPAY_API_URL)}/countries`, {
    'X-Public-Key': env.SEBPAY_PUBLIC_KEY,
    'X-Secret-Key': env.SEBPAY_SECRET_KEY,
  });
  if (!result) return unreachable(base);
  const code = (result.body as { errors?: { code?: string } } | null)?.errors?.code;
  if (code === 'IP_NOT_ALLOWED') {
    return {
      ...base,
      state: 'error',
      detail: 'Clés reconnues, mais l’adresse IP de ce serveur n’est pas autorisée.',
      action: serverIp
        ? `Autoriser l’adresse ${serverIp} dans le tableau de bord SebPay (adresses IP autorisées de la clé).`
        : 'Autoriser l’adresse IP du serveur dans le tableau de bord SebPay.',
    };
  }
  /*
    SebPay répond « Invalid or inactive API keys » dans deux cas qu'il ne distingue pas : des clés
    mal recopiées, ou des clés de production d'un compte marchand dont la vérification d'identité
    n'est pas terminée (constaté le 11/10/2026). Les deux pistes sont donc données.
  */
  if (result.status === 401 || result.status === 403) {
    return {
      ...base,
      state: 'error',
      detail: 'Clés refusées : mal recopiées, ou compte marchand pas encore activé pour la production.',
      action:
        'Dans le tableau de bord SebPay : vérifier que le compte est activé (vérification d’identité terminée), puis recopier la clé publique et la clé secrète dans SEBPAY_PUBLIC_KEY et SEBPAY_SECRET_KEY.',
    };
  }
  if (result.status === 200) {
    const countries = JSON.stringify(result.body ?? '');
    const cameroon = /"CM"|Cameroun|Cameroon/i.test(countries);
    // En bac à sable, aucun argent réel ne circule : le Mobile Money reste réservé à l'équipe, comme la carte en mode test.
    if (sebpayMode() === 'test') {
      return {
        ...base,
        state: 'warning',
        detail: 'Clés de test (bac à sable) : aucun argent réel. Les clients ne voient pas le Mobile Money ; l’équipe peut l’essayer.',
        action: 'Pour encaisser : remplacer les clés par les clés de production (pk_live_… et sk_live_…) du tableau de bord SebPay.',
      };
    }
    return {
      ...base,
      state: cameroon ? 'ok' : 'warning',
      detail: cameroon
        ? 'Paiements Mobile Money réels actifs · Cameroun disponible.'
        : 'Clés acceptées, mais le Cameroun n’apparaît pas dans les pays du compte.',
      action: cameroon ? null : 'Demander au support SebPay l’ouverture du Cameroun (MTN, Orange, XAF).',
    };
  }
  return unreachable(base);
}

/**
 * Radar : le seul service qui travaille sans que personne ne clique. C'est donc le seul dont
 * une panne peut passer inaperçue des mois — d'où ce contrôle, qui répond à trois questions que
 * l'administrateur ne peut poser nulle part ailleurs :
 *
 *  1. le balayage tourne-t-il vraiment ? (date du dernier relevé, pas la présence du code)
 *  2. un déclencheur extérieur est-il configuré ? Sans lui, en hébergement sans serveur, le
 *     radar est inerte alors que tout paraît en place ;
 *  3. la collecte payante est-elle joignable et son jeton accepté ?
 */
/**
 * Collecte des publicités : le mur est-il encore alimenté ?
 *
 * Ce contrôle regarde le RÉSULTAT — la dernière annonce relevée —, pas la configuration. Du 06 au
 * 11/10/2026, la lecture payante refusait le serveur et l'atelier du collecteur tournait sans son
 * secret : tout était « configuré », rien n'arrivait, et aucune ligne de cette page ne le disait.
 */
async function checkAdCollection(): Promise<ServiceCheck> {
  const base = { id: 'ad-collection', name: 'Collecte des publicités', role: 'Alimente le mur d’Espionnage et complète les recherches (collecteur maison, lecture payante en appoint)' };
  const [[mur], [attente]] = await Promise.all([
    getDb().select({ total: sql<number>`count(*)`, derniere: sql<Date | null>`max(${spiedAds.lastSeenAt})` }).from(spiedAds),
    getDb()
      .select({ total: sql<number>`count(*)` })
      .from(adSearches)
      .where(eq(adSearches.collector, 'pending')),
  ]);
  const total = Number(mur?.total ?? 0);
  const enAttente = Number(attente?.total ?? 0);
  const recherches = enAttente > 0 ? ` ${enAttente} recherche${enAttente > 1 ? 's' : ''} de clients attend${enAttente > 1 ? 'ent' : ''} sa lecture.` : '';
  const remede =
    'Vérifier que le secret CRON_SECRET du dépôt GitHub (Settings → Secrets and variables → Actions) porte la même valeur que celui du site : ' +
    'sans lui, l’atelier « Collecte des publicités » ne verse rien. À défaut, lancer « npm run collecte » depuis un poste.';
  if (total === 0) return { ...base, state: 'warning', detail: `Le mur est vide : aucune annonce n’a encore été relevée.${recherches}`, action: remede };

  const heures = mur?.derniere ? Math.floor((Date.now() - new Date(mur.derniere).getTime()) / 3_600_000) : null;
  const depuis = heures === null ? 'date inconnue' : heures < 48 ? `il y a ${heures} h` : `il y a ${Math.floor(heures / 24)} jours`;
  const detail = `${total.toLocaleString('fr-FR')} annonces sur le mur, la dernière relevée ${depuis}.${recherches}`;
  if (heures !== null && heures <= 36) return { ...base, state: 'ok', detail, action: null };
  return { ...base, state: heures !== null && heures <= 72 ? 'warning' : 'error', detail: `${detail} Le mur vieillit : plus rien n’y est versé.`, action: remede };
}

/**
 * Relevé du marché : les ventes des boutiques de l'index sont-elles lues chaque jour ?
 *
 * C'est lui qui produit les alertes, et elles se calculent d'un jour sur l'autre. Du 07 au
 * 11/10/2026, il ne relisait plus qu'une poignée de boutiques par nuit : le fil des alertes
 * affichait « aucune alerte » et rien, ici, ne disait pourquoi. Le contrôle regarde les relevés
 * eux-mêmes — un passage du réveil qui n'a rien lu ne compte pas.
 */
async function checkMarketReading(): Promise<ServiceCheck> {
  const base = { id: 'market-reading', name: 'Relevé du marché', role: 'Lit chaque jour les ventes des boutiques repérées ; les alertes se calculent sur ces relevés' };
  const [watch, [fil], [passage]] = await Promise.all([
    alertWatch(),
    getDb().select({ total: sql<number>`count(*)`, derniere: sql<Date | null>`max(${alerts.occurredAt})` }).from(alerts),
    getDb().select().from(auditLogs).where(eq(auditLogs.action, MARKET_RUN_AUDIT_ACTION)).orderBy(desc(auditLogs.createdAt)).limit(1),
  ]);
  const alertes = Number(fil?.total ?? 0);
  const fils = alertes > 0 && fil?.derniere ? ` ${alertes} alerte${alertes > 1 ? 's' : ''} au fil, la dernière le ${new Date(fil.derniere).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}.` : ' Aucune alerte au fil.';
  // Le dernier passage tel qu'il s'est raconté : combien de boutiques lues, combien en échec, et pourquoi.
  const compte = (passage?.details ?? null) as { source?: string; indexed?: number | null; failed?: number | null; remaining?: number | null; halted?: boolean; reasons?: { reason: string; stores: number }[] } | null;
  const cause = compte?.reasons?.[0] ? ` Échec le plus fréquent : « ${compte.reasons[0].reason} » (${compte.reasons[0].stores}).` : '';
  const dernierPassage =
    passage && compte
      ? ` Dernier passage (${compte.source ?? 'réveil'}, ${passage.createdAt.toLocaleString('fr-FR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} TU) : ${compte.indexed ?? '?'} relevée${(compte.indexed ?? 0) > 1 ? 's' : ''}, ${compte.failed ?? '?'} en échec, ${compte.remaining ?? '?'} en attente.${cause}`
      : ' Aucun passage du relevé n’a encore laissé de compte rendu.';
  const suite = `${fils}${dernierPassage}`;
  // Le dernier passage s'est arrêté sur des refus : ce n'est pas le relevé qui manque de passer, c'est la plateforme qui ne répond plus au serveur.
  const refuse = Boolean(compte?.halted);
  const remede = refuse
    ? 'La plateforme des vitrines refuse les lectures du serveur. Le relevé réessaie à chaque passage, cinq boutiques au plus, sans insister. ' +
      'Il reprend par Firecrawl dès que FIRECRAWL_API_KEY est renseignée chez l’hébergeur (voir « Lecture des vitrines ») ; un grand passage peut aussi partir d’un poste : « node collecteur/vitrines.mjs --credits=N ».'
    : 'Vérifier que l’atelier « Veille continue » du dépôt GitHub tourne (toutes les demi-heures) et que le secret CRON_SECRET y est renseigné, avec la même valeur que sur le site. ' +
      'À défaut, seule la tâche planifiée de l’hébergeur relève les boutiques, une fois par nuit.';
  if (watch.stores === 0) return { ...base, state: 'warning', detail: `Aucune boutique n’est encore dans l’index du marché.${suite}`, action: remede };

  const dernier = watch.readings[0];
  if (!dernier) return { ...base, state: 'error', detail: `${watch.stores} boutique${watch.stores > 1 ? 's' : ''} dans l’index, aucune relevée depuis deux semaines.${suite}`, action: remede };
  const age = Math.round((Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${dernier.day}T00:00:00Z`)) / 86_400_000);
  const quand = age <= 0 ? 'aujourd’hui' : age === 1 ? 'hier' : `il y a ${age} jours`;
  const detail = `${watch.stores} boutique${watch.stores > 1 ? 's' : ''} dans l’index ; dernier relevé ${quand} : ${dernier.stores} boutique${dernier.stores > 1 ? 's' : ''} lue${dernier.stores > 1 ? 's' : ''}.${suite}`;
  if (age > 2) return { ...base, state: 'error', detail: `${detail} Sans relevé d’un jour sur l’autre, aucune alerte ne peut se déclencher.`, action: remede };
  // Moins d'une boutique sur deux relue : le relevé tourne, mais ne fait pas le tour.
  if (age > 1 || dernier.stores * 2 < watch.stores) return { ...base, state: 'warning', detail: `${detail} Le relevé ne fait pas le tour des boutiques chaque jour.`, action: remede };
  return { ...base, state: 'ok', detail, action: null };
}

/**
 * Lecture des vitrines : par quoi le radar lit-il les boutiques, et lui reste-t-il de quoi lire ?
 *
 * La plateforme refuse le serveur du site depuis le 11/10/2026 ; le propriétaire a décidé le
 * 18/10/2026 de lire les vitrines par Firecrawl. Une page = un crédit : le contrôle dit les pages
 * lues aujourd'hui, le plafond du jour, et ce qu'il reste au forfait.
 */
async function checkStorefrontReading(): Promise<ServiceCheck> {
  const base = { id: 'storefronts', name: 'Lecture des vitrines', role: 'Catalogue et ventes des boutiques, pour le radar, l’index du marché et les alertes (Firecrawl)' };
  const plafond = `RADAR_FIRECRAWL_DAILY_PAGES (${env.RADAR_FIRECRAWL_DAILY_PAGES} pages par jour ; 30 tiennent dans 1 000 crédits par mois)`;
  if (!providers.firecrawl) {
    return {
      ...base,
      state: 'warning',
      detail: 'Vitrines lues directement par le serveur, ce que la plateforme refuse depuis le 11/10/2026 : ni ventes ni alertes de vente sans le collecteur des vitrines.',
      action: `Ajouter FIRECRAWL_API_KEY aux variables de l’hébergeur (Vercel → Settings → Environment Variables), puis redéployer. Plafond réglable par ${plafond}.`,
    };
  }
  const [compte, lues] = await Promise.all([
    probe(`${trimmed(env.FIRECRAWL_API_URL)}/v2/team/credit-usage`, { Authorization: `Bearer ${env.FIRECRAWL_API_KEY ?? ''}` }),
    firecrawlPagesToday().catch(() => null),
  ]);
  if (compte && (compte.status === 401 || compte.status === 403)) return refused(base, 'FIRECRAWL_API_KEY');
  const restants = Number((compte?.body as { data?: { remainingCredits?: unknown } } | null)?.data?.remainingCredits ?? Number.NaN);
  const jour = `${lues ?? '?'} page${(lues ?? 0) > 1 ? 's' : ''} lue${(lues ?? 0) > 1 ? 's' : ''} aujourd’hui, sur un plafond de ${env.RADAR_FIRECRAWL_DAILY_PAGES}`;
  if (Number.isFinite(restants) && restants <= 0) {
    return { ...base, state: 'error', detail: `Forfait Firecrawl épuisé : plus aucune vitrine n’est lue jusqu’au renouvellement. ${jour}.`, action: 'Recharger ou changer de forfait sur firecrawl.dev (Billing).' };
  }
  const reste = Number.isFinite(restants) ? ` · ${restants.toLocaleString('fr-FR')} crédits restants au forfait` : ' · forfait illisible pour l’instant';
  return { ...base, state: 'ok', detail: `Lecture par Firecrawl, ordinaire (jamais furtive) · ${jour}${reste}.`, action: null };
}

async function checkRadar(): Promise<ServiceCheck> {
  const base = { id: 'radar', name: 'Radar', role: 'Relevé quotidien des boutiques surveillées, résumés et découverte' };

  const [surveillees, dernierReleve] = await Promise.all([
    getDb()
      .select({ total: sql<number>`count(*)` })
      .from(watches)
      .where(eq(watches.active, true)),
    getDb()
      .select({ at: sql<Date | null>`max(${watches.lastSweptAt})` })
      .from(watches),
  ]);

  const actives = Number(surveillees[0]?.total ?? 0);
  const derniere = dernierReleve[0]?.at ? new Date(dernierReleve[0].at) : null;
  const heures = derniere ? Math.floor((Date.now() - derniere.getTime()) / 3_600_000) : null;

  // Un serveur sans serveur n'a pas de minuteur : sans secret de déclenchement, rien ne relèvera.
  if (!env.CRON_SECRET) {
    return {
      ...base,
      state: actives > 0 ? 'error' : 'warning',
      detail:
        actives > 0
          ? `${actives} boutique${actives > 1 ? 's' : ''} surveillée${actives > 1 ? 's' : ''}, mais aucun déclencheur périodique n’est configuré.`
          : 'Aucun déclencheur périodique configuré.',
      action:
        'Renseigner CRON_SECRET, puis planifier GET /api/cron/radar une fois par jour. Sans cela, le radar ne relève ' +
        'jamais en hébergement sans serveur — le minuteur en mémoire n’existe que sur un serveur classique.',
    };
  }

  if (actives === 0) {
    return { ...base, state: 'off', detail: 'Aucune boutique surveillée pour l’instant.', action: null };
  }

  // Deux jours sans relevé alors que des boutiques attendent : le planificateur ne passe plus.
  if (heures === null || heures > 48) {
    return {
      ...base,
      state: 'error',
      detail:
        heures === null
          ? `${actives} boutique${actives > 1 ? 's' : ''} surveillée${actives > 1 ? 's' : ''}, aucun relevé abouti à ce jour.`
          : `Dernier relevé il y a ${Math.floor(heures / 24)} jours, alors que le rythme prévu est de ${env.RADAR_SWEEP_INTERVAL_HOURS} h.`,
      action: 'Vérifier que la tâche planifiée appelle bien GET /api/cron/radar, et consulter le journal du serveur.',
    };
  }

  const collecte = providers.apify
    ? await probe(`${trimmed(env.APIFY_API_URL)}/users/me`, { Authorization: `Bearer ${env.APIFY_TOKEN ?? ''}` })
    : null;

  if (providers.apify && collecte && (collecte.status === 401 || collecte.status === 403)) {
    return refused(base, 'APIFY_TOKEN');
  }

  const decouverte = !providers.apify
    ? ' Découverte de boutiques et mesures de marché désactivées (aucun jeton Apify).'
    : collecte === null
      ? ' Service de collecte injoignable pour l’instant.'
      : ' Jeton de collecte accepté.';

  return {
    ...base,
    state: 'ok',
    detail: `${actives} boutique${actives > 1 ? 's' : ''} surveillée${actives > 1 ? 's' : ''} · dernier relevé il y a ${heures} h.${decouverte}`,
    action: null,
  };
}

async function checkEmail(): Promise<ServiceCheck> {
  const base = { id: 'email', name: 'E-mails', role: 'Mot de passe oublié, confirmation d’adresse, avis de paiement' };
  if (!providers.email) {
    return {
      ...base,
      state: 'off',
      detail: 'Aucun service d’envoi : aucun e-mail ne part.',
      action: 'Créer un compte Brevo (gratuit, 300 e-mails par jour), puis renseigner EMAIL_PROVIDER=brevo, EMAIL_API_KEY et EMAIL_FROM.',
    };
  }
  const brevo = env.EMAIL_PROVIDER === 'brevo';
  const origin = trimmed(env.EMAIL_API_URL ?? (brevo ? 'https://api.brevo.com' : 'https://api.resend.com'));
  const result = brevo
    ? await probe(`${origin}/v3/account`, { 'api-key': env.EMAIL_API_KEY ?? '' })
    : await probe(`${origin}/domains`, { Authorization: `Bearer ${env.EMAIL_API_KEY ?? ''}` });
  if (!result) return unreachable(base);
  if (result.status === 200)
    return { ...base, state: 'ok', detail: `Clé ${brevo ? 'Brevo' : 'Resend'} acceptée · expéditeur ${env.EMAIL_FROM}.`, action: null };
  if (result.status === 401 || result.status === 403) return refused(base, 'EMAIL_API_KEY');
  return unreachable(base);
}

async function publicIp(): Promise<string | null> {
  if (env.PUBLIC_IP_URL === 'off') return null;
  const result = await probe(env.PUBLIC_IP_URL, {});
  const ip = (result?.body as { ip?: string } | null)?.ip;
  return ip && /^[\d.:a-fA-F]+$/.test(ip) ? ip : null;
}

let cached: { at: number; report: ServicesReport } | null = null;

/**
 * Dernier relevé, s'il est plus récent que `maxAgeMs`. Sert au contrôle avant lancement
 * (services/preflight), qui refuse une génération quand un service est connu en panne
 * mais ne doit surtout pas déclencher d'appel réseau sur le chemin d'une requête.
 */
export function cachedServicesReport(maxAgeMs: number): ServicesReport | null {
  return cached && Date.now() - cached.at < maxAgeMs ? cached.report : null;
}

/**
 * Réglages écartés au démarrage parce que leur valeur n'a pas la forme attendue : leur fonction
 * est éteinte comme s'ils manquaient. Rien ne le montrait ailleurs (26/10/2026 : clé Cloudflare
 * « bien chez Vercel » selon le propriétaire, invisible pour le serveur). Les noms seuls, jamais
 * les valeurs.
 */
function checkSettings(): ServiceCheck {
  const base = { id: 'settings', name: 'Réglages du serveur', role: 'Variables lues au démarrage chez l’hébergeur' };
  if (ignoredSettings.length === 0) return { ...base, state: 'ok', detail: 'Toutes les variables renseignées ont la forme attendue.', action: null };
  return {
    ...base,
    state: 'error',
    detail: `Ignorée${ignoredSettings.length > 1 ? 's' : ''}, valeur au mauvais format : ${ignoredSettings.join(', ')}. La fonction correspondante est éteinte.`,
    action: 'Recoller la valeur chez l’hébergeur, sans guillemets ni espace, pour l’environnement « Production », puis redéployer.',
  };
}

export async function checkServices(options: { refresh?: boolean } = {}): Promise<ServicesReport> {
  if (!options.refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.report;

  const serverIp = await publicIp();
  const services = await Promise.all([
    Promise.resolve(checkSettings()),
    checkDatabase(),
    checkGemini(),
    Promise.resolve(checkGroq()),
    checkVoice(),
    checkPerplexity(),
    checkVideoArchive(),
    checkChariow(),
    checkRadar(),
    checkStorefrontReading(),
    checkMarketReading(),
    checkAdCollection(),
    checkStripe(),
    checkSebpay(serverIp),
    checkEmail(),
  ]);
  const report = { checkedAt: new Date().toISOString(), serverIp, services };
  cached = { at: Date.now(), report };
  return report;
}
