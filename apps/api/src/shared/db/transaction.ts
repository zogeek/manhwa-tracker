import type { Database, DbClient } from './index.js';

/**
 * Unit of Work : exécute un bloc de travail dans une transaction Postgres.
 * Les repositories fournis au bloc partagent la même transaction : soit tout est commité,
 * soit une erreur (quelle qu'elle soit) annule l'ensemble (ROLLBACK).
 */
export interface TransactionRunner<TRepositories> {
  run<T>(work: (repositories: TRepositories) => Promise<T>): Promise<T>;
}

export function createTransactionRunner<TRepositories>(
  db: Database,
  createRepositories: (client: DbClient) => TRepositories,
): TransactionRunner<TRepositories> {
  return {
    run: (work) => db.transaction((tx) => work(createRepositories(tx))),
  };
}
