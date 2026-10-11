import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Headphones, RefreshCw, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { AUDIO_MINUTES_PER_UNIT, AUDIO_VOICES, type AudioTrack, type AudioVoiceId, audioMinutes, audioReady, formatAudioDuration } from '@server/shared/audio';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { toApiError } from '@/shared/lib/apiError';
import { audioApi } from '@/shared/lib/audio';
import { formatDateFr } from '@/shared/lib/formatDate';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';

/**
 * Parcours audio d'un ouvrage : chaque module rédigé se fait lire à voix haute, s'écoute ici et se
 * télécharge en MP3 pour être vendu avec l'ebook, ou seul.
 *
 * Demande du propriétaire : « quand ça met parcours audio, ça devait rédiger l'ebook plus l'audio
 * téléchargeable ». Un module à la fois : on écoute, on corrige le texte, on relit ce module-là
 * sans repayer les autres. « Tout lire » enchaîne ceux qui n'ont pas encore leur piste.
 */

/** Pendant une lecture, on regarde si la piste est arrivée : la réponse peut se perdre sur une connexion instable. */
const WATCH_MS = 15_000;

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
/** Tranches facturées pour une durée : toute tranche entamée est due. */
const unitsFor = (minutes: number) => Math.max(1, Math.ceil(minutes / AUDIO_MINUTES_PER_UNIT)) * AUDIO_MINUTES_PER_UNIT;

export function AudioCoursePanel({ product, available }: { product: DigitalProductIdea; available: boolean }) {
  const { runWithCredits } = useCreditGate();
  const [tracks, setTracks] = useState<Record<number, AudioTrack>>({});
  const [voice, setVoice] = useState<AudioVoiceId>('posee');
  /** Rang du module en cours de lecture. */
  const [reading, setReading] = useState<number | null>(null);
  /** Modules encore à lire dans un « Tout lire ». */
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await audioApi.list(product.id);
    setTracks(Object.fromEntries(list.map((track) => [track.position, track])));
  }, [product.id]);

  useEffect(() => {
    setTracks({});
    setError(null);
    void refresh().catch(() => undefined);
  }, [refresh]);

  // Filet d'une connexion instable : la piste est prête et payée sur le serveur même si sa réponse se perd.
  useEffect(() => {
    if (reading === null) return;
    const watcher = window.setInterval(() => void refresh().catch(() => undefined), WATCH_MS);
    return () => window.clearInterval(watcher);
  }, [reading, refresh]);

  const modules = useMemo(
    () =>
      product.tableOfContents.map((module, index) => ({
        position: index + 1,
        title: module.title,
        text: module.details,
        ready: audioReady(module.details),
        minutes: audioMinutes(module.title, module.details),
      })),
    [product.tableOfContents],
  );
  const written = modules.filter((module) => module.ready);
  const toRead = written.filter((module) => !tracks[module.position]);
  const done = Object.values(tracks);
  const totalSeconds = done.reduce((sum, track) => sum + track.seconds, 0);
  const totalBytes = done.reduce((sum, track) => sum + track.bytes, 0);
  const expiry = done.map((track) => track.expiresAt).filter((date): date is string => Boolean(date)).sort()[0];
  const busy = reading !== null;

  const say = async (module: (typeof modules)[number]) => {
    setReading(module.position);
    try {
      const track = await audioApi.create({ subjectId: product.id, position: module.position, title: module.title, text: module.text, voice });
      setTracks((current) => ({ ...current, [track.position]: track }));
      return track;
    } finally {
      setReading(null);
    }
  };

  const readOne = async (module: (typeof modules)[number]) => {
    setError(null);
    try {
      const track = await runWithCredits('audio_reading', () => say(module), unitsFor(module.minutes));
      if (track) toast.success(`Module ${module.position} lu`, { description: `${formatAudioDuration(track.seconds)} d’audio, prêt à écouter et à télécharger.` });
    } catch (caught) {
      setError(toApiError(caught, 'Ce module n’a pas pu être lu.').message);
      void refresh().catch(() => undefined);
    }
  };

  const readAll = async () => {
    setError(null);
    const queue = toRead;
    // Un seul prix annoncé pour l'ensemble : la somme de ce que chaque module coûtera.
    const units = queue.reduce((sum, module) => sum + unitsFor(module.minutes), 0);
    try {
      const read = await runWithCredits(
        'audio_reading',
        async () => {
          let count = 0;
          for (const [index, module] of queue.entries()) {
            setRemaining(queue.length - index);
            await say(module);
            count += 1;
          }
          return count;
        },
        units,
      );
      if (read) toast.success('Parcours audio prêt', { description: `${read} module${read > 1 ? 's' : ''} lu${read > 1 ? 's' : ''}. Écoutez-les, puis téléchargez-les.` });
    } catch (caught) {
      // Ce qui est déjà lu reste acquis : la suite se relance d'un geste, sans rien repayer.
      setError(toApiError(caught, 'La lecture s’est arrêtée avant la fin.').message);
      void refresh().catch(() => undefined);
    } finally {
      setRemaining(0);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-center gap-2 font-semibold">
            <Headphones className="size-5 text-brand-green-text" aria-hidden="true" />
            Parcours audio
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Chaque module rédigé se fait lire à voix haute : vous l’écoutez ici, puis vous le téléchargez en MP3 pour le vendre avec votre ebook, ou seul.
          </p>
        </div>
        {toRead.length > 1 && (
          <Button onClick={() => void readAll()} disabled={busy || !available}>
            {busy && remaining > 0 ? <Spinner /> : <Volume2 />}
            {busy && remaining > 0 ? `Lecture… encore ${remaining}` : `Tout lire (${toRead.length} modules)`}
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <p id={`voix-${product.id}`} className="text-sm font-medium">
          Voix
        </p>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={voice}
          onValueChange={(value) => value && setVoice(value as AudioVoiceId)}
          aria-labelledby={`voix-${product.id}`}
          className="flex-wrap justify-start"
          disabled={busy}
        >
          {AUDIO_VOICES.map((option) => (
            <ToggleGroupItem key={option.id} value={option.id}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{AUDIO_VOICES.find((option) => option.id === voice)?.tone}</p>
      </div>

      {written.length === 0 ? (
        <p className="rounded-lg bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">
          Aucun module n’est encore rédigé. Faites rédiger votre ebook ci-dessus, ou écrivez-le dans le mode Expert : chaque module pourra ensuite être lu.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {modules.map((module) => {
            const track = tracks[module.position];
            const isReading = reading === module.position;
            return (
              <li key={module.position} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-foreground tabular-nums">{module.position}</span>
                  <p className="min-w-0 flex-1 basis-40 text-sm font-medium [overflow-wrap:anywhere]">{module.title || `Module ${module.position}`}</p>
                  {!module.ready ? (
                    <span className="text-xs text-muted-foreground">À rédiger d’abord</span>
                  ) : isReading ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                      <Spinner />
                      Lecture en cours : environ {Math.max(20, Math.round((module.minutes * 60) / 3 / 10) * 10 + 20)} s
                    </span>
                  ) : track ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatAudioDuration(track.seconds)} · {megabytes(track.bytes)}
                      </span>
                      <Button asChild size="sm" variant="outline">
                        <a href={audioApi.downloadUrl(track)} download>
                          <Download />
                          MP3
                        </a>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void readOne(module)} disabled={busy || !available} title="Relire ce module avec son texte actuel et la voix choisie">
                        <RefreshCw />
                        Relire
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => void readOne(module)} disabled={busy || !available}>
                      <Volume2 />
                      Lire · environ {module.minutes} min
                    </Button>
                  )}
                </div>
                {track && !isReading && (
                  <audio controls preload="none" src={audioApi.fileUrl(track)} className="h-9 w-full" aria-label={`Écouter le module ${module.position}`} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {done.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {done.length} piste{done.length > 1 ? 's' : ''} · {formatAudioDuration(totalSeconds)} · {megabytes(totalBytes)}
          {expiry ? ` · fichiers conservés jusqu’au ${formatDateFr(expiry)} : téléchargez-les.` : ''}
        </p>
      )}
      {!available && <p className="text-sm text-muted-foreground">La lecture à voix haute est momentanément indisponible.</p>}
      {error && (
        <Alert variant="danger" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
