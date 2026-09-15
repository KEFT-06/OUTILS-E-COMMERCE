import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Schéma de la base Smart Creator (PostgreSQL ; Supabase en production).
 *
 * Trois règles :
 *  - Aucun secret en clair. Mots de passe en Argon2id ; jetons de session, liens à
 *    usage unique et codes de secours en SHA-256 ; secrets de double
 *    authentification et clés API des utilisateurs chiffrés en AES-256-GCM
 *    (server/lib/crypto.ts).
 *  - Row Level Security activée sur chaque table, sans aucune politique. L'API REST
 *    automatique de Supabase ne peut donc rien lire ni écrire, même avec la clé
 *    publique « anon » : seul le serveur, connecté avec le rôle propriétaire, accède
 *    aux données.
 *  - Ce fichier n'importe que drizzle : drizzle-kit le lit tel quel pour générer
 *    les migrations SQL du dossier drizzle/.
 */

export const PLAN_IDS = ['free', 'plus', 'pro', 'max', 'elite'] as const;

export const GENERATION_KINDS = [
  'video',
  'image',
  'storybook',
  'ebook',
  'product_page',
  'report_pdf',
  'swipe_file',
  'launch_kit',
  'ad_scan',
] as const;

export const PAYMENT_METHODS = ['mobile_money', 'card', 'bank_transfer', 'cash', 'chariow', 'other'] as const;

export const userRole = pgEnum('user_role', ['user', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'suspended']);
export const planId = pgEnum('plan_id', PLAN_IDS);
export const featureAccess = pgEnum('feature_access', ['granted', 'revoked']);
export const creditReason = pgEnum('credit_reason', ['plan_cycle', 'usage', 'refund', 'admin_grant', 'plan_change']);
export const generationKind = pgEnum('generation_kind', GENERATION_KINDS);
export const generationStatus = pgEnum('generation_status', ['pending', 'completed', 'failed']);
/** « server » : mesuré par le serveur ; « client » : déclaré par le navigateur (exports locaux). */
export const usageSource = pgEnum('usage_source', ['server', 'client']);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentStatus = pgEnum('payment_status', ['paid', 'refunded']);
export const tokenPurpose = pgEnum('token_purpose', ['setup', 'reset']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const moment = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Toujours en minuscules : l'unicité porte sur la forme normalisée. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** Null tant que le lien de création du mot de passe n'a pas servi. */
    passwordHash: text('password_hash'),
    role: userRole('role').notNull().default('user'),
    status: userStatus('status').notNull().default('active'),
    suspendedReason: text('suspended_reason'),
    plan: planId('plan').notNull().default('free'),
    /** Null : palier sans échéance (gratuit, ou attribué sans limite par un administrateur). */
    planExpiresAt: moment('plan_expires_at'),
    /** Points du quota mensuel du palier, remis à niveau à chaque cycle. */
    planCredits: integer('plan_credits').notNull().default(0),
    /** Points ajoutés par un administrateur ou un remboursement : ils n'expirent pas. */
    bonusCredits: integer('bonus_credits').notNull().default(0),
    creditsCycleEndsAt: moment('credits_cycle_ends_at').notNull(),
    twoFactorSecret: text('two_factor_secret'),
    twoFactorPendingSecret: text('two_factor_pending_secret'),
    twoFactorEnabledAt: moment('two_factor_enabled_at'),
    /** Dernier pas TOTP accepté : un code déjà utilisé ne peut pas être rejoué. */
    twoFactorLastStep: integer('two_factor_last_step'),
    savedNiches: jsonb('saved_niches').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    lastLoginAt: moment('last_login_at'),
    passwordChangedAt: moment('password_changed_at'),
    createdAt: createdAt(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email), index('users_created_idx').on(table.createdAt)],
).enableRLS();

export const sessions = pgTable(
  'sessions',
  {
    /** Empreinte SHA-256 du jeton : le jeton lui-même ne vit que dans le cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: moment('last_seen_at').notNull().defaultNow(),
    expiresAt: moment('expires_at').notNull(),
  },
  (table) => [index('sessions_user_idx').on(table.userId), index('sessions_last_seen_idx').on(table.lastSeenAt)],
).enableRLS();

/** Connexion en attente du code de double authentification. */
export const mfaChallenges = pgTable(
  'mfa_challenges',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attempts: integer('attempts').notNull().default(0),
    ipAddress: text('ip_address'),
    createdAt: createdAt(),
    expiresAt: moment('expires_at').notNull(),
  },
  (table) => [index('mfa_challenges_user_idx').on(table.userId)],
).enableRLS();

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: moment('used_at'),
    createdAt: createdAt(),
  },
  (table) => [index('recovery_codes_user_idx').on(table.userId)],
).enableRLS();

/**
 * Compteurs d'échecs de connexion, par adresse e-mail (existante ou non) et par
 * adresse IP. En base plutôt qu'en mémoire : le verrou survit à un redémarrage et
 * vaut pour toutes les instances du serveur.
 */
export const authThrottles = pgTable('auth_throttles', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull().default(0),
  lockedUntil: moment('locked_until'),
  lastFailureAt: moment('last_failure_at').notNull().defaultNow(),
}).enableRLS();

export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    email: text('email'),
    type: text('type').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [index('auth_events_created_idx').on(table.createdAt), index('auth_events_user_idx').on(table.userId)],
).enableRLS();

/** Journal des actions d'administration. Aucune route ne permet d'en supprimer une ligne. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    targetEmail: text('target_email'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    createdAt: createdAt(),
  },
  (table) => [index('audit_logs_created_idx').on(table.createdAt), index('audit_logs_target_idx').on(table.targetUserId)],
).enableRLS();

export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.permission] })],
).enableRLS();

/** Accès accordé ou retiré à une fonction, par-dessus ce que prévoit le palier. */
export const featureOverrides = pgTable(
  'feature_overrides',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    access: featureAccess('access').notNull(),
    setBy: uuid('set_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.feature] })],
).enableRLS();

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planDelta: integer('plan_delta').notNull().default(0),
    bonusDelta: integer('bonus_delta').notNull().default(0),
    reason: creditReason('reason').notNull(),
    actionId: text('action_id'),
    generationId: uuid('generation_id'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    balanceAfter: integer('balance_after').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('credit_transactions_user_idx').on(table.userId, table.createdAt),
    index('credit_transactions_created_idx').on(table.createdAt),
  ],
).enableRLS();

export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: generationKind('kind').notNull(),
    provider: text('provider').notNull(),
    /** Identifiant chez le fournisseur : c'est lui qui ouvre l'accès au fichier. */
    providerRef: text('provider_ref'),
    status: generationStatus('status').notNull(),
    fileFormat: text('file_format'),
    source: usageSource('source').notNull().default('server'),
    creditsCharged: integer('credits_charged').notNull().default(0),
    /** Transaction de débit, pour rembourser exactement ce qui a été prélevé. */
    debitTransactionId: uuid('debit_transaction_id'),
    refunded: boolean('refunded').notNull().default(false),
    createdAt: createdAt(),
    completedAt: moment('completed_at'),
  },
  (table) => [
    uniqueIndex('generations_provider_ref_unique').on(table.provider, table.providerRef),
    index('generations_user_idx').on(table.userId, table.createdAt),
    index('generations_kind_idx').on(table.kind, table.createdAt),
  ],
).enableRLS();

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Copie de l'adresse au moment du paiement : la comptabilité survit à la suppression du compte. */
    userEmail: text('user_email').notNull(),
    plan: planId('plan').notNull(),
    periodMonths: integer('period_months').notNull(),
    /** Montant entier en francs CFA : la devise n'a pas de centimes. */
    amountFcfa: integer('amount_fcfa').notNull(),
    method: paymentMethod('method').notNull(),
    reference: text('reference'),
    status: paymentStatus('status').notNull().default('paid'),
    paidAt: moment('paid_at').notNull(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    refundedAt: moment('refunded_at'),
    createdAt: createdAt(),
  },
  (table) => [index('payments_paid_idx').on(table.paidAt), index('payments_user_idx').on(table.userId)],
).enableRLS();

/** Liens à usage unique : création du mot de passe d'un compte, ou réinitialisation. */
export const passwordTokens = pgTable(
  'password_tokens',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: tokenPurpose('purpose').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: moment('expires_at').notNull(),
    usedAt: moment('used_at'),
    createdAt: createdAt(),
  },
  (table) => [index('password_tokens_user_idx').on(table.userId)],
).enableRLS();

/** Clés API personnelles (Chariow…), chiffrées. Le serveur ne les renvoie jamais au navigateur. */
export const userIntegrations = pgTable(
  'user_integrations',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    secret: text('secret').notNull(),
    /** Quatre derniers caractères, pour que l'utilisateur reconnaisse sa clé. */
    hint: text('hint').notNull(),
    verifiedAt: moment('verified_at').notNull(),
    createdAt: createdAt(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
).enableRLS();

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type PlanId = (typeof PLAN_IDS)[number];
export type GenerationKind = (typeof GENERATION_KINDS)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
