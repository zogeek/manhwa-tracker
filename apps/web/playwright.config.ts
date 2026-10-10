import { defineConfig, devices } from "@playwright/test";

// Parcours E2E : navigateur réel → Next.js (build de prod) → API Hono → Postgres de test.
// Cf. la matrice de tests du CLAUDE.md. Fichiers `e2e/*.e2e.ts` : un suffixe distinct des
// `*.spec.ts(x)` de Vitest, pour que les deux lanceurs ne ramassent jamais les tests de l'autre.
//
// Prérequis : un Postgres JETABLE (jamais la base de dev, les migrations y sont appliquées), ex. :
//   docker run -d --rm --name manhwa-e2e -p 5439:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=manhwa_e2e postgres:16-alpine

const isCI = Boolean(process.env.CI);
// Ports dédiés : ne heurtent pas un `pnpm dev` déjà lancé (3000 / 3001).
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.E2E_API_PORT ?? 3101);
const baseURL = `http://localhost:${webPort}`;
const apiURL = `http://localhost:${apiPort}`;
const databaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5439/manhwa_e2e";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "fr-FR",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "api",
      // Migrations sur la base de test, puis l'API sans fichier .env (configuration 100 % explicite).
      command: "pnpm --filter api db:migrate && pnpm --filter api exec node --import tsx src/index.ts",
      url: `${apiURL}/health`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        PORT: String(apiPort),
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: "e2e-tests-secret-0123456789abcdef0123456789",
        BETTER_AUTH_URL: baseURL,
        CORS_ORIGINS: baseURL,
        SCRAPER_API_KEY: "e2e-tests-scraper-key-0123456789abcdef0123456789",
        MEDIA_STORAGE_DIR: "./storage/e2e-media",
        // Aucun appel sortant attendu : pas de tâches de fond pendant les parcours.
        JOBS_WORKER_ENABLED: "false",
      },
    },
    {
      name: "web",
      // Build de prod dans `.next-e2e` : les rewrites y visent l'API de test et ne remplacent
      // jamais le build `.next` de dev/prod. (`next dev` refuse en outre une 2e instance.)
      command: `pnpm build && pnpm start --port ${webPort}`,
      url: `${baseURL}/login`,
      reuseExistingServer: !isCI,
      timeout: 240_000,
      env: { API_INTERNAL_URL: apiURL, NEXT_DIST_DIR: ".next-e2e" },
    },
  ],
});
