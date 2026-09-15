import 'dotenv/config';
import { z } from 'zod';

/** Une ligne `NOM=` recopiée de .env.example vaut « non renseigné », pas « chaîne vide ». */
function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema);
}

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
  APP_URL: z.string().url().default('http://localhost:5173'),

  // Origines CORS autorisées, séparées par des virgules.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Fournisseurs IA — optionnels : chaque route vérifie la clé dont elle dépend
  // et renvoie 503 avec un message explicite si elle manque.
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_API_URL: z.string().url().default('https://generativelanguage.googleapis.com'),
  /** Modèle de traduction des guides multilingues. */
  GEMINI_MODEL: z.string().regex(/^[\w.-]+$/).default('gemini-2.5-flash'),
  // Higgsfield authentifie par une paire identifiant + secret, envoyée sous la
  // forme `Authorization: Key ID:SECRET` (docs.higgsfield.ai/docs/authentication).
  // L'ancienne variable unique HIGGSFIELD_API_KEY ne pouvait fonctionner avec
  // aucun appel réel : elle est remplacée par les deux noms de la documentation.
  HIGGSFIELD_API_KEY_ID: z.string().min(1).optional(),
  HIGGSFIELD_API_KEY_SECRET: z.string().min(1).optional(),
  HIGGSFIELD_API_URL: z.string().url().default('https://api.higgsfield.ai'),
  GAMMA_API_KEY: z.string().min(1).optional(),

  // Ingestion publicitaire (module 1)
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),

  /**
   * PostgreSQL (Supabase en production, obligatoire). Absente en développement :
   * base embarquée dans .data/pglite, exclue de Git. `memory://` : base éphémère
   * des tests.
   */
  DATABASE_URL: emptyAsUndefined(z.string().optional()),
  REDIS_URL: z.string().optional(),

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

  /**
   * Source d'ingestion publicitaire active : « meta » (défaut) ou « fixture ».
   *
   * `fixture` produit des publicités de démonstration et doit être demandé
   * explicitement. Le laisser se déclencher par défaut ferait servir des
   * chiffres fictifs à toute installation mal configurée.
   */
  AD_INGESTION_ADAPTER: z.enum(['meta', 'fixture']).optional(),

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
  higgsfield: Boolean(env.HIGGSFIELD_API_KEY_ID && env.HIGGSFIELD_API_KEY_SECRET),
  gamma: Boolean(env.GAMMA_API_KEY),
  meta: Boolean(env.META_ACCESS_TOKEN),
  chariow: Boolean(env.CHARIOW_API_KEY),
} as const;

/**
 * Garde-fou de démarrage : en production, la base distante et la clé de chiffrement
 * sont obligatoires. Optionnelles en développement pour ne pas bloquer un
 * contributeur ; optionnelles en production, ce serait une faille.
 */
if (isProd) {
  const missing = (['DATABASE_URL', 'DATA_ENCRYPTION_KEY'] as const).filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`\n❌ En production, ces secrets sont obligatoires : ${missing.join(', ')}`);
    console.error('   Générez-les avec : openssl rand -hex 32\n');
    process.exit(1);
  }
}
