import { useMemo, useState } from 'react';
import { ClipboardPaste, Compass } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { subjectOf } from '@/modules/studio/MarketReviewCard';
import { useProviders } from '@/shared/hooks/useProviders';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { PASTED_TEXT_MAX, PASTED_TEXT_MIN, type TextProductResult, writingApi } from '@/shared/lib/writing';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Spinner } from '@/shared/ui/spinner';
import { Switch } from '@/shared/ui/switch';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Mode Texte → Produit : l'auteur colle ce qu'il a déjà écrit, l'ouvrage est créé.
 *
 * Le titre et les chapitres sont reconnus, la fiche du produit est remplie ; ses mots ne sont
 * pas réécrits. Il ne lui reste qu'à relire et valider.
 *
 * L'ÉTUDE DE MARCHÉ PART DU TEXTE. Demande du propriétaire, le 07/10/2026 : « quand je colle mon
 * texte, ça fait l'analyse, ensuite ça rédige le plan, et ça me donne toutes les infos comme si
 * j'avais analysé une niche — quand je donne un texte, il sait dans quelle niche il se trouve ».
 * La niche est donc lue dans le texte, l'étude lancée sur elle sans que l'auteur ait à la nommer,
 * et son résultat rangé avec l'ouvrage. Un seul prix annoncé, une seule confirmation.
 */
export function TextToProductDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `studied` : l'étude de marché de l'ouvrage est partie. */
  onCreated: (result: TextProductResult, studied: boolean) => void;
}) {
  const { runWithCredits } = useCreditGate();
  const { launchAnalysis, analysisJob } = useWorkspace();
  const { account } = useAuth();
  const providers = useProviders();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'reading' | 'studying' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [wanted, setWanted] = useState(true);

  // L'étude se propose quand elle peut partir : forfait qui l'inclut, recherche disponible, aucune autre en cours.
  const studyPossible = Boolean(account?.features.niche_analysis) && Boolean(providers?.webSearch);
  const studyFree = studyPossible && !analysisJob;
  const study = studyFree && wanted;

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
    setBusy('reading');
    setError(null);
    try {
      const outcome = await runWithCredits(study ? 'text_to_product+niche_analysis' : 'text_to_product', async () => {
        const result = await writingApi.textProduct(text);
        if (!study) return { result, studied: false };
        setBusy('studying');
        /*
          L'ouvrage est créé : rien de ce qui suit ne doit le faire perdre. Si l'étude ne part
          pas, il arrive quand même dans le Studio, d'où elle se lance d'un geste.
        */
        const studied = await launchAnalysis(result.niche, account?.country ?? null, subjectOf(result.product))
          .then((job) => job.subject?.productId === result.product.id)
          .catch(() => false);
        return { result, studied };
      });
      if (!outcome) return;
      onCreated(outcome.result, outcome.studied);
      setText('');
      setBusy(null);
      change(false);
    } catch (caught) {
      setError(toApiError(caught, 'Votre texte n’a pas pu être mis en forme.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Créer un produit depuis mon texte</DialogTitle>
            <DialogDescription>
              Collez votre texte tel qu’il est. Sa niche est reconnue, son titre et ses chapitres aussi, et la fiche du produit est remplie : vos mots restent
              les vôtres, il ne vous reste qu’à relire et valider.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="texte-colle">Votre texte</FieldLabel>
            <Textarea
              id="texte-colle"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={'Collez ici votre ebook, votre guide ou votre formation.\n\nLes titres de chapitres sont reconnus d’eux-mêmes : « Chapitre 1 », « 2. Trouver ses clients », une ligne en capitales…'}
              className="h-64 resize-y font-sans leading-relaxed"
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

          {studyPossible && (
            <label
              htmlFor="etude-de-marche"
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-primary/30 bg-accent/40 p-3 has-[:disabled]:cursor-default"
            >
              <Switch id="etude-de-marche" checked={study} onCheckedChange={setWanted} disabled={!studyFree || busy !== null} className="mt-0.5" />
              <span className="min-w-0 space-y-0.5">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Compass className="size-4 text-brand-green-text" aria-hidden="true" />
                  Étudier le marché de mon ouvrage
                </span>
                <span className="block text-sm leading-relaxed text-muted-foreground">
                  {studyFree
                    ? 'Verdict, concurrents, prix pratiqués, public, publicités et plan de lancement : tout ce que donne l’analyse d’une niche, pour la vôtre, sans avoir à la nommer.'
                    : 'Une analyse est déjà en cours sur votre compte : l’étude de cet ouvrage se lancera depuis sa fiche, d’un geste.'}
                </span>
              </span>
            </label>
          )}

          {error && (
            <Alert variant="danger" role="alert">
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy !== null}>
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!ready || busy !== null}>
              {busy ? <Spinner /> : <ClipboardPaste />}
              {busy === 'studying' ? 'Lancement de l’étude de marché…' : busy === 'reading' ? 'Lecture de votre texte…' : study ? 'Analyser et créer mon ouvrage' : 'Créer mon ouvrage'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
