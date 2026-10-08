"""Recherche de la fiche d'une œuvre par « dorking » : `site:scan-manga.com "Titre"` posé à un moteur tiers.

Le site cible ne reçoit aucune requête : on interroge l'index que le moteur a déjà construit. Le moteur doit
autoriser l'automatisation — d'où l'API officielle de Brave Search (clé + quota) et pas la page HTML d'un moteur
grand public (DuckDuckGo répond aux robots par un CAPTCHA : refus ciblé, cf. README, « Éthique »).

Le moteur est derrière le protocole `SearchEngine` : passer à un SearXNG auto-hébergé = une classe de plus.
"""

from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ValidationError

from .extractors import SourceExtractor

BRAVE_API_URL = "https://api.search.brave.com/res/v1/"
MAX_RESULTS = 10


@dataclass(frozen=True, slots=True)
class SearchResult:
    title: str
    url: str


class SearchEngine(Protocol):
    async def search(self, query: str, *, count: int) -> list[SearchResult]:
        """Résultats dans l'ordre du moteur. Lève une `SearchError` si le moteur ne répond pas normalement."""
        ...


class SearchError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class _BraveResult(BaseModel):
    title: str
    url: str


class _BraveWeb(BaseModel):
    results: list[_BraveResult] = []


class _BraveResponse(BaseModel):
    """Seuls les champs lus sont déclarés : les autres (`query`, `mixed`, `videos`…) sont ignorés."""

    web: _BraveWeb | None = None


def create_brave_client(api_key: str, *, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """Seul endroit qui connaît la clé Brave. `transport` permet aux tests de simuler l'API (aucun quota consommé)."""
    return httpx.AsyncClient(
        base_url=BRAVE_API_URL,
        headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
        timeout=httpx.Timeout(15.0),
        transport=transport,
    )


class BraveSearchEngine:
    """API REST « Web Search » de Brave (https://api.search.brave.com/app/documentation/web-search)."""

    def __init__(self, http: httpx.AsyncClient) -> None:
        self._http = http

    async def search(self, query: str, *, count: int) -> list[SearchResult]:
        try:
            response = await self._http.get("web/search", params={"q": query, "count": count})
        except httpx.HTTPError as error:
            raise SearchError(f"Brave Search injoignable : {error}") from error
        if response.status_code == 429:
            raise SearchError("Brave Search : quota ou débit dépassé (429)", status=429)
        if response.is_error:
            raise SearchError(
                f"Brave Search -> {response.status_code}: {response.text[:300]}", status=response.status_code
            )
        try:
            body = _BraveResponse.model_validate_json(response.content)
        except ValidationError as error:
            raise SearchError(f"Réponse Brave Search inattendue : {error}") from error
        results = body.web.results if body.web is not None else []
        return [SearchResult(title=result.title, url=result.url) for result in results]


def dork_query(extractor: type[SourceExtractor], title: str) -> str:
    """`site:<domaine> "<titre>"` : domaine sans `www.` (couvre les deux), guillemets du titre retirés."""
    host = (urlsplit(extractor.base_url).hostname or "").removeprefix("www.")
    phrase = " ".join(title.replace('"', " ").split())
    if not phrase:
        raise ValueError("Titre vide")
    return f'site:{host} "{phrase}"'


class SeriesFinder:
    def __init__(self, engine: SearchEngine) -> None:
        self._engine = engine

    async def find(self, extractor: type[SourceExtractor], title: str) -> str | None:
        """URL canonique de la première fiche de `extractor` parmi les résultats ; `None` si aucune."""
        for result in await self._engine.search(dork_query(extractor, title), count=MAX_RESULTS):
            if (url := extractor.series_url(result.url)) is not None:
                return url
        return None
