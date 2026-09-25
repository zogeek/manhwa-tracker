# API — Hono + Drizzle

## Démarrage

```sh
cp .env.example .env.development   # puis ajuster DATABASE_URL, BETTER_AUTH_SECRET et SCRAPER_API_KEY
docker compose up -d               # depuis la racine du repo (Postgres sur :5431)
pnpm db:migrate
pnpm dev                           # http://localhost:3001
```

## Scripts

| Script | Rôle |
|---|---|
| `dev` | Serveur en watch (`.env.development`) |
| `build` / `start` | Compile dans `dist/` puis lance `dist/index.js` (`.env.production` si présent) |
| `typecheck` | `tsc --noEmit` (src, specs et configs — vérifie aussi les assertions `expectTypeOf`) |
| `test` / `test:watch` | Vitest : projets `unit` + `integration` |
| `test:unit` | Specs sans DB (`*.spec.ts` hors `*.route.spec.ts`) |
| `test:integration` | `*.route.spec.ts` sur un Postgres éphémère (Docker requis) ou `TEST_DATABASE_URL` |
| `admin:promote <email>` | Donne le rôle `admin` à un utilisateur existant (bootstrap du premier admin) |
| `auth:generate` | Régénère `src/shared/db/auth-schema.ts` via le CLI Better Auth (ne jamais l'éditer à la main) |
| `db:generate` | Génère une migration SQL dans `drizzle/` à partir de `src/shared/db/schema.ts` |
| `db:migrate` / `db:migrate:prod` | Applique les migrations |
| `db:push` | Synchronise le schéma sans migration — **dev uniquement** |
| `db:studio` | Drizzle Studio |

## Architecture

- `src/container.ts` — composition root : instancie repositories Drizzle → services.
- `src/app.ts` — `createApp({ services })` : middlewares, handler d'erreurs global, montage des routes. Exporte `AppType` (Hono RPC).
- `src/modules/<module>/` — `schema`, `validator`, `repository` (interface + implémentation Drizzle), `service`, `route` (handlers inline chaînés, `createXRoutes(service)`).

## Authentification

- Better Auth est configuré dans `src/shared/auth/index.ts` et monté sur `/api/auth/*`.
- `requireAuth` (`src/shared/middleware/auth.middleware.ts`) protège toutes les routes `/reading/*` ; l'identité vient exclusivement de la session.
- `requireAdmin` (session + rôle `admin`, plugin admin de Better Auth) protège toutes les mutations du catalogue (sources, manhwas, chapters, genres) : `401` sans session, `403` sans le rôle.
- Premier admin : s'inscrire, puis `pnpm --filter api admin:promote <email>`. Les admins gèrent ensuite les rôles via `/api/auth/admin/*`.
- Les listes de lecture vérifient la propriété : `403 FORBIDDEN` si la liste appartient à un autre utilisateur.

## Conventions HTTP

- Succès : `{ "data": ... }` — `DELETE` renvoie `204` sans body.
- Erreur : `{ "error": { "code", "message", "details?" } }` — produit uniquement par le handler global (`shared/http/error-handler.ts`).
- Les violations de contraintes Postgres sont traduites : unique → `409 CONFLICT`, FK → `422 UNPROCESSABLE_ENTITY`, check/format → `400 BAD_REQUEST`.

## API d'ingestion (worker de scraping, machine-à-machine)

Montée sur `/api/ingest/*`, **hors du contrat RPC du front** (`AppType`). Authentification par clé :
header `x-api-key` = `SCRAPER_API_KEY` (comparaison en temps constant). Aucune session Better Auth n'y donne accès.
Le worker appelle l'API directement (`http://<api>:3001/api/ingest/...`), jamais via le proxy Next.js.

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/ingest/runs` | Démarre une exécution `{ sourceId, workerVersion? }` → `201 { data: run }` |
| `PATCH` | `/api/ingest/runs/:id` | Clôture `{ status: succeeded\|partial\|failed, stats?, error? }` — `409` si déjà terminée |
| `POST` | `/api/ingest/health` | Échantillons de santé `{ samples: [{ sourceId, status, httpStatus?, latencyMs?, blockedBy? }] }` |
| `POST` | `/api/ingest/batches` | Lot de mises à jour (voir ci-dessous) — header `Idempotency-Key` obligatoire |

### Lots (`POST /api/ingest/batches`)

```http
POST /api/ingest/batches
x-api-key: <SCRAPER_API_KEY>
Idempotency-Key: 8f1c…            # unique par lot, réutilisée telle quelle en cas de retry
Content-Type: application/json

{
  "sourceId": "<uuid>", "scrapeRunId": "<uuid, optionnel>",
  "manhwas": [{
    "sourceManhwaUrl": "https://asura.example/series/solo-leveling",
    "manhwaId": "<uuid, optionnel>",
    "title": "Solo Leveling", "synopsis": "…", "coverUrl": "https://…", "status": "ongoing", "totalChapters": 200,
    "chapters": [{ "number": 42.5, "url": "https://…/42-5", "language": "fr", "scanlationGroup": "Asura Team",
                   "publishedAt": "2026-09-01T12:00:00+02:00" }]
  }]
}
```

- **Idempotence** : même clé + même contenu → `200` + header `Idempotent-Replayed: true`, résultat d'origine, rien n'est réécrit.
  Même clé + contenu différent → `409`. En cas d'erreur, tout le lot est annulé et la clé reste réutilisable.
- **Rapprochement** : URL déjà connue sur la source → fiche liée ; sinon `manhwaId` fourni ; sinon création d'une fiche.
- **Non destructif** : synopsis / couverture / titre original ne sont remplis que s'ils sont vides ;
  `totalChapters` et `latestChapter` ne reculent jamais.
- **Chapitres** : un chapitre canonique par `(manhwa, numéro)`, une parution (`chapter_releases`) par `(source, url)`.
- Limites : 100 œuvres par lot, 2 000 chapitres par œuvre, 5 Mo par requête (`413` au-delà).
