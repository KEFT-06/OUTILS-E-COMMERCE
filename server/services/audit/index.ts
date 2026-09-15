import type { Request } from 'express';
import { getDb, type Executor } from '@server/db/client';
import { auditLogs, authEvents } from '@server/db/schema';

/**
 * Deux journaux distincts :
 *  - `auth_events` : ce qui arrive aux comptes (connexions, échecs, verrous,
 *    double authentification). Sert à repérer une attaque.
 *  - `audit_logs` : ce que font les administrateurs. Sert à savoir qui a changé
 *    quoi, et quand. Aucune route ne permet d'en effacer une ligne.
 */

export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

export function clientInfo(req: Request): ClientInfo {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
  };
}

export const AUTH_EVENT_LABELS = {
  signup: 'Inscription',
  login_success: 'Connexion réussie',
  login_failure: 'Mot de passe incorrect',
  login_locked: 'Tentative pendant un verrou',
  login_suspended: 'Connexion d’un compte bloqué',
  mfa_challenge: 'Code de vérification demandé',
  mfa_failure: 'Code de vérification incorrect',
  recovery_code_used: 'Code de secours utilisé',
  logout: 'Déconnexion',
  logout_all: 'Déconnexion de tous les appareils',
  password_changed: 'Mot de passe modifié',
  password_reset: 'Mot de passe défini par lien',
  mfa_enabled: 'Double authentification activée',
  mfa_disabled: 'Double authentification désactivée',
  recovery_codes_regenerated: 'Codes de secours renouvelés',
  security_code_set: 'Code de sécurité défini',
  security_code_changed: 'Code de sécurité modifié',
  security_code_removed: 'Code de sécurité retiré',
  integration_saved: 'Clé API enregistrée',
  integration_removed: 'Clé API supprimée',
  account_deleted: 'Compte supprimé par son titulaire',
  password_reset_requested: 'Lien de mot de passe envoyé par e-mail',
  email_verified: 'Adresse e-mail confirmée',
} as const;

export type AuthEventType = keyof typeof AUTH_EVENT_LABELS;

export async function recordAuthEvent(
  type: AuthEventType,
  input: { userId?: string | null; email?: string | null; client: ClientInfo; details?: Record<string, unknown> },
  executor: Executor = getDb(),
): Promise<void> {
  await executor.insert(authEvents).values({
    type,
    userId: input.userId ?? null,
    email: input.email ?? null,
    ipAddress: input.client.ipAddress,
    userAgent: input.client.userAgent,
    details: input.details ?? null,
  });
}

export interface AuditActor {
  id: string | null;
  email: string;
}

export async function recordAudit(
  input: {
    actor: AuditActor;
    action: string;
    target?: { id: string; email: string } | null;
    details?: Record<string, unknown>;
    client: ClientInfo;
  },
  executor: Executor = getDb(),
): Promise<void> {
  await executor.insert(auditLogs).values({
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    action: input.action,
    targetUserId: input.target?.id ?? null,
    targetEmail: input.target?.email ?? null,
    details: input.details ?? null,
    ipAddress: input.client.ipAddress,
  });
}
