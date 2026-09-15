import { createConnection } from 'node:net';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { closeDatabase, databaseKind, getDb, initDatabase } from '@server/db/client';
import { userPermissions, users } from '@server/db/schema';
import { env } from '@server/env';
import { createUserRecord } from '@server/services/accounts';
import { recordAudit } from '@server/services/audit';
import { emailSchema, issuePasswordToken, nameSchema } from '@server/services/auth';
import { revokeUserSessions } from '@server/services/auth/sessions';

/**
 * Crée le compte administrateur, ou promeut un compte existant.
 *
 *   npm run admin:create -- --email vous@exemple.com --name "Votre nom"
 *   npm run admin:create -- --email vous@exemple.com --reset   (nouveau lien)
 *
 * Aucun mot de passe ne transite par la ligne de commande (il resterait dans
 * l'historique du terminal) : la commande affiche un lien à usage unique où
 * l'administrateur choisit lui-même son mot de passe.
 */

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    reset: { type: 'boolean', default: false },
  },
});

function apiIsListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: env.PORT });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function main(): Promise<void> {
  const email = emailSchema.safeParse(values.email);
  if (!email.success) {
    console.error('Usage : npm run admin:create -- --email vous@exemple.com [--name "Votre nom"] [--reset]');
    process.exit(1);
  }
  const name = values.name ? nameSchema.parse(values.name) : undefined;

  // La base embarquée ne supporte qu'un programme à la fois : l'ouvrir pendant
  // que le serveur tourne pourrait la corrompre.
  if (!env.DATABASE_URL && (await apiIsListening())) {
    console.error(
      `\n❌ Le serveur API tourne sur le port ${env.PORT}. Arrêtez-le le temps de cette commande :` +
        ' la base embarquée ne peut être ouverte que par un seul programme à la fois.\n',
    );
    process.exit(1);
  }

  await initDatabase();
  const db = getDb();
  const actor = { id: null, email: 'ligne de commande' };
  const client = { ipAddress: null, userAgent: 'npm run admin:create' };

  const [existing] = await db.select().from(users).where(eq(users.email, email.data)).limit(1);
  let user = existing;

  if (!user) {
    user = await createUserRecord({
      name: name ?? email.data.split('@')[0]!,
      email: email.data,
      passwordHash: null,
      role: 'admin',
      plan: 'elite',
    });
    await recordAudit({ actor, action: 'admin.bootstrap_created', target: user, client });
    console.log(`\n✅ Compte administrateur créé : ${user.email} (palier Elite Enterprise, points illimités).`);
  } else if (user.role !== 'admin' || user.status !== 'active') {
    await db
      .update(users)
      .set({ role: 'admin', status: 'active', suspendedReason: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await db.delete(userPermissions).where(eq(userPermissions.userId, user.id));
    await revokeUserSessions(user.id);
    await recordAudit({ actor, action: 'admin.bootstrap_promoted', target: user, details: { previousRole: user.role }, client });
    console.log(`\n✅ ${user.email} est désormais administrateur.`);
  } else {
    console.log(`\nℹ️  ${user.email} est déjà administrateur.`);
  }

  if (!user.passwordHash || values.reset) {
    const purpose = user.passwordHash ? 'reset' : 'setup';
    const link = await issuePasswordToken({ userId: user.id, purpose, createdBy: null });
    console.log('\n   Lien à usage unique pour choisir le mot de passe :');
    console.log(`   ${link.url}`);
    console.log(`   Valable jusqu’au ${link.expiresAt.toLocaleString('fr-FR')}, et une seule fois.`);
    console.log('\n   Ensuite : connectez-vous, activez la double authentification dans Mon compte,');
    console.log('   puis ouvrez Administration dans la barre latérale.');
  }

  console.log(`\n   Base : ${databaseKind() === 'postgres' ? 'PostgreSQL distant' : 'PostgreSQL embarqué (.data/pglite)'}\n`);
  await closeDatabase();
}

main().catch(async (error: unknown) => {
  console.error('\n❌', error instanceof Error ? error.message : error);
  await closeDatabase().catch(() => undefined);
  process.exit(1);
});
