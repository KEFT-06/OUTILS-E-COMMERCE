-- Fausses nouveautés du radar (constat du 18/10/2026).
--
-- Le premier relevé d'une surveillance annonçait chacun des produits que la boutique vendait déjà
-- comme un « Nouveau produit » : 173 événements le 18/10/2026 sur cinq boutiques ajoutées le jour
-- même. Le code n'en écrit plus (le premier relevé est l'état de départ) ; ceux déjà écrits partent.
--
-- Visés, et eux seuls : les événements « appeared » datés EXACTEMENT du premier relevé de leur
-- surveillance (colonne « created_at » : le même instant que la première apparition de ses articles), hors retours en vente.
-- Une vraie nouveauté, constatée à un relevé suivant, porte une date plus tardive : elle reste.
DELETE FROM "watch_events" AS e
USING (
	SELECT "watch_id", min("first_seen_at") AS "depart"
	FROM "watch_items"
	GROUP BY "watch_id"
) AS d
WHERE e."watch_id" = d."watch_id"
	AND e."kind" = 'appeared'
	AND e."created_at" = d."depart"
	AND coalesce(e."payload"->>'returned', 'false') <> 'true';
