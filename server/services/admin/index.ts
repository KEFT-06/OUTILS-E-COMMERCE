import { and, desc, eq, exists, gt, gte, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { getDb, queryRows } from '@server/db/client';
import {
  GENERATION_KINDS,
  PLAN_IDS,
  auditLogs,
  authEvents,
  authThrottles,
  creditTransactions,
  generations,
  payments,
  sessions,
  userPermissions,
  users,
} from '@server/db/schema';
import { env } from '@server/env';
import { describeDevice, maskIp } from '@server/lib/device';
import { AppError } from '@server/middleware';
import { creditSummary, loadAccount } from '@server/services/accounts';
import { AUTH_EVENT_LABELS } from '@server/services/audit';
import { ONLINE_WINDOW_MS } from '@server/services/auth/sessions';
import { integrationsOverview } from '@server/services/integrations';
import { FEATURES, FEATURE_IDS, getPlanConfig } from '@server/services/plans';

/**
 * Statistiques de l'administration.
 *
 * Tout est calculé en base à partir des lignes réelles : paiements enregistrés,
 * générations, sessions. Aucun chiffre estimé. Les périodes « aujourd'hui, ce
 * mois, cette année » suivent le fuseau REPORTING_TIMEZONE.
 */

export const GRANULARITIES = ['day', 'month', 'year'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

const SERIES: Record<Granularity, { count: number; format: string }> = {
  day: { count: 30, format: 'YYYY-MM-DD' },
  month: { count: 12, format: 'YYYY-MM' },
  year: { count: 5, format: 'YYYY' },
};

const DAY_MS = 86_400_000;

const zone = () => sql`${env.REPORTING_TIMEZONE}::text`;
const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;
const num = (expression: SQL) => sql<number>`${expression}`.mapWith(Number);
const optionalDate = (value: unknown) => (value ? new Date(value as string) : null);

/** Début de la période courante (ou d'une période antérieure) dans le fuseau de reporting. */
function startOf(unit: Granularity, periodsBack = 0): SQL {
  const shift = periodsBack > 0 ? sql.raw(` - interval '${periodsBack} ${unit}'`) : sql.raw('');
  return sql`((date_trunc('${sql.raw(unit)}', now() AT TIME ZONE ${zone()})${shift}) AT TIME ZONE ${zone()})`;
}

async function planLabels(): Promise<Record<string, string>> {
  const config = await getPlanConfig();
  return Object.fromEntries(config.plans.map((plan) => [plan.id, plan.label]));
}

/* -------------------------------------------------------------------------- */
/*  Vue d'ensemble                                                             */
/* -------------------------------------------------------------------------- */

export async function revenueTotals() {
  const db = getDb();
  const [row] = await db
    .select({
      today: num(sql`coalesce(sum(${payments.amountFcfa}) filter (where ${payments.paidAt} >= ${startOf('day')}), 0)`),
      month: num(sql`coalesce(sum(${payments.amountFcfa}) filter (where ${payments.paidAt} >= ${startOf('month')}), 0)`),
      previousMonth: num(
        sql`coalesce(sum(${payments.amountFcfa}) filter (where ${payments.paidAt} >= ${startOf('month', 1)} and ${payments.paidAt} < ${startOf('month')}), 0)`,
      ),
      year: num(sql`coalesce(sum(${payments.amountFcfa}) filter (where ${payments.paidAt} >= ${startOf('year')}), 0)`),
      total: num(sql`coalesce(sum(${payments.amountFcfa}), 0)`),
      payments: num(sql`count(*)`),
      // Revenu mensuel récurrent : chaque abonnement en cours, ramené à un mois.
      monthlyRecurring: num(
        sql`coalesce(round(sum(${payments.amountFcfa}::float8 / ${payments.periodMonths}) filter (where ${payments.paidAt} + make_interval(months => ${payments.periodMonths}) > now())), 0)`,
      ),
    })
    .from(payments)
    .where(eq(payments.status, 'paid'));

  const [subscribers] = await db
    .select({ active: num(sql`count(*)`) })
    .from(users)
    .where(
      and(
        sql`${users.plan} <> 'free'`,
        eq(users.status, 'active'),
        or(sql`${users.planExpiresAt} is null`, gt(users.planExpiresAt, new Date())),
      ),
    );

  return { currency: 'FCFA', ...row!, activeSubscribers: subscribers?.active ?? 0 };
}

async function securityTotals() {
  const db = getDb();
  const since = new Date(Date.now() - DAY_MS);
  const [events] = await db
    .select({
      logins24h: num(sql`count(*) filter (where ${authEvents.type} = 'login_success')`),
      failedLogins24h: num(sql`count(*) filter (where ${authEvents.type} in ('login_failure', 'mfa_failure'))`),
      blockedAttempts24h: num(sql`count(*) filter (where ${authEvents.type} = 'login_locked')`),
    })
    .from(authEvents)
    .where(gte(authEvents.createdAt, since));
  const [locks] = await db
    .select({ active: num(sql`count(*)`) })
    .from(authThrottles)
    .where(gt(authThrottles.lockedUntil, new Date()));
  return { ...events!, activeLocks: locks?.active ?? 0 };
}

async function generationTotals() {
  const db = getDb();
  const since = new Date(Date.now() - 30 * DAY_MS);
  const byKind = await db
    .select({
      kind: generations.kind,
      total: num(sql`count(*)`),
      completed: num(sql`count(*) filter (where ${generations.status} = 'completed')`),
      failed: num(sql`count(*) filter (where ${generations.status} = 'failed')`),
      last30d: num(sql`count(*) filter (where ${generations.createdAt} >= ${at(since)})`),
      declaredByBrowser: num(sql`count(*) filter (where ${generations.source} = 'client')`),
    })
    .from(generations)
    .groupBy(generations.kind);

  const byFormat = await db
    .select({ format: generations.fileFormat, files: num(sql`count(*)`) })
    .from(generations)
    .where(and(isNotNull(generations.fileFormat), eq(generations.status, 'completed')))
    .groupBy(generations.fileFormat);

  return {
    byKind: GENERATION_KINDS.map((kind) => {
      const row = byKind.find((candidate) => candidate.kind === kind);
      return {
        kind,
        total: row?.total ?? 0,
        completed: row?.completed ?? 0,
        failed: row?.failed ?? 0,
        last30d: row?.last30d ?? 0,
        declaredByBrowser: row?.declaredByBrowser ?? 0,
      };
    }),
    byFormat: byFormat
      .filter((row): row is { format: string; files: number } => Boolean(row.format))
      .sort((a, b) => b.files - a.files),
  };
}

export async function adminOverview(options: { includeRevenue: boolean; includeSecurity: boolean }) {
  const db = getDb();
  const now = new Date();
  const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS);

  const [userStats] = await db
    .select({
      total: num(sql`count(*)`),
      newToday: num(sql`count(*) filter (where ${users.createdAt} >= ${startOf('day')})`),
      new7d: num(sql`count(*) filter (where ${users.createdAt} >= ${at(new Date(now.getTime() - 7 * DAY_MS))})`),
      new30d: num(sql`count(*) filter (where ${users.createdAt} >= ${at(new Date(now.getTime() - 30 * DAY_MS))})`),
      suspended: num(sql`count(*) filter (where ${users.status} = 'suspended')`),
      admins: num(sql`count(*) filter (where ${users.role} = 'admin')`),
      withTwoFactor: num(sql`count(*) filter (where ${users.twoFactorEnabledAt} is not null)`),
    })
    .from(users);

  const planRows = await db
    .select({ plan: users.plan, users: num(sql`count(*)`) })
    .from(users)
    .groupBy(users.plan);

  const [online] = await db
    .select({
      users: num(sql`count(distinct ${sessions.userId})`),
      sessions: num(sql`count(*)`),
    })
    .from(sessions)
    .where(and(gte(sessions.lastSeenAt, onlineSince), gt(sessions.expiresAt, now)));

  const [activeToday] = await db
    .select({ users: num(sql`count(distinct ${sessions.userId})`) })
    .from(sessions)
    .where(sql`${sessions.lastSeenAt} >= ${startOf('day')}`);

  const [credits] = await db
    .select({
      consumed30d: num(
        sql`coalesce(-(sum(${creditTransactions.planDelta} + ${creditTransactions.bonusDelta}) filter (where ${creditTransactions.reason} in ('usage', 'refund'))), 0)`,
      ),
      granted30d: num(
        sql`coalesce(sum(${creditTransactions.bonusDelta}) filter (where ${creditTransactions.reason} = 'admin_grant' and ${creditTransactions.bonusDelta} > 0), 0)`,
      ),
    })
    .from(creditTransactions)
    .where(gte(creditTransactions.createdAt, new Date(now.getTime() - 30 * DAY_MS)));

  const labels = await planLabels();

  return {
    generatedAt: now.toISOString(),
    timezone: env.REPORTING_TIMEZONE,
    users: userStats!,
    online: { users: online?.users ?? 0, sessions: online?.sessions ?? 0, activeToday: activeToday?.users ?? 0 },
    plans: PLAN_IDS.map((id) => ({ id, label: labels[id] ?? id, users: planRows.find((row) => row.plan === id)?.users ?? 0 })),
    content: await generationTotals(),
    credits: credits!,
    revenue: options.includeRevenue ? await revenueTotals() : null,
    security: options.includeSecurity ? await securityTotals() : null,
    recentActivity: options.includeSecurity ? await auditEntries({ page: 1, pageSize: 8 }).then((result) => result.entries) : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Séries temporelles                                                         */
/* -------------------------------------------------------------------------- */

function periodsCte(granularity: Granularity): SQL {
  const { count } = SERIES[granularity];
  const unit = sql.raw(granularity);
  return sql`periods AS (
    SELECT generate_series(
      date_trunc('${unit}', now() AT TIME ZONE ${zone()}) - interval '${sql.raw(String(count - 1))} ${unit}',
      date_trunc('${unit}', now() AT TIME ZONE ${zone()}),
      interval '1 ${unit}'
    ) AS period
  )`;
}

export async function revenueSeries(granularity: Granularity) {
  const { format } = SERIES[granularity];
  const unit = sql.raw(granularity);

  const points = await queryRows<{ period: string; amount: number; payments: number }>(sql`
    WITH ${periodsCte(granularity)}
    SELECT to_char(periods.period, ${format}::text) AS period,
           coalesce(sum(p.amount_fcfa), 0)::float8 AS amount,
           count(p.id)::int AS payments
    FROM periods
    LEFT JOIN payments p
      ON p.status = 'paid'
     AND date_trunc('${unit}', p.paid_at AT TIME ZONE ${zone()}) = periods.period
    GROUP BY periods.period
    ORDER BY periods.period
  `);

  const since = startOf(granularity, SERIES[granularity].count - 1);
  const byPlan = await queryRows<{ plan: string; amount: number; payments: number }>(sql`
    SELECT plan::text AS plan, coalesce(sum(amount_fcfa), 0)::float8 AS amount, count(*)::int AS payments
    FROM payments WHERE status = 'paid' AND paid_at >= ${since}
    GROUP BY plan ORDER BY amount DESC
  `);
  const byMethod = await queryRows<{ method: string; amount: number; payments: number }>(sql`
    SELECT method::text AS method, coalesce(sum(amount_fcfa), 0)::float8 AS amount, count(*)::int AS payments
    FROM payments WHERE status = 'paid' AND paid_at >= ${since}
    GROUP BY method ORDER BY amount DESC
  `);

  const labels = await planLabels();
  return {
    granularity,
    timezone: env.REPORTING_TIMEZONE,
    currency: 'FCFA',
    points: points.map((point) => ({ ...point, amount: Number(point.amount), payments: Number(point.payments) })),
    total: points.reduce((sum, point) => sum + Number(point.amount), 0),
    byPlan: byPlan.map((row) => ({ ...row, label: labels[row.plan] ?? row.plan, amount: Number(row.amount) })),
    byMethod: byMethod.map((row) => ({ ...row, amount: Number(row.amount) })),
  };
}

export async function usageSeries(granularity: Granularity) {
  const { format } = SERIES[granularity];
  const unit = sql.raw(granularity);

  const rows = await queryRows<{ period: string; kind: string | null; count: number }>(sql`
    WITH ${periodsCte(granularity)}
    SELECT to_char(periods.period, ${format}::text) AS period, g.kind::text AS kind, count(g.id)::int AS count
    FROM periods
    LEFT JOIN generations g ON date_trunc('${unit}', g.created_at AT TIME ZONE ${zone()}) = periods.period
    GROUP BY periods.period, g.kind
    ORDER BY periods.period
  `);

  const points = new Map<string, Record<string, number | string>>();
  for (const row of rows) {
    const point = points.get(row.period) ?? { period: row.period, ...Object.fromEntries(GENERATION_KINDS.map((kind) => [kind, 0])) };
    if (row.kind) point[row.kind] = Number(row.count);
    points.set(row.period, point);
  }
  return { granularity, timezone: env.REPORTING_TIMEZONE, points: [...points.values()] };
}

export async function contentStats(granularity: Granularity) {
  const db = getDb();
  const since = new Date(Date.now() - 30 * DAY_MS);

  const topCreators = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      generations: num(sql`count(*)`),
    })
    .from(generations)
    .innerJoin(users, eq(users.id, generations.userId))
    .where(gte(generations.createdAt, since))
    .groupBy(users.id, users.name, users.email)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  const creditsByAction = await db
    .select({
      actionId: creditTransactions.actionId,
      points: num(sql`coalesce(-sum(${creditTransactions.planDelta} + ${creditTransactions.bonusDelta}), 0)`),
      uses: num(sql`count(*) filter (where ${creditTransactions.reason} = 'usage')`),
    })
    .from(creditTransactions)
    .where(
      and(
        isNotNull(creditTransactions.actionId),
        gte(creditTransactions.createdAt, since),
        sql`${creditTransactions.reason} in ('usage', 'refund')`,
      ),
    )
    .groupBy(creditTransactions.actionId);

  return {
    totals: await generationTotals(),
    series: await usageSeries(granularity),
    topCreators,
    creditsByAction: creditsByAction.sort((a, b) => b.points - a.points),
  };
}

/* -------------------------------------------------------------------------- */
/*  Utilisateurs                                                               */
/* -------------------------------------------------------------------------- */

export const userListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  plan: z.enum(PLAN_IDS).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  role: z.enum(['user', 'admin', 'staff']).optional(),
  online: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  sort: z.enum(['created_desc', 'created_asc', 'last_seen_desc', 'credits_desc', 'name_asc']).default('created_desc'),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

export async function listUsers(query: UserListQuery) {
  const db = getDb();
  const now = new Date();
  const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS);

  const hasPermissions = exists(
    db.select({ one: sql`1` }).from(userPermissions).where(eq(userPermissions.userId, users.id)),
  );
  const isOnline = exists(
    db
      .select({ one: sql`1` })
      .from(sessions)
      .where(and(eq(sessions.userId, users.id), gte(sessions.lastSeenAt, onlineSince), gt(sessions.expiresAt, now))),
  );

  const conditions: SQL[] = [];
  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    conditions.push(or(ilike(users.email, pattern), ilike(users.name, pattern))!);
  }
  if (query.plan) conditions.push(eq(users.plan, query.plan));
  if (query.status) conditions.push(eq(users.status, query.status));
  if (query.role === 'admin') conditions.push(eq(users.role, 'admin'));
  if (query.role === 'user') conditions.push(and(eq(users.role, 'user'), sql`not ${hasPermissions}`)!);
  if (query.role === 'staff') conditions.push(or(eq(users.role, 'admin'), hasPermissions)!);
  if (query.online) conditions.push(isOnline);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const lastSeen = sql`(select max(${sessions.lastSeenAt}) from ${sessions} where ${sessions.userId} = ${users.id} and ${sessions.expiresAt} > now())`;
  const orderBy = {
    created_desc: [desc(users.createdAt)],
    created_asc: [users.createdAt],
    last_seen_desc: [sql`${lastSeen} desc nulls last`],
    credits_desc: [desc(sql`${users.planCredits} + ${users.bonusCredits}`)],
    name_asc: [users.name],
  }[query.sort];

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      plan: users.plan,
      planExpiresAt: users.planExpiresAt,
      planCredits: users.planCredits,
      bonusCredits: users.bonusCredits,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      twoFactorEnabledAt: users.twoFactorEnabledAt,
      lastSeenAt: sql<Date | null>`${lastSeen}`.mapWith(optionalDate),
      generations: num(sql`(select count(*) from ${generations} where ${generations.userId} = ${users.id})`),
      permissionCount: num(sql`(select count(*) from ${userPermissions} where ${userPermissions.userId} = ${users.id})`),
    })
    .from(users)
    .where(where)
    .orderBy(...orderBy)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const [total] = await db.select({ value: num(sql`count(*)`) }).from(users).where(where);
  const labels = await planLabels();

  return {
    page: query.page,
    pageSize: query.pageSize,
    total: total?.value ?? 0,
    users: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
      plan: { id: row.plan, label: labels[row.plan] ?? row.plan },
      planExpiresAt: row.planExpiresAt?.toISOString() ?? null,
      credits: { plan: row.planCredits, bonus: row.bonusCredits, total: row.planCredits + row.bonusCredits },
      createdAt: row.createdAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      online: Boolean(row.lastSeenAt && row.lastSeenAt >= onlineSince),
      generations: row.generations,
      isStaff: row.role === 'admin' || row.permissionCount > 0,
      twoFactorEnabled: Boolean(row.twoFactorEnabledAt),
    })),
  };
}

export async function adminUserDetail(userId: string) {
  const snapshot = await loadAccount(userId);
  if (!snapshot) throw new AppError(404, 'Utilisateur introuvable.', 'USER_NOT_FOUND');

  const db = getDb();
  const now = new Date();
  const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS);
  const { user, plan } = snapshot;
  const actor = alias(users, 'actor');

  const sessionRows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.lastSeenAt));

  const ledger = await db
    .select({ entry: creditTransactions, actorEmail: actor.email })
    .from(creditTransactions)
    .leftJoin(actor, eq(actor.id, creditTransactions.actorId))
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(50);

  const generationRows = await db
    .select()
    .from(generations)
    .where(eq(generations.userId, userId))
    .orderBy(desc(generations.createdAt))
    .limit(50);

  const usage = await db
    .select({ kind: generations.kind, count: num(sql`count(*)`) })
    .from(generations)
    .where(eq(generations.userId, userId))
    .groupBy(generations.kind);

  const recorder = alias(users, 'recorder');
  const paymentRows = await db
    .select({ payment: payments, recordedByEmail: recorder.email })
    .from(payments)
    .leftJoin(recorder, eq(recorder.id, payments.recordedBy))
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.paidAt))
    .limit(50);

  const events = await db
    .select()
    .from(authEvents)
    .where(eq(authEvents.userId, userId))
    .orderBy(desc(authEvents.createdAt))
    .limit(30);

  const audit = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetUserId, userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(30);

  const grants = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId));

  const integrations = await integrationsOverview(user);
  const lastSeenAt = sessionRows[0]?.lastSeenAt ?? null;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      suspendedReason: user.suspendedReason,
      plan: { id: plan.id, label: plan.label },
      planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lastSeenAt: lastSeenAt?.toISOString() ?? null,
      online: Boolean(lastSeenAt && lastSeenAt >= onlineSince),
      passwordSet: Boolean(user.passwordHash),
      twoFactorEnabled: Boolean(user.twoFactorEnabledAt),
      isStaff: snapshot.isStaff,
    },
    credits: creditSummary(snapshot),
    features: FEATURE_IDS.map((id) => ({
      id,
      label: FEATURES[id],
      planDefault: plan.features[id] ?? true,
      override: snapshot.overrides.find((override) => override.feature === id)?.access ?? null,
      effective: snapshot.features[id],
    })),
    permissions: {
      effective: snapshot.permissions,
      granted: grants.map((grant) => grant.permission),
    },
    sessions: sessionRows.map((session) => ({
      id: session.id,
      device: describeDevice(session.userAgent),
      ip: maskIp(session.ipAddress),
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      online: session.lastSeenAt >= onlineSince,
      mfaVerified: session.mfaVerified,
    })),
    ledger: ledger.map(({ entry, actorEmail }) => ({
      id: entry.id,
      reason: entry.reason,
      actionId: entry.actionId,
      delta: entry.planDelta + entry.bonusDelta,
      planDelta: entry.planDelta,
      bonusDelta: entry.bonusDelta,
      balanceAfter: entry.balanceAfter,
      note: entry.note,
      actorEmail,
      createdAt: entry.createdAt.toISOString(),
    })),
    generations: generationRows.map((generation) => ({
      id: generation.id,
      kind: generation.kind,
      provider: generation.provider,
      status: generation.status,
      fileFormat: generation.fileFormat,
      source: generation.source,
      creditsCharged: generation.creditsCharged,
      refunded: generation.refunded,
      createdAt: generation.createdAt.toISOString(),
      completedAt: generation.completedAt?.toISOString() ?? null,
    })),
    usage: Object.fromEntries(usage.map((row) => [row.kind, row.count])),
    payments: paymentRows.map(({ payment, recordedByEmail }) => serializePayment(payment, recordedByEmail)),
    securityEvents: events.map((event) => ({
      id: event.id,
      type: event.type,
      label: AUTH_EVENT_LABELS[event.type as keyof typeof AUTH_EVENT_LABELS] ?? event.type,
      device: describeDevice(event.userAgent),
      ip: maskIp(event.ipAddress),
      createdAt: event.createdAt.toISOString(),
    })),
    audit: audit.map(serializeAudit),
    integrations: {
      chariow: {
        connected: integrations.chariow.connected,
        source: integrations.chariow.source,
        verifiedAt: integrations.chariow.verifiedAt,
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  En ligne, paiements, sécurité, journal                                     */
/* -------------------------------------------------------------------------- */

export async function onlineUsers() {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({ session: sessions, user: { id: users.id, name: users.name, email: users.email, plan: users.plan, role: users.role } })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(gte(sessions.lastSeenAt, new Date(now.getTime() - ONLINE_WINDOW_MS)), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(300);

  const labels = await planLabels();
  const grouped = new Map<string, { user: (typeof rows)[number]['user'] & { planLabel: string }; lastSeenAt: string; devices: { device: string; ip: string | null; lastSeenAt: string }[] }>();

  for (const { session, user } of rows) {
    const entry = grouped.get(user.id) ?? {
      user: { ...user, planLabel: labels[user.plan] ?? user.plan },
      lastSeenAt: session.lastSeenAt.toISOString(),
      devices: [],
    };
    entry.devices.push({
      device: describeDevice(session.userAgent),
      ip: maskIp(session.ipAddress),
      lastSeenAt: session.lastSeenAt.toISOString(),
    });
    grouped.set(user.id, entry);
  }

  return { windowMinutes: ONLINE_WINDOW_MS / 60_000, users: [...grouped.values()] };
}

type PaymentRow = typeof payments.$inferSelect;

export function serializePayment(payment: PaymentRow, recordedByEmail: string | null) {
  return {
    id: payment.id,
    userId: payment.userId,
    userEmail: payment.userEmail,
    plan: payment.plan,
    periodMonths: payment.periodMonths,
    amountFcfa: payment.amountFcfa,
    method: payment.method,
    reference: payment.reference,
    status: payment.status,
    note: payment.note,
    paidAt: payment.paidAt.toISOString(),
    refundedAt: payment.refundedAt?.toISOString() ?? null,
    recordedByEmail,
    createdAt: payment.createdAt.toISOString(),
  };
}

export async function listPayments(input: { page: number; pageSize: number }) {
  const db = getDb();
  const recorder = alias(users, 'recorder');
  const rows = await db
    .select({ payment: payments, recordedByEmail: recorder.email })
    .from(payments)
    .leftJoin(recorder, eq(recorder.id, payments.recordedBy))
    .orderBy(desc(payments.paidAt))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const [total] = await db.select({ value: num(sql`count(*)`) }).from(payments);

  return {
    page: input.page,
    pageSize: input.pageSize,
    total: total?.value ?? 0,
    payments: rows.map(({ payment, recordedByEmail }) => serializePayment(payment, recordedByEmail)),
  };
}

export async function securityEvents(input: { page: number; pageSize: number; type?: string }) {
  const db = getDb();
  const where = input.type ? eq(authEvents.type, input.type) : undefined;
  const rows = await db
    .select()
    .from(authEvents)
    .where(where)
    .orderBy(desc(authEvents.createdAt))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const [total] = await db.select({ value: num(sql`count(*)`) }).from(authEvents).where(where);

  return {
    page: input.page,
    pageSize: input.pageSize,
    total: total?.value ?? 0,
    events: rows.map((event) => ({
      id: event.id,
      type: event.type,
      label: AUTH_EVENT_LABELS[event.type as keyof typeof AUTH_EVENT_LABELS] ?? event.type,
      userId: event.userId,
      email: event.email,
      device: describeDevice(event.userAgent),
      ip: maskIp(event.ipAddress),
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Compteurs d'échecs en cours. L'adresse IP est entière ici : elle est nécessaire pour lever un verrou. */
export async function throttleEntries() {
  const rows = await getDb()
    .select()
    .from(authThrottles)
    .where(or(gt(authThrottles.lockedUntil, new Date()), gte(authThrottles.lastFailureAt, new Date(Date.now() - DAY_MS))))
    .orderBy(desc(authThrottles.lastFailureAt))
    .limit(100);

  return rows.map((row) => ({
    key: row.key,
    kind: row.key.startsWith('ip:') ? ('ip' as const) : ('email' as const),
    subject: row.key.slice(row.key.indexOf(':') + 1),
    failures: row.failures,
    lockedUntil: row.lockedUntil && row.lockedUntil > new Date() ? row.lockedUntil.toISOString() : null,
    lastFailureAt: row.lastFailureAt.toISOString(),
  }));
}

function serializeAudit(entry: typeof auditLogs.$inferSelect) {
  return {
    id: entry.id,
    action: entry.action,
    actorEmail: entry.actorEmail,
    targetUserId: entry.targetUserId,
    targetEmail: entry.targetEmail,
    details: entry.details,
    createdAt: entry.createdAt.toISOString(),
  };
}

export async function auditEntries(input: { page: number; pageSize: number }) {
  const db = getDb();
  const rows = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const [total] = await db.select({ value: num(sql`count(*)`) }).from(auditLogs);
  return { page: input.page, pageSize: input.pageSize, total: total?.value ?? 0, entries: rows.map(serializeAudit) };
}
