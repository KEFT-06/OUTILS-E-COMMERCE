import { useState } from "react";
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
  Store,
} from "lucide-react";
import { safeHttpUrl } from "@/shared/lib/safeUrl";
import type { LibraryAd } from "@/shared/types/radar";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

/**
 * Une publicité de la bibliothèque de Meta, présentée comme Meta la présente. Partagée par le mur
 * (annonces des boutiques de la plateforme) et par la recherche par mot-clé (annonces de tous les
 * comptes) : une annonce qui ne mène pas à la plateforme n'a simplement pas de boutique à suivre.
 */

export function AgeBadge({ days }: { days: number | null }) {
  if (days === null) return <Badge variant="outline">Date inconnue</Badge>;
  // Trois mois de publicité payée : le seuil au-delà duquel un produit a vraiment prouvé quelque chose.
  if (days >= 90)
    return (
      <Badge className="bg-brand-green-text text-white">
        {days} jours de diffusion
      </Badge>
    );
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
  FACEBOOK: { Icone: Facebook, nom: "Facebook" },
  INSTAGRAM: { Icone: Instagram, nom: "Instagram" },
  MESSENGER: { Icone: MessageCircle, nom: "Messenger" },
  WHATSAPP: { Icone: MessagesSquare, nom: "WhatsApp" },
  THREADS: { Icone: AtSign, nom: "Threads" },
  AUDIENCE_NETWORK: { Icone: Radio, nom: "Audience Network" },
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
            <span
              key={nom}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase"
            >
              {nom}
            </span>
          );
        }
        return (
          <connue.Icone
            key={nom}
            className="size-3.5"
            aria-label={connue.nom}
          />
        );
      })}
    </p>
  );
}

/** Date de début telle que Meta la publie : « Lancée le 16 août 2026 ». */
const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** Boutons d'action tels que Meta les renvoie (en anglais), dits comme sur la bibliothèque en français. */
const CTA_FR: Record<string, string> = {
  "learn more": "En savoir plus",
  "see details": "Voir les détails",
  download: "Télécharger",
  "shop now": "Acheter",
  "buy now": "Acheter",
  "sign up": "S’inscrire",
  "order now": "Commander",
  "get offer": "Profiter de l’offre",
  "book now": "Réserver",
  "send message": "Envoyer un message",
  "send whatsapp message": "Envoyer un message WhatsApp",
  "contact us": "Nous contacter",
  subscribe: "S’abonner",
  "watch more": "Regarder plus",
  "apply now": "Postuler",
  "get quote": "Demander un devis",
};
const ctaFr = (cta: string | null) =>
  cta ? (CTA_FR[cta.trim().toLowerCase()] ?? cta) : null;

/** Visuel de l'annonce : l'aperçu conservé d'abord (il ne périme pas), sinon l'adresse de Meta. */
function AdMedia({ ad }: { ad: LibraryAd }) {
  const [cassee, setCassee] = useState(false);
  const source = ad.thumbnailUrl ?? ad.mediaUrl;
  return (
    <div className="relative aspect-square w-full overflow-hidden bg-muted">
      {source && !cassee ? (
        <img
          src={source}
          alt={ad.title ?? "Visuel de l’annonce"}
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
      {ad.mediaKind === "video" && (
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
          <Play className="size-3" aria-hidden="true" />
          Vidéo
        </span>
      )}
    </div>
  );
}

/** Barre de lien sous le visuel, comme chez Meta : domaine, titre, description et bouton. */
function LinkBar({ ad }: { ad: LibraryAd }) {
  const lien = ad.landingUrl ? safeHttpUrl(ad.landingUrl) : null;
  const cta = ctaFr(ad.ctaText);
  return (
    <div className="flex items-center gap-3 border-t bg-muted/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {ad.linkCaption ?? ad.storeHost}
        </p>
        {ad.title && (
          <p className="line-clamp-2 text-sm font-semibold leading-snug">
            {ad.title}
          </p>
        )}
        {ad.linkDescription && (
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {ad.linkDescription}
          </p>
        )}
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
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-brand-green-text"
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * Une annonce, présentée comme dans la bibliothèque publicitaire de Meta : état, identifiant,
 * date de lancement, plateformes, puis l'annonce elle-même — annonceur, texte, visuel, barre de
 * lien. C'est la disposition que connaissent ceux qui se servent déjà de la bibliothèque.
 */
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
  const annonceur = ad.advertiser ?? ad.storeHost ?? "Annonceur";
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
            <span className="font-semibold text-muted-foreground">
              Inactive
            </span>
          )}
          <span className="text-muted-foreground">
            ID de la bibliothèque :{" "}
            <span className="font-mono tabular-nums">{ad.externalId}</span>
          </span>
        </div>
        {ad.startedAt && (
          <p className="text-muted-foreground">
            Diffusion commencée le {dateFr(ad.startedAt)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Plateformes</span>
          <Plateformes noms={ad.platforms} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <AgeBadge days={ad.runningDays} />
          {ad.variants > 1 && (
            <Badge variant="outline">
              {ad.variants} publicités utilisent ce contenu
            </Badge>
          )}
          {ad.active && ad.daysSinceSeen > 7 && (
            <Badge
              variant="outline"
              title="Une collecte ne ramène qu'une partie des annonces : son absence ne prouve pas un arrêt."
            >
              Non revue depuis {ad.daysSinceSeen} jours
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          onClick={() => onShowDetails(ad)}
        >
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
        {ad.bodyText && (
          <p className="line-clamp-4 px-4 pb-3 text-sm leading-relaxed whitespace-pre-line">
            {ad.bodyText}
          </p>
        )}
        <AdMedia ad={ad} />
        <LinkBar ad={ad} />
        {/* Seule une boutique de la plateforme peut être suivie par le radar. */}
        {ad.storeHost && (
          <div className="mt-auto flex flex-wrap gap-2 border-t p-3">
            <Button
              size="sm"
              variant="outline"
              disabled={busy === ad.storeHost}
              onClick={() => ad.storeHost && onWatch(ad.storeHost)}
              title="Suivre cette boutique jour après jour"
            >
              <Eye />
              Surveiller la boutique
            </Button>
          </div>
        )}
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
  const bibliotheque = ad
    ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.externalId)}`
    : "#";
  const page = ad?.pageUrl ? safeHttpUrl(ad.pageUrl) : null;
  return (
    <Dialog open={ad !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {ad && (
          <>
            <DialogHeader>
              <DialogTitle>{ad.advertiser ?? ad.storeHost}</DialogTitle>
              <DialogDescription>
                {ad.active ? "Active" : "Inactive"} · ID {ad.externalId}
                {ad.startedAt
                  ? ` · diffusion commencée le ${dateFr(ad.startedAt)}`
                  : ""}
                {ad.runningDays !== null
                  ? ` · ${ad.runningDays} jours observés`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="overflow-hidden rounded-lg border">
                <AdMedia ad={ad} />
                <LinkBar ad={ad} />
              </div>
              <div className="space-y-3 text-sm">
                {ad.bodyText && (
                  <p className="leading-relaxed whitespace-pre-line">
                    {ad.bodyText}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {ad.storeHost ? (
                    <>
                      Boutique :{" "}
                      <span className="font-medium text-foreground">
                        {ad.storeHost}
                      </span>
                    </>
                  ) : (
                    "Hors boutiques de la plateforme"
                  )}
                  {ad.displayFormat
                    ? ` · format ${ad.displayFormat.toLowerCase()}`
                    : ""}
                </p>
              </div>
            </div>
            {ad.cards.length > 1 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  {ad.cards.length} variantes de cette publicité
                </p>
                <ol className="grid gap-2 sm:grid-cols-2">
                  {ad.cards.map((carte, rang) => (
                    <li key={rang} className="rounded-lg border p-3 text-sm">
                      <p className="text-xs text-muted-foreground">
                        Variante {rang + 1}
                      </p>
                      {carte.title && (
                        <p className="font-medium">{carte.title}</p>
                      )}
                      {carte.body && (
                        <p className="line-clamp-4 text-muted-foreground">
                          {carte.body}
                        </p>
                      )}
                      {carte.ctaText && (
                        <p className="mt-1 text-xs">
                          Bouton : {ctaFr(carte.ctaText)}
                        </p>
                      )}
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => onShowAdvertiser(ad)}
              >
                <Store />
                Toutes les annonces de cet annonceur
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a
                  href={bibliotheque}
                  target="_blank"
                  rel="noreferrer noopener"
                >
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
