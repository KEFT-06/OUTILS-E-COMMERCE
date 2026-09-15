import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Compass, Sparkles } from 'lucide-react';
import { pathOf } from '@/app/navigation';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { useAuth } from '@/features/auth/AuthContext';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';

/** Mêmes bornes que `nicheQuerySchema` côté serveur. */
const schema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Indiquez au moins 2 caractères.')
    .max(200, 'La requête ne peut pas dépasser 200 caractères.'),
});

type FormValues = z.infer<typeof schema>;

/**
 * Fenêtre « Analyser une niche ».
 *
 * Rendue dans un portail Radix : l'ancienne fenêtre vivait dans l'en-tête, dont
 * le flou d'arrière-plan servait de repère aux éléments fixes. Elle s'ouvrait
 * coupée, titre et champ hors de l'écran.
 */
export function NicheAnalysisDialog() {
  const { analysisDialogOpen, setAnalysisDialogOpen, analyzeNiche, isAnalyzing } = useWorkspace();
  const { account } = useAuth();
  const suggestions = account?.savedNiches.slice(0, 6) ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { query: '' },
  });

  const onSubmit = form.handleSubmit(async ({ query }) => {
    // La fenêtre se ferme d'abord : le simulateur de crédits prend le relais.
    setAnalysisDialogOpen(false);
    form.reset();
    await analyzeNiche(query);
  });

  return (
    <Dialog open={analysisDialogOpen} onOpenChange={setAnalysisDialogOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Analyser une niche</DialogTitle>
          <DialogDescription>
            Demande, concurrence et rentabilité : Smart Creator évalue la niche et produit un rapport dont chaque chiffre
            porte sa source. Le coût en points s’affiche avant le lancement.
          </DialogDescription>
        </DialogHeader>

        <form id="niche-analysis" onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Controller
              name="query"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="niche-query">Niche, mot-clé ou produit digital</FieldLabel>
                  <Input
                    {...field}
                    id="niche-query"
                    autoFocus
                    autoComplete="off"
                    placeholder="ex. élevage de poulets, énergie solaire, formation Excel"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>Entre 2 et 200 caractères.</FieldDescription>
                  )}
                </Field>
              )}
            />

            {suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Vos niches enregistrées</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto py-1.5 font-normal whitespace-normal"
                    onClick={() => form.setValue('query', suggestion, { shouldValidate: true })}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
            )}

            <Button variant="link" asChild className="h-auto justify-start p-0">
              <Link to={pathOf('niches')} onClick={() => setAnalysisDialogOpen(false)}>
                <Compass />
                Parcourir le catalogue des niches, tous secteurs
              </Link>
            </Button>
          </FieldGroup>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Annuler</Button>
          </DialogClose>
          <Button type="submit" form="niche-analysis" disabled={isAnalyzing}>
            <Sparkles />
            Lancer l’analyse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
