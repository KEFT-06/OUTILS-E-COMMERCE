/**
 * Longueur d'un rapport rédigé : combien de mots font une page.
 *
 * L'auteur commande un nombre de PAGES ; le rédacteur, lui, reçoit un nombre de mots. Le lien
 * entre les deux est la mise en page du PDF (src/shared/lib/documentPdf.ts) : A4, marges de
 * 18 mm, corps en 10,5 points.
 *
 * Mesuré le 12/10/2026 sur cette mise en page : un texte structuré comme un rapport — sous-titres,
 * paragraphes, une liste par sous-partie — y tient à 458 mots par page (660 pour un bloc de texte
 * sans respiration). Le serveur en comptait 380 : un rapport commandé à 250 pages sortait à 207.
 * Le test src/shared/lib/documentPdf.test.ts refait cette mesure : changer la mise en page sans
 * revoir ce nombre le fait échouer.
 *
 * Module pur, partagé avec le site.
 */
export const REPORT_WORDS_PER_PAGE = 460;
