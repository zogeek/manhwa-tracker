"""Cibles « séries suivies » : URL connue → scrapée telle quelle ; URL manquante → cherchée puis rattachée."""

from collections.abc import AsyncIterator, Iterable
from typing import ClassVar
from uuid import UUID

import pytest

from manhwa_scraper.contract import TrackedSeries
from manhwa_scraper.extractors.themes import MadaraExtractor
from manhwa_scraper.pipeline import ScrapeTarget
from manhwa_scraper.search import SearchError, SearchResult, SeriesFinder
from manhwa_scraper.tracking import tracked_targets

from .fakes import tracked_series

NECRO_ID = UUID("a1000000-0000-4000-8000-000000000001")
SOLO_ID = UUID("a1000000-0000-4000-8000-000000000002")
TOWER_ID = UUID("a1000000-0000-4000-8000-000000000003")
NECRO = "https://scan.test/manga/necro/"
SOLO = "https://scan.test/manga/solo/"


class Searchable(MadaraExtractor):
    slug: ClassVar[str] = "demo"
    name: ClassVar[str] = "Démo"
    base_url: ClassVar[str] = "https://scan.test/"

    @classmethod
    def series_url(cls, url: str) -> str | None:
        return url if url.startswith("https://scan.test/manga/") else None


class FakeEngine:
    """Moteur simulé : titre cherché → résultats ; une `SearchError` à lever le cas échéant."""

    def __init__(self, results: dict[str, list[str]], *, error: SearchError | None = None) -> None:
        self._results = results
        self._error = error
        self.queries: list[str] = []

    async def search(self, query: str, *, count: int) -> list[SearchResult]:
        self.queries.append(query)
        if self._error is not None:
            raise self._error
        title = query.split('"')[1]
        return [SearchResult(title=title, url=url) for url in self._results.get(title, [])]


async def stream(rows: Iterable[TrackedSeries]) -> AsyncIterator[TrackedSeries]:
    for row in rows:
        yield row


def series(manhwa_id: UUID, title: str, url: str | None = None) -> TrackedSeries:
    return TrackedSeries.model_validate(tracked_series(str(manhwa_id), title, url))


async def collect(rows: list[TrackedSeries], engine: FakeEngine | None) -> list[ScrapeTarget]:
    finder = SeriesFinder(engine) if engine is not None else None
    return [target async for target in tracked_targets(stream(rows), Searchable, finder)]


async def test_a_known_url_is_scraped_without_searching() -> None:
    engine = FakeEngine({})

    targets = await collect([series(NECRO_ID, "Necro", NECRO)], engine)

    assert targets == [ScrapeTarget(url=NECRO, manhwa_id=NECRO_ID)]
    assert engine.queries == []


async def test_a_missing_url_is_searched_and_attached_to_the_series() -> None:
    engine = FakeEngine({"Solo Leveling": ["https://ailleurs.test/solo", SOLO]})

    targets = await collect([series(SOLO_ID, "Solo Leveling")], engine)

    assert targets == [ScrapeTarget(url=SOLO, manhwa_id=SOLO_ID)]
    assert engine.queries == ['site:scan.test "Solo Leveling"']


async def test_known_urls_come_first_and_a_found_page_already_owned_is_dropped() -> None:
    # Trié par id comme l'API : la série à chercher arrive avant celle qui porte déjà la page.
    engine = FakeEngine({"Necromancer": [NECRO]})

    targets = await collect([series(NECRO_ID, "Necromancer"), series(SOLO_ID, "Necro", NECRO)], engine)

    assert targets == [ScrapeTarget(url=NECRO, manhwa_id=SOLO_ID)]


async def test_a_series_not_found_is_skipped() -> None:
    engine = FakeEngine({})

    targets = await collect([series(SOLO_ID, "Introuvable"), series(NECRO_ID, "Necro", NECRO)], engine)

    assert targets == [ScrapeTarget(url=NECRO, manhwa_id=NECRO_ID)]


async def test_without_engine_only_known_urls_are_scraped() -> None:
    targets = await collect([series(SOLO_ID, "Solo"), series(NECRO_ID, "Necro", NECRO)], None)

    assert targets == [ScrapeTarget(url=NECRO, manhwa_id=NECRO_ID)]


async def test_a_failing_engine_is_not_asked_again() -> None:
    engine = FakeEngine({}, error=SearchError("SearXNG injoignable"))

    targets = await collect([series(SOLO_ID, "Solo"), series(TOWER_ID, "Tower")], engine)

    assert targets == []
    assert len(engine.queries) == 1


@pytest.mark.parametrize("title", ['""', "  "])
async def test_an_unsearchable_title_is_skipped(title: str) -> None:
    engine = FakeEngine({})

    assert await collect([series(SOLO_ID, title)], engine) == []
    assert engine.queries == []
