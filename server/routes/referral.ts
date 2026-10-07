import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { REFERRAL_PAYOUT_METHODS } from '@server/db/schema';
import { env, isProd } from '@server/env';
import { readCookie } from '@server/lib/cookies';
import { asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { normalizeCode, recordReferralVisit, referralCodeExists, referralDashboard, requestPayout } from '@server/services/referral';

/**
 * Parrainage — le lien suivi, le tableau du parrain et ses demandes de retrait.
 * Le traitement des retraits par l'équipe est dans les routes d'administration.
 */

export const referralRouter = Router();

/** Cookie du lien suivi. Illisible par la page ; SameSite=Lax : il doit survivre à l'arrivée depuis un autre site. */
export const REFERRAL_COOKIE = 'sc_ref';

const cookieOptions = () => ({ httpOnly: true, secure: isProd, sameSite: 'lax' as const, path: '/', maxAge: env.REFERRAL_COOKIE_DAYS * 86_400_000 });

/** Code du parrain suivi par ce navigateur, s'il y en a un. */
export const referralCodeOf = (req: Request): string | null => normalizeCode(readCookie(req, REFERRAL_COOKIE));

export function clearReferralCookie(res: Response): void {
  res.clearCookie(REFERRAL_COOKIE, { path: '/' });
}

/**
 * Visite arrivée par un lien de parrainage.
 *
 * DEUX TEMPS, ET C'EST VOULU. Le cookie du lien suivi n'est pas nécessaire au fonctionnement du
 * site pour le visiteur : il sert à créditer quelqu'un d'autre. Il ne se dépose donc pas d'office.
 *   · sans `remember` : la visite est comptée, rien n'est déposé ;
 *   · avec `remember` : le visiteur a accepté qu'on retienne le parrainage — le cookie est posé,
 *     pour REFERRAL_COOKIE_DAYS jours. Dernier clic : il remplace celui d'un lien précédent.
 * Sans accord, le rattachement reste possible si l'inscription a lieu pendant la même visite :
 * le code voyage alors avec la demande d'inscription, sans rien écrire sur l'appareil.
 *
 * Un code inconnu ne lève pas d'erreur : le visiteur n'a rien à voir d'un lien mal recopié.
 */
referralRouter.post(
  '/visit',
  routeLimiter(10, 30),
  validateBody(z.object({ code: z.string().trim().max(24), remember: z.boolean().default(false) })),
  asyncRoute(async (req, res) => {
    const body = req.body as { code: string; remember: boolean };
    const code = normalizeCode(body.code);
    if (!code) {
      res.json({ followed: false });
      return;
    }
    if (body.remember) {
      const known = await referralCodeExists(code);
      if (known) res.cookie(REFERRAL_COOKIE, code, cookieOptions());
      res.json({ followed: known, remembered: known });
      return;
    }
    // Ce navigateur a déjà fait retenir ce lien : la visite n'est pas comptée une seconde fois.
    if (referralCodeOf(req) === code) {
      res.json({ followed: true });
      return;
    }
    res.json({ followed: (await recordReferralVisit(code)) !== null });
  }),
);

/** Tableau du parrain : son lien, ses visites, ses filleuls, ses commissions et ses retraits. */
referralRouter.get(
  '/',
  requireAuth,
  asyncRoute(async (req, res) => {
    const dashboard = await referralDashboard(req.auth!.account.user.id);
    const base = env.APP_URL.replace(/\/+$/, '');
    res.json({ ...dashboard, link: `${base}/r/${dashboard.code}`, altLink: `${base}/?ref=${dashboard.code}` });
  }),
);

const payoutSchema = z.object({
  method: z.enum(REFERRAL_PAYOUT_METHODS),
  /** Numéro Mobile Money, IBAN ou adresse de portefeuille. */
  destination: z.string().trim().min(6, 'Indiquez où recevoir le versement.').max(120),
  holderName: z.string().trim().min(2, 'Indiquez le nom du titulaire.').max(120),
});

referralRouter.post(
  '/payouts',
  requireAuth,
  routeLimiter(60, 6),
  validateBody(payoutSchema),
  asyncRoute(async (req, res) => {
    const payout = await requestPayout(req.auth!.account.user.id, req.body as z.infer<typeof payoutSchema>);
    res.status(201).json(payout);
  }),
);
