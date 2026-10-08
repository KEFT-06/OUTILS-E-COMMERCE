import { useEffect, useState } from 'react';
import { Download, ImageDown } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { BookCover } from '@/shared/components/BookCover';
import { composeCoverFor, downloadBookCover } from '@/shared/lib/downloadBookCover';
import { rememberProductCover } from '@/shared/stores/useProductCovers';
import { CoverGenerator } from '@/shared/components/CoverGenerator';
import { ZoomableImage } from '@/shared/components/ZoomableImage';
import { type CoverView, coversApi } from '@/shared/lib/covers';
import { toFileSlug } from '@/shared/lib/pdfText';
import { useCustomProducts } from '@/shared/stores/useCustomProducts';
import { useProductDrafts } from '@/shared/stores/useProductDrafts';
import { Button } from '@/shared/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Onglet « Livre » des Créatifs : la couverture d'un livre, prête à être publiée.
 *
 * Une couverture n'est pas un visuel publicitaire : elle n'a ni méthode, ni niveau de
 * conscience, ni format de placement. Elle a un titre, un sous-titre, un auteur et une
 * illustration. L'illustration est générée sans texte ; le titre est posé ensuite par la mise en
 * page, avec les vrais accents — puis l'ensemble se télécharge en une image.
 *
 * Pour un produit du Studio, l'illustration est la même que celle du PDF de l'ebook : la
 * générer ici la met aussi sur le livre, et inversement.
 */

/** Livre qui n'est pas (encore) un produit du Studio : titre saisi ici. */
const FREE = 'libre';

interface CoverTexts {
  title: string;
  subtitle: string;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export function BookCoverPanel() {
  const { currentReport } = useWorkspace();
  const { account } = useAuth();
  const custom = useCustomProducts();
  const drafts = useProductDrafts();

  // Les produits du compte d'abord (les plus récents en tête), puis ceux de la niche analysée.
  const products = [...custom.products, ...(currentReport?.digitalProducts ?? [])].map((product) => drafts.effective(product));

  /** `null` : pas encore choisi — le premier produit du compte, ou un titre libre s'il n'y en a pas. */
  const [chosen, setChosen] = useState<string | null>(null);
  const source = chosen ?? products[0]?.id ?? FREE;
  const product = products.find((candidate) => candidate.id === source);

  /** Textes retouchés pour la couverture, par livre : ils ne modifient pas le produit. */
  const [edits, setEdits] = useState<Record<string, CoverTexts>>({});
  const texts = edits[source] ?? { title: product?.title ?? '', subtitle: product?.subtitle ?? '' };
  const setTexts = (patch: Partial<CoverTexts>) => setEdits((previous) => ({ ...previous, [source]: { ...texts, ...patch } }));
  const [author, setAuthor] = useState(account?.name ?? '');

  // Un titre libre retrouve sa couverture d'une visite à l'autre : elle est rangée sous son titre.
  const settledTitle = useDebounced(texts.title, 600);
  const subjectId = product ? product.id : `livre-${toFileSlug(settledTitle, 'sans-titre')}`;

  const [cover, setCover] = useState<CoverView | null>(null);
  const [composed, setComposed] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const ready = cover?.status === 'ready' ? cover : null;
  const imageUrl = ready ? coversApi.imageUrl(ready) : null;
  const title = texts.title.trim();
  const settledTexts = useDebounced(`${texts.title}\n${texts.subtitle}\n${author}`, 250);

  const label = product?.typeName;
  // La couverture en grand, telle qu'elle sera téléchargée : sur son illustration, ou typographique.
  useEffect(() => {
    let cancelled = false;
    const [coverTitle = '', subtitle = '', coverAuthor = ''] = settledTexts.split('\n');
    composeCoverFor({ imageUrl, text: { title: coverTitle, subtitle, author: coverAuthor, label }, seed: subjectId })
      .then((canvas) => {
        if (!cancelled) setComposed(canvas.toDataURL('image/jpeg', 0.9));
      })
      .catch(() => {
        if (!cancelled) setComposed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, settledTexts, label, subjectId]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadBookCover({ imageUrl, text: { title, subtitle: texts.subtitle, author, label }, seed: subjectId });
    } catch {
      toast.error('La couverture n’a pas pu être téléchargée', { description: 'Relancez le téléchargement.' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <div className="order-2 space-y-3 lg:order-1">
        <div className="mx-auto w-full max-w-[17rem] overflow-hidden rounded-lg border bg-slate-900 shadow-sm" style={{ aspectRatio: '1 / 1.414' }}>
          {composed ? (
            <ZoomableImage
              src={composed}
              alt={title ? `Couverture de « ${title} »` : 'Couverture du livre'}
              className="size-full"
              imageClassName="size-full object-cover"
            />
          ) : (
            // Le temps de la composer en grand : la même couverture, dessinée par la page.
            <BookCover title={title || 'Le titre de votre livre'} subtitle={texts.subtitle} author={author} label={label} imageUrl={imageUrl} seed={subjectId} className="size-full rounded-none shadow-none ring-0" />
          )}
        </div>
        <div className="mx-auto flex max-w-[17rem] flex-col gap-2">
          <Button onClick={() => void download()} disabled={downloading || title.length < 2}>
            {downloading ? <Spinner /> : <Download />}
            Télécharger la couverture
          </Button>
          {imageUrl && (
            <Button asChild variant="ghost" size="sm">
              <a href={imageUrl} download={`${toFileSlug(title, 'livre')}-illustration`}>
                <ImageDown />
                L’illustration seule, sans titre
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="order-1 space-y-4 lg:order-2">
        {products.length > 0 && (
          <Field>
            <FieldLabel htmlFor="livre-source">Pour quel livre ?</FieldLabel>
            <Select value={source} onValueChange={setChosen}>
              <SelectTrigger id="livre-source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {products.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </SelectItem>
                ))}
                <SelectItem value={FREE}>Un autre livre</SelectItem>
              </SelectContent>
            </Select>
            {product && <FieldDescription>Cette couverture est aussi celle du PDF de ce produit, dans le Studio.</FieldDescription>}
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="livre-titre">Titre</FieldLabel>
          <Input
            id="livre-titre"
            value={texts.title}
            onChange={(event) => setTexts({ title: event.target.value })}
            maxLength={200}
            placeholder="Ex. Le Pack Animateur : études prêtes à l’emploi"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="livre-sous-titre">Sous-titre (facultatif)</FieldLabel>
          <Input
            id="livre-sous-titre"
            value={texts.subtitle}
            onChange={(event) => setTexts({ subtitle: event.target.value })}
            maxLength={300}
            placeholder="La promesse du livre, en une phrase"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="livre-auteur">Auteur (facultatif)</FieldLabel>
          <Input id="livre-auteur" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={80} placeholder="Votre nom ou celui de votre marque" />
        </Field>

        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-semibold">Illustration</p>
          <CoverGenerator
            key={subjectId}
            subject="product"
            subjectId={subjectId}
            title={title}
            subtitle={texts.subtitle}
            book={product ? { audience: product.targetAudience, promise: product.transformationPromise, chapters: product.tableOfContents.map((module) => module.title) } : undefined}
            hidePreview
            onChange={(next) => {
              setCover(next);
              // Un produit du Studio : sa carte et son PDF prennent aussitôt la nouvelle illustration.
              if (product) rememberProductCover(product.id, next);
            }}
          />
        </div>
      </div>
    </div>
  );
}
