/** Miroir client de `server/services/blueprints`. */

export interface BlueprintObjective {
  id: string;
  /** Nom exact dans le gestionnaire de publicités de la plateforme. */
  officialName: string;
  category?: string;
  purpose: string;
}

export interface BlueprintPlatform {
  id: string;
  label: string;
  objectivesSource: string;
  objectivesCheckedAt: string;
  objectives: BlueprintObjective[];
}

export interface BlueprintRule {
  kind: 'cut' | 'scale' | 'watch';
  description: string;
  /** Seuil en multiple du coût d'acquisition cible saisi par l'utilisateur. */
  cpaMultiplier?: number;
}

export interface BlueprintPhase {
  id: string;
  name: string;
  objectiveId: string;
  fallbackObjectiveId?: string;
  fallbackCondition?: string;
  durationDays: number;
  budgetSharePercent: number;
  structure: { campaigns: number; adSets: number; adsPerAdSet: number };
  guidance: string;
  rules: BlueprintRule[];
}

export interface CampaignBlueprint {
  id: string;
  platform: string;
  name: string;
  summary: string;
  prerequisites: string[];
  phases: BlueprintPhase[];
}

export interface CampaignBlueprintConfig {
  version: string;
  updatedAt: string;
  note?: string;
  valuesStatus?: string;
  platforms: BlueprintPlatform[];
  blueprints: CampaignBlueprint[];
}
