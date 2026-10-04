import { useCallback, useEffect, useMemo, useState } from "react";
import { Store } from "lucide-react";
import { toast } from "sonner";
import { AdCard, AdDetailsDialog } from "@/modules/espionnage/AdCard";
import { MetaSearchPanel } from "@/modules/espionnage/MetaSearchPanel";
import { PageHeader } from "@/shared/components/PageHeader";
import { apiRequest } from "@/shared/lib/api";
import { useCachedState } from "@/shared/lib/apiCache";
import { toApiError } from "@/shared/lib/apiError";
import type {
  EspionnageView as EspionnageData,
  LibraryAd,
} from "@/shared/types/radar";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";

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
  { value: "0", label: "Toutes les annonces", hint: "" },
  {
    value: "7",
    label: "Diffusées 7 jours et plus",
    hint: "a passé le premier tri",
  },
  {
    value: "30",
    label: "Diffusées 30 jours et plus",
    hint: "tient depuis un mois",
  },
  {
    value: "90",
    label: "Diffusées 90 jours et plus",
    hint: "produit installé, il paie depuis trois mois",
  },
] as const;

export function EspionnageView() {
  // Aucune consigne d'administration sur cet écran, pas même pour un administrateur : la
  // collecte tourne seule, et l'écran d'un abonné ne doit rien montrer de la cuisine (29/09/2026).
  const [erreur, setErreur] = useState<string | null>(null);
  const [anciennete, setAnciennete] = useState("0");
  const [format, setFormat] = useState<"tous" | "image" | "video">("tous");
  /*
    « En cours » par défaut, comme la bibliothèque de Meta, dont c'est le premier filtre et
    le réglage d'ouverture : la question qu'on se pose en arrivant est « qu'est-ce qui tourne
    encore ? ». Les annonces arrêtées restent à un clic — une offre qui a tourné deux cents
    jours avant de s'arrêter reste une preuve.
  */
  const [etat, setEtat] = useState<"toutes" | "active" | "arretee">("active");
  const [tri, setTri] = useState<"oldest" | "newest" | "variants">("oldest");
  const [busy, setBusy] = useState<string | null>(null);
  const [details, setDetails] = useState<LibraryAd | null>(null);
  /** « Toutes les annonces de cet annonceur », comme sur la page d'un annonceur chez Meta. */
  const [annonceur, setAnnonceur] = useState<{
    pageId: string | null;
    storeHost: string | null;
    nom: string;
  } | null>(null);

  const adresse = useMemo(() => {
    // Aucune limite demandée : le serveur sert ce que le palier autorise. En fixer une ici
    // rognait ce que les paliers supérieurs avaient payé, sans que rien ne le dise.
    const params = new URLSearchParams({ sort: tri });
    if (anciennete !== "0") params.set("minDays", anciennete);
    if (format !== "tous") params.set("mediaKind", format);
    if (etat !== "toutes") params.set("etat", etat);
    if (annonceur?.pageId) params.set("pageId", annonceur.pageId);
    else if (annonceur?.storeHost) params.set("storeHost", annonceur.storeHost);
    return `/api/espionnage?${params.toString()}`;
  }, [anciennete, format, etat, tri, annonceur]);
  // Le mur déjà vu avec ces réglages se réaffiche tout de suite, puis il est relu.
  const [data, setData] = useCachedState<EspionnageData>(adresse);

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<EspionnageData>(adresse));
      setErreur(null);
    } catch (caught) {
      setErreur(
        toApiError(caught, "Le mur d’espionnage n’a pas pu être chargé.")
          .message,
      );
    }
  }, [adresse, setData]);

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

  const voirAnnonceur = (ad: LibraryAd) => {
    setDetails(null);
    setAnnonceur({
      pageId: ad.pageId,
      storeHost: ad.storeHost,
      nom: ad.advertiser ?? ad.storeHost ?? "cet annonceur",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function surveiller(host: string) {
    setBusy(host);
    try {
      await apiRequest("/api/radar/watches", {
        method: "POST",
        body: { target: host },
      });
      toast.success(
        "Boutique ajoutée à votre radar. Elle sera relevée chaque jour.",
      );
    } catch (caught) {
      toast.error(
        toApiError(caught, "Cette boutique n’a pas pu être ajoutée.").message,
      );
    } finally {
      setBusy(null);
    }
  }

  const hint =
    ANCIENNETE.find((option) => option.value === anciennete)?.hint ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voir"
        title="Espionnage"
        description="Les publicités qui tournent en ce moment : ce que vendent ceux qui paient pour être vus, et depuis combien de temps."
      />

      {/* Une seule page, sans onglets (demande du 29/09/2026) : la recherche façon Meta en haut,
          les dernières publicités repérées dessous. */}
      <MetaSearchPanel />

      <section className="space-y-6" aria-labelledby="dernieres-publicites">
        <h2 id="dernieres-publicites" className="font-display text-xl font-bold tracking-tight">
          Dernières publicités repérées
        </h2>
          {erreur && (
            <Alert variant="destructive">
              <AlertTitle>Mur indisponible</AlertTitle>
              <AlertDescription>{erreur}</AlertDescription>
            </Alert>
          )}

          {annonceur && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/60 px-3 py-2 text-sm">
              <Store className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Toutes les annonces de{" "}
                <span className="font-semibold">{annonceur.nom}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAnnonceur(null)}
              >
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
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="font-display text-2xl font-extrabold tracking-tight tabular-nums">
                  {data
                    ? `${data.ads.length} annonce${data.ads.length > 1 ? "s" : ""}`
                    : "…"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {data
                    ? `chez ${data.stores} boutique${data.stores > 1 ? "s" : ""}`
                    : ""}
                  {hint ? ` · ${hint}` : ""}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 md:justify-end">
                <Select value={anciennete} onValueChange={setAnciennete}>
                  <SelectTrigger
                    className="w-full sm:w-72"
                    aria-label="Ancienneté de diffusion"
                  >
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

                <Select
                  value={etat}
                  onValueChange={(value) => setEtat(value as typeof etat)}
                >
                  <SelectTrigger
                    className="w-full sm:w-44"
                    aria-label="État de l’annonce"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Annonces en cours</SelectItem>
                    <SelectItem value="arretee">Annonces arrêtées</SelectItem>
                    <SelectItem value="toutes">Tous les états</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={format}
                  onValueChange={(value) => setFormat(value as typeof format)}
                >
                  <SelectTrigger
                    className="w-full sm:w-40"
                    aria-label="Format de l’annonce"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tous">Tous formats</SelectItem>
                    <SelectItem value="image">Images</SelectItem>
                    <SelectItem value="video">Vidéos</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={tri}
                  onValueChange={(value) => setTri(value as typeof tri)}
                >
                  <SelectTrigger
                    className="w-full sm:w-64"
                    aria-label="Trier par"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oldest">
                      Les plus anciennes d’abord
                    </SelectItem>
                    <SelectItem value="newest">
                      Les plus récentes d’abord
                    </SelectItem>
                    <SelectItem value="variants">
                      Le plus de variantes d’abord
                    </SelectItem>
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
                {data.hiddenByPlan} annonce{data.hiddenByPlan > 1 ? "s" : ""} de
                plus correspond
                {data.hiddenByPlan > 1 ? "ent" : ""} à ce filtre
              </AlertTitle>
              <AlertDescription>
                Votre palier affiche {data.visibleLimit} annonces à la fois. Les
                autres sont déjà collectées et vous attendent sur un palier
                supérieur.
              </AlertDescription>
            </Alert>
          )}

          {data && data.ads.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {data.ads.map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  onWatch={surveiller}
                  onShowDetails={setDetails}
                  onShowAdvertiser={voirAnnonceur}
                  busy={busy}
                />
              ))}
            </div>
          )}

          <AdDetailsDialog
            ad={details}
            onClose={() => setDetails(null)}
            onShowAdvertiser={voirAnnonceur}
          />

          {data && data.ads.length === 0 && (
            <Empty className="border border-dashed py-12">
              <EmptyHeader>
                <EmptyTitle>
                  {data.total === 0
                    ? "Aucune annonce collectée pour l’instant"
                    : "Aucune annonce sur ce filtre"}
                </EmptyTitle>
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
                    ? etat === "active"
                      ? "Aucune annonce en cours ne correspond. Affichez tous les états, élargissez l’ancienneté ou retirez la recherche."
                      : "Élargissez l’ancienneté, changez l’état ou retirez la recherche."
                    : data.configured
                      ? "Les premières annonces arrivent : le mur se remplit de lui-même. En attendant, cherchez un mot-clé dans l’onglet « Rechercher comme sur Meta »."
                      : "Le mur des annonces n’est pas encore disponible. Cherchez un mot-clé dans l’onglet « Rechercher comme sur Meta »."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          <p className="text-xs text-muted-foreground">
            Annonces publiées dans la bibliothèque publicitaire de Meta, que
            tout le monde peut consulter. Budget, impressions et portée n’y
            figurent pas : Meta ne les publie que pour l’Union européenne. Les
            visuels restent hébergés chez Meta ; leur aperçu est conservé ici
            trente jours après la dernière fois qu’une annonce a été vue.
          </p>
      </section>
    </div>
  );
}
