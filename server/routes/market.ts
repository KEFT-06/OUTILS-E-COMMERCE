import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { cachedBenchmark, nicheBenchmark } from '@server/services/market/benchmark';
import { performanceFor, setPerformanceOptIn } from '@server/services/performanceLoop/collect';

/**
 * Mesures de marché : ce que l'on peut compter sur une niche, par opposition à ce que l'IA en
 * pense. Aucune route ne coûte de point à l'utilisateur — la dépense est côté serveur, chez le
 * fournisseur de collecte, et elle est bornée par un plafond quotidien global.
 *
 * Le cache est mutualisé : la deuxième personne qui demande la même niche ne fait rien payer.
 */

export const marketRouter = Router();

marketRouter.use(requireAuth);

const benchmarkSchema = z.object({
  niche: z.string().trim().min(2, 'Indiquez la niche à mesurer.').max(120),
});

/**
 * Une mesure peut déclencher un relevé payant : limite basse, et le plafond quotidien du serveur
 * reste le garde-fou véritable. Le verbe est POST parce que l'appel peut créer une mesure.
 */
marketRouter.post(
  '/benchmark',
  routeLimiter(10, 20),
  validateBody(benchmarkSchema),
  asyncRoute(async (req, res) => {
    const { niche } = req.body as z.infer<typeof benchmarkSchema>;

    /*
      Le palier décide de la COLLECTE, pas de la lecture. Une mesure déjà en cache est servie à
      tout le monde : elle est mutualisée et ne coûte rien de plus, et la cacher n'apprendrait
      rien à personne. Ce qui se paie chez le fournisseur, c'est un relevé neuf — sans cette
      porte, un compte gratuit viderait la réserve du mois au détriment de ceux qui la financent.
    */
    const peutCollecter = req.auth!.account.features.market_benchmark !== false;
    if (peutCollecter) {
      res.json(await nicheBenchmark(niche));
      return;
    }

    const cache = await cachedBenchmark(niche);
    res.json({ benchmark: cache, origin: cache ? 'cache' : 'plan' });
  }),
);

/**
 * Repère partagé de performance : où se situe le vendeur parmi ceux de sa niche.
 *
 * Lecture pure, aucun point facturé — le calcul porte sur des relevés déjà pris. Le
 * consentement est relu à chaque appel, si bien qu'un retrait prend effet immédiatement.
 */
marketRouter.get(
  '/performance',
  asyncRoute(async (req, res) => {
    res.json(await performanceFor(req.auth!.account.user.id));
  }),
);

const optInSchema = z.object({ enabled: z.boolean() });

/**
 * Accepter ou retirer sa participation.
 *
 * Le retrait EFFACE les relevés déjà versés : on ne garde pas des chiffres d'affaires que
 * leur propriétaire a repris. C'est aussi pourquoi le verbe est POST et non GET.
 */
marketRouter.post(
  '/performance/opt-in',
  routeLimiter(10, 20),
  validateBody(optInSchema),
  asyncRoute(async (req, res) => {
    const { enabled } = req.body as z.infer<typeof optInSchema>;
    await setPerformanceOptIn(req.auth!.account.user.id, enabled);
    res.json(await performanceFor(req.auth!.account.user.id));
  }),
);
