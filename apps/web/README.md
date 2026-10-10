# web — interface Manhwa Tracker

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · shadcn/ui (style `radix-nova`) · Better Auth.

## Démarrer

```bash
cp .env.example .env.local   # API_INTERNAL_URL (défaut : http://localhost:3001)
pnpm --filter api dev        # backend Hono sur :3001
pnpm --filter web dev        # front sur :3000
```

| Commande | Rôle |
|---|---|
| `pnpm --filter web typecheck` | TypeScript strict |
| `pnpm --filter web lint` | ESLint (config Next) |
| `pnpm --filter web test` | Vitest + Testing Library (jsdom), fichiers `*.spec.ts(x)` |
| `pnpm --filter web test:e2e` | Playwright (Chromium), parcours `e2e/*.e2e.ts` sur la pile complète |
| `pnpm --filter web build` | Build de production |

## Tests E2E (Playwright)

Navigateur réel → Next.js (build de prod) → API Hono → Postgres. `playwright.config.ts` démarre
lui-même l'API (port 3101, migrations appliquées au démarrage) et le front (port 3100) : aucun
conflit avec un `pnpm dev` en cours sur 3000/3001.

```bash
# Postgres JETABLE (jamais la base de dev : les migrations y sont appliquées)
docker run -d --rm --name manhwa-e2e -p 5439:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=manhwa_e2e postgres:16-alpine
pnpm --filter web exec playwright install chromium   # une seule fois
pnpm --filter web test:e2e
docker stop manhwa-e2e
```

- Variables : `E2E_DATABASE_URL` (défaut `postgres://postgres:postgres@localhost:5439/manhwa_e2e`),
  `E2E_WEB_PORT`, `E2E_API_PORT`.
- Le front est construit dans `.next-e2e` (`NEXT_DIST_DIR`) : ses rewrites visent l'API de test, et
  il ne remplace jamais le build `.next` de dev/prod (les rewrites sont figés au build).
- En CI : job `e2e` du workflow, rapport HTML publié en artefact en cas d'échec.

## Comment le front parle à l'API

```
Navigateur ──/api/*──▶ Next.js (proxy, même origine) ──▶ Hono (API_INTERNAL_URL)
Server Components ───────────────────────────────────────▶ Hono (direct, cookie relayé)
```

- **Proxy same-origin** (`next.config.ts`) : le navigateur ne voit qu'une seule origine, donc le
  cookie de session Better Auth est first-party et il n'y a pas de CORS. Seules les ressources de
  `app/lib/api-routes.ts` sont relayées (liste blanche) : l'API machine `/api/ingest/*` reste injoignable.
- **Contrat typé de bout en bout** : `app/lib/api.ts` est un client Hono RPC typé par `AppType`
  (importé du workspace `api`, types uniquement). Les types métier du front sont *déduits* dans
  `app/lib/api-types.ts` — aucune interface recopiée à la main.
- **Configuration** : `app/lib/env.ts` est le seul module qui lit `process.env` (URL validée et normalisée).

## Authentification

| Où | Fichier | Usage |
|---|---|---|
| Client Components | `app/lib/auth-client.ts` | `authClient.useSession()`, `signIn`, `signUp`, `signOut` |
| Server Components | `app/lib/dal.ts` (`server-only`) | `verifySession()` en tête de page protégée, `getForwardedAuthHeaders()` pour les appels RPC serveur |
| Toutes les pages | `proxy.ts` | redirection *optimiste* vers `/login` si aucun cookie de session |

`proxy.ts` ne fait qu'un contrôle de présence du cookie : la vraie vérification (signature,
expiration) est faite par l'API, via `verifySession()`.

## Organisation

```
app/(app)/        pages connectées (shell avec sidebar)
app/(auth)/       pages publiques (login)
app/lib/          code partagé sans JSX (client API, auth, routes, formatage)
components/ui/    composants shadcn (ajoutés un par un : `pnpm dlx shadcn@latest add <nom>`)
components/<domaine>/  composants métier (dashboard, manhwa, reading, library, search…)
hooks/            hooks client (mutations, progression…)
e2e/              parcours Playwright (`*.e2e.ts`)
```

Constantes partagées entre Server et Client Components : dans `app/lib/*`, jamais dans un module
`"use client"` (elles y deviendraient des références client).
