import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Info, Link2, Loader2, Mail, Search, Users } from 'lucide-react';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import {
  EMPTY_UTM,
  UTM_DOCUMENTATION_URL,
  UtmFields,
  buildAffiliateLinks,
  buildUtmUrl,
} from '@/shared/lib/utm';
import { AffiliateSummary, InvitationResult } from '@/shared/types/affiliation';

/**
 * Affiliation — Lot 6.
 *
 * Trois outils, chacun limité à ce qui est réellement possible :
 *  - liens de campagne UTM conformes à Google Analytics (entièrement local) ;
 *  - suivi d'un affilié Chariow par son code (l'API ne permet pas de les lister) ;
 *  - invitation d'affiliés par e-mail, qui envoie de vrais messages.
 *
 * Smart Creator ne calcule pas les commissions : Chariow les gère et en publie
 * le total par affilié. Le format des liens de parrainage Chariow n'est pas
 * documenté publiquement ; l'affilié obtient le sien dans son espace Chariow.
 */

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500';

const MAX_INVITATIONS = 25;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CopyButton: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copier le lien"
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:border-indigo-300"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copié' : 'Copier'}
    </button>
  );
};

export const AffiliationView: React.FC = () => {
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
  const codes = codesInput.split(/[\n,;]+/).map((code) => code.trim()).filter(Boolean);
  const affiliateLinks = codes.length > 0 ? buildAffiliateLinks(baseUrl, fields, codes) : [];

  const emails = [...new Set(emailsInput.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const invalidEmails = emails.filter((email) => !EMAIL_PATTERN.test(email));
  const canInvite =
    emails.length > 0 && emails.length <= MAX_INVITATIONS && invalidEmails.length === 0 && consent && !isInviting;

  const setField = (key: keyof UtmFields, value: string) => setFields((previous) => ({ ...previous, [key]: value }));

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

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header>
        <span className="mb-2 inline-block rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700">
          Module 07
        </span>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          <Users className="h-6 w-6 text-indigo-600" />
          Affiliation
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Liens de campagne traçables, suivi de vos affiliés Chariow et invitations.
        </p>
      </header>

      <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p className="text-xs leading-relaxed text-slate-600">
          Smart Creator ne calcule pas les commissions : Chariow les gère et publie le total gagné par chaque affilié.
          Le lien de parrainage d'un affilié se récupère dans son espace Chariow — son format n'est pas documenté
          publiquement, Smart Creator ne le fabrique donc pas. Les liens UTM ci-dessous le complètent pour la mesure.
        </p>
      </div>

      <section className="space-y-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Link2 className="h-4 w-4 text-indigo-600" />
          Liens de campagne UTM
        </h2>

        <label className="block">
          <span className={labelClass}>Adresse de destination (https)</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="ex. la page de votre produit" className={fieldClass} />
        </label>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ['source', 'utm_source (obligatoire)', 'ex. facebook'],
              ['medium', 'utm_medium (obligatoire)', 'ex. cpc, email'],
              ['campaign', 'utm_campaign (obligatoire)', 'ex. lancement_septembre'],
              ['id', 'utm_id (recommandé)', 'identifiant de campagne'],
              ['sourcePlatform', 'utm_source_platform (recommandé)', 'ex. meta_ads'],
              ['content', 'utm_content', 'ex. variante_b'],
              ['term', 'utm_term', 'mot-clé payant'],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="block">
              <span className={labelClass}>{label}</span>
              <input value={fields[key]} onChange={(e) => setField(key, e.target.value)} placeholder={placeholder} maxLength={100} className={fieldClass} />
            </label>
          ))}
        </div>

        {single.ok ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
            <code className="min-w-0 flex-1 break-all text-[11px] text-emerald-900">{single.url}</code>
            <CopyButton value={single.url} />
          </div>
        ) : (
          (baseUrl || fields.source || fields.campaign) && (
            <ul className="space-y-0.5">
              {single.errors.map((error) => (
                <li key={error} className="text-[11px] text-rose-700">
                  {error}
                </li>
              ))}
            </ul>
          )
        )}

        <label className="block">
          <span className={labelClass}>Un lien par affilié (codes séparés par une virgule ou un retour à la ligne)</span>
          <textarea value={codesInput} onChange={(e) => setCodesInput(e.target.value)} rows={2} placeholder="ex. CREATOR123, PARTNER2025" className={fieldClass} />
          <span className="mt-1 block text-[11px] text-slate-400">
            utm_source reçoit le code de l'affilié et utm_medium la valeur « affiliate ». Valeurs mises en minuscules,
            sans accents ni espaces : Google Analytics distingue « Facebook » de « facebook ».
          </span>
        </label>

        {affiliateLinks.length > 0 && (
          <ul className="space-y-1.5">
            {affiliateLinks.map(({ code, result }) => (
              <li key={code} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <span className="w-24 shrink-0 truncate text-xs font-bold text-slate-700">{code}</span>
                {result.ok ? (
                  <>
                    <code className="min-w-0 flex-1 break-all text-[11px] text-slate-600">{result.url}</code>
                    <CopyButton value={result.url} />
                  </>
                ) : (
                  <span className="text-[11px] text-rose-700">{result.errors.join(' ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-slate-400">
          Paramètres reconnus par Google Analytics, vérifiés le 14 septembre 2026.{' '}
          <a href={UTM_DOCUMENTATION_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-indigo-600">
            documentation
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </section>

      <section className="space-y-3 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Search className="h-4 w-4 text-indigo-600" />
          Suivre un affilié Chariow
        </h2>
        <form onSubmit={lookUp} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={affiliateCode}
            onChange={(e) => setAffiliateCode(e.target.value)}
            placeholder="Code de l'affilié, ex. CREATOR123"
            maxLength={64}
            aria-label="Code de l'affilié"
            className={fieldClass}
          />
          <button
            type="submit"
            disabled={!affiliateCode.trim() || isLookingUp}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-600 disabled:bg-slate-300"
          >
            {isLookingUp && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Rechercher
          </button>
        </form>

        {lookupError && <p className="text-xs text-rose-700">{lookupError.message}</p>}

        {affiliate && (
          <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">
                {affiliate.pseudo ?? affiliate.code}
                {affiliate.country ? <span className="font-normal text-slate-500"> · {affiliate.country}</span> : null}
              </p>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                {affiliate.status}
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[10px] font-bold uppercase text-slate-500">Visites</dt>
                <dd className="text-lg font-black text-slate-900">{affiliate.totalVisits.toLocaleString('fr-FR')}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[10px] font-bold uppercase text-slate-500">Ventes</dt>
                <dd className="text-lg font-black text-slate-900">{affiliate.totalSales.toLocaleString('fr-FR')}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[10px] font-bold uppercase text-slate-500">Gains</dt>
                <dd className="text-lg font-black text-slate-900">{affiliate.totalEarnings?.formatted ?? '—'}</dd>
              </div>
            </dl>
            {(affiliate.firstVisitAt || affiliate.lastVisitAt) && (
              <p className="text-[11px] text-slate-400">
                {affiliate.firstVisitAt ? `Première visite le ${formatDateFr(affiliate.firstVisitAt)}` : ''}
                {affiliate.firstVisitAt && affiliate.lastVisitAt ? ' · ' : ''}
                {affiliate.lastVisitAt ? `dernière le ${formatDateFr(affiliate.lastVisitAt)}` : ''}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Mail className="h-4 w-4 text-indigo-600" />
          Inviter des affiliés
        </h2>

        <div className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-amber-900">
            <strong>Envoi immédiat de vrais e-mails</strong> par Chariow aux adresses saisies, {MAX_INVITATIONS} au plus par envoi.
            N'invitez que des personnes qui ont accepté d'être contactées.
          </p>
        </div>

        <textarea
          value={emailsInput}
          onChange={(e) => setEmailsInput(e.target.value)}
          rows={3}
          placeholder="adresses séparées par une virgule, un espace ou un retour à la ligne"
          aria-label="Adresses e-mail à inviter"
          className={fieldClass}
        />
        <p className="text-[11px] text-slate-500">
          {emails.length} adresse(s)
          {emails.length > MAX_INVITATIONS ? ` — au-delà de ${MAX_INVITATIONS}, l'envoi est refusé` : ''}
          {invalidEmails.length > 0 ? ` — invalides : ${invalidEmails.join(', ')}` : ''}
        </p>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
          Ces personnes ont accepté de recevoir une invitation de ma part.
        </label>

        <button
          type="button"
          onClick={invite}
          disabled={!canInvite}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isInviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          Envoyer {emails.length > 0 ? `${emails.length} invitation(s)` : 'les invitations'}
        </button>

        {invitationError && <p className="text-xs text-rose-700">{invitationError.message}</p>}
        {invitation && (
          <p className="text-xs text-emerald-700">
            {invitation.sentCount} invitation(s) envoyée(s)
            {invitation.skippedEmails.length > 0
              ? ` · ignorées par Chariow (déjà affiliées ou déjà invitées) : ${invitation.skippedEmails.join(', ')}`
              : ''}
            .
          </p>
        )}
      </section>
    </div>
  );
};
