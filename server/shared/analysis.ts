import type { ReportDataProvenance } from '@server/shared/provenance';
import type { ScoreTrace } from '@server/shared/scoring';

/**
 * Rapport d'analyse d'une niche, produit et conservé par le serveur, affiché et
 * exporté par le navigateur. Types seulement.
 *
 * Deux natures de contenu, jamais confondues :
 *  - les faits de marché (concurrents, prix constatés, niveaux des taux) viennent
 *    d'une source : collecte publicitaire mesurée, ou page web numérotée et citée ;
 *  - les propositions (produits, scripts, plan d'action) sont rédigées par l'IA,
 *    présentées comme telles et sans chiffre inventé.
 */

export type TauxLevel = 'Faible' | 'Moyen' | 'Élevé' | 'Très élevé';

/**
 * measured : calculé par le moteur de scoring sur une collecte ;
 * assessment : appréciation qualitative de l'IA, fondée sur les sources citées ;
 * unavailable : non évalué, faute de mesure ou de source.
 */
export type RateBasis = 'measured' | 'assessment' | 'unavailable';

export interface MarketRate {
  key: 'demand' | 'saturation' | 'profitability' | 'opportunity' | 'virality';
  label: string;
  /** null : non évalué. */
  level: TauxLevel | null;
  /** Score sur 100, seulement quand le moteur de scoring l'a calculé. */
  score: number | null;
  description: string;
  trend: 'up' | 'stable' | 'down' | null;
  /** Absent sur les rapports antérieurs à septembre 2026. */
  basis?: RateBasis;
  /** Numéros des sources web qui fondent l'appréciation. */
  sourceIds?: number[];
  /**
   * Trace de calcul persistée. Absente tant que la méthodologie du taux n'est
   * pas publiée : dans ce cas le panneau de détail le dit, plutôt que d'inventer
   * une ventilation.
   */
  trace?: ScoreTrace;
}

export interface SearchTrendKeyword {
  keyword: string;
  /** null : aucune source de volumes de recherche n'est branchée. */
  volume: string | null;
  growthRate: string | null;
  growthType: 'explosive' | 'steady' | 'niche' | null;
  intent: 'commercial' | 'informational' | 'transactional';
}

export interface CompetitorInsight {
  id: string;
  name: string;
  urlOrHandle: string;
  priceRange: string;
  positioning: string;
  strengths: string[];
  weaknesses: string[];
  exploitableGaps: string[];
  /** Sources qui établissent l'existence et la description du concurrent. */
  sourceIds?: number[];
}

/** Produit créé hors d'une analyse de niche : tiré d'une vidéo, ou saisi à la main. */
export type ProductOrigin = { kind: 'video'; label: string; url?: string } | { kind: 'manual' };

export interface DigitalProductIdea {
  id: string;
  /** Absent : produit proposé par une analyse de niche. */
  origin?: ProductOrigin;
  title: string;
  subtitle: string;
  type: 'ebook' | 'template' | 'masterclass' | 'bundle' | 'micro_tool';
  typeName: string;
  /** null : aucun prix n'est avancé sans source ; l'auteur fixe le sien. */
  recommendedPrice: number | null;
  currency: string;
  /** null : non estimé. */
  estimatedProductionDays: number | null;
  /** null : non estimée. */
  estimatedMarginPercent: number | null;
  /** Repères de prix tirés des sources, ou raison de leur absence. */
  pricingNote?: string;
  targetAudience: string;
  transformationPromise: string;
  tableOfContents: {
    moduleNumber: number;
    title: string;
    details: string;
  }[];
  leadMagnet: {
    title: string;
    format: string;
    hook: string;
  };
  imageUrl: string;
}

export interface MetaAdScene {
  sceneNumber: number;
  timing: string;
  phase: 'Attention' | 'Intérêt' | 'Désir' | 'Action' | 'Problème' | 'Agitation' | 'Solution' | 'Avant' | 'Après' | 'Pont';
  visualDescription: string;
  onScreenText: string;
  spokenVoiceover: string;
  soundAndVibe: string;
}

export interface MetaComplianceItem {
  rule: string;
  compliant: boolean;
  explanation: string;
}

export interface MetaAdCampaign {
  id: string;
  framework: 'AIDA' | 'PAS' | 'BAB' | 'UGC';
  frameworkFullName: string;
  targetProductTitle: string;
  hookHeadline: string;
  metaPrimaryText: string;
  metaHeadline: string;
  callToAction: string;
  aspectRatio: '9:16' | '1:1';
  durationSeconds: number;
  scenes: MetaAdScene[];
  complianceCheck: MetaComplianceItem[];
  metaTargeting: {
    interests: string[];
    demographics: string;
    placements: string[];
  };
}

export type OverallVerdict = 'Opportunité Exceptionnelle' | 'Opportunité Forte' | 'Marché Compétitif' | 'Niche Risquée';

export interface WebGroundingSource {
  title: string;
  url: string;
  /** Numéro cité dans le rapport, à partir de 1. */
  id?: number;
  /** Âge de la page annoncé par le moteur de recherche, quand il le donne. */
  publishedAt?: string | null;
}

/** Qui a produit le rapport, avec quelle consigne et quelles sources. */
export interface ReportGenerator {
  provider: string;
  model: string;
  promptVersion: string;
  /** Moteur de recherche web consulté ; null : aucun. */
  webSearch: string | null;
  generatedAt: string;
}

export interface MarketAnalysisReport {
  id: string;
  query: string;
  nicheName: string;
  dateCreated: string;
  /** Pays visé (ISO 3166-1 alpha-2) ; null : tous marchés. */
  market?: string | null;
  executiveSummary: string;
  summarySourceIds?: number[];
  /** null : verdict non établi, faute de sources suffisantes. */
  overallVerdict: OverallVerdict | null;
  verdictRationale?: string;
  rates: {
    demand: MarketRate;
    saturation: MarketRate;
    profitability: MarketRate;
    opportunity: MarketRate;
    virality: MarketRate;
  };
  searchTrends: SearchTrendKeyword[];
  competitors: CompetitorInsight[];
  digitalProducts: DigitalProductIdea[];
  adCampaigns: MetaAdCampaign[];
  illustrativeImages: {
    title: string;
    url: string;
    caption: string;
  }[];
  strategicActionPlan: {
    phase: string;
    title: string;
    steps: string[];
  }[];
  groundingSources?: WebGroundingSource[];
  /**
   * Provenance des blocs chiffrés, affichée sous chaque graphique.
   * Absente ⇒ le graphique le signale à l'écran plutôt que de se taire.
   */
  dataProvenance?: ReportDataProvenance;
  /** Ce que le rapport n'a pas pu établir, dit en clair. */
  limitations?: string[];
  generator?: ReportGenerator;
}

/** Entrée de la liste des rapports d'un compte. */
export interface ReportSummary {
  id: string;
  query: string;
  nicheName: string;
  market: string | null;
  createdAt: string;
}

export interface RadarTrendingProduct {
  title: string;
  format: 'template' | 'ebook' | 'bundle' | 'masterclass' | 'micro_tool';
  priceEstimated: number;
  targetAudience: string;
  keyFeature: string;
}

export interface RadarTrendingNiche {
  id: string;
  nicheName: string;
  category: string;
  explosionScore: number; // 0 to 100
  growthSignal: string;
  trendVelocity: 'breakout' | 'explosive' | 'steady';
  saturationLevel: 'Faible' | 'Moyenne' | 'Forte';
  estimatedMargin: string;
  searchVolumeEstimated: string;
  whyItExplodes: string;
  socialPlatforms: ('Google Trends' | 'Meta Ads' | 'TikTok' | 'Gumroad' | 'Etsy' | 'Reddit')[];
  viralAngles: string[];
  topDigitalProducts: RadarTrendingProduct[];
  sources?: WebGroundingSource[];
  actionIdea?: string;
}

export interface RadarScanResult {
  id: string;
  timestamp: string;
  searchFilter: string;
  platformsScanned: string[];
  totalNichesFound: number;
  executiveTakeaway: string;
  niches: RadarTrendingNiche[];
  webQueriesUsed?: string[];
}
