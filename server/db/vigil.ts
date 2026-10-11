import { databaseAnswers, renewDatabase } from '@server/db/client';

/**
 * Réveil d'une instance sans serveur : sa connexion à la base est-elle encore vivante ?
 *
 * Constat du 11/10/2026, en production : une demande à `/api/health` — un simple `select 1` — est
 * restée sans réponse 300 secondes, jusqu'à ce que l'hébergeur la coupe (504), alors que la
 * connexion au site s'était faite en 0,24 s. Le même matin, des écrans sont restés sur
 * « Vérification de votre session… » et deux lectures ont rendu une erreur 500.
 *
 * L'hébergeur endort une instance entre deux requêtes. Sa connexion à la base, elle, peut mourir
 * pendant ce sommeil sans que rien ne le lui dise : au réveil, la requête part dans le vide et
 * attend une réponse qui ne viendra pas. Avec une seule connexion par instance, tout ce qui
 * arrive ensuite fait la queue derrière elle.
 *
 * La parade : une instance qui a dormi interroge la base avant de servir, avec un délai court ;
 * sans réponse, elle abandonne ses connexions et en ouvre de neuves. Le repos se mesure à
 * l'horloge, pas avec un minuteur — rien ne tourne pendant le sommeil. Et tant qu'une requête
 * est en cours, on ne sonde pas : l'unique connexion peut être prise par un travail légitime,
 * qu'un délai dépassé ferait couper à tort.
 */

export interface VigilOptions {
  /** Repos au-delà duquel la connexion est vérifiée avant de servir. */
  restMs?: number;
  /** Délai laissé à la base pour répondre. */
  probeMs?: number;
  answers?: (withinMs: number) => Promise<boolean>;
  renew?: () => void;
  now?: () => number;
}

export interface Vigil {
  /** À attendre avant de servir une requête : se résout quand la connexion est sûre. Ne lève jamais. */
  awake(): Promise<void>;
  /** Une requête commence ; la fonction rendue s'appelle quand elle finit. */
  enter(): () => void;
}

export function createVigil(options: VigilOptions = {}): Vigil {
  const { restMs = 15_000, probeMs = 2_500, answers = databaseAnswers, renew = renewDatabase, now = Date.now } = options;
  let busy = 0;
  let quietSince = now();
  let check: Promise<void> | null = null;

  return {
    awake() {
      // Plusieurs requêtes arrivent ensemble au réveil : une seule vérification pour toutes.
      if (check) return check;
      if (busy > 0 || now() - quietSince < restMs) return Promise.resolve();
      check = (async () => {
        if (await answers(probeMs)) return;
        console.error('[base] connexion muette au réveil de l’instance : remplacée par une neuve.');
        renew();
      })()
        .catch(() => undefined)
        .finally(() => {
          check = null;
          quietSince = now();
        });
      return check;
    },
    enter() {
      busy += 1;
      let left = false;
      return () => {
        if (left) return;
        left = true;
        busy -= 1;
        quietSince = now();
      };
    },
  };
}
