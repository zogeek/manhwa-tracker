import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { manhwaTerms, manhwas } from '../../shared/db/schema.js';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { createTestContext, signUp, signUpAdmin, type TestUser } from '../../test/integration.js';

const context = createTestContext();
const taxonomy = context.client.taxonomy;

let catalog: SeededCatalog;
let admin: TestUser;
let reader: TestUser;

beforeEach(async () => {
  catalog = await seedCatalog(context.db);
  admin = await signUpAdmin(context, 'admin');
  reader = await signUp(context, 'reader');
});

afterAll(() => context.close());

describe('taxonomy — public reads', () => {
  it('lists the terms of a vocabulary with their hierarchy', async () => {
    const res = await taxonomy.vocabularies[':slug'].terms.$get({ param: { slug: 'genre' } });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    const martialArts = data.find((term) => term.slug === 'martial-arts');
    expect(martialArts?.parentId).toBe(catalog.taxonomy.action.id);
  });

  it("lists a manhwa's tags with their vocabulary", async () => {
    const res = await taxonomy.manhwas[':manhwaId'].terms.$get({ param: { manhwaId: catalog.manhwa.id } });

    const { data } = await res.json();
    expect(data).toEqual([expect.objectContaining({ vocabularySlug: 'genre', term: expect.objectContaining({ slug: 'action' }) })]);
  });
});

describe('taxonomy — admin-only mutations', () => {
  it('answers 401 without a session and 403 for a regular user', async () => {
    const json = { vocabularyId: catalog.taxonomy.genreVocabulary.id, slug: 'isekai', name: 'Isekai' };

    expect((await taxonomy.terms.$post({ json })).status).toBe(401);
    expect((await taxonomy.terms.$post({ json }, { headers: reader.headers })).status).toBe(403);
    expect((await taxonomy.terms.$post({ json }, { headers: admin.headers })).status).toBe(201);
  });

  it('rejects a cycle with 409', async () => {
    const res = await taxonomy.terms[':id'].$patch(
      { param: { id: catalog.taxonomy.action.id }, json: { parentId: catalog.taxonomy.martialArts.id } },
      { headers: admin.headers },
    );

    expect(res.status).toBe(409);
  });

  it('refuses to delete a parent term (409), then cascades manhwa_terms when deleting a leaf', async () => {
    const parent = await taxonomy.terms[':id'].$delete(
      { param: { id: catalog.taxonomy.action.id } },
      { headers: admin.headers },
    );
    expect(parent.status).toBe(409);

    // Tag the manhwa with the leaf, then delete the leaf: the pivot row goes, the manhwa stays.
    await taxonomy.manhwas[':manhwaId'].terms[':termId'].$put(
      { param: { manhwaId: catalog.manhwa.id, termId: catalog.taxonomy.martialArts.id }, json: { relevance: 60 } },
      { headers: admin.headers },
    );
    const leaf = await taxonomy.terms[':id'].$delete(
      { param: { id: catalog.taxonomy.martialArts.id } },
      { headers: admin.headers },
    );
    expect(leaf.status).toBe(204);

    const links = await context.db
      .select()
      .from(manhwaTerms)
      .where(eq(manhwaTerms.termId, catalog.taxonomy.martialArts.id));
    expect(links).toEqual([]);
    const [manhwa] = await context.db.select().from(manhwas).where(eq(manhwas.id, catalog.manhwa.id));
    expect(manhwa?.deletedAt).toBeNull();
  });

  it('tags and untags a manhwa', async () => {
    const param = { manhwaId: catalog.manhwa.id, termId: catalog.taxonomy.martialArts.id };

    const tagged = await taxonomy.manhwas[':manhwaId'].terms[':termId'].$put(
      { param, json: { relevance: 40, isSpoiler: true } },
      { headers: admin.headers },
    );
    expect((await tagged.json()).data).toMatchObject({ relevance: 40, isSpoiler: true, source: 'curated' });

    const untagged = await taxonomy.manhwas[':manhwaId'].terms[':termId'].$delete({ param }, { headers: admin.headers });
    expect(untagged.status).toBe(204);
  });
});
