import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { Granularity } from '@/features/admin/adminApi';
import type { ApiError } from '@/shared/lib/apiError';
import { formatDateFr, formatRelativeFr } from '@/shared/lib/formatDate';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group';

type Tone = 'default' | 'brand' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<Tone, string> = {
  default: 'bg-muted text-muted-foreground',
  brand: 'bg-accent text-accent-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Card className={cn('gap-3 py-5', className)}>
      <CardContent className="space-y-2 px-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', TONE_CLASSES[tone])}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
        <p className="font-display text-2xl font-extrabold tracking-tight tabular-nums sm:text-3xl">{value}</p>
        {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function AdminErrorAlert({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <Alert variant="danger">
      <TriangleAlert />
      <AlertTitle>Chargement impossible</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RefreshCw />
            Réessayer
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function GranularityToggle({ value, onChange }: { value: Granularity; onChange: (value: Granularity) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as Granularity);
      }}
      aria-label="Découpage"
    >
      <ToggleGroupItem value="day" className="px-3">
        Jour
      </ToggleGroupItem>
      <ToggleGroupItem value="month" className="px-3">
        Mois
      </ToggleGroupItem>
      <ToggleGroupItem value="year" className="px-3">
        Année
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function PresenceLabel({ online, lastSeenAt }: { online: boolean; lastSeenAt: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <span className={cn('size-2 shrink-0 rounded-full', online ? 'bg-success' : 'bg-muted-foreground/40')} aria-hidden="true" />
      {online ? 'En ligne' : lastSeenAt ? `Vu ${formatRelativeFr(lastSeenAt)}` : 'Hors ligne'}
    </span>
  );
}

/** Lien à transmettre (création ou réinitialisation de mot de passe). */
export function CopyableLink({ url, expiresAt }: { url: string; expiresAt: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Lien copié');
    } catch {
      toast.error('Copie impossible', { description: 'Sélectionnez le lien et copiez-le à la main.' });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 rounded-lg border border-success-border bg-success-soft p-3 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 text-xs break-all">{url}</code>
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void copy()}>
          <Copy />
          Copier
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Transmettez-le à la personne (WhatsApp, e-mail). Il ne sert qu’une fois et expire le {formatDateFr(expiresAt, true)}.
      </p>
    </div>
  );
}

/**
 * Confirmation d'une action sensible par un code de double authentification frais :
 * une session laissée ouverte ne suffit pas à changer un rôle ou des privilèges.
 */
export function StepUpDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (next: boolean) => {
    if (!next) {
      setCode('');
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(code.replace(/\s/g, ''));
      change(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action refusée.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="step-up-code">Code de double authentification</FieldLabel>
            <Input
              id="step-up-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              autoFocus
              className="h-11 max-w-44 text-center text-lg font-semibold tracking-[0.3em] tabular-nums"
            />
            <FieldDescription>Chaque code ne sert qu’une fois : si besoin, attendez le suivant.</FieldDescription>
          </Field>
          {error && (
            <Alert variant="danger" role="alert">
              <TriangleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => change(false)}>
              Annuler
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || code.replace(/\s/g, '').length !== 6}>
              {busy && <Spinner />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-2 text-sm">
      <span className="text-muted-foreground tabular-nums">
        Page {page} sur {pages} · {total.toLocaleString('fr-FR')} résultat{total > 1 ? 's' : ''}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Précédente
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Suivante
        </Button>
      </div>
    </nav>
  );
}
