import { eq } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { userPermissions, users } from '@server/db/schema';
import { createUserRecord } from '@server/services/accounts';
import { recordAudit } from '@server/services/audit';
import { SETUP_TOKEN_TTL_MS, issuePasswordToken } from '@server/services/auth';
import { revokeUserSessions } from '@server/services/auth/sessions';

/**
 * Premier administrateur d'une nouvelle installation, créé au démarrage à partir de
 * ADMIN_BOOTSTRAP_EMAIL. Pour les hébergeurs sans terminal (Render gratuit) : sans cela, il
 * faudrait lancer `npm run admin:create` depuis un poste avec la chaîne de connexion de la base
 * de production, qui resterait dans l'historique du terminal.
 *
 * - N'agit que tant qu'aucun administrateur n'existe : une fois le premier compte créé, la
 *   variable n'ouvre plus rien, même si elle reste renseignée.
 * - Aucun mot de passe ne transite : le journal du serveur, lisible par le seul propriétaire de
 *   l'hébergement, reçoit un lien à usage unique valable 24 heures.
 */
export async function bootstrapFirstAdmin(email: string): Promise<'created' | 'promoted' | 'skipped'> {
  const db = getDb();
  const [anyAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  if (anyAdmin) {
    console.log('  Premier administrateur : un administrateur existe déjà, ADMIN_BOOTSTRAP_EMAIL est ignorée (vous pouvez la retirer).');
    return 'skipped';
  }

  const actor = { id: null, email: 'démarrage du serveur' };
  const client = { ipAddress: null, userAgent: 'ADMIN_BOOTSTRAP_EMAIL' };
  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);

  let user = existing;
  let outcome: 'created' | 'promoted';
  if (!user) {
    user = await createUserRecord({ name: normalized.split('@')[0]!, email: normalized, passwordHash: null, role: 'admin', plan: 'elite' });
    await recordAudit({ actor, action: 'admin.bootstrap_created', target: user, client });
    outcome = 'created';
  } else {
    await db
      .update(users)
      .set({ role: 'admin', status: 'active', suspendedReason: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await db.delete(userPermissions).where(eq(userPermissions.userId, user.id));
    await revokeUserSessions(user.id, { reason: 'role_changed' });
    await recordAudit({ actor, action: 'admin.bootstrap_promoted', target: user, details: { previousRole: user.role }, client });
    outcome = 'promoted';
  }

  const link = await issuePasswordToken({
    userId: user.id,
    purpose: user.passwordHash ? 'reset' : 'setup',
    createdBy: null,
    ttlMs: SETUP_TOKEN_TTL_MS,
  });
  console.log(`\n  ✅ Premier administrateur ${outcome === 'created' ? 'créé' : 'désigné'} : ${user.email}`);
  console.log('     Lien à usage unique pour choisir le mot de passe (valable 24 heures) :');
  console.log(`     ${link.url}`);
  console.log('     Ensuite : Mon compte → Sécurité pour le second facteur, puis Administration.\n');
  return outcome;
}
