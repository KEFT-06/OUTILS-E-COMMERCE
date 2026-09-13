/**
 * Moteur de score d'intensité concurrentielle — module 1 du cahier des charges.
 *
 * Différenciateur n°1 : la méthode est publique et chaque score produit le détail
 * de son calcul. Le concurrent direct est reproché d'avoir un scoring opaque ;
 * reproduire cela ici viderait le produit de sa promesse.
 *
 * Règle non négociable (CdC §6.1) : le score est persisté AVEC sa version de
 * méthodologie. Un score recalculé à l'affichage avec des poids qui ont changé
 * depuis n'est pas traçable — il est faux.
 */

export const METHODOLOGY_VERSION = '1.0.0';

export type RateLevel = 'Faible' | 'Moyen' | 'Élevé' | 'Très élevé';

/** Signaux bruts issus de l'agent SCOUT. Aucun n'est estimé ni extrapolé. */
export interface RawSignals {
  /** Nombre d'annonceurs distincts diffusant sur la niche et le marché. */
  uniqueAdvertisers: number;
  /** Nombre de publicités actives au moment de la collecte. */
  activeAds: number;
  /** Durée de vie moyenne des publicités, en jours. */
  averageLifetimeDays: number;
  /** Nombre de publicités diffusées depuis plus de 14 jours. */
  establishedAds: number;
}

export interface CriterionBreakdown {
  key: string;
  label: string;
  /** Poids en pourcentage. La somme des quatre fait exactement 100. */
  weight: number;
  /** Valeur brute mesurée, telle que collectée. */
  rawValue: number;
  /** Seuil au-delà duquel le critère est considéré « élevé » (CdC §6.1). */
  highThreshold: number;
  /** Valeur normalisée sur 0–100. */
  normalized: number;
  /** Contribution au score final : normalized × weight / 100. */
  contribution: number;
  /**
   * Unité d'affichage de `rawValue` et `highThreshold` : '' ou ' %'.
   * Exposée pour que le client n'ait pas à redeviner quels critères sont des
   * pourcentages — une règle dupliquée est une règle qui divergera.
   */
  unit: string;
  /** Phrase lisible expliquant le calcul, affichée dans le panneau de détail. */
  explanation: string;
}

export interface ScoreResult {
  score: number;
  level: RateLevel;
  methodologyVersion: string;
  measuredAt: string;
  breakdown: CriterionBreakdown[];
  /** Volume d'échantillon — sans lui, un score n'est pas interprétable. */
  sampleSize: number;
}

/**
 * Pondérations du cahier des charges, §6.1.
 * À déplacer en table de configuration versionnée (server/config/) dès que le
 * moteur de mise à jour continue sera en place — CdC §6.1.3.
 */
export const CRITERIA = [
  {
    key: 'uniqueAdvertisers',
    label: 'Annonceurs uniques',
    weight: 30,
    highThreshold: 50,
  },
  {
    key: 'activeAds',
    label: 'Publicités actives',
    weight: 25,
    highThreshold: 200,
  },
  {
    key: 'averageLifetimeDays',
    label: 'Durée de vie moyenne',
    weight: 25,
    highThreshold: 21,
  },
  {
    key: 'establishedAds',
    label: 'Publicités établies (> 14 j)',
    weight: 20,
    highThreshold: 40, // exprimé en % du total, cf. normalisation ci-dessous
  },
] as const;

/**
 * Normalisation : le seuil « élevé » vaut 75/100, pas 100. Atteindre le seuil
 * signifie « marché nettement actif », pas « saturation maximale » — laisser
 * de la marge au-dessus évite d'écraser toutes les niches fortes sur 100.
 */
function normalize(value: number, threshold: number): number {
  if (threshold <= 0) return 0;
  const ratio = value / threshold;
  const scaled = ratio <= 1 ? ratio * 75 : 75 + Math.min(25, (ratio - 1) * 25);
  return Math.round(Math.max(0, Math.min(100, scaled)));
}

function toLevel(score: number): RateLevel {
  if (score >= 75) return 'Très élevé';
  if (score >= 50) return 'Élevé';
  if (score >= 25) return 'Moyen';
  return 'Faible';
}

/**
 * Calcule le score d'intensité concurrentielle et son détail complet.
 *
 * @throws si un signal est négatif — une valeur négative signale un défaut
 *         d'ingestion, et produire un score dessus le masquerait.
 */
export function computeCompetitiveScore(signals: RawSignals, measuredAt = new Date()): ScoreResult {
  for (const [key, value] of Object.entries(signals)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Signal invalide pour « ${key} » : ${value}`);
    }
  }

  // Les publicités établies sont pondérées en part du total, pas en valeur absolue.
  const establishedPct =
    signals.activeAds > 0 ? (signals.establishedAds / signals.activeAds) * 100 : 0;

  const rawValues: Record<string, number> = {
    uniqueAdvertisers: signals.uniqueAdvertisers,
    activeAds: signals.activeAds,
    averageLifetimeDays: signals.averageLifetimeDays,
    establishedAds: Math.round(establishedPct * 10) / 10,
  };

  const breakdown: CriterionBreakdown[] = CRITERIA.map((criterion) => {
    const rawValue = rawValues[criterion.key] ?? 0;
    const normalized = normalize(rawValue, criterion.highThreshold);
    const contribution = Math.round((normalized * criterion.weight) / 100);
    const unit = criterion.key === 'establishedAds' ? ' %' : '';

    return {
      key: criterion.key,
      label: criterion.label,
      weight: criterion.weight,
      rawValue,
      highThreshold: criterion.highThreshold,
      normalized,
      contribution,
      unit,
      explanation:
        `${rawValue}${unit} mesuré pour un seuil « élevé » de ${criterion.highThreshold}${unit}. ` +
        `Normalisé à ${normalized}/100, pondéré à ${criterion.weight} % ` +
        `→ ${contribution} points sur le score final.`,
    };
  });

  const score = Math.min(100, breakdown.reduce((sum, c) => sum + c.contribution, 0));

  return {
    score,
    level: toLevel(score),
    methodologyVersion: METHODOLOGY_VERSION,
    measuredAt: measuredAt.toISOString(),
    breakdown,
    sampleSize: signals.activeAds,
  };
}

/**
 * Rendu texte de la méthodologie, servi tel quel par GET /api/scoring/methodology.
 * L'utilisateur doit pouvoir lire la règle sans ouvrir le code.
 */
export function describeMethodology() {
  return {
    version: METHODOLOGY_VERSION,
    criteria: CRITERIA.map((c) => ({ ...c })),
    normalization:
      'Chaque critère est normalisé sur 0–100. Atteindre le seuil « élevé » vaut 75 points ; ' +
      'au-delà, la progression est ralentie pour éviter la saturation à 100.',
    levels: [
      { from: 75, to: 100, label: 'Très élevé' },
      { from: 50, to: 74, label: 'Élevé' },
      { from: 25, to: 49, label: 'Moyen' },
      { from: 0, to: 24, label: 'Faible' },
    ],
    disclaimer:
      'Smart Creator fournit des analyses basées sur des données publiques. ' +
      'Aucun résultat financier n’est garanti.',
  };
}
