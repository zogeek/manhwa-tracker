import { z } from 'zod';

/** Liste séparée par des virgules (`a, b,c`) → tableau sans entrées vides. */
const commaSeparated = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Clé de signature des sessions Better Auth (`openssl rand -base64 32`). */
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  /** URL publique par laquelle le navigateur atteint l'API (via le proxy Next.js en dev/prod). */
  BETTER_AUTH_URL: z.url(),
  /** Clé d'API du worker de scraping (header `x-api-key`) : `openssl rand -hex 32`. */
  SCRAPER_API_KEY: z.string().min(32, 'SCRAPER_API_KEY must be at least 32 characters'),
  CORS_ORIGINS: commaSeparated('http://localhost:3000'),
  /** Endpoint GraphQL d'AniList (catalogue externe de la recherche et de l'import). */
  ANILIST_API_URL: z.url({ protocol: /^https$/ }).default('https://graphql.anilist.co'),
});

export type Env = z.infer<typeof envSchema>;

/** Valide `process.env` au démarrage : l'app refuse de booter avec une config invalide. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
