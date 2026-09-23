import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit ne charge pas les fichiers .env : on reproduit le comportement de `node --env-file-if-exists`.
const envFile = `.env.${process.env['NODE_ENV'] ?? 'development'}`;
if (!process.env['DATABASE_URL'] && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  schema: './src/shared/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
