import QRCode from 'qrcode';
import { and, count, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Transaction } from '@server/db/client';
import {
  authEvents,
  emailVerificationTokens,
  mfaChallenges,
  passwordTokens,
  recoveryCodes,
  sessions,
  userPermissions,
  users,
  type UserRow,
} from '@server/db/schema';
import { env, providers } from '@server/env';
import { describeDevice } from '@server/lib/device';
import { emailNotConfigured, sendEmailInBackground } from '@server/services/email';
import { emailVerificationEmail, passwordChangedEmail, passwordResetEmail } from '@server/services/email/templates';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '@server/lib/crypto';
import { AppError } from '@server/middleware';
import { createUserRecord } from '@server/services/accounts';
import { recordAuthEvent, type ClientInfo } from '@server/services/audit';
import {
  PASSWORD_MAX_LENGTH,
  hashPassword,
  passwordProblems,
  verifyPassword,
} from '@server/services/auth/password';
import { hasAuthenticatorApp, hasSecondFactor, hasSecurityCode, secondFactorMethods } from '@server/services/auth/factors';
import { createSession, revokeUserSessions } from '@server/services/auth/sessions';
import {
  EMAIL_POLICY,
  IP_POLICY,
  clearFailures,
  emailThrottleKey,
  ipThrottleKey,
  lockedFor,
  registerFailure,
} from '@server/services/auth/throttle';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from '@server/services/auth/totp';

/**
 * Parcours d'authentification : inscription, connexion, double authentification,
 * mot de passe et liens à usage unique.
 *
 * Principe constant : un message d'erreur ne révèle jamais si une adresse est
 * inscrite, et un verrou ne se contourne pas avec le bon mot de passe.
 */

export const emailSchema = z.string().trim().toLowerCase().max(254).email('Adresse e-mail invalide.');

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Le nom doit contenir au moins 2 caractères.')
  .max(80, 'Le nom ne peut pas dépasser 80 caractères.')
  // eslint-disable-next-line no-control-regex -- caractères de contrôle refusés volontairement
  .refine((value) => !/[\u0000-\u001f\u007f<>]/.test(value), 'Le nom contient des caractères interdits.');

export const passwordInputSchema = z
  .string()
  .min(1, 'Indiquez le mot de passe.')
  .max(PASSWORD_MAX_LENGTH, `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`);

/** Code de vérification : 6 chiffres de l'application, code de secours ou code de sécurité personnel. */
export const codeSchema = z.string().trim().min(6, 'Saisissez votre code.').max(128);

export const SECURITY_CODE_MIN_LENGTH = 8;
export const securityCodeInputSchema = z
  .string()
  .min(1, 'Choisissez un code de sécurité.')
  .max(128, 'Le code de sécurité ne peut pas dépasser 128 caractères.');

const COMMON_SECURITY_CODES = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '11223344',
  '12341234',
  '00001111',
  'azertyui',
  'azertyuiop',
  'qwertyui',
  'abcdefgh',
  'password',
  'motdepasse',
]);

/**
 * Motifs de refus d'un code de sécurité. Il sert de second facteur : il doit
 * résister à une série d'essais, et ne jamais être le mot de passe lui-même.
 */
export function securityCodeProblems(code: string): string[] {
  const normalized = code.normalize('NFKC').trim();
  const problems: string[] = [];
  if (normalized.length < SECURITY_CODE_MIN_LENGTH) {
    problems.push(`Le code de sécurité doit contenir au moins ${SECURITY_CODE_MIN_LENGTH} caractères.`);
  }
  if (new Set(normalized).size < 4) {
    problems.push('Le code répète trop peu de caractères différents : mélangez-en au moins 4.');
  }
  if (COMMON_SECURITY_CODES.has(normalized.toLowerCase())) {
    problems.push('Ce code est trop courant : choisissez-en un autre.');
  }
  return problems;
}

const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
const MFA_MAX_ATTEMPTS = 5;
export const SETUP_TOKEN_TTL_MS = 24 * 3_600_000;
export const RESET_TOKEN_TTL_MS = 2 * 3_600_000;

const invalidCredentials = () =>
  new AppError(401, 'Adresse e-mail ou mot de passe incorrect.', 'INVALID_CREDENTIALS');

/**
 * Adresse sans compte, dite en clair — choix assumé du propriétaire du site.
 *
 * Distinguer « pas de compte » de « mot de passe faux » apprend à qui le demande quelles
 * adresses sont inscrites : une liste d'e-mails suffit alors à récolter des utilisateurs,
 * pour du hameçonnage ciblé ou pour concentrer les tentatives sur des comptes réels.
 * Le risque a été exposé et accepté, la clarté ayant été jugée plus utile ici.
 *
 * Deux protections le limitent et doivent être gardées : la vérification Argon2 reste
 * faite même sans compte (le temps de réponse ne trahit rien de plus), et l'échec compte
 * dans les limites par adresse et par IP, qui verrouillent bien avant qu'une liste
 * entière soit passée en revue.
 */
const unknownAccount = () =>
  new AppError(401, 'Compte inexistant. Veuillez vous inscrire pour accéder à Smart Creator.', 'ACCOUNT_NOT_FOUND');

function tooManyAttempts(seconds: number, subject = 'Trop de tentatives de connexion'): AppError {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const delay = minutes >= 90 ? `${Math.round(minutes / 60)} heures` : `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return new AppError(
    429,
    `${subject}. Par sécurité, réessayez dans ${delay}.`,
    'TOO_MANY_ATTEMPTS',
    { retryAfterSeconds: seconds },
  );
}

export function weakPassword(problems: string[]): AppError {
  return new AppError(400, problems[0] ?? 'Mot de passe refusé.', 'WEAK_PASSWORD', { problems });
}

async function hasStaffPrivileges(user: UserRow, executor: Transaction | ReturnType<typeof getDb> = getDb()): Promise<boolean> {
  if (user.role === 'admin') return true;
  const [grant] = await executor
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, user.id))
    .limit(1);
  return Boolean(grant);
}

/* -------------------------------------------------------------------------- */
/*  Inscription et connexion                                                   */
/* -------------------------------------------------------------------------- */

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
  country?: string;
  client: ClientInfo;
}): Promise<UserRow> {
  const problems = passwordProblems(input.password, { email: input.email, name: input.name });
  if (problems.length > 0) throw weakPassword(problems);

  const passwordHash = await hashPassword(input.password);
  const user = await createUserRecord({
    name: input.name,
    email: input.email,
    passwordHash,
    role: 'user',
    country: input.country ?? null,
  });
  await recordAuthEvent('signup', { userId: user.id, email: user.email, client: input.client });
  if (providers.email) {
    await sendEmailVerification(user).catch((error: unknown) => {
      console.error('[e-mails] confirmation d’adresse non préparée :', error instanceof AppError ? error.code : 'erreur inconnue');
    });
  }
  return user;
}

export interface OpenedSession {
  user: UserRow;
  token: string;
  sessionId: string;
  expiresAt: Date;
  mfaVerified: boolean;
}

export type LoginResult =
  | ({ kind: 'session' } & OpenedSession)
  | { kind: 'mfa'; challengeToken: string; expiresAt: Date; methods: { app: boolean; code: boolean } };

export async function openSession(user: UserRow, mfaVerified: boolean, client: ClientInfo): Promise<OpenedSession> {
  const staff = await hasStaffPrivileges(user);
  const session = await createSession({ userId: user.id, staff, mfaVerified, client });
  await getDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await recordAuthEvent('login_success', { userId: user.id, email: user.email, client, details: { mfa: mfaVerified } });
  return { user, mfaVerified, ...session };
}

export async function attemptLogin(input: { email: string; password: string; client: ClientInfo }): Promise<LoginResult> {
  const emailKey = emailThrottleKey(input.email);
  const ipKey = ipThrottleKey(input.client.ipAddress);

  const lockSeconds = await lockedFor([emailKey, ipKey]);
  if (lockSeconds > 0) {
    await recordAuthEvent('login_locked', { email: input.email, client: input.client, details: { retryAfterSeconds: lockSeconds } });
    throw tooManyAttempts(lockSeconds);
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  // Toujours une vérification Argon2 complète, compte existant ou non.
  const valid = await verifyPassword(user?.passwordHash, input.password);

  if (!user || !valid) {
    const emailLock = await registerFailure(emailKey, EMAIL_POLICY);
    const ipLock = await registerFailure(ipKey, IP_POLICY);
    const locked = Math.max(emailLock, ipLock);
    await recordAuthEvent('login_failure', {
      userId: user?.id ?? null,
      email: input.email,
      client: input.client,
      ...(locked > 0 ? { details: { lockedSeconds: locked } } : {}),
    });
    if (locked > 0) throw tooManyAttempts(locked);
    throw user ? invalidCredentials() : unknownAccount();
  }

  await clearFailures(emailKey);

  if (user.status === 'suspended') {
    await recordAuthEvent('login_suspended', { userId: user.id, email: user.email, client: input.client });
    throw new AppError(403, 'Ce compte est bloqué. Contactez l’administrateur de Smart Creator.', 'ACCOUNT_SUSPENDED');
  }

  if (hasSecondFactor(user)) {
    const challengeToken = randomToken();
    const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
    await db.delete(mfaChallenges).where(eq(mfaChallenges.userId, user.id));
    await db.insert(mfaChallenges).values({
      id: sha256(challengeToken),
      userId: user.id,
      ipAddress: input.client.ipAddress,
      expiresAt,
    });
    await recordAuthEvent('mfa_challenge', { userId: user.id, email: user.email, client: input.client });
    return { kind: 'mfa', challengeToken, expiresAt, methods: secondFactorMethods(user) };
  }

  return { kind: 'session', ...(await openSession(user, false, input.client)) };
}

/**
 * Accepte un code de l'application (6 chiffres), un code de secours (XXXX-XXXX)
 * ou le code de sécurité personnel. Les mises à jour de l'application et des
 * codes de secours sont conditionnelles : deux requêtes simultanées avec le même
 * code ne peuvent pas réussir toutes les deux.
 */
async function acceptSecondFactor(
  user: UserRow,
  code: string,
  options: { allowRecovery?: boolean } = {},
): Promise<'totp' | 'recovery' | 'code' | null> {
  const db = getDb();
  const compact = code.replace(/\s/g, '');

  if (/^\d{6}$/.test(compact) && hasAuthenticatorApp(user)) {
    const step = verifyTotp(decryptSecret(user.twoFactorSecret!), compact, user.twoFactorLastStep);
    if (step !== null) {
      const claimed = await db
        .update(users)
        .set({ twoFactorLastStep: step })
        .where(and(eq(users.id, user.id), or(isNull(users.twoFactorLastStep), lt(users.twoFactorLastStep, step))))
        .returning({ id: users.id });
      if (claimed.length > 0) return 'totp';
    }
  }

  if ((options.allowRecovery ?? true) && /^[A-Za-z2-7]{4}-?[A-Za-z2-7]{4}$/.test(compact)) {
    const used = await db
      .update(recoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(recoveryCodes.userId, user.id),
          eq(recoveryCodes.codeHash, hashRecoveryCode(compact)),
          isNull(recoveryCodes.usedAt),
        ),
      )
      .returning({ id: recoveryCodes.id });
    if (used.length > 0) return 'recovery';
  }

  // Vérification Argon2 complète : un code de sécurité se devine aussi mal qu'un mot de passe.
  if (hasSecurityCode(user) && (await verifyPassword(user.securityCodeHash, code.trim()))) return 'code';

  return null;
}

const challengeExpired = () =>
  new AppError(401, 'La vérification a expiré. Reconnectez-vous avec votre mot de passe.', 'MFA_CHALLENGE_EXPIRED');

export async function completeMfaLogin(input: {
  challengeToken: string;
  code: string;
  client: ClientInfo;
}): Promise<OpenedSession> {
  const db = getDb();
  const challengeId = sha256(input.challengeToken);

  // Tentative comptée avant la vérification, de façon atomique.
  const [challenge] = await db
    .update(mfaChallenges)
    .set({ attempts: sql`${mfaChallenges.attempts} + 1` })
    .where(and(eq(mfaChallenges.id, challengeId), gt(mfaChallenges.expiresAt, new Date())))
    .returning();
  if (!challenge) throw challengeExpired();

  const [user] = await db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
  if (!user || user.status !== 'active' || !hasSecondFactor(user) || challenge.attempts > MFA_MAX_ATTEMPTS) {
    await db.delete(mfaChallenges).where(eq(mfaChallenges.id, challengeId));
    throw challengeExpired();
  }

  const accepted = await acceptSecondFactor(user, input.code);
  if (!accepted) {
    await recordAuthEvent('mfa_failure', { userId: user.id, email: user.email, client: input.client });
    if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
      await db.delete(mfaChallenges).where(eq(mfaChallenges.id, challengeId));
      await registerFailure(emailThrottleKey(user.email), EMAIL_POLICY);
      throw new AppError(401, 'Trop de codes incorrects. Reconnectez-vous avec votre mot de passe.', 'MFA_CHALLENGE_EXPIRED');
    }
    throw new AppError(401, 'Code incorrect ou déjà utilisé.', 'INVALID_MFA_CODE', {
      attemptsLeft: MFA_MAX_ATTEMPTS - challenge.attempts,
    });
  }

  await db.delete(mfaChallenges).where(eq(mfaChallenges.id, challengeId));
  if (accepted === 'recovery') {
    await recordAuthEvent('recovery_code_used', { userId: user.id, email: user.email, client: input.client });
  }
  return openSession(user, true, input.client);
}

/**
 * Confirmation par code avant une action sensible d'administration (changer un
 * rôle, attribuer des privilèges) : une session volée ne suffit pas à s'élever.
 */
export async function verifyStepUp(user: UserRow, code: string | undefined): Promise<void> {
  // Compteur propre à la confirmation : un code de sécurité ne doit pas se deviner
  // par une série d'actions d'administration.
  const key = `stepup:${user.id}`;
  const locked = await lockedFor([key]);
  if (locked > 0) throw tooManyAttempts(locked, 'Trop de codes incorrects');

  const accepted = code && code.trim().length >= 6 ? await acceptSecondFactor(user, code, { allowRecovery: false }) : null;
  if (accepted !== 'totp' && accepted !== 'code') {
    const lock = await registerFailure(key, EMAIL_POLICY);
    if (lock > 0) throw tooManyAttempts(lock, 'Trop de codes incorrects');
    throw new AppError(
      403,
      'Code incorrect : saisissez votre code de sécurité, ou le code affiché par votre application d’authentification.',
      'STEP_UP_FAILED',
    );
  }
  await clearFailures(key);
}

/* -------------------------------------------------------------------------- */
/*  Double authentification                                                    */
/* -------------------------------------------------------------------------- */

export async function beginTotpEnrollment(user: UserRow): Promise<{ secret: string; otpauthUri: string; qrSvg: string }> {
  if (user.twoFactorEnabledAt) {
    throw new AppError(409, 'La double authentification est déjà activée sur ce compte.', 'MFA_ALREADY_ENABLED');
  }

  const secret = generateTotpSecret();
  await getDb()
    .update(users)
    .set({ twoFactorPendingSecret: encryptSecret(secret), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const uri = otpauthUri(secret, user.email);
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret: secret.match(/.{1,4}/g)?.join(' ') ?? secret, otpauthUri: uri, qrSvg };
}

async function replaceRecoveryCodes(tx: Transaction, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await tx.insert(recoveryCodes).values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })));
  return codes;
}

export async function confirmTotpEnrollment(
  user: UserRow,
  code: string,
  sessionId: string,
  client: ClientInfo,
): Promise<string[]> {
  if (user.twoFactorEnabledAt) {
    throw new AppError(409, 'La double authentification est déjà activée sur ce compte.', 'MFA_ALREADY_ENABLED');
  }
  if (!user.twoFactorPendingSecret) {
    throw new AppError(409, 'Commencez par afficher le QR code de configuration.', 'MFA_SETUP_NOT_STARTED');
  }

  const secret = decryptSecret(user.twoFactorPendingSecret);
  const step = verifyTotp(secret, code, null);
  if (step === null) {
    throw new AppError(
      400,
      'Code incorrect. Vérifiez que l’heure de votre téléphone est automatique, puis saisissez le code affiché.',
      'INVALID_MFA_CODE',
    );
  }

  const codes = await getDb().transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        twoFactorSecret: encryptSecret(secret),
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: new Date(),
        twoFactorLastStep: step,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    const generated = await replaceRecoveryCodes(tx, user.id);
    // La session courante vient de prouver le second facteur ; les autres, non.
    await tx.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, sessionId));
    await revokeUserSessions(user.id, { exceptSessionId: sessionId, reason: 'second_factor_changed' }, tx);
    return generated;
  });

  await recordAuthEvent('mfa_enabled', { userId: user.id, email: user.email, client });
  return codes;
}

export async function regenerateRecoveryCodes(user: UserRow, code: string, client: ClientInfo): Promise<string[]> {
  if (!user.twoFactorEnabledAt) {
    throw new AppError(409, 'La double authentification n’est pas activée.', 'MFA_NOT_ENABLED');
  }
  await verifyStepUp(user, code);
  const codes = await getDb().transaction((tx) => replaceRecoveryCodes(tx, user.id));
  await recordAuthEvent('recovery_codes_regenerated', { userId: user.id, email: user.email, client });
  return codes;
}

export async function disableTotp(
  user: UserRow,
  input: { password: string; code: string; isStaff: boolean; client: ClientInfo },
): Promise<void> {
  if (input.isStaff && !hasSecurityCode(user)) {
    throw new AppError(
      403,
      'Les comptes qui détiennent des privilèges d’administration doivent garder un second facteur : définissez d’abord un code de sécurité.',
      'MFA_REQUIRED_FOR_STAFF',
    );
  }
  if (!user.twoFactorEnabledAt) {
    throw new AppError(409, 'La double authentification n’est pas activée.', 'MFA_NOT_ENABLED');
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await registerFailure(emailThrottleKey(user.email), EMAIL_POLICY);
    throw new AppError(400, 'Mot de passe incorrect.', 'INVALID_PASSWORD');
  }
  await verifyStepUp(user, input.code);

  await getDb().transaction(async (tx) => {
    await tx
      .update(users)
      .set({ twoFactorSecret: null, twoFactorPendingSecret: null, twoFactorEnabledAt: null, twoFactorLastStep: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
  });
  await recordAuthEvent('mfa_disabled', { userId: user.id, email: user.email, client: input.client });
}

/* -------------------------------------------------------------------------- */
/*  Code de sécurité                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Définit ou remplace le code de sécurité : un second secret, demandé après le
 * mot de passe à chaque connexion, pour qui préfère un code à une application.
 *
 * Le mot de passe est exigé ; si le compte a déjà un second facteur, il l'est
 * aussi. Une session volée ne suffit donc pas à poser son propre code.
 */
export async function setSecurityCode(
  user: UserRow,
  input: { password: string; newCode: string; currentCode?: string; sessionId: string; client: ClientInfo },
): Promise<void> {
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await registerFailure(emailThrottleKey(user.email), EMAIL_POLICY);
    throw new AppError(400, 'Mot de passe incorrect.', 'INVALID_PASSWORD');
  }
  if (hasSecondFactor(user)) await verifyStepUp(user, input.currentCode);

  const newCode = input.newCode.trim();
  const problems = securityCodeProblems(newCode);
  if (await verifyPassword(user.passwordHash, newCode)) {
    problems.unshift('Le code de sécurité doit être différent de votre mot de passe.');
  }
  if (problems.length > 0) throw new AppError(400, problems[0]!, 'WEAK_SECURITY_CODE', { problems });

  const securityCodeHash = await hashPassword(newCode);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.update(users).set({ securityCodeHash, securityCodeSetAt: now, updatedAt: now }).where(eq(users.id, user.id));
    // La session courante vient de prouver le mot de passe et le code ; les autres, non.
    await tx.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, input.sessionId));
    await revokeUserSessions(user.id, { exceptSessionId: input.sessionId, reason: 'second_factor_changed' }, tx);
  });

  await recordAuthEvent(hasSecurityCode(user) ? 'security_code_changed' : 'security_code_set', {
    userId: user.id,
    email: user.email,
    client: input.client,
  });
}

export async function removeSecurityCode(
  user: UserRow,
  input: { password: string; code: string; isStaff: boolean; client: ClientInfo },
): Promise<void> {
  if (!hasSecurityCode(user)) {
    throw new AppError(409, 'Aucun code de sécurité n’est défini sur ce compte.', 'SECURITY_CODE_NOT_SET');
  }
  if (input.isStaff && !hasAuthenticatorApp(user)) {
    throw new AppError(
      403,
      'Les comptes qui détiennent des privilèges d’administration doivent garder un second facteur : activez d’abord l’application d’authentification.',
      'MFA_REQUIRED_FOR_STAFF',
    );
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await registerFailure(emailThrottleKey(user.email), EMAIL_POLICY);
    throw new AppError(400, 'Mot de passe incorrect.', 'INVALID_PASSWORD');
  }
  await verifyStepUp(user, input.code);

  await getDb()
    .update(users)
    .set({ securityCodeHash: null, securityCodeSetAt: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  await recordAuthEvent('security_code_removed', { userId: user.id, email: user.email, client: input.client });
}

/* -------------------------------------------------------------------------- */
/*  Mot de passe                                                               */
/* -------------------------------------------------------------------------- */

export async function changePassword(
  user: UserRow,
  input: { currentPassword: string; newPassword: string; sessionId: string; client: ClientInfo },
): Promise<void> {
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    await registerFailure(emailThrottleKey(user.email), EMAIL_POLICY);
    throw new AppError(400, 'Mot de passe actuel incorrect.', 'INVALID_PASSWORD');
  }
  const problems = passwordProblems(input.newPassword, { email: user.email, name: user.name });
  if (problems.length > 0) throw weakPassword(problems);

  const passwordHash = await hashPassword(input.newPassword);
  await getDb()
    .update(users)
    .set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  // Un mot de passe changé parce qu'il a fuité ne doit laisser aucune autre session ouverte.
  await revokeUserSessions(user.id, { exceptSessionId: input.sessionId, reason: 'password_changed' });
  await recordAuthEvent('password_changed', { userId: user.id, email: user.email, client: input.client });
  if (providers.email) {
    sendEmailInBackground(
      passwordChangedEmail(
        { email: user.email, name: user.name },
        {
          at: new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: env.REPORTING_TIMEZONE }),
          device: describeDevice(input.client.userAgent),
          resetUrl: `${appUrl()}/mot-de-passe-oublie`,
        },
      ),
      'alerte de mot de passe',
    );
  }
}

const appUrl = () => env.APP_URL.replace(/\/$/, '');

/**
 * Preuve que la personne devant l'écran est le titulaire du compte, avant une action
 * irréversible (suppression du compte) : mot de passe, puis second facteur s'il est
 * activé. Le verrou anti-force brute s'applique comme à la connexion.
 */
export async function verifyAccountOwner(user: UserRow, input: { password: string; code?: string }): Promise<void> {
  const key = emailThrottleKey(user.email);
  const locked = await lockedFor([key]);
  if (locked > 0) throw tooManyAttempts(locked, 'Trop de tentatives');

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const lock = await registerFailure(key, EMAIL_POLICY);
    if (lock > 0) throw tooManyAttempts(lock, 'Trop de tentatives');
    throw new AppError(400, 'Mot de passe incorrect.', 'INVALID_PASSWORD');
  }
  if (hasSecondFactor(user)) await verifyStepUp(user, input.code);
}

/**
 * Lien à usage unique : création du mot de passe d'un compte ouvert par un
 * administrateur, ou réinitialisation. Seule l'empreinte du jeton est stockée ;
 * le jeton voyage dans le fragment de l'adresse (#…), que les navigateurs
 * n'envoient jamais au serveur ni dans l'en-tête Referer.
 */
export async function issuePasswordToken(
  input: { userId: string; purpose: 'setup' | 'reset'; createdBy: string | null; ttlMs?: number },
  executor?: Transaction,
): Promise<{ url: string; expiresAt: Date }> {
  const token = randomToken();
  const ttl = input.ttlMs ?? (input.purpose === 'setup' ? SETUP_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS);
  const expiresAt = new Date(Date.now() + ttl);
  const db = executor ?? getDb();

  await db.delete(passwordTokens).where(and(eq(passwordTokens.userId, input.userId), isNull(passwordTokens.usedAt)));
  await db.insert(passwordTokens).values({
    id: sha256(token),
    userId: input.userId,
    purpose: input.purpose,
    createdBy: input.createdBy,
    expiresAt,
  });

  return { url: `${env.APP_URL.replace(/\/$/, '')}/mot-de-passe#${token}`, expiresAt };
}

const tokenInvalid = () =>
  new AppError(404, 'Ce lien n’est plus valide : il a expiré ou a déjà servi. Demandez-en un nouveau.', 'TOKEN_INVALID');

async function findUsableToken(token: string) {
  if (token.length < 20 || token.length > 100) throw tokenInvalid();
  const [row] = await getDb()
    .select({ token: passwordTokens, user: users })
    .from(passwordTokens)
    .innerJoin(users, eq(users.id, passwordTokens.userId))
    .where(
      and(eq(passwordTokens.id, sha256(token)), isNull(passwordTokens.usedAt), gt(passwordTokens.expiresAt, new Date())),
    )
    .limit(1);
  if (!row) throw tokenInvalid();
  return row;
}

export async function inspectPasswordToken(token: string) {
  const { token: row, user } = await findUsableToken(token);
  return { purpose: row.purpose, email: user.email, name: user.name, expiresAt: row.expiresAt.toISOString() };
}

export async function consumePasswordToken(input: { token: string; password: string; client: ClientInfo }): Promise<void> {
  const { token: tokenRow, user } = await findUsableToken(input.token);
  // Un lien demandé soi-même arrive par e-mail : s'en servir prouve que l'adresse est la bonne.
  const provesEmail = tokenRow.createdBy === null && !user.emailVerifiedAt;
  const problems = passwordProblems(input.password, { email: user.email, name: user.name });
  if (problems.length > 0) throw weakPassword(problems);

  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  await getDb().transaction(async (tx) => {
    // Réclamation conditionnelle : un lien ouvert deux fois en parallèle ne sert qu'une fois.
    const claimed = await tx
      .update(passwordTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordTokens.id, sha256(input.token)), isNull(passwordTokens.usedAt), gt(passwordTokens.expiresAt, now)))
      .returning({ id: passwordTokens.id });
    if (claimed.length === 0) throw tokenInvalid();

    await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: now, updatedAt: now, ...(provesEmail ? { emailVerifiedAt: now } : {}) })
      .where(eq(users.id, user.id));
    await revokeUserSessions(user.id, { reason: 'password_reset' }, tx);
    await tx.delete(mfaChallenges).where(eq(mfaChallenges.userId, user.id));
  });

  await clearFailures(emailThrottleKey(user.email));
  await recordAuthEvent('password_reset', { userId: user.id, email: user.email, client: input.client });
}

/* -------------------------------------------------------------------------- */
/*  E-mails : mot de passe oublié et confirmation d'adresse                    */
/* -------------------------------------------------------------------------- */

export const PASSWORD_RESET_EMAIL_TTL_MS = 60 * 60_000;
export const EMAIL_VERIFICATION_TTL_MS = 48 * 3_600_000;
const RESET_EMAILS_PER_HOUR = 3;

/**
 * Mot de passe oublié. Ne dit jamais si l'adresse est inscrite : l'appelant répond
 * la même chose dans tous les cas. Trois e-mails par heure au plus par compte, pour
 * qu'on ne puisse pas s'en servir pour inonder une boîte de réception.
 */
export async function requestPasswordReset(email: string, client: ClientInfo): Promise<void> {
  if (!providers.email) throw emailNotConfigured();

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.status !== 'active') return;

  const [recent] = await db
    .select({ total: count() })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.userId, user.id),
        eq(authEvents.type, 'password_reset_requested'),
        gt(authEvents.createdAt, new Date(Date.now() - 3_600_000)),
      ),
    );
  if ((recent?.total ?? 0) >= RESET_EMAILS_PER_HOUR) return;

  const link = await issuePasswordToken({
    userId: user.id,
    purpose: user.passwordHash ? 'reset' : 'setup',
    createdBy: null,
    ttlMs: PASSWORD_RESET_EMAIL_TTL_MS,
  });
  await recordAuthEvent('password_reset_requested', { userId: user.id, email: user.email, client });
  sendEmailInBackground(
    passwordResetEmail({ email: user.email, name: user.name }, link.url, PASSWORD_RESET_EMAIL_TTL_MS / 60_000),
    'mot de passe oublié',
  );
}

export async function sendEmailVerification(user: UserRow): Promise<void> {
  if (!providers.email) throw emailNotConfigured();
  if (user.emailVerifiedAt) throw new AppError(409, 'Votre adresse est déjà confirmée.', 'EMAIL_ALREADY_VERIFIED');

  const token = randomToken();
  const db = getDb();
  await db
    .delete(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)));
  await db.insert(emailVerificationTokens).values({
    id: sha256(token),
    userId: user.id,
    email: user.email,
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
  });
  sendEmailInBackground(
    emailVerificationEmail({ email: user.email, name: user.name }, `${appUrl()}/verifier-email#${token}`),
    'confirmation d’adresse',
  );
}

export async function verifyEmailToken(token: string, client: ClientInfo): Promise<void> {
  if (token.length < 20 || token.length > 100) throw tokenInvalid();
  const now = new Date();

  await getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailVerificationTokens.id, sha256(token)),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, now),
        ),
      )
      .returning();
    if (!claimed) throw tokenInvalid();

    const [user] = await tx
      .update(users)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(and(eq(users.id, claimed.userId), eq(users.email, claimed.email)))
      .returning({ id: users.id, email: users.email });
    if (!user) throw tokenInvalid();

    await recordAuthEvent('email_verified', { userId: user.id, email: user.email, client }, tx);
  });
}
