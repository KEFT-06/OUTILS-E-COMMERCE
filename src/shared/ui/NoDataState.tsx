import React from 'react';
import { LucideIcon, PlugZap } from 'lucide-react';

/**
 * État vide explicite pour une carte de tableau de bord.
 *
 * Sert à remplacer un bloc qui affichait des chiffres inventés. Le CdC §9.4
 * n'autorise que deux états : la donnée réelle, ou l'aveu qu'elle n'existe pas
 * encore. Un chiffre plausible sous un libellé « réel » est le pire des trois,
 * parce qu'il se lit comme une mesure.
 *
 * Le composant force donc à dire **pourquoi** la donnée manque et **quand**
 * elle arrivera : un état vide sans explication pousse l'utilisateur à croire
 * à un bug plutôt qu'à une étape de la feuille de route.
 */
interface NoDataStateProps {
  /** Ce qui serait affiché ici une fois la source branchée. */
  title: string;
  /** Pourquoi il n'y a rien à montrer — en clair, sans jargon technique. */
  reason: string;
  /** Jalon de la feuille de route, ex. « Lot 5 ». Affiché tel quel. */
  milestone?: string;
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
}

export const NoDataState: React.FC<NoDataStateProps> = ({
  title,
  reason,
  milestone,
  icon: Icon = PlugZap,
  action,
}) => {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white">
        <Icon className="h-5 w-5 text-slate-400" />
      </div>

      <p className="text-sm font-bold text-slate-700">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">{reason}</p>

      {milestone && (
        <span className="mt-3 inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Prévu — {milestone}
        </span>
      )}

      {action && (
        <div className="mt-4">
          <button
            type="button"
            onClick={action.onClick}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
};
