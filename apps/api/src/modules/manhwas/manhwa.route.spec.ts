import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCatalog, type SeededCatalog } from '../../shared/db/seed.test.js';
import { createTestContext, signUp, type TestUser } from '../../test/integration.js';

const context = createTestContext();
const manhwas = context.client.manhwas;

let catalog: SeededCatalog;
let editor: TestUser;

beforeAll(async () => {
  catalog = await seedCatalog(context.db);
  editor = await signUp(context, 'editor');
});

afterAll(() => context.close());

describe('manhwas — catalog mutations require a session', () => {
  it('keeps reads public', async () => {
    const res = await manhwas[':id'].$get({ param: { id: catalog.manhwa.id } });

    expect(res.status).toBe(200);
  });

  it('answers 401 on POST/PATCH/DELETE without a session, even with x-user-id', async () => {
    const id = catalog.manhwa.id;
    const forged = { headers: { 'x-user-id': editor.id } };
    const responses = await Promise.all([
      manhwas.$post({ json: { title: 'Nope' } }, forged),
      manhwas[':id'].$patch({ param: { id }, json: { title: 'Nope' } }, forged),
      manhwas[':id'].$delete({ param: { id } }, forged),
    ]);

    expect(responses.map((res) => res.status)).toEqual([401, 401, 401]);
  });

  it('rejects a malformed JSON body with 400 once authenticated', async () => {
    const res = await context.app.request('/manhwas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...editor.headers },
      body: '{not json',
    });

    expect(res.status).toBe(400);
  });

  it('records the session user as author', async () => {
    const created = await manhwas.$post({ json: { title: 'Omniscient Reader' } }, { headers: editor.headers });
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(data.createdBy).toBe(editor.id);

    const updated = await manhwas[':id'].$patch(
      { param: { id: data.id }, json: { status: 'completed' } },
      { headers: editor.headers },
    );
    expect((await updated.json()).data.updatedBy).toBe(editor.id);
  });
});
