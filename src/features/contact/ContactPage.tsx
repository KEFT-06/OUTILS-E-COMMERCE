import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Mail, MailCheck, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { apiRequest } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { useTrackVisit } from '@/shared/hooks/useTrackVisit';
import { usePublicPageMeta } from '@/shared/hooks/usePublicPageMeta';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { BrandLogo } from '@/shared/components/BrandLogo';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Page Contact : le message arrive dans l'administration de Smart Creator. Un champ
 * invisible sert de piège à robots ; aucune adresse de l'équipe n'est affichée.
 *
 * Mêmes règles que le serveur (server/services/contact) : chaque champ fautif dit ce qui
 * manque dès l'envoi, au lieu d'un bouton grisé sans explication.
 */

const TOPICS = [
  { value: 'question', label: 'Question sur le site' },
  { value: 'bug', label: 'Problème technique' },
  { value: 'partnership', label: 'Partenariat' },
  { value: 'data', label: 'Mes données personnelles' },
  { value: 'other', label: 'Autre' },
] as const;

type Topic = (typeof TOPICS)[number]['value'];

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Indiquez votre nom (2 caractères au moins).').max(80, '80 caractères au plus.'),
  email: z.string().trim().min(1, 'Indiquez votre adresse e-mail.').email('Adresse e-mail invalide : vérifiez-la.').max(254, 'Adresse trop longue.'),
  topic: z.enum(TOPICS.map((entry) => entry.value) as [Topic, ...Topic[]]),
  message: z.string().trim().min(10, 'Votre message doit contenir au moins 10 caractères.').max(5000, '5 000 caractères au plus.'),
  /** Champ piège invisible : un robot le remplit, une personne jamais. */
  website: z.string().optional(),
});

type ContactValues = z.infer<typeof contactSchema>;

function firstIssue(error: ApiError): string {
  const issues = (error.details as { issues?: { message?: string }[] } | undefined)?.issues;
  return issues?.[0]?.message ?? error.message;
}

export function ContactPage() {
  useTrackVisit('/contact');
  usePublicPageMeta('/contact');
  const { account } = useAuth();
  const [params] = useSearchParams();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: account?.name ?? '',
      email: account?.email ?? '',
      topic: TOPICS.find((entry) => entry.value === params.get('sujet'))?.value ?? 'question',
      message: '',
      website: '',
    },
  });
  const topic = form.watch('topic');
  const { getValues, setValue } = form;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Compte chargé après l'affichage : nom et adresse préremplis, sans écraser une saisie.
  useEffect(() => {
    if (!account) return;
    if (!getValues('name')) setValue('name', account.name);
    if (!getValues('email')) setValue('email', account.email);
  }, [account, getValues, setValue]);

  const submit = form.handleSubmit(async ({ name, email, topic: chosen, message, website }) => {
    setError(null);
    try {
      await apiRequest('/api/contact', {
        method: 'POST',
        body: { name, email, topic: chosen, message, ...(website ? { website } : {}) },
      });
      setSentTo(email);
    } catch (caught) {
      setError(toApiError(caught, 'Le message n’a pas pu être envoyé.'));
    }
  });

  return (
    <div className="flex min-h-svh flex-col items-center bg-background px-4 py-10">
      <header className="flex w-full max-w-xl items-center justify-between gap-4">
        <Link to="/" className="rounded-md" aria-label="Accueil Smart Creator">
          <BrandLogo size="md" />
        </Link>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft />
            Accueil
          </Link>
        </Button>
      </header>

      <main className="mt-10 w-full max-w-xl">
        <Card>
          <CardHeader>
            <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Mail className="size-5" aria-hidden="true" />
            </span>
            <CardTitle className="mt-2 font-display text-2xl font-extrabold tracking-tight">
              <h1>Nous écrire</h1>
            </CardTitle>
            <CardDescription>
              Une question, un problème, un partenariat ? Votre message arrive directement à l’équipe Smart Creator, qui
              vous répond par e-mail.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {sentTo ? (
              <Alert variant="success" role="status">
                <MailCheck />
                <AlertTitle>Message envoyé</AlertTitle>
                <AlertDescription>Merci. Nous vous répondrons à l’adresse {sentTo}.</AlertDescription>
              </Alert>
            ) : (
              <form onSubmit={(event) => void submit(event)} noValidate>
                <FieldGroup>
                  {error && (
                    <Alert variant="danger" role="alert">
                      <TriangleAlert />
                      <AlertTitle>{firstIssue(error)}</AlertTitle>
                    </Alert>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Controller
                      name="name"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor="contact-name">Votre nom</FieldLabel>
                          <Input {...field} id="contact-name" maxLength={80} autoComplete="name" aria-invalid={fieldState.invalid} />
                          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                      )}
                    />
                    <Controller
                      name="email"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor="contact-email">Votre adresse e-mail</FieldLabel>
                          <Input
                            {...field}
                            id="contact-email"
                            type="email"
                            maxLength={254}
                            autoComplete="email"
                            aria-invalid={fieldState.invalid}
                          />
                          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                      )}
                    />
                  </div>
                  <Controller
                    name="topic"
                    control={form.control}
                    render={({ field }) => (
                      <Field>
                        <FieldLabel htmlFor="contact-topic">Sujet</FieldLabel>
                        <Select value={field.value} onValueChange={(value) => field.onChange(value as Topic)}>
                          <SelectTrigger id="contact-topic" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TOPICS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {topic === 'data' && (
                          <FieldDescription>
                            Vous pouvez aussi télécharger une copie de vos données ou supprimer votre compte vous-même,
                            depuis Mon compte → Vos données.
                          </FieldDescription>
                        )}
                      </Field>
                    )}
                  />
                  <Controller
                    name="message"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="contact-message">Message</FieldLabel>
                        <Textarea {...field} id="contact-message" rows={6} maxLength={5000} aria-invalid={fieldState.invalid} />
                        {fieldState.invalid ? (
                          <FieldError errors={[fieldState.error]} />
                        ) : (
                          <FieldDescription>10 caractères au moins. N’indiquez ni mot de passe, ni code, ni clé API.</FieldDescription>
                        )}
                      </Field>
                    )}
                  />
                  {/* Piège à robots : invisible et hors du parcours clavier. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                    <label htmlFor="contact-website">Site web</label>
                    <input id="contact-website" tabIndex={-1} autoComplete="off" {...form.register('website')} />
                  </div>
                  <Button type="submit" className="w-full sm:w-auto" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && <Spinner />}
                    Envoyer le message
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
