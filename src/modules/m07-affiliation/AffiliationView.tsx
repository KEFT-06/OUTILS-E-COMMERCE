import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, ExternalLink, Info, Link2, Mail, Search } from 'lucide-react';
import { PageHeader } from '@/shared/components/PageHeader';
import { type ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { EMPTY_UTM, UTM_DOCUMENTATION_URL, type UtmFields, buildAffiliateLinks, buildUtmUrl } from '@/shared/lib/utm';
import type { AffiliateSummary, InvitationResult } from '@/shared/types/affiliation';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Affiliation : trois outils, chacun limité à ce qui est réellement possible.
 *  - liens de campagne UTM conformes à Google Analytics (entièrement local) ;
 *  - suivi d'un affilié Chariow par son code (l'API ne permet pas de les lister) ;
 *  - invitation d'affiliés par e-mail, qui envoie de vrais messages.
 *
 * Smart Creator ne calcule pas les commissions : Chariow les gère et en publie le
 * total par affilié.
 */

const MAX_INVITATIONS = 25;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UtmKey = keyof UtmFields;

const REQUIRED_FIELDS: { key: UtmKey; label: string; param: string; placeholder: string }[] = [
  { key: 'source', label: 'Source', param: 'utm_source', placeholder: 'ex. facebook' },
  { key: 'medium', label: 'Support', param: 'utm_medium', placeholder: 'ex. cpc, email' },
  { key: 'campaign', label: 'Campagne', param: 'utm_campaign', placeholder: 'ex. lancement_septembre' },
];

const OPTIONAL_FIELDS: { key: UtmKey; label: string; param: string; placeholder: string }[] = [
  { key: 'id', label: 'Identifiant de campagne', param: 'utm_id · recommandé', placeholder: 'ex. 2026-09-lancement' },
  { key: 'sourcePlatform', label: 'Plateforme', param: 'utm_source_platform · recommandé', placeholder: 'ex. meta_ads' },
  { key: 'content', label: 'Variante', param: 'utm_content', placeholder: 'ex. variante_b' },
  { key: 'term', label: 'Mot-clé payant', param: 'utm_term', placeholder: 'ex. template_notion' },
];

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('Lien copié');
  } catch {
    toast.error('Copie impossible', { description: 'Votre navigateur a refusé l’accès au presse-papiers.' });
  }
}

export function AffiliationView() {
  const [baseUrl, setBaseUrl] = useState('');
  const [fields, setFields] = useState<UtmFields>(EMPTY_UTM);
  const [codesInput, setCodesInput] = useState('');

  const [affiliateCode, setAffiliateCode] = useState('');
  const [affiliate, setAffiliate] = useState<AffiliateSummary | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<ApiError | null>(null);

  const [emailsInput, setEmailsInput] = useState('');
  const [consent, setConsent] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [invitation, setInvitation] = useState<InvitationResult | null>(null);
  const [invitationError, setInvitationError] = useState<ApiError | null>(null);

  const single = buildUtmUrl(baseUrl, fields);
  const codes = codesInput
    .split(/[\n,;]+/)
    .map((code) => code.trim())
    .filter(Boolean);
  const affiliateLinks = codes.length > 0 ? buildAffiliateLinks(baseUrl, fields, codes) : [];

  const emails = [...new Set(emailsInput.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const invalidEmails = emails.filter((email) => !EMAIL_PATTERN.test(email));
  const canInvite =
    emails.length > 0 && emails.length <= MAX_INVITATIONS && invalidEmails.length === 0 && consent && !isInviting;

  const setField = (key: UtmKey, value: string) => setFields((previous) => ({ ...previous, [key]: value }));

  const lookUp = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = affiliateCode.trim();
    if (!code) return;

    setIsLookingUp(true);
    setLookupError(null);
    setAffiliate(null);
    try {
      const response = await fetch(`/api/affiliation/chariow/affiliates/${encodeURIComponent(code)}`);
      if (!response.ok) throw await readApiError(response, `La recherche a échoué (${response.status}).`);
      setAffiliate((await response.json()) as AffiliateSummary);
    } catch (caught) {
      setLookupError(toApiError(caught, 'La recherche a échoué.'));
    } finally {
      setIsLookingUp(false);
    }
  };

  const invite = async () => {
    if (!canInvite) return;
    setIsInviting(true);
    setInvitationError(null);
    setInvitation(null);
    try {
      const response = await fetch('/api/affiliation/chariow/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, consent: true }),
      });
      if (!response.ok) throw await readApiError(response, `L'envoi a échoué (${response.status}).`);
      setInvitation((await response.json()) as InvitationResult);
      setEmailsInput('');
      setConsent(false);
    } catch (caught) {
      setInvitationError(toApiError(caught, "L'envoi a échoué."));
    } finally {
      setIsInviting(false);
    }
  };

  const renderUtmField = (field: (typeof REQUIRED_FIELDS)[number]) => (
    <Field key={field.key}>
      <FieldLabel htmlFor={`utm-${field.key}`}>{field.label}</FieldLabel>
      <Input
        id={`utm-${field.key}`}
        value={fields[field.key]}
        onChange={(event) => setField(field.key, event.target.value)}
        placeholder={field.placeholder}
        maxLength={100}
      />
      <FieldDescription className="font-mono text-xs">{field.param}</FieldDescription>
    </Field>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vendre"
        title="Affiliation"
        description="Liens de campagne traçables, suivi de vos affiliés Chariow et invitations."
      />

      <Alert variant="info">
        <Info />
        <AlertTitle>Les commissions restent gérées par Chariow</AlertTitle>
        <AlertDescription>
          Chariow calcule les commissions et publie le total gagné par chaque affilié. Le lien de parrainage d’un affilié
          se récupère dans son espace Chariow : son format n’est pas documenté publiquement, Smart Creator ne le fabrique
          donc pas. Les liens UTM le complètent pour la mesure.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="utm" className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            <TabsTrigger value="utm">
              <Link2 />
              Liens UTM
            </TabsTrigger>
            <TabsTrigger value="suivi">
              <Search />
              Suivi d’un affilié
            </TabsTrigger>
            <TabsTrigger value="invitations">
              <Mail />
              Invitations
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="utm">
          <Card>
            <CardHeader>
              <CardTitle>Créer un lien de campagne</CardTitle>
              <CardDescription>
                Paramètres reconnus par Google Analytics, vérifiés le 14 septembre 2026.{' '}
                <a
                  href={UTM_DOCUMENTATION_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-brand-green-text underline-offset-4 hover:underline"
                >
                  Documentation
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field>
                <FieldLabel htmlFor="utm-base">Adresse de destination</FieldLabel>
                <Input
                  id="utm-base"
                  type="url"
                  inputMode="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://… la page de votre produit"
                />
                <FieldDescription>Adresse en https uniquement.</FieldDescription>
              </Field>

              <div className="grid gap-4 sm:grid-cols-3">{REQUIRED_FIELDS.map(renderUtmField)}</div>

              <Collapsible className="rounded-lg border">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="group w-full justify-between rounded-lg px-4">
                    Paramètres facultatifs
                    <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="grid gap-4 border-t p-4 sm:grid-cols-2">
                  {OPTIONAL_FIELDS.map(renderUtmField)}
                </CollapsibleContent>
              </Collapsible>

              {single.ok ? (
                <div className="flex flex-col gap-2 rounded-lg border border-success-border bg-success-soft p-3 sm:flex-row sm:items-center">
                  <code className="min-w-0 flex-1 text-sm break-all">{single.url}</code>
                  <Button variant="outline" size="sm" onClick={() => void copyText(single.url)} className="shrink-0">
                    <Copy />
                    Copier
                  </Button>
                </div>
              ) : (
                (baseUrl || fields.source || fields.campaign) && (
                  <ul className="space-y-1">
                    {single.errors.map((error) => (
                      <li key={error} className="flex items-start gap-1.5 text-sm text-warning">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        {error}
                      </li>
                    ))}
                  </ul>
                )
              )}

              <Field className="border-t pt-5">
                <FieldLabel htmlFor="utm-codes">Un lien par affilié</FieldLabel>
                <Textarea
                  id="utm-codes"
                  value={codesInput}
                  onChange={(event) => setCodesInput(event.target.value)}
                  rows={2}
                  placeholder="Codes séparés par une virgule ou un retour à la ligne, ex. CREATOR123, PARTNER2025"
                />
                <FieldDescription>
                  La source reçoit le code de l’affilié et le support la valeur « affiliate ». Les valeurs sont mises en
                  minuscules, sans accents ni espaces : Google Analytics distingue « Facebook » de « facebook ».
                </FieldDescription>
              </Field>

              {affiliateLinks.length > 0 && (
                <ul className="space-y-2">
                  {affiliateLinks.map(({ code, result }) => (
                    <li key={code} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
                      <span className="w-28 shrink-0 truncate text-sm font-semibold">{code}</span>
                      {result.ok ? (
                        <>
                          <code className="min-w-0 flex-1 text-sm break-all text-muted-foreground">{result.url}</code>
                          <Button variant="outline" size="sm" onClick={() => void copyText(result.url)} className="shrink-0">
                            <Copy />
                            Copier
                          </Button>
                        </>
                      ) : (
                        <span className="text-sm text-warning">{result.errors.join(' ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suivi">
          <Card>
            <CardHeader>
              <CardTitle>Suivre un affilié Chariow</CardTitle>
              <CardDescription>Visites, ventes et gains publiés par Chariow pour un code d’affilié.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={lookUp} className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={affiliateCode}
                  onChange={(event) => setAffiliateCode(event.target.value)}
                  placeholder="Code de l’affilié, ex. CREATOR123"
                  maxLength={64}
                  aria-label="Code de l’affilié"
                />
                <Button type="submit" disabled={!affiliateCode.trim() || isLookingUp} className="shrink-0">
                  {isLookingUp ? <Spinner /> : <Search />}
                  Rechercher
                </Button>
              </form>

              {lookupError && (
                <Alert variant="danger">
                  <AlertTriangle />
                  <AlertDescription>{lookupError.message}</AlertDescription>
                </Alert>
              )}

              {affiliate && (
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      {affiliate.pseudo ?? affiliate.code}
                      {affiliate.country ? <span className="font-normal text-muted-foreground"> · {affiliate.country}</span> : null}
                    </p>
                    <Badge variant="secondary">{affiliate.status}</Badge>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/60 p-3">
                      <dt className="text-xs text-muted-foreground">Visites</dt>
                      <dd className="font-display text-lg font-extrabold tabular-nums">
                        {affiliate.totalVisits.toLocaleString('fr-FR')}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/60 p-3">
                      <dt className="text-xs text-muted-foreground">Ventes</dt>
                      <dd className="font-display text-lg font-extrabold tabular-nums">
                        {affiliate.totalSales.toLocaleString('fr-FR')}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/60 p-3">
                      <dt className="text-xs text-muted-foreground">Gains</dt>
                      <dd className="font-display text-lg font-extrabold tabular-nums">
                        {affiliate.totalEarnings?.formatted ?? '—'}
                      </dd>
                    </div>
                  </dl>
                  {(affiliate.firstVisitAt || affiliate.lastVisitAt) && (
                    <p className="text-xs text-muted-foreground">
                      {affiliate.firstVisitAt ? `Première visite le ${formatDateFr(affiliate.firstVisitAt)}` : ''}
                      {affiliate.firstVisitAt && affiliate.lastVisitAt ? ' · ' : ''}
                      {affiliate.lastVisitAt ? `dernière le ${formatDateFr(affiliate.lastVisitAt)}` : ''}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invitations">
          <Card>
            <CardHeader>
              <CardTitle>Inviter des affiliés</CardTitle>
              <CardDescription>Chariow envoie l’invitation depuis votre boutique.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>Envoi immédiat de vrais e-mails</AlertTitle>
                <AlertDescription>
                  Chariow écrit aux adresses saisies, {MAX_INVITATIONS} au plus par envoi. N’invitez que des personnes qui
                  ont accepté d’être contactées.
                </AlertDescription>
              </Alert>

              <Field>
                <FieldLabel htmlFor="invite-emails">Adresses e-mail</FieldLabel>
                <Textarea
                  id="invite-emails"
                  value={emailsInput}
                  onChange={(event) => setEmailsInput(event.target.value)}
                  rows={3}
                  placeholder="Séparées par une virgule, un espace ou un retour à la ligne"
                />
                <FieldDescription className="tabular-nums">
                  {emails.length} adresse(s)
                  {emails.length > MAX_INVITATIONS ? ` — au-delà de ${MAX_INVITATIONS}, l’envoi est refusé` : ''}
                  {invalidEmails.length > 0 ? ` — invalides : ${invalidEmails.join(', ')}` : ''}
                </FieldDescription>
              </Field>

              <div className="flex items-start gap-2.5">
                <Checkbox
                  id="invite-consent"
                  checked={consent}
                  onCheckedChange={(checked) => setConsent(checked === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="invite-consent" className="leading-relaxed font-normal">
                  Ces personnes ont accepté de recevoir une invitation de ma part.
                </Label>
              </div>

              <Button onClick={invite} disabled={!canInvite}>
                {isInviting ? <Spinner /> : <Mail />}
                Envoyer {emails.length > 0 ? `${emails.length} invitation(s)` : 'les invitations'}
              </Button>

              {invitationError && (
                <Alert variant="danger">
                  <AlertTriangle />
                  <AlertDescription>{invitationError.message}</AlertDescription>
                </Alert>
              )}
              {invitation && (
                <Alert variant="success">
                  <CheckCircle2 />
                  <AlertTitle>{invitation.sentCount} invitation(s) envoyée(s)</AlertTitle>
                  {invitation.skippedEmails.length > 0 && (
                    <AlertDescription>
                      Ignorées par Chariow (déjà affiliées ou déjà invitées) : {invitation.skippedEmails.join(', ')}.
                    </AlertDescription>
                  )}
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
