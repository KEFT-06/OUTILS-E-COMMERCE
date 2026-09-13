import React from 'react';
import { Clock, Hammer } from 'lucide-react';

interface PlaceholderModuleViewProps {
  moduleNumber: string;
  title: string;
  description: string;
}

export const PlaceholderModuleView: React.FC<PlaceholderModuleViewProps> = ({
  moduleNumber,
  title,
  description,
}) => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-black tracking-widest uppercase border border-indigo-100">
              Module {moduleNumber}
            </span>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold tracking-widest uppercase border border-amber-100">
              <Clock className="w-3 h-3" />
              <span>En cours de développement</span>
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {title}
          </h1>
          <p className="text-slate-500 mt-1 max-w-2xl">
            {description}
          </p>
        </div>
      </div>

      {/* Empty State / Construction View */}
      <div className="relative rounded-3xl border border-slate-200/80 bg-white/50 backdrop-blur-xl overflow-hidden min-h-[400px] flex flex-col items-center justify-center p-8 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        
        <div className="absolute inset-0 bg-grid-slate-100/[0.04] bg-[size:32px_32px]" />
        
        <div className="relative z-10 max-w-md mx-auto">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mb-6 shadow-sm">
            <Hammer className="w-10 h-10 text-indigo-400" />
          </div>
          
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            Module prévu pour la prochaine phase
          </h3>
          <p className="text-sm text-slate-500 mb-8 leading-relaxed">
            Conformément à la feuille de route (Cahier des charges - Chapitre 12), ce module est en cours de structuration. Notre équipe technique y intègre actuellement les standards de qualité et les connecteurs API requis.
          </p>

          {/* Skeleton Loaders for Preview */}
          <div className="w-full space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-slate-100 animate-pulse" />
              <div className="space-y-2 flex-1">
                <div className="h-4 w-1/3 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-3 w-3/4 bg-slate-50 rounded-lg animate-pulse" />
              </div>
            </div>
            <div className="flex items-center gap-4 opacity-75">
              <div className="w-12 h-12 rounded-xl bg-slate-100 animate-pulse" />
              <div className="space-y-2 flex-1">
                <div className="h-4 w-1/4 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-3 w-2/3 bg-slate-50 rounded-lg animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
