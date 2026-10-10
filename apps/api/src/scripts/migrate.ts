// Applique les migrations Drizzle au démarrage du conteneur API (image de prod, sans drizzle-kit).
// Usage : node dist/scripts/migrate.js — en dev, `pnpm --filter api db:migrate` reste la commande de référence.
// Seul DATABASE_URL est requis : migrer ne demande ni les secrets d'auth ni la clé du scraper.
import { z } from 'zod';
import { createDatabase } from '../shared/db/index.js';
import { runMigrations } from '../shared/db/migrate.js';

const { DATABASE_URL } = z.object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) }).parse(process.env);
const database = createDatabase(DATABASE_URL);

try {
  await runMigrations(database.db);
  console.log('✔ Database migrations applied.');
} finally {
  await database.close();
}
