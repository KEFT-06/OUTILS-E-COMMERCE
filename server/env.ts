import 'dotenv/config';
import { z } from 'zod';

/** Une ligne `NOM=` recopiée de .env.example vaut « non renseigné », pas « chaîne vide ». */
function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema);
}

/** Adresse publique attribuée par l'hébergeur (Render), utilisée quand APP_URL n'est pas renseignée. */
const hostedUrl = process.env.RENDER_EXTERNAL_URL || undefined;

/**
 * Validation de l'environnement au démarrage.
 *
 * Un serveur qui démarre avec une configuration incomplète échoue plus tard,
 * en production, sur une requête utilisateur. Mieux vaut refuser de démarrer.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Adresse d'écoute. Vide : 127.0.0.1 hors production, pour que seul ce poste
   * joigne l'API — sinon tout appareil du même Wi-Fi pourrait lancer des
   * générations payées avec les clés du serveur. En production : 0.0.0.0, que
   * les hébergeurs exigent.
   */
  HOST: z.string().optional(),
  /**
   * Proxys placés devant le serveur, pour lire la vraie adresse IP du visiteur (limites de
   * débit, journal de sécurité). « 1 » derrière un hébergeur ou un répartiteur de charge ;
   * « 0 » quand le serveur est joint directement, sinon n'importe qui pourrait se forger une
   * adresse avec l'en-tête X-Forwarded-For. Vide : 1 en production, boucle locale sinon.
   */
  TRUST_PROXY: emptyAsUndefined(z.coerce.number().int().min(0).max(5).optional()),
  APP_URL: emptyAsUndefined(z.string().url().default(hostedUrl ?? 'http://localhost:5173')),

  // Origines CORS autorisées, séparées par des virgules. Vide : l'adresse publique.
  CORS_ORIGINS: emptyAsUndefined(z.string().default(process.env.APP_URL || hostedUrl || 'http://localhost:5173'))
    .transform((v) =>
      v
        .split(',')
        // Une origine envoyée par le navigateur ne finit jamais par « / ».
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),

  // Fournisseurs IA — optionnels : chaque route vérifie la clé dont elle dépend
  // et renvoie 503 avec un message explicite si elle manque.
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_API_URL: z.string().url().default('https://generativelanguage.googleapis.com'),
  /** Modèle Gemini des analyses de niche, des rédactions et des traductions. */
  GEMINI_MODEL: emptyAsUndefined(z.string().regex(/^[\w.-]+$/).default('gemini-3.5-flash')),
  /**
   * Modèle de secours quand le modèle principal est saturé chez Google (réponse 503, « high
   * demand »), après une seconde tentative. « off » : pas de modèle de secours.
   */
  GEMINI_FALLBACK_MODEL: emptyAsUndefined(
    z
      .string()
      .regex(/^[\w.-]+$/)
      .default('gemini-3.6-flash')
      .transform((model) => (model === 'off' ? null : model)),
  ),
  /**
   * Étude de marché des analyses de niche : Perplexity cherche et lit le web (Agent API, repli
   * sur l'API Search), Gemini rédige ensuite le rapport sans rien avancer hors des sources citées.
   * La recherche Google intégrée à Gemini n'est pas utilisée : ses conditions interdisent de
   * conserver ou d'exporter les résultats. Sans clé, l'analyse de niche est refusée.
   */
  PERPLEXITY_API_KEY: emptyAsUndefined(z.string().min(1).optional()),
  PERPLEXITY_API_URL: emptyAsUndefined(z.string().url().default('https://api.perplexity.ai')),
  /**
   * Profondeur de l'étude menée par l'Agent API de Perplexity (préréglages de Perplexity) :
   * « medium » = recherche approfondie (défaut, environ une minute), « high » = la plus complète,
   * « low »/« fast » = plus rapides. « off » : seulement l'API Search (pages brutes, sans étude).
   */
  PERPLEXITY_RESEARCH_PRESET: emptyAsUndefined(z.enum(['fast', 'low', 'medium', 'high', 'off']).default('medium')),
  /**
   * Modèle d'image de Gemini (couvertures des guides et des ebooks). Exige la facturation activée
   * sur le projet Google de la clé : l'offre gratuite n'autorise aucune image.
   */
  GEMINI_IMAGE_MODEL: emptyAsUndefined(z.string().regex(/^[\w.-]+$/).default('gemini-3.1-flash-image')),
  /** Modèle d'image que Gamma utilise pour illustrer les storybooks (liste : developers.gamma.app, « Image models »). */
  GAMMA_IMAGE_MODEL: emptyAsUndefined(z.string().regex(/^[\w.-]+$/).default('gemini-3.1-flash-image')),
  // Higgsfield authentifie par une paire identifiant + secret, envoyée sous la
  // forme `Authorization: Key ID:SECRET` (docs.higgsfield.ai/docs/authentication).
  // L'ancienne variable unique HIGGSFIELD_API_KEY ne pouvait fonctionner avec
  // aucun appel réel : elle est remplacée par les deux noms de la documentation.
  HIGGSFIELD_API_KEY_ID: z.string().min(1).optional(),
  HIGGSFIELD_API_KEY_SECRET: z.string().min(1).optional(),
  HIGGSFIELD_API_URL: z.string().url().default('https://api.higgsfield.ai'),
  GAMMA_API_KEY: emptyAsUndefined(z.string().min(1).optional()),
  /** Surchargeable pour tester contre un serveur factice. */
  GAMMA_API_URL: emptyAsUndefined(z.string().url().default('https://public-api.gamma.app')),

  /**
   * E-mails transactionnels (mot de passe oublié, confirmation d'adresse, alertes de
   * sécurité) : Brevo ou Resend. EMAIL_FROM : « Nom <adresse> » d'un domaine vérifié
   * chez le fournisseur. Sans eux, le mot de passe oublié passe par l'administrateur.
   */
  EMAIL_PROVIDER: emptyAsUndefined(z.enum(['brevo', 'resend']).optional()),
  EMAIL_API_KEY: emptyAsUndefined(z.string().min(1).optional()),
  EMAIL_FROM: emptyAsUndefined(z.string().min(3).optional()),
  /** Surchargeable pour tester contre un serveur factice. */
  EMAIL_API_URL: emptyAsUndefined(z.string().url().optional()),
  /**
   * Paiement en ligne des paliers (Stripe Checkout). STRIPE_API_KEY : clé secrète (sk_test_… en
   * mode test, sk_live_… en réel). STRIPE_WEBHOOK_SECRET : secret de signature du webhook
   * /api/billing/webhook (whsec_…), recommandé pour ne manquer aucun paiement.
   */
  STRIPE_API_KEY: emptyAsUndefined(z.string().min(1).optional()),
  STRIPE_WEBHOOK_SECRET: emptyAsUndefined(z.string().min(1).optional()),
  STRIPE_API_URL: emptyAsUndefined(z.string().url().default('https://api.stripe.com')),

  /**
   * Premier administrateur d'une nouvelle installation (hébergeur sans terminal) : créé au
   * démarrage tant qu'aucun administrateur n'existe, avec un lien à usage unique dans le journal
   * du serveur. Sans effet ensuite. Voir server/services/admin/bootstrap.ts.
   */
  ADMIN_BOOTSTRAP_EMAIL: emptyAsUndefined(z.string().email().optional()),

  /**
   * SebPay (Mobile Money, Afrique de l'Ouest et centrale) : clés publique et secrète du tableau de bord.
   * Les clés sont limitées aux adresses IP autorisées chez SebPay ; l'administration affiche celle du serveur.
   */
  SEBPAY_PUBLIC_KEY: emptyAsUndefined(z.string().min(1).optional()),
  SEBPAY_SECRET_KEY: emptyAsUndefined(z.string().min(1).optional()),
  SEBPAY_API_URL: emptyAsUndefined(z.string().url().default('https://newapi.sebpay.bj/api/v1')),
  /** Service qui renvoie l'adresse IP publique du serveur (page « État des services ») ; « off » pour ne pas l'interroger. */
  PUBLIC_IP_URL: emptyAsUndefined(z.string().default('https://api.ipify.org?format=json')),

  /** Facultatif : boîte de l'équipe, qui reçoit une copie de chaque message de la page Contact et un avis à chaque paiement en ligne. */
  CONTACT_INBOX_EMAIL: emptyAsUndefined(z.string().email().optional()),

  /**
   * PostgreSQL (Supabase en production, obligatoire). Absente en développement :
   * base embarquée dans .data/pglite, exclue de Git. `memory://` : base éphémère
   * des tests.
   */
  DATABASE_URL: emptyAsUndefined(z.string().optional()),

  /**
   * Clé de chiffrement des secrets stockés en base (double authentification, clés
   * API Chariow des utilisateurs) : 64 caractères hexadécimaux, soit 256 bits.
   * Générer avec : openssl rand -hex 32. La perdre rend ces secrets illisibles.
   */
  DATA_ENCRYPTION_KEY: emptyAsUndefined(
    z.string().regex(/^[0-9a-fA-F]{64}$/, '64 caractères hexadécimaux attendus (openssl rand -hex 32).').optional(),
  ),

  /** Fuseau des statistiques « aujourd'hui, ce mois, cette année » de l'administration. */
  REPORTING_TIMEZONE: emptyAsUndefined(
    z
      .string()
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('fr-FR', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'Fuseau horaire inconnu (exemple : Africa/Abidjan).')
      .default('UTC'),
  ),

  /** Paliers d'abonnement : quotas, prix et fonctions ouvertes. */
  PLANS_PATH: emptyAsUndefined(z.string().optional()),

  /**
   * Taux de change (base EUR), rafraîchis chaque jour pour afficher les prix dans
   * la devise du pays de chaque utilisateur. Données ouvertes, sans clé ; aucune
   * donnée personnelle n'est envoyée. « off » : taux de repli de
   * server/config/exchange-rates.json uniquement.
   */
  EXCHANGE_RATES_URL: emptyAsUndefined(
    z.union([z.literal('off'), z.string().url()]).default('https://open.er-api.com/v6/latest/EUR'),
  ),

  /**
   * Emplacement de la table de règles de conformité.
   *
   * Doit rester un fichier EXTERNE au bundle : le CdC §6.4.1 exige de pouvoir
   * l'éditer sans redéployer. L'inliner dans le build réglerait le problème de
   * chemin mais supprimerait cette propriété — ce serait résoudre un incident
   * en cassant une exigence.
   */
  COMPLIANCE_RULES_PATH: z.string().optional(),

  /** Grille tarifaire des research points (CdC §8). Mêmes contraintes. */
  CREDIT_COSTS_PATH: z.string().optional(),

  /** Fourchettes de prix produits et coûts publicitaires (CdC §2). */
  PRICING_PATH: z.string().optional(),

  /** Paramètres et corpus du vérificateur d'originalité (feuille de route 3.2). */
  ORIGINALITY_PATH: z.string().optional(),

  /** Structures de campagnes Meta et TikTok (feuille de route 5.4). */
  CAMPAIGN_BLUEPRINTS_PATH: z.string().optional(),

  /** Boutons d'appel à l'action et découpages des scripts du kit de lancement (5.1). */
  LAUNCH_KIT_PATH: z.string().optional(),

  /**
   * Clé API Chariow (connecteur marketplace, feuille de route 5.2), créée dans
   * app.chariow.com → Paramètres → Clés API. Serveur uniquement : la
   * documentation Chariow interdit de l'exposer au navigateur.
   */
  CHARIOW_API_KEY: z.string().min(1).optional(),
  /** Surchargeable pour tester le connecteur contre un serveur factice. */
  CHARIOW_API_URL: z.string().url().default('https://api.chariow.com/v1'),


});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌ Configuration d’environnement invalide :\n');
  for (const issue of parsed.error.issues) {
    console.error(`   · ${issue.path.join('.')} — ${issue.message}`);
  }
  console.error('\n   Copiez .env.example vers .env et complétez les valeurs.\n');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const listenHost = env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1');

/** Vrai si la clé du fournisseur est présente. Aucune route ne doit la lire directement. */
export const providers = {
  gemini: Boolean(env.GEMINI_API_KEY),
  webSearch: Boolean(env.PERPLEXITY_API_KEY),
  email: Boolean(env.EMAIL_PROVIDER && env.EMAIL_API_KEY && env.EMAIL_FROM),
  payments: Boolean(env.STRIPE_API_KEY && !env.STRIPE_API_KEY.trim().startsWith('pk_')),
  higgsfield: Boolean(env.HIGGSFIELD_API_KEY_ID && env.HIGGSFIELD_API_KEY_SECRET),
  gamma: Boolean(env.GAMMA_API_KEY),
  chariow: Boolean(env.CHARIOW_API_KEY),
} as const;

/**
 * Garde-fou de démarrage : en production, la base distante et la clé de chiffrement
 * sont obligatoires. Optionnelles en développement pour ne pas bloquer un
 * contributeur ; optionnelles en production, ce serait une faille.
 */
if (isProd) {
  // Sans adresse publique en https, les liens envoyés (paiement, mot de passe) pointeraient ailleurs.
  if (!env.APP_URL.startsWith('https://')) {
    console.warn(`\n⚠️  APP_URL vaut ${env.APP_URL} : indiquez l'adresse publique du site en https (liens de paiement et de mot de passe).\n`);
  }
  const missing = (['DATABASE_URL', 'DATA_ENCRYPTION_KEY'] as const).filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`\n❌ En production, ces secrets sont obligatoires : ${missing.join(', ')}`);
    console.error('   Générez-les avec : openssl rand -hex 32\n');
    process.exit(1);
  }
}
