import { useState, type ComponentProps } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

/** Champ de mot de passe avec bouton Afficher/Masquer : sur téléphone, une faute de frappe invisible coûte un verrou. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-11', className)} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1/2 right-1 size-8 -translate-y-1/2 text-muted-foreground"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

export const PASSWORD_MIN_LENGTH = 12;

/**
 * Indications en direct. Seules les règles vérifiables sans le serveur sont
 * cochées ici ; le serveur refuse en plus les mots de passe les plus utilisés.
 */
export function PasswordHints({ password }: { password: string }) {
  const rules = [
    { ok: password.length >= PASSWORD_MIN_LENGTH, label: `${PASSWORD_MIN_LENGTH} caractères au moins` },
    { ok: new Set(password).size >= 5, label: 'Des caractères variés' },
  ];

  return (
    <ul className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
      {rules.map((rule) => (
        <li key={rule.label} className={cn('flex items-center gap-1.5', rule.ok && 'text-success')}>
          <Check className={cn('size-3.5', !rule.ok && 'opacity-30')} aria-hidden="true" />
          {rule.label}
          <span className="sr-only">{rule.ok ? ' : respecté' : ' : pas encore'}</span>
        </li>
      ))}
      <li>Une phrase de plusieurs mots est plus sûre et plus facile à retenir qu’un mot compliqué.</li>
    </ul>
  );
}
