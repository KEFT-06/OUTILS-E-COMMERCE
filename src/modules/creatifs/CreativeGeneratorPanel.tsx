import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, BookOpen, Clapperboard, Download, Eye, Image as ImageIcon, PenLine, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { apiRequest } from '@/shared/lib/api';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { MAX_POLL_MISSES, lostTrackMessage, pollStatus } from '@/shared/lib/polling';
import { AWARENESS_OPTIONS } from '@/shared/lib/awareness';
import { findAdFramework, isAdFrameworkAvailable } from '@server/shared/adFrameworks';
import { VIDEO_LANGUAGES, type VideoLanguageCode } from '@server/shared/languages';
import { useAuth } from '@/features/auth/AuthContext';
import { AdFrameworkPicker } from '@/modules/creatifs/AdFrameworkPicker';
import { type AdReference, type AdStudy, type ProductStart, type ProductStartInput, readAdReference, readProductStart } from '@/modules/creatifs/adReference';
import { CREATIVE_ATTESTATIONS } from '@/modules/creatifs/attestations';
import { launchCreative } from '@/modules/creatifs/launchCreative';
import { BookCoverPanel } from '@/modules/creatifs/BookCoverPanel';
import { type Brouillon, CLE_BROUILLON, VIDEO_DURATIONS, VIDEO_FORMATS, type VideoDuration, lireBrouillon } from '@/modules/creatifs/briefDraft';
import { CountryCombobox } from '@/shared/components/CountryCombobox';
import { ZoomableImage } from '@/shared/components/ZoomableImage';
import { useScreenMemory } from '@/shared/lib/apiCache';
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
const ATTESTATIONS = CREATIVE_ATTESTATIONS;

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

/**
 * `onVisualCreated` : un visuel vient d'être enregistré — « Mes visuels » se recharge.
 * `onVideoChanged` : une vidéo vient d'être lancée ou de se terminer — « Mes vidéos » se recharge.
 * `suggestion` : le brief que l'analyse ouverte permet de proposer, quand le formulaire est vide.
 */
export function CreativeGeneratorPanel({
  onVisualCreated,
  onVideoChanged,
  suggestion = null,
}: { onVisualCreated?: () => void; onVideoChanged?: () => void; suggestion?: ProductStartInput | null } = {}) {
  const { runWithCredits, costTable } = useCreditGate();
  const extensionCost = costTable?.actions.find((action) => action.id === 'video_extension')?.cost ?? null;

  // Lu une seule fois, au montage : relire le stockage à chaque rendu coûterait pour rien.
  const [brouillon] = useState(lireBrouillon);
  /*
    Arrivée depuis une publicité de l'Espionnage (« Créer ma vidéo à partir de cette publicité ») :
    l'annonce reste sous les yeux pendant qu'on écrit son propre brief. On part de son angle, on ne
    reprend ni son texte ni ses images — le brief reste à écrire, seul le produit est proposé.
  */
  const location = useLocation();
  const [reference, setReference] = useState<AdReference | null>(() => readAdReference(location.state));
  /*
    Arrivée depuis un ouvrage de « Mes créations » (« Générer la vidéo associée ») : le brief part
    de l'ouvrage — son titre, son public — sans rien ressaisir. Le reste du brouillon est remis à
    zéro : une scène écrite pour un autre produit n'a rien à faire ici.
  */
  const [depart, setDepart] = useState(() => readProductStart(location.state));
  const { account } = useAuth();
  const frameworkLimit = account ? account.limits.adFrameworks : 0;
  /**
   * Le brief d'une vidéo, d'après ce dont on part. Une méthode que le palier n'ouvre pas n'est pas
   * proposée : le serveur la refuserait, sur un brief que l'auteur n'a pas choisi.
   */
  const briefDe = (start: ProductStart, previous: Partial<Brouillon>): Partial<Brouillon> => {
    const methode = start.methode && isAdFrameworkAvailable(start.methode, frameworkLimit) ? start.methode : null;
    return {
      market: start.marche ?? previous.market,
      format: start.format ?? (previous.format && VIDEO_FORMATS.includes(previous.format) ? previous.format : '9:16'),
      language: start.langue ?? previous.language,
      kind: 'video',
      purpose: 'ad',
      productName: start.titre,
      audience: start.public,
      onScreenText: start.promesse,
      sceneDescription: start.scene,
      adFramework: methode,
      frameworkBeats: methode ? start.temps : [],
      awarenessLevel: start.niveau,
    };
  };
  const [initial] = useState<Partial<Brouillon>>(() =>
    reference
      ? // Le produit reste celui de l'auteur : le titre d'une annonce est celui d'un autre vendeur, pas le nom de son produit.
        { ...brouillon, kind: 'video', purpose: 'ad', productName: brouillon.productName ?? '' }
      : depart
        ? briefDe(depart, brouillon)
        : brouillon,
  );

  const [kind, setKind] = useState<CreativeKind>(initial.kind ?? 'visual');
  /** Onglet « Livre » : une couverture n'est pas un créatif publicitaire, elle a son propre écran. */
  const [bookMode, setBookMode] = useState(false);
  const [productName, setProductName] = useState(initial.productName ?? '');
  const [awarenessLevel, setAwarenessLevel] = useState<AwarenessLevel | null>(initial.awarenessLevel ?? null);
  const [format, setFormat] = useState<CreativeFormat>(initial.format ?? '9:16');
  const [market, setMarket] = useState(() => initial.market ?? account?.country ?? guessCountryCode() ?? 'CI');
  /** Langue de la vidéo. Le français par défaut : c'est celle de la plupart des auteurs, et le moteur ne la devine pas. */
  const [language, setLanguage] = useState<VideoLanguageCode>(initial.language ?? 'fr');
  const [purpose, setPurpose] = useState<'ad' | 'content'>(initial.purpose ?? 'ad');
  const [adFramework, setAdFramework] = useState<string | null>(initial.adFramework ?? null);
  const [frameworkBeats, setFrameworkBeats] = useState<string[]>(initial.frameworkBeats ?? []);
  const [audience, setAudience] = useState(initial.audience ?? '');
  const [sceneDescription, setSceneDescription] = useState(initial.sceneDescription ?? '');
  const [onScreenText, setOnScreenText] = useState(initial.onScreenText ?? '');
  const [visualStyle, setVisualStyle] = useState(initial.visualStyle ?? '');
  const [duration, setDuration] = useState<VideoDuration>(initial.duration ?? 6);

  /*
    « Créer cette vidéo », cliqué sur un script affiché plus bas sur CE même écran : le panneau est
    déjà monté, l'état de navigation change sans lui. On remplit donc le brief à chaque nouvelle
    arrivée, et on le ramène sous les yeux.
  */
  const panneau = useRef<HTMLDivElement>(null);
  const arrivee = useRef(location.key);
  useEffect(() => {
    if (arrivee.current === location.key) return;
    arrivee.current = location.key;
    const start = readProductStart(location.state);
    if (!start) return;
    const brief = briefDe(start, { market, format, language });
    setDepart(start);
    setReference(null);
    setBookMode(false);
    setKind('video');
    setPurpose('ad');
    setProductName(brief.productName ?? '');
    setAudience(brief.audience ?? '');
    setOnScreenText(brief.onScreenText ?? '');
    setSceneDescription(brief.sceneDescription ?? '');
    setAdFramework(brief.adFramework ?? null);
    setFrameworkBeats(brief.frameworkBeats ?? []);
    setAwarenessLevel(brief.awarenessLevel ?? null);
    if (brief.market) setMarket(brief.market);
    if (brief.format) setFormat(brief.format);
    if (brief.language) setLanguage(brief.language);
    panneau.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Ne réagit qu'à une nouvelle arrivée : les réglages du moment sont lus, pas suivis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  /*
    Formulaire vide, et une analyse ouverte : le brief part de son premier script — produit,
    public, scène, méthode et niveau de conscience (demande du propriétaire, 11/10/2026 :
    « l'utilisateur ne fait que modifier »). Proposé une seule fois par script : ce que l'auteur
    efface, ou un « Nouveau brief », reste vide. Le type choisi (visuel ou vidéo) n'est pas changé ;
    pour un visuel, la scène est le premier plan du script, pas son déroulé.
  */
  const [propose, setPropose] = useScreenMemory<string | null>('prerempli.creatifs.brief', null);
  useEffect(() => {
    if (!suggestion || depart || reference) return;
    const start = readProductStart({ produit: suggestion });
    if (!start) return;
    const signature = `${start.titre}|${start.scene}`;
    if (propose === signature) return;
    // Quelque chose est déjà écrit : c'est le brief de l'auteur, on n'y touche pas.
    if (productName.trim() || sceneDescription.trim() || audience.trim() || onScreenText.trim()) return;
    setPropose(signature);
    const brief = briefDe(start, { market, format, language });
    const firstShot = (start.scene.split('\n')[0] ?? '').replace(/^\d+\.\s*/, '');
    setProductName(brief.productName ?? '');
    setAudience(brief.audience ?? '');
    setOnScreenText(brief.onScreenText ?? '');
    setSceneDescription(kind === 'visual' ? firstShot.slice(0, 600) : (brief.sceneDescription ?? ''));
    if (!adFramework && brief.adFramework) {
      setAdFramework(brief.adFramework);
      setFrameworkBeats(brief.frameworkBeats ?? []);
    }
    if (!awarenessLevel && brief.awarenessLevel) setAwarenessLevel(brief.awarenessLevel);
    if (!visualStyle.trim()) setVisualStyle('Photo réaliste, lumière naturelle');
    if (start.marche) setMarket(start.marche);
    // Ne réagit qu'à une nouvelle proposition : l'état du formulaire est lu au moment où elle arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion, propose]);

  /** Ce que l'outil a vu dans la vidéo de la publicité de référence. */
  const [etude, setEtude] = useState<AdStudy | null>(null);
  const [etudeEnCours, setEtudeEnCours] = useState(false);

  /**
   * L'outil regarde la vidéo de la publicité de référence, dit ce qui la fait marcher, et écrit
   * la scène d'une vidéo semblable pour le produit de l'auteur : le brief se remplit, il reste à
   * le relire. On reprend une mécanique, jamais le texte ni les images d'un autre.
   */
  const etudierLaVideo = async () => {
    const adId = reference?.adId;
    if (!adId) return;
    setEtudeEnCours(true);
    setError(null);
    try {
      const rendu = await runWithCredits('ad_video_study', () =>
        apiRequest<{ study: AdStudy }>(`/api/espionnage/ads/${adId}/study`, {
          method: 'POST',
          body: { ...(productName.trim() ? { productName: productName.trim().slice(0, 160) } : {}), ...(audience.trim() ? { audience: audience.trim().slice(0, 300) } : {}) },
        }),
      );
      if (!rendu || unmountedRef.current) return;
      const { study } = rendu;
      setEtude(study);
      setKind('video');
      setBookMode(false);
      setSceneDescription(study.brief.sceneDescription);
      if (study.brief.onScreenText) setOnScreenText(study.brief.onScreenText);
      if (study.brief.visualStyle) setVisualStyle(study.brief.visualStyle);
      if (!audience.trim() && study.brief.audience) setAudience(study.brief.audience);
      if ((VIDEO_FORMATS as readonly string[]).includes(study.format)) setFormat(study.format);
      toast.success('Vidéo regardée', { description: 'Sa construction est sous vos yeux, et votre scène est écrite : relisez-la, puis générez.' });
    } catch (caught) {
      if (!unmountedRef.current) setError(toApiError(caught, 'La vidéo n’a pas pu être regardée.'));
    } finally {
      if (!unmountedRef.current) setEtudeEnCours(false);
    }
  };

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
      language,
    };
    try {
      window.localStorage.setItem(CLE_BROUILLON, JSON.stringify(brouillon));
    } catch {
      // Stockage indisponible : le formulaire marche, il ne survivra simplement pas à un rechargement.
    }
  }, [kind, productName, awarenessLevel, format, market, purpose, adFramework, frameworkBeats, audience, sceneDescription, onScreenText, visualStyle, duration, language]);

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
    setDepart(null);
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
        if (misses >= MAX_POLL_MISSES) throw new ApiError(lostTrackMessage(generationKind === 'video' ? 'dans « Mes vidéos »' : 'dans « Mes visuels »'));
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
            body: JSON.stringify({ sceneDescription: sceneSuivante.trim(), language }),
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
      ...(generationKind === 'video' ? { duration: longue ? 8 : duration, language, ...(longue ? { extendable: true } : {}) } : {}),
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
          // Le lancement aboutit même si la réponse se perd : le créatif arrivé sur le compte fait foi.
          const launched = await launchCreative(generationKind, body);
          // La vidéo est lancée : elle figure dès maintenant dans « Mes vidéos », quoi qu'il arrive à cet écran.
          if (generationKind === 'video') onVideoChanged?.();
          const status = await suivre(launched, generationKind);
          setResult(resultOf(status));
        } finally {
          // Quelle que soit l'issue vue d'ici, les listes sont relues : ce que le serveur a produit doit s'y voir.
          if (generationKind === 'video') onVideoChanged?.();
          else onVisualCreated?.();
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
    <Card ref={panneau} className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-lg">{bookMode ? 'Créer la couverture d’un livre' : 'Générer un visuel ou une vidéo'}</CardTitle>
        <CardDescription>
          {bookMode
            ? 'La couverture complète de votre livre — relief, titre, points forts, bandeau — prête à télécharger et à montrer pour vendre.'
            : 'Une vidéo ou un visuel structuré par une méthode publicitaire, et orienté par le niveau de conscience de votre prospect.'}
        </CardDescription>
        <CardAction>
          <div className="inline-flex rounded-lg border bg-muted/50 p-1" role="group" aria-label="Type de créatif">
            <Button
              size="sm"
              variant={!bookMode && kind === 'visual' ? 'secondary' : 'ghost'}
              aria-pressed={!bookMode && kind === 'visual'}
              onClick={() => {
                setBookMode(false);
                setKind('visual');
              }}
              disabled={isGenerating}
            >
              <ImageIcon />
              Visuel
            </Button>
            <Button
              size="sm"
              variant={!bookMode && kind === 'video' ? 'secondary' : 'ghost'}
              aria-pressed={!bookMode && kind === 'video'}
              onClick={() => {
                setBookMode(false);
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
            <Button size="sm" variant={bookMode ? 'secondary' : 'ghost'} aria-pressed={bookMode} onClick={() => setBookMode(true)} disabled={isGenerating}>
              <BookOpen />
              Livre
            </Button>
          </div>
        </CardAction>
      </CardHeader>

      {bookMode && (
        <CardContent>
          <BookCoverPanel />
        </CardContent>
      )}

      {/* Le brief reste monté sous l'onglet Livre : y revenir ne fait rien perdre. */}
      <CardContent className={cn('space-y-5', bookMode && 'hidden')}>
        {reference && (
          <Alert>
            <Clapperboard />
            <AlertTitle>Publicité de référence : {reference.annonceur}</AlertTitle>
            <AlertDescription>
              {reference.titre && <p className="font-medium text-foreground">{reference.titre}</p>}
              {reference.texte && <p className="line-clamp-4 whitespace-pre-line">{reference.texte}</p>}
              <p>Inspirez-vous de son angle pour décrire VOTRE scène : son texte et ses images restent les siens.</p>
              {etude && (
                <div className="mt-1 space-y-2 rounded-lg border bg-background p-3 text-foreground">
                  <p>
                    <span className="font-semibold">Son accroche.</span> {etude.hook}
                  </p>
                  <div>
                    <p className="font-semibold">
                      Ses temps{etude.durationSeconds > 0 ? ` (${etude.durationSeconds} s)` : ''}
                    </p>
                    <ol className="mt-1 space-y-1">
                      {etude.beats.map((beat, index) => (
                        <li key={index} className="flex gap-2">
                          <span className="shrink-0 font-medium tabular-nums text-muted-foreground">{beat.moment || `${index + 1}.`}</span>
                          <span className="min-w-0">
                            {beat.shows}
                            {beat.says && <span className="text-muted-foreground"> — « {beat.says} »</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {etude.whyItWorks.length > 0 && (
                    <div>
                      <p className="font-semibold">Ce qui la fait marcher</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {etude.whyItWorks.map((reason, index) => (
                          <li key={index}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-muted-foreground">Votre scène est écrite ci-dessous, pour votre produit : relisez-la avant de générer.</p>
                </div>
              )}
              {reference.adId && !etude && (
                <Button type="button" size="sm" variant="outline" className="mt-1 h-auto min-h-9 whitespace-normal py-2 text-left" onClick={() => void etudierLaVideo()} disabled={etudeEnCours || isGenerating}>
                  {etudeEnCours ? <Spinner /> : <Eye />}
                  {etudeEnCours ? 'La vidéo est regardée : environ une minute…' : 'Regarder sa vidéo et écrire ma scène'}
                </Button>
              )}
              <Button type="button" variant="link" className="h-auto p-0" onClick={() => setReference(null)}>
                Retirer la référence
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {depart?.origine && !reference && (
          <Alert variant="info">
            <Sparkles />
            <AlertTitle>Votre brief est prêt</AlertTitle>
            <AlertDescription>
              Il est rempli d’après {depart.origine}. Relisez-le, changez ce que vous voulez, puis générez la vidéo.
            </AlertDescription>
          </Alert>
        )}
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

            {kind === 'video' && (
              <Field>
                <FieldLabel htmlFor="creative-language">Langue de la vidéo</FieldLabel>
                <Select value={language} onValueChange={(value) => setLanguage(value as VideoLanguageCode)} disabled={isGenerating}>
                  <SelectTrigger id="creative-language" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIDEO_LANGUAGES.map((entry) => (
                      <SelectItem key={entry.code} value={entry.code}>
                        {entry.fr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Tout ce qui se dit dans la vidéo est dans cette langue.</FieldDescription>
              </Field>
            )}

            {kind === 'video' ? (
              <fieldset className="space-y-2 sm:col-span-2">
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
              {kind === 'video'
                ? 'Vous pouvez quitter cet écran pendant le rendu : la vidéo vous attendra dans « Mes vidéos ».'
                : 'Votre visuel sera gardé dans « Mes visuels ».'}
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
                  <ZoomableImage src={fileUrl('inline')} alt="Créatif généré" className="w-full" imageClassName="max-h-96 w-full object-contain" />
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
