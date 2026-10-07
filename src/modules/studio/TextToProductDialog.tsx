import { useMemo, useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { PASTED_TEXT_MAX, PASTED_TEXT_MIN, type TextProductResult, writingApi } from '@/shared/lib/writing';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Mode Texte → Produit : l'auteur colle ce qu'il a déjà écrit, l'ouvrage est créé.
 *
 * Le titre et les chapitres sont reconnus, la fiche du produit est remplie ; ses mots ne sont
 * pas réécrits. Il ne lui reste qu'à relire et valider.
 */
export function TextToProductDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: TextProductResult) => void;
}) {
  const { runWithCredits } = useCreditGate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const longueur = text.trim().length;
  const mots = useMemo(() => text.trim().split(/\s+/).filter(Boolean).length, [text]);
  const tropCourt = longueur > 0 && longueur < PASTED_TEXT_MIN;
  const tropLong = longueur > PASTED_TEXT_MAX;
  const ready = longueur >= PASTED_TEXT_MIN && !tropLong;

  const change = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runWithCredits('text_to_product', () => writingApi.textProduct(text));
      if (!result) return;
      onCreated(result);
      setText('');
      setBusy(false);
      change(false);
    } catch (caught) {
      setError(toApiError(caught, 'Votre texte n’a pas pu être mis en forme.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Créer un produit depuis mon texte</DialogTitle>
            <DialogDescription>
              Collez votre texte tel qu’il est. Son titre et ses chapitres sont reconnus, la fiche du produit est remplie : vos mots restent les vôtres, il ne vous
              reste qu’à relire et valider.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="texte-colle">Votre texte</FieldLabel>
            <Textarea
              id="texte-colle"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={'Collez ici votre ebook, votre guide ou votre formation.\n\nLes titres de chapitres sont reconnus d’eux-mêmes : « Chapitre 1 », « 2. Trouver ses clients », une ligne en capitales…'}
              className="h-72 resize-y font-sans leading-relaxed"
              spellCheck={false}
              autoFocus
            />
            <FieldDescription>
              {tropLong
                ? 'Ce texte dépasse la taille d’un ouvrage du Studio : collez-le en deux produits.'
                : tropCourt
                  ? 'Encore quelques paragraphes : il en faut assez pour reconnaître un ouvrage.'
                  : longueur === 0
                    ? 'De quelques paragraphes à un ouvrage entier.'
                    : `${mots.toLocaleString('fr-FR')} mots, soit environ ${Math.max(1, Math.round(mots / 300))} page${mots >= 450 ? 's' : ''}.`}
            </FieldDescription>
          </Field>

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
              {busy ? <Spinner /> : <ClipboardPaste />}
              {busy ? 'Reconnaissance des chapitres…' : 'Créer mon ouvrage'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
