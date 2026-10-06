import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { toApiError } from '@/shared/lib/apiError';
import { type EbookJob, type EbookResult, type EbookStart, ebookApi } from '@/shared/lib/writing';

/**
 * Suivi d'une rédaction menée sur le serveur, pour le produit affiché.
 *
 * Un seul suivi pour les deux rédactions du Studio — le contenu des modules (« Génératif ») et
 * l'ebook long : toutes deux s'écrivent par tranches sur le serveur, enregistrées à mesure.
 * Quitter l'écran n'interrompt rien ; au retour, le suivi reprend la rédaction en cours et
 * verse le texte au brouillon quand elle se termine — ou tout de suite, si elle s'est terminée
 * pendant l'absence. Le serveur retient qu'un texte a été versé : il n'est jamais proposé deux
 * fois, et jamais oublié.
 */

/** Cadence du suivi. C'est aussi lui qui relance la tranche suivante côté serveur. */
const POLL_MS = 4_000;

export function useEbookJob({ productId, onWritten }: { productId: string; onWritten: (result: EbookResult) => void }) {
  const { runWithCredits } = useCreditGate();
  const [job, setJob] = useState<EbookJob | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Évite de verser deux fois le même texte si deux suivis se croisent à la fin.
  const collected = useRef<string | null>(null);
  // Le dernier `onWritten` connu : le suivi ne repart pas de zéro à chaque rendu de l'écran.
  const deliver = useRef(onWritten);
  useEffect(() => {
    deliver.current = onWritten;
  }, [onWritten]);

  const collect = useCallback(async (finished: EbookJob) => {
    if (collected.current === finished.id) return;
    collected.current = finished.id;
    try {
      deliver.current(await ebookApi.result(finished.id));
      // Versé : le serveur peut l'oublier. Si cet accusé se perd, le texte sera reproposé — jamais perdu.
      void ebookApi.delivered(finished.id).catch(() => undefined);
    } catch (error) {
      // Le texte est sur le compte : le suivi le reprendra au prochain passage sur cet écran.
      collected.current = null;
      toast.error('Le texte rédigé n’a pas pu être récupéré', { description: toApiError(error, 'Rouvrez ce produit : il vous attend.').message });
    } finally {
      setJob(null);
    }
  }, []);

  // Rédaction lancée avant un rechargement de la page, ou depuis un autre appareil : le suivi
  // reprend tout seul. Terminée pendant l'absence : son texte est versé au brouillon dès le retour.
  useEffect(() => {
    let cancelled = false;
    setJob(null);
    void ebookApi
      .pending(productId)
      .then(({ job: waiting }) => {
        if (cancelled || !waiting) return;
        if (waiting.status === 'completed') void collect(waiting);
        else setJob(waiting);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [productId, collect]);

  // Suivi : chaque passage affiche l'avancement et fait repartir le serveur sur la suite.
  const followedId = job && job.status !== 'completed' && job.status !== 'failed' ? job.id : null;
  useEffect(() => {
    if (!followedId) return;
    let cancelled = false;

    const timer = setInterval(() => {
      void ebookApi
        .follow(followedId)
        .then((response) => {
          if (cancelled) return;
          const next = response.job;
          if (next.status === 'completed') {
            clearInterval(timer);
            void collect(next);
            return;
          }
          if (next.status === 'failed') {
            clearInterval(timer);
            setJob(null);
            toast.error('La rédaction n’a pas abouti', { description: next.error?.message ?? 'Vos points ont été rendus.', duration: 12_000 });
            return;
          }
          setJob(next);
        })
        .catch(() => {
          // Coupure passagère : la rédaction continue sur le serveur, le suivi réessaie.
        });
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [followedId, collect]);

  /** Lance une rédaction, derrière l'annonce de son coût. `units` : pages, pour un ouvrage facturé à la page. */
  const start = async (action: 'product_generation' | 'ebook_longform', body: EbookStart, units?: number): Promise<void> => {
    setIsStarting(true);
    try {
      const response = await runWithCredits(action, () => ebookApi.start(body), units);
      if (!response) return;
      /*
        Une autre rédaction occupe déjà le compte : le serveur la renvoie au lieu d'en ouvrir une
        seconde, sans rien débiter. La suivre ici verserait le texte d'un AUTRE produit dans
        celui-ci.
      */
      if (response.job.productId !== productId) {
        toast.info('Une rédaction est déjà en cours', {
          description: `« ${response.job.title} » se termine d’abord : relancez celle-ci juste après. Aucun point n’a été retiré.`,
          duration: 10_000,
        });
        return;
      }
      collected.current = null;
      setJob(response.job);
    } catch (error) {
      toast.error('La rédaction n’a pas pu être lancée', { description: toApiError(error, 'Aucun point n’a été retiré.').message });
    } finally {
      setIsStarting(false);
    }
  };

  /**
   * Sortie de secours : une rédaction occupe le compte plusieurs minutes. Sans elle, il fallait
   * attendre la fin d'un texte dont on ne voulait plus. Points rendus.
   */
  const cancel = async (): Promise<void> => {
    if (!job) return;
    try {
      await ebookApi.cancel(job.id);
      setJob(null);
      toast.success('Rédaction annulée', { description: 'Vos points ont été rendus.' });
    } catch (error) {
      toast.error('L’annulation a échoué', { description: toApiError(error, 'La rédaction continue.').message });
    }
  };

  return { job, isStarting, isRunning: followedId !== null, start, cancel };
}

export type EbookJobFollow = ReturnType<typeof useEbookJob>;
