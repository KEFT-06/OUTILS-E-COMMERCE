import { countryName } from '@server/shared/countries';
import { CountryFlag } from '@/shared/components/CountryFlag';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Info, KeyRound, ShieldOff, TriangleAlert, UserCog } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { type AdminMeta, type AdminUserDetail, useAdminMeta, useAdminResource } from '@/features/admin/adminApi';
import {
  ChangePlanDialog,
  GrantCreditsDialog,
  PasswordLinkDialog,
  RecordPaymentDialog,
  RefillPlanCreditsDialog,
  RefundPaymentDialog,
  RevokeSessionsDialog,
  SuspendDialog,
} from '@/features/admin/AdminDialogs';
import { AdminErrorAlert, PresenceLabel, StepUpDialog } from '@/features/admin/components';
import { describeAuditDetails } from '@/features/admin/format';
import { initialsOf, useAuth } from '@/features/auth/AuthContext';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr, formatRelativeFr } from '@/shared/lib/formatDate';
import {
  AUDIT_ACTION_LABELS,
  CREDIT_REASON_LABELS,
  FILE_FORMAT_LABELS,
  GENERATION_KIND_LABELS,
  GENERATION_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  labelOf,
} from '@/shared/lib/labels';
import { formatPaymentAmount } from '@/features/admin/format';
import { cn } from '@/shared/lib/utils';
import type { FeatureId, Permission } from '@/shared/types/auth';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';
import { NoDataState } from '@/shared/ui/NoDataState';
import { Progress } from '@/shared/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <Link to="/app/admin/utilisateurs">
        <ArrowLeft />
        Utilisateurs
      </Link>
    </Button>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function signed(delta: number) {
  return (
    <span className={cn('font-semibold tabular-nums', delta > 0 && 'text-success', delta < 0 && 'text-danger')}>
      {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0'}
    </span>
  );
}

export function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { account } = useAuth();
  const meta = useAdminMeta();
  const { data, error, reload, setData } = useAdminResource<AdminUserDetail>(userId ? `/api/admin/users/${userId}` : null);

  if (!account) return null;

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        {error ? (
          <AdminErrorAlert error={error} onRetry={() => void reload()} />
        ) : (
          <div className="space-y-4" role="status" aria-label="Chargement de la fiche">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        )}
      </div>
    );
  }

  const has = (permission: Permission) => account.permissions.includes(permission);
  const isAdmin = account.role === 'admin';
  const isSelf = data.user.id === account.id;
  const canActOnTarget = isAdmin || (data.user.role !== 'admin' && !isSelf);
  const canManage = has('admin.users.manage') && canActOnTarget;
  const canCredits = has('admin.credits.grant') && canActOnTarget;
  const canPayments = has('admin.payments.record') && canActOnTarget;
  const planLabels = Object.fromEntries((meta?.plans ?? []).map((plan) => [plan.id, plan.label]));
  const update = (detail: AdminUserDetail) => setData(detail);

  return (
    <div className="space-y-6">
      <BackLink />

      <Card>
        <CardContent className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <Avatar className="size-16 rounded-xl">
            <AvatarFallback className="rounded-xl bg-accent text-lg font-semibold text-accent-foreground">
              {initialsOf(data.user.name)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="truncate font-display text-2xl font-extrabold tracking-tight">{data.user.name}</h1>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <span className="truncate">{data.user.email}</span>
              {data.user.country && (
                <>
                  <span aria-hidden="true">·</span>
                  <CountryFlag code={data.user.country} />
                  {countryName(data.user.country)}
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.user.plan.id === 'free' ? 'secondary' : 'brand'}>Palier {data.user.plan.label}</Badge>
              {data.user.role === 'admin' ? (
                <Badge variant="info">Administrateur</Badge>
              ) : data.user.isStaff ? (
                <Badge variant="outline">Équipe</Badge>
              ) : null}
              {data.user.status === 'suspended' && <Badge variant="danger">Suspendu</Badge>}
              {data.user.twoFactorEnabled ? (
                <Badge variant="success">
                  {data.user.twoFactorMethods.code && !data.user.twoFactorMethods.app ? 'Code de sécurité' : 'Second facteur actif'}
                </Badge>
              ) : (
                <Badge variant="outline">Sans second facteur</Badge>
              )}
              {!data.user.passwordSet && <Badge variant="warning">Mot de passe pas encore choisi</Badge>}
              <PresenceLabel online={data.user.online} lastSeenAt={data.user.lastSeenAt} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
            {canCredits && <GrantCreditsDialog detail={data} onDone={update} />}
            {canPayments && meta && (
              <RecordPaymentDialog plans={meta.plans} presetUser={data.user} presetPlan={data.user.plan.id} onDone={() => void reload()} />
            )}
            {canManage && meta && <ChangePlanDialog detail={data} plans={meta.plans} onDone={update} />}
            {canManage && !isSelf && <PasswordLinkDialog detail={data} />}
            {canManage && !isSelf && <RevokeSessionsDialog detail={data} onDone={() => void reload()} />}
            {canManage && !isSelf && <SuspendDialog detail={data} onDone={update} />}
          </div>
        </CardContent>
      </Card>

      {data.user.status === 'suspended' && (
        <Alert variant="danger">
          <TriangleAlert />
          <AlertTitle>Compte suspendu</AlertTitle>
          <AlertDescription>{data.user.suspendedReason ?? 'Aucune raison indiquée.'}</AlertDescription>
        </Alert>
      )}
      {isSelf && (
        <Alert variant="info">
          <Info />
          <AlertDescription>
            C’est votre propre compte : mot de passe, appareils et double authentification se gèrent dans Mon compte.
          </AlertDescription>
        </Alert>
      )}
      {!canActOnTarget && !isSelf && (
        <Alert variant="info">
          <Info />
          <AlertDescription>Compte administrateur : seul un administrateur peut le modifier.</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="apercu" className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            <TabsTrigger value="apercu">Aperçu</TabsTrigger>
            <TabsTrigger value="acces">Accès et privilèges</TabsTrigger>
            <TabsTrigger value="activite">Activité</TabsTrigger>
            <TabsTrigger value="paiements">Paiements ({data.payments.length})</TabsTrigger>
            <TabsTrigger value="securite">Sessions et sécurité</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="apercu">
          <OverviewTab data={data} canCredits={canCredits} onUpdate={update} />
        </TabsContent>
        <TabsContent value="acces">
          <AccessTab data={data} meta={meta} canManage={canManage} isAdmin={isAdmin} isSelf={isSelf} onUpdate={update} />
        </TabsContent>
        <TabsContent value="activite">
          <ActivityTab data={data} />
        </TabsContent>
        <TabsContent value="paiements">
          <PaymentsTab data={data} planLabels={planLabels} canRefund={canPayments} onChanged={() => void reload()} />
        </TabsContent>
        <TabsContent value="securite">
          <SecurityTab data={data} meta={meta} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({
  data,
  canCredits,
  onUpdate,
}: {
  data: AdminUserDetail;
  canCredits: boolean;
  onUpdate: (detail: AdminUserDetail) => void;
}) {
  const { credits } = data;
  const pct = credits.unlimited ? 100 : credits.allowance ? Math.min(100, (credits.plan / credits.allowance) * 100) : 0;
  const usage = Object.entries(data.usage).sort((a, b) => b[1] - a[1]);
  const chariow = data.integrations.chariow;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Points</h2>
          </CardTitle>
          <CardDescription>
            {credits.unlimited ? 'Palier illimité : aucune action ne décompte.' : `Quota rechargé le ${formatDateFr(credits.cycleEndsAt)}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="font-display text-4xl font-extrabold tabular-nums">{credits.unlimited ? '∞' : credits.total}</p>
          <Progress value={pct} aria-label="Quota mensuel restant" />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">Quota du mois</dt>
              <dd className="font-semibold tabular-nums">
                {credits.plan} / {credits.allowance ?? '∞'}
              </dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">Points bonus</dt>
              <dd className="font-semibold tabular-nums">{credits.bonus}</dd>
            </div>
          </dl>
          {canCredits && <RefillPlanCreditsDialog detail={data} onDone={onUpdate} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Compte</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <InfoRow label="Inscription" value={formatDateFr(data.user.createdAt)} />
            <InfoRow label="Dernière connexion" value={data.user.lastLoginAt ? formatDateFr(data.user.lastLoginAt, true) : 'Jamais'} />
            <InfoRow
              label="Palier"
              value={`${data.user.plan.label}${data.user.planExpiresAt ? ` jusqu’au ${formatDateFr(data.user.planExpiresAt)}` : ', sans échéance'}`}
            />
            <InfoRow
              label="Chariow"
              value={
                !chariow.connected
                  ? 'Non connecté'
                  : chariow.source === 'own'
                    ? `Clé personnelle${chariow.verifiedAt ? `, vérifiée le ${formatDateFr(chariow.verifiedAt)}` : ''}`
                    : 'Clé du serveur (administrateur)'
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Contenus créés</h2>
          </CardTitle>
          <CardDescription>Depuis l’inscription</CardDescription>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun contenu pour l’instant.</p>
          ) : (
            <ul className="divide-y">
              {usage.map(([kind, count]) => (
                <li key={kind} className="flex justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
                  <span>{labelOf(GENERATION_KIND_LABELS, kind)}</span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type StepUpAction = 'permissions' | 'promote' | 'demote' | 'reset2fa';

const STEP_UP_TEXT: Record<StepUpAction, { title: string; description: string; confirm: string; success: string }> = {
  permissions: {
    title: 'Confirmer les privilèges',
    description: 'Le compte devra se reconnecter, avec la double authentification, pour utiliser ses nouveaux privilèges.',
    confirm: 'Confirmer',
    success: 'Privilèges mis à jour',
  },
  promote: {
    title: 'Nommer administrateur',
    description: 'Ce compte obtiendra tous les accès, y compris sur les revenus et sur les autres administrateurs. Ses sessions sont fermées.',
    confirm: 'Nommer administrateur',
    success: 'Rôle administrateur attribué',
  },
  demote: {
    title: 'Retirer le rôle administrateur',
    description: 'Le compte redevient utilisateur, sans aucun privilège. Ses sessions sont fermées.',
    confirm: 'Retirer le rôle',
    success: 'Rôle administrateur retiré',
  },
  reset2fa: {
    title: 'Réinitialiser la double authentification',
    description: 'Le secret et les codes de secours de ce compte sont effacés et ses sessions fermées. La personne devra la réactiver.',
    confirm: 'Réinitialiser',
    success: 'Double authentification réinitialisée',
  },
};

function AccessTab({
  data,
  meta,
  canManage,
  isAdmin,
  isSelf,
  onUpdate,
}: {
  data: AdminUserDetail;
  meta: AdminMeta | null;
  canManage: boolean;
  isAdmin: boolean;
  isSelf: boolean;
  onUpdate: (detail: AdminUserDetail) => void;
}) {
  const [busyFeature, setBusyFeature] = useState<string | null>(null);
  const grantedKey = [...data.permissions.granted].sort().join(',');
  const [selected, setSelected] = useState<string[]>(data.permissions.granted);
  const [stepUp, setStepUp] = useState<StepUpAction | null>(null);

  useEffect(() => {
    setSelected(grantedKey ? grantedKey.split(',') : []);
  }, [grantedKey]);

  const dirty = [...selected].sort().join(',') !== grantedKey;
  const targetIsAdmin = data.user.role === 'admin';
  const canEditPrivileges = isAdmin && !isSelf && !targetIsAdmin;

  const setFeature = async (feature: FeatureId, access: 'default' | 'granted' | 'revoked') => {
    setBusyFeature(feature);
    try {
      onUpdate(await apiRequest<AdminUserDetail>(`/api/admin/users/${data.user.id}/features`, { method: 'PUT', body: { feature, access } }));
      toast.success('Accès mis à jour');
    } catch (caught) {
      toast.error('Accès non modifié', { description: toApiError(caught, 'Erreur inconnue.').message });
    } finally {
      setBusyFeature(null);
    }
  };

  const confirmStepUp = async (code: string) => {
    const action = stepUp;
    if (!action) return;
    const path = `/api/admin/users/${data.user.id}`;
    const detail =
      action === 'permissions'
        ? await apiRequest<AdminUserDetail>(`${path}/permissions`, { method: 'PUT', body: { permissions: selected, confirmationCode: code } })
        : action === 'reset2fa'
          ? await apiRequest<AdminUserDetail>(`${path}/two-factor/reset`, { method: 'POST', body: { confirmationCode: code } })
          : await apiRequest<AdminUserDetail>(`${path}/role`, {
              method: 'PATCH',
              body: { role: action === 'promote' ? 'admin' : 'user', confirmationCode: code },
            });
    onUpdate(detail);
    toast.success(STEP_UP_TEXT[action].success);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Fonctions</h2>
          </CardTitle>
          <CardDescription>
            Ce qu’ouvre le palier {data.user.plan.label}, corrigé pour ce compte. « Accordé » ouvre une fonction hors palier ; « Retiré » la
            ferme.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {data.features.map((feature) => (
              <li key={feature.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{feature.label}</p>
                  <p className="text-xs text-muted-foreground">
                    Palier : {feature.planDefault ? 'incluse' : 'non incluse'} ·{' '}
                    <span className={feature.effective ? 'text-success' : 'text-danger'}>{feature.effective ? 'ouverte' : 'fermée'}</span>
                  </p>
                </div>
                <Select
                  value={feature.override ?? 'default'}
                  onValueChange={(value) => void setFeature(feature.id, value as 'default' | 'granted' | 'revoked')}
                  disabled={!canManage || busyFeature === feature.id}
                >
                  <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={`Accès : ${feature.label}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Selon le palier</SelectItem>
                    <SelectItem value="granted">Accordé</SelectItem>
                    <SelectItem value="revoked">Retiré</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Privilèges d’administration</h2>
            </CardTitle>
            <CardDescription>
              {targetIsAdmin
                ? 'Un administrateur les détient tous.'
                : 'Délégués un par un. Chaque changement est confirmé par votre code et impose au compte la double authentification.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-3">
              {(meta?.permissions ?? []).map((permission) => (
                <li key={permission.id} className="flex items-start gap-2.5">
                  <Checkbox
                    id={`perm-${permission.id}`}
                    checked={targetIsAdmin || selected.includes(permission.id)}
                    disabled={!canEditPrivileges}
                    onCheckedChange={(checked) =>
                      setSelected((current) =>
                        checked === true ? [...new Set([...current, permission.id])] : current.filter((item) => item !== permission.id),
                      )
                    }
                    className="mt-0.5"
                  />
                  <Label htmlFor={`perm-${permission.id}`} className="flex flex-col items-start gap-0.5 font-normal">
                    <span className="text-sm font-medium">{permission.label}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{permission.description}</span>
                  </Label>
                </li>
              ))}
            </ul>
            {canEditPrivileges && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!dirty} onClick={() => setStepUp('permissions')}>
                  <KeyRound />
                  Enregistrer les privilèges
                </Button>
                {dirty && (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(grantedKey ? grantedKey.split(',') : [])}>
                    Annuler
                  </Button>
                )}
              </div>
            )}
            {!isAdmin && <p className="text-xs text-muted-foreground">Seul un administrateur attribue ou retire des privilèges.</p>}
          </CardContent>
        </Card>

        {isAdmin && !isSelf && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Rôle et double authentification</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Rôle : {targetIsAdmin ? 'administrateur' : 'utilisateur'}</p>
                  <p className="text-xs text-muted-foreground">Un administrateur a tous les accès, y compris sur les autres administrateurs.</p>
                </div>
                <Button size="sm" variant={targetIsAdmin ? 'outline' : 'default'} onClick={() => setStepUp(targetIsAdmin ? 'demote' : 'promote')}>
                  <UserCog />
                  {targetIsAdmin ? 'Retirer le rôle' : 'Nommer administrateur'}
                </Button>
              </div>
              {data.user.twoFactorEnabled && (
                <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">Téléphone perdu ?</p>
                    <p className="text-xs text-muted-foreground">Retire la double authentification et ferme les sessions du compte.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setStepUp('reset2fa')}>
                    <ShieldOff />
                    Réinitialiser la 2FA
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <StepUpDialog
        open={stepUp !== null}
        onOpenChange={(open) => {
          if (!open) setStepUp(null);
        }}
        title={stepUp ? STEP_UP_TEXT[stepUp].title : ''}
        description={stepUp ? STEP_UP_TEXT[stepUp].description : ''}
        confirmLabel={stepUp ? STEP_UP_TEXT[stepUp].confirm : 'Confirmer'}
        destructive={stepUp === 'demote' || stepUp === 'reset2fa'}
        onConfirm={confirmStepUp}
      />
    </div>
  );
}

function ActivityTab({ data }: { data: AdminUserDetail }) {
  const { costTable } = useCreditGate();
  const actionLabel = (id: string | null) => (id ? (costTable?.actions.find((action) => action.id === id)?.label ?? id) : null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Générations et exports</h2>
          </CardTitle>
          <CardDescription>Les 50 derniers. « Navigateur » : export déclaré par l’appareil de l’utilisateur.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.generations.length === 0 ? (
            <NoDataState title="Aucun contenu" reason="Ce compte n’a encore rien généré ni exporté." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Contenu</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead>Fichier</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.generations.map((generation) => (
                  <TableRow key={generation.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateFr(generation.createdAt, true)}</TableCell>
                    <TableCell>
                      {labelOf(GENERATION_KIND_LABELS, generation.kind)}
                      <span className="block text-xs text-muted-foreground">
                        {generation.source === 'client' ? 'Navigateur' : generation.provider}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={generation.status === 'completed' ? 'success' : generation.status === 'failed' ? 'danger' : 'info'}>
                        {labelOf(GENERATION_STATUS_LABELS, generation.status)}
                      </Badge>
                      {generation.refunded && <span className="block text-xs text-muted-foreground">points rendus</span>}
                    </TableCell>
                    <TableCell>{generation.fileFormat ? labelOf(FILE_FORMAT_LABELS, generation.fileFormat) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{generation.creditsCharged || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Registre des points</h2>
          </CardTitle>
          <CardDescription>Chaque mouvement du solde, avec son auteur quand il vient de l’équipe.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Mouvement</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Solde</TableHead>
                <TableHead>Par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ledger.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateFr(entry.createdAt, true)}</TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    {labelOf(CREDIT_REASON_LABELS, entry.reason)}
                    {entry.actionId && <span className="text-muted-foreground"> · {actionLabel(entry.actionId)}</span>}
                    {entry.note && <span className="block text-xs text-muted-foreground">{entry.note}</span>}
                  </TableCell>
                  <TableCell className="text-right">{signed(entry.delta)}</TableCell>
                  <TableCell className="text-right tabular-nums">{entry.balanceAfter}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{entry.actorEmail ?? 'Système'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentsTab({
  data,
  planLabels,
  canRefund,
  onChanged,
}: {
  data: AdminUserDetail;
  planLabels: Record<string, string>;
  canRefund: boolean;
  onChanged: () => void;
}) {
  if (data.payments.length === 0) {
    return (
      <NoDataState
        title="Aucun paiement enregistré"
        reason="Les abonnements réglés par ce compte apparaîtront ici dès leur enregistrement."
      />
    );
  }

  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Palier</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead>Moyen</TableHead>
              <TableHead>État</TableHead>
              <TableHead>Enregistré par</TableHead>
              {canRefund && <TableHead className="sr-only">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateFr(payment.paidAt)}</TableCell>
                <TableCell>
                  {planLabels[payment.plan] ?? payment.plan}
                  <span className="block text-xs text-muted-foreground">{payment.periodMonths} mois</span>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatPaymentAmount(payment)}</TableCell>
                <TableCell>
                  {labelOf(PAYMENT_METHOD_LABELS, payment.method)}
                  {payment.reference && <span className="block text-xs text-muted-foreground">{payment.reference}</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={payment.status === 'paid' ? 'success' : 'secondary'}>{payment.status === 'paid' ? 'Encaissé' : 'Remboursé'}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{payment.recordedByEmail ?? '—'}</TableCell>
                {canRefund && (
                  <TableCell className="text-right">
                    <RefundPaymentDialog payment={payment} onDone={onChanged} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SecurityTab({ data, meta }: { data: AdminUserDetail; meta: AdminMeta | null }) {
  const planLabels = Object.fromEntries((meta?.plans ?? []).map((plan) => [plan.id, plan.label]));
  const permissionLabels = Object.fromEntries((meta?.permissions ?? []).map((permission) => [permission.id, permission.label]));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Sessions ouvertes</h2>
          </CardTitle>
          <CardDescription>Adresses IP tronquées : l’adresse complète est une donnée personnelle.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune session ouverte.</p>
          ) : (
            <ul className="divide-y">
              {data.sessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{session.device}</p>
                    <p className="text-xs text-muted-foreground">
                      {session.ip ?? 'IP inconnue'} · ouverte le {formatDateFr(session.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <PresenceLabel online={session.online} lastSeenAt={session.lastSeenAt} />
                    {session.mfaVerified && <Badge variant="success">avec code</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Événements de connexion</h2>
          </CardTitle>
          <CardDescription>Les 30 derniers</CardDescription>
        </CardHeader>
        <CardContent>
          {data.securityEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun événement.</p>
          ) : (
            <ul className="divide-y">
              {data.securityEvents.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm">{event.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {event.device} · {event.ip ?? 'IP inconnue'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeFr(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>
            <h2>Actions de l’équipe sur ce compte</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p>
          ) : (
            <ul className="divide-y">
              {data.audit.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{labelOf(AUDIT_ACTION_LABELS, entry.action)}</p>
                    <p className="text-xs text-muted-foreground">
                      {describeAuditDetails(entry.action, entry.details, { plans: planLabels, permissions: permissionLabels })}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {entry.actorEmail} · {formatDateFr(entry.createdAt, true)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
