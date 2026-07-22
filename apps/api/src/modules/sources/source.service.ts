import { error } from "console";
import { SourceRepository } from "./source.repository.js";
import { type Source } from "./source.schema.js";

export class SourceService {
    private repo: SourceRepository;

    constructor(repo?: SourceRepository) {
        this.repo = repo ?? new SourceRepository();
    }

    async getById(id : Source['id']) {
        const result = await this.repo.findById(id)
        if(!result) {
            throw new error("Aucun resultat trouvé")
        }

    }

    async getAll() {
        return await this.repo.findAll();
    }
}