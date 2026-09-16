import { env, providers } from '@server/env';
import { AppError } from '@server/middleware';

/**
 * Envoi des e-mails transactionnels (lien de mot de passe, confirmation d'adresse,
 * alerte de sécurité) par Brevo ou Resend, au choix du propriétaire.
 *
 * La clé ne quitte jamais le serveur ; les journaux ne gardent que le code de
 * réponse du fournisseur, jamais l'adresse du destinataire ni le contenu.
 */

const TIMEOUT_MS = 15_000;

export interface OutgoingEmail {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
}

/** « Smart Creator <no-reply@exemple.com> » ou « no-reply@exemple.com ». */
export function parseSender(from: string): { name: string; email: string } | null {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s@]+@[^<>\s@]+)>\s*$/.exec(from) ?? /^\s*()([^<>\s@]+@[^<>\s@]+)\s*$/.exec(from);
  if (!match) return null;
  return { name: (match[1] ?? '').trim() || 'Smart Creator', email: match[2]! };
}

export const emailNotConfigured = () =>
  new AppError(
    503,
    'L’envoi d’e-mails n’est pas encore configuré sur ce serveur : demandez un lien à l’administrateur de Smart Creator.',
    'EMAIL_NOT_CONFIGURED',
  );

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const sender = env.EMAIL_FROM ? parseSender(env.EMAIL_FROM) : null;
  if (!providers.email || !sender || !env.EMAIL_API_KEY) throw emailNotConfigured();

  const request: { url: string; headers: Record<string, string>; body: unknown } =
    env.EMAIL_PROVIDER === 'resend'
      ? {
          url: `${(env.EMAIL_API_URL ?? 'https://api.resend.com').replace(/\/+$/, '')}/emails`,
          headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}` },
          body: {
            from: `${sender.name} <${sender.email}>`,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          },
        }
      : {
          url: `${(env.EMAIL_API_URL ?? 'https://api.brevo.com').replace(/\/+$/, '')}/v3/smtp/email`,
          headers: { 'api-key': env.EMAIL_API_KEY },
          body: {
            sender,
            to: [{ email: message.to, ...(message.toName ? { name: message.toName } : {}) }],
            subject: message.subject,
            htmlContent: message.html,
            textContent: message.text,
          },
        };

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(504, 'Le service d’e-mails n’a pas répondu à temps.', 'EMAIL_TIMEOUT');
  }
  if (!response.ok) {
    console.error('[e-mails] le fournisseur a répondu', response.status);
    throw new AppError(502, 'Le service d’e-mails a refusé l’envoi.', 'EMAIL_FAILED');
  }
}

/**
 * Envoi détaché de la réponse HTTP : la durée de l'envoi ne doit pas révéler si une
 * adresse est inscrite, et un fournisseur lent ne doit pas bloquer l'écran.
 */
/**
 * Avis à la boîte de l'équipe (CONTACT_INBOX_EMAIL), en arrière-plan. Sans boîte ou sans service
 * d'e-mails, rien n'est envoyé : l'information reste dans l'administration.
 */
export function notifyTeamInBackground(subject: string, lines: string[], context: string): void {
  if (!providers.email || !env.CONTACT_INBOX_EMAIL) return;
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
  sendEmailInBackground(
    { to: env.CONTACT_INBOX_EMAIL, subject, text: lines.join('\n'), html: `<p>${lines.map(escape).join('<br>')}</p>` },
    context,
  );
}

export function sendEmailInBackground(message: OutgoingEmail, context: string): void {
  void sendEmail(message).catch((error: unknown) => {
    console.error(`[e-mails] envoi impossible (${context}) :`, error instanceof AppError ? error.code : 'erreur inconnue');
  });
}
