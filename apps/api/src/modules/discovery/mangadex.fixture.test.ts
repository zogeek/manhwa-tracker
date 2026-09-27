import { createHash } from 'node:crypto';

// Réponses MangaDex factices (forme réelle de l'API REST), partagées par les tests unitaires et d'intégration.

export const TBATE_MANGADEX_ID = 'a1c7c817-4e59-43b7-9365-09675a149a6f';
export const TBATE_ANILIST_ID = '105398';

type MangaOverrides = Partial<{
  id: string;
  title: Record<string, string>;
  originalLanguage: string;
  status: string;
  lastChapter: string | null;
  contentRating: string;
  links: Record<string, string> | never[] | null;
  description: Record<string, string> | never[];
}>;

export function mangaDexManga(overrides: MangaOverrides = {}) {
  const id = overrides.id ?? TBATE_MANGADEX_ID;
  return {
    id,
    type: 'manga',
    attributes: {
      title: overrides.title ?? { en: 'The Beginning After the End' },
      altTitles: [{ ko: '끝이 아닌 시작' }, { 'ko-ro': 'Kkeut-i Anin Sijak' }, { en: 'TBATE' }, { fr: 'Le Commencement après la fin' }],
      description: overrides.description ?? {
        en: 'King Grey has **unrivaled** strength.\r\n\r\n---\r\n[Official](https://tapas.io/series/tbate-comic)',
      },
      isLocked: false,
      links: overrides.links === undefined ? { al: TBATE_ANILIST_ID, mal: '126287', raw: 'https://page.kakao.com' } : overrides.links,
      originalLanguage: overrides.originalLanguage ?? 'ko',
      lastVolume: '',
      lastChapter: overrides.lastChapter === undefined ? '175' : overrides.lastChapter,
      publicationDemographic: null,
      status: overrides.status ?? 'completed',
      year: 2018,
      contentRating: overrides.contentRating ?? 'safe',
      tags: [
        { id: 't1', type: 'tag', attributes: { name: { en: 'Action' }, group: 'genre' } },
        { id: 't2', type: 'tag', attributes: { name: { en: 'Fantasy' }, group: 'genre' } },
        { id: 't3', type: 'tag', attributes: { name: { en: 'Reincarnation' }, group: 'theme' } },
        { id: 't4', type: 'tag', attributes: { name: { en: 'Magic' }, group: 'theme' } },
        { id: 't5', type: 'tag', attributes: { name: { en: 'Long Strip' }, group: 'format' } },
      ],
    },
    relationships: [
      { id: 'author-1', type: 'author', attributes: { name: 'Turtle-Me (터틀미)' } },
      { id: 'artist-1', type: 'artist', attributes: { name: 'Fuyuki23' } },
      { id: 'author-2', type: 'author', attributes: { name: 'Studio Waveon' } },
      { id: 'artist-2', type: 'artist', attributes: { name: 'Studio Waveon' } },
      { id: 'cover-1', type: 'cover_art', attributes: { fileName: 'b1461071-cover.jpg', volume: null } },
    ],
  };
}

/** Team telle que MangaDex l'embarque avec `includes[]=scanlation_group` (sans `name` : groupe supprimé). */
export type MangaDexGroupFixture = { name?: string; website?: string | null };

/** UUID stable par nom de team : le même groupe garde le même identifiant d'un chapitre à l'autre. */
export const mangaDexGroupId = (name: string) =>
  `00000000-0000-4000-9000-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;

type ChapterOverrides = Partial<{
  chapter: string | null;
  title: string | null;
  translatedLanguage: string;
  /** Raccourci : une seule team, par son nom (`null` : chapitre sans team créditée). */
  group: string | null;
  /** Plusieurs teams (collaboration), dans l'ordre de crédit. */
  groups: MangaDexGroupFixture[];
  publishAt: string;
}>;

let chapterSequence = 0;

export function mangaDexChapter(overrides: ChapterOverrides = {}) {
  chapterSequence += 1;
  const group = overrides.group === undefined ? 'Tapas Official' : overrides.group;
  const groups = overrides.groups ?? (group ? [{ name: group }] : []);
  return {
    id: `00000000-0000-4000-8000-${String(chapterSequence).padStart(12, '0')}`,
    type: 'chapter',
    attributes: {
      volume: null,
      chapter: overrides.chapter === undefined ? '1' : overrides.chapter,
      title: overrides.title === undefined ? 'Prologue' : overrides.title,
      translatedLanguage: overrides.translatedLanguage ?? 'en',
      externalUrl: null,
      publishAt: overrides.publishAt ?? '2021-03-05T14:57:57+00:00',
      pages: 42,
      version: 1,
    },
    relationships: [
      ...groups.map(({ name, website }) =>
        name
          ? { id: mangaDexGroupId(name), type: 'scanlation_group', attributes: { name, website: website ?? null, locked: false } }
          : { id: '00000000-0000-4000-9000-00000000dead', type: 'scanlation_group' },
      ),
      { id: 'user-1', type: 'user' },
    ],
  };
}

export const mangaDexSearchResponse = (data: ReturnType<typeof mangaDexManga>[]) =>
  Response.json({ result: 'ok', response: 'collection', data, limit: 10, offset: 0, total: data.length });

export const mangaDexEntityResponse = (manga: ReturnType<typeof mangaDexManga> | null) =>
  manga
    ? Response.json({ result: 'ok', response: 'entity', data: manga })
    : Response.json({ result: 'error', errors: [{ status: 404, title: 'Not found' }] }, { status: 404 });

export const mangaDexFeedResponse = (data: ReturnType<typeof mangaDexChapter>[], offset = 0, total = data.length) =>
  Response.json({ result: 'ok', response: 'collection', data, limit: 500, offset, total });
