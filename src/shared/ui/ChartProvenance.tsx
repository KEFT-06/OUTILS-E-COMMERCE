import React from 'react';
import { AlertTriangle, Database, ExternalLink, FlaskConical } from 'lucide-react';
import { DataProvenance } from '@/shared/types/provenance';

/**
 * Bandeau de provenance à apposer sous chaque graphique (feuille de route, 2.6).
 *
 * Quand la provenance est absente, ce composant ne s'efface pas : il le dit.
 * C'est l'intérêt de le rendre obligatoire — un graphique dont on a oublié de
 * renseigner la source se signale à l'écran au lieu de passer inaperçu.
 */
interface ChartProvenanceProps {
  provenance?: DataProvenance;
  className?: string;
}

function formatCollectedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const ChartProvenance: React.FC<ChartProvenanceProps> = ({ provenance, className = '' }) => {
  if (!provenance) {
    return (
      <div
        className={`mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 ${className}`}
      >
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
        <p className="text-[10px] leading-relaxed text-amber-900">
          <strong>Provenance non renseignée.</strong> Ces chiffres sont affichés sans source ni
          date de collecte : à interpréter avec prudence.
        </p>
      </div>
    );
  }

  const Icon = provenance.isDemonstration ? FlaskConical : Database;

  return (
    <div className={`mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
        <Icon className="h-3 w-3 shrink-0" />
        {provenance.isDemonstration && (
          <span className="rounded bg-indigo-100 px-1 py-px font-bold uppercase tracking-wider text-indigo-700">
            Démonstration
          </span>
        )}
        <span>{provenance.source}</span>
      </span>

      <span className="text-[10px] text-slate-400">·</span>
      <span className="text-[10px] text-slate-500">
        collecté le {formatCollectedAt(provenance.collectedAt)}
      </span>

      {provenance.sampleSize !== undefined && (
        <>
          <span className="text-[10px] text-slate-400">·</span>
          <span className="text-[10px] text-slate-500">
            échantillon : {provenance.sampleSize.toLocaleString('fr-FR')}
            {provenance.sampleUnit ? ` ${provenance.sampleUnit}` : ''}
          </span>
        </>
      )}

      {provenance.sourceUrl && (
        <a
          href={provenance.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-indigo-600 hover:text-indigo-700"
        >
          source
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  );
};
