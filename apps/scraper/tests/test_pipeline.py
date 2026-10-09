from collections.abc import AsyncIterator
from typing import ClassVar
from uuid import UUID

import pytest
from selectolax.lexbor import LexborHTMLParser

from manhwa_scraper.contract import IngestManhwa, RunOutcome
from manhwa_scraper.extractors import SeriesLink, UnsupportedDiscoveryError, UnsupportedSeriesError
from manhwa_scraper.extractors.themes import MadaraExtractor
from manhwa_scraper.fetching import FetchError
from manhwa_scraper.ingest_client import IngestClient, create_http_client
from manhwa_scraper.pipeline import ScrapeRunner, ScrapeTarget, explicit_urls

from .fakes import FakeFetcher, FakeIngestApi, blocked, fixture, no_sleep

SOURCE_ID = UUID("0c7e1f0a-0000-4000-8000-000000000001")
CATALOG_1 = "https://scan.test/manga/?m_orderby=latest"
CATALOG_2 = "https://scan.test/manga/page/2/?m_orderby=latest"
NECRO = "https://scan.test/manga/necro/"
SOLO = "https://scan.test/manga/solo/"
TOP = "https://scan.test/top/"


class DemoMadara(MadaraExtractor):
    slug: ClassVar[str] = "demo"
    name: ClassVar[str] = "Démo"
    base_url: ClassVar[str] = "https://scan.test/"


class DemoMadaraWithTop(DemoMadara):
    top_page_url: ClassVar[str | None] = TOP

    def parse_top(self, document: LexborHTMLParser, page_url: str) -> list[SeriesLink]:
        return [SeriesLink(title=link.text(), url=link.attributes.get("href") or "") for link in document.css("a")]


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
        "series_skipped": 0,
        "series_rejected": 0,
        "chapters_sent": 2,
        "batches_sent": 1,
    }


async def test_a_series_rejected_by_the_api_makes_the_run_partial(
    api: FakeIngestApi, fetcher: FakeFetcher, ingest: IngestClient
) -> None:
    fetcher.add(SOLO, fixture("madara_series_ajax.html"))
    fetcher.add(f"{SOLO}ajax/chapters/", fixture("madara_chapters_fragment.html"), method="POST")
    api.rejected_urls.add(NECRO)

    report = await runner(fetcher, ingest).run()

    assert report.outcome == RunOutcome.partial
    assert (report.stats.series_scraped, report.stats.series_rejected) == (2, 1)


async def test_a_run_whose_every_series_is_rejected_fails(
    api: FakeIngestApi, fetcher: FakeFetcher, ingest: IngestClient
) -> None:
    api.rejected_urls.add(NECRO)

    report = await ScrapeRunner(
        DemoMadara(fetcher), ingest, source_id=SOURCE_ID, worker_version="test", targets=explicit_urls([NECRO])
    ).run()

    assert report.outcome == RunOutcome.failed
    assert report.error == "Aucune fiche n'a pu être extraite ni enregistrée"


async def test_an_unsupported_series_is_skipped_without_degrading_the_run(
    api: FakeIngestApi, fetcher: FakeFetcher, ingest: IngestClient
) -> None:
    class SkipsSolo(DemoMadara):
        def parse_series(self, document: LexborHTMLParser, series_url: str) -> IngestManhwa:
            if series_url == SOLO:
                raise UnsupportedSeriesError("roman")
            return super().parse_series(document, series_url)

    fetcher.add(SOLO, fixture("madara_series_ajax.html"))

    report = await ScrapeRunner(SkipsSolo(fetcher), ingest, source_id=SOURCE_ID, worker_version="test").run()

    assert report.outcome == RunOutcome.succeeded
    assert (report.stats.series_scraped, report.stats.series_skipped, report.stats.series_failed) == (1, 1, 0)
    assert len(api.bodies("POST", "/api/ingest/batches")[0]["manhwas"]) == 1


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


async def test_explicit_urls_scrape_only_the_given_series(
    api: FakeIngestApi, fetcher: FakeFetcher, ingest: IngestClient
) -> None:
    targets = explicit_urls([NECRO, NECRO])  # doublon d'un fichier de suivi : une seule requête

    report = await ScrapeRunner(
        DemoMadara(fetcher), ingest, source_id=SOURCE_ID, worker_version="test", targets=targets
    ).run()

    assert report.outcome == RunOutcome.succeeded
    assert [call.url for call in fetcher.calls] == [NECRO]  # aucun passage par le catalogue
    [batch] = api.bodies("POST", "/api/ingest/batches")
    assert [manhwa["sourceManhwaUrl"] for manhwa in batch["manhwas"]] == [NECRO]


async def test_a_top_run_scrapes_the_ranked_series(
    api: FakeIngestApi, fetcher: FakeFetcher, ingest: IngestClient
) -> None:
    fetcher.add(TOP, f'<html><body><a href="{NECRO}">Necro</a></body></html>')
    extractor = DemoMadaraWithTop(fetcher)

    report = await ScrapeRunner(
        extractor, ingest, source_id=SOURCE_ID, worker_version="test", targets=extractor.discover_top()
    ).run()

    assert report.outcome == RunOutcome.succeeded
    assert [call.url for call in fetcher.calls] == [TOP, NECRO]
    assert report.stats.series_scraped == 1


async def test_a_source_without_top_refuses_the_top_discovery(fetcher: FakeFetcher) -> None:
    with pytest.raises(UnsupportedDiscoveryError):
        [url async for url in DemoMadara(fetcher).discover_top()]
    assert fetcher.calls == []


async def test_a_tracked_target_attaches_the_page_to_its_api_series(
    api: FakeIngestApi, fetcher: FakeFetcher, ingest: IngestClient
) -> None:
    manhwa_id = UUID("a1000000-0000-4000-8000-000000000001")
    targets = explicit_targets([ScrapeTarget(url=NECRO, manhwa_id=manhwa_id)])

    report = await ScrapeRunner(
        DemoMadara(fetcher), ingest, source_id=SOURCE_ID, worker_version="test", targets=targets
    ).run()

    assert report.outcome == RunOutcome.succeeded
    [batch] = api.bodies("POST", "/api/ingest/batches")
    assert [(m["sourceManhwaUrl"], m["manhwaId"]) for m in batch["manhwas"]] == [(NECRO, str(manhwa_id))]


async def test_an_empty_tracking_list_is_not_a_failure(api: FakeIngestApi, ingest: IngestClient) -> None:
    fetcher = FakeFetcher()

    report = await ScrapeRunner(
        DemoMadara(fetcher),
        ingest,
        source_id=SOURCE_ID,
        worker_version="test",
        targets=explicit_targets([]),
        allow_empty=True,
    ).run()

    assert report.outcome == RunOutcome.succeeded
    assert fetcher.calls == []
    assert api.bodies("POST", "/api/ingest/batches") == []


async def explicit_targets(targets: list[ScrapeTarget]) -> AsyncIterator[ScrapeTarget]:
    for target in targets:
        yield target
