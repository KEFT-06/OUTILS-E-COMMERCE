import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { type Guide, coversApi, guidesApi } from '@/modules/multilingue/guidesApi';
import { GUIDE_DOCUMENT_CSS, exportNotice, guideDocumentOf, paragraphsOf } from '@/modules/multilingue/guideExport';
import { toApiError } from '@/shared/lib/apiError';
import { recordExport } from '@/shared/lib/usage';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Page d'impression d'un guide : couverture pleine page, puis le texte. La
 * fenêtre d'impression s'ouvre dès que la couverture est chargée ; « Enregistrer
 * au format PDF » y produit le fichier, avec les polices du système pour toutes
 * les écritures.
 */
export function GuidePrintView() {
  const { guideId = '', language = '' } = useParams();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageSettled, setImageSettled] = useState(false);
  const printed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    guidesApi
      .get(guideId)
      .then((loaded) => {
        if (!cancelled) setGuide(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Le guide n’a pas pu être chargé.').message);
      });
    return () => {
      cancelled = true;
    };
  }, [guideId]);

  const printable = guide ? guideDocumentOf(guide, language) : null;
  const cover = guide?.cover?.status === 'ready' ? guide.cover : null;
  const title = printable?.title;
  const readyToPrint = Boolean(printable) && (!cover || imageSettled);

  useEffect(() => {
    // Le navigateur propose le titre comme nom du fichier PDF.
    if (title) document.title = title;
  }, [title]);

  const print = () => {
    recordExport('ebook', 'pdf');
    window.print();
  };

  useEffect(() => {
    if (!readyToPrint || printed.current) return;
    printed.current = true;
    const timer = window.setTimeout(print, 500);
    return () => window.clearTimeout(timer);
  }, [readyToPrint]);

  return (
    <div className="min-h-svh bg-slate-100 text-slate-900 print:bg-white">
      <style>{GUIDE_DOCUMENT_CSS}</style>
      <nav aria-label="Impression" className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/app/multilingue/${guideId}`}>
            <ArrowLeft />
            Retour au guide
          </Link>
        </Button>
        <Button size="sm" onClick={print} disabled={!printable}>
          <Printer />
          Imprimer ou enregistrer en PDF
        </Button>
        <p className="text-sm text-slate-600">Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF ».</p>
      </nav>

      {error ? (
        <p className="mx-auto max-w-xl p-8 text-center text-sm" role="alert">
          {error}
        </p>
      ) : !guide ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-600" role="status">
          <Spinner />
          Préparation du document…
        </div>
      ) : !printable ? (
        <p className="mx-auto max-w-xl p-8 text-center text-sm" role="alert">
          Ce guide n’a pas de traduction dans cette langue.
        </p>
      ) : (
        <main className="guide my-6 rounded-xl shadow-sm print:my-0" lang={printable.language} dir={printable.direction}>
          <header className={`guide-cover${cover ? ' has-image' : ''}`}>
            {cover && (
              <img src={coversApi.imageUrl(cover)} alt="" onLoad={() => setImageSettled(true)} onError={() => setImageSettled(true)} />
            )}
            <div className="guide-cover-title">
              <h1>{printable.title}</h1>
            </div>
          </header>
          {printable.sections.map((section) => (
            <section key={section.id}>
              {section.heading && <h2>{section.heading}</h2>}
              {paragraphsOf(section.body).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </section>
          ))}
          <footer className="guide-colophon" lang="fr" dir="ltr">
            {exportNotice(printable)} · Smart Creator
          </footer>
        </main>
      )}
    </div>
  );
}
