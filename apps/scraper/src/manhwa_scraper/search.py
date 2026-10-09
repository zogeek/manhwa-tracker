"""Recherche de la fiche d'une œuvre : recherche native du site si elle existe, sinon « dorking ».

Recherche native : la source interroge son propre moteur (`SourceExtractor.search_series`, ex. l'API AJAX
de mangas-origines). Elle est prioritaire : une requête au site, résultats à jour, aucun tiers.

Dorking (repli) : `site:scan-manga.com "Titre"` posé à un moteur tiers.

Le site cible ne reçoit aucune requête : on interroge l'index que le moteur a déjà construit. Le moteur doit
autoriser l'automatisation, ce qui exclut la page HTML d'un moteur grand public (DuckDuckGo répond aux robots
par un CAPTCHA : refus ciblé, cf. README, « Éthique »).

Moteurs, derrière le protocole `SearchEngine` :
- `SearxngSearchEngine` (prioritaire) : instance SearXNG auto-hébergée, API JSON, aucun compte chez un tiers ;
- `BraveSearchEngine` (repli, inactif par défaut) : API officielle de Brave, qui exige un compte et une clé.
"""

from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ValidationError

from .extractors import ExtractionError, SeriesLink, SourceExtractor, UnsupportedDiscoveryError
from .fetching import FetchError

BRAVE_API_URL = "https://api.search.brave.com/res/v1/"
USER_AGENT = "manhwa-scraper (+tracker personnel)"
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


class _SearxngResult(BaseModel):
    title: str
    url: str


class _SearxngResponse(BaseModel):
    """Seuls les champs lus sont déclarés : `answers`, `infoboxes`, `suggestions`… sont ignorés."""

    results: list[_SearxngResult] = []


def create_searxng_client(base_url: str, *, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """`base_url` = racine de l'instance (ex. `http://localhost:8080`, ou un sous-chemin `https://hote/searxng`)."""
    return httpx.AsyncClient(
        base_url=f"{base_url.rstrip('/')}/",  # `/` final : `search` se résout sous un éventuel sous-chemin
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        timeout=httpx.Timeout(20.0),  # SearXNG attend lui-même les moteurs qu'il interroge
        transport=transport,
    )


class SearxngSearchEngine:
    """API de recherche d'une instance SearXNG : `GET /search?q=…&format=json`.

    Le format JSON doit être autorisé dans `settings.yml` de l'instance (`search.formats: [html, json]`),
    sinon SearXNG répond 403.
    """

    def __init__(self, http: httpx.AsyncClient) -> None:
        self._http = http

    async def search(self, query: str, *, count: int) -> list[SearchResult]:
        try:
            response = await self._http.get("search", params={"q": query, "format": "json"})
        except httpx.HTTPError as error:
            raise SearchError(f"SearXNG injoignable : {error}") from error
        if response.status_code == 403:
            raise SearchError(
                "SearXNG refuse le format JSON : ajouter `json` à `search.formats` dans settings.yml", status=403
            )
        if response.is_error:
            raise SearchError(f"SearXNG -> {response.status_code}: {response.text[:300]}", status=response.status_code)
        try:
            body = _SearxngResponse.model_validate_json(response.content)
        except ValidationError as error:
            raise SearchError(f"Réponse SearXNG inattendue : {error}") from error
        # SearXNG n'a pas de paramètre « nombre de résultats » : on tronque après coup.
        return [SearchResult(title=result.title, url=result.url) for result in body.results[:count]]


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


def _normalized(title: str) -> str:
    return " ".join(title.casefold().split())


def best_match(extractor: type[SourceExtractor], candidates: list[SeriesLink], title: str) -> str | None:
    """URL canonique de la fiche retenue : titre identique (casse et espaces ignorés) d'abord, sinon la première.

    Les candidats qui ne sont pas des fiches de `extractor` (accueil, autre site, page de catalogue) sont écartés.
    Un titre identique passe devant : « Solo Leveling » ne doit pas tomber sur « Solo Leveling : Ragnarok ».
    """
    wanted = _normalized(title)
    pages = [(link.title, url) for link in candidates if (url := extractor.series_url(link.url)) is not None]
    exact = next((url for found, url in pages if _normalized(found) == wanted), None)
    return exact if exact is not None else next((url for _, url in pages), None)


class SeriesFinder:
    """Trouve la fiche d'une œuvre sur une source : sa recherche native si elle en a une, sinon le dorking.

    `engine` absent (aucun moteur configuré) : seules les sources à recherche native restent cherchables.
    """

    def __init__(self, engine: SearchEngine | None) -> None:
        self._engine = engine

    async def find(self, extractor: SourceExtractor, title: str) -> str | None:
        """URL canonique de la fiche ; `None` si aucune. `SearchError` si la recherche est impossible ou en panne."""
        if not _normalized(title.replace('"', " ")):
            raise ValueError("Titre vide")
        try:
            candidates = await extractor.search_series(title)
        except UnsupportedDiscoveryError:
            candidates = await self._dork(type(extractor), title)
        except (FetchError, ExtractionError) as error:
            # Pas de repli sur le dorking : la source a parlé (ou bloque), le moteur tiers n'en saurait pas plus.
            raise SearchError(f"Recherche native {extractor.slug} en échec : {error}") from error
        return best_match(type(extractor), candidates, title)

    async def _dork(self, extractor: type[SourceExtractor], title: str) -> list[SeriesLink]:
        if self._engine is None:
            raise SearchError(
                f"« {extractor.slug} » n'a pas de recherche native et aucun moteur n'est configuré "
                "(définir SEARXNG_URL, ex. http://localhost:8080)"
            )
        results = await self._engine.search(dork_query(extractor, title), count=MAX_RESULTS)
        return [SeriesLink(title=result.title, url=result.url) for result in results]
