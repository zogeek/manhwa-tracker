import type { Database, DbClient } from './index.js';

/**
 * Point de reprise (SAVEPOINT) dans la transaction en cours : si le bloc échoue, seules ses écritures
 * sont annulées (ROLLBACK TO SAVEPOINT) et l'erreur est relancée ; la transaction englobante reste utilisable.
 */
export type Savepoint<TRepositories> = <T>(work: (repositories: TRepositories) => Promise<T>) => Promise<T>;

/**
 * Unit of Work : exécute un bloc de travail dans une transaction Postgres.
 * Les repositories fournis au bloc partagent la même transaction : soit tout est commité,
 * soit une erreur (quelle qu'elle soit) annule l'ensemble (ROLLBACK). `savepoint` isole un sous-bloc
 * dont l'échec peut être toléré sans perdre le reste.
 */
export interface TransactionRunner<TRepositories> {
  run<T>(work: (repositories: TRepositories, savepoint: Savepoint<TRepositories>) => Promise<T>): Promise<T>;
}

export function createTransactionRunner<TRepositories>(
  db: Database,
  createRepositories: (client: DbClient) => TRepositories,
): TransactionRunner<TRepositories> {
  return {
    run: (work) =>
      db.transaction((tx) =>
        // Dans une transaction, Drizzle traduit `transaction()` en SAVEPOINT / ROLLBACK TO SAVEPOINT.
        work(createRepositories(tx), (inner) => tx.transaction((sp) => inner(createRepositories(sp)))),
      ),
  };
}
