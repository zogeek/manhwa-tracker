# syntax=docker/dockerfile:1.7
# Image de production de l'API Hono. Contexte de build : racine du monorepo (lockfile pnpm partagé) :
#   docker build -f apps/api/Dockerfile -t manhwa-api .

ARG NODE_VERSION=24.14.1

# ── base : Node + pnpm (version épinglée par `packageManager`, via corepack) ─────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ── build : dépendances complètes (devDependencies comprises) + compilation TypeScript ───────────────────
FROM base AS build
# Manifestes seuls d'abord : cette couche (la plus lente) reste en cache tant que les dépendances ne changent pas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/scraper/package.json apps/scraper/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
RUN pnpm --filter api build
# Dossier autonome de l'API avec ses seules dépendances de production. `--no-optional` écarte les « peers »
# optionnels de better-auth (next, vitest, drizzle-kit…) qu'il ne charge que si présents : ~500 Mo de moins.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter api deploy --prod --no-optional --legacy /out \
 && cd /out && rm -rf src contracts Dockerfile README.md ./*.ts tsconfig*.json \
 && cp -r /repo/apps/api/dist /repo/apps/api/drizzle /out/

# ── runtime : Node seul, utilisateur non root ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    MEDIA_STORAGE_DIR=/app/storage/media
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Point de montage du volume des couvertures miroir, créé ici pour appartenir à `node` (et non à root).
RUN mkdir -p /app/storage/media && chown -R node:node /app/storage
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 3001) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# Migrations d'abord (idempotentes) : l'API ne démarre jamais sur un schéma en retard. `exec` laisse Node
# devenir le processus principal et recevoir SIGTERM directement (arrêt propre géré dans src/index.ts).
CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/index.js"]
