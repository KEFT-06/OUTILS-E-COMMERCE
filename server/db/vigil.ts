import type { IncomingMessage, ServerResponse } from 'node:http';
import { databaseAnswers, releaseDatabase, renewDatabase } from '@server/db/client';

/**
 * Veille de la connexion à la base, en hébergement sans serveur.
 *
 * Constat du 11/10/2026, en production : une demande à `/api/health` — un simple `select 1` — est
 * restée sans réponse 300 secondes, jusqu'à ce que l'hébergeur la coupe (504), alors que la
 * connexion au site s'était faite en 0,24 s. Le même matin, des écrans sont restés sur
 * « Vérification de votre session… » et des lectures ont rendu une erreur 500. Une sonde l'a
 * reproduit : après trois à cinq minutes de repos, une lecture sur cinq restait sans réponse.
 *
 * L'hébergeur endort une instance entre deux requêtes. Sa connexion à la base, elle, peut mourir
 * pendant ce sommeil sans que rien ne le lui dise : au réveil, la requête part dans le vide et
 * attend une réponse qui ne viendra pas. Avec une seule connexion par instance, tout ce qui
 * arrive ensuite fait la queue derrière elle.
 *
 * La sonde du 11/10 a montré plus que des connexions mortes : après le remplacement d'une
 * connexion pendue, la NEUVE a mis plus de dix secondes à s'ouvrir. Par moments, la base n'en
 * accorde plus — ce qui arrive quand trop d'instances endormies gardent chacune la leur : chaque
 * mise en ligne en laisse derrière elle, et leur nombre est plafonné. D'où la règle de fond :
 *
 *   · AU REPOS (`releaseIfIdle`) : une instance qui n'a plus rien à servir rend sa connexion. Elle
 *     n'emporte rien dans son sommeil — ni place occupée dans la base, ni connexion qui mourra
 *     sans prévenir — et en ouvre une neuve à la requête suivante (quelques dizaines de
 *     millisecondes : la base est dans la même région).
 *
 * Et deux parades, l'une avant de servir, l'autre pendant :
 *
 *   · AU RÉVEIL (`createVigil`) : une instance qui a dormi interroge la base avant de servir, avec
 *     un délai court ; sans réponse, elle abandonne ses connexions et en ouvre de neuves. Le repos
 *     se mesure à l'horloge, pas avec un minuteur — rien ne tourne pendant le sommeil. Tant qu'une
 *     requête est en cours, on ne sonde pas : l'unique connexion peut être prise par un travail
 *     légitime, qu'un délai dépassé ferait couper à tort.
 *
 *   · EN COURS DE ROUTE (`guardQuickRead`) : la première parade n'a pas suffi — après elle, la
 *     sonde a encore vu une lecture rester sans réponse. Une lecture courte (la session, le solde,
 *     l'espace de travail : quelques requêtes en base, aucun service extérieur) qui n'a rien rendu
 *     au bout de huit secondes fait donc remplacer les connexions, quelle que soit la cause. Les
 *     requêtes pendues échouent aussitôt, le navigateur redemande la lecture de lui-même
 *     (src/shared/lib/api.ts), et l'instance est guérie pour tous ceux qui suivent.
 */

/** Ce que la veille a fait avant de servir : rien, une sonde qui a répondu, un remplacement — ou rien à vérifier, la connexion ayant été rendue. */
export type WakeOutcome = 'none' | 'alive' | 'renewed' | 'fresh';

export interface VigilOptions {
  /** Repos au-delà duquel la connexion est vérifiée avant de servir. */
  restMs?: number;
  /** Délai laissé à la base pour répondre. */
  probeMs?: number;
  answers?: (withinMs: number) => Promise<boolean>;
  renew?: () => void;
  /** Repos au bout duquel l'instance rend sa connexion. */
  idleMs?: number;
  release?: () => void;
  /** Travaux encore en cours hors requêtes (arrière-plan) : tant qu'il y en a, rien n'est rendu. */
  otherWork?: () => number;
  now?: () => number;
}

export interface Vigil {
  /** À attendre avant de servir une requête : se résout quand la connexion est sûre. Ne lève jamais. */
  awake(): Promise<WakeOutcome>;
  /** Une requête commence ; la fonction rendue s'appelle quand elle finit. */
  enter(): () => void;
  /** Rend la connexion si plus rien n'est en cours depuis `idleMs`. Vrai si elle vient d'être rendue. */
  releaseIfIdle(): boolean;
}

export function createVigil(options: VigilOptions = {}): Vigil {
  const { restMs = 15_000, probeMs = 2_500, answers = databaseAnswers, renew = renewDatabase, now = Date.now } = options;
  const { idleMs = 1_400, release = releaseDatabase, otherWork = () => 0 } = options;
  /** La connexion a été rendue et rien n'est arrivé depuis : il n'y a rien à sonder. */
  let released = false;
  let busy = 0;
  let quietSince = now();
  let check: Promise<WakeOutcome> | null = null;

  return {
    awake() {
      // Plusieurs requêtes arrivent ensemble au réveil : une seule vérification pour toutes.
      if (check) return check;
      if (released) return Promise.resolve('fresh');
      if (busy > 0 || now() - quietSince < restMs) return Promise.resolve('none');
      check = (async (): Promise<WakeOutcome> => {
        if (await answers(probeMs)) return 'alive';
        console.error('[base] connexion muette au réveil de l’instance : remplacée par une neuve.');
        renew();
        return 'renewed';
      })()
        .catch((): WakeOutcome => 'none')
        .finally(() => {
          check = null;
          quietSince = now();
        });
      return check;
    },
    enter() {
      busy += 1;
      released = false;
      let left = false;
      return () => {
        if (left) return;
        left = true;
        busy -= 1;
        quietSince = now();
      };
    },
    releaseIfIdle() {
      if (released || busy > 0 || check || otherWork() > 0 || now() - quietSince < idleMs) return false;
      released = true;
      release();
      return true;
    },
  };
}

/** Lectures courtes : quelques requêtes en base, jamais d'appel à un service extérieur. */
const QUICK_READS = /^\/api\/(?:(?:auth\/me|health|account\/credits)(?:\?|$)|(?:workspace|credits)\/)/;

export interface QuickReadGuardOptions {
  /** Attente au-delà de laquelle une lecture courte est tenue pour pendue. */
  waitMs?: number;
  /** Délai laissé ensuite à l'application pour répondre d'elle-même, avant de le faire à sa place. */
  graceMs?: number;
  renew?: () => void;
}

export interface QuickReadGuard {
  /** Où en est la requête : dit, si elle reste pendue, à quelle étape. */
  stage(name: 'veille' | 'application'): void;
}

const NO_GUARD: QuickReadGuard = { stage: () => undefined };

/**
 * Garde-fou d'une lecture courte : voir l'en-tête de ce fichier. Sans effet sur toute autre
 * requête — une génération dure légitimement plusieurs minutes.
 */
export function guardQuickRead(
  request: Pick<IncomingMessage, 'method' | 'url'>,
  response: ServerResponse,
  options: QuickReadGuardOptions = {},
): QuickReadGuard {
  if ((request.method ?? 'GET') !== 'GET' || !QUICK_READS.test(request.url ?? '')) return NO_GUARD;
  const { waitMs = 8_000, graceMs = 2_000, renew = renewDatabase } = options;
  // Sans accent : cette étape part dans un en-tête de réponse.
  let stage = 'preparation';
  let grace: NodeJS.Timeout | undefined;

  const wait = setTimeout(() => {
    if (response.headersSent) return;
    console.error(`[base] lecture sans réponse après ${waitMs} ms (étape : ${stage}) : connexions remplacées.`);
    renew();
    // Les requêtes pendues viennent d'échouer : l'application répond d'elle-même. Sinon, on le fait.
    grace = setTimeout(() => {
      if (response.headersSent) return;
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Server-Timing', `base;desc="sans reponse : ${stage}"`);
      response.end(JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Le service est momentanément indisponible.' } }));
    }, graceMs);
  }, waitMs);

  const settle = () => {
    clearTimeout(wait);
    clearTimeout(grace);
  };
  response.once('finish', settle);
  response.once('close', settle);

  return {
    stage(name) {
      stage = name;
    },
  };
}
