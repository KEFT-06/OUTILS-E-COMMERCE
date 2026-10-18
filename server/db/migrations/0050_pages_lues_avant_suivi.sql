-- Pages d'annonceurs lues en entier le 18/10/2026 entre 02 h 15 et 03 h 20 UTC par le collecteur
-- Firecrawl, avant que le site ne retienne les lectures (table spied_pages, migration 0049).
-- Leur lecture a « revu » toutes leurs annonces dans cette fenêtre ; aucun autre collecteur n'a tourné
-- entre 00 h 35 et 03 h 20 UTC. Sans cette ligne, le plan les remettrait en tête et un passage les
-- relirait pour rien. Sur une base qui n'a pas connu ces passages, rien n'est inscrit.
INSERT INTO "spied_pages" ("page_id", "read_at", "ads")
SELECT "page_id", max("last_seen_at"), CAST(count(*) AS integer)
FROM "spied_ads"
WHERE "page_id" IS NOT NULL
GROUP BY "page_id"
HAVING max("last_seen_at") BETWEEN '2026-10-18T02:15:00Z' AND '2026-10-18T03:20:00Z'
ON CONFLICT ("page_id") DO NOTHING;
