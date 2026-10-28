/** Miroir client de `server/services/creatives`. */

export type AwarenessLevel = 'unaware' | 'problem_aware' | 'solution_aware' | 'product_aware' | 'most_aware';

export interface CreativeStatus {
  requestId: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';
  /** Présent quand un fichier est prêt ; il se récupère via le relais du serveur. */
  mediaType?: 'image' | 'video';
  message?: string;
  /** Jours pendant lesquels le fichier reste téléchargeable (vidéo : selon le palier) ; null : gardé sans limite. */
  retentionDays?: number | null;
  /** Vidéo : date jusqu'à laquelle elle reste téléchargeable. */
  availableUntil?: string;
  /** Vidéo : conservation échue, le fichier n'existe plus. */
  expired?: boolean;
  /** Vidéo : durée en secondes. */
  durationSeconds?: number | null;
}
