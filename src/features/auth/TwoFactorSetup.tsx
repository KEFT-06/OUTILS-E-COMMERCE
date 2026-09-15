import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Download, ShieldCheck, Smartphone, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { apiRequest } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { triggerDownload } from '@/shared/lib/download';
import type { Account } from '@/shared/types/auth';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Activation de la double authentification (application TOTP).
 *
 * Le compte n'est mis à jour dans l'interface qu'une fois les codes de secours
 * mis à l'abri : sinon l'écran qui exigeait la double authentification
 * disparaîtrait avant que la personne ait pu les noter.
 */

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(label);
  } catch {
    toast.error('Copie impossible', { description: 'Votre navigateur a refusé l’accès au presse-papiers.' });
  }
}

export function RecoveryCodesPanel({ codes, onDone, doneLabel = 'Terminer' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const text = [
    'Smart Creator — codes de secours de double authentification',
    'Chaque code ne sert qu’une fois. Rangez-les hors de votre téléphone.',
    '',
    ...codes,
  ].join('\n');

  return (
    <div className="space-y-4">
      <Alert variant="warning">
        <TriangleAlert />
        <AlertTitle>Notez ces codes maintenant</AlertTitle>
        <AlertDescription>
          Ils ne seront plus jamais affichés. Chacun remplace une fois le code de votre téléphone, si vous le perdez.
        </AlertDescription>
      </Alert>

      <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-4" aria-label="Codes de secours">
        {codes.map((code) => (
          <li key={code} className="text-center font-mono text-sm font-semibold tracking-wider tabular-nums">
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy(codes.join('\n'), 'Codes copiés')}>
          <Copy />
          Copier
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => triggerDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'smart-creator-codes-de-secours.txt')}
        >
          <Download />
          Télécharger
        </Button>
      </div>

      <div className="flex items-start gap-2.5">
        <Checkbox id="recovery-saved" checked={saved} onCheckedChange={(checked) => setSaved(checked === true)} className="mt-0.5" />
        <Label htmlFor="recovery-saved" className="text-sm leading-relaxed font-normal">
          J’ai rangé ces codes en lieu sûr.
        </Label>
      </div>

      <Button type="button" className="w-full" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}

interface SetupPayload {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
}

export function TwoFactorSetup({ onEnabled }: { onEnabled?: (account: Account) => void }) {
  const { setAccount } = useAuth();
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const enabledAccount = useRef<Account | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await apiRequest<SetupPayload>('/api/account/two-factor/setup', { method: 'POST' }));
    } catch (caught) {
      setError(toApiError(caught, 'La configuration n’a pas pu démarrer.'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ recoveryCodes: string[]; account: Account }>('/api/account/two-factor/enable', {
        method: 'POST',
        body: { code },
      });
      enabledAccount.current = result.account;
      setRecoveryCodes(result.recoveryCodes);
    } catch (caught) {
      setError(toApiError(caught, 'Le code n’a pas été accepté.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    const account = enabledAccount.current;
    if (!account) return;
    setAccount(account);
    toast.success('Double authentification activée');
    onEnabled?.(account);
  };

  if (recoveryCodes) return <RecoveryCodesPanel codes={recoveryCodes} onDone={finish} />;

  if (!setup) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          À chaque connexion, en plus du mot de passe, un code à 6 chiffres affiché par une application sur votre téléphone :
          Google Authenticator, Microsoft Authenticator ou 2FAS, toutes gratuites. Un mot de passe volé ne suffit plus.
        </p>
        {error && (
          <Alert variant="danger">
            <TriangleAlert />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <Button type="button" onClick={() => void start()} disabled={busy}>
          {busy ? <Spinner /> : <ShieldCheck />}
          Configurer la double authentification
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void confirm(event)} className="space-y-5">
      <ol className="space-y-5">
        <li className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs text-accent-foreground">1</span>
            Scannez ce QR code avec l’application
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
              alt="QR code à scanner avec votre application d’authentification"
              width={176}
              height={176}
              className="size-44 rounded-lg border bg-white p-2"
            />
            <div className="min-w-0 space-y-2 text-sm text-muted-foreground">
              <p>Impossible de scanner ? Dans l’application, choisissez « Saisir une clé » et recopiez :</p>
              <p className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm font-semibold break-all text-foreground">
                {setup.secret}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void copy(setup.secret.replace(/\s/g, ''), 'Clé copiée')}>
                <Copy />
                Copier la clé
              </Button>
            </div>
          </div>
        </li>

        <li className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs text-accent-foreground">2</span>
            Saisissez le code affiché
          </p>
          <Field>
            <FieldLabel htmlFor="two-factor-code" className="sr-only">
              Code à 6 chiffres
            </FieldLabel>
            <Input
              id="two-factor-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="h-12 max-w-48 text-center text-xl font-semibold tracking-[0.3em] tabular-nums"
            />
            <FieldDescription className="flex items-center gap-1.5">
              <Smartphone className="size-3.5" aria-hidden="true" />
              Le code change toutes les 30 secondes.
            </FieldDescription>
          </Field>
        </li>
      </ol>

      {error && (
        <Alert variant="danger" role="alert">
          <TriangleAlert />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6}>
        {busy && <Spinner />}
        Activer
      </Button>
    </form>
  );
}
