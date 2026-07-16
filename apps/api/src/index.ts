import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "./shared/db/index.ts";
import { manhwas } from "./shared/db/schema.ts";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import manhwaRouteur from "./routes/manhwa/index.ts";

const app = new Hono();

app.use(
    "*",
    cors({
        origin: "http://localhost:3000",
        credentials: true,
    }),
);

const createManhwaSchema = z.object({
    title: z.string(),
    currentChapterRead: z.number().default(0),
    latestChapterAvailable: z.number().default(0),
});

const updateManhwaSchema = z.object({
    currentChapterRead: z.number(),
});

const routes = app
    .get("/", (c) => {
        return c.text("Hello Hono!");
    })
    .get("/health", (c) => {
        return c.json({ status: "OK" });
    })
    .route("/manhwa", manhwaRouteur)

serve(
    {
        fetch: app.fetch,
        port: 3001,
    },
    (info) => {
        console.log(`Server is running on http://localhost:${info.port}`);
    },
);

export type AppType = typeof routes;
