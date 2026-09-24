import { NotFoundError } from '../../shared/lib/errors.js';
import type { GenreRepository } from './genre.repository.js';
import type { Genre } from './genre.schema.js';
import type { CreateGenreInput, UpdateGenreInput } from './genre.validator.js';

// L'unicité du slug est garantie par l'index `genres_slug_idx` : une violation remonte en 409 via le handler global.
export class GenreService {
  constructor(private readonly repo: GenreRepository) {}

  async getAll(): Promise<Genre[]> {
    return this.repo.findAll();
  }

  async getById(id: Genre['id']): Promise<Genre> {
    const genre = await this.repo.findById(id);
    if (!genre) throw new NotFoundError('Genre', id);
    return genre;
  }

  async create(data: CreateGenreInput): Promise<Genre> {
    return this.repo.insert(data);
  }

  async update(id: Genre['id'], data: UpdateGenreInput): Promise<Genre> {
    const updated = await this.repo.update(id, data);
    if (!updated) throw new NotFoundError('Genre', id);
    return updated;
  }

  async delete(id: Genre['id']): Promise<void> {
    const removed = await this.repo.remove(id);
    if (!removed) throw new NotFoundError('Genre', id);
  }
}
