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
| `typecheck` | `tsc --noEmit` (src + drizzle.config.ts) |
| `db:generate` | Génère une migration SQL dans `drizzle/` à partir de `src/shared/db/schema.ts` |
| `db:migrate` / `db:migrate:prod` | Applique les migrations |
| `db:push` | Synchronise le schéma sans migration — **dev uniquement** |
| `db:studio` | Drizzle Studio |

## Conventions HTTP

- Succès : `{ "data": ... }` — `DELETE` renvoie `204` sans body.
- Erreur : `{ "error": { "code", "message", "details?" } }` — produit uniquement par le handler global (`shared/http/error-handler.ts`).
- Les violations de contraintes Postgres sont traduites : unique → `409 CONFLICT`, FK → `422 UNPROCESSABLE_ENTITY`, check/format → `400 BAD_REQUEST`.
