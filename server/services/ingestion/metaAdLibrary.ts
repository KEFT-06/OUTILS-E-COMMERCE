import { env, providers } from '@server/env';
import {
  AdIngestionAdapter,
  IngestedAd,
  IngestionQuery,
  IngestionResult,
  deriveSignals,
} from '@server/services/ingestion/types';

/**
 * Adaptateur Meta Ad Library — source de référence du module 1.
 *
 * ⚠️ Cet adaptateur est **écrit mais non vérifié contre l'API réelle** : son
 * activation exige un jeton d'accès délivré après App Review et Business
 * Verification (CdC §6.11.5). Le mapping des champs ci-dessous suit la
 * documentation publique de l'endpoint `ads_archive` et devra être confronté à
 * une réponse réelle avant toute mise en production.
 *
 * Le reste de l'application n'en dépend pas : il ne connaît que l'interface
 * `AdIngestionAdapter`.
 */

const API_VERSION = 'v21.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}/ads_archive`;

/** Forme des enregistrements renvoyés par `ads_archive`, réduite à l'utile. */
interface MetaAdRecord {
  id?: string;
  page_id?: string;
  page_name?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_creative_bodies?: string[];
  ad_snapshot_url?: string;
}

function toIngestedAd(record: MetaAdRecord, market: string): IngestedAd | null {
  // Sans identifiant, sans annonceur ou sans date de début, la publicité ne peut
  // contribuer à aucun des quatre critères : la retenir fausserait les comptes.
  if (!record.id || !record.page_id || !record.ad_delivery_start_time) return null;

  return {
    externalId: record.id,
    advertiserId: record.page_id,
    advertiserName: record.page_name ?? 'Annonceur inconnu',
    startedAt: new Date(record.ad_delivery_start_time).toISOString(),
    ...(record.ad_delivery_stop_time
      ? { endedAt: new Date(record.ad_delivery_stop_time).toISOString() }
      : {}),
    market,
    ...(record.ad_creative_bodies?.[0] ? { creativeBody: record.ad_creative_bodies[0] } : {}),
    ...(record.ad_snapshot_url ? { landingPageUrl: record.ad_snapshot_url } : {}),
  };
}

export const metaAdLibraryAdapter: AdIngestionAdapter = {
  id: 'meta',
  label: 'Meta Ad Library',

  isAvailable() {
    if (!providers.meta) {
      return {
        available: false,
        reason:
          "L'accès à la Meta Ad Library n'est pas configuré. Il requiert un jeton délivré après App Review et Business Verification (CdC §6.11.5).",
      };
    }
    return { available: true };
  },

  async fetchAds(query: IngestionQuery): Promise<IngestionResult> {
    const availability = this.isAvailable();
    if (!availability.available) throw new Error(availability.reason);

    const market = query.market ?? 'CI';
    const params = new URLSearchParams({
      access_token: env.META_ACCESS_TOKEN ?? '',
      search_terms: query.niche,
      ad_reached_countries: `["${market}"]`,
      ad_active_status: 'ALL',
      limit: String(Math.min(query.limit ?? 200, 500)),
      fields: [
        'id',
        'page_id',
        'page_name',
        'ad_delivery_start_time',
        'ad_delivery_stop_time',
        'ad_creative_bodies',
        'ad_snapshot_url',
      ].join(','),
    });

    const response = await fetch(`${BASE_URL}?${params.toString()}`);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Meta Ad Library a répondu ${response.status}. ${body.slice(0, 300)}`);
    }

    const payload = (await response.json()) as { data?: MetaAdRecord[] };
    const collectedAt = new Date();

    const ads = (payload.data ?? [])
      .map((record) => toIngestedAd(record, market))
      .filter((ad): ad is IngestedAd => ad !== null);

    return {
      ads,
      signals: deriveSignals(ads, collectedAt),
      sourceLabel: 'Meta Ad Library',
      collectedAt: collectedAt.toISOString(),
      isDemonstration: false,
      sourceUrl: 'https://www.facebook.com/ads/library/',
    };
  },
};
