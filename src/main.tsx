import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/app/App';
import '@/styles/index.css';

// Thème appliqué avant le premier rendu : sans cela, un utilisateur en thème
// sombre voit la page s'afficher en clair une fraction de seconde.
try {
  if (localStorage.getItem('smartcreator_theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch {
  // Stockage indisponible : le thème clair par défaut s'applique.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
