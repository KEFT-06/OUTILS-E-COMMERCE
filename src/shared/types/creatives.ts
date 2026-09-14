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
}
