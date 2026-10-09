"""Contrat HTTP avec l'API Hono (`/api/ingest/*`), sur un faux serveur `httpx.MockTransport`."""

from collections.abc import AsyncIterator
from uuid import UUID

import httpx
import pytest

from manhwa_scraper.contract import IngestBatch, IngestManhwa
from manhwa_scraper.ingest_client import IngestClient, IngestError, create_http_client

from .fakes import FakeIngestApi, no_sleep, tracked_series

SOURCE_ID = UUID("0c7e1f0a-0000-4000-8000-000000000001")
BATCH = IngestBatch(
    source_id=SOURCE_ID,
    manhwas=[IngestManhwa(source_manhwa_url="https://scan.test/manga/solo/", title="Solo")],
)


@pytest.fixture
def api() -> FakeIngestApi:
    return FakeIngestApi()


@pytest.fixture
async def client(api: FakeIngestApi) -> AsyncIterator[IngestClient]:
    async with create_http_client("http://api.test", "k" * 32, transport=api.transport()) as http:
        yield IngestClient(http, sleep=no_sleep)


async def test_authenticates_with_the_service_key(api: FakeIngestApi, client: IngestClient) -> None:
    run = await client.start_run(SOURCE_ID, "0.1.0")

    assert run.id == UUID(api.run_id)
    assert api.requests[0].headers["x-api-key"] == "k" * 32
    assert api.bodies("POST", "/api/ingest/runs") == [{"sourceId": str(SOURCE_ID), "workerVersion": "0.1.0"}]


async def test_retries_a_batch_on_transient_errors_with_the_same_idempotency_key(
    api: FakeIngestApi, client: IngestClient
) -> None:
    api.batch_failures = [503, 429]

    result = await client.send_batch(BATCH, idempotency_key="run-1:0")

    assert result.chapters_created == 2
    keys = [r.headers["idempotency-key"] for r in api.requests if r.url.path == "/api/ingest/batches"]
    assert keys == ["run-1:0"] * 3


async def test_does_not_retry_a_rejected_batch(api: FakeIngestApi, client: IngestClient) -> None:
    api.batch_failures = [400]

    with pytest.raises(IngestError) as error:
        await client.send_batch(BATCH, idempotency_key="run-1:0")

    assert error.value.status_code == 400
    assert len(api.requests) == 1


async def test_gives_up_after_the_retry_budget(api: FakeIngestApi, client: IngestClient) -> None:
    api.batch_failures = [503] * 10

    with pytest.raises(IngestError):
        await client.send_batch(BATCH, idempotency_key="run-1:0")

    assert len(api.requests) == 5


async def test_never_replays_a_non_idempotent_request_that_reached_the_api() -> None:
    calls: list[httpx.Request] = []

    def flaky(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(503, json={"error": "busy"})

    async with create_http_client("http://api.test", "k" * 32, transport=httpx.MockTransport(flaky)) as http:
        with pytest.raises(IngestError):
            await IngestClient(http, sleep=no_sleep).start_run(SOURCE_ID)

    assert len(calls) == 1  # rejouer ce POST risquerait d'ouvrir deux runs


async def test_retries_a_non_idempotent_request_that_never_left() -> None:
    attempts = 0

    def unreachable_then_ok(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ConnectError("connexion refusée", request=request)
        return httpx.Response(201, json={"data": {"id": str(SOURCE_ID), "status": "running"}})

    transport = httpx.MockTransport(unreachable_then_ok)
    async with create_http_client("http://api.test", "k" * 32, transport=transport) as http:
        run = await IngestClient(http, sleep=no_sleep).start_run(SOURCE_ID)

    assert run.status == "running"
    assert attempts == 2


IDS = [f"00000000-0000-4000-8000-00000000000{n}" for n in range(1, 6)]


class TestTrackedSeries:
    async def test_follows_the_cursor_until_the_last_page(self, api: FakeIngestApi, client: IngestClient) -> None:
        api.tracked = [tracked_series(manhwa_id, f"Série {n}") for n, manhwa_id in enumerate(IDS)]

        series = [item async for item in client.tracked_series(SOURCE_ID, page_size=2)]

        assert [str(item.manhwa_id) for item in series] == IDS
        pages = [r for r in api.requests if r.url.path == "/api/ingest/tracked"]
        assert [r.url.params.get("cursor") for r in pages] == [None, IDS[1], IDS[3]]
        assert all(r.headers["x-api-key"] == "k" * 32 for r in pages)
        assert all(r.url.params["sourceId"] == str(SOURCE_ID) and r.url.params["limit"] == "2" for r in pages)

    async def test_reads_a_series_still_to_be_found_on_the_source(
        self, api: FakeIngestApi, client: IngestClient
    ) -> None:
        api.tracked = [
            tracked_series(IDS[0], "Connue", "https://scan.test/manga/solo/"),
            tracked_series(IDS[1], "À chercher"),
        ]

        known, orphan = [item async for item in client.tracked_series(SOURCE_ID)]

        assert str(known.manhwa_url) == "https://scan.test/manga/solo/"
        assert orphan.manhwa_url is None
        assert orphan.title == "À chercher"

    async def test_an_empty_list_makes_a_single_request(self, api: FakeIngestApi, client: IngestClient) -> None:
        assert [item async for item in client.tracked_series(SOURCE_ID)] == []
        assert len(api.requests) == 1

    async def test_retries_a_page_on_transient_errors(self) -> None:
        statuses = [503, 200]

        def flaky(request: httpx.Request) -> httpx.Response:
            if statuses.pop(0) == 503:
                return httpx.Response(503, json={"error": "busy"})
            return httpx.Response(200, json={"data": [tracked_series(IDS[0], "Solo")], "nextCursor": None})

        async with create_http_client("http://api.test", "k" * 32, transport=httpx.MockTransport(flaky)) as http:
            series = [item async for item in IngestClient(http, sleep=no_sleep).tracked_series(SOURCE_ID)]

        assert [item.title for item in series] == ["Solo"]

    async def test_an_unknown_source_is_not_retried(self) -> None:
        calls: list[httpx.Request] = []

        def not_found(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return httpx.Response(404, json={"error": "Source not found"})

        async with create_http_client("http://api.test", "k" * 32, transport=httpx.MockTransport(not_found)) as http:
            with pytest.raises(IngestError, match="404"):
                _ = [item async for item in IngestClient(http, sleep=no_sleep).tracked_series(SOURCE_ID)]

        assert len(calls) == 1
