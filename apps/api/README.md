# API — Hono + Drizzle

## Démarrage

```sh
cp .env.example .env.development   # puis ajuster DATABASE_URL
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
| `test` / `test:watch` | Vitest (`src/**/*.spec.ts`) |
| `db:generate` | Génère une migration SQL dans `drizzle/` à partir de `src/shared/db/schema.ts` |
| `db:migrate` / `db:migrate:prod` | Applique les migrations |
| `db:push` | Synchronise le schéma sans migration — **dev uniquement** |
| `db:studio` | Drizzle Studio |

## Architecture

- `src/container.ts` — composition root : instancie repositories Drizzle → services.
- `src/app.ts` — `createApp({ services })` : middlewares, handler d'erreurs global, montage des routes. Exporte `AppType` (Hono RPC).
- `src/modules/<module>/` — `schema`, `validator`, `repository` (interface + implémentation Drizzle), `service`, `route` (handlers inline chaînés, `createXRoutes(service)`).

## Conventions HTTP

- Succès : `{ "data": ... }` — `DELETE` renvoie `204` sans body.
- Erreur : `{ "error": { "code", "message", "details?" } }` — produit uniquement par le handler global (`shared/http/error-handler.ts`).
- Les violations de contraintes Postgres sont traduites : unique → `409 CONFLICT`, FK → `422 UNPROCESSABLE_ENTITY`, check/format → `400 BAD_REQUEST`.
