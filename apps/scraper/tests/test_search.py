"""Recherche : SearXNG et Brave simulés par `httpx.MockTransport`, le site par `FakeFetcher` (aucun appel réel)."""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import ClassVar

import httpx
import pytest

from manhwa_scraper.extractors.sites.mangas_origines import MangasOriginesExtractor
from manhwa_scraper.extractors.sites.scan_manga import ScanMangaExtractor
from manhwa_scraper.extractors.themes import MadaraExtractor
from manhwa_scraper.search import (
    BraveSearchEngine,
    SearchError,
    SearchResult,
    SearxngSearchEngine,
    SeriesFinder,
    create_brave_client,
    create_searxng_client,
    dork_query,
)

from .fakes import FakeFetcher, blocked

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


SEARXNG = "http://searx.test/searxng"


@dataclass
class FakeSearxng:
    """Fausse instance SearXNG : `GET /searxng/search?format=json` → `status` + `body`."""

    status: int = 200
    body: object = field(default_factory=lambda: {"query": "x", "results": []})
    requests: list[httpx.Request] = field(default_factory=list)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path != "/searxng/search":
            return httpx.Response(404)
        return httpx.Response(self.status, content=json.dumps(self.body))


@pytest.fixture
def searxng() -> FakeSearxng:
    return FakeSearxng()


@pytest.fixture
async def searxng_engine(searxng: FakeSearxng) -> AsyncIterator[SearxngSearchEngine]:
    async with create_searxng_client(SEARXNG, transport=searxng.transport()) as http:
        yield SearxngSearchEngine(http)


class TestSearxngSearchEngine:
    async def test_queries_the_json_api_under_the_instance_path(
        self, searxng: FakeSearxng, searxng_engine: SearxngSearchEngine
    ) -> None:
        await searxng_engine.search('site:scan-manga.com "Solo Leveling"', count=5)

        (request,) = searxng.requests
        assert (request.url.host, request.url.path) == ("searx.test", "/searxng/search")
        assert request.url.params["q"] == 'site:scan-manga.com "Solo Leveling"'
        assert request.url.params["format"] == "json"
        assert "X-Subscription-Token" not in request.headers  # aucun compte, aucune clé

    async def test_returns_results_in_order_truncated_to_count(
        self, searxng: FakeSearxng, searxng_engine: SearxngSearchEngine
    ) -> None:
        searxng.body = {
            "query": "x",
            "number_of_results": 0,
            "results": [
                {"title": "A", "url": "https://a.test/", "engine": "brave", "score": 2.0, "content": "…"},
                {"title": "B", "url": "https://b.test/", "engines": ["mojeek"]},
                {"title": "C", "url": "https://c.test/"},
            ],
            "answers": [],
            "infoboxes": [],
        }

        assert await searxng_engine.search("x", count=2) == [
            SearchResult("A", "https://a.test/"),
            SearchResult("B", "https://b.test/"),
        ]

    async def test_a_disabled_json_format_explains_the_fix(
        self, searxng: FakeSearxng, searxng_engine: SearxngSearchEngine
    ) -> None:
        searxng.status = 403

        with pytest.raises(SearchError, match=r"search\.formats") as error:
            await searxng_engine.search("x", count=5)
        assert error.value.status == 403

    async def test_rate_limiting_is_an_error(self, searxng: FakeSearxng, searxng_engine: SearxngSearchEngine) -> None:
        searxng.status = 429

        with pytest.raises(SearchError) as error:
            await searxng_engine.search("x", count=5)
        assert error.value.status == 429

    async def test_an_unexpected_body_is_an_error(
        self, searxng: FakeSearxng, searxng_engine: SearxngSearchEngine
    ) -> None:
        searxng.body = {"results": [{"title": "sans url"}]}

        with pytest.raises(SearchError, match="inattendue"):
            await searxng_engine.search("x", count=5)

    async def test_an_unreachable_instance_is_an_error(self) -> None:
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refusé", request=request)

        async with create_searxng_client(SEARXNG, transport=httpx.MockTransport(refuse)) as http:
            with pytest.raises(SearchError, match="injoignable"):
                await SearxngSearchEngine(http).search("x", count=5)


class TestDorkQuery:
    def test_targets_the_bare_domain_with_an_exact_phrase(self) -> None:
        assert dork_query(ScanMangaExtractor, "Solo Leveling") == 'site:scan-manga.com "Solo Leveling"'

    def test_quotes_and_extra_spaces_cannot_break_the_phrase(self) -> None:
        assert dork_query(MangasOriginesExtractor, ' Le  "Roi" ') == 'site:mangas-origines.fr "Le Roi"'

    def test_rejects_an_empty_title(self) -> None:
        with pytest.raises(ValueError, match="vide"):
            dork_query(ScanMangaExtractor, ' " ')


class DorkOnly(MadaraExtractor):
    """Source Madara sans recherche native : `SeriesFinder` doit passer par le moteur."""

    slug: ClassVar[str] = "dork-only"
    name: ClassVar[str] = "Sans recherche"
    base_url: ClassVar[str] = "https://scan.test/"


ORIGINES_AJAX = "https://mangas-origines.fr/wp-admin/admin-ajax.php"


def origines(body: str | None = None) -> tuple[MangasOriginesExtractor, FakeFetcher]:
    fetcher = FakeFetcher()
    if body is not None:
        fetcher.add(ORIGINES_AJAX, body, method="POST")
    return MangasOriginesExtractor(fetcher), fetcher


def ajax_hits(*hits: tuple[str, str]) -> str:
    return json.dumps({"success": True, "data": [{"title": title, "url": url} for title, url in hits]})


class TestSeriesFinderDorking:
    async def test_returns_the_first_series_page_of_the_source(self) -> None:
        engine = FakeSearchEngine(
            [
                SearchResult("Autre site", "https://ailleurs.test/manga/solo/"),
                SearchResult("Accueil", "https://www.scan-manga.com/"),
                SearchResult("Solo Leveling - Scan Manga", "https://scan-manga.com/1805-54398/Solo-Leveling.html"),
                SearchResult("Doublon", "https://www.scan-manga.com/9/Autre.html"),
            ]
        )

        url = await SeriesFinder(engine).find(ScanMangaExtractor(FakeFetcher()), "Solo Leveling")

        assert url == "https://www.scan-manga.com/1805-54398/Solo-Leveling.html"
        assert engine.queries == ['site:scan-manga.com "Solo Leveling"']

    async def test_a_chapter_result_leads_back_to_its_series(self) -> None:
        engine = FakeSearchEngine([SearchResult("Ch. 12", "https://scan.test/manga/solo/chapitre-12/")])

        assert await SeriesFinder(engine).find(DorkOnly(FakeFetcher()), "Solo") == "https://scan.test/manga/solo/"

    async def test_none_when_nothing_matches(self) -> None:
        engine = FakeSearchEngine([SearchResult("Catalogue", "https://scan.test/manga/page/2/")])

        assert await SeriesFinder(engine).find(DorkOnly(FakeFetcher()), "Introuvable") is None

    async def test_without_engine_a_source_without_native_search_cannot_be_searched(self) -> None:
        with pytest.raises(SearchError, match="SEARXNG_URL"):
            await SeriesFinder(None).find(DorkOnly(FakeFetcher()), "Solo")

    async def test_rejects_an_empty_title_before_any_request(self) -> None:
        engine = FakeSearchEngine([])

        with pytest.raises(ValueError, match="vide"):
            await SeriesFinder(engine).find(DorkOnly(FakeFetcher()), ' " ')
        assert engine.queries == []


class TestSeriesFinderNativeSearch:
    async def test_is_used_first_and_the_engine_is_never_called(self) -> None:
        engine = FakeSearchEngine([SearchResult("Autre", "https://mangas-origines.fr/oeuvre/mauvaise-piste/")])
        extractor, fetcher = origines(ajax_hits(("Necromancer", "https://mangas-origines.fr/oeuvre/necromancer/")))

        url = await SeriesFinder(engine).find(extractor, "Necromancer")

        assert url == "https://mangas-origines.fr/oeuvre/necromancer/"
        assert engine.queries == []
        (call,) = fetcher.calls
        assert (call.method, call.url) == ("POST", ORIGINES_AJAX)
        assert call.data == {"action": "madara_child_search", "term": "Necromancer"}

    async def test_works_without_any_engine_configured(self) -> None:
        extractor, _ = origines(ajax_hits(("Necromancer", "https://mangas-origines.fr/oeuvre/necromancer/")))

        assert await SeriesFinder(None).find(extractor, "Necromancer") == (
            "https://mangas-origines.fr/oeuvre/necromancer/"
        )

    async def test_prefers_the_exact_title_over_the_first_spin_off(self) -> None:
        # Ordre réel du site pour « solo leveling » (relevé du 2026-10-09) : les dérivés passent devant.
        extractor, _ = origines(
            ajax_hits(
                ("Solo Leveling Arise : Hunters Origins", "https://mangas-origines.fr/oeuvre/solo-leveling-arise/"),
                ("Solo Leveling : Ragnarok", "https://mangas-origines.fr/oeuvre/solo-leveling-ragnarok/"),
                ("Solo  Leveling", "https://mangas-origines.fr/oeuvre/solo-leveling/"),
            )
        )

        assert await SeriesFinder(None).find(extractor, "solo leveling") == (
            "https://mangas-origines.fr/oeuvre/solo-leveling/"
        )

    async def test_falls_back_to_the_first_series_page_without_an_exact_title(self) -> None:
        extractor, _ = origines(
            ajax_hits(
                ("Lien mort", "https://ailleurs.test/oeuvre/x/"),
                ("Solo Leveling : Ragnarok", "https://mangas-origines.fr/oeuvre/solo-leveling-ragnarok/"),
            )
        )

        assert await SeriesFinder(None).find(extractor, "Solo Leveling Ragnarok") == (
            "https://mangas-origines.fr/oeuvre/solo-leveling-ragnarok/"
        )

    async def test_no_result_is_final_without_asking_the_engine(self) -> None:
        engine = FakeSearchEngine([SearchResult("X", "https://mangas-origines.fr/oeuvre/x/")])
        extractor, _ = origines(json.dumps({"success": True, "data": []}))

        assert await SeriesFinder(engine).find(extractor, "Introuvable") is None
        assert engine.queries == []

    async def test_a_site_failure_is_a_search_error(self) -> None:
        extractor, _ = origines()  # aucune réponse enregistrée : le faux site répond 404

        with pytest.raises(SearchError, match="mangas-origines"):
            await SeriesFinder(None).find(extractor, "Solo")

    async def test_an_anti_bot_block_is_a_search_error(self) -> None:
        extractor, fetcher = origines()
        fetcher.add(ORIGINES_AJAX, blocked(ORIGINES_AJAX), method="POST")

        with pytest.raises(SearchError, match="Bloqué"):
            await SeriesFinder(None).find(extractor, "Solo")

    async def test_an_unreadable_answer_is_a_search_error(self) -> None:
        extractor, _ = origines("<html>maintenance</html>")

        with pytest.raises(SearchError, match="inattendue"):
            await SeriesFinder(None).find(extractor, "Solo")
