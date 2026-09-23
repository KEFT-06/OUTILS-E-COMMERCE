import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Eye, ImageOff, Play, Search, Store } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import type { EspionnageView as EspionnageData, SpiedAd } from '@/shared/types/radar';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Mur d'espionnage : les publicités qui tournent en ce moment et qui mènent à une boutique de la
 * plateforme.
 *
 * L'ancienneté est la donnée centrale de cet écran, et c'est la seule que Meta donne gratuitement
 * et immédiatement. Elle sépare deux situations que l'on confond toujours : une annonce de 12 jours
 * est un test que personne n'a encore validé, une annonce de 213 jours est un produit dont
 * quelqu'un paie la publicité depuis sept mois. La seconde a fait ses preuves. C'est pourquoi le
 * tri par défaut met les plus anciennes en premier, et non les plus récentes.
 *
 * Ce que cet écran n'affichera jamais : budget, impressions, portée. Meta ne les publie que pour
 * l'Union européenne — vérifié à 0 sur 43 annonces africaines. Mieux vaut ne pas en parler que
 * montrer des cases vides qui passeraient pour une panne.
 */

/** Seuils d'ancienneté, choisis sur la durée de vie mesurée des annonces (10 à 213 jours). */
const ANCIENNETE = [
  { value: '0', label: 'Toutes les annonces', hint: '' },
  { value: '7', label: 'Diffusées 7 jours et plus', hint: 'a passé le premier tri' },
  { value: '30', label: 'Diffusées 30 jours et plus', hint: 'tient depuis un mois' },
  { value: '90', label: 'Diffusées 90 jours et plus', hint: 'produit installé, il paie depuis trois mois' },
] as const;

function AgeBadge({ days }: { days: number | null }) {
  if (days === null) return <Badge variant="outline">Date inconnue</Badge>;
  // Trois mois de publicité payée : le seuil au-delà duquel un produit a vraiment prouvé quelque chose.
  if (days >= 90) return <Badge className="bg-brand-green-text text-white">{days} jours de diffusion</Badge>;
  if (days >= 30) return <Badge variant="secondary">{days} jours</Badge>;
  return <Badge variant="outline">{days} jours · test récent</Badge>;
}

function AdCard({ ad, onWatch, busy }: { ad: SpiedAd; onWatch: (host: string) => void; busy: string | null }) {
  const [imageCassee, setImageCassee] = useState(false);
  const lien = safeHttpUrl(ad.landingUrl);
  const bibliotheque = `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.externalId)}`;

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative aspect-square w-full bg-muted">
        {/*
          Les adresses de visuel de Meta sont signées et expirent. Sans ce repli, le mur se
          remplirait d'images cassées quelques jours après chaque collecte.
        */}
        {ad.mediaUrl && !imageCassee ? (
          <img
            src={ad.mediaUrl}
            alt={ad.title ?? 'Visuel de l’annonce'}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
            onError={() => setImageCassee(true)}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
            <ImageOff className="size-6" aria-hidden="true" />
            <span className="text-xs">Visuel expiré chez Meta</span>
          </div>
        )}
        {ad.mediaKind === 'video' && (
          <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
            <Play className="size-3" aria-hidden="true" />
            Vidéo
          </span>
        )}
        {ad.variants > 1 && (
          <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
            {ad.variants} variantes
          </span>
        )}
      </div>

      <CardHeader className="gap-1.5">
        <CardTitle className="text-sm leading-snug">{ad.title ?? 'Annonce sans titre'}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-1.5">
          <AgeBadge days={ad.runningDays} />
          {!ad.active && <Badge variant="outline">Arrêtée</Badge>}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {ad.bodyText && <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">{ad.bodyText}</p>}

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Store className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate" title={ad.storeHost}>
            {ad.advertiser ?? ad.storeHost}
          </span>
        </p>

        <div className="mt-auto flex flex-wrap gap-2">
          {lien && (
            <Button asChild size="sm" variant="secondary" className="flex-1">
              <a href={lien} target="_blank" rel="noreferrer noopener">
                Voir le produit
                <ExternalLink />
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy === ad.storeHost}
            onClick={() => onWatch(ad.storeHost)}
            title="Suivre cette boutique jour après jour"
          >
            <Eye />
            Surveiller
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={bibliotheque} target="_blank" rel="noreferrer noopener">
              Chez Meta
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function EspionnageView() {
  const [data, setData] = useState<EspionnageData | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [anciennete, setAnciennete] = useState('0');
  const [format, setFormat] = useState<'tous' | 'image' | 'video'>('tous');
  const [tri, setTri] = useState<'oldest' | 'newest' | 'variants'>('oldest');
  const [recherche, setRecherche] = useState('');
  const [recherchee, setRecherchee] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ sort: tri, limit: '60' });
    if (anciennete !== '0') params.set('minDays', anciennete);
    if (format !== 'tous') params.set('mediaKind', format);
    if (recherchee) params.set('search', recherchee);
    try {
      setData(await apiRequest<EspionnageData>(`/api/espionnage?${params.toString()}`));
      setErreur(null);
    } catch (caught) {
      setErreur(toApiError(caught, 'Le mur d’espionnage n’a pas pu être chargé.').message);
    }
  }, [anciennete, format, tri, recherchee]);

  useEffect(() => {
    void load();
  }, [load]);

  async function surveiller(host: string) {
    setBusy(host);
    try {
      await apiRequest('/api/radar/watches', { method: 'POST', body: { target: host } });
      toast.success('Boutique ajoutée à votre radar. Elle sera relevée chaque jour.');
    } catch (caught) {
      toast.error(toApiError(caught, 'Cette boutique n’a pas pu être ajoutée.').message);
    } finally {
      setBusy(null);
    }
  }

  const hint = ANCIENNETE.find((option) => option.value === anciennete)?.hint ?? '';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voir"
        title="Espionnage"
        description="Les publicités qui tournent en ce moment et qui mènent à une boutique de la plateforme. Ce que vendent ceux qui paient pour être vus, et depuis combien de temps."
      />

      {erreur && (
        <Alert variant="destructive">
          <AlertTitle>Mur indisponible</AlertTitle>
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Filtrer</CardTitle>
          <CardDescription>
            {data
              ? `${data.total} annonces conservées chez ${data.stores} boutiques${data.lastCollectedAt ? `, dernière collecte ${formatRelativeFr(data.lastCollectedAt)}` : ''}.`
              : 'Chargement…'}
            {hint ? ` Filtre : ${hint}.` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(submit) => {
              submit.preventDefault();
              setRecherchee(recherche.trim());
            }}
          >
            <Input
              value={recherche}
              onChange={(change) => setRecherche(change.target.value)}
              placeholder="Chercher un mot dans les annonces…"
              aria-label="Chercher dans les annonces"
            />
            <Button type="submit" variant="secondary">
              <Search />
              Chercher
            </Button>
          </form>

          <div className="flex flex-wrap gap-2">
            <Select value={anciennete} onValueChange={setAnciennete}>
              <SelectTrigger className="w-full sm:w-72" aria-label="Ancienneté de diffusion">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANCIENNETE.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={format} onValueChange={(value) => setFormat(value as typeof format)}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Format de l’annonce">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tous">Tous formats</SelectItem>
                <SelectItem value="image">Images</SelectItem>
                <SelectItem value="video">Vidéos</SelectItem>
              </SelectContent>
            </Select>

            <Select value={tri} onValueChange={(value) => setTri(value as typeof tri)}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Trier par">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oldest">Les plus anciennes d’abord</SelectItem>
                <SelectItem value="newest">Les plus récentes d’abord</SelectItem>
                <SelectItem value="variants">Le plus de variantes d’abord</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {data === null && !erreur && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-80 rounded-xl" />
          ))}
        </div>
      )}

      {data && data.ads.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} onWatch={surveiller} busy={busy} />
          ))}
        </div>
      )}

      {data && data.ads.length === 0 && (
        <Empty className="border border-dashed py-12">
          <EmptyHeader>
            <EmptyTitle>{data.total === 0 ? 'Aucune annonce collectée pour l’instant' : 'Aucune annonce sur ce filtre'}</EmptyTitle>
            <EmptyDescription>
              {data.total === 0
                ? data.configured
                  ? 'La collecte tourne d’elle-même, au rythme réglé par l’administrateur. Elle peut aussi être lancée depuis l’écran Radar.'
                  : 'La collecte publicitaire n’est pas configurée sur ce serveur : aucun jeton de collecte.'
                : 'Élargissez l’ancienneté ou retirez la recherche.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <p className="text-xs text-muted-foreground">
        Annonces publiées dans la bibliothèque publicitaire de Meta, que tout le monde peut consulter. Budget, impressions
        et portée n’y figurent pas : Meta ne les publie que pour l’Union européenne. Les visuels restent hébergés chez
        Meta et leurs adresses expirent — chaque collecte les rafraîchit.
      </p>
    </div>
  );
}
