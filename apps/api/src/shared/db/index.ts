import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

/** Transaction Drizzle, utilisable partout où un `Database` est attendu en lecture/écriture. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Client injecté dans les repositories : la connexion globale ou une transaction en cours. */
export type DbClient = Database | Transaction;

export type DatabaseConnection = {
  db: Database;
  close: () => Promise<void>;
};

export function createDatabase(connectionString: string): DatabaseConnection {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}
