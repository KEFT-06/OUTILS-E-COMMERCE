import { env, ignoredSettings, isProd } from '@server/env';

/** Sonde lancée dans un processus séparé : `server/env.ts` valide au chargement et peut sortir en échec. */
console.log(
  JSON.stringify({
    nodeEnv: env.NODE_ENV,
    isProd,
    port: env.PORT,
    geminiApiUrl: env.GEMINI_API_URL,
    geminiApiKey: env.GEMINI_API_KEY ?? null,
    supabaseKey: env.SUPABASE_API_SECRET_KEY ?? null,
    appUrl: env.APP_URL,
    reportingTimezone: env.REPORTING_TIMEZONE,
    databaseUrl: env.DATABASE_URL ?? null,
    googleVerification: env.GOOGLE_SITE_VERIFICATION ?? null,
    bingVerification: env.BING_SITE_VERIFICATION ?? null,
    cloudflareAccount: env.CLOUDFLARE_ACCOUNT_ID ?? null,
    ignoredSettings,
  }),
);
