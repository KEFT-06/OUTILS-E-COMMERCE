import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Smartphone, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { PasswordInput } from '@/features/auth/PasswordInput';
import { TwoFactorSetup } from '@/features/auth/TwoFactorSetup';
import { apiRequest, passwordProblemsOf } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { cn } from '@/shared/lib/utils';
import type { Account } from '@/shared/types/auth';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Code de sécurité : un second secret, choisi par l'utilisateur et demandé après
 * le mot de passe à chaque connexion. Pour qui préfère un code à une application
 * d'authentification. Le serveur le hache comme un mot de passe et bloque les
 * essais répétés.
 */

export const SECURITY_CODE_MIN_LENGTH = 8;

export function SecurityCodeForm({ account, onDone }: { account: Account; onDone?: (account: Account) => void }) {
  const { setAccount } = useAuth();
  const replacing = account.twoFactor.methods.code;
  const needsCurrent = account.twoFactor.enabled;
  const [password, setPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const tooShort = code.length > 0 && code.trim().length < SECURITY_CODE_MIN_LENGTH;
  const mismatch = confirmation.length > 0 && code !== confirmation;
  const canSubmit =
    password.length > 0 &&
    code.trim().length >= SECURITY_CODE_MIN_LENGTH &&
    code === confirmation &&
    (!needsCurrent || currentCode.trim().length >= 6);
  const problems = passwordProblemsOf(error);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ account: Account }>('/api/account/two-factor/security-code', {
        method: 'POST',
        body: { password, newCode: code, ...(needsCurrent ? { currentCode } : {}) },
      });
      setAccount(result.account);
      toast.success(replacing ? 'Code de sécurité modifié' : 'Code de sécurité activé', {
        description: 'Il vous sera demandé après votre mot de passe, à chaque connexion.',
      });
      setPassword('');
      setCurrentCode('');
      setCode('');
      setConfirmation('');
      onDone?.(result.account);
    } catch (caught) {
      setError(toApiError(caught, 'Le code de sécurité n’a pas pu être enregistré.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <FieldGroup>
        {error && (
          <Alert variant="danger" role="alert">
            <TriangleAlert />
            <AlertTitle>{error.message}</AlertTitle>
            {problems.length > 1 && (
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {problems.slice(1).map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </AlertDescription>
            )}
          </Alert>
        )}

        <input type="text" name="username" autoComplete="username" value={account.email} readOnly hidden />

        <Field>
          <FieldLabel htmlFor="security-code-password">Mot de passe du compte</FieldLabel>
          <PasswordInput
            id="security-code-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </Field>

        {needsCurrent && (
          <Field>
            <FieldLabel htmlFor="security-code-current">{replacing ? 'Code de sécurité actuel' : 'Code de votre application'}</FieldLabel>
            <PasswordInput
              id="security-code-current"
              value={currentCode}
              onChange={(event) => setCurrentCode(event.target.value)}
              autoComplete="off"
            />
            <FieldDescription>Votre code de sécurité actuel, ou le code affiché par votre application.</FieldDescription>
          </Field>
        )}

        <Field data-invalid={tooShort || undefined}>
          <FieldLabel htmlFor="security-code-new">{replacing ? 'Nouveau code de sécurité' : 'Code de sécurité'}</FieldLabel>
          <PasswordInput
            id="security-code-new"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="new-password"
            aria-invalid={tooShort || undefined}
          />
          <FieldDescription>
            {SECURITY_CODE_MIN_LENGTH} caractères au moins, différent de votre mot de passe. Chiffres, lettres ou une courte
            phrase : ce que vous retiendrez sans le noter sur votre téléphone.
          </FieldDescription>
        </Field>

        <Field data-invalid={mismatch || undefined}>
          <FieldLabel htmlFor="security-code-confirmation">Confirmez le code</FieldLabel>
          <PasswordInput
            id="security-code-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch || undefined}
          />
          {mismatch && <FieldError errors={[{ message: 'Les deux codes ne correspondent pas.' }]} />}
        </Field>

        <Button type="submit" disabled={!canSubmit || busy} className="w-full sm:w-auto">
          {busy ? <Spinner /> : <KeyRound />}
          {replacing ? 'Modifier le code' : 'Activer le code de sécurité'}
        </Button>
      </FieldGroup>
    </form>
  );
}

/** Choix du second facteur : code de sécurité (par défaut) ou application d'authentification. */
export function SecondFactorChooser({ account }: { account: Account }) {
  const [method, setMethod] = useState<'code' | 'app'>('code');

  const options = [
    {
      id: 'code' as const,
      icon: KeyRound,
      title: 'Code de sécurité',
      text: 'Un code secret que vous choisissez, demandé après le mot de passe. Rien à installer.',
    },
    {
      id: 'app' as const,
      icon: Smartphone,
      title: 'Application d’authentification',
      text: 'Un code à 6 chiffres qui change toutes les 30 secondes. La protection la plus forte.',
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Type de second facteur">
        {options.map((option) => {
          const Icon = option.icon;
          const active = method === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => setMethod(option.id)}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                active && 'border-primary bg-accent/60',
              )}
            >
              <Icon className="mt-0.5 size-5 shrink-0 text-brand-green-text" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold">{option.title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{option.text}</span>
              </span>
            </button>
          );
        })}
      </div>

      {method === 'code' ? <SecurityCodeForm account={account} /> : <TwoFactorSetup />}
    </div>
  );
}
