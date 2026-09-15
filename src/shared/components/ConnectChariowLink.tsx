import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';

/** Renvoie vers Mon compte → Connexions, où chaque utilisateur enregistre SA propre clé Chariow. */
export function ConnectChariowLink({ className }: { className?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className={cn('w-fit', className)}>
      <Link to="/app/compte#connexions">
        <KeyRound />
        Ajouter ma clé Chariow
      </Link>
    </Button>
  );
}
