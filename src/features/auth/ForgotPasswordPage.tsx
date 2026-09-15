import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTrackVisit } from '@/shared/lib/audience';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, MailCheck, KeyRound, TriangleAlert } from 'lucide-react';
import { apiRequest } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { useProviders } from '@/shared/lib/useProviders';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Mot de passe oublié : un lien à usage unique part par e-mail.
 *
 * La réponse est la même qu'un compte existe ou non : la page ne révèle jamais
 * quelles adresses sont inscrites.
 */

const schema = z.object({ email: z.string().trim().min(1, 'Indiquez votre adresse e-mail.').email('Adresse e-mail invalide.') });

export function ForgotPasswordPage() {
  useTrackVisit('/mot-de-passe-oublie');
  const providers = useProviders();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  useEffect(() => {
    document.title = 'Mot de passe oublié · Smart Creator';
  }, []);

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await apiRequest('/api/auth/password-reset', { method: 'POST', body: { email } });
      setSentTo(email);
    } catch (caught) {
      setError(toApiError(caught, 'La demande n’a pas pu être envoyée.'));
    }
  });

  return (
    <div className="flex min-h-svh flex-col items-center bg-background px-4 py-10">
      <header>
        <Link to="/" className="rounded-md" aria-label="Accueil Smart Creator">
          <BrandLogo size="md" />
        </Link>
      </header>

      <main className="mt-10 w-full max-w-md">
        <Card>
          <CardHeader>
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <KeyRound className="size-5" aria-hidden="true" />
            </span>
            <CardTitle className="mt-2 font-display text-2xl font-extrabold tracking-tight">
              <h1>Mot de passe oublié</h1>
            </CardTitle>
            <CardDescription>Recevez par e-mail un lien pour choisir un nouveau mot de passe.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {!providers ? (
              <div className="space-y-3" role="status" aria-label="Chargement">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            ) : !providers.email ? (
              <Alert variant="info">
                <TriangleAlert />
                <AlertTitle>Envoi d’e-mails pas encore disponible</AlertTitle>
                <AlertDescription>
                  Demandez un lien de réinitialisation à l’administrateur de Smart Creator : il peut le créer depuis votre
                  fiche.
                </AlertDescription>
              </Alert>
            ) : sentTo ? (
              <Alert variant="success" role="status">
                <MailCheck />
                <AlertTitle>Vérifiez votre boîte de réception</AlertTitle>
                <AlertDescription>
                  Si un compte existe pour {sentTo}, un e-mail vient de partir. Le lien reste valable une heure et ne sert
                  qu’une fois. Pensez à regarder dans les courriers indésirables.
                </AlertDescription>
              </Alert>
            ) : (
              <form onSubmit={onSubmit} noValidate>
                <FieldGroup>
                  {error && (
                    <Alert variant="danger" role="alert">
                      <TriangleAlert />
                      <AlertTitle>{error.message}</AlertTitle>
                    </Alert>
                  )}
                  <Controller
                    name="email"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="forgot-email">Adresse e-mail du compte</FieldLabel>
                        <Input {...field} id="forgot-email" type="email" autoComplete="email" autoFocus aria-invalid={fieldState.invalid} />
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && <Spinner />}
                    Envoyer le lien
                  </Button>
                </FieldGroup>
              </form>
            )}

            <Button variant="ghost" size="sm" asChild className="-ml-2">
              <Link to="/connexion">
                <ArrowLeft />
                Retour à la connexion
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
