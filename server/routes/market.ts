import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, routeLimiter, validateBody } from '@server/middleware';
import { requireAuth } from '@server/middleware/auth';
import { nicheBenchmark } from '@server/services/market/benchmark';

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
    res.json(await nicheBenchmark(niche));
  }),
);
