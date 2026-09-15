import { createHmac, randomBytes } from 'node:crypto';
import { desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, queryRows } from '@server/db/client';
import { siteDaily, siteVisitors, siteVisits, users } from '@server/db/schema';
import { env } from '@server/env';

/**
 * Mesure d'audience sans cookie ni service tiers.
 *
 * Chaque affichage d'une page publique compte une visite, rangée par jour, page et
 * domaine d'origine. Pour les visiteurs uniques du jour, le serveur garde une
 * empreinte HMAC de l'adresse IP et du navigateur, calculée avec un sel aléatoire
 * propre au jour : sel et empreintes sont effacés le lendemain, et plus rien ne
 * permet alors de relier une visite à une personne. Refus de suivi (Do Not Track,
 * Global Privacy Control) et robots ignorés.
 */

export const TRACKED_PAGES = {
  '/': 'Accueil',
  '/connexion': 'Connexion et inscription',
  '/contact': 'Contact',
  '/mot-de-passe-oublie': 'Mot de passe oublié',
  '/mentions-legales': 'Mentions légales',
  '/confidentialite': 'Confidentialité',
  '/conditions': 'Conditions d’utilisation',
} as const;

const ROBOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp|telegram|curl|wget|python|axios|node-fetch|go-http/i;

export const visitSchema = z.object({
  path: z.string().max(200),
  referrer: z.string().max(1000).optional(),
});

/** Jour AAAA-MM-JJ dans le fuseau des statistiques. */
export function dayIn(date: Date, timeZone: string = env.REPORTING_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const bareHost = (hostname: string) => hostname.toLowerCase().replace(/^www\./, '');

/** Domaine d'origine d'une visite ; chaîne vide pour un accès direct ou depuis le site lui-même. */
export function referrerHost(referrer: string | undefined): string {
  if (!referrer) return '';
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    const host = bareHost(url.hostname);
    return host === bareHost(new URL(env.APP_URL).hostname) ? '' : host.slice(0, 100);
  } catch {
    return '';
  }
}

let purgedBefore: string | null = null;

export async function recordVisit(input: {
  path: string;
  referrer?: string;
  ipAddress: string | null;
  userAgent: string | null;
  optOut: boolean;
}): Promise<void> {
  if (!Object.hasOwn(TRACKED_PAGES, input.path) || input.optOut || !input.userAgent || ROBOTS.test(input.userAgent)) return;

  const day = dayIn(new Date());
  const referrer = referrerHost(input.referrer);
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx.insert(siteDaily).values({ day, salt: randomBytes(32).toString('hex') }).onConflictDoNothing();
    const [daily] = await tx.select({ salt: siteDaily.salt }).from(siteDaily).where(eq(siteDaily.day, day)).limit(1);
    if (daily?.salt) {
      const visitor = createHmac('sha256', daily.salt).update(`${input.ipAddress ?? ''}|${input.userAgent}`).digest('base64url');
      const inserted = await tx.insert(siteVisitors).values({ day, visitor }).onConflictDoNothing().returning({ visitor: siteVisitors.visitor });
      if (inserted.length > 0) {
        await tx.update(siteDaily).set({ uniques: sql`${siteDaily.uniques} + 1` }).where(eq(siteDaily.day, day));
      }
    }
    await tx
      .insert(siteVisits)
      .values({ day, path: input.path, referrer, visits: 1 })
      .onConflictDoUpdate({ target: [siteVisits.day, siteVisits.path, siteVisits.referrer], set: { visits: sql`${siteVisits.visits} + 1` } });
  });

  // Une fois par jour : les empreintes et le sel des jours passés disparaissent.
  if (purgedBefore !== day) {
    purgedBefore = day;
    await db.delete(siteVisitors).where(lt(siteVisitors.day, day));
    await db.update(siteDaily).set({ salt: null }).where(lt(siteDaily.day, day));
  }
}

export async function audienceSummary(days = 30, now = new Date()) {
  const dayList = [...new Set(Array.from({ length: days }, (_, index) => dayIn(new Date(now.getTime() - (days - 1 - index) * 86_400_000))))];
  const from = dayList[0]!;
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const db = getDb();
  const total = sql<number>`sum(${siteVisits.visits})::int`;

  const [visitRows, dailyRows, pageRows, referrerRows, signupRows] = await Promise.all([
    db.select({ day: siteVisits.day, visits: total }).from(siteVisits).where(gte(siteVisits.day, from)).groupBy(siteVisits.day),
    db.select({ day: siteDaily.day, uniques: siteDaily.uniques }).from(siteDaily).where(gte(siteDaily.day, from)),
    db.select({ path: siteVisits.path, visits: total }).from(siteVisits).where(gte(siteVisits.day, from)).groupBy(siteVisits.path).orderBy(desc(total)),
    db
      .select({ referrer: siteVisits.referrer, visits: total })
      .from(siteVisits)
      .where(gte(siteVisits.day, from))
      .groupBy(siteVisits.referrer)
      .orderBy(desc(total))
      .limit(11),
    queryRows<{ day: string; signups: number }>(
      sql`SELECT to_char(${users.createdAt} AT TIME ZONE ${env.REPORTING_TIMEZONE}::text, 'YYYY-MM-DD') AS day, count(*)::int AS signups
          FROM ${users} WHERE ${users.createdAt} >= ${since}::timestamptz GROUP BY 1`,
    ),
  ]);

  const visitsByDay = new Map(visitRows.map((row) => [row.day, Number(row.visits)]));
  const uniquesByDay = new Map(dailyRows.map((row) => [row.day, row.uniques]));
  const signupsByDay = new Map(signupRows.map((row) => [row.day, Number(row.signups)]));

  const daily = dayList.map((day) => ({
    day,
    visits: visitsByDay.get(day) ?? 0,
    uniques: uniquesByDay.get(day) ?? 0,
    signups: signupsByDay.get(day) ?? 0,
  }));
  const totals = daily.reduce(
    (sum, entry) => ({ visits: sum.visits + entry.visits, uniques: sum.uniques + entry.uniques, signups: sum.signups + entry.signups }),
    { visits: 0, uniques: 0, signups: 0 },
  );

  return {
    days: dayList.length,
    timezone: env.REPORTING_TIMEZONE,
    totals: {
      ...totals,
      /** Inscriptions pour 100 visiteurs uniques ; null sans visiteur. */
      conversionPercent: totals.uniques > 0 ? Math.round((totals.signups / totals.uniques) * 1000) / 10 : null,
    },
    daily,
    pages: pageRows.map((row) => ({ path: row.path, label: TRACKED_PAGES[row.path as keyof typeof TRACKED_PAGES] ?? row.path, visits: Number(row.visits) })),
    referrers: referrerRows.map((row) => ({ host: row.referrer || null, visits: Number(row.visits) })),
  };
}
