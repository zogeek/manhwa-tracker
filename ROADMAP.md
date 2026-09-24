# 📖 Manhwa Tracker — État du Projet

> Dernière mise à jour : 23 septembre 2026 — branche `refactor/api-foundations`

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
| **Auth** | Better Auth (email + mot de passe) | 1.7 |
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
│   ├── web/              ← Frontend Next.js (🔴 cassé : prototype non aligné sur l'API)
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
├── drizzle/                         ← Migrations SQL versionnées (0000_baseline, 0001_better_auth)
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
🔒 = session Better Auth obligatoire (`requireAuth`). L'identité provient **uniquement** de la session.

| Module | Lecture publique | 🔒 Protégé |
|---|---|---|
| **Auth** `/api/auth/*` | — | Géré par Better Auth (sign-up, sign-in, session, sign-out…), rate-limité |
| **Sources** `/sources` | `GET /`, `GET /:id` | `POST /`, `PATCH /:id`, `DELETE /:id` (soft) |
| **Manhwas** `/manhwas` | `GET /`, `GET /:id` | `POST /`, `PATCH /:id`, `DELETE /:id` (soft) |
| **Chapters** `/chapters` | `GET /`, `GET /manhwa/:manhwaId`, `GET /:id` | `POST /`, `PATCH /:id`, `DELETE /:id` (soft) |
| **Genres** `/genres` | `GET /`, `GET /:id` | `POST /`, `PATCH /:id`, `DELETE /:id` (hard, cascade pivot) |
| **Progression** `/reading` | — | `GET /progress`, `GET /progress/:manhwaId`, `PUT /progress/:manhwaId`, `POST /reads` (lecture + progression atomiques), `GET /reads`, `GET /reads/:manhwaId` |
| **Listes** `/reading/lists` | — | `GET /`, `GET /:id` (avec items), `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /:id/items`, `DELETE /:id/items/:manhwaId` — **403 si non propriétaire** |

### 3.4 Schéma DB (21 tables)

17 tables métier + 4 tables Better Auth (`user`, `session`, `account`, `verification`, générées par `pnpm --filter api auth:generate`).
Les tables personnelles (`reading_progress`, `chapter_reads`, `reading_lists`) ont une FK `user_id → user.id` (cascade).

| Table | Soft delete | Module API |
|---|---|---|
| `manhwas` | ✅ | manhwas |
| `manhwa_titles`, `authors`, `manhwa_authors`, `manhwa_sources`, `chapter_sources`, `external_links`, `manhwa_covers` | — | ❌ pas encore de module |
| `genres` / `manhwa_genres` | ❌ (hard) | genres |
| `sources` | ✅ | sources |
| `chapters` | ✅ | chapters |
| `reading_progress`, `chapter_reads` | — | reading-progress |
| `reading_lists` / `reading_list_items` | ✅ / — | reading-lists |
| `audit_logs` | — | ❌ (admin, lecture seule — à venir) |
| `user`, `session`, `account`, `verification` | — | Better Auth |

> ⚠️ Les tables Better Auth utilisent `timestamp` sans fuseau (sortie du CLI, non modifiable à la main par règle) — exception assumée à la règle `timestamptz`.

### 3.5 Qualité

| Métrique | Valeur |
|---|---|
| Fichiers TypeScript API (hors tests) | 47 |
| `any` / type casts | 0 |
| Tests | 34 (unitaires + intégration sur Postgres éphémère) |
| Commandes | `pnpm --filter api typecheck` · `test` · `test:unit` · `test:integration` · `build` |

---

## 4. Frontend (`apps/web/`) — 🔴 Volontairement cassé

Prototype (landing, login, dashboard, `ManhwaCard`) non aligné sur l'API actuelle : ~56 erreurs TypeScript (routes renommées, enveloppe `{ data }`). Le RPC étant désormais correctement typé, `tsc` liste précisément les corrections à faire.

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

### 🔴 Priorité suivante — Sécurité & robustesse API

| Tâche | Pourquoi |
|---|---|
| Rôle admin (plugin `admin` Better Auth) pour les mutations du catalogue | Aujourd'hui, tout utilisateur connecté peut modifier le catalogue |
| Pagination cursor-based sur les `GET` de liste | `GET /chapters` renvoie toute la table |
| CI GitHub Actions (typecheck → test → build, drift check des migrations) | Règle CLAUDE.md |
| Clé de service pour le scraper | Ingestion séparée des routes du client web |

### 🟠 Tables pivot / enrichissement

Routes pour `manhwa_titles`, `manhwa_authors`, `manhwa_genres`, `manhwa_sources`, `chapter_sources`, `external_links`, `manhwa_covers`, `audit_logs` (admin, lecture seule) — chacune livrée avec ses tests.

### 🟡 Frontend

Proxy Next.js (`/api/auth/*` → Hono), client Better Auth, réalignement du dashboard sur l'API typée, Vitest + Playwright.

### 🟤 Scraper

Architecture du worker, première source, planification, ingestion via l'API.

### 🔵 Évolutions DB proposées (non validées)

Parutions de chapitres par source (`chapter_releases`), historique de scraping, télémétrie de lecture partitionnée, taxonomie hiérarchique, audit par triggers, PostgreSQL 18 (`uuidv7()`).
