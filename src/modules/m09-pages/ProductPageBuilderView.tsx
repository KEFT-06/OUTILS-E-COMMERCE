import React, { useState } from 'react';
import { AlertTriangle, Download, ImageIcon, Info, LayoutTemplate, Loader2, Plus, Trash2 } from 'lucide-react';
import { awarenessLabel } from '@/shared/lib/awareness';
import { ComplianceBlockedError } from '@/shared/lib/complianceGate';
import {
  PAGE_SECTIONS,
  PageVariant,
  buildPageModel,
  emptyPageDraft,
  hasVariantB,
  missingForExport,
} from '@/shared/lib/productPage';
import { PageIncompleteError, exportProductPage } from '@/shared/lib/productPageExport';
import { safeHttpsUrl } from '@/shared/lib/safeUrl';
import { useProductDrafts } from '@/shared/lib/useProductDrafts';
import { useProductPageDrafts } from '@/shared/lib/useProductPageDrafts';
import { MarketAnalysisReport } from '@/shared/types/analysis';
import { ReportComplianceVerdict } from '@/shared/types/compliance';
import { ProductPageDraft, SectionRole } from '@/shared/types/productPage';
import { ComplianceBlockDialog } from '@/shared/ui/ComplianceBlockDialog';
import { NoDataState } from '@/shared/ui/NoDataState';

/**
 * Générateur de pages produits — feuille de route 5.3.
 *
 * Contenu, public et offre viennent du produit du Studio (sa version retouchée
 * en mode Expert si elle existe). Le reste est saisi par l'auteur : aucune
 * section n'est remplie à sa place, et aucun témoignage n'est proposé.
 */

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500';

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export const ProductPageBuilderView: React.FC<{ report: MarketAnalysisReport }> = ({ report }) => {
  const productDrafts = useProductDrafts();
  const pageDrafts = useProductPageDrafts();

  const [productId, setProductId] = useState(report.digitalProducts[0]?.id ?? '');
  const [previewVariant, setPreviewVariant] = useState<PageVariant>('A');
  const [exporting, setExporting] = useState<PageVariant | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  const baseProduct =
    report.digitalProducts.find((candidate) => candidate.id === productId) ?? report.digitalProducts[0];

  if (!baseProduct) {
    return (
      <NoDataState
        icon={LayoutTemplate}
        title="Aucun produit dans ce rapport"
        reason="Le générateur de pages part d'un produit du Studio. Ce rapport n'en contient pas encore."
      />
    );
  }

  const product = productDrafts.effective(baseProduct);
  const draft = pageDrafts.get(product.id) ?? emptyPageDraft(product);
  const update = (changes: Partial<ProductPageDraft>) => pageDrafts.save({ ...draft, ...changes });
  const updateImage = (role: SectionRole, url: string) => update({ images: { ...draft.images, [role]: url } });

  const model = buildPageModel(product, draft, previewVariant);
  const missing = missingForExport(draft);
  const variantB = hasVariantB(draft);

  const handleExport = async (variant: PageVariant) => {
    setExporting(variant);
    setExportError(null);

    try {
      await exportProductPage(product, draft, variant);
    } catch (error) {
      if (error instanceof ComplianceBlockedError) {
        setBlockedVerdict(error.verdict);
        return;
      }
      if (error instanceof PageIncompleteError) {
        setExportError(error.missing.join(' '));
        return;
      }
      setExportError(error instanceof Error ? error.message : "L'export a échoué.");
    } finally {
      setExporting(null);
    }
  };

  const sectionInputs: Record<SectionRole, React.ReactNode> = {
    hero: (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Accroche — variante A</span>
          <input value={draft.headlineA} onChange={(e) => update({ headlineA: e.target.value })} maxLength={160} className={fieldClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Accroche — variante B</span>
          <input value={draft.headlineB} onChange={(e) => update({ headlineB: e.target.value })} maxLength={160} placeholder="facultatif" className={fieldClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Bouton — variante A</span>
          <input value={draft.ctaLabelA} onChange={(e) => update({ ctaLabelA: e.target.value })} maxLength={60} className={fieldClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Bouton — variante B</span>
          <input value={draft.ctaLabelB} onChange={(e) => update({ ctaLabelB: e.target.value })} maxLength={60} placeholder="facultatif" className={fieldClass} />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClass}>Lien de paiement (https, obligatoire)</span>
          <input
            value={draft.checkoutUrl}
            onChange={(e) => update({ checkoutUrl: e.target.value })}
            placeholder="ex. la page de votre produit sur Chariow"
            className={fieldClass}
          />
          {draft.checkoutUrl && !safeHttpsUrl(draft.checkoutUrl) && (
            <span className="mt-1 block text-[11px] text-rose-600">Lien invalide : seul un lien https est accepté.</span>
          )}
        </label>
      </div>
    ),
    problem: (
      <label className="block">
        <span className={labelClass}>Le problème vécu par votre lecteur (obligatoire)</span>
        <textarea value={draft.problem} onChange={(e) => update({ problem: e.target.value })} rows={4} maxLength={2000} className={fieldClass} />
      </label>
    ),
    solution: (
      <p className="text-xs leading-relaxed text-slate-600">
        Reprend la promesse de transformation du produit : « {product.transformationPromise} »
      </p>
    ),
    content: (
      <p className="text-xs text-slate-600">
        Reprend les {product.tableOfContents.length} modules du produit, modifiables en mode Expert dans le Studio.
      </p>
    ),
    audience: (
      <div className="space-y-2">
        <p className="text-xs leading-relaxed text-slate-600">Public repris du produit : « {product.targetAudience} »</p>
        <label className="block">
          <span className={labelClass}>Pour qui ce n'est pas (facultatif)</span>
          <textarea value={draft.notFor} onChange={(e) => update({ notFor: e.target.value })} rows={2} maxLength={1000} className={fieldClass} />
        </label>
      </div>
    ),
    offer: (
      <div className="space-y-2">
        <p className="text-xs text-slate-600">
          Prix repris du produit : <strong>{model.price}</strong>
          {product.leadMagnet.title ? <> · bonus : « {product.leadMagnet.title} »</> : null}
        </p>
        <label className="block">
          <span className={labelClass}>Conditions (remboursement, accès…) — facultatif</span>
          <textarea
            value={draft.offerConditions}
            onChange={(e) => update({ offerConditions: e.target.value })}
            rows={2}
            maxLength={1000}
            className={fieldClass}
          />
        </label>
      </div>
    ),
    faq_cta: (
      <div className="space-y-2">
        {draft.faq.map((item, index) => (
          <div key={index} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-slate-200 p-2">
            <div className="space-y-1.5">
              <input
                value={item.question}
                onChange={(e) => update({ faq: draft.faq.map((faq, i) => (i === index ? { ...faq, question: e.target.value } : faq)) })}
                placeholder="Question"
                maxLength={200}
                aria-label={`Question ${index + 1}`}
                className={fieldClass}
              />
              <textarea
                value={item.answer}
                onChange={(e) => update({ faq: draft.faq.map((faq, i) => (i === index ? { ...faq, answer: e.target.value } : faq)) })}
                placeholder="Réponse"
                rows={2}
                maxLength={1000}
                aria-label={`Réponse ${index + 1}`}
                className={fieldClass}
              />
            </div>
            <button
              type="button"
              onClick={() => update({ faq: draft.faq.filter((_faq, i) => i !== index) })}
              aria-label={`Supprimer la question ${index + 1}`}
              className="self-start rounded-lg border border-slate-200 p-2 text-slate-400 hover:text-rose-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update({ faq: [...draft.faq, { question: '', answer: '' }] })}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:border-indigo-300"
        >
          <Plus className="h-3 w-3" />
          Ajouter une question
        </button>
      </div>
    ),
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="mb-2 inline-block rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700">
            Module 09
          </span>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            <LayoutTemplate className="h-6 w-6 text-indigo-600" />
            Générateur de Pages Produits
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Une page de vente en 7 sections, chacune avec son rôle de conversion, exportée en HTML autonome.
          </p>
        </div>
        <label className="block sm:w-72">
          <span className={labelClass}>Produit</span>
          <select value={baseProduct.id} onChange={(e) => setProductId(e.target.value)} className={fieldClass}>
            {report.digitalProducts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {productDrafts.effective(candidate).title}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p className="text-xs leading-relaxed text-slate-600">
          Aucun témoignage n'est proposé : une page ne doit en montrer que s'ils sont réels et vérifiables. Pour le
          test A/B, les deux fichiers ne diffèrent que par l'accroche et le bouton ; la répartition du trafic et la
          mesure se font sur l'outil qui héberge la page.
        </p>
      </div>

      {pageDrafts.writeFailed && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-900">
            Ce navigateur refuse l'enregistrement : vos saisies seront perdues à la fermeture de l'onglet.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          {PAGE_SECTIONS.map((section, index) => (
            <section key={section.role} className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-indigo-600">
                  Section {index + 1} · {section.label}
                </p>
                <p className="text-xs text-slate-500">{section.purpose}</p>
              </div>

              {sectionInputs[section.role]}

              <div className="rounded-xl bg-slate-50 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Image — {awarenessLabel(section.awarenessLevel)}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{section.imageBrief}</p>
                <input
                  value={draft.images[section.role] ?? ''}
                  onChange={(e) => updateImage(section.role, e.target.value)}
                  placeholder="Lien https de l'image (facultatif)"
                  aria-label={`Image de la section ${section.label}`}
                  className={`${fieldClass} mt-2`}
                />
                {draft.images[section.role] && !safeHttpsUrl(draft.images[section.role]) && (
                  <span className="mt-1 block text-[11px] text-rose-600">Image ignorée : seul un lien https est accepté.</span>
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Aperçu</p>
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
              {(['A', 'B'] as const).map((variant) => (
                <button
                  key={variant}
                  type="button"
                  aria-pressed={previewVariant === variant}
                  onClick={() => setPreviewVariant(variant)}
                  disabled={variant === 'B' && !variantB}
                  className={`rounded-lg px-3 py-1 text-xs font-bold disabled:opacity-40 ${
                    previewVariant === variant ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  Variante {variant}
                </button>
              ))}
            </div>
          </div>

          <article className="max-h-[70vh] space-y-6 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-xs">
            {PAGE_SECTIONS.map((section) => {
              const imageUrl = model.images[section.role];
              return (
                <div key={section.role} className="space-y-2 border-b border-slate-100 pb-5 last:border-0">
                  {imageUrl && (
                    <div className="flex h-24 items-center justify-center rounded-xl bg-slate-100 text-[11px] text-slate-500">
                      Image : {hostname(imageUrl)}
                    </div>
                  )}
                  {section.role === 'hero' && (
                    <div className="space-y-2 text-center">
                      <h2 className="text-xl font-black text-slate-900">{model.headline}</h2>
                      {model.subtitle && <p className="text-sm text-slate-500">{model.subtitle}</p>}
                      <span className="inline-block rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">{model.ctaLabel}</span>
                    </div>
                  )}
                  {section.role === 'problem' &&
                    (model.problem ? (
                      <p className="whitespace-pre-line text-sm text-slate-700">{model.problem}</p>
                    ) : (
                      <p className="text-xs italic text-rose-600">Section Problème à rédiger.</p>
                    ))}
                  {section.role === 'solution' && <p className="text-sm text-slate-700">{model.promise}</p>}
                  {section.role === 'content' && (
                    <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
                      {model.modules.map((module, index) => (
                        <li key={`${module.number}-${index}`}>{module.title}</li>
                      ))}
                    </ol>
                  )}
                  {section.role === 'audience' && (
                    <p className="text-sm text-slate-700">
                      {model.audience}
                      {model.notFor && <span className="block pt-1 text-slate-500">Pas pour : {model.notFor}</span>}
                    </p>
                  )}
                  {section.role === 'offer' && <p className="text-lg font-black text-slate-900">{model.price}</p>}
                  {section.role === 'faq_cta' && (
                    <p className="text-xs text-slate-500">
                      {model.faq.length} question(s) · bouton « {model.ctaLabel} »
                    </p>
                  )}
                </div>
              );
            })}
          </article>

          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
            {missing.length > 0 && (
              <ul className="space-y-1">
                {missing.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-xs text-rose-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              {(['A', 'B'] as const)
                .filter((variant) => variant === 'A' || variantB)
                .map((variant) => (
                  <button
                    key={variant}
                    type="button"
                    onClick={() => handleExport(variant)}
                    disabled={missing.length > 0 || exporting !== null}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {exporting === variant ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Télécharger la variante {variant} (HTML)
                  </button>
                ))}
            </div>

            {exportError && <p className="text-xs text-rose-700">{exportError}</p>}

            <p className="text-[11px] leading-relaxed text-slate-400">
              Chaque export passe la conformité sur les deux variantes et inclut la mention légale. Le fichier ne
              contient aucun script ; ses images sont chargées depuis vos liens https.
            </p>
          </div>
        </div>
      </div>

      <ComplianceBlockDialog
        verdict={blockedVerdict}
        open={blockedVerdict !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setBlockedVerdict(null);
        }}
      />
    </div>
  );
};
