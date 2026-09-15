import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CircleCheck, KeyRound, TriangleAlert } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, PasswordHints, PasswordInput } from '@/features/auth/PasswordInput';
import { apiRequest, passwordProblemsOf } from '@/shared/lib/api';
import { ApiError, toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Lien à usage unique : création du mot de passe d'un compte ouvert par
 * l'administration, ou réinitialisation.
 *
 * Le jeton arrive dans le fragment de l'adresse (#…), que le navigateur n'envoie
 * jamais au serveur ni aux sites tiers. Il est retiré de la barre d'adresse et de
 * l'historique dès la lecture.
 */

interface TokenInfo {
  purpose: 'setup' | 'reset';
  email: string;
  name: string;
  expiresAt: string;
}

const schema = z
  .object({
    password: z.string().min(PASSWORD_MIN_LENGTH, `${PASSWORD_MIN_LENGTH} caractères au moins.`).max(128),
    confirmation: z.string(),
  })
  .refine((values) => values.password === values.confirmation, {
    message: 'Les deux mots de passe ne correspondent pas.',
    path: ['confirmation'],
  });

export function PasswordTokenPage() {
  const navigate = useNavigate();
  const [token] = useState(() => window.location.hash.slice(1));
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirmation: '' } });
  const password = form.watch('password');

  useEffect(() => {
    document.title = 'Mot de passe · Smart Creator';
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setLoadError(new ApiError('Ce lien est incomplet : ouvrez-le exactement tel que vous l’avez reçu.', 'TOKEN_INVALID'));
      return;
    }

    let cancelled = false;
    apiRequest<TokenInfo>('/api/auth/password-token/inspect', { method: 'POST', body: { token } })
      .then((loaded) => {
        if (!cancelled) setInfo(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(toApiError(caught, 'Ce lien n’est plus valide.'));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = form.handleSubmit(async ({ password: chosen }) => {
    setSubmitError(null);
    try {
      await apiRequest('/api/auth/password-token/consume', { method: 'POST', body: { token, password: chosen } });
      setDone(true);
    } catch (caught) {
      setSubmitError(toApiError(caught, 'Le mot de passe n’a pas pu être enregistré.'));
    }
  });

  const problems = passwordProblemsOf(submitError);
  const isSetup = info?.purpose === 'setup';

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
              <h1>{done ? 'Mot de passe enregistré' : isSetup ? 'Créez votre mot de passe' : 'Choisissez un nouveau mot de passe'}</h1>
            </CardTitle>
            {info && !done && (
              <CardDescription>
                Compte <span className="font-medium text-foreground">{info.email}</span>. Lien valable jusqu’au{' '}
                {formatDateFr(info.expiresAt, true)}, une seule fois.
              </CardDescription>
            )}
          </CardHeader>

          <CardContent className="space-y-5">
            {loadError ? (
              <Alert variant="danger">
                <TriangleAlert />
                <AlertTitle>Lien inutilisable</AlertTitle>
                <AlertDescription>{loadError.message}</AlertDescription>
              </Alert>
            ) : done ? (
              <div className="space-y-4">
                <Alert variant="success">
                  <CircleCheck />
                  <AlertTitle>C’est fait</AlertTitle>
                  <AlertDescription>
                    Toutes les sessions ouvertes sur ce compte ont été fermées. Connectez-vous avec votre nouveau mot de passe.
                  </AlertDescription>
                </Alert>
                <Button className="w-full" onClick={() => navigate('/connexion', { state: { email: info?.email } })}>
                  Se connecter
                </Button>
              </div>
            ) : !info ? (
              <div className="space-y-3" role="status" aria-label="Vérification du lien">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate>
                <FieldGroup>
                  {submitError && (
                    <Alert variant="danger" role="alert">
                      <TriangleAlert />
                      <AlertTitle>{submitError.message}</AlertTitle>
                      {problems.length > 1 && (
                        <AlertDescription>
                          <ul className="list-disc pl-4">
                            {problems.slice(1).map((problem) => (
                              <li key={problem}>{problem}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      )}
                    </Alert>
                  )}
                  <Controller
                    name="password"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="token-password">Mot de passe</FieldLabel>
                        <PasswordInput {...field} id="token-password" autoComplete="new-password" aria-invalid={fieldState.invalid} />
                        <PasswordHints password={password} />
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />
                  <Controller
                    name="confirmation"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="token-confirmation">Confirmez le mot de passe</FieldLabel>
                        <PasswordInput {...field} id="token-confirmation" autoComplete="new-password" aria-invalid={fieldState.invalid} />
                        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                      </Field>
                    )}
                  />
                  <input type="text" name="username" autoComplete="username" value={info.email} readOnly hidden />
                  <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && <Spinner />}
                    Enregistrer le mot de passe
                  </Button>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
