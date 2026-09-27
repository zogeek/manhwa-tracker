import { describe, expect, it } from 'vitest';
import { authorIdentity, mergeAuthors, parseAuthorRole, splitNativeName, type ExternalAuthor } from './external-catalog.js';

describe('parseAuthorRole (free-text roles from AniList)', () => {
  it.each([
    ['Story & Art', 'both'],
    ['Story', 'story'],
    ['Original Creator', 'story'],
    ['Story (Webtoon)', 'story'],
    ['Art', 'art'],
    ['Illustration', 'art'],
  ])('maps %j to %s', (role, expected) => {
    expect(parseAuthorRole(role)).toBe(expected);
  });

  it.each(['Translator (English)', 'Lettering', 'Art (assistant)', 'Editing', 'Character Design', null])(
    'ignores %j (not an author of the work)',
    (role) => {
      expect(parseAuthorRole(role)).toBeNull();
    },
  );
});

describe('splitNativeName (MangaDex « Latin (Native) » names)', () => {
  it('separates the romanized and the native name', () => {
    expect(splitNativeName('Chugong (추공)')).toEqual({ name: 'Chugong', nativeName: '추공' });
    expect(splitNativeName('REDICE Studio (레드아이스 스튜디오)')).toEqual({
      name: 'REDICE Studio',
      nativeName: '레드아이스 스튜디오',
    });
  });

  it('keeps a plain name as is', () => {
    expect(splitNativeName('  TurtleMe ')).toEqual({ name: 'TurtleMe', nativeName: null });
  });
});

// Graphies réellement observées pour Solo Leveling (AniList vs MangaDex, septembre 2026).
describe('authorIdentity — same person across catalogues', () => {
  it('uses the native name when known, whatever the romanization', () => {
    expect(authorIdentity({ name: 'Chu-Gong', nativeName: '추공' })).toBe(authorIdentity(splitNativeName('Chugong (추공)')));
    expect(authorIdentity({ name: 'Seong-Rak Jang', nativeName: '장성락' })).toBe(
      authorIdentity(splitNativeName('Jang Sung-Rak (장성락)')),
    );
  });

  it('otherwise ignores case, accents, hyphens and word order', () => {
    expect(authorIdentity({ name: 'So-Ryeong Gi', nativeName: null })).toBe(
      authorIdentity({ name: 'Gi So-Ryeong', nativeName: null }),
    );
    expect(authorIdentity({ name: 'Chu-Gong', nativeName: null })).toBe(authorIdentity({ name: 'chugong', nativeName: null }));
    expect(authorIdentity({ name: 'Chugong', nativeName: null })).not.toBe(authorIdentity({ name: 'Chu', nativeName: null }));
  });
});

describe('mergeAuthors', () => {
  it('merges the same person listed twice into a single "both" entry, keeping the first position', () => {
    expect(
      mergeAuthors([
        { name: 'Chugong', nativeName: '추공', role: 'story' },
        { name: 'Jang Sung-Rak', nativeName: null, role: 'art' },
        { name: 'Chu-Gong', nativeName: '추공', role: 'art' },
      ]),
    ).toEqual([
      { name: 'Chugong', nativeName: '추공', role: 'both' },
      { name: 'Jang Sung-Rak', nativeName: null, role: 'art' },
    ]);
  });

  it('drops empty names and caps the list', () => {
    const many: ExternalAuthor[] = Array.from({ length: 15 }, (_, index) => ({
      name: `Author ${index}`,
      nativeName: null,
      role: 'story',
    }));
    expect(mergeAuthors([{ name: '  ', nativeName: null, role: 'art' }, ...many])).toHaveLength(10);
  });
});
