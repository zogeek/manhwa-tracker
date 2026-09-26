// Constantes de recherche partagées serveur ET client. Elles ne doivent pas vivre dans un
// module "use client" : importée depuis un Server Component, une valeur exportée par un tel
// module devient une *référence client* (une fonction), plus le nombre attendu.

/** L'API exige au moins 2 caractères (validator Zod de `GET /manhwas/search`). */
export const MIN_QUERY_LENGTH = 2;
