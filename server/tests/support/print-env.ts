import { env, isProd } from '@server/env';

/** Sonde lancée dans un processus séparé : `server/env.ts` valide au chargement et peut sortir en échec. */
console.log(
  JSON.stringify({
    nodeEnv: env.NODE_ENV,
    isProd,
    port: env.PORT,
    geminiApiUrl: env.GEMINI_API_URL,
    geminiApiKey: env.GEMINI_API_KEY ?? null,
    higgsfieldId: env.HIGGSFIELD_API_KEY_ID ?? null,
    appUrl: env.APP_URL,
    reportingTimezone: env.REPORTING_TIMEZONE,
    databaseUrl: env.DATABASE_URL ?? null,
  }),
);
