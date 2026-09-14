import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Download, ExternalLink, Info, Plus, Rocket, Trash2, Wand2 } from 'lucide-react';
import { PageHeader } from '@/shared/components/PageHeader';
import { type ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { ComplianceBlockedError } from '@/shared/lib/complianceGate';
import { formatDateFr } from '@/shared/lib/formatDate';
import { KitIncompleteError, OBJECTIVE_LABELS, exportLaunchKit, missingForKit } from '@/shared/lib/launchKit';
import { MARKETS } from '@/shared/lib/markets';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { MAX_COPY_VARIANTS, emptyKitDraft, useLaunchKitDrafts } from '@/shared/lib/useLaunchKitDrafts';
import { useProductDrafts } from '@/shared/lib/useProductDrafts';
import { cn } from '@/shared/lib/utils';
import type { MarketAnalysisReport } from '@/shared/types/analysis';
import type { ReportComplianceVerdict } from '@/shared/types/compliance';
import type { AdCopyVariant, BeatText, KitObjective, LaunchKitConfig, LaunchKitDraft } from '@/shared/types/launchKit';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ComplianceBlockDialog } from '@/shared/ui/ComplianceBlockDialog';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { NoDataState } from '@/shared/ui/NoDataState';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Kit de lancement.
 *
 * Aucun fournisseur de texte n'est branché : le kit structure, pré-remplit depuis
 * le produit réel et contrôle, mais n'écrit pas à la place de l'auteur.
 *
 * Les boutons d'appel à l'action ne sont demandés que pour les marchés choisis :
 * l'ancienne version affichait d'un coup 17 menus « non concerné ».
 */

const NO_BUTTON = '__aucun';

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function LaunchKitView({ report }: { report: MarketAnalysisReport }) {
  const productDrafts = useProductDrafts();
  const kitDrafts = useLaunchKitDrafts();

  const [config, setConfig] = useState<LaunchKitConfig | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [productId, setProductId] = useState(report.digitalProducts[0]?.id ?? '');
  const [duration, setDuration] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/launch-kit/config')
      .then(async (response) => {
        if (!response.ok) throw await readApiError(response, `Le kit n'a pas pu être chargé (${response.status}).`);
        return (await response.json()) as LaunchKitConfig;
      })
      .then((payload) => {
        if (cancelled) return;
        setConfig(payload);
        setDuration((current) => current ?? payload.scriptFormats[0]?.durationSeconds ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(toApiError(caught, "Le kit n'a pas pu être chargé."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const baseProduct = report.digitalProducts.find((candidate) => candidate.id === productId) ?? report.digitalProducts[0];

  if (!baseProduct) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Vendre" title="Kit de lancement" />
        <NoDataState
          icon={Rocket}
          title="Aucun produit dans ce rapport"
          reason="Le kit de lancement part d’un produit du Studio. Choisissez une niche qui en propose un."
        />
      </div>
    );
  }

  const product = productDrafts.effective(baseProduct);
  const draft = kitDrafts.get(product.id) ?? emptyKitDraft(product.id);
  const update = (changes: Partial<LaunchKitDraft>) => kitDrafts.save({ ...draft, ...changes });

  const updateCopy = (index: number, changes: Partial<AdCopyVariant>) =>
    update({ copies: draft.copies.map((copy, i) => (i === index ? { ...copy, ...changes } : copy)) });

  const updateBeat = (seconds: number, beatId: string, changes: Partial<BeatText>) => {
    const key = String(seconds);
    const beats = draft.scripts[key] ?? {};
    const current = beats[beatId] ?? { onScreen: '', voiceOver: '' };
    update({ scripts: { ...draft.scripts, [key]: { ...beats, [beatId]: { ...current, ...changes } } } });
  };

  /** Pré-remplit la première variante depuis le produit réel, sans écraser une saisie. */
  const prefillFromProduct = () => {
    const [first, ...rest] = draft.copies;
    if (!first) return;
    update({
      copies: [
        {
          primaryText: first.primaryText || product.transformationPromise,
          headline: first.headline || product.title,
          description: first.description || product.subtitle,
        },
        ...rest,
      ],
    });
  };

  /** Un marché est ciblé dès qu'il figure dans la table, même sans bouton choisi. */
  const toggleMarket = (code: string) => {
    const next = { ...draft.ctaByMarket };
    if (code in next) delete next[code];
    else next[code] = '';
    update({ ctaByMarket: next });
  };

  const handleExport = async () => {
    if (!config) return;
    setIsExporting(true);
    setExportError(null);
    try {
      await exportLaunchKit(product, draft, config);
    } catch (error) {
      if (error instanceof ComplianceBlockedError) {
        setBlockedVerdict(error.verdict);
        return;
      }
      if (error instanceof KitIncompleteError) {
        setExportError(error.missing.join(' '));
        return;
      }
      setExportError(error instanceof Error ? error.message : "L'export a échoué.");
    } finally {
      setIsExporting(false);
    }
  };

  const platform = config?.ctaPlatforms[0];
  const format = config?.scriptFormats.find((candidate) => candidate.durationSeconds === duration);
  const missing = missingForKit(draft);
  const targetedMarkets = MARKETS.filter((market) => market.code in draft.ctaByMarket);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vendre"
        title="Kit de lancement"
        description="Textes publicitaires, scripts de 15, 30 et 60 secondes, et boutons d’appel à l’action par marché."
        actions={
          <Field className="w-full sm:w-72">
            <FieldLabel htmlFor="kit-product">Produit</FieldLabel>
            <Select value={baseProduct.id} onValueChange={setProductId}>
              <SelectTrigger id="kit-product" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {report.digitalProducts.map((candidate) => (
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
          Aucun fournisseur de rédaction n’est branché : le kit vous guide et contrôle vos textes, il ne les écrit pas.
          Le pré-remplissage reprend uniquement les données de votre produit.
        </AlertDescription>
      </Alert>

      {loadError && (
        <Alert variant="danger">
          <AlertTriangle />
          <AlertTitle>Kit indisponible</AlertTitle>
          <AlertDescription>{loadError.message}</AlertDescription>
        </Alert>
      )}

      {config?.valuesStatus && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>{config.valuesStatus}</AlertDescription>
        </Alert>
      )}

      <Card className="py-5">
        <CardContent>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Objectif de la campagne</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(OBJECTIVE_LABELS) as KitObjective[]).map((objective) => (
                <Button
                  key={objective}
                  type="button"
                  size="sm"
                  variant={draft.objective === objective ? 'secondary' : 'outline'}
                  aria-pressed={draft.objective === objective}
                  onClick={() => update({ objective })}
                  className={cn(draft.objective === objective && 'border-primary/40 text-brand-green-text')}
                >
                  {OBJECTIVE_LABELS[objective]}
                </Button>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Textes publicitaires</CardTitle>
          <CardDescription>
            Jusqu’à {MAX_COPY_VARIANTS} variantes à tester l’une contre l’autre.
          </CardDescription>
          <CardAction className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={prefillFromProduct}>
              <Wand2 />
              Pré-remplir
            </Button>
            {draft.copies.length < MAX_COPY_VARIANTS && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => update({ copies: [...draft.copies, { primaryText: '', headline: '', description: '' }] })}
              >
                <Plus />
                Variante
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft.copies.map((copy, index) => (
            <div key={index} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-brand-green-text">Variante {index + 1}</p>
                {draft.copies.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => update({ copies: draft.copies.filter((_copy, i) => i !== index) })}
                    aria-label={`Supprimer la variante ${index + 1}`}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              <Field>
                <FieldLabel htmlFor={`kit-copy-${index}-primary`}>Texte principal</FieldLabel>
                <Textarea
                  id={`kit-copy-${index}-primary`}
                  value={copy.primaryText}
                  onChange={(event) => updateCopy(index, { primaryText: event.target.value })}
                  rows={3}
                  maxLength={2000}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`kit-copy-${index}-headline`}>Titre</FieldLabel>
                  <Input
                    id={`kit-copy-${index}-headline`}
                    value={copy.headline}
                    onChange={(event) => updateCopy(index, { headline: event.target.value })}
                    maxLength={120}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`kit-copy-${index}-description`}>Description</FieldLabel>
                  <Input
                    id={`kit-copy-${index}-description`}
                    value={copy.description}
                    onChange={(event) => updateCopy(index, { description: event.target.value })}
                    maxLength={200}
                  />
                </Field>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {!config && !loadError && <Skeleton className="h-64 rounded-xl" />}

      {config && format && (
        <Card>
          <CardHeader>
            <CardTitle>Scripts vidéo</CardTitle>
            <CardDescription>Chaque temps du script a un rôle et un nombre de mots conseillé pour la voix off.</CardDescription>
            <CardAction>
              <div className="inline-flex flex-wrap rounded-lg border bg-muted/50 p-1" role="group" aria-label="Durée du script">
                {config.scriptFormats.map((candidate) => (
                  <Button
                    key={candidate.durationSeconds}
                    size="sm"
                    variant={duration === candidate.durationSeconds ? 'secondary' : 'ghost'}
                    aria-pressed={duration === candidate.durationSeconds}
                    onClick={() => setDuration(candidate.durationSeconds)}
                  >
                    {candidate.label}
                  </Button>
                ))}
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {format.beats.map((beat) => {
              const text = draft.scripts[String(format.durationSeconds)]?.[beat.id] ?? { onScreen: '', voiceOver: '' };
              const seconds = beat.endSecond - beat.startSecond;
              const maxWords = Math.round(seconds * config.voiceOverWordsPerSecond);
              const words = wordCount(text.voiceOver);
              return (
                <div key={beat.id} className="space-y-3 rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-semibold">
                      <span className="text-brand-green-text tabular-nums">
                        {beat.startSecond}–{beat.endSecond} s
                      </span>{' '}
                      · {beat.label}
                    </p>
                    <p className="text-sm text-muted-foreground">{beat.purpose}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={`beat-${beat.id}-screen`}>Texte à l’écran</FieldLabel>
                      <Textarea
                        id={`beat-${beat.id}-screen`}
                        value={text.onScreen}
                        onChange={(event) => updateBeat(format.durationSeconds, beat.id, { onScreen: event.target.value })}
                        rows={2}
                        maxLength={300}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`beat-${beat.id}-voice`}>Voix off</FieldLabel>
                      <Textarea
                        id={`beat-${beat.id}-voice`}
                        value={text.voiceOver}
                        onChange={(event) => updateBeat(format.durationSeconds, beat.id, { voiceOver: event.target.value })}
                        rows={2}
                        maxLength={600}
                      />
                      <FieldDescription className={cn('tabular-nums', words > maxWords && 'text-warning')}>
                        {words} mot(s) · {maxWords} au plus pour {seconds} s
                      </FieldDescription>
                    </Field>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {platform && (
        <Card>
          <CardHeader>
            <CardTitle>Boutons d’appel à l’action par marché</CardTitle>
            <CardDescription>
              Noms officiels {platform.label}, vérifiés le {formatDateFr(platform.checkedAt)}.{' '}
              {safeHttpUrl(platform.source) && (
                <a
                  href={safeHttpUrl(platform.source) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-brand-green-text underline-offset-4 hover:underline"
                >
                  Source
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">1. Choisissez vos marchés</legend>
              <div className="flex flex-wrap gap-2">
                {MARKETS.map((market) => {
                  const isTargeted = market.code in draft.ctaByMarket;
                  return (
                    <Button
                      key={market.code}
                      type="button"
                      size="sm"
                      variant={isTargeted ? 'secondary' : 'outline'}
                      aria-pressed={isTargeted}
                      onClick={() => toggleMarket(market.code)}
                      className={cn(isTargeted && 'border-primary/40 text-brand-green-text')}
                    >
                      {isTargeted && <Check />}
                      {market.label}
                    </Button>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-2">
              <p className="text-sm font-medium">2. Choisissez un bouton pour chacun</p>
              {targetedMarkets.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun marché sélectionné.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {targetedMarkets.map((market) => {
                    const recommended = platform.buttons.filter((button) => button.recommendedFor.includes(draft.objective));
                    const others = platform.buttons.filter((button) => !button.recommendedFor.includes(draft.objective));
                    const value = draft.ctaByMarket[market.code] || NO_BUTTON;
                    return (
                      <Field key={market.code}>
                        <FieldLabel htmlFor={`cta-${market.code}`}>{market.label}</FieldLabel>
                        <Select
                          value={value}
                          onValueChange={(next) =>
                            update({ ctaByMarket: { ...draft.ctaByMarket, [market.code]: next === NO_BUTTON ? '' : next } })
                          }
                        >
                          <SelectTrigger id={`cta-${market.code}`} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_BUTTON}>Pas encore choisi</SelectItem>
                            <SelectSeparator />
                            <SelectGroup>
                              <SelectLabel>Recommandés : {OBJECTIVE_LABELS[draft.objective]}</SelectLabel>
                              {recommended.map((button) => (
                                <SelectItem key={button.id} value={button.id}>
                                  {button.officialName}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                            <SelectSeparator />
                            <SelectGroup>
                              <SelectLabel>Autres boutons</SelectLabel>
                              {others.map((button) => (
                                <SelectItem key={button.id} value={button.id}>
                                  {button.officialName}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
          <Button onClick={handleExport} disabled={!config || missing.length > 0 || isExporting}>
            {isExporting ? <Spinner /> : <Download />}
            Télécharger le kit (texte)
          </Button>
          {exportError && (
            <Alert variant="danger">
              <AlertTriangle />
              <AlertDescription>{exportError}</AlertDescription>
            </Alert>
          )}
          {kitDrafts.writeFailed && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertDescription>
                Ce navigateur refuse l’enregistrement : exportez le kit avant de fermer l’onglet.
              </AlertDescription>
            </Alert>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Tous les textes et scripts passent le vérificateur de conformité avant le téléchargement. Vos saisies sont
            conservées dans ce navigateur.
          </p>
        </CardContent>
      </Card>

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
