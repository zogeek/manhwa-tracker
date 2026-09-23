import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { createTestContext, signUp, type TestUser } from '../../test/integration.js';

const context = createTestContext();
const lists = context.client.reading.lists;

let catalog: SeededCatalog;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  catalog = await seedCatalog(context.db);
  alice = await signUp(context, 'alice');
  bob = await signUp(context, 'bob');
});

afterAll(() => context.close());

async function createAliceList(name = 'Favoris'): Promise<string> {
  const res = await lists.$post({ json: { name } }, { headers: alice.headers });
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.data.id;
}

describe('reading lists — authentication', () => {
  it('answers 401 without a session on every route', async () => {
    const id = randomUUID();
    const responses = await Promise.all([
      lists.$get(),
      lists.$post({ json: { name: 'x' } }),
      lists[':id'].$get({ param: { id } }),
      lists[':id'].$patch({ param: { id }, json: { name: 'x' } }),
      lists[':id'].$delete({ param: { id } }),
      lists[':id'].items.$post({ param: { id }, json: { manhwaId: catalog.manhwa.id } }),
      lists[':id'].items[':manhwaId'].$delete({ param: { id, manhwaId: catalog.manhwa.id } }),
    ]);

    expect(responses.map((res) => res.status)).toEqual(Array(responses.length).fill(401));
  });

  it('ignores a forged x-user-id header', async () => {
    const res = await lists.$get({}, { headers: { 'x-user-id': alice.id } });

    expect(res.status).toBe(401);
  });
});

describe('reading lists — ownership (IDOR)', () => {
  it('lets the owner manage the list and its items', async () => {
    const id = await createAliceList();

    const added = await lists[':id'].items.$post(
      { param: { id }, json: { manhwaId: catalog.manhwa.id } },
      { headers: alice.headers },
    );
    expect(added.status).toBe(201);

    const res = await lists[':id'].$get({ param: { id } }, { headers: alice.headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items.map((item) => item.manhwaId)).toEqual([catalog.manhwa.id]);
  });

  it("answers 403 when another user reads or mutates Alice's list, and changes nothing", async () => {
    const id = await createAliceList('Top tier');

    const attempts = await Promise.all([
      lists[':id'].$get({ param: { id } }, { headers: bob.headers }),
      lists[':id'].$patch({ param: { id }, json: { name: 'pwned' } }, { headers: bob.headers }),
      lists[':id'].$delete({ param: { id } }, { headers: bob.headers }),
      lists[':id'].items.$post({ param: { id }, json: { manhwaId: catalog.manhwa.id } }, { headers: bob.headers }),
      lists[':id'].items[':manhwaId'].$delete(
        { param: { id, manhwaId: catalog.manhwa.id } },
        { headers: bob.headers },
      ),
    ]);
    expect(attempts.map((res) => res.status)).toEqual(Array(attempts.length).fill(403));

    const res = await lists[':id'].$get({ param: { id } }, { headers: alice.headers });
    const body = await res.json();
    expect(body.data.name).toBe('Top tier');
    expect(body.data.items).toEqual([]);
  });

  it("does not leak Alice's lists in Bob's index", async () => {
    await createAliceList('Private');

    const res = await lists.$get({}, { headers: bob.headers });
    const body = await res.json();

    expect(body.data).toEqual([]);
  });

  it('maps constraint violations: duplicate item 409, unknown manhwa 422', async () => {
    const id = await createAliceList();
    const add = (manhwaId: string) =>
      lists[':id'].items.$post({ param: { id }, json: { manhwaId } }, { headers: alice.headers });

    expect((await add(catalog.manhwa.id)).status).toBe(201);
    expect((await add(catalog.manhwa.id)).status).toBe(409);
    expect((await add(randomUUID())).status).toBe(422);
  });
});
