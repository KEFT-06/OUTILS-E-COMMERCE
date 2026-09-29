import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/*
  Lu directement dans la media query, dès le premier rendu : l'ancienne version répondait
  « ordinateur » au premier affichage puis se corrigeait, ce qui dessinait la barre latérale
  de bureau avant de la remplacer sur téléphone (double rendu, saut de mise en page), et
  relisait `innerWidth`, qui force un calcul de mise en page.
*/
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

const isMobileNow = () => window.matchMedia(QUERY).matches
const onServer = () => false

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, isMobileNow, onServer)
}
