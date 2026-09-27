## Description

<!-- Quoi et surtout pourquoi. Quel problème cette PR résout-elle pour l'application ou les utilisateurs ? -->

Closes #

## Type de changement

- [ ] ✨ `feat` — nouvelle fonctionnalité
- [ ] 🐛 `fix` — correction de bug
- [ ] ♻️ `refactor` — sans changement de comportement
- [ ] ⚡ `perf` — performance
- [ ] 🗃️ `db` — schéma / migration Drizzle
- [ ] 🔧 `chore` / `ci` / `build` — outillage, dépendances, pipeline
- [ ] 📝 `docs`
- [ ] 💥 **Breaking change** — contrat d'API, variable d'environnement ou migration non rétrocompatible (détailler ci-dessous)

## Périmètre

- [ ] `apps/api` (Hono)
- [ ] `apps/web` (Next.js)
- [ ] `apps/scraper` (Python)
- [ ] CI / infra

## Comment tester

<!-- Étapes pour vérifier le comportement à la main (routes appelées, parcours dans l'UI, commande du scraper…). -->

1.

## Checklist

### Qualité
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` et `pnpm build` passent en local
- [ ] Aucun `any` ni cast (`as never`, `as string`) ajouté côté TypeScript ; `mypy --strict` passe côté Python
- [ ] Commits atomiques au format Conventional Commits

### Tests
- [ ] Logique métier couverte par des tests unitaires (`*.service.spec.ts` / pytest)
- [ ] Routes couvertes par des tests d'intégration (`*.route.spec.ts`, Postgres de test)
- [ ] Toute nouvelle route protégée teste le **401** sans session **et** le **403** hors propriétaire / sans rôle
- [ ] Tables pivot : un test vérifie que la suppression d'une entité ne casse pas les relations

### Base de données
- [ ] Migration générée (`pnpm --filter api db:generate`) et commitée — sinon le drift check de la CI échoue
- [ ] Dates en `timestamptz`, décimaux en `numeric`, index uniques partiels pour le soft delete

### Sécurité
- [ ] Routes mutantes derrière `requireAuth` / `requireAdmin` ; aucun userId lu depuis un header client
- [ ] Aucun secret commité ; `.env.example` mis à jour pour chaque nouvelle variable
- [ ] Routes GET de liste paginées par curseur

## Captures / notes pour la revue

<!-- UI modifiée : avant / après. Points d'attention, choix discutables, suites prévues. -->
