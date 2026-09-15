import { createConnection } from 'node:net';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { closeDatabase, databaseKind, getDb, initDatabase } from '@server/db/client';
import { recoveryCodes, userPermissions, users } from '@server/db/schema';
import { env } from '@server/env';
import { createUserRecord } from '@server/services/accounts';
import { recordAudit } from '@server/services/audit';
import { SETUP_TOKEN_TTL_MS, emailSchema, issuePasswordToken, nameSchema } from '@server/services/auth';
import { revokeUserSessions } from '@server/services/auth/sessions';
import { clearFailures, emailThrottleKey } from '@server/services/auth/throttle';
import { findCountry } from '@server/shared/countries';

/**
 * Crée le compte administrateur, ou promeut un compte existant.
 *
 *   npm run admin:create -- --email vous@exemple.com --name "Votre nom" --country CM
 *   npm run admin:create -- --email vous@exemple.com --reset        (mot de passe oublié)
 *   npm run admin:create -- --email vous@exemple.com --reset-2fa    (code de sécurité ou téléphone perdu)
 *
 * Aucun mot de passe ne transite par la ligne de commande (il resterait dans
 * l'historique du terminal) : la commande affiche un lien à usage unique où
 * l'administrateur choisit lui-même son mot de passe. Qui lance cette commande a
 * déjà accès au serveur : le lien reste valable 24 heures.
 */

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    country: { type: 'string' },
    reset: { type: 'boolean', default: false },
    'reset-2fa': { type: 'boolean', default: false },
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
    console.error(
      'Usage : npm run admin:create -- --email vous@exemple.com [--name "Votre nom"] [--country CM] [--reset] [--reset-2fa]',
    );
    process.exit(1);
  }
  const name = values.name ? nameSchema.parse(values.name) : undefined;
  const country = values.country ? findCountry(values.country) : undefined;
  if (values.country && !country) {
    console.error(`\n❌ Pays inconnu : « ${values.country} ». Indiquez le code à deux lettres (CM, CI, SN, FR, US…).\n`);
    process.exit(1);
  }

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
      country: country?.code ?? null,
    });
    await recordAudit({ actor, action: 'admin.bootstrap_created', target: user, client });
    console.log(`\n✅ Compte administrateur créé : ${user.email} (palier Elite Enterprise, points illimités).`);
  } else if (user.role !== 'admin' || user.status !== 'active') {
    await db
      .update(users)
      .set({ role: 'admin', status: 'active', suspendedReason: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await db.delete(userPermissions).where(eq(userPermissions.userId, user.id));
    await revokeUserSessions(user.id, { reason: 'role_changed' });
    await recordAudit({ actor, action: 'admin.bootstrap_promoted', target: user, details: { previousRole: user.role }, client });
    console.log(`\n✅ ${user.email} est désormais administrateur.`);
  } else {
    console.log(`\nℹ️  ${user.email} est déjà administrateur.`);
  }

  if (country && user.country !== country.code) {
    await db.update(users).set({ country: country.code, updatedAt: new Date() }).where(eq(users.id, user.id));
    console.log(`   Pays : ${country.fr} (prix affichés en ${country.currency}).`);
  }

  if (values['reset-2fa']) {
    await db
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
      .where(eq(users.id, user.id));
    await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
    await revokeUserSessions(user.id, { reason: 'second_factor_reset' });
    await recordAudit({ actor, action: 'two_factor.reset', target: user, client });
    console.log('\n   Second facteur retiré : définissez un nouveau code de sécurité dans Mon compte → Sécurité.');
  }

  if (!user.passwordHash || values.reset) {
    const purpose = user.passwordHash ? 'reset' : 'setup';
    const link = await issuePasswordToken({ userId: user.id, purpose, createdBy: null, ttlMs: SETUP_TOKEN_TTL_MS });
    // Un verrou posé par des essais erronés ne doit pas bloquer la personne qui vient de prouver l'accès au serveur.
    await clearFailures(emailThrottleKey(user.email));
    console.log('\n   Lien à usage unique pour choisir le mot de passe :');
    console.log(`   ${link.url}`);
    console.log(`   Valable jusqu’au ${link.expiresAt.toLocaleString('fr-FR')}, et une seule fois.`);
    console.log('\n   Ensuite : connectez-vous, définissez votre code de sécurité dans Mon compte → Sécurité,');
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
