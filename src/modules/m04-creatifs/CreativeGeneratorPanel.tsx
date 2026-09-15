import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clapperboard, Download, Image as ImageIcon, PenLine, ShieldCheck, Sparkles } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { AWARENESS_OPTIONS } from '@/shared/lib/awareness';
import { MARKETS } from '@/shared/lib/markets';
import { cn } from '@/shared/lib/utils';
import type { AwarenessLevel, CreativeFormat, CreativeKind, CreativeStatus } from '@/shared/types/creatives';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Génération de visuels et de vidéos publicitaires.
 *
 * - Le niveau de conscience du prospect est obligatoire, et rien n'est
 *   présélectionné : une valeur par défaut serait retenue par inadvertance.
 * - Conformité en deux temps. Le texte du brief est vérifié par le serveur avant
 *   toute génération — c'est un blocage réel. Le contenu visuel, qu'aucun outil
 *   ne relit de façon fiable, doit être regardé puis attesté par l'auteur avant
 *   que le téléchargement soit proposé.
 */

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS: Record<CreativeKind, number> = { visual: 10 * 60_000, video: 20 * 60_000 };
const FAILED_STATUSES: CreativeStatus['status'][] = ['failed', 'nsfw', 'canceled'];

const FORMAT_OPTIONS: { value: CreativeFormat; label: string }[] = [
  { value: '1:1', label: 'Carré 1:1' },
  { value: '9:16', label: 'Vertical 9:16' },
  { value: '16:9', label: 'Horizontal 16:9' },
];

/** Contrôles que l'auteur atteste avoir faits en regardant le fichier généré. */
const ATTESTATIONS = [
  "Il n'affiche aucune promesse de gain chiffrée ni garantie de résultat.",
  'Il ne met en scène ni avant/après trompeur, ni témoignage inventé.',
  'Tout texte visible est lisible, exact et conforme à mon brief.',
  'Il ne montre ni logo de marque tierce, ni personne réelle identifiable sans son accord.',
];

const PROGRESS_LABELS: Partial<Record<CreativeStatus['status'], string>> = {
  queued: 'En file d’attente chez le fournisseur…',
  in_progress: 'Génération en cours…',
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function CreativeGeneratorPanel() {
  const { runWithCredits } = useCreditGate();

  const [kind, setKind] = useState<CreativeKind>('visual');
  const [productName, setProductName] = useState('');
  const [awarenessLevel, setAwarenessLevel] = useState<AwarenessLevel | null>(null);
  const [format, setFormat] = useState<CreativeFormat>('9:16');
  const [market, setMarket] = useState('CI');
  const [audience, setAudience] = useState('');
  const [sceneDescription, setSceneDescription] = useState('');
  const [onScreenText, setOnScreenText] = useState('');
  const [visualStyle, setVisualStyle] = useState('');
  const [duration, setDuration] = useState<5 | 10>(5);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<CreativeStatus['status'] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ requestId: string; mediaType: 'image' | 'video' } | null>(null);
  const [attested, setAttested] = useState<boolean[]>(() => ATTESTATIONS.map(() => false));

  // Remis à false au montage : en mode strict, React démonte et remonte une fois.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const sceneMax = kind === 'visual' ? 600 : 1500;
  const canSubmit =
    productName.trim().length > 0 && awarenessLevel !== null && sceneDescription.trim().length >= 3 && !isGenerating;
  const allAttested = attested.every(Boolean);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !awarenessLevel) return;

    const generationKind = kind;
    const body = {
      productName: productName.trim(),
      awarenessLevel,
      format,
      market,
      sceneDescription: sceneDescription.trim().slice(0, sceneMax),
      ...(audience.trim() ? { audience: audience.trim() } : {}),
      ...(onScreenText.trim() ? { onScreenText: onScreenText.trim() } : {}),
      ...(visualStyle.trim() ? { visualStyle: visualStyle.trim() } : {}),
      ...(generationKind === 'video' ? { duration } : {}),
    };

    setError(null);
    setResult(null);
    setAttested(ATTESTATIONS.map(() => false));

    try {
      // Points réservés par le serveur au lancement, puis rendus automatiquement si
      // la génération échoue ou si le filtre de sécurité du fournisseur la refuse.
      await runWithCredits(generationKind === 'visual' ? 'image_generation' : 'video_generation', async () => {
        setIsGenerating(true);
        setProgress('queued');

        try {
          const submitted = await fetch(`/api/creatives/${generationKind === 'visual' ? 'visuals' : 'videos'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!submitted.ok) throw await readApiError(submitted, `La demande a échoué (${submitted.status}).`);

          let status = (await submitted.json()) as CreativeStatus;
          const deadline = Date.now() + MAX_WAIT_MS[generationKind];

          while (status.status !== 'completed') {
            if (FAILED_STATUSES.includes(status.status)) {
              throw new ApiError(status.message ?? 'La génération a échoué.');
            }
            if (Date.now() > deadline) {
              throw new ApiError(
                "La génération dépasse le délai d'attente : suivi abandonné sur cet écran. Si elle échoue chez le fournisseur, vos points vous seront rendus automatiquement.",
              );
            }

            await wait(POLL_INTERVAL_MS);
            if (unmountedRef.current) {
              throw new ApiError("Suivi interrompu : l'écran a été quitté pendant la génération.");
            }

            const polled = await fetch(`/api/creatives/requests/${encodeURIComponent(status.requestId)}`);
            if (!polled.ok) throw await readApiError(polled, `Le suivi a échoué (${polled.status}).`);
            status = (await polled.json()) as CreativeStatus;
            setProgress(status.status);
          }

          if (!status.mediaType) {
            throw new ApiError("La génération s'est terminée sans produire de fichier.");
          }
          setResult({ requestId: status.requestId, mediaType: status.mediaType });
        } finally {
          if (!unmountedRef.current) {
            setIsGenerating(false);
            setProgress(null);
          }
        }
      });
    } catch (caught) {
      if (!unmountedRef.current) setError(toApiError(caught, 'La génération a échoué.'));
    }
  };

  const fileUrl = (disposition: 'inline' | 'attachment') =>
    result ? `/api/creatives/requests/${encodeURIComponent(result.requestId)}/file?disposition=${disposition}` : '';

  const choiceClass = (active: boolean) =>
    cn('flex-1 whitespace-normal', active && 'border-primary bg-accent text-accent-foreground hover:bg-accent');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Générer un visuel ou une vidéo</CardTitle>
        <CardDescription>Un créatif publicitaire orienté par le niveau de conscience de votre prospect.</CardDescription>
        <CardAction>
          <div className="inline-flex rounded-lg border bg-muted/50 p-1" role="group" aria-label="Type de créatif">
            <Button
              size="sm"
              variant={kind === 'visual' ? 'secondary' : 'ghost'}
              aria-pressed={kind === 'visual'}
              onClick={() => setKind('visual')}
              disabled={isGenerating}
            >
              <ImageIcon />
              Visuel
            </Button>
            <Button
              size="sm"
              variant={kind === 'video' ? 'secondary' : 'ghost'}
              aria-pressed={kind === 'video'}
              onClick={() => setKind('video')}
              disabled={isGenerating}
            >
              <Clapperboard />
              Vidéo
            </Button>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
              Niveau de conscience du prospect
              <Badge variant="outline">obligatoire</Badge>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {AWARENESS_OPTIONS.map((option) => {
                const isActive = awarenessLevel === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'cursor-pointer rounded-lg border p-3 transition-colors hover:border-primary/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                      isActive && 'border-primary bg-accent/60',
                    )}
                  >
                    <input
                      type="radio"
                      name="awareness"
                      value={option.value}
                      checked={isActive}
                      onChange={() => setAwarenessLevel(option.value)}
                      className="sr-only"
                    />
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="creative-product">Produit</FieldLabel>
              <Input
                id="creative-product"
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                maxLength={120}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="creative-market">Marché</FieldLabel>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger id="creative-market" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETS.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Format</legend>
              <div className="flex gap-1.5">
                {FORMAT_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={format === option.value}
                    onClick={() => setFormat(option.value)}
                    className={choiceClass(format === option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </fieldset>

            <Field className="sm:col-span-3">
              <FieldLabel htmlFor="creative-scene">Scène à représenter</FieldLabel>
              <Textarea
                id="creative-scene"
                value={sceneDescription}
                onChange={(event) => setSceneDescription(event.target.value)}
                rows={3}
                maxLength={sceneMax}
                placeholder="ex. une commerçante vérifie ses ventes du jour sur son téléphone, au marché, en fin d’après-midi"
              />
              <FieldDescription className="tabular-nums">
                {sceneDescription.length} / {sceneMax} caractères
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="creative-audience">Public visé</FieldLabel>
              <Input
                id="creative-audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
                maxLength={300}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="creative-text">Texte à l’écran</FieldLabel>
              <Input
                id="creative-text"
                value={onScreenText}
                onChange={(event) => setOnScreenText(event.target.value)}
                maxLength={120}
                placeholder="facultatif — sinon aucun texte"
              />
            </Field>

            {kind === 'video' ? (
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Durée</legend>
                <div className="flex gap-1.5">
                  {([5, 10] as const).map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={duration === value}
                      onClick={() => setDuration(value)}
                      className={choiceClass(duration === value)}
                    >
                      {value} s
                    </Button>
                  ))}
                </div>
              </fieldset>
            ) : (
              <Field>
                <FieldLabel htmlFor="creative-style">Style visuel</FieldLabel>
                <Input
                  id="creative-style"
                  value={visualStyle}
                  onChange={(event) => setVisualStyle(event.target.value)}
                  maxLength={300}
                  placeholder="facultatif"
                />
              </Field>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Le brief passe le vérificateur de conformité avant l’envoi. Le coût en points s’affiche avant validation ;
              restez sur cet écran pendant la génération.
              {!awarenessLevel && (
                <span className="mt-1 block text-warning">Choisissez le niveau de conscience du prospect pour continuer.</span>
              )}
            </p>
            <Button type="submit" disabled={!canSubmit} className="shrink-0">
              {isGenerating ? <Spinner /> : <Sparkles />}
              {isGenerating ? 'Génération en cours…' : kind === 'visual' ? 'Générer le visuel' : 'Générer la vidéo'}
            </Button>
          </div>
        </form>

        {isGenerating && progress && (
          <Alert variant="info" role="status">
            <Spinner />
            <AlertDescription>{PROGRESS_LABELS[progress] ?? 'Génération en cours…'}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="danger">
            <AlertTriangle />
            <AlertTitle>La génération n’a pas abouti</AlertTitle>
            <AlertDescription>
              <p>{error.message}</p>
              {error.findings.length > 0 && (
                <ul className="mt-2 w-full space-y-2">
                  {error.findings.map((finding, index) => (
                    <li key={`${finding.category}-${index}`} className="rounded-md border border-danger-border bg-card p-3">
                      <p className="text-xs font-semibold tracking-wider text-danger uppercase">{finding.category}</p>
                      <p className="mt-1 font-medium">« {finding.matched} »</p>
                      <p className="mt-1.5 flex items-start gap-1.5 text-muted-foreground">
                        <PenLine className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        {finding.rewriteHint}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}

        {result && (
          <div className="grid gap-5 rounded-xl border bg-muted/30 p-4 lg:grid-cols-2">
            <div className="flex items-center justify-center overflow-hidden rounded-lg bg-muted">
              {result.mediaType === 'video' ? (
                <video src={fileUrl('inline')} controls className="max-h-96 w-full object-contain" />
              ) : (
                <img src={fileUrl('inline')} alt="Créatif généré" className="max-h-96 w-full object-contain" />
              )}
            </div>

            <div className="space-y-3">
              <h3 className="flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="size-4 text-brand-green-text" aria-hidden="true" />
                Contrôle avant téléchargement
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Le texte de votre brief a passé la conformité. Le contenu généré, lui, ne peut pas être relu
                automatiquement : regardez-le, puis confirmez chaque point.
              </p>

              <ul className="space-y-2.5">
                {ATTESTATIONS.map((statement, index) => (
                  <li key={statement} className="flex items-start gap-2.5">
                    <Checkbox
                      id={`attestation-${index}`}
                      checked={attested[index]}
                      onCheckedChange={(checked) =>
                        setAttested((previous) => previous.map((value, i) => (i === index ? checked === true : value)))
                      }
                      className="mt-0.5"
                    />
                    <Label htmlFor={`attestation-${index}`} className="text-sm leading-relaxed font-normal">
                      {statement}
                    </Label>
                  </li>
                ))}
              </ul>

              {allAttested ? (
                <Button asChild>
                  <a href={fileUrl('attachment')}>
                    <Download />
                    Télécharger le fichier
                  </a>
                </Button>
              ) : (
                <Button disabled>
                  <Download />
                  Cochez les quatre points pour télécharger
                </Button>
              )}

              <p className="text-xs leading-relaxed text-muted-foreground">
                Le fournisseur ne conserve le fichier qu’environ sept jours : téléchargez-le pour le garder.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
