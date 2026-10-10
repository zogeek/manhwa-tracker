import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './index.js';

/** `apps/api/drizzle`, résolu depuis `src/shared/db` (tsx, tests) comme depuis `dist/shared/db` (build). */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/**
 * Applique les migrations SQL commitées (journal `drizzle/meta`), sans drizzle-kit : utilisable dans l'image
 * de production, où seules les dépendances runtime sont installées. Idempotent : seules les migrations absentes
 * de `drizzle.__drizzle_migrations` sont jouées, chacune dans une transaction.
 */
export async function runMigrations(db: Database, migrationsFolder: string = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder });
}
