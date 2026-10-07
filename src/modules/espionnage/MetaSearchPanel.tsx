import { useCallback, useEffect, useRef, useState } from "react";
import { BrandIcon } from "@/shared/components/BrandIcon";
import { Loader2, Search, Store, X } from "lucide-react";
import { toast } from "sonner";
import { countryName } from "@server/shared/countries";
import { followableOnRadar } from "@server/shared/storefronts";
import { AdCard, AdDetailsDialog } from "@/modules/espionnage/AdCard";
import { apiRequest } from "@/shared/lib/api";
import { useCachedState } from "@/shared/lib/apiCache";
import { toApiError } from "@/shared/lib/apiError";
import { formatRelativeFr } from "@/shared/lib/formatDate";
import { MAX_POLL_MISSES, pollStatus } from "@/shared/lib/polling";
import type {
  AdSearch,
  AdSearchOverview,
  LibraryAd,
} from "@/shared/types/radar";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Switch } from "@/shared/ui/switch";

/**
 * Recherche dans la bibliothèque publicitaire, comme sur la page de Meta : un pays, un mot-clé,
 * et les publicités EN COURS de tous les comptes qui l'utilisent — « chariow », « formation
 * excel », « ebook »…
 *
 * Ce que l'écran doit dire, parce que c'est ce qui la distingue de la page de Meta : une
 * recherche nouvelle prend une trentaine de secondes (mesuré : 27 s pour 20 publicités), et chaque palier en
 * a un nombre par mois. Une recherche déjà faite dans les 24 heures, par n'importe qui, s'affiche
 * tout de suite et ne compte pas.
 */

/** Marchés proposés d'abord : ceux du public de Smart Creator, puis la diaspora. */
const PAYS = [
  "ALL",
  "CM",
  "CI",
  "SN",
  "BJ",
  "TG",
  "BF",
  "ML",
  "NE",
  "GN",
  "GA",
  "CG",
  "CD",
  "MA",
  "TN",
  "DZ",
  "MG",
  "FR",
  "BE",
  "CA",
] as const;
const nomPays = (code: string) =>
  code === "ALL" ? "Tous les pays" : countryName(code) || code;

const POLL_MS = 4_000;
const EXEMPLES = ["chariow", "formation", "ebook", "coaching"];

export function MetaSearchPanel() {
  const [apercu, setApercu] = useCachedState<AdSearchOverview>("/api/espionnage/searches");
  const [motCle, setMotCle] = useState("");
  const [pays, setPays] = useState<string>("ALL");
  const [recherche, setRecherche] = useState<AdSearch | null>(null);
  const [lancement, setLancement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [seulementChariow, setSeulementChariow] = useState(false);
  const [annonceur, setAnnonceur] = useState<{
    pageId: string;
    nom: string;
  } | null>(null);
  const [details, setDetails] = useState<LibraryAd | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [secondes, setSecondes] = useState(0);
  const suivi = useRef(0);
  const zoneResultat = useRef<HTMLDivElement>(null);

  /*
    Sur téléphone, le suivi puis les résultats s'affichent sous le formulaire et les recherches
    récentes, hors de l'écran : on tapait « Rechercher » et rien ne semblait se passer
    (signalé le 29/09/2026). L'écran descend donc jusqu'à eux, au lancement puis à l'arrivée.
  */
  const etatRecherche = recherche ? `${recherche.id}:${recherche.status}` : null;
  useEffect(() => {
    const zone = zoneResultat.current;
    if (!etatRecherche || !zone) return;
    const { top } = zone.getBoundingClientRect();
    if (top < 0 || top > window.innerHeight * 0.6) {
      zone.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [etatRecherche]);

  const chargerApercu = useCallback(async () => {
    try {
      setApercu(await apiRequest<AdSearchOverview>("/api/espionnage/searches"));
    } catch {
      // L'aperçu (recherches récentes, quota) est un confort : la recherche reste possible sans lui.
    }
  }, [setApercu]);

  useEffect(() => {
    void chargerApercu();
  }, [chargerApercu]);

  // Suivi d'une recherche en cours : relue toutes les quatre secondes jusqu'au résultat.
  useEffect(() => {
    if (recherche?.status !== "running") return;
    const jeton = ++suivi.current;
    const debut = Date.now();
    let rates = 0;
    const minuteur = setInterval(
      () => setSecondes(Math.round((Date.now() - debut) / 1000)),
      1000,
    );
    const boucle = async () => {
      while (suivi.current === jeton) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (suivi.current !== jeton) return;
        const reponse = await pollStatus<{ search: AdSearch }>(
          `/api/espionnage/searches/${recherche.id}`,
          "Le suivi de la recherche a échoué",
        ).catch((caught: unknown) => {
          setErreur(
            toApiError(caught, "Le suivi de la recherche a échoué.").message,
          );
          return null;
        });
        if (!reponse) {
          rates += 1;
          if (rates >= MAX_POLL_MISSES) {
            // La recherche tourne côté serveur : on continue de la suivre, plus lentement, et son
            // résultat s'affiche de lui-même au retour de la connexion. On ne demande pas de la relancer.
            setErreur(
              "Connexion perdue : la recherche continue sans vous, son résultat s’affichera ici dès le retour de la connexion.",
            );
            await new Promise((resolve) => setTimeout(resolve, 11_000));
          }
          continue;
        }
        if (rates > 0) setErreur(null);
        rates = 0;
        if (reponse.search.status !== "running") {
          setRecherche(reponse.search);
          void chargerApercu();
          return;
        }
      }
    };
    void boucle();
    return () => {
      suivi.current += 1;
      clearInterval(minuteur);
    };
  }, [recherche?.id, recherche?.status, chargerApercu]);

  async function lancer(mot = motCle, codePays = pays) {
    const texte = mot.trim();
    if (texte.length < 2) return;
    setErreur(null);
    setLancement(true);
    setAnnonceur(null);
    setSecondes(0);
    try {
      const { search } = await apiRequest<{ search: AdSearch }>(
        "/api/espionnage/searches",
        {
          method: "POST",
          body: { query: texte, country: codePays },
        },
      );
      setRecherche(search);
      setMotCle(texte);
      if (search.status !== "running") void chargerApercu();
    } catch (caught) {
      setErreur(
        toApiError(caught, "La recherche n’a pas pu être lancée.").message,
      );
    } finally {
      setLancement(false);
    }
  }

  async function ouvrir(id: string) {
    setErreur(null);
    setAnnonceur(null);
    try {
      const { search } = await apiRequest<{ search: AdSearch }>(
        `/api/espionnage/searches/${id}`,
      );
      setRecherche(search);
      setMotCle(search.query);
      setPays(search.country);
    } catch (caught) {
      setErreur(
        toApiError(caught, "Cette recherche n’a pas pu être ouverte.").message,
      );
    }
  }

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

  const voirAnnonceur = (ad: LibraryAd) => {
    setDetails(null);
    if (ad.pageId)
      setAnnonceur({
        pageId: ad.pageId,
        nom: ad.advertiser ?? "cet annonceur",
      });
  };

  const quota = apercu?.quota;
  const annonces = (recherche?.ads ?? [])
    .filter((ad) => !seulementChariow || followableOnRadar(ad.storeHost))
    .filter((ad) => !annonceur || ad.pageId === annonceur.pageId);

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <BrandIcon brand="meta" decorative className="mt-0.5 size-5" />
          <div className="space-y-1">
            <h2 className="font-semibold">Bibliothèque publicitaire</h2>
            <p className="text-sm text-muted-foreground">
              Comme sur la bibliothèque de Meta : tapez un mot-clé et voyez les
              publicités en cours de tous les comptes qui l’utilisent, avec leur
              ancienneté, leur texte, leur visuel et leur lien.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-2 md:flex-row"
          onSubmit={(submit) => {
            submit.preventDefault();
            void lancer();
          }}
        >
          <Select value={pays} onValueChange={setPays}>
            <SelectTrigger
              className="h-11 w-full md:w-52"
              aria-label="Pays de diffusion"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYS.map((code) => (
                <SelectItem key={code} value={code}>
                  {nomPays(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={motCle}
            onChange={(change) => setMotCle(change.target.value)}
            placeholder="Mot-clé : chariow, formation, ebook…"
            aria-label="Mot-clé à chercher dans les publicités"
            className="h-11 text-base"
            maxLength={80}
          />
          <Button
            type="submit"
            className="h-11 shrink-0"
            disabled={
              lancement ||
              motCle.trim().length < 2 ||
              recherche?.status === "running"
            }
          >
            {lancement ? <Loader2 className="animate-spin" /> : <Search />}
            Rechercher
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {quota && (
            <span>
              {quota.limit === null
                ? "Recherches nouvelles illimitées sur votre palier"
                : quota.limit === 0
                  ? "Votre palier consulte les recherches déjà faites ; les nouvelles s’ouvrent à partir du palier Plus"
                  : `${Math.max(0, quota.limit - quota.used)} recherche${quota.limit - quota.used > 1 ? "s" : ""} nouvelle${quota.limit - quota.used > 1 ? "s" : ""} restante${quota.limit - quota.used > 1 ? "s" : ""} ce mois-ci`}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {(apercu?.recent.length ? apercu.recent : []).map((entree) => (
            <Button
              key={entree.id}
              size="sm"
              variant="outline"
              onClick={() => void ouvrir(entree.id)}
              title={`Recherche du ${new Date(entree.createdAt).toLocaleString("fr-FR")}`}
            >
              {entree.query}
              <span className="text-xs text-muted-foreground">
                {entree.country !== "ALL" ? `${entree.country} · ` : ""}
                {entree.adsFound}
              </span>
            </Button>
          ))}
          {!apercu?.recent.length &&
            EXEMPLES.map((exemple) => (
              <Button
                key={exemple}
                size="sm"
                variant="ghost"
                onClick={() => setMotCle(exemple)}
              >
                {exemple}
              </Button>
            ))}
        </div>
      </div>

      {apercu && !apercu.configured && (
        <Alert>
          <AlertTitle>Recherche indisponible</AlertTitle>
          <AlertDescription>
            La recherche de publicités est momentanément indisponible.
          </AlertDescription>
        </Alert>
      )}

      <div ref={zoneResultat} className="scroll-mt-20" aria-hidden="true" />

      {erreur && (
        <Alert variant="destructive">
          <AlertTitle>Recherche impossible</AlertTitle>
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      {recherche?.status === "running" && (
        <Alert variant="info" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <AlertTitle>
            Recherche de « {recherche.query} » dans la bibliothèque de Meta…
          </AlertTitle>
          <AlertDescription>
            Environ trente secondes{secondes > 0 ? ` (${secondes} s)` : ""}. Les
            publicités s’affichent ici dès qu’elles arrivent ; si vous quittez
            la page, la recherche continue et restera consultable 24 heures.
          </AlertDescription>
        </Alert>
      )}

      {recherche?.status === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>
            La recherche de « {recherche.query} » n’a pas abouti
          </AlertTitle>
          <AlertDescription>
            {recherche.error ?? "Relancez-la dans un moment."}
          </AlertDescription>
        </Alert>
      )}

      {recherche?.status === "done" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-display text-2xl font-extrabold tracking-tight tabular-nums">
                {recherche.adsFound ?? 0} publicité
                {(recherche.adsFound ?? 0) > 1 ? "s" : ""} en cours pour «{" "}
                {recherche.query} »
              </p>
              <p className="text-sm text-muted-foreground">
                {nomPays(recherche.country)} · dont {recherche.platformAds} vers
                une boutique Chariow
                {recherche.fromCache
                  ? ` · recherche partagée ${formatRelativeFr(recherche.createdAt)}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="seulement-chariow"
                checked={seulementChariow}
                onCheckedChange={setSeulementChariow}
              />
              <Label htmlFor="seulement-chariow">
                Seulement les boutiques Chariow
              </Label>
            </div>
          </div>

          {annonceur && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/60 px-3 py-2 text-sm">
              <Store className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Publicités de{" "}
                <span className="font-semibold">{annonceur.nom}</span> dans
                cette recherche
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAnnonceur(null)}
              >
                <X />
                Retirer ce filtre
              </Button>
            </div>
          )}

          {recherche.hiddenByPlan > 0 && (
            <Alert>
              <AlertTitle>
                {recherche.hiddenByPlan} publicité
                {recherche.hiddenByPlan > 1 ? "s" : ""} de plus trouvée
                {recherche.hiddenByPlan > 1 ? "s" : ""}
              </AlertTitle>
              <AlertDescription>
                Votre palier en affiche une partie ; les autres vous attendent
                sur un palier supérieur.
              </AlertDescription>
            </Alert>
          )}

          {annonces.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {annonces.map((ad) => (
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
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {seulementChariow
                ? "Aucune de ces publicités ne mène à une boutique Chariow. Retirez le filtre pour les voir toutes."
                : "Aucune publicité en cours ne contient ce mot-clé dans ce pays. Essayez un mot plus large ou « Tous les pays »."}
            </p>
          )}
        </div>
      )}

      <AdDetailsDialog
        ad={details}
        onClose={() => setDetails(null)}
        onShowAdvertiser={voirAnnonceur}
      />
    </div>
  );
}
