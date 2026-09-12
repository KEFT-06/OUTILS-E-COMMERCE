import React, { useState } from 'react';
import {
  ArrowLeft,
  Zap,
  Bookmark,
  ShieldCheck,
  Check,
  Pencil,
  LogOut,
  ArrowRight,
  CreditCard,
  Info,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { usePreferences } from '@/app/providers/PreferencesContext';
import { BrandLogo } from '@/shared/ui/BrandLogo';
import { Button } from '@/shared/ui/button';

interface AccountViewProps {
  onBackToApp: () => void;
  onSelectSavedNiche: (nicheQuery: string) => void;
}

/** Les 5 paliers du chapitre 8 du cahier des charges. */
const PLANS = [
  { id: 'Gratuit', searches: '3 (aperçu)', highlight: false },
  { id: 'Plus', searches: '20 / mois', highlight: false },
  { id: 'Pro', searches: '60 / mois', highlight: true },
  { id: 'Max', searches: '60 / mois + vidéo', highlight: false },
  { id: 'Elite Enterprise', searches: 'Illimité', highlight: false },
] as const;

export const AccountView: React.FC<AccountViewProps> = ({ onBackToApp, onSelectSavedNiche }) => {
  const { user, logout, updateProfile } = useAuth();
  const { t } = usePreferences();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(user?.name ?? '');

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-[var(--text-muted)]">
          {t('Aucune session active.', 'No active session.')}
        </p>
      </div>
    );
  }

  const used = user.apiSearchesUsed;
  const limit = user.apiSearchesLimit;
  const remaining = Math.max(0, limit - used);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const barColor = pct < 50 ? 'bg-rate-excellent' : pct < 80 ? 'bg-rate-medium' : 'bg-rate-low';

  const saveName = () => {
    const clean = draftName.trim();
    if (clean) updateProfile({ name: clean });
    setIsEditing(false);
  };

  return (
    <div className="min-h-screen bg-[var(--surface-sunken)] text-[var(--text-primary)]">
      <header className="glass-1 sticky top-0 z-40 border-x-0 border-t-0 rounded-none">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <button
            type="button"
            onClick={onBackToApp}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:bg-slate-500/10 hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t('Retour à l’espace de travail', 'Back to workspace')}</span>
          </button>
          <BrandLogo size="sm" showText={false} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        {/* Identité */}
        <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-6 sm:p-8">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <img
              src={user.avatar}
              alt=""
              referrerPolicy="no-referrer"
              className="h-20 w-20 shrink-0 rounded-2xl object-cover ring-1 ring-[var(--border-subtle)]"
            />

            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveName();
                      if (e.key === 'Escape') setIsEditing(false);
                    }}
                    aria-label={t('Nom complet', 'Full name')}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <Button size="sm" onClick={saveName} className="gap-1.5">
                    <Check className="h-3.5 w-3.5" />
                    {t('Enregistrer', 'Save')}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-2xl font-black tracking-tight">{user.name}</h1>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(user.name);
                      setIsEditing(true);
                    }}
                    aria-label={t('Modifier le nom', 'Edit name')}
                    className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-slate-500/10"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <p className="mt-1 text-sm text-[var(--text-muted)]">{user.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-1 font-bold text-indigo-700 dark:text-indigo-300">
                  {t('Palier', 'Plan')} {user.plan}
                </span>
                <span className="text-[var(--text-muted)]">{user.role}</span>
                <span className="text-[var(--text-muted)]">
                  · {t('Membre depuis', 'Member since')} {user.joinedDate}
                </span>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={logout} className="gap-1.5 self-start">
              <LogOut className="h-3.5 w-3.5" />
              {t('Se déconnecter', 'Sign out')}
            </Button>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Solde de research points — simulateur de crédits (CdC ch. 8) */}
          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600">
                <Zap className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-bold">{t('Solde IA (Research Points)', 'AI Balance (Research Points)')}</h2>
            </div>

            <div className="mb-2 flex items-end gap-2">
              <span className="font-display text-4xl font-black tracking-tighter">{remaining}</span>
              <span className="mb-1 text-sm font-semibold text-[var(--text-muted)]">
                / {limit} {t('pts restants', 'pts left')}
              </span>
            </div>

            <div
              role="progressbar"
              aria-valuenow={used}
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-label={t('Consommation de crédits', 'Credit usage')}
              className="mb-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-500/15"
            >
              <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
            </div>

            <p className="mb-5 text-xs text-[var(--text-muted)]">
              {t(
                `${used} recherches consommées sur ce cycle de facturation.`,
                `${used} searches used in this billing cycle.`,
              )}
            </p>

            <Button className="w-full gap-2">
              <CreditCard className="h-3.5 w-3.5" />
              {t('Recharger le solde', 'Top up balance')}
            </Button>

            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-[var(--text-muted)]">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              {t(
                'Le coût de chaque génération est affiché avant validation, en points et en équivalent monétaire.',
                'The cost of each generation is shown before confirmation, in points and monetary equivalent.',
              )}
            </p>
          </section>

          {/* Niches suivies */}
          <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/12 text-indigo-600">
                <Bookmark className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-bold">{t('Niches enregistrées', 'Saved niches')}</h2>
            </div>

            {user.savedNiches.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--text-muted)]">
                {t('Aucune niche enregistrée pour le moment.', 'No saved niches yet.')}
              </p>
            ) : (
              <ul className="space-y-2">
                {user.savedNiches.map((niche) => (
                  <li key={niche}>
                    <button
                      type="button"
                      onClick={() => onSelectSavedNiche(niche)}
                      className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-3 text-left transition-colors hover:border-indigo-400"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{niche}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Paliers */}
        <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-6 sm:p-8">
          <h2 className="text-sm font-bold">{t('Paliers d’abonnement', 'Subscription plans')}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t(
              'Chaque palier débloque des modules, des méthodes de copywriting et des quotas de génération.',
              'Each plan unlocks modules, copywriting methods and generation quotas.',
            )}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {PLANS.map((plan) => {
              const isCurrent = plan.id === user.plan;
              return (
                <div
                  key={plan.id}
                  className={`rounded-2xl border p-4 ${
                    isCurrent
                      ? 'border-indigo-500 bg-indigo-500/8 ring-1 ring-indigo-500/20'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-sunken)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-black">{plan.id}</span>
                    {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">{plan.searches}</p>
                  {plan.highlight && !isCurrent && (
                    <span className="mt-2 inline-block rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700 dark:text-amber-400">
                      {t('populaire', 'popular')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Sécurité */}
        <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-6 sm:p-8">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-bold">{t('Sécurité et connexions', 'Security and connections')}</h2>
          </div>

          <ul className="space-y-3 text-xs">
            <li className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-3">
              <span>
                <span className="block font-semibold">{t('Comptes publicitaires connectés', 'Connected ad accounts')}</span>
                <span className="text-[var(--text-muted)]">
                  {t(
                    'Connexion par OAuth officiel uniquement. Révocable à tout moment.',
                    'Official OAuth connection only. Revocable at any time.',
                  )}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[var(--text-muted)]">{t('aucun', 'none')}</span>
            </li>
            <li className="flex items-start justify-between gap-4">
              <span>
                <span className="block font-semibold">
                  {t('Boucle de performance réelle', 'Real performance loop')}
                </span>
                <span className="text-[var(--text-muted)]">
                  {t(
                    'Partage anonymisé de vos ventes, agrégé à partir de 5 vendeurs minimum.',
                    'Anonymised sharing of your sales, aggregated from at least 5 sellers.',
                  )}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[var(--text-muted)]">{t('désactivée', 'disabled')}</span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
};
