# syntax=docker/dockerfile:1.7
# Image du worker de scraping : une boucle (docker/scheduler.sh) lance `track --from-api` à intervalle fixe.
# Contexte de build : apps/scraper — docker build -t manhwa-scraper apps/scraper

ARG PYTHON_VERSION=3.13
ARG UV_VERSION=0.12.19

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# ── build : environnement virtuel figé par uv.lock, sans les outils de dev (pytest, mypy, ruff…) ────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS build
COPY --from=uv /uv /bin/uv
# Bytecode précompilé (démarrage plus rapide), copie des fichiers (le cache uv n'est pas dans l'image finale),
# et le Python de l'image de base, jamais un Python téléchargé par uv.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
# Dépendances seules d'abord : cette couche reste en cache tant que pyproject.toml / uv.lock ne changent pas.
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# ── runtime ──────────────────────────────────────────────────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    SCRAPER_HEADLESS=true \
    SCRAPER_HEARTBEAT_FILE=/tmp/manhwa-scraper.heartbeat
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
# Bibliothèques système d'un Firefox headless (Camoufox est un Firefox modifié) : la liste officielle maintenue
# par Playwright, installée via apt. tini : PID 1 qui relaie les signaux et ramasse les processus zombies
# laissés par les navigateurs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && playwright install-deps firefox \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 scraper
COPY --chmod=755 docker/scheduler.sh docker/healthcheck.sh /usr/local/bin/
USER scraper
# Binaire Camoufox + base GeoIP, téléchargés dans ~/.cache/camoufox de l'utilisateur qui lance le worker.
RUN camoufox fetch
HEALTHCHECK --interval=5m --timeout=10s --start-period=1m --retries=2 CMD ["healthcheck.sh"]
ENTRYPOINT ["tini", "--"]
CMD ["scheduler.sh"]
