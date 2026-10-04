/**
 * Lecture d'un refus 429 de Google (API Gemini).
 *
 * Google répond 429 « RESOURCE_EXHAUSTED » pour trois situations qui n'appellent pas du tout la
 * même réaction, et le site les confondait toutes en « service très demandé » :
 *  - débit de la minute dépassé : un autre modèle, ou la minute suivante, passent ;
 *  - quota du jour atteint pour ce modèle : un autre modèle peut encore passer ;
 *  - crédits prépayés épuisés ou facturation absente : c'est le PROJET de la clé qui est
 *    bloqué, tous modèles confondus — insister ne sert à rien, seul l'administrateur peut agir ;
 *  - offre gratuite sans droit sur CE modèle (« limit: 0 ») : le refus ne vaut que pour lui,
 *    un modèle voisin peut avoir une franchise gratuite. Mesuré en production le 04/10/2026 :
 *    la rédaction répondait alors que le premier modèle d'image refusait ainsi, et le site
 *    abandonnait toute la chaîne d'images à ce premier refus.
 *
 * Le dernier refus est gardé en mémoire pour la page « État des services » : sans lui, la seule
 * trace d'une clé à court de crédits était un message « très demandé » vu par les clients.
 */

export type GoogleRefusal = 'per_minute' | 'per_day' | 'billing' | 'no_free_tier' | 'unknown';

interface GoogleErrorPayload {
  error?: { status?: string; message?: string; details?: { '@type'?: string; violations?: { quotaId?: string; quotaMetric?: string; quotaValue?: string }[] }[] };
}

export function classifyGoogle429(payload: unknown): GoogleRefusal {
  const error = (payload as GoogleErrorPayload | null)?.error;
  const message = error?.message ?? '';
  if (/prepayment|prepaid|credits? (are|is) depleted|billing account|enable billing/i.test(message)) return 'billing';
  const violations = (error?.details ?? []).flatMap((detail) => (detail['@type']?.endsWith('QuotaFailure') ? (detail.violations ?? []) : []));
  if (violations.some((v) => /free_?tier/i.test(`${v.quotaId} ${v.quotaMetric}`) && v.quotaValue === '0')) return 'no_free_tier';
  if (/limit: 0\b/.test(message)) return 'no_free_tier';
  if (violations.some((v) => /PerDay/i.test(v.quotaId ?? ''))) return 'per_day';
  if (violations.some((v) => /PerMinute/i.test(v.quotaId ?? ''))) return 'per_minute';
  return 'unknown';
}

let lastRefusal: { kind: GoogleRefusal; model: string; at: string; detail: string } | null = null;

export function recordGoogleRefusal(kind: GoogleRefusal, model: string, detail: string): void {
  lastRefusal = { kind, model, at: new Date().toISOString(), detail: detail.slice(0, 200) };
}

/** Dernier refus 429 de Google depuis le démarrage de l'instance, pour l'administration. */
export function lastGoogleRefusal() {
  return lastRefusal;
}
