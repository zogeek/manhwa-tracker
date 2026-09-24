import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../shared/lib/errors.js';
import type { TaxonomyRepository } from './taxonomy.repository.js';
import type {
  ManhwaTag,
  ManhwaTerm,
  NewManhwaTerm,
  NewTerm,
  NewVocabulary,
  Term,
  Vocabulary,
} from './taxonomy.schema.js';
import { TaxonomyService } from './taxonomy.service.js';

class InMemoryTaxonomyRepository implements TaxonomyRepository {
  readonly vocabularies = new Map<string, Vocabulary>();
  readonly terms = new Map<string, Term>();
  readonly tags: ManhwaTerm[] = [];

  async findVocabularies(): Promise<Vocabulary[]> {
    return [...this.vocabularies.values()];
  }

  async findVocabularyById(id: string): Promise<Vocabulary | null> {
    return this.vocabularies.get(id) ?? null;
  }

  async findVocabularyBySlug(slug: string): Promise<Vocabulary | null> {
    return [...this.vocabularies.values()].find((vocabulary) => vocabulary.slug === slug) ?? null;
  }

  async insertVocabulary(data: NewVocabulary): Promise<Vocabulary> {
    const now = new Date();
    const vocabulary: Vocabulary = {
      id: randomUUID(),
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      isHierarchical: data.isHierarchical ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.vocabularies.set(vocabulary.id, vocabulary);
    return vocabulary;
  }

  async findTermsByVocabulary(vocabularyId: string): Promise<Term[]> {
    return [...this.terms.values()].filter((term) => term.vocabularyId === vocabularyId);
  }

  async findTermById(id: string): Promise<Term | null> {
    return this.terms.get(id) ?? null;
  }

  async findAncestorIds(termId: string): Promise<string[]> {
    const ancestors: string[] = [];
    let current = this.terms.get(termId)?.parentId ?? null;
    while (current && !ancestors.includes(current)) {
      ancestors.push(current);
      current = this.terms.get(current)?.parentId ?? null;
    }
    return ancestors;
  }

  async hasChildren(termId: string): Promise<boolean> {
    return [...this.terms.values()].some((term) => term.parentId === termId);
  }

  async insertTerm(data: NewTerm): Promise<Term> {
    const now = new Date();
    const term: Term = {
      id: data.id ?? randomUUID(),
      vocabularyId: data.vocabularyId,
      parentId: data.parentId ?? null,
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      color: data.color ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.terms.set(term.id, term);
    return term;
  }

  async updateTerm(id: string, data: Partial<NewTerm>): Promise<Term | null> {
    const term = this.terms.get(id);
    if (!term) return null;
    const updated: Term = { ...term, ...data, id, updatedAt: new Date() };
    this.terms.set(id, updated);
    return updated;
  }

  async deleteTerm(id: string): Promise<Term | null> {
    const term = this.terms.get(id) ?? null;
    this.terms.delete(id);
    return term;
  }

  async findManhwaTags(): Promise<ManhwaTag[]> {
    return [];
  }

  async upsertManhwaTerm(data: NewManhwaTerm): Promise<ManhwaTerm> {
    const tag: ManhwaTerm = {
      manhwaId: data.manhwaId,
      termId: data.termId,
      relevance: data.relevance ?? 100,
      isSpoiler: data.isSpoiler ?? false,
      source: data.source ?? 'curated',
      createdAt: new Date(),
    };
    this.tags.push(tag);
    return tag;
  }

  async deleteManhwaTerm(): Promise<ManhwaTerm | null> {
    return null;
  }
}

describe('TaxonomyService (tree invariants)', () => {
  let repo: InMemoryTaxonomyRepository;
  let service: TaxonomyService;
  let genres: Vocabulary;
  let themes: Vocabulary;
  let action: Term;
  let martialArts: Term;
  let murim: Term;

  beforeEach(async () => {
    repo = new InMemoryTaxonomyRepository();
    service = new TaxonomyService(repo);
    genres = await service.createVocabulary({ slug: 'genre', name: 'Genres', isHierarchical: true });
    themes = await service.createVocabulary({ slug: 'theme', name: 'Thèmes' });
    // Action > Martial arts > Murim
    action = await service.createTerm({ vocabularyId: genres.id, slug: 'action', name: 'Action' });
    martialArts = await service.createTerm({
      vocabularyId: genres.id,
      parentId: action.id,
      slug: 'martial-arts',
      name: 'Martial arts',
    });
    murim = await service.createTerm({ vocabularyId: genres.id, parentId: martialArts.id, slug: 'murim', name: 'Murim' });
  });

  it('refuses to move a term under one of its descendants (cycle)', async () => {
    await expect(service.updateTerm(action.id, { parentId: murim.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(service.updateTerm(action.id, { parentId: action.id })).rejects.toBeInstanceOf(ConflictError);

    expect(repo.terms.get(action.id)?.parentId).toBeNull();
  });

  it('allows moving a term to another branch', async () => {
    const fantasy = await service.createTerm({ vocabularyId: genres.id, slug: 'fantasy', name: 'Fantasy' });

    const moved = await service.updateTerm(murim.id, { parentId: fantasy.id });

    expect(moved.parentId).toBe(fantasy.id);
  });

  it('refuses a parent from another vocabulary', async () => {
    const theme = await service.createTerm({ vocabularyId: themes.id, slug: 'revenge', name: 'Revenge' });

    await expect(service.updateTerm(murim.id, { parentId: theme.id })).rejects.toBeInstanceOf(
      UnprocessableEntityError,
    );
  });

  it('refuses a parent in a flat vocabulary', async () => {
    const revenge = await service.createTerm({ vocabularyId: themes.id, slug: 'revenge', name: 'Revenge' });

    await expect(
      service.createTerm({ vocabularyId: themes.id, parentId: revenge.id, slug: 'vendetta', name: 'Vendetta' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
  });

  it('refuses to delete a term that still has children, then allows it once they are gone', async () => {
    await expect(service.deleteTerm(martialArts.id)).rejects.toBeInstanceOf(ConflictError);

    await service.deleteTerm(murim.id);
    await service.deleteTerm(martialArts.id);

    expect(repo.terms.has(martialArts.id)).toBe(false);
  });

  it('answers NotFound for an unknown vocabulary or term', async () => {
    await expect(service.getTerms('unknown')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.deleteTerm(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
