import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clapperboard, Download, Image as ImageIcon, PenLine, ShieldCheck, Sparkles } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { MAX_POLL_MISSES, lostTrackMessage, pollStatus } from '@/shared/lib/polling';
import { AWARENESS_OPTIONS } from '@/shared/lib/awareness';
import { findAdFramework } from '@server/shared/adFrameworks';
import { useAuth } from '@/features/auth/AuthContext';
import { AdFrameworkPicker } from '@/modules/creatifs/AdFrameworkPicker';
import { type Brouillon, CLE_BROUILLON, VIDEO_DURATIONS, VIDEO_FORMATS, type VideoDuration, lireBrouillon } from '@/modules/creatifs/briefDraft';
import { CountryCombobox } from '@/shared/components/CountryCombobox';
import { guessCountryCode } from '@/shared/lib/geo';
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
import { Progress } from '@/shared/ui/progress';
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
  queued: 'En file d’attente…',
  in_progress: 'Génération en cours…',
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Durée de conservation annoncée sous le résultat : l'utilisateur doit savoir jusqu'à quand télécharger. */
function retentionNotice(result: { mediaType: 'image' | 'video'; retentionDays?: number | null; availableUntil?: string }): string {
  if (result.retentionDays === null) return 'Ce fichier est enregistré sur votre compte.';
  if (result.retentionDays === undefined) return 'Ce fichier n’est conservé que quelques jours : téléchargez-le pour le garder.';
  const duree = result.retentionDays === 1 ? '24 heures' : `${result.retentionDays} jours`;
  const jusquau = result.availableUntil
    ? `, jusqu’au ${new Date(result.availableUntil).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
    : '';
  return result.mediaType === 'video'
    ? `Vidéo téléchargeable pendant ${duree}${jusquau} : téléchargez-la pour la garder.`
    : `Fichier téléchargeable pendant ${duree}${jusquau} : téléchargez-le pour le garder.`;
}

/** `onVisualCreated` : un visuel vient d'être enregistré — « Mes visuels » se recharge. */
export function CreativeGeneratorPanel({ onVisualCreated }: { onVisualCreated?: () => void } = {}) {
  const { runWithCredits, costTable } = useCreditGate();
  const extensionCost = costTable?.actions.find((action) => action.id === 'video_extension')?.cost ?? null;

  // Lu une seule fois, au montage : relire le stockage à chaque rendu coûterait pour rien.
  const [initial] = useState(lireBrouillon);

  const [kind, setKind] = useState<CreativeKind>(initial.kind ?? 'visual');
  const [productName, setProductName] = useState(initial.productName ?? '');
  const [awarenessLevel, setAwarenessLevel] = useState<AwarenessLevel | null>(initial.awarenessLevel ?? null);
  const [format, setFormat] = useState<CreativeFormat>(initial.format ?? '9:16');
  const { account } = useAuth();
  const [market, setMarket] = useState(() => initial.market ?? account?.country ?? guessCountryCode() ?? 'CI');
  const [purpose, setPurpose] = useState<'ad' | 'content'>(initial.purpose ?? 'ad');
  const [adFramework, setAdFramework] = useState<string | null>(initial.adFramework ?? null);
  const [frameworkBeats, setFrameworkBeats] = useState<string[]>(initial.frameworkBeats ?? []);
  const [audience, setAudience] = useState(initial.audience ?? '');
  const [sceneDescription, setSceneDescription] = useState(initial.sceneDescription ?? '');
  const [onScreenText, setOnScreenText] = useState(initial.onScreenText ?? '');
  const [visualStyle, setVisualStyle] = useState(initial.visualStyle ?? '');
  const [duration, setDuration] = useState<VideoDuration>(initial.duration ?? 6);

  // Enregistré à chaque changement. Le stockage local est synchrone et bon marché : attendre
  // une pause de frappe ferait perdre les dernières secondes, justement celles d'une coupure.
  useEffect(() => {
    const brouillon: Brouillon = {
      kind,
      productName,
      awarenessLevel,
      format,
      market,
      purpose,
      adFramework,
      frameworkBeats,
      audience,
      sceneDescription,
      onScreenText,
      visualStyle,
      duration,
    };
    try {
      window.localStorage.setItem(CLE_BROUILLON, JSON.stringify(brouillon));
    } catch {
      // Stockage indisponible : le formulaire marche, il ne survivra simplement pas à un rechargement.
    }
  }, [kind, productName, awarenessLevel, format, market, purpose, adFramework, frameworkBeats, audience, sceneDescription, onScreenText, visualStyle, duration]);

  /** Repartir d'une page blanche, sur demande explicite : un brouillon ne s'efface pas tout seul. */
  const nouveauBrief = () => {
    setProductName('');
    setAwarenessLevel(null);
    setAdFramework(null);
    setFrameworkBeats([]);
    setAudience('');
    setSceneDescription('');
    setOnScreenText('');
    setVisualStyle('');
    try {
      window.localStorage.removeItem(CLE_BROUILLON);
    } catch {
      // Sans stockage il n'y a rien à effacer.
    }
  };

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<CreativeStatus['status'] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{
    requestId: string;
    mediaType: 'image' | 'video';
    retentionDays?: number | null;
    availableUntil?: string;
    /** Vidéo Veo : durée totale, et possibilité de la prolonger de 7 s. */
    durationSeconds?: number | null;
    extendable?: boolean;
    maxDurationSeconds?: number;
  } | null>(null);
  /** Premier plan d'une vidéo longue : 8 s en 720p, à prolonger ensuite par étapes. */
  const [longue, setLongue] = useState(false);
  const [sceneSuivante, setSceneSuivante] = useState('');
  const [isExtending, setIsExtending] = useState(false);
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
    productName.trim().length > 0 &&
    awarenessLevel !== null &&
    sceneDescription.trim().length >= 3 &&
    (purpose === 'content' || adFramework !== null) &&
    !isGenerating;
  const allAttested = attested.every(Boolean);

  /** Suit une génération jusqu'à son terme ; lève en cas d'échec, de délai dépassé ou d'écran quitté. */
  const suivre = async (initial: CreativeStatus, generationKind: 'visual' | 'video'): Promise<CreativeStatus> => {
    let status = initial;
    const deadline = Date.now() + MAX_WAIT_MS[generationKind];
    let misses = 0;
    while (status.status !== 'completed') {
      if (FAILED_STATUSES.includes(status.status)) {
        throw new ApiError(status.message ?? 'La génération a échoué.');
      }
      if (Date.now() > deadline) {
        throw new ApiError(
          "La génération prend plus de temps que prévu : retrouvez-la dans vos créations. Si elle échoue, vos points vous seront rendus.",
        );
      }
      await wait(POLL_INTERVAL_MS);
      if (unmountedRef.current) {
        throw new ApiError("Suivi interrompu : l'écran a été quitté pendant la génération.");
      }
      const polled = await pollStatus<CreativeStatus>(`/api/creatives/requests/${encodeURIComponent(status.requestId)}`, 'Le suivi a échoué');
      if (!polled) {
        misses += 1;
        if (misses >= MAX_POLL_MISSES) throw new ApiError(lostTrackMessage('dans « Mes visuels »'));
        continue;
      }
      misses = 0;
      status = polled;
      setProgress(status.status);
    }
    if (!status.mediaType) {
      throw new ApiError("La génération s'est terminée sans produire de fichier.");
    }
    return status;
  };

  const resultOf = (status: CreativeStatus) => ({
    requestId: status.requestId,
    mediaType: status.mediaType!,
    retentionDays: status.retentionDays,
    availableUntil: status.availableUntil,
    durationSeconds: status.durationSeconds,
    extendable: status.extendable,
    maxDurationSeconds: status.maxDurationSeconds,
  });

  /** Prolonge la vidéo affichée de 7 s : la nouvelle version, entière, remplace la précédente. */
  const prolonger = async () => {
    if (!result || sceneSuivante.trim().length < 3) return;
    const parent = result.requestId;
    setError(null);
    try {
      await runWithCredits('video_extension', async () => {
        setIsExtending(true);
        setProgress('queued');
        try {
          const submitted = await fetch(`/api/creatives/videos/${encodeURIComponent(parent)}/extend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneDescription: sceneSuivante.trim() }),
          });
          if (!submitted.ok) throw await readApiError(submitted, `La prolongation a échoué (${submitted.status}).`);
          const status = await suivre((await submitted.json()) as CreativeStatus, 'video');
          setResult(resultOf(status));
          setSceneSuivante('');
          setAttested(ATTESTATIONS.map(() => false));
        } finally {
          if (!unmountedRef.current) {
            setIsExtending(false);
            setProgress(null);
          }
        }
      });
    } catch (caught) {
      if (!unmountedRef.current) setError(toApiError(caught, 'La prolongation a échoué.'));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !awarenessLevel) return;

    const generationKind = kind;
    const body = {
      productName: productName.trim(),
      awarenessLevel,
      format,
      market,
      purpose,
      ...(purpose === 'ad' && adFramework
        ? {
            adFramework,
            frameworkBeats: frameworkBeats
              .slice(0, findAdFramework(adFramework)?.steps.length ?? 0)
              .map((beat) => beat.trim()),
          }
        : {}),
      sceneDescription: sceneDescription.trim().slice(0, sceneMax),
      ...(audience.trim() ? { audience: audience.trim() } : {}),
      ...(onScreenText.trim() ? { onScreenText: onScreenText.trim() } : {}),
      ...(visualStyle.trim() ? { visualStyle: visualStyle.trim() } : {}),
      ...(generationKind === 'video' ? { duration: longue ? 8 : duration, ...(longue ? { extendable: true } : {}) } : {}),
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

          const status = await suivre((await submitted.json()) as CreativeStatus, generationKind);
          setResult(resultOf(status));
          if (status.mediaType === 'image' && status.retentionDays === null) onVisualCreated?.();
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
        <CardDescription>
          Une vidéo ou un visuel structuré par une méthode publicitaire, et orienté par le niveau de conscience de votre prospect.
        </CardDescription>
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
              onClick={() => {
                setKind('video');
                /*
                  Le carré disparaît de la liste en passant à la vidéo, mais un format déjà
                  choisi y resterait — et partirait au serveur, qui le refuserait. L'auteur
                  aurait écrit son brief pour rien. On retombe donc sur le vertical, qui est
                  le format des placements où ces vidéos sont diffusées.
                */
                if (!VIDEO_FORMATS.includes(format)) setFormat('9:16');
              }}
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
            <legend className="mb-2 text-sm font-medium">Objectif {kind === 'video' ? 'de la vidéo' : 'du visuel'}</legend>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['ad', 'Publicité'],
                  ['content', 'Contenu : présentation, tutoriel…'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={purpose === value}
                  onClick={() => setPurpose(value)}
                  disabled={isGenerating}
                  className={choiceClass(purpose === value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>

          {purpose === 'ad' && (
            <AdFrameworkPicker
              value={adFramework}
              onChange={(id) => {
                setAdFramework(id);
                setFrameworkBeats([]);
              }}
              beats={frameworkBeats}
              onBeatsChange={setFrameworkBeats}
              disabled={isGenerating}
            />
          )}

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
              <CountryCombobox id="creative-market" value={market} onChange={setMarket} />
            </Field>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Format</legend>
              <div className="flex flex-wrap gap-1.5">
                {FORMAT_OPTIONS.filter((option) => kind !== 'video' || VIDEO_FORMATS.includes(option.value)).map((option) => (
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
                <div className="flex flex-wrap gap-1.5">
                  {VIDEO_DURATIONS.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={!longue && duration === value}
                      onClick={() => {
                        setLongue(false);
                        setDuration(value);
                      }}
                      className={choiceClass(!longue && duration === value)}
                    >
                      {value} s
                    </Button>
                  ))}
                  <Button type="button" variant="outline" size="sm" aria-pressed={longue} onClick={() => setLongue(true)} className={choiceClass(longue)}>
                    Vidéo longue
                  </Button>
                </div>
                {longue && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Un premier plan de 8 s en 720p, puis vous la prolongez par étapes de 7 s, en décrivant chaque scène, jusqu’à 2 min 28
                    ({extensionCost ?? '…'} points l’étape). Chaque étape se lance dans les 2 jours qui suivent la précédente.
                  </p>
                )}
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
              Restez sur cet écran pendant la génération.
              {!awarenessLevel && (
                <span className="mt-1 block text-warning">Choisissez le niveau de conscience du prospect pour continuer.</span>
              )}
              {purpose === 'ad' && !adFramework && (
                <span className="mt-1 block text-warning">Choisissez une méthode publicitaire pour continuer.</span>
              )}
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              {/*
                Le brouillon est gardé d'une visite à l'autre : il faut donc un geste explicite
                pour repartir de zéro. Sans lui, on ne pourrait vider le formulaire qu'en
                effaçant chaque champ à la main.
              */}
              <Button type="button" variant="ghost" onClick={nouveauBrief} disabled={isGenerating}>
                Nouveau brief
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isGenerating ? <Spinner /> : <Sparkles />}
                {isGenerating ? 'Génération en cours…' : kind === 'visual' ? 'Générer le visuel' : 'Générer la vidéo'}
              </Button>
            </div>
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
            <div className="space-y-3">
              <div className="flex items-center justify-center overflow-hidden rounded-lg bg-muted">
                {result.mediaType === 'video' ? (
                  // La clé change à chaque étape : le lecteur recharge la nouvelle version, entière.
                  <video key={result.requestId} src={fileUrl('inline')} controls className="max-h-96 w-full object-contain" />
                ) : (
                  <img src={fileUrl('inline')} alt="Créatif généré" className="max-h-96 w-full object-contain" />
                )}
              </div>

              {/* Vidéo longue : construite par étapes de 7 s, chaque étape décrite par l'auteur. */}
              {result.mediaType === 'video' && typeof result.durationSeconds === 'number' && (result.extendable || result.durationSeconds > 8) && (
                <div className="space-y-2 rounded-lg border bg-background p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Vidéo longue</span>
                    <span className="tabular-nums text-muted-foreground">
                      {Math.floor(result.durationSeconds / 60)} min {String(result.durationSeconds % 60).padStart(2, '0')} s
                      {' / '}
                      {Math.floor((result.maxDurationSeconds ?? 148) / 60)} min {String((result.maxDurationSeconds ?? 148) % 60).padStart(2, '0')} s
                    </span>
                  </div>
                  <Progress value={(result.durationSeconds / (result.maxDurationSeconds ?? 148)) * 100} aria-label="Durée de la vidéo longue" />
                  {result.extendable ? (
                    <>
                      <Field>
                        <FieldLabel htmlFor="scene-suivante">Scène suivante (7 s)</FieldLabel>
                        <Textarea
                          id="scene-suivante"
                          value={sceneSuivante}
                          onChange={(event) => setSceneSuivante(event.target.value)}
                          rows={2}
                          maxLength={800}
                          placeholder="Ce qui se passe ensuite : action, geste, réplique…"
                          disabled={isExtending}
                        />
                      </Field>
                      <Button type="button" onClick={() => void prolonger()} disabled={isExtending || sceneSuivante.trim().length < 3}>
                        {isExtending ? <Spinner /> : <Clapperboard />}
                        {isExtending ? 'Prolongation en cours…' : `Prolonger de 7 s${extensionCost ? ` (${extensionCost} points)` : ''}`}
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Cette vidéo ne peut plus être prolongée : durée maximale atteinte, ou délai de 2 jours dépassé.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="size-4 text-brand-green-text" aria-hidden="true" />
                Contrôle avant téléchargement
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Regardez le résultat, puis confirmez chaque point.
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

              {/* La durée vient du serveur : un visuel ne se périme pas, une vidéo reste
                  téléchargeable le temps prévu par le palier (24 h, 30 ou 90 jours). */}
              <p className="text-xs leading-relaxed text-muted-foreground">{retentionNotice(result)}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
