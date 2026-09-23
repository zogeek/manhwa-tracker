import { hc, type InferRequestType, type InferResponseType } from 'hono/client';
import { describe, expectTypeOf, it } from 'vitest';
import type { AppType } from './app.js';

// Garde-fou du contrat Hono RPC consommé par apps/web : ces assertions sont vérifiées par `tsc`
// (pnpm typecheck). Si une route sort de l'inférence, la compilation échoue.
const client = hc<AppType>('http://localhost');

describe('AppType (Hono RPC contract)', () => {
  it('exposes typed responses for every module', () => {
    type ManhwaById = InferResponseType<(typeof client.manhwas)[':id']['$get'], 200>;
    expectTypeOf<ManhwaById['data']['title']>().toEqualTypeOf<string>();
    // Les Date sont sérialisées en string côté client.
    expectTypeOf<ManhwaById['data']['createdAt']>().toEqualTypeOf<string>();

    type Chapters = InferResponseType<typeof client.chapters.$get, 200>;
    expectTypeOf<Chapters['data'][number]['number']>().toEqualTypeOf<number>();

    type Genres = InferResponseType<typeof client.genres.$get, 200>;
    expectTypeOf<Genres['data'][number]['slug']>().toEqualTypeOf<string>();

    type Sources = InferResponseType<typeof client.sources.$get, 200>;
    expectTypeOf<Sources['data'][number]['baseUrl']>().toEqualTypeOf<string>();

    type Library = InferResponseType<typeof client.reading.progress.$get, 200>;
    expectTypeOf<Library['data'][number]['manhwa']['title']>().toEqualTypeOf<string>();

    type Progress = InferResponseType<(typeof client.reading.progress)[':manhwaId']['$get'], 200>;
    expectTypeOf<NonNullable<Progress['data']>['furthestChapter']>().toEqualTypeOf<number>();
  });

  it('exposes typed inputs derived from the Zod validators', () => {
    type NewChapter = InferRequestType<typeof client.chapters.$post>['json'];
    expectTypeOf<NewChapter['number']>().toEqualTypeOf<number>();
    expectTypeOf<NewChapter['manhwaId']>().toEqualTypeOf<string>();

    type AddItem = InferRequestType<(typeof client.reading.lists)[':id']['items']['$post']>;
    expectTypeOf<AddItem['param']['id']>().toEqualTypeOf<string>();
    expectTypeOf<AddItem['json']['manhwaId']>().toEqualTypeOf<string>();
  });
});
