/**
 * Fonction unique de l'hébergement sans serveur (Vercel).
 *
 * Vercel cherche ses fonctions dans ce dossier. Le serveur, lui, est écrit en TypeScript
 * avec des chemins courts (`@server/…`) que Vercel ne sait pas résoudre : il est donc
 * assemblé en un seul fichier pendant la construction (`npm run build:server`), et ce
 * fichier-ci se contente de le désigner.
 *
 * Toutes les adresses arrivent ici, sauf les fichiers du site que Vercel distribue
 * lui-même (voir « rewrites » dans vercel.json).
 */
export { default } from '../dist/vercel.js';
