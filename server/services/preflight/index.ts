import { AppError } from '@server/middleware';
import { type ServiceCheck, cachedServicesReport } from '@server/services/admin/services';

/**
 * Contrôle avant lancement.
 *
 * Une génération qui part alors qu'un service est en panne fait perdre du temps à
 * l'utilisateur, et il faut ensuite lui rendre ses points. Quand l'état d'un service est
 * déjà connu — la supervision le relève régulièrement —, autant refuser tout de suite,
 * avant le moindre débit, avec un message qui dit ce qui manque.
 *
 * Le contrôle ne déclenche jamais d'appel réseau : il lit ce que la supervision a
 * constaté récemment. Sans relevé récent, il laisse passer — mieux vaut tenter une
 * génération que bloquer sur une information qu'on n'a pas.
 */

/** Ce dont une action a besoin, nommé par la capacité et non par le fournisseur. */
export type Capability = 'writing' | 'webSearch' | 'images' | 'video' | 'layout' | 'database';

/** Services de la supervision qui portent chaque capacité. */
const SERVICES_OF: Record<Capability, string[]> = {
  writing: ['gemini'],
  webSearch: ['perplexity'],
  images: ['gemini-images'],
  video: ['higgsfield'],
  layout: ['gamma'],
  database: ['database'],
};

const LABEL_OF: Record<Capability, string> = {
  writing: 'la rédaction par IA',
  webSearch: 'l’étude de marché sur le web',
  images: 'la création d’images',
  video: 'la création de vidéos',
  layout: 'la mise en page illustrée',
  database: 'l’enregistrement de vos travaux',
};

/** Un relevé plus ancien ne dit plus rien de l'état présent. */
const FRESH_MS = 5 * 60_000;

function brokenAmong(checks: ServiceCheck[], capability: Capability): ServiceCheck | null {
  const ids = SERVICES_OF[capability];
  return checks.find((check) => ids.includes(check.id) && check.state === 'error') ?? null;
}

/**
 * Refuse l'action si l'une des capacités demandées est connue en panne. À appeler avant
 * toute réservation de points : le message dit alors qu'aucun point n'a été retiré.
 */
export function ensureReady(capabilities: Capability[]): void {
  const report = cachedServicesReport(FRESH_MS);
  if (!report) return;

  for (const capability of capabilities) {
    const broken = brokenAmong(report.services, capability);
    if (broken) {
      console.error(`[avant lancement] ${capability} indisponible :`, broken.detail);
      throw new AppError(
        503,
        `${LABEL_OF[capability][0]!.toUpperCase()}${LABEL_OF[capability].slice(1)} est momentanément indisponible : l’administrateur en a été informé. Aucun point n’a été retiré.`,
        'CAPABILITY_UNAVAILABLE',
        { capability },
      );
    }
  }
}
