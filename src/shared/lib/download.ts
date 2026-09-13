/** Déclenche le téléchargement d'un fichier généré dans le navigateur. */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Révoquer immédiatement annule le téléchargement dans certains navigateurs.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
