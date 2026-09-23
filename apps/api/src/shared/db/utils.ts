/** Première ligne d'un résultat, ou `null`. */
export function firstOrNull<T>(rows: readonly T[]): T | null {
  return rows[0] ?? null;
}

/** Première ligne d'un résultat qui en contient forcément une (ex. `INSERT … RETURNING`). */
export function firstOrThrow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('Expected the query to return at least one row');
  }
  return row;
}
