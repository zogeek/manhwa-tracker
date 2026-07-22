import { Hono } from "hono";
import { SourceService } from "./source.service.js";
import { sourceControler } from "./source.controller.js";

const service = new SourceService();

const sourceRouter = new Hono();

sourceRouter.get("/", async (c) => {
  sourceControler.getAll(c):
})

export default sourceRouter;