import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clapperboard, Download, Image as ImageIcon, Play } from 'lucide-react';
import { type AdminCreativeList, useAdminResource } from '@/features/admin/adminApi';
import { AdminErrorAlert, Pagination } from '@/features/admin/components';
import { formatDateFr } from '@/shared/lib/formatDate';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';

/**
 * Vidéos et visuels générés par les comptes, avec lecture et téléchargement. Le fichier est relayé
 * par le serveur depuis Higgsfield, qui ne le garde qu'environ sept jours ; chaque ouverture est
 * inscrite au journal d'audit.
 */

type Kind = 'video' | 'image';
type Entry = AdminCreativeList['entries'][number];

const STATUS = {
  completed: { label: 'Terminée', variant: 'success' },
  pending: { label: 'En cours', variant: 'info' },
  failed: { label: 'Échouée', variant: 'danger' },
} as const;

const fileUrl = (id: string, download = false) => `/api/admin/creatives/${id}/file${download ? '?disposition=attachment' : ''}`;

export function AdminCreativesLibrary({ canOpenUsers }: { canOpenUsers: boolean }) {
  const [kind, setKind] = useState<Kind>('video');
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<Entry | null>(null);
  const { data, error, reload } = useAdminResource<AdminCreativeList>(`/api/admin/creatives?kind=${kind}&page=${page}&pageSize=15`, {
    refreshMs: 60_000,
  });
  const noun = kind === 'video' ? 'vidéo' : 'visuel';

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Bibliothèque des créatifs</h2>
        </CardTitle>
        <CardDescription>
          {data
            ? `${data.counts.completed.toLocaleString('fr-FR')} ${noun}${data.counts.completed > 1 ? 's' : ''} terminé${kind === 'video' ? 'e' : ''}${data.counts.completed > 1 ? 's' : ''}, ${data.counts.pending} en cours, ${data.counts.failed} échoué${kind === 'video' ? 'e' : ''}${data.counts.failed > 1 ? 's' : ''}. Fichiers disponibles ${data.retentionDays} jours chez le fournisseur ; chaque ouverture est inscrite au journal.`
            : 'Vidéos et visuels générés par les comptes.'}
        </CardDescription>
        <CardAction>
          <Tabs
            value={kind}
            onValueChange={(value) => {
              setKind(value as Kind);
              setPage(1);
            }}
          >
            <TabsList>
              <TabsTrigger value="video">
                <Clapperboard />
                Vidéos
              </TabsTrigger>
              <TabsTrigger value="image">
                <ImageIcon />
                Visuels
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <AdminErrorAlert error={error} onRetry={() => void reload()} />}
        {!data ? (
          <Skeleton className="h-48 rounded-lg" />
        ) : data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun{kind === 'video' ? 'e vidéo' : ' visuel'} créé{kind === 'video' ? 'e' : ''} pour l’instant.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Créé le</TableHead>
                  <TableHead>Compte</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Fichier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDateFr(entry.createdAt, true)}</TableCell>
                    <TableCell className="max-w-56">
                      {canOpenUsers ? (
                        <Link to={`/app/admin/utilisateurs/${entry.user.id}`} className="block truncate font-medium hover:underline">
                          {entry.user.name}
                        </Link>
                      ) : (
                        <span className="block truncate font-medium">{entry.user.name}</span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">{entry.user.email}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS[entry.status].variant}>{STATUS[entry.status].label}</Badge>
                      {entry.refunded && <span className="ml-1.5 text-xs text-muted-foreground">points rendus</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{entry.creditsCharged}</TableCell>
                    <TableCell className="text-right">
                      {entry.available ? (
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => setOpened(entry)}>
                            <Play />
                            Voir
                          </Button>
                          <Button variant="ghost" size="icon" asChild>
                            <a href={fileUrl(entry.id, true)} aria-label={`Télécharger ${kind === 'video' ? 'la vidéo' : 'le visuel'} du ${formatDateFr(entry.createdAt, true)}`}>
                              <Download />
                            </a>
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {entry.status === 'completed' ? 'Expiré chez le fournisseur' : '—'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        )}
      </CardContent>

      <Dialog open={opened !== null} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent className="sm:max-w-3xl">
          {opened && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {kind === 'video' ? 'Vidéo' : 'Visuel'} de {opened.user.name}
                </DialogTitle>
                <DialogDescription>
                  Créé{kind === 'video' ? 'e' : ''} le {formatDateFr(opened.createdAt, true)} · {opened.creditsCharged} point
                  {opened.creditsCharged > 1 ? 's' : ''}
                </DialogDescription>
              </DialogHeader>
              {kind === 'video' ? (
                <video src={fileUrl(opened.id)} controls preload="metadata" className="max-h-[70vh] w-full rounded-lg bg-black" />
              ) : (
                <img src={fileUrl(opened.id)} alt={`Visuel créé par ${opened.user.name}`} className="max-h-[70vh] w-full rounded-lg object-contain" />
              )}
              <Button variant="outline" asChild className="self-start">
                <a href={fileUrl(opened.id, true)}>
                  <Download />
                  Télécharger
                </a>
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
