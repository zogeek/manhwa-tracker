"""Client de l'API d'ingestion Hono (`/api/ingest/*`), authentifié par la clé de service `x-api-key`.

Robustesse : les erreurs passagères (réseau, 429, 5xx) sont ré-essayées avec un recul exponentiel,
mais seulement quand c'est sans danger :
- lots (`Idempotency-Key`) et clôture de run (PATCH) : rejouables tels quels, l'API ne double rien ;
- ouverture de run et santé (POST sans clé) : ré-essayés seulement si la requête n'est jamais partie
  (échec de connexion), sinon on risquerait de créer deux runs.
"""

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from uuid import UUID

import httpx
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_random_exponential

from .contract import FinishRun, HealthSample, IngestBatch, RecordHealth, RunOutcome, StartRun
from .models import BatchResult, HealthResult, ResponseModel, ScrapeRun, to_payload

INGEST_PREFIX = "/api/ingest"
_TRANSIENT_STATUSES = frozenset({408, 429, 500, 502, 503, 504})


class IngestError(RuntimeError):
    """Réponse non-2xx de l'API : le message porte le statut et le corps `{ error }` renvoyé."""

    def __init__(self, response: httpx.Response) -> None:
        self.status_code = response.status_code
        self.body = response.text
        request = response.request
        super().__init__(f"{request.method} {request.url.path} -> {response.status_code}: {self.body[:500]}")


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    max_attempts: int = 5
    max_backoff_s: float = 30.0


def create_http_client(
    api_url: str, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> httpx.AsyncClient:
    """Seul endroit qui connaît la clé : elle est posée une fois sur le client, jamais passée aux extracteurs."""
    return httpx.AsyncClient(
        base_url=api_url,
        headers={"x-api-key": api_key},
        timeout=httpx.Timeout(30.0),
        transport=transport,
    )


def _is_transient(error: BaseException, *, idempotent: bool) -> bool:
    if isinstance(error, httpx.ConnectError | httpx.ConnectTimeout):
        return True  # La requête n'a jamais atteint l'API : toujours rejouable.
    if not idempotent:
        return False
    if isinstance(error, IngestError):
        return error.status_code in _TRANSIENT_STATUSES
    return isinstance(error, httpx.TransportError)


class IngestClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        retry: RetryPolicy | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._http = http
        self._retry = retry or RetryPolicy()
        self._sleep = sleep

    async def start_run(self, source_id: UUID, worker_version: str | None = None) -> ScrapeRun:
        body = StartRun(source_id=source_id, worker_version=worker_version)
        return await self._send("POST", "/runs", to_payload(body), ScrapeRun, idempotent=False)

    async def finish_run(
        self,
        run_id: UUID,
        status: RunOutcome,
        *,
        stats: Mapping[str, int] | None = None,
        error: str | None = None,
    ) -> ScrapeRun:
        # Erreur tronquée plutôt que rejetée : une trace trop longue ne doit pas empêcher de clore le run.
        body = FinishRun(
            status=status,
            stats=dict(stats) if stats is not None else None,
            error=error[:10_000] if error is not None else None,
        )
        return await self._send("PATCH", f"/runs/{run_id}", to_payload(body), ScrapeRun, idempotent=True)

    async def send_batch(self, batch: IngestBatch, idempotency_key: str) -> BatchResult:
        """Envoie un lot. La même clé est rejouée à chaque tentative : un timeout ne crée pas de doublon."""
        return await self._send(
            "POST",
            "/batches",
            to_payload(batch),
            BatchResult,
            idempotent=True,
            headers={"Idempotency-Key": idempotency_key},
        )

    async def record_health(self, samples: list[HealthSample]) -> HealthResult:
        body = RecordHealth(samples=samples)
        return await self._send("POST", "/health", to_payload(body), HealthResult, idempotent=False)

    async def _send[T: ResponseModel](
        self,
        method: str,
        path: str,
        body: dict[str, object],
        response_model: type[T],
        *,
        idempotent: bool,
        headers: Mapping[str, str] | None = None,
    ) -> T:
        retrying = AsyncRetrying(
            stop=stop_after_attempt(self._retry.max_attempts),
            wait=wait_random_exponential(multiplier=0.5, max=self._retry.max_backoff_s),
            retry=retry_if_exception(lambda error: _is_transient(error, idempotent=idempotent)),
            sleep=self._sleep,
            reraise=True,
        )
        async for attempt in retrying:
            with attempt:
                response = await self._http.request(method, f"{INGEST_PREFIX}{path}", json=body, headers=headers)
                if response.is_error:
                    raise IngestError(response)
                return _parse_data(response, response_model)
        raise AssertionError("unreachable: tenacity relance l'erreur finale (reraise=True)")


def _parse_data[T: ResponseModel](response: httpx.Response, model: type[T]) -> T:
    """Les réponses de l'API sont enveloppées : `{ "data": … }`."""
    envelope: object = response.json()
    if not isinstance(envelope, dict) or "data" not in envelope:
        raise IngestError(response)
    return model.model_validate(envelope["data"])
