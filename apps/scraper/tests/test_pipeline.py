from collections.abc import AsyncIterator
from typing import ClassVar
from uuid import UUID

import pytest

from manhwa_scraper.extractors.themes import MadaraExtractor
from manhwa_scraper.fetching import FetchError
from manhwa_scraper.ingest_client import IngestClient, create_http_client
from manhwa_scraper.pipeline import ScrapeRunner

from .fakes import FakeFetcher, FakeIngestApi, blocked, fixture, no_sleep

SOURCE_ID = UUID("0c7e1f0a-0000-4000-8000-000000000001")
CATALOG_1 = "https://scan.test/manga/?m_orderby=latest"
CATALOG_2 = "https://scan.test/manga/page/2/?m_orderby=latest"
NECRO = "https://scan.test/manga/necro/"
SOLO = "https://scan.test/manga/solo/"


class DemoMadara(MadaraExtractor):
    slug: ClassVar[str] = "demo"
    name: ClassVar[str] = "Démo"
    base_url: ClassVar[str] = "https://scan.test/"


@pytest.fixture
def api() -> FakeIngestApi:
    return FakeIngestApi()


@pytest.fixture
def fetcher() -> FakeFetcher:
    fetcher = FakeFetcher()
    fetcher.add(CATALOG_1, fixture("madara_catalog.html"))
    fetcher.add(CATALOG_2, "<html><body></body></html>")
    fetcher.add(NECRO, fixture("madara_series.html"))
    return fetcher


@pytest.fixture
async def ingest(api: FakeIngestApi) -> AsyncIterator[IngestClient]:
    async with create_http_client("http://api.test", "k" * 32, transport=api.transport()) as http:
        yield IngestClient(http, sleep=no_sleep)


def runner(fetcher: FakeFetcher, ingest: IngestClient, *, batch_size: int = 20) -> ScrapeRunner:
    return ScrapeRunner(DemoMadara(fetcher), ingest, source_id=SOURCE_ID, worker_version="test", batch_size=batch_size)


async def test_successful_run_sends_batches_and_closes_the_run(
    api: FakeIngestApi, fetcher: FakeFetcher, ingest: IngestClient
) -> None:
    fetcher.add(SOLO, fixture("madara_series_ajax.html"))
    fetcher.add(f"{SOLO}ajax/chapters/", fixture("madara_chapters_fragment.html"), method="POST")

    report = await runner(fetcher, ingest, batch_size=1).run()

    assert report.outcome == "succeeded"
    assert (report.stats.series_scraped, report.stats.batches_sent, report.stats.chapters_sent) == (2, 2, 4)
    keys = [r.headers["idempotency-key"] for r in api.requests if r.url.path == "/api/ingest/batches"]
    assert keys == [f"{api.run_id}:0", f"{api.run_id}:1"]
    batch = api.bodies("POST", "/api/ingest/batches")[0]
    assert batch["scrapeRunId"] == api.run_id
    [finish] = api.bodies("PATCH", f"/api/ingest/runs/{api.run_id}")
    assert finish["status"] == "succeeded"
    [health] = api.bodies("POST", "/api/ingest/health")
    assert health["samples"] == [
        {
            "sourceId": str(SOURCE_ID),
            "scrapeRunId": api.run_id,
            "status": "up",
            "checkedAt": health["samples"][0]["checkedAt"],
        }
    ]


async def test_a_failing_series_makes_the_run_partial(
    api: FakeIngestApi, fetcher: FakeFetcher, ingest: IngestClient
) -> None:
    fetcher.add(SOLO, FetchError("timeout", url=SOLO))

    report = await runner(fetcher, ingest).run()

    assert report.outcome == "partial"
    assert (report.stats.series_scraped, report.stats.series_failed) == (1, 1)
    assert api.bodies("PATCH", f"/api/ingest/runs/{api.run_id}")[0]["stats"] == {
        "series_found": 2,
        "series_scraped": 1,
        "series_failed": 1,
        "chapters_sent": 2,
        "batches_sent": 1,
    }


async def test_an_anti_bot_block_stops_the_run_and_flags_the_source(
    api: FakeIngestApi, fetcher: FakeFetcher, ingest: IngestClient
) -> None:
    fetcher.add(NECRO, blocked(NECRO))

    report = await runner(fetcher, ingest).run()

    assert report.outcome == "failed"
    assert [call.url for call in fetcher.calls] == [CATALOG_1, NECRO]  # on n'insiste pas sur les fiches suivantes
    assert api.bodies("POST", "/api/ingest/batches") == []
    sample = api.bodies("POST", "/api/ingest/health")[0]["samples"][0]
    assert (sample["status"], sample["blockedBy"], sample["httpStatus"]) == ("blocked", "cloudflare", 403)


async def test_an_empty_catalog_fails_the_run(api: FakeIngestApi, ingest: IngestClient) -> None:
    fetcher = FakeFetcher()
    fetcher.add(CATALOG_1, "<html><body></body></html>")

    report = await runner(fetcher, ingest).run()

    assert report.outcome == "failed"
    assert report.error is not None
    assert "sélecteurs" in report.error


async def test_an_unexpected_error_still_closes_the_run(api: FakeIngestApi, ingest: IngestClient) -> None:
    fetcher = FakeFetcher()  # catalogue absent → FetchError hors d'une fiche : le run ne peut pas continuer

    with pytest.raises(FetchError):
        await runner(fetcher, ingest).run()

    assert api.bodies("PATCH", f"/api/ingest/runs/{api.run_id}")[0]["status"] == "failed"
