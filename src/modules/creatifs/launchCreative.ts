import { apiRequest } from '@/shared/lib/api';
import { readApiError } from '@/shared/lib/apiError';
import type { CreativeStatus } from '@/shared/types/creatives';

/**
 * Lancement d'un créatif, qui aboutit même quand la réponse du serveur se perd en route.
 *
 * Un visuel se rend dans UNE demande d'une trentaine de secondes ; une vidéo se dépose en
 * quelques secondes. Sur une connexion instable, la réponse peut ne jamais arriver alors que le
 * serveur a tout fait : le visuel est enregistré et payé, la vidéo est lancée et payée — et
 * l'écran affichait « serveur injoignable ». Le propriétaire le décrit ainsi : « je crée des
 * visuels, mais quand je vais dans Mes visuels je ne les vois pas » (06/10/2026).
 *
 * Pendant l'attente, on regarde donc si le créatif est arrivé sur le compte. S'il y est, c'est
 * lui le résultat, que la réponse soit revenue ou non.
 */

interface Listed {
  requestId: string;
}

/** Cadence du coup d'œil au compte pendant l'attente. */
const WATCH_MS = 10_000;
/** Après une coupure, temps laissé au serveur pour finir avant de conclure à l'échec. */
const GRACE_MS = 90_000;

const LISTS = {
  visual: { post: '/api/creatives/visuals', list: '/api/creatives/visuals?page=1', key: 'visuals' as const },
  video: { post: '/api/creatives/videos', list: '/api/creatives/videos', key: 'videos' as const },
};

const listed = async (kind: 'visual' | 'video'): Promise<Listed[] | null> => {
  try {
    const page = await apiRequest<Record<string, Listed[]>>(LISTS[kind].list);
    return page[LISTS[kind].key] ?? [];
  } catch {
    return null;
  }
};

export async function launchCreative(kind: 'visual' | 'video', body: unknown): Promise<CreativeStatus> {
  const before = new Set((await listed(kind))?.map((entry) => entry.requestId) ?? []);

  return new Promise<CreativeStatus>((resolve, reject) => {
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(watcher);
      clearTimeout(grace);
      outcome();
    };

    // Le créatif est-il arrivé sur le compte pendant qu'on attendait la réponse ?
    const watcher = setInterval(() => {
      void listed(kind).then((entries) => {
        const fresh = entries?.find((entry) => !before.has(entry.requestId));
        if (!fresh) return;
        finish(() =>
          resolve(
            kind === 'visual'
              ? { requestId: fresh.requestId, status: 'completed', mediaType: 'image', retentionDays: null }
              : { requestId: fresh.requestId, status: 'in_progress' },
          ),
        );
      });
    }, WATCH_MS);

    fetch(LISTS[kind].post, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (submitted) => {
        if (settled) return;
        // Le serveur a répondu : son verdict fait foi, refus compris (points rendus par lui).
        if (!submitted.ok) {
          const refusal = await readApiError(submitted, 'La demande n’a pas abouti.');
          finish(() => reject(refusal));
          return;
        }
        const status = (await submitted.json()) as CreativeStatus;
        finish(() => resolve(status));
      })
      .catch((error: unknown) => {
        if (settled) return;
        // Connexion coupée : le serveur travaille peut-être encore. Le coup d'œil au compte continue un moment.
        grace = setTimeout(() => finish(() => reject(error instanceof Error ? error : new Error('Connexion interrompue.'))), GRACE_MS);
      });
  });
}
