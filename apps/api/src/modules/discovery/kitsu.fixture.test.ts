// Réponses Kitsu factices (forme réelle de l'API JSON:API), partagées par les tests unitaires et d'intégration.

export const TBATE_KITSU_ID = '41174';

type MangaOverrides = Partial<{
  id: string;
  titles: Record<string, string | null>;
  subtype: string;
  status: string;
  ageRating: string | null;
  averageRating: string | null;
  startDate: string | null;
  anilistId: string | null;
}>;

/** Une fiche manga et ses ressources embarquées (`included`) : catégories et correspondances. */
export function kitsuManga(overrides: MangaOverrides = {}) {
  const id = overrides.id ?? TBATE_KITSU_ID;
  const anilistId = overrides.anilistId === undefined ? '105398' : overrides.anilistId;
  const mappings = [
    { type: 'mappings', id: `${id}-mal`, attributes: { externalSite: 'myanimelist/manga', externalId: '126287' } },
    ...(anilistId ? [{ type: 'mappings', id: `${id}-al`, attributes: { externalSite: 'anilist/manga', externalId: anilistId } }] : []),
  ];
  const categories = [
    { type: 'categories', id: 'c-action', attributes: { title: 'Action' } },
    { type: 'categories', id: 'c-fantasy', attributes: { title: 'Fantasy' } },
    { type: 'categories', id: 'c-magic', attributes: { title: 'Magic' } },
    { type: 'categories', id: 'c-reincarnation', attributes: { title: 'Reincarnation' } },
  ];

  return {
    data: {
      id,
      type: 'manga',
      links: { self: `https://kitsu.app/api/edge/manga/${id}` },
      attributes: {
        slug: 'the-beginning-after-the-end',
        synopsis: '  King Grey has unrivaled strength, wealth, and prestige.  ',
        canonicalTitle: 'The Beginning After The End',
        titles: overrides.titles ?? { en: 'The Beginning After the End', en_kr: 'Kkeut-i Anin Sijak', ko_kr: '끝이 아닌 시작' },
        abbreviatedTitles: ['TBATE'],
        averageRating: overrides.averageRating === undefined ? '84.26' : overrides.averageRating,
        startDate: overrides.startDate === undefined ? '2018-07-17' : overrides.startDate,
        endDate: null,
        subtype: overrides.subtype ?? 'manhwa',
        status: overrides.status ?? 'current',
        ageRating: overrides.ageRating === undefined ? 'PG' : overrides.ageRating,
        chapterCount: null,
        posterImage: {
          tiny: `https://media.kitsu.app/manga/poster_images/${id}/tiny.jpg`,
          large: `https://media.kitsu.app/manga/poster_images/${id}/large.jpg`,
          original: `https://media.kitsu.app/manga/poster_images/${id}/original.jpg`,
        },
      },
      relationships: {
        categories: { data: categories.map(({ type, id: categoryId }) => ({ type, id: categoryId })) },
        mappings: { data: mappings.map(({ type, id: mappingId }) => ({ type, id: mappingId })) },
      },
    },
    included: [...categories, ...mappings],
  };
}

type KitsuFixture = ReturnType<typeof kitsuManga>;

export const kitsuSearchResponse = (items: KitsuFixture[]) =>
  Response.json(
    { data: items.map((item) => item.data), included: items.flatMap((item) => item.included), meta: { count: items.length } },
    { headers: { 'Content-Type': 'application/vnd.api+json' } },
  );

export const kitsuEntityResponse = (item: KitsuFixture | null) =>
  item
    ? Response.json(item, { headers: { 'Content-Type': 'application/vnd.api+json' } })
    : Response.json({ errors: [{ title: 'Record not found', status: '404' }] }, { status: 404 });
