import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Inbox, Languages, LogIn, ShieldCheck } from 'lucide-react';
import { languageName } from '@server/shared/languages';
import { useAuth } from '@/features/auth/AuthContext';
import { SecondFactorChooser } from '@/features/auth/SecurityCodeForm';
import { LanguageMultiPicker, LanguageName } from '@/modules/multilingue/LanguagePicker';
import { type ReviewItem, type ReviewerDashboard, reviewsApi } from '@/modules/multilingue/guidesApi';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr, formatRelativeFr } from '@/shared/lib/formatDate';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog';
import { NoDataState } from '@/shared/components/NoDataState';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Espace des relecteurs natifs. Un relecteur voit les demandes dans ses langues
 * maternelles, sans leur texte ; il le découvre en prenant une demande en charge.
 */

const MAX_LANGUAGES = 8;

function LanguagesDialog({ current, onSaved }: { current: string[]; onSaved: (dashboard: ReviewerDashboard) => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(current);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await reviewsApi.setLanguages(selected));
      toast.success('Langues enregistrées');
      setOpen(false);
    } catch (caught) {
      toast.error('Enregistrement impossible', { description: toApiError(caught, 'Les langues n’ont pas pu être enregistrées.').message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSelected(current);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Languages />
          {current.length === 0 ? 'Choisir mes langues' : 'Modifier'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mes langues maternelles</DialogTitle>
          <DialogDescription>
            Ne choisissez que les langues que vous parlez depuis l’enfance : la relecture native en dépend. {MAX_LANGUAGES} au plus.
          </DialogDescription>
        </DialogHeader>
        <LanguageMultiPicker selected={selected} onChange={setSelected} unavailable={{}} remaining={MAX_LANGUAGES} />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Spinner />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pair({ item }: { item: ReviewItem }) {
  return (
    <span className="text-sm text-muted-foreground">
      {languageName(item.from)} → <span className="font-medium text-foreground">{languageName(item.to)}</span> ·{' '}
      {item.words.toLocaleString('fr-FR')} mots
    </span>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<ReviewerDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    reviewsApi
      .dashboard()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Les relectures n’ont pas pu être chargées.').message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const claim = async (id: string) => {
    setClaiming(id);
    try {
      await reviewsApi.claim(id);
      navigate(`/app/multilingue/relectures/${id}`);
    } catch (caught) {
      toast.error('Prise en charge impossible', { description: toApiError(caught, 'La demande n’est plus disponible.').message });
      setData(await reviewsApi.dashboard().catch(() => data));
    } finally {
      setClaiming(null);
    }
  };

  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4" role="status" aria-label="Chargement des relectures">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Mes langues maternelles</h2>
          </CardTitle>
          <CardDescription>Vous ne recevez que les demandes dans ces langues.</CardDescription>
          <CardAction>
            <LanguagesDialog current={data.languages} onSaved={setData} />
          </CardAction>
        </CardHeader>
        <CardContent>
          {data.languages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune langue choisie pour l’instant.</p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Langues maternelles">
              {data.languages.map((code) => (
                <li key={code}>
                  <Badge variant="secondary" className="px-2.5 py-1 text-sm">
                    <LanguageName code={code} />
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {data.mine.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Mes relectures en cours</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.mine.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.guideTitle}</p>
                    <Pair item={item} />
                  </div>
                  <Button size="sm" asChild>
                    <Link to={`/app/multilingue/relectures/${item.id}`}>
                      Continuer
                      <ArrowRight />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Demandes en attente</h2>
          </CardTitle>
          <CardDescription>Le texte s’affiche une fois la demande prise en charge. Ne prenez que ce que vous pouvez rendre rapidement.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.queue.length === 0 ? (
            <NoDataState
              icon={Inbox}
              title="Aucune demande dans vos langues"
              reason={data.languages.length === 0 ? 'Choisissez d’abord vos langues maternelles.' : 'Les nouvelles demandes apparaîtront ici.'}
            />
          ) : (
            <ul className="divide-y">
              {data.queue.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate font-medium">{item.guideTitle}</p>
                    <Pair item={item} />
                    {item.note && <p className="text-xs text-muted-foreground">Consignes : {item.note}</p>}
                    {item.requestedAt && <p className="text-xs text-muted-foreground">Demandée {formatRelativeFr(item.requestedAt)}</p>}
                  </div>
                  <Button size="sm" onClick={() => void claim(item.id)} disabled={claiming !== null}>
                    {claiming === item.id && <Spinner />}
                    Prendre en charge
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {data.completed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Relectures rendues</h2>
            </CardTitle>
            <CardDescription>Le texte n’est plus accessible une fois la relecture rendue.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {data.completed.map((item) => (
                <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 truncate">{item.guideTitle}</span>
                  <span className="text-xs text-muted-foreground">
                    {languageName(item.to)}
                    {item.reviewedAt ? ` · ${formatDateFr(item.reviewedAt)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ReviewerPanel() {
  const { account, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  if (!account) return null;

  if (!account.twoFactor.enabled) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-brand-green-text" aria-hidden="true" />
              Protégez d’abord votre compte
            </h2>
          </CardTitle>
          <CardDescription>
            Les relecteurs lisent des guides confiés par d’autres créateurs : un second facteur est obligatoire.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SecondFactorChooser account={account} />
        </CardContent>
      </Card>
    );
  }

  if (!account.twoFactor.sessionVerified) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            <h2>Confirmez votre identité</h2>
          </CardTitle>
          <CardDescription>Cette session a été ouverte avant votre second facteur. Reconnectez-vous : votre code vous sera demandé.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              void logout().finally(() => navigate('/connexion', { state: { from: location.pathname, email: account.email } }));
            }}
          >
            <LogIn />
            Me reconnecter
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <Dashboard />;
}
