import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Page Contact : le message arrive dans l'administration de Smart Creator. Un champ
 * invisible sert de piège à robots ; aucune adresse de l'équipe n'est affichée.
 */

const TOPICS = [
  { value: 'question', label: 'Question sur le site' },
  { value: 'bug', label: 'Problème technique' },
  { value: 'partnership', label: 'Partenariat' },
  { value: 'data', label: 'Mes données personnelles' },
  { value: 'other', label: 'Autre' },
] as const;

type Topic = (typeof TOPICS)[number]['value'];

function firstIssue(error: ApiError): string {
  const issues = (error.details as { issues?: { message?: string }[] } | undefined)?.issues;
  return issues?.[0]?.message ?? error.message;
}

export function ContactPage() {
  useTrackVisit('/contact');
  usePublicPageMeta('/contact');
  const { account } = useAuth();
  const [name, setName] = useState(account?.name ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [params] = useSearchParams();
  const [topic, setTopic] = useState<Topic>(() => TOPICS.find((entry) => entry.value === params.get('sujet'))?.value ?? 'question');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!account) return;
    setName((current) => current || account.name);
    setEmail((current) => current || account.email);
  }, [account]);

  const ready = name.trim().length >= 2 && /\S+@\S+\.\S+/.test(email.trim()) && message.trim().length >= 10;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/api/contact', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), topic, message: message.trim(), ...(website ? { website } : {}) },
      });
      setSent(true);
    } catch (caught) {
      setError(toApiError(caught, 'Le message n’a pas pu être envoyé.'));
    } finally {
      setBusy(false);
    }
  };

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
            {sent ? (
              <Alert variant="success" role="status">
                <MailCheck />
                <AlertTitle>Message envoyé</AlertTitle>
                <AlertDescription>Merci. Nous vous répondrons à l’adresse {email.trim()}.</AlertDescription>
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
                    <Field>
                      <FieldLabel htmlFor="contact-name">Votre nom</FieldLabel>
                      <Input id="contact-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="contact-email">Votre adresse e-mail</FieldLabel>
                      <Input
                        id="contact-email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        maxLength={254}
                        autoComplete="email"
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="contact-topic">Sujet</FieldLabel>
                    <Select value={topic} onValueChange={(value) => setTopic(value as Topic)}>
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
                        Vous pouvez aussi télécharger une copie de vos données ou supprimer votre compte vous-même, depuis Mon
                        compte → Vos données.
                      </FieldDescription>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="contact-message">Message</FieldLabel>
                    <Textarea id="contact-message" value={message} onChange={(event) => setMessage(event.target.value)} rows={6} maxLength={5000} />
                    <FieldDescription>10 caractères au moins. N’indiquez ni mot de passe, ni code, ni clé API.</FieldDescription>
                  </Field>
                  {/* Piège à robots : invisible et hors du parcours clavier. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                    <label htmlFor="contact-website">Site web</label>
                    <input id="contact-website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
                  </div>
                  <Button type="submit" className="w-full sm:w-auto" disabled={!ready || busy}>
                    {busy && <Spinner />}
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
