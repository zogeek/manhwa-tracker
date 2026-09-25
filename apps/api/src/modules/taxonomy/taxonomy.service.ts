import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../shared/lib/errors.js';
import type { TaxonomyRepository } from './taxonomy.repository.js';
import type { ManhwaTag, ManhwaTerm, Term, Vocabulary } from './taxonomy.schema.js';
import type {
  CreateTermInput,
  CreateVocabularyInput,
  TagManhwaInput,
  UpdateTermInput,
} from './taxonomy.validator.js';

/**
 * Invariants de l'arbre des termes :
 * - un parent appartient au même vocabulaire, qui doit être hiérarchique ;
 * - aucun cycle (un terme ne peut pas devenir le descendant de lui-même) ;
 * - on ne supprime pas un terme qui a encore des enfants.
 */
export class TaxonomyService {
  constructor(private readonly repo: TaxonomyRepository) {}

  async getVocabularies(): Promise<Vocabulary[]> {
    return this.repo.findVocabularies();
  }

  async createVocabulary(data: CreateVocabularyInput): Promise<Vocabulary> {
    return this.repo.insertVocabulary(data);
  }

  async getTerms(vocabularySlug: string): Promise<Term[]> {
    const vocabulary = await this.repo.findVocabularyBySlug(vocabularySlug);
    if (!vocabulary) throw new NotFoundError('Vocabulary', vocabularySlug);
    return this.repo.findTermsByVocabulary(vocabulary.id);
  }

  async createTerm(data: CreateTermInput): Promise<Term> {
    const vocabulary = await this.repo.findVocabularyById(data.vocabularyId);
    if (!vocabulary) throw new UnprocessableEntityError('Vocabulary does not exist');
    if (data.parentId) await this.assertValidParent(vocabulary, data.parentId);
    return this.repo.insertTerm(data);
  }

  async updateTerm(id: string, data: UpdateTermInput): Promise<Term> {
    const term = await this.getTerm(id);

    if (data.parentId) {
      const vocabulary = await this.repo.findVocabularyById(term.vocabularyId);
      if (!vocabulary) throw new NotFoundError('Vocabulary', term.vocabularyId);
      await this.assertValidParent(vocabulary, data.parentId);

      // Cycle : le nouveau parent ne doit être ni le terme lui-même, ni l'un de ses descendants.
      const parentAncestors = await this.repo.findAncestorIds(data.parentId);
      if (data.parentId === id || parentAncestors.includes(id)) {
        throw new ConflictError('A term cannot be moved under itself or one of its descendants');
      }
    }

    const updated = await this.repo.updateTerm(id, data);
    if (!updated) throw new NotFoundError('Term', id);
    return updated;
  }

  async deleteTerm(id: string): Promise<void> {
    await this.getTerm(id);
    if (await this.repo.hasChildren(id)) {
      throw new ConflictError('Delete or move the child terms first');
    }
    await this.repo.deleteTerm(id);
  }

  async getManhwaTags(manhwaId: string): Promise<ManhwaTag[]> {
    return this.repo.findManhwaTags(manhwaId);
  }

  async tagManhwa(manhwaId: string, termId: string, data: TagManhwaInput): Promise<ManhwaTerm> {
    return this.repo.upsertManhwaTerm({ manhwaId, termId, ...data, source: 'curated' });
  }

  async untagManhwa(manhwaId: string, termId: string): Promise<void> {
    const removed = await this.repo.deleteManhwaTerm(manhwaId, termId);
    if (!removed) throw new NotFoundError('ManhwaTerm', termId);
  }

  private async getTerm(id: string): Promise<Term> {
    const term = await this.repo.findTermById(id);
    if (!term) throw new NotFoundError('Term', id);
    return term;
  }

  private async assertValidParent(vocabulary: Vocabulary, parentId: string): Promise<void> {
    if (!vocabulary.isHierarchical) {
      throw new UnprocessableEntityError(`Vocabulary "${vocabulary.slug}" is flat: terms cannot have a parent`);
    }
    const parent = await this.repo.findTermById(parentId);
    if (!parent) throw new UnprocessableEntityError('Parent term does not exist');
    if (parent.vocabularyId !== vocabulary.id) {
      throw new UnprocessableEntityError('Parent term belongs to another vocabulary');
    }
  }
}
