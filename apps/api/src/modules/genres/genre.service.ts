import { NotFoundError, ConflictError } from '../../shared/lib/errors.js';
import { GenreRepository } from './genre.repository.js';
import type { Genre } from './genre.schema.js';
import type { CreateGenreInput, UpdateGenreInput } from './genre.validator.js';

export class GenreService {
  constructor(private readonly genreRepository: GenreRepository) {}

  async getAll(): Promise<Genre[]> {
    return this.genreRepository.findAll();
  }

  async getById(id: string): Promise<Genre> {
    const genre = await this.genreRepository.findById(id);
    if (!genre) {
      throw new NotFoundError('Genre', id);
    }
    return genre;
  }

  async create(data: CreateGenreInput): Promise<Genre> {
    const existing = await this.genreRepository.findBySlug(data.slug);
    if (existing) {
      throw new ConflictError('Genre with this slug already exists');
    }
    return this.genreRepository.insert(data);
  }

  async update(id: string, data: UpdateGenreInput): Promise<Genre> {
    const genre = await this.genreRepository.findById(id);
    if (!genre) {
      throw new NotFoundError('Genre', id);
    }

    if (data.slug && data.slug !== genre.slug) {
      const existing = await this.genreRepository.findBySlug(data.slug);
      if (existing) {
        throw new ConflictError('Genre with this slug already exists');
      }
    }

    return this.genreRepository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    const genre = await this.genreRepository.findById(id);
    if (!genre) {
      throw new NotFoundError('Genre', id);
    }
    await this.genreRepository.remove(id);
  }
}
