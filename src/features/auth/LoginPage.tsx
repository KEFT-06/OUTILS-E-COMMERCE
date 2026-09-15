import { useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTrackVisit } from '@/shared/lib/audience';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Check, KeyRound, Lock, ShieldCheck, Smartphone, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { CountryCombobox } from '@/shared/components/CountryCombobox';
import { guessCountryCode } from '@/shared/lib/geo';
import type { SecondFactorMethods } from '@/shared/types/auth';
import { PASSWORD_MIN_LENGTH, PasswordHints, PasswordInput } from '@/features/auth/PasswordInput';
import { passwordProblemsOf } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

/**
 * Connexion et inscription.
 *
 * Tout est vérifié par le serveur. Les messages ne disent jamais si une adresse
 * est inscrite ; un verrou après plusieurs essais est annoncé tel quel, avec son
 * délai, pour que la personne sache quoi faire.
 */

const emailField = z.string().trim().min(1, 'Indiquez votre adresse e-mail.').email('Adresse e-mail invalide.');

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Indiquez votre mot de passe.'),
});

const signupSchema = z
  .object({
    name: z.string().trim().min(2, 'Indiquez votre nom (2 caractères au moins).').max(80, '80 caractères au plus.'),
    email: emailField,
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `${PASSWORD_MIN_LENGTH} caractères au moins.`)
      .max(128, '128 caractères au plus.'),
    confirmation: z.string(),
    country: z.string().min(2, 'Choisissez votre pays : la devise des prix en dépend.'),
  })
  .refine((values) => values.password === values.confirmation, {
    message: 'Les deux mots de passe ne correspondent pas.',
    path: ['confirmation'],
  });

const mfaSchema = z.object({ code: z.string().trim().min(6, 'Saisissez votre code (6 caractères au moins).').max(128, 'Code trop long.') });

function AuthErrorAlert({ error }: { error: ApiError }) {
  const problems = passwordProblemsOf(error);
  const locked = error.code === 'TOO_MANY_ATTEMPTS';

  return (
    <Alert variant={locked ? 'warning' : 'danger'} role="alert">
      {locked ? <Lock /> : <TriangleAlert />}
      <AlertTitle>{locked ? 'Connexion temporairement bloquée' : error.message}</AlertTitle>
      {locked && <AlertDescription>{error.message}</AlertDescription>}
      {!locked && problems.length > 1 && (
        <AlertDescription>
          <ul className="list-disc space-y-0.5 pl-4">
            {problems.slice(1).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </AlertDescription>
      )}
    </Alert>
  );
}

function LoginForm({
  defaultEmail,
  onMfaRequired,
}: {
  defaultEmail: string;
  onMfaRequired: (methods: SecondFactorMethods | null) => void;
}) {
  const { login } = useAuth();
  const [error, setError] = useState<ApiError | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: defaultEmail, password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const { mfaRequired, methods } = await login(values);
      if (mfaRequired) onMfaRequired(methods);
    } catch (caught) {
      setError(toApiError(caught, 'La connexion a échoué.'));
      form.resetField('password');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {error && <AuthErrorAlert error={error} />}
        <Controller
          name="email"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="login-email">Adresse e-mail</FieldLabel>
              <Input
                {...field}
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="vous@exemple.com"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="password"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="login-password">Mot de passe</FieldLabel>
              <PasswordInput {...field} id="login-password" autoComplete="current-password" aria-invalid={fieldState.invalid} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner />}
          Se connecter
        </Button>
        <p className="text-center text-sm">
          <Link to="/mot-de-passe-oublie" className="font-medium text-brand-green-text underline-offset-4 hover:underline">
            Mot de passe oublié ?
          </Link>
        </p>
      </FieldGroup>
    </form>
  );
}

function MfaForm({ methods, onBack }: { methods: SecondFactorMethods | null; onBack: () => void }) {
  const codeOnly = Boolean(methods?.code && !methods.app);
  const appOnly = Boolean(methods?.app && !methods.code);
  const { verifyMfa } = useAuth();
  const [error, setError] = useState<ApiError | null>(null);
  const form = useForm<z.infer<typeof mfaSchema>>({ resolver: zodResolver(mfaSchema), defaultValues: { code: '' } });
  const expired = error?.code === 'MFA_CHALLENGE_EXPIRED';

  const onSubmit = form.handleSubmit(async ({ code }) => {
    setError(null);
    try {
      await verifyMfa(code);
    } catch (caught) {
      setError(toApiError(caught, 'La vérification a échoué.'));
      form.resetField('code');
    }
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          {codeOnly ? <KeyRound className="size-5" aria-hidden="true" /> : <Smartphone className="size-5" aria-hidden="true" />}
        </span>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Vérification en deux étapes</h1>
        <p className="text-sm text-muted-foreground">
          {codeOnly
            ? 'Saisissez votre code de sécurité : celui que vous avez choisi en plus de votre mot de passe.'
            : appOnly
              ? 'Ouvrez votre application d’authentification et saisissez le code affiché pour Smart Creator.'
              : 'Saisissez votre code de sécurité, ou le code affiché par votre application d’authentification.'}
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          {error && <AuthErrorAlert error={error} />}
          {!expired && (
            <>
              <Controller
                name="code"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="mfa-code">{codeOnly ? 'Code de sécurité' : 'Code de vérification'}</FieldLabel>
                    {appOnly ? (
                      <Input
                        {...field}
                        id="mfa-code"
                        inputMode="text"
                        autoComplete="one-time-code"
                        autoFocus
                        placeholder="123456"
                        className="h-12 text-center text-xl font-semibold tracking-[0.3em] tabular-nums"
                        aria-invalid={fieldState.invalid}
                      />
                    ) : (
                      <PasswordInput {...field} id="mfa-code" autoComplete="off" autoFocus aria-invalid={fieldState.invalid} />
                    )}
                    <FieldDescription>
                      {methods?.app
                        ? 'Téléphone perdu ? Saisissez l’un de vos codes de secours, au format XXXX-XXXX.'
                        : 'Code oublié ? L’administrateur de Smart Creator peut réinitialiser votre second facteur.'}
                    </FieldDescription>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Spinner />}
                Vérifier et me connecter
              </Button>
            </>
          )}
          <Button type="button" variant={expired ? 'default' : 'ghost'} className="w-full" onClick={onBack}>
            <ArrowLeft />
            {expired ? 'Recommencer la connexion' : 'Retour'}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}

function SignupForm() {
  const { signup } = useAuth();
  const [error, setError] = useState<ApiError | null>(null);
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', email: '', password: '', confirmation: '', country: guessCountryCode() ?? '' },
  });
  const password = form.watch('password');

  const onSubmit = form.handleSubmit(async ({ name, email, password: chosen, country }) => {
    setError(null);
    try {
      await signup({ name, email, password: chosen, country });
    } catch (caught) {
      setError(toApiError(caught, 'La création du compte a échoué.'));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {error && <AuthErrorAlert error={error} />}
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="signup-name">Nom</FieldLabel>
              <Input {...field} id="signup-name" autoComplete="name" aria-invalid={fieldState.invalid} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="email"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="signup-email">Adresse e-mail</FieldLabel>
              <Input
                {...field}
                id="signup-email"
                type="email"
                autoComplete="email"
                placeholder="vous@exemple.com"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="country"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="signup-country">Pays</FieldLabel>
              <CountryCombobox
                id="signup-country"
                value={field.value}
                onChange={field.onChange}
                showCurrency
                invalid={fieldState.invalid}
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : (
                <FieldDescription>Les prix s’affichent dans la devise de votre pays.</FieldDescription>
              )}
            </Field>
          )}
        />
        <Controller
          name="password"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="signup-password">Mot de passe</FieldLabel>
              <PasswordInput {...field} id="signup-password" autoComplete="new-password" aria-invalid={fieldState.invalid} />
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
              <FieldLabel htmlFor="signup-confirmation">Confirmez le mot de passe</FieldLabel>
              <PasswordInput {...field} id="signup-confirmation" autoComplete="new-password" aria-invalid={fieldState.invalid} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner />}
          Créer mon compte gratuit
        </Button>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          En créant un compte, vous acceptez les{' '}
          <Link to="/conditions" className="font-medium text-brand-green-text underline-offset-4 hover:underline">
            conditions d’utilisation
          </Link>{' '}
          et la{' '}
          <Link to="/confidentialite" className="font-medium text-brand-green-text underline-offset-4 hover:underline">
            politique de confidentialité
          </Link>
          .
        </p>
      </FieldGroup>
    </form>
  );
}

const PROMISES = [
  'Chaque taux s’ouvre sur le détail de son calcul.',
  'La conformité publicitaire est vérifiée avant chaque export.',
  'Le coût en points s’affiche avant chaque action.',
];

const SECURITY = [
  { icon: KeyRound, text: 'Mot de passe haché avec Argon2id : il n’est jamais stocké en clair.' },
  { icon: Lock, text: 'Connexion bloquée automatiquement après cinq essais erronés.' },
  { icon: ShieldCheck, text: 'Code de sécurité ou application en second facteur, obligatoire pour l’administration.' },
];

export function LoginPage() {
  useTrackVisit('/connexion');
  const { status, isAuthenticated } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const state = location.state as { from?: string; email?: string } | null;
  const [tab, setTab] = useState(params.get('mode') === 'inscription' ? 'signup' : 'login');
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [methods, setMethods] = useState<SecondFactorMethods | null>(null);

  if (isAuthenticated) {
    return <Navigate to={state?.from?.startsWith('/app') ? state.from : '/app/cockpit'} replace />;
  }

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
      <aside className="hidden flex-col justify-between border-r bg-card p-10 lg:flex">
        <Link to="/" className="self-start rounded-md" aria-label="Accueil Smart Creator">
          <BrandLogo size="md" showTagline />
        </Link>

        <div className="max-w-md space-y-8">
          <div className="space-y-6">
            <h2 className="font-display text-4xl leading-tight font-extrabold tracking-tight">
              Sachez quoi vendre avant de le produire.
            </h2>
            <ul className="space-y-3">
              {PROMISES.map((promise) => (
                <li key={promise} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                  {promise}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3 rounded-xl border bg-background p-5">
            <p className="text-sm font-semibold">Votre compte est protégé</p>
            <ul className="space-y-2.5">
              {SECURITY.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <Icon className="mt-0.5 size-4 shrink-0 text-brand-green-text" aria-hidden="true" />
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Smart Creator fournit des analyses basées sur des données publiques. Aucun résultat financier n’est garanti.
        </p>
      </aside>

      <main className="flex flex-col px-4 py-4 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft />
              Accueil
            </Link>
          </Button>
          <BrandLogo size="sm" className="lg:hidden" />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-10">
          {status === 'loading' ? (
            <div role="status" className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
              <Spinner className="size-5" />
              Vérification de votre session…
            </div>
          ) : step === 'mfa' ? (
            <MfaForm methods={methods} onBack={() => setStep('credentials')} />
          ) : (
            <>
              <div className="space-y-2">
                <h1 className="font-display text-3xl font-extrabold tracking-tight">Accéder à votre espace</h1>
                <p className="text-sm text-muted-foreground">
                  Radar, analyses, studio de création et kit de lancement au même endroit.
                </p>
              </div>

              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">Se connecter</TabsTrigger>
                  <TabsTrigger value="signup">Créer un compte</TabsTrigger>
                </TabsList>
                <TabsContent value="login" className="pt-4">
                  <LoginForm defaultEmail={state?.email ?? ''} onMfaRequired={(next) => {
                      setMethods(next);
                      setStep('mfa');
                    }} />
                </TabsContent>
                <TabsContent value="signup" className="pt-4">
                  <SignupForm />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
