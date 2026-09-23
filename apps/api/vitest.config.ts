import { defineConfig } from 'vitest/config';

// Les assertions de types (`expectTypeOf`) des specs sont vérifiées par `pnpm typecheck` :
// les fichiers `*.spec.ts` sont inclus dans tsconfig.json.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
  },
});
