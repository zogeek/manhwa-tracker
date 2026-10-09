"""Configuration du worker, lue une seule fois depuis l'environnement (ou `.env`) et validée au démarrage."""

from typing import Annotated, Literal

from pydantic import Field, HttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SCRAPER_", env_file=".env", extra="ignore", frozen=True)

    # Origine de l'API Hono (sans `/api/ingest`), ex. http://localhost:3001.
    api_url: HttpUrl
    # Même valeur que `SCRAPER_API_KEY` côté API : SecretStr évite qu'elle fuite dans un log ou un repr().
    api_key: Annotated[SecretStr, Field(min_length=32)]
    # Navigateur sans fenêtre par défaut ; `false` aide à déboguer un challenge anti-bot en local.
    headless: bool = True
    # Délai max d'un chargement de page (challenge anti-bot compris).
    page_timeout_ms: Annotated[int, Field(gt=0)] = 45_000
    # Politesse : intervalle minimal entre deux requêtes vers un même site.
    request_interval_s: Annotated[float, Field(ge=0)] = 1.5
    # Durée de vie du robots.txt en cache, par site (24 h au plus selon la RFC 9309).
    robots_ttl_s: Annotated[float, Field(gt=0, le=86_400)] = 86_400
    # Œuvres par lot envoyé à `/api/ingest/batches` (l'API en accepte 100 au plus).
    batch_size: Annotated[int, Field(ge=1, le=100)] = 20
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"


class SearchSettings(BaseSettings):
    """Variables de `search` uniquement (non préfixées) : chercher une URL ne demande ni l'API Hono ni sa clé."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    # Instance SearXNG auto-hébergée (ex. http://localhost:8080) : moteur prioritaire dès qu'elle est définie.
    searxng_url: HttpUrl | None = None
    # Repli inactif par défaut : clé de l'API Brave Search (compte requis), utilisée seulement sans SEARXNG_URL.
    brave_search_api_key: Annotated[SecretStr, Field(min_length=1)] | None = None


def load_settings() -> Settings:
    """Lève une `ValidationError` explicite si une variable manque ou est invalide."""
    return Settings()


def load_search_settings() -> SearchSettings:
    return SearchSettings()
