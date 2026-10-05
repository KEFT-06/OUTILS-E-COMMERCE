import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, FileDown, FileText, Pencil, Sparkles, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { BookProse } from '@/shared/components/BookProse';
import { toApiError } from '@/shared/lib/apiError';
import { writingApi, type WritingFinding } from '@/shared/lib/writing';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * « Voir l'ebook » : l'ouvrage tel qu'il sera téléchargé, à lire, corriger et télécharger au
 * même endroit.
 *
 * Il s'ouvre de lui-même dès qu'une rédaction se termine. Jusqu'ici la rédaction ouvrait un
 * formulaire de champs de texte ; pour LIRE son livre, il fallait télécharger le PDF. Le texte
 * est composé ici comme à l'impression — titres et sous-titres en gras, paragraphes, listes —
 * par la même lecture que le PDF et le DOCX.
 *
 * Deux façons de corriger, parce qu'elles ne servent pas la même chose :
 *   · à la main, pour une faute de frappe ou une phrase qu'on sait déjà écrire ;
 *   · par une consigne (« raccourcis », « ajoute un exemple », « ton plus direct »), pour ce
 *     qu'on sait juger mais pas reformuler.
 *
 * Le téléchargement part toujours de ce qui est à l'écran : une correction pas encore
 * enregistrée l'est d'abord, puis le fichier est produit.
 */

type ExportFormat = 'pdf' | 'docx';

interface ProductPreviewPanelProps {
  product: DigitalProductIdea;
  market: string | null;
  /** Enregistre la version modifiée dans le brouillon du compte. */
  onSave: (product: DigitalProductIdea) => void;
  /** Signalements de conformité rapportés par une retouche. */
  onFindings: (findings: WritingFinding[]) => void;
  /** Télécharge l'ouvrage donné (contrôles compris). */
  onExport: (format: ExportFormat, product: DigitalProductIdea) => void;
  /** Format en cours de téléchargement, ou null. */
  exporting: ExportFormat | null;
  /** Amène l'ouvrage à l'écran à l'ouverture (fin d'une rédaction). */
  scrollIntoView?: boolean;
}

const WORDS = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

function ModuleBlock({
  numero,
  titre,
  texte,
  productTitle,
  market,
  onChange,
  onFindings,
}: {
  numero: number;
  titre: string;
  texte: string;
  productTitle: string;
  market: string | null;
  onChange: (texte: string) => void;
  onFindings: (findings: WritingFinding[]) => void;
}) {
  const { runWithCredits } = useCreditGate();
  const [edition, setEdition] = useState<string | null>(null);
  const [consigne, setConsigne] = useState('');
  const [enCours, setEnCours] = useState(false);
  /** Version d'avant la retouche : permet de revenir en arrière sans rien avoir perdu. */
  const [avant, setAvant] = useState<string | null>(null);

  async function retoucher() {
    const demande = consigne.trim();
    if (!demande || enCours) return;
    setEnCours(true);
    try {
      const resultat = await runWithCredits('product_revision', () =>
        writingApi.revise({ text: texte, instruction: demande, productTitle, sectionTitle: titre, market }),
      );
      if (!resultat) return;
      setAvant(texte);
      onChange(resultat.text);
      onFindings(resultat.findings);
      setConsigne('');
      toast.success('Passage réécrit', { description: 'Relisez-le : vous pouvez revenir en arrière en un clic.' });
    } catch (error) {
      toast.error('La retouche n’a pas abouti', { description: toApiError(error, 'Réessayez dans un moment.').message });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section className="space-y-4 border-t pt-8 first:border-t-0 first:pt-0">
      <header className="space-y-1">
        <p className="text-xs font-bold tracking-[0.14em] text-brand-green-text uppercase">Module {numero}</p>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl font-extrabold tracking-tight">{titre}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">{WORDS(texte).toLocaleString('fr-FR')} mots</span>
        </div>
      </header>

      {edition === null ? (
        texte.trim() ? (
          <BookProse text={texte} />
        ) : (
          <p className="text-sm text-muted-foreground italic">Ce module n’a pas encore de contenu.</p>
        )
      ) : (
        <div className="space-y-2">
          <Textarea
            value={edition}
            onChange={(change) => setEdition(change.target.value)}
            rows={18}
            aria-label={`Contenu du module ${numero}`}
            className="font-mono text-sm leading-relaxed"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Un titre : <code className="rounded bg-muted px-1">## Titre</code> · un sous-titre :{' '}
            <code className="rounded bg-muted px-1">### Sous-titre</code> · une liste : <code className="rounded bg-muted px-1">- élément</code> · une
            étape : <code className="rounded bg-muted px-1">1. étape</code> · une ligne vide entre deux paragraphes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                setAvant(texte);
                onChange(edition);
                setEdition(null);
              }}
            >
              <Check />
              Garder
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdition(null)}>
              <X />
              Annuler
            </Button>
          </div>
        </div>
      )}

      {edition === null && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-center">
          <Button size="sm" variant="outline" onClick={() => setEdition(texte)} className="shrink-0">
            <Pencil />
            Corriger à la main
          </Button>
          {avant !== null && (
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                onChange(avant);
                setAvant(null);
              }}
            >
              <Undo2 />
              Revenir à l’avant
            </Button>
          )}
          {/* La consigne : une phrase, pas un formulaire. */}
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(envoi) => {
              envoi.preventDefault();
              void retoucher();
            }}
          >
            <Input
              value={consigne}
              onChange={(change) => setConsigne(change.target.value)}
              placeholder="Ou demandez : « raccourcis », « ajoute un exemple »…"
              aria-label={`Consigne de retouche du module ${numero}`}
              disabled={enCours}
            />
            <Button type="submit" size="sm" variant="secondary" disabled={enCours || consigne.trim().length < 3} className="shrink-0">
              {enCours ? <Spinner className="size-4" /> : <Sparkles />}
              Retoucher
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}

export function ProductPreviewPanel({ product, market, onSave, onFindings, onExport, exporting, scrollIntoView = false }: ProductPreviewPanelProps) {
  /** Copie de travail : rien ne rejoint le brouillon tant que l'auteur n'a pas validé. */
  const [brouillon, setBrouillon] = useState(product.tableOfContents);
  const modifie = brouillon.some((module, index) => module.details !== product.tableOfContents[index]?.details);
  const total = brouillon.reduce((somme, module) => somme + WORDS(module.details), 0);
  const haut = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollIntoView) haut.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollIntoView]);

  /** Le fichier part de ce qui est à l'écran : une correction en attente est enregistrée d'abord. */
  const telecharger = (format: ExportFormat) => {
    const courant = { ...product, tableOfContents: brouillon };
    if (modifie) onSave(courant);
    onExport(format, courant);
  };

  return (
    <Card ref={haut} className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="size-4 text-brand-green-text" aria-hidden="true" />
          Votre ebook
        </CardTitle>
        <CardDescription>Lisez-le tel qu’il sera téléchargé, corrigez ce qui doit l’être, puis téléchargez-le.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{brouillon.length} modules</Badge>
          <Badge variant="outline">{total.toLocaleString('fr-FR')} mots</Badge>
          {/* Une page A4 aérée fait environ 300 mots : le repère que le Studio utilise déjà. */}
          <Badge variant="outline">≈ {Math.max(1, Math.round(total / 300))} pages</Badge>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => telecharger('pdf')} disabled={exporting !== null || brouillon.length === 0}>
              {exporting === 'pdf' ? <Spinner /> : <FileDown />}
              Télécharger le PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => telecharger('docx')} disabled={exporting !== null || brouillon.length === 0}>
              {exporting === 'docx' ? <Spinner /> : <FileText />}
              DOCX
            </Button>
          </div>
        </div>

        <article className="mx-auto max-w-3xl space-y-8 rounded-xl border bg-card p-5 shadow-sm sm:p-10">
          <header className="space-y-3 border-b pb-8 text-center">
            <p className="text-xs font-bold tracking-[0.18em] text-brand-green-text uppercase">{product.typeName}</p>
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{product.title}</h2>
            {product.subtitle && <p className="mx-auto max-w-xl text-muted-foreground text-balance">{product.subtitle}</p>}
          </header>

          {brouillon.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Ce produit n’a pas encore de plan. Lancez le mode Génératif pour le composer et le rédiger.
            </p>
          ) : (
            brouillon.map((module, index) => (
              <ModuleBlock
                key={`${module.moduleNumber}-${index}`}
                numero={module.moduleNumber}
                titre={module.title}
                texte={module.details}
                productTitle={product.title}
                market={market}
                onFindings={onFindings}
                onChange={(texte) =>
                  setBrouillon((actuel) => actuel.map((entree, rang) => (rang === index ? { ...entree, details: texte } : entree)))
                }
              />
            ))
          )}
        </article>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant={modifie ? 'default' : 'outline'} disabled={!modifie} onClick={() => onSave({ ...product, tableOfContents: brouillon })}>
            <Check />
            Enregistrer les corrections
          </Button>
          {modifie && (
            <Button variant="ghost" onClick={() => setBrouillon(product.tableOfContents)}>
              <Undo2 />
              Tout annuler
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
