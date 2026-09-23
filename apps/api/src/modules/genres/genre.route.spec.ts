import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manhwaGenres, manhwas } from '../../shared/db/schema.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { createTestContext, signUpAdmin, type TestUser } from '../../test/integration.js';

const context = createTestContext();

let catalog: SeededCatalog;
let editor: TestUser;

beforeAll(async () => {
  catalog = await seedCatalog(context.db);
  editor = await signUpAdmin(context, 'editor');
});

afterAll(() => context.close());

describe('genres — pivot integrity (manhwa_genres)', () => {
  it('hard-deleting a genre cascades the pivot rows and leaves the manhwa intact', async () => {
    const res = await context.client.genres[':id'].$delete(
      { param: { id: catalog.genre.id } },
      { headers: editor.headers },
    );
    expect(res.status).toBe(204);

    const links = await context.db.select().from(manhwaGenres).where(eq(manhwaGenres.genreId, catalog.genre.id));
    expect(links).toEqual([]);
    const [manhwa] = await context.db.select().from(manhwas).where(eq(manhwas.id, catalog.manhwa.id));
    expect(manhwa?.deletedAt).toBeNull();
  });

  it('rejects a duplicate slug with 409', async () => {
    const create = () =>
      context.client.genres.$post({ json: { name: 'Romance', slug: 'romance' } }, { headers: editor.headers });

    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(409);
  });
});
