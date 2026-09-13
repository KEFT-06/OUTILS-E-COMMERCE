import React, { useState } from 'react';
import { AlertTriangle, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { DigitalProductIdea } from '@/shared/types/analysis';

/**
 * Mode Expert du Studio — feuille de route 3.1.
 *
 * L'utilisateur rédige lui-même la structure du produit. Ce mode ne dépend
 * d'aucun fournisseur d'IA : c'est le seul des trois modes utilisable tant que la
 * génération n'est pas branchée.
 *
 * Le parent remonte ce composant quand le produit ou l'existence d'un brouillon
 * change (`key`) : le formulaire repart toujours de la version affichée.
 */
interface ProductExpertEditorProps {
  /** Version affichée : le brouillon s'il existe, sinon l'original du rapport. */
  product: DigitalProductIdea;
  hasDraft: boolean;
  writeFailed: boolean;
  onSave: (product: DigitalProductIdea) => void;
  onDiscard: () => void;
}

type ModuleItem = DigitalProductIdea['tableOfContents'][number];

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500';

export const ProductExpertEditor: React.FC<ProductExpertEditorProps> = ({
  product,
  hasDraft,
  writeFailed,
  onSave,
  onDiscard,
}) => {
  const [form, setForm] = useState<DigitalProductIdea>(product);

  const isDirty = JSON.stringify(form) !== JSON.stringify(product);
  const titleMissing = form.title.trim().length === 0;

  const update = <K extends keyof DigitalProductIdea>(key: K, value: DigitalProductIdea[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const updateModule = (index: number, changes: Partial<ModuleItem>) =>
    setForm((previous) => ({
      ...previous,
      tableOfContents: previous.tableOfContents.map((module, i) =>
        i === index ? { ...module, ...changes } : module,
      ),
    }));

  const addModule = () =>
    setForm((previous) => ({
      ...previous,
      tableOfContents: [
        ...previous.tableOfContents,
        {
          moduleNumber:
            previous.tableOfContents.reduce((max, module) => Math.max(max, module.moduleNumber), 0) + 1,
          title: '',
          details: '',
        },
      ],
    }));

  const removeModule = (index: number) =>
    setForm((previous) => ({
      ...previous,
      tableOfContents: previous.tableOfContents.filter((_module, i) => i !== index),
    }));

  const updateLeadMagnet = (changes: Partial<DigitalProductIdea['leadMagnet']>) =>
    setForm((previous) => ({ ...previous, leadMagnet: { ...previous.leadMagnet, ...changes } }));

  const handleDiscard = () => {
    if (window.confirm('Abandonner vos retouches et revenir à la version issue du rapport ?')) {
      onDiscard();
    }
  };

  return (
    <div className="space-y-5 rounded-2xl border border-indigo-100 bg-indigo-50/30 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-slate-600">
          Vos retouches sont enregistrées comme un brouillon, à côté de la version du rapport. Les
          exports utilisent la version affichée.
        </p>
        <div className="flex shrink-0 gap-2">
          {hasDraft && (
            <button
              type="button"
              onClick={handleDiscard}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-rose-200 hover:text-rose-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Version du rapport
            </button>
          )}
          <button
            type="button"
            onClick={() => onSave(form)}
            disabled={!isDirty || titleMissing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Save className="h-3.5 w-3.5" />
            Enregistrer le brouillon
          </button>
        </div>
      </div>

      {writeFailed && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-amber-900">
            Ce navigateur refuse l'enregistrement : le brouillon sera perdu à la fermeture de l'onglet.
            Exportez le produit avant de quitter.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelClass}>Titre</span>
          <input value={form.title} onChange={(e) => update('title', e.target.value)} maxLength={200} className={fieldClass} />
          {titleMissing && <span className="mt-1 block text-[11px] text-rose-600">Le titre est obligatoire.</span>}
        </label>

        <label className="block sm:col-span-2">
          <span className={labelClass}>Sous-titre</span>
          <input value={form.subtitle} onChange={(e) => update('subtitle', e.target.value)} maxLength={300} className={fieldClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Public cible</span>
          <textarea value={form.targetAudience} onChange={(e) => update('targetAudience', e.target.value)} rows={3} maxLength={1000} className={fieldClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Promesse de transformation</span>
          <textarea
            value={form.transformationPromise}
            onChange={(e) => update('transformationPromise', e.target.value)}
            rows={3}
            maxLength={1000}
            className={fieldClass}
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={labelClass}>Modules ({form.tableOfContents.length})</span>
          <button
            type="button"
            onClick={addModule}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:border-indigo-300"
          >
            <Plus className="h-3 w-3" />
            Ajouter un module
          </button>
        </div>

        {form.tableOfContents.map((module, index) => (
          <div key={index} className="grid grid-cols-[64px_1fr_auto] gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <label className="block">
              <span className="sr-only">Numéro du module</span>
              <input
                type="number"
                min={1}
                value={module.moduleNumber}
                onChange={(e) => updateModule(index, { moduleNumber: Math.max(1, Number(e.target.value) || 1) })}
                className={fieldClass}
              />
            </label>

            <div className="space-y-2">
              <input
                value={module.title}
                onChange={(e) => updateModule(index, { title: e.target.value })}
                maxLength={200}
                placeholder="Titre du module"
                aria-label={`Titre du module ${index + 1}`}
                className={fieldClass}
              />
              <textarea
                value={module.details}
                onChange={(e) => updateModule(index, { details: e.target.value })}
                rows={2}
                maxLength={4000}
                placeholder="Contenu du module"
                aria-label={`Contenu du module ${index + 1}`}
                className={fieldClass}
              />
            </div>

            <button
              type="button"
              onClick={() => removeModule(index)}
              aria-label={`Supprimer le module ${index + 1}`}
              title="Supprimer le module"
              className="self-start rounded-lg border border-slate-200 p-2 text-slate-400 hover:border-rose-200 hover:text-rose-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className={labelClass}>Lead magnet — titre</span>
          <input value={form.leadMagnet.title} onChange={(e) => updateLeadMagnet({ title: e.target.value })} maxLength={200} className={fieldClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Format</span>
          <input value={form.leadMagnet.format} onChange={(e) => updateLeadMagnet({ format: e.target.value })} maxLength={100} className={fieldClass} />
        </label>
        <label className="block sm:col-span-3">
          <span className={labelClass}>Accroche</span>
          <textarea value={form.leadMagnet.hook} onChange={(e) => updateLeadMagnet({ hook: e.target.value })} rows={2} maxLength={1000} className={fieldClass} />
        </label>
      </div>
    </div>
  );
};
