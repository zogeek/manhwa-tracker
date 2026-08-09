import { NotFoundError } from "../../shared/lib/errors.js";
import { ManhwaRepository } from "./manhwa.repository.js";
import type { Manhwa } from "./manhwa.schema.js";
import type { CreateManhwaInput, UpdateManhwaInput } from "./manhwa.validator.js";

export class ManhwaService {
  private readonly repo: ManhwaRepository;

  constructor(repo?: ManhwaRepository) {
    this.repo = repo ?? new ManhwaRepository();
  }

  async getAll(): Promise<Manhwa[]> {
    return this.repo.findAll();
  }

  async getById(id: Manhwa["id"]): Promise<Manhwa> {
    const manhwa = await this.repo.findById(id);
    if (!manhwa || manhwa.deletedAt) {
      throw new NotFoundError("Manhwa", id);
    }
    return manhwa;
  }

  async create(data : CreateManhwaInput, userId? : string) : Promise<Manhwa> {
    return this.repo.insert({...data, createdBy : userId});
  }

  async update(
    id: Manhwa["id"],
    data: UpdateManhwaInput,
    userId?: string,
  ): Promise<Manhwa> {
    await this.getById(id);
    const updated = await this.repo.update(id, { ...data, updatedBy: userId });
    return updated!;
  }

  async delete(id: Manhwa["id"], userId?: string): Promise<void> {
    await this.getById(id);
    await this.repo.softDelete(id);
  }
}
