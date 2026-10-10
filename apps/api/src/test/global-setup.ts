import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../shared/db/index.js';
import { runMigrations } from '../shared/db/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Base de test dédiée, jamais la base de dev :
 * - en local : conteneur Postgres 16 éphémère (Docker requis), détruit en fin de suite ;
 * - en CI : `TEST_DATABASE_URL` pointe vers le service container du job.
 */
export default async function setup(project: TestProject) {
  let container: StartedPostgreSqlContainer | undefined;
  let databaseUrl = process.env['TEST_DATABASE_URL'];

  if (!databaseUrl) {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    databaseUrl = container.getConnectionUri();
  }

  const database = createDatabase(databaseUrl);
  try {
    await runMigrations(database.db);
  } finally {
    await database.close();
  }

  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await container?.stop();
  };
}
