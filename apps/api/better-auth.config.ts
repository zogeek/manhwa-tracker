// Point d'entrée du CLI Better Auth (`pnpm auth:generate`) — outillage uniquement, jamais importé par l'app.
// Il réutilise la factory de `shared/auth` : la configuration n'existe qu'à un seul endroit.
import { createAuth } from './src/shared/auth/index.js';
import { createDatabase } from './src/shared/db/index.js';

// Le pool pg est paresseux : `generate` lit la configuration sans ouvrir de connexion.
const { db } = createDatabase(process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/unused');

export const auth = createAuth({
  db,
  secret: 'cli-only-secret-not-used-at-runtime-000000',
  baseURL: 'http://localhost:3000',
  trustedOrigins: [],
});
