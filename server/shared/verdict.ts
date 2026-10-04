import type { MarketAnalysisReport, OverallVerdict, TauxLevel } from '@server/shared/analysis';

/**
 * Un rapport rend toujours un verdict.
 *
 * Il affichait « Non établi — trop peu de taux ont pu être évalués à partir des sources » (vu
 * par un client le 04/10/2026, sur une niche pourtant documentée par une quinzaine de pages).
 * C'était rendre la question à celui qui la posait. Une niche dont rien ne mesure la demande
 * n'est pas « sans verdict » : c'est un pari, et le dire est une réponse.
 *
 * Le verdict vient d'abord du rédacteur de l'analyse, qui a lu les sources. À défaut, il se
 * déduit ici des niveaux relevés — même règle sur le serveur (nouveaux rapports) et dans le
 * navigateur (rapports enregistrés avant ce changement, qui portent encore un verdict vide).
 */

const VALUE: Record<TauxLevel, number> = { Faible: 1, Moyen: 2, Élevé: 3, 'Très élevé': 4 };
const FEMININE: Record<TauxLevel, string> = { Faible: 'faible', Moyen: 'moyenne', Élevé: 'élevée', 'Très élevé': 'très élevée' };

type Rates = MarketAnalysisReport['rates'];

const TEST_FIRST = 'validez-la par un test à petit budget avant de produire';

/** Verdict déduit des niveaux, avec ce qui le fonde. Fonction pure. */
export function deriveVerdict(rates: Rates): { verdict: OverallVerdict; rationale: string } {
  const level = (key: keyof Rates) => rates[key]?.level ?? null;
  const value = (key: keyof Rates) => {
    const found = level(key);
    return found ? VALUE[found] : null;
  };
  const demand = value('demand');
  const saturation = value('saturation');
  const opportunity = value('opportunity');

  const seen = [
    level('demand') ? `demande ${FEMININE[level('demand')!]}` : null,
    level('saturation') ? `concurrence ${FEMININE[level('saturation')!]}` : null,
    level('opportunity') ? `opportunité ${FEMININE[level('opportunity')!]}` : null,
  ].filter((part): part is string => part !== null);
  const basis = seen.length > 0 ? `D’après les niveaux relevés : ${seen.join(', ')}.` : '';
  const unmeasured = demand === null ? ` La demande n’est pas encore mesurée : ${TEST_FIRST}.` : '';
  const settle = (verdict: OverallVerdict) => ({ verdict, rationale: `${basis}${unmeasured}`.trim() });

  if (demand === null && saturation === null && opportunity === null) {
    return {
      verdict: 'Niche Risquée',
      rationale: `Rien ne mesure encore la demande ni la concurrence sur cette niche : traitez-la comme un pari, et ${TEST_FIRST}.`,
    };
  }
  const openField = saturation === null || saturation <= 2;
  if (opportunity !== null && opportunity >= 3 && openField) {
    return settle(opportunity === 4 || demand === 4 ? 'Opportunité Exceptionnelle' : 'Opportunité Forte');
  }
  if (demand !== null && demand >= 3 && openField) {
    return settle(demand === 4 && saturation === 1 ? 'Opportunité Exceptionnelle' : 'Opportunité Forte');
  }
  if (saturation !== null && saturation >= 3) return settle(demand !== null && demand <= 1 ? 'Niche Risquée' : 'Marché Compétitif');
  if (demand === null || demand <= 1) return settle('Niche Risquée');
  return settle('Marché Compétitif');
}

/** Verdict à afficher pour un rapport : celui qu'il porte, sinon celui que ses niveaux donnent. */
export function settledVerdict(report: Pick<MarketAnalysisReport, 'overallVerdict' | 'verdictRationale' | 'rates'>): {
  verdict: OverallVerdict;
  rationale: string;
} {
  if (report.overallVerdict) return { verdict: report.overallVerdict, rationale: report.verdictRationale ?? '' };
  return deriveVerdict(report.rates);
}
