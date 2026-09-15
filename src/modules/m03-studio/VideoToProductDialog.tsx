import { useState } from 'react';
import { FileVideo, Link2, Video } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { VIDEO_FILE_MAX_BYTES, type VideoProductResult, writingApi } from '@/shared/lib/writing';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';

/**
 * Mode Vidéo → Produit : une vidéo publique (lien YouTube) ou un fichier court
 * devient la structure d'un produit digital, sans rien ajouter que la vidéo ne dise.
 */
export function VideoToProductDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: VideoProductResult) => void;
}) {
  const { runWithCredits } = useCreditGate();
  const [mode, setMode] = useState<'link' | 'file'>('link');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const tooLarge = file !== null && file.size > VIDEO_FILE_MAX_BYTES;
  const ready = mode === 'link' ? url.trim().length > 10 : file !== null && !tooLarge;

  const change = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) {
      setUrl('');
      setFile(null);
      setError(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runWithCredits('video_to_product', () =>
        mode === 'link' ? writingApi.videoLink(url.trim()) : writingApi.videoFile(file!),
      );
      if (!result) return;
      onCreated(result);
      setBusy(false);
      change(false);
    } catch (caught) {
      setError(toApiError(caught, 'La vidéo n’a pas pu être transformée.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Créer un produit depuis une vidéo</DialogTitle>
            <DialogDescription>
              L’IA regarde votre vidéo et en tire un produit structuré : promesse, public, modules et aimant à prospects.
              Elle n’ajoute ni chiffre ni promesse que la vidéo ne contient pas. Utilisez une vidéo dont vous avez les droits.
            </DialogDescription>
          </DialogHeader>

          <ToggleGroup
            type="single"
            variant="outline"
            value={mode}
            onValueChange={(value) => value && setMode(value as 'link' | 'file')}
            aria-label="Source de la vidéo"
          >
            <ToggleGroupItem value="link">
              <Link2 />
              Lien YouTube
            </ToggleGroupItem>
            <ToggleGroupItem value="file">
              <FileVideo />
              Fichier
            </ToggleGroupItem>
          </ToggleGroup>

          {mode === 'link' ? (
            <Field>
              <FieldLabel htmlFor="video-url">Lien de la vidéo</FieldLabel>
              <Input
                id="video-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                autoComplete="off"
              />
              <FieldDescription>Vidéo publique uniquement : une vidéo privée ou non répertoriée peut être refusée.</FieldDescription>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="video-file">Fichier vidéo ou audio</FieldLabel>
              <Input
                id="video-file"
                type="file"
                accept="video/*,audio/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <FieldDescription>
                {tooLarge
                  ? 'Ce fichier dépasse 14 Mo : envoyez un extrait, la bande son seule, ou publiez la vidéo sur YouTube.'
                  : '14 Mo au plus (quelques minutes de vidéo, ou bien plus en audio seul).'}
              </FieldDescription>
            </Field>
          )}

          {error && (
            <Alert variant="danger" role="alert">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!ready || busy}>
              {busy ? <Spinner /> : <Video />}
              {busy ? 'Analyse de la vidéo…' : 'Créer le produit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
