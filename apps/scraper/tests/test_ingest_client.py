"""Contrat HTTP avec l'API Hono (`/api/ingest/*`), sur un faux serveur `httpx.MockTransport`."""

from collections.abc import AsyncIterator
from uuid import UUID

import httpx
import pytest

from manhwa_scraper.contract import IngestBatch, IngestManhwa
from manhwa_scraper.ingest_client import IngestClient, IngestError, create_http_client

from .fakes import FakeIngestApi, no_sleep

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
