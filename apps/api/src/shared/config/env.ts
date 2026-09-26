import { z } from 'zod';
import { EXTERNAL_PROVIDERS } from '../../modules/discovery/external-catalog.js';

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
  /** Catalogues externes activés pour la recherche et l'import, par ordre de priorité. */
  DISCOVERY_PROVIDERS: commaSeparated('anilist,mangadex,kitsu').pipe(z.array(z.enum(EXTERNAL_PROVIDERS))),
  /** Endpoint GraphQL d'AniList (catalogue externe de la recherche et de l'import). */
  ANILIST_API_URL: z.url({ protocol: /^https$/ }).default('https://graphql.anilist.co'),
  /** API REST de MangaDex (catalogue + flux de chapitres). */
  MANGADEX_API_URL: z.url({ protocol: /^https$/ }).default('https://api.mangadex.org'),
  /** API JSON:API de Kitsu (catalogue). */
  KITSU_API_URL: z.url({ protocol: /^https$/ }).default('https://kitsu.app/api/edge'),
  /** Langues des chapitres synchronisés depuis MangaDex (codes MangaDex). */
  MANGADEX_CHAPTER_LANGUAGES: commaSeparated('fr,en').pipe(
    z.array(z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/, 'Code de langue MangaDex attendu (ex. fr, pt-br)')).min(1),
  ),
  /** Répertoire des médias copiés localement (couvertures miroir). */
  MEDIA_STORAGE_DIR: z.string().min(1).default('./storage/media'),
  /** Worker de tâches de fond intégré à l'API (désactivable si un process dédié s'en charge). */
  JOBS_WORKER_ENABLED: z.stringbool().default(true),
  JOBS_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
  JOBS_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  /** Domaines d'images autorisés par `/images/proxy` (sous-domaines inclus). */
  IMAGE_PROXY_ALLOWED_HOSTS: commaSeparated('anilist.co,mangadex.org,kitsu.app,kitsu.io'),
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
