import { useState, type ReactNode } from 'react';
import { AlertTriangle, Download, ImageIcon, Info, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/shared/components/PageHeader';
import { awarenessLabel } from '@/shared/lib/awareness';
import { ComplianceBlockedError } from '@/shared/lib/complianceGate';
import {
  PAGE_SECTIONS,
  type PageVariant,
  buildPageModel,
  emptyPageDraft,
  hasVariantB,
  missingForExport,
} from '@/modules/pages-produits/productPage';
import { PageIncompleteError, exportProductPage } from '@/modules/pages-produits/productPageExport';
import { safeHttpsUrl } from '@/shared/lib/safeUrl';
import { useProductDrafts } from '@/shared/stores/useProductDrafts';
import { useProductPageDrafts } from '@/modules/pages-produits/useProductPageDrafts';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import type { ReportComplianceVerdict } from '@/shared/types/compliance';
import type { ProductPageDraft, SectionRole } from '@/shared/types/productPage';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ComplianceBlockDialog } from '@/shared/components/ComplianceBlockDialog';
import { Field, FieldError, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { NoDataState } from '@/shared/components/NoDataState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Générateur de pages produits.
 *
 * Contenu, public et offre viennent du produit du Studio (sa version retouchée
 * en mode Expert si elle existe). Le reste est saisi par l'auteur : aucune
 * section n'est remplie à sa place, et aucun témoignage n'est proposé.
 */

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const sectionAnchor = (role: SectionRole) => `page-section-${role}`;

export function ProductPageBuilderView({ products }: { products: DigitalProductIdea[] }) {
  const productDrafts = useProductDrafts();
  const pageDrafts = useProductPageDrafts();

  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [previewVariant, setPreviewVariant] = useState<PageVariant>('A');
  const [exporting, setExporting] = useState<PageVariant | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  const baseProduct = products.find((candidate) => candidate.id === productId) ?? products[0];

  if (!baseProduct) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Créer" title="Pages produits" />
        <NoDataState
          icon={LayoutTemplate}
          title="Aucun produit dans ce rapport"
          reason="Le générateur de pages part d’un produit du Studio. Choisissez une niche qui en propose un."
        />
      </div>
    );
  }

  const product = productDrafts.effective(baseProduct);
  const draft = pageDrafts.get(product.id) ?? emptyPageDraft(product);
  const update = (changes: Partial<ProductPageDraft>) => pageDrafts.save({ ...draft, ...changes });
  const updateImage = (role: SectionRole, url: string) => update({ images: { ...draft.images, [role]: url } });

  const model = buildPageModel(product, draft, previewVariant);
  const missing = missingForExport(draft);
  const variantB = hasVariantB(draft);
  const checkoutInvalid = Boolean(draft.checkoutUrl) && !safeHttpsUrl(draft.checkoutUrl);

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

  const sectionInputs: Record<SectionRole, ReactNode> = {
    hero: (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="page-headline-a">Accroche · variante A</FieldLabel>
          <Input id="page-headline-a" value={draft.headlineA} onChange={(event) => update({ headlineA: event.target.value })} maxLength={160} />
        </Field>
        <Field>
          <FieldLabel htmlFor="page-headline-b">Accroche · variante B</FieldLabel>
          <Input
            id="page-headline-b"
            value={draft.headlineB}
            onChange={(event) => update({ headlineB: event.target.value })}
            maxLength={160}
            placeholder="facultatif"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="page-cta-a">Bouton · variante A</FieldLabel>
          <Input id="page-cta-a" value={draft.ctaLabelA} onChange={(event) => update({ ctaLabelA: event.target.value })} maxLength={60} />
        </Field>
        <Field>
          <FieldLabel htmlFor="page-cta-b">Bouton · variante B</FieldLabel>
          <Input
            id="page-cta-b"
            value={draft.ctaLabelB}
            onChange={(event) => update({ ctaLabelB: event.target.value })}
            maxLength={60}
            placeholder="facultatif"
          />
        </Field>
        <Field data-invalid={checkoutInvalid} className="sm:col-span-2">
          <FieldLabel htmlFor="page-checkout">Lien de paiement (https, obligatoire)</FieldLabel>
          <Input
            id="page-checkout"
            type="url"
            inputMode="url"
            value={draft.checkoutUrl}
            onChange={(event) => update({ checkoutUrl: event.target.value })}
            placeholder="https://… la page de votre produit sur Chariow"
            aria-invalid={checkoutInvalid}
          />
          {checkoutInvalid && <FieldError>Lien invalide : seul un lien https est accepté.</FieldError>}
        </Field>
      </div>
    ),
    problem: (
      <Field>
        <FieldLabel htmlFor="page-problem">Le problème vécu par votre lecteur (obligatoire)</FieldLabel>
        <Textarea id="page-problem" value={draft.problem} onChange={(event) => update({ problem: event.target.value })} rows={4} maxLength={2000} />
      </Field>
    ),
    solution: (
      <p className="text-sm leading-relaxed text-muted-foreground">
        Reprend la promesse de transformation du produit : « {product.transformationPromise} »
      </p>
    ),
    content: (
      <p className="text-sm text-muted-foreground">
        Reprend les {product.tableOfContents.length} modules du produit, modifiables en mode Expert dans le Studio.
      </p>
    ),
    audience: (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">Public repris du produit : « {product.targetAudience} »</p>
        <Field>
          <FieldLabel htmlFor="page-not-for">Pour qui ce n’est pas (facultatif)</FieldLabel>
          <Textarea id="page-not-for" value={draft.notFor} onChange={(event) => update({ notFor: event.target.value })} rows={2} maxLength={1000} />
        </Field>
      </div>
    ),
    offer: (
      <div className="space-y-3">
        <Field>
          <FieldLabel htmlFor="page-price">Prix affiché</FieldLabel>
          <Input
            id="page-price"
            value={draft.price ?? ''}
            onChange={(event) => update({ price: event.target.value })}
            maxLength={60}
            placeholder={product.recommendedPrice !== null ? model.price : 'ex. 5 000 FCFA'}
          />
          <p className="text-xs text-muted-foreground">
            {product.recommendedPrice !== null
              ? 'Vide : le prix du produit est repris.'
              : 'Le produit n’a pas de prix : indiquez le vôtre, ou laissez vide pour ne pas en afficher.'}
            {product.leadMagnet.title ? <> Bonus repris : « {product.leadMagnet.title} ».</> : null}
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor="page-conditions">Conditions (remboursement, accès…) — facultatif</FieldLabel>
          <Textarea
            id="page-conditions"
            value={draft.offerConditions}
            onChange={(event) => update({ offerConditions: event.target.value })}
            rows={2}
            maxLength={1000}
          />
        </Field>
      </div>
    ),
    faq_cta: (
      <div className="space-y-3">
        {draft.faq.map((item, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border p-3">
            <div className="space-y-2">
              <Input
                value={item.question}
                onChange={(event) =>
                  update({ faq: draft.faq.map((faq, i) => (i === index ? { ...faq, question: event.target.value } : faq)) })
                }
                placeholder="Question"
                maxLength={200}
                aria-label={`Question ${index + 1}`}
              />
              <Textarea
                value={item.answer}
                onChange={(event) =>
                  update({ faq: draft.faq.map((faq, i) => (i === index ? { ...faq, answer: event.target.value } : faq)) })
                }
                placeholder="Réponse"
                rows={2}
                maxLength={1000}
                aria-label={`Réponse ${index + 1}`}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => update({ faq: draft.faq.filter((_faq, i) => i !== index) })}
              aria-label={`Supprimer la question ${index + 1}`}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => update({ faq: [...draft.faq, { question: '', answer: '' }] })}>
          <Plus />
          Ajouter une question
        </Button>
      </div>
    ),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Créer"
        title="Pages produits"
        description="Une page de vente en 7 sections, chacune avec son rôle, exportée en HTML autonome."
        actions={
          <Field className="w-full sm:w-72">
            <FieldLabel htmlFor="page-product">Produit</FieldLabel>
            <Select value={baseProduct.id} onValueChange={setProductId}>
              <SelectTrigger id="page-product" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {products.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {productDrafts.effective(candidate).title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        }
      />

      <Alert variant="info">
        <Info />
        <AlertDescription>
          Aucun témoignage n’est proposé : une page ne doit en montrer que s’ils sont réels et vérifiables. Pour le test
          A/B, les deux fichiers ne diffèrent que par l’accroche et le bouton ; la répartition du trafic et la mesure se
          font sur l’outil qui héberge la page.
        </AlertDescription>
      </Alert>

      {pageDrafts.writeFailed && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>
            Vos saisies n’ont pas pu être enregistrées sur votre compte (connexion interrompue ?). Réessayez dans un
            instant ; en cas de doute, exportez la page avant de fermer l’onglet.
          </AlertDescription>
        </Alert>
      )}

      <nav aria-label="Sections de la page" className="flex flex-wrap gap-2">
        {PAGE_SECTIONS.map((section, index) => (
          <Button key={section.role} variant="outline" size="sm" asChild>
            <a href={`#${sectionAnchor(section.role)}`}>
              <span className="text-muted-foreground tabular-nums">{index + 1}</span>
              {section.label}
            </a>
          </Button>
        ))}
      </nav>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          {PAGE_SECTIONS.map((section, index) => (
            <Card key={section.role} id={sectionAnchor(section.role)} className="scroll-mt-20 gap-4 py-5">
              <CardHeader className="px-5">
                <CardDescription className="font-medium text-brand-green-text">
                  Section {index + 1} · {section.label}
                </CardDescription>
                <CardTitle className="text-sm font-normal text-muted-foreground">{section.purpose}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 px-5">
                {sectionInputs[section.role]}

                <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                    Image · {awarenessLabel(section.awarenessLevel)}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{section.imageBrief}</p>
                  <Input
                    type="url"
                    inputMode="url"
                    value={draft.images[section.role] ?? ''}
                    onChange={(event) => updateImage(section.role, event.target.value)}
                    placeholder="Lien https de l’image (facultatif)"
                    aria-label={`Image de la section ${section.label}`}
                  />
                  {draft.images[section.role] && !safeHttpsUrl(draft.images[section.role]) && (
                    <p className="text-xs text-warning">Image ignorée : seul un lien https est accepté.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Aperçu</p>
            <div className="inline-flex rounded-lg border bg-muted/50 p-1" role="group" aria-label="Variante affichée">
              {(['A', 'B'] as const).map((variant) => (
                <Button
                  key={variant}
                  size="sm"
                  variant={previewVariant === variant ? 'secondary' : 'ghost'}
                  aria-pressed={previewVariant === variant}
                  onClick={() => setPreviewVariant(variant)}
                  disabled={variant === 'B' && !variantB}
                >
                  Variante {variant}
                </Button>
              ))}
            </div>
          </div>

          <article className="max-h-[65vh] space-y-6 overflow-y-auto rounded-xl border bg-card p-6 shadow-sm" tabIndex={0} aria-label="Aperçu de la page">
            {PAGE_SECTIONS.map((section) => {
              const imageUrl = model.images[section.role];
              return (
                <div key={section.role} className="space-y-2 border-b pb-5 last:border-0">
                  {imageUrl && (
                    <div className="flex h-24 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                      Image : {hostname(imageUrl)}
                    </div>
                  )}
                  {section.role === 'hero' && (
                    <div className="space-y-3 text-center">
                      <h2 className="font-display text-xl font-extrabold">{model.headline}</h2>
                      {model.subtitle && <p className="text-sm text-muted-foreground">{model.subtitle}</p>}
                      <span className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                        {model.ctaLabel}
                      </span>
                    </div>
                  )}
                  {section.role === 'problem' &&
                    (model.problem ? (
                      <p className="text-sm whitespace-pre-line">{model.problem}</p>
                    ) : (
                      <p className="text-sm text-warning italic">Section « Problème » à rédiger.</p>
                    ))}
                  {section.role === 'solution' && <p className="text-sm">{model.promise}</p>}
                  {section.role === 'content' && (
                    <ol className="list-decimal space-y-1 pl-5 text-sm">
                      {model.modules.map((module, index) => (
                        <li key={`${module.number}-${index}`}>{module.title}</li>
                      ))}
                    </ol>
                  )}
                  {section.role === 'audience' && (
                    <p className="text-sm">
                      {model.audience}
                      {model.notFor && <span className="block pt-1 text-muted-foreground">Pas pour : {model.notFor}</span>}
                    </p>
                  )}
                  {section.role === 'offer' && <p className="font-display text-lg font-extrabold tabular-nums">{model.price}</p>}
                  {section.role === 'faq_cta' && (
                    <p className="text-sm text-muted-foreground">
                      {model.faq.length} question(s) · bouton « {model.ctaLabel} »
                    </p>
                  )}
                </div>
              );
            })}
          </article>

          <Card className="py-5">
            <CardContent className="space-y-3">
              {missing.length > 0 && (
                <ul className="space-y-1">
                  {missing.map((item) => (
                    <li key={item} className="flex items-start gap-1.5 text-sm text-warning">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-2">
                {(['A', 'B'] as const)
                  .filter((variant) => variant === 'A' || variantB)
                  .map((variant) => (
                    <Button key={variant} onClick={() => handleExport(variant)} disabled={missing.length > 0 || exporting !== null}>
                      {exporting === variant ? <Spinner /> : <Download />}
                      Télécharger la variante {variant} (HTML)
                    </Button>
                  ))}
              </div>

              {exportError && (
                <Alert variant="danger">
                  <AlertTriangle />
                  <AlertDescription>{exportError}</AlertDescription>
                </Alert>
              )}

              <p className="text-xs leading-relaxed text-muted-foreground">
                Chaque export passe la conformité sur les deux variantes et inclut la mention légale. Le fichier ne contient
                aucun script ; ses images sont chargées depuis vos liens https.
              </p>
            </CardContent>
          </Card>
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
}
