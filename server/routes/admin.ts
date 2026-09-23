import { Router, type Request } from 'express';
import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import {
  PAYMENT_METHODS,
  PLAN_IDS,
  auditLogs,
  authEvents,
  authThrottles,
  featureOverrides,
  payments,
  recoveryCodes,
  userPermissions,
  users,
  type UserRow,
} from '@server/db/schema';
import { env } from '@server/env';
import { AppError, asyncRoute, countrySchema, routeLimiter, validateBody } from '@server/middleware';
import {
  requireAdminRole,
  requireAuth,
  requirePermission,
  requireStaff,
  type RequestAuth,
} from '@server/middleware/auth';
import { addMonths, changePlan, createUserRecord, emailTaken, grantCredits } from '@server/services/accounts';
import {
  GRANULARITIES,
  adminOverview,
  adminUserDetail,
  auditEntries,
  connectionHistory,
  connectionQuerySchema,
  contentStats,
  listPayments,
  listUsers,
  onlineUsers,
  revenueSeries,
  revenueTotals,
  securityEvents,
  serializePayment,
  throttleEntries,
  userListQuerySchema,
} from '@server/services/admin';
import { AUTH_EVENT_LABELS, clientInfo, recordAudit } from '@server/services/audit';
import { emailSchema, issuePasswordToken, nameSchema, verifyStepUp } from '@server/services/auth';
import { PERMISSIONS, PERMISSION_IDS, isPermission } from '@server/services/auth/permissions';
import { revokeUserSessions } from '@server/services/auth/sessions';
import { convertAmount, getRates, toMinorUnits } from '@server/services/currency';
import { FEATURES, getPlan, getPlanConfig, isFeature } from '@server/services/plans';
import { audienceSummary } from '@server/services/audience';
import { creativeListQuerySchema, findCreativeFile, listCreatives } from '@server/services/admin/creatives';
import { pricingOverview } from '@server/services/admin/pricing';
import { checkServices } from '@server/services/admin/services';
import { streamCreativeFile } from '@server/services/creatives';
import { contactListQuerySchema, contactStatusSchema, listContactMessages, setContactMessageStatus } from '@server/services/contact';
import { formatMoney } from '@server/shared/currency';

/**
 * Administration.
 *
 * Chaque route exige un privilège précis ; les pouvoirs non délégables (rôles et
 * privilèges) exigent le rôle admin et un code de double authentification frais.
 * Chaque modification laisse une ligne dans le journal d'audit, dans la même
 * transaction : une action sans trace ne peut pas avoir lieu.
 */

export const adminRouter = Router();

adminRouter.use(requireAuth, (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const authOf = (req: Request): RequestAuth => req.auth!;
const actorOf = (auth: RequestAuth) => ({ id: auth.account.user.id, email: auth.account.user.email });
const granularityOf = (value: unknown) => z.enum(GRANULARITIES).catch('day').parse(value);
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(25),
});

async function loadTarget(id: string | undefined): Promise<UserRow> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) throw new AppError(400, 'Identifiant d’utilisateur invalide.', 'INVALID_USER_ID');
  const [user] = await getDb().select().from(users).where(eq(users.id, parsed.data)).limit(1);
  if (!user) throw new AppError(404, 'Utilisateur introuvable.', 'USER_NOT_FOUND');
  return user;
}

/** Un membre de l'équipe sans rôle admin n'agit ni sur un administrateur, ni sur son propre compte. */
function assertCanManage(auth: RequestAuth, target: UserRow): void {
  if (auth.account.user.role === 'admin') return;
  if (target.role === 'admin') {
    throw new AppError(403, 'Seul un administrateur peut modifier un compte administrateur.', 'FORBIDDEN');
  }
  if (target.id === auth.account.user.id) {
    throw new AppError(403, 'Vous ne pouvez pas modifier votre propre compte depuis l’administration.', 'FORBIDDEN');
  }
}

function assertNotSelf(auth: RequestAuth, target: UserRow, message: string): void {
  if (target.id === auth.account.user.id) throw new AppError(403, message, 'SELF_ACTION_FORBIDDEN');
}

async function activeAdminCount(): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
  return row?.value ?? 0;
}

const formatDay = (date: Date) => date.toLocaleDateString('fr-FR', { timeZone: env.REPORTING_TIMEZONE });

/* -------------------------------------------------------------------------- */
/*  Lecture                                                                    */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/meta',
  requireStaff,
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const config = await getPlanConfig();
    res.json({
      viewer: { id: auth.account.user.id, role: auth.account.user.role, permissions: auth.account.permissions },
      permissions: PERMISSION_IDS.map((id) => ({ id, ...PERMISSIONS[id] })),
      features: Object.entries(FEATURES).map(([id, label]) => ({ id, label })),
      plans: config.plans.map(({ id, label, monthlyCredits }) => ({ id, label, monthlyCredits })),
      /** Devise des statistiques de revenus : chaque paiement y est converti au taux du jour. */
      reportingCurrency: 'XAF',
      currencies: Object.keys((await getRates()).rates).sort(),
      paymentMethods: PAYMENT_METHODS,
      authEventTypes: Object.entries(AUTH_EVENT_LABELS).map(([id, label]) => ({ id, label })),
      timezone: env.REPORTING_TIMEZONE,
    });
  }),
);

adminRouter.get(
  '/overview',
  requirePermission('admin.dashboard.read'),
  asyncRoute(async (req, res) => {
    const { permissions } = authOf(req).account;
    res.json(
      await adminOverview({
        includeRevenue: permissions.includes('admin.revenue.read'),
        includeSecurity: permissions.includes('admin.security.read'),
      }),
    );
  }),
);

adminRouter.get(
  '/online',
  requirePermission('admin.dashboard.read'),
  asyncRoute(async (_req, res) => {
    res.json(await onlineUsers());
  }),
);

adminRouter.get(
  '/content',
  requirePermission('admin.dashboard.read'),
  asyncRoute(async (req, res) => {
    res.json(await contentStats(granularityOf(req.query.granularity)));
  }),
);

/** Vidéos et visuels générés par les comptes : liste, puis fichier relayé depuis le fournisseur. */
adminRouter.get(
  '/creatives',
  requirePermission('admin.content.view'),
  asyncRoute(async (req, res) => {
    res.json(await listCreatives(creativeListQuerySchema.parse(req.query)));
  }),
);

/** Ouvrir le contenu d'un compte n'est pas anodin : chaque ouverture est inscrite au journal d'audit. */
adminRouter.get(
  '/creatives/:generationId/file',
  requirePermission('admin.content.view'),
  routeLimiter(1, 60),
  asyncRoute(async (req, res) => {
    const creative = await findCreativeFile(req.params.generationId);
    const disposition = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
    await recordAudit({
      actor: actorOf(req.auth!),
      action: disposition === 'attachment' ? 'creative.downloaded' : 'creative.viewed',
      target: { id: creative.userId, email: creative.userEmail },
      details: { generationId: creative.id, kind: creative.kind },
      client: clientInfo(req),
    });
    await streamCreativeFile(creative.providerRef, creative.provider === 'fal' ? 'fal' : 'higgsfield', disposition, res);
  }),
);

adminRouter.get(
  '/revenue',
  requirePermission('admin.revenue.read'),
  asyncRoute(async (req, res) => {
    res.json(await revenueSeries(granularityOf(req.query.granularity)));
  }),
);

adminRouter.get(
  '/revenue/totals',
  requirePermission('admin.revenue.read'),
  asyncRoute(async (_req, res) => {
    res.json(await revenueTotals());
  }),
);

adminRouter.get(
  '/payments',
  requirePermission('admin.revenue.read'),
  asyncRoute(async (req, res) => {
    res.json(await listPayments(pageQuery.parse(req.query)));
  }),
);

adminRouter.get(
  '/users',
  requirePermission('admin.users.read'),
  asyncRoute(async (req, res) => {
    const parsed = userListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, 'Filtres de recherche invalides.', 'VALIDATION_ERROR');
    res.json(await listUsers(parsed.data));
  }),
);

adminRouter.get(
  '/users/:userId',
  requirePermission('admin.users.read'),
  asyncRoute(async (req, res) => {
    const target = await loadTarget(req.params.userId);
    res.json(await adminUserDetail(target.id));
  }),
);

/** Heures de connexion et de déconnexion : tous les comptes, ou un seul (`userId`). */
adminRouter.get(
  '/connections',
  requirePermission('admin.users.read'),
  asyncRoute(async (req, res) => {
    res.json(await connectionHistory(connectionQuerySchema.parse(req.query)));
  }),
);

adminRouter.get(
  '/security/events',
  requirePermission('admin.security.read'),
  asyncRoute(async (req, res) => {
    const { page, pageSize } = pageQuery.parse(req.query);
    const type = typeof req.query.type === 'string' && Object.hasOwn(AUTH_EVENT_LABELS, req.query.type) ? req.query.type : undefined;
    res.json(await securityEvents({ page, pageSize, ...(type ? { type } : {}) }));
  }),
);

adminRouter.get(
  '/security/locks',
  requirePermission('admin.security.read'),
  asyncRoute(async (_req, res) => {
    res.json({ entries: await throttleEntries() });
  }),
);

adminRouter.get(
  '/audit',
  requirePermission('admin.security.read'),
  asyncRoute(async (req, res) => {
    res.json(await auditEntries(pageQuery.parse(req.query)));
  }),
);

/* -------------------------------------------------------------------------- */
/*  Comptes                                                                    */
/* -------------------------------------------------------------------------- */

const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  plan: z.enum(PLAN_IDS).default('free'),
  country: countrySchema.optional(),
});

/** Ouvre un compte pour quelqu'un (client payé hors ligne, membre de l'équipe) et renvoie son lien de création de mot de passe. */
adminRouter.post(
  '/users',
  requirePermission('admin.users.manage'),
  validateBody(createUserSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const { name, email, plan, country } = req.body as z.infer<typeof createUserSchema>;

    const [existing] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw emailTaken();

    const { user, link } = await getDb().transaction(async (tx) => {
      const created = await createUserRecord({ name, email, passwordHash: null, role: 'user', plan, country: country ?? null }, tx);
      const issued = await issuePasswordToken({ userId: created.id, purpose: 'setup', createdBy: auth.account.user.id }, tx);
      await recordAudit(
        { actor: actorOf(auth), action: 'user.created', target: created, details: { plan }, client: clientInfo(req) },
        tx,
      );
      return { user: created, link: issued };
    });

    res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email },
      setupLink: { url: link.url, expiresAt: link.expiresAt.toISOString() },
    });
  }),
);

const planChangeSchema = z.object({
  plan: z.enum(PLAN_IDS),
  /** null : sans échéance. */
  durationMonths: z.number().int().min(1).max(36).nullable(),
  refillCredits: z.boolean().default(true),
  note: z.string().trim().min(3, 'Indiquez la raison du changement.').max(300),
});

adminRouter.patch(
  '/users/:userId/plan',
  requirePermission('admin.users.manage'),
  validateBody(planChangeSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertCanManage(auth, target);
    const body = req.body as z.infer<typeof planChangeSchema>;
    const expiresAt = body.durationMonths ? addMonths(new Date(), body.durationMonths) : null;

    await getDb().transaction(async (tx) => {
      await changePlan(
        {
          userId: target.id,
          plan: body.plan,
          expiresAt,
          refillCredits: body.refillCredits,
          actorId: auth.account.user.id,
          note: body.note,
        },
        tx,
      );
      await recordAudit(
        {
          actor: actorOf(auth),
          action: 'user.plan_changed',
          target,
          details: {
            from: target.plan,
            to: body.plan,
            expiresAt: expiresAt?.toISOString() ?? null,
            refillCredits: body.refillCredits,
            note: body.note,
          },
          client: clientInfo(req),
        },
        tx,
      );
    });

    res.json(await adminUserDetail(target.id));
  }),
);

const statusSchema = z
  .object({
    status: z.enum(['active', 'suspended']),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((value) => value.status === 'active' || (value.reason?.length ?? 0) >= 3, {
    message: 'Indiquez la raison du blocage.',
    path: ['reason'],
  });

adminRouter.post(
  '/users/:userId/status',
  requirePermission('admin.users.manage'),
  validateBody(statusSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertCanManage(auth, target);
    assertNotSelf(auth, target, 'Vous ne pouvez pas bloquer votre propre compte.');
    const { status, reason } = req.body as z.infer<typeof statusSchema>;

    if (status === 'suspended' && target.role === 'admin' && target.status === 'active' && (await activeAdminCount()) <= 1) {
      throw new AppError(409, 'Impossible de bloquer le dernier administrateur actif.', 'LAST_ADMIN');
    }

    await getDb().transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status, suspendedReason: status === 'suspended' ? reason! : null, updatedAt: new Date() })
        .where(eq(users.id, target.id));
      if (status === 'suspended') await revokeUserSessions(target.id, { reason: 'suspended' }, tx);
      await recordAudit(
        {
          actor: actorOf(auth),
          action: status === 'suspended' ? 'user.suspended' : 'user.reactivated',
          target,
          details: reason ? { reason } : {},
          client: clientInfo(req),
        },
        tx,
      );
    });

    res.json(await adminUserDetail(target.id));
  }),
);

const creditsSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((value) => value !== 0, 'Le nombre de points ne peut pas être nul.'),
  note: z.string().trim().min(3, 'Indiquez la raison de la recharge.').max(300),
});

adminRouter.post(
  '/users/:userId/credits',
  requirePermission('admin.credits.grant'),
  validateBody(creditsSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertCanManage(auth, target);
    const { amount, note } = req.body as z.infer<typeof creditsSchema>;

    const result = await getDb().transaction(async (tx) => {
      const granted = await grantCredits({ userId: target.id, amount, actorId: auth.account.user.id, note }, tx);
      await recordAudit(
        {
          actor: actorOf(auth),
          action: amount > 0 ? 'credits.granted' : 'credits.removed',
          target,
          details: { requested: amount, applied: granted.applied, balance: granted.balance, note },
          client: clientInfo(req),
        },
        tx,
      );
      return granted;
    });

    res.json({ ...result, user: await adminUserDetail(target.id) });
  }),
);

const noteSchema = z.object({ note: z.string().trim().min(3, 'Indiquez la raison.').max(300) });

/** Remet les points du palier au quota et ouvre un nouveau cycle d'un mois. */
adminRouter.post(
  '/users/:userId/credits/refill',
  requirePermission('admin.credits.grant'),
  validateBody(noteSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertCanManage(auth, target);
    const { note } = req.body as z.infer<typeof noteSchema>;
    const plan = await getPlan(target.plan);

    await getDb().transaction(async (tx) => {
      await changePlan(
        { userId: target.id, plan: target.plan, expiresAt: target.planExpiresAt, refillCredits: true, actorId: auth.account.user.id, note },
        tx,
      );
      await recordAudit(
        {
          actor: actorOf(auth),
          action: 'credits.plan_refilled',
          target,
          details: { plan: target.plan, allowance: plan.monthlyCredits, note },
          client: clientInfo(req),
        },
        tx,
      );
    });

    res.json(await adminUserDetail(target.id));
  }),
);

const featureSchema = z.object({
  feature: z.string().refine(isFeature, 'Fonction inconnue.'),
  access: z.enum(['default', 'granted', 'revoked']),
});

adminRouter.put(
  '/users/:userId/features',
  requirePermission('admin.users.manage'),
  validateBody(featureSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertCanManage(auth, target);
    const { feature, access } = req.body as z.infer<typeof featureSchema>;

    await getDb().transaction(async (tx) => {
      if (access === 'default') {
        await tx
          .delete(featureOverrides)
          .where(and(eq(featureOverrides.userId, target.id), eq(featureOverrides.feature, feature)));
      } else {
        await tx
          .insert(featureOverrides)
          .values({ userId: target.id, feature, access, setBy: auth.account.user.id })
          .onConflictDoUpdate({
            target: [featureOverrides.userId, featureOverrides.feature],
            set: { access, setBy: auth.account.user.id, createdAt: new Date() },
          });
      }
      await recordAudit(
        {
          actor: actorOf(auth),
          action: `feature.${access === 'default' ? 'reset' : access}`,
          target,
          details: { feature, label: FEATURES[feature as keyof typeof FEATURES] },
          client: clientInfo(req),
        },
        tx,
      );
    });

    res.json(await adminUserDetail(target.id));
  }),
);

/** Code de sécurité personnel, ou code à 6 chiffres de l'application d'authentification. */
const confirmationCode = z
  .string()
  .trim()
  .min(6, 'Saisissez votre code de sécurité, ou le code affiché par votre application d’authentification.')
  .max(128);

const permissionsSchema = z.object({
  permissions: z.array(z.string().refine(isPermission, 'Privilège inconnu.')).max(PERMISSION_IDS.length),
  confirmationCode,
});

adminRouter.put(
  '/users/:userId/permissions',
  routeLimiter(15, 20),
  requireAdminRole,
  validateBody(permissionsSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertNotSelf(auth, target, 'Vous ne pouvez pas modifier vos propres privilèges.');
    if (target.role === 'admin') {
      throw new AppError(409, 'Un administrateur détient déjà tous les privilèges.', 'ADMIN_HAS_ALL_PERMISSIONS');
    }

    const body = req.body as z.infer<typeof permissionsSchema>;
    await verifyStepUp(auth.account.user, body.confirmationCode);

    const next: string[] = [...new Set(body.permissions)];
    const current = (
      await getDb().select({ permission: userPermissions.permission }).from(userPermissions).where(eq(userPermissions.userId, target.id))
    ).map((row) => row.permission);
    const added = next.filter((permission) => !current.includes(permission));
    const removed = current.filter((permission) => !next.includes(permission));

    if (added.length > 0 || removed.length > 0) {
      await getDb().transaction(async (tx) => {
        await tx.delete(userPermissions).where(eq(userPermissions.userId, target.id));
        if (next.length > 0) {
          await tx
            .insert(userPermissions)
            .values(next.map((permission) => ({ userId: target.id, permission, grantedBy: auth.account.user.id })));
        }
        // Reconnexion imposée : la nouvelle session suit la règle des comptes d'équipe (double authentification, durée courte).
        await revokeUserSessions(target.id, { reason: 'privileges_changed' }, tx);
        await recordAudit(
          { actor: actorOf(auth), action: 'permissions.updated', target, details: { added, removed }, client: clientInfo(req) },
          tx,
        );
      });
    }

    res.json(await adminUserDetail(target.id));
  }),
);

const roleSchema = z.object({ role: z.enum(['user', 'admin']), confirmationCode });

adminRouter.patch(
  '/users/:userId/role',
  routeLimiter(15, 20),
  requireAdminRole,
  validateBody(roleSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertNotSelf(auth, target, 'Vous ne pouvez pas changer votre propre rôle.');
    const body = req.body as z.infer<typeof roleSchema>;

    if (target.role !== body.role) {
      await verifyStepUp(auth.account.user, body.confirmationCode);
      if (target.role === 'admin' && target.status === 'active' && (await activeAdminCount()) <= 1) {
        throw new AppError(409, 'Impossible de retirer le rôle du dernier administrateur actif.', 'LAST_ADMIN');
      }

      await getDb().transaction(async (tx) => {
        await tx.update(users).set({ role: body.role, updatedAt: new Date() }).where(eq(users.id, target.id));
        // Un administrateur détient tout : les privilèges individuels deviennent sans objet.
        if (body.role === 'admin') await tx.delete(userPermissions).where(eq(userPermissions.userId, target.id));
        await revokeUserSessions(target.id, { reason: 'role_changed' }, tx);
        await recordAudit(
          { actor: actorOf(auth), action: 'role.changed', target, details: { from: target.role, to: body.role }, client: clientInfo(req) },
          tx,
        );
      });
    }

    res.json(await adminUserDetail(target.id));
  }),
);

const deleteUserSchema = z.object({
  confirmationCode: z.string().trim().max(128).optional(),
  confirmation: z
    .string()
    .trim()
    .refine((value) => value === 'SUPPRIMER', 'Saisissez SUPPRIMER pour confirmer.'),
});

/**
 * Supprime définitivement un compte.
 *
 * Réservée au rôle d'administrateur, et exigeant son second facteur : c'est la seule
 * action de cette page qu'aucune manœuvre ne rattrape. Les contenus, points, sessions et
 * historiques partent avec la ligne du compte ; les paiements restent, détachés de leur
 * auteur, parce que la comptabilité ne se réécrit pas.
 *
 * Deux refus : son propre compte, qui passe par Mon compte et demande le mot de passe, et
 * le dernier administrateur actif, sans quoi le site resterait sans personne pour l'administrer.
 */
adminRouter.delete(
  '/users/:userId',
  routeLimiter(15, 10),
  requireAdminRole,
  validateBody(deleteUserSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertNotSelf(auth, target, 'Pour supprimer votre propre compte, passez par Mon compte.');
    const body = req.body as z.infer<typeof deleteUserSchema>;

    await verifyStepUp(auth.account.user, body.confirmationCode);

    await getDb().transaction(async (tx) => {
      // Verrou : deux suppressions simultanées ne peuvent pas laisser le site sans administrateur.
      const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).for('update');
      if (target.role === 'admin' && admins.length <= 1) {
        throw new AppError(409, 'Impossible de supprimer le dernier administrateur.', 'LAST_ADMIN');
      }

      await recordAudit(
        {
          actor: actorOf(auth),
          action: 'user.deleted',
          target,
          details: { role: target.role, plan: target.plan },
          client: clientInfo(req),
        },
        tx,
      );
      await tx.delete(authEvents).where(eq(authEvents.userId, target.id));
      await tx.update(auditLogs).set({ targetUserId: null }).where(eq(auditLogs.targetUserId, target.id));
      await tx.delete(users).where(eq(users.id, target.id));
    });

    res.json({ deleted: true, email: target.email });
  }),
);

adminRouter.post(
  '/users/:userId/sessions/revoke',
  requirePermission('admin.users.manage'),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertCanManage(auth, target);
    assertNotSelf(auth, target, 'Pour vos propres sessions, passez par Mon compte.');

    const revoked = await getDb().transaction(async (tx) => {
      const total = await revokeUserSessions(target.id, { reason: 'revoked_by_staff' }, tx);
      await recordAudit(
        { actor: actorOf(auth), action: 'sessions.revoked', target, details: { sessions: total }, client: clientInfo(req) },
        tx,
      );
      return total;
    });

    res.json({ revoked });
  }),
);

/** Lien de création ou de réinitialisation du mot de passe, à transmettre à la personne (WhatsApp, e-mail…). */
adminRouter.post(
  '/users/:userId/password-link',
  routeLimiter(15, 20),
  requirePermission('admin.users.manage'),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertCanManage(auth, target);
    assertNotSelf(auth, target, 'Pour votre propre mot de passe, passez par Mon compte.');
    const purpose = target.passwordHash ? 'reset' : 'setup';

    const link = await getDb().transaction(async (tx) => {
      const issued = await issuePasswordToken({ userId: target.id, purpose, createdBy: auth.account.user.id }, tx);
      await recordAudit(
        { actor: actorOf(auth), action: 'password.link_created', target, details: { purpose }, client: clientInfo(req) },
        tx,
      );
      return issued;
    });

    res.json({ url: link.url, expiresAt: link.expiresAt.toISOString(), purpose });
  }),
);

/** Téléphone perdu : l'administrateur retire la double authentification d'un compte, qui devra la réactiver. */
adminRouter.post(
  '/users/:userId/two-factor/reset',
  routeLimiter(15, 10),
  requireAdminRole,
  validateBody(z.object({ confirmationCode })),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const target = await loadTarget(req.params.userId);
    assertNotSelf(auth, target, 'Vous ne pouvez pas réinitialiser votre propre double authentification.');
    await verifyStepUp(auth.account.user, (req.body as { confirmationCode: string }).confirmationCode);

    await getDb().transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          twoFactorSecret: null,
          twoFactorPendingSecret: null,
          twoFactorEnabledAt: null,
          twoFactorLastStep: null,
          securityCodeHash: null,
          securityCodeSetAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, target.id));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, target.id));
      await revokeUserSessions(target.id, { reason: 'second_factor_reset' }, tx);
      await recordAudit({ actor: actorOf(auth), action: 'two_factor.reset', target, client: clientInfo(req) }, tx);
    });

    res.json(await adminUserDetail(target.id));
  }),
);

/* -------------------------------------------------------------------------- */
/*  Paiements                                                                  */
/* -------------------------------------------------------------------------- */

const paymentSchema = z.object({
  userId: z.string().uuid(),
  plan: z.enum(PLAN_IDS).refine((plan) => plan !== 'free', 'Un paiement porte sur un palier payant.'),
  periodMonths: z.number().int().min(1).max(36),
  /** Montant payé, dans la devise du paiement. */
  amount: z.number().positive().max(1_000_000_000),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Devise ISO 4217 attendue (ex. XAF).')
    .default('XAF'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
  paidAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(300).optional(),
  activatePlan: z.boolean().default(true),
});

adminRouter.post(
  '/payments',
  requirePermission('admin.payments.record'),
  validateBody(paymentSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const body = req.body as z.infer<typeof paymentSchema>;
    const target = await loadTarget(body.userId);
    assertCanManage(auth, target);

    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    if (paidAt.getTime() > Date.now() + 5 * 60_000) {
      throw new AppError(400, 'La date du paiement ne peut pas être dans le futur.', 'VALIDATION_ERROR');
    }
    const plan = await getPlan(body.plan);
    const converted = convertAmount(body.amount, body.currency, 'XAF', await getRates());
    if (converted === null) {
      throw new AppError(400, `Devise non prise en charge : ${body.currency}.`, 'UNSUPPORTED_CURRENCY');
    }
    const amountFcfa = Math.max(1, Math.round(converted));
    const paidLabel = formatMoney(body.amount, body.currency);

    const payment = await getDb().transaction(async (tx) => {
      const [created] = await tx
        .insert(payments)
        .values({
          userId: target.id,
          userEmail: target.email,
          plan: body.plan,
          periodMonths: body.periodMonths,
          currency: body.currency,
          amountMinor: toMinorUnits(body.amount, body.currency),
          amountFcfa,
          method: body.method,
          reference: body.reference || null,
          note: body.note || null,
          paidAt,
          recordedBy: auth.account.user.id,
        })
        .returning();

      let expiresAt: Date | null = null;
      if (body.activatePlan) {
        // Renouvellement du même palier : la nouvelle période s'ajoute à celle en cours.
        const now = new Date();
        const base = target.plan === body.plan && target.planExpiresAt && target.planExpiresAt > now ? target.planExpiresAt : now;
        expiresAt = addMonths(base, body.periodMonths);
        await changePlan(
          {
            userId: target.id,
            plan: body.plan,
            expiresAt,
            refillCredits: true,
            actorId: auth.account.user.id,
            note: `Paiement de ${paidLabel} enregistré : palier ${plan.label} jusqu’au ${formatDay(expiresAt)}.`,
          },
          tx,
        );
      }

      await recordAudit(
        {
          actor: actorOf(auth),
          action: 'payment.recorded',
          target,
          details: {
            paymentId: created!.id,
            amount: body.amount,
            currency: body.currency,
            amountFcfa,
            plan: body.plan,
            periodMonths: body.periodMonths,
            method: body.method,
            planActivated: body.activatePlan,
            expiresAt: expiresAt?.toISOString() ?? null,
          },
          client: clientInfo(req),
        },
        tx,
      );
      return created!;
    });

    res.status(201).json({ payment: serializePayment(payment, auth.account.user.email) });
  }),
);

adminRouter.post(
  '/payments/:paymentId/refund',
  requirePermission('admin.payments.record'),
  validateBody(noteSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const paymentId = z.string().uuid().safeParse(req.params.paymentId);
    if (!paymentId.success) throw new AppError(400, 'Identifiant de paiement invalide.', 'INVALID_PAYMENT_ID');
    const { note } = req.body as z.infer<typeof noteSchema>;

    const updated = await getDb().transaction(async (tx) => {
      const [row] = await tx
        .update(payments)
        .set({
          status: 'refunded',
          refundedAt: new Date(),
          note: sql`coalesce(${payments.note} || ' · ', '') || ${`Remboursé : ${note}`}`,
        })
        .where(and(eq(payments.id, paymentId.data), eq(payments.status, 'paid')))
        .returning();
      if (!row) throw new AppError(409, 'Paiement introuvable ou déjà remboursé.', 'PAYMENT_NOT_REFUNDABLE');

      await recordAudit(
        {
          actor: actorOf(auth),
          action: 'payment.refunded',
          target: row.userId ? { id: row.userId, email: row.userEmail } : null,
          details: { paymentId: row.id, amountFcfa: row.amountFcfa, note },
          client: clientInfo(req),
        },
        tx,
      );
      return row;
    });

    res.json({ payment: serializePayment(updated, null) });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Sécurité                                                                   */
/* -------------------------------------------------------------------------- */

const unlockSchema = z.object({ key: z.string().min(4).max(300).regex(/^(email|ip):/) });

adminRouter.post(
  '/security/unlock',
  requirePermission('admin.users.manage'),
  validateBody(unlockSchema),
  asyncRoute(async (req, res) => {
    const auth = authOf(req);
    const { key } = req.body as z.infer<typeof unlockSchema>;

    await getDb().transaction(async (tx) => {
      const removed = await tx.delete(authThrottles).where(eq(authThrottles.key, key)).returning({ key: authThrottles.key });
      if (removed.length === 0) throw new AppError(404, 'Aucun compteur pour cette clé.', 'LOCK_NOT_FOUND');
      await recordAudit({ actor: actorOf(auth), action: 'security.unlocked', details: { key }, client: clientInfo(req) }, tx);
    });

    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/*  Messages de la page Contact et audience du site                            */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/messages',
  requirePermission('admin.users.read'),
  asyncRoute(async (req, res) => {
    res.json(await listContactMessages(contactListQuerySchema.parse(req.query)));
  }),
);

adminRouter.post(
  '/messages/:messageId/status',
  requirePermission('admin.users.read'),
  validateBody(contactStatusSchema),
  asyncRoute(async (req, res) => {
    await setContactMessageStatus(req.params.messageId, (req.body as z.infer<typeof contactStatusSchema>).status);
    res.status(204).end();
  }),
);

adminRouter.get(
  '/audience',
  requirePermission('admin.dashboard.read'),
  asyncRoute(async (_req, res) => {
    res.json(await audienceSummary(30));
  }),
);

/** État des services branchés (clés, crédits, adresse IP du serveur), vérifié en direct sans rien consommer. */
/**
 * Grille tarifaire complète, en lecture seule : ce qu'un palier donne et ce que chaque action
 * coûte. Les deux tables sont des fichiers modifiables sans redéploiement ; cet écran sert à les
 * RELIRE, pas à les éditer — une grille changée depuis une page web le serait sans trace.
 */
adminRouter.get(
  '/pricing',
  requirePermission('admin.pricing.read'),
  asyncRoute(async (_req, res) => {
    res.json(await pricingOverview());
  }),
);

adminRouter.get(
  '/services',
  requirePermission('admin.security.read'),
  routeLimiter(1, 12),
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await checkServices({ refresh: req.query.refresh === '1' }));
  }),
);
