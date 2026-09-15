import { hash, verify } from '@node-rs/argon2';
import { randomToken } from '@server/lib/crypto';

/**
 * Mots de passe : Argon2id avec les paramètres recommandés par l'OWASP
 * (19 Mio de mémoire, 2 passes, 1 fil). Coûteux en mémoire, donc lent à attaquer
 * sur carte graphique, sans pénaliser une connexion légitime.
 */

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Mots de passe fréquents d'au moins 12 caractères : les plus courts sont déjà refusés par la longueur. */
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  'motdepasse123',
  'motdepasse1234',
  'motdepasse12345',
  'password1234',
  'password12345',
  'azertyuiop12',
  'azertyuiop123',
  'qwertyuiop12',
  'qwertyuiop123',
  'administrateur',
  'administrator',
  'bonjour123456',
  'iloveyou1234',
  'jetaime123456',
  'smartcreator',
  'smartcreator1',
  'smartcreator123',
  'changeme1234',
  'welcome12345',
  'football1234',
  'soleil123456',
]);

/**
 * Motifs de refus, en français, pour l'écran d'inscription. Liste vide : accepté.
 * Pas de règle « une majuscule, un chiffre, un symbole » : elle produit des
 * « Motdepasse1! » prévisibles. La longueur et le refus des mots de passe connus
 * protègent davantage (NIST SP 800-63B).
 */
export function passwordProblems(password: string, context: { email?: string; name?: string } = {}): string[] {
  const problems: string[] = [];
  const normalized = password.normalize('NFKC');
  const lower = normalized.toLowerCase();

  if (normalized.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`);
  }
  if (normalized.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Le mot de passe ne peut pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`);
  }
  if (new Set(normalized).size < 5) {
    problems.push('Le mot de passe répète trop peu de caractères différents.');
  }
  if (COMMON_PASSWORDS.has(lower)) {
    problems.push('Ce mot de passe figure parmi les plus utilisés : choisissez-en un autre.');
  }

  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
    problems.push('Le mot de passe ne doit pas contenir votre adresse e-mail.');
  }
  const firstName = context.name?.trim().split(/\s+/)[0]?.toLowerCase();
  if (firstName && firstName.length >= 4 && lower.includes(firstName)) {
    problems.push('Le mot de passe ne doit pas contenir votre nom.');
  }

  return problems;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password.normalize('NFKC'), ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | null = null;

/**
 * Vérifie un mot de passe. Sans compte, la vérification se fait contre une
 * empreinte factice : la durée de la réponse ne révèle pas si l'adresse existe.
 */
export async function verifyPassword(passwordHash: string | null | undefined, password: string): Promise<boolean> {
  const candidate = password.normalize('NFKC');
  if (!passwordHash) {
    dummyHash ??= hash(randomToken(), ARGON2_OPTIONS);
    await verify(await dummyHash, candidate).catch(() => false);
    return false;
  }
  return verify(passwordHash, candidate).catch(() => false);
}
