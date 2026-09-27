import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/shared/ui/button';

/**
 * Deux repères de lecture sur les pages longues : où l'on en est, et comment revenir en haut.
 *
 * Les rapports d'analyse, les pages légales et le mur d'espionnage défilent sur plusieurs
 * écrans. Sans repère, on ne sait pas s'il reste un paragraphe ou dix, et remonter suppose
 * de faire défiler tout ce qu'on vient de lire.
 *
 * UN SEUL COMPOSANT pour les deux, parce qu'ils partagent la mesure : la position de défilement
 * est lue une fois par image, et sert à la fois à remplir la barre et à décider si le bouton
 * doit apparaître. Deux composants liraient la même chose deux fois.
 *
 * `passive: true` sur l'écoute : sans lui, le navigateur doit attendre de savoir si le
 * gestionnaire annule le défilement avant de le peindre, ce qui le rend saccadé sur mobile —
 * précisément là où ces deux aides servent le plus.
 */

/** En dessous, la page tient dans un écran ou deux : ni barre ni bouton n'ont d'utilité. */
const SEUIL_PX = 600;

export function ScrollAids() {
  const [progression, setProgression] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let demande = 0;

    const mesurer = () => {
      demande = 0;
      const haut = window.scrollY;
      const restant = document.documentElement.scrollHeight - window.innerHeight;
      // Page plus courte que l'écran : aucune progression à montrer, et diviser par zéro
      // donnerait NaN, donc une barre vide sur toutes les pages courtes.
      setProgression(restant > 0 ? Math.min(100, (haut / restant) * 100) : 0);
      setVisible(haut > SEUIL_PX);
    };

    /*
      Une seule mesure par image. Le défilement émet bien plus d'événements que l'écran
      n'affiche d'images ; mesurer à chacun ferait recalculer la mise en page des dizaines
      de fois pour un affichage identique.
    */
    const auDefilement = () => {
      if (demande) return;
      demande = window.requestAnimationFrame(mesurer);
    };

    mesurer();
    window.addEventListener('scroll', auDefilement, { passive: true });
    window.addEventListener('resize', auDefilement, { passive: true });
    return () => {
      if (demande) window.cancelAnimationFrame(demande);
      window.removeEventListener('scroll', auDefilement);
      window.removeEventListener('resize', auDefilement);
    };
  }, []);

  return (
    <>
      {/*
        Purement décorative : un lecteur d'écran annonce déjà sa position dans le document,
        et une barre qui se déclare « barre de progression » la lui répéterait à chaque
        mouvement. D'où `aria-hidden` plutôt qu'un rôle.
      */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5" aria-hidden="true">
        <div
          className="h-full origin-left bg-brand-green-text transition-transform duration-75 ease-out"
          style={{ transform: `scaleX(${progression / 100})` }}
        />
      </div>

      <Button
        size="icon"
        variant="secondary"
        aria-label="Revenir en haut de la page"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        // Caché au clavier comme à la souris quand il ne sert pas : un bouton invisible mais
        // focusable piège la tabulation sur une page qu'on vient d'ouvrir.
        className={`fixed right-4 bottom-24 z-40 rounded-full shadow-lg transition-opacity md:bottom-6 ${
          visible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        tabIndex={visible ? 0 : -1}
        aria-hidden={!visible}
      >
        <ArrowUp />
      </Button>
    </>
  );
}
