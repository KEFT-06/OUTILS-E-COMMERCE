import { desc, eq, sql } from 'drizzle-orm';
import { databaseKind, getDb } from '@server/db/client';
import { storybooks, watches } from '@server/db/schema';
import { env, isProd, providers } from '@server/env';
import { lastImageOutcome } from '@server/services/ai/image';

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
  if (databaseKind() === 'postgres')
    return { ...base, state: 'ok', detail: 'PostgreSQL distant (Supabase) : données hébergées en ligne.', action: null };
  return {
    ...base,
    state: isProd ? 'error' : 'warning',
    detail: 'Base embarquée sur ce poste (développement) : les données ne sont pas en ligne.',
    action: 'Renseigner DATABASE_URL avec la chaîne « Session pooler » de Supabase et le mot de passe de la base.',
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
    return {
      ...base,
      state: 'ok',
      detail: `Clé acceptée · modèle ${env.GEMINI_MODEL}${env.GEMINI_FALLBACK_MODEL ? `, secours ${env.GEMINI_FALLBACK_MODEL}` : ''}.`,
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
 * Couvertures : Cloudflare Workers AI en principal, Gemini en secours. L'état rapporté est celui
 * du fournisseur qui travaille réellement, et la ligne dit toujours lequel c'est — sans quoi une
 * facture Gemini inattendue resterait inexplicable.
 */
function checkImages(): ServiceCheck {
  const base = { id: 'images', name: 'Génération d’images', role: 'Couvertures des guides et des ebooks' };
  const billing =
    'Activer la facturation du projet Google de la clé (aistudio.google.com → Billing) : l’offre gratuite n’autorise aucune image.';

  if (!providers.cloudflareImages && !providers.gemini)
    return {
      ...base,
      state: 'off',
      detail: 'Aucun fournisseur d’images.',
      action: 'Renseigner CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_AI_TOKEN, ou à défaut GEMINI_API_KEY.',
    };

  const { cloudflare, gemini } = lastImageOutcome();
  const secours = providers.gemini ? 'Gemini prend le relais si la réserve du jour est vide.' : 'Aucun secours : sans clé Gemini, la réserve épuisée refuse les couvertures.';

  if (providers.cloudflareImages) {
    const horodate = (at: string) => new Date(at).toLocaleString('fr-FR', { timeZone: env.REPORTING_TIMEZONE });
    // Configuré n'est pas éprouvé : un jeton sans le droit d'écriture ne se révèle qu'à la
    // première image. On le dit, plutôt que d'afficher un vert qui ne repose sur rien.
    if (!cloudflare)
      return {
        ...base,
        state: 'warning',
        detail: `Cloudflare ${env.CLOUDFLARE_IMAGE_MODEL} · aucune image demandée depuis le démarrage. ${secours}`,
        action: 'Créer une couverture pour éprouver le jeton.',
      };
    if (cloudflare.ok)
      return {
        ...base,
        state: 'ok',
        detail: `Cloudflare ${env.CLOUDFLARE_IMAGE_MODEL} · dernière image produite le ${horodate(cloudflare.at)}${cloudflare.neurons ? ` (${Math.round(cloudflare.neurons)} neurones)` : ''}.`,
        action: null,
      };
    if (cloudflare.code === 'CF_IMAGE_QUOTA_EXHAUSTED')
      return {
        ...base,
        state: 'warning',
        detail: `Réserve Cloudflare du jour épuisée depuis le ${horodate(cloudflare.at)}. ${secours}`,
        action: 'Passer le compte Cloudflare en offre Workers Paid (5 $/mois) pour facturer au-delà au lieu de refuser.',
      };
    if (cloudflare.code === 'CF_IMAGE_ACCESS_DENIED')
      return {
        ...base,
        state: 'error',
        detail: 'Cloudflare refuse le jeton du serveur.',
        action: 'Recréer le jeton avec les droits « Workers AI » en lecture ET en écriture, puis mettre à jour CLOUDFLARE_AI_TOKEN.',
      };
    return {
      ...base,
      state: 'warning',
      detail: `Dernière tentative Cloudflare refusée (${cloudflare.code}) le ${horodate(cloudflare.at)}. ${secours}`,
      action: 'Réessayer une couverture ; si le refus persiste, vérifier le compte Cloudflare.',
    };
  }

  // Gemini seul : plus coûteux, et sa facturation doit être ouverte.
  if (!gemini)
    return {
      ...base,
      state: 'warning',
      detail: `Gemini ${env.GEMINI_IMAGE_MODEL} seul, faute de compte Cloudflare · pas encore vérifié depuis le démarrage.`,
      action: `Renseigner CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_AI_TOKEN : une couverture y coûte une vingtaine de fois moins. Sinon : ${billing}`,
    };
  if (gemini.ok)
    return {
      ...base,
      state: 'warning',
      detail: `Gemini ${env.GEMINI_IMAGE_MODEL} seul, faute de compte Cloudflare · dernière image le ${new Date(gemini.at).toLocaleString('fr-FR', { timeZone: env.REPORTING_TIMEZONE })}.`,
      action: 'Renseigner CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_AI_TOKEN : une couverture y coûte une vingtaine de fois moins.',
    };
  if (gemini.code === 'GEMINI_IMAGE_BILLING_REQUIRED')
    return { ...base, state: 'error', detail: 'Google refuse les images : la clé est sur l’offre gratuite.', action: billing };
  return {
    ...base,
    state: 'warning',
    detail: `Dernière tentative Gemini refusée (${gemini.code}).`,
    action: 'Réessayer une couverture ; si le refus persiste, vérifier la clé Gemini.',
  };
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

async function checkGamma(): Promise<ServiceCheck> {
  const base = { id: 'gamma', name: 'Gamma', role: 'Mise en page, illustrations et PDF des storybooks' };
  if (!providers.gamma)
    return {
      ...base,
      state: 'off',
      detail: 'Aucune clé : les storybooks sont fermés.',
      action: 'Créer une clé (offre Pro ou plus) dans Gamma → Settings → API keys, et la mettre dans GAMMA_API_KEY.',
    };
  const api = `${trimmed(env.GAMMA_API_URL)}/v1.0`;
  const headers = { 'X-API-KEY': env.GAMMA_API_KEY ?? '' };
  const result = await probe(`${api}/themes?limit=1`, headers);
  if (!result) return unreachable(base);
  if (result.status === 401 || result.status === 403) return refused(base, 'GAMMA_API_KEY');
  if (result.status !== 200) return unreachable(base);

  // Solde de crédits : lu sur le dernier conte, seul endroit où l'API le donne.
  let credits = '';
  const [latest] = await getDb().select({ ref: storybooks.generationRef }).from(storybooks).orderBy(desc(storybooks.createdAt)).limit(1);
  if (latest) {
    const generation = await probe(`${api}/generations/${encodeURIComponent(latest.ref)}`, headers);
    const remaining = (generation?.body as { credits?: { remaining?: number } } | null)?.credits?.remaining;
    if (typeof remaining === 'number') credits = ` · crédits restants : ${remaining.toLocaleString('fr-FR')}`;
  }
  return { ...base, state: 'ok', detail: `Clé acceptée · illustrations ${env.GAMMA_IMAGE_MODEL}${credits}.`, action: null };
}

async function checkHiggsfield(): Promise<ServiceCheck> {
  const base = { id: 'higgsfield', name: 'Higgsfield', role: 'Vidéos publicitaires et visuels' };
  if (!providers.higgsfield)
    return {
      ...base,
      state: 'off',
      detail: 'Aucune clé : vidéos et visuels fermés.',
      action: 'Renseigner HIGGSFIELD_API_KEY_ID et HIGGSFIELD_API_KEY_SECRET.',
    };
  const result = await probe(`${trimmed(env.HIGGSFIELD_API_URL)}/requests/00000000-0000-4000-8000-000000000000/status`, {
    Authorization: `Key ${env.HIGGSFIELD_API_KEY_ID}:${env.HIGGSFIELD_API_KEY_SECRET}`,
  });
  if (!result) return unreachable(base);
  if (result.status === 401 || result.status === 403) return refused(base, 'HIGGSFIELD_API_KEY_ID et HIGGSFIELD_API_KEY_SECRET');
  if (result.status === 404 || result.status === 200) {
    return {
      ...base,
      state: 'ok',
      detail: 'Clé acceptée. Le solde de crédits ne se lit pas par l’API : une vidéo refusée pour crédits ne retire aucun point.',
      action: 'Vérifier le solde sur higgsfield.ai avant de lancer des vidéos.',
    };
  }
  return unreachable(base);
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
  const base = { id: 'sebpay', name: 'SebPay', role: 'Mobile Money (paiement des paliers, à brancher)' };
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
  if (result.status === 401 || result.status === 403) return refused(base, 'SEBPAY_PUBLIC_KEY et SEBPAY_SECRET_KEY');
  if (result.status === 200) {
    const countries = JSON.stringify(result.body ?? '');
    const cameroon = /"CM"|Cameroun|Cameroon/i.test(countries);
    return {
      ...base,
      state: cameroon ? 'ok' : 'warning',
      detail: cameroon
        ? 'Clés acceptées · Cameroun disponible.'
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

export async function checkServices(options: { refresh?: boolean } = {}): Promise<ServicesReport> {
  if (!options.refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.report;

  const serverIp = await publicIp();
  const services = await Promise.all([
    checkDatabase(),
    checkGemini(),
    Promise.resolve(checkImages()),
    checkPerplexity(),
    checkGamma(),
    checkHiggsfield(),
    checkChariow(),
    checkRadar(),
    checkStripe(),
    checkSebpay(serverIp),
    checkEmail(),
  ]);
  const report = { checkedAt: new Date().toISOString(), serverIp, services };
  cached = { at: Date.now(), report };
  return report;
}
