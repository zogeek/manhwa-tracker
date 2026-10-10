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
| `pnpm --filter web build` | Build de production |

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
components/<domaine>/  composants métier (manhwa, reading, library, search…)
hooks/            hooks client (mutations, progression…)
```

Constantes partagées entre Server et Client Components : dans `app/lib/*`, jamais dans un module
`"use client"` (elles y deviendraient des références client).
