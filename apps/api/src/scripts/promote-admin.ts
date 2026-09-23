// Promeut un utilisateur existant au rôle admin (bootstrap du premier administrateur).
// Usage : pnpm --filter api admin:promote <email>
// Ensuite, les admins peuvent gérer les rôles via les endpoints /api/auth/admin/* du plugin Better Auth.
import { eq } from 'drizzle-orm';
import { ADMIN_ROLE } from '../shared/auth/index.js';
import { loadEnv } from '../shared/config/env.js';
import { createDatabase } from '../shared/db/index.js';
import { user } from '../shared/db/schema.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: pnpm --filter api admin:promote <email>');
  process.exit(1);
}

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);

try {
  const [promoted] = await database.db
    .update(user)
    .set({ role: ADMIN_ROLE })
    .where(eq(user.email, email))
    .returning({ id: user.id, email: user.email });

  if (!promoted) {
    console.error(`No user found with email "${email}". Sign up first, then promote.`);
    process.exitCode = 1;
  } else {
    console.log(`✔ ${promoted.email} is now ${ADMIN_ROLE}.`);
  }
} finally {
  await database.close();
}
