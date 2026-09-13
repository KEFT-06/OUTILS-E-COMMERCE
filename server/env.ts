import 'dotenv/config';
import { z } from 'zod';

/**
 * Validation de l'environnement au démarrage.
 *
 * Un serveur qui démarre avec une configuration incomplète échoue plus tard,
 * en production, sur une requête utilisateur. Mieux vaut refuser de démarrer.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
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
  HIGGSFIELD_API_KEY: z.string().min(1).optional(),
  HIGGSFIELD_API_URL: z.string().url().default('https://api.higgsfield.ai'),
  GAMMA_API_KEY: z.string().min(1).optional(),

  // Ingestion publicitaire (module 1)
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),

  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

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

  SESSION_SECRET: z.string().min(32).optional(),
  JWT_SECRET: z.string().min(32).optional(),
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

/** Vrai si la clé du fournisseur est présente. Aucune route ne doit la lire directement. */
export const providers = {
  gemini: Boolean(env.GEMINI_API_KEY),
  higgsfield: Boolean(env.HIGGSFIELD_API_KEY),
  gamma: Boolean(env.GAMMA_API_KEY),
  meta: Boolean(env.META_ACCESS_TOKEN),
} as const;

/**
 * Garde-fou de démarrage : en production, les secrets de session sont obligatoires.
 * Les laisser optionnels en développement évite de bloquer un contributeur, mais
 * les laisser optionnels en production serait une faille.
 */
if (isProd) {
  const missing = (['SESSION_SECRET', 'JWT_SECRET'] as const).filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`\n❌ En production, ces secrets sont obligatoires : ${missing.join(', ')}`);
    console.error('   Générez-les avec : openssl rand -hex 32\n');
    process.exit(1);
  }
}
