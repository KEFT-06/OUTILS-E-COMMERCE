import { DataProvenance } from '@/shared/types/provenance';
import { ScoreCriterion, ScoreLevel } from '@/shared/types/scoring';

/** Miroir client de `server/services/ingestion` et de `POST /api/ingestion/scan`. */

export interface GalleryAd {
  externalId: string;
  advertiserName: string;
  advertiserId: string;
  /** ISO 8601. */
  startedAt: string;
  /** ISO 8601. Absent ⇒ active à la collecte. */
  endedAt?: string;
  market: string;
  creativeBody?: string;
  /** Lien fourni par la source externe : ne jamais l'injecter sans `safeHttpUrl`. */
  landingPageUrl?: string;
  /**
   * Calculés par le serveur avec la fonction qui alimente le score. Le client
   * les affiche sans les recalculer, pour que galerie et score ne divergent pas.
   */
  lifetimeDays: number;
  isActive: boolean;
  isEstablished: boolean;
}

export interface IngestionSignals {
  uniqueAdvertisers: number;
  activeAds: number;
  averageLifetimeDays: number;
  establishedAds: number;
}

export interface IngestionScore {
  score: number;
  level: ScoreLevel;
  methodologyVersion: string;
  measuredAt: string;
  breakdown: ScoreCriterion[];
  sampleSize: number;
}

export interface IngestionScanResponse {
  score: IngestionScore;
  signals: IngestionSignals;
  ads: GalleryAd[];
  /** true ⇒ la galerie n'affiche qu'une partie de l'échantillon ayant servi au score. */
  adsTruncated: boolean;
  provenance: DataProvenance;
  advertiserCount: number;
}
