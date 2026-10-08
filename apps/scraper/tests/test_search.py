"""Dorking via Brave Search : l'API est simulée par `httpx.MockTransport`, aucun appel réel ni quota consommé."""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx
import pytest

from manhwa_scraper.extractors.sites.mangas_origines import MangasOriginesExtractor
from manhwa_scraper.extractors.sites.scan_manga import ScanMangaExtractor
from manhwa_scraper.search import (
    BraveSearchEngine,
    SearchError,
    SearchResult,
    SeriesFinder,
    create_brave_client,
    dork_query,
)

KEY = "brave-test-key"


@dataclass
class FakeBraveApi:
    """Faux `api.search.brave.com` : renvoie `status` + `body` et journalise les requêtes reçues."""

    status: int = 200
    body: object = field(default_factory=lambda: {"web": {"results": []}})
    requests: list[httpx.Request] = field(default_factory=list)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.headers.get("X-Subscription-Token") != KEY:
            return httpx.Response(401, json={"type": "ErrorResponse"})
        return httpx.Response(self.status, content=json.dumps(self.body))


@dataclass
class FakeSearchEngine:
    results: list[SearchResult]
    queries: list[str] = field(default_factory=list)

    async def search(self, query: str, *, count: int) -> list[SearchResult]:
        self.queries.append(query)
        return self.results[:count]


@pytest.fixture
def brave() -> FakeBraveApi:
    return FakeBraveApi()


@pytest.fixture
async def engine(brave: FakeBraveApi) -> AsyncIterator[BraveSearchEngine]:
    async with create_brave_client(KEY, transport=brave.transport()) as http:
        yield BraveSearchEngine(http)


class TestBraveSearchEngine:
    async def test_sends_the_key_and_the_query(self, brave: FakeBraveApi, engine: BraveSearchEngine) -> None:
        await engine.search('site:scan-manga.com "Solo Leveling"', count=5)

        (request,) = brave.requests
        assert request.url.host == "api.search.brave.com"
        assert request.url.path == "/res/v1/web/search"
        assert request.url.params["q"] == 'site:scan-manga.com "Solo Leveling"'
        assert request.url.params["count"] == "5"
        assert request.headers["Accept"] == "application/json"

    async def test_returns_web_results_in_order_and_ignores_other_fields(
        self, brave: FakeBraveApi, engine: BraveSearchEngine
    ) -> None:
        brave.body = {
            "type": "search",
            "query": {"original": "x"},
            "web": {
                "results": [
                    {"title": "A", "url": "https://a.test/", "description": "…", "age": "2 days"},
                    {"title": "B", "url": "https://b.test/"},
                ]
            },
        }

        assert await engine.search("x", count=2) == [
            SearchResult("A", "https://a.test/"),
            SearchResult("B", "https://b.test/"),
        ]

    async def test_no_web_section_means_no_result(self, brave: FakeBraveApi, engine: BraveSearchEngine) -> None:
        brave.body = {"type": "search", "query": {"original": "x"}}

        assert await engine.search("x", count=5) == []

    async def test_quota_exhaustion_is_reported(self, brave: FakeBraveApi, engine: BraveSearchEngine) -> None:
        brave.status = 429

        with pytest.raises(SearchError, match="quota") as error:
            await engine.search("x", count=5)
        assert error.value.status == 429

    async def test_a_wrong_key_is_an_error(self, brave: FakeBraveApi) -> None:
        async with create_brave_client("wrong", transport=brave.transport()) as http:
            with pytest.raises(SearchError) as error:
                await BraveSearchEngine(http).search("x", count=5)
        assert error.value.status == 401

    async def test_an_unexpected_body_is_an_error(self, brave: FakeBraveApi, engine: BraveSearchEngine) -> None:
        brave.body = {"web": {"results": [{"title": "sans url"}]}}

        with pytest.raises(SearchError, match="inattendue"):
            await engine.search("x", count=5)

    async def test_a_network_failure_is_an_error(self) -> None:
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refusé", request=request)

        async with create_brave_client(KEY, transport=httpx.MockTransport(refuse)) as http:
            with pytest.raises(SearchError, match="injoignable"):
                await BraveSearchEngine(http).search("x", count=5)


class TestDorkQuery:
    def test_targets_the_bare_domain_with_an_exact_phrase(self) -> None:
        assert dork_query(ScanMangaExtractor, "Solo Leveling") == 'site:scan-manga.com "Solo Leveling"'

    def test_quotes_and_extra_spaces_cannot_break_the_phrase(self) -> None:
        assert dork_query(MangasOriginesExtractor, ' Le  "Roi" ') == 'site:mangas-origines.fr "Le Roi"'

    def test_rejects_an_empty_title(self) -> None:
        with pytest.raises(ValueError, match="vide"):
            dork_query(ScanMangaExtractor, ' " ')


class TestSeriesFinder:
    async def test_returns_the_first_series_page_of_the_source(self) -> None:
        engine = FakeSearchEngine(
            [
                SearchResult("Autre site", "https://ailleurs.test/manga/solo/"),
                SearchResult("Accueil", "https://www.scan-manga.com/"),
                SearchResult("Solo Leveling", "https://scan-manga.com/1805-54398/Solo-Leveling.html"),
                SearchResult("Doublon", "https://www.scan-manga.com/9/Autre.html"),
            ]
        )

        url = await SeriesFinder(engine).find(ScanMangaExtractor, "Solo Leveling")

        assert url == "https://www.scan-manga.com/1805-54398/Solo-Leveling.html"
        assert engine.queries == ['site:scan-manga.com "Solo Leveling"']

    async def test_a_chapter_result_leads_back_to_its_series(self) -> None:
        engine = FakeSearchEngine([SearchResult("Ch. 12", "https://mangas-origines.fr/oeuvre/solo/chapitre-12/")])

        assert await SeriesFinder(engine).find(MangasOriginesExtractor, "Solo") == (
            "https://mangas-origines.fr/oeuvre/solo/"
        )

    async def test_none_when_nothing_matches(self) -> None:
        engine = FakeSearchEngine([SearchResult("Catalogue", "https://mangas-origines.fr/oeuvre/page/2/")])

        assert await SeriesFinder(engine).find(MangasOriginesExtractor, "Introuvable") is None
