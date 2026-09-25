# 📖 Manhwa Tracker — État du Projet

> Dernière mise à jour : 24 septembre 2026 — branche `feat/advanced-db-and-ingestion`

---

## 1. Vue d'ensemble

**Manhwa Tracker** est une application web de suivi de lecture de manhwas/mangas/webtoons. L'utilisateur peut suivre sa progression, noter ses séries, organiser ses listes, et retrouver les chapitres disponibles sur différentes sources de scantrad.

### Stack technique

| Couche | Technologie | Version |
|---|---|---|
| **Monorepo** | Turborepo + pnpm | turbo 2.11 / pnpm 10.34 |
| **Runtime** | Node.js | ≥ 24 |
| **API** | Hono (Node.js) | 4.13 |
| **ORM** | Drizzle ORM + drizzle-kit | 0.45 / 0.31 (v1 en RC : migration différée) |
| **Validation** | Zod + drizzle-zod | 4.6 / 0.8 |
| **Auth** | Better Auth (email + mot de passe, plugin admin) | 1.7 |
| **DB** | PostgreSQL | 16 (Docker Alpine) |
| **Tests API** | Vitest + testcontainers | 5.0 / 12.1 |
| **Frontend** | Next.js + React + Tailwind + shadcn/ui | Next 16.3 / React 19.3 / TW 4.3 |
| **Scraper** | FastAPI + Playwright (Python) — worker isolé, parle à l'API en HTTP | — |
| **TypeScript** | Strict (+ `noUncheckedIndexedAccess`), ESM NodeNext | 5.9 |

### Décisions d'architecture

| Décision | Raison |
|---|---|
| **Hono RPC (`AppType`)** | Type-safety de bout en bout client ↔ serveur. Garantie par `app.types.spec.ts` (échec de compilation si le contrat casse). |
| **Routes chaînées, handlers inline** | Les classes Controller cassaient l'inférence Hono ; les handlers délèguent directement aux services. |
| **Composition root (`container.ts`) + `createApp()`** | Seul endroit qui instancie les implémentations concrètes ; tout le reste reçoit ses dépendances par constructeur/paramètre. |
| **Repositories = interface + implémentation Drizzle** | Les services dépendent d'abstractions → tests unitaires sans base de données. |
| **Unit of Work (`createTransactionRunner`)** | Opérations multi-tables atomiques (ex : lecture de chapitre + progression). |
| **Erreurs typées + handler global unique** | Format unique `{ error: { code, message, details? } }` ; violations Postgres traduites (409 / 422 / 400). |
| **Better Auth derrière le proxy Next.js** | `/api/auth/*` même origine que le front → cookies de session first-party. |
| **Scraper Python isolé** | Écosystème anti-bot plus mature ; l'API Hono reste l'unique point d'entrée vers la DB. |
| **`timestamptz`, `numeric(8,2)`, index uniques partiels** | Dates sans ambiguïté de fuseau, chapitres 10.5, soft delete compatible avec l'unicité. |

---

## 2. Architecture du monorepo

```
manhwa-tracker/
├── apps/
│   ├── api/              ← Backend Hono + Drizzle + Better Auth (✅ socle sécurisé, testé)
│   ├── web/              ← Frontend Next.js (✅ branché : proxy, auth, dashboard typé)
│   └── scraper/          ← Scraper Python (🔴 pas commencé)
├── packages/             ← Packages partagés (vide)
├── CLAUDE.md             ← Règles d'architecture, SOP Git, stratégie de tests
├── docker-compose.yml    ← PostgreSQL 16 local (port 5431)
├── turbo.json            ← build / typecheck / test / lint
└── pnpm-workspace.yaml
```

---

## 3. API Backend (`apps/api/`)

### 3.1 Structure

```
apps/api/
├── drizzle/                         ← Migrations SQL versionnées (0000 baseline → 0002 plugin admin)
├── better-auth.config.ts            ← Entrée du CLI Better Auth (outillage uniquement)
├── vitest.config.ts                 ← Projets `unit` et `integration`
└── src/
    ├── index.ts                     ← Bootstrap : env validé, DB, container, serveur, arrêt propre
    ├── app.ts                       ← createApp() : middlewares, handler d'erreurs, /api/auth/*, routes → AppType
    ├── container.ts                 ← Composition root (repositories → services, auth, transactions)
    ├── modules/
    │   ├── sources/  manhwas/  chapters/  genres/
    │   ├── reading-progress/        ← Progression + journal de lecture (transaction atomique)
    │   └── reading-lists/           ← Listes personnelles (contrôle de propriété)
    ├── shared/
    │   ├── auth/index.ts            ← createAuth() — source de vérité Better Auth
    │   ├── middleware/auth.middleware.ts ← requireAuth / optionalAuth
    │   ├── config/env.ts            ← Variables d'environnement validées par Zod
    │   ├── db/                      ← schema.ts, auth-schema.ts (généré), errors, transaction, seed.test.ts
    │   ├── http/                    ← error-handler, validate(), types
    │   └── lib/                     ← errors (AppError…), validation partagée
    └── test/                        ← global-setup (Postgres éphémère), helpers d'intégration
```

### 3.2 Pattern par module (5 fichiers)

| Fichier | Rôle |
|---|---|
| `*.schema.ts` | Ré-export des tables Drizzle + types `InferSelect/Insert` |
| `*.validator.ts` | Schemas Zod dérivés de `createInsertSchema(table)` |
| `*.repository.ts` | Interface + implémentation Drizzle (reçoit un `DbClient` : DB ou transaction) |
| `*.service.ts` | Logique métier, erreurs de domaine (`NotFoundError`, `ForbiddenError`…) |
| `*.route.ts` | `createXRoutes(service, auth)` : routes chaînées, `validate()`, `requireAuth` |

Tests à côté du code : `*.service.spec.ts` (unitaires, repository en mémoire) et `*.route.spec.ts` (intégration, vraie DB + vraies sessions).

### 3.3 Endpoints

**Conventions** : succès `{ data }` · erreurs `{ error: { code, message, details? } }` · `DELETE` → `204`.
🔒 = session Better Auth obligatoire (`requireAuth`). 🤖 = clé d'API machine (`requireApiKey`, `SCRAPER_API_KEY`). 👑 = rôle `admin` requis (`requireAdmin` : 401 sans session, 403 sans rôle). L'identité provient **uniquement** de la session.
Premier admin : `pnpm --filter api admin:promote <email>`.

| Module | Lecture publique | 🔒 Protégé |
|---|---|---|
| **Auth** `/api/auth/*` | — | Géré par Better Auth (sign-up, sign-in, session, sign-out…), rate-limité |
| **Sources** `/sources` | `GET /`, `GET /:id` | 👑 `POST /`, `PATCH /:id`, `DELETE /:id` (soft) |
| **Manhwas** `/manhwas` | `GET /`, `GET /:id` | 👑 `POST /`, `PATCH /:id`, `DELETE /:id` (soft) |
| **Chapters** `/chapters` | `GET /`, `GET /manhwa/:manhwaId`, `GET /:id` | 👑 `POST /`, `PATCH /:id`, `DELETE /:id` (soft) |
| **Taxonomie** `/taxonomy` | `GET /vocabularies`, `GET /vocabularies/:slug/terms`, `GET /manhwas/:manhwaId/terms` | 👑 `POST /vocabularies`, `POST /terms`, `PATCH /terms/:id` (anti-cycle), `DELETE /terms/:id` (409 si enfants), `PUT`/`DELETE /manhwas/:manhwaId/terms/:termId` |
| **Ingestion** `/api/ingest` (M2M) | — | 🤖 clé `x-api-key` : `POST /runs`, `PATCH /runs/:id`, `POST /health`, `POST /batches` (idempotent, `Idempotency-Key`) — hors `AppType` |
| **Progression** `/reading` | — | `GET /progress` (bibliothèque, manhwa inclus), `GET /progress/:manhwaId`, `PUT /progress/:manhwaId`, `DELETE /progress/:manhwaId`, `POST /reads` (lecture + progression atomiques), `GET /reads`, `GET /reads/:manhwaId` |
| **Listes** `/reading/lists` | — | `GET /`, `GET /:id` (avec items), `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /:id/items`, `DELETE /:id/items/:manhwaId` — **403 si non propriétaire** |

### 3.4 Schéma DB (27 tables)

23 tables métier + 4 tables Better Auth (`user`, `session`, `account`, `verification`, générées par `pnpm --filter api auth:generate`).
Les tables personnelles (`reading_progress`, `chapter_reads`, `reading_lists`) ont une FK `user_id → user.id` (cascade).

| Domaine | Tables | Module API |
|---|---|---|
| Catalogue | `manhwas` (soft delete), `manhwa_titles`, `authors`, `manhwa_authors`, `manhwa_covers`, `external_links` | manhwas (titres, auteurs, liens : ❌ pas encore de module) |
| Taxonomie | `vocabularies`, `terms` (arbre via `parent_id`, anti-cycle), `term_aliases`, `manhwa_terms` (pertinence, spoiler, provenance) | taxonomy |
| Sources & chapitres | `sources` (soft delete), `manhwa_sources`, `chapters` (canonique, `kind`), `chapter_releases` (parution : source, langue, équipe, URL), `scanlation_groups` | sources, chapters, ingestion |
| Scraper | `scrape_runs`, `source_health` (série temporelle), `ingestion_batches` (journal d'idempotence) | ingestion (M2M) |
| Lecture | `reading_progress`, `chapter_reads`, `reading_lists` (soft delete), `reading_list_items` | reading-progress, reading-lists |
| Audit | `audit_logs` | ❌ (admin, lecture seule — à venir) |
| Auth | `user`, `session`, `account`, `verification` | Better Auth |

> Migrations `0003`/`0004` : les anciens `genres`/`manhwa_genres` sont repris dans le vocabulaire hiérarchique `genre`, et `chapter_sources` dans `chapter_releases`, avant suppression.
>
> Le plugin admin ajoute `role`, `banned`, `ban_reason`, `ban_expires` à `user` et `impersonated_by` à `session` (migration `0002_auth_admin_plugin`).
>
> ⚠️ Les tables Better Auth utilisent `timestamp` sans fuseau (sortie du CLI, non modifiable à la main par règle) — exception assumée à la règle `timestamptz`.

### 3.5 Qualité

| Métrique | Valeur |
|---|---|
| Fichiers TypeScript API (hors tests) | 54 |
| `any` / type casts | 0 |
| Tests | 73 (unitaires + intégration sur Postgres éphémère) |
| Commandes | `pnpm --filter api typecheck` · `test` · `test:unit` · `test:integration` · `build` |

---

## 4. Frontend (`apps/web/`) — 🟢 Squelette applicatif (layout, navigation, auth)

| Élément | État |
|---|---|
| Proxy same-origin (`next.config.ts`) | ✅ `/api/auth/*` → Hono `/api/auth/*` ; `/api/<ressource>/*` → Hono `/<ressource>/*` **uniquement pour la liste blanche** `PUBLIC_API_RESOURCES` (`app/lib/api-routes.ts`, dérivée de `AppType` et vérifiée au typecheck). `/api/ingest` (M2M) n'est jamais relayé, y compris sous forme encodée |
| Protection des pages | ✅ `proxy.ts` : redirection optimiste vers `/login` sans cookie de session ; `verifySession()` (DAL `server-only`, `app/lib/dal.ts`) vérifie réellement la session dans chaque page |
| Client RPC (`app/lib/api.ts`) | ✅ `hc<AppType>` — appels serveur au nom de l'utilisateur via `getForwardedAuthHeaders()` |
| Auth | ✅ `/login` (connexion / inscription), menu utilisateur (`useSession`) avec déconnexion |
| Layout | ✅ Sidebar shadcn repliable (Catalogue, Ma Bibliothèque, Paramètres) + header |
| Pages | ✅ Accueil (bienvenue personnalisée + statistiques), Catalogue (liste serveur) ; 🚧 Ma Bibliothèque, Paramètres (lecture seule) |
| UI (`components/ui`) | ✅ shadcn (style `radix-nova`) : button, card, input, label, field, dropdown-menu, sidebar, avatar, separator, sheet, tooltip, skeleton |
| TypeScript / Lint | ✅ 0 erreur, 0 avertissement |
| Tests (Vitest + Playwright) | ❌ À mettre en place |

---|---|
| Proxy same-origin (`next.config.ts`) | ✅ `/api/auth/*` → Hono `/api/auth/*`, `/api/*` → Hono `/*` (`API_INTERNAL_URL`, figé au build) |
| Client RPC (`app/lib/api.ts`) | ✅ `hc<AppType>` — `AppType` importé du paquet workspace `api` |
| Auth (`app/lib/auth-client.ts`) | ✅ Client Better Auth + plugin admin (aucune page de connexion pour l'instant) |
| UI | 🧹 Supprimée : une seule page `/` (« Projet Vierge »), layout minimal, aucun composant — shadcn (`components.json`) réinstallera les composants un par un |
| Styles (`app/globals.css`) | ✅ Socle Tailwind v4 + variables de thème shadcn uniquement (config CSS-first, pas de `tailwind.config.ts`) |
| TypeScript | ✅ 0 erreur (`pnpm --filter web typecheck`) |
| Lint | ✅ 0 erreur, 0 avertissement (`pnpm --filter web lint`) |
| Tests (Vitest + Playwright) | ❌ À mettre en place |

---

## 5. Scraper (`apps/scraper/`) — 🔴 Pas commencé

Worker Python isolé (FastAPI/Playwright) qui poussera ses données vers l'API Hono via HTTP interne, authentifié par une clé de service (jamais les routes du client web).

---

## 6. Roadmap

### ✅ Fait (refactorisation « API foundations »)

- Étape 1 — Assainissement : dépendances, pnpm 10, tsconfig strict, build, drizzle-kit, migrations
- Étape 2 — Socle transverse : handler d'erreurs unique, erreurs typées, composition root, format de réponse
- Étape 3 — Hono RPC restauré : routes chaînées, 0 cast, garde-fou de types
- Étape 5 — Schéma : `timestamptz`, `numeric`, `jsonb`, index partiels, contraintes CHECK, FK manquantes
- Priorité 1 — Better Auth : `/api/auth/*`, `requireAuth` sur toutes les mutations, suppression de `x-user-id`, rate limiting
- Étape 4 — `reading` découpé en `reading-progress` / `reading-lists`, correction IDOR (403), lecture + progression atomiques
- Infrastructure de tests : Vitest (unit + intégration testcontainers), seed isolé
- Rôle admin (plugin Better Auth) : mutations du catalogue réservées aux admins
- Frontend reconnecté : proxy Next.js, login/inscription, dashboard sur le RPC typé (0 erreur TS)
- Schéma avancé : chapitres canoniques / parutions, équipes, taxonomie hiérarchique, télémétrie scraper
- API d'ingestion M2M (`/api/ingest`, clé d'API, lots idempotents et atomiques)

### 🔴 Priorité suivante — Sécurité & robustesse API

| Tâche | Pourquoi |
|---|---|
| Pagination cursor-based sur les `GET` de liste | `GET /chapters` renvoie toute la table |
| CI GitHub Actions (typecheck → test → build, drift check des migrations) | Règle CLAUDE.md |
| Durcir l'auth du scraper (signature HMAC horodatée ou mTLS, rotation de clé) | La clé statique `x-api-key` est un premier niveau (cf. CLAUDE.md) |

### 🟠 Tables pivot / enrichissement

Routes pour `manhwa_titles`, `manhwa_authors`, `manhwa_genres`, `manhwa_sources`, `chapter_sources`, `external_links`, `manhwa_covers`, `audit_logs` (admin, lecture seule) — chacune livrée avec ses tests.

### 🟡 Frontend

Vitest (composants) + Playwright (E2E), page Ma Bibliothèque (progression, mise à jour), fiche manhwa détaillée, ajout au suivi depuis le catalogue, gestion des listes personnalisées, édition du profil.

### 🟤 Scraper

Architecture du worker, première source, planification, ingestion via l'API.

### 🔵 Évolutions DB proposées (non validées)

Télémétrie de lecture partitionnée (sessions / événements), rapprochement flou des titres (`pg_trgm`) et file de validation, ingestion des tags via `term_aliases`, audit par triggers, PostgreSQL 18 (`uuidv7()`).
