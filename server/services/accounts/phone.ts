import { AppError } from '@server/middleware';
import { dialCodeOf } from '@server/shared/dialCodes';
import { accountPhone } from '@server/shared/phone';

/**
 * Le numéro de téléphone d'un compte, tel qu'il sera enregistré.
 *
 * - `undefined` : rien n'a été envoyé, le numéro en place ne change pas ;
 * - `null` : champ vidé, le numéro est retiré ;
 * - sinon le numéro au format international.
 *
 * Une saisie qui ne peut pas être un numéro est refusée, avec un message qui dit quoi écrire —
 * l'indicatif du pays quand on le connaît.
 */
export function readAccountPhone(typed: string | undefined, country: string | null | undefined): string | null | undefined {
  if (typed === undefined) return undefined;
  if (!typed.trim()) return null;
  const phone = accountPhone(typed, country);
  if (phone) return phone;
  const dial = dialCodeOf(country);
  throw new AppError(
    400,
    dial
      ? `Ce numéro de téléphone n’est pas reconnu : écrivez-le en entier, par exemple +${dial} suivi de votre numéro.`
      : 'Ce numéro de téléphone n’est pas reconnu : écrivez-le avec l’indicatif de votre pays, par exemple +237 suivi de votre numéro.',
    'PHONE_INVALID',
  );
}
