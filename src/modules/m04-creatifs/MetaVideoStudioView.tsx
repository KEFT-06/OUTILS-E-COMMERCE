import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Square,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { cn } from '@/shared/lib/utils';
import type { MetaAdCampaign } from '@/shared/types/analysis';
import type { DataProvenance } from '@/shared/types/provenance';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/shared/ui/chart';
import { ChartProvenance } from '@/shared/ui/ChartProvenance';
import { NoDataState } from '@/shared/ui/NoDataState';

interface MetaVideoStudioViewProps {
  campaigns: MetaAdCampaign[];
  /** Provenance des campagnes du rapport. */
  provenance?: DataProvenance;
}

/**
 * Scripts vidéo et storyboards publicitaires (AIDA, PAS…).
 *
 * L'ancienne version affichait une « courbe de rétention estimée » dont les
 * valeurs (100 %, 92 %, 85 %…) étaient écrites en dur, et promettait une vidéo
 * « 100 % conforme » qui « ne sera pas rejetée ». Ne restent que ce que le script
 * contient réellement : ses scènes, leurs durées et les points de conformité
 * vérifiés — la décision finale appartient à la modération de Meta.
 */

const durationConfig = { duration: { label: 'Durée (s)', color: 'var(--chart-2)' } } satisfies ChartConfig;

/** Convertit un timecode « m:ss » en secondes. */
function timecodeToSeconds(timecode: string): number {
  const parts = timecode.trim().split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function cancelSpeech() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}

export function MetaVideoStudioView({ campaigns, provenance }: MetaVideoStudioViewProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(campaigns[0]?.id);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '1:1'>('9:16');
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedId) ?? campaigns[0];

  // Changement de niche : on repart de la première campagne.
  useEffect(() => {
    if (campaigns.length > 0 && !campaigns.some((campaign) => campaign.id === selectedId)) {
      setSelectedId(campaigns[0]?.id);
      setActiveSceneIndex(0);
      setIsPlaying(false);
    }
  }, [campaigns, selectedId]);

  const speakScene = (text: string) => {
    if (isAudioMuted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Synthèse vocale indisponible : la lecture reste visuelle.
    }
  };

  // Lecture scène par scène de l'aperçu.
  useEffect(() => {
    if (!isPlaying || !selectedCampaign || selectedCampaign.scenes.length === 0) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const scene = selectedCampaign.scenes[activeSceneIndex];
    if (scene) speakScene(scene.spokenVoiceover);

    timerRef.current = setTimeout(() => {
      setActiveSceneIndex((previous) => {
        if (previous + 1 < selectedCampaign.scenes.length) return previous + 1;
        setIsPlaying(false);
        return 0;
      });
    }, 4500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // speakScene lit isAudioMuted, déjà dans les dépendances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, activeSceneIndex, selectedCampaign, isAudioMuted]);

  useEffect(() => cancelSpeech, []);

  if (!selectedCampaign) {
    return (
      <NoDataState
        icon={Video}
        title="Aucun script vidéo pour cette niche"
        reason="Le rapport actif ne contient pas de campagne publicitaire. Choisissez une autre niche dans l’en-tête."
      />
    );
  }

  const currentScene = selectedCampaign.scenes[activeSceneIndex] ?? selectedCampaign.scenes[0];

  const durationData = selectedCampaign.scenes.map((scene) => {
    const [start, end] = scene.timing.split(' - ');
    return {
      phase: scene.phase,
      duration: Math.max(0, timecodeToSeconds(end ?? '') - timecodeToSeconds(start ?? '')),
    };
  });

  const selectCampaign = (id: string) => {
    setSelectedId(id);
    setActiveSceneIndex(0);
    setIsPlaying(false);
    cancelSpeech();
  };

  const copyAdText = async () => {
    try {
      await navigator.clipboard.writeText(
        `${selectedCampaign.metaPrimaryText}\n\n${selectedCampaign.metaHeadline}\nBouton : ${selectedCampaign.callToAction}`,
      );
      toast.success('Texte publicitaire copié');
    } catch {
      toast.error('Copie impossible', { description: 'Votre navigateur a refusé l’accès au presse-papiers.' });
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="scripts-video-title">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 id="scripts-video-title" className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">
            Scripts vidéo
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Storyboards construits sur les méthodes AIDA (attention, intérêt, désir, action) et PAS (problème, agitation,
            solution).
          </p>
          <ChartProvenance provenance={provenance} className="mt-1" />
        </div>
        <div className="inline-flex shrink-0 self-start rounded-lg border bg-muted/50 p-1" role="group" aria-label="Méthode">
          {campaigns.map((campaign) => (
            <Button
              key={campaign.id}
              size="sm"
              variant={campaign.id === selectedCampaign.id ? 'secondary' : 'ghost'}
              aria-pressed={campaign.id === selectedCampaign.id}
              onClick={() => selectCampaign(campaign.id)}
            >
              Méthode {campaign.framework}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>Aperçu de la vidéo</CardTitle>
              <CardDescription>Lecture scène par scène, avec la voix off du navigateur.</CardDescription>
              <CardAction>
                <div className="inline-flex rounded-lg border bg-muted/50 p-1" role="group" aria-label="Format de l’aperçu">
                  <Button
                    size="icon-sm"
                    variant={aspectRatio === '9:16' ? 'secondary' : 'ghost'}
                    aria-pressed={aspectRatio === '9:16'}
                    aria-label="Format vertical 9:16"
                    onClick={() => setAspectRatio('9:16')}
                  >
                    <Smartphone />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant={aspectRatio === '1:1' ? 'secondary' : 'ghost'}
                    aria-pressed={aspectRatio === '1:1'}
                    aria-label="Format carré 1:1"
                    onClick={() => setAspectRatio('1:1')}
                  >
                    <Square />
                  </Button>
                </div>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-5">
              {/* Maquette d'écran : couleurs d'appareil, identiques dans les deux thèmes. */}
              <div
                className={cn(
                  'relative flex max-w-full flex-col justify-between overflow-hidden rounded-[1.75rem] border-4 border-neutral-900 bg-neutral-950 p-4 text-white shadow-xl',
                  aspectRatio === '9:16' ? 'h-[520px] w-[292px]' : 'h-[300px] w-[300px]',
                )}
              >
                <div className="absolute top-2 right-4 left-4 z-30 flex gap-1">
                  {selectedCampaign.scenes.map((scene, index) => (
                    <button
                      key={scene.sceneNumber}
                      type="button"
                      aria-label={`Aller à la scène ${index + 1}`}
                      onClick={() => {
                        setActiveSceneIndex(index);
                        setIsPlaying(false);
                      }}
                      className={cn(
                        'h-1 flex-1 rounded-full',
                        index === activeSceneIndex ? 'bg-brand-green' : index < activeSceneIndex ? 'bg-white' : 'bg-white/30',
                      )}
                    />
                  ))}
                </div>

                <div className="z-20 mt-2 flex items-center justify-between text-xs font-medium text-white/85">
                  <span className="rounded-full bg-black/50 px-2 py-0.5">{selectedCampaign.framework}</span>
                  <span className="rounded-full bg-black/50 px-2 py-0.5 tabular-nums">{currentScene?.timing}</span>
                </div>

                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-b from-neutral-900/70 via-neutral-900/50 to-neutral-950/95 p-6 text-center">
                  <span className="mb-4 rounded-full bg-brand-orange px-3 py-1 text-xs font-extrabold tracking-wider text-neutral-950 uppercase">
                    {currentScene?.phase}
                  </span>
                  <p className="max-w-[90%] rounded-xl border border-white/20 bg-black/80 p-4 text-base leading-snug font-extrabold">
                    {currentScene?.onScreenText}
                  </p>
                  <p className="mt-4 line-clamp-3 px-2 text-xs text-white/75 italic">« {currentScene?.spokenVoiceover} »</p>
                </div>

                <div className="z-20 space-y-2">
                  <div className="flex items-center justify-center gap-2 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-bold text-neutral-950">
                    {selectedCampaign.callToAction}
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </div>
                  <p className="text-center text-xs text-white/60">Zone de sécurité : bouton dégagé au centre</p>
                </div>
              </div>

              <div className="flex w-full items-center justify-between border-t pt-4">
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    onClick={() => {
                      if (isPlaying) cancelSpeech();
                      setIsPlaying(!isPlaying);
                    }}
                    aria-label={isPlaying ? 'Mettre en pause' : 'Lire l’aperçu'}
                  >
                    {isPlaying ? <Pause /> : <Play />}
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Recommencer"
                    onClick={() => {
                      setIsPlaying(false);
                      setActiveSceneIndex(0);
                      cancelSpeech();
                    }}
                  >
                    <RotateCcw />
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-pressed={!isAudioMuted}
                  onClick={() => {
                    if (!isAudioMuted) cancelSpeech();
                    setIsAudioMuted(!isAudioMuted);
                  }}
                >
                  {isAudioMuted ? <VolumeX /> : <Volume2 />}
                  {isAudioMuted ? 'Voix off coupée' : 'Voix off active'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-4 text-brand-green-text" aria-hidden="true" />
                Durée de chaque phase
              </CardTitle>
              <CardDescription>Calculée à partir des timings du script.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={durationConfig} className="h-48 w-full">
                <BarChart data={durationData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="phase" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={(value: number) => `${value} s`} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="duration" fill="var(--color-duration)" radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-7">
          <Card>
            <CardHeader>
              <Badge variant="brand">
                Méthode {selectedCampaign.framework} — {selectedCampaign.frameworkFullName}
              </Badge>
              <CardTitle className="text-lg">{selectedCampaign.targetProductTitle}</CardTitle>
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => void copyAdText()}>
                  <Copy />
                  Copier le texte
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-brand-orange/40 bg-brand-orange/10 p-4">
                <p className="mb-1 text-sm font-semibold text-brand-orange-text">Accroche des 3 premières secondes</p>
                <p className="font-semibold">« {selectedCampaign.hookHeadline} »</p>
              </div>

              <div className="rounded-lg border bg-muted/40 p-4">
                <p className="mb-2 text-sm font-semibold">Texte publicitaire (fil Facebook et Instagram)</p>
                <p className="text-sm leading-relaxed whitespace-pre-line">{selectedCampaign.metaPrimaryText}</p>
              </div>

              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <dt className="mb-1 font-medium">Centres d’intérêt suggérés</dt>
                  <dd className="text-muted-foreground">{selectedCampaign.metaTargeting.interests.join(', ')}</dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="mb-1 font-medium">Emplacements</dt>
                  <dd className="text-muted-foreground">{selectedCampaign.metaTargeting.placements.join(' · ')}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="size-4 text-brand-green-text" aria-hidden="true" />
                Storyboard
              </CardTitle>
              <CardDescription className="tabular-nums">
                {selectedCampaign.scenes.length} scènes · {selectedCampaign.durationSeconds} s
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {selectedCampaign.scenes.map((scene, index) => (
                  <li key={scene.sceneNumber}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-pressed={index === activeSceneIndex}
                      onClick={() => {
                        setActiveSceneIndex(index);
                        speakScene(scene.spokenVoiceover);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setActiveSceneIndex(index);
                        }
                      }}
                      className={cn(
                        'cursor-pointer rounded-lg border p-4 transition-colors hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                        index === activeSceneIndex && 'border-primary bg-accent/40',
                      )}
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-xs text-background tabular-nums">
                            {scene.sceneNumber}
                          </span>
                          {scene.timing} · <span className="text-brand-orange-text">{scene.phase}</span>
                        </span>
                        <span className="text-xs text-muted-foreground italic">{scene.soundAndVibe}</span>
                      </div>
                      <div className="grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Image</p>
                          <p className="mt-0.5">{scene.visualDescription}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Texte à l’écran (sans le son)</p>
                          <p className="mt-0.5 font-semibold">« {scene.onScreenText} »</p>
                        </div>
                      </div>
                      <div className="mt-3 border-t pt-2 text-sm">
                        <p className="text-xs font-medium text-muted-foreground">Voix off</p>
                        <p className="mt-0.5 italic">« {scene.spokenVoiceover} »</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {selectedCampaign.complianceCheck.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-brand-green-text" aria-hidden="true" />
                  Points de conformité du script
                </CardTitle>
                <CardDescription>
                  Vérifiés dans le texte du script. La validation finale appartient à la modération de Meta.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {selectedCampaign.complianceCheck.map((rule) => (
                    <li key={rule.rule} className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
                      <CheckCircle2
                        className={cn('mt-0.5 size-4 shrink-0', rule.compliant ? 'text-success' : 'text-warning')}
                        aria-label={rule.compliant ? 'Respecté' : 'À revoir'}
                      />
                      <div>
                        <p className="font-medium">{rule.rule}</p>
                        <p className="text-muted-foreground">{rule.explanation}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
