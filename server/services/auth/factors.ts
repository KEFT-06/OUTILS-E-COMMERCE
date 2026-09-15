import type { UserRow } from '@server/db/schema';

/**
 * Seconds facteurs d'un compte, au choix de l'utilisateur :
 *  - une application d'authentification (code à 6 chiffres qui change toutes les 30 s) ;
 *  - un code de sécurité personnel, distinct du mot de passe.
 * L'un ou l'autre suffit à protéger la connexion et l'administration.
 */

type FactorFields = Pick<UserRow, 'twoFactorEnabledAt' | 'twoFactorSecret' | 'securityCodeHash'>;

export function hasAuthenticatorApp(user: FactorFields): boolean {
  return Boolean(user.twoFactorEnabledAt && user.twoFactorSecret);
}

export function hasSecurityCode(user: FactorFields): boolean {
  return Boolean(user.securityCodeHash);
}

export function hasSecondFactor(user: FactorFields): boolean {
  return hasAuthenticatorApp(user) || hasSecurityCode(user);
}

export function secondFactorMethods(user: FactorFields): { app: boolean; code: boolean } {
  return { app: hasAuthenticatorApp(user), code: hasSecurityCode(user) };
}
