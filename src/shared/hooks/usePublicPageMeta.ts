import { useEffect } from 'react';
import { findPublicPage } from '@server/shared/publicPages';

function setMeta(selector: string, attribute: 'content' | 'href', value: string) {
  const element = document.head.querySelector(selector);
  if (element) element.setAttribute(attribute, value);
}

/**
 * Titre, description et adresse canonique d'une page publique, mis à jour à chaque
 * changement de page (le serveur les écrit déjà pour le premier affichage).
 */
export function usePublicPageMeta(path: string) {
  useEffect(() => {
    const page = findPublicPage(path);
    if (!page) return;
    document.title = page.title;
    setMeta('meta[name="description"]', 'content', page.description);
    setMeta('meta[property="og:title"]', 'content', page.title);
    setMeta('meta[property="og:description"]', 'content', page.description);
    const canonical = new URL(page.path, window.location.origin).href;
    setMeta('link[rel="canonical"]', 'href', canonical);
    setMeta('meta[property="og:url"]', 'content', canonical);
  }, [path]);
}
