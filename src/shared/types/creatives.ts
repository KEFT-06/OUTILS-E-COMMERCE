/** Miroir client de `server/services/creatives`. */

export type AwarenessLevel = 'unaware' | 'problem_aware' | 'solution_aware' | 'product_aware' | 'most_aware';

export type CreativeFormat = '1:1' | '9:16' | '16:9';

export type CreativeKind = 'visual' | 'video';

export interface CreativeStatus {
  requestId: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';
  /** Présent quand un fichier est prêt ; il se récupère via le relais du serveur. */
  mediaType?: 'image' | 'video';
  message?: string;
  /** Jours pendant lesquels le fichier reste récupérable chez le fournisseur ; null : gardé sans limite. */
  retentionDays?: number | null;
  /** Vidéo Veo : durée totale en secondes. */
  durationSeconds?: number | null;
  /** Vidéo longue (720p) prolongeable de 7 s maintenant. */
  extendable?: boolean;
  /** Durée maximale atteignable par prolongations (148 s). */
  maxDurationSeconds?: number;
}
