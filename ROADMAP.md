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
| **Recherche floue `pg_trgm`** | Index GIN trigrammes sur `manhwas.title`, `original_title` et `manhwa_titles.title` ; seuil `word_similarity` 0.4 posé par transaction (`set_config(…, true)`), jokers `LIKE` échappés. |
| **Catalogues externes = pattern Strategy (port + adaptateurs + décorateurs)** | `ExternalCatalogProvider` (port) ← `AniListClient`, `MangaDexClient` (adaptateurs, réponses validées par Zod) enrobés par `RateLimitedCatalogProvider` et `CachedCatalogProvider` dans la composition root ; activés par `DISCOVERY_PROVIDERS`. Port séparé `ExternalChapterFeed` pour les fournisseurs qui listent les chapitres (MangaDex) ; la tâche `chapters.sync` ne reçoit que l'œuvre et choisit ses flux d'après ses `external_links` (aucun fournisseur codé en dur, sortie propre sans flux : les chapitres viendront de `/api/ingest`). Références croisées (MangaDex → id AniList) : une même œuvre importée des deux côtés n'a qu'une fiche. |
| **Outbox transactionnelle + worker Postgres** | Table `jobs` alimentée dans la transaction métier (import → `cover.mirror`, `chapters.sync`) ; worker interne (`JobWorker`) qui réserve par `FOR UPDATE SKIP LOCKED`, ré-essais exponentiels, dead-letter (`failed`), reprise des réservations orphelines, dédoublonnage par `dedupe_key` (index unique partiel), arrêt propre. Un handler par type de tâche (`JobHandler`). |
| **`fetch` injecté** | Tous les appels sortants passent par un `HttpFetch` injecté : les tests utilisent un faux, jamais le réseau. |
| **Proxy d'images anti-SSRF** | Liste blanche de domaines (revérifiée à chaque redirection), HTTPS/port 443, pas de SVG, 5 Mo max, 8 s max, `CSP: sandbox`. |

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
| **Manhwas** `/manhwas` | `GET /`, `GET /:id`, `GET /search?q=&limit=&external=&providers=` (floue `pg_trgm` sur titres + alias ; repli AniList + MangaDex si aucun résultat local, chaque fournisseur dégradé indépendamment) | 🔒 `POST /import` `{ provider, externalId }` (idempotent : 201 puis 200, 409 si retiré par un admin) · 👑 `POST /`, `PATCH /:id`, `DELETE /:id` (soft) |
| **Images** `/images` | `GET /proxy?url=` (couvertures tierces servies par l'API : anti-hotlinking, cache 24 h, liste blanche `IMAGE_PROXY_ALLOWED_HOSTS`) · `GET /media/:key` (couvertures copiées localement, clé SHA-256, cache `immutable`) | — |
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
| Fichiers TypeScript API (hors tests) | 68 |
| `any` / type casts | 0 |
| Tests | 125 (unitaires + intégration sur Postgres éphémère, appels sortants simulés) |
| Commandes | `pnpm --filter api typecheck` · `test` · `test:unit` · `test:integration` · `build` |

---

## 4. Frontend (`apps/web/`) — 🟢 Recherche, import, fiche détaillée et bibliothèque fonctionnels

| Élément | État |
|---|---|
| Proxy same-origin (`next.config.ts`) | ✅ `/api/auth/*` → Hono `/api/auth/*` ; `/api/<ressource>/*` → Hono `/<ressource>/*` **uniquement pour la liste blanche** `PUBLIC_API_RESOURCES` (`app/lib/api-routes.ts`, dérivée de `AppType` et vérifiée au typecheck). `/api/ingest` (M2M) n'est jamais relayé, y compris sous forme encodée |
| Protection des pages | ✅ `proxy.ts` : redirection optimiste vers `/login` sans cookie de session ; `verifySession()` (DAL `server-only`, `app/lib/dal.ts`) vérifie réellement la session dans chaque page |
| Client RPC (`app/lib/api.ts`) | ✅ `hc<AppType>` — appels serveur au nom de l'utilisateur via `getForwardedAuthHeaders()` |
| Auth | ✅ `/login` (connexion / inscription), menu utilisateur (`useSession`) avec déconnexion |
| Layout | ✅ Sidebar shadcn repliable (Catalogue, Ma Bibliothèque, Paramètres) + header |
| Pages | ✅ Routes en anglais centralisées (`app/lib/routes.ts`), anciennes URLs `/catalogue`, `/bibliotheque` et `/parametres` redirigées en 308 (`/settings`) ; Accueil (bienvenue + statistiques) ; Catalogue (`/catalog`) : recherche dans l'URL (`?q=&external=true`, anti-rebond, tolérante aux fautes), résultats locaux + AniList/MangaDex/Kitsu streamés (`<Suspense>` + squelettes), import en un clic (toast, `router.refresh()`), fournisseurs en panne signalés sans casser la page ; Fiche `/manhwas/[id]` : couverture locale (repli automatique sur le proxy puis sur un emplacement neutre), auteurs par rôle avec nom natif, synopsis, genres/thèmes (spoilers repliés), saisie directe du chapitre (« 120 », « 10,5 », validation locale, Échap, « Annuler » dans le toast), statut, chapitres « Lu » (`POST /reading/reads`) et menu « Lu jusqu'ici » / « Reprendre ici » (mise à jour absolue), sections streamées ; Ma Bibliothèque (`/library`, onglets par statut avec compteurs, filtrage instantané, onglet dans l'URL `?statut=`, statut modifiable depuis la carte, « +1 » optimiste) ; 🚧 Paramètres (lecture seule) |
| Types front | ✅ Déduits du contrat RPC (`app/lib/api-types.ts`, `InferResponseType`/`InferRequestType`) — aucune interface dupliquée ; libellés FR exhaustifs par enum (`app/lib/labels.ts`) |
| Données serveur | ✅ `app/lib/queries.ts` (`server-only`) : lectures RPC mémoïsées par `cache()` (la page, `generateMetadata` et les sections streamées partagent un seul appel) |
| Mutations client | ✅ Hook `useApiMutation` : appel Hono RPC via le proxy, transition React + `router.refresh()`, `onSuccess`/`onError`, toasts Sonner, messages FR par statut (`app/lib/api-errors.ts`) |
| États de chargement / erreurs | ✅ `loading.tsx` (catalogue, fiche), squelettes par section, `error.tsx` (bouton « Réessayer », `retry()` de Next 16), `not-found.tsx` pour une fiche inconnue |
| UI (`components/ui`) | ✅ shadcn (style `radix-nova`, alias `utils` → paquet `cn`) : badge, button, card, input, label, field, dropdown-menu, select, sidebar, avatar, separator, sheet, tooltip, skeleton, sonner |
| TypeScript / Lint | ✅ 0 erreur, 0 avertissement |
| Tests composants (Vitest + Testing Library, jsdom) | ✅ `pnpm --filter web test` : recherche (anti-rebond, URL), import (succès/409/réseau), « Lu », saisie du chapitre (validation, annulation, échec serveur, resynchronisation), « Lu jusqu'ici », onglets de la bibliothèque, URL de couverture |
| Tests E2E (Playwright) | ❌ À mettre en place |

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
- Frontend : catalogue (grille, ajout à la bibliothèque) et bibliothèque (+1 chapitre, statut)
- « Super-backend » : recherche floue `pg_trgm`, repli + import AniList (genres/tags créés à la volée, résolution par alias), proxy d'images anti-SSRF, cache TTL et limiteur de débit
- Multi-fournisseurs (Strategy) : MangaDex en plus d'AniList, filtre `?providers=`, références croisées anti-doublon ; outbox + worker `SKIP LOCKED` (miroir des couvertures sur disque, synchronisation des chapitres MangaDex)
- 3ᵉ fournisseur Kitsu (preuve de l'Open/Closed : aucune ligne du service modifiée)
- Frontend découverte : recherche + import depuis les 3 catalogues, fiche détaillée (tags, chapitres, progression), squelettes / toasts / frontière d'erreur, tests composants Vitest
- Teams de scantrad : identité fournisseur (UUID MangaDex) sur `scanlation_groups`, collaborations via la table de liaison `chapter_release_groups` (ordre de crédit), upsert idempotent partagé par la synchronisation et l'ingestion du scraper (`scanlationGroups[]`), migration avec reprise des crédits existants
- Affichage des teams : `GET /chapters/manhwa/:id` renvoie chaque chapitre avec ses parutions et teams créditées (2 requêtes groupées, sans N+1) ; la fiche affiche « FR — Asura Scans & Flame Comics » avec lien vers la source (http(s) uniquement), langue seule si aucune team
- Auteurs (AniList, MangaDex ; Kitsu n'expose pas l'équipe des mangas) dédoublonnés par nom natif, table pivot ordonnée ; couvertures locales exposées par l'API (`localCoverUrl`) et affichées avec repli ; `/settings`
- Stabilisation : URLs en anglais (`/catalog`, `/library`) avec redirections, boutons de carte responsives, synchronisation des chapitres agnostique (pilotée par les liens de l'œuvre)
- Progression avancée : saisie directe du chapitre, « Lu jusqu'ici » (mise à jour absolue, sans faux historique), « Annuler », bibliothèque en onglets ; l'API passe une série « à lire » en « en cours » dès qu'on saisit un chapitre

### 🔴 Priorité suivante — Sécurité & robustesse API

| Tâche | Pourquoi |
|---|---|
| Pagination cursor-based sur les `GET` de liste | `GET /chapters` renvoie toute la table |
| CI GitHub Actions (typecheck → test → build, drift check des migrations) | Règle CLAUDE.md |
| Durcir l'auth du scraper (signature HMAC horodatée ou mTLS, rotation de clé) | La clé statique `x-api-key` est un premier niveau (cf. CLAUDE.md) |

### 🟠 Tables pivot / enrichissement

Routes pour `manhwa_titles`, `manhwa_authors`, `manhwa_genres`, `manhwa_sources`, `chapter_sources`, `external_links`, `manhwa_covers`, `audit_logs` (admin, lecture seule) — chacune livrée avec ses tests.

### 🟡 Frontend

Playwright (E2E), tags de genre sur les cartes (embarquer les termes dans `GET /manhwas` pour éviter N+1 requêtes), pagination cursor du catalogue, titres alternatifs sur la fiche (route API à créer), page « œuvres de cet auteur », retrait de la bibliothèque, gestion des listes personnalisées, édition du profil.

### 🟤 Scraper

Architecture du worker, première source, planification, ingestion via l'API.

### 🔵 Évolutions DB proposées (non validées)

Télémétrie de lecture partitionnée (sessions / événements), rapprochement flou des titres du scraper (`pg_trgm` est en place : reste la file de validation humaine), ingestion des tags du scraper via `term_aliases` (déjà fait pour l'import AniList), audit par triggers, PostgreSQL 18 (`uuidv7()`).

### 🟣 Idées d'architecte (backend avancé, non validées)

| Fonctionnalité | Ce que ça apporte | Esquisse technique |
|---|---|---|
| **Suite de l'outbox** (socle livré) | Rafraîchissement périodique des fiches et chapitres, événement « nouveau chapitre » pour les notifications | Tâches planifiées (`run_at` + ré-enfilage), enfilage depuis l'ingestion du scraper, page admin des tâches `failed` (relance), purge des tâches terminées |
| **Recherche sémantique et recommandations (`pgvector`)** | « Un manhwa où le héros se réincarne en forgeron » trouve des œuvres sans mot commun ; « Parce que vous avez lu X » | Embeddings du synopsis + tags stockés en `vector(…)` (index HNSW) ; classement hybride trigrammes + vecteurs (Reciprocal Rank Fusion) ; filtrage collaboratif sur `reading_progress` |
| **Suite du miroir des couvertures** (socle livré : disque local, clé SHA-256) | Images redimensionnées, chargement instantané, stockage partagé entre instances | Adaptateur `MediaStorage` S3/R2, variantes `sharp` (WebP/AVIF, 3 tailles), `blurhash` en base, exposer `storageKey` dans `GET /manhwas` |

### 🧠 Idées d'architecte V2 (non validées)

| Fonctionnalité | Ce que ça apporte | Esquisse technique |
|---|---|---|
| **Temps réel : `LISTEN/NOTIFY` → SSE + Web Push** | « Le chapitre 176 de TBATE est sorti » arrive en quelques secondes, sans que le front interroge l'API en boucle ; le worker se réveille instantanément au lieu de sonder toutes les 2 s | Trigger `pg_notify` à l'insertion dans `jobs` / `chapter_releases` ; une connexion `LISTEN` dédiée par instance ; route SSE authentifiée (`requireAuth`) qui ne pousse que les séries de la bibliothèque de l'utilisateur ; Web Push (VAPID) quand l'onglet est fermé ; tâche outbox `notify.new_chapter` pour le fan-out |
| **Observabilité OpenTelemetry de bout en bout** | Voir sur UNE trace : requête d'import → transaction → tâche enfilée → tâche exécutée 3 s plus tard → appel MangaDex lent ; alertes sur la profondeur de file et les tâches `failed` | SDK OTel Node (auto-instrumentation HTTP/pg/fetch) ; `traceparent` stocké dans le payload du job pour relier producteur et worker ; métriques (latence par fournisseur, jobs par statut, âge de la plus vieille tâche) ; export OTLP → Grafana Tempo/Prometheus/Loki ; SLO + alerting |
| **Résilience distribuée : Redis (Valkey) pour quotas, cache et disjoncteurs** | Aujourd'hui cache et quotas sont en mémoire PAR instance : à 3 instances, on envoie 3× notre quota à MangaDex. Avec Redis : un quota global, un cache partagé, et un fournisseur en panne est court-circuité au lieu d'être martelé | Seau à jetons atomique (script Lua) partagé ; cache L1 mémoire + L2 Redis avec *stale-while-revalidate* ; *single-flight* (100 recherches identiques simultanées = 1 appel sortant) ; décorateur `CircuitBreakerCatalogProvider` (ouvert après N échecs, demi-ouvert après délai) — branché dans la composition root sans toucher au service |
