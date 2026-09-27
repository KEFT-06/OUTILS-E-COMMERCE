import { useCallback, useEffect, useState } from 'react';
import {
  AtSign,
  CheckCircle2,
  ExternalLink,
  Eye,
  Facebook,
  ImageOff,
  Instagram,
  type LucideIcon,
  MessageCircle,
  MessagesSquare,
  Play,
  Radio,
  Search,
  Store,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthContext';
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

/**
 * Plateformes de diffusion, comme la bibliothèque de Meta les montre.
 *
 * L'information était collectée depuis le début et n'était affichée nulle part. Elle dit
 * pourtant quelque chose d'utile : une annonce diffusée sur cinq plateformes coûte plus cher
 * que la même sur une seule, et son annonceur y croit davantage.
 *
 * Une plateforme inconnue n'est pas masquée : Meta en ajoute, et la faire disparaître
 * donnerait à lire moins que ce qui a été relevé.
 */
const PLATEFORMES: Record<string, { Icone: LucideIcon; nom: string }> = {
  FACEBOOK: { Icone: Facebook, nom: 'Facebook' },
  INSTAGRAM: { Icone: Instagram, nom: 'Instagram' },
  MESSENGER: { Icone: MessageCircle, nom: 'Messenger' },
  WHATSAPP: { Icone: MessagesSquare, nom: 'WhatsApp' },
  THREADS: { Icone: AtSign, nom: 'Threads' },
  AUDIENCE_NETWORK: { Icone: Radio, nom: 'Audience Network' },
};

function Plateformes({ noms }: { noms: string[] }) {
  if (noms.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only">Diffusée sur</span>
      {noms.map((nom) => {
        const connue = PLATEFORMES[nom.toUpperCase()];
        if (!connue) {
          return (
            <span key={nom} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
              {nom}
            </span>
          );
        }
        return <connue.Icone key={nom} className="size-3.5" aria-label={connue.nom} />;
      })}
    </p>
  );
}

/** Date de début telle que Meta la publie : « Lancée le 16 août 2026 ». */
const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

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
        {/*
          L'en-tête reprend ce que la bibliothèque de Meta affiche, et dans le même ordre :
          l'état, l'identifiant, la date de lancement, les plateformes. Ces quatre éléments
          étaient tous en base depuis la première collecte, et aucun n'était montré. Les
          retrouver ici évite d'ouvrir Meta pour vérifier ce que l'outil savait déjà.
        */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {ad.active ? (
            <span className="flex items-center gap-1 font-medium text-success">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Active
            </span>
          ) : (
            <span className="font-medium text-muted-foreground">Arrêtée</span>
          )}
          <span className="text-muted-foreground">
            ID <span className="font-mono tabular-nums">{ad.externalId}</span>
          </span>
        </div>
        {ad.startedAt && <p className="text-xs text-muted-foreground">Lancée le {dateFr(ad.startedAt)}</p>}
        <Plateformes noms={ad.platforms} />

        <CardTitle className="text-sm leading-snug">{ad.title ?? 'Annonce sans titre'}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-1.5">
          <AgeBadge days={ad.runningDays} />
          {/*
            Une collecte ne ramène qu'un nombre plafonné d'annonces, triées par impressions :
            ne plus retrouver une annonce ne prouve pas qu'elle s'est arrêtée. On dit donc ce
            qu'on sait — la date de la dernière fois qu'on l'a vue — au lieu de laisser croire
            qu'elle tourne encore. Sept jours : au-delà d'une semaine, l'incertitude compte.
          */}
          {ad.active && ad.daysSinceSeen > 7 && (
            <Badge variant="outline" title="Une collecte ne ramène qu'une partie des annonces : son absence ne prouve pas un arrêt.">
              Non revue depuis {ad.daysSinceSeen} jours
            </Badge>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {ad.bodyText && <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">{ad.bodyText}</p>}

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Store className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate" title={ad.storeHost}>
            {ad.advertiser ?? ad.storeHost}
          </span>
          <span className="shrink-0 text-[10px] uppercase opacity-70">Sponsorisé</span>
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
          {/*
            L'équivalent du « See ad details » de la bibliothèque. Le lien est juste par
            construction : l'identifiant enregistré EST l'`adArchiveID` de Meta, celui que
            sa bibliothèque affiche sous « Library ID » et attend dans « ?id= ».
          */}
          <Button asChild size="sm" variant="ghost">
            <a href={bibliotheque} target="_blank" rel="noreferrer noopener">
              Détail chez Meta
              <ExternalLink />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function EspionnageView() {
  // Le conseil de configuration ne s’adresse qu’à qui peut l’appliquer : les autres n’ont pas
  // la main sur les variables du serveur, et lire une consigne qu’on ne peut pas suivre inquiète.
  const { account } = useAuth();
  const estAdmin = account?.role === 'admin';
  const [data, setData] = useState<EspionnageData | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [anciennete, setAnciennete] = useState('0');
  const [format, setFormat] = useState<'tous' | 'image' | 'video'>('tous');
  /*
    « En cours » par défaut, comme la bibliothèque de Meta, dont c'est le premier filtre et
    le réglage d'ouverture : la question qu'on se pose en arrivant est « qu'est-ce qui tourne
    encore ? ». Les annonces arrêtées restent à un clic — une offre qui a tourné deux cents
    jours avant de s'arrêter reste une preuve.
  */
  const [etat, setEtat] = useState<'toutes' | 'active' | 'arretee'>('active');
  const [tri, setTri] = useState<'oldest' | 'newest' | 'variants'>('oldest');
  const [recherche, setRecherche] = useState('');
  const [recherchee, setRecherchee] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Aucune limite demandée : le serveur sert ce que le palier autorise. En fixer une ici
    // rognait ce que les paliers supérieurs avaient payé, sans que rien ne le dise.
    const params = new URLSearchParams({ sort: tri });
    if (anciennete !== '0') params.set('minDays', anciennete);
    if (format !== 'tous') params.set('mediaKind', format);
    if (etat !== 'toutes') params.set('etat', etat);
    if (recherchee) params.set('search', recherchee);
    try {
      setData(await apiRequest<EspionnageData>(`/api/espionnage?${params.toString()}`));
      setErreur(null);
    } catch (caught) {
      setErreur(toApiError(caught, 'Le mur d’espionnage n’a pas pu être chargé.').message);
    }
  }, [anciennete, format, etat, tri, recherchee]);

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

      {/*
        La disposition reprend celle de la bibliothèque de Meta, parce que c'est celle que
        connaissent les gens qui s'en servent : la recherche occupe toute la largeur en haut,
        le nombre de résultats vient dessous en évidence, et les filtres se rangent à droite.
        Un outil qui montre la même chose autrement oblige à réapprendre ce qu'on sait déjà.
      */}
      <div className="space-y-4">
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
            className="h-11 text-base"
          />
          <Button type="submit" variant="secondary" className="h-11 shrink-0">
            <Search />
            Chercher
          </Button>
        </form>

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-display text-2xl font-extrabold tracking-tight tabular-nums">
              {data ? `${data.ads.length} annonce${data.ads.length > 1 ? 's' : ''}` : '…'}
            </p>
            <p className="text-sm text-muted-foreground">
              {data
                ? `Sur ${data.total} conservées chez ${data.stores} boutique${data.stores > 1 ? 's' : ''}${
                    data.lastCollectedAt ? ` · dernière collecte ${formatRelativeFr(data.lastCollectedAt)}` : ''
                  }`
                : 'Chargement…'}
              {hint ? ` · ${hint}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 md:justify-end">
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

            <Select value={etat} onValueChange={(value) => setEtat(value as typeof etat)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="État de l’annonce">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Annonces en cours</SelectItem>
                <SelectItem value="arretee">Annonces arrêtées</SelectItem>
                <SelectItem value="toutes">Tous les états</SelectItem>
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
        </div>
      </div>

      {data === null && !erreur && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-80 rounded-xl" />
          ))}
        </div>
      )}

      {data && data.hiddenByPlan > 0 && (
        /*
          Dire ce qui manque, et pourquoi. Un mur tronqué en silence passe pour un mur pauvre :
          l'utilisateur en conclut que l'outil ne trouve rien, alors que c'est son palier qui borne.
        */
        <Alert>
          <AlertTitle>
            {data.hiddenByPlan} annonce{data.hiddenByPlan > 1 ? 's' : ''} de plus correspond
            {data.hiddenByPlan > 1 ? 'ent' : ''} à ce filtre
          </AlertTitle>
          <AlertDescription>
            Votre palier affiche {data.visibleLimit} annonces à la fois. Les autres sont déjà collectées et
            vous attendent sur un palier supérieur.
          </AlertDescription>
        </Alert>
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
            {/*
              Un mur vide dit POURQUOI il est vide, et ce qu'il faut faire pour le remplir.

              Il annonçait « aucun jeton de collecte » et s'arrêtait là. Pour qui met le
              module en service, c'est une impasse : le message décrit la panne sans nommer
              le geste. Trois causes possibles, trois phrases différentes — et celle qui
              s'adresse à l'administrateur n'apparaît qu'à lui, les autres n'ayant pas la
              main sur la configuration du serveur.
            */}
            <EmptyDescription>
              {data.total > 0
                ? etat === 'active'
                  ? 'Aucune annonce en cours ne correspond. Affichez tous les états, élargissez l’ancienneté ou retirez la recherche.'
                  : 'Élargissez l’ancienneté, changez l’état ou retirez la recherche.'
                : data.configured
                  ? 'La collecte tourne d’elle-même, au rythme réglé par l’administrateur. Le premier passage remplira ce mur. Un administrateur peut aussi la lancer tout de suite depuis l’écran Radar.'
                  : estAdmin
                    ? 'Aucun jeton de collecte sur ce serveur. Posez APIFY_TOKEN dans les variables d’environnement de l’hébergement, puis relancez le déploiement — sans lui, aucune annonce ne peut être récupérée.'
                    : 'La collecte publicitaire n’est pas encore activée sur ce serveur. L’administrateur doit la configurer.'}
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
