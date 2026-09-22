import type { OutgoingEmail } from '@server/services/email';

/**
 * Modèles des e-mails transactionnels : texte brut et HTML simple, en français.
 * Toute donnée variable est échappée dans le HTML ; les liens portent leur jeton
 * après « # », que les navigateurs n'envoient jamais au serveur.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function layout(input: { title: string; paragraphs: string[]; action?: { label: string; url: string }; footer: string }): string {
  const paragraphs = input.paragraphs.map((paragraph) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(paragraph)}</p>`).join('');
  const action = input.action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#00a844;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(input.action.label)}</a></p>` +
      `<p style="margin:0 0 14px;font-size:13px;color:#475569;line-height:1.5">Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br><span style="word-break:break-all">${escapeHtml(input.action.url)}</span></p>`
    : '';
  return (
    '<!doctype html><html lang="fr"><body style="margin:0;background:#f5f7f4;font-family:Arial,Helvetica,sans-serif;color:#0f172a">' +
    '<div style="max-width:560px;margin:0 auto;padding:28px 18px">' +
    '<p style="margin:0 0 18px;font-weight:700;color:#00a844">Smart Creator</p>' +
    `<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px"><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(input.title)}</h1>${paragraphs}${action}</div>` +
    `<p style="margin:18px 0 0;font-size:12px;color:#64748b;line-height:1.5">${escapeHtml(input.footer)}</p>` +
    '</div></body></html>'
  );
}

function textOf(input: { title: string; paragraphs: string[]; action?: { label: string; url: string }; footer: string }): string {
  return [input.title, '', ...input.paragraphs, ...(input.action ? ['', `${input.action.label} : ${input.action.url}`] : []), '', '—', input.footer].join('\n');
}

function build(to: { email: string; name: string }, subject: string, content: Parameters<typeof layout>[0]): OutgoingEmail {
  return { to: to.email, toName: to.name, subject, text: textOf(content), html: layout(content) };
}

export function passwordResetEmail(to: { email: string; name: string }, url: string, validMinutes: number): OutgoingEmail {
  return build(to, 'Réinitialiser votre mot de passe Smart Creator', {
    title: 'Réinitialiser votre mot de passe',
    paragraphs: [
      `Bonjour ${to.name},`,
      `Une réinitialisation du mot de passe de votre compte Smart Creator a été demandée. Ce lien sert une seule fois et reste valable ${validMinutes} minutes.`,
      'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.',
    ],
    action: { label: 'Choisir un nouveau mot de passe', url },
    footer: 'Smart Creator ne vous demandera jamais votre mot de passe ni votre code de sécurité par e-mail.',
  });
}

export function emailVerificationEmail(to: { email: string; name: string }, url: string): OutgoingEmail {
  return build(to, 'Confirmez votre adresse e-mail', {
    title: 'Confirmez votre adresse e-mail',
    paragraphs: [
      `Bonjour ${to.name},`,
      'Confirmez que cette adresse vous appartient : elle servira à vous envoyer un lien si vous oubliez votre mot de passe.',
      'Ce lien reste valable 48 heures.',
    ],
    action: { label: 'Confirmer mon adresse', url },
    footer: 'Vous n’avez pas créé de compte Smart Creator ? Ignorez ce message : aucun compte ne sera confirmé.',
  });
}

export function passwordChangedEmail(to: { email: string; name: string }, input: { at: string; device: string; resetUrl: string }): OutgoingEmail {
  return build(to, 'Votre mot de passe Smart Creator a été modifié', {
    title: 'Votre mot de passe a été modifié',
    paragraphs: [
      `Bonjour ${to.name},`,
      `Le mot de passe de votre compte a été modifié le ${input.at}, depuis : ${input.device}. Vos autres appareils ont été déconnectés.`,
      'Si c’est bien vous, il n’y a rien à faire. Sinon, réinitialisez votre mot de passe tout de suite.',
    ],
    action: { label: 'Réinitialiser mon mot de passe', url: input.resetUrl },
    footer: 'Message de sécurité envoyé à chaque changement de mot de passe.',
  });
}

/**
 * Résumé du radar. Le seul e-mail que Smart Creator envoie sans que l'utilisateur ait
 * cliqué sur quoi que ce soit — c'est son objet même : un radar dont personne n'est
 * averti ne sert à rien.
 *
 * Deux règles de forme : les phrases sont celles rédigées par le serveur au moment du
 * relevé, reprises telles quelles (l'écran et l'e-mail disent donc exactement la même
 * chose), et le nombre d'événements annoncé est celui de la période, jamais un total
 * cumulé qui gonflerait avec le temps.
 */
export function radarDigestEmail(
  to: { email: string; name: string },
  input: { lines: string[]; total: number; since: string; url: string },
): OutgoingEmail {
  const reste = input.total - input.lines.length;
  return build(to, `Radar : ${input.total} changement${input.total > 1 ? 's' : ''} chez vos concurrents`, {
    title: 'Ce que le radar a vu',
    paragraphs: [
      `Bonjour ${to.name},`,
      `Depuis ${input.since}, le radar a relevé ${input.total} changement${input.total > 1 ? 's' : ''} sur les boutiques que vous surveillez :`,
      ...input.lines.map((line) => `• ${line}`),
      ...(reste > 0 ? [`… et ${reste} autre${reste > 1 ? 's' : ''}, à voir sur le radar.`] : []),
    ],
    action: { label: 'Ouvrir le radar', url: input.url },
    footer:
      'Vous recevez ce résumé parce que vous surveillez au moins une boutique. Il se désactive en un clic depuis l’écran Radar.',
  });
}
