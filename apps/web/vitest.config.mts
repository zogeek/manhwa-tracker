import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tests de composants (Testing Library) dans un DOM simulé (jsdom). Les parcours complets
// front + API relèvent de Playwright (`e2e/*.e2e.ts`, `pnpm test:e2e`), cf. la matrice de tests du CLAUDE.md.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Même alias que tsconfig.json (`@/*` → racine de l'app).
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.spec.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", ".next-e2e/**", "e2e/**"],
    restoreMocks: true,
  },
});
