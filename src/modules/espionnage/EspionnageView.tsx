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
import { Card } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
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

/** Boutons d'action tels que Meta les renvoie (en anglais), dits comme sur la bibliothèque en français. */
const CTA_FR: Record<string, string> = {
  'learn more': 'En savoir plus',
  'see details': 'Voir les détails',
  download: 'Télécharger',
  'shop now': 'Acheter',
  'buy now': 'Acheter',
  'sign up': 'S’inscrire',
  'order now': 'Commander',
  'get offer': 'Profiter de l’offre',
  'book now': 'Réserver',
  'send message': 'Envoyer un message',
  'send whatsapp message': 'Envoyer un message WhatsApp',
  'contact us': 'Nous contacter',
  subscribe: 'S’abonner',
  'watch more': 'Regarder plus',
  'apply now': 'Postuler',
  'get quote': 'Demander un devis',
};
const ctaFr = (cta: string | null) => (cta ? (CTA_FR[cta.trim().toLowerCase()] ?? cta) : null);

/** Visuel de l'annonce : l'aperçu conservé d'abord (il ne périme pas), sinon l'adresse de Meta. */
function AdMedia({ ad }: { ad: SpiedAd }) {
  const [cassee, setCassee] = useState(false);
  const source = ad.thumbnailUrl ?? ad.mediaUrl;
  return (
    <div className="relative aspect-square w-full overflow-hidden bg-muted">
      {source && !cassee ? (
        <img
          src={source}
          alt={ad.title ?? 'Visuel de l’annonce'}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setCassee(true)}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
          <ImageOff className="size-6" aria-hidden="true" />
          <span className="text-xs">Aperçu pas encore disponible</span>
        </div>
      )}
      {ad.mediaKind === 'video' && (
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
          <Play className="size-3" aria-hidden="true" />
          Vidéo
        </span>
      )}
    </div>
  );
}

/** Barre de lien sous le visuel, comme chez Meta : domaine, titre, description et bouton. */
function LinkBar({ ad }: { ad: SpiedAd }) {
  const lien = safeHttpUrl(ad.landingUrl);
  const cta = ctaFr(ad.ctaText);
  return (
    <div className="flex items-center gap-3 border-t bg-muted/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{ad.linkCaption ?? ad.storeHost}</p>
        {ad.title && <p className="line-clamp-2 text-sm font-semibold leading-snug">{ad.title}</p>}
        {ad.linkDescription && <p className="line-clamp-1 text-xs text-muted-foreground">{ad.linkDescription}</p>}
      </div>
      {cta && lien && (
        <Button asChild size="sm" variant="secondary" className="shrink-0">
          <a href={lien} target="_blank" rel="noreferrer noopener">
            {cta}
          </a>
        </Button>
      )}
    </div>
  );
}

/** Initiale de l'annonceur, à la place de sa photo de profil (dont l'adresse expire aussi). */
function AdvertiserAvatar({ name }: { name: string }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-brand-green-text" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/**
 * Une annonce, présentée comme dans la bibliothèque publicitaire de Meta : état, identifiant,
 * date de lancement, plateformes, puis l'annonce elle-même — annonceur, texte, visuel, barre de
 * lien. C'est la disposition que connaissent ceux qui se servent déjà de la bibliothèque.
 */
function AdCard({
  ad,
  onWatch,
  onShowDetails,
  onShowAdvertiser,
  busy,
}: {
  ad: SpiedAd;
  onWatch: (host: string) => void;
  onShowDetails: (ad: SpiedAd) => void;
  onShowAdvertiser: (ad: SpiedAd) => void;
  busy: string | null;
}) {
  const annonceur = ad.advertiser ?? ad.storeHost;
  return (
    <Card className="flex flex-col gap-0 overflow-hidden py-0">
      <div className="space-y-1.5 p-4 text-xs">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {ad.active ? (
            <span className="flex items-center gap-1 font-semibold text-success">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Active
            </span>
          ) : (
            <span className="font-semibold text-muted-foreground">Inactive</span>
          )}
          <span className="text-muted-foreground">
            ID de la bibliothèque : <span className="font-mono tabular-nums">{ad.externalId}</span>
          </span>
        </div>
        {ad.startedAt && <p className="text-muted-foreground">Diffusion commencée le {dateFr(ad.startedAt)}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Plateformes</span>
          <Plateformes noms={ad.platforms} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <AgeBadge days={ad.runningDays} />
          {ad.variants > 1 && <Badge variant="outline">{ad.variants} publicités utilisent ce contenu</Badge>}
          {ad.active && ad.daysSinceSeen > 7 && (
            <Badge variant="outline" title="Une collecte ne ramène qu'une partie des annonces : son absence ne prouve pas un arrêt.">
              Non revue depuis {ad.daysSinceSeen} jours
            </Badge>
          )}
        </div>
        <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => onShowDetails(ad)}>
          Voir le détail de la publicité
        </Button>
      </div>

      <div className="flex flex-1 flex-col border-t">
        <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
          <AdvertiserAvatar name={annonceur} />
          <div className="min-w-0">
            <button
              type="button"
              className="block max-w-full truncate text-left text-sm font-semibold hover:underline"
              onClick={() => onShowAdvertiser(ad)}
              title="Voir toutes les annonces de cet annonceur"
            >
              {annonceur}
            </button>
            <p className="text-[11px] text-muted-foreground">Sponsorisé</p>
          </div>
        </div>
        {ad.bodyText && <p className="line-clamp-4 px-4 pb-3 text-sm leading-relaxed whitespace-pre-line">{ad.bodyText}</p>}
        <AdMedia ad={ad} />
        <LinkBar ad={ad} />
        <div className="mt-auto flex flex-wrap gap-2 border-t p-3">
          <Button size="sm" variant="outline" disabled={busy === ad.storeHost} onClick={() => onWatch(ad.storeHost)} title="Suivre cette boutique jour après jour">
            <Eye />
            Surveiller la boutique
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Détail d'une annonce : tout le texte, toutes les variantes, les liens — ce que Meta montre en grand. */
function AdDetailsDialog({ ad, onClose, onShowAdvertiser }: { ad: SpiedAd | null; onClose: () => void; onShowAdvertiser: (ad: SpiedAd) => void }) {
  const lien = ad ? safeHttpUrl(ad.landingUrl) : null;
  const bibliotheque = ad ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.externalId)}` : '#';
  const page = ad?.pageUrl ? safeHttpUrl(ad.pageUrl) : null;
  return (
    <Dialog open={ad !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {ad && (
          <>
            <DialogHeader>
              <DialogTitle>{ad.advertiser ?? ad.storeHost}</DialogTitle>
              <DialogDescription>
                {ad.active ? 'Active' : 'Inactive'} · ID {ad.externalId}
                {ad.startedAt ? ` · diffusion commencée le ${dateFr(ad.startedAt)}` : ''}
                {ad.runningDays !== null ? ` · ${ad.runningDays} jours observés` : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="overflow-hidden rounded-lg border">
                <AdMedia ad={ad} />
                <LinkBar ad={ad} />
              </div>
              <div className="space-y-3 text-sm">
                {ad.bodyText && <p className="leading-relaxed whitespace-pre-line">{ad.bodyText}</p>}
                <p className="text-xs text-muted-foreground">
                  Boutique : <span className="font-medium text-foreground">{ad.storeHost}</span>
                  {ad.displayFormat ? ` · format ${ad.displayFormat.toLowerCase()}` : ''}
                </p>
              </div>
            </div>
            {ad.cards.length > 1 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">{ad.cards.length} variantes de cette publicité</p>
                <ol className="grid gap-2 sm:grid-cols-2">
                  {ad.cards.map((carte, rang) => (
                    <li key={rang} className="rounded-lg border p-3 text-sm">
                      <p className="text-xs text-muted-foreground">Variante {rang + 1}</p>
                      {carte.title && <p className="font-medium">{carte.title}</p>}
                      {carte.body && <p className="line-clamp-4 text-muted-foreground">{carte.body}</p>}
                      {carte.ctaText && <p className="mt-1 text-xs">Bouton : {ctaFr(carte.ctaText)}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {lien && (
                <Button asChild size="sm">
                  <a href={lien} target="_blank" rel="noreferrer noopener">
                    Voir le produit
                    <ExternalLink />
                  </a>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onShowAdvertiser(ad)}>
                <Store />
                Toutes les annonces de cet annonceur
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a href={bibliotheque} target="_blank" rel="noreferrer noopener">
                  Ouvrir chez Meta
                  <ExternalLink />
                </a>
              </Button>
              {page && (
                <Button asChild size="sm" variant="ghost">
                  <a href={page} target="_blank" rel="noreferrer noopener">
                    Page Facebook
                    <ExternalLink />
                  </a>
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
  const [details, setDetails] = useState<SpiedAd | null>(null);
  /** « Toutes les annonces de cet annonceur », comme sur la page d'un annonceur chez Meta. */
  const [annonceur, setAnnonceur] = useState<{ pageId: string | null; storeHost: string; nom: string } | null>(null);
  const [collecteEnCours, setCollecteEnCours] = useState(false);

  const load = useCallback(async () => {
    // Aucune limite demandée : le serveur sert ce que le palier autorise. En fixer une ici
    // rognait ce que les paliers supérieurs avaient payé, sans que rien ne le dise.
    const params = new URLSearchParams({ sort: tri });
    if (anciennete !== '0') params.set('minDays', anciennete);
    if (format !== 'tous') params.set('mediaKind', format);
    if (etat !== 'toutes') params.set('etat', etat);
    if (recherchee) params.set('search', recherchee);
    if (annonceur?.pageId) params.set('pageId', annonceur.pageId);
    else if (annonceur) params.set('storeHost', annonceur.storeHost);
    try {
      setData(await apiRequest<EspionnageData>(`/api/espionnage?${params.toString()}`));
      setErreur(null);
    } catch (caught) {
      setErreur(toApiError(caught, 'Le mur d’espionnage n’a pas pu être chargé.').message);
    }
  }, [anciennete, format, etat, tri, recherchee, annonceur]);

  useEffect(() => {
    void load();
  }, [load]);

  // Une collecte tourne : on relit le mur toutes les trente secondes, les annonces arrivent seules.
  const collecting = data?.collecting === true;
  useEffect(() => {
    if (!collecting) return;
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [collecting, load]);

  const voirAnnonceur = (ad: SpiedAd) => {
    setDetails(null);
    setAnnonceur({ pageId: ad.pageId, storeHost: ad.storeHost, nom: ad.advertiser ?? ad.storeHost });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Réservé à l'administration : chaque passage est facturé par le fournisseur. */
  async function lancerCollecte() {
    setCollecteEnCours(true);
    try {
      const { outcome } = await apiRequest<{ outcome: { adsKept: number; adsExamined: number; pending?: number } }>('/api/radar/discover/refresh', {
        method: 'POST',
      });
      toast.success(
        (outcome.pending ?? 0) > 0
          ? `Collecte lancée : ${outcome.adsKept} annonces déjà versées, la suite arrive dans quelques minutes.`
          : `Collecte terminée : ${outcome.adsKept} annonces retenues sur ${outcome.adsExamined} examinées.`,
      );
      await load();
    } catch (caught) {
      toast.error(toApiError(caught, 'La collecte n’a pas pu être lancée.').message);
    } finally {
      setCollecteEnCours(false);
    }
  }

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

      {collecting && (
        <Alert variant="info" role="status">
          <AlertTitle>Collecte en cours</AlertTitle>
          <AlertDescription>De nouvelles annonces arrivent dans quelques minutes : le mur se met à jour tout seul.</AlertDescription>
        </Alert>
      )}

      {estAdmin && data?.configured && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3 text-sm">
          <p className="text-muted-foreground">
            Administration : la collecte tourne chaque semaine d’elle-même. Chaque passage est facturé par Apify.
          </p>
          <Button size="sm" variant="outline" disabled={collecteEnCours || collecting} onClick={() => void lancerCollecte()}>
            {collecteEnCours ? 'Collecte…' : 'Lancer une collecte maintenant'}
          </Button>
        </div>
      )}

      {annonceur && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/60 px-3 py-2 text-sm">
          <Store className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Toutes les annonces de <span className="font-semibold">{annonceur.nom}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setAnnonceur(null)}>
            Retirer ce filtre
          </Button>
        </div>
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} onWatch={surveiller} onShowDetails={setDetails} onShowAdvertiser={voirAnnonceur} busy={busy} />
          ))}
        </div>
      )}

      <AdDetailsDialog ad={details} onClose={() => setDetails(null)} onShowAdvertiser={voirAnnonceur} />

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
