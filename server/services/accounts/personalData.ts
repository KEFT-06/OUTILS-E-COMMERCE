import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import {
  auditLogs,
  authEvents,
  contactMessages,
  covers,
  creditTransactions,
  featureOverrides,
  generations,
  guideTranslations,
  guides,
  payments,
  reports,
  sessionHistory,
  userIntegrations,
  userPermissions,
  users,
  type UserRow,
} from '@server/db/schema';
import { sha256 } from '@server/lib/crypto';
import { describeDevice, maskIp } from '@server/lib/device';
import { AppError } from '@server/middleware';
import { AUTH_EVENT_LABELS, recordAuthEvent } from '@server/services/audit';
import { passwordInputSchema, verifyAccountOwner } from '@server/services/auth';
import { hasAuthenticatorApp, hasSecurityCode } from '@server/services/auth/factors';
import { listWorkspaceDocuments } from '@server/services/workspace';
import { sessionEndLabel } from '@server/shared/sessions';

/**
 * Droits de la personne sur ses données : copie téléchargeable et suppression du
 * compte, sans passer par l'administrateur.
 *
 * La copie ne contient aucun secret (empreinte du mot de passe, secrets de double
 * authentification, codes de secours, clés API). La suppression est immédiate ;
 * seuls les paiements restent, avec l'adresse e-mail recopiée au moment du
 * paiement, parce que la comptabilité doit les conserver.
 */

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;

export const EXPORT_NOTICE =
  'Copie des données de votre compte Smart Creator. Par sécurité, n’y figurent pas : l’empreinte de votre mot de passe, ' +
  'vos secrets de double authentification, vos codes de secours et vos clés API (seuls leurs 4 derniers caractères). ' +
  'Les adresses IP sont tronquées. Les images de couverture se téléchargent depuis vos guides et vos produits.';

export async function exportPersonalData(userId: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, 'Compte introuvable.', 'ACCOUNT_NOT_FOUND');

  const [history, events, transactions, created, paid, ownGuides, translations, reviewed, coverRows, integrations, privileges, overrides, analyses] =
    await Promise.all([
      db.select().from(sessionHistory).where(eq(sessionHistory.userId, userId)).orderBy(desc(sessionHistory.startedAt)),
      db.select().from(authEvents).where(eq(authEvents.userId, userId)).orderBy(desc(authEvents.createdAt)),
      db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId)).orderBy(desc(creditTransactions.createdAt)),
      db.select().from(generations).where(eq(generations.userId, userId)).orderBy(desc(generations.createdAt)),
      db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.paidAt)),
      db.select().from(guides).where(eq(guides.userId, userId)).orderBy(desc(guides.updatedAt)),
      db.select().from(guideTranslations).where(eq(guideTranslations.userId, userId)),
      db
        .select({
          id: guideTranslations.id,
          language: guideTranslations.language,
          status: guideTranslations.status,
          claimedAt: guideTranslations.reviewClaimedAt,
          reviewedAt: guideTranslations.reviewedAt,
        })
        .from(guideTranslations)
        .where(eq(guideTranslations.reviewerId, userId)),
      db
        .select({
          id: covers.id,
          subject: covers.subject,
          subjectId: covers.subjectId,
          prompt: covers.prompt,
          status: covers.status,
          createdAt: covers.createdAt,
        })
        .from(covers)
        .where(eq(covers.userId, userId)),
      db.select().from(userIntegrations).where(eq(userIntegrations.userId, userId)),
      db.select().from(userPermissions).where(eq(userPermissions.userId, userId)),
      db.select().from(featureOverrides).where(eq(featureOverrides.userId, userId)),
      db.select().from(reports).where(eq(reports.userId, userId)).orderBy(desc(reports.createdAt)),
    ]);
  const workspace = await listWorkspaceDocuments(userId);
  const messages = await db.select().from(contactMessages).where(eq(contactMessages.userId, userId)).orderBy(desc(contactMessages.createdAt));

  return {
    format: 'smart-creator/donnees-personnelles',
    version: 1,
    generatedAt: new Date().toISOString(),
    notice: EXPORT_NOTICE,
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerifiedAt: iso(user.emailVerifiedAt),
      country: user.country,
      role: user.role,
      status: user.status,
      suspendedReason: user.suspendedReason,
      plan: user.plan,
      planExpiresAt: iso(user.planExpiresAt),
      savedNiches: user.savedNiches,
      reviewerLanguages: user.reviewerLanguages,
      createdAt: iso(user.createdAt),
      updatedAt: iso(user.updatedAt),
      lastLoginAt: iso(user.lastLoginAt),
    },
    security: {
      authenticatorApp: hasAuthenticatorApp(user),
      securityCode: hasSecurityCode(user),
      passwordChangedAt: iso(user.passwordChangedAt),
      events: events.map((event) => ({
        type: event.type,
        label: (AUTH_EVENT_LABELS as Record<string, string>)[event.type] ?? event.type,
        at: iso(event.createdAt),
        device: describeDevice(event.userAgent),
        ip: maskIp(event.ipAddress),
      })),
    },
    connections: history.map((entry) => ({
      device: entry.device,
      ip: entry.ipMasked,
      startedAt: iso(entry.startedAt),
      lastSeenAt: iso(entry.lastSeenAt),
      endedAt: iso(entry.endedAt),
      endReason: entry.endReason ? sessionEndLabel(entry.endReason) : null,
    })),
    credits: {
      planCredits: user.planCredits,
      bonusCredits: user.bonusCredits,
      cycleEndsAt: iso(user.creditsCycleEndsAt),
      transactions: transactions.map((entry) => ({
        at: iso(entry.createdAt),
        reason: entry.reason,
        actionId: entry.actionId,
        delta: entry.planDelta + entry.bonusDelta,
        balanceAfter: entry.balanceAfter,
        note: entry.note,
      })),
    },
    privileges: privileges.map((entry) => ({ permission: entry.permission, grantedAt: iso(entry.createdAt) })),
    featureOverrides: overrides.map((entry) => ({ feature: entry.feature, access: entry.access, setAt: iso(entry.createdAt) })),
    generations: created.map((entry) => ({
      kind: entry.kind,
      provider: entry.provider,
      status: entry.status,
      format: entry.fileFormat,
      creditsCharged: entry.creditsCharged,
      refunded: entry.refunded,
      createdAt: iso(entry.createdAt),
      completedAt: iso(entry.completedAt),
    })),
    payments: paid.map((entry) => ({
      plan: entry.plan,
      periodMonths: entry.periodMonths,
      currency: entry.currency,
      amountMinor: entry.amountMinor,
      method: entry.method,
      reference: entry.reference,
      status: entry.status,
      paidAt: iso(entry.paidAt),
      refundedAt: iso(entry.refundedAt),
    })),
    guides: ownGuides.map((guide) => ({
      id: guide.id,
      title: guide.title,
      sourceLanguage: guide.sourceLanguage,
      terms: guide.terms,
      sections: guide.sections,
      revision: guide.revision,
      createdAt: iso(guide.createdAt),
      updatedAt: iso(guide.updatedAt),
      translations: translations
        .filter((translation) => translation.guideId === guide.id)
        .map((translation) => ({
          language: translation.language,
          title: translation.title,
          sections: translation.sections,
          status: translation.status,
          authorValidatedAt: iso(translation.authorValidatedAt),
          reviewRequestedAt: iso(translation.reviewRequestedAt),
          reviewNote: translation.reviewNote,
          reviewedAt: iso(translation.reviewedAt),
          reviewerComment: translation.reviewerComment,
          updatedAt: iso(translation.updatedAt),
        })),
    })),
    nicheAnalyses: analyses.map((entry) => ({
      id: entry.id,
      query: entry.query,
      nicheName: entry.nicheName,
      market: entry.market,
      createdAt: iso(entry.createdAt),
      report: entry.report,
    })),
    contactMessages: messages.map((entry) => ({ topic: entry.topic, message: entry.message, email: entry.email, status: entry.status, createdAt: iso(entry.createdAt) })),
    workspace: workspace.map((entry) => ({ kind: entry.kind, updatedAt: iso(entry.updatedAt), data: entry.data })),
    reviewsAsReviewer: reviewed.map((entry) => ({
      translationId: entry.id,
      language: entry.language,
      status: entry.status,
      claimedAt: iso(entry.claimedAt),
      reviewedAt: iso(entry.reviewedAt),
    })),
    covers: coverRows.map((entry) => ({ ...entry, createdAt: iso(entry.createdAt) })),
    integrations: integrations.map((entry) => ({
      provider: entry.provider,
      keyEndsWith: entry.hint,
      verifiedAt: iso(entry.verifiedAt),
      createdAt: iso(entry.createdAt),
    })),
  };
}

export type PersonalDataExport = Awaited<ReturnType<typeof exportPersonalData>>;

export const DELETION_CONFIRMATION = 'SUPPRIMER';

export const accountDeletionSchema = z.object({
  password: passwordInputSchema,
  /** Code de sécurité ou code de l'application, exigé quand le compte en a un. */
  code: z.string().trim().max(128).optional(),
  confirmation: z
    .string()
    .trim()
    .refine((value) => value === DELETION_CONFIRMATION, `Saisissez ${DELETION_CONFIRMATION} pour confirmer.`),
});

/**
 * Supprime le compte de son titulaire, après mot de passe et second facteur.
 *
 * Les contenus, points, sessions et historiques partent avec la ligne `users`
 * (clés étrangères en cascade). Le journal de sécurité de la personne est effacé,
 * et son adresse retirée du journal d'administration. Une trace anonyme de la
 * suppression est gardée : l'empreinte de l'adresse, jamais l'adresse.
 */
export async function deleteOwnAccount(user: UserRow, input: { password: string; code?: string }): Promise<void> {
  await verifyAccountOwner(user, input);

  await getDb().transaction(async (tx) => {
    if (user.role === 'admin') {
      // Verrou sur les administrateurs : deux suppressions simultanées ne peuvent pas laisser le site sans aucun.
      const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).for('update');
      if (admins.length <= 1) {
        throw new AppError(
          409,
          'Vous êtes le seul administrateur de Smart Creator : nommez un autre administrateur avant de supprimer votre compte.',
          'LAST_ADMIN',
        );
      }
    }

    // Relectures prises en charge et pas encore rendues : remises dans la file pour un autre relecteur.
    await tx
      .update(guideTranslations)
      .set({ status: 'review_requested', reviewerId: null, reviewClaimedAt: null, updatedAt: new Date() })
      .where(and(eq(guideTranslations.reviewerId, user.id), eq(guideTranslations.status, 'in_review')));

    await tx.delete(authEvents).where(eq(authEvents.userId, user.id));
    await tx.update(auditLogs).set({ targetEmail: null }).where(eq(auditLogs.targetUserId, user.id));
    await tx.delete(users).where(eq(users.id, user.id));

    await recordAuthEvent(
      'account_deleted',
      { client: { ipAddress: null, userAgent: null }, details: { emailHash: sha256(user.email) } },
      tx,
    );
  });
}
