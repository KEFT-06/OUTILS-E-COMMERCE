-- Alertes « Publicité qui dure » en double (constat du 18/10/2026).
--
-- Un annonceur publie souvent la même annonce en plusieurs copies : le fil affichait cinq fois
-- « Africa boost diffuse la même publicité depuis 30 jours ». Le code n'en écrit plus qu'une par
-- annonceur, titre et cap ; des doublons déjà écrits, seule la plus ancienne alerte reste.
-- Une annonce sans titre n'est pas regroupée : rien ne dit que deux annonces sans titre sont la même.
DELETE FROM "alerts" AS a
USING "alerts" AS b
WHERE a."kind" = 'ad_longevity'
	AND b."kind" = 'ad_longevity'
	AND a."payload"->>'storeHost' = b."payload"->>'storeHost'
	AND coalesce(a."payload"->>'days', '') = coalesce(b."payload"->>'days', '')
	AND trim(coalesce(a."payload"->>'title', '')) <> ''
	AND lower(regexp_replace(trim(a."payload"->>'title'), '\s+', ' ', 'g')) = lower(regexp_replace(trim(coalesce(b."payload"->>'title', '')), '\s+', ' ', 'g'))
	AND (b."created_at" < a."created_at" OR (b."created_at" = a."created_at" AND b."id" < a."id"));
