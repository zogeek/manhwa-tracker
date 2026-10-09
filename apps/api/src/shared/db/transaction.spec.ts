import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../../test/integration.js';
import type { DbClient } from './index.js';
import { sources } from './schema.js';
import { resetDatabase } from './seed.test.js';
import { createTransactionRunner } from './transaction.js';

const context = createTestContext();

beforeEach(() => resetDatabase(context.db));

afterAll(() => context.close());

/** « Repository » minimal : écrit une source dans le client (transaction ou savepoint) reçu. */
const addSource = (client: DbClient) => (name: string) =>
  client.insert(sources).values({ name, baseUrl: `https://${name}.example` });

const names = async () => (await context.db.select({ name: sources.name }).from(sources)).map((row) => row.name).sort();

describe('createTransactionRunner (Postgres)', () => {
  const transactions = () => createTransactionRunner(context.db, addSource);

  it('rolls back only the failed savepoint and commits the rest of the transaction', async () => {
    await transactions().run(async (add, savepoint) => {
      await add('before');
      await expect(
        savepoint(async (inner) => {
          await inner('discarded');
          throw new Error('fiche refusée');
        }),
      ).rejects.toThrow('fiche refusée');
      await savepoint((inner) => inner('kept'));
      await add('after');
    });

    expect(await names()).toEqual(['after', 'before', 'kept']);
  });

  it('still rolls everything back, savepoints included, when the transaction itself fails', async () => {
    await expect(
      transactions().run(async (add, savepoint) => {
        await savepoint((inner) => inner('kept'));
        await add('before');
        throw new Error('erreur fatale');
      }),
    ).rejects.toThrow('erreur fatale');

    expect(await names()).toEqual([]);
  });

  it('keeps the transaction usable after a constraint violation inside a savepoint', async () => {
    await transactions().run(async (add, savepoint) => {
      await add('dup');
      // Même nom → violation d'index unique : sans savepoint, Postgres refuserait toute requête suivante
      // (« current transaction is aborted »).
      await expect(savepoint((inner) => inner('dup'))).rejects.toThrow();
      await add('after');
    });

    expect(await names()).toEqual(['after', 'dup']);
  });
});
