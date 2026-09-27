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

    type Terms = InferResponseType<(typeof client.taxonomy.vocabularies)[':slug']['terms']['$get'], 200>;
    expectTypeOf<Terms['data'][number]['parentId']>().toEqualTypeOf<string | null>();

    type Sources = InferResponseType<typeof client.sources.$get, 200>;
    expectTypeOf<Sources['data'][number]['baseUrl']>().toEqualTypeOf<string>();

    type Library = InferResponseType<typeof client.reading.progress.$get, 200>;
    expectTypeOf<Library['data'][number]['manhwa']['title']>().toEqualTypeOf<string>();

    type Progress = InferResponseType<(typeof client.reading.progress)[':manhwaId']['$get'], 200>;
    expectTypeOf<NonNullable<Progress['data']>['furthestChapter']>().toEqualTypeOf<number>();
  });

  it('exposes the multi-provider search and the mirrored media to the web client', () => {
    type SearchQuery = InferRequestType<typeof client.manhwas.search.$get>['query'];
    expectTypeOf<SearchQuery['providers']>().toEqualTypeOf<string | undefined>();

    type Search = InferResponseType<typeof client.manhwas.search.$get, 200>;
    expectTypeOf<Search['data']['external'][number]['provider']>().toEqualTypeOf<'anilist' | 'mangadex' | 'kitsu'>();
    expectTypeOf<Search['data']['external'][number]['importedManhwaId']>().toEqualTypeOf<string | null>();

    type MediaParam = InferRequestType<(typeof client.images.media)[':key']['$get']>['param'];
    expectTypeOf<MediaParam['key']>().toEqualTypeOf<string>();
  });

  it('exposes authors and the local cover on every manhwa read', () => {
    type ManhwaById = InferResponseType<(typeof client.manhwas)[':id']['$get'], 200>;
    expectTypeOf<ManhwaById['data']['authors'][number]>().toEqualTypeOf<{
      name: string;
      nativeName: string | null;
      role: 'story' | 'art' | 'both';
    }>();
    expectTypeOf<ManhwaById['data']['localCoverUrl']>().toEqualTypeOf<string | null>();

    type Library = InferResponseType<typeof client.reading.progress.$get, 200>;
    expectTypeOf<Library['data'][number]['manhwa']['localCoverUrl']>().toEqualTypeOf<string | null>();

    type Search = InferResponseType<typeof client.manhwas.search.$get, 200>;
    expectTypeOf<Search['data']['external'][number]['authors'][number]['role']>().toEqualTypeOf<'story' | 'art' | 'both'>();
  });

  it('keeps machine and auth endpoints out of the web contract', () => {
    // /api/ingest (clé M2M) et /api/auth (Better Auth) ne font pas partie de AppType.
    expectTypeOf(client).not.toHaveProperty('api');
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
