import { createHash } from 'node:crypto';

/** Slug ASCII stable (`Martial Arts` → `martial-arts`) ; repli sur une empreinte pour les noms non latins. */
export function slugify(name: string, fallbackPrefix = 'item'): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `${fallbackPrefix}-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
}
