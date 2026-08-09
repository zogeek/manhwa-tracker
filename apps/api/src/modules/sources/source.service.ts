import { SourceRepository } from "./source.repository.js";
import { NotFoundError } from "../../shared/lib/errors.js";
import type { Source } from "./source.schema.js";
import type {
  CreateSourceInput,
  UpdateSourceInput,
} from "./source.validator.js";

export class SourceService {
  private readonly repo: SourceRepository;

  constructor(repo?: SourceRepository) {
    this.repo = repo ?? new SourceRepository();
  }

  async getAll(): Promise<Source[]> {
    return this.repo.findAll();
  }

  /** Throw NotFoundError si non trouvée ou soft-deleted. */
  async getById(id: Source["id"]): Promise<Source> {
    const source = await this.repo.findById(id);
    if (!source || source.deletedAt) {
      throw new NotFoundError("Source", id);
    }
    return source;
  }

  async create(data: CreateSourceInput, userId?: string): Promise<Source> {
    return this.repo.insert({ ...data, createdBy: userId });
  }

  /** Vérifie l'existence avant de modifier. */
  async update(
    id: Source["id"],
    data: UpdateSourceInput,
    userId?: string,
  ): Promise<Source> {
    await this.getById(id);
    const updated = await this.repo.update(id, { ...data, updatedBy: userId });
    return updated!;
  }

  /** Vérifie l'existence avant de soft-delete. */
  async delete(id: Source["id"], userId?: string): Promise<void> {
    await this.getById(id);
    await this.repo.softDelete(id);
  }
}
