import { Link, Navigate, useLocation } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Check, Info, PlayCircle } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Separator } from '@/shared/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

/**
 * Connexion.
 *
 * Il n'existe pas encore d'authentification serveur : aucun mot de passe n'est
 * demandé, parce qu'aucun ne serait vérifié. L'ancien écran affichait un champ
 * mot de passe pré-rempli, l'adresse du fondateur et « chiffré SSL 256-bit ».
 */

const emailField = z.string().trim().min(1, 'Indiquez votre adresse e-mail.').email('Adresse e-mail invalide.');

const loginSchema = z.object({ email: emailField });
const signupSchema = z.object({
  name: z.string().trim().min(2, 'Indiquez votre nom (2 caractères au moins).').max(80, '80 caractères au plus.'),
  email: emailField,
});

function LoginForm() {
  const { login } = useAuth();
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '' },
  });

  return (
    <form onSubmit={form.handleSubmit(({ email }) => login(email))} noValidate>
      <FieldGroup>
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
        <Button type="submit" className="w-full">
          Se connecter
        </Button>
      </FieldGroup>
    </form>
  );
}

function SignupForm() {
  const { signup } = useAuth();
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', email: '' },
  });

  return (
    <form onSubmit={form.handleSubmit(({ name, email }) => signup(name, email))} noValidate>
      <FieldGroup>
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
        <Button type="submit" className="w-full">
          Créer mon compte
        </Button>
      </FieldGroup>
    </form>
  );
}

const PROMISES = [
  'Chaque taux s’ouvre sur le détail de son calcul.',
  'La conformité publicitaire est vérifiée avant chaque export.',
  'Le coût en points s’affiche avant chaque action.',
];

export function LoginPage() {
  const { isAuthenticated, loginDemo } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (isAuthenticated) {
    return <Navigate to={from?.startsWith('/app') ? from : '/app/cockpit'} replace />;
  }

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
      <aside className="hidden flex-col justify-between border-r bg-card p-10 lg:flex">
        <Link to="/" className="self-start rounded-md" aria-label="Accueil Smart Creator">
          <BrandLogo size="md" showTagline />
        </Link>

        <div className="max-w-md space-y-6">
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
          <div className="space-y-2">
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Accéder à votre espace</h1>
            <p className="text-sm text-muted-foreground">
              Radar, analyses, studio de création et kit de lancement au même endroit.
            </p>
          </div>

          <Alert>
            <Info />
            <AlertTitle>Version locale</AlertTitle>
            <AlertDescription>
              Aucun mot de passe n’est demandé ni vérifié : votre profil reste enregistré dans ce navigateur, en
              attendant les comptes sécurisés.
            </AlertDescription>
          </Alert>

          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Se connecter</TabsTrigger>
              <TabsTrigger value="signup">Créer un compte</TabsTrigger>
            </TabsList>
            <TabsContent value="login" className="pt-4">
              <LoginForm />
            </TabsContent>
            <TabsContent value="signup" className="pt-4">
              <SignupForm />
            </TabsContent>
          </Tabs>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            ou
            <Separator className="flex-1" />
          </div>

          <div className="space-y-2">
            <Button variant="outline" className="w-full" onClick={loginDemo}>
              <PlayCircle />
              Explorer la démonstration
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Compte fictif et rapports d’exemple, étiquetés comme tels.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
