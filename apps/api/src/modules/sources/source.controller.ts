import { SourceService } from "./source.service.js";

export class sourceControler {
    private service : SourceService

    constructor( service ?: SourceService){
        this.service = service ?? new SourceService();
    }

    async getAll(c : ) {
        const result = this.service.getAll();
        return c.json(result):
    }
}