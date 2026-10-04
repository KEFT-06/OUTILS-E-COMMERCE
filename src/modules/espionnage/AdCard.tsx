import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AtSign,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  Facebook,
  ImageOff,
  Info,
  Instagram,
  type LucideIcon,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  Play,
  Radar,
  Radio,
  Store,
} from 'lucide-react';
import { countryName } from '@server/shared/countries';
import { CountryFlag } from '@/shared/components/CountryFlag';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { cn } from '@/shared/lib/utils';
import type { LibraryAd } from '@/shared/types/radar';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';

/**
 * Une publicité, présentée EXACTEMENT comme la bibliothèque publicitaire de Meta la présente —
 * demandé par le propriétaire, captures à l'appui : pastille « Actif », « ID dans la
 * bibliothèque », « Début de la diffusion le … · Temps actif total : … », plateformes,
 * impressions quand Meta les publie, « N publicités utilisent ce contenu publicitaire et ce
 * texte », bouton de détails, puis l'annonce : photo de l'annonceur, « Sponsorisé », texte,
 * visuel entier sur fond gris, barre de lien et son bouton. Nos propres gestes (suivre la
 * boutique, voir le produit) vivent dans le menu « … », comme les actions de Meta.
 *
 * Partagée par le mur (boutiques de la plateforme) et par la recherche par mot-clé (tous les
 * comptes) : une annonce qui ne mène pas à la plateforme n'a pas de boutique à suivre.
 */

/** Plateformes de diffusion, avec l'icône que Meta leur donne. Une plateforme inconnue reste affichée. */
const PLATEFORMES: Record<string, { Icone: LucideIcon; nom: string }> = {
  FACEBOOK: { Icone: Facebook, nom: 'Facebook' },
  INSTAGRAM: { Icone: Instagram, nom: 'Instagram' },
  AUDIENCE_NETWORK: { Icone: Radio, nom: 'Audience Network' },
  MESSENGER: { Icone: MessageCircle, nom: 'Messenger' },
  WHATSAPP: { Icone: MessagesSquare, nom: 'WhatsApp' },
  THREADS: { Icone: AtSign, nom: 'Threads' },
};

function Plateformes({ noms }: { noms: string[] }) {
  if (noms.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {noms.map((nom) => {
        const connue = PLATEFORMES[nom.toUpperCase()];
        if (!connue) {
          return (
            <span key={nom} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
              {nom}
            </span>
          );
        }
        return <connue.Icone key={nom} className="size-4 text-foreground/80" aria-label={connue.nom} />;
      })}
    </span>
  );
}

/** « 28 sep 2026 », comme Meta l'écrit. */
const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
const dateMeta = (iso: string) => {
  const date = new Date(iso);
  return `${date.getDate()} ${MOIS[date.getMonth()]} ${date.getFullYear()}`;
};

/**
 * « Temps actif total », comme Meta : de la date de début jusqu'à maintenant pour une annonce
 * vue en cours à la dernière collecte, jusqu'à la dernière fois qu'on l'a vue sinon — on ne
 * prétend pas qu'une annonce tourne encore si on ne l'a pas revue.
 */
function tempsActif(ad: LibraryAd): string | null {
  if (!ad.startedAt) return null;
  const fin = ad.active && ad.daysSinceSeen <= 1 ? Date.now() : new Date(ad.lastSeenAt).getTime();
  const heures = Math.max(0, Math.floor((fin - new Date(ad.startedAt).getTime()) / 3_600_000));
  if (heures < 1) return 'moins d’une heure';
  if (heures < 24) return `${heures} heure${heures > 1 ? 's' : ''}`;
  const jours = Math.floor(heures / 24);
  return `${jours} jour${jours > 1 ? 's' : ''}`;
}

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

/** Visuel entier, centré sur fond gris, comme chez Meta ; l'aperçu conservé d'abord (il ne périme pas). */
function AdMedia({ ad }: { ad: LibraryAd }) {
  const [cassee, setCassee] = useState(false);
  const source = ad.thumbnailUrl ?? ad.mediaUrl;
  return (
    // Cadre de hauteur fixe : un visuel très haut repoussait ou masquait le texte de l'annonce
    // (signalé le 29/09/2026). L'image reste entière (object-contain), centrée sur fond gris.
    <div className="relative flex h-56 items-center justify-center overflow-hidden bg-muted sm:h-64">
      {source && !cassee ? (
        <img
          src={source}
          alt={ad.title ?? 'Visuel de l’annonce'}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain"
          onError={() => setCassee(true)}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
          <ImageOff className="size-6" aria-hidden="true" />
          <span className="text-xs">Aperçu pas encore disponible</span>
        </div>
      )}
      {ad.mediaKind === 'video' && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-label="Vidéo">
          <span className="flex size-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Play className="size-7 translate-x-0.5 fill-current" aria-hidden="true" />
          </span>
        </span>
      )}
    </div>
  );
}

/** Texte de l'annonce : quelques lignes, puis « Voir plus » pour le lire en entier sans quitter la carte. */
function AdText({ text: brut }: { text: string }) {
  const [entier, setEntier] = useState(false);
  // Annonces catalogue de Meta : leurs gabarits non remplis (« {{product.brand}} ») ne veulent rien dire.
  const text = brut.replace(/\{\{[^}]*\}\}/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  if (!text) return null;
  const long = text.length > 220 || text.split('\n').length > 4;
  return (
    <div className="px-5 pb-3">
      <p className={cn('text-[15px] leading-relaxed whitespace-pre-line', !entier && long && 'line-clamp-4')}>{text}</p>
      {long && (
        <button type="button" className="mt-1 text-sm font-semibold text-primary hover:underline" onClick={() => setEntier((ouvert) => !ouvert)}>
          {entier ? 'Voir moins' : 'Voir plus'}
        </button>
      )}
    </div>
  );
}

/** Barre de lien sous le visuel, comme chez Meta : domaine, titre, description et bouton. */
function LinkBar({ ad }: { ad: LibraryAd }) {
  const lien = ad.landingUrl ? safeHttpUrl(ad.landingUrl) : null;
  const cta = ctaFr(ad.ctaText);
  if (!ad.title && !ad.linkDescription && !ad.linkCaption && !cta) return null;
  return (
    <div className="flex items-center gap-3 bg-muted/60 px-4 py-3">
      <div className="min-w-0 flex-1">
        {ad.linkCaption && <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">{ad.linkCaption}</p>}
        {ad.title && <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{ad.title}</p>}
        {ad.linkDescription && <p className="line-clamp-2 text-sm text-muted-foreground">{ad.linkDescription}</p>}
      </div>
      {cta &&
        (lien ? (
          <Button asChild variant="secondary" className="max-w-[45%] shrink-0 bg-background/80 text-base font-medium hover:bg-background">
            <a href={lien} target="_blank" rel="noreferrer noopener" className="truncate">
              {cta}
            </a>
          </Button>
        ) : (
          <span className="max-w-[45%] shrink-0 truncate rounded-md bg-background/80 px-4 py-2 text-base font-medium">{cta}</span>
        ))}
    </div>
  );
}

/** Photo de profil de l'annonceur ; son initiale si la photo manque ou a expiré. */
function AdvertiserAvatar({ ad, name }: { ad: LibraryAd; name: string }) {
  const [cassee, setCassee] = useState(false);
  if (ad.pageAvatarUrl && !cassee) {
    return (
      <img
        src={ad.pageAvatarUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="size-10 shrink-0 rounded-full border object-cover"
        onError={() => setCassee(true)}
      />
    );
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-brand-green-text" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** Pastilles d'état en tête de carte : « Actif » en vert, « Nombre faible d'impressions » en orange. */
function Pastilles({ ad }: { ad: LibraryAd }) {
  const faible = ad.impressionsText?.trim().startsWith('<') ?? false;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ad.active ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-sm font-semibold text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Actif
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-sm font-semibold text-muted-foreground">Inactif</span>
      )}
      {faible && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-sm font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
          title="Meta publie une tranche d’impressions basse pour cette annonce."
        >
          Nombre faible d’impressions
          <Info className="size-3.5" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

/** Pays où l'annonce a été vue en diffusion. Rien n'est affiché quand aucun pays n'a été relevé. */
function Pays({ codes }: { codes: string[] }) {
  if (codes.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      Diffusée en
      {codes.slice(0, 6).map((code) => (
        <span key={code} className="inline-flex items-center gap-1 font-medium">
          <CountryFlag code={code} />
          {countryName(code)}
        </span>
      ))}
      {codes.length > 6 && <span className="text-muted-foreground">+{codes.length - 6}</span>}
    </p>
  );
}

export function AdCard({
  ad,
  onWatch,
  onShowDetails,
  onShowAdvertiser,
  busy,
}: {
  ad: LibraryAd;
  onWatch: (host: string) => void;
  onShowDetails: (ad: LibraryAd) => void;
  onShowAdvertiser: (ad: LibraryAd) => void;
  busy: string | null;
}) {
  const annonceur = ad.advertiser ?? ad.storeHost ?? 'Annonceur';
  const lien = ad.landingUrl ? safeHttpUrl(ad.landingUrl) : null;
  const actif = tempsActif(ad);
  const recapitulatif = ad.variants > 1;
  return (
    <Card className="flex flex-col gap-0 overflow-hidden py-0">
      <div className="space-y-2.5 p-5 text-[15px]">
        <div className="flex items-start justify-between gap-2">
          <Pastilles ad={ad} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mt-1 -mr-2 size-8 shrink-0" aria-label="Plus d’actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => onShowDetails(ad)}>
                <Info />
                Voir les détails de la publicité
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onShowAdvertiser(ad)}>
                <Store />
                Toutes les publicités de cet annonceur
              </DropdownMenuItem>
              {ad.storeHost && (
                <DropdownMenuItem disabled={busy === ad.storeHost} onSelect={() => ad.storeHost && onWatch(ad.storeHost)}>
                  <Eye />
                  Surveiller la boutique chaque jour
                </DropdownMenuItem>
              )}
              {ad.downloadable && (
                <DropdownMenuItem asChild>
                  <a href={`/api/espionnage/ads/${ad.id}/download`} download>
                    <Download />
                    Télécharger le visuel
                  </a>
                </DropdownMenuItem>
              )}
              {lien && (
                <DropdownMenuItem asChild>
                  <a href={lien} target="_blank" rel="noreferrer noopener">
                    <ExternalLink />
                    Voir le produit
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <a href={`https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.externalId)}`} target="_blank" rel="noreferrer noopener">
                  <ExternalLink />
                  Ouvrir dans la bibliothèque Meta
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p>
          ID dans la bibliothèque : <span className="tabular-nums">{ad.externalId}</span>
        </p>
        {ad.startedAt && (
          <p>
            Début de la diffusion le {dateMeta(ad.startedAt)}
            {actif ? ` · Temps actif total : ${actif}` : ''}
          </p>
        )}
        {ad.platforms.length > 0 && (
          <p className="flex flex-wrap items-center gap-2">
            Plateformes <Plateformes noms={ad.platforms} />
          </p>
        )}
        {ad.impressionsText && (
          <p className="flex items-center gap-2">
            <Eye className="size-4 text-muted-foreground" aria-hidden="true" />
            Impressions : <span className="font-semibold">{ad.impressionsText}</span>
          </p>
        )}
        {recapitulatif ? (
          <p>
            <span className="font-semibold">{ad.variants} publicités</span> utilisent ce contenu publicitaire et ce texte
          </p>
        ) : ad.cards.length > 1 ? (
          <p className="flex items-center gap-2">
            Cette publicité a plusieurs versions <Info className="size-4 text-muted-foreground" aria-hidden="true" />
          </p>
        ) : null}
        <Pays codes={ad.countries ?? []} />
        {ad.daysSinceSeen > 0 && (
          <p className="text-xs text-muted-foreground">
            État contrôlé il y a {ad.daysSinceSeen} jour{ad.daysSinceSeen > 1 ? 's' : ''}
          </p>
        )}
        <Button variant="secondary" className="mt-1 h-11 w-full text-base font-medium" onClick={() => onShowDetails(ad)}>
          {recapitulatif ? 'Voir les détails du récapitulatif' : 'Voir les détails de la publicité'}
        </Button>
        {/* Les deux gestes les plus demandés, à portée de pouce : la boutique derrière l'annonce, et son visuel. */}
        {(ad.storeHost || ad.downloadable) && (
          <div className="flex gap-2">
            {ad.storeHost && (
              <Button asChild variant="outline" className="h-10 min-w-0 flex-1">
                <Link to={`/app/radar?boutique=${encodeURIComponent(ad.storeHost)}`}>
                  <Radar />
                  <span className="truncate">Ouvrir dans le Radar</span>
                </Link>
              </Button>
            )}
            {ad.downloadable && (
              <Button asChild variant="outline" className={cn('h-10', !ad.storeHost && 'flex-1')}>
                <a href={`/api/espionnage/ads/${ad.id}/download`} download aria-label="Télécharger le visuel de cette publicité">
                  <Download />
                  {!ad.storeHost && 'Télécharger le visuel'}
                </a>
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mx-5 border-t" />

      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-3 px-5 pt-4 pb-3">
          <AdvertiserAvatar ad={ad} name={annonceur} />
          <div className="min-w-0">
            <button
              type="button"
              className="block max-w-full truncate text-left text-base font-semibold hover:underline"
              onClick={() => onShowAdvertiser(ad)}
              title="Voir toutes les publicités de cet annonceur"
            >
              {annonceur}
            </button>
            <p className="text-sm text-muted-foreground">Sponsorisé</p>
          </div>
        </div>
        {ad.bodyText && <AdText text={ad.bodyText} />}
        <div className="mt-auto">
          <AdMedia ad={ad} />
          <LinkBar ad={ad} />
        </div>
      </div>
    </Card>
  );
}

/** Détail d'une annonce : tout le texte, toutes les variantes, les liens — ce que Meta montre en grand. */
export function AdDetailsDialog({
  ad,
  onClose,
  onShowAdvertiser,
}: {
  ad: LibraryAd | null;
  onClose: () => void;
  onShowAdvertiser: (ad: LibraryAd) => void;
}) {
  const lien = ad?.landingUrl ? safeHttpUrl(ad.landingUrl) : null;
  const bibliotheque = ad ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.externalId)}` : '#';
  const page = ad?.pageUrl ? safeHttpUrl(ad.pageUrl) : null;
  const actif = ad ? tempsActif(ad) : null;
  return (
    <Dialog open={ad !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {ad && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <AdvertiserAvatar ad={ad} name={ad.advertiser ?? ad.storeHost ?? 'Annonceur'} />
                <div className="min-w-0 text-left">
                  <DialogTitle className="truncate">{ad.advertiser ?? ad.storeHost ?? 'Annonceur'}</DialogTitle>
                  <DialogDescription>
                    {ad.active ? 'Actif' : 'Inactif'} · ID dans la bibliothèque : {ad.externalId}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {ad.startedAt ? `Début de la diffusion le ${dateMeta(ad.startedAt)}` : 'Date de début non publiée'}
              {actif ? ` · Temps actif total : ${actif}` : ''}
              {ad.variants > 1 ? ` · ${ad.variants} publicités utilisent ce contenu publicitaire et ce texte` : ''}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="overflow-hidden rounded-lg border">
                <AdMedia ad={ad} />
                <LinkBar ad={ad} />
              </div>
              <div className="space-y-3 text-sm">
                {ad.bodyText && <p className="leading-relaxed whitespace-pre-line">{ad.bodyText}</p>}
                <p className="text-xs text-muted-foreground">
                  {ad.storeHost ? (
                    <>
                      Boutique : <span className="font-medium text-foreground">{ad.storeHost}</span>
                    </>
                  ) : (
                    'Hors boutiques de la plateforme'
                  )}
                  {ad.displayFormat ? ` · format ${ad.displayFormat.toLowerCase()}` : ''}
                </p>
              </div>
            </div>
            {ad.cards.length > 1 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">{ad.cards.length} versions de cette publicité</p>
                <ol className="grid gap-2 sm:grid-cols-2">
                  {ad.cards.map((carte, rang) => (
                    <li key={rang} className="rounded-lg border p-3 text-sm">
                      <p className="text-xs text-muted-foreground">Version {rang + 1}</p>
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
              {ad.storeHost && (
                <Button asChild size="sm" variant="outline">
                  <Link to={`/app/radar?boutique=${encodeURIComponent(ad.storeHost)}`}>
                    <Radar />
                    Ouvrir dans le Radar
                  </Link>
                </Button>
              )}
              {ad.downloadable && (
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/espionnage/ads/${ad.id}/download`} download>
                    <Download />
                    Télécharger le visuel
                  </a>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onShowAdvertiser(ad)}>
                <Store />
                Toutes les publicités de cet annonceur
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a href={bibliotheque} target="_blank" rel="noreferrer noopener">
                  Ouvrir dans la bibliothèque Meta
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
