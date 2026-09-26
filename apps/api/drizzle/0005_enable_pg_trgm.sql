-- Recherche floue par trigrammes (similarity, word_similarity, opérateurs % / <%, index GIN gin_trgm_ops).
-- Extension « trusted » depuis Postgres 13 : installable par le propriétaire de la base, sans superutilisateur.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
