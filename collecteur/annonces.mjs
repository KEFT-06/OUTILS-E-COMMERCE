/**
 * Ce que les deux collecteurs partagent : le collecteur maison (collecte.mjs, navigateur piloté)
 * et le collecteur Firecrawl (firecrawl.mjs). Lecture des réglages, adresse d'une recherche de la
 * bibliothèque publicitaire, relevé des annonces dans ce qu'elle renvoie, allègement avant versement.
 */
import { existsSync, readFileSync } from 'node:fs';

/**
 * Les réglages du fichier .env à la racine du dépôt, pour ceux que l'environnement ne donne pas
 * déjà. Lancé tel quel, le collecteur ne trouvait pas son secret et partait en « essai » sans rien
 * verser — sans que celui qui l'avait lancé le remarque (06/10/2026). Seuls les noms donnés sont repris.
 */
export function lireReglages(noms) {
  const reglages = new URL('../.env', import.meta.url);
  if (!existsSync(reglages)) return;
  for (const ligne of readFileSync(reglages, 'utf8').split(/\r?\n/)) {
    const lu = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(ligne.trim());
    if (lu && noms.test(lu[1]) && !process.env[lu[1]]) process.env[lu[1]] = lu[2].replace(/^(["'])(.*)\1$/, '$2').trim();
  }
}

/**
 * Demande au site, avec le secret du planificateur. Trois essais : sur une connexion instable,
 * un lot d'annonces ou la clôture du passage se perdait à la première coupure (passage du
 * 04/10/2026 : la clôture n'est jamais arrivée, les alertes n'ont pas été recalculées).
 */
export function clientDuSite(adresse, secret) {
  return async function site(path, init = {}) {
    let failure;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(`${adresse}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${secret}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
          signal: AbortSignal.timeout(90_000),
        });
        // Un refus du site (secret, lot illisible) ne se réessaie pas : il se répéterait à l'identique.
        if (response.status >= 400 && response.status < 500) throw Object.assign(new Error(`${path} a répondu ${response.status}`), { definitive: true });
        if (!response.ok) throw new Error(`${path} a répondu ${response.status}`);
        return await response.json();
      } catch (error) {
        failure = error;
        if (error.definitive || attempt === 3) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
      }
    }
    throw failure;
  };
}

/** Recherche par mot-clé dans la bibliothèque ; `reglage` : annonces en cours ou arrêtées, type de média. */
export const searchUrl = (query, country, reglage = {}) =>
  `https://www.facebook.com/ads/library/?${new URLSearchParams({
    active_status: reglage.statut ?? 'active',
    ad_type: 'all',
    country,
    q: query,
    search_type: 'keyword_unordered',
    media_type: reglage.media ?? 'all',
  })}`;

export const adUrl = (id) => `https://www.facebook.com/ads/library/?${new URLSearchParams({ active_status: 'all', ad_type: 'all', country: 'ALL', id })}`;

/** Ne garde d'une annonce que ce que le site lit : dix fois moins lourd à verser. */
export function slim(ad) {
  const media = (item) => ({
    original_image_url: item?.original_image_url ?? null,
    resized_image_url: item?.resized_image_url ?? null,
    video_preview_image_url: item?.video_preview_image_url ?? null,
    video_hd_url: item?.video_hd_url ?? null,
    video_sd_url: item?.video_sd_url ?? null,
  });
  const snapshot = ad.snapshot ?? {};
  return {
    ad_archive_id: ad.ad_archive_id,
    is_active: ad.is_active,
    start_date: ad.start_date,
    end_date: ad.end_date,
    collation_count: ad.collation_count,
    publisher_platform: ad.publisher_platform,
    page_id: ad.page_id,
    page_name: ad.page_name,
    impressions_with_index: ad.impressions_with_index,
    snapshot: {
      link_url: snapshot.link_url,
      caption: snapshot.caption,
      title: snapshot.title,
      body: snapshot.body ? { text: snapshot.body.text } : null,
      images: (snapshot.images ?? []).slice(0, 4).map(media),
      videos: (snapshot.videos ?? []).slice(0, 2).map(media),
      cards: (snapshot.cards ?? []).slice(0, 10).map((card) => ({ ...media(card), title: card.title, body: card.body, link_url: card.link_url, cta_text: card.cta_text })),
      page_name: snapshot.page_name,
      page_profile_uri: snapshot.page_profile_uri,
      page_profile_picture_url: snapshot.page_profile_picture_url,
      cta_text: snapshot.cta_text,
      display_format: snapshot.display_format,
      link_description: snapshot.link_description,
    },
  };
}

/** Relève les annonces contenues dans un texte de réponse (une ligne JSON par lot). */
export function harvest(text, into) {
  for (const line of text.split('\n')) {
    if (!line.includes('ad_archive_id')) continue;
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (node.ad_archive_id && node.snapshot) into.set(String(node.ad_archive_id), node);
      Object.values(node).forEach(visit);
    };
    visit(json);
  }
}

/** Les annonces écrites dans une page de la bibliothèque (le premier lot y est inscrit, dans des scripts). */
export function harvestPage(html, into) {
  harvest(html.replace(/<script[^>]*>/g, '\n').replace(/<\/script>/g, '\n'), into);
}
