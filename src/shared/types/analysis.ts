import { ScoreTrace } from '@/shared/types/scoring';
import { ReportDataProvenance } from '@/shared/types/provenance';

export type TauxLevel = 'Faible' | 'Moyen' | 'Élevé' | 'Très élevé';

export interface MarketRate {
  key: 'demand' | 'saturation' | 'profitability' | 'opportunity' | 'virality';
  label: string;
  level: TauxLevel;
  score: number; // 0 to 100
  description: string;
  trend: 'up' | 'stable' | 'down';
  /**
   * Trace de calcul persistée. Absente tant que la méthodologie du taux n'est
   * pas publiée : dans ce cas le panneau de détail le dit, plutôt que d'inventer
   * une ventilation.
   */
  trace?: ScoreTrace;
}

export interface SearchTrendKeyword {
  keyword: string;
  volume: string;
  growthRate: string;
  growthType: 'explosive' | 'steady' | 'niche';
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
}

export interface DigitalProductIdea {
  id: string;
  title: string;
  subtitle: string;
  type: 'ebook' | 'template' | 'masterclass' | 'bundle' | 'micro_tool';
  typeName: string;
  recommendedPrice: number;
  currency: string;
  estimatedProductionDays: number;
  estimatedMarginPercent: number;
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

export interface MarketAnalysisReport {
  id: string;
  query: string;
  nicheName: string;
  dateCreated: string;
  executiveSummary: string;
  overallVerdict: 'Opportunité Exceptionnelle' | 'Opportunité Forte' | 'Marché Compétitif' | 'Niche Risquée';
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
}

export interface WebGroundingSource {
  title: string;
  url: string;
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
  growthSignal: string; // e.g. "+380% sur Google Trends"
  trendVelocity: 'breakout' | 'explosive' | 'steady';
  saturationLevel: 'Faible' | 'Moyenne' | 'Forte';
  estimatedMargin: string; // e.g. "96%"
  searchVolumeEstimated: string; // e.g. "45 000 / mois"
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
