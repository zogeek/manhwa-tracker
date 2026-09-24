import { defineConfig } from 'vitest/config';

// Les assertions de types (`expectTypeOf`) des specs sont vérifiées par `pnpm typecheck` :
// les fichiers `*.spec.ts` sont inclus dans tsconfig.json.
export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.route.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.route.spec.ts'],
          // Postgres éphémère (testcontainers) ou TEST_DATABASE_URL (CI), migré une fois pour toute la suite.
          globalSetup: ['src/test/global-setup.ts'],
          // Une seule base partagée : les fichiers s'exécutent l'un après l'autre (seed rejoué par fichier).
          fileParallelism: false,
          hookTimeout: 120_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
